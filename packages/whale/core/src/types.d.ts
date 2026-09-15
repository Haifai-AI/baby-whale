/**
 * Durable session-log surface of the Whale task board: a whole-value snapshot
 * of a workspace's tasks, appended to the owning HQ session after every task
 * mutation and every delivery. Like `todo/write`, this is log-only UI state —
 * latest write wins on replay, and it never derives history.
 * @module @deepseek-ai/dsh-whale-core/src/types
 */
/**
 * Wire view of one task (the board payload). The shape is duplicated here,
 * not imported from `./spec.ts`, because this module is the cross-project
 * event contract: client aggregates resolve it through a path mapping and
 * must not pull host source files past their rootDir.
 */
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
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
         * Whole-list task snapshot for the owning session's workspace, after every
         * task mutation or delivery. Log-only UI state; never a history source.
         * @param data - the complete task board of the owning workspace.
         */
    'whale/task-board': {
      tasks: WhaleTaskView[]
    }
  }
}
//# sourceMappingURL=types.d.ts.map
