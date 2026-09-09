/**
 * Whale MCP manager: the one host-plane plugin that turns the `mcp` settings
 * namespace into live MCP servers. Each enabled entry mounts one
 * `@deepseek-ai/dsh-mcp-client` bridge fiber (stdio child process or
 * Streamable HTTP connection) whose tools join the shared `ctx.tools`
 * registry under `mcp__<name>__<tool>`; edits to the section reconcile the
 * mount set — untouched servers keep their fibers, changed ones remount.
 * The plugin is also the `mcpStatus` Remote: the Settings tab reads live
 * per-server state and tool lists from it, and can force one server's
 * remount. A first-use approval fence asks before any MCP tool runs in a
 * session that has not allowed it yet.
 *
 * @module @deepseek-ai/dsh-whale-mcp
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import * as bridge from '@deepseek-ai/dsh-mcp-client'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import {
  McpSettingsSchema, mountFingerprint, toBridgeConfig,
  type McpServerEntry, type McpSettings,
} from './config.ts'
import { decideMcpApproval } from './approval.ts'
import type { McpRestartRequest, McpServerState, McpStatusSnapshot } from './types.ts'

export type { McpRestartRequest, McpServerState, McpServerStatus, McpStatusSnapshot } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'whale-mcp'

/** Services required before the manager can mount bridges. */
export const inject = ['tools']

/** Structural face of the fiber handle `ctx.plugin` returns for one bridge. */
interface MountFiber {
  await(): Promise<unknown>
  dispose(): Promise<void> | void
}

/** Manager state for one configured server id. */
interface ServerCell {
  state: McpServerState
  error?: string | undefined
  fiber?: MountFiber | undefined
  fingerprint?: string | undefined
}

/**
 * The whale MCP manager service (`ctx.mcpStatus`). One instance per host;
 * each enabled settings entry gets one child bridge fiber under it.
 */
export class WhaleMcpService extends TypertRemoteService {
  /** Only the tools registry is required; settings presence is optional. */
  static inject = ['tools']

  private readonly cells = new Map<string, ServerCell>()
  private settings: SettingsScope<never> | undefined
  private reconcileTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'mcpStatus')

    // First-use approval: a session that never allowed an MCP tool sees one
    // card; the audit log remembers, exactly like the overwrite fence.
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = decideMcpApproval(exec)
      return decision === undefined ? next() : decision
    })

    // The settings service may not be composed (headless assemblies): the
    // manager still runs — it just has nothing to mount and nothing to watch.
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(settingsNamespace('mcp'), McpSettingsSchema)
      this.settings = scope as SettingsScope<never>
      settingsCtx.effect(() => {
        const disposer = scope.watch(() => { void this.requestReconcile() })
        return () => {
          disposer()
          if (this.settings === (scope as unknown)) this.settings = undefined
        }
      }, 'whale-mcp.settings()')
      void this.requestReconcile()
    })
  }

  /**
   * Read the live status of every configured server, in saved-section order.
   * Tool names enumerate the registry at call time, so a bridge that re-synced
   * (list_changed, reconnect) is reflected without any push channel.
   * @returns the current snapshot.
   */
  @Remote('list')
  list(): McpStatusSnapshot {
    const servers: McpStatusSnapshot['servers'][number][] = []
    const section = this.readSection()
    const knownTools = this.toolNamesByServer()
    for (const entry of section) {
      const cell = this.cells.get(entry.id)
      const prefix = `mcp__${entry.name}__`
      servers.push({
        id: entry.id,
        name: entry.name,
        transport: entry.transport,
        target: entry.transport === 'stdio' ? [entry.command, ...entry.args].join(' ') : entry.url,
        enabled: entry.enabled,
        state: cell?.state ?? 'disabled',
        error: cell?.error ?? null,
        toolNames: knownTools.get(prefix) ?? [],
      })
    }
    return { servers }
  }

  /**
   * Force one server's remount: disposal of any live fiber, then a fresh
   * bridge connection on the next reconcile pass. The go-to recovery for a
   * `failed` server once its cause (network, process, config elsewhere)
   * is addressed.
   * @param request - the settings-section id to remount.
   * @returns the snapshot read after the remount attempt settles.
   */
  @Remote('restart')
  async restart(request: McpRestartRequest): Promise<McpStatusSnapshot> {
    await this.requestReconcile(async () => {
      const cell = this.cells.get(request.id)
      if (cell !== undefined) await this.disposeCell(request.id, cell)
    })
    return this.list()
  }

  /**
   * Serialize reconcile passes (settings watch bursts, restarts) so fibers
   * never double-mount or race their own disposal.
   * @param beforeMount - optional mutation of the mount set to run first.
   * @returns settlement after the pass and its mounts complete.
   */
  private requestReconcile(beforeMount?: () => Promise<void>): Promise<void> {
    const task = this.reconcileTail.then(async () => {
      try {
        if (beforeMount !== undefined) await beforeMount()
        await this.reconcile()
      } catch (error) {
        this.ctx.logger.error('whale-mcp: reconcile failed: %o', error)
      }
    })
    this.reconcileTail = task
    return task
  }

  /**
   * Diff the saved section against the mount set: dispose removed/disabled/
   * changed fibers, mount missing ones. Untouched servers keep running.
   */
  private async reconcile(): Promise<void> {
    const section = this.readSection()
    const desired = new Map(section.map(entry => [entry.id, entry]))
    for (const [id, cell] of [...this.cells]) {
      if (cell.fiber === undefined) continue
      const entry = desired.get(id)
      if (entry === undefined || !entry.enabled || mountFingerprint(entry) !== cell.fingerprint) {
        await this.disposeCell(id, cell)
      }
    }
    for (const entry of section) {
      if (!entry.enabled) continue
      if (this.cells.get(entry.id)?.fiber !== undefined) continue
      await this.mount(entry)
    }
  }

  /**
   * Mount one bridge fiber and record its startup truth. A rejected startup
   * (unreachable server, bad command, duplicate name) is contained here: the
   * cell turns `failed` with the actionable message and the manager moves on.
   * @param entry - the enabled entry to mount.
   */
  private async mount(entry: McpServerEntry): Promise<void> {
    const cell: ServerCell = { state: 'connecting' }
    this.cells.set(entry.id, cell)
    const fiber = this.ctx.plugin(bridge, toBridgeConfig(entry)) as MountFiber
    try {
      await fiber.await()
    } catch (error) {
      cell.state = 'failed'
      cell.error = error instanceof Error ? error.message : String(error)
      try {
        await fiber.dispose()
      } catch {
        // The rolled-back fiber is already torn down; the recorded failure is
        // the actionable fact, not the teardown's opinion of it.
      }
      return
    }
    cell.state = 'connected'
    cell.fiber = fiber
    cell.fingerprint = mountFingerprint(entry)
  }

  /**
   * Dispose one server's fiber and drop its mount record; the cell stays as a
   * tombstone so a removed entry's last state is not misread as connected.
   * @param id - the settings-section id.
   * @param cell - the cell holding the fiber.
   */
  private async disposeCell(id: string, cell: ServerCell): Promise<void> {
    const fiber = cell.fiber
    cell.fiber = undefined
    cell.fingerprint = undefined
    cell.state = 'disabled'
    cell.error = undefined
    if (fiber === undefined) return
    try {
      await fiber.dispose()
    } catch (error) {
      this.ctx.logger.warn('whale-mcp: disposing server %s failed: %o', id, error)
    }
  }

  /**
   * @returns the saved server entries, or an empty list when settings is not
   * composed (headless) or the scope is not registered yet.
   */
  private readSection(): readonly McpServerEntry[] {
    const scope = this.settings as unknown as SettingsScope<McpSettings> | undefined
    return scope?.get().servers ?? []
  }

  /**
   * Group model-facing tool names by their `mcp__<server>__` prefix, read
   * from the live global registry.
   * @returns one entry per observed prefix.
   */
  private toolNamesByServer(): Map<string, string[]> {
    const grouped = new Map<string, string[]>()
    for (const schema of this.ctx.tools.schemas()) {
      if (!schema.name.startsWith('mcp__')) continue
      const prefixEnd = schema.name.indexOf('__', 'mcp__'.length)
      if (prefixEnd === -1) continue
      const prefix = schema.name.slice(0, prefixEnd + 2)
      const bucket = grouped.get(prefix)
      if (bucket === undefined) grouped.set(prefix, [schema.name])
      else bucket.push(schema.name)
    }
    return grouped
  }
}

export default WhaleMcpService
