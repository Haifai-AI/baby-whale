/**
 * Whale task board: one whole-value session event family (`whale/task-board`
 * snapshots from `@deepseek-ai/dsh-whale-core`) projected into one immutable
 * chat node per snapshot. Log-only UI state — latest write wins on replay.
 * @module @deepseek-ai/dsh-client-ui-whale-tasks/src/client/task-board
 */

import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-whale-core/types'
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Wire view of one task (mirrors `@deepseek-ai/dsh-whale-core`'s WhaleTaskView). */
export interface WhaleTaskView {
  id: string
  name: string
  status: 'active' | 'paused' | 'done'
  scheduleKind: 'once' | 'cron' | 'manual'
  scheduleSummary: string
  tz: string
  nextRunAt: string | null
  lastRunAt: string | null
  workspaceCwd: string
}

interface WhaleTaskBoardState {
  readonly seq: number
  readonly time: number
  readonly tasks: readonly WhaleTaskView[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** One whole-workspace Whale task snapshot. */
    'whale-task-board': { tasks: readonly WhaleTaskView[] }
  }
}

const viewData = (state: WhaleTaskBoardState): { tasks: readonly WhaleTaskView[] } => ({ tasks: state.tasks })

/** The task-board projection: each `whale/task-board` event is one node. */
export const whaleTaskBoardDefinition: ConversationNodeDefinition<WhaleTaskBoardState> = {
  kind: 'whale-task-board',
  target: 'chat',
  match: event => event.type === 'whale/task-board'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'whale/task-board') {
      throw new Error('whale-task-board requires whale/task-board')
    }
    return {
      seq: match.event.seq,
      time: match.event.time,
      tasks: match.event.data.tasks,
    }
  },
  update: context => context.state,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'whale-task-board',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: viewData(context.state),
    }
  },
}
