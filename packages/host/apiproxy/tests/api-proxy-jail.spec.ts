/**
 * Jail enforcement on the artifact channels: symlink escapes and
 * same-prefix sibling escapes refuse on raw and preview; missing files
 * refuse indistinguishably from escapes (no existence oracle); active
 * content (SVG) serves as an attachment so a navigated raw URL cannot
 * execute same-origin script.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { ApiProxy, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`jail-${String(nextRpc++)}`), payload }
}

async function harness(cwd: string): Promise<{ api: ApiProxy; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  const session = ctx.sessions.create(sid('jail-session'), { meta: { cwd, createdAt: 100 } })
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return { api, sessionId: session.id }
}

/** A workspace with an outside sibling, a planted link, and honest files. */
function workspace(): { cwd: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-jail-')))
  const cwd = join(base, 'ws')
  const evil = join(base, 'ws-evil')
  mkdirSync(join(cwd, 'deliverables'), { recursive: true })
  mkdirSync(evil, { recursive: true })
  writeFileSync(join(evil, 'secret.txt'), 'outside')
  writeFileSync(join(cwd, 'deliverables', 'notes.txt'), 'inside')
  writeFileSync(join(cwd, 'deliverables', 'pic.svg'), '<svg></svg>')
  writeFileSync(join(cwd, 'deliverables', 'pic.png'), 'png-bytes')
  symlinkSync(join(evil, 'secret.txt'), join(cwd, 'deliverables', 'link.txt'))
  return { cwd }
}

const signal = (): AbortSignal => new AbortController().signal

describe('raw channel jail', () => {
  it('refuses a symlink escape with 403', async () => {
    const { api, sessionId } = await harness(workspace().cwd)
    const response = await api.artifacts.raw({ sessionId, path: 'deliverables/link.txt' }, signal())
    expect(response.status).toBe(403)
  })

  it('refuses a missing file exactly like an escape (no existence oracle)', async () => {
    const { api, sessionId } = await harness(workspace().cwd)
    const response = await api.artifacts.raw({ sessionId, path: 'deliverables/gone.txt' }, signal())
    expect(response.status).toBe(403)
  })

  it('serves an inside file normally', async () => {
    const { api, sessionId } = await harness(workspace().cwd)
    const response = await api.artifacts.raw({ sessionId, path: 'deliverables/notes.txt' }, signal())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('inside')
  })

  it('forces active content (SVG) to download; images stay inline', async () => {
    const { api, sessionId } = await harness(workspace().cwd)
    const svg = await api.artifacts.raw({ sessionId, path: 'deliverables/pic.svg' }, signal())
    expect(svg.status).toBe(200)
    expect(svg.headers.get('content-disposition')).toContain('attachment')
    const png = await api.artifacts.raw({ sessionId, path: 'deliverables/pic.png' }, signal())
    expect(png.headers.get('content-disposition')).toBeNull()
  })
})

describe('preview RPC jail', () => {
  it('refuses a same-prefix sibling escape as unreadable', async () => {
    const { api, sessionId } = await harness(workspace().cwd)
    const response = await api.artifacts.preview(request({ sessionId, path: '../ws-evil/secret.txt' }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.message).toBe('preview target unreadable')
  })

  it('refuses a symlink escape as unreadable', async () => {
    const { api, sessionId } = await harness(workspace().cwd)
    const response = await api.artifacts.preview(request({ sessionId, path: 'deliverables/link.txt' }))
    expect(response.result.ok).toBe(false)
  })

  it('still previews an inside file', async () => {
    const { api, sessionId } = await harness(workspace().cwd)
    const response = await api.artifacts.preview(request({ sessionId, path: 'deliverables/notes.txt' }))
    if (!response.result.ok) throw new Error('preview failed')
    expect(response.result.value.preview).toMatchObject({ kind: 'text' })
  })
})
