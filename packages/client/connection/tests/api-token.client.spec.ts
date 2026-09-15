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

  it('returns undefined on a fixture page that has storage but no location', () => {
    // The built-lib fixture page defines `globalThis.location` alone, and Node
    // itself defines `sessionStorage` while never defining `location`: reading
    // a hardcoded `window.location` here threw out of the RPC call path.
    vi.stubGlobal('sessionStorage', { getItem: (): string | null => null, setItem: (): void => {} })
    vi.stubGlobal('location', undefined)
    expect(resolveApiToken()).toBeUndefined()
  })

  it('scrubs the fragment on a page whose location omits path and search', () => {
    // A fixture page can supply only the fragment it needs. The scrub must
    // then fall back to an empty suffix rather than reading absent fields.
    const replaceState = vi.fn()
    vi.stubGlobal('location', { hash: '#token=abc123' })
    vi.stubGlobal('history', { replaceState })
    expect(resolveApiToken()).toBe('abc123')
    expect(replaceState).toHaveBeenCalledWith(null, '', '')
  })

  it('keeps the fragment on a page that has no history object', () => {
    vi.stubGlobal('location', { hash: '#token=abc123', pathname: '/', search: '' })
    vi.stubGlobal('history', undefined)
    expect(resolveApiToken()).toBe('abc123')
  })

  it('reads the fragment on a page with no storage object at all', () => {
    vi.stubGlobal('location', { hash: '#token=abc123', pathname: '/', search: '' })
    vi.stubGlobal('sessionStorage', undefined)
    expect(resolveApiToken()).toBe('abc123')
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
