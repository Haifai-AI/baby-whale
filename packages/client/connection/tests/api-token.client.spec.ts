// @vitest-environment jsdom
/**
 * Instance API token: entry-URL fragment capture into tab storage, hash
 * scrubbing, stored-first resolution, and headerless-transport query
 * attachment. The server fence owns refusal; these helpers never guess.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveApiToken, withApiTokenQuery } from '../src/client/api-token.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  window.location.hash = ''
  vi.restoreAllMocks()
})

describe('resolveApiToken', () => {
  it('returns undefined when the tab holds no token', () => {
    expect(resolveApiToken()).toBeUndefined()
  })

  it('captures the entry-URL fragment into tab storage and scrubs the hash', () => {
    window.location.hash = '#token=abc123'
    expect(resolveApiToken()).toBe('abc123')
    expect(sessionStorage.getItem('dsh.apiToken')).toBe('abc123')
    expect(window.location.hash).toBe('')
    // The stored capture answers later calls without any fragment.
    expect(resolveApiToken()).toBe('abc123')
  })

  it('prefers the stored capture over a newer fragment', () => {
    sessionStorage.setItem('dsh.apiToken', 'stored')
    window.location.hash = '#token=fragment'
    expect(resolveApiToken()).toBe('stored')
  })

  it('finds the token among other fragment parameters', () => {
    window.location.hash = '#view=grid&token=xyz'
    expect(resolveApiToken()).toBe('xyz')
  })

  it('ignores an empty fragment token', () => {
    window.location.hash = '#token='
    expect(resolveApiToken()).toBeUndefined()
  })

  it('still authenticates the page load when storage refuses the capture', () => {
    // jsdom Storage methods ignore instance spies, so the locked-down
    // store is a stubbed global rather than a spy.
    vi.stubGlobal('sessionStorage', {
      getItem: (_key: string): string | null => null,
      setItem: (_key: string, _value: string): void => {
        throw new Error('storage denied')
      },
    })
    window.location.hash = '#token=abc123'
    expect(resolveApiToken()).toBe('abc123')
  })

  it('falls back to the fragment when storage reads fail', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: (_key: string): string | null => {
        throw new Error('storage denied')
      },
      setItem: (_key: string, _value: string): void => {},
    })
    window.location.hash = '#token=fragment'
    expect(resolveApiToken()).toBe('fragment')
  })
})

describe('withApiTokenQuery', () => {
  it('passes the URL through unchanged without a token', () => {
    expect(withApiTokenQuery('/api/artifacts.raw?session=s')).toBe('/api/artifacts.raw?session=s')
  })

  it('appends the token as the first or an additional query parameter', () => {
    window.location.hash = '#token=abc123'
    expect(withApiTokenQuery('/api/artifacts.raw')).toBe('/api/artifacts.raw?token=abc123')
    expect(withApiTokenQuery('/api/artifacts.raw?session=s')).toBe('/api/artifacts.raw?session=s&token=abc123')
  })
})
