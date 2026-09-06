/**
 * Preview cache directory resolution: DSH_HOME wins outright, otherwise the
 * platform home keeps the `.dsh` layout (USERPROFILE on Windows), with a
 * relative fallback when no home is visible at all.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/preview-cache-dir
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewCacheDir } from '../src/artifacts-preview.ts'

afterEach(() => { vi.unstubAllEnvs() })

describe('previewCacheDir', () => {
  it('uses DSH_HOME directly when set', () => {
    vi.stubEnv('DSH_HOME', '/custom/home')
    vi.stubEnv('HOME', '/home/user')
    expect(previewCacheDir()).toBe('/custom/home/preview-cache')
  })

  it('keeps the .dsh layout under HOME', () => {
    vi.stubEnv('DSH_HOME', '')
    vi.stubEnv('HOME', '/home/user')
    vi.stubEnv('USERPROFILE', '')
    expect(previewCacheDir()).toBe('/home/user/.dsh/preview-cache')
  })

  it('keeps the .dsh layout under USERPROFILE when HOME is absent', () => {
    vi.stubEnv('DSH_HOME', '')
    vi.stubEnv('HOME', '')
    vi.stubEnv('USERPROFILE', 'C:\\Users\\whale')
    expect(previewCacheDir()).toBe('C:\\Users\\whale/.dsh/preview-cache')
  })

  it('falls back to a relative directory with no home at all', () => {
    vi.stubEnv('DSH_HOME', '')
    vi.stubEnv('HOME', '')
    vi.stubEnv('USERPROFILE', '')
    expect(previewCacheDir()).toBe('./preview-cache')
  })
})
