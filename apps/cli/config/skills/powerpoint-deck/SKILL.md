---
name: powerpoint-deck
description: >
  Design and build a polished PowerPoint deck by writing and running a
  python-pptx script: a fresh, topic-informed visual design every time —
  palette, typography, motif, varied layouts, styled native charts, speaker
  notes, and a mandatory visual QA render. Use for any slide deliverable:
  business reviews, pitch decks, reports, training decks, announcements.
---

# Designing a deck (PPTX)

You build decks by **writing a python-pptx script and running it** with
`$DSH_OFFICE_PYTHON`. There is no template: **invent a new design for every
deck** — colors chosen for this topic, a motif, varied layouts. Two decks on
different subjects should never look like siblings.

Helper primitives (styled charts, bullets, shadows — they take your colors,
no layout opinions): `scripts/pptx_helpers.py`. Visual QA renderer:
`scripts/render_slides.py`. Resolve both against this skill's base directory.

## 1. Design before you code

**Start from the topic, never from a previous deck.** Before writing any
code, write a 3-line **design brief**: two or three candidate directions —
each a palette (dominant / support / accent hexes), a motif, a font pairing,
and a one-word persona from the list in `references/design.md` — then pick
the least obvious one and say in one sentence why it fits *this* audience
and *this* moment. Name the clichéd choice for the topic explicitly so you
can avoid it. Check the workspace first: if a previous build script or deck
exists there, its design is TAKEN — a new deck for a different topic must
not reuse its palette, motif, or script (start a fresh script file; do not
edit the old one). Same topic, new engagement (this quarter's review after
last quarter's) should also shift — evolve the palette and layout plan
rather than reskinning.

Write the chosen design as constants at the top of the build script:

- **Palette for THIS topic's concrete world** — not its category. "AI" does
  not mean dark + cyan glow; "finance" does not mean default navy;
  "sustainability" does not have to be green. Derive colors from something
  tangible about the subject — its industry's documents, its product, its
  season, its geography — and sanity-check: would this deck be mistakable
  for a generic tech template? If yes, redo it. Pick one dominant color
  (~60-70% of the visual weight), 1-2 supporting tones, ONE sharp accent
  (~10%, reserved for the numbers and phrases that matter). Derive tints
  with `blend()`/`tints()` instead of inventing extra hues. The palettes in
  `references/design.md` are raw material for synthesis — never pick a row
  verbatim, and never pick the same row twice in one workspace.
- **Font pairing from the safe list** (these ship with Office AND render
  true-to-width in the QA preview): headers **Cambria** (serif, editorial)
  or **Arial** (bold, modern); body **Calibri**. Contrast serif headers over
  sans body for a distinctive, zero-risk pairing. Never Aptos; Georgia or
  Trebuchet only if the user asks (their QA preview is unreliable — leave
  ~10% extra width slack there).
- **One motif, carried everywhere** — e.g. numbers in colored circles,
  oversized ghost numerals, soft translucent circles on dark slides, thick
  serif quote marks. Pick ONE and repeat it. Never an accent bar or stripe
  (see Never).
- **Sandwich structure**: dark cover and closing (optionally dark section
  dividers and a dark pull-quote breather), white content slides. Or commit
  to dark throughout for a premium feel — but then text contrast must be
  flawless.
- **Backgrounds are white** (`FFFFFF`) unless the user's brand says otherwise.
  Cream/beige defaults read as template filler.

## 2. Write the story before the slides

Outline first: cover → one context slide → 2-4 supporting beats with
evidence (charts, stats, tables) → what's next → closing. 6-12 content
slides. One idea per slide. Then map each slide to a DIFFERENT layout —
see the layout patterns in `references/design.md`.

- **Titles are claims**, not topics: "Payback fell from 14 to 9 months", not
  "Unit economics". ≤ 9 words, ≥ 30pt bold, left-aligned.
- **Body 14-15pt, left-aligned** (never center body text), ≤ 5 bullets of
  ≤ 2 lines, parallel grammar, bold lead-in phrase + normal rest.
- **Speaker notes** go in the notes pane (`slide.notes_slide...`), never in
  a text box on the slide.

## 3. Every slide needs a visual

Text-only slides are forgettable. Each content slide gets at least one of:
a native chart, big stat callouts, a table, numbered cards with a tinted
fill, a timeline, a half-bleed image (crop with `crop_to()`, never
squash), or a bold pull-quote. Icons: draw simple geometric marks with
shapes (circles, rings, bars) in palette colors — or skip them; a clean
number chip beats a bad icon.

## 4. Charts stay native and quiet

`add_chart` for anything PowerPoint can chart (column, bar, line, area,
pie, doughnut, scatter via `XyChartData`). Style every chart with
`style_chart(chart, colors)` — it kills the auto-title, labels values
directly where possible, drops the value axis when labels replace it, and
quiets gridlines to hairlines. Then:

- One chart per slide; the slide title is its claim; source caption below
  in 9.5pt italic muted.
- Single series → no legend; 2+ series → bottom legend. Put a tinted
  takeaway panel beside the chart instead of making the chart bigger.
- Series colors come from your palette (or a `tints()` ramp of it).
- No chart images — only PowerPoint-impossible visuals (Sankey, network)
  may be rendered images.

## 5. Workflow

1. Design constants + outline (steps above).
2. Write `build_deck.py`, run with bash under `$DSH_OFFICE_PYTHON`, fix
   errors, re-run until clean.
3. **Verify structure in code**: reopen the saved file, assert slide count
   and chart count; print two lines.
4. **Visual QA — required, every build**:
   ```bash
   $DSH_OFFICE_PYTHON <skill-dir>/scripts/render_slides.py deliverables/x.pptx --out qa
   ```
   View `qa/sheet.png`, then any suspect slide full-size. Fix in the build
   script and re-render — never hand-edit the pptx. Look for: text
   overflowing its box (the #1 defect), overlaps, elements < 0.3" apart,
   uneven gaps, low-contrast text or chart labels, orphaned/widow words,
   captions colliding with content.
5. Save to `deliverables/<slug>.pptx`, call **deliver** with the path, then
   paste the one-line-per-slide outline so the user can request swaps.

## python-pptx foot-guns (each of these bites)

- `RGBColor.from_string("4361EE")` — hex **without** `#`. An `#` corrupts nothing here but `from_string` raises; never paste CSS strings elsewhere.
- **`tf.text = "..."` destroys formatting** — it collapses to one unstyled run. Set text on `run`s, style `run.font`.
- New textboxes: `word_wrap = True`, `auto_size = None`, and zero the margins when text must align with a shape edge — default margins are ~0.1" and misalign everything.
- New autoshapes: run `strip_style(shape)` — python-pptx attaches a theme style ref that PowerPoint/LibreOffice resolve differently (phantom shadows, wrong lines).
- Shadows: don't rely on `shape.shadow` toggles alone — declare `soft_shadow(shape)` so both renderers agree; negative/implicit offsets differ between them.
- Rounded rectangle radius: `shape.adjustments[0] = 0.05` (fraction of the smaller side).
- Chart auto-title: python-pptx writes `autoTitleDeleted=0`, so PowerPoint invents a title from a single series' name. `chart.has_title = False`, always.
- Data labels: set `plot.has_data_labels = True` BEFORE touching `plot.data_labels` (it raises otherwise). `OUTSIDE_END` is valid on column/bar/pie; on stacked use `CENTER` only.
- Pie slices need per-point fills (`series[0].points[i].format.fill`) — series-level fill does nothing. Doughnut labels sit INSIDE slices: darken slice colors (white bold labels) or they vanish.
- Tables: kill the theme banding (`table.first_row = False`, `table.horz_banding = False`) and fill every cell explicitly; style with fills + `cell_border_bottom` hairlines only.
- Bullets: plain textboxes have none, and a literal "• " character double-indents wrapped lines. Use `bullet(paragraph, accent_hex)`.
- Coordinates past the slide edge are written, not clamped — off-slide shapes silently vanish from view. 13.333 × 7.5 in; keep ≥ 0.5" margins.
