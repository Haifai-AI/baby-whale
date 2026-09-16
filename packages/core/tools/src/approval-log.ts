/**
 * Session-log approval facts the tool fences read back. A fence cannot hold
 * in-memory approval state: the log IS the memory, and replay must reach the
 * same verdict. Both fences (the whale overwrite fence and the MCP first-use
 * fence) ask the same two questions of the same audit pair, so the readers
 * live beside the tool-approval decision vocabulary they serve.
 * @module @deepseek-ai/dsh-tools/approval-log
 */

/** The only session surface these readers use; a session is otherwise opaque. */
interface SessionEventLike {
  readonly type: string
  readonly data?: unknown
}

/** The event list of the session under test, or empty for an unknown session. */
function sessionEvents(session: unknown): readonly SessionEventLike[] {
  return (session as { events?: readonly SessionEventLike[] } | undefined)?.events ?? []
}

/**
 * Per-session memo of {@link approvedAskReasons}, validated by log length.
 * One entry per fence: each fence owns the reasons it remembers.
 */
export type ApprovedAskReasonCache = WeakMap<
  object,
  { readonly length: number; readonly reasons: ReadonlySet<string> }
>

/**
 * The session's standing approval policy: the last `approval/policy` event
 * wins, and a session without one runs the default `'ask'`. `'never'` is what
 * the danger-full-access preset writes — it means never PROMPT, with the
 * sandbox layer owning allow/deny — so a fence that asks under it would get
 * its ask auto-rejected by the approval service without any human seeing a
 * card, which is why every fence stands down instead.
 * @param session - the calling agent's session, when known.
 * @returns `'never'` only when a policy event last set it so.
 */
export function sessionApprovalPolicy(session: unknown): 'ask' | 'never' {
  const events = sessionEvents(session)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'approval/policy') continue
    const data = event.data as { policy?: unknown } | undefined
    return data?.policy === 'never' ? 'never' : 'ask'
  }
  return 'ask'
}

/**
 * The ask reasons this session already waved through: each `approval/decided`
 * grant resolves to the `reason` its `approval/asked` partner carried, so a
 * fence can skip re-asking for work the user already approved once. Rejected
 * and cancelled asks stay unapproved.
 *
 * Callers pass their own cache: the log is append-only, so an equal event
 * count is the same log and the memoized set still answers.
 * @param session - the calling agent's session, when known.
 * @param cache - the calling fence's per-session memo.
 * @returns the approved reasons, empty when the session has none.
 */
export function approvedAskReasons(session: unknown, cache: ApprovedAskReasonCache): ReadonlySet<string> {
  const events = sessionEvents(session)
  const cacheable = session !== null && typeof session === 'object'
  if (cacheable) {
    const cached = cache.get(session)
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
  if (cacheable) cache.set(session, { length: events.length, reasons })
  return reasons
}
