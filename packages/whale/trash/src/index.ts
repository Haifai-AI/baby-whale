/**
 * Whale undo layer: every guarded file mutation backs the existing target up
 * to `<session cwd>/.whale-trash/` before the dispatch, and the
 * `whale_trash_list`/`whale_trash_restore` tools let the model (and the
 * human) recover a prior version.
 * @module @deepseek-ai/dsh-whale-trash
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'whale-trash'

/** Services required by the backup wrapper and tools. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin config. */
export interface Config {
  /** Backup directory name inside the session workspace. */
  directory?: string
  /** Maximum bytes copied per backup (default 50 MiB). */
  maxBackupBytes?: number
}

export const Config: z<Config> = z.object({
  directory: z.string().default('.whale-trash'),
  maxBackupBytes: z.number().default(50 * 1024 * 1024),
})

/** Mutations whose existing target is backed up before the write. */
const GUARDED_TOOLS = new Set(['write', 'edit', 'xlsx_create', 'pptx_create', 'docx_create'])

/** Separator between the timestamp prefix and the encoded original path. */
const BACKUP_SEPARATOR = '__'

/**
 * Encode a workspace-relative path into one flat trash filename segment, so
 * nested targets (`deliverables/q2.xlsx`) survive the round-trip instead of
 * collapsing to their basename. Percent-escapes are unambiguous: `%` itself
 * is escaped first, so decoding never confuses an original `%2F` with a
 * separator.
 */
function encodeTrashSegment(path: string): string {
  return path.replaceAll('%', '%25').replaceAll('/', '%2F').replaceAll('\\', '%5C')
}

/** Inverse of {@link encodeTrashSegment}. */
function decodeTrashSegment(segment: string): string {
  return segment.replaceAll('%2F', '/').replaceAll('%5C', '\\').replaceAll('%25', '%')
}

/** New-scheme backup names: `<iso-stamp>__<encoded-path>`. */
const NEW_BACKUP_PATTERN = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z?)__(.*)$/

/** Legacy backup names (v0.1.4 and earlier): `<iso-stamp>-<basename>`. */
const LEGACY_BACKUP_PATTERN = /^\d{4}-\d{2}-\d{2}T[\d-]+Z?-/

/**
 * Recover the original workspace-relative path from a trash entry name.
 * New-scheme names decode exactly (including subdirectories); legacy names
 * fall back to the basename behavior they were written with.
 */
function backupOriginalOf(entryName: string): string {
  const match = NEW_BACKUP_PATTERN.exec(entryName)
  if (match?.[2] !== undefined) return decodeTrashSegment(match[2])
  return entryName.replace(LEGACY_BACKUP_PATTERN, '')
}

/** The `file_path` argument of a guarded mutation. */
function filePathOf(exec: ToolExecution): string | undefined {
  const args = exec.arguments as { file_path?: unknown } | undefined
  return typeof args?.file_path === 'string' ? args.file_path : undefined
}

/** The session workspace root, or undefined for a non-agent caller. */
function workspaceOf(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}

/**
 * Resolve the standing sandbox policy for writes, mirroring the office tools.
 * @param ctx - the plugin context.
 * @param exec - the tool execution identifying the session.
 * @returns the standing policy, or undefined when the backend does not confine.
 */
function standingPolicy(ctx: Context, exec: ToolExecution): SandboxExecutionPolicy | undefined {
  if (ctx.fs.sandboxMode === undefined) return undefined
  const policy = ctx.get('sandboxPolicy') as
    | { resolve(request: { session?: unknown }): SandboxExecutionPolicy }
    | undefined
  if (policy === undefined) throw new Error('whale-trash: the mounted filesystem confines but ctx.sandboxPolicy is missing')
  return policy.resolve(exec.agent ? { session: exec.agent.session } : {})
}

/**
 * Back up one existing target to the trash directory under the session
 * workspace, if the target exists and fits the size cap.
 * @param ctx - the plugin context.
 * @param exec - the calling execution (cwd + cancellation).
 * @param workspace - the session workspace root.
 * @param directory - trash directory name inside the workspace.
 * @param maxBackupBytes - size cap.
 * @param path - the model-facing target path.
 * @returns the backup's trash-relative path, or undefined when nothing was backed up.
 */
async function backupTarget(
  ctx: Context,
  exec: ToolExecution,
  workspace: string,
  directory: string,
  maxBackupBytes: number,
  path: string,
): Promise<string | undefined> {
  const target = await ctx.fs.resolve(path, { cwd: workspace, signal: exec.signal })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined || info.type !== 'file' || (info.size ?? 0) > maxBackupBytes) return undefined
  const bytes = await ctx.fs.readBytes(target, exec.signal, maxBackupBytes)
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const backupPath = `${directory}/${stamp}${BACKUP_SEPARATOR}${encodeTrashSegment(path)}`
  const backupTarget = await ctx.fs.resolve(backupPath, { cwd: workspace, signal: exec.signal })
  await ctx.fs.writeBytes(backupTarget, bytes, undefined, exec.signal, standingPolicy(ctx, exec))
  return backupPath
}

export async function restoreBackup(
  ctx: Context,
  exec: ToolExecution,
  workspace: string,
  maxBackupBytes: number,
  backup: string,
): Promise<{ ok: boolean; original: string }> {
  if (backup.includes('..')) throw new Error('whale trash refuses a backup path outside the workspace')
  const source = await ctx.fs.resolve(backup, { cwd: workspace, signal: exec.signal })
  const info = await ctx.fs.stat(source, exec.signal)
  if (info === undefined || info.type !== 'file') return { ok: false, original: backup }
  const bytes = await ctx.fs.readBytes(source, exec.signal, maxBackupBytes)
  // The original path is the backup's name minus its timestamp prefix, with
  // subdirectory structure recovered exactly for new-scheme entries.
  const name = backup.split(/[\\/]/).at(-1) ?? ''
  const original = backupOriginalOf(name)
  const originalTarget = await ctx.fs.resolve(original, { cwd: workspace, signal: exec.signal })
  await ctx.fs.writeBytes(originalTarget, bytes, undefined, exec.signal, standingPolicy(ctx, exec))
  return { ok: true, original }
}

/**
 * Register the backup wrapper and the trash tools.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - validated plugin config (schemastery filled the defaults).
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>

  ctx.systemPrompt.section({
    name: 'whale:trash',
    order: 109,
    text: 'Overwritten files are backed up under .whale-trash/ in the workspace. Use whale_trash_list to inspect backups and whale_trash_restore to put a prior version back.',
  })

  ctx.on('tools/execute', async (exec, next) => {
    // Never back up the trash's own operations: a restore would recursively
    // snapshot the backup it is about to consume.
    if (exec.name.startsWith('whale_trash_')) return next()
    const path = filePathOf(exec)
    const workspace = workspaceOf(exec)
    if (GUARDED_TOOLS.has(exec.name) && path !== undefined && workspace !== undefined) {
      // Best-effort: a backup failure (quota, transient I/O) must never block
      // the user's own mutation — the trash is a safety net, not a gate.
      try {
        await backupTarget(ctx, exec, workspace, resolved.directory, resolved.maxBackupBytes, path)
      } catch {
        // Fall through to the mutation below.
      }
    }
    return next()
  })

  const trashEntrySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      backup: { type: 'string', required: true },
      original: { type: 'string', required: true },
      size: { type: 'integer', required: true },
    },
  } as const

  ctx.tools.register(defineTool({
    name: 'whale_trash_list',
    description: 'List the .whale-trash backups of the current workspace.',
    parameters: {},
    output: {
      schema: { type: 'array', items: trashEntrySchema },
      render: (_args, value: Array<{ backup: string; original: string; size: number }>) => [{
        type: 'text',
        text: value.length === 0
          ? 'No backups in .whale-trash.'
          : value.map(entry => `- ${entry.original} → ${entry.backup} (${entry.size} bytes)`).join('\n'),
      }],
    },
    execute(_args: {}, exec: ToolExecution): Promise<Array<{ backup: string; original: string; size: number }>> {
      const workspace = workspaceOf(exec)
      if (workspace === undefined) return Promise.resolve([])
      return listEntries(ctx, exec, workspace, resolved.directory)
    },
    presentCall(): GenericCallView {
      return { card: 'generic', title: 'List .whale-trash backups', kind: 'other' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'whale_trash_restore',
    description: 'Restore one .whale-trash backup over its original path.',
    parameters: { backup: { type: 'string', required: true, description: 'Backup path relative to the workspace, from whale_trash_list.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, original: { type: 'string', required: true } } },
      render: (_args, value: { ok: boolean; original: string }) => [{
        type: 'text',
        text: value.ok ? `Restored ${value.original}.` : `No backup found at "${_args.backup}".`,
      }],
    },
    async execute(args: { backup: string }, exec: ToolExecution) {
      const workspace = workspaceOf(exec)
      if (workspace === undefined) throw new Error('whale trash requires a session workspace')
      return restoreBackup(ctx, exec, workspace, resolved.maxBackupBytes, args.backup)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Restore ${args.backup}`, kind: 'other', rawInput: args.backup }
    },
  }))
}

/** List entries of the trash directory under the session workspace, newest last. */
async function listEntries(
  ctx: Context,
  exec: ToolExecution,
  workspace: string,
  directory: string,
): Promise<Array<{ backup: string; original: string; size: number }>> {
  const dir = await ctx.fs.resolve(directory, { cwd: workspace, signal: exec.signal })
  const info = await ctx.fs.stat(dir, exec.signal)
  if (info === undefined || info.type !== 'directory') return []
  const entries = await ctx.fs.listDir(dir, exec.signal)
  return entries
    .map(entry => ({
      backup: `${directory}/${entry.name}`,
      original: backupOriginalOf(entry.name),
      size: entry.size ?? 0,
    }))
    // Stamp-prefixed names sort newest-first, so the latest backup reads first.
    .sort((left, right) => right.backup.localeCompare(left.backup))
}
