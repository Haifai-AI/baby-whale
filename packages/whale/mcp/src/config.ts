/**
 * The `mcp` settings namespace: one array of server entries, ecosystem-shaped
 * (stdio command/args/env, streamable-http url/headers) so a Claude Desktop
 * style `mcpServers` JSON block maps onto it field-for-field. The manager
 * mounts one `@deepseek-ai/dsh-mcp-client` bridge per enabled entry.
 * @module @deepseek-ai/dsh-whale-mcp/config
 */

import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { Config as BridgeConfig } from '@deepseek-ai/dsh-mcp-client'

/** Valid bridge namespace: the `name` field of one server entry. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Default per-tool-call timeout (ms), matching the bridge's own default. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** One user-configured MCP server. */
export interface McpServerEntry {
  /** Stable user-section identity; the mount key, never sent to the server. */
  readonly id: string
  /**
   * Model-facing namespace (`mcp__<name>__<tool>`); `[A-Za-z0-9_-]{1,32}`,
   * unique across enabled servers.
   */
  readonly name: string
  readonly enabled: boolean
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio only: executable to spawn. */
  readonly command: string
  /** stdio only: argument vector, no shell interpolation. */
  readonly args: readonly string[]
  /** stdio only: extra env vars merged on top of the scrubbed ambient env. */
  readonly env: Readonly<Record<string, string>>
  /** stdio only: child working directory. */
  readonly cwd: string
  /** streamable-http only: MCP endpoint URL. */
  readonly url: string
  /** streamable-http only: extra request headers (e.g. auth tokens). */
  readonly headers: Readonly<Record<string, string>>
  /** Per-tool-call timeout in milliseconds. */
  readonly toolCallTimeoutMs: number
}

/** The whole `mcp` settings section. */
export interface McpSettings {
  readonly servers: readonly McpServerEntry[]
}

/**
 * Environment and headers stay PLAIN (not secret-role) fields on purpose: the
 * settings wire is loopback-only, whole-array saves would silently blank
 * secret-role values the read path never returned, and the import source
 * (Claude Desktop style JSON) stores tokens in plaintext anyway.
 */
export const McpServerEntrySchema: Schema<McpServerEntry> = z.object({
  id: z.string().required(),
  name: z.string().required().pattern(SERVER_NAME_PATTERN),
  enabled: z.boolean().default(true),
  transport: z.union([z.const('stdio'), z.const('streamable-http')]).default('stdio'),
  command: z.string().default(''),
  args: z.array(String).default([]),
  env: z.dict(String).default({}),
  cwd: z.string().default(''),
  url: z.string().default(''),
  headers: z.dict(String).default({}),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
}) as unknown as Schema<McpServerEntry>

/** The whole-section schema registered under the `mcp` namespace. */
export const McpSettingsSchema: Schema<McpSettings> = z.object({
  servers: z.array(McpServerEntrySchema).default([]),
}) as unknown as Schema<McpSettings>

/**
 * Project one entry onto the bridge plugin's config shape. The bridge's own
 * schemastery schema fills the remaining defaults; reconnect policy is left
 * to the bridge defaults (enabled, capped backoff).
 * @param entry - the saved user entry.
 * @param startupTimeoutMs - the manager-owned startup bound for the mount;
 * the bridge default applies when omitted.
 * @returns config for one `@deepseek-ai/dsh-mcp-client` instance.
 */
export function toBridgeConfig(entry: McpServerEntry, startupTimeoutMs?: number): BridgeConfig {
  const common = {
    serverName: entry.name,
    toolCallTimeoutMs: entry.toolCallTimeoutMs,
    // Bounded startup: the bridge fails its own fiber when the initial
    // connection + tool sync exceed the bound, so one hanging external server
    // cannot hold its mount (and the serialized reconcile queue) forever.
    ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
    // Observability: a failed initial connection must REJECT the mount so the
    // manager can record a failed status; the bridge's reconnect loop only
    // engages after a first successful connection.
    failOnStartupError: true,
  } as const
  if (entry.transport === 'streamable-http') {
    return {
      transport: 'streamable-http',
      ...common,
      url: entry.url,
      headers: { ...entry.headers },
    }
  }
  return {
    transport: 'stdio',
    ...common,
    command: entry.command,
    args: [...entry.args],
    env: { ...entry.env },
    cwd: entry.cwd,
  }
}

/**
 * Canonical form used to decide "did this entry change" without remounting
 * untouched servers: JSON of exactly the fields the bridge consumes.
 * @param entry - the saved user entry.
 * @returns a stable string hash input over the mount-relevant fields.
 */
export function mountFingerprint(entry: McpServerEntry): string {
  return JSON.stringify(toBridgeConfig(entry))
}
