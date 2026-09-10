---
description: "The Whale task board for the dsh web client: scheduled-task snapshots projected into one compact chat node per workspace."
kind: "package-reference"
---

# `@deepseek-ai/dsh-ui-whale-tasks`

[English](README.md) | 中文

## 概述

One whole-value session event family (whale/task-board snapshots from whale-core) is projected by a conversation node definition into an immutable chat node; a keyed renderer draws the titled card with per-task status, schedule summary, and next-run time.

## 目录

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## 提供什么

One whole-value session event family (whale/task-board snapshots from whale-core) is projected by a conversation node definition into an immutable chat node; a keyed renderer draws the titled card with per-task status, schedule summary, and next-run time.

## 已知限制与后续工作

- Notification delivery rides the local Notification API when the tab is hidden; no push relay exists.

## 开发备注

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
