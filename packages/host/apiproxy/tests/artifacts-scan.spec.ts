/**
 * Artifact gallery scanning: extension buckets, the entries a walk refuses
 * (dotfiles, directories, links whose target is gone, absent scan
 * directories), newest-first ordering, and the 200-entry cap over a real
 * workspace tree.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/artifacts-scan
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanArtifacts } from '../src/artifacts-scan.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-scan-'))
  await mkdir(join(root, 'deliverables'))
  await mkdir(join(root, 'uploads'))
})

describe('scanArtifacts', () => {
  it('sorts each extension into its gallery kind, unknown ones into other', async () => {
    const kinds = {
      'report.xlsx': 'xlsx',
      'macros.xlsm': 'xlsx',
      'brief.docx': 'docx',
      'deck.pptx': 'pptx',
      'table.csv': 'csv',
      'table.tsv': 'csv',
      'paper.pdf': 'pdf',
      'SHOUTY.PDF': 'pdf',
      'shot.png': 'image',
      'photo.jpg': 'image',
      'photo.jpeg': 'image',
      'anim.gif': 'image',
      'art.webp': 'image',
      'icon.svg': 'image',
      'notes.txt': 'text',
      'readme.md': 'text',
      'data.json': 'text',
      'archive.zip': 'other',
    }
    for (const name of Object.keys(kinds)) await writeFile(join(root, 'deliverables', name), 'bytes')

    const found = await scanArtifacts(root)

    expect(Object.fromEntries(found.map(artifact => [artifact.name, artifact.kind]))).toEqual(kinds)
  })

  it('reports origin, workspace-relative path, size, and modification time', async () => {
    const at = new Date('2024-03-01T12:00:00Z')
    await writeFile(join(root, 'deliverables', 'report.csv'), 'hello')
    await writeFile(join(root, 'uploads', 'clip.mp4'), 'bytes!')
    await utimes(join(root, 'deliverables', 'report.csv'), at, at)
    await utimes(join(root, 'uploads', 'clip.mp4'), at, at)

    const found = await scanArtifacts(root)

    const byPath = new Map(found.map(artifact => [artifact.path, artifact]))
    expect(byPath.get('deliverables/report.csv')).toEqual({
      path: 'deliverables/report.csv',
      name: 'report.csv',
      kind: 'csv',
      size: 5,
      modifiedAt: at.getTime(),
      origin: 'deliverable',
    })
    expect(byPath.get('uploads/clip.mp4')).toEqual({
      path: 'uploads/clip.mp4',
      name: 'clip.mp4',
      kind: 'other',
      size: 6,
      modifiedAt: at.getTime(),
      origin: 'upload',
    })
  })

  it('skips dotfiles, directories, and entries whose link target is gone', async () => {
    await writeFile(join(root, 'deliverables', 'kept.txt'), 'kept')
    await writeFile(join(root, 'deliverables', '.hidden.txt'), 'hidden')
    await mkdir(join(root, 'deliverables', '.git'))
    await mkdir(join(root, 'deliverables', 'nested'))
    await symlink(join(root, 'deliverables', 'vanished.txt'), join(root, 'deliverables', 'dangling.txt'))

    const found = await scanArtifacts(root)

    expect(found.map(artifact => artifact.name)).toEqual(['kept.txt'])
  })

  it('orders artifacts newest first by modification time', async () => {
    const times = [
      ['oldest.txt', new Date('2024-01-01T00:00:00Z')],
      ['middle.txt', new Date('2024-02-01T00:00:00Z')],
      ['newest.txt', new Date('2024-03-01T00:00:00Z')],
    ] as const
    for (const [name, at] of times) {
      await writeFile(join(root, 'uploads', name), name)
      await utimes(join(root, 'uploads', name), at, at)
    }

    const found = await scanArtifacts(root)

    expect(found.map(artifact => artifact.name)).toEqual(['newest.txt', 'middle.txt', 'oldest.txt'])
    expect(found[0]!.modifiedAt).toBe(new Date('2024-03-01T00:00:00Z').getTime())
  })

  it('answers an empty gallery when neither scan directory exists', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'dsh-scan-bare-'))
    await expect(scanArtifacts(bare)).resolves.toEqual([])
  })

  it('keeps only the 200 most recent entries', async () => {
    for (let index = 0; index <= 200; index++) {
      const file = join(root, 'uploads', `f${String(index).padStart(3, '0')}.txt`)
      await writeFile(file, 'x')
      const at = new Date(Date.UTC(2024, 0, 1, 0, index))
      await utimes(file, at, at)
    }

    const found = await scanArtifacts(root)

    expect(found).toHaveLength(200)
    expect(found[0]!.name).toBe('f200.txt')
    expect(found.at(-1)!.name).toBe('f001.txt')
  })
})
