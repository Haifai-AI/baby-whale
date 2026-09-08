/**
 * Media previews and Range-serving on the artifacts channels: video/audio
 * extensions resolve to identity-only preview payloads (a feature-length
 * file is never buffered just to learn its name), the raw channel answers
 * 206 byte slices for single-range `bytes=` requests (open-ended, suffix,
 * clamped) with honest Content-Range/Length headers, and malformed or
 * multi-range headers fall back to the whole-file 200 so players treat
 * them as plain success. A range beyond EOF is 416 with a bare range.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { mediaPreviewKind, parseMediaPreview } from '../src/artifacts-preview.ts'
import { parseByteRange } from '../src/api-proxy.ts'
import { createApiProxy, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { ApiProxy, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`media-${String(nextRpc++)}`), payload }
}

async function harness(cwd: string): Promise<{ api: ApiProxy; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  const session = ctx.sessions.create(sid('media-session'), { meta: { cwd, createdAt: 100 } })
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return { api, sessionId: session.id }
}

/** 256 distinguishable bytes: byte i === i. */
const CLIP = new Uint8Array(256).map((_, i) => i)

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-media-'))
  mkdirSync(join(root, 'deliverables'), { recursive: true })
  writeFileSync(join(root, 'deliverables', 'clip.mp4'), CLIP)
  writeFileSync(join(root, 'deliverables', 'tone.mp3'), 'fake-audio-bytes')
  return root
}

describe('media preview kinds', () => {
  it('maps video and audio extensions, and nothing else, to media buckets', () => {
    expect(mediaPreviewKind('.mp4')).toBe('video')
    expect(mediaPreviewKind('.MOV')).toBeUndefined() // QuickTime container: no Chromium/Firefox playback
    expect(mediaPreviewKind('.webm')).toBe('video')
    expect(mediaPreviewKind('.mp3')).toBe('audio')
    expect(mediaPreviewKind('.flac')).toBe('audio')
    expect(mediaPreviewKind('.txt')).toBeUndefined()
    expect(mediaPreviewKind('.xlsx')).toBeUndefined()
  })

  it('parses media previews as identity-only payloads', () => {
    expect(parseMediaPreview('deliverables/clip.mp4')).toEqual({ kind: 'video', file_name: 'clip.mp4' })
    expect(parseMediaPreview('deliverables/tone.mp3')).toEqual({ kind: 'audio', file_name: 'tone.mp3' })
  })

  it('classifies an extensionless path as audio (the ?? "" fallback)', () => {
    expect(mediaPreviewKind('')).toBeUndefined()
    expect(parseMediaPreview('deliverables/extensionless')).toEqual({ kind: 'audio', file_name: 'extensionless' })
  })

  it('answers the preview RPC before any byte read, with the file size', async () => {
    const { api, sessionId } = await harness(workspace())
    const response = await api.artifacts.preview(request({ sessionId, path: 'deliverables/clip.mp4' }))
    if (!response.result.ok) throw new Error('preview failed')
    expect(response.result.value.preview).toEqual({ kind: 'video', file_name: 'clip.mp4' })
    expect(response.result.value.size).toBe(256)
  })
})

describe('raw channel Range serving', () => {
  it('parses single-range bytes= headers only', () => {
    expect(parseByteRange('bytes=2-5')).toEqual({ start: 2, end: 5 })
    expect(parseByteRange('bytes=2-')).toEqual({ start: 2, end: Number.MAX_SAFE_INTEGER })
    expect(parseByteRange('bytes=-4')).toEqual({ end: 4 })
    expect(parseByteRange(undefined)).toBeUndefined()
    expect(parseByteRange('bytes=5-2')).toBeUndefined()
    expect(parseByteRange('bytes=0-1,3-4')).toBeUndefined()
    expect(parseByteRange('items=2-5')).toBeUndefined()
    expect(parseByteRange('bytes=')).toBeUndefined()
  })

  it('serves the whole file with Accept-Ranges when no Range header rides', async () => {
    const { api, sessionId } = await harness(workspace())
    const response = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4' }, new AbortController().signal)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CLIP)
  })

  it('answers a bounded range with a 206 slice and honest headers', async () => {
    const { api, sessionId } = await harness(workspace())
    const response = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4', range: 'bytes=2-5' }, new AbortController().signal)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/256')
    expect(response.headers.get('content-length')).toBe('4')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4, 5])
  })

  it('resolves an open-ended range through EOF and clamps oversized ends', async () => {
    const { api, sessionId } = await harness(workspace())
    const tail = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4', range: 'bytes=254-' }, new AbortController().signal)
    expect(tail.status).toBe(206)
    expect(tail.headers.get('content-range')).toBe('bytes 254-255/256')
    expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([254, 255])

    const clamped = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4', range: 'bytes=0-999999' }, new AbortController().signal)
    expect(clamped.status).toBe(206)
    expect(clamped.headers.get('content-range')).toBe('bytes 0-255/256')
    expect(new Uint8Array(await clamped.arrayBuffer()).byteLength).toBe(256)
  })

  it('resolves a suffix range against the file length', async () => {
    const { api, sessionId } = await harness(workspace())
    const response = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4', range: 'bytes=-4' }, new AbortController().signal)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 252-255/256')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([252, 253, 254, 255])
  })

  it('rejects an unsatisfiable range with 416 and falls back to 200 on malformed ones', async () => {
    const { api, sessionId } = await harness(workspace())
    const beyond = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4', range: 'bytes=999-' }, new AbortController().signal)
    expect(beyond.status).toBe(416)
    expect(beyond.headers.get('content-range')).toBe('bytes */256')

    const malformed = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4', range: 'bytes=5-2' }, new AbortController().signal)
    expect(malformed.status).toBe(200)
    expect(new Uint8Array(await malformed.arrayBuffer()).byteLength).toBe(256)
  })

  it('forwards the HTTP Range header through the fetch handler to a 206 slice', async () => {
    // The product path: browsers scrub via a Range header on the wire, which
    // the handler forwards into raw() — exercise that exact wiring.
    const { api, sessionId } = await harness(workspace())
    const url = `http://host/api/artifacts.raw?session=${sessionId}&path=deliverables/clip.mp4`
    const response = await toFetchHandler(api).fetch(new Request(url, { headers: { range: 'bytes=2-5' } }))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/256')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4, 5])
  })

  it('keeps audio content types and attachment downloads intact', async () => {
    const { api, sessionId } = await harness(workspace())
    const audio = await api.artifacts.raw({ sessionId, path: 'deliverables/tone.mp3' }, new AbortController().signal)
    expect(audio.headers.get('content-type')).toBe('audio/mpeg')

    const download = await api.artifacts.raw({ sessionId, path: 'deliverables/clip.mp4', download: '1' }, new AbortController().signal)
    expect(download.headers.get('content-disposition')).toContain('attachment')
  })
})
