/**
 * PPTX and DOCX previews: shape/paragraph harvesting out of the OPC package
 * XML — slide titles and bullets from the placeholder marking, document
 * blocks from paragraph styles, list numbering, tables, and runs.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/artifacts-preview-office
 */

import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ParsedPreview } from '../src/artifacts-preview.ts'
import { parseDocxPreview, parsePptxPreview } from '../src/artifacts-preview.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Minimal OPC package carrying the given parts. */
function packageOf(parts: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, xml] of Object.entries(parts)) entries[name] = utf8(xml)
  return zipSync(entries)
}

function slide(body: string): string {
  return `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
}

/** One shape; `placeholder` becomes the `<p:ph>` marking when given. */
function shape(placeholder: string | undefined, paragraphs: string[]): string {
  const marking = placeholder === undefined ? '' : `<p:nvPr><p:ph type="${placeholder}"/></p:nvPr>`
  const body = paragraphs
    .map(runs => `<a:p>${runs.split('|').map(run => `<a:r><a:t>${run}</a:t></a:r>`).join('')}</a:p>`)
    .join('')
  return `<p:sp><p:nvSpPr>${marking}</p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`
}

function pptxPreview(preview: ParsedPreview | undefined): Extract<ParsedPreview, { kind: 'pptx' }> {
  if (preview?.kind !== 'pptx') throw new Error(`expected a pptx preview, got ${preview?.kind ?? 'undefined'}`)
  return preview
}

function docxPreview(preview: ParsedPreview | undefined): Extract<ParsedPreview, { kind: 'docx' }> {
  if (preview?.kind !== 'docx') throw new Error(`expected a docx preview, got ${preview?.kind ?? 'undefined'}`)
  return preview
}

describe('parsePptxPreview', () => {
  it('harvests an explicit title placeholder and the body bullets under it', () => {
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide([
        shape('title', ['Quarterly &amp; annual review']),
        shape('body', ['Revenue up 12%', 'Churn flat']),
      ].join('')),
    })
    expect(parsePptxPreview(bytes, 'decks/review.pptx')).toEqual({
      kind: 'pptx',
      file_name: 'review.pptx',
      title: 'Quarterly & annual review',
      slides: [{ title: 'Quarterly & annual review', bullets: ['Revenue up 12%', 'Churn flat'] }],
      truncated: false,
    })
  })

  it('accepts the centered-title placeholder marking too', () => {
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide(shape('ctrTitle', ['Opening'])),
    })
    expect(pptxPreview(parsePptxPreview(bytes, 'deck.pptx')).title).toBe('Opening')
  })

  it('promotes the first bullet line to the title when no placeholder is marked', () => {
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide(shape(undefined, ['Agenda', 'Item one', 'Item two'])),
    })
    expect(pptxPreview(parsePptxPreview(bytes, 'deck.pptx')).slides).toEqual([
      { title: 'Agenda', bullets: ['Item one', 'Item two'] },
    ])
  })

  it('joins the runs of one paragraph and collapses their whitespace', () => {
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide(shape('title', ['Split', 'across   runs'])),
    })
    const preview = pptxPreview(parsePptxPreview(bytes, 'deck.pptx'))
    expect(preview.title).toBe('Split across runs')
    expect(preview.slides[0]).toEqual({ title: 'Split across runs' })
  })

  it('keeps a second title-marked shape as body content', () => {
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide([
        shape('title', ['Real title']),
        shape('title', ['Shadow title']),
      ].join('')),
    })
    expect(pptxPreview(parsePptxPreview(bytes, 'deck.pptx')).slides).toEqual([
      { title: 'Real title', bullets: ['Shadow title'] },
    ])
  })

  it('skips shapes with no paragraphs and slides with no text at all', () => {
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide(`${shape('title', ['Kept'])}<p:sp><p:txBody></p:txBody></p:sp>`),
      'ppt/slides/slide2.xml': slide(''),
    })
    const preview = pptxPreview(parsePptxPreview(bytes, 'deck.pptx'))
    expect(preview.slides).toEqual([{ title: 'Kept' }])
  })

  it('orders slides numerically rather than by their file-name spelling', () => {
    const bytes = packageOf({
      'ppt/slides/slide10.xml': slide(shape('title', ['Tenth'])),
      'ppt/slides/slide2.xml': slide(shape('title', ['Second'])),
      'ppt/slides/slide1.xml': slide(shape('title', ['First'])),
    })
    const preview = pptxPreview(parsePptxPreview(bytes, 'deck.pptx'))
    expect(preview.slides.map(entry => entry.title)).toEqual(['First', 'Second', 'Tenth'])
    expect(preview.title).toBe('First')
  })

  it('caps the harvest at one slide page of content', () => {
    const parts: Record<string, string> = {}
    for (let index = 1; index <= 30; index++) {
      parts[`ppt/slides/slide${String(index)}.xml`] = slide(shape('title', [`Slide ${String(index)}`]))
    }
    const bytes = packageOf(parts)
    expect(pptxPreview(parsePptxPreview(bytes, 'deck.pptx')).slides).toHaveLength(24)
  })

  it('keeps at most a dozen bullets per slide', () => {
    const bullets = Array.from({ length: 15 }, (_, index) => `Point ${String(index)}`)
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide(shape('body', bullets)),
    })
    const preview = pptxPreview(parsePptxPreview(bytes, 'deck.pptx'))
    // Twelve lines are kept; the first of them is promoted to the title.
    expect(preview.title).toBe('Point 0')
    expect(preview.slides[0]!.bullets).toHaveLength(11)
    expect(preview.slides[0]!.bullets?.at(-1)).toBe('Point 11')
  })

  it('caps an over-long title with an ellipsis', () => {
    const bytes = packageOf({
      'ppt/slides/slide1.xml': slide(shape('title', ['t'.repeat(700)])),
    })
    expect(pptxPreview(parsePptxPreview(bytes, 'deck.pptx')).title).toBe(`${'t'.repeat(600)}…`)
  })

  it('returns undefined when the package carries no slide parts', () => {
    const bytes = packageOf({ 'docProps/app.xml': '<Properties/>' })
    expect(parsePptxPreview(bytes, 'deck.pptx')).toBeUndefined()
  })

  it('returns undefined for bytes that are not a package', () => {
    expect(parsePptxPreview(utf8('not a zip'), 'deck.pptx')).toBeUndefined()
  })
})

describe('parseDocxPreview', () => {
  const document = (body: string): string =>
    `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`

  it('maps heading styles, quotes, and list paragraphs to their block types', () => {
    const bytes = packageOf({
      'word/document.xml': document([
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Detail</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Fine print</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>Quoted line</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Plain bullet</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>1. Numbered</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Body copy</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Body</w:t></w:r><w:tab/><w:r><w:t>tabbed</w:t></w:r></w:p>',
      ].join('')),
    })
    const preview = docxPreview(parseDocxPreview(bytes, 'notes/brief.docx'))
    expect(preview.file_name).toBe('brief.docx')
    expect(preview.blocks).toEqual([
      { type: 'heading1', text: 'Overview' },
      { type: 'heading2', text: 'Detail' },
      { type: 'heading3', text: 'Fine print' },
      { type: 'quote', text: 'Quoted line' },
      { type: 'bullet', text: 'Plain bullet' },
      { type: 'number', text: '1. Numbered' },
      { type: 'paragraph', text: 'Body copy' },
      { type: 'paragraph', text: 'Body tabbed' },
    ])
    expect(preview.truncated).toBe(false)
  })

  it('joins table rows into one table block and drops empty ones', () => {
    const bytes = packageOf({
      'word/document.xml': document([
        '<w:tbl>',
        '<w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rev</w:t></w:r></w:p></w:tc></w:tr>',
        '<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>|</w:t></w:r></w:p></w:tc></w:tr>',
        '</w:tbl>',
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>|</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      ].join('')),
    })
    const preview = docxPreview(parseDocxPreview(bytes, 'table.docx'))
    expect(preview.blocks).toEqual([{ type: 'table', text: 'Region Rev\nNorth |' }])
  })

  it('drops paragraphs whose runs carry no text', () => {
    const bytes = packageOf({
      'word/document.xml': document([
        '<w:p><w:r><w:t>Kept</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>   </w:t></w:r></w:p>',
        '<w:p><w:tab/></w:p>',
      ].join('')),
    })
    expect(docxPreview(parseDocxPreview(bytes, 'sparse.docx')).blocks).toEqual([
      { type: 'paragraph', text: 'Kept' },
    ])
  })

  it('caps an over-long paragraph with an ellipsis', () => {
    const bytes = packageOf({
      'word/document.xml': document(`<w:p><w:r><w:t>${'b'.repeat(700)}</w:t></w:r></w:p>`),
    })
    expect(docxPreview(parseDocxPreview(bytes, 'long.docx')).blocks).toEqual([
      { type: 'paragraph', text: `${'b'.repeat(600)}…` },
    ])
  })

  it('stops after the block cap on a document with far more paragraphs', () => {
    const body = Array.from({ length: 450 }, (_, index) => `<w:p><w:r><w:t>Line ${String(index)}</w:t></w:r></w:p>`).join('')
    const bytes = packageOf({ 'word/document.xml': document(body) })
    expect(docxPreview(parseDocxPreview(bytes, 'huge.docx')).blocks).toHaveLength(400)
  })

  it('returns undefined when the package has no document part', () => {
    expect(parseDocxPreview(packageOf({ 'word/styles.xml': '<w:styles/>' }), 'brief.docx')).toBeUndefined()
  })

  it('returns undefined when the document body carries no readable block', () => {
    const bytes = packageOf({ 'word/document.xml': document('<w:p><w:r><w:t></w:t></w:r></w:p>') })
    expect(parseDocxPreview(bytes, 'blank.docx')).toBeUndefined()
  })

  it('returns undefined for bytes that are not a package', () => {
    expect(parseDocxPreview(utf8('not a zip'), 'brief.docx')).toBeUndefined()
  })
})
