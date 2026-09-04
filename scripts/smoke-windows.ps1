# smoke-windows — CI-only boot check for the Windows bundle: extract the
# freshly packed zip, boot the server with the bundled node.exe, and probe
# http://127.0.0.1:24680 until it answers. Fails the job if the server
# never comes up — a bundle that cannot boot must not ship.
$ErrorActionPreference = 'Stop'

$zip = Get-ChildItem dist/baby-whale-windows-*.zip | Select-Object -First 1
if ($null -eq $zip) { throw "no windows bundle found in dist/" }
Write-Host "==> smoke-testing $($zip.Name)"

$root = Join-Path ([IO.Path]::GetTempPath()) ("bwhale-smoke-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $root | Out-Null
tar.exe -xf $zip.FullName -C $root
$stage = Get-ChildItem $root -Directory | Select-Object -First 1

$node = Join-Path $stage.FullName 'node\node.exe'
$cli = Join-Path $stage.FullName 'baby-whale\apps\cli\lib\bin.js'
if (-not (Test-Path $node)) { throw "bundle incomplete: $node missing" }
if (-not (Test-Path $cli)) { throw "bundle incomplete: $cli missing" }

# Boot with a throwaway home so the check mirrors a first run. The env var
# must be set BEFORE Start-Process — the child inherits it at spawn time.
$home = Join-Path $root 'home'
New-Item -ItemType Directory -Force -Path $home | Out-Null
$env:DSH_HOME = $home
$proc = Start-Process -FilePath $node -ArgumentList @($cli, 'web', '--no-open') `
  -WorkingDirectory (Join-Path $stage.FullName 'baby-whale') `
  -WindowStyle Hidden -PassThru

$up = $false
try {
  foreach ($i in 1..60) {
    Start-Sleep -Seconds 3
    if ($proc.HasExited) { throw "server exited early with code $($proc.ExitCode)" }
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:24680/' -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -lt 500) { $up = $true; break }
    } catch { Write-Host "  waiting for the server ($i)" }
  }
  if (-not $up) { throw "server never answered on http://127.0.0.1:24680" }
  Write-Host "==> smoke test passed: server answered HTTP $($response.StatusCode)"
} finally {
  if (-not $proc.HasExited) {
    # Kill the whole tree (the server spawns children).
    taskkill /PID $proc.Id /T /F 2>$null | Out-Null
  }
  Start-Sleep -Seconds 2
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}
