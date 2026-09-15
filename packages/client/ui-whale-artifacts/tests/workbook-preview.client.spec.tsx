// @vitest-environment jsdom
/**
 * Workbook tab lens: the Data grid opens first, a Charts tab appears only when
 * the workbook carries charts and badges them with their count, and an
 * Original tab appears only when LibreOffice rendered a PDF beside the data.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkbookPreview, type WorkbookPreviewData } from '../src/client/WorkbookPreview.tsx'
import { zh, type WhaleArtifactsKey } from '../src/client/locales.ts'
import type { WorkbookChart } from '../src/client/WorkbookCharts.tsx'

afterEach(cleanup)

/** Minimal interpolating translator over the real zh dictionary. */
const t = (key: WhaleArtifactsKey): string => zh[key] ?? key

const sheets = [{
  name: 'Sheet1',
  header: ['Item', 'Qty'],
  rows: [[{ v: 'Widget' }, { v: '3' }]],
  total_rows: 1,
  total_cols: 2,
}]

const charts: WorkbookChart[] = [
  { type: 'column', title: 'Monthly Sales', series: [
    { name: 'North', categories: ['Jan'], values: [11648] },
  ] },
  { type: 'line', title: 'Trend', series: [
    { name: 'Total', categories: ['Jan'], values: [11648] },
  ] },
]

const workbook: WorkbookPreviewData = { kind: 'xlsx', file_name: 'book.xlsx', sheets }

describe('WorkbookPreview tabs', () => {
  it('opens on the Data grid and hides the tabs whose source is unavailable', () => {
    render(<WorkbookPreview data={workbook} t={t} />)
    expect(screen.getByText('数据')).toBeTruthy()
    expect(screen.getByText('Sheet1')).toBeTruthy()
    expect(screen.getByText('Widget')).toBeTruthy()
    expect(screen.queryByText('图表')).toBeNull()
    expect(screen.queryByText('原始')).toBeNull()
  })

  it('badges the Charts tab with the workbook chart count and draws them on selection', () => {
    render(<WorkbookPreview data={{ ...workbook, charts }} t={t} />)
    const chartsTab = screen.getByText('图表')
    expect(chartsTab.textContent).toContain('2')
    fireEvent.click(chartsTab)
    // Both charts plus the wall pill are offered, and the first chart is large.
    expect(screen.getByText('全部图表')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Monthly Sales' })).toBeTruthy()
    expect(screen.queryByText('Widget')).toBeNull()
  })

  it('serves the LibreOffice render from the file channel on the Original tab', () => {
    render(<WorkbookPreview data={{ ...workbook, pdfPath: '/cache/book.pdf' }} t={t} />)
    fireEvent.click(screen.getByText('原始'))
    const frame = screen.getByTitle('book.xlsx')
    expect(frame.getAttribute('src')).toContain('/api/artifacts.file?path=%2Fcache%2Fbook.pdf')
  })

  it('offers no Original tab for an empty rendered-PDF path', () => {
    render(<WorkbookPreview data={{ ...workbook, pdfPath: '' }} t={t} />)
    expect(screen.queryByText('原始')).toBeNull()
  })

  it('returns to the Data grid when the lens is remounted for another file', () => {
    const view = render(<WorkbookPreview key="a" data={{ ...workbook, charts }} t={t} />)
    fireEvent.click(screen.getByText('图表'))
    expect(screen.getByRole('img', { name: 'Monthly Sales' })).toBeTruthy()
    view.rerender(<WorkbookPreview key="b" data={{ ...workbook, charts, file_name: 'other.xlsx' }} t={t} />)
    expect(screen.queryByText('全部图表')).toBeNull()
    expect(screen.getByText('Widget')).toBeTruthy()
  })

  it('empties the charts wall when a re-parsed payload drops the charts it was showing', () => {
    // Same path, refreshed payload: React keeps this instance, so the Charts
    // tab stays open over a workbook that no longer carries a chart list.
    const view = render(<WorkbookPreview data={{ ...workbook, charts }} t={t} />)
    fireEvent.click(screen.getByText('图表'))
    expect(screen.getByText('全部图表')).toBeTruthy()
    view.rerender(<WorkbookPreview data={workbook} t={t} />)
    expect(screen.queryByText('图表')).toBeNull()
    expect(screen.queryByText('全部图表')).toBeNull()
    fireEvent.click(screen.getByText('数据'))
    expect(screen.getByText('Widget')).toBeTruthy()
  })
})
