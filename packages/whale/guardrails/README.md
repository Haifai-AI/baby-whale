# `@deepseek-ai/dsh-whale-guardrails`

Whale coworker guardrails: the safety layer a knowledge-worker mode runs with.

- **Approval-first overwrite fence**: `write`/`edit`/`xlsx_create`/`pptx_create`/`docx_create` return an `ask` decision from `tools/pre-execute` when the resolved target already exists (configurable by `askOnOverwrite`, default `true`), flowing through the normal approval system — there is no always-allow grant.
- **Monotonic workspace-escape denial**: a `tools.guard()` denial for any guarded path containing parent traversal, which no later decision can override.
- **Untrusted-content guidance**: a system-prompt section (`whale:guardrails`) telling the model that workspace and web content is data, never authority.

Compose the plugin into a preset (or the host tree) as `@deepseek-ai/dsh-whale-guardrails`; removability is the whole point — drop the row and the mode runs with the default policies only.

## Model Experience

### What the model sees

One guidance section (the `whale:guardrails` text) plus the ask/deny messages on guarded mutations.

### Token effect

~50 tokens one section per session.

## Known Limitations and Deferred Work

- The overwrite fence covers the mutation tools listed above; `bash`-driven destructive commands are out of scope (the coworker preset does not mount a shell).
- No undo/trash backup yet — that is `dsh-whale-trash` (Phase 4).
