# `@deepseek-ai/dsh-whale-trash`

The Whale undo layer. A `tools/execute` wrapper backs every existing target of a guarded mutation (`write`, `edit`, `xlsx_create`, `pptx_create`, `docx_create`) up to `<workspace>/.whale-trash/` **before** the dispatch, and two model-facing tools expose the layer:

- `whale_trash_list` — the current workspace's backups (backup path, original name, size).
- `whale_trash_restore { backup }` — writes one backup back over its original path.

Backups are raw byte copies made through the fs seam, so the trash survives restarts and the sandbox policy applies to restores. Nothing about the trash touches the model's context; the guidance section points the model at the tools.

## Composition

Mount `@deepseek-ai/dsh-whale-trash` on the host plane (after `ctx.fs`); its tools register globally. Config: `directory` (default `.whale-trash`), `maxBackupBytes` (default 50 MiB).

## Model Experience

### What the model sees

One `whale:trash` guidance paragraph plus the two tool schemas.

### Token effect

~40 tokens one section per session.

## Known Limitations and Deferred Work

- Backups are per-workspace files, not session-log entries: no browser undo surface yet (restore is model-driven).
- Files above `maxBackupBytes` are skipped silently.
