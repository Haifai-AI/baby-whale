# @deepseek-ai/dsh-tool-deliver

English | [中文](README.zh.md)

The `deliver` model-facing tool: claim finished workspace files as user-facing deliverables. Claim semantics only — the file must already exist, and `deliver` never writes, moves, or mutates anything.

## What it does

One tool, `deliver(paths)`, registered on `ctx.tools`. Each path resolves against the calling session's workspace (`exec.agent.session.header.cwd`), is confirmed through the sandboxed fs seam to exist as a file, and its byte size is read from the same stat. The successful result carries `{ delivered: [{ path, size }] }`.

Calls are bounded to one through ten paths; zero or eleven paths fail with `deliver requires between 1 and 10 paths`, and the first claimed path that is missing or is not a file fails the whole call with `deliver: "<path>" does not exist in the workspace`. No partial claim is emitted, so a bad path produces no cards at all.

Surfacing rides the render-intent pipeline: the call presents an edit-shaped card whose `locations` are the claimed paths, and the conversation turn tail aggregates it into end-of-turn deliverable chips exactly like every other mutation tool. Unloading the plugin removes the tool and the chips with it.

## The post-execute nudge

The package installs one `tools/post-execute` listener. When a successful `bash` result contains a text block matching `deliverables/` and no `deliver` call has succeeded yet this turn, it appends one `<system-reminder>` context message telling the model to deliver the finished files. The reminder goes through `additionalContexts` with the plugin source stamp `tool-deliver`, so the transcript renders a collapsed context row instead of a bubble impersonating the human.

The listener is deliberately narrow: it fires at most once per turn, never on a failed bash result, never on a non-text block, and never for another tool. A downstream listener's decision is preserved — a replaced result keeps its replacement alongside the reminder, and a non-accept decision passes through untouched.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` with NO default export, so the bundle row can be dropped without leaving anything else behind. It joins the `post-execute` waterfall and calls `next()` on every path that does not emit a reminder.

## Model Experience

### `tool:deliver` system-prompt guidance

#### What the model sees

One fixed guidance section registered as `tool:deliver` at order 107, telling the model that finished user-facing files belong under `deliverables/` and must be claimed with `deliver`.

##### Verbatim `tool:deliver` section text

```markdown
After finishing any user-facing file (spreadsheet, deck, document, PDF, code export…) under deliverables/, call deliver with its path so it appears as a received deliverable card. Deliver each finished file exactly once.
```

#### Token effect

Fixed: one prompt paragraph on every assembled request for as long as the plugin is mounted, independent of how many files a session delivers.

#### KV Cache effect

Prefix-stable: the section text and its order never change after mount, so the reusable request prefix that contains it survives every deliver call; only unloading or re-scoping the plugin invalidates reuse from that section.

### `deliver` tool definition

#### What the model sees

The generated [`deliver` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-deliver): one required `paths` array of strings, described as workspace-relative paths of finished files, one to ten entries.

#### Token effect

Fixed schema cost on every request where the tool is visible, plus the model's own submitted path strings retained in history with the call.

#### KV Cache effect

Prefix-stable while the definition and its visibility are unchanged. Plugin lifecycle or scoped restrictions that change the registered tool set may invalidate reuse from this definition.

### Deliver call and result

#### What the model sees

On success, one `<delivered>` block listing `<file path="<path>" bytes="<size>"/>` per claimed entry. Stable failures are `deliver requires between 1 and 10 paths` and `deliver: "<path>" does not exist in the workspace`. The chips the user sees are UI state derived from the call's locations, not a second model message.

#### Token effect

Append-only and caller-scaled: the result is small, but each claimed path is echoed in the arguments and the result and stays until compaction. The per-turn nudge adds one short reminder message only when the bash heuristic triggers, so a scripted turn can pay for one extra message it did not ask for.

#### KV Cache effect

Append-only: the call, its result, and any reminder follow the reusable request prefix instead of rewriting it. The listener's per-turn flags are plugin state, not request content, so triggering the reminder never invalidates cached prefix tokens.

## Known Limitations and Deferred Work

- **`deliver` claims files; it does not produce them** — nothing is rendered, converted, or moved, so a claimed path that a later step overwrites makes the card stale until the model calls `deliver` again.
- **The human sees no deliverable until the model calls it** — a file written through any tool other than a successful deliver call is invisible in the deliverable chips, which is why the nudge exists and why removing the plugin removes the whole surface.
- **The nudge is one `bash` heuristic** — a successful `bash` result must contain a text block matching `deliverables/`; `pwsh`, other tools, failed results, and matches that live in non-text blocks never trigger it, and it fires at most once per turn.
- **Ten paths per call** — claiming more finished files needs a second call; there is no glob, directory, or recursive claim.
- **`deliver` has no undo entry and no trash backup** — it mutates nothing, so the whale trash wrapper never snapshots it, and a mistaken claim is corrected only by claiming the right file.
- **Every claimed path is retained in history** — a session that delivers large batches repeatedly pays for the repeated arguments and results until compaction.
