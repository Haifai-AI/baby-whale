#!/usr/bin/env bash
# make-bundle — assemble the zero-install portable bundle for the current
# platform: the built workspace tree (libs + web dist + production
# node_modules), a matching portable Node binary, and a double-click
# launcher. Output: dist/baby-whale-<platform>-<arch>-<version>.zip
#
# Prereqs: a completed `pnpm install` + `pnpm run build` in this repo, and
# network for the Node dist tarball.
set -euo pipefail
cd "$(dirname "$0")/.."

# Version: CI passes the tag (RELEASE_VERSION) on release builds so the asset
# name always matches the release tag the launcher searches for; anything else
# (or a non semver value, e.g. a branch name) falls back to the app version.
VERSION="${RELEASE_VERSION:-}"
VERSION="${VERSION#v}"
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) VERSION="$(node -p "require('./apps/cli/package.json').version")" ;;
esac
OS="$(uname -s)"           # Darwin / Linux
ARCH="$(uname -m)"         # arm64 / aarch64 / x86_64
[ "$ARCH" = "aarch64" ] && ARCH="arm64"  # Linux arm runners report aarch64
NODE_VERSION="$(node -v)"  # e.g. v22.19.0 — bundle the running major
case "$OS" in
  Darwin) PLATFORM="macos"; NODE_OS="darwin" ;;
  Linux)  PLATFORM="linux"; NODE_OS="linux" ;;
  *) echo "unsupported host OS: $OS (build bundles on mac/linux CI)" >&2; exit 1 ;;
esac
case "$ARCH" in
  arm64)  NODE_ARCH="arm64" ;;
  x86_64) NODE_ARCH="x64" ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

STAGE_ROOT="$(mktemp -d)"
STAGE="$STAGE_ROOT/baby-whale-$PLATFORM-$ARCH-$VERSION"
mkdir -p "$STAGE"
trap 'rm -rf "$STAGE_ROOT"' EXIT

echo "==> copying workspace tree"
# Excludes are root-anchored (/dist = the repo's build-output dir) — a bare
# `dist` would also strip every node_modules package's dist/ (js-yaml et al).
rsync -a \
  --exclude /.git --exclude /.github --exclude /.artifacts --exclude /.dsh-build \
  --exclude /coverage --exclude /tmp --exclude "/*.tsbuildinfo" --exclude /dist \
  --exclude /scripts/tmp \
  ./ "$STAGE/baby-whale/"

echo "==> keeping node_modules intact"
# No pnpm prune here: this repo's runtime imports ride devDependencies
# (e.g. app-boot imports @deepseek-ai/cordis declared as dev), so a --prod
# install drops modules the built libs require. The full install is what
# the development machine runs — ship it byte-for-byte. Only the one
# runtime-relevant postinstall — node-pty's stripped spawn-helper exec
# bit — is re-asserted in case the archive strips it.
(cd "$STAGE/baby-whale/packages/subprocess/subprocess-local" && node scripts/ensure-spawn-helper.mjs)

echo "==> fetching portable Node $NODE_VERSION ($NODE_OS-$NODE_ARCH)"
mkdir -p "$STAGE/node"
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}.tar.gz" \
  | tar -xz -C "$STAGE/node" --strip-components=1 "node-${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}/bin/node"

echo "==> writing launcher + readme"
cat > "$STAGE/START.command" <<'LAUNCH'
#!/bin/bash
set -e
cd "$(dirname "$0")/baby-whale"
export PATH="$(cd "$(dirname "$0")" && pwd)/node/bin:$PATH"
exec node apps/cli/lib/bin.js web "$@"
LAUNCH
chmod +x "$STAGE/START.command"
cp "$STAGE/START.command" "$STAGE/START"
cat > "$STAGE/README.txt" <<'README'
Baby Whale — zero-install preview
=================================

Run it:
  1. Double-click START.command (macOS may ask permission the first time:
     right-click the file and choose Open, or run `bash START.command`).
  2. The app opens at http://127.0.0.1:24680 — nothing else is installed.

What happens on first boot:
  - A Python environment for office-file creation is prepared in your home
    folder (needs internet, a few minutes, once).
  - The first time you open a preview, the app offers a one-time ~281 MB
    download of the LibreOffice runtime for pixel-perfect rendering.

Connect a model (one-time): create ~/.dsh/.credentials.yaml containing
  version: 1
  refs:
    DEEPSEEK_API_KEY: sk-your-key-here
then run:  chmod 600 ~/.dsh/.credentials.yaml

Everything stays on this machine — files, sessions, and the workspace.
README

echo "==> packing"
mkdir -p dist
OUT="dist/baby-whale-$PLATFORM-$ARCH-$VERSION.zip"
rm -f "$OUT"
(cd "$STAGE_ROOT" && zip -qry "$OLDPWD/$OUT" "$(basename "$STAGE")")
ls -lh "$OUT"
echo "==> bundle ready: $OUT"
