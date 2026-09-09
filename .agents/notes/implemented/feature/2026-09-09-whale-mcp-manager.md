# Agent Note: The MCP ecosystem plugs in — user-configured servers, live status, first-use approval

Status: implemented

English | [中文](2026-09-09-whale-mcp-manager.zh.md)

## Problem

Baby Whale's tools all lived inside the app. The MCP ecosystem — thousands of community servers for filesystems, GitHub, databases, browsers — was unreachable: the harness shipped a mature client bridge (`@deepseek-ai/dsh-mcp-client`), but it could only be configured by hand-editing `cordis.yml`, which a product user must never have to do. Connecting a server also meant trusting it: an arbitrary external tool would have reached the model with no permission surface of its own.

## Decision

One host-plane manager plugin (`@deepseek-ai/dsh-whale-mcp`) turns a user-settings section into live servers, and one browser tab (`ui-settings-mcp`) turns the section into something a user can curate:

- **Settings-driven mounts.** The `mcp` namespace holds one array of server entries (stdio and streamable-http, field-for-field compatible with the `claude_desktop_config.json` shape). The manager watches the section and reconciles the mount set: one bridge fiber per enabled entry, mounted with `failOnStartupError: true` so a bad server is a visible `failed` status instead of a silently empty tool set. Edits diff by entry `id` plus a fingerprint over the bridge-consumed fields — untouched servers never restart. A server that dies after a successful start is the bridge's reconnect supervisor's job; a server that fails to START is the user's to retry via the tab's Restart button (`mcpStatus.restart`), which is the honest split because a startup failure usually needs a human's fix.
- **Status is pulled, not pushed.** `mcpStatus.list()` merges manager state (connecting/connected/failed/disabled) with tool names enumerated from the live registry at call time. No push channel, no second lifecycle truth; the tab refetches after saves at +600 ms/+2500 ms to let `connecting` settle.
- **First-use approval.** A `tools/pre-execute` fence asks before a session's first call of each MCP tool, with the session audit log as memory — the exact pattern of the whale guardrails overwrite fence, including standing down under the never-prompt policy where an ask would be auto-rejected unseen. The grant is per tool, not per server: one import of a server's tool surface should not blanket-authorize its writes.
- **Secrets stay plain, on purpose.** `env`/`headers` are ordinary fields: the settings wire is loopback-only, whole-array saves would silently blank secret-role values the read path never returns, and the import source stores tokens in plaintext anyway. Documented rather than pretended away.

The pair follows two existing extension seams without widening them: the manager is also the `mcpStatus` Typert Remote (same shape as plugin-inventory), and the tab is a `settings.plugins.tab` contribution writing through the standard settings RPC — the manager owns no custom transport of its own.

## Alternatives considered

- **Bridge per server in composition YAML**: zero new code, but configuration leaves the product and every edit becomes a file edit plus restart; rejected — the product's users do not edit compositions.
- **A generic "dynamic plugins" settings surface**: more reusable, but it would expose cordis machinery (plugin names, fiber semantics) as UI vocabulary; rejected in favor of a domain-shaped `mcpServers` surface the ecosystem already knows how to write.
- **Push status over a forwarded event**: fresher dots, but adds an allowlist entry and an event contract for data that is cheap to pull at exactly the moments it changes; rejected for v1.
- **Auto-remount retry loops for failed startups**: would have hidden failing configs behind churn and multiplied the crash-loop noise the bridge's own budget exists to cap; rejected.

## Consequences

Adding an MCP capability to Baby Whale is now a settings save, and every tool arrives with a permission story. The manager trusts the bridge's lifecycle rules (name collisions, reconnect budgets, schema drift) rather than re-owning them, so bridge behavior changes flow through; in exchange, restart-on-failure is manual and statuses are as fresh as the last pull. When Baby Whale later becomes an MCP *server* itself, this manager gives it the client half of the same story.
