import { describe, expect, it } from 'vitest'
import { parseImport } from '../src/client/json-import.ts'

const empty = new Set<string>()

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
    const entry = parsed.entries[0]
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
    expect(parsed.entries[0].args).toEqual(['-y', 'pkg'])
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
})
