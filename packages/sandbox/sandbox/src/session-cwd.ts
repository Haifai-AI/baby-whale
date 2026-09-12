/**
 * The tool-call working-directory rule shared by every path-resolving tool
 * family (filesystem reads/writes, office artifact tools): resolve relative
 * paths against the calling agent's per-session workspace
 * (`exec.agent.session.header.cwd`), so each session acts on ITS workspace
 * rather than the server's launch dir, and canonicalize when parent traversal
 * would make a symlinked cwd's filesystem identity observable — the same
 * canonical-path concern as `roots.ts`'s enforcement matching. One home, so
 * the tool families cannot drift on which cwd a relative path resolves
 * against. Non-agent calls return `undefined`, leaving the fallback in the
 * provider rather than reading `process.cwd()` at the tool boundary.
 *
 * @module dsh-sandbox/session-cwd
 */

import { canonicalPath } from './roots.ts'

/**
 * Structural slice of a tool execution this module reads: the calling agent's
 * session header cwd and the call's cancellation signal. Every tool family's
 * full execution type satisfies this shape.
 */
export interface SessionCwdExecution {
  /** The agent on whose behalf the call runs (absent for non-agent callers). */
  readonly agent?: { readonly session: { readonly header: { readonly cwd?: string } } }
  /** Cancellation forwarded to provider resolution. */
  readonly signal: AbortSignal
}

/** A path segment that escapes its directory (`..` as a full segment). */
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` and `signal` are read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 */
export function sessionCwd(exec: SessionCwdExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all path-resolving model-facing tools.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
export function sessionResolveOptions(
  exec: SessionCwdExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
