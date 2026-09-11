/**
 * The office tools' working-directory rule: resolve against the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`), so each
 * session's artifact writes land in ITS workspace, not the server's launch
 * dir. The rule is shared with the other path-resolving tool families
 * (`dsh-sandbox/session-cwd`) so they cannot drift.
 * @module @deepseek-ai/dsh-tool-office/src/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'

export { sessionCwd, sessionResolveOptions } from '@deepseek-ai/dsh-sandbox'

/**
 * Resolve the standing sandbox policy for the calling session, or `undefined`
 * when the mounted filesystem does not confine. A confining backend without a
 * mounted `sandboxPolicy` fails loud at the first write (mirrors
 * `dsh-tool-fs`'s construction guard).
 * @param ctx - the plugin context carrying `ctx.fs` and (optionally) `ctx.sandboxPolicy`.
 * @param exec - the tool-execution context identifying the calling session.
 * @returns the standing policy, or undefined for an unconfined backend.
 */
export function resolveOfficePolicy(
  ctx: { fs: { sandboxMode: string | undefined }; get(name: string): unknown },
  exec: ToolExecution,
): Promise<SandboxExecutionPolicy | undefined> {
  if (ctx.fs.sandboxMode === undefined) return Promise.resolve(undefined)
  const policy = ctx.get('sandboxPolicy') as
    | { resolve(request: { session?: unknown }): SandboxExecutionPolicy }
    | undefined
  if (policy === undefined) {
    throw new Error('tool-office: the mounted filesystem confines but ctx.sandboxPolicy is missing')
  }
  return Promise.resolve(policy.resolve(exec.agent ? { session: exec.agent.session } : {}))
}
