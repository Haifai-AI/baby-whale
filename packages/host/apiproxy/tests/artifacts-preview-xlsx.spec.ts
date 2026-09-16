/**
 * XLSX grid previews: content-based header detection (banner rows, transposed
 * layouts, single-column sheets), Excel-faithful display formatting for
 * percent/currency/thousands cells, formula display for both cached and
 * uncached workbooks, and the row/column/sheet caps that keep a pathological
 * workbook cheap.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/artifacts-preview-xlsx
 */

import ExcelJS from 'exceljs'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ParsedPreview } from '../src/artifacts-preview.ts'
import { parseXlsxPreview, xlsxHasUncachedFormulas } from '../src/artifacts-preview.ts'

async function workbookBytes(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
}

/** Rewrite one part of a generated package, keeping every other part intact. */
function rewritePart(bytes: Uint8Array, part: string, rewrite: (xml: string) => string): Uint8Array {
  const entries = unzipSync(bytes)
  const payload = entries[part]
  if (payload === undefined) throw new Error(`fixture package has no ${part}`)
  entries[part] = utf8(rewrite(new TextDecoder().decode(payload)))
  return zipSync(entries)
}

function xlsxPreview(preview: ParsedPreview | undefined): Extract<ParsedPreview, { kind: 'xlsx' }> {
  if (preview?.kind !== 'xlsx') throw new Error(`expected an xlsx preview, got ${preview?.kind ?? 'undefined'}`)
  return preview
}

describe('parseXlsxPreview header detection', () => {
  it('skips an echoed banner row and takes the first row with two distinct labels', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Summary')
      sheet.addRow(['Regional rollup', 'Regional rollup', 'Regional rollup'])
      sheet.addRow(['Region', 'Revenue', 'Share'])
      sheet.addRow(['North', 120000, 0.55])
      sheet.addRow(['South', 98000, 0.35])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'reports/rollup.xlsx'))
    expect(preview.file_name).toBe('rollup.xlsx')
    expect(preview.sheets).toHaveLength(1)
    const sheet = preview.sheets[0]!
    expect(sheet.name).toBe('Summary')
    expect(sheet.header).toEqual(['Region', 'Revenue', 'Share'])
    expect(sheet.total_cols).toBe(3)
    expect(sheet.rows.map(row => row.map(cell => cell.v))).toEqual([
      ['Region', 'Revenue', 'Share'],
      ['North', '120000', '0.55'],
      ['South', '98000', '0.35'],
    ])
  })

  it('reads a transposed sheet as labels-under-values, not values-under-labels', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Transposed')
      sheet.addRow([2023, 2024, 2025])
      sheet.addRow(['North', 'South', 'East'])
      sheet.addRow([10, 20, 30])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'transposed.xlsx'))
    const sheet = preview.sheets[0]!
    expect(sheet.header).toEqual(['North', 'South', 'East'])
    expect(sheet.rows.map(row => row.map(cell => cell.v))).toEqual([
      ['North', 'South', 'East'],
      ['10', '20', '30'],
    ])
  })

  it('keeps the value row as the header when nothing follows it', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Numbers')
      sheet.addRow([1, 2, 3])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'numbers.xlsx'))
    expect(preview.sheets[0]!.header).toEqual(['1', '2', '3'])
  })

  it('falls back to the first row of a single-column sheet, which has no distinct labels', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Names')
      sheet.addRow(['Region'])
      sheet.addRow(['North'])
      sheet.addRow(['South'])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'names.xlsx'))
    const sheet = preview.sheets[0]!
    expect(sheet.header).toEqual(['Region'])
    expect(sheet.total_rows).toBe(3)
    expect(sheet.rows.map(row => row[0]?.v)).toEqual(['Region', 'North', 'South'])
  })

  it('still previews a sheet whose every scanned row is decoration', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Banner')
      sheet.addRow(['Untitled', 'Untitled'])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'banner.xlsx'))
    const sheet = preview.sheets[0]!
    expect(sheet.header).toEqual(['Untitled', 'Untitled'])
    expect(sheet.rows.map(row => row.map(cell => cell.v))).toEqual([['Untitled', 'Untitled']])
  })

  it('keeps the text header row under a numeric one even when it has a single label', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Transposed')
      sheet.addRow([2023, 2024])
      sheet.addRow(['North', ''])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'transposed.xlsx'))
    const sheet = preview.sheets[0]!
    expect(sheet.header).toEqual(['North', ''])
    expect(sheet.rows.map(row => row.map(cell => cell.v))).toEqual([['North', '']])
  })

  it('looks past a banner row to reach the header below it', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Banner')
      sheet.addRow([2023, 2024])
      sheet.addRow(['Regional rollup', 'Regional rollup'])
      sheet.addRow(['North', 'South'])
      sheet.addRow([10, 20])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'banner.xlsx'))
    expect(preview.sheets[0]!.header).toEqual(['North', 'South'])
  })

  it('skips a worksheet that carries no rows or no columns', async () => {
    const bytes = await workbookBytes((workbook) => {
      workbook.addWorksheet('Blank')
      const sheet = workbook.addWorksheet('Data')
      sheet.addRow(['Region', 'Revenue'])
      sheet.addRow(['North', 10])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'mixed.xlsx'))
    expect(preview.sheets.map(sheet => sheet.name)).toEqual(['Data'])
  })
})

describe('parseXlsxPreview formatting', () => {
  it('renders percent, currency, thousands, and fraction-free cells the way Excel displays them', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Money')
      sheet.addRow(['Item', 'Percent', 'Currency', 'Thousands', 'Fractionless', 'Textfmt', 'General', 'Plain'])
      sheet.addRow(['North', 0.55, 120000, 1234567.891, 42, 42, 7, 8])
      sheet.getCell('B2').numFmt = '0.0%'
      sheet.getCell('C2').numFmt = '$#,##0.00'
      sheet.getCell('D2').numFmt = '#,##0'
      sheet.getCell('E2').numFmt = '0.000000000'
      sheet.getCell('F2').numFmt = '@'
      sheet.getCell('G2').numFmt = 'General'
      sheet.getCell('H2').numFmt = '0'
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'money.xlsx'))
    const data = preview.sheets[0]!.rows[1]!
    expect(data.map(cell => cell.v)).toEqual([
      'North', '55.0%', '$120,000.00', '1,234,568', '42.000000', '42', '7', '8',
    ])
  })

  it('takes the decimal count from a format whose fraction part has no zeros', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Hashes')
      sheet.addRow(['Item', 'Value'])
      sheet.addRow(['North', 1234.56])
      sheet.getCell('B2').numFmt = '#.##'
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'hashes.xlsx'))
    expect(preview.sheets[0]!.rows[1]!.map(cell => cell.v)).toEqual(['North', '1,235'])
  })

  it('leaves a date-formatted numeric cell to the date renderer ExcelJS already applied', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Dates')
      sheet.addRow(['Item', 'Value'])
      sheet.addRow(['North', 45000])
      sheet.getCell('B2').numFmt = 'yyyy-mm-dd'
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'dates.xlsx'))
    expect(preview.sheets[0]!.rows[1]!.map(cell => cell.v)).toEqual(['North', '2023-03-15'])
  })

  it('formats dates, rich text, hyperlinks, booleans, and blanks as display strings', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Kinds')
      sheet.addRow(['Date', 'Rich', 'Link', 'Flag', 'Blank', 'Text'])
      sheet.getCell('A2').value = new Date(Date.UTC(2024, 0, 15))
      sheet.getCell('B2').value = { richText: [{ text: 'bold' }, { text: ' heart' }] }
      sheet.getCell('C2').value = { text: 'spec', hyperlink: 'https://example.test/spec' }
      sheet.getCell('D2').value = true
      sheet.getCell('F2').value = 'plain'
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'kinds.xlsx'))
    expect(preview.sheets[0]!.rows[1]!.map(cell => cell.v)).toEqual([
      '2024-01-15', 'bold heart', 'spec', 'true', '', 'plain',
    ])
  })

  it('caps an over-long cell with an ellipsis', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Wide')
      sheet.addRow(['Body'])
      sheet.addRow(['x'.repeat(400)])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'wide.xlsx'))
    const cell = preview.sheets[0]!.rows[1]![0]!
    expect(cell.v).toBe(`${'x'.repeat(300)}…`)
    expect(cell.v).toHaveLength(301)
  })

  it('renders an Excel error cell as an empty display value', async () => {
    const generated = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Errors')
      sheet.addRow(['Region', 'Revenue'])
      sheet.addRow(['North', 120])
    })
    const bytes = rewritePart(generated, 'xl/worksheets/sheet1.xml', xml =>
      xml.replace('<c r="B2"><v>120</v></c>', '<c r="B2"><v>120</v></c><c r="C2" t="e"><v>#N/A</v></c>'))
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'errors.xlsx'))
    expect(preview.sheets[0]!.rows[1]!.map(cell => cell.v)).toEqual(['North', '120', ''])
  })

  it('ignores rich-text runs that carry no text of their own', async () => {
    const generated = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Runs')
      sheet.addRow(['Rich'])
      sheet.getCell('A2').value = { richText: [{ text: 'kept' }, { text: '' }] }
    })
    const bytes = rewritePart(generated, 'xl/sharedStrings.xml', xml =>
      xml.replace('<r><t></t></r>', '<r></r>'))
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'runs.xlsx'))
    expect(preview.sheets[0]!.rows[1]!.map(cell => cell.v)).toEqual(['kept'])
  })
})

describe('parseXlsxPreview formulas', () => {
  it('shows the cached result of a formula cell alongside its formula text', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Calc')
      sheet.addRow(['Metric', 'Value'])
      sheet.addRow(['Total', { formula: 'B4+B5', result: 12 }])
      sheet.addRow(['Double', { formula: 'B4*2', result: 10 }])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'calc.xlsx'))
    expect(preview.sheets[0]!.rows[1]![1]).toEqual({ v: '12', f: '=B4+B5' })
    expect(preview.sheets[0]!.rows[2]![1]).toEqual({ v: '10', f: '=B4*2' })
    expect(xlsxHasUncachedFormulas(preview)).toBe(false)
  })

  it('shows the formula text itself when the workbook carries no cached result', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Calc')
      sheet.addRow(['Metric', 'Value'])
      sheet.addRow(['Total', { formula: 'B4+B5' }])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'calc.xlsx'))
    expect(preview.sheets[0]!.rows[1]![1]).toEqual({ v: '=B4+B5', f: '=B4+B5' })
    expect(xlsxHasUncachedFormulas(preview)).toBe(true)
  })

  it('reads a cloned shared formula as the address of its master', async () => {
    const generated = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Shared')
      sheet.addRow(['Metric', 'Value'])
      sheet.addRow(['One', 2])
      sheet.addRow(['Two', 4])
    })
    const bytes = rewritePart(generated, 'xl/worksheets/sheet1.xml', xml => xml
      .replace('<c r="B2"><v>2</v></c>', '<c r="B2"><f t="shared" ref="B2:B3" si="0">A2</f><v>2</v></c>')
      .replace('<c r="B3"><v>4</v></c>', '<c r="B3"><f t="shared" si="0"/></c>'))
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'shared.xlsx'))
    expect(preview.sheets[0]!.rows[1]![1]).toEqual({ v: '2', f: '=A2' })
    expect(preview.sheets[0]!.rows[2]![1]).toEqual({ v: '=B2', f: '=B2' })
  })
})

describe('parseXlsxPreview bounds', () => {
  it('flags truncation when the sheet has more rows than the cap', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Long')
      sheet.addRow(['Index'])
      for (let row = 0; row < 150; row++) sheet.addRow([row])
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'long.xlsx'))
    expect(preview.truncated).toBe(true)
    expect(preview.sheets[0]!.rows).toHaveLength(100)
    expect(preview.sheets[0]!.total_rows).toBe(151)
  })

  it('flags truncation when the sheet is wider than the column cap', async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet('Wide')
      sheet.getCell('A1').value = 'first'
      sheet.getCell('BM1').value = 'last'
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'wide.xlsx'))
    expect(preview.truncated).toBe(true)
    expect(preview.sheets[0]!.total_cols).toBeGreaterThan(60)
    expect(preview.sheets[0]!.header).toHaveLength(60)
  })

  it('flags truncation when the workbook carries more sheets than the cap', async () => {
    const bytes = await workbookBytes((workbook) => {
      for (let index = 1; index <= 10; index++) {
        const sheet = workbook.addWorksheet(`Sheet${String(index)}`)
        sheet.addRow(['Region', 'Revenue'])
        sheet.addRow(['North', index])
      }
    })
    const preview = xlsxPreview(await parseXlsxPreview(bytes, 'many.xlsx'))
    expect(preview.truncated).toBe(true)
    expect(preview.sheets).toHaveLength(8)
  })
})

describe('parseXlsxPreview refusal', () => {
  it('returns undefined for bytes that are not a workbook', async () => {
    await expect(parseXlsxPreview(utf8('not a zip at all'), 'broken.xlsx')).resolves.toBeUndefined()
  })

  it('returns undefined when every worksheet is empty', async () => {
    const bytes = await workbookBytes((workbook) => {
      workbook.addWorksheet('Blank')
      workbook.addWorksheet('Also blank')
    })
    await expect(parseXlsxPreview(bytes, 'empty.xlsx')).resolves.toBeUndefined()
  })
})

describe('xlsxHasUncachedFormulas', () => {
  it('is false for previews that are not xlsx at all', () => {
    expect(xlsxHasUncachedFormulas({ kind: 'text', file_name: 'x.ts', text: '', truncated: false })).toBe(false)
    expect(xlsxHasUncachedFormulas({ kind: 'video', file_name: 'clip.mp4' })).toBe(false)
  })

  it('is false when every formula cell was persisted with its computed result', () => {
    expect(xlsxHasUncachedFormulas({
      kind: 'xlsx',
      file_name: 'cached.xlsx',
      truncated: false,
      sheets: [{
        name: 'Calc',
        header: ['Value'],
        total_rows: 1,
        total_cols: 1,
        rows: [[{ v: '12', f: '=B4+B5' }]],
      }],
    })).toBe(false)
  })

  it('is true as soon as one cell shows its formula text in place of a value', () => {
    expect(xlsxHasUncachedFormulas({
      kind: 'xlsx',
      file_name: 'uncached.xlsx',
      truncated: false,
      sheets: [{
        name: 'Calc',
        header: ['Value'],
        total_rows: 1,
        total_cols: 1,
        rows: [[{ v: '12' }, { v: '=B4+B5', f: '=B4+B5' }]],
      }],
    })).toBe(true)
  })
})
