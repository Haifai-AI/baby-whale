---
name: document-report
description: >
  Write polished Word documents by writing Python (python-docx) and running
  it — a fresh, topic-informed design every time: styled heading system,
  cover page, callouts, quiet tables, captions, page numbers. Use for
  reports, memos, proposals, one-pagers, any .docx deliverable.
---

# Document reports

Documents longer than a page are built by **writing a python-docx script
and running it** via bash with `$DSH_OFFICE_PYTHON`.

## Design first (no template — invent per document)

- **Palette for THIS topic**: one dominant heading color + one accent used
  sparingly (rules, callout tints, table header). Same discipline as decks;
  if a deck ships alongside, reuse ITS palette constants verbatim. Body
  text stays near-black (`2A2E35`), never a hue.
- **Type system**: body Calibri 10.5–11pt with 1.15 line spacing and 6pt
  space after paragraphs; headings in the palette's dominant color — H1
  18–20pt bold, H2 14pt bold, H3 12pt bold italic. Restyle the built-in
  `Heading 1/2/3` and `Title` styles once at the top (then the navigation
  pane and TOCs work).
- **Cover page**: title 32–40pt bold, one-line subtitle, author/date in
  small caps, generous whitespace. Big type + air — no accent rules, no
  full-width color bands. Page break after.
- **Callouts**: single-cell tables with a light tint fill
  (`blend(accent, white, 0.92)`) and NO border stripes — the tint alone
  separates. Reserve for the 2–4 load-bearing takeaways.
- **Tables**: header row filled dominant (white bold 10pt), body rows
  alternating white / 3% tint, hairline bottom borders only — no full
  grids. Numbers right-aligned.
- **Figures**: centered, ~15cm, caption 9pt italic gray, numbered
  ("Figure 3 — …").
- **Page numbers + footer**: one line, small gray; add via a PAGE field.

## Structure

Executive summary FIRST (write it last), then 3–6 `Heading 1` sections;
findings before method; active voice; no filler openers. Every claim that
rests on a number cites the table/figure that carries it.

## Workflow

1. Plan the spine; draft findings + evidence before touching code.
2. Write `build_report.py`, run via bash, iterate on errors.
3. **Verify**: re-extract paragraph text from the saved file; check heading
   order and that the summary matches the body. For layout-sensitive covers
   or callouts, render a spot-check:
   `$DSH_OFFICE_PYTHON <powerpoint-deck skill>/scripts/render_slides.py` is
   pptx-only — for docx use `soffice --headless --convert-to pdf` and view
   the PDF's first pages.
4. Save `deliverables/<slug>.docx`, call **deliver**, paste the five-line
   skeleton. Offer deck/workbook companions when tables carry the weight.
