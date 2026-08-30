# Design reference — decks

Deep reference for `powerpoint-deck`. Read the sections you need; the
SKILL.md carries the workflow.

## Design personas (rotate — never default)

Start the design brief by picking a persona the topic does NOT obviously
suggest:

| Persona | Feel | Signature moves |
|---------|------|-----------------|
| Editorial print | magazine, literary | white paper, serif display, ghost numerals, hairline rules, pull-quotes |
| Swiss grid | precise, institutional | one grotesque family, hard left alignment, flat color blocks, generous air |
| Warm humanist | approachable, local | white + warm accent (terracotta/ochre/plum), serif heads, rounded cards |
| Bold poster | confident, launch-y | one saturated field color on cover/dividers, huge type, big stats |
| Field notes | documentary, grounded | muted earth tones, small-caps labels, table-forward, thin rules |
| Terminal technical | engineering-brief crisp | near-white paper, mono accents for numbers, thin rules — NOT dark-cyber glow |

## Palette construction

One dominant color (60-70% of visual weight) + 1-2 supporting tones + ONE
sharp accent (~10%). Tints and shades come from these via
`pptx_helpers.blend/lighten/darken/tints` — extra hues dilute the design.
If the user gives brand hexes, those ARE the palette.

Synthesize from the topic's concrete world; the table below is raw
material, not a menu to pick from. Anti-cliché starting points for topics
that come up often:

| Topic | The cliché (avoid) | Fresher directions |
|-------|--------------------|--------------------|
| AI / tech | dark slate + cyan/indigo glow | paper-white engineering brief with a single ink + oxide red; warm archive tones (manila, oxblood) for "history of" pieces; blueprint blue on white |
| Finance | navy + gray | Ledger: cream-white, oxblood + brass; or mint-green accounting paper with ink black |
| Health | hospital teal | soft apricot + warm gray; clinical white + one deep plum |
| Sustainability | leaf green | kraft-paper brown + sky; regenerated-landscape palette (soil, river, wheat) |
| Education | primary chalkboard | composition-notebook black marble + pocket-folder accents |

### Inspiration palettes (adapt, don't default)

| Mood | Dominant | Support | Accent | Reads as |
|------|----------|---------|--------|----------|
| Midnight Executive | `1E2761` navy | `CADCFC` ice | `4361EE` | boardroom, finance |
| Ocean Depth | `065A82` deep blue | `1C7293` teal | `21295C` | maritime, logistics |
| Forest & Moss | `2C5F2D` forest | `97BC62` moss | `B08947` grain | sustainability, HR |
| Coral Energy | `F96167` coral | `F9C849` gold | `2F3C7E` navy | consumer, launches |
| Terracotta Warm | `B85042` clay | `E7E8D1` sand | `A7BEAE` sage | craft, food, real estate |
| Charcoal Minimal | `36454F` slate | `94A3B8` steel | `0E7490` teal | engineering, minimal |
| Teal Trust | `028090` teal | `00A896` seafoam | `02C39A` mint | health, science |
| Berry & Cream | `6D2E46` berry | `A26769` rose | `C9A227` gold | fashion, hospitality |
| Electric Slate | `0F172A` ink | `06B6D4` cyan | `6366F1` indigo | AI, dev tools |
| Cherry Bold | `990011` cherry | `FCF6F5` shell | `2F3C7E` navy | urgent, sports |

Dark-slide backgrounds: a *darker* shade of the dominant
(`darken(dominant, 0.3-0.45)`), never pure black. Text on dark slides:
white + a light tint of the dominant (`lighten(dominant, 0.7)` for muted).
Chart series: dominant, its darkened shade, then a `tints()` ramp — the
accent only for the series the claim is about.

## Typography scale

| Element | Size | Style |
|---------|------|-------|
| Cover title | 40-44pt | bold, header font |
| Slide title (claim) | 30-34pt | bold |
| Section number/divider | 90-100pt | bold, accent or ghost tint |
| Column/card heads | 15-16pt | bold |
| Body / bullets | 14-15pt | regular, 1.1-1.2 line spacing |
| Stat values | 44-54pt | bold |
| Captions / sources | 9.5-11pt | italic or muted |

Safe fonts (ship with Office, width-true in QA): **Cambria, Calibri, Arial,
Times New Roman, Courier New, Bookman Old Style, Century Schoolbook**.
Distinctive zero-risk pairing: serif headers (Cambria) + sans body
(Calibri). QA-unreliable (approximate preview widths — add ~10% slack,
don't trust fit checks): Georgia, Trebuchet MS, Garamond, Consolas,
Palatino Linotype, Impact, Arial Black. Never Aptos.

Uppercase kickers/eyebrows: 10-11pt bold with `letter_spacing(run, 130)`.

## Layout patterns — vary across the deck

Rotate at least 4 different patterns per deck; never two same-layout slides
in a row:

- **Claim + bullets** — the workhorse; use it at most twice per deck.
- **Stat band** — 2-4 huge numbers with caps labels and small notes; the
  first (most important) value takes the accent.
- **Chart + takeaway panel** — chart at ~2/3 width, tinted rounded panel
  right with "what this means" in 2-3 sentences.
- **Numbered cards** — 3-4 tinted rounded cards, circle number chips, bold
  head + 2-3 line body, `soft_shadow`.
- **Two-column contrast** — working vs. broken, before vs. after; hairline
  divider.
- **Timeline** — 3-5 numbered circles on a hairline connector, label +
  one-liner each.
- **Half-bleed image** — photo flush to half the slide (`crop_to()` it to
  the frame aspect), content on the other half.
- **Pull-quote breather** — oversized quotation mark motif, 22-24pt italic
  serif quote; dark background mid-deck resets attention.
- **Table, minimal** — dark header row, alternating white/tint body,
  bottom hairlines only, numbers right-aligned.

## Chart chooser

| You're showing | Use |
|---|---|
| One measure across categories/time | column (+ data labels, no axis) |
| Ranking / long category names | bar (horizontal) |
| Trend over time | line (+ markers if ≤ 12 points) |
| Part-to-whole, ≤ 5 slices | doughnut or pie |
| Composition over time | stacked column |
| Volume/magnitude shape | area (single series) |
| Correlation | scatter (one color per group) |

Two measures with different units → two slides or a normalized pair, not a
dual axis.

## The never-list (instant AI tells)

- Accent bars, header stripes, edge stripes, title underlines — NONE.
  Separate with whitespace or a background tint.
- Centered body text; centered only cover titles.
- Default-blue decks, cream/beige backgrounds, rainbow charts.
- Same layout twice in a row; text-only slides.
- 12pt body under 14pt; titles under 30pt.
- Chart junk: legends on single series, 3D anything, heavy gridlines,
  axis labels AND data labels together.
- Light-gray text on white below #6B7280; white text on tints lighter than
  ~55% (check every label on tinted panels).
- Text overflowing boxes — if it doesn't fit: shorten, split the slide, or
  resize; never let the renderer clip.

## Visual QA checklist (run on every rendered sheet)

1. Overflow/cut-off text (check first — most common).
2. Overlaps: text through shapes, captions under content, chips over titles.
3. Spacing: gaps < 0.3" anywhere? One cramped corner vs. one empty corner?
4. Margins ≥ 0.5" from slide edges.
5. Contrast: every text/icon on its actual background (tinted panels count).
6. Alignment: repeated elements on a shared grid; consistent card insets.
7. Charts: claim titles, quiet frames, readable tick + label sizes.
8. Motif present but not repeated to noise; footer/page numbers consistent.

Fix in the build script, re-render only what changed, stop when clean.
