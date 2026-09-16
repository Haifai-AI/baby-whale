/**
 * Managed LibreOffice install lifecycle: the single-flight macOS install
 * downloads the pinned disk image, verifies it, mounts it, copies the
 * application bundle into the support directory, and reports every abort
 * point as an error phase. The network, the helper commands, the artifact
 * digest, and a failing work-directory cleanup are stubbed seams; streaming,
 * verification, mounting, copying, and lifecycle bookkeeping run for real.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/managed-soffice-install
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { SofficeInstallState } from '../src/soffice-runtime.ts'

type RuntimeModule = typeof import('../src/soffice-runtime.ts')

/** Outcome a stubbed helper command reports for one invocation. */
type SpawnOutcome = (bin: string, args: string[]) => { status: number | null; stderr?: string }

/** One stubbed helper-command invocation, with the lifecycle snapshot it observed. */
interface SpawnCall {
  bin: string
  args: string[]
  timeout: number | undefined
  state: SofficeInstallState | undefined
}

/** Stubbed seams the install drives, reset between tests. */
interface Seams {
  /** Hex digest the hash seam reports; `undefined` computes the real SHA-256. */
  digest: string | undefined
  calls: SpawnCall[]
  spawn: SpawnOutcome | undefined
  /** Module instance whose state the helper seam snapshots. */
  runtime: RuntimeModule | undefined
  rmFailure: Error | undefined
}

const seams = vi.hoisted<Seams>(() => ({
  digest: undefined,
  calls: [],
  spawn: undefined,
  runtime: undefined,
  rmFailure: undefined,
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    // Neither hdiutil nor a copied soffice exists on a test host, so the seam
    // records the invocation and reports the outcome the test asked for.
    spawnSync: ((bin: string, args: string[], options?: { timeout?: number }) => {
      seams.calls.push({ bin, args, timeout: options?.timeout, state: seams.runtime?.sofficeInstallState() })
      const outcome = seams.spawn?.(bin, args) ?? { status: 0 }
      return { status: outcome.status, stderr: Buffer.from(outcome.stderr ?? '') }
    }) as unknown as typeof actual.spawnSync,
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    // A work directory the host refuses to remove (Windows holds open handles)
    // is the failure this seam reproduces; every other call reaches the real fs.
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (seams.rmFailure !== undefined) throw seams.rmFailure
      await actual.rm(...args)
    },
  }
})

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    // Only the official artifact bytes produce the pinned digest, so the seam
    // reports whatever digest the pin attests to while the real hash streams
    // the downloaded file; with no override it computes the real SHA-256.
    createHash: (algorithm: string, options?: object) => {
      const hash = actual.createHash(algorithm, options)
      const digest = seams.digest
      if (digest !== undefined) Object.defineProperty(hash, 'digest', { value: () => digest })
      return hash
    },
  }
})

let hostPlatform: NodeJS.Platform = 'darwin'
const residue: string[] = []

beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockImplementation(() => hostPlatform)
})

afterEach(() => {
  hostPlatform = 'darwin'
  seams.digest = undefined
  seams.calls = []
  seams.spawn = undefined
  seams.runtime = undefined
  seams.rmFailure = undefined
  for (const dir of residue.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  residue.push(dir)
  return dir
}

async function freshRuntime(): Promise<RuntimeModule> {
  vi.resetModules()
  return import('../src/soffice-runtime.ts')
}

/**
 * A runtime with an empty per-test support directory and no download yet, so
 * each test decides which artifact bytes arrive and how.
 */
async function installableRuntime(): Promise<{ runtime: RuntimeModule; support: string }> {
  const support = tempDir('soffice-support-')
  vi.stubEnv('DSH_APP_SUPPORT', support)
  const runtime = await freshRuntime()
  seams.runtime = runtime
  return { runtime, support }
}

/**
 * Open the hash gate for this platform: only the official artifact bytes
 * produce the pin, so the hash seam reports the digest the pin attests to.
 */
function acceptsPinnedDigest(runtime: RuntimeModule): void {
  const pin = runtime.managedInstallSupport().sha256
  if (pin === undefined) throw new Error('the stubbed macOS platform reports no pinned digest')
  seams.digest = pin
}

/** Serve `bytes` as the disk image, announcing `announced` octets to the download. */
function stubDownload(bytes: string, announced?: number): Mock {
  const fetchMock = vi.fn(async () => new Response(bytes, {
    headers: announced === undefined ? {} : { 'content-length': String(announced) },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** A download body the test feeds chunk by chunk, so mid-download states are observable. */
function pushableBody(): {
  body: ReadableStream<Uint8Array>
  push: (bytes: number) => void
  close: () => void
} {
  let enqueue: (chunk: Uint8Array) => void = () => { throw new Error('the body stream has not started') }
  let finish: () => void = () => { throw new Error('the body stream has not started') }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueue = (chunk) => { controller.enqueue(chunk) }
      finish = () => { controller.close() }
    },
  })
  return {
    body,
    push: (bytes) => { enqueue(new Uint8Array(bytes)) },
    close: () => { finish() },
  }
}

/** A helper-command fake whose `hdiutil attach` materializes `entries` in the mount point. */
function attachMaterializing(entries: string[]): SpawnOutcome {
  return (bin, args) => {
    if (bin === 'hdiutil' && args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1]
      if (mount === undefined) throw new Error(`attach without a mount point: ${args.join(' ')}`)
      for (const entry of entries) {
        mkdirSync(dirname(join(mount, entry)), { recursive: true })
        writeFileSync(join(mount, entry), '')
      }
    }
    return { status: 0 }
  }
}

/** Wait for the asynchronous install to settle into `phase`. */
async function settlesInto(runtime: RuntimeModule, phase: SofficeInstallState['phase']): Promise<void> {
  await vi.waitFor(() => { expect(runtime.sofficeInstallState().phase).toBe(phase) }, { timeout: 10_000 })
}

describe('beginManagedSofficeInstall', () => {
  it('reports the managed runtime as done without downloading when it is already installed', async () => {
    const support = tempDir('soffice-support-')
    vi.stubEnv('DSH_APP_SUPPORT', support)
    const binary = join(support, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
    mkdirSync(dirname(binary), { recursive: true })
    writeFileSync(binary, '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const runtime = await freshRuntime()
    const snapshot = await runtime.beginManagedSofficeInstall()

    expect(snapshot).toEqual({ phase: 'done', progress: 1 })
    expect(runtime.sofficeInstallState()).toEqual(snapshot)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(seams.calls).toEqual([])
  })

  it('guides to the manual download instead of installing off macOS', async () => {
    hostPlatform = 'linux'
    const support = tempDir('soffice-support-')
    vi.stubEnv('DSH_APP_SUPPORT', support)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const runtime = await freshRuntime()
    const snapshot = await runtime.beginManagedSofficeInstall()

    expect(snapshot.phase).toBe('error')
    expect(snapshot.progress).toBe(0)
    expect(snapshot.error).toContain('use the guided download for this platform')
    expect(runtime.sofficeInstallState()).toEqual(snapshot)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(seams.calls).toEqual([])
  })

  it('streams the pinned disk image, mounts it, and hands the runtime back installed', async () => {
    const { runtime, support } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    seams.spawn = attachMaterializing(['LibreOffice.app/Contents/MacOS/soffice'])
    const stream = pushableBody()
    const fetchMock = vi.fn(async () => new Response(stream.body, { headers: { 'content-length': '20' } }))
    vi.stubGlobal('fetch', fetchMock)

    let installed = 0
    await runtime.beginManagedSofficeInstall(() => { installed += 1 })
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    stream.push(10)
    // Half the announced length is half of the download's 0.8 share of progress.
    await vi.waitFor(() => { expect(runtime.sofficeInstallState().progress).toBe(0.4) })
    expect(runtime.sofficeInstallState().phase).toBe('downloading')
    stream.push(10)
    stream.close()
    await settlesInto(runtime, 'done')

    expect(installed).toBe(1)
    expect(runtime.sofficeInstallState()).toEqual({
      phase: 'done',
      progress: 1,
      message: 'Pixel-perfect previews are ready',
    })
    expect(runtime.managedSofficePath()).toBe(join(support, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'))
    expect(existsSync(join(support, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'))).toBe(true)
    // Attach, detach, then the version probe: the mount never outlives the copy.
    expect(seams.calls.map(call => call.args[0])).toEqual(['attach', 'detach', '--version'])
    const attachArgs = seams.calls[0]?.args
    const mount = attachArgs?.[4]
    expect(attachArgs?.slice(0, 5)).toEqual(['attach', '-nobrowse', '-readonly', '-mountpoint', mount])
    expect(attachArgs?.[5]?.endsWith('LibreOffice.dmg')).toBe(true)
    expect(seams.calls[0]).toMatchObject({
      bin: 'hdiutil',
      timeout: 300_000,
      state: { phase: 'installing', progress: 0.85, message: 'Installing into the application support folder' },
    })
    expect(seams.calls[1]).toMatchObject({ bin: 'hdiutil', args: ['detach', '-force', mount], timeout: 300_000 })
    expect(seams.calls[2]).toMatchObject({
      bin: join(support, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'),
      args: ['--version'],
      timeout: 60_000,
      state: { phase: 'installing', progress: 0.85 },
    })
  })

  it('keeps one install in flight when the banner asks again mid-download', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    seams.spawn = attachMaterializing(['LibreOffice.app/Contents/MacOS/soffice'])
    const stream = pushableBody()
    const fetchMock = vi.fn(async () => new Response(stream.body, { headers: { 'content-length': '20' } }))
    vi.stubGlobal('fetch', fetchMock)

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'downloading')
    const second = await runtime.beginManagedSofficeInstall()

    expect(second.phase).toBe('downloading')
    stream.push(20)
    stream.close()
    await settlesInto(runtime, 'done')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(seams.calls.filter(call => call.args[0] === 'attach')).toHaveLength(1)
  })

  it('installs a disk image whose length the mirror does not announce', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    seams.spawn = attachMaterializing(['LibreOffice.app/Contents/MacOS/soffice'])
    stubDownload('official-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'done')

    expect(runtime.sofficeInstallState().progress).toBe(1)
  })

  it('refuses the disk image whose bytes do not match the pinned digest', async () => {
    const { runtime, support } = await installableRuntime()
    seams.spawn = attachMaterializing(['LibreOffice.app/Contents/MacOS/soffice'])
    stubDownload('tampered-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toContain('checksum mismatch')
    // The gate: nothing mounts or executes before the hash matches.
    expect(seams.calls).toEqual([])
    expect(existsSync(join(support, 'LibreOffice.app'))).toBe(false)
  })

  it('reports the mirror status that refused the download', async () => {
    const { runtime } = await installableRuntime()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe('download failed with HTTP 503')
  })

  it('reports a download response that carries no body at all', async () => {
    const { runtime } = await installableRuntime()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe('download failed with HTTP 200')
  })

  it('reports a download that stops short of the announced length', async () => {
    const { runtime } = await installableRuntime()
    stubDownload('abc', 5)

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe('download truncated (3/5 bytes)')
  })

  it('reports a network failure that is not an Error by its string form', async () => {
    const { runtime } = await installableRuntime()
    vi.stubGlobal('fetch', vi.fn(() => { throw 'the mirror is unreachable' }))

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe('the mirror is unreachable')
  })

  it('reports a helper command that fails with its stderr text', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    seams.spawn = () => ({ status: 1, stderr: 'hdiutil: attach failed - no mountable file systems' })
    stubDownload('official-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe(
      'hdiutil attach failed: hdiutil: attach failed - no mountable file systems',
    )
  })

  it('reports a helper command that fails without any stderr text', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    seams.spawn = () => ({ status: 1 })
    stubDownload('official-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe('hdiutil attach failed')
  })

  it('fails when the disk image carries no application bundle', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    // A non-bundle entry exercises the scan that looks for the `.app`.
    seams.spawn = attachMaterializing(['readme.txt'])
    stubDownload('official-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe('the disk image contains no LibreOffice.app')
    // The mount that was opened is still released on the way out.
    expect(seams.calls.map(call => call.args[0])).toEqual(['attach', 'detach'])
  })

  it('fails when the copied bundle has no soffice binary', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    seams.spawn = attachMaterializing(['LibreOffice.app/Contents/Resources/readme.txt'])
    stubDownload('official-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'error')

    expect(runtime.sofficeInstallState().error).toBe('the install did not produce a soffice binary')
  })

  it('keeps the installed runtime when the disk image refuses to detach', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    const attach = attachMaterializing(['LibreOffice.app/Contents/MacOS/soffice'])
    seams.spawn = (bin, args) => (args[0] === 'detach' ? { status: 1, stderr: 'resource busy' } : attach(bin, args))
    stubDownload('official-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'done')

    expect(seams.calls.filter(call => call.args[0] === 'detach')).toHaveLength(1)
  })

  it('keeps the installed runtime when the work directory cannot be removed', async () => {
    const { runtime } = await installableRuntime()
    acceptsPinnedDigest(runtime)
    seams.spawn = attachMaterializing(['LibreOffice.app/Contents/MacOS/soffice'])
    seams.rmFailure = new Error('EBUSY: resource busy or locked')
    stubDownload('official-disk-image')

    await runtime.beginManagedSofficeInstall()
    await settlesInto(runtime, 'done')

    expect(runtime.managedSofficePath()).toBeDefined()
  })
})
