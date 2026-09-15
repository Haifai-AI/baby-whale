// @vitest-environment jsdom
/**
 * Rendered MCP servers tab: the transport selector must show the truth for an
 * edited HTTP server (regression: the option value said `http` while the state
 * said `streamable-http`, so HTTP edits displayed the stdio option), HTTP
 * edits expose exactly the HTTP fields, and saves land by canonical
 * comparison rather than key order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { McpStatusSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { McpSettingsTab, canonicalJson } from '../src/client/McpSettingsTab.tsx'
import type { McpServerEntryView, McpSettingsTabProps, McpSettingsView } from '../src/client/McpSettingsTab.tsx'
import { en } from '../src/client/locales.ts'
import type { McpSettingsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const HTTP_SERVER: McpServerEntryView = {
  id: 'srv-http',
  name: 'remote',
  enabled: true,
  transport: 'streamable-http',
  command: '',
  args: [],
  env: {},
  cwd: '',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer x' },
  toolCallTimeoutMs: 60_000,
}

/** Reverse a record's key order, so a fold is visible to raw stringify. */
function reverseKeys(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).reverse())
}

/**
 * Fold one entry the way the Host's schema pass may: reorder top-level keys
 * and the nested env/headers records. Structurally identical, but raw
 * `JSON.stringify` differs — a settlement check that compares raw strings
 * must fail the save, while the canonical comparison must land it.
 */
function foldEntry(entry: McpServerEntryView): McpServerEntryView {
  return {
    toolCallTimeoutMs: entry.toolCallTimeoutMs,
    url: entry.url,
    name: entry.name,
    headers: reverseKeys(entry.headers),
    env: reverseKeys(entry.env),
    cwd: entry.cwd,
    command: entry.command,
    args: [...entry.args],
    transport: entry.transport,
    enabled: entry.enabled,
    id: entry.id,
  }
}

/** In-memory scope double: saves fold straight into the snapshot, like the Host. */
function fakeScope(
  initial: readonly McpServerEntryView[],
  options: { mode?: 'host' | 'memory'; writable?: boolean } = {},
): SettingsScope<McpSettingsView> {
  // The snapshot object is cached: useSyncExternalStore requires getSnapshot
  // to return a stable reference until the next change.
  let snapshot: SettingsScopeSnapshot<McpSettingsView> = {
    status: 'ready',
    value: { servers: [...initial] },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: options.writable ?? true,
    mode: options.mode ?? 'host',
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async set(field, next) {
      if (field === 'servers') {
        snapshot = {
          ...snapshot,
          value: { servers: (next as McpServerEntryView[]).map(foldEntry) },
        }
      }
      for (const listener of [...listeners]) listener()
    },
    async unset() {},
  }
}

function t(key: McpSettingsLocaleKey, params?: Record<string, unknown>): string {
  let text = en[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

function renderTab(
  servers: readonly McpServerEntryView[] = [],
  chooseFolder?: () => Promise<string | null>,
  options: { mode?: 'host' | 'memory'; writable?: boolean } = {},
): { scope: SettingsScope<McpSettingsView> } {
  const scope = fakeScope(servers, options)
  const props = {
    list: vi.fn(async () => ({ servers: [] })),
    restart: vi.fn(async () => ({ servers: [] })),
    scope,
    chooseFolder,
    t,
  } as unknown as McpSettingsTabProps
  render(<McpSettingsTab {...props} />)
  return { scope }
}

async function openEditor(entry: McpServerEntryView): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(entry.name) }))
  fireEvent.click(screen.getByRole('button', { name: en.edit }))
  await act(async () => {})
}

describe('McpSettingsTab transport selector', () => {
  it('shows the streamable-http option as selected when editing an HTTP server', async () => {
    renderTab([HTTP_SERVER])
    await openEditor(HTTP_SERVER)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('streamable-http')
    expect(select.selectedOptions[0]?.textContent).toBe(en.transportHttp)
  })

  it('exposes exactly the HTTP fields for an HTTP server and no stdio fields', async () => {
    renderTab([HTTP_SERVER])
    await openEditor(HTTP_SERVER)
    expect(screen.getByLabelText<HTMLInputElement>(/^URL/).value).toBe(HTTP_SERVER.url)
    expect(screen.getByLabelText(/^Headers/)).toBeDefined()
    expect(screen.queryByLabelText(/^Command/)).toBeNull()
    expect(screen.queryByLabelText(/^Arguments/)).toBeNull()
  })

  it('switches a new server to HTTP and saves the streamable-http transport', async () => {
    const { scope } = renderTab()
    // Add now opens the quick-start catalog; the manual row is the other way in.
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.manual) }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'cloud' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'streamable-http' } })
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: 'https://cloud.example/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    const saved = scope.getSnapshot().value?.servers ?? []
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      name: 'cloud', transport: 'streamable-http', url: 'https://cloud.example/mcp',
    })
    // The save landed (canonical comparison): the editor closed, no failure.
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lands a save whose fold reorders nested env/headers, not just top-level keys', async () => {
    const { scope } = renderTab([HTTP_SERVER])
    await openEditor(HTTP_SERVER)
    fireEvent.change(screen.getByLabelText(/^Headers/), { target: { value: 'X-B=2\nX-A=1' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    const saved = scope.getSnapshot().value?.servers ?? []
    expect(saved[0]?.headers).toEqual({ 'X-B': '2', 'X-A': '1' })
    // Landed despite the fold reversing the nested header keys: the editor
    // closed and no save-failure alert rendered.
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('canonicalJson', () => {
  it('is order-insensitive: structurally equal sections stringify identically', () => {
    const landed = [
      {
        toolCallTimeoutMs: 60_000, url: 'https://x/mcp', name: 'remote', headers: { B: '2', A: '1' },
        env: {}, cwd: '', command: '', args: [], transport: 'streamable-http', enabled: true, id: 'srv-1',
      },
    ]
    const next = [
      {
        id: 'srv-1', name: 'remote', enabled: true, transport: 'streamable-http',
        command: '', args: [], env: {}, cwd: '', url: 'https://x/mcp',
        headers: { A: '1', B: '2' }, toolCallTimeoutMs: 60_000,
      },
    ]
    expect(canonicalJson(landed)).toBe(canonicalJson(next))
    expect(canonicalJson(next)).not.toBe(JSON.stringify(landed))
  })

  it('still distinguishes different values and array order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).not.toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson(['x', 'y'])).not.toBe(canonicalJson(['y', 'x']))
    expect(canonicalJson([{ a: 1 }])).toBe(canonicalJson([{ a: 1 }]))
  })
})

describe('McpSettingsTab tool chips', () => {
  const SERVER_A: McpServerEntryView = {
    id: 'srv-a', name: 'a', enabled: true, transport: 'stdio',
    command: 'a-cmd', args: [], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
  }
  const SERVER_AMB: McpServerEntryView = {
    id: 'srv-amb', name: 'a__b', enabled: true, transport: 'stdio',
    command: 'amb-cmd', args: [], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
  }

  /** A status row carrying the exact names the mount owns, plus display-safe local names. */
  function statusRow(entry: McpServerEntryView, toolNames: readonly string[], localToolNames: readonly string[]): McpStatusSnapshot['servers'][number] {
    return {
      id: entry.id,
      name: entry.name,
      transport: entry.transport,
      target: entry.command,
      enabled: entry.enabled,
      state: 'connected',
      error: null,
      toolNames,
      localToolNames,
    }
  }

  it('renders owner-exact chips from the payload: local names under the true owning server', async () => {
    // Server `a` owns the public name `mcp__a__b_t` (raw `b.t` — normalization
    // replaced the dot) even though server `a__b` is also configured. The
    // payload already carries display-safe local names, so the tab must render
    // them verbatim instead of stripping `mcp__<entry.name>__` off the public
    // name (which would show `b_t` — and, for `mcp__a__b__t`, the wrong server).
    const scope = fakeScope([SERVER_A, SERVER_AMB])
    const props = {
      list: vi.fn(async () => ({
        servers: [
          statusRow(SERVER_A, ['mcp__a__b_t'], ['b.t']),
          statusRow(SERVER_AMB, ['mcp__a__b__echo'], ['echo']),
        ],
      })),
      restart: vi.fn(async () => ({ servers: [] })),
      scope,
      t,
    } as unknown as McpSettingsTabProps
    render(<McpSettingsTab {...props} />)
    await act(async () => {})
    // The tab is an accordion: one card open at a time.
    const toggle = (title: string): void => {
      fireEvent.click(screen.getByText(title, { exact: true }).closest('button')!)
    }

    toggle('a')
    await act(async () => {})
    // Server `a`'s chip is the display-safe LOCAL name from the payload — not
    // the prefix-stripped public name (`b_t`), which normalization produced.
    expect(screen.getByText('b.t')).toBeDefined()
    expect(screen.queryByText('b_t')).toBeNull()
    expect(screen.queryByText('echo')).toBeNull()

    toggle('a')
    toggle('a__b')
    await act(async () => {})
    expect(screen.getByText('echo')).toBeDefined()
    expect(screen.queryByText('b.t')).toBeNull()
  })
})

describe('McpSettingsTab quick start', () => {
  /** Preset labels carry punctuation ("Everything (test)"), so match literally. */
  function exact(label: string): RegExp {
    return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  }

  /** Open the catalog from the header and pick one preset row. */
  function choosePreset(label: string): void {
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: exact(label) }))
  }

  it('opens a catalog rather than a blank form, and lists every preset', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    // Every catalog entry is offered by its plain-language name, so the user
    // never has to know the npm package behind it.
    expect(screen.getByRole('button', { name: exact(en.presetFilesystem) })).toBeDefined()
    expect(screen.getByRole('button', { name: exact(en.presetMemory) })).toBeDefined()
    expect(screen.getByRole('button', { name: exact(en.presetThinking) })).toBeDefined()
    expect(screen.getByRole('button', { name: exact(en.presetEverything) })).toBeDefined()
    expect(screen.getByRole('button', { name: exact(en.manual) })).toBeDefined()
  })

  it('pre-fills a chosen preset so the command never has to be typed', async () => {
    renderTab()
    choosePreset(en.presetMemory)
    await act(async () => {})
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('memory')
    // The command is decided by the preset and kept out of the way: the
    // argument list lives behind Advanced, not in front of the reader.
    expect(screen.queryByLabelText(/^Arguments/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: exact(en.advanced) }))
    await act(async () => {})
    expect(screen.getByLabelText<HTMLTextAreaElement>(/^Arguments/).value)
      .toContain('@modelcontextprotocol/server-memory')
  })

  it('asks for the one value a path preset cannot know, and lands it in args', async () => {
    const { scope } = renderTab([], async () => '/Users/someone/Documents')
    choosePreset(en.presetFilesystem)
    await act(async () => {})
    // The folder has its own field and a native chooser, so the path is never
    // a hand-written argument.
    expect(screen.getByLabelText(new RegExp(en.folder))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.chooseFolder }))
    await act(async () => {})
    expect(screen.getByLabelText<HTMLInputElement>(new RegExp(en.folder)).value)
      .toBe('/Users/someone/Documents')

    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    const saved = scope.getSnapshot().value?.servers ?? []
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/someone/Documents'],
    })
  })

  it('names the missing folder instead of leaving a dead Save button', async () => {
    renderTab()
    choosePreset(en.presetFilesystem)
    await act(async () => {})
    // Save stays enabled; pressing it states the problem.
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe(en.folderRequired)
    // Nothing was written.
    expect(screen.queryByRole('button', { name: en.save })).not.toBeNull()
  })

  it('explains a bad name by naming the rule, and blocks the write', async () => {
    const { scope } = renderTab()
    choosePreset(en.presetMemory)
    await act(async () => {})
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'has spaces' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe(en.nameInvalid)
    expect(scope.getSnapshot().value?.servers ?? []).toHaveLength(0)
  })

  it('suffixes a second preset server rather than colliding on the namespace', async () => {
    const { scope } = renderTab()
    choosePreset(en.presetMemory)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    expect(scope.getSnapshot().value?.servers[0]?.name).toBe('memory')

    // Adding the same preset again must not claim mcp__memory__* twice.
    choosePreset(en.presetMemory)
    await act(async () => {})
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('memory-2')
  })

  it('abandons the preset when the transport leaves stdio', async () => {
    // A preset is a local command line. Switching to HTTP must not leave a
    // folder substituted into a server that will never be spawned, and must
    // not keep claiming to be that preset.
    const { scope } = renderTab()
    choosePreset(en.presetFilesystem)
    await act(async () => {})
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'streamable-http' } })
    await act(async () => {})
    // The folder field and the Preset tag are gone; a URL is asked for instead.
    expect(screen.queryByLabelText(new RegExp(en.folder))).toBeNull()
    expect(screen.queryByText(en.presetTag)).toBeNull()

    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: 'https://cloud.example/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    const saved = scope.getSnapshot().value?.servers ?? []
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ transport: 'streamable-http', url: 'https://cloud.example/mcp' })
    // No leftover npm package arguments on an HTTP entry.
    expect(saved[0]?.args ?? []).toEqual([])
    expect(saved[0]?.command).toBe('')
  })

  it('keeps a preset-backed server on its folder field when reopened', async () => {
    const saved: McpServerEntryView = {
      id: 'srv-fs', name: 'filesystem', enabled: true, transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/someone/Documents'],
      env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
    }
    renderTab([saved])
    fireEvent.click(screen.getByRole('button', { name: /filesystem/ }))
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    await act(async () => {})
    // Recognised as the preset it came from, so the reader still edits a
    // Folder rather than a raw argument list.
    expect(screen.getByLabelText(new RegExp(en.folder))).toBeDefined()
    expect(screen.queryByLabelText(/^Arguments/)).toBeNull()
  })

  it('drops back to the general form once a preset server is hand-edited', async () => {
    const edited: McpServerEntryView = {
      id: 'srv-fs', name: 'filesystem', enabled: true, transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/one', '--extra'],
      env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
    }
    renderTab([edited])
    fireEvent.click(screen.getByRole('button', { name: /filesystem/ }))
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    await act(async () => {})
    // The command line no longer matches the preset, so the honest reading is
    // a general server: Advanced is open and the raw args are exposed.
    expect(screen.queryByLabelText(new RegExp(en.folder))).toBeNull()
    expect(screen.getByLabelText<HTMLTextAreaElement>(/^Arguments/).value).toContain('--extra')
  })
})

describe('McpSettingsTab field handling', () => {
  it('skips a malformed KEY=VALUE line instead of inventing a key', async () => {
    const { scope } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.manual) }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'echo' } })
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'npx' } })
    // The manual path opens Advanced on its own; the env field is already shown.
    // A line with no `=` names nothing; a leading `=` names an empty key. Both
    // are dropped rather than becoming a variable called "".
    fireEvent.change(screen.getByLabelText(/^Environment/), { target: { value: 'GOOD=1\nno-equals-here\n=blank\nALSO=2' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    const saved = scope.getSnapshot().value?.servers ?? []
    expect(saved[0]?.env).toEqual({ GOOD: '1', ALSO: '2' })
  })

  it('treats a missing timeout as the default rather than zero', async () => {
    const { scope } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.manual) }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'echo' } })
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'npx' } })
    // Cleared field: an empty string parses to NaN, which must not become a
    // zero-millisecond deadline that kills every call instantly.
    fireEvent.change(screen.getByLabelText(/^Tool timeout/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    expect(scope.getSnapshot().value?.servers[0]?.toolCallTimeoutMs).toBe(60_000)
  })

  it('drops the preset reading when only the command differs', async () => {
    const handRolled: McpServerEntryView = {
      id: 'srv-x', name: 'filesystem', enabled: true, transport: 'stdio',
      // Same argument shape as the preset, different executable.
      command: 'bunx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/somewhere'],
      env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
    }
    renderTab([handRolled])
    fireEvent.click(screen.getByRole('button', { name: /filesystem/ }))
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    await act(async () => {})
    // Args match but the command does not, so this is not that preset.
    expect(screen.queryByLabelText(new RegExp(en.folder))).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>(/^Command/).value).toBe('bunx')
  })

  it('offers no write controls when the scope is not the Host document', async () => {
    // A profile-scoped tree is read-only here: showing Add or Edit would offer
    // actions the write path cannot honour.
    renderTab([], undefined, { mode: 'memory' })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: en.add })).toBeNull()
    expect(screen.queryByRole('button', { name: en.importJson })).toBeNull()
  })
})
