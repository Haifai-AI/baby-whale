# `@deepseek-ai/dsh-tool-office`

English | [中文](README.zh.md)

Model-facing office READ tools over the [filesystem seam](../../fs/fs/README.md): `xlsx_read`, `csv_read`, and `docx_text`.

Each tool resolves a workspace-relative path against the calling session's cwd, reads at most 25 MB through `ctx.fs.readBytes`, and returns a bounded JSON-safe extraction instead of the raw file. Reading is the package's whole job: office CREATION is code-first, driven by running Python (`openpyxl` / `python-pptx` / `python-docx` / `reportlab`) through the bash tool and surfacing the result with `deliver`.

## Tools

| Tool | Input | Key behavior |
|---|---|---|
| `xlsx_read` | `.xlsx` | Per-sheet header, sampled rows, per-column type hints, A1 merged ranges, formulas kept as `{ formula: "=…" }` |
| `csv_read` | delimited text | Delimiter sniffing over `,`, `;`, tab, and `|`, RFC-4180 quoting, numeric coercion, bounded sample |
| `docx_text` | `.docx` | Title, headings 1-3, paragraphs, bullets, numbered items, and table rows as markdown-like lines |

Two bounds exist and they differ: the tool argument `max_rows` accepts up to 400 (defaults 100 for `xlsx_read`, 200 for `csv_read`), while extraction itself samples at most 200 rows and 64 columns per sheet and reports `truncated`. `docx_text` has no row argument; it stops at 24000 characters. Sampled values are shaped, never raw: dates become `YYYY-MM-DD`, booleans `TRUE`/`FALSE`, rich text is joined, error cells render as `{error:…}`. Banner-style workbooks that our own writers produce — a wide merged title on row 1 and the header on row 2 — are detected and reported with `title` and the header taken from row 2, so the data sample does not begin on the banner.

## Preview data

Extraction payloads are JSON-safe and replayable by construction, which is why the tools present generic read cards carrying `locations` rather than a bespoke preview renderer. The host preview service shares two helpers with this package — `loadWorkbookResilient` and `decodeEntities` — so the two xlsx readers cannot drift on which workbooks they can open or how they decode OOXML text.

## Model Experience

### `tool:office` and `tool:office-reads` system-prompt guidance

#### What the model sees

Two fixed guidance sections at order 105: `tool:office`, which routes creation to Python and `deliver`, and `tool:office-reads`, which names the three read tools and their bounds.

##### Verbatim `tool:office` section text

```markdown
Reading user files: use xlsx_read/csv_read/docx_text on uploaded spreadsheets and documents before analyzing them. Creating office files is done by WRITING AND RUNNING PYTHON CODE (openpyxl / python-pptx / python-docx / reportlab) through the bash tool using $DSH_OFFICE_PYTHON, then surfacing finished outputs with the deliver tool.
```

##### Verbatim `tool:office-reads` section text

```markdown
Reading user files: use xlsx_read on uploaded .xlsx workbooks (per-sheet header, sampled rows, column-type hints, merged ranges, formulas), csv_read on delimited text, and docx_text on .docx documents before analyzing or transforming them. Extraction is bounded; request follow-up slices only when genuinely needed. Analysis outputs still go through the create tools.
```

#### Token effect

Fixed: both paragraphs ship on every assembled request while the package is mounted, and neither varies with how many files a session reads.

#### KV Cache effect

Prefix-stable: both sections keep their text and order for the life of the mount, so a loaded prefix containing them stays reusable across turns.

### Office read tool definitions

#### What the model sees

The generated [`xlsx_read`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-office), [`csv_read`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-office), and [`docx_text`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-office) schemas: a required `file_path` on each, plus an optional `max_rows` on the two tabular tools whose description states the default and the hard cap.

#### Token effect

Fixed schema cost on every request where the tools are visible; the descriptions themselves carry the sampling policy, so the model does not need to discover the cap by trial.

#### KV Cache effect

Prefix-stable while the registered set and visibility are unchanged; plugin lifecycle or scoped restrictions that alter the tool set may invalidate reuse from the first changed definition.

### Extracted read results

#### What the model sees

Each result renders as `<path>…</path>`, `<type>xlsx|csv|docx</type>`, and a `<content>` block holding the JSON payload or, for `docx_text`, the markdown-like text. Sheet payloads carry `name`, `total_rows`, `total_cols`, an optional `header` and banner `title`, sampled `rows`, `column_types`, and up to 32 `merged_ranges`; both tabular tools set `truncated`. Stable failures are `unreadable workbook (exceljs failed, stripped-drawing retry also failed)` and `not a docx package (missing word/document.xml)`; an oversized file fails at the seam's 25 MB read bound.

#### Token effect

Conditional and file-dependent: one extraction is up to 400 sampled rows or 24000 characters, and follow-up slices append more. A wide workbook is charged at up to 64 columns per row, so the model controls the cost mainly through the two row parameters.

#### KV Cache effect

Append-only: extraction results follow the reusable request prefix rather than rewriting it, so reading a large file does not invalidate cached prefix tokens. Only a change to the registered tool set or the guidance paragraphs affects reuse.

## Known Limitations and Deferred Work

- No office file **preview** tool: the model cannot inspect an existing xlsx/pptx/docx beyond `read_bytes`-style access.
- No LibreOffice/full-fidelity fidelity guarantees: formatting is the tool's built-in default design, not a template engine.
- Reading is bounded and samples by position: a sparse sheet whose interesting data sits past the row cap needs an explicit follow-up slice, and only the tabular tools report `truncated` — `docx_text` reports it only on the paragraph-push path, so a document cut off at the block loop can return a partial `text` without the flag.
- The `tool:office-reads` guidance still tells the model that "analysis outputs still go through the create tools" — a leftover from the removal of `xlsx_create`/`pptx_create`/`docx_create`; creation is Python through `bash` plus `deliver` now.
