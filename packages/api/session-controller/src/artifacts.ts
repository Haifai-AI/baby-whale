/**
 * Whale deliverable-file routes, three authenticated GET channels mounted
 * beside `/api/file`:
 *
 * - `/api/artifacts.list` — the DELIVERED set: successful `deliver` claims
 *   read back from the session log, stat'd against the workspace.
 * - `/api/artifacts.preview` — bounded parsed preview JSON for one artifact.
 * - `/api/artifacts.raw` — original bytes with single-range 206 support so
 *   media previews can seek.
 *
 * Paths are jailed to the session workspace's `deliverables/` and `uploads/`
 * directories (preview accepts any workspace-relative path); the connection
 * service authenticates requests before these handlers run.
 * @module @deepseek-ai/dsh-api-session-controller/artifacts
 */

import { open, readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import {
  convertToPdfCached,
  findSoffice,
  mediaPreviewKind,
  parseDocxPreview,
  parseMediaPreview,
  parsePptxPreview,
  parseTextPreview,
  parseXlsxCharts,
  parseXlsxPreview,
  previewCacheDir,
  recalcXlsxBytes,
  textPreviewKind,
  xlsxHasUncachedFormulas,
  type ParsedPreview,
} from '@deepseek-ai/dsh-host-apiproxy'

/** Content types the raw channel may serve. Media entries here
 * cover downloads too; the native-PLAYER set lives in artifacts-preview.ts
 * (VIDEO/AUDIO_EXTENSIONS) and is narrower (.mov serves, never plays). */
const RAW_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
}

/**
 * Parse an HTTP `Range: bytes=...` header into byte offsets. Only the
 * single-range `bytes` unit is understood; anything else (multi-range,
 * other units, malformed) yields undefined and the caller serves the
 * whole file. `bytes=a-` means through EOF; `bytes=-n` is a suffix range
 * (start undefined — the caller resolves it against the file size).
 */
export function parseByteRange(header: string | undefined): { start?: number | undefined; end: number } | undefined {
  if (header === undefined) return undefined
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/i)
  if (match === null) return undefined
  const rawStart = match[1]
  const rawEnd = match[2]
  if (rawStart === undefined || rawEnd === undefined) return undefined
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const suffix = Number.parseInt(rawEnd, 10)
    return suffix > 0 ? { end: suffix } : undefined
  }
  const start = Number.parseInt(rawStart, 10)
  if (!Number.isSafeInteger(start) || start < 0) return undefined
  const end = rawEnd === '' ? Number.MAX_SAFE_INTEGER : Number.parseInt(rawEnd, 10)
  if (!Number.isSafeInteger(end) || end < start) return undefined
  return { start, end }
}

const jsonFail = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Resolve one session's workspace cwd: live first, then the persisted header. */
async function sessionCwd(ctx: Context, sessionId: SessionId): Promise<string | undefined> {
  const live = ctx.sessions.get(sessionId)
  if (live !== undefined && live.header.cwd !== undefined) return live.header.cwd
  const observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
  try {
    return observation.header.cwd
  } finally {
    observation[Symbol.dispose]()
  }
}

/** Pair every deliver CALL with its RESULT: only successful claims surface. */
function claimedDeliverPaths(events: readonly SessionEvent[], cwd: string): Map<string, number> {
  const results = new Map<string, boolean>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const message = (event.data as {
      message?: { source?: { callId?: string }; isError?: boolean; content?: Array<{ text?: string }> }
    }).message
    const callId = message?.source?.callId
    if (callId === undefined) continue
    const failed = message?.isError === true
      || (message?.content ?? []).some(block => (block.text ?? '').includes('deliver:'))
    results.set(String(callId), !failed)
  }
  const claimed = new Map<string, number>()
  for (const event of events) {
    if (event.type !== 'tool/call' || event.data.name !== 'deliver') continue
    if (results.get(String(event.data.callId)) !== true) continue
    let paths: unknown
    try {
      paths = (JSON.parse(event.data.arguments) as { paths?: unknown }).paths
    } catch {
      continue
    }
    if (!Array.isArray(paths)) continue
    for (const raw of paths) {
      if (typeof raw !== 'string' || raw.length === 0 || raw.includes('..')) continue
      // Canonical key: workspace-relative, forward slashes.
      const normalized = raw.startsWith(cwd) ? raw.slice(cwd.length).replace(/^[/\\]+/, '') : raw
      const key = normalized.replaceAll('\\', '/')
      // Last claim wins, but KEEP FIRST POSITION: delete before set.
      claimed.delete(key)
      claimed.set(key, event.seq)
    }
  }
  return claimed
}

async function listArtifacts(ctx: Context, request: Request): Promise<Response> {
  const sessionId = (new URL(request.url).searchParams.get('session') ?? '') as SessionId
  const cwd = await sessionCwd(ctx, sessionId)
  if (cwd === undefined) return jsonFail(409, `session "${sessionId}" has no workspace`)
  const observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
  let claimed: Map<string, number>
  try {
    claimed = claimedDeliverPaths(observation.events, cwd)
  } finally {
    observation[Symbol.dispose]()
  }
  const artifacts: Array<{
    path: string
    name: string
    kind: 'xlsx' | 'docx' | 'pptx' | 'csv' | 'pdf' | 'image' | 'markdown' | 'text' | 'video' | 'audio' | 'other'
    size: number
    modifiedAt: number
    origin: 'deliverable' | 'upload'
  }> = []
  for (const [path] of claimed) {
    try {
      const info = await stat(resolve(cwd, path))
      const name = basename(path)
      const ext = (name.match(/[.][a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
      const kind = ext === '.xlsx' || ext === '.xlsm' ? 'xlsx' as const
        : ext === '.docx' ? 'docx' as const
          : ext === '.pptx' ? 'pptx' as const
            : ext === '.csv' || ext === '.tsv' ? 'csv' as const
              : ext === '.pdf' ? 'pdf' as const
                : ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext) ? 'image' as const
                  : textPreviewKind(ext) === 'markdown' ? 'markdown' as const
                    : textPreviewKind(ext) === 'text' ? 'text' as const
                      : mediaPreviewKind(ext) ?? 'other' as const
      artifacts.push({
        path, name, kind,
        size: info.size,
        modifiedAt: Math.round(info.mtimeMs),
        origin: 'deliverable',
      })
    } catch {
      // Claimed but since deleted (or moved): skip silently; the chat
      // log remains the source of truth for what was handed over.
    }
  }
  artifacts.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return new Response(JSON.stringify({ artifacts }), { headers: { 'content-type': 'application/json' } })
}

async function previewArtifact(ctx: Context, request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const sessionId = (params.get('session') ?? '') as SessionId
  const path = params.get('path') ?? ''
  const cwd = await sessionCwd(ctx, sessionId)
  if (cwd === undefined) return jsonFail(409, `session "${sessionId}" has no workspace`)
  const absolute = resolve(cwd, path)
  if (!absolute.startsWith(resolve(cwd))) return jsonFail(403, 'preview path escapes the workspace')
  const ext = (path.match(/[.][a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  // Media previews carry identity only — answer before the byte read so
  // a feature-length video is never buffered just to learn its name.
  if (mediaPreviewKind(ext) !== undefined) {
    const info = await stat(absolute).catch(() => undefined)
    if (info === undefined) return jsonFail(404, 'preview target unreadable')
    return new Response(JSON.stringify({ preview: parseMediaPreview(path), size: info.size }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(absolute))
  } catch {
    return jsonFail(404, 'preview target unreadable')
  }
  let preview: ParsedPreview | undefined
  if (ext === '.xlsx' || ext === '.xlsm') {
    // Spreadsheets get the multi-lens payload in one response: the Data grid
    // (parsed sheets), the Charts tab (chart parts with their cached series),
    // and — when LibreOffice is available — the single-page-per-sheet render
    // for the pixel-true "Original" tab. Everything degrades independently.
    const soffice = findSoffice()
    const info = await stat(absolute).catch(() => undefined)
    let pdfPath: string | undefined
    if (soffice !== undefined && info !== undefined) {
      pdfPath = await convertToPdfCached(soffice, absolute, previewCacheDir(), info.mtimeMs,
        'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":true}}')
    }
    let parsed = await parseXlsxPreview(bytes, path)
    // XlsxWriter/openpyxl write formulas without cached results; a LibreOffice
    // round-trip recomputes them so the Data grid shows VALUES (the formula
    // bar still carries the formula text).
    if (parsed !== undefined && xlsxHasUncachedFormulas(parsed) && soffice !== undefined && info !== undefined) {
      const recalc = await recalcXlsxBytes(soffice, absolute, previewCacheDir(), info.mtimeMs)
      if (recalc !== undefined) {
        const resolved = await parseXlsxPreview(recalc, path)
        if (resolved !== undefined) parsed = resolved
      }
    }
    if (parsed !== undefined && parsed.kind === 'xlsx') {
      preview = { ...parsed, charts: await parseXlsxCharts(bytes), ...(pdfPath !== undefined ? { pdfPath } : {}) }
    } else if (pdfPath !== undefined) {
      preview = { kind: 'pdf', file_name: basename(path), pdfPath }
    }
  } else if (ext === '.pptx' || ext === '.docx') {
    // Slides and documents have no browser-native studio: LibreOffice renders
    // the REAL file (charts, layouts, designs) to PDF; text parsing is the
    // fallback, carrying an install hint when LibreOffice is absent — the
    // pixel-true preview is one install away.
    const soffice = findSoffice()
    if (soffice !== undefined) {
      const info = await stat(absolute).catch(() => undefined)
      if (info !== undefined) {
        const pdfPath = await convertToPdfCached(soffice, absolute, previewCacheDir(), info.mtimeMs)
        if (pdfPath !== undefined) preview = { kind: 'pdf', file_name: basename(path), pdfPath }
      }
    }
    if (preview === undefined) {
      const notice = soffice === undefined ? 'soffice-missing' as const : undefined
      if (ext === '.pptx') {
        const parsed = parsePptxPreview(bytes, path)
        preview = notice !== undefined && parsed?.kind === 'pptx' ? { ...parsed, notice } : parsed
      } else {
        const parsed = parseDocxPreview(bytes, path)
        preview = notice !== undefined && parsed?.kind === 'docx' ? { ...parsed, notice } : parsed
      }
    }
  } else if (textPreviewKind(ext) !== undefined) {
    preview = parseTextPreview(bytes, path)
  }
  if (preview === undefined && (ext === '.csv' || ext === '.tsv')) {
    // CSV reuses the sheet renderer with synthesized header handling.
    const text = new TextDecoder().decode(bytes.slice(0, 512 * 1024))
    const lines = text.split(/\r?\n/).filter(line => line.length > 0).slice(0, 101)
    const delimiter = [',', ';', '\t', '|']
      .map(d => ({ d, n: (lines[0] ?? '').split(d).length }))
      .sort((a, b) => b.n - a.n)[0]?.d ?? ','
    const splitRow = (row: string): string[] => {
      const out: string[] = []
      let field = ''
      let quoted = false
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]
        if (quoted) {
          if (ch === '"' && row[i + 1] === '"') { field += '"'; i++ }
          else if (ch === '"') quoted = false
          else field += ch
        } else if (ch === '"') quoted = true
        else if (ch === delimiter) { out.push(field); field = '' }
      }
      out.push(field)
      return out
    }
    const table = lines.map(splitRow)
    const width = Math.max(...table.map(row => row.length), 1)
    preview = {
      kind: 'xlsx',
      file_name: basename(path),
      sheets: [{
        name: 'csv',
        total_rows: Math.max(table.length - 1, 0),
        total_cols: width,
        header: (table[0] ?? []).map(cell => String(cell)),
        rows: table.slice(1).map(row => Array.from({ length: width }, (_, c) => ({ v: row[c] ?? '' }))),
      }],
      truncated: text.length >= 512 * 1024 || table.length > 101,
    }
  }
  if (preview === undefined) return new Response(JSON.stringify({ preview: undefined, size: bytes.byteLength }), {
    headers: { 'content-type': 'application/json' },
  })
  return new Response(JSON.stringify({ preview, size: bytes.byteLength }), {
    headers: { 'content-type': 'application/json' },
  })
}

async function rawArtifact(ctx: Context, request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const sessionId = (params.get('session') ?? '') as SessionId
  const path = params.get('path') ?? ''
  const download = params.get('download')
  const cwd = await sessionCwd(ctx, sessionId)
  if (cwd === undefined) {
    return new Response(`session "${sessionId}" has no workspace`, { status: 409 })
  }
  const normalized = path.replaceAll('\\', '/')
  if (normalized.includes('..')
    || (!normalized.startsWith('deliverables/') && !normalized.startsWith('uploads/'))) {
    return new Response('path must live under deliverables/ or uploads/', { status: 403 })
  }
  const workspaceRoot = resolve(cwd)
  const boundary = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`
  const resolved = resolve(cwd, normalized)
  if (!resolved.startsWith(boundary)) {
    return new Response('path escapes the workspace', { status: 403 })
  }
  const ext = (normalized.match(/[.][a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  const contentType = RAW_CONTENT_TYPES[ext] ?? 'application/octet-stream'
  const headers: Record<string, string> = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
  }
  if (download === '1') {
    headers['content-disposition'] = `attachment; filename="${basename(normalized).replaceAll('"', '')}"`
  }
  // Range request (media scrubbing): answer 206 with just the asked
  // slice, read through a file handle so a multi-hundred-MB video is
  // never fully buffered. Malformed or unsatisfiable ranges fall back
  // to the whole-file 200 — players treat that as plain success.
  const range = parseByteRange(request.headers.get('range') ?? undefined)
  if (range !== undefined) {
    try {
      const handle = await open(resolved, 'r')
      try {
        const { size } = await handle.stat()
        let { start, end } = range
        if (start === undefined) {
          // Suffix form `bytes=-N`: the final N bytes.
          start = Math.max(0, size - end)
          end = size - 1
        }
        end = Math.min(end, size - 1)
        if (start > end || start >= size) {
          return new Response('requested range not satisfiable', {
            status: 416,
            headers: { 'content-range': `bytes */${size}` },
          })
        }
        const length = end - start + 1
        const slice = new Uint8Array(length)
        const { bytesRead } = await handle.read(slice, 0, length, start)
        request.signal.throwIfAborted()
        return new Response(slice.subarray(0, bytesRead), {
          status: 206,
          headers: {
            ...headers,
            'content-range': `bytes ${start}-${end}/${size}`,
            'content-length': String(bytesRead),
          },
        })
      } finally {
        await handle.close()
      }
    } catch {
      request.signal.throwIfAborted()
      // Fall through to the whole-file response below.
    }
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(resolved))
  } catch {
    request.signal.throwIfAborted()
    return new Response('file not found', { status: 404 })
  }
  request.signal.throwIfAborted()
  return new Response(new Uint8Array(bytes), { headers })
}

/**
 * Whale artifact-file routes. The connection service supplies
 * authentication; the sessions/sessionQuery services resolve the
 * requesting session's workspace.
 */
export const SessionArtifacts = {
  inject: ['connection', 'sessions', 'sessionQuery'],
  apply(ctx: Context): void {
    const register = (path: string, fetch: (request: Request) => Promise<Response>): void => {
      ctx.effect(() => ctx.connection.fetch.register({
        path,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch,
      }), `session-controller: ${path}`)
    }
    register('/api/artifacts.list', request => listArtifacts(ctx, request))
    register('/api/artifacts.preview', request => previewArtifact(ctx, request))
    register('/api/artifacts.raw', request => rawArtifact(ctx, request))
  },
}
