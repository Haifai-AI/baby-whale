---
description: "Whale artifact preview parsers plus the managed LibreOffice runtime: bounded xlsx/pptx/docx/text/media preview extraction and one-click soffice installation."
kind: "package-reference"
---

# `@deepseek-ai/host-apiproxy`

[English](README.md) | 中文

## 概述

The parsers turn workspace documents into the JSON preview shapes the studios render (xlsx grid + charts, pptx slides, docx blocks, text/code, media identity); the runtime module downloads and manages the pinned LibreOffice build that converts office documents to cached preview PDFs.

## 目录

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## 提供什么

The parsers turn workspace documents into the JSON preview shapes the studios render (xlsx grid + charts, pptx slides, docx blocks, text/code, media identity); the runtime module downloads and manages the pinned LibreOffice build that converts office documents to cached preview PDFs.

## 已知限制与后续工作

- Conversion is optional: previews parse without LibreOffice and upgrade to pixel-true renders when the runtime (or a system soffice) is present.

## 开发备注

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
