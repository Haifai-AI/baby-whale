# `@deepseek-ai/dsh-client-ui-whale-artifact`

English | [中文](README.zh.md)

Office artifact preview cards for the Web GUI: keyed tool views for `xlsx_create`, `pptx_create`, and `docx_create` that render the bounded preview embedded in each tool result's `presentationMeta` as a Cowork-style artifact card — spreadsheet chrome (sheet tabs + frozen Excel-style grid), slide-deck thumbnails (16:9 cards), or a readable document page.

The preview data is generated server-side and caps every dimension (sheets/rows/cols, slides/bullets, blocks/text); anything cut carries `truncated: true` and the card shows a notice. No file-byte RPC is involved: the card is a pure render of the persisted tool-result metadata, so it replays identically.

## Composition

The package declares `dsh.client` (platform `web`), ships `./client`, and registers three keyed `tool.call.toolview` entries plus the `whale-artifact` dictionary namespace. Composers remove the whole surface by removing its roster row.

## Rendering contract

`previewOf` reads the preview from a settled, successful tool-result block. A running call, an errored result, or a result whose metadata carries no preview renders the failure card instead, and that arm offers neither Open nor the details studio even when the call arguments do carry a usable path. `filePathOf` parses `file_path` back out of the call's raw argument JSON to label the card and drive Open, falling back to the tool name when the result carries neither a file name nor a path.

The same preview also fills this package's `conversation.details.toolview` studios: the spreadsheet studio adds Excel-style chrome (formula bar, column letters, row gutter, navy header row) and selects a cell to show its formula, the deck studio renders one page-numbered 16:9 card per slide, and the document studio renders the shared paper page. `ArtifactStudioBody` is the public `/client` export another surface composes to render the same body from an already-parsed preview.

## Model Experience

### Office artifact card rendering

#### What the model sees

Nothing from this package: the card is a browser render of the preview carried in a settled office tool result's `presentationMeta`, a UI-only channel that no request assembly reads. The model-visible side of those calls is the producing tool's own result envelope, which this package neither registers nor rewrites.

#### Token effect

Zero direct effect: the package registers no prompt section, tool definition, or tool result, and nothing it renders is resent with a later request.

#### KV Cache effect

Independent: the package assembles and sends no provider request, so mounting it, removing it, or switching sheets and slides in the browser cannot invalidate a reusable prefix.

## Known Limitations and Deferred Work

- **A card is a call-time snapshot** — the preview is persisted with the tool result, so a file edited after the call keeps rendering the recorded sheets, slides, or blocks until the call is repeated; there is no file-byte read and no refresh action.
- **Client-side render caps sit below the payload caps** — the card grid draws at most 100 rows, the details studio at most 200, and a slide card at most 12 bullets with a `{count} more` note, so a payload that carries more is shortened again on the browser side.
- **A result without preview metadata has no usable fallback** — the failure card is the whole body, and its header drops the Open action even when the recorded arguments name a path the user could still open.
- **The key set is the fixed three wire names** — only `xlsx_create`, `pptx_create`, and `docx_create` reach these cards, so an office file produced through any other call renders as a generic tool row.
- **The three preview shapes are a hand-maintained mirror** — `OfficePreviewData` duplicates the producing package's payload types, and a producer-side field change compiles here without a type error until the render is checked against the new payload.
