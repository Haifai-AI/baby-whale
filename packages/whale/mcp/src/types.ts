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
  /** Configured but disabled by the user. */
  | 'disabled'

/**
 * One configured MCP server as the Settings tab renders it. `id` is the
 * user-section identity (stable across edits); every other field mirrors the
 * saved section, and `toolNames` reflects the registry as of the read.
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
  /** Present when `state` is `'failed'`: the actionable failure message. */
  readonly error: string | null
  /** Model-facing names registered by this server at read time. */
  readonly toolNames: readonly string[]
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
