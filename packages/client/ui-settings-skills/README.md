# `@deepseek-ai/dsh-client-ui-settings-skills`

English | [中文](README.zh.md)

The **Skills** section of Web Settings (`settings.section`, `id: skills`, `order: 16`): the discovered skill catalog grouped by discovery source, with one enable switch per skill over the host-owned `skills` settings namespace.

## What appears here

Rows come from one `skills.list` read addressed to a session id: the section prefers a running session and otherwise takes the first entry of the session list, so the catalog shown is the one that session's preset serves. With no session at all the section renders the "open a workspace session" copy and no switches.

Ready rows group by the source token a skill was discovered through, ranked bundled, harness, user-dsh, project-dsh, project-agents, runtime, then custom and every unrecognized token; skills sort by name inside a group. Each row shows the name, a tag naming whether the model may invoke the skill or only a person can, its description, and a switch reading enabled or disabled. An empty catalog states that no skills were discovered and where to put them, and a catalog read that fails falls back to the same unavailable copy as a missing session.

## Writes

The section binds `ctx.settingsScope` to the `skills` namespace and writes the whole `disabled` list through it, one revision-fenced field write per toggle. The row flips as soon as the switch moves, and a scope subscription re-reads the resolved `disabled` array back into the rows, so the resolved value stays the single source of truth: [`dsh-tool-skill`](../../skill/tool-skill/README.md) reads that same setting per evaluation to build the model-facing catalog and to refuse an invocation of a disabled skill.

The catalog re-reads on a 30-second timer while the section is mounted, which is how a skill folder that appears after launch joins the list. The injected toggle is one stable closure rather than a fresh one per read, because the renderer subscribes to it with the snapshot-reference caching the standard kit uses.

## Model Experience

Indirectly, through the `skills.disabled` list it writes: `@deepseek-ai/dsh-tool-skill` reads that setting per evaluation and owns the model-visible catalog entry and the disabled-skill refusal.

#### KV Cache effect

None from this package, which assembles no request; a flip that changes the model-facing catalog reaches the request through that consumer, which owns any prefix invalidation it causes.

## Known Limitations and Deferred Work

- **No session, no toggles** — the catalog is read through a session-addressed `skills.list`, so without an open workspace session the section shows the unavailable copy and cannot manage anything.
- **A refused save is silent** — the write is revision-fenced, and the scope swallows a refusal by reloading the mirror, so the optimistic row flips back with no message; the `saving-failed` alert the renderer draws is a status the controller never sets.
- **Every mount polls on a 30-second timer** — a skill folder added or removed outside the app appears only at the next poll, and each poll replaces the complete catalog rather than patching it.
- **One toggle rewrites the whole disabled list** — the save sends the complete `disabled` array as a single field write, so a concurrent edit of that field is refused instead of merged.
- **The rows follow one session's preset** — the read picks the running session, else the first listed one, so a preset switch elsewhere leaves the shown catalog stale until the next poll.
