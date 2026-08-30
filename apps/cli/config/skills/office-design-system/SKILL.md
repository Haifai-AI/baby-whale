---
name: office-design-system
description: >
  Cross-format visual language for Baby Whale deliverables: how to pick a
  fresh topic-informed palette and carry it consistently across workbooks,
  decks, documents, and PDFs so a multi-file pack reads as one designed set.
  Use alongside the other office skills whenever more than one file ships.
---

# Office design system

A quarterly pack usually ships as a set — workbook, deck, document. Ship it
as one designed system, not three unrelated files. Each format designs
itself fresh for the topic (no templates); the SYSTEM is the shared
decisions listed here.

## One palette decision per engagement

- Pick ONE topic-informed palette: a dominant color, 1–2 supporting tones,
  one sharp accent used ~10% of the time. Inspiration table:
  `powerpoint-deck/references/design.md`. With brand hexes from the user,
  use theirs everywhere.
- Write the hexes as named constants at the top of every build script —
  same names, same values in openpyxl / python-pptx / python-docx /
  reportlab. Derive tints (`blend`/`tints` in
  `powerpoint-deck/scripts/pptx_helpers.py`) instead of new hues.
- Chart series draw from the same ramp in every file, in the same order.

## Consistency checklist

- Identical title wording across cover page, deck title slide, and workbook
  banner (same case, same punctuation).
- Currency, units, and date formats match across every file (`usd` vs `$` in
  prose; `yyyy-mm-dd` everywhere).
- One number, one home: each metric has a canonical sheet; decks/documents
  quote it instead of recomputing.
- Typography discipline per format (deck titles ≥30pt, doc body 10.5–11pt,
  workbook labels 10–11pt) — consistent FEELING, format-appropriate sizes.
- Never accent bars/stripes/title underlines in any format — separation
  comes from whitespace and tints.

## File layout convention

Deliverables live under `deliverables/` with dated slugs:
`deliverables/q1-review-deck.pptx`, `deliverables/q1-revenue.xlsx`,
`deliverables/q1-summary.docx`. Mention the folder once, list files after.
