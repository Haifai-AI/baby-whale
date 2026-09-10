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
  } as McpServerEntryView
}

/** In-memory scope double: saves fold straight into the snapshot, like the Host. */
function fakeScope(initial: readonly McpServerEntryView[]): SettingsScope<McpSettingsView> {
  // The snapshot object is cached: useSyncExternalStore requires getSnapshot
  // to return a stable reference until the next change.
  let snapshot: SettingsScopeSnapshot<McpSettingsView> = {
    status: 'ready',
    value: { servers: [...initial] },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
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

function renderTab(servers: readonly McpServerEntryView[] = []): { scope: SettingsScope<McpSettingsView> } {
  const scope = fakeScope(servers)
  const props = {
    list: vi.fn(async () => ({ servers: [] })),
    restart: vi.fn(async () => ({ servers: [] })),
    scope,
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
    expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe(HTTP_SERVER.url)
    expect(screen.getByLabelText(/^Headers/)).toBeDefined()
    expect(screen.queryByLabelText(/^Command/)).toBeNull()
    expect(screen.queryByLabelText(/^Arguments/)).toBeNull()
  })

  it('switches a new server to HTTP and saves the streamable-http transport', async () => {
    const { scope } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
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
