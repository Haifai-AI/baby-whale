# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

The **MCP servers** tab in Web Settings → Plugins: the management surface over the [`whale-mcp`](../../../whale/mcp/README.md) host plugin. Users add, edit, enable, import, restart, and remove MCP servers; the tab shows each server's live connection state and the tools it currently offers the model.

## What appears here

The tab registers one `settings.plugins.tab` contribution (`id: mcp`) into the Plugins section, rendered as a header line (server count, **Add server**, **Import JSON**), an empty state, and one disclosure card per saved server. A collapsed card shows the server's name, a transport badge (local process / HTTP), a colored status dot with its localized label (`connected` / `connecting` / `failed` / `disabled`), and a chevron. Expanding reveals the target line (command with arguments, or endpoint URL), the failure message when the state is `failed`, the tool list as compact chips (the `mcp__<name>__` prefix is stripped for reading), and the action row: an enable switch, **Edit**, **Delete** (with an inline confirm), and **Restart** for enabled servers.

Statuses come from one point-in-time `mcpStatus.list()` read per mount/retry, refetched after every save/restart at +600 ms and +2500 ms so a `connecting` dot settles into its truth without a push channel.

## Writes

The tab binds the `mcp` settings scope (`ctx.settingsScope`) and writes the whole `servers` array through it — every save is one revision-fenced `settings.mutate` field write whose answer folds back into the shared mirror. A save that did not land (concurrent edit, schema refusal) reports inline instead of being dropped. Editing stages in a local draft; **Save** is disabled until the name matches the model-facing contract and the transport's required field is present. **Import JSON** parses pasted ecosystem JSON — a claude_desktop_config-style `mcpServers` block or a bare server map — into new entries, legalizing names and suffixing collisions.

## Model Experience

None; this package renders a configuration surface. What it writes reaches the model only through the whale MCP manager and its bridges.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **One snapshot per mount or retry** — statuses do not push; the scheduled refetches after saves cover the common settle window.
- **No pre-save connection test** — validation after save rides the status dot plus **Restart**.
