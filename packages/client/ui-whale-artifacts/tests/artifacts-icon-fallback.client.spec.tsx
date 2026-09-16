// @vitest-environment jsdom
/**
 * Gallery kind badges against a stylesheet that has no tint rule for every
 * kind: the badge still names the file's kind, and the card renders instead of
 * falling over the missing class.
 *
 * The shipped `ArtifactsView.module.css` tints xlsx/docx/pptx/csv/pdf/image/
 * video/audio/text only, so markdown and other files reach the missing-class
 * fallback. Vitest otherwise serves CSS modules through a proxy that mints a
 * class for any key, which hides that arm; the mock below restores a plain
 * class map so it stays observable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('../src/client/ArtifactsView.module.css', () => ({
  default: { icon: 'icon', icon_xlsx: 'icon_xlsx' },
}))

import { ArtifactsView } from '../src/client/ArtifactsView.tsx'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArtifactEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

afterEach(cleanup)

function entry(path: string, kind: ArtifactEntry['kind']): ArtifactEntry {
  return { path, name: path, kind, size: 4, modifiedAt: Date.now(), origin: 'deliverable' }
}

describe('ArtifactsView kind badges without a stylesheet rule', () => {
  it('still names the kind of a file the stylesheet does not tint', async () => {
    const connection = {
      api: {
        artifacts: {
          list: async () => ({
            result: { ok: true as const, value: { artifacts: [entry('notes.md', 'markdown'), entry('archive.zip', 'other')] } },
          }),
          preview: async () => ({ result: { ok: true as const, value: {} } }),
        },
        host: { openPath: async () => ({}) },
      },
    }
    // The view only touches artifacts list/preview and host.openPath, and the
    // cwd selector; spelling the full contracts would couple this spec to
    // every API method and store field.
    const useSessions = (() => undefined) as unknown as SnapshotSelectorHook<SessionListState>
    const props = {
      sessionId: 'outcomes' as SessionId,
      useSessions,
      connection: connection as unknown as ConnectionHandle,
      t: (key: string) => key,
    } as unknown as Parameters<typeof ArtifactsView>[0]
    render(<ArtifactsView {...props} />)
    await act(async () => {})
    expect(screen.getByText('MARK')).toBeTruthy()
    expect(screen.getByText('OTHE')).toBeTruthy()
  })
})
