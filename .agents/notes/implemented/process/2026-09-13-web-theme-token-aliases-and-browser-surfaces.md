# Agent Note: Web theme declares the token aliases feature CSS consumes and themes the browser-drawn surfaces

Status: implemented

English | [中文](2026-09-13-web-theme-token-aliases-and-browser-surfaces.zh.md)

## Problem

A scan of every `var(--dsw-*)` reference against every declaration found ten semantic aliases consumed by feature stylesheets that `design-platform.css` never declared: `--dsw-alias-fill-l2`, `--dsw-alias-fill-secondary`, `--dsw-alias-fill-tsp-secondary`, `--dsw-alias-label-quaternary`, `--dsw-alias-label-error`, `--dsw-alias-line-secondary`, `--dsw-alias-separator-primary`, and `--dsw-alias-border-secondary`, plus five one-off names in the unowned `--dsw-text-*`, `--dsw-surface-*`, `--dsw-danger`, `--dsw-warning*`, `--dsw-accent`, and `--dsw-font-mono` families. An undeclared custom property is not an error: the declaration computes to the guaranteed-invalid value and the reading property falls back to `inherit` or its initial value. The result was silent — a stats-line separator painted in the row's own text color instead of a fainter one, an agent-preset chip with no background, a form field's invalid border indistinguishable from its resting border, a disabled control keeping full-contrast ink, and an artifact banner with no seam under it. Each one is subtle enough that no single screen looks broken, which is why they accumulated.

Two related gaps sat in the same layer. Nothing themed the surfaces the browser draws rather than a component — `::selection`, `caret-color`, `accent-color`, and the keyboard-focus ring kept stock UA blue, which is the one palette in the product that no theme token reaches. And the elevation ladder gave each step a single blurred shadow with no offset/blur pairing, and no dark-palette override at all, so a dark-mode menu carried a black shadow at the light palette's alpha over a dark grey base and read as no elevation.

## Decision

`design-platform.css` declares every alias feature CSS already consumes, each bound to an existing static scale step; `base.css` adds `--dsw-font-mono` as the role-named alias of `--ds-font-family-code`. Feature stylesheets that referenced an unowned one-off name take the semantic alias for that role instead.

A new sheet, `ui-theme/src/styles/surfaces.css`, owns the browser-drawn surfaces:

- `::selection` takes `--dsw-specific-bubble-highlight` under primary ink, so selected text keeps its ratio in both palettes where the UA default washes out on dark.
- `caret-color` rides `--dsw-alias-state-business-primary`, which is the one glyph the composer's transparent textarea paints itself.
- `accent-color` gives the UA-painted form controls the same blue.
- `:focus-visible` draws a default ring from `--dsh-focus-ring-{width,offset,color}`, declared on `body` beside the rule. Text fields inset the ring; a component that draws its own ring still wins.

Its rules sit on `body`, which carries the `--dsw-alias-*` layer, and the sheet loads after `design-platform.css` — a custom property substitutes against the cascade position of the rule that reads it.

`--dsw-shadow-lv1/2/3` become contact-plus-ambient pairs (a tight small-offset shadow under a wide large-blur one), with a dark-palette block that deepens the alphas and adds a hairline to `lv3`.

Three consumer fixes ride along because the scan surfaced them as the same class of defect: `ProducedFiles`' studio, `DetailsArtifact`'s gallery, and `OfficeArtifactCard`'s document page each scrolled on a surface whose elevation they never rebound, so their dark-palette thumb took the base-surface color.

## Alternatives considered

- **Replacing each undeclared reference with an existing token at the call site** — the smallest diff per file, but it leaves the same name referenced from several sheets with no declaration, so the next reader cannot tell which value is authoritative and the tenth consumer repeats the mistake; rejected in favor of one declaration per name.
- **Giving the browser surfaces their own plugin package** — the styling rules put global sheets in `ui-theme/src/styles/`, and these consume that package's alias layer at `body`; a separate package would own no tokens and would have to load after this one by declaration; rejected.
- **Defaulting the focus ring to the `:focus` pseudo-class** — paints a ring on every pointer click, which the platform look forbids; rejected for `:focus-visible`.
- **Leaving the one-off names in place and declaring them as aliases too** — `--dsw-text-muted`, `--dsw-accent`, and `--dsw-warning` name a role the semantic layer already has, and declaring them would bless a second vocabulary for one role; rejected in favor of migrating the six call sites.

## Consequences

Every `var(--dsw-*)` reference in `packages/client` and `apps/web` now resolves against a declaration, and a refresh of the same scan reports only the two runtime-injected geometry variables (`--dsh-composer-height` from the seat observer, `--dsh-boot-arc` from the boot page's own loop). The focus ring and selection color are one affordance in every theme, and the elevation ladder reads as height in both palettes.

In exchange, `surfaces.css` is a sixth sheet that must keep loading after `design-platform.css`, the ring's three values are a new shared spelling feature CSS can adopt but that nothing yet enforces, and the elevation retune shifts every surface that consumes the ladder — a change no test pins, so it is verified by screenshot rather than by assertion.
