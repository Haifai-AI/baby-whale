# Agent Note: A prerelease tag never takes the channel the updater follows

Status: implemented

English | [中文](2026-09-16-prerelease-tags-never-take-the-updater-channel.zh.md)

## Problem

The portable bundle publishes a GitHub Release from every `v*` tag, and `npm/bwhale/bin/bwhale.js` resolves updates by fetching `https://api.github.com/repos/Haifai-AI/baby-whale/releases/latest`. The release step in `.github/workflows/bundle.yml` created every release with `--latest` and no prerelease flag, so the two sides disagreed about what a prerelease tag means: GitHub skips a release marked prerelease when it answers `releases/latest`, but the `--latest` flag overrides that and marks the release as the channel regardless of its tag.

That made a rehearsal tag indistinguishable from a stable one at the only place that decides what an installed launcher fetches. Tagging `v0.2.0-preview` to get preview artifacts into testers' hands would have pushed that preview onto every existing installation at its next start, because the updater reads the channel and not the version: `pickAsset` takes whatever `releases/latest` names and installs it.

## Decision

The release flag follows the version. `.github/workflows/bundle.yml` selects the release arguments from `GITHUB_REF_NAME` with a shell case: a tag whose name contains `-` is a semver prerelease, and publishes with `--prerelease`; every other tag publishes with `--latest`.

A prerelease release therefore carries its bundle zips and checksum sidecars as ordinary assets, is reachable by tag from the Releases page, and is invisible to `releases/latest`. Installing a preview is an explicit act — fetch the tag's asset by name — rather than a side effect of the update path. `--generate-notes` still names the delta from the previous release either way.

`scripts/ci-workflow.spec.ts` pins the step: it asserts both case arms, the `"${release_args[@]}"` expansion, and the absence of a bare `--generate-notes --latest` that would defeat the branch.

## Alternatives considered

- **Leaving the workflow alone and marking the preview release by hand after it is created** — the workflow races four matrix jobs at this step, and the first one creates the release, so a manual correction would have to follow a run that had already published the channel; rejected because the window is exactly when the harm happens.
- **Publishing preview bundles as workflow artifacts instead of a Release** — artifacts expire, need repository read access to fetch, and `bwhale` has no path to them; rejected because a preview nobody can install without a GitHub account is not a preview channel.
- **Refusing prerelease tags in the release step** — would make a rehearsal impossible rather than safe, and the version scheme already uses prereleases for exactly this purpose ([npm release sequences](2026-08-10-npm-release-sequences.md)); rejected.
- **Having `bwhale` filter prereleases itself** — the filter would only protect launchers that already carry it, while the release step is what decides for every launcher ever installed; rejected in favor of the side that all readers agree on.

## Consequences

A preview release can no longer displace the stable channel by accident, and the check is mechanical: a tag with a prerelease segment cannot create a `latest` release, so the pre-release path is safe by construction rather than by remembering to pass a flag.

In exchange, a preview needs a deliberate fetch to install, and this note is the only place that records the rule — the guard pins the workflow text rather than the behavior of GitHub's release API, so the `case` arms must keep matching the spellings the spec asserts. The npm publication path is unaffected: it already selects its dist-tag from the version ([npm release sequences](2026-08-10-npm-release-sequences.md)), which is the same decision applied to a second channel.
