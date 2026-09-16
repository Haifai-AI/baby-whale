// @vitest-environment jsdom
/**
 * Artifacts gallery: the listing's origin/size/date line, the listing's
 * loading, empty, and failed states, the refresh action, handing a path to the
 * OS, and the right-side pane that serves each preview kind through its own
 * channel (raw bytes, the file channel, the workbook lens, or the studio).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ArtifactsView } from '../src/client/ArtifactsView.tsx'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArtifactEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

afterEach(() => {
  cleanup()
  window.location.hash = ''
  sessionStorage.clear()
})

function entry(path: string, kind: ArtifactEntry['kind'], overrides: Partial<ArtifactEntry> = {}): ArtifactEntry {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    kind,
    size: 4,
    modifiedAt: Date.parse('2026-09-03T10:00:00.000Z'),
    origin: 'deliverable',
    ...overrides,
  }
}

/** A parsed preview as the `artifacts.preview` gateway returns it. */
function previewResult(preview: unknown): unknown {
  return { result: { ok: true as const, value: { preview } } }
}

/** The studio's xlsx payload: one sheet with one row. */
const sheet = { name: 'Sheet1', header: ['Item'], rows: [[{ v: 'Widget' }]], total_rows: 1, total_cols: 1 }

/**
 * Render the view over a scripted gateway. `cwd` drives the global sessions
 * selector the view reads for the workspace root; an undefined `cwd` leaves the
 * session unknown, which is how a workspace-less gallery is spelled.
 */
function renderView(input: {
  artifacts?: readonly ArtifactEntry[]
  listOutcome?: 'ok' | 'failed' | 'rejected'
  preview?: (args: { path: string }) => Promise<unknown>
  cwd?: string | undefined
} = {}) {
  const list = vi.fn(async () => {
    if (input.listOutcome === 'rejected') throw new Error('listing failed')
    if (input.listOutcome === 'failed') {
      return { result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } } }
    }
    return { result: { ok: true as const, value: { artifacts: input.artifacts ?? [] } } }
  })
  const preview = vi.fn(input.preview ?? (async () => previewResult({})))
  const openPath = vi.fn(async () => ({}))
  const connection = { api: { artifacts: { list, preview }, host: { openPath } } }
  // The view reads only the artifacts list/preview RPCs, host.openPath, and the
  // session cwd; spelling the full contracts would couple this spec to every
  // API method and store field.
  const sessions = {
    byId: input.cwd === undefined ? {} : { outcomes: { cwd: input.cwd } },
  } as unknown as SessionListState
  const useSessions = ((selector: (state: SessionListState) => unknown) =>
    selector(sessions)) as unknown as SnapshotSelectorHook<SessionListState>
  const props = {
    sessionId: 'outcomes' as SessionId,
    useSessions,
    connection: connection as unknown as ConnectionHandle,
    t: (key: string) => key,
  } as unknown as Parameters<typeof ArtifactsView>[0]
  return { view: render(<ArtifactsView {...props} />), list, preview, openPath }
}

/** The Preview buttons, in card order. */
function previewButtons(): HTMLElement[] {
  return screen.getAllByText('preview')
}

describe('ArtifactsView listing', () => {
  it('shows a loading note until the listing settles', async () => {
    const { view } = renderView({ artifacts: [] })
    expect(view.container.textContent).toContain('gallery.loading')
    await act(async () => {})
    expect(view.container.textContent).toContain('gallery.empty')
  })

  it('describes each file by origin, byte size, and modification time', async () => {
    const { view } = renderView({ cwd: '/ws', artifacts: [
      entry('deliverables/report.xlsx', 'xlsx', { size: 2048 }),
      entry('uploads/photo.png', 'image', { size: 3 * 1024 * 1024, origin: 'upload' }),
      entry('deliverables/notes.md', 'markdown', { size: 900 }),
      entry('deliverables/archive.zip', 'other', { size: 10 }),
    ] })
    await act(async () => {})
    const text = view.container.textContent ?? ''
    expect(text).toContain('from.deliverable')
    expect(text).toContain('from.upload')
    // Bytes, kilobytes, and megabytes each get their own spelling.
    expect(text).toContain('900 B')
    expect(text).toContain('2 KB')
    expect(text).toContain('3.0 MB')
    // Kind badges stay short: the four-letter slice of the uppercase kind, and
    // IMG for images.
    for (const badge of ['XLSX', 'IMG', 'MARK', 'OTHE']) expect(screen.getByText(badge)).toBeTruthy()
    expect(view.container.textContent).not.toContain('undefined')
  })

  it('offers Preview only for kinds the browser or the studio can render', async () => {
    const { view } = renderView({ artifacts: [entry('deliverables/archive.zip', 'other', { size: 10 })] })
    await act(async () => {})
    expect(screen.getByText('open.app')).toBeTruthy()
    expect(screen.queryByText('preview')).toBeNull()
    expect(view.container.textContent).toContain('10 B')
  })

  it('reports an empty gallery when the listing is refused or throws', async () => {
    for (const listOutcome of ['failed', 'rejected'] as const) {
      const { view } = renderView({ listOutcome })
      await act(async () => {})
      expect(view.container.textContent).toContain('gallery.empty')
      view.unmount()
    }
  })

  it('re-reads the listing when Refresh is pressed', async () => {
    const { list } = renderView({ artifacts: [entry('deliverables/report.xlsx', 'xlsx')] })
    await act(async () => {})
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ sessionId: 'outcomes' })
    fireEvent.click(screen.getByText('refresh'))
    await act(async () => {})
    expect(list).toHaveBeenCalledTimes(2)
  })
})

describe('ArtifactsView open action', () => {
  it('resolves a workspace-relative path against the session cwd', async () => {
    const { openPath } = renderView({ cwd: '/ws', artifacts: [entry('deliverables/report.xlsx', 'xlsx')] })
    await act(async () => {})
    fireEvent.click(screen.getByText('open.app'))
    expect(openPath).toHaveBeenCalledWith({ path: '/ws/deliverables/report.xlsx' })
  })

  it('hands over the bare relative path when the workspace root is unknown', async () => {
    const { openPath } = renderView({ artifacts: [entry('deliverables/report.xlsx', 'xlsx')] })
    await act(async () => {})
    fireEvent.click(screen.getByText('open.app'))
    expect(openPath).toHaveBeenCalledWith({ path: 'deliverables/report.xlsx' })
  })

  it('opens the selected file from the pane header as well', async () => {
    const { openPath } = renderView({
      cwd: '/ws',
      artifacts: [entry('deliverables/report.xlsx', 'xlsx')],
      preview: async () => previewResult({ kind: 'xlsx', file_name: 'report.xlsx', sheets: [sheet] }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    // The pane is the header that carries the close control.
    const pane = screen.getByRole('button', { name: 'preview.close' }).parentElement
    fireEvent.click(within(pane as HTMLElement).getByText('open.app'))
    expect(openPath).toHaveBeenCalledWith({ path: '/ws/deliverables/report.xlsx' })
    expect(openPath).toHaveBeenCalledTimes(1)
  })
})

describe('ArtifactsView preview pane', () => {
  it('closes the pane and drops the parsed preview', async () => {
    const { view } = renderView({
      artifacts: [entry('deliverables/notes.txt', 'text')],
      preview: async () => previewResult({ kind: 'text', text: 'the whole file body' }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    expect(view.container.textContent).toContain('the whole file body')
    fireEvent.click(screen.getByRole('button', { name: 'preview.close' }))
    expect(view.container.textContent).not.toContain('the whole file body')
    expect(screen.queryByText('preview.close')).toBeNull()
  })

  it('plays video and audio artifacts from their raw bytes', async () => {
    const { view, preview } = renderView({
      artifacts: [entry('deliverables/clip.mp4', 'video'), entry('uploads/song.mp3', 'audio')],
    })
    await act(async () => {})
    fireEvent.click(previewButtons()[0]!)
    await act(async () => {})
    expect(view.container.querySelector('video')?.getAttribute('src'))
      .toBe('/api/artifacts.raw?session=outcomes&path=deliverables%2Fclip.mp4')
    fireEvent.click(previewButtons()[1]!)
    await act(async () => {})
    expect(view.container.querySelector('audio')?.getAttribute('src'))
      .toBe('/api/artifacts.raw?session=outcomes&path=uploads%2Fsong.mp3')
    // Raw kinds never reach the parse RPC.
    expect(preview).not.toHaveBeenCalled()
  })

  it('renders a converted PDF with an empty path fallback rather than crashing', async () => {
    const { view } = renderView({
      artifacts: [entry('deliverables/deck.pptx', 'pptx')],
      preview: async () => previewResult({ kind: 'pdf' }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    expect(view.container.querySelector('iframe')?.getAttribute('src')).toBe('/api/artifacts.file?path=')
  })

  it('renders a spreadsheet through the workbook lens', async () => {
    const { view } = renderView({
      artifacts: [entry('deliverables/book.xlsx', 'xlsx')],
      preview: async () => previewResult({ kind: 'xlsx', file_name: 'book.xlsx', sheets: [sheet] }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    expect(screen.getByText('tab.data')).toBeTruthy()
    expect(screen.getByText('Sheet1')).toBeTruthy()
    expect(view.container.textContent).toContain('Widget')
  })

  it('renders markdown with a truncation note only when the parse was capped', async () => {
    const truncated = renderView({
      artifacts: [entry('deliverables/notes.md', 'markdown')],
      preview: async () => previewResult({ kind: 'markdown', text: '# Findings', truncated: true }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    expect(screen.getByText('Findings')).toBeTruthy()
    expect(truncated.view.container.textContent).toContain('preview.truncated')
    cleanup()

    const whole = renderView({
      artifacts: [entry('deliverables/notes.md', 'markdown')],
      preview: async () => previewResult({ kind: 'markdown', text: '# Findings' }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    expect(whole.view.container.textContent).not.toContain('preview.truncated')
  })

  it('renders plain text with its language and a truncation note', async () => {
    const { view } = renderView({
      artifacts: [entry('deliverables/main.ts', 'text')],
      preview: async () => previewResult({ kind: 'text', text: 'const answer = 42', language: 'ts', truncated: true }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    expect(view.container.textContent).toContain('const answer = 42')
    expect(view.container.textContent).toContain('preview.truncated')
  })

  it('renders a text or markdown file that parsed to no body at all', async () => {
    for (const kind of ['text', 'markdown'] as const) {
      const { view } = renderView({
        artifacts: [entry(`deliverables/empty.${kind}`, kind)],
        preview: async () => previewResult({ kind }),
      })
      await act(async () => {})
      fireEvent.click(screen.getByText('preview'))
      await act(async () => {})
      expect(view.container.querySelector('[class*="filePreview"]')).not.toBeNull()
      expect(view.container.textContent).not.toContain('undefined')
      view.unmount()
    }
  })

  it('renders an office document through the studio and flags a missing converter', async () => {
    const { view } = renderView({
      artifacts: [entry('deliverables/report.docx', 'docx')],
      preview: async () => previewResult({
        kind: 'docx',
        file_name: 'report.docx',
        truncated: true,
        title: 'Quarterly report',
        blocks: [{ type: 'heading1', text: 'Revenue' }, { type: 'paragraph', text: 'Up and to the right' }],
        notice: 'soffice-missing',
      }),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('preview'))
    await act(async () => {})
    expect(screen.getByText('Quarterly report')).toBeTruthy()
    expect(screen.getByText('Revenue')).toBeTruthy()
    expect(screen.getByText('Up and to the right')).toBeTruthy()
    expect(view.container.textContent).toContain('preview.sofficeMissing')
    expect(view.container.textContent).toContain('preview.truncated')
  })

  it('ignores a stale failure from an earlier selection', async () => {
    const gates = new Map<string, { reject: (error: Error) => void }>()
    const preview = ({ path }: { path: string }): Promise<unknown> =>
      new Promise((_resolve, reject) => { gates.set(path, { reject }) })
    const { view } = renderView({
      artifacts: [entry('deliverables/a.txt', 'text'), entry('deliverables/b.txt', 'text')],
      preview,
    })
    await act(async () => {})
    fireEvent.click(previewButtons()[0]!)
    await act(async () => {})
    fireEvent.click(previewButtons()[1]!)
    await act(async () => {})
    await act(async () => { gates.get('deliverables/a.txt')?.reject(new Error('boom')) })
    // A's failure must not be reported against B, which is still loading.
    expect(view.container.textContent).not.toContain('preview.unsupported')
    await act(async () => { gates.get('deliverables/b.txt')?.reject(new Error('boom')) })
    expect(view.container.textContent).toContain('preview.unsupported')
  })
})
