// @vitest-environment jsdom
/**
 * The quick-start catalog's data contract.
 *
 * A preset is only worth offering if it names a package that exists and maps
 * onto a legal server entry, so these pin the shape the editor depends on:
 * one path-taking preset exactly, legal namespaces, unique naming, and args
 * that expand to a command line rather than to a leftover token.
 */
import { describe, expect, it } from 'vitest'
import {
  MCP_PRESETS, PRESET_PATH_TOKEN, presetArgs, presetById, presetNeedsPath, uniqueName,
} from '../src/client/presets.ts'
import { en } from '../src/client/locales.ts'

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

describe('MCP preset catalog', () => {
  it('offers more than one option and unique ids', () => {
    expect(MCP_PRESETS.length).toBeGreaterThan(1)
    expect(new Set(MCP_PRESETS.map(preset => preset.id)).size).toBe(MCP_PRESETS.length)
  })

  it('names every preset legally, so a pre-filled draft is always savable', () => {
    for (const preset of MCP_PRESETS) {
      expect(preset.name, preset.id).toMatch(NAME_PATTERN)
      expect(preset.command, preset.id).not.toBe('')
    }
  })

  it('describes every preset in both dictionaries', () => {
    // A missing key renders the raw key at the user, which is worse than an
    // untranslated string; both dictionaries are checked by the locale type,
    // and this catches a blurb pointing at a key that exists but is empty.
    for (const preset of MCP_PRESETS) {
      expect(en[preset.blurb], preset.id).toBeTruthy()
    }
  })

  it('leaves exactly one slot for the user to fill, and only on filesystem', () => {
    const pathPresets = MCP_PRESETS.filter(presetNeedsPath)
    expect(pathPresets.map(preset => preset.id)).toEqual(['filesystem'])
    // The token appears once, at the position the folder occupies.
    expect(presetById('filesystem')?.args).toContain(PRESET_PATH_TOKEN)
    expect(presetArgs(presetById('filesystem')!, '/tmp/docs')).toEqual([
      '-y', '@modelcontextprotocol/server-filesystem', '/tmp/docs',
    ])
  })

  it('expands a path-free preset to the same args whatever folder is passed', () => {
    const memory = presetById('memory')!
    expect(presetNeedsPath(memory)).toBe(false)
    expect(presetArgs(memory, '/ignored')).toEqual(presetArgs(memory, ''))
    expect(presetArgs(memory, 'x')).not.toContain(PRESET_PATH_TOKEN)
  })

  it('returns undefined for an id that is not in the catalog', () => {
    expect(presetById('nope')).toBeUndefined()
  })
})

describe('uniqueName', () => {
  it('keeps the base name when nothing holds it', () => {
    expect(uniqueName('filesystem', [])).toBe('filesystem')
    expect(uniqueName('filesystem', ['memory'])).toBe('filesystem')
  })

  it('suffixes past a collision instead of silently sharing a namespace', () => {
    // Two Filesystem servers must not both claim `mcp__filesystem__*`.
    expect(uniqueName('filesystem', ['filesystem'])).toBe('filesystem-2')
    expect(uniqueName('filesystem', ['filesystem', 'filesystem-2'])).toBe('filesystem-3')
  })

  it('always returns a name the server will accept', () => {
    const taken = ['filesystem', ...Array.from({ length: 20 }, (_, index) => `filesystem-${String(index + 2)}`)]
    expect(uniqueName('filesystem', taken)).toMatch(NAME_PATTERN)
  })

  it('stays legal even when the whole suffix range is exhausted', () => {
    // 999 same-named servers is not a real session, but the fallback is the one
    // path that could hand the server an illegal namespace, so it is exercised
    // rather than trusted: the result must still satisfy the wire pattern.
    const taken = ['filesystem', ...Array.from({ length: 998 }, (_, index) => `filesystem-${String(index + 2)}`)]
    expect(taken).toHaveLength(999)
    expect(uniqueName('filesystem', taken)).toMatch(NAME_PATTERN)
  })
})
