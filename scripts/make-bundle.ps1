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
# With hoisted, external deps are real files in the flat node_modules
# root; the workspace links (one physical junction per dependency edge)
# are materialized by scripts/bundle-junction-pool.mjs: each unique
# target becomes a fully-closed pool entry (inner links filled from
# other pool entries to a fixpoint — cycle-safe), and every site is
# then copied from the pool, so no site copy can have holes.
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

# Stage on the biggest scratch disk: CI gives RUNNER_TEMP on the data drive;
# the dereferenced tree easily outgrows the small system volume.
$stageTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$STAGE_ROOT = Join-Path $stageTemp ("bwhale-stage-" + [Guid]::NewGuid().ToString('N'))
$STAGE = Join-Path $STAGE_ROOT "baby-whale-$PLATFORM-$ARCH-$VERSION"
New-Item -ItemType Directory -Force -Path $STAGE | Out-Null

try {
  Write-Host "==> copying workspace tree (junctions skipped, then workspace links dereferenced)"
  # Bundle layout: <stage>/baby-whale/<repo> with node/ and START.bat as
  # siblings — same as make-bundle.sh. The copy targets the INNER baby-whale
  # directory. /XJ is critical: pnpm links workspace packages through
  # junctions (node_modules/@deepseek-ai/x -> packages/x, and per-package
  # node_modules link back into each other) — following them recurses
  # forever. /XJ skips every junction; the workspace links are re-created as
  # REAL directories right after, so the staged tree contains no links at
  # all. Exit codes 0-7 are success.
  $root = (Get-Location).Path
  $stageInner = Join-Path $STAGE 'baby-whale'
  # /XD node_modules\.pnpm: under the hoisted linker .pnpm holds HARD-LINKED
  # real files (pnpm's staging area — it exists under hoisted too), so without
  # this exclusion every external package would ship twice (root + .pnpm).
  # Runtime resolution never goes through .pnpm in hoisted mode.
  robocopy . $stageInner /E /XJ /NFL /NDL /NJH /NJS /NP /MT:16 `
    /XD "$root\.git" "$root\.github" "$root\.artifacts" "$root\.dsh-build" "$root\coverage" "$root\tmp" "$root\dist" "$root\scripts\tmp" "$root\node_modules\.pnpm" `
    /XF "*.tsbuildinfo" | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
  # robocopy's code sticks to the shell; reset so the next check is meaningful.
  $global:LASTEXITCODE = 0
  if (-not (Test-Path (Join-Path $STAGE 'baby-whale\apps\cli'))) {
    throw "main copy lost apps\cli — robocopy exclusion or path issue (stage root: $STAGE)"
  }

  Write-Host "==> materializing junction sites from a closed content pool"
  # scripts/bundle-junction-pool.mjs scans the SOURCE tree for physical
  # link sites (never descending into them — that is the cycle guard),
  # materializes each UNIQUE target once into a pool as a one-level real
  # copy (inner dir links skipped; file links dereferenced inline), and
  # additionally emits root canonical copies: every workspace package
  # also at node_modules/<name>. Node resolves bare specifiers by
  # walking UP, so skipped inner links fall through to the canonical
  # copy — no infinite closure needed for dependency cycles. Node does
  # the scan/target work because it resolves links natively;
  # PowerShell's .Target reports mangled paths for pnpm junctions.
  # Copying sites from live targets left holes at through-paths, and the
  # first boot smoke died on exactly such a hole (@deepseek-ai/cosmokit
  # inside the apps\cli copy of cordis; hoisted leaves root node_modules
  # nearly link-free, so walk-up resolution had no fallback).
  $poolDir = Join-Path $STAGE_ROOT ("pool-" + [Guid]::NewGuid().ToString('N'))
  $mapFile = Join-Path $STAGE_ROOT ("pool-map-" + [Guid]::NewGuid().ToString('N') + ".json")
  New-Item -ItemType Directory -Force -Path $poolDir | Out-Null
  $env:BW_POOL_DIR = $poolDir
  node "$root\scripts\bundle-junction-pool.mjs" $root $mapFile
  if ($LASTEXITCODE -ne 0) { throw "junction pool materialization failed (exit $LASTEXITCODE)" }
  $global:LASTEXITCODE = 0
  $poolMap = Get-Content $mapFile -Raw | ConvertFrom-Json
  $failures = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
  $poolMap.sites | ForEach-Object -Parallel {
    $failBag = $using:failures
    $stageInnerLocal = $using:stageInner
    $poolDirLocal = $using:poolDir
    $item = $_
    $dest = Join-Path $stageInnerLocal $item.site
    $destParent = Split-Path $dest -Parent
    if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
    if ($item.isFile) {
      Copy-Item (Join-Path $poolDirLocal $item.pool) $dest -Force
    } else {
      robocopy (Join-Path $poolDirLocal $item.pool) $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { $failBag.Add("site copy of $($item.site) (robocopy $LASTEXITCODE)") }
    }
  } -ThrottleLimit 12
  $global:LASTEXITCODE = 0
  if ($failures.Count -gt 0) {
    $failures | Select-Object -First 10 | ForEach-Object { Write-Host "    FAILED: $_" }
    throw "site copy failures: $($failures.Count)"
  }
  # Root canonical copies: every workspace package also at
  # node_modules/<name>, so any inner link a site copy skipped resolves
  # by walk-up. Skip names that already exist (external deps are real
  # dirs at root under hoisted; workspace names never collide).
  $rootFailures = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
  $poolMap.roots | ForEach-Object -Parallel {
    $failBag = $using:rootFailures
    $stageInnerLocal = $using:stageInner
    $poolDirLocal = $using:poolDir
    $item = $_
    $dest = Join-Path $stageInnerLocal $item.site
    if (Test-Path $dest) { return }
    robocopy (Join-Path $poolDirLocal $item.pool) $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { $failBag.Add("root canonical copy of $($item.site) (robocopy $LASTEXITCODE)") }
  } -ThrottleLimit 12
  $global:LASTEXITCODE = 0
  if ($rootFailures.Count -gt 0) {
    $rootFailures | Select-Object -First 10 | ForEach-Object { Write-Host "    FAILED: $_" }
    throw "root canonical copy failures: $($rootFailures.Count)"
  }
  Write-Host ("    populated {0} site copies + {1} root canonical copies" -f $poolMap.sites.Count, $poolMap.roots.Count)
  Remove-Item -Recurse -Force $poolDir -ErrorAction SilentlyContinue
  Remove-Item -Force $mapFile -ErrorAction SilentlyContinue
  $stageJunctions = @(Get-ChildItem $stageInner -Recurse -Directory -Force `
    -Attributes ReparsePoint -ErrorAction SilentlyContinue).Count
  if ($stageJunctions -gt 0) { throw "stage still contains $stageJunctions junction(s) after pool materialization" }
  Write-Host "    stage is junction-free"

  if (-not (Test-Path (Join-Path $STAGE 'baby-whale\apps\cli\lib'))) {
    Write-Host "stage baby-whale top level:"
    Get-ChildItem (Join-Path $STAGE 'baby-whale') -ErrorAction SilentlyContinue |
      Select-Object -First 30 -ExpandProperty Name
    throw "dereference loop lost apps\cli\lib — a bad link dest clobbered the stage"
  }

  Write-Host "==> verifying the staged entrypoint"
  # The CLI entrypoint is what every launcher runs; assert it at both ends
  # (source build output and staged copy) so a silent build or copy gap
  # fails here with context instead of as a mystery on a user machine.
  $srcEntry = Join-Path $root 'apps\cli\lib\bin.js'
  $stageEntry = Join-Path $STAGE 'baby-whale\apps\cli\lib\bin.js'
  if (-not (Test-Path $srcEntry)) { throw "source build output missing: $srcEntry — did build:lib:host produce apps/cli/lib?" }
  if (-not (Test-Path $stageEntry)) {
    Write-Host "stage apps\cli tree:"
    Get-ChildItem (Join-Path $STAGE 'baby-whale\apps\cli') -Recurse -Depth 2 -ErrorAction SilentlyContinue |
      Select-Object -First 40 -ExpandProperty FullName
    Write-Host "stage apps\cli\lib exists: $(Test-Path (Join-Path $STAGE 'baby-whale\apps\cli\lib'))"
    throw "stage lost apps\cli\lib\bin.js during copy — robocopy gap"
  }
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
  # Second probe: a DIFFERENT root-scope package resolved from the same app
  # directory — exercises exactly the walk-up that failed at first boot
  # (a workspace dep of a dep, found only via the bundle root scope).
  $secondPkg = (Get-ChildItem (Join-Path $STAGE 'baby-whale\node_modules\@deepseek-ai') -Directory |
    Where-Object { $_.Name -ne $probePkg } | Select-Object -First 1).Name
  if ($secondPkg) {
    $probe2 = & (Join-Path $nodeDir 'node.exe') -e "require.resolve('@deepseek-ai/$secondPkg/package.json', { paths: [process.argv[1]] }); console.log('resolve ok via root: @deepseek-ai/$secondPkg')" $cliDir
    if ($LASTEXITCODE -ne 0) { throw "root-scope walk-up resolution probe failed" }
    Write-Host $probe2
  }

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
  tar.exe -a --options "zip:compression-level=1" -cf $OUT -C $STAGE_ROOT (Split-Path $STAGE -Leaf)
  if ($LASTEXITCODE -ne 0) { throw "tar pack failed" }
  Get-Item $OUT | ForEach-Object { Write-Host ("==> bundle ready: {0} ({1:N0} MB)" -f $_.FullName, ($_.Length / 1MB)) }
} finally {
  Remove-Item -Recurse -Force $STAGE_ROOT -ErrorAction SilentlyContinue
}
