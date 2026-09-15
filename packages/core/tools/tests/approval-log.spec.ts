/**
 * Session-log approval readers shared by the tool fences: the standing
 * approval policy and the ask reasons a session already granted. The log is
 * append-only, so the memo must answer from an equal-length log and must not
 * answer from a longer one.
 * @module @deepseek-ai/dsh-tools/tests/approval-log
 */

import { describe, expect, it } from 'vitest'
import { approvedAskReasons, sessionApprovalPolicy, type ApprovedAskReasonCache } from '../src/index.ts'

/** A session whose only relevant surface is its append-only event list. */
function sessionWith(events: { type: string; data?: unknown }[]): object {
  return { events }
}

describe('sessionApprovalPolicy', () => {
  it('defaults to ask for an unknown session', () => {
    expect(sessionApprovalPolicy(undefined)).toBe('ask')
    expect(sessionApprovalPolicy(null)).toBe('ask')
    expect(sessionApprovalPolicy({})).toBe('ask')
  })

  it('reads the last policy event', () => {
    const session = sessionWith([
      { type: 'approval/policy', data: { policy: 'never' } },
      { type: 'approval/policy', data: { policy: 'ask' } },
      { type: 'approval/policy', data: { policy: 'never' } },
    ])
    expect(sessionApprovalPolicy(session)).toBe('never')
  })

  it('treats an unrecognized policy value as ask', () => {
    expect(sessionApprovalPolicy(sessionWith([{ type: 'approval/policy', data: { policy: 'sometimes' } }]))).toBe('ask')
    expect(sessionApprovalPolicy(sessionWith([{ type: 'approval/policy' }]))).toBe('ask')
  })

  it('ignores unrelated events after the last policy event', () => {
    const session = sessionWith([
      { type: 'approval/policy', data: { policy: 'never' } },
      { type: 'user/message', data: {} },
    ])
    expect(sessionApprovalPolicy(session)).toBe('never')
  })
})

describe('approvedAskReasons', () => {
  const ask = (id: string, reason?: unknown): { type: string; data?: unknown } =>
    ({ type: 'approval/asked', data: reason === undefined ? { id } : { id, reason } })
  const decided = (id: string, outcome: string): { type: string; data: unknown } =>
    ({ type: 'approval/decided', data: { id, outcome } })

  it('returns nothing for a session that is not an object', () => {
    const cache: ApprovedAskReasonCache = new WeakMap()
    expect(approvedAskReasons(undefined, cache).size).toBe(0)
    expect(approvedAskReasons(null, cache).size).toBe(0)
  })

  it('collects the reason behind each allowed-once decision', () => {
    const cache: ApprovedAskReasonCache = new WeakMap()
    const session = sessionWith([ask('a', 'overwrite /tmp/deck.py'), decided('a', 'allowed-once')])
    expect([...approvedAskReasons(session, cache)]).toEqual(['overwrite /tmp/deck.py'])
  })

  it('leaves rejected decisions unapproved', () => {
    const cache: ApprovedAskReasonCache = new WeakMap()
    const session = sessionWith([ask('a', 'overwrite /tmp/deck.py'), decided('a', 'rejected')])
    expect(approvedAskReasons(session, cache).size).toBe(0)
  })

  it('ignores a decision whose ask carried no string reason', () => {
    const cache: ApprovedAskReasonCache = new WeakMap()
    const session = sessionWith([
      ask('no-reason'),
      decided('no-reason', 'allowed-once'),
      ask('numeric', 7),
      decided('numeric', 'allowed-once'),
    ])
    expect(approvedAskReasons(session, cache).size).toBe(0)
  })

  it('ignores a decision with no matching ask', () => {
    const cache: ApprovedAskReasonCache = new WeakMap()
    expect(approvedAskReasons(sessionWith([decided('ghost', 'allowed-once')]), cache).size).toBe(0)
  })

  it('ignores events without a usable id', () => {
    const cache: ApprovedAskReasonCache = new WeakMap()
    const session = sessionWith([
      { type: 'approval/asked', data: { reason: 'unidentified' } },
      { type: 'approval/decided', data: { outcome: 'allowed-once' } },
    ])
    expect(approvedAskReasons(session, cache).size).toBe(0)
  })

  it('answers from the memo while the log is unchanged, and re-reads once it grows', () => {
    const cache: ApprovedAskReasonCache = new WeakMap()
    const session = sessionWith([ask('a', 'first'), decided('a', 'allowed-once')])
    expect(approvedAskReasons(session, cache).size).toBe(1)
    // Same log length: the memoized set is returned as-is.
    expect(approvedAskReasons(session, cache).size).toBe(1)
    ;(session as { events: { type: string; data?: unknown }[] }).events.push(ask('b', 'second'), decided('b', 'allowed-once'))
    expect([...approvedAskReasons(session, cache)].sort()).toEqual(['first', 'second'])
  })
})
