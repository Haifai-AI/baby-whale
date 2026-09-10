/**
 * Whale core: the durable scheduled-task layer. Provides `ctx.whaleTasks`
 * (the storage-domain-backed store), the HQ scheduler that delivers due tasks
 * into their owning session's live agent, the model-facing whale_task_* tools,
 * and the task-board snapshot events the Web board renders from.
 * @module @deepseek-ai/dsh-whale-core
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-session/types'
import { WhaleTaskStore } from './store.ts'
import { DEFAULT_TICK_MS, WhaleTaskScheduler } from './runtime.ts'
import { applyWhaleTaskTools } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'whale-core'

/** Services required by the store, scheduler, and tools. */
export const inject = ['storageDomain', 'tools', 'systemPrompt', 'agents', 'sessions']

/** Plugin config. */
export interface Config {
  /** HQ scheduler tick interval in milliseconds. */
  intervalMs?: number
}

export const Config: z<Config> = z.object({
  intervalMs: z.number().min(1000).default(DEFAULT_TICK_MS),
})

/**
 * Mount the Whale task layer: the store service, the HQ scheduler, and the
 * model-facing tools. All registrations are effects scoped to this plugin.
 * @param ctx - the plugin context.
 * @param config - validated plugin config (schemastery filled the defaults).
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery has already filled every defaulted field.
  const resolved = config as Required<Config>
  const store = new WhaleTaskStore(ctx)
  const scheduler = new WhaleTaskScheduler(ctx, store, resolved.intervalMs)
  // Open the domain BEFORE the tick loop starts; an unopened store at the
  // first tick is a fatal load failure.
  ctx.effect(async () => {
    await store.openDomain()
    scheduler.start()
    return () => { scheduler.dispose() }
  }, 'whaleTasks.scheduler')
  applyWhaleTaskTools(ctx)
}
