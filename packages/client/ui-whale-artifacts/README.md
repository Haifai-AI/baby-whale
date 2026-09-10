---
description: "The Artifacts gallery tab for the dsh web client: one conversation.view entry listing the session's deliverables and uploads with right-side previews, downloads, and studio rendering."
kind: "package-reference"
---

# `@deepseek-ai/dsh-ui-whale-artifacts`

English | [中文](README.zh.md)

## Summary

The gallery lists every delivered claim under the session workspace's deliverables/ and uploads/ (server-scanned), parses previews through the artifacts routes, and renders office kinds through the shared studio bodies; media streams from the Range-capable raw channel.

## Table of Contents

- [What it provides](#what-it-provides)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-provides"></a>
## What it provides

The gallery lists every delivered claim under the session workspace's deliverables/ and uploads/ (server-scanned), parses previews through the artifacts routes, and renders office kinds through the shared studio bodies; media streams from the Range-capable raw channel.

## Known Limitations and Deferred Work

- Right-panel preview bodies for office kinds are deferred; the gallery's own preview pane carries the full studio meanwhile.

## Dev Note

- Baby Whale-specific package introduced in the 0.1.x line; upstream v0.1.5 does not carry it, so sync merges must re-register it (tsconfig aliases, catalog manifests) rather than expect upstream support.
