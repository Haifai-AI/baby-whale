# `@deepseek-ai/dsh-tool-office`

Model-facing office artifact generation tools over the [filesystem seam](../fs/README.md): `xlsx_create`, `pptx_create`, and `docx_create`.

Each tool generates a real binary document (Excel 2007+ workbook, PowerPoint 16:9 deck, Word document) and writes it through `ctx.fs.writeBytes` — the same atomic, observed, sandboxed write path `dsh-tool-fs` uses, so artifacts respect the mounted fs policy and show up in the deliverables UI as produced files.

## Tools

| Tool | Output | Key behavior |
|---|---|---|
| `xlsx_create` | `.xlsx` | styled header row, frozen first row, fitted column widths, number-typed cells stay numeric |
| `pptx_create` | `.pptx` | 16:9 deck: title slide + content slides with accent bar, theme colors `{ primary, accent }` |
| `docx_create` | `.docx` | title, headings 1-3, paragraphs, quotes, bullets, numbered lists |

Artifact paths resolve under the calling session's workspace cwd (`exec.agent.session.header.cwd`), mirroring `dsh-tool-fs`.

## Preview data

Each successful tool result carries a bounded **preview** in `presentationMeta` (the client renders it from the tool result node's `meta`): capped sheet rows/columns, slide bullets, and document blocks. Caps live in `src/preview.ts`; anything cut sets `truncated: true`. Previews are JSON-safe and replayable; they are derived from the tool arguments so they never round-trip file bytes.

## Model Experience

### What the model sees

- Three tool declarations with per-tool schemas (sheets/slides/blocks) plus a shared `tool:office` guidance section; the section text above is what the model reads when assembling a prompt.
- Each call returns a short envelope: path, format, counts, byte size.

### Token effect

One guidance paragraph plus tool schemas; constant per session.

## Known Limitations and Deferred Work

- No office file **reader/preview** tool: the model cannot inspect an existing xlsx/pptx/docx beyond `read_bytes`-style access; `read_back` tooling for office formats is deferred.
- No LibreOffice/full-fidelity fidelity guarantees: formatting is the tool's built-in default design (navy `#1E3A5F` primary, blue `#2F6FB2` accent), not a template engine.
- Binary writes use the `writeBytes` seam; a backend that does not implement it throws on first use.
