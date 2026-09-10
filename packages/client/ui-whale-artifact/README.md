---
description: "Office artifact preview cards for the dsh web client: keyed tool views that render the bounded preview metadata embedded in office tool results as Cowork-style artifact cards."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-whale-artifact

English | [中文](README.zh.md)

## Summary

Office artifact preview cards for the Web GUI: keyed `tool.call.toolview` entries for the office tools that render the bounded preview embedded in each tool result's `presentationMeta` — spreadsheet chrome (sheet tabs, formula bar, frozen Excel-style grid), slide-deck thumbnails (16:9 cards), or a readable document page.

The preview data is generated server-side and caps every dimension (sheets/rows/cols, slides/bullets, blocks/text); anything cut carries `truncated: true` and the card shows a notice. No file-byte RPC is involved: the card is a pure render of the persisted tool-result metadata, so it replays identically.

## Table of Contents

- [What it registers](#what-it-registers)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The card** — the keyed `tool.call.toolview` seat under each office tool name: `OfficeArtifactCard` picks the artifact path and preview out of the durable call/result pair and renders the studio body.
- **The studio bodies** — `ArtifactStudioBody` (public API of this package) renders any parsed office preview: the Excel-style grid for xlsx, the slide gallery for pptx, and the document page for docx. The Artifacts gallery (`ui-whale-artifacts`) reuses these bodies through the client bundle face.
- **The dictionary** — the `whale-artifact` locale namespace.

## Model Experience

### What the model sees

Nothing: all browser-surface renderer copy lives client-side.

### Token effect

Zero (server guidance for the office tools comes from `@deepseek-ai/dsh-tool-office`).

## Known Limitations and Deferred Work

- Right-panel (document preview) bodies for office kinds are deferred; the Artifacts gallery carries the full studio meanwhile.

## Dev Note

- Preview shapes mirror `@deepseek-ai/dsh-host-apiproxy`'s `ParsedPreview` union; `whale-preview.ts` keeps the mapping and byte formatting pure and is unit-covered there.
- The card reads only durable presentation metadata, so history pages rebuild without host round-trips.
