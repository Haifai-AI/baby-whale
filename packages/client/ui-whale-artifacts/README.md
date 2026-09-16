# `@deepseek-ai/dsh-client-ui-whale-artifacts`

English | [中文](README.zh.md)

The **Artifacts** view tab (`id: whale-artifacts`, `order: 11`) beside Chat and Trajectory: a metadata-only gallery of the session workspace's `deliverables/` and `uploads/` files, with a right-side preview pane and Open-in-app, served by the `artifacts` gateway domain.

## Listing

`artifacts.list` answers one session-addressed read per mount; Refresh repeats it, and nothing else does, because the wire carries no artifact-change notification. Rows arrive newest first, bounded at 200 entries by the host scan, which stats the top level of the two directories only and skips hidden names and nested directories.

Each row draws a kind badge, the file name with its full path as the title, the origin (`from.deliverable` / `from.upload`), the byte size, and the localized modification time with an unknown-date fallback. Preview appears only for kinds the browser or the studio can render; `other` offers Open alone. Opening — from a row or the pane header — resolves the workspace-relative path against the session cwd and hands it to `host.openPath`; a deployment that reports no cwd still opens the bare relative path.

## Preview pane

Selection drives one parse per file, and each selection claims a generation so a slower earlier response cannot overwrite a newer one. Kinds with a native browser renderer — image, video, and audio — skip the parse call entirely and point the pane at the tokenized `artifacts.raw` URL; video and audio render the native players, which stream through the Range-capable channel.

Parsed previews route by kind: `markdown` through `MarkdownFilePreview`, `text` through `CodeFilePreview` (both note a truncated parse), `pdf` through the host-only converted-PDF channel in an iframe, and the office kinds through `ArtifactStudioBody`, reusing [`ui-whale-artifact`](../ui-whale-artifact/README.md)'s public studio. A workbook gets its own tabs: `Data` (the native grid studio), `Charts (n)` (the workbook's embedded charts re-rendered as themed SVG), and `Original` (LibreOffice's PDF render of the real file) — each tab disappears independently when its source is missing. When the parse reports `soffice-missing`, a notice explains the text-extraction fallback ahead of the body.

## Composition

The package declares `dsh.client` (platform `web`, with `@deepseek-ai/dsh-client-ui-whale-artifact/client` and `@deepseek-ai/dsh-client-connection/client` as declared module requests), registers one `conversation.view` entry whose registration injects the connection handle and the addressed session, plus the `whale-artifacts` dictionary namespace. Its node half contributes no host behavior.

## Model Experience

### Artifacts gallery and preview pane

#### What the model sees

Nothing: the tab renders a browser-side gallery over the `artifacts.list` and `artifacts.preview` gateway reads and the `artifacts.raw` / `artifacts.file` byte channels, none of which touch a request. This package registers no prompt section, no tool definition, and no tool result.

#### Token effect

Zero direct effect: listing, refreshing, and previewing artifacts add no tokens to any request, and the tokenized raw URLs serve the browser only.

#### KV Cache effect

Independent: the package neither assembles nor sends a provider request, so preview activity cannot invalidate a reusable prefix.

## Known Limitations and Deferred Work

- **The listing is read once per mount** — the wire announces no artifact change, so a file written after the tab mounted stays invisible until Refresh or a session switch.
- **The scan is two flat directories capped at 200 entries** — only files directly under `deliverables/` and `uploads/` are listed, hidden names are skipped, and the cap keeps the newest 200 by modification time.
- **Office previews need LibreOffice** — the `Original` tab and the pixel-true office render depend on the host's `soffice` runtime; without it the studio shows a text extraction with a notice, and `Charts (n)` still carries only the charts the parse could extract.
- **The `Charts` tab is a re-drawing, not the workbook's own rendering** — embedded charts are re-rendered as themed SVG from the extracted series (grouped column, bar, line, area, pie, doughnut, and scatter), so their styling does not match Excel's.
- **Preview URLs carry the instance token** — the pane's iframe and media players ride `withApiTokenQuery` URLs, and the host refuses any path outside the two scanned directories.
- **A stale parse is dropped, a stale listing is not** — the per-selection generation guard discards a late preview response, while the gallery rows keep the metadata captured at the last read.
