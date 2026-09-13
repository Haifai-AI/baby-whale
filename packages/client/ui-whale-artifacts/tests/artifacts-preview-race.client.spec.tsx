// @vitest-environment jsdom
/**
 * ArtifactsView preview race: a slow response for an earlier selection must
 * not overwrite the preview of a newer selection (per-request generation).
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ArtifactsView } from '../src/client/ArtifactsView.tsx'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArtifactEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

afterEach(cleanup)

function entry(path: string, kind: ArtifactEntry['kind'] = 'text'): ArtifactEntry {
  return { path, name: path, kind, size: 4, modifiedAt: Date.now(), origin: 'deliverable' }
}

/** Render the view over a fixed gallery and preview implementation. */
function renderView(artifacts: ArtifactEntry[], preview: (args: { path: string }) => Promise<unknown>) {
  const connection = {
    api: {
      artifacts: {
        list: async () => ({
          result: { ok: true as const, value: { artifacts } },
        }),
        preview,
      },
      host: { openPath: async () => ({}) },
    },
  }
  // The view only touches artifacts list/preview and host.openPath, and the
  // cwd selector; spelling the full contracts would couple this test to
  // every API method and store field.
  const useSessions = (() => '/ws') as unknown as SnapshotSelectorHook<SessionListState>
  const props = {
    sessionId: 'outcomes' as SessionId,
    useSessions,
    connection: connection as unknown as ConnectionHandle,
    t: (key: string) => key,
  } as unknown as Parameters<typeof ArtifactsView>[0]
  return render(<ArtifactsView {...props} />)
}

/** Deferred preview responses keyed by artifact path. */
function previewGate() {
  const gates = new Map<string, { resolve: (text: string) => void }>()
  const preview = vi.fn(async ({ path }: { path: string }) => {
    const text = await new Promise<string>((resolve) => {
      gates.set(path, { resolve })
    })
    return { result: { ok: true as const, value: { preview: { kind: 'text', text } } } }
  })
  return { preview, gates }
}

describe('ArtifactsView preview race', () => {
  it('ignores a stale earlier response after reselection', async () => {
    const { preview, gates } = previewGate()
    const connection = {
      api: {
        artifacts: {
          list: async () => ({
            result: { ok: true as const, value: { artifacts: [entry('a.txt'), entry('b.txt')] } },
          }),
          preview,
        },
        host: { openPath: async () => ({}) },
      },
    }
    // The view only touches artifacts list/preview and host.openPath, and the
    // cwd selector; spelling the full contracts would couple this test to
    // every API method and store field.
    const useSessions = (() => '/ws') as unknown as SnapshotSelectorHook<SessionListState>
    const props = {
      sessionId: 'race' as SessionId,
      useSessions,
      connection: connection as unknown as ConnectionHandle,
      t: (key: string) => key,
    } as unknown as Parameters<typeof ArtifactsView>[0]
    const view = render(<ArtifactsView {...props} />)
    await act(async () => {})
    const buttons = view.getAllByRole('button', { name: 'preview' })
    expect(buttons).toHaveLength(2)

    // Select A, then B while A's preview is still in flight.
    fireEvent.click(buttons[0]!)
    await act(async () => {})
    fireEvent.click(buttons[1]!)
    await act(async () => {})

    // A's late response must not render; B's must.
    await act(async () => { gates.get('a.txt')?.resolve('content of AAAA') })
    expect(view.container.textContent).not.toContain('content of AAAA')
    await act(async () => { gates.get('b.txt')?.resolve('content of BBBB') })
    expect(view.container.textContent).toContain('content of BBBB')
    expect(view.container.textContent).not.toContain('content of AAAA')
  })
})

describe('ArtifactsView preview outcomes', () => {
  it('serves browser-native kinds from the raw URL without calling preview', async () => {
    const preview = async (): Promise<unknown> => {
      throw new Error('raw kinds must not reach the preview RPC')
    }
    const view = renderView([entry('doc.pdf', 'pdf')], preview)
    await act(async () => {})
    fireEvent.click(view.getAllByRole('button', { name: 'preview' })[0]!)
    await act(async () => {})
    const frame = view.container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('/api/artifacts.raw?session=outcomes&path=doc.pdf')
  })

  it('attaches the instance token to raw subresource URLs', async () => {
    window.location.hash = '#token=t1'
    try {
      const preview = async (): Promise<unknown> => {
        throw new Error('raw kinds must not reach the preview RPC')
      }
      const view = renderView([entry('pic.png', 'image')], preview)
      await act(async () => {})
      fireEvent.click(view.getAllByRole('button', { name: 'preview' })[0]!)
      await act(async () => {})
      expect(view.container.querySelector('img')?.getAttribute('src')).toContain('token=t1')
    } finally {
      window.location.hash = ''
      sessionStorage.clear()
    }
  })

  it('renders a converted pdf through the file channel', async () => {
    const preview = async (): Promise<unknown> => ({
      result: { ok: true as const, value: { preview: { kind: 'pdf', pdfPath: '/cache/x.pdf' }, size: 8 } },
    })
    const view = renderView([entry('sheet.xlsx', 'xlsx')], preview)
    await act(async () => {})
    fireEvent.click(view.getAllByRole('button', { name: 'preview' })[0]!)
    await act(async () => {})
    const frame = view.container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toContain('/api/artifacts.file?path=')
  })

  it('reports unsupported for empty, failed, and rejected previews', async () => {
    for (const preview of [
      async (): Promise<unknown> => ({ result: { ok: true as const, value: {} } }),
      async (): Promise<unknown> => ({
        result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } },
      }),
      async (): Promise<unknown> => {
        throw new Error('preview failed')
      },
    ]) {
      const view = renderView([entry('deck.pptx', 'pptx')], preview)
      await act(async () => {})
      fireEvent.click(view.getAllByRole('button', { name: 'preview' })[0]!)
      await act(async () => {})
      expect(view.container.textContent).toContain('preview.unsupported')
      view.unmount()
    }
  })
})
