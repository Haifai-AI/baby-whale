---
name: excel-analysis
description: >
  Build polished Excel analysis workbooks by writing Python (openpyxl,
  pandas) and running it — live formulas that still preview with real
  numbers, native charts, real Excel Tables, number formats, a summary
  sheet with findings. Use whenever the user shares a spreadsheet or asks
  to analyze, summarize, or present numbers in Excel.
---

# Excel analysis workbooks

You build workbooks the way an analyst does: **write Python, run it,
verify the output**. Never hand-emit file contents. The bar is a workbook
a finance teammate could forward to their VP without editing: it opens to
a summary that answers the question, every number is formatted, every
total is a live formula, and nothing looks unfinished.

## Workflow

1. **Read first.** `xlsx_read` on any uploaded workbook (`csv_read` for
   delimited text) — headers, types, row counts. For big files profile
   with pandas inside your script instead of pulling everything through
   tools.
2. **Ensure the interpreter.** The bundled one is `$DSH_OFFICE_PYTHON`
   (set at app launch; on Windows it points into the managed venv's
   `Scripts/python.exe`, and `$DSH_OFFICE_PYTHON` expands in pwsh too).
   If the shell says it is missing:

   ```bash
   python3 -m venv .venv && .venv/bin/pip install openpyxl pandas && echo OK
   ```

   then use `.venv/bin/python`. On Windows (pwsh) the same fallback reads:

   ```powershell
   py -m venv .venv; .venv/Scripts/python -m pip install openpyxl pandas
   ```

   then use `.venv/Scripts/python.exe` (`py` itself missing → `python`).
3. **Build with the helper module** in this skill's `scripts/` directory —
   `wb.py` (resolve its path against this skill's base directory and
   `sys.path.insert` it). It bakes in the design system, real Excel
   Tables, styled charts, and the formula-cache step that makes previews
   show numbers instead of `=SUM(...)` text:

   ```python
   from wb import WorkbookBuilder
   b = WorkbookBuilder()
   b.readme("Q3 sales analysis", "One line on what this file answers.",
            [("Summary", "Headline numbers and findings"), ...],
            source="sales_export_2026-06.csv")
   raw = b.sheet("Sales Data")
   b.table(raw, "SalesData", ["Product", "Units", "Revenue"], rows,
           formats={1: "#,##0", 2: '"$"#,##0'}, title="Raw sales rows")
   # totals as live formulas — you compute the value anyway, pass it in:
   b.set_formula(raw, "B12", "=SUM(B2:B11)", total_units, "#,##0")
   b.chart(raw, "H3", "col", "iPhone leads units at 5,250", data, cats,
           colors=["1F6F43"], y_title="Units")
   b.summary(kpis=[("Revenue", 11604955, '"$"#,##0')], findings=[...])
   b.save("deliverables/q3_sales.xlsx")   # never wb.save() directly
   ```

   `set_formula(ref, formula, cached)` is the contract: **the `cached`
   value is the number you already computed in pandas/Python for that
   formula.** `save()` writes it into the file so previews, Quick Look,
   and pandas all see real numbers, while `fullCalcOnLoad` keeps Excel
   authoritative — a user editing an input sees every total and chart
   update live.
4. **Structure like an analyst.** Default sheet order:
   `Read Me` → `Summary` → data/detail sheets. One logical table per
   sheet; keep the raw source data on its own sheet untouched so numbers
   are traceable. Name sheets for content (`Sales Data`), not for type
   (`Data1`). For anything with more than one data sheet, the Read Me tab
   (one line per sheet) is not optional.
5. **Numbers are never naked.** Every measure column gets a number
   format: `#,##0` counts, `"$"#,##0` / `"€"#,##0.00` money, `0.0%`
   shares, `yyyy-mm-dd` dates, `0.0×` multiples. Currency symbol matches
   the data, not your locale. Percentages are real fractions with a `%`
   format — never the number 54 followed by the word "percent".
6. **Charts carry the finding.** Native `openpyxl.chart` only (Bar /
   Line / Pie via `b.chart`). Titles state the claim — "North leads at
   $120k", not "Revenue by region" — and each chart earns its place:
   column for comparisons, line for trends over time, pie only for
   parts-of-a-whole with ≤5 slices. Legend bottom or none; no 3D, no
   exploded slices, no rainbow palettes.
7. **Verify in code** (mandatory, every build — the helper module makes
   it cheap):

   ```bash
   $DSH_OFFICE_PYTHON <skill-dir>/scripts/verify_workbook.py deliverables/report.xlsx
   ```

   It reloads the file and fails on any formula without a cached value,
   any cached `#REF!`/`#DIV/0!`, any error string, and prints the sheet +
   table inventory. Fix the build script and re-run — never hand-edit the
   xlsx. Then re-open with `load_workbook` and assert two or three
   headline numbers against the source data, printing the checks.
8. **Deliver.** Save under `deliverables/<slug>.xlsx`, call the
   **deliver** tool with that path, describe each sheet in one line, and
   answer the user's question in prose — lead with the finding, not the
   file.

## Design system (baked into wb.py — match it if you build by hand)

- Palette: navy `1E3A5F` for headers/titles, accent `2E7D5B` for
  highlights, grey `5A6572` for meta text. No other colors.
- Header row: bold white on navy; freeze panes below it; banded rows via
  real Excel Tables (`TableStyleMedium9`), not manual fills.
- Column widths fitted to content (capped), gridlines off on every
  sheet, one blank column between KPI blocks.
- Summary sheet: KPI blocks (label above, big number below), then the
  findings list — each finding a full sentence with the number in it.

## Pitfalls

- openpyxl writes formulas **without cached results**; saving via
  `WorkbookBuilder.save()` is what patches them in. A workbook built with
  raw `wb.save()` will fail `verify_workbook.py`.
- Tables need unique `displayName`s (no spaces) and string headers —
  `b.table()` handles both.
- Don't mix types in a column (numbers as text poison sorts and SUMs) —
  coerce in pandas before writing.
- Dates as `datetime` objects + a date format, never strings.
- The summary's KPI numbers should be formulas pointing at detail sheets
  when they aggregate deliverable data (`='Sales Data'!G14`), and cached
  like any other formula — the Summary then updates with the data.

## Packages available

openpyxl, pandas (already in `$DSH_OFFICE_PYTHON`; install extras with
`.venv/bin/pip` as needed).
