# Agent Note: Media deliverables preview natively with HTTP Range playback

Status: implemented

English | [中文](2026-09-08-media-deliverables-range-playback.zh.md)

## Problem

Deliverables were readable, but not playable: a screen recording or narration the coworker produced had no in-app preview — the file card offered only a download or an external open. Serving media through the existing whole-file bytes channel also had no `Range` support, so even a hand-built `<video>` element could not seek: browsers scrub by requesting byte slices, and a server that answers every request with the entire file forces a full re-download per seek. Buffering whole videos host-side to serve them would have made the preview RPC and the bytes channel pay a memory cost proportional to media length.

## Decision

Video (`.mp4`, `.m4v`, `.webm`) and audio (`.mp3`, `.wav`, `.ogg`, `.oga`, `.m4a`, `.flac`, `.aac`, `.opus`) deliverables preview through native browser players, and the artifacts bytes channel (`artifacts.raw`) speaks single-range HTTP `Range`:

- The forwarded `Range` header accepts only the `bytes` unit with one range. `bytes=a-b` serves a 206 slice read through a file handle at offset (a multi-gigabyte video is never fully buffered); `bytes=a-` runs through EOF; `bytes=-n` is a suffix resolved against the file size; ends clamp to the file; an unsatisfiable range is `416` with `bytes */<size>`; malformed or multi-range headers fall back to the whole-file `200`, which players treat as plain success. Every response carries `Accept-Ranges: bytes`.
- Media preview payloads are identity-only and short-circuit before any byte read; the player rides the raw channel.
- Players are keyed by path, so switching files rebuilds the element and playback state never leaks across retargets.
- `.mov` is deliberately outside the native-player set: the QuickTime container does not play in Chromium or Firefox, and a dead player with no fallback is worse than the honest path — `.mov` files keep the generic preview and open in the system player.

The extension lists live in four places that must agree — the host content-type map, the host media-kind classifier, and the two client dispatchers — and each carries a pointer comment to the others.

## Alternatives considered

- **Whole-file responses with `Accept-Ranges: none`**: smallest diff, but scrubbing re-downloads the file and long recordings become unusable in the panel; rejected because playback was the point.
- **Host-side transcode to a uniform format**: would have normalized containers but added a media-tool dependency to every platform bundle and a quality/latency tax on every preview; rejected against the nothing-office-sized-is-required rule.
- **A client-side player library**: solves seeking only when the server supports ranges anyway, and adds bundle weight for what native elements already do; rejected.
- **Keeping `.mov` on the native path for Safari users**: one platform would have gained in-panel playback while every other browser showed a broken player with no download affordance; rejected in favor of a consistent external open.

## Consequences

The preview RPC for media stays O(1) in file size, seeking costs only the requested slice, and playback state cannot leak between files. In exchange, four extension lists must move together when a format is added, and browser support — not our code — decides which containers play: a format Chromium and Firefox cannot decode must be added to the native set only with an explicit fallback story.
