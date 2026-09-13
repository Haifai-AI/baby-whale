# Agent Note: The web client replaces its visual world with a macOS window system

Status: implemented

English | [中文](2026-09-14-web-client-apple-visual-world.zh.md)

## Problem

The client's visual world was inherited from the design system it was built against: a DeepSeek-flavoured palette whose semantic aliases resolved to a blue-grey ramp, controls sized on a 14px capsule geometry, and a "product accent" that resolved to neutral ink. Three consequences compounded.

The palette had no room for a hierarchy of surface roles. `--dsw-alias-bg-base`, `-layer-1`, `-layer-2`, and `-layer-3` all resolved to pure white in the light scheme, so a card, a dialog, and a menu were the same surface as the page under them and depth had to come entirely from shadow. In the dark scheme nine semantically distinct surfaces — the canvas, four chrome steps, a control face, two scrollbar inks, and a tooltip — all landed on the same rung of the ramp, which is why the settings rail, the composer card, and an inset group read as one flat field.

There was no rule about where the one accent colour was allowed to appear. The accent filled the selected settings nav cell, the active tab's underline, the composer's attach button, the send button, and a link, all in the same view; the light value also failed AA as text (`#007aff` on white is 3.6:1). Two visual signals that meant different things — "this is where you are" and "you can press this" — were the same signal.

Type and geometry were sized for a marketing surface rather than a tool: 14px controls, 22px capsules, a 26px display weight of 500 with no tracking, and a `--ds-ease-spring` curve used on press. Measured against the running app, `--dsw-alias-label-tertiary` — consumed 208 times — rendered at 3.62:1 on the light canvas and 3.33:1 on the sidebar fill, so a large fraction of the interface's secondary text was below AA in the palette users actually use.

## Decision

Replace the world rather than polish it. `PRODUCT.md` records the product truth (a local-first document coworker whose output is a file, used all day by non-programmers); `DESIGN.md` and `.impeccable/design.json` record the replacement system. The old look is evidence of what the surfaces are, not authority over what they look like.

The token layer becomes a closed ramp. `design-platform.css` declares `--dsw-gray-00` … `--dsw-gray-95` and assigns every surface role (canvas, chrome, card, elevated control, four label steps) a named step. The light ramp and the dark ramp are separate palettes, not an inversion: in dark, chrome sits *above* the canvas rather than below it, and the label steps are re-picked for a dark ground. `--dsw-accent` is a new single accent with light and dark values (`#0071e3` / `#0a84ff`, both of which carry white text at AA), and it is the target of every button fill.

Two named rules bind how the accent is spent. **The One Blue Rule:** the accent appears at most once per column at rest — a sidebar shows one selected row, a settings panel one selected nav cell and one primary button, never both. **The Selection Inverts Rule:** a selected item takes the accent as its *fill* with inverted ink, never as a coloured edge, and sets `color: var(--dsw-alias-label-primary-foreground)` so every descendant drawing in `currentColor` (the state dot, chevrons, trailing icons) inverts with it.

The label ramp is bounded by physics rather than taste. On the sidebar's own fill (`245`), a neutral must sit at or under roughly `112` to clear 4.5:1, so the light palette has room for exactly two steps below primary: `--dsw-alias-label-caption` and `-tertiary` coincide there and separate in dark, where the ground is dark enough for a third. `-secondary` moves to a new `gray-70` (`88, 88, 93`). `-quaternary` and `-dimmed` remain, documented as decoration that must never carry meaning alone.

A six-step corner scale (`--dsw-radius-xs` … `-full`) replaces ad-hoc radii, assigned by the size of the thing rounded; 6px is the signature for a row or a control and 16px for the composer. The elevation ladder becomes a hairline plus a contact-and-ambient shadow pair, with a dark override that swaps the hairline for a light one. The control scale drops to 13px with prose at 15px, and `--ds-ease-spring` is deleted: a macOS control answers a press by darkening, not by moving.

Geometry follows the macOS source list: 28px session rows with a 20px indent step, a 30px New Session button, a 26px pop-up button, 30px shared button height, and settings rows as inset groups inside a card on the panel's grey — separators drawn as a pseudo-element that stops short of the card's leading edge so the card reads as one object. The running state of a tool row becomes a 1px travelling accent rule, replacing a 300px glare band that swept across the row's own glyphs and dimmed the text it annotated.

`backdrop-filter` is deliberately *not* used on the sidebar column or the composer card. It establishes a containing block for `position: fixed` descendants, and `ui-primitives`' Menu portal mode positions itself by computing viewport coordinates from an anchor's rect; blurring either container silently relocates the settings overlay and every menu anchored inside the session list or the composer. The dialog scrim and the toast, which host no portaled menu, keep the blur.

## Alternatives considered

- **Refining the incumbent palette** — changing values inside the existing alias names without restructuring them. Rejected: the failure was structural (four roles on one rung, no rule for the accent), and re-pointing the same names would have left the same collisions while making them harder to see.
- **Adopting a saturated accent** — a brand blue or the whale's own cyan as the fill for primary actions. Rejected in favor of system blue: the product runs beside Excel, Keynote, and Finder, and a bespoke accent in that context reads as a web page, which is precisely what the redesign is trying to stop looking like.
- **A distinct typeface** — a geometric or humanist sans to give the product a voice. Rejected: the system stack is the face the user's operating system already speaks, it renders Chinese correctly without a fallback, and character is better spent on weight and tracking than on a family the UI has to download.
- **Keeping the accent on the selected tab** — it read as the most obviously "designed" detail in the header. Rejected under the One Blue Rule: a tab is a place, not an action, and the selected tab is now the darkest ink in the strip plus a rule.
- **Deleting the `--dsw-static-*` palette outright** — it has 67 consumers. Rejected: an undeclared custom property is not an error, so every one of those references would have silently resolved to the guaranteed-invalid value — the exact failure class the previous Agent Note in this series fixed. The raw palette stays as the bottom layer while its consumers migrate, and each surface that migrates removes its own references.
- **A pre-3.0 dark mode by inverting the light ramp** — rejected: inverting produces chrome *darker* than the canvas, which is why the original dark scheme was flat. The dark ramp is authored independently.

## Consequences

Every surface role resolves to a distinct step in both palettes, so a settings card is legible as a card and a menu is legible as a menu without relying on shadow alone. Measured on the running app with the ink composited over its real translucent backdrops, all sampled text clears AA in both themes across the hero, settings, and conversation surfaces (previously: `-tertiary` at 3.62:1 light, `caption` at 3.33:1 on the sidebar, the inverse-surface ink at 1.22:1 in dark). The settings dialog now reads as one macOS window: accent nav cell, grey rail, white inset groups.

`--dsw-static-*` has no consumers left in feature CSS; the artifact previews read file-kind tokens (`--dsw-alias-file-*`) and document surfaces (`--dsw-alias-file-canvas`, `--dsw-office-ink*`) instead, and `ansi.ts` keeps the raw blue steps it needs for terminal colour. Office previews keep a documented exception: text **inside** a painted page is sized to the document it is showing, while everything the preview draws around the page takes the control scale.

The client design detector reports no findings over the changed stylesheets. `pnpm run test:gui` fails one pre-existing test (`ui-brand-official`, which also fails on a clean `origin/main`) where a clean checkout fails three; the third — the elevated-surface scrollbar rebind — is now satisfied because the surfaces whose elevation collapsed were those this change re-spaced.

Two costs are recorded rather than hidden. The light palette cannot support a third label step above AA, so `caption` and `tertiary` are the same value there and components that relied on the two differing must separate them by size or weight instead. And the package suites pin several values this change deliberately alters (`sidebar-styles`, `browser-styles`), which are updated in the same commit with their intent comments adjusted.
