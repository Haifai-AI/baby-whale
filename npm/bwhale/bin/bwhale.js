#!/usr/bin/env node
/**
 * bwhale — the npm launcher for Baby Whale. The published package carries
 * only the app code pointer and this installer/launcher (never
 * node_modules); the runtime bundle is fetched once from GitHub Releases
 * into ~/.bwhale, with per-platform prerequisites checked — and offered for
 * install the platform's own way — before boot.
 *
 * Commands:
 *   bwhale            start (first run: fetch bundle, then boot + open)
 *   bwhale doctor     report prerequisite status per platform convention
 *   bwhale update     refresh the runtime bundle to the latest release
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, platform, arch } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const REPO = 'Haifai-AI/bwhale-dist'
const HOME = homedir()
const ROOT = process.env.BWHALE_HOME ?? path.join(HOME, '.bwhale')
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const PORT = 24680
const MARKER_VERSION = 2 // bundle layout revision; bump forces a refetch

const SUPPORT = {
  darwin: {
    label: 'macOS',
    platformKey: () => 'macos',
    missing: () => [], // git/python ship with the dev tools; office libs auto-install at first boot
  },
  linux: {
    label: 'Linux',
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
  win32: {
    label: 'Windows',
    platformKey: () => 'windows',
    missing: () => {
      const gaps = []
      if (!which('git')) gaps.push({ name: 'git', hint: 'winget install Git.Git' })
      if (!which('python')) gaps.push({ name: 'python3', hint: 'winget install Python.Python.3.12   (office-file creation)' })
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
  return `baby-whale-${p}-${a}-${version}.zip`
}

async function latestRelease() {
  const response = await fetch(LATEST_API, { headers: { 'user-agent': 'bwhale-launcher' } })
  if (!response.ok) die(`cannot reach GitHub Releases (HTTP ${response.status})`)
  const release = await response.json()
  const asset = (release.assets ?? []).find(a => a.name === bundleAssetName(release.tag_name))
  if (asset === undefined) {
    die(`no bundle for ${platform()}/${arch()} in release ${release.tag_name} — assets: ${(release.assets ?? []).map(a => a.name).join(', ') || 'none'}`)
  }
  return { version: release.tag_name, url: asset.browser_download_url, name: asset.name, size: asset.size }
}

/** Stream a download with a percent progress line; resumable cache across runs. */
async function download(url, dest, size) {
  mkdirSync(path.dirname(dest), { recursive: true })
  const partial = `${dest}.part`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) die(`download failed with HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length') ?? size ?? 0)
  let received = 0
  const out = createWriteStream(partial)
  process.stderr.write('bwhale: downloading runtime ')
  for await (const chunk of Readable.fromWeb(response.body)) {
    received += chunk.length
    out.write(chunk)
    if (total > 0) process.stderr.write(`\rbwhale: downloading runtime ${Math.round((received / total) * 100)}%`)
  }
  process.stderr.write('\n')
  await finished(out)
  // integrity: the release asset is the contract; a truncated file must never install
  if (total > 0 && received !== total) die(`download truncated (${received}/${total} bytes) — retry`)
  rmSync(dest, { force: true })
  statSync(partial)
  return partial
}

function unzip(archive, into) {
  mkdirSync(into, { recursive: true })
  const result = platform() === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath "${archive}" -DestinationPath "${into}"`], { stdio: 'inherit' })
    : spawnSync('unzip', ['-q', archive, '-d', into], { stdio: 'inherit' })
  if (result.status !== 0) die('extraction failed')
}

/** Installed bundle layout: <ROOT>/runtime/baby-whale-<p>-<a>-<version> */
function runtimeDir(version) {
  const p = SUPPORT?.platformKey() ?? platform()
  const a = arch() === 'arm64' ? 'arm64' : 'x86_64'
  return path.join(ROOT, 'runtime', `baby-whale-${p}-${a}-${version}`)
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

/** Ensure the runtime bundle exists at the wanted version; fetch+install if not. */
async function ensureRuntime(wanted) {
  const existing = readInstalled()
  if (wanted === 'installed' && existing !== null) return existing
  const release = wanted === 'latest'
    ? await latestRelease()
    : { version: wanted, url: `https://github.com/${REPO}/releases/download/${wanted}/${bundleAssetName(wanted)}`, name: bundleAssetName(wanted) }
  if (existing?.version === release.version) return existing // already exactly this version
  log(`bwhale: fetching Baby Whale ${release.version} runtime (${Math.round((release.size ?? 0) / 1048576) || '~400'} MB, once)`)
  const archive = await download(release.url, path.join(ROOT, 'cache', release.name), release.size)
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
  return entry
}

async function cmdStart(argv) {
  const gaps = SUPPORT?.missing() ?? []
  if (gaps.length > 0) {
    log(`bwhale: missing prerequisites on ${SUPPORT?.label ?? platform()}:`)
    for (const gap of gaps) log(`  - ${gap.name}: ${gap.hint}`)
    if (gaps.some(g => g.name.startsWith('git'))) die('git is required (session history)')
  }
  const entry = await ensureRuntime(process.env.BWHALE_VERSION ?? 'latest')
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
      const open = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
      spawnSync(open, [`http://127.0.0.1:${PORT}/`], { stdio: 'ignore' })
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

const [command = 'start', ...rest] = process.argv.slice(2)
const dispatch = {
  start: () => cmdStart(rest.filter(a => a !== '--no-open')),
  doctor: () => cmdDoctor(),
  update: () => cmdUpdate(),
}
;(dispatch[command] ?? die(`unknown command "${command}" — try bwhale, bwhale doctor, or bwhale update`))()
