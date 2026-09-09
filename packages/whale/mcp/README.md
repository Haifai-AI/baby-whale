# @deepseek-ai/dsh-whale-mcp

English | [中文](README.zh.md)

Whale MCP manager: the host-plane plugin that turns the `mcp` settings namespace into live MCP servers, so the whole Model Context Protocol ecosystem plugs into Baby Whale without touching a YAML file.

Each enabled entry in the section mounts one [`@deepseek-ai/dsh-mcp-client`](../../mcp/mcp-client/README.md) bridge fiber — a stdio child process or a Streamable HTTP connection — whose tools join the shared `ctx.tools` registry under server-qualified model-facing names (`mcp__<name>__<rawTool>`). Editing the section in Settings reconciles the mount set: untouched servers keep their fibers, changed servers remount, disabled or removed servers unwind. The plugin is also the `mcpStatus` Remote: the Settings tab reads live per-server state and tool lists from it and can force one server's remount.

## Config

The `mcp` settings namespace is one array of server entries:

| Field | Transport | Description |
|---|---|---|
| `id` | both | Stable section identity (generated, never sent to the server). |
| `name` | both | Model-facing namespace; `[A-Za-z0-9_-]{1,32}`, unique across enabled servers. |
| `enabled` | both | Disabled entries keep their saved fields but mount nothing. |
| `transport` | both | `"stdio"` or `"streamable-http"`. |
| `command` / `args` / `env` / `cwd` | stdio | Child process launch, merged over the scrubbed ambient env. |
| `url` / `headers` | streamable-http | MCP endpoint and extra request headers. |
| `toolCallTimeoutMs` | both | Per-tool-call timeout (default 60000). |

The bridge mounts with `failOnStartupError: true`, so a failed initial connection is a visible `failed` status rather than a silently empty tool set; the bridge's own reconnect loop still covers a connection lost AFTER a successful start. Environment values and headers are deliberately plain fields, not secret-role: the settings wire is loopback-only, whole-array saves would silently blank secret-role values the read path never returns, and the import source (Claude Desktop style JSON) stores tokens in plaintext anyway.

## Behavior

- On section change: diff by saved `id` plus a fingerprint over the bridge-consumed fields. New and changed enabled entries mount (serially, one reconcile pass at a time); disabled, removed, and changed entries dispose. Reconcile failures are contained and logged — one bad server never blocks the others.
- Duplicate `name` across enabled entries: the bridge's own reservation check rejects the later mount, and that server shows `failed` with the actionable message.
- `mcpStatus.list()` merges manager state (`connecting` / `connected` / `failed` / `disabled`) with tool names read from the live registry at call time, so a bridge that re-synced is reflected without any push channel.
- `mcpStatus.restart({ id })` disposes one server's fiber and mounts it again — the recovery path for a `failed` server once its cause is addressed.
- First-use approval: a `tools/pre-execute` fence asks before a session's first call of each MCP tool (`run MCP tool "mcp__x__y" …?`). The session's audit log is the memory — one allowed-once grant per tool per session; sessions under the never-prompt policy (danger-full-access) run unfenced, exactly like the whale guardrails overwrite fence.

## Model Experience

#### What the model sees

Every tool advertised by a connected server appears as a native tool named `mcp__<name>__<rawTool>` with the server's description and schema, plus one approval card on the session's first use of each tool. Removal or disablement unregisters the tools immediately.

#### Token effect

Data-dependent schema cost is paid while tools are registered; a re-sync replaces rather than accumulates definitions (see the bridge README for the KV-cache contract).

## Known Limitations and Deferred Work

- **No automatic remount of a failed startup** — a server that fails at boot stays `failed` until the user saves, re-enables, or restarts it; a `tools/list_changed` re-sync after a successful start is the bridge's own behavior.
- **Resources and Prompts are not bridged** — tools only, same as the underlying bridge.
- **No pre-save connection test** — the status snapshot plus restart covers validation after a save; probing an unsaved draft is future work.
