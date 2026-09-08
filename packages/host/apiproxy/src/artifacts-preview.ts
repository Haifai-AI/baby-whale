/**
 * Artifact preview parsing: bounded, read-only extraction that turns an
 * xlsx/docx/pptx in the workspace into the SAME JSON preview shapes the
 * right-side studio renders (the shapes the removed generator tools used to
 * emit). Code-first files get first-class previews without serving bytes.
 * @module @deepseek-ai/dsh-tool-apiproxy/src/artifacts-preview
 */

import ExcelJS from 'exceljs'
import { unzipSync, zipSync } from 'fflate'
import { execFileSync } from 'node:child_process'
import { managedSofficePath } from './soffice-runtime.ts'

export interface PreviewCell {
  /** Display value (formula cells carry their cached computed result). */
  readonly v: string
  /** Formula text (`=SUM(A1:A2)`) when the cell is a formula. */
  readonly f?: string
}

export interface PreviewSheet {
  readonly name: string
  readonly header: string[]
  readonly rows: PreviewCell[][]
  readonly total_rows: number
  readonly total_cols: number
}

export interface PreviewSlide {
  readonly title: string
  readonly bullets?: string[]
}

export interface PreviewBlock {
  readonly type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'quote' | 'bullet' | 'number' | 'callout' | 'caption' | 'image' | 'table'
  readonly text: string
}

/** One series of a workbook chart: cached labels and cached numbers. */
export interface PreviewChartSeries {
  readonly name?: string
  readonly categories: readonly string[]
  readonly values: readonly number[]
}

/** One chart parsed from a workbook's `xl/charts/chartN.xml` part. */
export interface PreviewChart {
  readonly type: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter'
  readonly title?: string
  /** Sheet the chart is anchored to, when resolvable. */
  readonly sheet?: string
  readonly series: readonly PreviewChartSeries[]
}

/** The parse result union — mirrors ui-whale-artifact's OfficePreviewData. */
export type ParsedPreview =
  | {
    kind: 'xlsx'
    file_name: string
    sheets: PreviewSheet[]
    truncated: boolean
    charts?: PreviewChart[]
    /** LibreOffice single-page-per-sheet render for the "Original" tab. */
    pdfPath?: string
  }
  | {
    kind: 'pptx'
    file_name: string
    title: string
    slides: PreviewSlide[]
    truncated: boolean
    /** Set when LibreOffice is absent and the pixel-true PDF preview is unavailable. */
    notice?: 'soffice-missing'
  }
  | {
    kind: 'docx'
    file_name: string
    blocks: PreviewBlock[]
    truncated: boolean
    /** Set when LibreOffice is absent and the pixel-true PDF preview is unavailable. */
    notice?: 'soffice-missing'
  }
  /** LibreOffice-converted PDF served through the artifacts.file GET route. */
  | { kind: 'pdf'; file_name: string; pdfPath: string }
  /** Markdown source, rendered client-side by the shared markdown renderer. */
  | { kind: 'markdown'; file_name: string; text: string; truncated: boolean }
  /** Text/code source, rendered client-side by the highlighted line viewer. */
  | { kind: 'text'; file_name: string; text: string; language?: string; truncated: boolean }
  /** Video file — identity only; bytes stream from the raw channel with Range support. */
  | { kind: 'video'; file_name: string }
  /** Audio file — identity only; bytes stream from the raw channel with Range support. */
  | { kind: 'audio'; file_name: string }

const MAX_ROWS = 100
const MAX_COLS = 60
const CELL_CHARS = 300
const MAX_SHEETS = 8
const MAX_SLIDES = 24
const MAX_BULLETS = 12
const MAX_BLOCKS = 400
const BLOCK_TEXT = 600

/** Decode cap for whole-file text previews (markdown/code/JSON). */
export const TEXT_PREVIEW_BYTES = 512 * 1024

/** Extensions that preview as plain/highlighted text (kind 'text'). */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.dart', '.scala', '.clj',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cs', '.php', '.lua', '.pl', '.ex', '.exs', '.erl',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd',
  '.html', '.htm', '.xml', '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.astro',
  '.sql', '.graphql', '.gql', '.prisma', '.proto', '.tf', '.hcl', '.r', '.jl', '.zig', '.nim',
])

/** Extension → shiki grammar alias (see ui-primitives highlight.ts LANG_ALIASES). */
const TEXT_LANGUAGES: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx', '.mts': 'ts', '.cts': 'ts',
  '.js': 'js', '.jsx': 'jsx', '.mjs': 'js', '.cjs': 'js',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',
  '.py': 'python', '.pyw': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift', '.dart': 'dart',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.hh': 'cpp', '.cs': 'csharp',
  '.php': 'php', '.lua': 'lua', '.pl': 'perl', '.ex': 'elixir', '.exs': 'elixir',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  '.ps1': 'powershell', '.psm1': 'powershell',
  '.html': 'html', '.htm': 'html', '.xml': 'xml', '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
  '.vue': 'vue', '.svelte': 'svelte', '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.r': 'r',
}

/** Which preview bucket a text-ish extension maps to: 'markdown', 'text', or undefined. */
export function textPreviewKind(ext: string): 'markdown' | 'text' | undefined {
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return undefined
}

/** Extensions that preview as a native browser video player. */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov'])
/** Extensions that preview as a native browser audio player. */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.aac', '.opus'])

/** Media preview bucket for an extension; undefined when the type is not a playable medium. */
export function mediaPreviewKind(ext: string): 'video' | 'audio' | undefined {
  const normalized = ext.toLowerCase()
  if (VIDEO_EXTENSIONS.has(normalized)) return 'video'
  if (AUDIO_EXTENSIONS.has(normalized)) return 'audio'
  return undefined
}

/**
 * Build the media preview payload. Bytes are never parsed — the player rides
 * the raw channel (Range-capable), so the preview only carries identity.
 */
export function parseMediaPreview(filePath: string): ParsedPreview {
  if (mediaPreviewKind((/[.][a-z0-9]+$/i.exec(filePath)?.[0] ?? '').toLowerCase()) === 'video') {
    return { kind: 'video', file_name: basename(filePath) }
  }
  return { kind: 'audio', file_name: basename(filePath) }
}

/** Shiki grammar hint for a text extension; undefined renders plain monospace. */
export function textPreviewLanguage(ext: string): string | undefined {
  return TEXT_LANGUAGES[ext]
}

/**
 * Parse a text-ish artifact (markdown or code/JSON/whatever) into the
 * bounded preview payload: decoded source capped at {@link TEXT_PREVIEW_BYTES},
 * plus the renderer hint. Binary content decodes to replacement characters —
 * acceptable for a preview of a file the caller believes is text.
 */
export function parseTextPreview(bytes: Uint8Array, filePath: string): ParsedPreview {
  const ext = (/[.][a-z0-9]+$/i.exec(filePath)?.[0] ?? '').toLowerCase()
  const kind = textPreviewKind(ext)
  if (kind === undefined) throw new Error(`not a text preview extension: ${ext}`)
  const text = new TextDecoder().decode(bytes.slice(0, TEXT_PREVIEW_BYTES))
  const truncated = bytes.byteLength > TEXT_PREVIEW_BYTES
  if (kind === 'markdown') return { kind: 'markdown', file_name: basename(filePath), text, truncated }
  const language = textPreviewLanguage(ext)
  return language === undefined
    ? { kind: 'text', file_name: basename(filePath), text, truncated }
    : { kind: 'text', file_name: basename(filePath), text, language, truncated }
}

function cap(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function basename(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return i >= 0 ? filePath.slice(i + 1) : filePath
}

interface RawCell {
  readonly formula?: unknown
  readonly sharedFormula?: unknown
  readonly result?: unknown
  readonly text?: unknown
  readonly richText?: unknown
}

/** The formula text (`=...`) of a formula cell, when the raw value is one. */
function formulaOf(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as RawCell
  if (typeof record.formula === 'string') return `=${record.formula}`
  if (typeof record.sharedFormula === 'string') return `=${record.sharedFormula}`
  return undefined
}

/**
 * One grid cell: the display value `v`, plus the backing formula `f` when the
 * cell is a formula. ExcelJS caches the computed result alongside the
 * formula, so like Excel the grid shows the VALUE; without a cached result
 * the formula string is all there is to show.
 */
function cellView(raw: unknown): PreviewCell {
  if (raw === null || raw === undefined) return { v: '' }
  if (typeof raw === 'string') return { v: raw }
  if (typeof raw === 'number' || typeof raw === 'boolean') return { v: String(raw) }
  if (raw instanceof Date) return { v: raw.toISOString().slice(0, 10) }
  if (typeof raw === 'object') {
    const record = raw as RawCell
    const formula = formulaOf(raw)
    if (record.result !== undefined && record.result !== null && typeof record.result !== 'object') {
      return { v: cellView(record.result).v, ...(formula !== undefined ? { f: formula } : {}) }
    }
    if (formula !== undefined) return { v: formula, f: formula }
    if (typeof record.text === 'string') return { v: record.text }
    if (Array.isArray(record.richText)) {
      return {
        v: record.richText.map((part: unknown) =>
          typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '').join(''),
      }
    }
  }
  return { v: '' }
}

function allIdentical(cells: readonly string[]): boolean {
  return cells.length > 1 && cells.every(cell => cell === cells[0])
}

/** The numeric payload of a raw cell value (formula cells: their result). */
function numericOf(raw: unknown): number | undefined {
  if (typeof raw === 'number') return raw
  if (raw !== null && typeof raw === 'object' && !(raw instanceof Date)) {
    const result = (raw as { result?: unknown }).result
    if (typeof result === 'number') return result
  }
  return undefined
}

/**
 * Excel-faithful display formatting for numeric cells: percent formats
 * multiply by 100, currency and thousands formats add their symbol and
 * separators, with decimal counts taken from the format string. Anything
 * else falls through to the raw value.
 */
function formatByNumFmt(raw: unknown, numFmt: unknown): string | undefined {
  const value = numericOf(raw)
  if (value === undefined || typeof numFmt !== 'string' || numFmt === 'General' || numFmt === '0') {
    return undefined
  }
  const dot = numFmt.indexOf('.')
  const decimals = dot === -1 ? 0 : (numFmt.slice(dot + 1).match(/0/g) ?? []).length
  if (numFmt.includes('%')) return `${(value * 100).toFixed(Math.min(decimals, 6))}%`
  const currency = /[¥£€$]/.exec(numFmt)?.[0]
  if (currency !== undefined) {
    return `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: Math.min(decimals, 6), maximumFractionDigits: Math.min(decimals, 6) })}`
  }
  if (/[,#0]/.test(numFmt)) {
    return value.toLocaleString('en-US', { minimumFractionDigits: Math.min(decimals, 6), maximumFractionDigits: Math.min(decimals, 6) })
  }
  return undefined
}

function denseRow(values: unknown[], width: number): string[] {
  return Array.from({ length: Math.min(width, MAX_COLS) }, (_, i) => cap(cellView(values[i + 1]).v, CELL_CHARS))
}

/** Dense row of display cells off an exceljs row, applying number formats. */
function denseCells(row: ExcelJS.Row, width: number): PreviewCell[] {
  return Array.from({ length: Math.min(width, MAX_COLS) }, (_, i) => {
    const cell = row.getCell(i + 1)
    const view = cellView(cell.value)
    const formatted = formatByNumFmt(cell.value, cell.numFmt)
    return {
      v: cap(formatted ?? view.v, CELL_CHARS),
      ...(view.f !== undefined ? { f: cap(view.f, CELL_CHARS) } : {}),
    }
  })
}


/**
 * exceljs 4.4 crashes in XLSX.reconcile on openpyxl-written workbooks that
 * carry charts/drawings (`drawing.anchors` undefined). Charts carry no text
 * preview value, so on that failure strip drawing/chart/media parts and the
 * sheets' `<drawing>` references, then reload.
 */
export async function loadWorkbookResilient(bytes: Uint8Array): Promise<ExcelJS.Workbook | undefined> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0])
    return workbook
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/drawing|anchor/i.test(message)) return undefined
  }
  try {
    const entries = unzipSync(bytes)
    // Rebuild rather than delete: strip the parts ExcelJS stumbles on.
    const kept: Record<string, Uint8Array> = {}
    for (const [name, payload] of Object.entries(entries)) {
      if (/^xl\/(drawings|charts|media)\//.test(name)) continue
      kept[name] = payload
    }
    for (const [name, payload] of Object.entries(kept)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue
      const xml = new TextDecoder().decode(payload)
      if (!xml.includes('<drawing ')) continue
      kept[name] = new TextEncoder().encode(xml.replace(/<drawing [^>]*\/>/g, ''))
    }
    const stripped = zipSync(kept)
    const retry = new ExcelJS.Workbook()
    await retry.xlsx.load(Buffer.from(stripped) as unknown as Parameters<typeof retry.xlsx.load>[0])
    return retry
  } catch {
    return undefined
  }
}

/** Parse an .xlsx payload into capped worksheet previews. */
export async function parseXlsxPreview(bytes: Uint8Array, fileName: string): Promise<ParsedPreview | undefined> {
  try {
    const workbook = await loadWorkbookResilient(bytes)
    if (workbook === undefined) return undefined
    const sheets: PreviewSheet[] = []
    let truncated = false
    if (workbook.worksheets.length > MAX_SHEETS) truncated = true
    for (const ws of workbook.worksheets.slice(0, MAX_SHEETS)) {
      if (ws.rowCount === 0 || ws.columnCount === 0) continue
      const colCount = Math.min(ws.columnCount, MAX_COLS)
      const scanRows = Math.min(ws.rowCount, 8)
      const grid: string[][] = []
      for (let r = 1; r <= scanRows; r++) grid.push(denseRow(ws.getRow(r).values as unknown[], colCount))

      // Content-based header detection: leading rows that are empty or
      // all-identical (banner echoes) are decoration; the header is the first
      // row with at least two distinct non-empty values.
      const isDecoration = (cells: string[]): boolean =>
        cells.every(cell => cell.length === 0) || allIdentical(cells)
      const isContent = (cells: string[]): boolean =>
        cells.some(cell => cell.length > 0) && new Set(cells.filter(c => c.length > 0)).size >= 2

      const isMostlyNumeric = (cells: string[]): boolean => {
        const filled = cells.filter(cell => cell.length > 0)
        if (filled.length < 2) return false
        const numeric = filled.filter(cell => /^[($\u00a3\u00a5\u20ac-]?[-+]?[\d.,]+%?[)]?$/.test(cell)).length
        return numeric / filled.length >= 0.6
      }
      const nextContentRow = (from: number): number => {
        for (let r = from + 1; r < grid.length; r++) {
          const candidate = grid[r]
          if (candidate !== undefined && !isDecoration(candidate)) return r
        }
        return -1
      }
      let headerIndex = -1
      let fallbackIndex = -1
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r]
        if (row === undefined || isDecoration(row)) continue
        if (fallbackIndex === -1) fallbackIndex = r
        if (isContent(row)) {
          // Transposed layout: a mostly-numeric candidate followed by a text
          // row means the TEXT row is the header (labels live under values).
          const next = nextContentRow(r)
          if (next !== -1 && isMostlyNumeric(row) && !isMostlyNumeric(grid[next] ?? row)) {
            headerIndex = next
          } else {
            headerIndex = r
          }
          break
        }
      }
      // No row with two distinct values: use the first non-decorated row.
      if (headerIndex === -1) headerIndex = fallbackIndex === -1 ? 0 : fallbackIndex
      const headerText = grid[headerIndex] ?? []
      const startRow = headerIndex + 1
      const availableRows = Math.max(ws.rowCount - startRow + 1, 0)
      const takeRows = Math.min(availableRows, MAX_ROWS)
      if (availableRows > takeRows || ws.columnCount > MAX_COLS) truncated = true
      const rows: PreviewCell[][] = Array.from({ length: takeRows }, (_, r) =>
        denseCells(ws.getRow(startRow + r), colCount))
      if (headerText.length === 0 || rows.length === 0) continue

      const sheet: PreviewSheet = {
        name: ws.name,
        total_rows: availableRows,
        total_cols: ws.columnCount,
        rows,
        header: headerText,
      }
      sheets.push(sheet)
    }
    if (sheets.length === 0) return undefined
    return { kind: 'xlsx', file_name: basename(fileName), sheets, truncated }
  } catch {
    return undefined
  }
}

/** Parse a .pptx payload into capped slide previews by harvesting shape text. */
export function parsePptxPreview(bytes: Uint8Array, fileName: string): ParsedPreview | undefined {
  try {
    const entries = unzipSync(bytes)
    const slideNames = Object.keys(entries)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number((/slide(\d+)\.xml$/.exec(a) ?? [])[1] ?? 0) - Number((/slide(\d+)\.xml$/.exec(b) ?? [])[1] ?? 0))
      .slice(0, MAX_SLIDES)
    const slides: Array<{ title: string; bullets?: string[] }> = []
    for (const name of slideNames) {
      const slideXml = entries[name]
      if (slideXml === undefined) continue
      const xml = new TextDecoder().decode(slideXml)

      // Walk SHAPES, not raw txBody pairing: python-pptx and PowerPoint both
      // mark the title placeholder explicitly, and paragraph runs inside a
      // shape are the bullet lines.
      const shapes = [...xml.matchAll(/<p:sp>[^]*?<\/p:sp>/g)].map(shapeMatch => shapeMatch[0])
      let title: string | undefined
      const bullets: string[] = []
      for (const shape of shapes) {
        const paragraphs = [...shape.matchAll(/<a:p>[^]*?<\/a:p>/g)].map(paraMatch =>
          [...paraMatch[0].matchAll(/<a:t(?:\s[^>]*)?>([^]*?)<\/a:t>/g)]
            .map(run => decodeXmlEntities(run[1] ?? '').trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim())
          .filter(line => line.length > 0)
        if (paragraphs.length === 0) continue
        const isTitle = /<p:ph[^>]*type="(ctrTitle|title)"/.test(shape)
        if (isTitle && title === undefined) {
          title = cap(paragraphs.join(' '), BLOCK_TEXT)
          continue
        }
        for (const line of paragraphs) {
          if (bullets.length < MAX_BULLETS) bullets.push(cap(line, BLOCK_TEXT))
        }
      }
      if (title === undefined && bullets.length > 0) {
        // No placeholder marking: promote the first bullet line to the title.
        title = bullets.shift()
      }
      if (title === undefined && bullets.length === 0) continue
      const slide: { title: string; bullets?: string[] } = { title: title ?? '' }
      if (bullets.length > 0) slide.bullets = bullets
      slides.push(slide)
    }
    const firstSlide = slides[0]
    if (firstSlide === undefined) return undefined
    return { kind: 'pptx', file_name: basename(fileName), title: firstSlide.title, slides, truncated: false }
  } catch {
    return undefined
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/** Parse a .docx payload into capped block previews off word/document.xml. */
export function parseDocxPreview(bytes: Uint8Array, fileName: string): ParsedPreview | undefined {
  try {
    const entries = unzipSync(bytes)
    const documentXml = entries['word/document.xml']
    if (documentXml === undefined) return undefined
    const xml = new TextDecoder().decode(documentXml)
    const blocks: Array<{ type: PreviewBlock['type']; text: string }> = []
    const blockRegex = /<w:(p|tbl)[ >][^]*?<\/w:\1>/g
    let match: RegExpExecArray | null
    while ((match = blockRegex.exec(xml)) !== null && blocks.length < MAX_BLOCKS) {
      const block = match[0]
      if (block.startsWith('<w:tbl')) {
        const rows = [...block.matchAll(/<w:tr[ >][^]*?<\/w:tr>/g)].map(row =>
          [...row[0].matchAll(/<w:t(?:\s[^>]*)?>([^]*?)<\/w:t>/g)]
            .map(t => decodeXmlEntities(t[1] ?? '').trim()).join(' '))
        const joined = rows.filter(r => r.replace(/\|/g, '').trim().length > 0).join('\n')
        if (joined.length > 0) blocks.push({ type: 'table', text: cap(joined, BLOCK_TEXT) })
        continue
      }
      const styleAttr = (/<w:pStyle w:val="([^"]+)"/.exec(block)?.[1] ?? '').toLowerCase()
      const isList = /<w:numPr\s*\/?>/.test(block)
      const text = [...block.matchAll(/<w:t(?:\s[^>]*)?>([^]*?)<\/w:t>|<w:tab\s*\/>/g)]
        .map(run => run[1] === undefined ? '\t' : decodeXmlEntities(run[1]))
        .join('').replace(/\s+/g, ' ').trim()
      if (text.length === 0) continue
      let type: PreviewBlock['type'] = 'paragraph'
      if (styleAttr === 'heading1') type = 'heading1'
      else if (styleAttr === 'heading2') type = 'heading2'
      else if (styleAttr === 'heading3') type = 'heading3'
      else if (/quote/.test(styleAttr)) type = 'quote'
      else if (isList && /^\d+[.)]\s*/.test(text)) type = 'number'
      else if (isList) type = 'bullet'
      blocks.push({ type, text: cap(text, BLOCK_TEXT) })
    }
    if (blocks.length === 0) return undefined
    return { kind: 'docx', file_name: basename(fileName), blocks, truncated: false }
  } catch {
    return undefined
  }
}

/** Result of one LibreOffice conversion. */
export interface ConvertedPdf {
  /** Absolute path of the converted PDF inside the preview cache. */
  readonly pdfPath: string
}

const MAX_CHARTS = 12
const MAX_SERIES = 12
const MAX_CATS = 60

/** Resolve `..`/`.` segments and absolute targets against a part's directory. */
function joinTarget(baseDir: string, target: string): string {
  const full = target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`
  const parts: string[] = []
  for (const segment of full.split('/')) {
    if (segment === '..') parts.pop()
    else if (segment !== '.' && segment !== '') parts.push(segment)
  }
  return parts.join('/')
}

function relTarget(relElement: string): { readonly id?: string; readonly target?: string } {
  const id = /\bId="([^"]+)"/.exec(relElement)?.[1]
  const target = /\bTarget="([^"]+)"/.exec(relElement)?.[1]
  return {
    ...(id !== undefined ? { id } : {}),
    ...(target !== undefined ? { target } : {}),
  }
}

/**
 * Map each `chartN.xml` base name to the name of the sheet it is anchored to:
 * sheet → drawing r:id → drawing part → chart relationship. Bounded regex
 * walk of the workbook's relationship graph.
 */
function chartSheetNames(entries: Record<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>()
  const workbookXml = entries['xl/workbook.xml']
  const workbookRels = entries['xl/_rels/workbook.xml.rels']
  if (workbookXml === undefined || workbookRels === undefined) return map
  const decode = (payload: Uint8Array): string => new TextDecoder().decode(payload)
  const workbookTargets = new Map<string, string>()
  for (const rel of decode(workbookRels).matchAll(/<Relationship\b[^>]*>/g)) {
    const { id, target } = relTarget(rel[0] ?? '')
    if (id !== undefined && target !== undefined) workbookTargets.set(id, target)
  }
  // Worksheet part path → sheet name.
  const sheetParts = new Map<string, string>()
  for (const sheet of decode(workbookXml).matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(sheet[0] ?? '')?.[1]
    const rid = /\br:id="([^"]+)"/.exec(sheet[0] ?? '')?.[1]
    const target = rid !== undefined ? workbookTargets.get(rid) : undefined
    if (name === undefined || target === undefined) continue
    sheetParts.set(joinTarget('xl/', target), name)
  }
  for (const [sheetPath, sheetName] of sheetParts) {
    const sheetDir = `${sheetPath.split('/').slice(0, -1).join('/')}/`
    const sheetXml = entries[sheetPath]
    if (sheetXml === undefined) continue
    const drawingRid = /<drawing[^>]*\br:id="([^"]+)"/.exec(decode(sheetXml))?.[1]
    if (drawingRid === undefined) continue
    const sheetRels = entries[`${sheetDir}_rels/${basename(sheetPath)}.rels`]
    if (sheetRels === undefined) continue
    let drawingPath: string | undefined
    for (const rel of decode(sheetRels).matchAll(/<Relationship\b[^>]*>/g)) {
      const { id, target } = relTarget(rel[0] ?? '')
      if (id === drawingRid && target !== undefined) drawingPath = joinTarget(sheetDir, target)
    }
    if (drawingPath === undefined) continue
    const drawingDir = `${drawingPath.split('/').slice(0, -1).join('/')}/`
    const drawingRels = entries[`${drawingDir}_rels/${basename(drawingPath)}.rels`]
    if (drawingRels === undefined) continue
    for (const rel of decode(drawingRels).matchAll(/<Relationship\b[^>]*>/g)) {
      const element = rel[0] ?? ''
      const { target } = relTarget(element)
      if (target === undefined || !/\/chart\b/.test(/\bType="([^"]+)"/.exec(element)?.[1] ?? '')) continue
      const chartName = basename(joinTarget(drawingDir, target))
      if (!map.has(chartName)) map.set(chartName, sheetName)
    }
  }
  return map
}

/** Optional XML prefix for chart-namespace elements: writers differ (`c:barChart` vs default-ns `<barChart>`). */
const C = '(?:[A-Za-z][\\w.-]*:)?'

/** Cached `<pt>` strings of a cache block (`strCache`/`numCache`), in order. */
function cachePoints(block: string): string[] {
  const cache = (new RegExp(`<${C}strCache>[^]*?</${C}strCache>`).exec(block)
    ?? new RegExp(`<${C}numCache>[^]*?</${C}numCache>`).exec(block))?.[0]
  if (cache === undefined) return []
  return [...cache.matchAll(new RegExp(`<${C}pt\\b[^>]*>[^]*?</${C}pt>`, 'g'))]
    .map(point => decodeXmlEntities(new RegExp(`<${C}v>([^<]*)</${C}v>`).exec(point[0])?.[1] ?? '').trim())
}

function cacheNumbers(block: string): number[] {
  return cachePoints(block)
    .map(text => Number.parseFloat(text.replace(/,/g, '')))
    .filter(value => Number.isFinite(value))
}

/** Sub-element `<tag>…</tag>` of a block, or ''. */
function subElement(block: string, tag: string): string {
  return new RegExp(`<${C}${tag}>[^]*?</${C}${tag}>`).exec(block)?.[0] ?? ''
}

/** Text content of an element block with all tags stripped. */
function elementText(block: string): string {
  return block.replace(/<[^>]*>/g, '').trim()
}

/** A chart series mid-parse: caches when the writer supplied them, otherwise the range refs to resolve. */
interface DraftSeries {
  name?: string
  categories: string[]
  values: number[]
  nameRef?: string
  catRef?: string
  valRef?: string
}

/** Parse one chart part's XML into the preview shape; undefined when unrenderable. */
function parseChartXml(xml: string): Omit<PreviewChart, 'sheet'> & { series: DraftSeries[] } | undefined {
  const group = new RegExp(`<${C}(bar|line|pie|doughnut|area|scatter)Chart(?:\\s[^>]*)?>[^]*?</${C}\\1Chart>`).exec(xml)?.[0]
  if (group === undefined) return undefined
  const kind = new RegExp(`<${C}(bar|line|pie|doughnut|area|scatter)Chart`).exec(group)?.[1] ?? ''
  const type: PreviewChart['type'] = kind === 'bar'
    ? (new RegExp(`<${C}barDir\\s+val="bar"`).test(group) ? 'bar' : 'column')
    : kind === 'doughnut' ? 'doughnut' : (kind as PreviewChart['type'])
  const titleRuns = [...(subElement(xml, 'title').matchAll(new RegExp(`<${C}t(?:\\s[^>]*)?>([^<]*)</${C}t>`, 'g')))]
    .map(run => decodeXmlEntities(run[1] ?? ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const series: DraftSeries[] = []
  for (const serMatch of group.matchAll(new RegExp(`<${C}ser>[^]*?</${C}ser>`, 'g'))) {
    if (series.length >= MAX_SERIES) break
    const ser = serMatch[0]
    const txBlock = subElement(ser, 'tx')
    const name = decodeXmlEntities(cachePoints(txBlock)[0] ?? '').slice(0, 80) || undefined
    const nameRef = elementText(subElement(txBlock, 'f')) || undefined
    let categories: string[]
    let values: number[]
    let catRef: string | undefined
    let valRef: string | undefined
    if (kind === 'scatter') {
      // Scatter keeps numeric x in xVal: categories become the x labels.
      const xBlock = subElement(ser, 'xVal')
      categories = cacheNumbers(xBlock).map(value => String(value))
      catRef = elementText(subElement(xBlock, 'f')) || undefined
      const yBlock = subElement(ser, 'yVal')
      values = cacheNumbers(yBlock)
      valRef = elementText(subElement(yBlock, 'f')) || undefined
    } else {
      const catBlock = subElement(ser, 'cat')
      categories = cachePoints(catBlock).slice(0, MAX_CATS)
      catRef = elementText(subElement(catBlock, 'f')) || undefined
      const valBlock = subElement(ser, 'val')
      values = cacheNumbers(valBlock)
      valRef = elementText(subElement(valBlock, 'f')) || undefined
    }
    if (values.length === 0 && catRef === undefined && valRef === undefined) continue
    series.push({
      ...(name !== undefined ? { name } : {}),
      categories,
      values,
      ...(name === undefined && nameRef !== undefined ? { nameRef } : {}),
      ...(catRef !== undefined ? { catRef } : {}),
      ...(valRef !== undefined ? { valRef } : {}),
    })
  }
  if (series.length === 0) return undefined
  return {
    type,
    ...(titleRuns.length > 0 ? { title: titleRuns.slice(0, 120) } : {}),
    series,
  }
}

/** A1-style range of a series reference: `$B$5:$B$12`, `$B$5`, `A1:A8`. */
function resolveRange(workbook: ExcelJS.Workbook, ref: string): { text: string[]; numbers: number[] } | undefined {
  const match = /^(?:'([^']+)'|([^'!]+))!(.+)$/.exec(ref.replace(/^\s+|\s+$/g, ''))
  if (match === null) return undefined
  const sheetName = match[1] ?? match[2]
  const ws = sheetName === undefined ? undefined : workbook.getWorksheet(sheetName)
  if (ws === undefined) return undefined
  const range = match[3] ?? ''
  const bounds = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(range.replace(/\s+/g, ''))
  if (bounds === null) return undefined
  const colIndex = (letters: string): number =>
    letters.split('').reduce((acc, ch) => acc * 26 + (ch.toUpperCase().charCodeAt(0) - 64), 0)
  const colStart = colIndex(bounds[1] ?? 'A')
  const rowStart = Number(bounds[2] ?? 1)
  const colEnd = bounds[3] !== undefined ? colIndex(bounds[3]) : colStart
  const rowEnd = bounds[4] !== undefined ? Number(bounds[4]) : rowStart
  const text: string[] = []
  const numbers: number[] = []
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const cell = ws.getRow(row).getCell(col)
      text.push(cellView(cell.value).v)
      const numeric = numericOf(cell.value)
      if (numeric !== undefined) numbers.push(numeric)
    }
  }
  return { text, numbers }
}

/**
 * Extract the workbook's embedded charts for the Charts tab. Excel writes
 * cached series values into the chart part; XlsxWriter does not, so ranges
 * are resolved against the worksheet data (loaded lazily, only when a
 * reference lacks a cache) via the same resilient loader the grid uses.
 */
export async function parseXlsxCharts(bytes: Uint8Array): Promise<PreviewChart[]> {
  try {
    const entries = unzipSync(bytes)
    const sheetNames = chartSheetNames(entries)
    const chartFiles = Object.keys(entries)
      .filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name))
      .sort((a, b) => Number((/chart(\d+)\.xml$/.exec(a)?.[1] ?? 0)) - Number((/chart(\d+)\.xml$/.exec(b)?.[1] ?? 0)))
    const charts: PreviewChart[] = []
    let workbook: ExcelJS.Workbook | undefined
    for (const name of chartFiles) {
      if (charts.length >= MAX_CHARTS) break
      const payload = entries[name]
      if (payload === undefined) continue
      const parsed = parseChartXml(new TextDecoder().decode(payload))
      if (parsed === undefined) continue
      const series: PreviewChartSeries[] = []
      for (const draft of parsed.series) {
        let { categories, values } = draft
        const needsSheet = draft.name === undefined && draft.nameRef !== undefined
          || values.length === 0 && (draft.valRef !== undefined || draft.catRef !== undefined)
        if (needsSheet) {
          workbook ??= await loadWorkbookResilient(bytes)
          if (workbook === undefined) break
          let resolvedName: string | undefined
          if (draft.name === undefined && draft.nameRef !== undefined) {
            resolvedName = resolveRange(workbook, draft.nameRef)?.text[0]
          }
          if (values.length === 0 && draft.valRef !== undefined) {
            values = resolveRange(workbook, draft.valRef)?.numbers ?? []
          }
          if (categories.length === 0 && draft.catRef !== undefined) {
            categories = (resolveRange(workbook, draft.catRef)?.text ?? []).slice(0, MAX_CATS)
          }
          if (values.length === 0) continue
          series.push({
            ...(resolvedName !== undefined && resolvedName.length > 0 ? { name: resolvedName.slice(0, 80) } : {}),
            categories,
            values,
          })
          continue
        }
        if (values.length === 0) continue
        series.push({
          ...(draft.name !== undefined ? { name: draft.name } : {}),
          categories,
          values,
        })
      }
      if (series.length === 0) continue
      const sheet = sheetNames.get(basename(name))
      charts.push({
        type: parsed.type, series,
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(sheet !== undefined ? { sheet } : {}),
      })
    }
    return charts
  } catch {
    return []
  }
}

/** Candidate soffice binaries, in probe order. */
const SOFFICE_CANDIDATES = [
  process.env.DSH_SOFFICE_PATH,
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  // Standard Windows install layout (the installer does not add itself to PATH).
  ...(process.platform === 'win32'
    ? [String.raw`${process.env['ProgramFiles'] ?? 'C:\Program Files'}\LibreOffice\program\soffice.exe`]
    : []),
].filter((value): value is string => typeof value === 'string' && value.length > 0)

/** Resolved once per process; undefined when LibreOffice is not installed. */
let sofficeBin: string | undefined | false

/**
 * Locate a usable LibreOffice binary. Cached: the probe spawns `--version`
 * once, so a broken install does not re-probe on every preview.
 * @returns absolute binary path, or undefined when LibreOffice is absent.
 */
export function findSoffice(): string | undefined {
  // The managed runtime wins: it is our pinned, known-good build, and one
  // stat per call is negligible — it also lets a just-finished download
  // upgrade the preview pipeline without a process restart.
  const managed = managedSofficePath()
  if (managed !== undefined) {
    sofficeBin = managed
    return managed
  }
  if (sofficeBin !== undefined) return sofficeBin || undefined
  for (const candidate of SOFFICE_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 10_000 })
      sofficeBin = candidate
      return candidate
    } catch {
      // Try the next candidate.
    }
  }
  sofficeBin = false
  return undefined
}

/**
 * Drop the cached soffice lookup — after a managed install completes, or
 * when the user installs LibreOffice while the app is already running.
 */
export function resetSofficeLookup(): void {
  sofficeBin = undefined
}

/**
 * Convert an office document to PDF via headless LibreOffice, cached by
 * source mtime. A unique user-profile per conversion avoids soffice's
 * single-instance profile lock.
 * @param soffice - LibreOffice binary path.
 * @param sourcePath - absolute office document path.
 * @param cacheDir - directory receiving the PDF.
 * @param sourceMtimeMs - source modification time for cache validation.
 * @param filterSpec - optional `--convert-to` spec overriding plain `pdf`
 *   (e.g. Calc's SinglePageSheets export); when the spec yields nothing the
 *   conversion retries with plain `pdf` for older LibreOffice installs.
 * @returns the cached PDF path, or undefined when conversion failed.
 */
export async function convertToPdfCached(
  soffice: string,
  sourcePath: string,
  cacheDir: string,
  sourceMtimeMs: number,
  filterSpec?: string,
): Promise<string | undefined> {
  const { createHash } = await import('node:crypto') as typeof import('node:crypto')
  const key = createHash('sha1')
    .update(sourcePath)
    .update(String(sourceMtimeMs))
    .update(filterSpec ?? 'pdf')
    .digest('hex')
    .slice(0, 16)
  const pdfPath = `${cacheDir}/${key}.pdf`
  try {
    const info = await (await import('node:fs/promises') as typeof import('node:fs/promises')).stat(pdfPath)
    if (info.isFile() && info.size > 0) return pdfPath
  } catch {
    // Cache miss — convert below.
  }
  const { execFile } = await import('node:child_process') as typeof import('node:child_process')
  const profile = `${cacheDir}/lo-profile`
  await (await import('node:fs/promises') as typeof import('node:fs/promises')).mkdir(cacheDir, { recursive: true })
  const convertWith = (spec: string): Promise<boolean> => new Promise<boolean>((resolveConvert) => {
    execFile(soffice, [
      '--headless', '--norestore',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', spec, '--outdir', cacheDir, sourcePath,
    ], { timeout: 60_000 }, (error) => { resolveConvert(error === null) })
  })
  // soffice --outdir writes into cacheDir under the source basename.
  const sourceBase = basename(sourcePath).replace(/\.[^.]+$/, '')
  const produced = `${cacheDir}/${sourceBase}.pdf`
  const exists = async (): Promise<boolean> => {
    try {
      return (await (await import('node:fs/promises') as typeof import('node:fs/promises')).stat(produced)).isFile()
    } catch {
      return false
    }
  }
  // Unknown filter options yield nothing on older LibreOffice — fall back to
  // plain `pdf` whenever the spec produced no file.
  const spec = filterSpec ?? 'pdf'
  await convertWith(spec)
  if (!await exists() && spec !== 'pdf') await convertWith('pdf')
  try {
    if (!await exists()) return undefined
    const target = `${cacheDir}/${key}.pdf`
    if (produced !== target) {
      await (await import('node:fs/promises') as typeof import('node:fs/promises')).rename(produced, target)
    }
    return target
  } catch {
    return undefined
  }
}

/** Blank-or-missing env lookup: empty strings count as unset. */
function envHome(name: 'DSH_HOME' | 'HOME' | 'USERPROFILE'): string | undefined {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value : undefined
}

/** The gateway-owned directory receiving converted preview PDFs. */
export function previewCacheDir(): string {
  // DSH_HOME is the product home itself; otherwise resolve the platform home
  // and keep the `.dsh` layout identical everywhere (Windows: USERPROFILE).
  const configured = envHome('DSH_HOME')
  if (configured !== undefined) return `${configured}/preview-cache`
  const platformHome = envHome('HOME') ?? envHome('USERPROFILE')
  if (platformHome !== undefined) return `${platformHome}/.dsh/preview-cache`
  return './preview-cache'
}

/**
 * Whether any grid cell displays a formula string because the workbook (as
 * XlsxWriter and openpyxl write them) carried no cached computed result.
 * Such previews show `=SUM(...)` where Excel would show the value — the cue
 * for the recalc round-trip below.
 */
export function xlsxHasUncachedFormulas(preview: ParsedPreview): boolean {
  if (preview.kind !== 'xlsx') return false
  return preview.sheets.some(sheet => sheet.rows.some(row =>
    row.some(cell => cell.f !== undefined && cell.v === cell.f)))
}

/**
 * Recalculate a workbook by round-tripping it through headless LibreOffice
 * (`--convert-to xlsx`): Calc computes every formula on load and the
 * converted copy carries cached results the parser can read. Cached by
 * source mtime under the preview cache.
 * @returns the recalculated workbook bytes, or undefined on failure.
 */
export async function recalcXlsxBytes(
  soffice: string,
  sourcePath: string,
  cacheDir: string,
  sourceMtimeMs: number,
): Promise<Uint8Array | undefined> {
  const { createHash } = await import('node:crypto') as typeof import('node:crypto')
  const { mkdir, readFile, rename, stat } = await import('node:fs/promises') as typeof import('node:fs/promises')
  const { execFile } = await import('node:child_process') as typeof import('node:child_process')
  const key = `${createHash('sha1').update(sourcePath).update(String(sourceMtimeMs)).digest('hex').slice(0, 16)}.recalc.xlsx`
  const target = `${cacheDir}/${key}`
  try {
    const info = await stat(target)
    if (info.isFile() && info.size > 0) return new Uint8Array(await readFile(target))
  } catch {
    // Cache miss — convert below.
  }
  await mkdir(cacheDir, { recursive: true })
  const profile = `${cacheDir}/lo-profile-recalc`
  const done = await new Promise<boolean>((resolveConvert) => {
    execFile(soffice, [
      '--headless', '--norestore',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', 'xlsx', '--outdir', cacheDir, sourcePath,
    ], { timeout: 60_000 }, (error) => { resolveConvert(error === null) })
  })
  if (!done) return undefined
  const sourceBase = basename(sourcePath).replace(/\.[^.]+$/, '')
  const produced = `${cacheDir}/${sourceBase}.xlsx`
  try {
    if (produced !== target) await rename(produced, target)
    return new Uint8Array(await readFile(target))
  } catch {
    return undefined
  }
}
