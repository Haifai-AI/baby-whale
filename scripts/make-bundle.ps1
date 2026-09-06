# make-bundle (Windows) — assemble the zero-install portable bundle for
# Windows x64: the built workspace tree (libs + web dist + node_modules),
# a portable node.exe, and a double-click START.bat. Output:
#   dist/baby-whale-windows-x86_64-<version>.zip
#
# Run on a Windows CI runner (or dev box) after `pnpm install` +
# `pnpm run build`. The install must use pnpm's hoisted node-linker so
# node_modules is real files, not junctions: junctions do not survive
# zip -> extract on machines without symlink privileges, and pnpm's
# default isolated layout resolves transitive deps THROUGH junctions.
# With hoisted, every resolution path is a real directory in the flat
# node_modules root. Workspace packages stay junctioned into node_modules
# — robocopy follows those, so the staged copies carry the freshly built
# lib/dist output.
#
# Env: RELEASE_VERSION (optional) — the git tag (v0.1.6 -> 0.1.6); falls
# back to apps/cli/package.json's version.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location (Join-Path $PSScriptRoot '..')

$VERSION = $env:RELEASE_VERSION
if ($null -eq $VERSION) { $VERSION = '' }
$VERSION = $VERSION -replace '^v', ''
if ($VERSION -notmatch '^\d+\.\d+\.\d+$') {
  $VERSION = (node -p "require('./apps/cli/package.json').version")
}
$PLATFORM = 'windows'
$ARCH = 'x86_64'
$NODE_VERSION = (node -v)  # e.g. v22.19.0 — bundle the running major

$STAGE_ROOT = Join-Path ([IO.Path]::GetTempPath()) ("bwhale-stage-" + [Guid]::NewGuid().ToString('N'))
$STAGE = Join-Path $STAGE_ROOT "baby-whale-$PLATFORM-$ARCH-$VERSION"
New-Item -ItemType Directory -Force -Path $STAGE | Out-Null

try {
  Write-Host "==> copying workspace tree (junctions skipped, then workspace links dereferenced)"
  # /XJ is critical: pnpm links workspace packages through junctions
  # (node_modules/@deepseek-ai/x -> packages/x, and per-package node_modules
  # link back into each other) — following them recurses forever. /XJ skips
  # every junction; the workspace links are re-created as REAL directories
  # right after, so the staged tree contains no links at all. Exit 0-7 ok.
  $root = (Get-Location).Path
  robocopy . $STAGE /E /XJ /NFL /NDL /NJH /NJS /NP /MT:16 `
    /XD "$root\.git" "$root\.github" "$root\.artifacts" "$root\.dsh-build" "$root\coverage" "$root\tmp" "$root\dist" "$root\scripts\tmp" `
    /XF "*.tsbuildinfo" | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
  # robocopy's code sticks to the shell; reset so the next check is meaningful.
  $global:LASTEXITCODE = 0

  Write-Host "==> dereferencing workspace links into node_modules"
  # Workspace links live PER-PACKAGE (apps/cli/node_modules/@deepseek-ai/x ->
  # packages/...), plus a few at the root — robocopy /XJ skipped every one of
  # them. Enumerate all reparse points under packages/apps and the root scope
  # (PS7 -Recurse does NOT descend into junctions, so this cannot cycle), then
  # copy THROUGH each into its stage path: PowerShell's .Target reports
  # mangled paths for pnpm junctions, so it is never read. /XJ in the per-link
  # copy keeps nested links from recursing; they are loop items themselves.
  $linkDirs = @(
    Get-ChildItem "$root\node_modules" -Directory -Force -ErrorAction SilentlyContinue |
      Where-Object LinkType
    Get-ChildItem "$root\node_modules\@deepseek-ai" -Directory -Force -ErrorAction SilentlyContinue |
      Where-Object LinkType
    Get-ChildItem -Path "$root\packages", "$root\apps", "$root\native" -Recurse -Directory -Force `
      -Attributes ReparsePoint -ErrorAction SilentlyContinue
  )
  # Distinct source paths only.
  $links = $linkDirs | ForEach-Object { $_.FullName } | Sort-Object -Unique
  if ($links.Count -eq 0) { throw "no workspace links found — was the install hoisted?" }
  Write-Host ("    {0} links to dereference" -f $links.Count)
  foreach ($link in $links) {
    $stagePath = $link.Substring($root.Length).TrimStart('\', '/')
    $dest = Join-Path $STAGE "baby-whale\$stagePath"
    $destParent = Split-Path $dest -Parent
    if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    robocopy $link $dest /E /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "dereference of $link failed (robocopy $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
  }

  Write-Host "==> verifying the staged entrypoint"
  # The CLI entrypoint is what every launcher runs; assert it at both ends
  # (source build output and staged copy) so a silent build or copy gap
  # fails here with context instead of as a mystery on a user machine.
  $srcEntry = Join-Path $root 'apps\cli\lib\bin.js'
  $stageEntry = Join-Path $STAGE 'baby-whale\apps\cli\lib\bin.js'
  if (-not (Test-Path $srcEntry)) { throw "source build output missing: $srcEntry — did build:lib:host produce apps/cli/lib?" }
  if (-not (Test-Path $stageEntry)) { throw "stage lost apps\cli\lib\bin.js during copy — robocopy gap" }
  Write-Host "    entrypoint ok: apps\cli\lib\bin.js"

  Write-Host "==> fetching portable Node $NODE_VERSION (win-x64)"
  $nodeDir = Join-Path $STAGE 'node'
  New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
  $nodeZip = Join-Path $STAGE_ROOT "node-$NODE_VERSION-win-x64.zip"
  $nodeUrl = "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
  # curl.exe ships with the runner and honors --max-time; Invoke-WebRequest
  # can stall forever on a dropped connection (burned a 6-hour runner once).
  curl.exe -fsSL --max-time 600 --retry 2 -o $nodeZip $nodeUrl
  if ($LASTEXITCODE -ne 0) { throw "node download failed (curl exit $LASTEXITCODE)" }
  # Expand only the binary itself — the zip's rest is docs and npm we don't need.
  $expand = Join-Path $STAGE_ROOT "node-extract"
  Expand-Archive -Force -Path $nodeZip -DestinationPath $expand
  Copy-Item (Join-Path $expand "node-$NODE_VERSION-win-x64\node.exe") $nodeDir
  Remove-Item -Recurse -Force $expand, $nodeZip

  Write-Host "==> probing the staged tree resolves modules"
  # Catches any link-mode surprise (missing hoist, skipped junction) BEFORE
  # packing: the staged CLI must resolve a real workspace import through its
  # own node_modules. Pick whichever @deepseek-ai link the CLI actually has.
  $cliDir = Join-Path $STAGE 'baby-whale\apps\cli'
  $cliScope = Join-Path $cliDir 'node_modules\@deepseek-ai'
  if (-not (Test-Path $cliScope)) { throw "staged apps/cli has no node_modules\@deepseek-ai — dereference failed" }
  $probePkg = (Get-ChildItem $cliScope -Directory | Select-Object -First 1).Name
  $probe = & (Join-Path $nodeDir 'node.exe') -e "require.resolve('@deepseek-ai/$probePkg/package.json', { paths: [process.argv[1]] }); console.log('resolve ok: @deepseek-ai/$probePkg')" $cliDir
  if ($LASTEXITCODE -ne 0) { throw "staged tree failed module resolution probe" }
  Write-Host $probe

  Write-Host "==> writing launchers + readme"
  $startBat = @'
@echo off
setlocal
cd /d "%~dp0baby-whale"
set "PATH=%~dp0node;%PATH%"
node apps\cli\lib\bin.js web %*
'@
  [IO.File]::WriteAllText((Join-Path $STAGE 'START.bat'), ($startBat -replace "`n", "`r`n"))

  $startPs1 = @'
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'baby-whale')
$env:PATH = (Join-Path $PSScriptRoot 'node') + ';' + $env:PATH
node apps/cli/lib/bin.js web @args
'@
  [IO.File]::WriteAllText((Join-Path $STAGE 'START.ps1'), ($startPs1 -replace "`n", "`r`n"))

  $readme = @'
Baby Whale - zero-install preview (Windows)
===========================================

Run it:
  1. Double-click START.bat (or right-click START.ps1 -> Run with PowerShell).
  2. The app opens at http://127.0.0.1:24680 - nothing else is installed.

What happens on first boot:
  - Office-file creation needs Python 3 on your machine (winget install
    Python.Python.3.12). The libraries for document generation install
    themselves the first time a skill needs them.
  - Pixel-perfect previews need LibreOffice (winget install
    TheDocumentFoundation.LibreOffice). Without it the app still builds
    every file - previews just show a simpler rendering.

Connect a model (one-time): create %USERPROFILE%\.dsh\.credentials.yaml containing
  version: 1
  refs:
    DEEPSEEK_API_KEY: sk-your-key-here

Everything stays on this machine - files, sessions, and the workspace.
'@
  [IO.File]::WriteAllText((Join-Path $STAGE 'README.txt'), ($readme -replace "`n", "`r`n"))

  Write-Host "==> packing"
  New-Item -ItemType Directory -Force -Path dist | Out-Null
  $OUT = "dist/baby-whale-$PLATFORM-$ARCH-$VERSION.zip"
  if (Test-Path $OUT) { Remove-Item -Force $OUT }
  # tar.exe (Windows 10+) writes a plain zip via -a; the staged tree is all
  # real files, so no symlink/junction semantics are involved.
  tar.exe -a -cf $OUT -C $STAGE_ROOT (Split-Path $STAGE -Leaf)
  if ($LASTEXITCODE -ne 0) { throw "tar pack failed" }
  Get-Item $OUT | ForEach-Object { Write-Host ("==> bundle ready: {0} ({1:N0} MB)" -f $_.FullName, ($_.Length / 1MB)) }
} finally {
  Remove-Item -Recurse -Force $STAGE_ROOT -ErrorAction SilentlyContinue
}
