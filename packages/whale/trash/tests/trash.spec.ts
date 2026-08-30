/**
 * Whale trash behavior tests: the pre-dispatch backup of an existing target,
 * the listing of backups, and the restore of one backup over its original.
 * @module @deepseek-ai/dsh-whale-trash/tests/trash
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import * as TrashPlugin from '../src/index.ts'
import { restoreBackup } from '../src/index.ts'

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'whale-trash-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

function execution(name: string, args: unknown, cwd: string): ToolExecution {
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    token: 't' as never,
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } } as never,
  }
}

async function booted(): Promise<{ ctx: Context; root: string }> {
  const root = mkdtempSync(join(ROOT_BASE, 'case-'))
  const ctx = new Context()
  new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 })
  ctx.provide('systemPrompt', { section: () => {} })
  ctx.provide('tools', { register: () => {} })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write' }) } as never)
  await ctx.plugin(TrashPlugin)
  return { ctx, root }
}

/** Invoke the tools/execute waterfall with the wrapper under test. */
function dispatch(ctx: Context, exec: ToolExecution, next: () => Promise<unknown>): Promise<unknown> {
  return (ctx.waterfall as (event: string, ...rest: unknown[]) => Promise<unknown>)(
    'tools/execute', exec, next,
  )
}

describe('whale-trash', () => {
  it('backs up an existing target before the mutation dispatch', async () => {
    const { ctx, root } = await booted()
    writeFileSync(join(root, 'notes.txt'), 'original')
    let dispatched = false
    await dispatch(ctx, execution('write', { file_path: 'notes.txt' }, root), async () => { dispatched = true; return { ok: true } })
    expect(dispatched).toBe(true)
    const trash = await ctx.fs.resolve('.whale-trash', { cwd: root })
    const entries = await ctx.fs.listDir(trash)
    expect(entries).toHaveLength(1)
    const backup = await ctx.fs.resolve(`.whale-trash/${entries[0]!.name}`, { cwd: root })
    const bytes = await ctx.fs.readBytes(backup, undefined, 1024 * 1024)
    expect(Buffer.from(bytes).toString()).toBe('original')
  })

  it('skips unknown targets silently', async () => {
    const { ctx, root } = await booted()
    await dispatch(ctx, execution('write', { file_path: 'missing.txt' }, root), async () => ({ ok: true }))
    const trash = await ctx.fs.resolve('.whale-trash', { cwd: root })
    const info = await ctx.fs.stat(trash)
    const names = info === undefined ? [] : (await ctx.fs.listDir(trash)).map(entry => entry.name)
    expect(names).toHaveLength(0)
  })

  it('lists and restores backups over their original path', async () => {
    const { ctx, root } = await booted()
    writeFileSync(join(root, 'data.csv'), 'v1')
    await dispatch(ctx, execution('edit', { file_path: 'data.csv' }, root), async () => ({ ok: true }))
    writeFileSync(join(root, 'data.csv'), 'v2')
    const trash = await ctx.fs.resolve('.whale-trash', { cwd: root })
    const entries = await ctx.fs.listDir(trash)
    const backupName = entries[0]!.name
    const restored = await restoreBackup(
      ctx,
      execution('whale_trash_restore', { backup: `.whale-trash/${backupName}` }, root),
      root,
      50 * 1024 * 1024,
      `.whale-trash/${backupName}`,
    )
    expect(restored.ok).toBe(true)
    const content = await ctx.fs.readText(await ctx.fs.resolve('data.csv', { cwd: root }))
    expect(content).toBe('v1')
  })
})
