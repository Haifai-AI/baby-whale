/**
 * Whale HQ scheduler behavior tests: delivery of a due task into its live
 * owning agent, the tick loop's non-overlap and failure containment, and the
 * loop's lifetime under disposal.
 * @module @deepseek-ai/dsh-whale-core/tests/scheduler
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import StoragePlugin from '@deepseek-ai/dsh-storage'
import * as StorageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import type { WhaleTaskRecord } from '../src/spec.ts'
import { WhaleTaskStore } from '../src/store.ts'
import { deliverTask } from '../src/runtime.ts'
import { WhaleTaskScheduler } from '../src/runtime.ts'

const ROOT = mkdtempSync(join(tmpdir(), 'whale-scheduler-'))
afterAll(() => { rmSync(ROOT, { recursive: true, force: true }) })

/** One delivered message captured from a fake agent. */
interface Followup {
  readonly content: Array<{ type: string; text?: string }>
  readonly source?: unknown
}

/** A context whose `agents` registry serves the sessions registered live. */
function agentContext(live: Map<string, Followup[]>): Context {
  const ctx = new Context()
  ctx.provide('agents', {
    get: (id: unknown) => {
      const sessionId = String(id)
      if (!live.has(sessionId)) return undefined
      return {
        followup: (message: { content: Followup['content']; source?: unknown }) => {
          live.get(sessionId)?.push({ content: message.content, source: message.source })
        },
      }
    },
  } as never)
  return ctx
}

async function storeOf(): Promise<WhaleTaskStore> {
  const ctx = new Context()
  await ctx.plugin(StoragePlugin)
  await ctx.plugin(StorageJsonPlugin, { root: mkdtempSync(join(ROOT, 'store-')) })
  await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
  ctx.provide('sessions', { get: () => undefined } as never)
  await ctx.plugin(WhaleTaskStore)
  const store = ctx.get('whaleTasks') as WhaleTaskStore
  await store.openDomain()
  return store
}

async function dueTask(store: WhaleTaskStore, name: string, sessionId = 'hq-session'): Promise<WhaleTaskRecord> {
  return store.create({
    name,
    prompt: `Run ${name}.`,
    schedule: { kind: 'once', at: '2020-01-01T00:00:00.000Z' },
    tz: 'UTC',
    sessionId: SessionId(sessionId),
    workspaceCwd: '/tmp/ws',
  })
}

describe('whale task delivery', () => {
  it('queues the task prompt into its live owning agent', () => {
    const live = new Map<string, Followup[]>([['hq-session', []]])
    const ctx = agentContext(live)
    const record = { name: 'daily brief', prompt: 'Summarize yesterday.', sessionId: 'hq-session' } as WhaleTaskRecord
    expect(deliverTask(ctx, record)).toBe(true)
    expect(live.get('hq-session')).toEqual([{
      content: [{ type: 'text', text: '[whale task] daily brief\n\nSummarize yesterday.' }],
      source: { kind: 'plugin', plugin: 'whale-tasks' },
    }])
  })

  it('reports no delivery when the owning session has no live agent', () => {
    const ctx = agentContext(new Map())
    const record = { name: 'daily brief', prompt: 'Summarize yesterday.', sessionId: 'cold-session' } as WhaleTaskRecord
    expect(deliverTask(ctx, record)).toBe(false)
  })
})

describe('whale task scheduler', () => {
  it('delivers every due task on its tick and advances the delivered record', async () => {
    const store = await storeOf()
    const live = new Map<string, Followup[]>([['hq-session', []]])
    const ctx = agentContext(live)
    const record = await dueTask(store, 'ping')
    const scheduler = new WhaleTaskScheduler(ctx, store, 60_000)
    await scheduler.tick()
    expect(live.get('hq-session')).toHaveLength(1)
    expect(store.get(record.id)).toMatchObject({ status: 'done' })
  })

  it('leaves a due task untouched while its session has no live agent', async () => {
    const store = await storeOf()
    const ctx = agentContext(new Map())
    const record = await dueTask(store, 'ping')
    await new WhaleTaskScheduler(ctx, store, 60_000).tick()
    expect(store.get(record.id)).toMatchObject({ status: 'active' })
    expect(store.dueTasks(new Date())).toHaveLength(1)
  })

  it('never overlaps a tick with one already running', async () => {
    const store = await storeOf()
    const record = await dueTask(store, 'ping')
    const releases: Array<() => void> = []
    const slow = {
      dueTasks: () => store.dueTasks(new Date()),
      markDue: () => new Promise<void>((resolve) => { releases.push(resolve) }),
    } as unknown as WhaleTaskStore
    const scheduler = new WhaleTaskScheduler(agentContext(new Map([['hq-session', []]])), slow, 60_000)
    const first = scheduler.tick()
    const second = scheduler.tick()
    await second
    // The overlapping call returned without consulting the store a second time.
    expect(releases).toHaveLength(1)
    releases.forEach((release) => { release() })
    await first
    expect(record.status).toBe('active')
  })

  it('leaves a task due when recording its delivery fails, and retries on the next tick', async () => {
    const store = await storeOf()
    const record = await dueTask(store, 'ping')
    let attempts = 0
    const failing = {
      dueTasks: () => store.dueTasks(new Date()),
      markDue: (id: string, now: Date) => {
        attempts += 1
        if (attempts === 1) return Promise.reject(new Error('store unavailable'))
        return store.markDue(id, now)
      },
    } as unknown as WhaleTaskStore
    const scheduler = new WhaleTaskScheduler(agentContext(new Map([['hq-session', []]])), failing, 60_000)
    await scheduler.tick()
    expect(store.get(record.id)).toMatchObject({ status: 'active' })
    await scheduler.tick()
    expect(store.get(record.id)).toMatchObject({ status: 'done' })
  })
})

describe('whale task scheduler lifetime', () => {
  it('delivers due tasks on the interval until disposed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const store = await storeOf()
      const live = new Map<string, Followup[]>()
      const ctx = agentContext(live)
      const record = await dueTask(store, 'ping')
      const scheduler = new WhaleTaskScheduler(ctx, store, 60_000)
      scheduler.start()
      live.set('hq-session', [])
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.waitFor(() => { expect(store.get(record.id)).toMatchObject({ status: 'done' }) })
      expect(live.get('hq-session')).toHaveLength(1)
      scheduler.dispose()
      await store.setStatus(record.id, 'active')
      await vi.advanceTimersByTimeAsync(600_000)
      expect(live.get('hq-session')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('disposes safely without a started loop', () => {
    const scheduler = new WhaleTaskScheduler(agentContext(new Map()), {} as WhaleTaskStore, 60_000)
    expect(() => { scheduler.dispose() }).not.toThrow()
  })

  it('keeps ticking when the platform timer cannot be unrefed', async () => {
    const store = await storeOf()
    const record = await dueTask(store, 'ping')
    let installed: (() => void) | undefined
    vi.stubGlobal('setInterval', (callback: () => void) => {
      installed = callback
      return { unref: undefined }
    })
    try {
      const scheduler = new WhaleTaskScheduler(agentContext(new Map([['hq-session', []]])), store, 60_000)
      scheduler.start()
      expect(installed).toBeDefined()
      installed?.()
      await vi.waitFor(() => { expect(store.get(record.id)).toMatchObject({ status: 'done' }) })
      scheduler.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
