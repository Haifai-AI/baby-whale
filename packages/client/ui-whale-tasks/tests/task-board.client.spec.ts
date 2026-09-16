// @vitest-environment jsdom
/**
 * The `whale/task-board` Conversation Definition: one whole-value snapshot
 * event per immutable Chat node. These specs drive the Definition through the
 * real node assembler (match → start → buildViewNode) and then pin the arms
 * the assembler cannot reach — the state-absent view and the two anchor and
 * Location fallbacks.
 */
import { describe, expect, it } from 'vitest'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationMatch, ConversationNodeDefinition,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Value-free: pulls the `whale/task-board` SessionEventMap member this spec names.
import type {} from '@deepseek-ai/dsh-whale-core/types'
import { whaleTaskBoardDefinition, type WhaleTaskView } from '../src/client/task-board.ts'

/** State and Context types the Definition declares, without exporting them. */
type BoardState = ReturnType<typeof whaleTaskBoardDefinition.start>
type BoardContext = Parameters<NonNullable<typeof whaleTaskBoardDefinition.buildViewNode>>[0]

/** The chat node the engine publishes; `buildViewNode` erases to the base node type. */
function builtNode(context: BoardContext): ChatConversationViewNode | null | undefined {
  return whaleTaskBoardDefinition.buildViewNode?.(context) as ChatConversationViewNode | null | undefined
}

const STAMP = 1_700_000_000_000

/** One realistic task row, mirroring the host's wire view. */
const task = (overrides: Partial<WhaleTaskView> = {}): WhaleTaskView => ({
  id: 't-1',
  name: 'nightly report',
  status: 'active',
  scheduleKind: 'cron',
  scheduleSummary: '每天 09:00',
  tz: 'Asia/Shanghai',
  nextRunAt: '2026-01-01T01:00:00.000Z',
  lastRunAt: null,
  workspaceCwd: '/work/repo',
  ...overrides,
})

const TASKS: readonly WhaleTaskView[] = [
  task(),
  task({ id: 't-2', name: 'backup', status: 'paused', scheduleSummary: '每周日 02:00' }),
]

/** A real log event of the family this Definition owns. */
function boardEvent(seq: number, tasks: readonly WhaleTaskView[] = TASKS): SessionEvent<'whale/task-board'> {
  return { seq, time: STAMP + seq, type: 'whale/task-board', data: { tasks: [...tasks] } }
}

/** Any other log event, for the non-matching arms. */
function otherEvent(seq: number, type: string): SessionEvent {
  return { seq, time: STAMP + seq, type, data: {} } as SessionEvent
}

/** A Definition-accepted match: the assembler's role plus an unresolved Location. */
function matched(event: SessionEvent, role: ConversationMatch['role'] = 'start'): ConversationMatch {
  return { event, view: undefined, role, location: { kind: 'unresolved' } }
}

/**
 * A Context carrying only the fields the Definition reads: `key`/`id` for the
 * node identity, `state` for the payload, and `start`/`matches` for the anchor.
 */
function boardContext(overrides: {
  state?: BoardState | undefined
  start?: ConversationMatch | undefined
  matches?: readonly ConversationMatch[]
} = {}): BoardContext {
  return {
    key: '7:whale-task-board7',
    kind: 'whale-task-board',
    id: '7',
    matches: [],
    start: undefined,
    state: undefined,
    current: new Map(),
    ...overrides,
  }
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [whaleTaskBoardDefinition] }
  fallbackEntry(): undefined { return undefined }
}

const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, { nodes: ReadonlyMap<string, ChatConversationViewNode> }> = {
  target: 'chat',
  create: () => {
    let nodes = new Map<string, ChatConversationViewNode>()
    const snapshot = () => ({ nodes })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

function assembler(events: readonly SessionEvent[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(
    events.map((event): ConversationEventInput => ({ event, view: undefined })),
    false,
  )
  value.flush()
  return value
}

function chatNodes(value: ConversationNodeAssembler): readonly ChatConversationViewNode[] {
  const snapshot = value.snapshot('chat') as { nodes: ReadonlyMap<string, ChatConversationViewNode> }
  return [...snapshot.nodes.values()]
}

describe('whaleTaskBoardDefinition identity', () => {
  it('owns one chat-targeted node kind', () => {
    expect(whaleTaskBoardDefinition.kind).toBe('whale-task-board')
    expect(whaleTaskBoardDefinition.target).toBe('chat')
  })
})

describe('whaleTaskBoardDefinition matching', () => {
  it('matches only the whale/task-board family, keyed by the log seq', () => {
    expect(whaleTaskBoardDefinition.match(boardEvent(7))).toEqual({ id: '7', role: 'start' })
    expect(whaleTaskBoardDefinition.match(otherEvent(8, 'turn/start'))).toBeNull()
  })
})

describe('whaleTaskBoardDefinition folding', () => {
  it('copies the snapshot seq, time, and tasks into the adopted state', () => {
    const event = boardEvent(7)
    const state = whaleTaskBoardDefinition.start(boardContext(), matched(event), { previous: () => undefined })
    expect(state).toEqual({ seq: 7, time: STAMP + 7, tasks: TASKS })
  })

  it('refuses a start match that is not this event family', () => {
    expect(() => whaleTaskBoardDefinition.start(
      boardContext(),
      matched(otherEvent(8, 'turn/start')),
      { previous: () => undefined },
    )).toThrow('whale-task-board requires whale/task-board')
  })

  it('keeps the adopted state for a post-start match', () => {
    const state: BoardState = { seq: 7, time: STAMP + 7, tasks: TASKS }
    const context = boardContext({ state }) as BoardContext & { state: BoardState }
    expect(whaleTaskBoardDefinition.update(context, matched(otherEvent(8, 'turn/start'), 'update'))).toBe(state)
  })

  it('publishes every accepted match immediately', () => {
    expect(whaleTaskBoardDefinition.publication?.(matched(boardEvent(7)))).toBe('immediate')
  })
})

describe('whaleTaskBoardDefinition view node', () => {
  it('materializes the snapshot as one visible chat node anchored at its start event', () => {
    const state: BoardState = { seq: 7, time: STAMP + 7, tasks: TASKS }
    const context = boardContext({
      state,
      start: matched(boardEvent(7)),
      matches: [matched(boardEvent(7))],
    })
    expect(builtNode(context)).toEqual({
      key: '7:whale-task-board7',
      kind: 'whale-task-board',
      id: '7',
      target: 'chat',
      anchorSeq: 7,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data: { tasks: TASKS },
    })
  })

  it('publishes nothing before the start match has produced a state', () => {
    expect(builtNode(boardContext())).toBeNull()
  })

  it('anchors at the first match when the start match is no longer in the window', () => {
    const state: BoardState = { seq: 4, time: STAMP + 4, tasks: TASKS }
    const context = boardContext({ state, matches: [matched(boardEvent(4), 'update')] })
    expect(builtNode(context)?.anchorSeq).toBe(4)
  })

  it('anchors at seq zero when neither the start nor any match survives', () => {
    const state: BoardState = { seq: 4, time: STAMP + 4, tasks: TASKS }
    const context = boardContext({ state })
    expect(builtNode(context)?.anchorSeq).toBe(0)
  })

  it('carries the start match Location into the node', () => {
    const state: BoardState = { seq: 7, time: STAMP + 7, tasks: TASKS }
    const start = { ...matched(boardEvent(7)), location: { kind: 'session' } as const }
    expect(builtNode(boardContext({ state, start }))?.location).toEqual({ kind: 'session' })
  })
})

describe('whaleTaskBoardDefinition through the node assembler', () => {
  it('turns one snapshot event into one chat node carrying the whole task list', () => {
    const nodes = chatNodes(assembler([otherEvent(1, 'turn/start'), boardEvent(3)]))
    expect(nodes).toHaveLength(1)
    const [node] = nodes
    expect(node?.kind).toBe('whale-task-board')
    expect(node?.id).toBe('3')
    expect(node?.anchorSeq).toBe(3)
    expect(node?.data).toEqual({ tasks: TASKS })
  })

  it('replaces the displayed snapshot when a later event arrives', () => {
    const replacement = [task({ id: 't-9', name: 'rotate logs' })]
    const nodes = chatNodes(assembler([boardEvent(3), boardEvent(5, replacement)]))
    expect(nodes).toHaveLength(2)
    expect(nodes.map(node => node.id)).toEqual(['3', '5'])
    expect(nodes[1]?.data).toEqual({ tasks: replacement })
  })

  it('ignores unrelated events entirely', () => {
    expect(chatNodes(assembler([otherEvent(1, 'turn/start'), otherEvent(2, 'step/end')]))).toHaveLength(0)
  })
})
