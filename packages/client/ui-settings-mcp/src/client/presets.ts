/**
 * The MCP quick-start catalog.
 *
 * A blank "command + arguments" form asks the user to already know an npm
 * package name and how to invoke it through `npx`, which is a developer's
 * model of the task. Someone who wants their Documents folder readable by the
 * model is thinking "filesystem", not `-y @modelcontextprotocol/server-filesystem
 * /Users/…`. These entries are that thought, pre-decomposed.
 *
 * Every entry below was launched and answered `tools/list` before being
 * listed here; a catalog that ships a dead package is worse than no catalog.
 * Tool counts in the descriptions come from those live handshakes.
 *
 * `{path}` in an entry's args is the one value a preset cannot supply: the
 * folder the user means. The editor substitutes it from a native directory
 * picker rather than asking for a raw argument.
 *
 * @module ui-settings-mcp/presets
 */

import type { McpSettingsLocaleKey } from './locales.ts'

/** Leading glyph slot, resolved to an icon by the view. */
export type McpPresetGlyph = 'folder' | 'memory' | 'steps' | 'sparkle'

/** One ready-to-add MCP server. */
export interface McpPreset {
  /** Stable key for React and for tests. */
  readonly id: string
  /** Model-facing namespace base, and the name a new entry starts with. */
  readonly name: string
  /** Locale key for the one-line description of what this server does. */
  readonly blurb: McpSettingsLocaleKey
  /** Which leading glyph the row draws. */
  readonly glyph: McpPresetGlyph
  /** Executable to spawn. */
  readonly command: string
  /**
   * Arguments after the executable. A `{path}` token is replaced by the folder
   * the user picks; see {@link presetNeedsPath}.
   */
  readonly args: readonly string[]
}

/** The token a path-taking preset leaves for the user to fill. */
export const PRESET_PATH_TOKEN = '{path}'

/** Every preset offered in the quick-start list, in display order. */
export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    blurb: 'presetFilesystemBlurb',
    glyph: 'folder',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', PRESET_PATH_TOKEN],
  },
  {
    id: 'memory',
    name: 'memory',
    blurb: 'presetMemoryBlurb',
    glyph: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'sequential-thinking',
    name: 'sequential-thinking',
    blurb: 'presetThinkingBlurb',
    glyph: 'steps',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    id: 'everything',
    name: 'everything',
    blurb: 'presetEverythingBlurb',
    glyph: 'sparkle',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  },
]

/** Look one preset up by id. */
export function presetById(id: string): McpPreset | undefined {
  return MCP_PRESETS.find(candidate => candidate.id === id)
}

/**
 * Whether this preset takes a folder from the user.
 * @param preset - the preset to test.
 * @returns true when its args still hold {@link PRESET_PATH_TOKEN}.
 */
export function presetNeedsPath(preset: McpPreset): boolean {
  return preset.args.includes(PRESET_PATH_TOKEN)
}

/**
 * The preset's arguments with its folder substituted.
 * @param preset - the preset to expand.
 * @param path - the chosen folder; ignored by presets that take none.
 * @returns the argument list a command line would carry.
 */
export function presetArgs(preset: McpPreset, path: string): string[] {
  return preset.args.map(arg => arg === PRESET_PATH_TOKEN ? path : arg)
}

/**
 * A legal, unique namespace for a new entry, derived from a preset's name.
 *
 * The model-facing name must match `[A-Za-z0-9_-]{1,32}` and be unique across
 * enabled servers, so a second Filesystem server becomes `filesystem-2` rather
 * than silently colliding with the first.
 * @param base - the desired name.
 * @param taken - names already configured.
 * @returns the first free variant of `base`.
 */
export function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.includes(candidate)) return candidate
  }
  // 999 collisions on one name is not a real session; the fallback still has to
  // be a legal namespace, so it stays inside the alphabet and length bound.
  return `${base}-${Date.now().toString(36)}`.slice(0, 32)
}
