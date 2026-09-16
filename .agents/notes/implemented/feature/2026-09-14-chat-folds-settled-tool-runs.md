# Agent Note: Chat folds a settled tool run into one summary line

Status: implemented

English | [中文](2026-09-14-chat-folds-settled-tool-runs.zh.md)

## Problem

A turn that calls tools renders one row per call, one after another, with prose scattered between them. Measured on a real 23-step session, the transcript showed 15 tool rows occupying 332px of a ~700px viewport — roughly half the reading column was process. A longer turn pushed the answer off-screen entirely.

The rows were not wrong individually; the web client's tool row is already a quiet single line. The problem was volume and flatness. Every call rendered at the same weight whether it read a file or failed, the rows stacked with no gap so they read as texture rather than a list, and the tool name repeated on every line (`Bash ·` five times). The transcript could not distinguish "here is the answer" from "here is what I did to get it".

The obvious fix — collapse the tool rows — had a hazard worth naming. Folding by tool-call contiguity alone does not work in this client: a turn renders as alternating `assistant-step` and `tool-call` Nodes, so the longest contiguous run of tool calls is usually two. A fold built on that predicate would have appeared correct in a unit test and done nothing in the product. This was confirmed by dumping the flow kinds from a live session before writing the grouping.

## Decision

`ui-conversation` groups the Chat flow into runs of *process* and folds a settled, clean, long-enough run into one summary row.

**The run boundary is prose, not call contiguity.** A run is the maximal contiguous slice of the flow order whose Nodes are all process: tool calls, plus assistant steps that carry no non-empty text. A step carrying prose ends the run, because the answer is what the fold exists to protect. A step carrying only reasoning is work and recedes with the calls around it. Any other Node kind — a user message, a command, a compaction marker, the turn tail — is content and ends the run. An unrecognized block is treated as content rather than folding something the grouping cannot read.

**The fold is derived, never stored.** `groupToolRuns` is a pure function of the flow order and the runtime's `ChatNodeStore`, memoized in `ChatView` on both. Run identity is the run's first Node key, so appending a call to a live run keeps its fold state instead of remounting the summary.

**What folds.** `foldsByDefault` requires three conditions together: the run has settled, nothing in it failed or was interrupted, and it covers at least three tool calls (`MIN_FOLDABLE_RUN`). The threshold is deliberate: folding two rows saves one row and costs a click. A run that is still working keeps its rows visible, so live calls stay watchable; a run that failed keeps them too, because a collapsed failure is a failure the user has to go looking for.

**What the reader controls.** `ChatStoreState.expandedRuns` holds run keys the reader opened, and the only stored direction is *open*. A run that does not fold by default offers no collapse, so no "closed" half is needed, and a run opened while it was running stays open after it settles rather than re-folding under the reader.

**What the summary says.** The count of tool calls (not of covered Nodes — the two differ because a run spans reasoning steps too) and, once the run has settled, its wall span from the first covered Node to the last settlement. A run with any unsettled Node reports no duration at all, because a partially-timed span would print a duration for work still in flight. Times come from the same block fields the row models read, so the summary cannot disagree with the rows it replaces.

The summary row is styled as muted text that answers a hover, not as a bordered or filled control: a second kind of chrome in the transcript would compete with the composer, which is the only other control there. It carries a tooltip naming the count and the action, so an unlabelled number explains itself without a click.

## Alternatives considered

- **Fold by contiguous tool calls only** — the straightforward predicate, and the one a reader would assume. Rejected after measuring the real flow: assistant steps sit between calls, so runs would almost never reach the fold threshold and the feature would look implemented while doing nothing.
- **Fold the whole turn (every step and call into one line).** The largest reduction available. Rejected because it hides the answer's own prose along with the work; a reader would have to open the turn to read what the agent said.
- **Fold reasoning steps too, always.** They are work by the same argument. Rejected as a separate decision: reasoning rows carry the agent's stated intent, and folding them changes what a turn looks like far beyond the tool log. They fold only when they sit between calls, which is the case the run boundary already covers.
- **A severity notion per tool** (routine success folds, destructive operations stay loud). Rejected for this change: it requires per-tool metadata the render intent does not carry today, and failure plus liveness already covers the cases where a reader must see the rows.
- **Fold at two calls rather than three.** Rejected: the saving is one row and the cost is a click plus a second thing to scan.
- **Persist a closed-run set as well as an open one.** Rejected: no run offers a collapse unless it folds by default, so the closed direction would only ever record the default it already computes.
- **Reuse `hasVisibleContent` from the assistant node to decide process vs content.** Rejected: that predicate counts reasoning as visible content, which is the opposite of the classification a run boundary needs.

## Consequences

On the measured 23-step session, a settled turn's flow height fell from 2746px to 1800px — 946px, about a third of the transcript, replaced by four summary lines — with tool rows dropping from 15 visible to 5. The answer now sits beside its process instead of below it.

The Chat and Trajectory tabs stop duplicating each other: Trajectory remains the full dense log, and Chat becomes the narrative, which is what its name and placement already implied.

Costs and limits. The fold depends on Node kinds staying stable, so a new Chat Node kind is content by default and ends a run — the safe direction, but it means a future *process* Node kind must be added to `foldNode` explicitly or it will silently break runs in two. The summary reports a wall span, not summed tool time, so a run with idle gaps shows a longer duration than the work took; the composer's stats line remains the place for accurate totals. `expandedRuns` is keyed by Node key, so a session whose window is reloaded past a run drops that run's expansion with the Node itself.
