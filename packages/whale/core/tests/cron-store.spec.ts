/**
 * Cron and task-store contract tests: parsing, timezone-aware next-arrival
 * computation (including a DST zone), store lifecycle over a real JSON
 * storage backend, due detection, and delivery bookkeeping.
 * @module @deepseek-ai/dsh-whale-core/tests/cron-store
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import StoragePlugin from '@deepseek-ai/dsh-storage'
import * as StorageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import { nextRun, parseCron } from '../src/cron.ts'
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
})

describe('whale task store', () => {
  async function booted(): Promise<WhaleTaskStore> {
    const ctx = new Context()
    await ctx.plugin(StoragePlugin)
    await ctx.plugin(StorageJsonPlugin, { root: mkdtempSync(join(tmpdir(), 'whale-core-store-')) })
    await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    ctx.provide('sessions', { get: () => undefined } as never)
    await ctx.plugin(WhaleTaskStore)
    const store = ctx.get('whaleTasks') as WhaleTaskStore
    await store.openDomain()
    return store
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
})
