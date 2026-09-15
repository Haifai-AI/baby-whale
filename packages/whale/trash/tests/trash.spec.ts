/**
 * Whale trash behavior tests: the pre-dispatch backup of an existing target,
 * the listing of backups, the restore of one backup over its original, and the
 * sandbox policy each backup write runs under.
 * @module @deepseek-ai/dsh-whale-trash/tests/trash
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import * as TrashPlugin from '../src/index.ts'
import { restoreBackup } from '../src/index.ts'

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'whale-trash-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

interface CapturedTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
  output: { render(args: unknown, value: unknown): Array<{ type: string; text: string }> }
  presentCall(args: unknown): Record<string, unknown> | undefined
}

interface BackupEntry {
  readonly backup: string
  readonly original: string
  readonly size: number
}

/** A local backend that reports a file's type without its byte size, as the fs seam allows. */
class SizelessStatFileSystem extends LocalFileSystem {
  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const info = await super.stat(target, signal)
    return info === undefined ? undefined : { version: info.version, type: info.type }
  }
}

/** A local backend that reports a default confinement mode, like a sandboxing deployment. */
class ConfiningFileSystem extends LocalFileSystem {
  override get sandboxMode(): 'workspace-write' { return 'workspace-write' }
}

interface BootOptions {
  /** Report a default confinement mode, like a sandboxing deployment. */
  confining?: boolean
  /** Withhold the sandboxPolicy service even though the filesystem confines. */
  withoutSandboxPolicy?: boolean
  /** Omit byte sizes from stat(), as a backend that cannot measure may. */
  sizelessStat?: boolean
}

interface Harness {
  readonly ctx: Context
  readonly root: string
  readonly tools: CapturedTool[]
  readonly sections: Array<Record<string, unknown>>
  readonly policyRequests: Array<Record<string, unknown>>
}

async function booted(
  config?: { directory?: string; maxBackupBytes?: number },
  options: BootOptions = {},
): Promise<Harness> {
  const root = mkdtempSync(join(ROOT_BASE, 'case-'))
  const ctx = new Context()
  const fsConfig = { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 }
  if (options.sizelessStat) new SizelessStatFileSystem(ctx, fsConfig)
  else if (options.confining) new ConfiningFileSystem(ctx, fsConfig)
  else new LocalFileSystem(ctx, fsConfig)
  const sections: Array<Record<string, unknown>> = []
  ctx.provide('systemPrompt', {
    section: (section: Record<string, unknown>) => { sections.push(section) },
  })
  const tools: CapturedTool[] = []
  ctx.provide('tools', {
    register: (tool: CapturedTool) => {
      tools.push(tool)
      return () => {}
    },
  })
  const policyRequests: Array<Record<string, unknown>> = []
  if (options.withoutSandboxPolicy !== true) {
    ctx.provide('sandboxPolicy', {
      resolve: (request: Record<string, unknown>) => {
        policyRequests.push(request)
        return { mode: 'workspace-write' }
      },
    } as never)
  }
  await ctx.plugin(TrashPlugin, config ?? {})
  return { ctx, root, tools, sections, policyRequests }
}

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

/** A caller outside any session: no agent, no workspace, no cwd. */
function sessionlessExecution(name: string, args: unknown): ToolExecution {
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    token: 't' as never,
    name,
    arguments: args,
    signal: new AbortController().signal,
  }
}

/** Invoke the tools/execute waterfall with the wrapper under test. */
function dispatch(ctx: Context, exec: ToolExecution, next: () => Promise<unknown>): Promise<unknown> {
  return (ctx.waterfall as (event: string, ...rest: unknown[]) => Promise<unknown>)(
    'tools/execute', exec, next,
  )
}

/** Names of the trash entries for a workspace, or an empty list when it has none. */
async function trashNames(ctx: Context, root: string): Promise<string[]> {
  const dir = await ctx.fs.resolve('.whale-trash', { cwd: root })
  const info = await ctx.fs.stat(dir)
  if (info === undefined) return []
  return (await ctx.fs.listDir(dir)).map(entry => entry.name)
}

function toolNamed(tools: CapturedTool[], name: string): CapturedTool {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`${name} was not registered`)
  return tool
}

function backupPath(name: string): string {
  return `.whale-trash/${name}`
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
    const backup = await ctx.fs.resolve(backupPath(entries[0]!.name), { cwd: root })
    const bytes = await ctx.fs.readBytes(backup, undefined, 1024 * 1024)
    expect(Buffer.from(bytes).toString()).toBe('original')
  })

  it('skips unknown targets silently', async () => {
    const { ctx, root } = await booted()
    await dispatch(ctx, execution('write', { file_path: 'missing.txt' }, root), async () => ({ ok: true }))
    expect(await trashNames(ctx, root)).toHaveLength(0)
  })

  it('lists and restores backups over their original path', async () => {
    const { ctx, root } = await booted()
    writeFileSync(join(root, 'data.csv'), 'v1')
    await dispatch(ctx, execution('edit', { file_path: 'data.csv' }, root), async () => ({ ok: true }))
    writeFileSync(join(root, 'data.csv'), 'v2')
    const backupName = (await trashNames(ctx, root))[0]!
    const restored = await restoreBackup(
      ctx,
      execution('whale_trash_restore', { backup: backupPath(backupName) }, root),
      root,
      50 * 1024 * 1024,
      backupPath(backupName),
    )
    expect(restored.ok).toBe(true)
    const content = await ctx.fs.readText(await ctx.fs.resolve('data.csv', { cwd: root }))
    expect(content).toBe('v1')
  })

  it('round-trips a nested target back into its subdirectory', async () => {
    const { ctx, root } = await booted()
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    writeFileSync(join(root, 'deliverables', 'q2.xlsx'), 'v1')
    await dispatch(ctx, execution('write', { file_path: 'deliverables/q2.xlsx' }, root), async () => ({ ok: true }))
    writeFileSync(join(root, 'deliverables', 'q2.xlsx'), 'v2')
    const backupName = (await trashNames(ctx, root))[0]!
    // The encoded path must survive in the flat entry name.
    expect(backupName).toContain('__')
    const restored = await restoreBackup(
      ctx,
      execution('whale_trash_restore', { backup: backupPath(backupName) }, root),
      root,
      50 * 1024 * 1024,
      backupPath(backupName),
    )
    expect(restored).toEqual({ ok: true, original: 'deliverables/q2.xlsx' })
    const content = await ctx.fs.readText(await ctx.fs.resolve('deliverables/q2.xlsx', { cwd: root }))
    expect(content).toBe('v1')
  })

  it('still lists and restores legacy basename backups', async () => {
    const { ctx, root } = await booted()
    mkdirSync(join(root, '.whale-trash'), { recursive: true })
    writeFileSync(join(root, '.whale-trash', '2026-01-01T00-00-00-000Z-old.txt'), 'legacy')
    writeFileSync(join(root, 'old.txt'), 'current')
    const restored = await restoreBackup(
      ctx,
      execution('whale_trash_restore', { backup: backupPath('2026-01-01T00-00-00-000Z-old.txt') }, root),
      root,
      50 * 1024 * 1024,
      backupPath('2026-01-01T00-00-00-000Z-old.txt'),
    )
    expect(restored).toEqual({ ok: true, original: 'old.txt' })
    const content = await ctx.fs.readText(await ctx.fs.resolve('old.txt', { cwd: root }))
    expect(content).toBe('legacy')
  })

  it('a backup failure never blocks the mutation', async () => {
    // Point the trash directory at an existing FILE so every backup write fails.
    const { ctx, root } = await booted({ directory: 'blocked-trash' })
    writeFileSync(join(root, 'notes.txt'), 'original')
    writeFileSync(join(root, 'blocked-trash'), 'not a directory')
    let dispatched = false
    await dispatch(ctx, execution('write', { file_path: 'notes.txt' }, root), async () => { dispatched = true; return { ok: true } })
    expect(dispatched).toBe(true)
  })

  it('never backs up the trash tools’ own operations', async () => {
    const { ctx, root } = await booted()
    mkdirSync(join(root, '.whale-trash'), { recursive: true })
    writeFileSync(join(root, '.whale-trash', '2026-01-01T00-00-00-000Z-notes.txt'), 'legacy')
    let dispatched = false
    const result = await dispatch(
      ctx,
      execution('whale_trash_restore', { backup: backupPath('2026-01-01T00-00-00-000Z-notes.txt') }, root),
      async () => { dispatched = true; return { ok: true } },
    )
    expect(result).toEqual({ ok: true })
    expect(dispatched).toBe(true)
    // A recursive snapshot would have added a second entry for the backup itself.
    expect(await trashNames(ctx, root)).toEqual(['2026-01-01T00-00-00-000Z-notes.txt'])
  })

  it('ignores unguarded tools and guarded calls without a file_path', async () => {
    const { ctx, root } = await booted()
    writeFileSync(join(root, 'notes.txt'), 'original')
    await dispatch(ctx, execution('bash', { command: 'rm notes.txt' }, root), async () => ({ ok: true }))
    await dispatch(ctx, execution('write', undefined, root), async () => ({ ok: true }))
    await dispatch(ctx, execution('write', { file_path: 42 }, root), async () => ({ ok: true }))
    expect(await trashNames(ctx, root)).toHaveLength(0)
  })

  it('does not back up for a caller without a session', async () => {
    const { ctx, root } = await booted()
    writeFileSync(join(root, 'notes.txt'), 'original')
    await dispatch(ctx, sessionlessExecution('write', { file_path: 'notes.txt' }), async () => ({ ok: true }))
    expect(await trashNames(ctx, root)).toHaveLength(0)
  })

  it('skips a target larger than the size cap', async () => {
    const { ctx, root } = await booted({ maxBackupBytes: 1 })
    writeFileSync(join(root, 'notes.txt'), 'original')
    await dispatch(ctx, execution('write', { file_path: 'notes.txt' }, root), async () => ({ ok: true }))
    expect(await trashNames(ctx, root)).toHaveLength(0)
  })

  it('skips a directory target', async () => {
    const { ctx, root } = await booted()
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    await dispatch(ctx, execution('write', { file_path: 'deliverables' }, root), async () => ({ ok: true }))
    expect(await trashNames(ctx, root)).toHaveLength(0)
  })

  it('backs up a target whose backend cannot report a byte size', async () => {
    const { ctx, root } = await booted({ maxBackupBytes: 8 }, { sizelessStat: true })
    writeFileSync(join(root, 'notes.txt'), 'original')
    await dispatch(ctx, execution('write', { file_path: 'notes.txt' }, root), async () => ({ ok: true }))
    const backupName = (await trashNames(ctx, root))[0]!
    const backup = await ctx.fs.resolve(backupPath(backupName), { cwd: root })
    expect(Buffer.from(await ctx.fs.readBytes(backup, undefined, 1024)).toString()).toBe('original')
  })

  it('round-trips an escaped percent and an escaped separator in the original path', async () => {
    const { ctx, root } = await booted()
    // The literal `%2F` in the name must survive as text, never collapse into a separator.
    const original = '100%-mix%2Fodd.txt'
    writeFileSync(join(root, original), 'v1')
    await dispatch(ctx, execution('write', { file_path: original }, root), async () => ({ ok: true }))
    const backupName = (await trashNames(ctx, root))[0]!
    expect(backupName).toContain('%25')
    const restored = await restoreBackup(
      ctx,
      execution('whale_trash_restore', { backup: backupPath(backupName) }, root),
      root,
      50 * 1024 * 1024,
      backupPath(backupName),
    )
    expect(restored).toEqual({ ok: true, original })
    expect(await ctx.fs.readText(await ctx.fs.resolve(original, { cwd: root }))).toBe('v1')
  })

  it.skipIf(process.platform === 'win32')('round-trips a backslash in the original name', async () => {
    const { ctx, root } = await booted()
    // A backslash is an ordinary filename character on POSIX and a path separator on Windows.
    const original = 'notes\\draft.txt'
    writeFileSync(join(root, original), 'v1')
    await dispatch(ctx, execution('write', { file_path: original }, root), async () => ({ ok: true }))
    const backupName = (await trashNames(ctx, root))[0]!
    // Escaping keeps the flat entry name from reading as a subdirectory path.
    expect(backupName).toContain('%5C')
    expect(backupName).not.toContain('\\')
    const restored = await restoreBackup(
      ctx,
      execution('whale_trash_restore', { backup: backupPath(backupName) }, root),
      root,
      50 * 1024 * 1024,
      backupPath(backupName),
    )
    expect(restored).toEqual({ ok: true, original })
  })

  it('registers the trash guidance in the system prompt', async () => {
    const { sections } = await booted()
    expect(sections).toEqual([{
      name: 'whale:trash',
      order: 109,
      text: 'Overwritten files are backed up under .whale-trash/ in the workspace. Use whale_trash_list to inspect backups and whale_trash_restore to put a prior version back.',
    }])
  })
})

describe('whale trash backup policy', () => {
  it('writes the backup under the session policy when the filesystem confines', async () => {
    const { ctx, root, policyRequests } = await booted(undefined, { confining: true })
    writeFileSync(join(root, 'notes.txt'), 'original')
    await dispatch(ctx, execution('write', { file_path: 'notes.txt' }, root), async () => ({ ok: true }))
    expect(policyRequests).toEqual([{ session: { header: { cwd: root } } }])
    expect(await trashNames(ctx, root)).toHaveLength(1)
  })

  it('writes without resolving a policy when the filesystem does not confine', async () => {
    const { ctx, root, policyRequests } = await booted()
    writeFileSync(join(root, 'notes.txt'), 'original')
    await dispatch(ctx, execution('write', { file_path: 'notes.txt' }, root), async () => ({ ok: true }))
    expect(policyRequests).toEqual([])
    expect(await trashNames(ctx, root)).toHaveLength(1)
  })

  it('refuses to write when the filesystem confines without a policy service', async () => {
    const { ctx, root } = await booted(undefined, { confining: true, withoutSandboxPolicy: true })
    mkdirSync(join(root, '.whale-trash'), { recursive: true })
    writeFileSync(join(root, '.whale-trash', '2026-01-01T00-00-00-000Z-old.txt'), 'legacy')
    await expect(restoreBackup(
      ctx,
      execution('whale_trash_restore', { backup: backupPath('2026-01-01T00-00-00-000Z-old.txt') }, root),
      root,
      1024,
      backupPath('2026-01-01T00-00-00-000Z-old.txt'),
    )).rejects.toThrow('whale-trash: the mounted filesystem confines but ctx.sandboxPolicy is missing')
  })

  it('resolves a session-less policy for a caller with no agent', async () => {
    const { ctx, root, policyRequests } = await booted(undefined, { confining: true })
    mkdirSync(join(root, '.whale-trash'), { recursive: true })
    writeFileSync(join(root, '.whale-trash', '2026-01-01T00-00-00-000Z-old.txt'), 'legacy')
    const restored = await restoreBackup(
      ctx,
      sessionlessExecution('whale_trash_restore', { backup: backupPath('2026-01-01T00-00-00-000Z-old.txt') }),
      root,
      1024,
      backupPath('2026-01-01T00-00-00-000Z-old.txt'),
    )
    expect(restored).toEqual({ ok: true, original: 'old.txt' })
    expect(policyRequests).toEqual([{}])
  })
})

describe('whale trash tools', () => {
  it('lists backups with decoded originals, sizes, and the newest first', async () => {
    const { ctx, root, tools } = await booted()
    mkdirSync(join(root, 'deliverables'), { recursive: true })
    writeFileSync(join(root, 'deliverables', 'q2.xlsx'), 'v1')
    await dispatch(ctx, execution('write', { file_path: 'deliverables/q2.xlsx' }, root), async () => ({ ok: true }))
    writeFileSync(join(root, '.whale-trash', '2000-01-01T00-00-00-000Z-legacy.txt'), 'old')
    mkdirSync(join(root, '.whale-trash', 'nested-dir'), { recursive: true })
    const entries = await toolNamed(tools, 'whale_trash_list').execute(
      {},
      execution('whale_trash_list', {}, root),
    ) as BackupEntry[]
    expect(entries.map(entry => entry.original)).toEqual(['nested-dir', 'deliverables/q2.xlsx', 'legacy.txt'])
    expect(entries.map(entry => entry.backup).every(backup => backup.startsWith('.whale-trash/'))).toBe(true)
    expect(entries[0]).toMatchObject({ original: 'nested-dir', size: 0 })
    expect(entries[1]).toMatchObject({ original: 'deliverables/q2.xlsx', size: 2 })
  })

  it('reports an empty trash when the directory is absent', async () => {
    const { root, tools } = await booted()
    const entries = await toolNamed(tools, 'whale_trash_list').execute(
      {},
      execution('whale_trash_list', {}, root),
    )
    expect(entries).toEqual([])
  })

  it('ignores a .whale-trash path that is a plain file', async () => {
    const { root, tools } = await booted()
    writeFileSync(join(root, '.whale-trash'), 'not a directory')
    const entries = await toolNamed(tools, 'whale_trash_list').execute(
      {},
      execution('whale_trash_list', {}, root),
    )
    expect(entries).toEqual([])
  })

  it('lists nothing for a caller without a session', async () => {
    const { tools } = await booted()
    const entries = await toolNamed(tools, 'whale_trash_list').execute(
      {},
      sessionlessExecution('whale_trash_list', {}),
    )
    expect(entries).toEqual([])
  })

  it('restores a backup through the registered tool', async () => {
    const { ctx, root, tools } = await booted()
    writeFileSync(join(root, 'notes.txt'), 'original')
    await dispatch(ctx, execution('write', { file_path: 'notes.txt' }, root), async () => ({ ok: true }))
    writeFileSync(join(root, 'notes.txt'), 'overwritten')
    const backup = backupPath((await trashNames(ctx, root))[0]!)
    const restored = await toolNamed(tools, 'whale_trash_restore').execute(
      { backup },
      execution('whale_trash_restore', { backup }, root),
    )
    expect(restored).toEqual({ ok: true, original: 'notes.txt' })
    expect(await ctx.fs.readText(await ctx.fs.resolve('notes.txt', { cwd: root }))).toBe('original')
  })

  it('reports a missing backup without writing anything', async () => {
    const { ctx, root, tools } = await booted()
    mkdirSync(join(root, '.whale-trash'), { recursive: true })
    const backup = backupPath('2000-01-01T00-00-00-000Z-gone.txt')
    const restored = await toolNamed(tools, 'whale_trash_restore').execute(
      { backup },
      execution('whale_trash_restore', { backup }, root),
    )
    expect(restored).toEqual({ ok: false, original: backup })
    expect(await trashNames(ctx, root)).toEqual([])
  })

  it('rejects a restore for a caller without a session', async () => {
    const { tools } = await booted()
    await expect(toolNamed(tools, 'whale_trash_restore').execute(
      { backup: backupPath('whatever') },
      sessionlessExecution('whale_trash_restore', { backup: backupPath('whatever') }),
    )).rejects.toThrow('whale trash requires a session workspace')
  })

  it('treats a directory in the trash as a missing backup', async () => {
    const { ctx, root } = await booted()
    mkdirSync(join(root, '.whale-trash', 'nested-dir'), { recursive: true })
    const restored = await restoreBackup(
      ctx,
      execution('whale_trash_restore', {}, root),
      root,
      1024,
      backupPath('nested-dir'),
    )
    expect(restored).toEqual({ ok: false, original: backupPath('nested-dir') })
  })

  it('refuses a backup path that climbs out of the workspace', async () => {
    const { ctx, root } = await booted()
    await expect(restoreBackup(
      ctx,
      execution('whale_trash_restore', {}, root),
      root,
      1024,
      '.whale-trash/../secrets.txt',
    )).rejects.toThrow('whale trash refuses a backup path outside the workspace')
  })

  it('renders list results and their pending call', async () => {
    const { tools } = await booted()
    const list = toolNamed(tools, 'whale_trash_list')
    expect(list.output.render({}, [])).toEqual([{ type: 'text', text: 'No backups in .whale-trash.' }])
    expect(list.output.render({}, [
      { backup: backupPath('stamp__a.txt'), original: 'a.txt', size: 3 },
      { backup: backupPath('stamp__b.txt'), original: 'b.txt', size: 4 },
    ])).toEqual([{
      type: 'text',
      text: `- a.txt → ${backupPath('stamp__a.txt')} (3 bytes)\n- b.txt → ${backupPath('stamp__b.txt')} (4 bytes)`,
    }])
    expect(list.presentCall({})).toEqual({ card: 'generic', title: 'List .whale-trash backups', kind: 'other' })
  })

  it('renders restore outcomes and their pending call', async () => {
    const { tools } = await booted()
    const restore = toolNamed(tools, 'whale_trash_restore')
    const backup = backupPath('stamp__a.txt')
    expect(restore.output.render({ backup }, { ok: true, original: 'a.txt' }))
      .toEqual([{ type: 'text', text: 'Restored a.txt.' }])
    expect(restore.output.render({ backup }, { ok: false, original: backup }))
      .toEqual([{ type: 'text', text: `No backup found at "${backup}".` }])
    expect(restore.presentCall({ backup })).toEqual({
      card: 'generic',
      title: `Restore ${backup}`,
      kind: 'other',
      rawInput: backup,
    })
  })
})
