/**
 * Office runtime boot: only a finished venv install is advertised, on POSIX
 * (`bin/python` behind the marker) and on Windows (`Scripts\\python.exe`
 * behind the same marker). Marker-absent paths spawn background installers
 * and are not covered here.
 * @module @deepseek-ai/dsh/tests/office-runtime
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { prepareOfficeRuntime } from '../src/profile-boot.ts'

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
  vi.unstubAllEnvs()
})

describe('prepareOfficeRuntime', () => {
  it('advertises a finished POSIX venv', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'posix-'))
    mkdirSync(join(venvDir, 'bin'), { recursive: true })
    writeFileSync(join(venvDir, 'bin', 'python'), '')
    writeFileSync(join(venvDir, '.libs-ok-2'), '')
    bootAs('darwin', venvDir)
    expect(process.env.DSH_OFFICE_PYTHON).toBe(join(venvDir, 'bin', 'python'))
  })

  it('advertises a finished Windows venv', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'win-'))
    mkdirSync(join(venvDir, 'Scripts'), { recursive: true })
    writeFileSync(join(venvDir, 'Scripts', 'python.exe'), '')
    writeFileSync(join(venvDir, '.libs-ok-2'), '')
    bootAs('win32', venvDir)
    expect(process.env.DSH_OFFICE_PYTHON).toBe(join(venvDir, 'Scripts', 'python.exe'))
  })

  it('never overrides an explicitly configured interpreter', () => {
    const venvDir = mkdtempSync(join(ROOT_BASE, 'explicit-'))
    mkdirSync(join(venvDir, 'Scripts'), { recursive: true })
    writeFileSync(join(venvDir, 'Scripts', 'python.exe'), '')
    writeFileSync(join(venvDir, '.libs-ok-2'), '')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.stubEnv('DSH_OFFICE_VENV_DIR', venvDir)
    vi.stubEnv('DSH_OFFICE_PYTHON', 'C:\\tools\\python.exe')
    prepareOfficeRuntime()
    expect(process.env.DSH_OFFICE_PYTHON).toBe('C:\\tools\\python.exe')
  })

  // Marker-absent paths spawn background installers (bash / PowerShell) and
  // are deliberately not covered here: asserting nothing would either build
  // a real venv or crash on the missing shell.
})
