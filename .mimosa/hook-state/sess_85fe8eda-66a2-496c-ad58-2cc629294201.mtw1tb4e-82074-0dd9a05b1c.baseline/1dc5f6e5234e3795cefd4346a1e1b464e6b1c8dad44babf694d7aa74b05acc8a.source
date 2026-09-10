/**
 * The Whale HQ scheduler: a periodic tick that delivers due tasks into their
 * owning session's live agent through `Agent.followup` — the queued message
 * wakes an idle agent, and markDue advances the record. Sessions with no live
 * agent keep their due tasks until the next tick after the agent returns.
 * @module @deepseek-ai/dsh-whale-core/src/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { WhaleTaskStore } from './store.ts'
import type { WhaleTaskRecord } from './spec.ts'

/** Default scheduler tick; deployments may set `intervalMs` in whale-core config. */
export const DEFAULT_TICK_MS = 60_000

/**
 * Deliver one due task into its owning agent.
 * @param ctx - the plugin context (agents registry).
 * @param task - the due task record.
 * @returns whether a live agent received the task.
 */
export function deliverTask(ctx: Context, task: WhaleTaskRecord): boolean {
  const agent = ctx.agents.get(SessionId(task.sessionId))
  if (agent === undefined) return false
  agent.followup(createUserMessage({
    content: [{
      type: 'text',
      text: `[whale task] ${task.name}\n\n${task.prompt}`,
    }],
    source: { kind: 'plugin', plugin: 'whale-tasks' },
  }))
  return true
}

/**
 * The HQ scheduler: owns the periodic tick over the Whale task store and
 * delivers due tasks to their live owning agents.
 */
export class WhaleTaskScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false

  constructor(
    private readonly ctx: Context,
    private readonly store: WhaleTaskStore,
    private readonly intervalMs: number,
  ) {}

  /** Start the tick loop (dispose stops it). */
  start(): void {
    const timer = setInterval(() => { void this.tick() }, this.intervalMs)
    // The scheduler must never keep the process alive on its own: disposal
    // (plugin unload, shutdown) owns the lifetime, not the interval.
    if (typeof timer.unref === 'function') timer.unref()
    this.timer = timer
  }

  /** Stop the tick loop. */
  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Deliver every currently due task, advancing each delivered record. Ticks
   * never overlap (a slow store cannot double-deliver), and one task's
   * failure never skips its siblings — the failed task simply stays due for
   * the next tick.
   */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const task of this.store.dueTasks(new Date())) {
        try {
          if (deliverTask(this.ctx, task)) {
            await this.store.markDue(task.id, new Date())
          }
        } catch {
          // Leave the task due; the next tick retries it.
        }
      }
    } finally {
      this.ticking = false
    }
  }
}
