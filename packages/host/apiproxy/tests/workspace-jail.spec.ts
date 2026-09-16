/**
 * Workspace jail: separator-boundary containment (same-prefix siblings
 * refused, an already-terminated filesystem root contained) and symlink
 * anchoring (links out refused, links in allowed, missing refused).
 * Real-filesystem specs under an OS temp root, resolved to canonical spelling
 * first so the boundary logic — not the platform's temp-dir aliasing — is what
 * the assertions exercise.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, win32 } from 'node:path'
import { anchorWorkspacePath, containedPath, withoutExtendedPrefix } from '../src/workspace-jail.ts'

let base: string
let root: string

beforeEach(async () => {
  // Canonical spelling: macOS temp dirs alias /var to /private/var, and the
  // jail compares canonical paths — build fixtures under the resolved base.
  base = await realpath(await mkdtemp(join(tmpdir(), 'dsh-wsjail-')))
  root = join(base, 'work')
  await mkdir(root)
})

describe('containedPath', () => {
  it('contains the root itself and paths beneath it', () => {
    expect(containedPath(root, root)).toBe(true)
    expect(containedPath(root, join(root, 'deliverables', 'a.mp4'))).toBe(true)
    expect(containedPath(`${root}/`, join(root, 'f'))).toBe(true)
  })

  it('refuses same-prefix siblings, parents, and outsiders', () => {
    // The regression this helper exists for: a bare string prefix admits
    // `/work-evil/x` under `/work`.
    expect(containedPath(root, join(`${root}-evil`, 'secret.txt'))).toBe(false)
    expect(containedPath(root, base)).toBe(false)
    expect(containedPath(root, join(tmpdir(), 'dsh-wsjail-elsewhere'))).toBe(false)
  })

  it('falls back to the lexical root when the root does not exist', async () => {
    // The workspace may be removed while a request is in flight. The lexical
    // form is then the only evidence available, and it still decides the same
    // way for an inside path and for an outsider.
    const vanished = join(base, 'gone-workspace')
    expect(containedPath(vanished, join(vanished, 'deliverables', 'a.mp4'))).toBe(true)
    expect(containedPath(vanished, join(base, 'elsewhere'))).toBe(false)
  })

  it('contains every path when the root real path already ends in a separator', () => {
    // A POSIX root realpaths to `/`, which is already separator-terminated and
    // must not gain a second one; a Windows root ends in a backslash instead.
    const filesystemRoot = parse(process.cwd()).root
    expect(containedPath(filesystemRoot, filesystemRoot)).toBe(true)
    expect(containedPath(filesystemRoot, join(filesystemRoot, 'elsewhere'))).toBe(true)
  })
})

describe('withoutExtendedPrefix', () => {
  it('treats the extended-length prefix as the same path, on either side', () => {
    // Node adds `\\?\` when it resolves through one realpath implementation and
    // omits it through another, and `path.relative` then reports the two
    // spellings as living on different roots. On Windows that refused every
    // honest file inside a workspace, so both sides are normalized first. The
    // spellings are Windows ones by construction, and `path.win32` decides
    // them identically on every host.
    expect(withoutExtendedPrefix('\\\\?\\C:\\ws')).toBe('C:\\ws')
    expect(withoutExtendedPrefix('\\\\?\\C:\\ws\\notes.txt')).toBe('C:\\ws\\notes.txt')
    expect(withoutExtendedPrefix('C:\\ws')).toBe('C:\\ws')
    // A UNC root keeps its own leading pair rather than losing both.
    expect(withoutExtendedPrefix('\\\\?\\UNC\\server\\share')).toBe('\\\\server\\share')
  })

  it('leaves a prefixed and an unprefixed path on one root after normalization', () => {
    const root = withoutExtendedPrefix('\\\\?\\C:\\ws')
    const target = withoutExtendedPrefix('C:\\ws\\deliverables\\notes.txt')
    expect(win32.relative(root, target)).toBe('deliverables\\notes.txt')
    // The sibling escape stays refused at the same time.
    expect(win32.relative(root, 'C:\\ws-evil\\secret.txt').startsWith('..')).toBe(true)
  })
})

describe('anchorWorkspacePath', () => {
  it('anchors an inside file to its real path', async () => {
    const file = join(root, 'deliverables', 'clip.mp4')
    await mkdir(join(root, 'deliverables'), { recursive: true })
    await writeFile(file, 'bytes')
    await expect(anchorWorkspacePath(root, 'deliverables/clip.mp4')).resolves.toBe(await realpath(file))
  })

  it('refuses missing files exactly like escapes (no existence oracle)', async () => {
    await expect(anchorWorkspacePath(root, 'deliverables/gone.mp4')).resolves.toBeUndefined()
  })

  it('refuses parent-traversal escapes even when the target exists', async () => {
    await writeFile(join(base, 'outside.txt'), 'secret')
    await expect(anchorWorkspacePath(root, '../outside.txt')).resolves.toBeUndefined()
    await expect(anchorWorkspacePath(root, join(base, 'outside.txt'))).resolves.toBeUndefined()
  })

  it('refuses same-prefix sibling directories', async () => {
    const evil = join(`${root}-evil`)
    await mkdir(evil)
    await writeFile(join(evil, 'secret.txt'), 'secret')
    await expect(anchorWorkspacePath(root, '../work-evil/secret.txt')).resolves.toBeUndefined()
  })

  it('refuses file symlinks pointing outside, allows ones pointing inside', async () => {
    await writeFile(join(base, 'outside.txt'), 'secret')
    await writeFile(join(root, 'inside.txt'), 'fine')
    await symlink(join(base, 'outside.txt'), join(root, 'link-out.txt'))
    await symlink(join(root, 'inside.txt'), join(root, 'link-in.txt'))
    await expect(anchorWorkspacePath(root, 'link-out.txt')).resolves.toBeUndefined()
    await expect(anchorWorkspacePath(root, 'link-in.txt')).resolves.toBe(await realpath(join(root, 'inside.txt')))
  })

  it('refuses files reached through a directory symlink pointing outside', async () => {
    const outside = join(base, 'outside-dir')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(root, 'link-dir'))
    await expect(anchorWorkspacePath(root, 'link-dir/secret.txt')).resolves.toBeUndefined()
  })

  it('allows files reached through a directory symlink pointing inside', async () => {
    const inner = join(root, 'inner')
    await mkdir(inner)
    await writeFile(join(inner, 'ok.txt'), 'fine')
    await symlink(inner, join(root, 'link-inner'))
    await expect(anchorWorkspacePath(root, 'link-inner/ok.txt')).resolves.toBe(await realpath(join(inner, 'ok.txt')))
  })
})
