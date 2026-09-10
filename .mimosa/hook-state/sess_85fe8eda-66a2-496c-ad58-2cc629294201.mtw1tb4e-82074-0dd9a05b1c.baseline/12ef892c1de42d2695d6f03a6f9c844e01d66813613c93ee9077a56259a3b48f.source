/**
 * Deliver tool behavior tests: workspace-relative claims resolve against the
 * calling session's workspace (never the process cwd), missing paths fail
 * loudly, and the 1–10 path bound is enforced.
 * @module @deepseek-ai/dsh-tool-deliver/tests/deliver
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolDeliver from '../src/index.ts'

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'whale-deliver-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

interface CapturedTool {
  readonly name: string
  execute(args: never, exec: never): Promise<unknown>
}

function execution(name: string, args: unknown, cwd: string): Record<string, unknown> {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: 't',
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  }
}

async function booted(): Promise<{ deliver: CapturedTool; root: string }> {
  const root = mkdtempSync(join(ROOT_BASE, 'case-'))
  const ctx = new Context()
  new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 })
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
  return { deliver, root }
}

describe('deliver', () => {
  it('claims a finished file from the calling session workspace', async () => {
    const { deliver, root } = await booted()
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    writeFileSync(join(root, 'deliverables', 'report.txt'), 'finished')
    const result = await deliver.execute(
      { paths: ['deliverables/report.txt'] } as never,
      execution('deliver', { paths: ['deliverables/report.txt'] }, root) as never,
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
      { paths: ['deliverables/only-here.txt'] } as never,
      execution('deliver', { paths: ['deliverables/only-here.txt'] }, elsewhere) as never,
    )).rejects.toThrow('does not exist in the workspace')
  })

  it('fails loudly on a claimed-but-missing path', async () => {
    const { deliver, root } = await booted()
    await expect(deliver.execute(
      { paths: ['deliverables/ghost.xlsx'] } as never,
      execution('deliver', { paths: ['deliverables/ghost.xlsx'] }, root) as never,
    )).rejects.toThrow('does not exist in the workspace')
  })

  it('enforces the 1–10 path bound', async () => {
    const { deliver, root } = await booted()
    await expect(deliver.execute(
      { paths: [] } as never,
      execution('deliver', { paths: [] }, root) as never,
    )).rejects.toThrow('between 1 and 10 paths')
    await expect(deliver.execute(
      { paths: Array.from({ length: 11 }, (_, index) => `f${index}.txt`) } as never,
      execution('deliver', {}, root) as never,
    )).rejects.toThrow('between 1 and 10 paths')
  })
})
