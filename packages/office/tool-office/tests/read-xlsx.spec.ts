/**
 * xlsx/csv extraction behavior: bounded per-sheet sampling of real ExcelJS
 * workbooks (headers, banner titles, row/column budgets, merges), the
 * drawing-reference recovery reload, and RFC-4180 CSV parsing with delimiter
 * sniffing over hostile-ish delimited text.
 * @module @deepseek-ai/dsh-tool-office/tests/read-xlsx
 */

import ExcelJS from 'exceljs'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseCsvText, parseXlsxBytes } from '../src/read-xlsx.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Build one workbook from a caller-supplied worksheet layout. */
async function workbookBytes(build: (book: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  build(book)
  return new Uint8Array(await book.xlsx.writeBuffer())
}

/** The sheet relationship an openpyxl chart workbook carries without its drawing part. */
const DANGLING_DRAWING_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
  + '</Relationships>'

/**
 * Rewrite a two-sheet workbook into the openpyxl chart layout exceljs 4.4
 * crashes on: the first sheet references a drawing part that the package does
 * not contain, while the second sheet has no drawing reference at all.
 */
async function chartedWorkbookBytes(options: { breakRowRefs?: boolean } = {}): Promise<Uint8Array> {
  const parts = unzipSync(await workbookBytes((book) => {
    const charted = book.addWorksheet('Charted')
    charted.addRow(['Region', 'Revenue'])
    charted.addRow(['North', 10])
    book.addWorksheet('Plain').addRow(['Label'])
  }))
  const texts = new Map(Object.entries(parts).map(([name, payload]) => [name, new TextDecoder().decode(payload)]))
  const sheetXml = texts.get('xl/worksheets/sheet1.xml')
  if (sheetXml === undefined) throw new Error('generated workbook has no first worksheet part')
  const withDrawing = sheetXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>')
  texts.set('xl/worksheets/sheet1.xml', options.breakRowRefs === true ? withDrawing.replace('<row r="1"', '<row r="!!!"') : withDrawing)
  texts.set('xl/worksheets/_rels/sheet1.xml.rels', DANGLING_DRAWING_RELS)
  return zipSync(Object.fromEntries([...texts].map(([name, text]) => [name, utf8(text)])))
}

describe('xlsx_read core over generated workbooks', () => {
  it('reads a header row and the data rows that follow it', async () => {
    const bytes = await workbookBytes((book) => {
      const sheet = book.addWorksheet('Plain')
      sheet.addRow(['Region', 'Revenue'])
      sheet.addRow(['North', 120000])
      sheet.addRow(['South', 98000])
    })
    const parsed = await parseXlsxBytes(bytes)
    expect(parsed.sheet_count).toBe(1)
    expect(parsed.truncated).toBe(false)
    const sheet = parsed.sheets[0]!
    expect(sheet.name).toBe('Plain')
    expect(sheet.header).toEqual(['Region', 'Revenue'])
    expect(sheet.title).toBeUndefined()
    expect(sheet.merged_ranges).toBeUndefined()
    expect(sheet.total_rows).toBe(2)
    expect(sheet.total_cols).toBe(2)
    expect(sheet.rows).toEqual([['North', 120000], ['South', 98000]])
    expect(sheet.column_types).toEqual([{ col: 'A', kind: 'text' }, { col: 'B', kind: 'number' }])
  })

  it('treats a first row holding a non-text cell as data instead of a header', async () => {
    const bytes = await workbookBytes((book) => {
      const sheet = book.addWorksheet('Data')
      sheet.addRow([2024, 2025])
      sheet.addRow(['North', 10])
    })
    const sheet = (await parseXlsxBytes(bytes)).sheets[0]!
    expect(sheet.header).toBeUndefined()
    expect(sheet.rows).toEqual([[2024, 2025], ['North', 10]])
    expect(sheet.total_rows).toBe(2)
    expect(sheet.column_types[0]?.kind).toBe('text')
    expect(sheet.column_types[1]?.kind).toBe('number')
  })

  it('reports a worksheet that has no rows or columns as empty', async () => {
    const bytes = await workbookBytes((book) => {
      book.addWorksheet('Empty')
      book.addWorksheet('Filled').addRow(['x', 1])
    })
    const parsed = await parseXlsxBytes(bytes)
    expect(parsed.sheet_count).toBe(2)
    expect(parsed.sheets[0]).toEqual({ name: 'Empty', total_rows: 0, total_cols: 0, rows: [], column_types: [] })
    expect(parsed.sheets[1]?.rows).toEqual([['x', 1]])
  })

  it('samples only the requested number of rows and flags the truncation', async () => {
    const bytes = await workbookBytes((book) => {
      const sheet = book.addWorksheet('Sales')
      sheet.addRow(['Region'])
      for (const region of ['North', 'South', 'East', 'West', 'Centre']) sheet.addRow([region])
    })
    const parsed = await parseXlsxBytes(bytes, 2)
    expect(parsed.truncated).toBe(true)
    const sheet = parsed.sheets[0]!
    expect(sheet.rows).toEqual([['North'], ['South']])
    expect(sheet.total_rows).toBe(5)
  })

  it('caps the sampled columns at the column budget and flags the truncation', async () => {
    const bytes = await workbookBytes((book) => {
      book.addWorksheet('Wide').addRow(Array.from({ length: 70 }, (_, index) => index + 1))
    })
    const parsed = await parseXlsxBytes(bytes)
    expect(parsed.truncated).toBe(true)
    const sheet = parsed.sheets[0]!
    expect(sheet.total_cols).toBe(70)
    expect(sheet.column_types).toHaveLength(64)
    expect(sheet.column_types.at(-1)?.col).toBe('BL')
    expect(sheet.rows[0]).toHaveLength(64)
  })

  it('reads a one-row sheet as a header without sampling any data row', async () => {
    const bytes = await workbookBytes((book) => {
      book.addWorksheet('One').addRow(['Only'])
    })
    const sheet = (await parseXlsxBytes(bytes)).sheets[0]!
    expect(sheet.header).toEqual(['Only'])
    expect(sheet.rows).toEqual([])
    expect(sheet.total_rows).toBe(0)
  })

  it('reads a banner title and header from rows one and two of a merged sheet', async () => {
    const bytes = await workbookBytes((book) => {
      const sheet = book.addWorksheet('Banner')
      sheet.mergeCells('A1:C1')
      sheet.getCell('A1').value = 'Regional rollup'
      sheet.getRow(2).values = ['Region', 'Revenue', 'Share']
      sheet.addRow(['North', 120000, 0.55])
    })
    const sheet = (await parseXlsxBytes(bytes)).sheets[0]!
    expect(sheet.title).toBe('Regional rollup')
    expect(sheet.header).toEqual(['Region', 'Revenue', 'Share'])
    expect(sheet.rows).toEqual([['North', 120000, 0.55]])
    expect(sheet.merged_ranges).toEqual(['A1:C1'])
  })

  it('leaves the banner title empty when the merged first row carries no text', async () => {
    const bytes = await workbookBytes((book) => {
      const sheet = book.addWorksheet('Banner')
      sheet.mergeCells('A1:B1')
      sheet.getRow(2).values = ['Region', 'Revenue']
      sheet.addRow(['North', 10])
    })
    const sheet = (await parseXlsxBytes(bytes)).sheets[0]!
    expect(sheet.title).toBe('')
    expect(sheet.header).toEqual(['Region', 'Revenue'])
    expect(sheet.rows).toEqual([['North', 10]])
  })

  it('falls back to a non-text banner cell when no string cell exists on row one', async () => {
    const bytes = await workbookBytes((book) => {
      const sheet = book.addWorksheet('Banner')
      sheet.getCell('A1').value = 2024
      sheet.mergeCells('A1:B1')
      sheet.getRow(2).values = ['Region', 'Revenue']
      sheet.addRow(['North', 10])
    })
    const sheet = (await parseXlsxBytes(bytes)).sheets[0]!
    expect(sheet.title).toBe('')
    expect(sheet.header).toEqual(['Region', 'Revenue'])
  })

  it('reloads a workbook whose drawing relationship has no drawing part', async () => {
    const parsed = await parseXlsxBytes(await chartedWorkbookBytes())
    expect(parsed.sheet_count).toBe(2)
    expect(parsed.sheets[0]?.name).toBe('Charted')
    expect(parsed.sheets[0]?.header).toEqual(['Region', 'Revenue'])
    expect(parsed.sheets[0]?.rows).toEqual([['North', 10]])
    expect(parsed.sheets[1]?.header).toEqual(['Label'])
  })

  it('rejects a workbook that still fails after the drawing parts are stripped', async () => {
    await expect(parseXlsxBytes(await chartedWorkbookBytes({ breakRowRefs: true })))
      .rejects.toThrow('unreadable workbook')
  })

  it('rejects bytes that are not a workbook package', async () => {
    await expect(parseXlsxBytes(utf8('region,revenue\nNorth,10\n'))).rejects.toThrow('unreadable workbook')
  })
})

describe('csv_read core', () => {
  it('returns an empty sheet for text without any field', () => {
    expect(parseCsvText('')).toEqual({ name: 'csv', total_rows: 0, total_cols: 0, rows: [], column_types: [], truncated: false })
    expect(parseCsvText('\n\n').total_rows).toBe(0)
  })

  it('sniffs tab and pipe delimiters from the first line', () => {
    const tsv = parseCsvText('name\tscore\nAna\t41\n', 10)
    expect(tsv.header).toEqual(['name', 'score'])
    expect(tsv.rows).toEqual([['Ana', 41]])
    const piped = parseCsvText('name|score\nAna|41\n', 10)
    expect(piped.header).toEqual(['name', 'score'])
    expect(piped.rows).toEqual([['Ana', 41]])
  })

  it('keeps the comma default when the first line holds no candidate delimiter', () => {
    const sheet = parseCsvText('name\nAna\nBob\n', 10)
    expect(sheet.header).toEqual(['name'])
    expect(sheet.total_cols).toBe(1)
    expect(sheet.rows).toEqual([['Ana'], ['Bob']])
  })

  it('ignores delimiters inside a quoted first line', () => {
    const sheet = parseCsvText('"name;legal";score\n"Smith; Jr";41\n', 10)
    expect(sheet.header).toEqual(['name;legal', 'score'])
    expect(sheet.rows).toEqual([['Smith; Jr', 41]])
  })

  it('keeps a newline inside a quoted field in that field', () => {
    const sheet = parseCsvText('region,note\nNorth,"line one\nline two"\n', 10)
    expect(sheet.header).toEqual(['region', 'note'])
    expect(sheet.rows).toEqual([['North', 'line one\nline two']])
  })

  it('strips the carriage return of CRLF rows', () => {
    const sheet = parseCsvText('region,revenue\r\nNorth,10\r\n', 10)
    expect(sheet.header).toEqual(['region', 'revenue'])
    expect(sheet.rows).toEqual([['North', 10]])
  })

  it('fills the missing trailing columns of a ragged row with empty cells', () => {
    const sheet = parseCsvText('a,b,c\n1\n2,3,4\n', 10)
    expect(sheet.total_cols).toBe(3)
    expect(sheet.rows).toEqual([[1, '', ''], [2, 3, 4]])
    expect(sheet.column_types.map(entry => entry.kind)).toEqual(['number', 'number', 'number'])
  })

  it('coerces bare numeric tokens and leaves text intact', () => {
    const sheet = parseCsvText('amount,label\n-3.5,net\n1e3,gross\n12345678901234567,long\nabc,text\n', 10)
    expect(sheet.rows).toEqual([[-3.5, 'net'], [1000, 'gross'], ['12345678901234567', 'long'], ['abc', 'text']])
    expect(sheet.column_types[0]?.kind).toBe('text')
    expect(sheet.column_types[1]?.kind).toBe('text')
  })

  it('flags truncation when the file exceeds the row budget', () => {
    const sheet = parseCsvText('region\nNorth\nSouth\nEast\n', 2)
    expect(sheet.truncated).toBe(true)
    expect(sheet.rows).toEqual([['North'], ['South']])
    expect(sheet.total_rows).toBe(3)
  })

  it('flags truncation when the file exceeds the column budget', () => {
    const sheet = parseCsvText(`${Array.from({ length: 70 }, (_, index) => `c${index}`).join(',')}\n`, 10)
    expect(sheet.truncated).toBe(true)
    expect(sheet.total_cols).toBe(70)
    expect(sheet.column_types).toHaveLength(64)
    expect(sheet.column_types.at(-1)?.col).toBe('BL')
  })

  it('keeps an unterminated quoted field as literal text', () => {
    const sheet = parseCsvText('region,note\nNorth,"unterminated', 10)
    expect(sheet.header).toEqual(['region', 'note'])
    expect(sheet.rows).toEqual([['North', 'unterminated']])
  })
})
