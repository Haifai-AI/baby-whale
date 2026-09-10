/**
 * Reader contract tests: the extraction cores round-trip real generated
 * artifacts (xlsx), survive hostile-ish delimited text, and reconstruct
 * docx structure from package XML.
 * @module @deepseek-ai/dsh-tool-office/tests/read-tools
 */

import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseCsvText, parseXlsxBytes } from '../src/read-xlsx.ts'
import { extractDocxText } from '../src/read-docx.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('xlsx_read core', () => {
  it('round-trips a generated workbook including formulas, merges, and banner detection', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Summary')
    ws.mergeCells('A1:C1')
    ws.getCell('A1').value = 'Regional rollup'
    const header = ws.addRow(['Region', 'Revenue', 'Share'])
    header.font = { bold: true }
    ws.addRow(['North', 120000, { formula: 'B4/B6', result: 0.55 }])
    ws.addRow(['South', 98000, 0.35])
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const parsed = await parseXlsxBytes(bytes, 50)
    expect(parsed.sheet_count).toBe(1)
    const sheet = parsed.sheets[0]!
    expect(sheet.name).toBe('Summary')
    expect(sheet.title).toBe('Regional rollup')
    expect(sheet.header).toEqual(['Region', 'Revenue', 'Share'])
    expect(sheet.rows[0]).toEqual(['North', 120000, { formula: '=B4/B6' }])
    expect(sheet.column_types.find(c => c.col === 'B')?.kind).toBe('number')
    expect((sheet.merged_ranges ?? []).some(m => m.startsWith('A1:'))).toBe(true)
  })
})

describe('csv reader', () => {
  it('sniffs semicolons, honors quotes, and coerces numbers', () => {
    const sheet = parseCsvText('name;score;note\n"Smith; Jr";41;"ok"\nAna;39.5;"said ""hi"""\n', 10)
    expect(sheet.header).toEqual(['name', 'score', 'note'])
    expect(sheet.rows[0]).toEqual(['Smith; Jr', 41, 'ok'])
    expect(sheet.rows[1]?.[1]).toBe(39.5)
    expect(sheet.rows[1]?.[2]).toBe('said "hi"')
  })

  it('flags truncation against small budgets', () => {
    const text = Array.from({ length: 12 }, (_, i) => `row${i},`).join('\n')
    const sheet = parseCsvText(text, 5)
    expect(sheet.truncated).toBe(true)
    expect(sheet.rows.length).toBe(5)
  })
})

describe('docx_text core', () => {
  it('reconstructs headings, lists, and table rows from a real package', () => {
    // Deterministic minimal OPC package carrying known structure (heading +
    // list item + one table) to exercise style mapping precisely.
    const entries: Record<string, Uint8Array> = {}
    entries['word/document.xml'] = utf8(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Grew by 12%</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rev</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`)
    const rebuilt = zipSync(entries) as unknown as Parameters<typeof extractDocxText>[0]
    const model = extractDocxText(rebuilt)
    expect(model.truncated).toBe(false)
    expect(model.paragraphs[0]).toEqual({ style: 'heading1', text: 'Overview' })
    expect(model.paragraphs[1]).toEqual({ style: 'bullet', text: 'Grew by 12%' })
    const tableParagraph = model.paragraphs.find(p => p.style === 'table-cell')
    expect(tableParagraph?.text).toContain('Region | Rev')
    expect(tableParagraph?.text).toContain('North | 10')
  })

  it('throws on non-docx payloads', () => {
    const notDocx = zipSync({ 'hello.txt': utf8('hi') })
    expect(() => extractDocxText(notDocx)).toThrow(/missing word\/document\.xml/)
  })
})
