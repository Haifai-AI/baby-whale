---
description: "Whale core: the durable task store, cron and schedule evaluation, HQ task delivery into sessions, the whale_task_* tools, and the task-board snapshots the board renders from."
kind: "package-reference"
---

# `@deepseek-ai/whale-core`

[English](README.md) | 中文

## 概述

Tasks live in the durable storage domain, are evaluated by the host scheduler, and deliver their prompts into their owning sessions; every state change publishes a whale/task-board session event.

## 目录

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## 提供什么

Tasks live in the durable storage domain, are evaluated by the host scheduler, and deliver their prompts into their owning sessions; every state change publishes a whale/task-board session event.

## 已知限制与后续工作

- One HQ scheduler instance evaluates due work; multi-host fan-out is out of scope.

## 开发备注

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
