---
description: "The deliver model-facing tool: claims finished workspace files as user-facing deliverables."
kind: "package-reference"
---

# `@deepseek-ai/whale-tool-deliver`

English | [中文](README.zh.md)

## Summary

deliver records the claim against the session; the conversation turn-tail aggregates claims into end-of-turn deliverable cards exactly like every other mutation tool, and the artifacts gallery lists them.

## Table of Contents

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## What it provides

deliver records the claim against the session; the conversation turn-tail aggregates claims into end-of-turn deliverable cards exactly like every other mutation tool, and the artifacts gallery lists them.

## Known Limitations and Deferred Work

- deliver never writes, moves, or mutates anything: the file must already exist under the workspace.

## Dev Note

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
