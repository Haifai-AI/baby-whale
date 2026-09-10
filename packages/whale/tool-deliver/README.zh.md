---
description: "The deliver model-facing tool: claims finished workspace files as user-facing deliverables."
kind: "package-reference"
---

# `@deepseek-ai/whale-tool-deliver`

[English](README.md) | 中文

## 概述

deliver records the claim against the session; the conversation turn-tail aggregates claims into end-of-turn deliverable cards exactly like every other mutation tool, and the artifacts gallery lists them.

## 目录

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## 提供什么

deliver records the claim against the session; the conversation turn-tail aggregates claims into end-of-turn deliverable cards exactly like every other mutation tool, and the artifacts gallery lists them.

## 已知限制与后续工作

- deliver never writes, moves, or mutates anything: the file must already exist under the workspace.

## 开发备注

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
