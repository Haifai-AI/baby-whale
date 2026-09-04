/**
 * Model-facing Whale task tools: whale_task_create / whale_task_list /
 * whale_task_pause / whale_task_resume / whale_task_remove / whale_task_run
 * over `ctx.whaleTasks` plus the HQ scheduler's delivery.
 * @module @deepseek-ai/dsh-whale-core/src/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { WhaleTaskStore } from './store.ts'
import { deliverTask } from './runtime.ts'
import type { WhaleTaskView } from './spec.ts'
import { taskView } from './spec.ts'


/** The store, resolved lazily so a composition without whale-core degrades the tool row off. */
function storeOf(ctx: Context): WhaleTaskStore | undefined {
  return ctx.get('whaleTasks') as WhaleTaskStore | undefined
}

/** The calling session (required for every whale task tool). */
function sessionOf(exec: ToolExecution): SessionId {
  if (exec.agent === undefined) throw new Error('whale task tools require a calling agent session')
  return exec.agent.session.id
}

const VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['active', 'paused', 'done'] },
    scheduleKind: { type: 'string', required: true, enum: ['once', 'cron', 'manual'] },
    scheduleSummary: { type: 'string', required: true },
    tz: { type: 'string', required: true },
    nextRunAt: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    lastRunAt: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    workspaceCwd: { type: 'string', required: true },
  },
} as const

const okSchema = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } } as const

function presentCall(title: string, rawInput: unknown): GenericCallView {
  return {
    card: 'generic',
    title,
    kind: 'other',
    ...rawInput !== undefined ? { rawInput } : {},
  }
}

/**
 * Register the whale task tools and their guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 */
export function applyWhaleTaskTools(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'whale:tasks',
    order: 108,
    text: 'Schedule recurring work with whale_task_create (cron expressions, IANA timezones, or one-shot times). List with whale_task_list, and manage with whale_task_pause/resume/remove. Scheduled tasks run in the owning session when it is open.',
  })

  ctx.tools.register(defineTool({
    name: 'whale_task_create',
    description: 'Schedule a recurring or one-shot whale task for this session.',
    parameters: {
      name: { type: 'string', required: true, description: 'Short task name.' },
      prompt: { type: 'string', required: true, description: 'The instructions the agent runs when the task is due.' },
      schedule: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['once', 'cron', 'manual'], description: 'one-shot at an ISO time, recurring cron, or manual.' },
          at: { type: 'string', description: 'ISO-8601 one-shot time (kind=once).' },
          expr: { type: 'string', description: 'Five-field cron expression, e.g. "0 9 * * 1-5" (kind=cron).' },
          tz: { type: 'string', description: 'IANA timezone, e.g. "Asia/Shanghai" (defaults to the machine timezone).' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          task: { type: 'object', additionalProperties: false, properties: { ...VIEW_SCHEMA.properties, id: { type: 'string', required: true } }, required: true },
        },
      },
      render: (_args, value: { ok: boolean; task: WhaleTaskView }) => [{
        type: 'text',
        text: `Task "${value.task.name}" scheduled (${value.task.scheduleSummary}).`,
      }],
      presentationMeta: (_args, value) => ({ task: value.task }),
    },
    async execute(args: {
      name: string
      prompt: string
      schedule: { kind: 'once' | 'cron' | 'manual'; at?: string; expr?: string; tz?: string }
    }, exec: ToolExecution) {
      const store = storeOf(ctx)
      if (store === undefined) throw new Error('whale tasks are unavailable in this composition')
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('whale tasks require a session workspace')
      const schedule = normalizeSchedule(args.schedule)
      const record = await store.create({
        name: args.name,
        prompt: args.prompt,
        schedule,
        ...schedule.kind === 'cron' && schedule.tz !== undefined ? { tz: schedule.tz } : {},
        sessionId: sessionOf(exec),
        workspaceCwd: cwd,
      })
      return { ok: true, task: taskView(record) }
    },
    presentCall(args): GenericCallView {
      return presentCall(`Schedule whale task "${args.name}"`, args.schedule)
    },
    presentResult(args, result: ToolResult): GenericResultView | undefined {
      if (result.isError) return undefined
      return { card: 'generic', title: `Scheduled "${args.name}"` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'whale_task_list',
    description: 'List the whale tasks of the current workspace.',
    parameters: {
      include_done: { type: 'boolean', description: 'Include finished one-shot tasks (default false).' },
    },
    output: {
      schema: { type: 'array', items: VIEW_SCHEMA },
      render: (_args, value: WhaleTaskView[]) => [{
        type: 'text',
        text: value.length === 0
          ? 'No whale tasks.'
          : value.map(task => `- ${task.name} [${task.status}] ${task.scheduleSummary}`).join('\n'),
      }],
      presentationMeta: (_args, value) => ({ tasks: value }),
    },
    execute(args: { include_done?: boolean }, exec: ToolExecution): Promise<WhaleTaskView[]> {
      const store = storeOf(ctx)
      if (store === undefined) return Promise.reject(new Error('whale tasks are unavailable in this composition'))
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) return Promise.reject(new Error('whale tasks require a session workspace'))
      return Promise.resolve(store.viewsOf(cwd).filter(view => args.include_done === true || view.status !== 'done'))
    },
    presentCall(args): GenericCallView {
      return presentCall('List whale tasks', args.include_done)
    },
    presentResult(_args): GenericResultView | undefined {
      return undefined
    },
  }))

  for (const [name, description, action] of [
    ['whale_task_pause', 'Pause a whale task so it stops firing (resume restores it).', 'pause'],
    ['whale_task_resume', 'Resume a paused whale task.', 'resume'],
    ['whale_task_remove', 'Delete a whale task permanently.', 'remove'],
    ['whale_task_run', 'Run a whale task now (deliver it into the owning session).', 'run'],
  ] as const) {
    ctx.tools.register(defineTool({
      name,
      description,
      parameters: { task_id: { type: 'string', required: true, description: 'The task id from whale_task_list.' } },
      output: {
        schema: okSchema,
        render: (_args, value: { ok: boolean }) => [{ type: 'text', text: value.ok ? 'Done.' : 'Task not found.' }],
      },
      async execute(args: { task_id: string }) {
        const store = storeOf(ctx)
        if (store === undefined) throw new Error('whale tasks are unavailable in this composition')
        if (action === 'run') {
          const task = store.get(args.task_id)
          if (task === undefined) return { ok: false }
          const delivered = deliverTask(ctx, task)
          if (delivered) await store.markDue(task.id, new Date())
          return { ok: delivered }
        }
        const status = action === 'pause' ? 'paused' as const : action === 'resume' ? 'active' as const : undefined
        if (status === undefined) {
          const removed = await store.remove(args.task_id)
          return { ok: removed }
        }
        return { ok: (await store.setStatus(args.task_id, status)) !== undefined }
      },
      presentCall(args): GenericCallView {
        return presentCall(`${name} ${args.task_id}`, args.task_id)
      },
      presentResult(args, result: ToolResult): GenericResultView | undefined {
        if (result.isError) return undefined
        return { card: 'generic', title: `${name} ${args.task_id}` }
      },
    }))
  }
}

function normalizeSchedule(input: { kind: 'once' | 'cron' | 'manual'; at?: string; expr?: string; tz?: string }): { kind: 'once'; at: string } | { kind: 'cron'; expr: string; tz?: string } | { kind: 'manual' } {
  switch (input.kind) {
    case 'once':
      if (input.at === undefined) throw new Error('whale task once schedule requires "at"')
      return { kind: 'once', at: input.at }
    case 'cron':
      if (input.expr === undefined) throw new Error('whale task cron schedule requires "expr"')
      return { kind: 'cron', expr: input.expr, ...input.tz !== undefined ? { tz: input.tz } : {} }
    case 'manual':
      return { kind: 'manual' }
  }
}
