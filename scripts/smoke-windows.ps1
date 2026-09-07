# smoke-windows — CI-only boot check for the Windows bundle: extract the
# freshly packed zip, boot the server with the bundled node.exe, and probe
# http://127.0.0.1:24680 until it answers. Fails the job if the server
# never comes up — a bundle that cannot boot must not ship.
$ErrorActionPreference = 'Stop'

$zip = Get-ChildItem dist/baby-whale-windows-*.zip | Select-Object -First 1
if ($null -eq $zip) { throw "no windows bundle found in dist/" }
Write-Host "==> smoke-testing $($zip.Name)"

# Extract to a SHORT root ($env:RUNNER_TEMP is D:\a\_temp on CI): deep hoisted
# node_modules paths plus a long temp prefix can exceed legacy MAX_PATH.
$root = Join-Path $env:RUNNER_TEMP ("bw-smoke-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root | Out-Null
tar.exe -xf $zip.FullName -C $root
if ($LASTEXITCODE -ne 0) { throw "bundle extraction failed (tar exit $LASTEXITCODE)" }
$stage = Get-ChildItem $root -Directory | Select-Object -First 1

$node = Join-Path $stage.FullName 'node\node.exe'
$cli = Join-Path $stage.FullName 'baby-whale\apps\cli\lib\bin.js'
if (-not (Test-Path $node)) {
  Write-Host "extracted tree:"
  Get-ChildItem $stage.FullName -Recurse -Depth 2 | Select-Object -First 30 -ExpandProperty FullName
  throw "bundle incomplete: $node missing"
}
if (-not (Test-Path $cli)) {
  Write-Host "apps\cli contents:"
  Get-ChildItem (Join-Path $stage.FullName 'baby-whale\apps\cli') -Recurse -Depth 2 -ErrorAction SilentlyContinue |
    Select-Object -First 40 -ExpandProperty FullName
  throw "bundle incomplete: $cli missing"
}

# Boot with a throwaway home so the check mirrors a first run. The env var
# must be set BEFORE Start-Process — the child inherits it at spawn time.
$fakeHome = Join-Path $root 'home'
New-Item -ItemType Directory -Force -Path $fakeHome | Out-Null
$env:DSH_HOME = $fakeHome
# Capture the server's streams: an early exit is a product bug we need to see.
$outLog = Join-Path $root 'server-out.log'
$errLog = Join-Path $root 'server-err.log'
$proc = Start-Process -FilePath $node -ArgumentList @($cli, 'web', '--no-open') `
  -WorkingDirectory (Join-Path $stage.FullName 'baby-whale') `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

$up = $false
try {
  foreach ($i in 1..60) {
    Start-Sleep -Seconds 3
    if ($proc.HasExited) {
      Write-Host "==> server stdout:"
      Get-Content $outLog -ErrorAction SilentlyContinue | Select-Object -First 40
      Write-Host "==> server stderr:"
      Get-Content $errLog -ErrorAction SilentlyContinue | Select-Object -First 40
      throw "server exited early with code $($proc.ExitCode)"
    }
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:24680/' -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -lt 500) { $up = $true; break }
    } catch { Write-Host "  waiting for the server ($i)" }
  }
  if (-not $up) {
    Write-Host "==> server stderr (timeout):"
    Get-Content $errLog -ErrorAction SilentlyContinue | Select-Object -First 40
    throw "server never answered on http://127.0.0.1:24680"
  }
  Write-Host "==> smoke test passed: server answered HTTP $($response.StatusCode)"
} finally {
  if (-not $proc.HasExited) {
    # Kill the whole tree (the server spawns children).
    taskkill /PID $proc.Id /T /F 2>$null | Out-Null
  }
  Start-Sleep -Seconds 2
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}
