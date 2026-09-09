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

/**
 * Manager-owned bound given to every bridge startup (initial connection plus
 * tool sync). The bridge fails its own fiber at this deadline — a bounded
 * startup lifecycle, so one hanging external server can never hold a fiber in
 * LOADING forever. {@link WhaleMcpService.startupTimeoutMs} is the test/assembly
 * seam; this is the production default.
 */
export const MOUNT_STARTUP_TIMEOUT_MS = 30_000

/**
 * Grace the manager's own net waits beyond the bridge's startup bound before
 * abandoning a mount. In normal operation the bridge rejects first (clean
 * rollback, contained failure); the net only fires when a fiber wedges below
 * the bridge — a pathological case that must still not strand the serialized
 * reconcile queue.
 */
const MOUNT_STARTUP_GRACE_MS = 5_000

/** Bound for abandoning a disposal whose fiber never settled. */
const DISPOSE_ABANDON_MS = 5_000

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
  /**
   * Startup bound handed to each bridge mount (see {@link MOUNT_STARTUP_TIMEOUT_MS}).
   * An instance field rather than config: lowering it is a test/assembly seam
   * for proving a hanging server harmless without waiting out the default.
   */
  startupTimeoutMs: number = MOUNT_STARTUP_TIMEOUT_MS

  constructor(ctx: Context) {
    super(ctx, 'mcpStatus')

    // First-use approval: a session that never allowed an MCP tool sees one
    // card; the audit log remembers, exactly like the overwrite fence. The
    // configured server names attribute a tool to its server by literal prefix
    // match — tool names are never parsed for identity, so a name containing
    // `__` stays unambiguous.
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = decideMcpApproval(exec, this.configuredServerNames())
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
      const prefix = serverPrefix(entry.name)
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
   * Cells are records of LIVE manager state, not history: a removed or
   * disabled entry's cell is dropped (no tombstones accumulate across edit
   * cycles), an edited entry's cell is replaced by its remount, and a
   * still-enabled unchanged entry keeps its cell — a `failed` startup stays
   * visible instead of being silently retried on every unrelated edit.
   */
  private async reconcile(): Promise<void> {
    const section = this.readSection()
    const desired = new Map(section.map(entry => [entry.id, entry]))
    for (const [id, cell] of [...this.cells]) {
      const entry = desired.get(id)
      if (entry === undefined || !entry.enabled) {
        await this.disposeCell(id, cell)
        continue
      }
      if (cell.fiber !== undefined && mountFingerprint(entry) !== cell.fingerprint) {
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
   * (unreachable server, bad command, duplicate name, startup deadline) is
   * contained here: the cell turns `failed` with the actionable message and
   * the manager moves on to the next server. The bridge fails its own fiber
   * at {@link WhaleMcpService.startupTimeoutMs}; the manager additionally
   * bounds the await itself, so even a fiber wedged below the bridge cannot
   * hold the serialized reconcile queue past the deadline plus grace.
   * @param entry - the enabled entry to mount.
   */
  private async mount(entry: McpServerEntry): Promise<void> {
    const cell: ServerCell = { state: 'connecting' }
    this.cells.set(entry.id, cell)
    const config = toBridgeConfig(entry, this.startupTimeoutMs)
    const fiber = this.ctx.plugin(bridge, config) as MountFiber
    const startup: Promise<unknown> = fiber.await()
    // A fiber abandoned by the manager net can still settle (or reject) much
    // later; this handler keeps that late settlement from escalating into an
    // unhandled rejection.
    startup.catch(() => {})
    let abandoned = false
    try {
      await Promise.race([
        startup,
        startupDeadline(this.startupTimeoutMs + MOUNT_STARTUP_GRACE_MS, () => { abandoned = true }),
      ])
    } catch (error) {
      cell.state = 'failed'
      cell.error = abandoned
        ? `startup did not settle within ${this.startupTimeoutMs + MOUNT_STARTUP_GRACE_MS}ms — mount abandoned; restart to retry`
        : error instanceof Error ? error.message : String(error)
      await this.quiesceFiber(fiber, abandoned)
      return
    }
    cell.state = 'connected'
    cell.fiber = fiber
    cell.fingerprint = mountFingerprint(entry)
  }

  /**
   * Tear down a failed mount's fiber without letting teardown itself hold the
   * queue. A fiber that failed below the bridge disposes promptly; an
   * abandoned LOADING fiber defers its unload until its plugin settles, so the
   * wait is bounded and a stuck teardown is logged and left behind.
   * @param fiber - the mount fiber to dispose.
   * @param abandoned - whether the mount was abandoned by the manager net.
   */
  private async quiesceFiber(fiber: MountFiber, abandoned: boolean): Promise<void> {
    try {
      if (!abandoned) {
        await fiber.dispose()
        return
      }
      await Promise.race([
        Promise.resolve(fiber.dispose()).catch((error) => {
          this.ctx.logger.warn('whale-mcp: abandoned mount disposal failed: %o', error)
        }),
        startupDeadline(DISPOSE_ABANDON_MS),
      ])
    } catch {
      // The rolled-back fiber is already torn down; the recorded failure is
      // the actionable fact, not the teardown's opinion of it.
    }
  }

  /**
   * Dispose one server's fiber and drop its mount record entirely: the cell
   * map holds live state only, so removed, disabled, and remounted entries
   * leave nothing behind to accumulate. A still-configured enabled entry's
   * `failed` cell is never passed here (see {@link reconcile}), so its visible
   * failure survives until the user edits or restarts it.
   * @param id - the settings-section id.
   * @param cell - the cell holding the fiber.
   */
  private async disposeCell(id: string, cell: ServerCell): Promise<void> {
    const fiber = cell.fiber
    this.cells.delete(id)
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
   * @returns the names of the servers currently configured, for literal
   * prefix attribution of MCP tool names.
   */
  private configuredServerNames(): ReadonlySet<string> {
    return new Set(this.readSection().map(entry => entry.name))
  }

  /**
   * Group model-facing tool names by the configured server they belong to,
   * read from the live global registry. Tools are attributed by LITERAL
   * configured prefix (`mcp__<name>__`, longest match first) — never by
   * parsing the name at the first `__`, which would misattribute servers whose
   * own name contains `__` (e.g. `a__b`).
   * @returns one entry per configured literal prefix.
   */
  private toolNamesByServer(): Map<string, string[]> {
    const grouped = new Map<string, string[]>()
    const prefixes = this.readSection()
      .map(entry => serverPrefix(entry.name))
      .sort((a, b) => b.length - a.length)
    for (const schema of this.ctx.tools.schemas()) {
      const prefix = prefixes.find(candidate => schema.name.startsWith(candidate))
      if (prefix === undefined) continue
      const bucket = grouped.get(prefix)
      if (bucket === undefined) grouped.set(prefix, [schema.name])
      else bucket.push(schema.name)
    }
    return grouped
  }
}

/**
 * The literal model-facing prefix owned by one configured server name.
 * @param name - the configured server name.
 * @returns the prefix its tools are registered under.
 */
function serverPrefix(name: string): string {
  return `mcp__${name}__`
}

/**
 * A promise that rejects after `ms`, racing a mount's startup (or disposal).
 * The timer never holds the process open on its own; the tick mutates the
 * caller's `abandoned` flag before rejecting so the handler can distinguish
 * a bridge-reported failure from a manager-net abandonment.
 * @param ms - the bound.
 * @param onTick - optional flag setter run when the deadline fires.
 * @returns the rejecting deadline promise.
 */
function startupDeadline(ms: number, onTick?: () => void): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      onTick?.()
      reject(new Error(`deadline of ${ms}ms exceeded`))
    }, ms)
    timer.unref()
  })
}

export default WhaleMcpService
