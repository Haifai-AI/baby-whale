// @vitest-environment jsdom
/**
 * Artifact card content rules: numbered document blocks number among
 * themselves (headings and paragraphs must not shift the sequence), and
 * long slide bullet lists cap with an overflow note.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OfficeArtifactCard, type OfficeArtifactCardProps } from '../src/client/OfficeArtifactCard.tsx'
import { zh, type WhaleArtifactKey } from '../src/client/locales.ts'
import type { OfficePreviewData } from '../src/client/whale-preview.ts'

afterEach(cleanup)

/** Minimal interpolating translator over the real zh dictionary. */
const t = (key: WhaleArtifactKey, params?: Record<string, unknown>): string => {
  const template: string = zh[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

function propsOf(preview: OfficePreviewData): OfficeArtifactCardProps {
  return {
    callId: 'c1',
    toolName: 'docx_create',
    block: {
      kind: 'tool-call',
      isError: false,
      meta: { preview, size: 12 },
      call: { name: 'docx_create', argsRaw: '{"file_path":"deliverables/report.docx"}' },
    },
    openFile: () => {},
    openDetails: undefined,
    t,
  } as unknown as OfficeArtifactCardProps
}

describe('OfficeArtifactCard document numbering', () => {
  it('numbers numbered blocks among themselves, ignoring other blocks', () => {
    render(<OfficeArtifactCard {...propsOf({
      kind: 'docx',
      file_name: 'report.docx',
      truncated: false,
      title: 'Q2',
      blocks: [
        { type: 'heading1', text: 'Title' },
        { type: 'paragraph', text: 'intro' },
        { type: 'number', text: 'first' },
        { type: 'number', text: 'second' },
      ],
    })} />)
    expect(screen.getByText('1. first')).toBeTruthy()
    expect(screen.getByText('2. second')).toBeTruthy()
    expect(screen.queryByText('3. second')).toBeNull()
    expect(screen.queryByText('4. second')).toBeNull()
  })
})

describe('OfficeArtifactCard slide bullets', () => {
  it('caps long bullet lists with an overflow note', () => {
    render(<OfficeArtifactCard {...propsOf({
      kind: 'pptx',
      file_name: 'deck.pptx',
      truncated: false,
      title: 'Deck',
      slides: [{ title: 'S1', bullets: Array.from({ length: 15 }, (_, index) => `b${index}`) }],
    })} />)
    expect(document.querySelectorAll('li')).toHaveLength(12)
    expect(screen.getByText('还有 3 条')).toBeTruthy()
  })

  it('renders short bullet lists without an overflow note', () => {
    render(<OfficeArtifactCard {...propsOf({
      kind: 'pptx',
      file_name: 'deck.pptx',
      truncated: false,
      title: 'Deck',
      slides: [{ title: 'S1', bullets: ['a', 'b'] }],
    })} />)
    expect(document.querySelectorAll('li')).toHaveLength(2)
    expect(screen.queryByText(/还有/)).toBeNull()
  })
})
