// @vitest-environment jsdom
/**
 * FilePreviewPane mode dispatch: media extensions render native players on
 * the raw channel without an RPC round-trip, images and PDFs stay raw/iframe,
 * and rpc-backed kinds still parse through the preview channel. Players are
 * keyed by path so a pane retarget rebuilds the element instead of mutating
 * its src (no playback state leaks across files).
 */
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FilePreviewPane } from '../src/client/FilePreviewPane.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const sessionId = 'sess-media' as SessionId

/** A connection whose preview RPC is an inspectable mock, returned alongside that mock. */
function fakeConnection(preview?: { kind: string; text?: string }): {
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
})
