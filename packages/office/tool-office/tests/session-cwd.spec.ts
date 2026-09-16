/**
 * Office sandbox-policy resolution behavior: an unconfined filesystem resolves
 * no policy, a confining one delegates to the mounted sandboxPolicy service
 * with the calling agent's session, and a confining one without that service
 * fails loud instead of writing unguarded.
 * @module @deepseek-ai/dsh-tool-office/tests/session-cwd
 */

import { describe, expect, it } from 'vitest'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveOfficePolicy, sessionCwd, sessionResolveOptions } from '../src/session-cwd.ts'

interface PolicyRequest {
  session?: unknown
}

/** The structural context `resolveOfficePolicy` reads: the fs mode and the service lookup. */
interface PolicyContext {
  fs: { sandboxMode: string | undefined }
  get(name: string): unknown
}

function context(options: { sandboxMode?: string; policy?: { resolve(request: PolicyRequest): unknown } }): PolicyContext {
  return {
    fs: { sandboxMode: options.sandboxMode },
    get: name => (name === 'sandboxPolicy' ? options.policy : undefined),
  }
}

function execution(agent?: unknown): ToolExecution {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: 'token',
    name: 'xlsx_read',
    arguments: {},
    signal: new AbortController().signal,
    ...(agent === undefined ? {} : { agent }),
  } as unknown as ToolExecution
}

describe('resolveOfficePolicy', () => {
  it('resolves no policy for a filesystem that never confines', async () => {
    let asked = false
    const ctx: PolicyContext = {
      fs: { sandboxMode: undefined },
      get: () => { asked = true; return undefined },
    }
    await expect(resolveOfficePolicy(ctx, execution())).resolves.toBeUndefined()
    expect(asked).toBe(false)
  })

  it('delegates to the mounted policy with the calling agent session', async () => {
    const session = { header: { cwd: '/workspace' } }
    const requests: PolicyRequest[] = []
    const policy = { workspaceRoot: '/workspace' }
    const resolved = await resolveOfficePolicy(
      context({ sandboxMode: 'workspace-write', policy: { resolve: (request) => { requests.push(request); return policy } } }),
      execution({ session }),
    )
    expect(resolved).toBe(policy)
    expect(requests).toEqual([{ session }])
  })

  it('delegates without a session for a caller that has no agent', async () => {
    const requests: PolicyRequest[] = []
    await resolveOfficePolicy(
      context({ sandboxMode: 'read-only', policy: { resolve: (request) => { requests.push(request); return {} } } }),
      execution(),
    )
    expect(requests).toEqual([{}])
  })

  it('fails loud when a confining filesystem has no policy service mounted', () => {
    expect(() => resolveOfficePolicy(context({ sandboxMode: 'workspace-write' }), execution()))
      .toThrow('tool-office: the mounted filesystem confines but ctx.sandboxPolicy is missing')
  })
})

describe('shared session cwd rule', () => {
  it('re-exports the path rule every tool family resolves against', () => {
    const exec = execution({ session: { header: { cwd: '/workspace' } } })
    expect(sessionCwd(exec, 'q2.xlsx')).toBe('/workspace')
    expect(sessionResolveOptions(exec, 'q2.xlsx', '/policy-root')).toMatchObject({ cwd: '/policy-root' })
  })
})
