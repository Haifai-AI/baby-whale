/**
 * The durable Whale task store: one storage-domain table (`whale-tasks`)
 * holding every scheduled task, with lifecycle operations, cron/IANA
 * scheduling, due detection, and board snapshot publication to the owning
 * HQ session.
 * @module @deepseek-ai/dsh-whale-core/src/store
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { isValidCron, isValidTimeZone, nextRun, parseCron } from './cron.ts'
import { taskView, whaleTaskDomainSpec } from './spec.ts'
import type { WhaleSchedule, WhaleTaskRecord, WhaleTaskView } from './spec.ts'

/** Input for one new task. */
export interface WhaleTaskInput {
  name: string
  prompt: string
  schedule: WhaleSchedule
  /** IANA timezone for schedule computations; defaults to the caller's zone when omitted. */
  tz?: string
  sessionId: SessionId
  workspaceCwd: string
}

/**
 * The machine's own IANA zone (UTC when it cannot be determined), used when a
 * task is created without an explicit timezone. A hardcoded home zone would
 * silently shift every schedule for users elsewhere.
 */
function defaultTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof zone === 'string' && zone !== '') return zone
  } catch {
    // Fall through to UTC below.
  }
  return 'UTC'
}

/** Compute the first arrival of a schedule strictly after `now`. */
function firstRunAt(schedule: WhaleSchedule, tz: string, now: Date): string {
  switch (schedule.kind) {
    case 'once':
      return schedule.at
    case 'cron': {
      const next = nextRun(parseCron(schedule.expr), tz, now)
      if (next === undefined) throw new Error(`whale task: cron "${schedule.expr}" has no occurrence within the next year`)
      return next.toISOString()
    }
    case 'manual':
      return ''
  }
}

/**
 * The Whale task store service (`ctx.whaleTasks`). Owns the durable table and
 * the scheduling vocabulary; delivery lives in the scheduler plugin.
 */
export class WhaleTaskStore extends Service {
  static inject = ['storageDomain', 'sessions']

  private table: KvTable<string, WhaleTaskRecord> | undefined

  constructor(ctx: Context) {
    super(ctx, 'whaleTasks')
  }

  /**
   * Open the durable domain and hold the table. Called explicitly by the
   * mounting plugin before the scheduler starts: a service constructed in
   * `apply` never runs `Service.init`, so relying on it would leave the store
   * permanently unopened and the first scheduler tick would crash.
   */
  async openDomain(): Promise<void> {
    const domain: Domain<typeof whaleTaskDomainSpec> = await this.ctx.storageDomain.open(whaleTaskDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'whaleTasks.domainClose')
    this.table = domain.table('tasks')
  }

  private requireTable(): KvTable<string, WhaleTaskRecord> {
    if (this.table === undefined) throw new Error('whaleTasks: domain not open yet')
    return this.table
  }

  /**
   * All tasks of one workspace, next-run-first.
   * @param workspaceCwd - workspace to scope to; omitted reads every workspace's tasks.
   * @returns records ordered by ascending `nextRunAt` (a manual task's empty instant sorts first).
   */
  list(workspaceCwd?: string): WhaleTaskRecord[] {
    const records = [...this.requireTable().entries()].map(([, record]) => record)
    const scoped = workspaceCwd === undefined
      ? records
      : records.filter(record => record.workspaceCwd === workspaceCwd)
    return scoped.sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt))
  }

  /**
   * One task by id.
   * @param id - the task's uuid.
   * @returns the record, or undefined when no task carries that id.
   */
  get(id: string): WhaleTaskRecord | undefined {
    return this.requireTable().get(id)
  }

  /**
   * Wire views of one workspace, for tools and the board.
   * @param workspaceCwd - workspace to scope to.
   * @returns views in the same next-run-first order as {@link WhaleTaskStore.list}.
   */
  viewsOf(workspaceCwd: string): WhaleTaskView[] {
    return this.list(workspaceCwd).map(taskView)
  }

  /**
   * Create a task, validating its schedule and computing the first arrival.
   * The owning session's board republishes only after the record is durable,
   * and only when that session is live.
   * @param input - name, prompt, schedule, owning session and workspace, and an
   * optional IANA `tz` (the machine's zone when omitted).
   * @returns the stored record with its generated id.
   * @throws Error when a cron expression is invalid or has no occurrence within
   * the next year, when a one-shot instant is unparsable, or when a scheduled
   * task's explicit `tz` is unknown.
   */
  async create(input: WhaleTaskInput): Promise<WhaleTaskRecord> {
    this.validateSchedule(input.schedule, input.tz)
    const tz = input.tz ?? defaultTimeZone()
    const now = new Date()
    const record: WhaleTaskRecord = {
      id: crypto.randomUUID(),
      workspaceCwd: input.workspaceCwd,
      sessionId: String(input.sessionId),
      name: input.name,
      prompt: input.prompt,
      schedule: input.schedule,
      tz,
      status: 'active',
      nextRunAt: firstRunAt(input.schedule, tz, now),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    await this.requireTable().put(record.id, record)
    this.publishBoard(record.workspaceCwd, record.sessionId)
    return record
  }

  /**
   * Set status (`pause`/`resume`/`done`), recomputing the next run on resume.
   * @param id - the task's uuid.
   * @param status - target status; `active` recomputes `nextRunAt` from the current time, other transitions leave it untouched.
   * @returns the updated record, the unchanged record when the status already matched, or undefined when no task carries that id.
   */
  async setStatus(id: string, status: 'active' | 'paused' | 'done'): Promise<WhaleTaskRecord | undefined> {
    const record = this.requireTable().get(id)
    if (record === undefined) return undefined
    if (record.status === status) return record
    const now = new Date()
    const updated: WhaleTaskRecord = {
      ...record,
      status,
      nextRunAt: status === 'active'
        ? firstRunAt(record.schedule, record.tz, now)
        : record.nextRunAt,
      updatedAt: now.toISOString(),
    }
    await this.requireTable().put(id, updated)
    this.publishBoard(record.workspaceCwd, record.sessionId)
    return updated
  }

  /**
   * Remove a task.
   * @param id - the task's uuid.
   * @returns true when a record was deleted, false when the id was already unknown.
   */
  async remove(id: string): Promise<boolean> {
    const record = this.requireTable().get(id)
    if (record === undefined) return false
    await this.requireTable().delete(id)
    this.publishBoard(record.workspaceCwd, record.sessionId)
    return true
  }

  /**
   * Tasks due at `now` (scheduled, active, non-manual, nextRunAt reached).
   * @param now - the instant to compare against; a task stays due until
   * {@link WhaleTaskStore.markDue} advances it, so a late tick still sees it.
   * @returns due records from every workspace, earliest next run first.
   */
  dueTasks(now: Date): WhaleTaskRecord[] {
    return this.list().filter(record =>
      record.status === 'active'
      && record.schedule.kind !== 'manual'
      && new Date(record.nextRunAt).getTime() <= now.getTime())
  }

  /**
   * Record a delivery: one-shot tasks move to `done`, cron tasks advance to
   * the next arrival, and the board snapshot republishes to the owning session.
   * @param id - the task's uuid.
   * @param now - delivery instant, stored as `lastRunAt` and used as the exclusive lower bound for the next cron arrival.
   * @returns the updated record, or undefined when no task carries that id; a
   * cron task with no arrival within the next year is closed as `done`.
   */
  async markDue(id: string, now: Date): Promise<WhaleTaskRecord | undefined> {
    const record = this.requireTable().get(id)
    if (record === undefined) return undefined
    let updated: WhaleTaskRecord
    if (record.schedule.kind === 'once') {
      updated = {
        ...record,
        status: 'done',
        lastRunAt: now.toISOString(),
        nextRunAt: '',
        updatedAt: now.toISOString(),
      }
    } else if (record.schedule.kind === 'manual') {
      updated = {
        ...record,
        lastRunAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
    } else {
      const next = nextRun(parseCron(record.schedule.expr), record.tz, now)
      if (next === undefined) {
        updated = {
          ...record,
          status: 'done',
          lastRunAt: now.toISOString(),
          nextRunAt: '',
          updatedAt: now.toISOString(),
        }
      } else {
        updated = {
          ...record,
          lastRunAt: now.toISOString(),
          nextRunAt: next.toISOString(),
          updatedAt: now.toISOString(),
        }
      }
    }
    await this.requireTable().put(updated.id, updated)
    this.publishBoard(updated.workspaceCwd, updated.sessionId)
    return updated
  }

  private validateSchedule(schedule: WhaleSchedule, tz: string | undefined): void {
    switch (schedule.kind) {
      case 'cron':
        if (!isValidCron(schedule.expr)) throw new Error(`whale task: invalid cron expression "${schedule.expr}"`)
        break
      case 'once':
        if (Number.isNaN(Date.parse(schedule.at))) throw new Error(`whale task: invalid one-shot time "${schedule.at}"`)
        break
      case 'manual':
        break
    }
    if (schedule.kind !== 'manual' && tz !== undefined && !isValidTimeZone(tz)) {
      throw new Error(`whale task: unknown timezone "${tz}"`)
    }
  }

  /**
   * Publish the whole-workspace board snapshot to the owning HQ session when
   * it is live. A cold session has no board until the next mutation while it
   * is open — the snapshot is log-only UI state.
   */
  private publishBoard(workspaceCwd: string, sessionId: string): void {
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) return
    session.append('whale/task-board', { tasks: this.viewsOf(workspaceCwd) })
  }
}
