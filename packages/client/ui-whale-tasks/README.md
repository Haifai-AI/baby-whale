# `@deepseek-ai/dsh-client-ui-whale-tasks`

English | [中文](README.zh.md)

Whale task board for the Web GUI: one keyed chat node (`whale-task-board`) rendering each `whale/task-board` snapshot (emitted by `@deepseek-ai/dsh-whale-core` after every task mutation or delivery) as a compact scheduled-task list — status dot, name, schedule summary, and next run.

The board is a pure render of the durable event: replay recomputes it from the session log, and an absent snapshot renders nothing.

## Composition

The package declares `dsh.client` (platform `web`), ships `./client`, and registers the event definition plus the keyed renderer and the `whale-tasks` dictionary namespace. Remove its roster row to turn the board off.

## Rendering contract

Every `whale/task-board` event becomes its own node with `id` set to the event `seq` and `publication: 'immediate'`, so the projection holds no fold: the newest snapshot arrives as a new card instead of updating the previous one, and replaying the log reproduces the same sequence of cards. An empty snapshot still renders the card, with the empty-state line in place of the rows.

Each row draws the localized status dot (`active` / `paused` / `done`), the task name, the schedule summary beside the localized status, and a next-run line — the localized instant, the placeholder `—` when `nextRunAt` is null or unparseable, or the missed copy once an active task is more than 90 seconds past its scheduled instant. The same 90-second window gates the completion notification, which fires at most once per landed snapshot and only while `Notification.permission` is already `granted` and the tab is hidden.

## Model Experience

### Whale task-board chat node

#### What the model sees

Nothing: the board renders the whole-value `whale/task-board` session event `@deepseek-ai/dsh-whale-core` emits after each task mutation or delivery. That event is log-only UI state recorded so replay can rebuild the card; this package registers no prompt section, no tool definition, and no result text, and scheduling reaches the model only through the host package's `whale_task_*` results.

#### Token effect

Zero direct effect: the node adds no prompt text and no tool definition, and the durable event it renders is never part of an assembled request.

#### KV Cache effect

Independent: the package assembles and sends no provider request, so mounting or removing the board changes the browser tree only and cannot invalidate a reusable prefix.

## Known Limitations and Deferred Work

- **The board is read-only** — rows carry no actions; creating, pausing, and finishing tasks happen through the `whale_task_*` tools.
- **One card per snapshot** — each snapshot is a separate chat node keyed by its event `seq`, so a burst of mutations leaves one card per snapshot instead of folding into a single live board.
- **Only the next run is drawn** — the row has no last-run line; `lastRunAt` reaches the node but drives only the notification heuristic, and the dictionaries keep an unused `board.lastRun` key.
- **Overdue is a client-side 90-second heuristic** — the browser clock decides whether a next run was missed, so a task whose run time has just passed still shows the literal instant while the host scheduler may already be late.
- **The completion notification is best-effort** — it fires only for a snapshot that lands within 90 seconds of a recorded `lastRunAt`, while the permission is already granted and the tab is hidden; there is no push channel, so a delivery that arrives with the tab visible passes silently.
