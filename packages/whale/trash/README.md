# `@deepseek-ai/dsh-whale-trash`

English | [中文](README.zh.md)

The Whale undo layer. A `tools/execute` wrapper backs every existing target of a guarded mutation (`write`, `edit`, `xlsx_create`, `pptx_create`, `docx_create`) up to `<workspace>/.whale-trash/` **before** the dispatch, and two model-facing tools expose the layer:

- `whale_trash_list` — the current workspace's backups (backup path, original name, size).
- `whale_trash_restore { backup }` — writes one backup back over its original path.

Backups are raw byte copies made through the fs seam, so the trash survives restarts and the sandbox policy applies to restores. Nothing about the trash touches the model's context; the guidance section points the model at the tools.

Backup names are `<iso-stamp>__<encoded-path>` where the original workspace-relative path is percent-encoded, so nested targets round-trip exactly. Pre-0.1.5 `<iso-stamp>-<basename>` entries still list and restore (to the workspace root, as written). The backup wrapper is best-effort: a backup failure never blocks the mutation it was snapshotting.

Writes that bypass the tool layer — shell redirects and scripts run through `bash`/`pwsh` — are neither asked about nor backed up. The sandbox still confines them to the workspace.

## Composition

Mount `@deepseek-ai/dsh-whale-trash` on the host plane (after `ctx.fs`); its tools register globally. Config: `directory` (default `.whale-trash`), `maxBackupBytes` (default 50 MiB).

## Model Experience

### `whale:trash` system-prompt guidance

#### What the model sees

One fixed guidance section registered as `whale:trash` at order 109, telling the model where backups live and which two tools read and restore them.

##### Verbatim `whale:trash` section text

```markdown
Overwritten files are backed up under .whale-trash/ in the workspace. Use whale_trash_list to inspect backups and whale_trash_restore to put a prior version back.
```

#### Token effect

Fixed: one prompt paragraph on every assembled request while the plugin is mounted, regardless of how many backups the workspace accumulates.

#### KV Cache effect

Prefix-stable: the section text and its order never change after mount, so the reusable request prefix that contains it survives every backed-up mutation.

### Trash listing and restore results

#### What the model sees

`whale_trash_list` takes no arguments and renders one line per backup as `<original> → <backup> (<size> bytes)`, newest first, or the literal `No backups in .whale-trash.` when the directory is absent or empty. `whale_trash_restore { backup }` renders `Restored <original>.` on success, or `No backup found at "<backup>".` when the named entry is not a file; a `backup` argument containing `..` is refused with `whale trash refuses a backup path outside the workspace`.

#### Token effect

Conditional and caller-scaled: listing output grows with the backup count and each entry carries a full path plus a byte size, so a workspace with many backups pays for all of them on every listing. Every dispatched guarded mutation also retains one tool call and result in history whether or not it produced a backup.

#### KV Cache effect

Append-only: list and restore results follow the reusable request prefix rather than rewriting it, and the backup wrapper itself injects nothing into the model request — a backed-up mutation's own tool call is the only history it adds.

## Known Limitations and Deferred Work

- Backups are per-workspace files, not session-log entries: no browser undo surface yet (restore is model-driven).
- Files above `maxBackupBytes` are skipped silently.
- No retention cap yet: the fs seam has no delete operation, so backups accumulate until the workspace owner removes them. A `maxBackups` prune will follow once the seam grows deletion.
