---
description: "Whale guardrails: the pre-execute fence that stands down for workspace-safe operations under the session's permission preset and asks otherwise."
kind: "package-reference"
---

# `@deepseek-ai/whale-guardrails`

[English](README.md) | 中文

## 概述

The fence reads the session permission preset (read-only, workspace-write, danger-full-access); in-workspace overwrites under workspace-write pass silently, while destructive or out-of-workspace operations raise the user-approval flow.

## 目录

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## 提供什么

The fence reads the session permission preset (read-only, workspace-write, danger-full-access); in-workspace overwrites under workspace-write pass silently, while destructive or out-of-workspace operations raise the user-approval flow.

## 已知限制与后续工作

- Heuristics are deliberately conservative; new destructive verbs need explicit classification here.

## 开发备注

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
