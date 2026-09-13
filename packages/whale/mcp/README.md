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
- Startup is bounded: every mount carries a manager-owned startup deadline (default 30 s) into the bridge, so a server whose initial connection never settles fails visibly (`failed`, with a restartable error) instead of holding the serialized reconcile queue — and every later server, settings edit, or restart — forever. The manager additionally bounds the wait itself as a net; a healthy later server still mounts after an earlier one hangs.
- Internal state tracks only live servers: removing or disabling an entry drops its record (including a failed one), while a still-enabled unchanged entry keeps its visible `failed` status instead of being silently retried on every unrelated edit.
- Duplicate `name` across enabled entries: the bridge's own reservation check rejects the later mount, and that server shows `failed` with the actionable message.
- `mcpStatus.list()` merges manager state (`connecting` / `connected` / `failed` / `stuck` / `disabled`) with tools read from the live registry at call time, so a bridge that re-synced (`list_changed`, reconnect) is reflected without any push channel. Tool ownership is EXACT, never inferred from the public name: the bridge records each definition's mount identity (server name plus raw wire name) in module-private provenance, exposed only through its read-only `getMcpToolOrigin()` accessor, and each row lists the tools whose provenance names this server's own mount — public `toolNames` plus display-safe `localToolNames`. Definitions created by anything else (including same-process plugins stamping lookalike metadata) resolve to no owner and land under no row. Prefix parsing cannot be made sound: with servers `a` and `a__b` both configured, the public name `mcp__a__b__t` (raw `b__t` on server `a`) matches `a__b`'s namespace too, and a disabled or stale configured name would steal attribution.
- Only a config change or an explicit `mcpStatus.restart({ id })` remounts a `failed` server: the cell keeps the fingerprint of the attempted config, so unrelated edits to other servers never silently retry it. Restart disposes the fiber and mounts again — the recovery path once the cause is addressed.
- Wedged mounts are reported honestly as `stuck`: if a fiber neither settles nor disposes (a child wedged below the bridge), the manager abandons the wait, keeps the fiber handle, and blocks duplicate remounts — a second bridge could not take the namespace while the old child may still own it. Restart re-arms a bounded wait on the SAME disposal (never a second dispose); a disposal that eventually settles demotes the cell to an ordinary recoverable `failed`; one that never settles keeps the row `stuck` with an actionable message, and a Host process restart is the recovery. A removed entry whose cleanup is wedged stays retained as a stranded record until it settles, so no child leaks invisibly.
- First-use approval: a `tools/pre-execute` fence asks before a session's first call of each MCP tool (`run MCP tool "mcp__x__y" from server "x"?`). The server clause comes from the bridge's read-only provenance accessor — the same exact-ownership source as status grouping; the session's audit log is the memory — one allowed-once grant per tool per session; sessions under the never-prompt policy (danger-full-access) run unfenced, exactly like the whale guardrails overwrite fence. The grant key is the ask reason — (tool name, resolved owner) — so a grant intentionally survives remounts of a same-named server within the session, including a reconfigured one: server settings are user-authorized edits and the tool identity the model sees is unchanged, which is the declared per-tool-per-session policy. A definition without bridge-recognized provenance can never produce the server-clause reason, so it always asks fresh and can never ride a legitimate tool's grant.

## Model Experience

#### What the model sees

Every tool advertised by a connected server appears as a native tool named `mcp__<name>__<rawTool>` with the server's description and schema, plus one approval card on the session's first use of each tool. Removal or disablement unregisters the tools immediately.

#### Token effect

Data-dependent schema cost is paid while tools are registered; a re-sync replaces rather than accumulates definitions (see the bridge README for the KV-cache contract).

## Known Limitations and Deferred Work

- **No automatic remount of a failed startup** — a server that fails at boot stays `failed` until the user saves, re-enables, or restarts it; a `tools/list_changed` re-sync after a successful start is the bridge's own behavior.
- **A wedged fiber requires a process restart** — if a mount's disposal never settles, the row stays `stuck` and duplicate remounts are blocked by design; the manager cannot kill same-process code that ignores cancellation, so an honest `stuck` plus Host restart beats leaking or double-mounting.
- **Resources and Prompts are not bridged** — tools only, same as the underlying bridge.
- **No pre-save connection test** — the status snapshot plus restart covers validation after a save; probing an unsaved draft is future work.
