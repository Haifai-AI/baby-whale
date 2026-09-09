/**
 * First-use approval for MCP tools: a session that has never allowed a given
 * `mcp__server__tool` call sees one approval card; the session's audit log is
 * the memory, exactly like the whale guardrails overwrite fence. Under the
 * never-prompt policy (danger-full-access) the fence stands down — an ask
 * there would be auto-rejected without any human seeing it.
 * @module @deepseek-ai/dsh-whale-mcp/approval
 */

import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Model-facing prefix every bridge tool carries (`mcp__<server>__<tool>`). */
export const MCP_TOOL_PREFIX = 'mcp__'

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
 * Attribute a tool name to its configured server by LITERAL prefix match.
 * Tool names are never parsed to recover identity: a server named `a__b`
 * registers `mcp__a__b__<tool>`, and splitting at the first `__` would
 * misattribute it to a server `a`. Longest configured name wins, so servers
 * `a` and `a__b` coexist deterministically.
 * @param toolName - the model-facing public tool name.
 * @param serverNames - the names of the servers currently configured.
 * @returns the owning configured server name, or undefined when none matches.
 */
function configuredServerOf(toolName: string, serverNames: ReadonlySet<string>): string | undefined {
  let owner: string | undefined
  for (const name of serverNames) {
    if (!toolName.startsWith(`${MCP_TOOL_PREFIX}${name}__`)) continue
    if (owner === undefined || name.length > owner.length) owner = name
  }
  return owner
}

/**
 * The approval ask reason for one MCP tool call: stable per (tool name,
 * configured server set) so a later audit scan recognizes the earlier grant.
 * The server clause names the CONFIGURED server owning the tool's literal
 * prefix; an unconfigured tool (never the case for a mounted server) asks
 * without one.
 * @param toolName - the model-facing public tool name.
 * @param serverNames - the names of the servers currently configured.
 * @returns the human-facing ask reason.
 */
export function mcpAskReason(toolName: string, serverNames: ReadonlySet<string> = new Set()): string {
  const server = configuredServerOf(toolName, serverNames)
  return `run MCP tool "${toolName}"${server !== undefined ? ` from server "${server}"` : ''}?`
}

/**
 * Decide one tool execution for the MCP fence.
 * @param exec - the execution about to dispatch.
 * @param serverNames - the names of the servers currently configured, used to
 * attribute the tool to its server by literal prefix (see {@link mcpAskReason}).
 * @returns an ask decision on first use, or `undefined` to let the call pass.
 */
export function decideMcpApproval(
  exec: Readonly<ToolExecution>,
  serverNames: ReadonlySet<string> = new Set(),
): PreToolDecision | undefined {
  if (!exec.name.startsWith(MCP_TOOL_PREFIX)) return undefined
  const session = exec.agent?.session
  if (sessionApprovalPolicy(session) === 'never') return undefined
  const reason = mcpAskReason(exec.name, serverNames)
  if (approvedReasons(session).has(reason)) return undefined
  return { kind: 'ask', reason }
}
