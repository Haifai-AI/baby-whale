// Tool-run grouping: what becomes one line, what keeps its rows.
//
// The fold decides how much of the process a reader sees, so its boundaries
// are asserted directly rather than through a rendered transcript. The cases
// that matter are the ones a plausible grouping gets wrong: the real transcript
// interleaves assistant steps with tool calls, prose ends a run, and a settled
// run that failed must not fold.
import { describe, expect, it } from 'vitest'
import type { ChatNodeStore, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import type { ChatFlowEntry } from '../src/client/chat/tool-run.ts'
import {
  MIN_FOLDABLE_RUN, entryIsProcess, foldsByDefault, groupToolRuns, rowsVisible,
} from '../src/client/chat/tool-run.ts'

/** A settled call block. */
function settled(callId: string, time: number, callTime: number, isError = false): ToolCallBlock {
  return {
    kind: 'tool-result', seq: time, time, callId,
    call: { name: 'Read', argsRaw: '{}' },
    callTime, content: [], isError,
    callView: null, resultView: null, subCalls: [],
  }
}

/** A call still in flight. */
function running(callId: string, time: number): ToolCallBlock {
  return { callId, name: 'Read', argsRaw: '{}', turn: 1, step: 1, time, callView: null, subCalls: [] }
}

/** A tool-call Node wrapping one root block. */
function call(key: string, block: ToolCallBlock): ChatNode {
  return { key, kind: 'tool-call', data: { root: block } } as unknown as ChatNode
}

/** An assistant step Node. `blocks` decides whether it is process or content. */
function step(
  key: string,
  time: number,
  blocks: readonly { kind: string; text?: string }[],
  status = 'settled',
): ChatNode {
  return { key, kind: 'assistant-step', data: { status, time, blocks } } as unknown as ChatNode
}

/** Prose: the answer, and the thing a run must never swallow. */
const prose = (text: string) => ({ kind: 'text', text })

/** A non-process row (user message, command, turn tail). */
function other(key: string, kind: string): ChatNode {
  return { key, kind, data: {} } as unknown as ChatNode
}

/** The narrow reader the runtime hands a renderer. */
function store(nodes: readonly ChatNode[]): ChatNodeStore {
  const index = new Map(nodes.map(node => [node.key, node as never]))
  return { get: key => index.get(key), values: () => [...index.values()] }
}

describe('groupToolRuns', () => {
  it('folds the assistant steps interleaved with calls, which is the real transcript', () => {
    // The shape a turn actually renders: step, call, call, step, call.
    const nodes = [
      step('s1', 10, [{ kind: 'reasoning', text: 'thinking' }]),
      call('c1', running('a', 20)), call('c2', running('b', 30)),
      step('s2', 40, [{ kind: 'reasoning', text: 'more' }]),
      call('c3', running('d', 50)),
    ]
    const flow = groupToolRuns(['s1', 'c1', 'c2', 's2', 'c3'], store(nodes))

    expect(flow).toHaveLength(1)
    expect(flow[0]).toMatchObject({
      kind: 'run', key: 's1',
      run: { keys: ['s1', 'c1', 'c2', 's2', 'c3'], calls: 3 },
    })
  })

  it('counts tool calls, not covered Nodes', () => {
    const flow = groupToolRuns(['c1', 's1', 'c2'], store([
      call('c1', running('a', 1)),
      step('s1', 2, [{ kind: 'reasoning', text: 'x' }]),
      call('c2', running('b', 3)),
    ]))
    expect(flow[0]).toMatchObject({ run: { calls: 2, keys: ['c1', 's1', 'c2'] } })
  })

  it('ends the run at prose, so the answer is never folded away', () => {
    const nodes = [
      call('c1', running('a', 1)), call('c2', running('b', 2)),
      step('answer', 3, [prose('Here is the deck.')]),
      call('c3', running('d', 4)),
    ]
    const flow = groupToolRuns(['c1', 'c2', 'answer', 'c3'], store(nodes))

    expect(flow.map(entry => entry.kind)).toEqual(['run', 'node', 'run'])
    expect(flow[1]).toMatchObject({ kind: 'node', key: 'answer' })
  })

  it('treats a blank-text step as process and a non-empty one as content', () => {
    const blank = groupToolRuns(['c1', 's1', 'c2'], store([
      call('c1', running('a', 1)), step('s1', 2, [prose('   ')]), call('c2', running('b', 3)),
    ]))
    expect(blank).toHaveLength(1)

    const filled = groupToolRuns(['c1', 's1', 'c2'], store([
      call('c1', running('a', 1)), step('s1', 2, [prose('Hi')]), call('c2', running('b', 3)),
    ]))
    expect(filled.map(entry => entry.kind)).toEqual(['run', 'node', 'run'])
  })

  it('treats an unrecognized block as content rather than folding something it cannot read', () => {
    const flow = groupToolRuns(['c1', 's1', 'c2'], store([
      call('c1', running('a', 1)), step('s1', 2, [{ kind: 'image' }]), call('c2', running('b', 3)),
    ]))
    expect(flow.map(entry => entry.kind)).toEqual(['run', 'node', 'run'])
  })

  it('keeps other row kinds standalone and outside any run', () => {
    const flow = groupToolRuns(['c1', 'u1', 'c2'], store([
      call('c1', running('a', 1)), other('u1', 'user'), call('c2', running('b', 2)),
    ]))
    expect(flow.map(entry => entry.kind)).toEqual(['run', 'node', 'run'])
  })

  it('renders a reasoning-only stretch as its own Nodes, not as a 0-call run', () => {
    const flow = groupToolRuns(['s1', 's2'], store([
      step('s1', 1, [{ kind: 'reasoning', text: 'a' }]),
      step('s2', 2, [{ kind: 'reasoning', text: 'b' }]),
    ]))
    expect(flow.map(entry => entry.kind)).toEqual(['node', 'node'])
  })

  it('run identity is the first key, so a run keeps its fold across an append', () => {
    const first = groupToolRuns(['c1', 'c2'], store([
      call('c1', running('a', 1)), call('c2', running('b', 2)),
    ]))
    const grown = groupToolRuns(['c1', 'c2', 'c3'], store([
      call('c1', running('a', 1)), call('c2', running('b', 2)), call('c3', running('c', 3)),
    ]))
    expect(first[0]).toMatchObject({ key: 'c1' })
    expect(grown[0]).toMatchObject({ key: 'c1', run: { keys: ['c1', 'c2', 'c3'] } })
  })

  it('a Node missing from the index ends the run instead of joining it', () => {
    // The seat renders nothing for an absent Node, so folding across it would
    // hide a row that is not there and misreport the count.
    const flow = groupToolRuns(['c1', 'gone', 'c2'], store([
      call('c1', running('a', 1)), call('c2', running('b', 2)),
    ]))
    expect(flow.map(entry => entry.kind)).toEqual(['run', 'node', 'run'])
  })

  it('treats an unsettled call or a streaming step as running', () => {
    const unsettled = groupToolRuns(['c1', 'c2'], store([
      call('c1', settled('a', 100, 40)), call('c2', running('b', 120)),
    ]))
    expect(unsettled[0]).toMatchObject({ run: { running: true, failed: false } })

    const streaming = groupToolRuns(['c1', 's1'], store([
      call('c1', settled('a', 100, 40)),
      step('s1', 120, [{ kind: 'reasoning', text: 'x' }], 'running'),
    ]))
    expect(streaming[0]).toMatchObject({ run: { running: true } })
  })

  it('spans the run from first Node time to last settlement', () => {
    const flow = groupToolRuns(['s1', 'c1', 'c2'], store([
      step('s1', 90, [{ kind: 'reasoning', text: 'x' }]),
      call('c1', settled('a', 500, 100)),
      call('c2', settled('b', 900, 600)),
    ]))
    expect(flow[0]).toMatchObject({ run: { startTime: 90, endTime: 900 } })
  })

  it('leaves endTime null while any covered Node is unsettled', () => {
    const flow = groupToolRuns(['c1', 'c2'], store([
      call('c1', settled('a', 500, 100)), call('c2', running('b', 600)),
    ]))
    // A partially-timed span would print a duration the run has not finished
    // taking.
    expect(flow[0]).toMatchObject({ run: { startTime: 100, endTime: null } })
  })

  it('marks a run failed on a failed call or an interruption', () => {
    const failed = groupToolRuns(['c1', 'c2'], store([
      call('c1', settled('a', 100, 40)), call('c2', settled('b', 200, 150, true)),
    ]))
    expect(failed[0]).toMatchObject({ run: { failed: true } })

    const stopped = groupToolRuns(['c1'], store([
      call('c1', { ...settled('c', 200, 150), error: { name: 'AbortError', code: 'interrupted' } } as ToolCallBlock),
    ]))
    expect(stopped[0]).toMatchObject({ run: { failed: true } })
  })

  it('returns no entries for an empty order', () => {
    expect(groupToolRuns([], store([]))).toEqual([])
  })
})

describe('foldsByDefault', () => {
  const run = (over: Partial<Parameters<typeof foldsByDefault>[0]>) => ({
    key: 'r1', keys: ['a', 'b', 'c'], calls: 3, running: false, failed: false,
    startTime: 1, endTime: 2, ...over,
  })

  it('folds a settled, clean run at the threshold and above', () => {
    expect(foldsByDefault(run({ calls: 3 }))).toBe(true)
    expect(foldsByDefault(run({ calls: 9 }))).toBe(true)
  })

  it('leaves a short run expanded: folding two rows saves a row and costs a click', () => {
    expect(foldsByDefault(run({ calls: 1 }))).toBe(false)
    expect(foldsByDefault(run({ calls: 2 }))).toBe(false)
    expect(MIN_FOLDABLE_RUN).toBe(3)
  })

  it('never folds a running run, so live calls stay visible', () => {
    expect(foldsByDefault(run({ running: true }))).toBe(false)
  })

  it('never folds a failed run: a collapsed failure has to be gone looking for', () => {
    expect(foldsByDefault(run({ failed: true }))).toBe(false)
  })
})

describe('rowsVisible', () => {
  const foldable = {
    key: 'r1', keys: ['a', 'b', 'c'], calls: 3, running: false, failed: false, startTime: 1, endTime: 2,
  }

  it('hides a foldable run until the reader opens it', () => {
    expect(rowsVisible(foldable, new Set())).toBe(false)
    expect(rowsVisible(foldable, new Set(['r1']))).toBe(true)
  })

  it('keeps a non-foldable run visible whatever the reader did', () => {
    expect(rowsVisible({ ...foldable, failed: true }, new Set())).toBe(true)
    expect(rowsVisible({ ...foldable, running: true }, new Set())).toBe(true)
  })

  it('an opened run stays open after it settles, rather than re-folding under the reader', () => {
    const streaming = { ...foldable, running: true }
    const opened = new Set(['r1'])
    expect(rowsVisible(streaming, opened)).toBe(true)
    expect(rowsVisible({ ...streaming, running: false }, opened)).toBe(true)
  })
})

describe('turn assignment', () => {
  /** A turn tail Node — the last Node of its turn, carrying the turn number. */
  function tail(key: string, turn: number): ChatNode {
    return { key, kind: 'turn-tail', data: { turn } } as unknown as ChatNode
  }

  it('labels a turn from its tail, walking backwards', () => {
    // Two turns. The tail is each turn's LAST Node, so one backward pass has
    // to label everything behind it — and the two calls of turn 2 arrive as a
    // single run entry, not two.
    const nodes = [
      call('a1', running('a', 1)), call('a2', running('b', 2)), tail('t1', 1),
      call('b1', running('c', 3)), call('b2', running('d', 4)), tail('t2', 2),
    ]
    const flow = groupToolRuns(['a1', 'a2', 't1', 'b1', 'b2', 't2'], store(nodes))
    expect(flow.map(e => [e.kind, e.turn])).toEqual([
      ['run', 1], ['node', 1], ['run', 2], ['node', 2],
    ])
  })

  it('labels a turn´s user message with that turn, since it leads the exchange', () => {
    const flow = groupToolRuns(['u1', 'a1', 't1'], store([
      other('u1', 'user'), call('a1', running('a', 1)), tail('t1', 1),
    ]))
    // The user message is content, so the label never changes what is hidden —
    // it only decides which turn's footer the row reads as belonging to.
    expect(flow.map(e => [e.kind, e.turn])).toEqual([['node', 1], ['run', 1], ['node', 1]])
    expect(entryIsProcess(flow[0]!, store([other('u1', 'user')]))).toBe(false)
  })

  it('leaves the live turn unlabelled, because it has no footer to toggle from', () => {
    const flow = groupToolRuns(['a1', 't1', 'b1'], store([
      call('a1', running('a', 1)), tail('t1', 1), call('b1', running('b', 2)),
    ]))
    expect(flow.map(e => e.turn)).toEqual([1, 1, null])
  })

  it('leaves everything unlabelled when no turn has closed', () => {
    const flow = groupToolRuns(['a1', 'a2'], store([
      call('a1', running('a', 1)), call('a2', running('b', 2)),
    ]))
    expect(flow.map(e => e.turn)).toEqual([null])
  })
})

describe('entryIsProcess', () => {
  it('treats every run as process', () => {
    const nodes = [call('c1', running('a', 1))]
    const flow = groupToolRuns(['c1'], store(nodes))
    expect(flow[0]?.kind).toBe('run')
    expect(entryIsProcess(flow[0]!, store(nodes))).toBe(true)
  })

  it('treats a reasoning-only step as process but prose as content', () => {
    const reasoningNodes = [step('s1', 1, [{ kind: 'reasoning', text: 'x' }])]
    expect(entryIsProcess(groupToolRuns(['s1'], store(reasoningNodes))[0]!, store(reasoningNodes))).toBe(true)

    const proseNodes = [step('s1', 1, [prose('the answer')])]
    expect(entryIsProcess(groupToolRuns(['s1'], store(proseNodes))[0]!, store(proseNodes))).toBe(false)
  })

  it('never treats another row kind as process, so a notice is never hidden', () => {
    for (const kind of ['user', 'command', 'compaction', 'turn-error', 'turn-tail', 'unknown']) {
      const nodes = [other('n1', kind)]
      const entry = groupToolRuns(['n1'], store(nodes))[0]!
      expect(entryIsProcess(entry, store(nodes)), kind).toBe(false)
    }
  })

  it('treats a Node missing from the index as content, so nothing vanishes unread', () => {
    const nodes = [call('c1', running('a', 1))]
    const entry: ChatFlowEntry = { kind: 'node', key: 'gone', turn: 1 }
    expect(entryIsProcess(entry, store(nodes))).toBe(false)
  })
})
