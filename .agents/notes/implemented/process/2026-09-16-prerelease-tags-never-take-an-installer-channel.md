# Agent Note: A prerelease tag never takes a channel an installer follows

Status: implemented

English | [中文](2026-09-16-prerelease-tags-never-take-an-installer-channel.zh.md)

## Problem

The portable bundle publishes two distribution channels from every `v*` tag, and both default to the stable channel unless the tag's version says otherwise.

The GitHub Release is the one `npm/bwhale/bin/bwhale.js` follows: it resolves updates by fetching `https://api.github.com/repos/Haifai-AI/baby-whale/releases/latest`. The release step in `.github/workflows/bundle.yml` created every release with `--latest` and no prerelease flag, so the two sides disagreed about what a prerelease tag means. GitHub skips a release marked prerelease when it answers `releases/latest`, but the `--latest` flag overrides that marking and points the channel at the release regardless of its tag.

The npm launcher is the one `npm install -g @haifai/bwhale` follows. `npm publish` takes the `latest` dist-tag unless it is told otherwise, which the step never did.

That made a rehearsal tag indistinguishable from a stable one at both places that decide what an installer fetches. Tagging `v0.2.0-preview` to get preview artifacts into testers' hands would have pushed that preview onto every existing installation at its next start, and onto everyone installing the launcher from npm. The updater reads the channel and not the version: `pickAsset` takes whatever `releases/latest` names and installs it.

## Decision

Both publication steps select their channel flag from `GITHUB_REF_NAME` with a shell case. A tag whose name contains `-` is a semver prerelease: the GitHub release publishes with `--prerelease` and the npm package with `--tag next`. Every other tag publishes `--latest` and takes the default `latest` dist-tag.

A prerelease release therefore carries its bundle zips and checksum sidecars as ordinary assets, is reachable by tag from the Releases page, and is invisible to `releases/latest`; the launcher version is visible under the `next` dist-tag and not under `latest`. `--generate-notes` still names the delta from the previous release either way.

Installing a preview is an explicit act. Either install the launcher from npm (`npm install -g @haifai/bwhale@next`) and pin the runtime with `BWHALE_VERSION=v0.2.0-preview bwhale`, or fetch the tag's zip and its checksum sidecar directly. The launcher resolves a pinned tag through `releaseByTag`, which finds a prerelease release.

`scripts/ci-workflow.spec.ts` pins both steps: each case's two arms, its array expansion, and — for the GitHub release — the absence of a bare `--generate-notes --latest` that would defeat the branch.

## Alternatives considered

- **Leaving the workflow alone and marking the preview release by hand after it is created** — the workflow races four matrix jobs at this step, and the first one creates the release, so a manual correction would have to follow a run that had already published the channel; rejected because the window is exactly when the harm happens.
- **Publishing preview bundles as workflow artifacts instead of a Release** — artifacts expire, need repository read access to fetch, and `bwhale` has no path to them; rejected because a preview nobody can install without a GitHub account is not a preview channel.
- **Skipping the npm publish on a prerelease tag** — the step already carries `continue-on-error`, so a skipped publication is indistinguishable from a failed one, and a launcher version that never published would read as shipped; rejected in favor of publishing to a channel that means "not stable", which is the same decision `scripts/release/publish.ts` already makes for the dsh family ([npm release sequences](2026-08-10-npm-release-sequences.md)).
- **Refusing prerelease tags in the release step** — would make a rehearsal impossible rather than safe, and the version scheme already uses prereleases for exactly this purpose ([npm release sequences](2026-08-10-npm-release-sequences.md)); rejected.
- **Having `bwhale` filter prereleases itself** — the filter would only protect launchers that already carry it, while the release step is what decides for every launcher ever installed; rejected in favor of the side that all readers agree on.

## Consequences

A preview release can no longer displace the stable channel by accident on either distribution path, and both checks are mechanical: a tag with a prerelease segment cannot create a `latest` release or a `latest` npm version, so the pre-release path is safe by construction rather than by remembering to pass a flag.

In exchange, a preview needs a deliberate install, and this note is the only place that records the rule — the guards pin the workflow text rather than the behavior of GitHub's and npm's APIs, so the `case` arms must keep matching the spellings the spec asserts. The launcher package sits outside the pnpm workspace, so `release:dsh` does not bump `npm/bwhale/package.json`; a release commit must move that version by hand, because npm refuses to republish an existing version and a stale one fails silently behind `continue-on-error`.
