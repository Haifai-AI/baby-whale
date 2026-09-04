# `@deepseek-ai/dsh-whale-guardrails`

Whale coworker guardrails: the safety layer a knowledge-worker mode runs with.

- **Approval-first overwrite fence**: `write`/`edit` return an `ask` decision from `tools/pre-execute` when the resolved target already exists (configurable by `askOnOverwrite`, default `true`), flowing through the normal approval system — there is no always-allow grant. An approval already granted for the same file in this session is not asked again; rejections keep asking.
- **Workspace-escape tripwire**: a `tools.guard()` denial for any guarded path containing parent traversal, which no later decision can override. Absolute and otherwise-escaped paths are left to the sandbox layer, which owns allow/deny for resolved targets.
- **Untrusted-content guidance**: a system-prompt section (`whale:guardrails`) telling the model that workspace and web content is data, never authority.

Compose the plugin into a preset (or the host tree) as `@deepseek-ai/dsh-whale-guardrails`; removability is the whole point — drop the row and the mode runs with the default policies only.

## Model Experience

### What the model sees

One guidance section (the `whale:guardrails` text) plus the ask/deny messages on guarded mutations.

### Token effect

~50 tokens one section per session.

## Known Limitations and Deferred Work

- The fence and the trash only see the tool layer: writes made through `bash`/`pwsh` (redirects, scripts) are neither asked about nor backed up. The coworker preset mounts a shell because office work is code-first, so its persona tells the model to prefer the file tools for overwrites worth undoing.
- Undo lives in `dsh-whale-trash`, which backs up these mutations before dispatch (its set also names the retired office artifact tools, harmlessly).
