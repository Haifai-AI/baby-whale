# Agent Note: The transcript's process rows consolidate on one chrome

Status: implemented

English | [中文](2026-09-14-transcript-process-row-chrome.zh.md)

## Problem

Every unit of process in the transcript — a tool call, a reasoning block, a slash command, an injected context, a skill invocation — was its own implementation of the same row. Seven existed: `ToolRow`, `ReasoningRow`, `GenericCommandCard`, `ContextInjectionRow`, `SkillRow`, the Bash toolview, and the folded-run summary. Five composed the shared `DisclosureRow`; two hand-rolled its markup.

They had drifted into four incompatible spellings of one object. The meta run was 13px/22px where a row composed the chrome and 14px/24px where it hand-rolled it. The separator between the verb and its meta was a 3px dot in one family and a 2px dot in the other, drawn from three different tokens. Most consequentially, [the visual world note](../process/2026-09-14-web-client-apple-visual-world.md) had recorded the running state as "a 1px travelling accent rule, replacing a 300px glare band that swept across the row's own glyphs and dimmed the text it annotated" — and that was true of exactly one row. The reasoning, command, skill, and Bash rows still swept the band.

The result was that the row carried no hierarchy at all. Measured in the running app, a tool row drew its title at 14px/400 in `label-secondary` and its summary at 13px/400 in `label-tertiary`, separated by a 3px dot that composited to **1.98:1** on the canvas. One pixel of size and no weight step is not a distinction a reader can see; the dot was below the contrast floor and read as neither punctuation nor a boundary. The row scanned as one grey run-on sentence, and on a session with thirty-odd reasoning blocks it was the most-repeated object on screen.

## Decision

One chrome owns the row, and the differences between the five kinds become rank rather than structure. `DisclosureRow` in `ui-primitives` — already the shared atom for five of the seven — becomes the single definition: a 24px row, a **20px leading tile** on `--dsw-alias-fill-l2` at the 6px row radius, an 8px gap, the verb at **13px/22px medium in `label-primary`**, an 8px gap, and a truncating 13px/22px meta run in `label-tertiary`.

The tile is the move. It gives every row a definite left edge, so a row reads as an object sitting on the text axis rather than as one more line of grey prose, and it replaces the separator dot without adding a glyph: the verb's 500 over the meta run's 400 is now a full weight step, and `label-primary` over `label-tertiary` is two ramp steps. No process row draws a separator. The two rows that hand-roll the chrome — Bash and Skill — repeat these values and carry a comment saying they must be kept in step.

**The one deliberate axis of difference is rank.** A tool call's verb is `label-primary`; a reasoning row's is `label-secondary`. Thinking is ambient and a call is an event, so the thirty-odd reasoning rows in a long turn recede behind the calls that did the work while remaining legible. Everything else about the two rows is identical — the 14px/13px and 24px/22px differences that used to separate them were two copies drifting, not two decisions.

The running state becomes the travelling 1px accent rule in every row that has one, completing what the visual world already claimed. `packages/client` now contains zero `width: 300px` rules.

The folded-run summary repeats the row's leading slot exactly — the same 20px slot and 8px gap — so its label lands on the arithmetic axis of the row titles it stands in for. That alignment spans two packages, so a spec reads both stylesheets and asserts the arithmetic (`-margin + padding + icon + gap == tile + gap`), because jsdom has no layout and a change to either side alone silently drops every folded label one step off the prose.

Two supporting fixes were needed to keep the transcript's own footer sound. The turn's process control rides inside the assistant actions row through that row's existing `extraActions` seat rather than in a wrapper of its own: a new flex wrapper makes the row a content-sized item instead of the stretched child it had been, so its trailing run-time label stops shrinking and the footer overflows the conversation column. And that label — the row's only shrinkable part — now ellipsizes instead of pinning the row to its content width. Before this change the row's content only just fit the column at a 900px viewport, so any added control pushed the run-time stats outside it; the row now absorbs a narrower column rather than overflowing it.

## Alternatives considered

**A chevron on every row instead of a tile.** Rejected: it doubles the disclosure affordance count on a screen that already has one per row, and a chevron column is a tree control's vocabulary, not a report's.

**A card or filled chip per row.** Rejected: it puts a second kind of chrome into a transcript whose only other control is the composer, and makes a forty-row turn read as a stack of forty boxes.

**A vertical rule or indentation to group a run's rows.** Rejected: it states a grouping the fold already states, and any 1px coloured edge above the hairline weight is a costume this world does not own.

**Leaving the seven copies and fixing the values in place.** Rejected: the drift was the defect. Four spellings of one row is what produced a 1.98:1 dot surviving a redesign that had already declared the treatment retired.

## Consequences

Measured in the running app at 1440px and 900px, both themes, over a real session: the row is 24px with a 20×20 tile at the 6px radius, the verb is 13px/500 in `label-primary`, the meta run 13px/400 in `label-tertiary`, **zero** separators remain, and no horizontal overflow appears at either width. Forty-five rows measured across all five kinds sit on exactly one title axis (28px). Contrast in both themes clears AA: the tile glyph 5.93:1 light and 5.64:1 dark, the meta run 4.95:1 light and 6.01:1 dark.

`test:gui` is 4079 passed with the one pre-existing `ui-brand-official` failure that also fails on a clean `main`. The design detector reports zero findings over the nine changed stylesheets. The cross-file axis spec was verified to reject drift by moving the shared gap from 8px to 6px and observing the expected failure.

Two rows still hand-roll the chrome rather than composing the atom — `bash-sample` and `SkillRow` — because each owns an expand interaction the atom's props do not express. They are the remaining drift risk, and the standing fix is to teach `DisclosureRow` the interaction rather than to keep repeating its values.
