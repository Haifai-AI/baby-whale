/**
 * Whale task tool behavior tests: the model-facing whale_task_* tools over a
 * real durable store — creation from the calling session workspace, listing,
 * pause/resume/remove/run, their presentation, and the plugin composition.
 * @module @deepseek-ai/dsh-whale-core/tests/whale-tools
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import StoragePlugin from '@deepseek-ai/dsh-storage'
import * as StorageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as WhaleCore from '../src/index.ts'
import { DEFAULT_TICK_MS } from '../src/runtime.ts'
import { WhaleTaskStore } from '../src/store.ts'
import type { WhaleTaskView } from '../src/spec.ts'
import { applyWhaleTaskTools } from '../src/tools.ts'

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'whale-tools-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

/** The parts of a registered tool these tests drive. */
interface CapturedTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
  presentCall?(args: unknown): unknown
  presentResult?(args: unknown, result: unknown): unknown
  readonly output: {
    render(args: unknown, value: unknown): unknown
    presentationMeta?(args: unknown, value: unknown): unknown
  }
}

/** One message queued into a fake agent by the scheduler's delivery. */
interface Followup {
  readonly content: Array<{ type: string; text?: string }>
}

interface Composition {
  readonly ctx: Context
  readonly store: WhaleTaskStore
  readonly sections: Array<{ name: string; text: string }>
  readonly live: Map<string, Followup[]>
  tool(name: string): CapturedTool
}

/** One tool execution as the tool-under-test sees it. */
function execution(args: unknown, cwd?: string): ToolExecution {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: 't',
    name: 'whale_task',
    arguments: args,
    signal: new AbortController().signal,
    ...cwd === undefined ? {} : {
      agent: { session: { id: SessionId('hq-session'), header: { cwd } } },
    },
  } as unknown as ToolExecution
}

/** Boot whale-core over a real storage backend and fake tool/prompt registries. */
async function composition(config: WhaleCore.Config = {}): Promise<Composition> {
  const ctx = new Context()
  await ctx.plugin(StoragePlugin)
  await ctx.plugin(StorageJsonPlugin, { root: mkdtempSync(join(ROOT_BASE, 'store-')) })
  await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
  const tools = new Map<string, CapturedTool>()
  const sections: Array<{ name: string; text: string }> = []
  const live = new Map<string, Followup[]>()
  ctx.provide('sessions', { get: () => undefined } as never)
  ctx.provide('agents', {
    get: (id: unknown) => {
      const sessionId = String(id)
      if (!live.has(sessionId)) return undefined
      return {
        followup: (message: Followup) => { live.get(sessionId)?.push(message) },
      }
    },
  } as never)
  ctx.provide('systemPrompt', {
    section: (entry: { name: string; text: string }) => { sections.push(entry) },
  } as never)
  ctx.provide('tools', {
    register: (tool: CapturedTool) => {
      tools.set(tool.name, tool)
      return () => {}
    },
  } as never)
  await ctx.plugin(WhaleCore, config)
  const store = ctx.get('whaleTasks') as WhaleTaskStore
  // The plugin opens the durable domain in its mount effect.
  await vi.waitFor(() => { store.list() })
  return {
    ctx,
    store,
    sections,
    live,
    tool: (name: string) => {
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`${name} was not registered`)
      return tool
    },
  }
}

/** Boot the tools alone, without the store service they resolve lazily. */
function compositionWithoutStore(): Map<string, CapturedTool> {
  const ctx = new Context()
  const tools = new Map<string, CapturedTool>()
  ctx.provide('systemPrompt', { section: () => {} } as never)
  ctx.provide('tools', {
    register: (tool: CapturedTool) => {
      tools.set(tool.name, tool)
      return () => {}
    },
  } as never)
  applyWhaleTaskTools(ctx)
  return tools
}

/** Create one task through the model-facing tool. */
async function created(harness: Composition, args: Record<string, unknown>): Promise<WhaleTaskView> {
  const result = await harness.tool('whale_task_create').execute(
    { name: 'daily brief', prompt: 'Summarize yesterday.', ...args },
    execution(args, '/tmp/ws'),
  ) as { ok: boolean; task: WhaleTaskView }
  expect(result.ok).toBe(true)
  return result.task
}

describe('whale_task_create', () => {
  it('schedules a cron task in the calling session workspace with its timezone', async () => {
    const harness = await composition()
    const task = await created(harness, { schedule: { kind: 'cron', expr: '0 9 * * 1-5', tz: 'Asia/Shanghai' } })
    expect(task).toMatchObject({
      name: 'daily brief',
      status: 'active',
      scheduleKind: 'cron',
      scheduleSummary: 'cron "0 9 * * 1-5" in Asia/Shanghai',
      tz: 'Asia/Shanghai',
      workspaceCwd: '/tmp/ws',
    })
    expect(harness.store.get(task.id)).toMatchObject({ sessionId: 'hq-session', prompt: 'Summarize yesterday.' })
  })

  it('defaults a cron task without a timezone to the machine zone', async () => {
    const harness = await composition()
    const task = await created(harness, { schedule: { kind: 'cron', expr: '0 9 * * *' } })
    expect(task.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('schedules a one-shot task with no timezone of its own', async () => {
    const harness = await composition()
    const task = await created(harness, { schedule: { kind: 'once', at: '2027-01-01T00:00:00.000Z' } })
    expect(task.scheduleSummary).toBe('once at 2027-01-01T00:00:00.000Z')
    expect(harness.store.dueTasks(new Date('2027-01-01T00:00:00.000Z')).map(record => record.id)).toEqual([task.id])
  })

  it('schedules a manual task that waits for an explicit run', async () => {
    const harness = await composition()
    const task = await created(harness, { schedule: { kind: 'manual' } })
    expect(task.scheduleSummary).toBe('manual (run with whale_task_run)')
    expect(task.nextRunAt).toBe('')
  })

  it('refuses a one-shot schedule without a time and a cron schedule without an expression', async () => {
    const harness = await composition()
    const create = harness.tool('whale_task_create')
    await expect(create.execute(
      { name: 'ping', prompt: 'Ping me.', schedule: { kind: 'once' } },
      execution({}, '/tmp/ws'),
    )).rejects.toThrow('whale task once schedule requires "at"')
    await expect(create.execute(
      { name: 'ping', prompt: 'Ping me.', schedule: { kind: 'cron' } },
      execution({}, '/tmp/ws'),
    )).rejects.toThrow('whale task cron schedule requires "expr"')
  })

  it('reports an uncomposted tool row when no whale task store is mounted', async () => {
    const create = compositionWithoutStore().get('whale_task_create')
    await expect(create?.execute(
      { name: 'ping', prompt: 'Ping me.', schedule: { kind: 'manual' } },
      execution({}, '/tmp/ws'),
    )).rejects.toThrow('whale tasks are unavailable in this composition')
  })

  it('refuses a call with no session workspace', async () => {
    const harness = await composition()
    await expect(harness.tool('whale_task_create').execute(
      { name: 'ping', prompt: 'Ping me.', schedule: { kind: 'manual' } },
      execution({}),
    )).rejects.toThrow('whale tasks require a session workspace')
  })

  it('renders the scheduled task and presents its schedule as raw input', async () => {
    const harness = await composition()
    const create = harness.tool('whale_task_create')
    const view: WhaleTaskView = {
      id: 'task-1',
      name: 'daily brief',
      status: 'active',
      scheduleKind: 'cron',
      scheduleSummary: 'cron "0 9 * * 1-5" in Asia/Shanghai',
      tz: 'Asia/Shanghai',
      nextRunAt: '2026-08-27T01:00:00.000Z',
      lastRunAt: null,
      workspaceCwd: '/tmp/ws',
    }
    expect(create.output.render({}, { ok: true, task: view })).toEqual([{
      type: 'text',
      text: 'Task "daily brief" scheduled (cron "0 9 * * 1-5" in Asia/Shanghai).',
    }])
    expect(create.output.presentationMeta?.({}, { ok: true, task: view })).toEqual({ task: view })
    expect(create.presentCall?.({ name: 'daily brief', prompt: 'p', schedule: { kind: 'manual' } })).toEqual({
      card: 'generic',
      title: 'Schedule whale task "daily brief"',
      kind: 'other',
      rawInput: { kind: 'manual' },
    })
    const scheduled = { name: 'daily brief', prompt: 'p', schedule: { kind: 'manual' as const } }
    expect(create.presentResult?.(scheduled, { isError: false })).toEqual({
      card: 'generic',
      title: 'Scheduled "daily brief"',
    })
    expect(create.presentResult?.(scheduled, { isError: true })).toBeUndefined()
  })
})

describe('whale_task_list', () => {
  it('lists the tasks of the calling workspace and hides finished ones', async () => {
    const harness = await composition()
    const pending = await created(harness, { name: 'pending', schedule: { kind: 'manual' } })
    const finished = await created(harness, { name: 'finished', schedule: { kind: 'once', at: '2020-01-01T00:00:00.000Z' } })
    await harness.store.markDue(finished.id, new Date())
    await harness.store.create({
      name: 'elsewhere',
      prompt: 'Runs in another workspace.',
      schedule: { kind: 'manual' },
      sessionId: SessionId('hq-session'),
      workspaceCwd: '/tmp/other',
    })
    const list = harness.tool('whale_task_list')
    const visible = await list.execute({}, execution({}, '/tmp/ws')) as WhaleTaskView[]
    expect(visible.map(view => view.id)).toEqual([pending.id])
    const all = await list.execute({ include_done: true }, execution({}, '/tmp/ws')) as WhaleTaskView[]
    expect(all.map(view => view.id)).toEqual(expect.arrayContaining([pending.id, finished.id]))
    expect(all).toHaveLength(2)
  })

  it('reports an uncomposted tool row when no whale task store is mounted', async () => {
    const list = compositionWithoutStore().get('whale_task_list')
    await expect(list?.execute({}, execution({}, '/tmp/ws')))
      .rejects.toThrow('whale tasks are unavailable in this composition')
  })

  it('refuses a call with no session workspace', async () => {
    const harness = await composition()
    await expect(harness.tool('whale_task_list').execute({}, execution({})))
      .rejects.toThrow('whale tasks require a session workspace')
  })

  it('renders an empty and a populated task list', async () => {
    const harness = await composition()
    const list = harness.tool('whale_task_list')
    expect(list.output.render({}, [])).toEqual([{ type: 'text', text: 'No whale tasks.' }])
    const view = await created(harness, { schedule: { kind: 'manual' } })
    expect(list.output.render({}, [view])).toEqual([{
      type: 'text',
      text: `- ${view.name} [active] manual (run with whale_task_run)`,
    }])
    expect(list.output.presentationMeta?.({}, [view])).toEqual({ tasks: [view] })
    expect(list.presentCall?.({})).toEqual({ card: 'generic', title: 'List whale tasks', kind: 'other' })
    expect(list.presentCall?.({ include_done: true })).toMatchObject({ rawInput: true })
    expect(list.presentResult?.({}, { isError: false })).toBeUndefined()
  })
})

describe('whale task management tools', () => {
  it('pauses, resumes, and removes a task and renders each outcome', async () => {
    const harness = await composition()
    const task = await created(harness, { schedule: { kind: 'manual' } })
    const pause = harness.tool('whale_task_pause')
    expect(await pause.execute({ task_id: task.id }, execution({}))).toEqual({ ok: true })
    expect(harness.store.get(task.id)).toMatchObject({ status: 'paused' })
    expect(pause.output.render({}, { ok: true })).toEqual([{ type: 'text', text: 'Done.' }])
    expect(pause.output.render({}, { ok: false })).toEqual([{ type: 'text', text: 'Task not found.' }])
    expect(pause.presentCall?.({ task_id: task.id })).toEqual({
      card: 'generic',
      title: `whale_task_pause ${task.id}`,
      kind: 'other',
      rawInput: task.id,
    })
    expect(pause.presentResult?.({ task_id: task.id }, { isError: false })).toEqual({
      card: 'generic',
      title: `whale_task_pause ${task.id}`,
    })
    expect(pause.presentResult?.({ task_id: task.id }, { isError: true })).toBeUndefined()

    expect(await harness.tool('whale_task_resume').execute({ task_id: task.id }, execution({}))).toEqual({ ok: true })
    expect(harness.store.get(task.id)).toMatchObject({ status: 'active' })
    expect(await harness.tool('whale_task_remove').execute({ task_id: task.id }, execution({}))).toEqual({ ok: true })
    expect(harness.store.get(task.id)).toBeUndefined()
  })

  it('reports a missing task as not found', async () => {
    const harness = await composition()
    for (const name of ['whale_task_pause', 'whale_task_resume', 'whale_task_remove', 'whale_task_run']) {
      expect(await harness.tool(name).execute({ task_id: 'missing' }, execution({})), name).toEqual({ ok: false })
    }
  })

  it('runs a task now by delivering it into the owning session and marking it due', async () => {
    const harness = await composition()
    const task = await created(harness, { schedule: { kind: 'once', at: '2030-01-01T00:00:00.000Z' } })
    harness.live.set('hq-session', [])
    expect(await harness.tool('whale_task_run').execute({ task_id: task.id }, execution({}))).toEqual({ ok: true })
    expect(harness.live.get('hq-session')).toHaveLength(1)
    expect(harness.live.get('hq-session')?.[0]?.content[0]?.text).toContain('[whale task] daily brief')
    expect(harness.store.get(task.id)).toMatchObject({ status: 'done' })
  })

  it('reports an undelivered manual run when the owning session has no live agent', async () => {
    const harness = await composition()
    const task = await created(harness, { schedule: { kind: 'manual' } })
    expect(await harness.tool('whale_task_run').execute({ task_id: task.id }, execution({}))).toEqual({ ok: false })
    expect(harness.store.get(task.id)).toMatchObject({ status: 'active' })
    expect(harness.store.get(task.id)?.lastRunAt).toBeUndefined()
  })

  it('reports an uncomposted tool row when no whale task store is mounted', async () => {
    const run = compositionWithoutStore().get('whale_task_run')
    await expect(run?.execute({ task_id: 'task-1' }, execution({})))
      .rejects.toThrow('whale tasks are unavailable in this composition')
  })
})

describe('whale-core plugin', () => {
  it('declares its loader name, injected services, and scheduler tick default', async () => {
    expect(WhaleCore.name).toBe('whale-core')
    expect(WhaleCore.inject).toEqual(['storageDomain', 'tools', 'systemPrompt', 'agents', 'sessions'])
    const harness = await composition()
    expect(DEFAULT_TICK_MS).toBe(60_000)
    // The mount resolved config through the plugin schema, so intervalMs is set.
    expect(harness.sections.map(section => section.name)).toEqual(['whale:tasks'])
  })

  it('rejects a tick interval below the schema minimum', async () => {
    await expect(composition({ intervalMs: 10 })).rejects.toThrow()
  })

  it('registers every whale task tool and its guidance on mount', async () => {
    const harness = await composition()
    expect(harness.sections[0]?.text).toContain('whale_task_create')
    for (const name of ['whale_task_create', 'whale_task_list', 'whale_task_pause', 'whale_task_resume', 'whale_task_remove', 'whale_task_run']) {
      expect(harness.tool(name).name, name).toBe(name)
    }
  })

  it('stops the scheduler and closes the store when the composition unloads', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const harness = await composition({ intervalMs: 1000 })
      const task = await created(harness, { schedule: { kind: 'once', at: '2020-01-01T00:00:00.000Z' } })
      harness.live.set('hq-session', [])
      await vi.waitFor(() => { expect(harness.store.list()).toHaveLength(1) })
      await harness.ctx.fiber.dispose()
      expect(() => harness.store.get(task.id)).toThrow(/closed/)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(harness.live.get('hq-session')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
