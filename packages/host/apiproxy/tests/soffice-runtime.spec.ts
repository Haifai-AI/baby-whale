/**
 * Managed LibreOffice runtime: the download gate refuses tampered artifacts
 * before anything mounts or executes them, and every downloadable artifact
 * carries a pinned checksum.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { managedInstallSupport, verifyFileSha256 } from '../src/soffice-runtime.ts'

function fixture(bytes: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'soffice-verify-'))
  const file = join(dir, 'artifact.bin')
  writeFileSync(file, bytes)
  return { dir, file }
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

describe('managedInstallSupport', () => {
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
