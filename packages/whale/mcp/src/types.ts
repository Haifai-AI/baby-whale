/**
 * Client-safe wire vocabulary of the whale MCP manager: the per-server status
 * view the Settings tab renders. Types only — no runtime code, nothing here
 * reaches a Host-only symbol.
 * @module @deepseek-ai/dsh-whale-mcp/types
 */

/** Lifecycle state of one configured MCP server's connection. */
export type McpServerState =
  /** Configured and enabled; the bridge fiber is mounting/connecting. */
  | 'connecting'
  /** Initial connection and tool discovery succeeded. */
  | 'connected'
  /** The initial connection or tool synchronization failed. */
  | 'failed'
  /**
   * A previous mount wedged below the bridge: its fiber neither settled nor
   * disposed, so it may still own tool registrations and its server-name
   * namespace. No remount is attempted (a duplicate could not take the
   * namespace anyway); an explicit restart re-arms a bounded wait, and a Host
   * process restart is the recovery when the fiber never settles.
   */
  | 'stuck'
  /** Configured but disabled by the user. */
  | 'disabled'

/**
 * One configured MCP server as the Settings tab renders it. `id` is the
 * user-section identity (stable across edits); every other field mirrors the
 * saved section. `toolNames`/`localToolNames` reflect the registry as of the
 * read, attributed by the owning mount's recorded identity — never by parsing
 * the public name.
 */
export interface McpServerStatus {
  readonly id: string
  /** The model-facing namespace (`mcp__<name>__<tool>`). */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio command or HTTP endpoint URL — one display line per transport. */
  readonly target: string
  readonly enabled: boolean
  readonly state: McpServerState
  /** Present when `state` is `'failed'`/`'stuck'`: the actionable failure message. */
  readonly error: string | null
  /**
   * Model-facing public names this server's mount registered, as of the read.
   * Exact ownership: each name was registered by THIS server's bridge mount
   * (its recorded origin), so a public name that merely shares a prefix with
   * another server's namespace is never listed here.
   */
  readonly toolNames: readonly string[]
  /**
   * Display-safe local (raw) tool names behind {@link toolNames}, in the same
   * order — the UI renders these instead of stripping a prefix off the public
   * name.
   */
  readonly localToolNames: readonly string[]
}

/** Point-in-time snapshot returned by the `mcpStatus` Remote. */
export interface McpStatusSnapshot {
  readonly servers: readonly McpServerStatus[]
}

/** Request vocabulary of the `mcpStatus.restart` Remote method. */
export interface McpRestartRequest {
  /** The settings-section id of the server to remount. */
  readonly id: string
}
