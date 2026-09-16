// @vitest-environment jsdom
/**
 * FilePreviewPane mode dispatch: media extensions render native players on
 * the raw channel without an RPC round-trip, images and PDFs stay raw/iframe,
 * and rpc-backed kinds still parse through the preview channel. Players are
 * keyed by path so a pane retarget rebuilds the element instead of mutating
 * its src (no playback state leaks across files).
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FilePreviewPane } from '../src/client/FilePreviewPane.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en)
const sessionId = 'sess-media' as SessionId

/** A connection whose preview RPC is an inspectable mock, returned alongside that mock. */
function fakeConnection(preview?: { kind: string } & Record<string, unknown>): {
  readonly connection: ConnectionHandle
  readonly previewRpc: Mock
} {
  const previewRpc = vi.fn(async () => ({
    result: { ok: true as const, value: { preview, size: 12 } },
  }))
  return {
    previewRpc,
    connection: {
      api: { artifacts: { preview: previewRpc } },
    } as unknown as ConnectionHandle,
  }
}

/** A connection whose preview calls settle only when the test says so. */
function deferredConnection(deferreds: readonly Promise<unknown>[]): ConnectionHandle {
  const queue = [...deferreds]
  return {
    api: {
      artifacts: {
        preview: () => {
          const next = queue.shift()
          if (next === undefined) throw new Error('unexpected preview call')
          return next
        },
      },
    },
  } as unknown as ConnectionHandle
}

/** A promise that stays pending until `resolve`/`reject` is called. */
function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void } {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise((settle, fail) => { resolve = settle; reject = fail })
  return { promise, resolve, reject }
}

/** An office payload shaped like the host's `artifacts.preview` result. */
const XLSX_PREVIEW = {
  kind: 'xlsx',
  file_name: 'budget.xlsx',
  truncated: false,
  sheets: [{ name: 'Sheet1', header: ['Note'], rows: [[{ v: 'A1 value' }]], total_rows: 1, total_cols: 1 }],
}

describe('FilePreviewPane mode dispatch', () => {
  it('renders a video element on the raw channel with no preview RPC', () => {
    const { connection, previewRpc } = fakeConnection()
    const { container } = render(
      <FilePreviewPane path="deliverables/demo.mp4" sessionId={sessionId} connection={connection} t={t} />,
    )
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src'))
      .toBe(`/api/artifacts.raw?${new URLSearchParams({ session: sessionId, path: 'deliverables/demo.mp4' })}`)
    expect(video?.getAttribute('controls')).not.toBeNull()
    expect(previewRpc).not.toHaveBeenCalled()
  })

  it('keeps .mov off the native player: rpc fallback, no video element', () => {
    const { connection, previewRpc } = fakeConnection()
    const { container } = render(
      <FilePreviewPane path="deliverables/clip.mov" sessionId={sessionId} connection={connection} t={t} />,
    )
    expect(container.querySelector('video')).toBeNull()
    // The fallback is the preview RPC, not a dead player.
    expect(previewRpc).toHaveBeenCalledTimes(1)
  })

  it('renders an audio element for audio extensions, also RPC-free', () => {
    const { connection, previewRpc } = fakeConnection()
    const { container } = render(
      <FilePreviewPane path="deliverables/jingle.mp3" sessionId={sessionId} connection={connection} t={t} />,
    )
    expect(container.querySelector('audio')).not.toBeNull()
    expect(previewRpc).not.toHaveBeenCalled()
  })

  it('keys the player by path so retargeting rebuilds it', () => {
    const { connection } = fakeConnection()
    const { container, rerender } = render(
      <FilePreviewPane path="deliverables/one.mp4" sessionId={sessionId} connection={connection} t={t} />,
    )
    const first = container.querySelector('video')
    rerender(
      <FilePreviewPane path="deliverables/two.mp4" sessionId={sessionId} connection={connection} t={t} />,
    )
    const second = container.querySelector('video')
    expect(second).not.toBe(first)
    expect(second?.getAttribute('src')).toContain('two.mp4')
  })

  it('keeps images on the raw channel and rpc kinds on the preview channel', async () => {
    const { connection, previewRpc } = fakeConnection({ kind: 'markdown', text: '# hi' })
    const { container } = render(
      <FilePreviewPane path="deliverables/pic.png" sessionId={sessionId} connection={connection} t={t} />,
    )
    expect(container.querySelector('img')).not.toBeNull()

    const rpc = render(
      <FilePreviewPane path="deliverables/notes.md" sessionId={sessionId} connection={connection} t={t} />,
    )
    expect(previewRpc).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(rpc.container.textContent).toContain('hi') })
  })

  it('wraps the PDF frame in the full-height pane instead of leaving it bare', () => {
    // A bare iframe has no intrinsic height. The details panel renders this
    // seat inside a scrolling, padded body, so an unwrapped frame collapsed to
    // the UA default and drew the page as a thumbnail in the corner. The
    // wrapper is what the frame's `flex: 1` resolves against, and every other
    // mode already had one.
    const { connection, previewRpc } = fakeConnection()
    const { container } = render(
      <FilePreviewPane path="deliverables/report.pdf" sessionId={sessionId} connection={connection} t={t} />,
    )
    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.parentElement?.className).toMatch(/filePreviewPane/)
    // Raw channel: a PDF never needs the preview RPC.
    expect(previewRpc).not.toHaveBeenCalled()
  })
})

describe('FilePreviewPane preview payloads', () => {
  it('renders the office studio and flags a preview built without LibreOffice', async () => {
    const degraded = fakeConnection({ ...XLSX_PREVIEW, notice: 'soffice-missing' })
    const view = render(
      <FilePreviewPane path="deliverables/budget" sessionId={sessionId} connection={degraded.connection} t={t} />,
    )
    await waitFor(() => { expect(view.getByText('A1 value')).toBeTruthy() })
    expect(view.getByText(t('preview.sofficeMissing'))).toBeTruthy()
    view.unmount()

    const full = fakeConnection(XLSX_PREVIEW)
    const plain = render(
      <FilePreviewPane path="deliverables/budget" sessionId={sessionId} connection={full.connection} t={t} />,
    )
    await waitFor(() => { expect(plain.getByText('A1 value')).toBeTruthy() })
    expect(plain.queryByText(t('preview.sofficeMissing'))).toBeNull()
  })

  it('renders an RPC-served PDF page and falls back to an empty path when none is named', async () => {
    const named = fakeConnection({ kind: 'pdf', pdfPath: 'deliverables/report.pdf' })
    const view = render(
      <FilePreviewPane path="deliverables/report" sessionId={sessionId} connection={named.connection} t={t} />,
    )
    await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
    expect(view.container.querySelector('iframe')?.getAttribute('src'))
      .toBe(`/api/artifacts.file?path=${encodeURIComponent('deliverables/report.pdf')}`)
    view.unmount()

    const unnamed = fakeConnection({ kind: 'pdf' })
    const bare = render(
      <FilePreviewPane path="deliverables/report" sessionId={sessionId} connection={unnamed.connection} t={t} />,
    )
    await waitFor(() => { expect(bare.container.querySelector('iframe')).not.toBeNull() })
    expect(bare.container.querySelector('iframe')?.getAttribute('src')).toBe('/api/artifacts.file?path=')
  })

  it('renders markdown and highlighted code, and an empty surface when no text came back', async () => {
    const markdown = fakeConnection({ kind: 'markdown', text: '# Release notes' })
    const view = render(
      <FilePreviewPane path="deliverables/notes" sessionId={sessionId} connection={markdown.connection} t={t} />,
    )
    await waitFor(() => { expect(view.getByText('Release notes')).toBeTruthy() })
    view.unmount()

    const emptyMarkdown = fakeConnection({ kind: 'markdown' })
    const bare = render(
      <FilePreviewPane path="deliverables/notes" sessionId={sessionId} connection={emptyMarkdown.connection} t={t} />,
    )
    await waitFor(() => { expect(bare.queryByText(t('preview.loading'))).toBeNull() })
    expect(bare.container.textContent).toBe('')
    bare.unmount()

    const code = fakeConnection({ kind: 'text', text: 'const answer = 42', language: 'ts' })
    const highlighted = render(
      <FilePreviewPane path="deliverables/tool" sessionId={sessionId} connection={code.connection} t={t} />,
    )
    await waitFor(() => { expect(highlighted.container.textContent).toContain('const answer = 42') })
    // The payload's language hint reaches the viewer's own banner.
    expect(highlighted.container.textContent).toContain('ts')
    highlighted.unmount()

    const bareCode = fakeConnection({ kind: 'text' })
    const plain = render(
      <FilePreviewPane path="deliverables/tool" sessionId={sessionId} connection={bareCode.connection} t={t} />,
    )
    await waitFor(() => { expect(plain.queryByText(t('preview.loading'))).toBeNull() })
    // An absent payload renders an empty document rather than an error note:
    // the viewer mounts with one blank line and no content text.
    expect(plain.container.querySelector('[class^="_content_"]')?.textContent).toBe('')
  })

  it('reports an unsupported preview when the payload names no kind', async () => {
    const { connection } = fakeConnection({ kind: 42 } as never)
    const view = render(
      <FilePreviewPane path="deliverables/mystery.bin" sessionId={sessionId} connection={connection} t={t} />,
    )
    await waitFor(() => { expect(view.getByText(t('preview.unsupported'))).toBeTruthy() })
  })

  it('reports an unsupported preview when the preview call fails or rejects', async () => {
    const failed = {
      api: {
        artifacts: {
          preview: async () => ({ result: { ok: false as const, error: { code: 'e', message: 'no' } } }),
        },
      },
    } as unknown as ConnectionHandle
    const failure = render(
      <FilePreviewPane path="deliverables/thing.bin" sessionId={sessionId} connection={failed} t={t} />,
    )
    await waitFor(() => { expect(failure.getByText(t('preview.unsupported'))).toBeTruthy() })
    failure.unmount()

    const refused = {
      api: { artifacts: { preview: () => Promise.reject(new Error('offline')) } },
    } as unknown as ConnectionHandle
    const rejection = render(
      <FilePreviewPane path="deliverables/thing.bin" sessionId={sessionId} connection={refused} t={t} />,
    )
    await waitFor(() => { expect(rejection.getByText(t('preview.unsupported'))).toBeTruthy() })
  })

  it('drops a response or failure whose pane already retargeted or unmounted', async () => {
    const first = deferred()
    const second = deferred()
    const connection = deferredConnection([first.promise, second.promise])
    const view = render(
      <FilePreviewPane path="deliverables/old.md" sessionId={sessionId} connection={connection} t={t} />,
    )
    // Retarget to a native player: the pending RPC effect is torn down, so its
    // late value must never render under the new path.
    view.rerender(
      <FilePreviewPane path="deliverables/new.mp4" sessionId={sessionId} connection={connection} t={t} />,
    )
    await act(async () => {
      first.resolve({ result: { ok: true, value: { preview: { kind: 'markdown', text: '# stale' } } } })
    })
    expect(view.queryByText('stale')).toBeNull()
    expect(view.container.querySelector('video')).not.toBeNull()

    // The same guard covers an unmounted pane's rejection.
    view.rerender(
      <FilePreviewPane path="deliverables/again.md" sessionId={sessionId} connection={connection} t={t} />,
    )
    view.unmount()
    await act(async () => { second.reject(new Error('offline')) })
  })
})
