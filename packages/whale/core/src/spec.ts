/**
 * Durable Whale task records: the zod schema at the storage-domain boundary,
 * the domain spec the registry opens, and the wire view shapes the tools and
 * the task board render from.
 * @module @deepseek-ai/dsh-whale-core/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** One task's schedule: a one-shot instant or a cron expression in one IANA zone. */
export const whaleSchedule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string() }),
  z.object({ kind: z.literal('cron'), expr: z.string() }),
  z.object({ kind: z.literal('manual') }),
])
export type WhaleSchedule = z.infer<typeof whaleSchedule>

/** Durable shape of one scheduled task (ISO-8601 timestamps). */
export const whaleTaskRecord = z.object({
  id: z.string(),
  /** Workspace the task runs in (the session cwd that owns it). */
  workspaceCwd: z.string(),
  /** The HQ session that owns and executes this task. */
  sessionId: z.string(),
  name: z.string(),
  /** The prompt injected into the HQ agent when the task comes due. */
  prompt: z.string(),
  schedule: whaleSchedule,
  status: z.enum(['active', 'paused', 'done']),
  /** Timezone for schedule computations; ISO-8601 in the record, IANA name on the wire. */
  tz: z.string(),
  nextRunAt: z.string(),
  lastRunAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type WhaleTaskRecord = z.infer<typeof whaleTaskRecord>

/** The durable domain: one `tasks` table keyed by task id. */
export const whaleTaskDomainSpec = defineDomain({
  name: 'whale_tasks',
  version: 1,
  tables: { tasks: domainTable<string, WhaleTaskRecord>(whaleTaskRecord) },
})

/** Wire view of one task (the toolbar + tools surface). */
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

/** Project a stored record to the wire view. */
export function taskView(record: WhaleTaskRecord): WhaleTaskView {
  const summary = record.schedule.kind === 'once'
    ? `once at ${record.schedule.at}`
    : record.schedule.kind === 'cron'
      ? `cron "${record.schedule.expr}" in ${record.tz}`
      : 'manual (run with whale_task_run)'
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    scheduleKind: record.schedule.kind,
    scheduleSummary: summary,
    tz: record.tz,
    nextRunAt: record.status === 'active' ? record.nextRunAt : null,
    lastRunAt: record.lastRunAt ?? null,
    workspaceCwd: record.workspaceCwd,
  }
}
