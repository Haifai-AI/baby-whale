/**
 * First-use approval for MCP tools: a session that has never allowed a given
 * `mcp__server__tool` call sees one approval card; the session's audit log is
 * the memory, exactly like the whale guardrails overwrite fence. Under the
 * never-prompt policy (danger-full-access) the fence stands down — an ask
 * there would be auto-rejected without any human seeing it.
 *
 * Ownership is INJECTED, never inferred from the tool name: the caller
 * supplies a resolver that answers "which server's mount registered this
 * exact tool". Prefix parsing (first `__` or longest configured prefix both)
 * misattributes names like `mcp__a__b__t` when servers `a` and `a__b`
 * coexist, and a stale configured name can steal attribution.
 * @module @deepseek-ai/dsh-whale-mcp/approval
 */

import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Model-facing prefix every bridge tool carries (`mcp__<server>__<tool>`). */
export const MCP_TOOL_PREFIX = 'mcp__'

/**
 * Resolves the exact mount identity behind one model-facing tool name.
 * The whale MCP manager answers from the origin stamp its bridge mounts put
 * on every registered definition; `undefined` means no live mount owns the
 * name (or the caller has no ownership source) and the ask names no server.
 */
export type McpToolOwnerResolver = (toolName: string) => string | undefined

/**
 * The session's approval policy: the last `approval/policy` event wins, and a
 * session without one runs the default `'ask'`. `'never'` is what the
 * danger-full-access preset writes — never PROMPT, the sandbox layer owns
 * allow/deny — so asking under it would only produce silent auto-rejections.
 * @param session - the calling agent's session, when known.
 * @returns `'never'` only when a policy event last set it so.
 */
function sessionApprovalPolicy(session: unknown): 'ask' | 'never' {
  const events = (session as { events?: readonly SessionEventLike[] } | undefined)?.events ?? []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'approval/policy') continue
    const data = event.data as { policy?: unknown } | undefined
    return data?.policy === 'never' ? 'never' : 'ask'
  }
  return 'ask'
}

interface SessionEventLike {
  readonly type: string
  readonly data?: unknown
}

/**
 * MCP tools this session already allowed, validated against the audit log
 * length (append-only, so an equal length is the same log). Approved asks are
 * remembered by REASON, and the reason names the tool — first use of each
 * tool asks once per session, not once per server.
 */
const approvedMcpReasons = new WeakMap<object, { readonly length: number; readonly reasons: ReadonlySet<string> }>()

/**
 * Reasons allowed-once in this session, from the same audit shape the
 * overwrite fence reads: `approval/asked` records a reason under its ask id,
 * and a later `approval/decided` with outcome `allowed-once` approves it.
 * @param session - the calling agent's session object (cache key).
 * @returns the set of approved ask reasons.
 */
function approvedReasons(session: unknown): ReadonlySet<string> {
  const events = (session as { events?: readonly SessionEventLike[] } | undefined)?.events ?? []
  const cacheable = session !== null && typeof session === 'object'
  if (cacheable) {
    const cached = approvedMcpReasons.get(session)
    if (cached !== undefined && cached.length === events.length) return cached.reasons
  }
  const reasonById = new Map<string, string | undefined>()
  const reasons = new Set<string>()
  for (const event of events) {
    const data = event.data as { id?: unknown; reason?: unknown; outcome?: unknown } | undefined
    if (event.type === 'approval/asked' && typeof data?.id === 'string') {
      reasonById.set(data.id, typeof data.reason === 'string' ? data.reason : undefined)
    } else if (event.type === 'approval/decided' && data?.outcome === 'allowed-once' && typeof data.id === 'string') {
      const reason = reasonById.get(data.id)
      if (reason !== undefined) reasons.add(reason)
    }
  }
  if (cacheable) approvedMcpReasons.set(session, { length: events.length, reasons })
  return reasons
}

/**
 * The approval ask reason for one MCP tool call: stable per (tool name,
 * resolved owner) so a later audit scan recognizes the earlier grant. The
 * server clause names the mount that ACTUALLY registered the tool, as
 * resolved by the caller's ownership source; a name no live mount owns asks
 * without one.
 * @param toolName - the model-facing public tool name.
 * @param owner - the owning server's configured name, when resolved.
 * @returns the human-facing ask reason.
 */
export function mcpAskReason(toolName: string, owner?: string): string {
  return `run MCP tool "${toolName}"${owner !== undefined ? ` from server "${owner}"` : ''}?`
}

/**
 * Decide one tool execution for the MCP fence.
 * @param exec - the execution about to dispatch.
 * @param resolveOwner - resolves the exact mount identity behind a tool name
 *   (see {@link McpToolOwnerResolver}); the ask reason names that server.
 * @returns an ask decision on first use, or `undefined` to let the call pass.
 */
export function decideMcpApproval(
  exec: Readonly<ToolExecution>,
  resolveOwner: McpToolOwnerResolver = () => undefined,
): PreToolDecision | undefined {
  if (!exec.name.startsWith(MCP_TOOL_PREFIX)) return undefined
  const session = exec.agent?.session
  if (sessionApprovalPolicy(session) === 'never') return undefined
  const reason = mcpAskReason(exec.name, resolveOwner(exec.name))
  if (approvedReasons(session).has(reason)) return undefined
  return { kind: 'ask', reason }
}
