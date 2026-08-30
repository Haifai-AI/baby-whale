# Whale demo garden

Drop the sample file into a workspace (or just attach it), then try:

## 1. Clean + analyze (Excel loop)
> Clean up messy-sales.csv and give me an analysis workbook: per-region
> revenue summary with live formulas, data bars on revenue, a column chart,
> and totals — corporate-blue theme.

Exercises: csv_read → data-cleaning rules → xlsx_create (formats, bars,
charts) → verify by re-read.

## 2. Quarterly pack (multi-deliverable)
> From messy-sales.csv build my Q2 kickoff pack: a cleaned workbook, a
> 6-slide review deck with three KPI stats and a region chart, and a one-page
> Word summary. Keep all three visually consistent.

Exercises: multi-artifact consistency via office-design-system; deck stat
cards; docx cover page.

## 3. Recurring report
> Every Monday 09:00, summarize any new notes.md changes into
> deliverables/weekly-report.docx.

Exercises: whale_task_create cron scheduling while the session stays open;
task board behavior.
