# `@deepseek-ai/dsh-whale-core`

English | [中文](README.zh.md)

Whale's durable scheduled-task layer. The HQ-session model: every task names the session that owns it; when the scheduler ticks and the task is due, the task prompt is delivered into that session's **live** agent via `Agent.followup` (queued message — it wakes an idle agent) and the record advances. A session with no live agent keeps its due tasks until the next tick.

## Pieces

- **Durable store** (`ctx.whaleTasks`): one storage-domain table (`whale-tasks` domain, JSON backend) holding every task record — restart-surviving, workspace-scoped, versioned by the domain.
- **Cron + IANA timezone**: five-field cron expressions (`*`, lists, ranges, steps — numbers only) plus named-zone next-arrival computation with DST handling (`src/cron.ts`).
- **HQ scheduler**: periodic tick (config `intervalMs`, default 60s) delivering due tasks into live owning agents and advancing once/cron records.
- **Model-facing tools**: `whale_task_create` (once/cron/manual), `whale_task_list`, `whale_task_pause`, `whale_task_resume`, `whale_task_remove`, `whale_task_run`.
- **Board snapshots**: after every mutation, the owning HQ session's log receives a `whale/task-board` event carrying the whole-workspace task view (log-only UI state, like `todo/write`); the Web board renders from it.

## Composition

Mount `@deepseek-ai/dsh-whale-core` on the host plane (after `storage-domain` with the `json` backend); the tools register globally, so any preset can call them.

## Model Experience

### `whale:tasks` system-prompt guidance

#### What the model sees

One fixed guidance section registered as `whale:tasks` at order 108, telling the model that scheduled work exists and which tools own it.

##### Verbatim `whale:tasks` section text

```markdown
Schedule recurring work with whale_task_create (cron expressions, IANA timezones, or one-shot times). List with whale_task_list, and manage with whale_task_pause/resume/remove. Scheduled tasks run in the owning session when it is open.
```

#### Token effect

Fixed: one short prompt paragraph on every assembled request for as long as the package is mounted, independent of how many tasks the workspace holds.

#### KV Cache effect

Prefix-stable: the section text and its order never change after mount, so a loaded prefix that includes it stays reusable across turns until the plugin is unloaded or re-scoped.

### Whale task tools

#### What the model sees

`whale_task_create`, `whale_task_list`, `whale_task_pause`, `whale_task_resume`, `whale_task_remove`, and `whale_task_run`, each with a fixed schema. Scheduling is inherited from the arguments of `whale_task_create`: `kind` is `once` with an ISO-8601 `at`, `cron` with a five-field `expr` plus an optional IANA `tz`, or `manual` for a task that only `whale_task_run` fires; the four management tools take one required `task_id` string.

#### Token effect

Fixed schema cost on every request where the definitions are visible, plus a workspace-scaled `whale_task_list` result whose rows carry `taskView` — id, name, status (`active`/`paused`/`done`), kind, schedule summary, source timezone, `nextRunAt`, `lastRunAt`, and `workspaceCwd`; `include_done` defaults to false, so finished one-shot tasks drop out of the list unless the model asks for them.

#### KV Cache effect

Prefix-stable while the registered set and visibility are unchanged. Newly visible list results append after the reusable prefix and do not invalidate existing KV-cache entries; a task mutation edits no earlier request content.

### Task delivery message

#### What the model sees

When a task comes due, the scheduler injects one user-role message into the owning session: the exact literal `[whale task] <name>` followed by a blank line and the task's own stored instruction text, with the plugin source stamp `whale-tasks`. `whale_task_run` on a task whose owning session has no live agent reports the string `Task not found.` instead of delivering anything.

#### Token effect

Conditional and unbounded by this package: one message per fire, sized by the stored instructions the human or model wrote at creation. Every fire stays in the session log until compaction.

#### KV Cache effect

Append-only: each delivery appends to the owning session's history and follows the reusable request prefix rather than rewriting it, so an idle-woken session reuses its prefix and pays only for the new message. `whale/task-board` snapshots are log-only UI state and never enter a model request.

## Known Limitations and Deferred Work

- Delivery needs the owning session's agent live; there is no wake-a-cold-session channel yet.
- Cron grammar supports numeric fields only (no month/day names, no `?`/`L`/`#`).
- The board snapshot is appended only while the owning session is live; a cold session catches up on its next live mutation.
