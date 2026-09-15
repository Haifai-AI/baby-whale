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
import type { RenderResult } from '@testing-library/react'
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
  options: {
    mode?: 'host' | 'memory'
    writable?: boolean
    /** Start before the first Host answer: loading status, no section yet. */
    loading?: boolean
    /** A deployment that does not serve the `mcp` namespace at all. */
    unavailable?: boolean
    /** Reject the write, as a failed Host write does. */
    failWrite?: boolean
    /** Accept the write without folding it, as a superseded document does. */
    dropWrite?: boolean
  } = {},
): SettingsScope<McpSettingsView> & { setSpy: ReturnType<typeof vi.fn> } {
  const empty = options.loading === true || options.unavailable === true
  // The snapshot object is cached: useSyncExternalStore requires getSnapshot
  // to return a stable reference until the next change.
  let snapshot: SettingsScopeSnapshot<McpSettingsView> = {
    status: options.unavailable === true ? 'unavailable' : options.loading === true ? 'loading' : 'ready',
    value: empty ? undefined : { servers: [...initial] },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: options.writable ?? true,
    mode: options.mode ?? 'host',
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: string, next: unknown) => {
    if (options.failWrite === true) throw new Error('the Host refused the write')
    if (field === 'servers' && options.dropWrite !== true) {
      snapshot = {
        ...snapshot,
        value: { servers: (next as McpServerEntryView[]).map(foldEntry) },
      }
    }
    for (const listener of [...listeners]) listener()
  })
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    async unset() {},
    setSpy: set,
  }
}

/**
 * One Host status row for an expanded card.
 * @param entry - the saved entry the row describes.
 * @param rest - state, error, and tool-name overrides.
 */
function statusRow(
  entry: McpServerEntryView,
  rest: Partial<McpStatusSnapshot['servers'][number]> = {},
): McpStatusSnapshot['servers'][number] {
  return {
    id: entry.id,
    name: entry.name,
    transport: entry.transport,
    target: entry.transport === 'stdio' ? [entry.command, ...entry.args].join(' ') : entry.url,
    enabled: entry.enabled,
    state: 'connected',
    error: null,
    toolNames: [],
    localToolNames: [],
    ...rest,
  }
}

/** A status read whose settlement the test owns. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
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
  options: Parameters<typeof fakeScope>[1] & {
    /** Status read override, for reads the test holds open or fails. */
    list?: () => Promise<McpStatusSnapshot>
    /** Restart override, for remounts the test holds open or fails. */
    restart?: (id: string) => Promise<McpStatusSnapshot>
  } = {},
): { scope: ReturnType<typeof fakeScope>; view: RenderResult; list: ReturnType<typeof vi.fn>; restart: ReturnType<typeof vi.fn> } {
  const scope = fakeScope(servers, options)
  const list = vi.fn(options.list ?? (async () => ({ servers: [] })))
  const restart = vi.fn(options.restart ?? (async () => ({ servers: [] })))
  const props = { list, restart, scope, chooseFolder, t } as unknown as McpSettingsTabProps
  const view = render(<McpSettingsTab {...props} />)
  return { scope, view, list, restart }
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
  function ownRow(entry: McpServerEntryView, toolNames: readonly string[], localToolNames: readonly string[]) {
    return statusRow(entry, { toolNames, localToolNames })
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
          ownRow(SERVER_A, ['mcp__a__b_t'], ['b.t']),
          ownRow(SERVER_AMB, ['mcp__a__b__echo'], ['echo']),
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

describe('McpSettingsTab states', () => {
  const SERVER: McpServerEntryView = {
    id: 'srv-1', name: 'local', enabled: true, transport: 'stdio',
    command: 'npx', args: ['-y', 'pkg'], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
  }

  /** Open one card's accordion by its title. */
  function toggleCard(title: string): void {
    fireEvent.click(screen.getByText(title, { exact: true }).closest('button')!)
  }

  it('shows the loading line until the settings document answers', async () => {
    renderTab([], undefined, { loading: true })
    await act(async () => {})

    expect(screen.getByText(en.loading)).toBeTruthy()
    // Nothing is known yet, so the empty catalog is not asserted either.
    expect(screen.queryByText(en.empty)).toBeNull()
    expect(screen.getByRole('button', { name: en.add })).toBeTruthy()
  })

  it('says the tab is unavailable when the namespace is not served', async () => {
    renderTab([], undefined, { unavailable: true })
    await act(async () => {})

    expect(screen.getByText(en.error)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.add })).toBeNull()
  })

  it('reports a status read that failed and re-reads it on retry', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('bridge offline'))
      .mockResolvedValue({ servers: [] })
    renderTab([], undefined, { list })
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toBe(en.error)

    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await act(async () => {})

    expect(screen.queryByRole('alert')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('drops a status read that lands after the tab is gone', async () => {
    const pending = deferred<McpStatusSnapshot>()
    const { view } = renderTab([], undefined, { list: () => pending.promise })
    view.unmount()

    pending.resolve({ servers: [] })
    await act(async () => {})

    expect(view.container.textContent).toBe('')
  })

  it('drops a status failure that lands after the tab is gone', async () => {
    const pending = deferred<McpStatusSnapshot>()
    const { view } = renderTab([], undefined, { list: () => pending.promise })
    view.unmount()

    pending.reject(new Error('bridge offline'))
    await act(async () => {})

    expect(view.container.textContent).toBe('')
  })

  it('states a server is disabled without claiming a live status', async () => {
    const off: McpServerEntryView = { ...SERVER, enabled: false }
    const { restart } = renderTab([off])
    await act(async () => {})
    toggleCard('local')

    // A disabled server is never spawned, so its dot and Restart are absent
    // and the card says disabled rather than "connecting" forever.
    expect(screen.getByText(en.stateDisabled)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: en.restart })).toBeNull()
    expect(restart).not.toHaveBeenCalled()
  })

  it('shows the command line of an expanded server and says it lists no tools yet', async () => {
    const { list } = renderTab([SERVER], undefined, {
      list: async () => ({ servers: [statusRow(SERVER, { state: 'connecting' })] }),
    })
    await act(async () => {})
    expect(list).toHaveBeenCalled()
    toggleCard('local')

    expect(screen.getByText('npx -y pkg')).toBeTruthy()
    expect(screen.getByText(en.toolEmpty)).toBeTruthy()
  })

  it('reports the error a server bridge reported', async () => {
    renderTab([SERVER], undefined, {
      list: async () => ({ servers: [statusRow(SERVER, { state: 'failed', error: 'spawn ENOENT' })] }),
    })
    await act(async () => {})
    toggleCard('local')

    expect(screen.getByRole('alert').textContent).toBe('spawn ENOENT')
  })

  it('keeps an expanded card read-only without the Host document', async () => {
    const { scope } = renderTab([SERVER], undefined, { writable: false })
    await act(async () => {})
    toggleCard('local')

    expect(scope.getSnapshot().writable).toBe(false)
    expect(screen.queryByRole('button', { name: en.edit })).toBeNull()
    expect(screen.queryByRole('button', { name: en.remove })).toBeNull()
    // Restart stays available: it acts on the running bridge, not the document.
    expect(screen.getByRole('button', { name: en.restart })).toBeTruthy()
  })

  it('closes a card again on a second click', async () => {
    renderTab([SERVER])
    await act(async () => {})
    toggleCard('local')
    expect(screen.getByText('npx -y pkg')).toBeTruthy()

    toggleCard('local')

    expect(screen.queryByText('npx -y pkg')).toBeNull()
  })
})

describe('McpSettingsTab card actions', () => {
  const SERVER: McpServerEntryView = {
    id: 'srv-1', name: 'local', enabled: true, transport: 'stdio',
    command: 'npx', args: ['-y', 'pkg'], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
  }
  const OTHER: McpServerEntryView = {
    id: 'srv-2', name: 'other', enabled: true, transport: 'stdio',
    command: 'bunx', args: [], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
  }

  function toggleCard(title: string): void {
    fireEvent.click(screen.getByText(title, { exact: true }).closest('button')!)
  }

  it('edits one server without disturbing the others', async () => {
    const { scope } = renderTab([SERVER, OTHER])
    await act(async () => {})
    toggleCard('other')
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'renamed' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})

    const saved = scope.getSnapshot().value?.servers ?? []
    expect(saved.map(entry => entry.name)).toEqual(['local', 'renamed'])
    expect(saved[0]).toEqual(SERVER)
  })

  it('closes the editor without writing when cancelled', async () => {
    const { scope } = renderTab([SERVER])
    await act(async () => {})
    toggleCard('local')
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'renamed' } })

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    await act(async () => {})

    expect(screen.queryByLabelText(/^Name/)).toBeNull()
    expect(scope.getSnapshot().value?.servers[0]?.name).toBe('local')
  })

  it('keeps the editor open and says so when the section did not land', async () => {
    // The Host accepted the call but folded a different document back (a
    // concurrent writer): the tab must not pretend the edit is saved.
    const { scope } = renderTab([SERVER], undefined, { dropWrite: true })
    await act(async () => {})
    toggleCard('local')
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'renamed' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
    expect(screen.getByRole('button', { name: en.save })).toBeTruthy()
    expect(scope.getSnapshot().value?.servers[0]?.name).toBe('local')
  })

  it('reports a rejected write as a save failure', async () => {
    const { scope, view } = renderTab([SERVER], undefined, { failWrite: true })
    await act(async () => {})
    toggleCard('local')
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'renamed' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
    expect(scope.setSpy).toHaveBeenCalledWith('servers', expect.any(Array))
    expect(view.container.textContent).toContain(en.saveFailed)
  })

  it('reports a save that did not land when the scope has no section yet', async () => {
    const { scope } = renderTab([], undefined, { loading: true, dropWrite: true })
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.manual) }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'cloud' } })
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})

    // Nothing folded back, so the tab reports the save instead of closing.
    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
    expect(scope.getSnapshot().value).toBeUndefined()
  })

  it('flips a saved server off and on from its card', async () => {
    const { scope } = renderTab([SERVER, OTHER])
    await act(async () => {})
    toggleCard('local')

    fireEvent.click(screen.getByRole('checkbox', { name: en.enabledSwitch }))
    await act(async () => {})
    expect(scope.getSnapshot().value?.servers.map(entry => entry.enabled)).toEqual([false, true])

    fireEvent.click(screen.getByRole('checkbox', { name: en.enabledSwitch }))
    await act(async () => {})
    expect(scope.getSnapshot().value?.servers.map(entry => entry.enabled)).toEqual([true, true])
  })

  it('reports an enable write that failed', async () => {
    const { scope } = renderTab([SERVER], undefined, { failWrite: true })
    await act(async () => {})
    toggleCard('local')

    fireEvent.click(screen.getByRole('checkbox', { name: en.enabledSwitch }))
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
    expect(scope.getSnapshot().value?.servers[0]?.enabled).toBe(true)
  })

  it('asks before removing a server, then writes the shorter list', async () => {
    const { scope } = renderTab([SERVER, OTHER])
    await act(async () => {})
    toggleCard('local')

    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(screen.getByText(en.removeConfirm.replace('{name}', 'local'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    await act(async () => {})

    expect(scope.getSnapshot().value?.servers.map(entry => entry.name)).toEqual(['other'])
    expect(screen.queryByText('local')).toBeNull()
  })

  it('drops the removal question when cancelled', async () => {
    const { scope } = renderTab([SERVER])
    await act(async () => {})
    toggleCard('local')
    fireEvent.click(screen.getByRole('button', { name: en.remove }))

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    await act(async () => {})

    expect(screen.queryByText(en.removeConfirm.replace('{name}', 'local'))).toBeNull()
    expect(scope.getSnapshot().value?.servers).toHaveLength(1)
  })

  it('reports a removal that failed', async () => {
    const { scope } = renderTab([SERVER], undefined, { failWrite: true })
    await act(async () => {})
    toggleCard('local')
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
    expect(scope.getSnapshot().value?.servers).toHaveLength(1)
  })

  it('restarts a server from its card', async () => {
    const { restart } = renderTab([SERVER], undefined, {
      restart: async () => ({ servers: [statusRow(SERVER, { state: 'connecting' })] }),
    })
    await act(async () => {})
    toggleCard('local')

    fireEvent.click(screen.getByRole('button', { name: en.restart }))
    await act(async () => {})

    expect(restart).toHaveBeenCalledWith('srv-1')
  })
})

describe('McpSettingsTab editor fields', () => {
  const SERVER: McpServerEntryView = {
    id: 'srv-1', name: 'local', enabled: true, transport: 'stdio',
    command: 'npx', args: ['-y', 'pkg'], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
  }

  it('flips a new server off through the editor switch', async () => {
    const { scope } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.manual) }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'cloud' } })
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'npx' } })

    fireEvent.click(screen.getByRole('checkbox', { name: en.enabledSwitch }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})

    expect(scope.getSnapshot().value?.servers[0]?.enabled).toBe(false)
  })

  /** Open one saved server's editor. */
  async function openEditor(): Promise<void> {
    renderTab([SERVER])
    await act(async () => {})
    fireEvent.click(screen.getByText('local', { exact: true }).closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
  }

  it('ignores a name edit that arrives after the editor was cancelled', async () => {
    await openEditor()
    const name = screen.getByLabelText(/^Name/)

    // Both events land in one batch, the way a fast typist can outrun the
    // close: the draft is already gone when the keystroke is folded in.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.cancel }))
      fireEvent.change(name, { target: { value: 'renamed' } })
    })

    expect(screen.queryByLabelText(/^Name/)).toBeNull()
  })

  it('ignores a transport change that arrives after the editor was cancelled', async () => {
    await openEditor()
    const transport = screen.getByRole('combobox')

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.cancel }))
      fireEvent.change(transport, { target: { value: 'streamable-http' } })
    })

    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('ignores a switch flip that arrives after the editor was cancelled', async () => {
    await openEditor()
    const enabled = screen.getByRole('checkbox', { name: en.enabledSwitch })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.cancel }))
      fireEvent.click(enabled)
    })

    // The card's own switch stays behind; the editor's is gone with the form.
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
    expect(screen.getAllByRole('checkbox', { name: en.enabledSwitch })).toHaveLength(1)
  })

  it('takes a typed folder when no chooser is mounted', async () => {
    const { scope } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.presetFilesystem) }))
    await act(async () => {})

    fireEvent.change(screen.getByLabelText(new RegExp(en.folder)), { target: { value: '/srv/docs' } })
    expect(screen.getByLabelText<HTMLInputElement>(new RegExp(en.folder)).value).toBe('/srv/docs')

    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})
    expect(scope.getSnapshot().value?.servers[0]?.args).toEqual([
      '-y', '@modelcontextprotocol/server-filesystem', '/srv/docs',
    ])
  })

  it('leaves the folder the user typed when the native dialog is dismissed', async () => {
    renderTab([], async () => null)
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.presetFilesystem) }))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText(new RegExp(en.folder)), { target: { value: '/srv/docs' } })

    fireEvent.click(screen.getByRole('button', { name: en.chooseFolder }))
    await act(async () => {})

    expect(screen.getByLabelText<HTMLInputElement>(new RegExp(en.folder)).value).toBe('/srv/docs')
  })

  it('ignores a folder chosen after the editor was closed', async () => {
    const pending = deferred<string | null>()
    renderTab([], () => pending.promise)
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.presetFilesystem) }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: en.chooseFolder }))

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    pending.resolve('/picked/late')
    await act(async () => {})

    expect(screen.queryByLabelText(new RegExp(en.folder))).toBeNull()
  })

  it('takes a typed HTTP timeout and headers', async () => {
    const { scope } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.manual) }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'cloud' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'streamable-http' } })
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: 'https://cloud.example/mcp' } })
    fireEvent.change(screen.getByLabelText(/^Tool timeout/), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText(/^Headers/), { target: { value: 'X-A=1' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})

    expect(scope.getSnapshot().value?.servers[0]).toMatchObject({
      transport: 'streamable-http', toolCallTimeoutMs: 15_000, headers: { 'X-A': '1' },
    })
  })

  it('switches an HTTP draft back to a stdio command line', async () => {
    renderTab([HTTP_SERVER])
    await act(async () => {})
    fireEvent.click(screen.getByText('remote', { exact: true }).closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    await act(async () => {})

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'stdio' } })
    await act(async () => {})

    expect(screen.getByLabelText<HTMLInputElement>(/^Command/).value).toBe('')
    expect(screen.queryByLabelText(/^URL/)).toBeNull()
  })

  it('stages the raw argument list behind Advanced for a preset server', async () => {
    const { scope } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.presetFilesystem) }))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText(new RegExp(en.folder)), { target: { value: '/srv/docs' } })

    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.advanced) }))
    await act(async () => {})
    // Behind Advanced the preset states the command it decided on its own.
    expect(screen.getByText(en.presetCommandNote.replace('{command}', 'npx'))).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/^Arguments/), {
      target: { value: '-y\n@modelcontextprotocol/server-filesystem\n/srv/docs\n--readonly' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await act(async () => {})

    // The folder still wins for the path slot, so the typed list only adds
    // the extra flag.
    expect(scope.getSnapshot().value?.servers[0]?.args).toEqual([
      '-y', '@modelcontextprotocol/server-filesystem', '/srv/docs',
    ])
  })
})

describe('McpSettingsTab JSON import', () => {
  const SERVER: McpServerEntryView = {
    id: 'srv-1', name: 'local', enabled: true, transport: 'stdio',
    command: 'npx', args: [], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: 60_000,
  }

  /** Open the import dialog and paste one block. */
  function paste(text: string): void {
    fireEvent.click(screen.getByRole('button', { name: en.importJson }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: en.importApply }))
  }

  it('adds the servers pasted from another client', async () => {
    const { scope } = renderTab()
    await act(async () => {})

    paste(JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', 'server-github'] },
        remote: { url: 'https://example.com/mcp' },
      },
    }))
    await act(async () => {})

    const saved = scope.getSnapshot().value?.servers ?? []
    expect(saved.map(entry => entry.name)).toEqual(['github', 'remote'])
    expect(saved[1]).toMatchObject({ transport: 'streamable-http', url: 'https://example.com/mcp' })
    // The dialog closed and the new servers joined the list.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('github')).toBeTruthy()
  })

  it('suffixes an imported name that is already taken', async () => {
    const { scope } = renderTab([SERVER])
    await act(async () => {})

    paste(JSON.stringify({ mcpServers: { local: { command: 'other' } } }))
    await act(async () => {})

    expect(scope.getSnapshot().value?.servers.map(entry => entry.name)).toEqual(['local', 'local-2'])
  })

  it('reports a paste that is not JSON', async () => {
    renderTab()
    await act(async () => {})

    paste('{ nope')
    await act(async () => {})

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(en.importError.split('{reason}')[0]!)
  })

  it('reports a paste that names no server with a launch target', async () => {
    const { scope } = renderTab()
    await act(async () => {})

    paste(JSON.stringify({ mcpServers: { junk: { note: 'no command or url' } } }))
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toContain(en.toolEmpty)
    expect(scope.getSnapshot().value?.servers ?? []).toHaveLength(0)
  })

  it('closes the dialog without importing when cancelled', async () => {
    const { scope } = renderTab()
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: en.importJson }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: en.importCancel }))
    await act(async () => {})

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(scope.setSpy).not.toHaveBeenCalled()
  })

  it('reports an import that did not land', async () => {
    const { scope } = renderTab([], undefined, { failWrite: true })
    await act(async () => {})

    paste(JSON.stringify({ mcpServers: { github: { command: 'npx' } } }))
    await act(async () => {})

    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
    expect(scope.getSnapshot().value?.servers ?? []).toHaveLength(0)
  })

  it('goes back to the list from the quick-start catalog', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(screen.getByText(en.quickStart)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))

    expect(screen.queryByText(en.quickStart)).toBeNull()
    expect(screen.queryByLabelText(/^Name/)).toBeNull()
    expect(screen.getByText(en.empty)).toBeTruthy()
  })
})
