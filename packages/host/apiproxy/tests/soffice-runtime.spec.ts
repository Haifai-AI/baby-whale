/**
 * Managed LibreOffice runtime: the download gate refuses tampered artifacts
 * before anything mounts or executes them, every downloadable artifact
 * carries a pinned checksum, and the per-OS support layout resolves from the
 * environment without touching the real user's application support folder.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appSupportDir,
  managedInstallSupport,
  managedSofficePath,
  sofficeInstallState,
  verifyFileSha256,
} from '../src/soffice-runtime.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function fixture(bytes: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'soffice-verify-'))
  const file = join(dir, 'artifact.bin')
  writeFileSync(file, bytes)
  return { dir, file }
}

/** An empty support directory of our own: the layout probes must never read the real one. */
function supportFixture(): string {
  return mkdtempSync(join(tmpdir(), 'soffice-layout-'))
}

/** Where a platform's managed layout expects the soffice binary under `support`. */
function platformBinary(support: string, platform: 'darwin' | 'win32' | 'linux'): string {
  if (platform === 'darwin') return join(support, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
  if (platform === 'win32') {
    return join(support, 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe')
  }
  return join(support, 'libre', 'program', 'soffice')
}

describe('verifyFileSha256', () => {
  it('resolves when the stream digest matches the pin', async () => {
    const { dir, file } = fixture('official-bytes')
    try {
      const expected = createHash('sha256').update('official-bytes').digest('hex')
      await expect(verifyFileSha256(file, expected)).resolves.toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a tampered artifact (wrong bytes, same length)', async () => {
    const { dir, file } = fixture('official-byteS')
    try {
      const expected = createHash('sha256').update('official-bytes').digest('hex')
      await expect(verifyFileSha256(file, expected)).rejects.toThrow('checksum mismatch')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('appSupportDir', () => {
  it('uses the DSH_APP_SUPPORT override verbatim', () => {
    vi.stubEnv('DSH_APP_SUPPORT', '/custom/app-support')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(appSupportDir()).toBe('/custom/app-support')
  })

  it('treats an empty DSH_APP_SUPPORT as unset', () => {
    vi.stubEnv('DSH_APP_SUPPORT', '')
    vi.stubEnv('HOME', '/home/whale')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(appSupportDir()).toBe(join('/home/whale', 'Library', 'Application Support', 'BabyWhale'))
  })

  it('keeps the Windows layout under LOCALAPPDATA', () => {
    vi.stubEnv('DSH_APP_SUPPORT', '')
    vi.stubEnv('HOME', '/home/whale')
    vi.stubEnv('LOCALAPPDATA', '/local/appdata')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(appSupportDir()).toBe(join('/local/appdata', 'BabyWhale'))
  })

  it('keeps the Windows layout under the home AppData directory without LOCALAPPDATA', () => {
    vi.stubEnv('DSH_APP_SUPPORT', '')
    vi.stubEnv('HOME', '/home/whale')
    vi.stubEnv('LOCALAPPDATA', undefined)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(appSupportDir()).toBe(join('/home/whale', 'AppData', 'Local', 'BabyWhale'))
  })

  it('keeps the Linux layout under HOME', () => {
    vi.stubEnv('DSH_APP_SUPPORT', '')
    vi.stubEnv('HOME', '/home/whale')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(appSupportDir()).toBe(join('/home/whale', '.local', 'share', 'BabyWhale'))
  })

  it('reads USERPROFILE when HOME is absent', () => {
    vi.stubEnv('DSH_APP_SUPPORT', '')
    vi.stubEnv('HOME', undefined)
    vi.stubEnv('USERPROFILE', 'C:\\Users\\whale')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(appSupportDir()).toBe(join('C:\\Users\\whale', 'Library', 'Application Support', 'BabyWhale'))
  })

  it('falls back to a relative layout when no home is visible at all', () => {
    vi.stubEnv('DSH_APP_SUPPORT', '')
    vi.stubEnv('HOME', undefined)
    vi.stubEnv('USERPROFILE', undefined)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(appSupportDir()).toBe(join('', 'Library', 'Application Support', 'BabyWhale'))
  })
})

describe('managedSofficePath', () => {
  it('follows the macOS bundle appearing and disappearing under the support directory', () => {
    const support = supportFixture()
    try {
      vi.stubEnv('DSH_APP_SUPPORT', support)
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
      const binary = platformBinary(support, 'darwin')
      expect(managedSofficePath()).toBeUndefined()
      mkdirSync(dirname(binary), { recursive: true })
      writeFileSync(binary, '')
      expect(managedSofficePath()).toBe(binary)
      rmSync(binary)
      expect(managedSofficePath()).toBeUndefined()
    } finally {
      rmSync(support, { recursive: true, force: true })
    }
  })

  it('finds the Windows portable binary', () => {
    const support = supportFixture()
    try {
      vi.stubEnv('DSH_APP_SUPPORT', support)
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
      const binary = platformBinary(support, 'win32')
      expect(managedSofficePath()).toBeUndefined()
      mkdirSync(dirname(binary), { recursive: true })
      writeFileSync(binary, '')
      expect(managedSofficePath()).toBe(binary)
    } finally {
      rmSync(support, { recursive: true, force: true })
    }
  })

  it('finds the Linux program binary', () => {
    const support = supportFixture()
    try {
      vi.stubEnv('DSH_APP_SUPPORT', support)
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
      const binary = platformBinary(support, 'linux')
      expect(managedSofficePath()).toBeUndefined()
      mkdirSync(dirname(binary), { recursive: true })
      writeFileSync(binary, '')
      expect(managedSofficePath()).toBe(binary)
    } finally {
      rmSync(support, { recursive: true, force: true })
    }
  })
})

describe('managedInstallSupport', () => {
  it('offers the pinned Apple silicon disk image on arm64 macOS', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(managedInstallSupport()).toEqual({
      supported: true,
      url: 'https://download.documentfoundation.org/libreoffice/stable/26.2.6/mac/aarch64/LibreOffice_26.2.6_MacOS_aarch64.dmg',
      sizeMb: 284,
      sha256: '94bb3248df074c225490a8a6d1d9dc87c7d6783dbb7a8e9f0d0c3d94348552af',
    })
  })

  it('offers the pinned Intel disk image from the differently spelled mirror directory', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(managedInstallSupport()).toEqual({
      supported: true,
      url: 'https://download.documentfoundation.org/libreoffice/stable/26.2.6/mac/x86_64/LibreOffice_26.2.6_MacOS_x86-64.dmg',
      sizeMb: 294,
      sha256: '135b8a95b8133396d54bf8e726dbc0066145efa0d785963fc3d4592acbfcfe5b',
    })
  })

  it('guides to the manual download off macOS instead of offering an artifact', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(managedInstallSupport()).toEqual({
      supported: false,
      guideUrl: 'https://www.libreoffice.org/download/download-libreoffice/',
    })
  })

  it('pins a distinct checksum for every downloadable artifact', () => {
    const support = managedInstallSupport()
    if (process.platform !== 'darwin') {
      expect(support.supported).toBe(false)
      return
    }
    expect(support.supported).toBe(true)
    expect(support.url).toContain('26.2.6')
    // Exact pins: rotating a pin is a deliberate act (fresh official bytes,
    // fresh shasum), so the values are asserted verbatim, not by shape. The
    // two arch artifacts must never share one digest (copy-paste pinning
    // would verify neither).
    expect(support.sha256).toBe(
      process.arch === 'arm64'
        ? '94bb3248df074c225490a8a6d1d9dc87c7d6783dbb7a8e9f0d0c3d94348552af'
        : '135b8a95b8133396d54bf8e726dbc0066145efa0d785963fc3d4592acbfcfe5b',
    )
    expect(support.sizeMb).toBeGreaterThan(0)
  })
})

describe('sofficeInstallState', () => {
  it('hands out a snapshot that callers cannot mutate back into the lifecycle', () => {
    const before = sofficeInstallState()
    const snapshot = sofficeInstallState()
    snapshot.phase = 'error'
    snapshot.progress = 1
    snapshot.error = 'mutated by a caller'
    expect(sofficeInstallState()).toEqual(before)
  })
})
