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
  robocopy . $stageInner /E /XJ /NFL /NDL /NJH /NJS /NP /MT:16 `
    /XD "$root\.git" "$root\.github" "$root\.artifacts" "$root\.dsh-build" "$root\coverage" "$root\tmp" "$root\dist" "$root\scripts\tmp" `
    /XF "*.tsbuildinfo" | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
  # robocopy's code sticks to the shell; reset so the next check is meaningful.
  $global:LASTEXITCODE = 0
  if (-not (Test-Path (Join-Path $STAGE 'baby-whale\apps\cli'))) {
    throw "main copy lost apps\cli — robocopy exclusion or path issue (stage root: $STAGE)"
  }

  Write-Host "==> materializing @deepseek-ai/* packages at the bundle root scope"
  # ESM resolves imports through the importer's REAL path. On POSIX the app's
  # node_modules entries are symlinks, so imports resolve from packages/*,
  # where each package has its own dep links. Here the links become plain
  # copies, so resolution must not depend on them: every @deepseek-ai/*
  # package is materialized (real files, /XJ) in the bundle-root scope, so
  # the node walk-up from ANY copy always reaches every workspace package.
  # Every pnpm-workspace root that can hold a @deepseek-ai/* package
  # (vendor holds the cordis ecosystem: cosmokit, schemastery, ...).
  $scanRoots = @('vendor', 'packages', 'native', 'apps', 'website', 'examples') |
    ForEach-Object { Join-Path $root $_ } |
    Where-Object { Test-Path $_ }
  $pkgFiles = Get-ChildItem -Path $scanRoots `
    -Recurse -Depth 4 -Filter package.json -ErrorAction SilentlyContinue
  $pkgMap = @()   # @{ src = package dir; dest = root-scope copy in the stage }
  foreach ($pkgFile in $pkgFiles) {
    $name = (Get-Content $pkgFile.FullName -Raw | ConvertFrom-Json).name
    if (-not $name -or -not $name.StartsWith('@deepseek-ai/')) { continue }
    $pkgMap += @{ src = $pkgFile.Directory.FullName; dest = (Join-Path $STAGE "baby-whale\node_modules\$name") }
  }
  if ($pkgMap.Count -eq 0) { throw "no @deepseek-ai/* workspace packages were discovered" }
  # Plan every copy as an independent (real source -> stage dest) pair:
  #   - each @deepseek-ai/* package -> its root-scope copy, and
  #   - each junction -> its in-place path and every owning root-scope copy.
  $pairs = [System.Collections.Generic.List[object]]::new()
  foreach ($pkg in $pkgMap) { $pairs.Add(@{ src = $pkg.src; dest = $pkg.dest }) }
  $owners = $pkgMap | ForEach-Object { $_.src } | Sort-Object { $_.Length } -Descending
  $rootLen = $root.Length
  foreach ($link in $links) {
    $stagePath = $link.Substring($rootLen).TrimStart('\', '/')
    $dests = @((Join-Path $STAGE "baby-whale\$stagePath"))
    foreach ($owner in $owners) {
      if (-not $link.StartsWith($owner + '\', 'OrdinalIgnoreCase')) { continue }
      $relInPkg = $link.Substring($owner.Length).TrimStart('\')
      $ownerPkg = $pkgMap | Where-Object { $_.src -eq $owner } | Select-Object -First 1
      $dests += Join-Path $ownerPkg.dest $relInPkg
    }
    foreach ($d in $dests) { $pairs.Add(@{ src = $link; dest = $d }) }
  }
  Write-Host ("    {0} real-tree copies to make" -f $pairs.Count)

  # Copy each pair as a FULLY REAL tree: descend directories, and when a
  # junction is met, recurse THROUGH it (cycle-guarded per pair) so a copy
  # carries its own nested dependencies to any depth — the transitive chains
  # (plugin -> llm variant -> base package -> zod) resolve inside the copy
  # exactly as symlink resolution would in the source tree. Merging into an
  # existing destination is safe: identical content from a prior pair.
  $failures = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
  $pairs | ForEach-Object -Parallel {
    $failBag = $using:failures
    $pair = $_
    function Copy-RealTree([string]$src, [string]$dest, $seen) {
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      foreach ($item in (Get-ChildItem -LiteralPath $src -Force -ErrorAction SilentlyContinue)) {
        $to = Join-Path $dest $item.Name
        if ($item.PSIsContainer) {
          if ($item.LinkType) { if (-not $seen.Add($item.FullName)) { continue } }
          Copy-RealTree $item.FullName $to $seen
        } else {
          Copy-Item -LiteralPath $item.FullName -Destination $to -Force
        }
      }
    }
    try {
      Copy-RealTree $pair.src $pair.dest (New-Object 'System.Collections.Generic.HashSet[string]')
    } catch {
      $failBag.Add("copy $($pair.src) -> $($pair.dest): $($_.Exception.Message)")
    }
  } -ThrottleLimit 12
  if ($failures.Count -gt 0) {
    $failures | Select-Object -First 10 | ForEach-Object { Write-Host "    FAILED: $_" }
    throw "real-tree copy failures: $($failures.Count)"
  }

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
