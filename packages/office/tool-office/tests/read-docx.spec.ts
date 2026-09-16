/**
 * docx_text extraction behavior: style mapping for headings, lists, plain
 * paragraphs and table rows, tab and entity decoding, and the character budget
 * over real OPC packages.
 * @module @deepseek-ai/dsh-tool-office/tests/read-docx
 */

import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodeEntities, extractDocxText } from '../src/read-docx.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

const BODY_OPEN = '<?xml version="1.0"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
const BODY_CLOSE = '</w:body></w:document>'

/** One minimal OPC package carrying the given document body. */
function docxBytes(body: string): Parameters<typeof extractDocxText>[0] {
  return zipSync({ 'word/document.xml': utf8(`${BODY_OPEN}${body}${BODY_CLOSE}`) })
}

describe('docx_text core', () => {
  it('maps title, heading, numbered-list, and plain paragraph styles', () => {
    const model = extractDocxText(docxBytes(`
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Revenue</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="heading3"/></w:pPr><w:r><w:t>By region</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>1. First</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Unnumbered</w:t></w:r></w:p>
<w:p><w:r><w:t>Closing note</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>`))
    expect(model.paragraphs).toEqual([
      { style: 'title', text: 'Quarterly' },
      { style: 'heading2', text: 'Revenue' },
      { style: 'heading3', text: 'By region' },
      { style: 'number', text: '1. First' },
      { style: 'bullet', text: 'Unnumbered' },
      { style: 'paragraph', text: 'Closing note' },
      { style: 'heading1', text: '' },
    ])
    expect(model.char_count).toBe(9 + 7 + 9 + 8 + 10 + 12)
    expect(model.truncated).toBe(false)
  })

  it('decodes entities and folds a tab run into single spaces', () => {
    const model = extractDocxText(docxBytes(
      '<w:p><w:r><w:t>a &amp; b</w:t><w:tab/><w:t>&lt;tag&gt; &#8212; &quot;q&quot;</w:t></w:r></w:p>',
    ))
    expect(model.paragraphs).toEqual([{ style: 'paragraph', text: 'a & b <tag> — "q"' }])
  })

  it('joins table rows with pipes and skips rows without text', () => {
    const model = extractDocxText(docxBytes(`
<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rev</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>`))
    expect(model.paragraphs).toEqual([{ style: 'table-cell', text: 'Region | Rev\nNorth | 10' }])
    expect(model.char_count).toBe('Region | Rev\nNorth | 10'.length)
  })

  it('stops at the first block that reaches the character budget', () => {
    const model = extractDocxText(docxBytes(`
<w:p><w:r><w:t>First block of text</w:t></w:r></w:p>
<w:p><w:r><w:t>Second block of text</w:t></w:r></w:p>`), 5)
    expect(model.paragraphs).toEqual([{ style: 'paragraph', text: 'First block of text' }])
    expect(model.char_count).toBe('First block of text'.length)
    expect(model.truncated).toBe(false)
  })

  it('reads a document with no paragraphs as an empty model', () => {
    const model = extractDocxText(docxBytes(''))
    expect(model).toEqual({ paragraphs: [], char_count: 0, truncated: false })
  })
})

describe('entity decoding', () => {
  it('decodes named and numeric entities with ampersands last', () => {
    expect(decodeEntities('a &amp;lt; b &#8212; &quot;q&quot; &apos;s&apos; &gt; &lt;'))
      .toBe('a &lt; b — "q" \'s\' > <')
    expect(decodeEntities('plain')).toBe('plain')
  })
})
