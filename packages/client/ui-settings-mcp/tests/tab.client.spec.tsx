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
          value: { servers: structuredClone(next as McpServerEntryView[]) },
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
