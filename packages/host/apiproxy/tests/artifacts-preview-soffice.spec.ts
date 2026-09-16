/**
 * The LibreOffice seam behind office previews: binary lookup order (managed
 * install wins over the system candidates, each probe cached for the process,
 * dropped again by the re-lookup hook) and the two conversion round trips —
 * PDF for the Original tab and xlsx for formula recalculation — each cached by
 * source mtime under its own key.
 *
 * `node:child_process` is faked here so no case needs a real LibreOffice; the
 * fake also materializes the output file the real binary would have written,
 * which is what the cache logic actually keys on.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/artifacts-preview-soffice
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  convertToPdfCached,
  findSoffice,
  recalcXlsxBytes,
  resetSofficeLookup,
} from '../src/artifacts-preview.ts'

interface Invocation {
  bin: string
  args: string[]
}

/** Every `execFileSync` probe, in order. */
const probes: Invocation[] = []
/** Which probed binary answers `--version` successfully. */
let probeAccepts: (bin: string) => boolean = () => false

/** Every `execFile` conversion, in order. */
const conversions: Invocation[] = []
/** Conversion exit outcome. */
let conversionFails = false
/** Materializes the file the real LibreOffice would have written into `--outdir`. */
let materialize: ((outdir: string, source: string, spec: string) => void) | undefined

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: (bin: string, args: string[]): Buffer => {
      probes.push({ bin, args })
      if (!probeAccepts(bin)) throw new Error(`spawnSync ${bin} ENOENT`)
      return Buffer.from('')
    },
    execFile: (
      bin: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null) => void,
    ): void => {
      conversions.push({ bin, args })
      const outdir = args[args.indexOf('--outdir') + 1] ?? ''
      const spec = args[args.indexOf('--convert-to') + 1] ?? ''
      materialize?.(outdir, args[args.length - 1] ?? '', spec)
      callback(conversionFails ? new Error(`${bin} exited 1`) : null)
    },
  }
})

let root: string
let cacheDir: string
let sourcePath: string
let mtime = 1_700_000_000_000

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-soffice-'))
  cacheDir = join(root, 'cache')
  sourcePath = join(root, 'book.xlsx')
  writeFileSync(sourcePath, 'sheet bytes')
  // A DSH_APP_SUPPORT with no managed install: the lookup falls through to probing.
  vi.stubEnv('DSH_APP_SUPPORT', join(root, 'app-support'))
  probes.length = 0
  conversions.length = 0
  probeAccepts = () => false
  conversionFails = false
  materialize = undefined
  mtime += 1
  resetSofficeLookup()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** LibreOffice writes `<outdir>/<source basename>.<ext>`. */
function producing(extension: string, payload: string, spec: string): void {
  materialize = (outdir, source, requested) => {
    if (requested !== spec) return
    const base = basename(source).replace(/\.[^.]+$/, '')
    writeFileSync(join(outdir, `${base}.${extension}`), payload)
  }
}

function producingPdf(payload = 'pdf bytes', spec = 'pdf'): void {
  producing('pdf', payload, spec)
}

/** The cache key `convertToPdfCached` derives, so a case can pre-seed or block it. */
function pdfCacheKey(spec = 'pdf'): string {
  return `${createHash('sha1').update(sourcePath).update(String(mtime)).update(spec).digest('hex').slice(0, 16)}.pdf`
}

describe('findSoffice', () => {
  it('answers with the managed install without probing the system candidates', async () => {
    const support = join(root, 'app-support')
    const managed = join(support, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
    mkdirSync(join(support, 'LibreOffice.app', 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(managed, '#!/bin/sh\n')
    // The managed layout is per-OS; pin the OS so the fixture matches on any host.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { findSoffice: lookup } = await import('../src/artifacts-preview.ts')
    expect(lookup()).toBe(managed)
    expect(probes).toEqual([])
  })

  it('finds the Windows portable layout under the support directory', async () => {
    const support = join(root, 'app-support')
    const managed = join(support, 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe')
    mkdirSync(join(support, 'LibreOfficePortable', 'App', 'libreoffice', 'program'), { recursive: true })
    writeFileSync(managed, 'MZ')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const { findSoffice: lookup } = await import('../src/artifacts-preview.ts')
    expect(lookup()).toBe(managed)
    expect(probes).toEqual([])
  })

  it('resolves the Linux support layout and reports no managed install when it is absent', async () => {
    const support = join(root, 'app-support')
    const managed = join(support, 'libre', 'program', 'soffice')
    mkdirSync(join(support, 'libre', 'program'), { recursive: true })
    writeFileSync(managed, '#!/bin/sh\n')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const { managedSofficePath } = await import('../src/soffice-runtime.ts')
    expect(managedSofficePath()).toBe(managed)

    rmSync(managed)
    const { findSoffice: lookup } = await import('../src/artifacts-preview.ts')
    probeAccepts = bin => bin === 'soffice'
    expect(lookup()).toBe('soffice')
  })

  it('probes the Windows install location under ProgramFiles and skips a blank one', async () => {
    // SOFFICE_CANDIDATES is resolved at module load, so a fresh module instance
    // is the only way to see the Windows layout on this host.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.stubEnv('ProgramFiles', 'D:\\Program Files')
    vi.resetModules()
    const { findSoffice: lookup, resetSofficeLookup: reset } = await import('../src/artifacts-preview.ts')
    // Only the portable layout answers, so the probe walks every candidate before it.
    probeAccepts = bin => bin.endsWith('soffice.exe')
    expect(lookup()).toBe(String.raw`D:\Program Files\LibreOffice\program\soffice.exe`)

    vi.stubEnv('ProgramFiles', undefined)
    vi.resetModules()
    const unset = await import('../src/artifacts-preview.ts')
    unset.resetSofficeLookup()
    probes.length = 0
    // The fallback literal is not separator-terminated, so the path joins without one.
    expect(unset.findSoffice()).toBe(String.raw`C:Program Files\LibreOffice\program\soffice.exe`)
    reset()
  })

  it('omits the Windows install location on a host that is not Windows', async () => {
    // The candidate list is built once at module load from `process.platform`,
    // so its non-Windows arm needs a module instance of its own: on the Windows
    // lane every other import resolves the list with win32 already true, and the
    // per-file branch gate would otherwise never observe this arm there.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.stubEnv('ProgramFiles', String.raw`D:\Program Files`)
    vi.resetModules()
    const { findSoffice: lookup, resetSofficeLookup: reset } = await import('../src/artifacts-preview.ts')
    expect(lookup()).toBeUndefined()
    expect(probes.map(probe => probe.bin))
      .not.toContain(String.raw`D:\Program Files\LibreOffice\program\soffice.exe`)
    reset()
  })

  it('probes the candidates in order and answers with the first that reports a version', () => {
    probeAccepts = bin => bin === '/usr/bin/soffice'
    expect(findSoffice()).toBe('/usr/bin/soffice')
    expect(probes.map(probe => probe.bin)).toEqual([
      'soffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '/usr/bin/soffice',
    ])
    expect(probes.every(probe => probe.args.join(' ') === '--version')).toBe(true)
  })

  it('caches the resolved binary so later previews skip the probe', () => {
    probeAccepts = bin => bin === 'soffice'
    findSoffice()
    expect(probes).toHaveLength(1)
    expect(findSoffice()).toBe('soffice')
    expect(probes).toHaveLength(1)
  })

  it('caches the absent answer so every preview does not re-probe a broken host', () => {
    expect(findSoffice()).toBeUndefined()
    const probed = probes.length
    expect(probed).toBeGreaterThanOrEqual(4)
    expect(findSoffice()).toBeUndefined()
    expect(probes).toHaveLength(probed)
  })

  it('re-probes once the re-lookup hook drops the cached answer', () => {
    probeAccepts = bin => bin === 'soffice'
    expect(findSoffice()).toBe('soffice')
    resetSofficeLookup()
    probeAccepts = bin => bin === '/usr/local/bin/soffice'
    expect(findSoffice()).toBe('/usr/local/bin/soffice')
  })
})

describe('convertToPdfCached', () => {
  it('converts headless with a per-conversion profile and serves the cache afterwards', async () => {
    producingPdf('pdf bytes', 'calc_pdf_Export')
    const pdf = await convertToPdfCached('soffice', sourcePath, cacheDir, mtime, 'calc_pdf_Export')
    expect(pdf).toBe(join(cacheDir, pdfCacheKey('calc_pdf_Export')))
    expect(readFileSync(pdf!, 'utf8')).toBe('pdf bytes')
    expect(conversions).toHaveLength(1)
    const args = conversions[0]!.args
    expect(conversions[0]!.bin).toBe('soffice')
    expect(args.slice(0, 2)).toEqual(['--headless', '--norestore'])
    expect(args.some(arg => arg.startsWith(`-env:UserInstallation=file://${cacheDir}/lo-profile`))).toBe(true)
    expect(args[args.indexOf('--convert-to') + 1]).toBe('calc_pdf_Export')
    expect(args[args.indexOf('--outdir') + 1]).toBe(cacheDir)
    expect(args[args.length - 1]).toBe(sourcePath)

    conversions.length = 0
    materialize = undefined
    await expect(convertToPdfCached('soffice', sourcePath, cacheDir, mtime, 'calc_pdf_Export')).resolves.toBe(pdf)
    expect(conversions).toEqual([])
  })

  it('separates cached conversions of the same source by mtime and filter spec', async () => {
    materialize = (outdir, source, spec) => {
      const base = basename(source).replace(/\.[^.]+$/, '')
      writeFileSync(join(outdir, `${base}.pdf`), spec)
    }
    const plain = await convertToPdfCached('soffice', sourcePath, cacheDir, mtime)
    const filtered = await convertToPdfCached('soffice', sourcePath, cacheDir, mtime, 'calc_pdf_Export')
    mtime += 1
    const laterSource = await convertToPdfCached('soffice', sourcePath, cacheDir, mtime)
    expect(new Set([plain, filtered, laterSource]).size).toBe(3)
  })

  it('asks for the plain pdf filter when no spec rides', async () => {
    producingPdf()
    await convertToPdfCached('soffice', sourcePath, cacheDir, mtime)
    expect(conversions[0]!.args[conversions[0]!.args.indexOf('--convert-to') + 1]).toBe('pdf')
  })

  it('creates the cache directory when it does not exist yet', async () => {
    producingPdf()
    await expect(convertToPdfCached('soffice', sourcePath, join(root, 'deep', 'cache'), mtime))
      .resolves.toContain(join(root, 'deep', 'cache'))
  })

  it('retries with plain pdf when an unknown filter spec produces nothing', async () => {
    materialize = (outdir, source, spec) => {
      if (spec !== 'pdf') return
      const base = basename(source).replace(/\.[^.]+$/, '')
      writeFileSync(join(outdir, `${base}.pdf`), 'fallback bytes')
    }
    const pdf = await convertToPdfCached('soffice', sourcePath, cacheDir, mtime, 'macro:///Unknown')
    expect(readFileSync(pdf!, 'utf8')).toBe('fallback bytes')
    expect(conversions.map(call => call.args[call.args.indexOf('--convert-to') + 1]))
      .toEqual(['macro:///Unknown', 'pdf'])
  })

  it('does not retry when the plain pdf filter itself produced nothing', async () => {
    await expect(convertToPdfCached('soffice', sourcePath, cacheDir, mtime)).resolves.toBeUndefined()
    expect(conversions).toHaveLength(1)
  })

  it('converts again when the cached entry is empty', async () => {
    producingPdf()
    const pdf = await convertToPdfCached('soffice', sourcePath, cacheDir, mtime)
    writeFileSync(pdf!, '')
    conversions.length = 0
    await expect(convertToPdfCached('soffice', sourcePath, cacheDir, mtime)).resolves.toBe(pdf)
    expect(readFileSync(pdf!, 'utf8')).toBe('pdf bytes')
    expect(conversions).toHaveLength(1)
  })

  it('reports failure when the converted file cannot be moved onto its cache key', async () => {
    // A directory squatting on the key path makes the rename fail after the
    // conversion itself succeeded.
    mkdirSync(join(cacheDir, pdfCacheKey()), { recursive: true })
    producingPdf()
    await expect(convertToPdfCached('soffice', sourcePath, cacheDir, mtime)).resolves.toBeUndefined()
  })
})

describe('recalcXlsxBytes', () => {
  /** LibreOffice writes `<outdir>/<source basename>.xlsx`. */
  function producingXlsx(payload: string): void {
    materialize = (outdir, source, spec) => {
      if (spec !== 'xlsx') return
      const base = basename(source).replace(/\.[^.]+$/, '')
      writeFileSync(join(outdir, `${base}.xlsx`), payload)
    }
  }

  it('recalculates headless under its own profile and serves the cached copy afterwards', async () => {
    producingXlsx('recalculated bytes')
    const bytes = await recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)
    expect(new TextDecoder().decode(bytes)).toBe('recalculated bytes')
    expect(conversions).toHaveLength(1)
    const args = conversions[0]!.args
    expect(args.slice(0, 2)).toEqual(['--headless', '--norestore'])
    expect(args.some(arg => arg.startsWith(`-env:UserInstallation=file://${cacheDir}/lo-profile-recalc`))).toBe(true)
    expect(args[args.indexOf('--convert-to') + 1]).toBe('xlsx')
    expect(args[args.indexOf('--outdir') + 1]).toBe(cacheDir)

    conversions.length = 0
    materialize = undefined
    const cached = await recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)
    expect(new TextDecoder().decode(cached)).toBe('recalculated bytes')
    expect(conversions).toEqual([])
  })

  it('keys the recalculated copy by source mtime', async () => {
    producingXlsx('first')
    const first = await recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)
    mtime += 1
    producingXlsx('second')
    const second = await recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)
    expect(new TextDecoder().decode(first)).toBe('first')
    expect(new TextDecoder().decode(second)).toBe('second')
  })

  it('creates the cache directory when it does not exist yet', async () => {
    producingXlsx('recalculated bytes')
    await expect(recalcXlsxBytes('soffice', sourcePath, join(root, 'deep', 'cache'), mtime))
      .resolves.toBeInstanceOf(Uint8Array)
  })

  it('reports failure when LibreOffice exited non-zero', async () => {
    conversionFails = true
    await expect(recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)).resolves.toBeUndefined()
  })

  it('reports failure when LibreOffice exited cleanly but wrote nothing', async () => {
    await expect(recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)).resolves.toBeUndefined()
  })

  it('converts again when the cached copy is empty', async () => {
    producingXlsx('recalculated bytes')
    const cached = await recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)
    expect(cached).toBeInstanceOf(Uint8Array)
    const cacheFile = join(cacheDir, `${createHash('sha1').update(sourcePath).update(String(mtime)).digest('hex').slice(0, 16)}.recalc.xlsx`)
    writeFileSync(cacheFile, '')
    conversions.length = 0
    producingXlsx('recalculated bytes')
    await expect(recalcXlsxBytes('soffice', sourcePath, cacheDir, mtime)).resolves.toBeInstanceOf(Uint8Array)
    expect(conversions).toHaveLength(1)
  })
})
