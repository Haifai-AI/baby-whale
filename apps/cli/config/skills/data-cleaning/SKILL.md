---
name: data-cleaning
description: >
  Clean, normalize, and reconcile messy spreadsheets or delimited files —
  duplicates, inconsistent labels, mixed types, broken dates — then hand back
  a tidy workbook plus an audit trail of every change. Use when data looks
  messy before analysis.
---

# Data cleaning

Cleaning is a mapping from "untrustworthy" to "auditable". Never silently
fix: every transformation must be visible in the delivered file.

## Workflow

1. **Profile before touching anything.** `xlsx_read` / `csv_read` the source.
   Enumerate problems explicitly (column by column): blanks, duplicates,
   near-duplicate labels ("N. Region" vs "North"), numbers stored as text,
   impossible values (negative quantities, future dates), ragged rows.
2. **Propose the rule set** in one short message when the fixes are judgment
   calls ("merge 'US'/'USA'/'United States' into US?" — keep going with your
   best rule; flag it in the log sheet).
3. **Produce one clean workbook** with a pandas + openpyxl script run via
   `$DSH_OFFICE_PYTHON`:
   - `Clean` — tidy table: one header row, typed columns (`number_formats`),
     no merged cells inside the data area, `total_row` only when meaningful.
   - `Audit` — every change applied: original value → new value → rule name →
     affected row references. This sheet is what makes the work trustworthy.
   Style per excel-analysis (banner, header fill, number formats, banded rows).
4. **Verify**: re-read the cleaned file; assert row counts, spot-check five
   transformed cells against the audit entries, confirm totals match source
   sums where applicable.

## Standard rules

- Trim whitespace; collapse internal double spaces; unify casing of
  categorical labels (Title Case for names, UPPER for codes).
- Dates → ISO `yyyy-mm-dd` column format; store real dates, never strings.
- Numbers stay numbers: strip currency symbols/percent signs into the
  `number_formats` layer instead of baking them into strings.
- Duplicates: define the key first (whole-row vs business key), keep first,
  record dropped keys in Audit.
- Missing values: prefer explicit placeholders the analyst can filter
  ("(unknown)"), documented in Audit; never invent zeros for measures.

## Handoff

Report: rows in → rows kept/dropped, distinct rules applied (count each),
and where the audit lives. Offer to continue straight into analysis
(`excel-analysis`) on the cleaned file.
