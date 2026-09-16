/**
 * Office runtime boot: only a finished venv install is advertised, on POSIX
 * (`bin/python` behind the marker) and on Windows (`Scripts\\python.exe`
 * behind the same marker). Marker-absent paths spawn background installers
 * and are not covered here.
 * @module @deepseek-ai/dsh/tests/office-runtime
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  OFFICE_LIBS_MARKER,
  posixOfficeInstallScript,
  prepareOfficeRuntime,
  windowsOfficeInstallScript,
} from '../src/profile-boot.ts'
import { OFFICE_REQUIREMENTS_LOCK } from '../src/office-requirements-lock.ts'

/** Every background install the boot spawned, captured instead of run. */
const spawnCalls = vi.hoisted(() => [] as { command: string; args: string[] }[])

// The marker-absent paths start a real PowerShell/bash venv build otherwise:
// capture the spawn so the handoff is asserted without touching a network.
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args })
    return { unref: () => {} }
  },
}))

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'dsh-office-runtime-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

const realPlatform = process.platform

/** Run one boot with a mocked platform and venv dir, restoring both after. */
function bootAs(platform: string, venvDir: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  vi.stubEnv('DSH_OFFICE_VENV_DIR', venvDir)
  vi.stubEnv('DSH_OFFICE_PYTHON', '')
  delete process.env.DSH_OFFICE_PYTHON
  prepareOfficeRuntime()
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  spawnCalls.length = 0
  vi.unstubAllEnvs()
})

describe('prepareOfficeRuntime', () => {
  it('advertises a finished POSIX venv', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'posix-'))
    mkdirSync(join(venvDir, 'bin'), { recursive: true })
    writeFileSync(join(venvDir, 'bin', 'python'), '')
    writeFileSync(join(venvDir, OFFICE_LIBS_MARKER), '')
    bootAs('darwin', venvDir)
    expect(process.env.DSH_OFFICE_PYTHON).toBe(join(venvDir, 'bin', 'python'))
  })

  it('advertises a finished Windows venv', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'win-'))
    mkdirSync(join(venvDir, 'Scripts'), { recursive: true })
    writeFileSync(join(venvDir, 'Scripts', 'python.exe'), '')
    writeFileSync(join(venvDir, OFFICE_LIBS_MARKER), '')
    bootAs('win32', venvDir)
    expect(process.env.DSH_OFFICE_PYTHON).toBe(join(venvDir, 'Scripts', 'python.exe'))
  })

  it('never overrides an explicitly configured interpreter', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'explicit-'))
    mkdirSync(join(venvDir, 'Scripts'), { recursive: true })
    writeFileSync(join(venvDir, 'Scripts', 'python.exe'), '')
    writeFileSync(join(venvDir, OFFICE_LIBS_MARKER), '')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.stubEnv('DSH_OFFICE_VENV_DIR', venvDir)
    vi.stubEnv('DSH_OFFICE_PYTHON', 'C:\\tools\\python.exe')
    prepareOfficeRuntime()
    expect(process.env.DSH_OFFICE_PYTHON).toBe('C:\\tools\\python.exe')
  })

  // Marker-absent paths spawn background installers (bash / PowerShell);
  // `spawn` is mocked above so the handoff is asserted without building a venv.
})

describe('office background install', () => {
  it('hands the pinned lock to the POSIX install through a file', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'posix-spawn-'))
    bootAs('darwin', venvDir)
    expect(readFileSync(join(venvDir, 'office-requirements.lock'), 'utf8')).toBe(OFFICE_REQUIREMENTS_LOCK)
    const call = spawnCalls[0]
    expect(call?.command).toBe('/bin/bash')
    expect(call?.args[0]).toBe('-c')
    expect(call?.args[1]).toContain('--require-hashes')
    expect(call?.args[1]).not.toContain(OFFICE_REQUIREMENTS_LOCK.slice(0, 64))
  })

  it('hands the pinned lock to the Windows install without overrunning the command line', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'win-spawn-'))
    bootAs('win32', venvDir)
    expect(readFileSync(join(venvDir, 'office-requirements.lock'), 'utf8')).toBe(OFFICE_REQUIREMENTS_LOCK)
    const call = spawnCalls[0]
    expect(call?.command).toBe('powershell.exe')
    // Windows caps one process command line at 32,767 characters: inlining the
    // 63 KB lock here made every boot die on `spawn ENAMETOOLONG`.
    expect([call?.command, ...(call?.args ?? [])].join(' ').length).toBeLessThan(4_000)
  })
})

/** Direct dependencies the office venv exists to provide. */
const DIRECT_PACKAGES = [
  'openpyxl',
  'python-pptx',
  'python-docx',
  'reportlab',
  'pypdf',
  'pdfplumber',
  'pandas',
  'pymupdf',
]

/** The `name==version` stanzas of the lock with their hash lines. */
function lockStanzas(): { name: string; hashes: string[] }[] {
  const stanzas: { name: string; hashes: string[] }[] = []
  for (const line of OFFICE_REQUIREMENTS_LOCK.split('\n')) {
    const pin = /^([A-Za-z0-9_.-]+)==[^ ]+/.exec(line)
    if (pin?.[1] !== undefined) {
      stanzas.push({ name: pin[1].toLowerCase(), hashes: [] })
    } else if (line.startsWith('    --hash=sha256:')) {
      stanzas[stanzas.length - 1]?.hashes.push(line.trim())
    }
  }
  return stanzas
}

describe('office requirements lock', () => {
  it('pins every direct dependency with per-file hashes', () => {
    const stanzas = lockStanzas()
    expect(stanzas.length).toBeGreaterThan(DIRECT_PACKAGES.length) // transitive closure included
    for (const name of DIRECT_PACKAGES) {
      const stanza = stanzas.find(entry => entry.name === name)
      expect(stanza, `missing lock stanza for ${name}`).toBeDefined()
      expect(stanza?.hashes.length).toBeGreaterThan(0)
    }
    for (const stanza of stanzas) {
      expect(stanza.hashes.length, `unhashed stanza ${stanza.name}`).toBeGreaterThan(0)
    }
  })

  it('never pins the installer itself (no pip/setuptools/wheel self-upgrade vector)', () => {
    const names = lockStanzas().map(stanza => stanza.name)
    expect(names).not.toContain('pip')
    expect(names).not.toContain('setuptools')
    expect(names).not.toContain('wheel')
  })
})

describe('office install scripts', () => {
  const scripts = {
    posix: posixOfficeInstallScript('/venv/bin/python', '/venv').join('\n'),
    windows: windowsOfficeInstallScript('C:\\venv\\Scripts\\python.exe', 'C:\\venv').join('\n'),
  }

  it.each(['posix', 'windows'] as const)('%s enforces the lock with hashes', (dialect) => {
    expect(scripts[dialect]).toContain('--require-hashes')
  })

  it.each(['posix', 'windows'] as const)('%s never self-upgrades the installer', (dialect) => {
    expect(scripts[dialect]).not.toMatch(/pip install[^\n]*--upgrade pip/)
  })

  it.each(['posix', 'windows'] as const)('%s installs nothing outside the lock', (dialect) => {
    // A floating package list would name libraries in the pip invocation;
    // the only pip install takes the lock file.
    for (const name of DIRECT_PACKAGES) {
      expect(scripts[dialect]).not.toContain(` ${name}`)
    }
    expect(scripts[dialect]).toContain(OFFICE_LIBS_MARKER)
  })

  it.each(['posix', 'windows'] as const)('%s keeps the lock out of the command line', (dialect) => {
    expect(scripts[dialect]).not.toContain(OFFICE_REQUIREMENTS_LOCK.slice(0, 64))
    expect(scripts[dialect].length).toBeLessThan(2_000)
    expect(scripts[dialect]).toContain('office-requirements.lock')
  })
})
