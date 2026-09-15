/**
 * Deliver tool behavior tests: workspace-relative claims resolve against the
 * calling session's workspace (never the process cwd), missing paths fail
 * loudly, and the 1–10 path bound is enforced. The post-execute listener
 * reminds the model once per turn while bash writes under deliverables/.
 * @module @deepseek-ai/dsh-tool-deliver/tests/deliver
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolDeliver from '../src/index.ts'

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'whale-deliver-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

interface CapturedTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
  output: { render(args: unknown, value: unknown): Array<{ type: string; text: string }> }
  presentCall(args: unknown): Record<string, unknown> | undefined
  presentResult(args: unknown, result: { content: ContentBlock[]; isError: boolean }): Record<string, unknown> | undefined
}

/** A local backend that reports a file's type without its byte size, as the fs seam allows. */
class SizelessFileSystem extends LocalFileSystem {
  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const info = await super.stat(target, signal)
    return info === undefined ? undefined : { version: info.version, type: info.type }
  }
}

function execution(name: string, args: unknown, cwd?: string): Record<string, unknown> {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: 't',
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...(cwd === undefined ? {} : { agent: { session: { header: { cwd } } } }),
  }
}

/** One successful or failed result carrying the given model-visible content. */
function resultOf(content: ContentBlock[], isError = false): Readonly<ToolExecutionResult> {
  return isError
    ? { isError: true, error: { message: 'boom' }, content }
    : { isError: false, value: {}, content }
}

/** Run the registered tools/post-execute listener over one settled result. */
function postExecute(
  ctx: Context,
  exec: unknown,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
): Promise<PostToolDecision> {
  return (ctx.waterfall as (event: string, ...rest: unknown[]) => Promise<PostToolDecision>)(
    'tools/post-execute', exec, result, next,
  )
}

/** A downstream listener that accepts, optionally replacing the model-visible content. */
function accepting(content?: UserMessage['content']): () => Promise<PostToolDecision> {
  return async () => content === undefined ? { kind: 'accept' } : { kind: 'accept', content }
}

async function booted(options: { fs?: 'local' | 'sizeless' } = {}): Promise<{ ctx: Context; deliver: CapturedTool; root: string }> {
  const root = mkdtempSync(join(ROOT_BASE, 'case-'))
  const ctx = new Context()
  const fsConfig = { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 }
  if (options.fs === 'sizeless') new SizelessFileSystem(ctx, fsConfig)
  else new LocalFileSystem(ctx, fsConfig)
  ctx.provide('systemPrompt', { section: () => {} })
  const registered: CapturedTool[] = []
  ctx.provide('tools', {
    register: (tool: CapturedTool) => {
      registered.push(tool)
      return () => {}
    },
  } as never)
  await ctx.plugin(ToolDeliver)
  const deliver = registered.find(tool => tool.name === 'deliver')
  if (deliver === undefined) throw new Error('deliver tool was not registered')
  return { ctx, deliver, root }
}

describe('deliver', () => {
  it('claims a finished file from the calling session workspace', async () => {
    const { deliver, root } = await booted()
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    writeFileSync(join(root, 'deliverables', 'report.txt'), 'finished')
    const result = await deliver.execute(
      { paths: ['deliverables/report.txt'] },
      execution('deliver', { paths: ['deliverables/report.txt'] }, root),
    ) as { delivered: Array<{ path: string; size: number }> }
    expect(result.delivered).toHaveLength(1)
    expect(result.delivered[0]).toMatchObject({ path: 'deliverables/report.txt', size: 8 })
  })

  it('resolves against the session cwd, not the process cwd', async () => {
    const { deliver, root } = await booted()
    const elsewhere = mkdtempSync(join(ROOT_BASE, 'other-'))
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    writeFileSync(join(root, 'deliverables', 'only-here.txt'), 'x')
    // Same relative path from a workspace that lacks the file must fail,
    // even though the file exists in another session's workspace.
    await expect(deliver.execute(
      { paths: ['deliverables/only-here.txt'] },
      execution('deliver', { paths: ['deliverables/only-here.txt'] }, elsewhere),
    )).rejects.toThrow('does not exist in the workspace')
  })

  it('fails loudly on a claimed-but-missing path', async () => {
    const { deliver, root } = await booted()
    await expect(deliver.execute(
      { paths: ['deliverables/ghost.xlsx'] },
      execution('deliver', { paths: ['deliverables/ghost.xlsx'] }, root),
    )).rejects.toThrow('does not exist in the workspace')
  })

  it('enforces the 1–10 path bound', async () => {
    const { deliver, root } = await booted()
    await expect(deliver.execute(
      { paths: [] },
      execution('deliver', { paths: [] }, root),
    )).rejects.toThrow('between 1 and 10 paths')
    await expect(deliver.execute(
      { paths: Array.from({ length: 11 }, (_, index) => `f${index}.txt`) },
      execution('deliver', {}, root),
    )).rejects.toThrow('between 1 and 10 paths')
  })

  it('refuses a claimed path that is a directory', async () => {
    const { deliver, root } = await booted()
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    await expect(deliver.execute(
      { paths: ['deliverables'] },
      execution('deliver', { paths: ['deliverables'] }, root),
    )).rejects.toThrow('deliver: "deliverables" does not exist in the workspace')
  })

  it('resolves a claim against the filesystem cwd when the caller has no session', async () => {
    const { deliver, root } = await booted()
    writeFileSync(join(root, 'provider-avatar.png'), 'image')
    const result = await deliver.execute(
      { paths: ['provider-avatar.png'] },
      execution('deliver', { paths: ['provider-avatar.png'] }),
    ) as { delivered: Array<{ path: string; size: number }> }
    expect(result.delivered).toEqual([{ path: 'provider-avatar.png', size: 5 }])
  })

  it('reports zero bytes for a file whose backend omits the size', async () => {
    const { deliver, root } = await booted({ fs: 'sizeless' })
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    writeFileSync(join(root, 'deliverables', 'unmeasurable.txt'), 'twelve bytes')
    const result = await deliver.execute(
      { paths: ['deliverables/unmeasurable.txt'] },
      execution('deliver', { paths: ['deliverables/unmeasurable.txt'] }, root),
    ) as { delivered: Array<{ path: string; size: number }> }
    expect(result.delivered).toEqual([{ path: 'deliverables/unmeasurable.txt', size: 0 }])
  })
})

describe('deliver tool surface', () => {
  it('renders one file element per delivered entry', async () => {
    const { deliver } = await booted()
    const blocks = deliver.output.render(
      { paths: ['deliverables/q2.xlsx', 'deliverables/deck.pptx'] },
      { delivered: [{ path: 'deliverables/q2.xlsx', size: 8192 }, { path: 'deliverables/deck.pptx', size: 4096 }] },
    )
    expect(blocks).toEqual([{
      type: 'text',
      text: '<delivered>\n<file path="deliverables/q2.xlsx" bytes="8192"/>\n<file path="deliverables/deck.pptx" bytes="4096"/>\n</delivered>',
    }])
  })

  it('titles a single-path call with its path and a multi-path call with its count', async () => {
    const { deliver } = await booted()
    expect(deliver.presentCall({ paths: ['deliverables/q2.xlsx'] })).toEqual({
      card: 'generic',
      title: 'Delivered deliverables/q2.xlsx',
      kind: 'edit',
      locations: [{ path: 'deliverables/q2.xlsx' }],
    })
    expect(deliver.presentCall({ paths: ['deliverables/q2.xlsx', 'deliverables/deck.pptx'] })).toEqual({
      card: 'generic',
      title: 'Delivered 2 files',
      kind: 'edit',
      locations: [{ path: 'deliverables/q2.xlsx' }, { path: 'deliverables/deck.pptx' }],
    })
  })

  it('presents a delivered card for a success and nothing for an error', async () => {
    const { deliver } = await booted()
    const args = { paths: ['deliverables/q2.xlsx'] }
    expect(deliver.presentResult(args, { content: [{ type: 'text', text: '<delivered/>' }], isError: false }))
      .toEqual({ card: 'generic', title: 'Delivered' })
    expect(deliver.presentResult(args, { content: [{ type: 'text', text: 'deliver failed' }], isError: true }))
      .toBeUndefined()
  })
})

describe('deliver post-execute nudge', () => {
  const REMINDER = '<system-reminder>Files were written under deliverables/. When they are final, call the deliver tool with their paths so the user receives them.</system-reminder>'

  it('reminds the model after a bash result mentions deliverables/', async () => {
    const { ctx } = await booted()
    const decision = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      resultOf([{ type: 'text', text: 'wrote deliverables/q2-revenue.xlsx' }]),
      accepting(),
    )
    expect(decision.kind).toBe('accept')
    const contexts = decision.kind === 'accept' ? decision.additionalContexts : undefined
    expect(contexts).toHaveLength(1)
    expect(contexts?.[0]?.role).toBe('user')
    expect(contexts?.[0]?.content).toEqual([{ type: 'text', text: REMINDER }])
    expect(contexts?.[0]?.source).toEqual({ kind: 'plugin', plugin: 'tool-deliver' })
    // The nudge adds context without replacing whatever the downstream listener accepted.
    expect(decision).not.toHaveProperty('content')
  })

  it('keeps a downstream content replacement alongside the reminder', async () => {
    const { ctx } = await booted()
    const replacement: ContentBlock[] = [{ type: 'text', text: 'rewritten by a later listener' }]
    const decision = await postExecute(
      ctx,
      execution('bash', { command: 'ls deliverables/' }),
      resultOf([{ type: 'text', text: 'deliverables/q2.xlsx' }]),
      accepting(replacement),
    )
    expect(decision).toMatchObject({ kind: 'accept', content: replacement })
    expect(decision.kind === 'accept' ? decision.additionalContexts : undefined).toHaveLength(1)
  })

  it('passes a non-accept downstream decision straight through', async () => {
    const { ctx } = await booted()
    const blocked: PostToolDecision = { kind: 'block', feedback: [{ type: 'text', text: 'denied by policy' }] }
    const decision = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      resultOf([{ type: 'text', text: 'wrote deliverables/q2.xlsx' }]),
      async () => blocked,
    )
    expect(decision).toBe(blocked)
  })

  it('stays silent for a bash result that never mentions deliverables/', async () => {
    const { ctx } = await booted()
    const decision = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      // A non-text block cannot carry the trigger, even when its text matches.
      resultOf([{ type: 'reasoning', text: 'deliverables/q2.xlsx' }, { type: 'text', text: 'wrote notes.txt' }]),
      accepting(),
    )
    expect(decision).toEqual({ kind: 'accept' })
  })

  it('leaves non-bash calls alone', async () => {
    const { ctx } = await booted()
    const decision = await postExecute(
      ctx,
      execution('write', { file_path: 'deliverables/q2.xlsx' }, '/tmp/workspace'),
      resultOf([{ type: 'text', text: 'wrote deliverables/q2.xlsx' }]),
      accepting(),
    )
    expect(decision).toEqual({ kind: 'accept' })
  })

  it('reminds at most once per turn', async () => {
    const { ctx } = await booted()
    const first = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      resultOf([{ type: 'text', text: 'wrote deliverables/a.xlsx' }]),
      accepting(),
    )
    expect(first.kind === 'accept' ? first.additionalContexts : undefined).toHaveLength(1)
    const second = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      resultOf([{ type: 'text', text: 'wrote deliverables/b.xlsx' }]),
      accepting(),
    )
    expect(second).toEqual({ kind: 'accept' })
  })

  it('stops reminding once a deliver call succeeds', async () => {
    const { ctx } = await booted()
    await postExecute(
      ctx,
      execution('deliver', { paths: ['deliverables/a.xlsx'] }, '/tmp/workspace'),
      resultOf([{ type: 'text', text: '<delivered>\n<file path="deliverables/a.xlsx" bytes="9"/>\n</delivered>' }]),
      accepting(),
    )
    const decision = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      resultOf([{ type: 'text', text: 'wrote deliverables/b.xlsx' }]),
      accepting(),
    )
    expect(decision).toEqual({ kind: 'accept' })
  })

  it('still reminds after a failed deliver call', async () => {
    const { ctx } = await booted()
    await postExecute(
      ctx,
      execution('deliver', { paths: ['deliverables/a.xlsx'] }, '/tmp/workspace'),
      resultOf([{ type: 'text', text: 'deliver: "deliverables/a.xlsx" does not exist in the workspace' }], true),
      accepting(),
    )
    const decision = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      resultOf([{ type: 'text', text: 'wrote deliverables/b.xlsx' }]),
      accepting(),
    )
    expect(decision.kind === 'accept' ? decision.additionalContexts : undefined).toHaveLength(1)
  })

  it('stays silent for a failed bash result', async () => {
    const { ctx } = await booted()
    const decision = await postExecute(
      ctx,
      execution('bash', { command: 'node build.mjs' }),
      resultOf([{ type: 'text', text: 'cannot write deliverables/q2.xlsx' }], true),
      accepting(),
    )
    expect(decision).toEqual({ kind: 'accept' })
  })
})
