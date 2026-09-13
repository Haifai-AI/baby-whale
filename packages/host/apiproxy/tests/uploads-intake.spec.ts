/**
 * Upload intake hardening: the uploads directory object itself is validated
 * (a planted symlink is replaced, a non-directory fails loud) and the
 * end-to-end store lands files under `<workspace>/uploads/`.
 */
import { describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureUploadsDir, storeUpload } from '../src/uploads-intake.ts'

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-uptake-'))
  return root
}

describe('ensureUploadsDir', () => {
  it('creates a missing uploads directory', async () => {
    const root = await workspace()
    const directory = await ensureUploadsDir(root)
    expect(directory).toBe(join(root, 'uploads'))
    expect((await stat(directory)).isDirectory()).toBe(true)
  })

  it('keeps an existing real directory', async () => {
    const root = await workspace()
    await mkdir(join(root, 'uploads'))
    await writeFile(join(root, 'uploads', 'kept.txt'), 'kept')
    await expect(ensureUploadsDir(root)).resolves.toBe(join(root, 'uploads'))
    expect(await readFile(join(root, 'uploads', 'kept.txt'), 'utf8')).toBe('kept')
  })

  it('replaces a planted symlink without touching its target', async () => {
    const root = await workspace()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-uptake-out-'))
    await writeFile(join(outside, 'marker.txt'), 'outside stays')
    await symlink(outside, join(root, 'uploads'))
    await expect(ensureUploadsDir(root)).resolves.toBe(join(root, 'uploads'))
    expect((await lstat(join(root, 'uploads'))).isDirectory()).toBe(true)
    expect((await lstat(join(root, 'uploads'))).isSymbolicLink()).toBe(false)
    expect(await readFile(join(outside, 'marker.txt'), 'utf8')).toBe('outside stays')
  })

  it('fails loud when uploads exists as a non-directory', async () => {
    const root = await workspace()
    await writeFile(join(root, 'uploads'), 'a file, not a dir')
    await expect(ensureUploadsDir(root)).rejects.toThrow('is not a directory')
  })
})

describe('storeUpload', () => {
  it('stamps uploads under the workspace uploads directory', async () => {
    const root = await workspace()
    const outcome = await storeUpload(root, 'clip.mp4', new Uint8Array([1, 2, 3]), () => 1000)
    expect(outcome.path).toBe('uploads/1000-clip.mp4')
    expect(outcome.name).toBe('1000-clip.mp4')
    expect(outcome.size).toBe(3)
    expect([...await readFile(join(root, 'uploads', '1000-clip.mp4'))]).toEqual([1, 2, 3])
  })
})
