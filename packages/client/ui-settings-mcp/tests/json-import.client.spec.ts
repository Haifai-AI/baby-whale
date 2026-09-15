import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseImport } from '../src/client/json-import.ts'

const empty = new Set<string>()

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('parseImport', () => {
  it('imports a claude_desktop_config-style mcpServers block', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', 'server-github'], env: { TOKEN: 't' } },
      },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries).toHaveLength(1)
    const entry = parsed.entries[0]!
    expect(entry).toMatchObject({
      name: 'github', transport: 'stdio', command: 'npx',
      args: ['-y', 'server-github'], env: { TOKEN: 't' }, enabled: true,
    })
    expect(entry.id).toBeTruthy()
  })

  it('imports a bare server map with an http entry', () => {
    const parsed = parseImport(JSON.stringify({
      remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries[0]).toMatchObject({
      name: 'remote', transport: 'streamable-http',
      url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' },
    })
  })

  it('respects disabled flags and skips entries without a launch target', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        off: { command: 'npx', disabled: true },
        junk: { note: 'no command or url' },
      },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({ name: 'off', enabled: false })
  })

  it('legalizes model-hostile names and suffixes collisions', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        'my tools!': { command: 'a' },
        fs: { command: 'b' },
      },
    }), new Set(['fs', 'server-1', 'server-2']))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries.map(entry => entry.name).sort()).toEqual(['fs-2', 'my-tools-'])
  })

  it('accepts string args as a whitespace split', () => {
    const parsed = parseImport(JSON.stringify({ mcpServers: { a: { command: 'x', args: '-y pkg' } } }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries[0]!.args).toEqual(['-y', 'pkg'])
  })

  it('reports the parse failure reason', () => {
    const parsed = parseImport('{ nope', empty)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason.length).toBeGreaterThan(0)
  })

  it('rejects non-object JSON', () => {
    expect(parseImport('[1,2]', empty).ok).toBe(false)
    expect(parseImport('42', empty).ok).toBe(false)
  })

  it('still mints an id when the page has no secure-context UUID', () => {
    // `crypto.randomUUID` exists only in a secure context; a page served over
    // plain http must still stamp every imported server with a distinct id.
    vi.stubGlobal('crypto', {})
    const parsed = parseImport(JSON.stringify({ mcpServers: { a: { command: 'x' } } }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries[0]!.id).toMatch(/^srv-[0-9a-z]+-[0-9a-z]+$/)
  })

  it('skips a key whose value is not a server object', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        note: 'just a string',
        list: ['nope'],
        blank: null,
        real: { command: 'x' },
      },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries.map(entry => entry.name)).toEqual(['real'])
  })

  it('falls back to a positional name when nothing legal survives legalization', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        '!!!': { command: 'a' },
        '99 bottles': { command: 'b' },
      },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // `!!!` legalizes to nothing at all, and a name may not start with a digit
    // once its leading punctuation is stripped: both take the positional name.
    expect(parsed.entries.map(entry => entry.name)).toEqual(['server-1', '99-bottles'])
  })

  it('walks past every taken suffix variant of a colliding name', () => {
    // `fs` collides, so it takes `fs-2` — which is also taken, so the search
    // continues to `fs-3`. The second entry already ends in a number, so its
    // stem is reused rather than grown a second suffix.
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        fs: { command: 'a' },
        'fs-2': { command: 'b' },
      },
    }), new Set(['fs', 'fs-2']))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries.map(entry => entry.name)).toEqual(['fs-3', 'fs-4'])
  })

  it('keeps only the string-valued environment and header fields', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        remote: {
          url: 'https://example.com/mcp',
          env: { TOKEN: 'kept', COUNT: 3, NESTED: { a: 1 } },
          headers: { Authorization: 'Bearer x', RETRIES: 2 },
        },
      },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries[0]).toMatchObject({
      env: { TOKEN: 'kept' },
      headers: { Authorization: 'Bearer x' },
    })
  })

  it('drops an environment or header block that is not a record', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: {
        a: { command: 'x', env: 'TOKEN=1', headers: ['Authorization: x'] },
      },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries[0]).toMatchObject({ env: {}, headers: {} })
  })

  it('carries a working directory when the pasted config sets one', () => {
    const parsed = parseImport(JSON.stringify({
      mcpServers: { local: { command: 'npx', cwd: '/Users/someone/project' } },
    }), empty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries[0]!.cwd).toBe('/Users/someone/project')
  })

  it('reports a throw that is not an Error verbatim', () => {
    // Only a host that replaced JSON.parse (a polyfill, a patched global) can
    // throw something else; the reason must still reach the import dialog.
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw 'plain string failure' })
    const parsed = parseImport('{}', empty)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toBe('plain string failure')
  })
})
