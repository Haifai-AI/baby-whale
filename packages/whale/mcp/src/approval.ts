/**
 * First-use approval for MCP tools: a session that has never allowed a given
 * `mcp__server__tool` call sees one approval card; the session's audit log is
 * the memory, read through the same readers as the whale overwrite fence.
 * Under the never-prompt policy (danger-full-access) the fence stands down —
 * an ask there would be auto-rejected without any human seeing it.
 *
 * Ownership is INJECTED, never inferred from the tool name: the caller
 * supplies a resolver that answers "which server's mount registered this
 * exact tool". Prefix parsing (first `__` or longest configured prefix both)
 * misattributes names like `mcp__a__b__t` when servers `a` and `a__b`
 * coexist, and a stale configured name can steal attribution.
 * @module @deepseek-ai/dsh-whale-mcp/approval
 */

import {
  approvedAskReasons,
  sessionApprovalPolicy,
  type ApprovedAskReasonCache,
  type PreToolDecision,
  type ToolExecution,
} from '@deepseek-ai/dsh-tools'

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
 * MCP tools this session already allowed, validated against the audit log
 * length (append-only, so an equal length is the same log). Approved asks are
 * remembered by REASON, and the reason names the tool — first use of each
 * tool asks once per session, not once per server.
 */
const approvedMcpReasons: ApprovedAskReasonCache = new WeakMap()

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
  if (approvedAskReasons(session, approvedMcpReasons).has(reason)) return undefined
  return { kind: 'ask', reason }
}
