# whale/

English | [中文](README.zh.md)

Whale: the knowledge-work coworker layer of dsh — the scheduled-task store, the coworker guards, the MCP manager, the undo layer, and the `deliver` tool.

## Packages

| Package | Owns | `ctx` key |
|---|---|---|
| [`core/`](core/README.md) | Durable workspace task store over storage domains, IANA-timezone cron scheduling, HQ-session delivery, and the model-facing `whale_task_*` tools | `ctx.whaleTasks` |
| [`guardrails/`](guardrails/README.md) | Approval-first overwrite fence, workspace-escape denial, untrusted-content guidance | — |
| [`mcp/`](mcp/README.md) | The `mcp` settings namespace mounted as live MCP servers, with per-server status and remount | `ctx.mcpStatus` |
| [`tool-deliver/`](tool-deliver/README.md) | The model-facing `deliver` tool: claim finished workspace files as user-facing deliverables | — |
| [`trash/`](trash/README.md) | Backup of every overwritten file into `<workspace>/.whale-trash`, with model-facing list and restore tools | — |
