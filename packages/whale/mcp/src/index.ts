/**
 * Whale MCP manager: the one host-plane plugin that turns the `mcp` settings
 * namespace into live MCP servers. Each enabled entry mounts one
 * `@deepseek-ai/dsh-mcp-client` bridge fiber (stdio child process or
 * Streamable HTTP connection) whose tools join the shared `ctx.tools`
 * registry under `mcp__<name>__<tool>`; edits to the section reconcile the
 * mount set — untouched servers keep their fibers, changed ones remount.
 *
 * Tool ownership is EXACT, never inferred from the public name: the bridge
 * records each definition's mount identity in module-private provenance,
 * exposed only through its read-only `getMcpToolOrigin` accessor, and status
 * grouping and the approval fence resolve ownership through that accessor.
 * Nothing a foreign same-process plugin stamps onto its own definitions can
 * forge attribution. Prefix parsing cannot be made sound — with servers `a`
 * and `a__b` both configured, the public name `mcp__a__b__t` (raw `b__t` on
 * server `a`) matches `a__b`'s namespace too, and a stale or disabled
 * configured name would steal attribution.
 *
 * Mount cells keep their fiber handles for as long as a fiber may still own
 * effects. A mount that never settles is abandoned by a bounded net; if its
 * disposal also never settles, the cell reports `stuck` honestly and keeps
 * the handle — no duplicate mount is attempted while the old child may still
 * hold its namespace and tools, an explicit restart re-arms a bounded wait,
 * and a Host process restart is the recovery. A `failed` mount keeps its
 * fingerprint: unrelated reconciles never retry it; only a config change or
 * an explicit restart does.
 *
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
import { getMcpToolOrigin, type McpToolOrigin } from '@deepseek-ai/dsh-mcp-client'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import type { Config as BridgeConfig } from '@deepseek-ai/dsh-mcp-client'
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
 * reconcile queue. {@link WhaleMcpService.startupGraceMs} is the seam.
 */
const MOUNT_STARTUP_GRACE_MS = 5_000

/**
 * Bound for abandoning a disposal whose fiber never settled. Above the
 * bridge's own bounded teardown (close grace plus quiescence) so a healthy
 * rollback is never mistaken for a wedge. {@link WhaleMcpService.disposeAbandonMs}
 * is the seam.
 */
const DISPOSE_ABANDON_MS = 10_000

/** Structural face of the fiber handle `ctx.plugin` returns for one bridge. */
interface MountFiber {
  await(): Promise<unknown>
  dispose(): Promise<void> | void
}

/**
 * One fiber disposal, created at most once per fiber: `settled` resolves when
 * the underlying `dispose()` definitively settles (its rejection, if any, is
 * consumed and logged). Reusing the record is what makes restarts and
 * reconciles double-dispose-proof; every bounded wait derives FRESH from
 * `settled`, so a record that outlived its first abandon (a stuck fiber that
 * eventually settled) reports truthfully on the next ask.
 */
interface DisposalRecord {
  readonly settled: Promise<void>
  /** Resolve `true` when the disposal settles within `boundMs`, else `false`. */
  waitFor(boundMs: number): Promise<boolean>
}

/** Manager state for one configured server id. */
interface ServerCell {
  /** The settings-section id this cell belongs to. */
  readonly id: string
  state: McpServerState
  error?: string | undefined
  /**
   * The mount's fiber handle, retained from mount until its disposal
   * DEFINITIVELY settles. Never dropped while the fiber may still own
   * registry effects: a lost handle cannot be disposed, retried, or
   * accounted for, and its child would leak invisibly.
   */
  fiber?: MountFiber | undefined
  /** The config fingerprint of the LAST mount attempt (kept on failure too). */
  fingerprint?: string | undefined
  /** The one disposal record for {@link fiber}, once disposal began. */
  disposal?: DisposalRecord | undefined
  /** Whether the late-settlement watcher is attached to {@link disposal}. */
  watched?: boolean | undefined
}

/**
 * The manager's durable background cleanup owner: a fiber whose disposal did
 * not settle while its settings entry was removed. The record keeps the
 * handle observable (and logs the eventual settlement) instead of letting a
 * wedged child leak invisibly.
 */
interface StrandedFiber {
  readonly id: string
  readonly cell: ServerCell
  readonly disposal: DisposalRecord
}

/**
 * The whale MCP manager service (`ctx.mcpStatus`). One instance per host;
 * each enabled settings entry gets one child bridge fiber under it.
 */
export class WhaleMcpService extends TypertRemoteService {
  /** Only the tools registry is required; settings presence is optional. */
  static inject = ['tools']

  private readonly cells = new Map<string, ServerCell>()
  private readonly stranded = new Set<StrandedFiber>()
  private settings: SettingsScope<never> | undefined
  private reconcileTail: Promise<void> = Promise.resolve()
  /**
   * Startup bound handed to each bridge mount (see {@link MOUNT_STARTUP_TIMEOUT_MS}).
   * An instance field rather than config: lowering it is a test/assembly seam
   * for proving a hanging server harmless without waiting out the default.
   */
  startupTimeoutMs: number = MOUNT_STARTUP_TIMEOUT_MS
  /** Extra wait beyond {@link startupTimeoutMs} before the manager abandons the await itself. */
  startupGraceMs: number = MOUNT_STARTUP_GRACE_MS
  /** Bound for abandoning a disposal whose fiber never settled. */
  disposeAbandonMs: number = DISPOSE_ABANDON_MS

  constructor(ctx: Context) {
    super(ctx, 'mcpStatus')

    // First-use approval: a session that never allowed an MCP tool sees one
    // card; the audit log remembers, exactly like the overwrite fence. Tool
    // ownership resolves from the mount origin stamp on each registered
    // definition — the public name is never parsed for identity.
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = decideMcpApproval(exec, toolName => this.owningServerName(toolName))
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
   * Tools are enumerated from the registry at call time and attributed by the
   * owning mount's origin stamp, so a bridge that re-synced (`list_changed`,
   * reconnect) is reflected without any push channel — and a public name that
   * merely shares a prefix with another server's namespace never lands under
   * the wrong row.
   * @returns the current snapshot.
   */
  @Remote('list')
  list(): McpStatusSnapshot {
    const servers: McpStatusSnapshot['servers'][number][] = []
    const section = this.readSection()
    const owned = this.toolsOwnedBy()
    // One live mount per name can exist (the bridge reserves server names),
    // so attribute each name's tools to the FIRST row with a live cell; any
    // duplicate-name row (whose own mount necessarily failed) stays empty.
    const attributed = new Set<string>()
    for (const entry of section) {
      const cell = this.cells.get(entry.id)
      const live = cell !== undefined && cell.fiber !== undefined
      const bucket = live && !attributed.has(entry.name) ? owned.get(entry.name) : undefined
      if (bucket !== undefined) attributed.add(entry.name)
      servers.push({
        id: entry.id,
        name: entry.name,
        transport: entry.transport,
        target: entry.transport === 'stdio' ? [entry.command, ...entry.args].join(' ') : entry.url,
        enabled: entry.enabled,
        state: cell?.state ?? 'disabled',
        error: cell?.error ?? null,
        toolNames: bucket?.publicNames ?? [],
        localToolNames: bucket?.localNames ?? [],
      })
    }
    return { servers }
  }

  /**
   * Force one server's remount: disposal of any live fiber, then a fresh
   * bridge connection on the next reconcile pass. The go-to recovery for a
   * `failed` server once its cause (network, process, config elsewhere)
   * is addressed. For a `stuck` cell the wait on the EXISTING disposal is
   * re-armed (never a second dispose): if the fiber settles within the bound,
   * the remount proceeds; otherwise the snapshot honestly reports `stuck`
   * with no duplicate mount attempted.
   * @param request - the settings-section id to remount.
   * @returns the snapshot read after the remount attempt settles.
   */
  @Remote('restart')
  async restart(request: McpRestartRequest): Promise<McpStatusSnapshot> {
    await this.requestReconcile(async () => {
      const cell = this.cells.get(request.id)
      if (cell === undefined) return
      if (cell.state === 'stuck' && cell.disposal !== undefined) {
        const settledNow = await Promise.race([
          cell.disposal.settled.then(() => true),
          delayFalse(this.disposeAbandonMs),
        ])
        if (!settledNow) return
        // The wedge is over: demote to an ordinary failure and tear down.
        cell.state = 'failed'
        cell.error = 'previous mount cleanup eventually settled — restarting'
      }
      await this.teardownCell(request.id, cell, true)
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
   * disabled entry's healthy cell is dropped (no tombstones accumulate across
   * edit cycles), an edited entry's cell is replaced by its remount, and a
   * still-enabled unchanged entry keeps its cell — a `failed` startup keeps
   * its fingerprint, so unrelated reconciles never retry it (only a config
   * change or an explicit restart does), and a `stuck` cell is never
   * replaced while its wedged fiber may still own registry effects.
   */
  private async reconcile(): Promise<void> {
    const section = this.readSection()
    const desired = new Map(section.map(entry => [entry.id, entry]))
    for (const [id, cell] of [...this.cells]) {
      const entry = desired.get(id)
      if (entry === undefined || !entry.enabled) {
        // Removed entries pass configured=false: a wedged disposal moves to
        // the stranded set instead of staying in the (row-less) cell map.
        await this.teardownCell(id, cell, entry !== undefined)
        continue
      }
      if (cell.state === 'stuck') continue
      if (cell.fingerprint !== undefined && mountFingerprint(entry) !== cell.fingerprint) {
        await this.teardownCell(id, cell, true)
      }
    }
    for (const entry of section) {
      if (!entry.enabled) continue
      const cell = this.cells.get(entry.id)
      // No duplicate mounts: this exact config was already attempted
      // (connected, failed, or connecting), or the old fiber is still wedged.
      if (cell !== undefined && (cell.state === 'stuck' || cell.fingerprint === mountFingerprint(entry))) continue
      await this.mount(entry)
    }
  }

  /**
   * The fiber handle for one bridge mount. A protected seam so deterministic
   * tests can stand in a fiber that wedges below the bridge.
   * @param config - the resolved bridge config for one mount.
   * @returns the Cordis fiber running the bridge plugin.
   */
  protected mountFiber(config: BridgeConfig): MountFiber {
    return this.ctx.plugin(bridge, config) as MountFiber
  }

  /**
   * Mount one bridge fiber and record its startup truth. The fiber handle is
   * retained on the cell from the moment it exists. A rejected startup
   * (unreachable server, bad command, duplicate name, startup deadline) is
   * contained here: the cell turns `failed` with the actionable message and
   * the manager moves on to the next server. The bridge fails its own fiber
   * at {@link WhaleMcpService.startupTimeoutMs}; the manager additionally
   * bounds the await itself, so even a fiber wedged below the bridge cannot
   * hold the serialized reconcile queue past the deadline plus grace — and a
   * fiber that never settles is reported `stuck` with its handle retained,
   * never silently dropped and never duplicated.
   * @param entry - the enabled entry to mount.
   */
  private async mount(entry: McpServerEntry): Promise<void> {
    const config = toBridgeConfig(entry, this.startupTimeoutMs)
    let fiber: MountFiber
    try {
      fiber = this.mountFiber(config)
    } catch (error) {
      // mountFiber itself refused (invalid config, disposed context): record
      // the failure so the row stays actionable; there is no fiber to own.
      this.cells.set(entry.id, {
        id: entry.id,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
        fingerprint: mountFingerprint(entry),
      })
      return
    }
    const cell: ServerCell = { id: entry.id, state: 'connecting', fiber, fingerprint: mountFingerprint(entry) }
    this.cells.set(entry.id, cell)
    // A fiber abandoned by the manager net can still settle (or reject) much
    // later; this lifelong handler keeps that late settlement from escalating
    // into an unhandled rejection.
    const startup = Promise.resolve().then(() => fiber.await())
    startup.catch(() => {})
    let abandoned = false
    try {
      await Promise.race([
        startup,
        startupDeadline(this.startupTimeoutMs + this.startupGraceMs, () => { abandoned = true }),
      ])
    } catch (error) {
      cell.state = 'failed'
      cell.error = error instanceof Error ? error.message : String(error)
      await this.abandonFiber(entry.id, cell)
      return
    }
    if (abandoned) {
      cell.state = 'failed'
      cell.error = `startup did not settle within ${this.startupTimeoutMs + this.startupGraceMs}ms — mount abandoned; restart to retry`
      await this.abandonFiber(entry.id, cell)
      return
    }
    cell.state = 'connected'
  }

  /**
   * Tear down a failed or abandoned mount's fiber without letting teardown
   * itself hold the queue. The disposal is bounded; when the fiber's disposal
   * never settles, the cell turns `stuck` with the handle retained — the
   * honest report that the old child may still own its namespace and tools
   * and that a Host process restart is the recovery.
   * @param id - the settings-section id.
   * @param cell - the failed cell holding the fiber.
   */
  private async abandonFiber(id: string, cell: ServerCell): Promise<void> {
    const record = this.disposeOnce(id, cell)
    cell.disposal = record
    this.watchDisposal(cell, record)
    if (await record.waitFor(this.disposeAbandonMs)) {
      // Rollback complete: the handle is inert; drop it so a later restart
      // never disposes the same fiber twice.
      cell.fiber = undefined
    } else {
      this.markStuck(cell, record)
    }
  }

  /**
   * Dispose one server's cell and drop it from the map once its fiber's
   * disposal DEFINITIVELY settled. Removed, disabled, and remounted entries
   * leave nothing behind — except a disposal that never settles: then the
   * cell reports `stuck` (kept visible while its entry is still configured,
   * moved to the stranded set when the entry is gone) and its handle is
   * retained by the manager until the disposal eventually settles.
   * @param id - the settings-section id.
   * @param cell - the cell holding the fiber.
   * @param configured - whether a settings entry still exists for this id
   *   (a stuck cell stays visible on a configured row; a removed one is
   *   stranded with its handle for background cleanup).
   */
  private async teardownCell(id: string, cell: ServerCell, configured: boolean): Promise<void> {
    const record = this.disposeOnce(id, cell)
    cell.disposal = record
    this.watchDisposal(cell, record)
    if (await record.waitFor(this.disposeAbandonMs)) {
      cell.fiber = undefined
      this.cells.delete(id)
      return
    }
    this.markStuck(cell, record)
    if (!configured) {
      // The row is gone from the section; keep the handle observable in the
      // background cleanup set instead of dropping it on the floor.
      this.cells.delete(id)
      this.stranded.add({ id, cell, disposal: record })
      this.ctx.logger.error(
        'whale-mcp: server %s was removed while its mount cleanup was still unsettled — the fiber is stranded until it settles; a Host process restart reclaims it',
        id,
      )
    }
  }

  /**
   * The one disposal record for a cell's fiber. Creates it at most once:
   * `fiber.dispose()` is called exactly once per fiber, its rejection is
   * consumed into the log, and every later caller reuses the same record.
   * @param id - the settings-section id (for diagnostics).
   * @param cell - the cell whose fiber should be disposed.
   * @returns the disposal record.
   */
  private disposeOnce(id: string, cell: ServerCell): DisposalRecord {
    if (cell.disposal !== undefined) return cell.disposal
    const settled = Promise.withResolvers<void>()
    const fiber = cell.fiber
    if (fiber === undefined) {
      settled.resolve()
    }
    let disposing: Promise<void> | undefined
    if (fiber !== undefined) {
      try {
        disposing = Promise.resolve(fiber.dispose())
      } catch (error) {
        this.ctx.logger.warn('whale-mcp: disposing server %s failed synchronously: %o', id, error)
      }
      if (disposing === undefined) {
        settled.resolve()
      } else {
        disposing.then(() => settled.resolve(), (error) => {
          this.ctx.logger.warn('whale-mcp: disposing server %s failed: %o', id, error)
          settled.resolve()
        })
      }
    }
    const record: DisposalRecord = {
      settled: settled.promise,
      waitFor: boundMs => Promise.race([
        settled.promise.then(() => true),
        delayFalse(boundMs),
      ]),
    }
    return record
  }

  /**
   * Attach the ONE late-settlement watcher for a cell's disposal: whenever
   * the disposal eventually settles (possibly long after the manager stopped
   * waiting), the cell demotes from `stuck` to an ordinary recoverable
   * failure — or a stranded record is released. Idempotent per cell, and the
   * only place the watcher is attached, so it can never be double-attached.
   * @param cell - the cell whose disposal is being observed.
   * @param record - the disposal record to watch.
   */
  private watchDisposal(cell: ServerCell, record: DisposalRecord): void {
    if (cell.watched) return
    cell.watched = true
    void record.settled.then(() => this.settleStuck(cell))
  }

  /**
   * Record the honest `stuck` truth on a cell whose disposal never settled.
   * The late-settlement watcher (see {@link watchDisposal}) keeps observing
   * the disposal, so ownership is retained for the fiber's whole life.
   * @param cell - the cell whose disposal is wedged.
   * @param record - the wedged disposal record.
   */
  private markStuck(cell: ServerCell, record: DisposalRecord): void {
    if (cell.state !== 'stuck') {
      cell.state = 'stuck'
      cell.error = `cleanup of the previous mount did not settle within ${this.disposeAbandonMs}ms — the server may still own its tools and namespace until it settles; restart the Host process if it stays stuck`
    }
    this.watchDisposal(cell, record)
  }

  /**
   * Late-settlement continuation: a stuck cell becomes an ordinary failed
   * cell (restart-to-retry), and stranded records are released with a log.
   * @param cell - the cell whose disposal finally settled.
   */
  private settleStuck(cell: ServerCell): void {
    for (const record of this.stranded) {
      if (record.cell !== cell) continue
      this.stranded.delete(record)
      this.ctx.logger.info('whale-mcp: stranded mount for server %s settled', record.id)
      break
    }
    if (this.cells.get(cell.id) !== cell) return
    if (cell.state !== 'stuck') return
    cell.state = 'failed'
    cell.error = 'previous mount cleanup eventually settled — restart to retry'
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
   * Resolve the exact mount identity behind one model-facing tool name from
   * the origin stamp its bridge put on the registered definition. Names not
   * registered by a whale mount resolve to `undefined` — a public name is
   * never parsed to recover a server.
   * @param toolName - the model-facing public tool name.
   * @returns the owning server's configured name, or undefined.
   */
  private owningServerName(toolName: string): string | undefined {
    return toolOriginOf(this.ctx.tools.get(toolName))?.serverName
  }

  /**
   * Group model-facing tool names by the server whose mount registered them,
   * read from the live global registry via the origin stamp. Tools from
   * non-whale registrations carry no stamp and are attributed to nobody.
   * @returns one bucket of public and display-safe local names per owning server name.
   */
  private toolsOwnedBy(): Map<string, { publicNames: string[]; localNames: string[] }> {
    const owned = new Map<string, { publicNames: string[]; localNames: string[] }>()
    for (const schema of this.ctx.tools.schemas()) {
      const origin = toolOriginOf(this.ctx.tools.get(schema.name))
      if (origin === undefined) continue
      let bucket = owned.get(origin.serverName)
      if (bucket === undefined) owned.set(origin.serverName, bucket = { publicNames: [], localNames: [] })
      bucket.publicNames.push(schema.name)
      bucket.localNames.push(origin.rawName)
    }
    return owned
  }
}

/**
 * Read a registered definition's bridge provenance through the bridge's own
 * read-only accessor — never from any public metadata a lookalike could carry.
 */
function toolOriginOf(definition: unknown): McpToolOrigin | undefined {
  return getMcpToolOrigin(definition)
}

/**
 * A promise that rejects after `ms`, racing a mount's startup. The timer
 * never holds the process open on its own; the tick mutates the caller's
 * `abandoned` flag before rejecting so the handler can distinguish a
 * bridge-reported failure from a manager-net abandonment.
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

/**
 * A promise that resolves `false` after `ms` — the lose side of a bounded
 * wait raced against a disposal's settlement. Never holds the process open
 * on its own and never rejects.
 * @param ms - the bound.
 * @returns the timer promise.
 */
function delayFalse(ms: number): Promise<false> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    timer.unref()
  })
}

export default WhaleMcpService
