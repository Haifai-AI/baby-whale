# Agent Note: Skeptic-confirmed audit findings, batch 1

Status: implemented

English | [中文](2026-09-08-audit-findings-batch-1.zh.md)

## Problem

A read-only audit of the application layer produced 15 skeptic-confirmed findings: every item survived an independent re-check against the code, and a separate deferred list was explicitly marked not-verified and is not acted on here. The confirmed set clusters on four boundaries: model-controlled fetch can reach non-public networks; the host API trusts loopback as authorization; workspace file reads, previews, and uploads use lexical prefix checks an attacker-controlled path can escape; and executed artifacts (runtime bundle, PyPI environment, office runtime) install without integrity checks. Smaller confirmed items cover unbounded request buffering, decode-before-limit uploads, an unstoppable reconnect backoff, and a stale-preview race.

## Decision

Each finding is fixed at its choke point; deferred leads are untouched.

Model-controlled egress (`dsh-web-fetch-http`) denies non-public destinations by default — loopback, private ranges, link-local, and cloud metadata — resolving DNS first and re-validating every redirect hop. `egressAllowHosts` is the explicit operator opt-in for internal hosts, validated as bare hosts at load. Residual DNS-rebinding risk is documented on the provider.

Host API authentication is a per-instance token minted at boot (256 bits, URL-safe) or pinned from deployment config, which must meet a length and alphabet check or the load fails. The trust fence still decides loopback versus declared authority; the token gate runs beside it on the `/api` route and on both WebSocket downlinks. Browsers cannot set WebSocket headers, so downlinks and subresource URLs carry the token as a `token` query parameter; the entry URL carries it as a `#token=` fragment that never crosses the HTTP boundary, and a `0600` token file per serving port hands the credential to non-browser automation.

Workspace containment is one helper, `anchorWorkspacePath`: trailing-separator boundary plus symlink resolution, refusing escapes and missing files with a single indistinguishable refusal. Preview, raw-file, and cache reads funnel through it; SVG serves as an attachment so same-origin navigation cannot execute stored script while `<img>` subresource use is unaffected. Upload intake validates the uploads directory object itself, removing a planted symlink and refusing non-directories before creating anything.

Executed artifacts verify before use and fail closed. The `bwhale` launcher resolves a required SHA-256 digest (release field or published `.sha256` sidecar) before downloading, and refuses releases without digest material. The office venv installs from a hash-locked requirements set with `--require-hashes` and no installer self-upgrade; the managed LibreOffice fetch pins a SHA-256 per macOS artifact and verifies the streamed download before anything mounts it. The LibreOffice pins were captured from the official release bytes by the change author and are not independently re-verified in this tree.

Resource and lifecycle bounds: the HTTP bridge reserves every request body against a service-wide in-flight budget (503 past it) instead of buffering per-request caps without a global ceiling; image admission refuses over-cap base64 text before decoding allocates; the connection controller's stop cancels a pending backoff through one lifecycle token and orphaned restart loops exit on their aborted token; artifact previews carry a per-request generation so a late earlier response cannot overwrite a newer selection.

## Testing

Each fix ships with its boundary tests: egress allow/deny plus per-hop re-validation; tokenless, forged, and query-carried credentials on HTTP and WebSocket paths, minting, and weak-pin load failure; sibling-prefix, symlink, and uploads-object escapes; SVG disposition; fail-closed digest resolution; lock-byte reproduction of both install scripts; streamed hash verification; budget 503s and over-release accounting; encoded-size refusal before decode; stop-during-backoff and restart-without-doubling; and a preview-race suite that fails against the old shared flag. Every affected suite passes, typecheck is green, and lint reports no diagnostics on touched files; a full unit run shows no new failures against the base control. Per-file coverage holds for every new module; pre-existing gaps elsewhere are left untouched.

## Alternatives considered

**Allowlist-only egress (permit public by default, block listed bad ranges).** Rejected: enumerating hostile destinations is open-ended — metadata, link-local, and new private uses keep arriving — while legitimate model fetch targets are overwhelmingly public, so default-deny with an explicit internal opt-in fails toward safety.

**Header-only token, no query carrier.** Rejected: WebSocket upgrades and subresource URLs cannot set headers in browsers, so a header-only design would leave the downlinks or force them onto a weaker check. The query carrier is narrow (exact `token` parameter) and verified in constant time like the header.

**Warn-and-continue on missing bundle digests.** Rejected: a warning on the download path trains operators to ignore the one signal that distinguishes a compromised mirror from a slow one. Old releases without sidecars are refused for fresh downloads; already-installed runtimes keep running.

**Fix the deferred leads in the same pass.** Rejected: they were not skeptic-confirmed, and several name behavior the codebase may intend. Each needs independent reproduction before any fix decision.

## Consequences

Loopback development flows that fetch internal hosts must now set `egressAllowHosts`; sandboxed shell defaults to denied egress and non-confining runners fail closed under it. Fresh `bwhale` installs refuse pre-sidecar releases. Every first-party UI surface presents the instance token, so third-party frontends must do the same or fail the fence. The reconnect loop no longer doubles on rapid restart, and rapid preview reselection renders the current file. The supply-chain posture moves from transport-only trust to pinned bytes, at the cost of bumping pins and the lock marker with each upstream release.
