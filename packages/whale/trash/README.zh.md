---
description: "Whale trash: an undo layer that backs up every overwritten workspace file to .whale-trash and ships a restore tool."
kind: "package-reference"
---

# `@deepseek-ai/whale-trash`

[English](README.md) | 中文

## 概述

Overwrites route their previous content into .whale-trash with a timestamped name; the restore tool lists and restores entries without touching anything else.

## 目录

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## 提供什么

Overwrites route their previous content into .whale-trash with a timestamped name; the restore tool lists and restores entries without touching anything else.

## 已知限制与后续工作

- Trash is per-workspace and unbounded; pruning is deferred.

## 开发备注

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
