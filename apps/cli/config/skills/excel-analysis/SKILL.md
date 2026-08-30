---
name: excel-analysis
description: >
  Build polished Excel analysis workbooks by writing Python (openpyxl,
  pandas) and running it — charts, live formulas, number formats,
  conditional formatting, multiple sheets. Use whenever the user shares a
  spreadsheet or asks to analyze, summarize, or present numbers in Excel.
---

# Excel analysis workbooks

You build workbooks the way an analyst does: **write Python, run it, verify
the output**. Never hand-emit file contents.

## Workflow

1. **Read first.** `xlsx_read` on any uploaded workbook (`csv_read` for
   delimited text) — headers, types, row counts. For big files profile with
   pandas inside your script instead of pulling everything through tools.
2. **Ensure the interpreter.** The bundled one is `$DSH_OFFICE_PYTHON`
   (set at app launch). If bash says it is missing:

   ```bash
   python3 -m venv .venv && .venv/bin/pip install openpyxl pandas && echo OK
   ```

   then use `.venv/bin/python`.
3. **Write the build script** into the workspace (`scripts/build_report.py`),
   run it with bash, read errors literally, fix, re-run.
4. **Design like an analyst** (openpyxl):
   - Sheet 1 = `Summary`: merged banner title, headline KPIs, findings.
   - Detail sheets: one logical table per sheet; header bold white on navy
     `1E3A5F`; freeze panes; banded rows; fitted column widths.
   - **Live formulas** for totals/growth (`=SUM(B4:B12)`, `=C4/$B$13-1`)
     with absolute refs where needed — full precision in cells.
   - **Number formats on every measure column**: `#,##0.00`, `"$"#,##0.00`,
     `0.0%`, `yyyy-mm-dd`. Never leave numbers unformatted.
   - **Native charts** (`openpyxl.chart` Bar/Line/Pie) with claim-style
     titles ("North leads at $120k"); data bars / color scales on
     magnitude columns only.
5. **Verify in code.** In the same script or a follow-up run, reload the
   workbook with `load_workbook` and assert sheet names plus two or three
   computed values against source. Print the checks.
6. **Deliver.** Save under `deliverables/<slug>.xlsx`, call the **deliver**
   tool with that path, describe each sheet in one line, and answer the
   user's question in prose.

## Packages available

openpyxl, pandas (already in `$DSH_OFFICE_PYTHON`; install extras with
`.venv/bin/pip` as needed).
