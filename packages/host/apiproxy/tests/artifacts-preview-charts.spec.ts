/**
 * Workbook chart extraction: chart part XML becomes the Charts-tab payload —
 * chart type (including Calc's horizontal-bar variant and scatter's numeric
 * x axis), cached series caches when the writer supplied them, and a
 * resolve-against-the-worksheet fallback when it did not. Chart parts are
 * mapped back to the sheet they are anchored to through the drawing
 * relationship chain.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/artifacts-preview-charts
 */

import ExcelJS from 'exceljs'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { PreviewChart } from '../src/artifacts-preview.ts'
import { parseXlsxCharts } from '../src/artifacts-preview.ts'

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
}

/** A package carrying only the given parts. */
function packageOf(parts: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, xml] of Object.entries(parts)) entries[name] = utf8(xml)
  return zipSync(entries)
}

/** Add or replace parts inside an already valid package. */
function withParts(bytes: Uint8Array, parts: Record<string, string>): Uint8Array {
  const entries = unzipSync(bytes)
  for (const [name, xml] of Object.entries(parts)) entries[name] = utf8(xml)
  return zipSync(entries)
}

function chartSpace(plot: string, title?: string): string {
  const titleBlock = title === undefined
    ? ''
    : `<c:title><c:tx><c:rich><a:p>${title
      .split('|')
      .map(run => `<a:r><a:t>${run}</a:t></a:r>`)
      .join('')}</a:p></c:rich></c:tx></c:title>`
  return `<?xml version="1.0"?><c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart>${titleBlock}<c:plotArea>${plot}</c:plotArea></c:chart></c:chartSpace>`
}

/** One `<c:ser>` carrying pre-computed caches, exactly as PowerPoint writes them. */
function cachedSeries(name: string, categories: string[], values: number[]): string {
  const points = (list: string[]): string =>
    list.map((value, index) => `<c:pt idx="${String(index)}"><c:v>${value}</c:v></c:pt>`).join('')
  return [
    '<c:ser>',
    `<c:tx><c:strRef><c:f>Data!$B$1</c:f><c:strCache>${points([name])}</c:strCache></c:strRef></c:tx>`,
    `<c:cat><c:strRef><c:f>Data!$A$2:$A$${String(categories.length + 1)}</c:f><c:strCache>${points(categories)}</c:strCache></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>Data!$B$2:$B$${String(values.length + 1)}</c:f><c:numCache>${points(values.map(String))}</c:numCache></c:numRef></c:val>`,
    '</c:ser>',
  ].join('')
}

/** A workbook whose sheet is named `name` and holds `rows` at A1. */
async function workbookBytes(sheetName: string, rows: Array<Array<string | number>>): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  for (const row of rows) sheet.addRow(row)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** Route `xl/worksheets/sheet1.xml` → drawing → chart so the sheet name resolves. */
function anchorChart(bytes: Uint8Array, chartParts: string[]): Uint8Array {
  const drawingRels = chartParts
    .map((part, index) => `<Relationship Id="rIdC${String(index + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../${part.replace(/^xl\//, '')}"/>`)
    .join('')
  const drawingId = 'rIdD1'
  return withParts(bytes, {
    'xl/drawings/_rels/drawing1.xml.rels': `<Relationships>${drawingRels}</Relationships>`,
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="${drawingId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
  })
}

/** Inject the `<drawing>` reference into sheet1, which ExcelJS never writes. */
function referenceDrawing(bytes: Uint8Array): Uint8Array {
  const entries = unzipSync(bytes)
  const sheet = entries['xl/worksheets/sheet1.xml']
  if (sheet === undefined) throw new Error('fixture package has no sheet1')
  entries['xl/worksheets/sheet1.xml'] = utf8(
    new TextDecoder().decode(sheet).replace('</worksheet>', '<drawing r:id="rIdD1"/></worksheet>'),
  )
  return zipSync(entries)
}

describe('parseXlsxCharts chart types', () => {
  const plot = (group: string): string => `<c:${group}Chart><c:barDir val="col"/>${cachedSeries('Revenue', ['North'], [120])}</c:${group}Chart>`

  it('reads a vertical column chart as a column chart', async () => {
    const bytes = packageOf({ 'xl/charts/chart1.xml': chartSpace(plot('bar')) })
    await expect(parseXlsxCharts(bytes)).resolves.toEqual([{
      type: 'column',
      series: [{ name: 'Revenue', categories: ['North'], values: [120] }],
    }])
  })

  it('reads Calc horizontal bars as a bar chart', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace(`<c:barChart><c:barDir val="bar"/>${cachedSeries('Revenue', ['North'], [120])}</c:barChart>`),
    })
    const charts = await parseXlsxCharts(bytes)
    expect(charts[0]?.type).toBe('bar')
  })

  it('reads line, pie, area, and doughnut plot areas by their own element name', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace(`<c:lineChart>${cachedSeries('Trend', ['Q1'], [1])}</c:lineChart>`),
      'xl/charts/chart2.xml': chartSpace(`<c:pieChart>${cachedSeries('Share', ['Q1'], [1])}</c:pieChart>`),
      'xl/charts/chart3.xml': chartSpace(`<c:areaChart>${cachedSeries('Volume', ['Q1'], [1])}</c:areaChart>`),
      'xl/charts/chart4.xml': chartSpace(`<c:doughnutChart>${cachedSeries('Ring', ['Q1'], [1])}</c:doughnutChart>`),
    })
    const charts = await parseXlsxCharts(bytes)
    expect(charts.map(chart => chart.type)).toEqual(['line', 'pie', 'area', 'doughnut'])
  })

  it('labels a scatter chart x axis from its numeric x values', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace([
        '<c:scatterChart><c:ser>',
        '<c:tx><c:strRef><c:f>Data!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>Spend</c:v></c:pt></c:strCache></c:strRef></c:tx>',
        '<c:xVal><c:numRef><c:numCache><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2,5</c:v></c:pt></c:numCache></c:numRef></c:xVal>',
        '<c:yVal><c:numRef><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>not-a-number</c:v></c:pt></c:numCache></c:numRef></c:yVal>',
        '</c:ser></c:scatterChart>',
      ].join('')),
    })
    await expect(parseXlsxCharts(bytes)).resolves.toEqual([{
      type: 'scatter',
      series: [{ name: 'Spend', categories: ['1', '25'], values: [10] }],
    }])
  })
})

describe('parseXlsxCharts titles and series', () => {
  it('joins the title runs, decodes entities, and collapses whitespace', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace(
        `<c:barChart><c:barDir val="col"/>${cachedSeries('Revenue', ['North'], [120])}</c:barChart>`,
        'Revenue &amp; |  margin',
      ),
    })
    expect((await parseXlsxCharts(bytes))[0]?.title).toBe('Revenue & margin')
  })

  it('caps an over-long chart title', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace(
        `<c:barChart><c:barDir val="col"/>${cachedSeries('Revenue', ['North'], [120])}</c:barChart>`,
        't'.repeat(200),
      ),
    })
    expect((await parseXlsxCharts(bytes))[0]?.title).toBe('t'.repeat(120))
  })

  it('omits the title and the sheet when the chart carries neither', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace(`<c:barChart><c:barDir val="col"/>${cachedSeries('Revenue', ['North'], [120])}</c:barChart>`),
    })
    expect(await parseXlsxCharts(bytes)).toEqual([{
      type: 'column',
      series: [{ name: 'Revenue', categories: ['North'], values: [120] }],
    }])
  })

  it('caps the categories and the series of a very wide chart', async () => {
    const categories = Array.from({ length: 80 }, (_, index) => `Region ${String(index)}`)
    const series = Array.from({ length: 15 }, (_, index) => cachedSeries(`Series ${String(index)}`, categories, [1]))
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace(`<c:barChart><c:barDir val="col"/>${series.join('')}</c:barChart>`),
    })
    const chart = (await parseXlsxCharts(bytes))[0]!
    expect(chart.series).toHaveLength(12)
    expect(chart.series[0]?.categories).toHaveLength(60)
  })

  it('falls back to the numeric cache when a category axis has no string cache', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace([
        '<c:barChart><c:barDir val="col"/><c:ser>',
        '<c:cat><c:numRef><c:numCache><c:pt idx="0"><c:v>2023</c:v></c:pt></c:numCache></c:numRef></c:cat>',
        '<c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>5</c:v></c:pt></c:numCache></c:numRef></c:val>',
        '</c:ser></c:barChart>',
      ].join('')),
    })
    expect((await parseXlsxCharts(bytes))[0]?.series[0]?.categories).toEqual(['2023'])
  })

  it('drops a series that carries neither a cache nor a reference', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace([
        '<c:barChart><c:barDir val="col"/>',
        '<c:ser><c:idx val="0"/></c:ser>',
        cachedSeries('Revenue', ['North'], [120]),
        '</c:barChart>',
      ].join('')),
    })
    const chart = (await parseXlsxCharts(bytes))[0]!
    expect(chart.series).toEqual([{ name: 'Revenue', categories: ['North'], values: [120] }])
  })

  it('ignores a chart part that holds no recognizable plot area', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': '<c:chartSpace xmlns:c="c"/>',
      'xl/charts/chart2.xml': chartSpace(`<c:barChart><c:barDir val="col"/>${cachedSeries('Revenue', ['North'], [120])}</c:barChart>`),
    })
    await expect(parseXlsxCharts(bytes)).resolves.toHaveLength(1)
  })

  it('keeps at most the chart cap of a workbook full of charts', async () => {
    const parts: Record<string, string> = {}
    for (let index = 1; index <= 15; index++) {
      parts[`xl/charts/chart${String(index)}.xml`] = chartSpace(
        `<c:barChart><c:barDir val="col"/>${cachedSeries(`Series ${String(index)}`, ['North'], [index])}</c:barChart>`,
      )
    }
    expect(await parseXlsxCharts(packageOf(parts))).toHaveLength(12)
  })

  it('drops a chart whose plot area carries no series', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace('<c:barChart><c:barDir val="col"/></c:barChart>'),
    })
    await expect(parseXlsxCharts(bytes)).resolves.toEqual([])
  })

  it('reads a cached value point that carries no value element as an empty label', async () => {
    const bytes = packageOf({
      'xl/charts/chart1.xml': chartSpace([
        '<c:barChart><c:barDir val="col"/><c:ser>',
        '<c:cat><c:strRef><c:strCache><c:pt idx="0"><c:shape/></c:pt><c:pt idx="1"><c:v>&lt;kept&gt;</c:v></c:pt></c:strCache></c:strRef></c:cat>',
        '<c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>3</c:v></c:pt></c:numCache></c:numRef></c:val>',
        '</c:ser></c:barChart>',
      ].join('')),
    })
    expect((await parseXlsxCharts(bytes))[0]?.series[0]?.categories).toEqual(['', '<kept>'])
  })

  it('returns an empty list for bytes that are not a package', async () => {
    await expect(parseXlsxCharts(utf8('not a zip'))).resolves.toEqual([])
  })
})

describe('parseXlsxCharts sheet anchoring', () => {
  /** One chart part, plus the drawing chain that anchors it to a sheet. */
  const chart = chartSpace(`<c:barChart><c:barDir val="col"/>${cachedSeries('Revenue', ['North'], [120])}</c:barChart>`)

  it('names the sheet a chart is anchored to through the drawing relationship chain', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const bytes = referenceDrawing(anchorChart(withParts(workbook, { 'xl/charts/chart1.xml': chart }), ['xl/charts/chart1.xml']))
    expect((await parseXlsxCharts(bytes))[0]?.sheet).toBe('Data')
  })

  it('resolves an absolute relationship target and drops empty and dot segments', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const withPartsAndAbsoluteTarget = withParts(workbook, {
      'xl/charts/chart1.xml': chart,
      // An absolute workbook target, plus paths carrying `//` and `./` segments.
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId4" Type="worksheet" Target="/xl//worksheets/./sheet1.xml"/></Relationships>',
      'xl/drawings/_rels/drawing1.xml.rels': '<Relationships><Relationship Id="rIdC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rIdD1" Type="drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    })
    const bytes = referenceDrawing(withPartsAndAbsoluteTarget)
    expect((await parseXlsxCharts(bytes))[0]?.sheet).toBe('Data')
  })

  it('skips relationships that carry no id or no target', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const bytes = referenceDrawing(withParts(workbook, {
      'xl/charts/chart1.xml': chart,
      'xl/_rels/workbook.xml.rels': [
        '<Relationships>',
        '<Relationship Type="worksheet" Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId5" Type="worksheet"/>',
        '<Relationship Id="rId4" Type="worksheet" Target="worksheets/sheet1.xml"/>',
        '</Relationships>',
      ].join(''),
      'xl/drawings/_rels/drawing1.xml.rels': [
        '<Relationships>',
        '<Relationship Id="rIdX" Type="drawing" Target="../drawings/other.xml"/>',
        '<Relationship Id="rIdC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>',
        '</Relationships>',
      ].join(''),
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rIdD9" Type="drawing" Target="../drawings/other.xml"/><Relationship Id="rIdD1" Type="drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    }))
    expect((await parseXlsxCharts(bytes))[0]?.sheet).toBe('Data')
  })

  it('leaves a chart unanchored when its sheet part, sheet relationships, or drawing relationships are absent', async () => {
    // A sheet entry pointing at a part the package does not carry.
    const ghostSheet = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const ghost = referenceDrawing(withParts(ghostSheet, {
      'xl/charts/chart1.xml': chart,
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId9" Type="worksheet" Target="worksheets/sheet9.xml"/></Relationships>',
    }))
    expect((await parseXlsxCharts(ghost))[0]?.sheet).toBeUndefined()

    // A sheet that references a drawing but ships no sheet relationships.
    const noSheetRels = referenceDrawing(withParts(ghostSheet, { 'xl/charts/chart1.xml': chart }))
    expect((await parseXlsxCharts(noSheetRels))[0]?.sheet).toBeUndefined()

    // Sheet relationships that map the drawing id to nothing.
    const unmatchedDrawing = referenceDrawing(withParts(ghostSheet, {
      'xl/charts/chart1.xml': chart,
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rIdOther" Type="drawing" Target="../drawings/drawing2.xml"/></Relationships>',
    }))
    expect((await parseXlsxCharts(unmatchedDrawing))[0]?.sheet).toBeUndefined()

    // A drawing whose own relationships part is missing.
    const noDrawingRels = referenceDrawing(withParts(ghostSheet, {
      'xl/charts/chart1.xml': chart,
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rIdD1" Type="drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    }))
    expect((await parseXlsxCharts(noDrawingRels))[0]?.sheet).toBeUndefined()
  })

  it('keeps a chart anchored to the first relationship that names it', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const anchored = anchorChart(withParts(workbook, { 'xl/charts/chart1.xml': chart }), ['xl/charts/chart1.xml'])
    const bytes = referenceDrawing(withParts(anchored, {
      'xl/drawings/_rels/drawing1.xml.rels': [
        '<Relationships>',
        '<Relationship Id="rIdC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>',
        '<Relationship Id="rIdC2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>',
        '</Relationships>',
      ].join(''),
    }))
    expect((await parseXlsxCharts(bytes))[0]?.sheet).toBe('Data')
  })

  it('ignores a drawing relationship whose chart type is not spelled out', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const anchored = anchorChart(withParts(workbook, { 'xl/charts/chart1.xml': chart }), ['xl/charts/chart1.xml'])
    const bytes = referenceDrawing(withParts(anchored, {
      'xl/drawings/_rels/drawing1.xml.rels': [
        '<Relationships>',
        '<Relationship Id="rIdC0" Target="../charts/chart1.xml"/>',
        '<Relationship Id="rIdC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>',
        '</Relationships>',
      ].join(''),
    }))
    expect((await parseXlsxCharts(bytes))[0]?.sheet).toBe('Data')
  })

  it('skips a sheet whose relationship target is not part of the package', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const parts = unzipSync(workbook)
    parts['xl/workbook.xml'] = utf8(
      new TextDecoder().decode(parts['xl/workbook.xml'])
        .replace('</sheets>', '<sheet name="Ghost" sheetId="9" r:id="rId9"/></sheets>'),
    )
    parts['xl/_rels/workbook.xml.rels'] = utf8(
      new TextDecoder().decode(parts['xl/_rels/workbook.xml.rels'])
        .replace('</Relationships>', '<Relationship Id="rId9" Type="worksheet" Target="worksheets/sheet9.xml"/></Relationships>'),
    )
    parts['xl/charts/chart1.xml'] = utf8(chart)
    // The ghost sheet is listed first, so it is the one the anchor walk visits.
    const bytes = referenceDrawing(anchorChart(zipSync(parts), ['xl/charts/chart1.xml']))
    expect((await parseXlsxCharts(bytes))[0]?.sheet).toBe('Data')
  })

  it('leaves a chart unanchored when a sheet carries no r:id or its relationship is unmatched', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const parts = unzipSync(workbook)
    parts['xl/charts/chart1.xml'] = utf8(chart)
    // No r:id at all on the sheet element, and an r:id that no relationship names.
    parts['xl/workbook.xml'] = utf8(
      new TextDecoder().decode(parts['xl/workbook.xml']).replace(/ r:id="[^"]*"/, ''),
    )
    expect((await parseXlsxCharts(zipSync(parts)))[0]?.sheet).toBeUndefined()

    parts['xl/workbook.xml'] = utf8(
      new TextDecoder().decode(parts['xl/workbook.xml']).replace('r:id="rId4"', 'r:id="rId404"'),
    )
    expect((await parseXlsxCharts(zipSync(parts)))[0]?.sheet).toBeUndefined()
  })

  it('anchors one shared chart part to the first sheet that reaches it', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const bytes = withParts(workbook, {
      'xl/charts/chart1.xml': chart,
      'xl/drawings/drawing1.xml': '<xdr/>',
      'xl/drawings/drawing2.xml': '<xdr/>',
      'xl/drawings/_rels/drawing1.xml.rels': '<Relationships><Relationship Id="rIdC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
      'xl/drawings/_rels/drawing2.xml.rels': '<Relationships><Relationship Id="rIdC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rIdT" Type="theme" Target="../theme/theme1.xml"/></Relationships>',
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rIdD1" Type="drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    })
    const chartWithoutSheet = unzipSync(bytes)
    chartWithoutSheet['xl/worksheets/sheet1.xml'] = utf8(
      new TextDecoder().decode(chartWithoutSheet['xl/worksheets/sheet1.xml'])
        .replace('</worksheet>', '<drawing r:id="rIdD1"/><drawing r:id="rIdD2"/></worksheet>'),
    )
    expect((await parseXlsxCharts(zipSync(chartWithoutSheet)))[0]?.sheet).toBe('Data')
  })
})

describe('parseXlsxCharts worksheet resolution', () => {
  it('resolves uncached series values against the worksheet data', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120], ['South', 98]])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:tx><c:strRef><c:f>Data!$B$1</c:f></c:strRef></c:tx>',
      '<c:cat><c:strRef><c:f>Data!$A$2:$A$3</c:f></c:strRef></c:cat>',
      '<c:val><c:numRef><c:f>Data!$B$2:$B$3</c:f></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    const bytes = referenceDrawing(anchorChart(withParts(workbook, { 'xl/charts/chart1.xml': chart }), ['xl/charts/chart1.xml']))
    await expect(parseXlsxCharts(bytes)).resolves.toEqual([{
      type: 'column',
      sheet: 'Data',
      series: [{ name: 'Revenue', categories: ['North', 'South'], values: [120, 98] }],
    }])
  })

  it('resolves a quoted sheet name and a whitespace-padded single-cell range', async () => {
    const workbook = await workbookBytes('My Data', [['Region', 'Revenue'], ['North', 120]])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:val><c:numRef><c:f>  \'My Data\'!$B$2  </c:f></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    const bytes = withParts(workbook, { 'xl/charts/chart1.xml': chart })
    const series = (await parseXlsxCharts(bytes))[0]?.series[0]
    expect(series).toEqual({ categories: [], values: [120] })
  })

  it('resolves an unnamed series through its name reference', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:tx><c:strRef><c:f>Data!$B$1</c:f><c:strCache><c:pt idx="0"><c:v></c:v></c:pt></c:strCache></c:strRef></c:tx>',
      '<c:val><c:numRef><c:f>Data!$B$2</c:f></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    const bytes = withParts(workbook, { 'xl/charts/chart1.xml': chart })
    const series = (await parseXlsxCharts(bytes))[0]?.series[0]
    expect(series).toEqual({ name: 'Revenue', categories: [], values: [120] })
  })

  it('omits the series name when its reference resolves to an empty cell', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:tx><c:strRef><c:f>Data!$Z$1</c:f></c:strRef></c:tx>',
      '<c:val><c:numRef><c:f>Data!$B$2</c:f></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    const bytes = withParts(workbook, { 'xl/charts/chart1.xml': chart })
    const series = (await parseXlsxCharts(bytes))[0]?.series[0]
    expect(series).toEqual({ categories: [], values: [120] })
  })

  it('drops every series whose reference cannot be turned into numbers', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/>',
      // No `sheet!` separator, an unknown sheet, a non-A1 range, and an empty range.
      '<c:ser><c:val><c:numRef><c:f>$B$2:$B$3</c:f></c:numRef></c:val></c:ser>',
      '<c:ser><c:val><c:numRef><c:f>Missing!$B$2:$B$3</c:f></c:numRef></c:val></c:ser>',
      '<c:ser><c:val><c:numRef><c:f>Data!not-a-range</c:f></c:numRef></c:val></c:ser>',
      '<c:ser><c:val><c:numRef><c:f>Data!$Z$1:$Z$2</c:f></c:numRef></c:val></c:ser>',
      '</c:barChart>',
    ].join(''))
    const bytes = withParts(workbook, { 'xl/charts/chart1.xml': chart })
    await expect(parseXlsxCharts(bytes)).resolves.toEqual([])
  })

  it('drops the series when the workbook behind the references never loads', async () => {
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:val><c:numRef><c:f>Data!$B$2:$B$3</c:f></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    // A workbook part ExcelJS cannot open leaves every reference unresolved.
    const bytes = packageOf({ 'xl/workbook.xml': '<not-a-workbook', 'xl/charts/chart1.xml': chart })
    await expect(parseXlsxCharts(bytes)).resolves.toEqual([])
  })

  it('keeps cached values of a series whose name still needs the sheet', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 120]])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:tx><c:strRef><c:f>Data!$B$1</c:f></c:strRef></c:tx>',
      '<c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    const bytes = withParts(workbook, { 'xl/charts/chart1.xml': chart })
    expect((await parseXlsxCharts(bytes))[0]?.series[0]).toEqual({ name: 'Revenue', categories: [], values: [120] })
  })

  it('drops a reference-only series when the sheet name resolves but the cells hold no number', async () => {
    const workbook = await workbookBytes('Data', [['Region', 'Revenue'], ['North', 'n/a']])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:cat><c:strRef><c:f>Data!Missing!$A$2:$A$3</c:f></c:strRef></c:cat>',
      '<c:val><c:numRef><c:f>Data!$B$2:$B$3</c:f></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    const bytes = withParts(workbook, { 'xl/charts/chart1.xml': chart })
    await expect(parseXlsxCharts(bytes)).resolves.toEqual([])
  })

  it('resolves multi-letter columns and skips text cells inside a value range', async () => {
    const workbook = await workbookBytes('Data', [
      ['a', 'b', 'c', 'd'],
      ['label', 'x', 'y', 10],
    ])
    const chart = chartSpace([
      '<c:barChart><c:barDir val="col"/><c:ser>',
      '<c:val><c:numRef><c:f>Data!$A$2:$D$2</c:f></c:numRef></c:val>',
      '</c:ser></c:barChart>',
    ].join(''))
    const bytes = withParts(workbook, { 'xl/charts/chart1.xml': chart })
    const series = (await parseXlsxCharts(bytes))[0]?.series[0]
    expect(series?.values).toEqual([10])
    expect(series?.categories).toEqual([])
  })

  it('orders chart parts numerically rather than by their file-name spelling', async () => {
    const parts: Record<string, string> = {}
    for (const index of [1, 2, 10]) {
      parts[`xl/charts/chart${String(index)}.xml`] = chartSpace(
        `<c:barChart><c:barDir val="col"/>${cachedSeries(`Series ${String(index)}`, ['North'], [index])}</c:barChart>`,
        `Title ${String(index)}`,
      )
    }
    const charts: PreviewChart[] = await parseXlsxCharts(packageOf(parts))
    expect(charts.map(chart => chart.title)).toEqual(['Title 1', 'Title 2', 'Title 10'])
  })
})
