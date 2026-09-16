// @vitest-environment jsdom
/**
 * Delivered cards against a stylesheet that tints only some kinds: a claim
 * whose kind has no `tile_*` rule still renders its card, names its kind, and
 * keeps its Preview affordance instead of falling over the missing class.
 *
 * The shipped `ProducedFiles.module.css` tints xlsx/csv/docx/pptx/pdf/py only,
 * so markdown, text, video, audio, and other claims reach the missing-class
 * fallback. Vitest otherwise serves CSS modules through a proxy that mints a
 * class for any key, which hides that arm; the mock below restores a plain
 * class map so it stays observable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

vi.mock('../src/client/ProducedFiles.module.css', () => ({
  default: { btnLogo: 'btnLogo', tile_xlsx: 'tile_xlsx' },
}))

import { DeliveredCards, type DeliveredCardsProps } from '../src/client/DeliveredCards.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

function props(overrides: Partial<DeliveredCardsProps> = {}): DeliveredCardsProps {
  return {
    matched: [],
    openFile: () => {},
    openFilePreview: () => {},
    sessionId: 'sess-delivered' as SessionId,
    isLoopback: true,
    useHostDescription: selector => selector({ canOpenPath: true }),
    connection: {} as never,
    t,
    ...overrides,
  }
}

describe('DeliveredCards without a stylesheet rule for the kind', () => {
  it('still names an untinted claim and keeps its preview affordance', () => {
    const view = render(<DeliveredCards {...props({
      matched: ['docs/notes.md', 'decks/q1.xlsx'],
    })} />)

    // Both cards render; the untinted one keeps its kind label and gesture.
    expect(view.getByText('Markdown · MD')).toBeTruthy()
    expect(view.getByText('Spreadsheet · XLSX')).toBeTruthy()
    expect(view.getAllByText('预览')).toHaveLength(2)
    expect(view.getAllByRole('button', { name: '打开 docs/notes.md' })).toHaveLength(2)
  })
})
