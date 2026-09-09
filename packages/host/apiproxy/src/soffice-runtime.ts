/**
 * Managed LibreOffice runtime: a per-user install of the official
 * Document Foundation build, downloaded on demand into this app's support
 * directory. Keeps preview fidelity one click away without admin rights,
 * without touching a system LibreOffice, and without redistributing
 * anything ourselves at packaging time (we fetch official artifacts at
 * runtime). macOS installs automatically from the official `.dmg`;
 * Windows/Linux are guided (their flows need an installer UI or a package
 * manager), and this module still reports status for the banner.
 * @module @deepseek-ai/dsh-host-apiproxy/soffice-runtime
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'

/** Pinned Document Foundation release the managed installer fetches. */
const LIBREOFFICE_VERSION = '26.2.6'

/**
 * Pinned SHA-256 of each managed macOS artifact, captured from the official
 * Document Foundation release bytes. A version bump without fresh pins fails
 * the install loudly instead of fetching an unverified disk image.
 */
const LIBREOFFICE_SHA256 = {
  aarch64: '94bb3248df074c225490a8a6d1d9dc87c7d6783dbb7a8e9f0d0c3d94348552af',
  'x86-64': '135b8a95b8133396d54bf8e726dbc0066145efa0d785963fc3d4592acbfcfe5b',
} as const

/** Display size (MiB) of each managed artifact, from the official content lengths. */
const LIBREOFFICE_SIZE_MB = {
  aarch64: 284,
  'x86-64': 294,
} as const

/** Per-OS managed layout, resolved under {@link appSupportDir}. */
export function appSupportDir(): string {
  const override = process.env.DSH_APP_SUPPORT
  if (override !== undefined && override !== '') return override
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'BabyWhale')
  }
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'BabyWhale')
  }
  return path.join(home, '.local', 'share', 'BabyWhale')
}

/**
 * The managed install's soffice binary when present. Checked before system
 * candidates by the preview layer, so a completed download upgrades the
 * preview pipeline without a restart.
 */
export function managedSofficePath(): string | undefined {
  const support = appSupportDir()
  const candidate = process.platform === 'darwin'
    ? path.join(support, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
    : process.platform === 'win32'
      ? path.join(support, 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe')
      : path.join(support, 'libre', 'program', 'soffice')
  return existsSync(candidate) ? candidate : undefined
}

/** Where the official artifact for this machine lives, or guided-only. */
export function managedInstallSupport(): {
  supported: boolean
  url?: string
  guideUrl?: string
  sizeMb?: number
  sha256?: string
} {
  if (process.platform === 'darwin') {
    // The mirror directory spells Intel `x86_64` while the file spells it
    // `x86-64`; the pin tables key on the file spelling.
    const key = process.arch === 'arm64' ? 'aarch64' : 'x86-64'
    const dir = key === 'aarch64' ? 'aarch64' : 'x86_64'
    return {
      supported: true,
      url: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/mac/${dir}/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_${key}.dmg`,
      sizeMb: LIBREOFFICE_SIZE_MB[key],
      sha256: LIBREOFFICE_SHA256[key],
    }
  }
  // Both flows need an interactive installer or a package manager; the
  // banner guides instead of downloading.
  return { supported: false, guideUrl: 'https://www.libreoffice.org/download/download-libreoffice/' }
}

/** Lifecycle of the one-click install, mirrored to the UI banner. */
export interface SofficeInstallState {
  phase: 'idle' | 'downloading' | 'installing' | 'done' | 'error'
  /** 0..1 when meaningful for the phase. */
  progress: number
  message?: string
  error?: string
}

let state: SofficeInstallState = { phase: 'idle', progress: 0 }
let inflight: Promise<void> | undefined

/** Snapshot of the current install lifecycle (copy — callers must not mutate). */
export function sofficeInstallState(): SofficeInstallState {
  return { ...state }
}

/**
 * Kick the managed download+install; single-flight. Safe to call again while
 * running (returns the live state) or after completion (no-op done state).
 * macOS only — other platforms never enter the machine phases.
 */
export async function beginManagedSofficeInstall(onInstalled?: () => void): Promise<SofficeInstallState> {
  if (managedSofficePath() !== undefined) {
    state = { phase: 'done', progress: 1 }
    return { ...state }
  }
  const support = managedInstallSupport()
  if (!support.supported || support.url === undefined) {
    state = {
      phase: 'error',
      progress: 0,
      error: 'Managed install is available on macOS; use the guided download for this platform.',
    }
    return { ...state }
  }
  // A supported platform without a pinned hash must never fetch: downloading
  // an unverified executable artifact is the failure this gate exists to stop.
  if (support.sha256 === undefined) {
    state = {
      phase: 'error',
      progress: 0,
      error: `No pinned checksum for LibreOffice ${LIBREOFFICE_VERSION} on this machine; refusing the unverified download.`,
    }
    return { ...state }
  }
  if (inflight !== undefined) return { ...state }
  inflight = runManagedInstall(support.url, support.sha256, onInstalled).finally(() => {
    inflight = undefined
  })
  return { ...state }
}

/**
 * Verify a downloaded artifact against its pinned SHA-256 before anything
 * mounts or executes it. Streams the file (never buffered whole) and fails
 * closed: the caller owns cleanup of the rejected bytes.
 * @param file - downloaded artifact path.
 * @param expected - pinned lowercase hex digest.
 */
export async function verifyFileSha256(file: string, expected: string): Promise<void> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  if (hash.digest('hex') !== expected) {
    throw new Error(
      'LibreOffice download checksum mismatch — the artifact may be corrupted or tampered with; refusing to install',
    )
  }
}

async function runManagedInstall(url: string, sha256: string, onInstalled?: () => void): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), 'babywhale-lo-'))
  try {
    state = {
      phase: 'downloading',
      progress: 0,
      message: `Downloading LibreOffice ${LIBREOFFICE_VERSION}`,
    }
    const dmg = path.join(work, 'LibreOffice.dmg')
    await downloadToFile(url, dmg, (fraction) => {
      state = { ...state, progress: Math.min(0.8, fraction * 0.8) }
    })
    // The gate: nothing mounts, copies, or runs before the hash matches. A
    // mismatch throws with the work directory (rejected bytes included)
    // removed by the finally below.
    await verifyFileSha256(dmg, sha256)

    state = { phase: 'installing', progress: 0.85, message: 'Installing into the application support folder' }
    const support = appSupportDir()
    await mkdir(support, { recursive: true })
    const mount = path.join(work, 'mount')
    await mkdir(mount, { recursive: true })
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg])
    try {
      const entries = await readdir(mount)
      const app = entries.find(entry => entry.endsWith('.app'))
      if (app === undefined) throw new Error('the disk image contains no LibreOffice.app')
      await cp(path.join(mount, app), path.join(support, 'LibreOffice.app'), {
        recursive: true,
        verbatimSymlinks: true,
      })
    } finally {
      try {
        run('hdiutil', ['detach', '-force', mount])
      } catch {
        // A stuck mount is cleaned up by the tmp rm; the install itself succeeded.
      }
    }

    const bin = managedSofficePath()
    if (bin === undefined) throw new Error('the install did not produce a soffice binary')
    run(bin, ['--version'], 60_000)

    onInstalled?.()
    state = { phase: 'done', progress: 1, message: 'Pixel-perfect previews are ready' }
  } catch (error) {
    state = {
      phase: 'error',
      progress: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Stream a download to disk, reporting received/total as 0..1. */
async function downloadToFile(url: string, dest: string, onFraction: (fraction: number) => void): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`download failed with HTTP ${response.status}`)
  }
  const total = Number(response.headers.get('content-length') ?? '0')
  let received = 0
  const out = createWriteStream(dest)
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onFraction(received / total)
  })
  await finished(source.pipe(out))
  if (total > 0 && received < total) throw new Error(`download truncated (${received}/${total} bytes)`)
}

function run(bin: string, args: string[], timeoutMs = 300_000): void {
  const result = spawnSync(bin, args, { timeout: timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] })
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim().slice(0, 300) ?? ''
    throw new Error(`${path.basename(bin)} ${args[0]} failed${stderr === '' ? '' : `: ${stderr}`}`)
  }
}
