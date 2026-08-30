# `@deepseek-ai/dsh-whale-core`

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

### What the model sees

One `whale:tasks` guidance paragraph plus the six tool schemas. `whale_task_create` takes a name, full instructions, and a `{kind, at|expr, tz}` schedule.

### Token effect

One guidance section + schemas; constant per session.

## Known Limitations and Deferred Work

- Delivery needs the owning session's agent live; there is no wake-a-cold-session channel yet.
- Cron grammar supports numeric fields only (no month/day names, no `?`/`L`/`#`).
- The board snapshot is appended only while the owning session is live; a cold session catches up on its next live mutation.
