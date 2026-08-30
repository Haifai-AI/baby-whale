# `@deepseek-ai/dsh-client-ui-whale-artifact`

Office artifact preview cards for the Web GUI: keyed tool views for `xlsx_create`, `pptx_create`, and `docx_create` that render the bounded preview embedded in each tool result's `presentationMeta` as a Cowork-style artifact card — spreadsheet chrome (sheet tabs + frozen Excel-style grid), slide-deck thumbnails (16:9 cards), or a readable document page.

The preview data is generated server-side by `@deepseek-ai/dsh-tool-office` and caps every dimension (sheets/rows/cols, slides/bullets, blocks/text); anything cut carries `truncated: true` and the card shows a notice. No file-byte RPC is involved: the card is a pure render of the persisted tool-result metadata, so it replays identically.

## Composition

The package declares `dsh.client` (platform `web`), ships `./client`, and registers three keyed `tool.call.toolview` entries plus the `whale-artifact` dictionary namespace. Composers remove the whole surface by removing its roster row.

## Model Experience

### What the model sees

Nothing: all browser-surface renderer copy lives client-side.

### Token effect

Zero (server guidance for the office tools comes from `@deepseek-ai/dsh-tool-office`).

## Known Limitations and Deferred Work

- No interactive editing: previews are read-only thumbnails; editing opens the file through the Host opener.
- Preview caps are fixed server-side; a deck with more than 24 slides shows its first 24.
