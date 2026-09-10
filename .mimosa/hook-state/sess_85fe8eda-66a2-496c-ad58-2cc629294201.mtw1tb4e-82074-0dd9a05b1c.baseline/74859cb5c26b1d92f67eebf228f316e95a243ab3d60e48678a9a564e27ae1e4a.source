/**
 * Derive the working directory an office tool resolves relative paths against:
 * the calling agent's per-session workspace (`exec.agent.session.header.cwd`),
 * so each session's artifact writes land in ITS workspace, not the server's
 * launch dir — mirroring how `dsh-tool-fs` resolves file paths.
 * @module @deepseek-ai/dsh-tool-office/src/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 */
export function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all office artifact tools.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call workspace root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
export function sessionResolveOptions(
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}

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
