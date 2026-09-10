---
description: "Office read tools (xlsx_read, csv_read, docx_text): bounded, sandboxed extraction over uploaded workspace documents."
kind: "package-reference"
---

# `@deepseek-ai/office-tool-office`

[English](README.md) | 中文

## 概述

Each tool opens the document through the session filesystem and returns a capped, structured view (worksheet grids with formulas, csv rows, document blocks) so analysis starts from real user data instead of guesses.

## 目录

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## 提供什么

Each tool opens the document through the session filesystem and returns a capped, structured view (worksheet grids with formulas, csv rows, document blocks) so analysis starts from real user data instead of guesses.

## 已知限制与后续工作

- Reads are bounded by design; creation flows belong to the skills and bash.

## 开发备注

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
