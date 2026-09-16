# office/

English | [中文](README.zh.md)

Model-facing office file access: reading uploaded spreadsheets and documents into structured data the model can analyze. Creating office artifacts is code-first — the model writes and runs Python (openpyxl / python-pptx / python-docx / reportlab) through the bash tool and surfaces the result with `deliver`.

## Packages

| Package | Owns | `ctx` key |
|---|---|---|
| [`tool-office/`](tool-office/README.md) | `xlsx_read` / `csv_read` / `docx_text` extraction tools over `ctx.fs`, plus the `tool:office` and `tool:office-reads` reading guidance | — |
