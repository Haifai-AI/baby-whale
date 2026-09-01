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

VERSION="$(node -p "require('./apps/cli/package.json').version")"
OS="$(uname -s)"           # Darwin / Linux
ARCH="$(uname -m)"         # arm64 / x86_64
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

if [ "$PLATFORM" = "macos" ]; then
echo "==> building BabyWhale.app"
APP="$STAGE_ROOT/BabyWhale.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp scripts/desktop/baby-whale.icns "$APP/Contents/Resources/baby-whale.icns"
mv "$STAGE" "$APP/Contents/Resources/server"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>BabyWhale</string>
  <key>CFBundleIdentifier</key><string>ai.haifai.babywhale</string>
  <key>CFBundleName</key><string>Baby Whale</string>
  <key>CFBundleDisplayName</key><string>Baby Whale</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleIconFile</key><string>baby-whale</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
cat > "$APP/Contents/MacOS/BabyWhale" <<'LAUNCH'
#!/bin/bash
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
URL="http://127.0.0.1:24680"
# Already running? Just bring the workspace up in the browser.
if curl -sf -o /dev/null --max-time 2 "$URL/"; then
  exec open "$URL"
fi
exec "$RES/server/node/bin/node" "$RES/server/baby-whale/apps/cli/lib/bin.js" web "$@"
LAUNCH
chmod +x "$APP/Contents/MacOS/BabyWhale"

echo "==> packing DMG"
DMG_STAGE="$STAGE_ROOT/dmg"
mkdir -p "$DMG_STAGE"
mv "$APP" "$DMG_STAGE/BabyWhale.app"
ln -s /Applications "$DMG_STAGE/Applications"
cat > "$DMG_STAGE/README.txt" <<'DMGREADME'
Baby Whale — install
====================
Drag BabyWhale into Applications, then double-click it.
The app starts the local server and opens http://127.0.0.1:24680.

First launch on macOS: right-click BabyWhale.app -> Open (one time), or
System Settings -> Privacy & Security -> Open Anyway.

Connect a model (one-time): create ~/.dsh/.credentials.yaml containing
  version: 1
  refs:
    DEEPSEEK_API_KEY: sk-your-key-here
then run:  chmod 600 ~/.dsh/.credentials.yaml

Everything stays on this machine.
DMGREADME
DMG_OUT="dist/baby-whale-$PLATFORM-$ARCH-$VERSION.dmg"
rm -f "$DMG_OUT"
hdiutil create -volname "Baby Whale" -srcfolder "$DMG_STAGE" -format UDZO -ov -quiet "$OLDPWD/$DMG_OUT"
ls -lh "$DMG_OUT"
echo "==> dmg ready: $DMG_OUT"
fi
