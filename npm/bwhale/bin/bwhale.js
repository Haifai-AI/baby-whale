#!/usr/bin/env node
/**
 * bwhale — the npm launcher for Baby Whale. The published package carries
 * only the app code pointer and this installer/launcher (never
 * node_modules); the runtime bundle is fetched once from GitHub Releases
 * into ~/.bwhale, with per-platform prerequisites checked — and offered for
 * install the platform's own way — before boot.
 *
 * Commands:
 *   bwhale              start (first run: fetch bundle, then boot + open)
 *   bwhale --no-open     start without opening the browser
 *   bwhale doctor       report prerequisite status per platform convention
 *   bwhale update       refresh the runtime bundle to the latest release
 *   bwhale stop         stop a running server (`bwhale --stop` also works)
 *   bwhale --version    report the installed runtime version
 *   bwhale --help       print this help
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, platform, arch } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

const REPO = 'Haifai-AI/bwhale-dist'
const HOME = homedir()
const ROOT = process.env.BWHALE_HOME ?? path.join(HOME, '.bwhale')
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const PORT = 24680
const MARKER_VERSION = 2 // bundle layout revision; bump forces a refetch

const SUPPORT = {
  darwin: {
    label: 'macOS',
    supported: true,
    platformKey: () => 'macos',
    missing: () => [], // git/python ship with the dev tools; office libs auto-install at first boot
  },
  linux: {
    label: 'Linux',
    supported: true,
    platformKey: () => 'linux',
    missing: () => {
      const gaps = []
      if (!which('git')) gaps.push({ name: 'git', hint: 'sudo apt install git   (or your distro equivalent)' })
      if (!which('python3')) gaps.push({ name: 'python3', hint: 'sudo apt install python3 python3-venv   (office-file creation)' })
      if (!which('soffice')) gaps.push({
        name: 'LibreOffice (optional — pixel-perfect previews)',
        hint: 'sudo apt install libreoffice   — or accept the in-app one-time setup later',
      })
      return gaps
    },
  },
  // Windows bundles are published for x64; the app's shell stack runs on
  // PowerShell there. Prerequisites follow the platform's own installer.
  win32: {
    label: 'Windows',
    supported: true,
    platformKey: () => 'windows',
    missing: () => {
      const gaps = []
      if (!which('git')) gaps.push({ name: 'git', hint: 'winget install Git.Git   (session history)' })
      if (!which('python') && !which('py')) gaps.push({
        name: 'python3',
        hint: 'winget install Python.Python.3.12   (office-file creation)',
      })
      if (!which('soffice')) gaps.push({
        name: 'LibreOffice (optional — pixel-perfect previews)',
        hint: 'winget install TheDocumentFoundation.LibreOffice',
      })
      return gaps
    },
  },
}[platform()] ?? null

function which(bin) {
  const probe = platform() === 'win32'
    ? spawnSync('where', [bin], { stdio: 'ignore' })
    : spawnSync('which', [bin], { stdio: 'ignore' })
  return probe.status === 0
}

function log(message) { console.error(message) }
function die(message) { log(`bwhale: ${message}`); process.exit(1) }

/** The platform/arch bundle asset this machine needs. */
function bundleAssetName(version) {
  const p = SUPPORT?.platformKey() ?? platform()
  const a = arch() === 'arm64' ? 'arm64' : 'x86_64'
  return `baby-whale-${p}-${a}-${version.replace(/^v/, '')}.zip`
}

function pickAsset(release) {
  const asset = (release.assets ?? []).find(a => a.name === bundleAssetName(release.tag_name))
  if (asset === undefined) {
    die(`no bundle for ${platform()}/${arch()} in release ${release.tag_name} — assets: ${(release.assets ?? []).map(a => a.name).join(', ') || 'none'}`)
  }
  return { version: release.tag_name, url: asset.browser_download_url, name: asset.name, size: asset.size, digest: asset.digest }
}

async function latestRelease() {
  const response = await fetch(LATEST_API, { headers: { 'user-agent': 'bwhale-launcher' } })
  if (!response.ok) die(`cannot reach GitHub Releases (HTTP ${response.status})`)
  return pickAsset(await response.json())
}

async function releaseByTag(tag) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers: { 'user-agent': 'bwhale-launcher' } })
  if (!response.ok) die(`cannot find Baby Whale release ${tag} (HTTP ${response.status})`)
  return pickAsset(await response.json())
}

/** Verify a downloaded file against the release's sha256 digest (when published). */
async function verifyDigest(file, digest) {
  if (typeof digest !== 'string' || !digest.startsWith('sha256:')) return
  const expected = digest.slice('sha256:'.length)
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  if (hash.digest('hex') !== expected) {
    rmSync(file, { force: true })
    die('download checksum mismatch — the bundle may be corrupted or tampered with; retry')
  }
}

/** Stream a download with a percent progress line; resumable cache across runs. */
async function download(url, dest, size, digest) {
  mkdirSync(path.dirname(dest), { recursive: true })
  const partial = `${dest}.part`
  // A finished-but-unrenamed .part from a previous crashed run is re-verified
  // (size, then checksum when published) before reuse — never trusted blind.
  if (size > 0 && existsSync(partial) && statSync(partial).size === size) {
    try {
      await verifyDigest(partial, digest)
      log('bwhale: reusing the completed download from the previous run')
      return partial
    } catch {
      // verifyDigest already removed the bad file and exited on mismatch;
      // any other failure falls through to a fresh download below.
    }
  }
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) die(`download failed with HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length') ?? size ?? 0)
  let received = 0
  let lastPercent = -1
  const counter = new Transform({
    transform(chunk, _enc, callback) {
      received += chunk.length
      if (total > 0) {
        const percent = Math.round((received / total) * 100)
        if (percent !== lastPercent) {
          lastPercent = percent
          process.stderr.write(`\rbwhale: downloading runtime ${percent}%`)
        }
      }
      callback(null, chunk)
    },
  })
  // pipeline applies backpressure — naive per-chunk writes buffer the whole
  // file in memory and get the process OOM-killed at these sizes.
  await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(partial))
  process.stderr.write('\n')
  if (total > 0 && received !== total) die(`download truncated (${received}/${total} bytes) — retry`)
  await verifyDigest(partial, digest)
  return partial
}

function unzip(archive, into) {
  mkdirSync(into, { recursive: true })
  const result = platform() === 'win32'
    // tar.exe (Windows 10+) reads plain zip archives and is far faster than
    // Expand-Archive on multi-hundred-MB bundles.
    ? spawnSync('tar', ['-xf', archive, '-C', into], { stdio: 'inherit' })
    : spawnSync('unzip', ['-q', archive, '-d', into], { stdio: 'inherit' })
  if (result.status !== 0) {
    if (platform() === 'win32' && result.error?.code === 'ENOENT') {
      const fallback = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath "${archive}" -DestinationPath "${into}"`], { stdio: 'inherit' })
      if (fallback.status === 0) return
    }
    die('extraction failed')
  }
}

/** Installed bundle layout: <ROOT>/runtime/baby-whale-<p>-<a>-<version> */
function runtimeDir(version) {
  const p = SUPPORT?.platformKey() ?? platform()
  const a = arch() === 'arm64' ? 'arm64' : 'x86_64'
  return path.join(ROOT, 'runtime', `baby-whale-${p}-${a}-${version.replace(/^v/, '')}`)
}

function installedMarker() {
  return path.join(ROOT, 'installed.json')
}

function readInstalled() {
  try {
    const parsed = JSON.parse(readFileSync(installedMarker(), 'utf8'))
    return parsed?.markerVersion === MARKER_VERSION ? parsed : null
  } catch { return null }
}

function writeInstalled(entry) {
  mkdirSync(ROOT, { recursive: true })
  writeFileSync(installedMarker(), JSON.stringify({ markerVersion: MARKER_VERSION, ...entry }, null, 2))
}

/** Remove every runtime and cache entry except the active one (best-effort). */
function pruneOldInstalls(activeDir, activeName) {
  try {
    const runtimeRoot = path.join(ROOT, 'runtime')
    if (existsSync(runtimeRoot)) {
      for (const entry of readdirSync(runtimeRoot)) {
        if (path.join(runtimeRoot, entry) !== activeDir) rmSync(path.join(runtimeRoot, entry), { recursive: true, force: true })
      }
    }
    const cacheRoot = path.join(ROOT, 'cache')
    if (existsSync(cacheRoot)) {
      for (const entry of readdirSync(cacheRoot)) {
        if (entry !== activeName && entry !== `${activeName}.part`) rmSync(path.join(cacheRoot, entry), { force: true })
      }
    }
  } catch {
    // Disk cleanup must never fail a start.
  }
}

/** Ensure the runtime bundle exists at the wanted version; fetch+install if not. */
async function ensureRuntime(wanted) {
  const existing = readInstalled()
  if (wanted === 'installed' && existing !== null) return existing
  const pinned = process.env.BWHALE_VERSION ?? 'latest'
  const release = pinned === 'latest' ? await latestRelease() : await releaseByTag(pinned)
  if (existing?.version === release.version) {
    pruneOldInstalls(existing.dir, release.name)
    return existing // already exactly this version
  }
  log(`bwhale: fetching Baby Whale ${release.version} runtime (${Math.round((release.size ?? 0) / 1048576) || '~400'} MB, once)`)
  const archive = await download(release.url, path.join(ROOT, 'cache', release.name), release.size, release.digest)
  const dir = runtimeDir(release.version)
  rmSync(dir, { recursive: true, force: true })
  unzip(archive, path.join(ROOT, 'runtime'))
  const inner = path.join(dir, 'baby-whale')
  if (!existsSync(inner)) die('bundle layout unexpected — no baby-whale directory')
  if (platform() !== 'win32') {
    // launcher + node binary need the exec bit back (zip loses some)
    for (const rel of ['START.command', 'START', 'node/bin/node']) {
      const p = path.join(dir, rel)
      if (existsSync(p)) spawnSync('chmod', ['+x', p])
    }
  }
  rmSync(archive, { force: true })
  const entry = { version: release.version, dir, installedAt: new Date().toISOString() }
  writeInstalled(entry)
  pruneOldInstalls(dir, release.name)
  return entry
}

async function cmdStart(argv) {
  if (SUPPORT !== null && SUPPORT.supported === false) {
    die(`${SUPPORT.label} bundles are not published yet — check bwhale doctor for what is missing`)
  }
  const gaps = SUPPORT?.missing() ?? []
  if (gaps.length > 0) {
    log(`bwhale: missing prerequisites on ${SUPPORT?.label ?? platform()}:`)
    for (const gap of gaps) log(`  - ${gap.name}: ${gap.hint}`)
    if (gaps.some(g => g.name.startsWith('git'))) die('git is required (session history)')
  }
  let entry
  try {
    entry = await ensureRuntime(process.env.BWHALE_VERSION ?? 'latest')
  } catch (error) {
    die(error instanceof Error ? error.message : String(error))
  }
  const nodeBin = platform() === 'win32'
    ? path.join(entry.dir, 'node', 'node.exe')
    : path.join(entry.dir, 'node', 'bin', 'node')
  const cli = path.join(entry.dir, 'baby-whale', 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(cli)) die(`runtime incomplete: ${cli} missing — run \`bwhale update\``)
  // Already serving? Never double-start — just bring the workspace up.
  try {
    const probe = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) })
    if (probe.ok) {
      log(`bwhale: Baby Whale is already running at http://127.0.0.1:${PORT}/`)
      // --no-open is honored here AND passed through to `dsh web` below.
      if (!argv.includes('--no-open')) {
        const open = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
        spawnSync(open, [`http://127.0.0.1:${PORT}/`], { stdio: 'ignore' })
      }
      return
    }
  } catch {
    // Not running — boot it below.
  }
  const child = spawnSync(nodeBin, [cli, 'web', ...argv], { stdio: 'inherit' })
  process.exitCode = child.status ?? 0
}

function cmdDoctor() {
  const p = platform()
  log(`bwhale doctor — ${SUPPORT?.label ?? p} (${arch()})`)
  if (SUPPORT !== null && SUPPORT.supported === false) {
    log('  platform:   NOT SUPPORTED YET — no Baby Whale bundles are published for this OS')
    return
  }
  log(`  node:      ${process.version} (launcher runtime — the app ships its own)`)
  log(`  git:       ${which('git') ? 'ok' : 'MISSING (required)'}`)
  log(`  python3:   ${which('python3') || which('python') ? 'ok' : 'MISSING (office-file creation auto-installs libs on first boot)'}`)
  log(`  libreoffice: ${which('soffice') ? 'ok' : 'not found (optional — the app offers a one-time setup for pixel-perfect previews)'}`)
  const entry = readInstalled()
  log(`  runtime:   ${entry === null ? 'not installed yet (first \`bwhale\` fetches it)' : `${entry.version} at ${entry.dir}`}`)
  const gaps = SUPPORT?.missing() ?? []
  if (gaps.length > 0) {
    log('  to install missing pieces:')
    for (const gap of gaps) log(`    ${gap.name}: ${gap.hint}`)
  }
}

function cmdUpdate() {
  rmSync(installedMarker(), { force: true })
  log('bwhale: will fetch the latest release on next start.')
}

/** PID of whatever is LISTENING on the Baby Whale port, or null. The LISTEN
 *  state matters: unfiltered listings also return browser sockets that
 *  merely connect to the port, and this command must never kill those. */
function serverPid() {
  if (platform() === 'win32') {
    const result = spawnSync('powershell', ['-NoProfile', '-Command',
      `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' })
    if (result.error !== undefined && result.error.code === 'ENOENT') die('bwhale stop needs Windows PowerShell available on PATH')
    const pid = Number.parseInt((result.stdout ?? '').trim(), 10)
    return Number.isInteger(pid) ? pid : null
  }
  const result = spawnSync('lsof', ['-ti', `:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') die('bwhale stop needs `lsof` (standard on macOS; install it on your distro if missing)')
  const pid = (result.stdout ?? '')
    .split('\n')
    .map(line => Number.parseInt(line.trim(), 10))
    .find(Number.isInteger)
  return pid ?? null
}

function killPid(pid, force) {
  if (platform() === 'win32') {
    const args = force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T']
    return spawnSync('taskkill', args, { stdio: 'ignore' }).status === 0
  }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    return true
  } catch {
    return false
  }
}

/** Stop a running server: graceful first, then force if it will not leave. */
async function cmdStop() {
  const pid = serverPid()
  if (pid === null) {
    log(`bwhale: nothing to stop — no Baby Whale is listening on port ${PORT}`)
    return
  }
  if (!killPid(pid, false)) die(`cannot stop pid ${pid}`)
  for (let waited = 0; waited < 5000; waited += 250) {
    await new Promise(resolve => setTimeout(resolve, 250))
    if (serverPid() !== pid) {
      log('bwhale: Baby Whale stopped.')
      return
    }
  }
  killPid(pid, true)
  log('bwhale: Baby Whale stopped (had to force-kill).')
}

function printUsage() {
  log(`bwhale — Baby Whale in one command (macOS, Linux, and Windows)

  bwhale [flags]      start (first run fetches the runtime, then boots + opens)
    --no-open           start without opening the browser
  bwhale doctor         report prerequisite status per platform convention
  bwhale update         refresh the runtime bundle to the latest release
  bwhale stop           stop a running server (--stop works too)
  bwhale --version      report the installed runtime version
  bwhale --help         print this help`)
}

function cmdVersion() {
  const entry = readInstalled()
  log(entry === null ? 'bwhale: runtime not installed yet (first `bwhale` fetches it)' : `bwhale runtime ${entry.version}`)
}

// Dash-args fall through to start (`bwhale --no-open`, `bwhale --port 8080`
// forward to `dsh web`); a bare word must be a known command, otherwise it is
// a usage error — never silently booted as an app argument.
const rawArgs = process.argv.slice(2)
const LAUNCHER_COMMANDS = new Set(['start', 'stop', '--stop', 'doctor', 'update', '--version', '-v', '--help', '-h'])
let command = 'start'
let rest = rawArgs
if (rawArgs.length > 0 && (LAUNCHER_COMMANDS.has(rawArgs[0]) || !rawArgs[0].startsWith('-'))) {
  command = rawArgs[0]
  rest = rawArgs.slice(1)
}
const dispatch = {
  start: () => cmdStart(rest),
  stop: () => cmdStop(),
  '--stop': () => cmdStop(),
  doctor: () => cmdDoctor(),
  update: () => cmdUpdate(),
  '--version': () => cmdVersion(),
  '-v': () => cmdVersion(),
  '--help': () => printUsage(),
  '-h': () => printUsage(),
}
const run = dispatch[command]
if (run === undefined) {
  printUsage()
  die(`unknown command "${command}"`)
}
void run()
