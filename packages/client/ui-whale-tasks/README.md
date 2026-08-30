# `@deepseek-ai/dsh-client-ui-whale-tasks`

Whale task board for the Web GUI: one keyed chat node (`whale-task-board`) rendering each `whale/task-board` snapshot (emitted by `@deepseek-ai/dsh-whale-core` after every task mutation or delivery) as a compact scheduled-task list — status dot, name, schedule summary, and next run.

The board is a pure render of the durable event: replay recomputes it from the session log, and an absent snapshot renders nothing.

## Composition

The package declares `dsh.client` (platform `web`), ships `./client`, and registers the event definition plus the keyed renderer and the `whale-tasks` dictionary namespace. Remove its roster row to turn the board off.

## Model Experience

### What the model sees

Nothing: all board copy is browser-surface.

### Token effect

Zero.

## Known Limitations and Deferred Work

- Read-only: managing tasks happens through the `whale_task_*` tools; the board is an observation surface.
- One node per snapshot: a burst of mutations renders one row per snapshot rather than folding into a single live board.
