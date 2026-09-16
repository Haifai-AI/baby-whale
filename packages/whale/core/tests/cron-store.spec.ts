/**
 * Cron and task-store contract tests: parsing, timezone-aware next-arrival
 * computation (including a DST zone), store lifecycle over a real JSON
 * storage backend, due detection, and delivery bookkeeping.
 * @module @deepseek-ai/dsh-whale-core/tests/cron-store
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import StoragePlugin from '@deepseek-ai/dsh-storage'
import * as StorageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import { isValidCron, nextRun, parseCron } from '../src/cron.ts'
import { taskView } from '../src/spec.ts'
import type { WhaleTaskRecord } from '../src/spec.ts'
import { WhaleTaskStore } from '../src/store.ts'

const root = mkdtempSync(join(tmpdir(), 'whale-core-'))
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('cron', () => {
  it('parses the five fields with lists, ranges, and steps', () => {
    const expr = parseCron('*/15 9-17 * * 1-5')
    expect(expr.minute).toEqual([0, 15, 30, 45])
    expect(expr.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(expr.dom).toHaveLength(31)
    expect(expr.dom[0]).toBe(1)
    expect(expr.dom[30]).toBe(31)
    expect(expr.dow).toEqual([1, 2, 3, 4, 5])
  })

  it('normalizes Sunday as 7 to 0', () => {
    expect(parseCron('0 9 * * 7').dow).toEqual([0])
  })

  it('rejects malformed fields', () => {
    expect(() => parseCron('61 0 * * *')).toThrow()
    expect(() => parseCron('0 0 * *')).toThrow()
    expect(() => parseCron('* * * * * *')).toThrow()
  })

  it('computes the next run in Asia/Shanghai (+08:00)', () => {
    const from = new Date('2026-08-26T00:00:00.000Z')
    const next = nextRun(parseCron('0 9 * * *'), 'Asia/Shanghai', from)
    expect(next?.toISOString()).toBe('2026-08-26T01:00:00.000Z')
  })

  it('skips non-matching weekdays', () => {
    // 2026-08-26 is a Wednesday. Mondays only → next Monday (2026-08-31).
    const from = new Date('2026-08-26T00:00:00.000Z')
    const next = nextRun(parseCron('0 9 * * 1'), 'Asia/Shanghai', from)
    expect(next?.toISOString()).toBe('2026-08-31T01:00:00.000Z')
  })

  it('handles the DST zone America/New_York across the fall transition', () => {
    // 09:00 local on Nov 2 is 14:00Z (EST), one day after the fall-back.
    const next = nextRun(parseCron('0 9 * * *'), 'America/New_York', new Date('2026-11-01T14:00:00.000Z'))
    expect(next?.toISOString()).toBe('2026-11-02T14:00:00.000Z')
  })

  it('rejects unknown timezones', () => {
    expect(() => nextRun(parseCron('* * * * *'), 'Not/AZone', new Date())).toThrow()
  })

  it('rejects a zero step', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(/invalid step/)
  })

  it('rejects a range whose bounds leave the field', () => {
    expect(() => parseCron('60-70 * * * *')).toThrow(/range 60-70 outside 0-59 for minute/)
    expect(() => parseCron('0 0 0-5 * *')).toThrow(/range 0-5 outside 1-31 for dom/)
  })

  it('rejects a range bound that is not a number', () => {
    expect(() => parseCron('1-x * * * *')).toThrow(/invalid range "1-x"/)
  })

  it('rejects a single value outside the field', () => {
    expect(() => parseCron('70 * * * *')).toThrow(/value 70 outside 0-59 for minute/)
  })

  it('reports validity instead of throwing on malformed expressions', () => {
    expect(isValidCron('0 9 * * 1-5')).toBe(true)
    expect(isValidCron('nope')).toBe(false)
  })

  it('gives up when no occurrence falls inside the one-year horizon', () => {
    expect(nextRun(parseCron('0 0 30 2 *'), 'UTC', new Date('2026-08-26T00:00:00.000Z'))).toBeUndefined()
  })

  it('lands a wall time inside the spring-forward gap on the closest instant', () => {
    // 02:30 does not exist on 2026-03-08 in New York; the estimate converges to
    // the first representable instant after the skipped hour.
    const next = nextRun(parseCron('30 2 * * *'), 'America/New_York', new Date('2026-03-08T00:00:00.000Z'))
    expect(next?.toISOString()).toBe('2026-03-08T08:30:00.000Z')
  })
})

describe('whale task view', () => {
  function record(overrides: Partial<WhaleTaskRecord> = {}): WhaleTaskRecord {
    return {
      id: 'task-1',
      workspaceCwd: '/tmp/ws',
      sessionId: 'hq-session',
      name: 'daily brief',
      prompt: 'Summarize yesterday.',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      status: 'active',
      tz: 'Asia/Shanghai',
      nextRunAt: '2026-08-27T01:00:00.000Z',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
      ...overrides,
    }
  }

  it('summarizes a cron schedule with its timezone', () => {
    expect(taskView(record())).toMatchObject({
      scheduleKind: 'cron',
      scheduleSummary: 'cron "0 9 * * *" in Asia/Shanghai',
      nextRunAt: '2026-08-27T01:00:00.000Z',
      lastRunAt: null,
    })
  })

  it('summarizes a one-shot schedule with its instant', () => {
    const view = taskView(record({ schedule: { kind: 'once', at: '2026-09-01T00:00:00.000Z' } }))
    expect(view.scheduleSummary).toBe('once at 2026-09-01T00:00:00.000Z')
  })

  it('summarizes a manual schedule as run-on-demand', () => {
    const view = taskView(record({ schedule: { kind: 'manual' } }))
    expect(view.scheduleSummary).toBe('manual (run with whale_task_run)')
  })

  it('withholds the next run from a task that is not active', () => {
    expect(taskView(record({ status: 'paused' })).nextRunAt).toBeNull()
    expect(taskView(record({ status: 'done' })).nextRunAt).toBeNull()
  })

  it('reports the last run once the task has run', () => {
    expect(taskView(record({ lastRunAt: '2026-08-26T01:00:00.000Z' })).lastRunAt).toBe('2026-08-26T01:00:00.000Z')
  })
})

describe('whale task store', () => {
  interface BootOptions {
    /** Open the durable domain (default true); false leaves the store unopened. */
    open?: boolean
    /** Live session the store publishes board snapshots to. */
    session?: { append(event: string, payload: unknown): void }
  }

  async function boot(options: BootOptions = {}): Promise<{ store: WhaleTaskStore; ctx: Context; fiber: Fiber }> {
    const ctx = new Context()
    await ctx.plugin(StoragePlugin)
    await ctx.plugin(StorageJsonPlugin, { root: mkdtempSync(join(tmpdir(), 'whale-core-store-')) })
    await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    ctx.provide('sessions', { get: () => options.session } as never)
    const fiber = await ctx.plugin(WhaleTaskStore)
    const store = ctx.get('whaleTasks') as WhaleTaskStore
    if (options.open !== false) await store.openDomain()
    return { store, ctx, fiber }
  }

  async function booted(options: BootOptions = {}): Promise<WhaleTaskStore> {
    return (await boot(options)).store
  }

  /** Create input for one task, with per-test overrides. */
  function input(overrides: Partial<Parameters<WhaleTaskStore['create']>[0]> = {}): Parameters<WhaleTaskStore['create']>[0] {
    return {
      name: 'daily brief',
      prompt: 'Summarize yesterday.',
      schedule: { kind: 'cron', expr: '0 9 * * 1-5' },
      tz: 'Asia/Shanghai',
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/ws',
      ...overrides,
    }
  }

  it('persists a cron task with a future run and survives listing', async () => {
    const store = await booted()
    const record = await store.create({
      name: 'daily brief',
      prompt: 'Summarize yesterday.',
      schedule: { kind: 'cron', expr: '0 9 * * 1-5' },
      tz: 'Asia/Shanghai',
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/ws',
    })
    expect(record.status).toBe('active')
    expect(new Date(record.nextRunAt).getTime()).toBeGreaterThan(Date.now())
    expect(store.list('/tmp/ws')).toHaveLength(1)
  })

  it('defaults an omitted timezone to the machine zone', async () => {
    const store = await booted()
    const record = await store.create({
      name: 'no-tz',
      prompt: 'Run whenever.',
      schedule: { kind: 'cron', expr: '0 9 * * 1-5' },
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/ws',
    })
    let expected = 'UTC'
    try {
      expected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      // Keep the UTC fallback.
    }
    expect(record.tz).toBe(expected)
  })

  it('marks a due once-task as done after delivery and removes it', async () => {
    const store = await booted()
    const record = await store.create({
      name: 'ping',
      prompt: 'Ping me.',
      schedule: { kind: 'once', at: '2020-01-01T00:00:00.000Z' },
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/ws',
    })
    expect(store.dueTasks(new Date('2026-08-26T00:00:00.000Z')).map(task => task.id)).toContain(record.id)
    const after = await store.markDue(record.id, new Date('2026-08-26T00:00:00.000Z'))
    expect(after?.status).toBe('done')
    expect(store.dueTasks(new Date('2026-08-26T00:00:00.000Z'))).toHaveLength(0)
    expect(await store.remove(record.id)).toBe(true)
    expect(store.get(record.id)).toBeUndefined()
  })

  it('pauses and resumes a task, recomputing the next run', async () => {
    const store = await booted()
    const record = await store.create({
      name: 'hourly',
      prompt: 'tick',
      schedule: { kind: 'cron', expr: '0 * * * *' },
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/ws',
    })
    const paused = await store.setStatus(record.id, 'paused')
    expect(paused?.status).toBe('paused')
    expect(store.dueTasks(new Date('2040-01-01T00:00:00.000Z'))).toHaveLength(0)
    const resumed = await store.setStatus(record.id, 'active')
    expect(resumed?.status).toBe('active')
    expect(new Date(resumed!.nextRunAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('refuses every operation before the durable domain is open', async () => {
    const store = await booted({ open: false })
    expect(() => store.list()).toThrow(/domain not open yet/)
    expect(() => store.get('any')).toThrow(/domain not open yet/)
    await expect(store.create(input())).rejects.toThrow(/domain not open yet/)
    await expect(store.setStatus('any', 'paused')).rejects.toThrow(/domain not open yet/)
    await expect(store.remove('any')).rejects.toThrow(/domain not open yet/)
    await expect(store.markDue('any', new Date())).rejects.toThrow(/domain not open yet/)
  })

  it('orders tasks by their next run', async () => {
    const store = await booted()
    const later = await store.create(input({ name: 'later', schedule: { kind: 'once', at: '2030-01-01T00:00:00.000Z' } }))
    const sooner = await store.create(input({ name: 'sooner', schedule: { kind: 'once', at: '2027-01-01T00:00:00.000Z' } }))
    expect(store.list('/tmp/ws').map(task => task.id)).toEqual([sooner.id, later.id])
    expect(store.viewsOf('/tmp/ws').map(view => view.name)).toEqual(['sooner', 'later'])
  })

  it('lists every workspace when no workspace filter is given', async () => {
    const store = await booted()
    await store.create(input({ workspaceCwd: '/tmp/one' }))
    await store.create(input({ workspaceCwd: '/tmp/two' }))
    expect(store.list()).toHaveLength(2)
  })

  it('rejects an invalid cron expression', async () => {
    const store = await booted()
    await expect(store.create(input({ schedule: { kind: 'cron', expr: 'nope' } }))).rejects.toThrow(/invalid cron expression "nope"/)
  })

  it('rejects a one-shot time it cannot parse', async () => {
    const store = await booted()
    await expect(store.create(input({ schedule: { kind: 'once', at: 'tomorrow-ish' } }))).rejects.toThrow(/invalid one-shot time "tomorrow-ish"/)
  })

  it('rejects an unknown timezone', async () => {
    const store = await booted()
    await expect(store.create(input({ tz: 'Not/AZone' }))).rejects.toThrow(/unknown timezone "Not\/AZone"/)
  })

  it('refuses a cron schedule with no arrival inside the year', async () => {
    const store = await booted()
    await expect(store.create(input({ schedule: { kind: 'cron', expr: '0 0 30 2 *' }, tz: 'UTC' })))
      .rejects.toThrow(/has no occurrence within the next year/)
  })

  it('creates a manual task with no scheduled arrival', async () => {
    const store = await booted()
    const record = await store.create({
      name: 'on demand',
      prompt: 'Run when asked.',
      schedule: { kind: 'manual' },
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/ws',
    })
    expect(record.nextRunAt).toBe('')
    expect(store.dueTasks(new Date('2040-01-01T00:00:00.000Z'))).toHaveLength(0)
  })

  it('falls back to UTC when the machine reports no timezone', async () => {
    const store = await booted()
    const original = Intl.DateTimeFormat
    Intl.DateTimeFormat = function () {
      return { resolvedOptions: () => ({ timeZone: '' }) }
    } as unknown as typeof Intl.DateTimeFormat
    try {
      const record = await store.create({
        name: 'on demand',
        prompt: 'Run when asked.',
        schedule: { kind: 'manual' },
        sessionId: SessionId('hq-session'),
        workspaceCwd: '/tmp/ws',
      })
      expect(record.tz).toBe('UTC')
    } finally {
      Intl.DateTimeFormat = original
    }
  })

  it('falls back to UTC when the machine timezone cannot be read', async () => {
    const store = await booted()
    const original = Intl.DateTimeFormat
    Intl.DateTimeFormat = function () {
      return { resolvedOptions: () => { throw new Error('no zone data') } }
    } as unknown as typeof Intl.DateTimeFormat
    try {
      const record = await store.create({
        name: 'on demand',
        prompt: 'Run when asked.',
        schedule: { kind: 'manual' },
        sessionId: SessionId('hq-session'),
        workspaceCwd: '/tmp/ws',
      })
      expect(record.tz).toBe('UTC')
    } finally {
      Intl.DateTimeFormat = original
    }
  })

  it('reports an unknown task id as nothing to act on', async () => {
    const store = await booted()
    expect(store.get('missing')).toBeUndefined()
    expect(await store.setStatus('missing', 'paused')).toBeUndefined()
    expect(await store.remove('missing')).toBe(false)
    expect(await store.markDue('missing', new Date())).toBeUndefined()
  })

  it('leaves a task untouched when its status is already the requested one', async () => {
    const store = await booted()
    const record = await store.create(input())
    expect(await store.setStatus(record.id, 'active')).toEqual(record)
  })

  it('records a manual run without scheduling a next one', async () => {
    const store = await booted()
    const record = await store.create({
      name: 'on demand',
      prompt: 'Run when asked.',
      schedule: { kind: 'manual' },
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/ws',
    })
    const after = await store.markDue(record.id, new Date('2026-08-26T00:00:00.000Z'))
    expect(after).toMatchObject({ status: 'active', lastRunAt: '2026-08-26T00:00:00.000Z', nextRunAt: '' })
  })

  it('advances a delivered cron task to its next arrival', async () => {
    const store = await booted()
    const record = await store.create(input({ schedule: { kind: 'cron', expr: '0 * * * *' }, tz: 'UTC' }))
    const after = await store.markDue(record.id, new Date('2026-08-26T00:00:00.000Z'))
    expect(after).toMatchObject({
      status: 'active',
      lastRunAt: '2026-08-26T00:00:00.000Z',
      nextRunAt: '2026-08-26T01:00:00.000Z',
    })
  })

  it('retires a cron task once its next leap-day arrival leaves the horizon', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2096-02-01T00:00:00.000Z'))
      const store = await booted()
      const record = await store.create(input({ name: 'leap day', schedule: { kind: 'cron', expr: '0 0 29 2 *' }, tz: 'UTC' }))
      expect(record.nextRunAt).toBe('2096-02-29T00:00:00.000Z')
      // The following leap day is 2104-02-29 — 2100 is not a leap year — so no
      // arrival remains inside the scheduler's one-year search.
      const after = await store.markDue(record.id, new Date('2096-02-29T00:00:00.000Z'))
      expect(after).toMatchObject({ status: 'done', nextRunAt: '', lastRunAt: '2096-02-29T00:00:00.000Z' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes the workspace board snapshot to the owning session', async () => {
    const appended: Array<{ event: string; payload: unknown }> = []
    const store = await booted({
      session: { append: (event, payload) => { appended.push({ event, payload }) } },
    })
    const record = await store.create(input())
    expect(appended).toEqual([{
      event: 'whale/task-board',
      payload: { tasks: [expect.objectContaining({ id: record.id, name: 'daily brief' })] },
    }])
  })

  it('closes the durable domain when the composition unloads', async () => {
    const { store, ctx } = await boot()
    await store.create(input())
    await ctx.fiber.dispose()
    expect(() => store.list()).toThrow(/closed/)
  })
})
