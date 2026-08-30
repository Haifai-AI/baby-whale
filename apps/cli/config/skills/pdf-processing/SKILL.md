---
name: pdf-processing
description: >
  Create PDFs by writing Python (reportlab) and running it — designed
  fresh per document, same visual language as our decks and docs; or
  manipulate existing PDFs with pypdf/pdfplumber (merge, split, fill forms,
  extract). Use for any PDF request or PDF-based analysis task.
---

# PDF processing

Baby Whale builds and manipulates real PDFs through Python code — write the
script, run it with bash using `$DSH_OFFICE_PYTHON`.

## Creating PDFs (reportlab)

- Prefer `platypus` flowables: `SimpleDocTemplate`, `Paragraph`,
  `Table`/`TableStyle`, `Spacer`, `PageBreak`.
- **Design per document, no default theme**: pick a dominant + accent for
  THIS topic (reuse a companion deck's constants when one exists). Define
  `colors.HexColor` constants once; body text stays near-black.
- Type scale: title 24–28pt bold, H2 14pt bold in the dominant color, body
  Helvetica 10.5pt with 14pt leading, generous spacing before headings.
- Tables quiet by default: header band in the dominant color (white bold),
  alternating 3% tint rows, `LINEBELOW` hairlines only — never full grids.
- Callout boxes: tinted single-cell tables, no border stripes.
- Multi-page documents get page numbers + a small running footer via
  `onPage` callbacks.

## Working with existing PDFs (pypdf / pdfplumber)

- Merge/split/reorder pages with pypdf's `PdfWriter`.
- Extract text with pdfplumber (`page.extract_text()`); extract tables with
  `page.extract_tables()`. For scanned pages without a text layer say so —
  do not invent contents.

## Workflow

1. For from-scratch documents draft the spine first (see document-report),
   then encode it in the script.
2. Run via bash under `$DSH_OFFICE_PYTHON`; iterate on errors.
3. **Verify**: page count for writes, non-empty extracted text/pages for
   manipulations; keep console output to a couple of lines.
4. Save `deliverables/<slug>.pdf`, call **deliver**, state the path and a
   one-line summary of contents.
