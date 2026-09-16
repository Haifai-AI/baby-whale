// @vitest-environment jsdom
/**
 * Artifact studio behavior: the details header (kind badge, file name, size and
 * path segments, tool-name footer), the spreadsheet studio's sheet strip,
 * formula bar, column letters, selection and row cap, the page-numbered slide
 * gallery, and the document page.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ArtifactStudioBody, DetailsArtifactView, ExcelStudio } from '../src/client/DetailsArtifact.tsx'
import { zh, type WhaleArtifactKey } from '../src/client/locales.ts'
import type { OfficePreviewData } from '../src/client/whale-preview.ts'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'

afterEach(cleanup)

/** Minimal interpolating translator over the real zh dictionary. */
const t = (key: WhaleArtifactKey, params?: Record<string, unknown>): string => {
  const template: string = zh[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

type StudioProps = Parameters<typeof DetailsArtifactView>[0]
type XlsxPreview = Extract<OfficePreviewData, { kind: 'xlsx' }>
type XlsxSheet = XlsxPreview['sheets'][number]

const REPORT_PATH = 'deliverables/report.docx'

/** A settled result; the render-only tail stays empty (the studio reads none of it). */
function settled(meta: unknown, call: ToolResultNode['call'] = { name: 'docx_create', argsRaw: `{"file_path":"${REPORT_PATH}"}` }): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'call-1',
    call,
    callTime: null,
    content: [],
    isError: false,
    meta,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

/** A still-running call: no `kind` tag yet, so only the running fields exist. */
function running(): ToolCallBlock {
  return {
    callId: 'call-2',
    name: 'docx_create',
    argsRaw: `{"file_path":"${REPORT_PATH}"}`,
    turn: 1,
    step: 1,
    time: 0,
    callView: null,
    subCalls: [],
  }
}

/** The view's props: the framework seats it never reads stay cast away. */
function studioProps(block: ToolCallBlock, cwd?: string): StudioProps {
  return { block, cwd, t } as unknown as StudioProps
}

function docxPreview(overrides: Partial<Extract<OfficePreviewData, { kind: 'docx' }>> = {}): OfficePreviewData {
  return { kind: 'docx', file_name: 'report.docx', truncated: false, blocks: [], ...overrides }
}

function xlsxPreview(sheets: XlsxSheet[], truncated = false): OfficePreviewData {
  return { kind: 'xlsx', file_name: 'budget.xlsx', truncated, sheets }
}

function sheet(overrides: Partial<XlsxSheet> = {}): XlsxSheet {
  return { name: 'Sheet1', header: ['Note'], rows: [[{ v: 'A1 value' }]], total_rows: 1, total_cols: 1, ...overrides }
}

function pptxPreview(slides: Extract<OfficePreviewData, { kind: 'pptx' }>['slides'], truncated = false): OfficePreviewData {
  return { kind: 'pptx', file_name: 'deck.pptx', truncated, title: 'Deck', slides }
}

/** The body rows of the rendered grid (the last row group is `<tbody>`). */
function gridBodyRows(): HTMLElement[] {
  const groups = screen.getAllByRole('rowgroup')
  return within(groups[groups.length - 1]!).getAllByRole('row')
}

describe('DetailsArtifactView header', () => {
  it('reports a failed artifact when the block carries no preview', () => {
    render(<DetailsArtifactView {...studioProps(running())} />)
    expect(screen.getByText('生成失败')).toBeTruthy()
  })

  it('badges the artifact kind and names the file', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview() }))} />)
    expect(screen.getByText('DOCX')).toBeTruthy()
    expect(screen.getByText('report.docx')).toBeTruthy()
  })

  it('shows the formatted artifact size beside the created-by copy', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview(), size: 1572864 }))} />)
    expect(screen.getByText('由 Whale 生成 · 1.5 MB')).toBeTruthy()
  })

  it('omits the size segment when the result reports none', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview() }))} />)
    expect(screen.getByText('由 Whale 生成')).toBeTruthy()
  })

  it('appends the artifact path when the workspace root is known', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview() }), '/work')} />)
    expect(screen.getByText(`由 Whale 生成 · ${REPORT_PATH}`)).toBeTruthy()
    expect(screen.getByTitle(REPORT_PATH).textContent).toBe('report.docx')
  })

  it('keeps the path out of the meta line when the workspace root is unknown', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview() }))} />)
    expect(screen.getByText('由 Whale 生成')).toBeTruthy()
  })

  it('keeps the path out of the meta line when the call arguments carry none', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview() }, null), '/work')} />)
    expect(screen.getByText('由 Whale 生成')).toBeTruthy()
  })

  it('falls back to the file name in the name tooltip when no path parses', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview() }, null))} />)
    expect(screen.getByTitle('report.docx').textContent).toBe('report.docx')
  })

  it('names the settled tool call in the footer', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview() }, { name: 'docx_create', argsRaw: '{}' }))} />)
    expect(screen.getByText('docx_create')).toBeTruthy()
  })

  it('notes a truncated preview', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: docxPreview({ truncated: true }) }))} />)
    expect(screen.getByText('预览已截断')).toBeTruthy()
  })
})

describe('DetailsArtifactView bodies', () => {
  it('renders the spreadsheet studio for an xlsx preview', () => {
    render(<DetailsArtifactView {...studioProps(settled({ preview: xlsxPreview([sheet()]) }))} />)
    expect(screen.getByText('XLSX')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sheet1' })).toBeTruthy()
    expect(screen.getByText('A1 value')).toBeTruthy()
  })

  it('renders the page-numbered slide gallery for a pptx preview', () => {
    // The gallery keeps every slide bullet (no cap, no overflow note).
    render(<DetailsArtifactView {...studioProps(settled({ preview: pptxPreview([{ title: 'One', bullets: ['point one', 'point two'] }, { title: 'Two' }]) }))} />)
    expect(screen.getByText('PPTX')).toBeTruthy()
    expect(screen.getByText('Deck')).toBeTruthy()
    // Two slides plus the deck-title card.
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect(screen.getByText('One')).toBeTruthy()
    expect(screen.getByText('point one')).toBeTruthy()
    expect(screen.getByText('point two')).toBeTruthy()
    expect(screen.getByText('Two')).toBeTruthy()
  })

  it('renders the document page for a docx preview, numbering only numbered blocks', () => {
    render(<DetailsArtifactView {...studioProps(settled({
      preview: docxPreview({
        title: 'Q3 report',
        blocks: [
          { type: 'heading1', text: 'Heading one' },
          { type: 'heading2', text: 'Heading two' },
          { type: 'heading3', text: 'Heading three' },
          { type: 'quote', text: 'Quoted line' },
          { type: 'bullet', text: 'bullet text' },
          { type: 'number', text: 'first' },
          { type: 'paragraph', text: 'Body copy' },
          { type: 'number', text: 'second' },
        ],
      }),
    }))} />)
    expect(screen.getByText('Q3 report')).toBeTruthy()
    expect(screen.getByText('Heading one')).toBeTruthy()
    expect(screen.getByText('Heading two')).toBeTruthy()
    expect(screen.getByText('Heading three')).toBeTruthy()
    expect(screen.getByText('Quoted line')).toBeTruthy()
    expect(screen.getByText('• bullet text')).toBeTruthy()
    expect(screen.getByText('1. first')).toBeTruthy()
    expect(screen.getByText('Body copy')).toBeTruthy()
    expect(screen.getByText('2. second')).toBeTruthy()
  })
})

describe('ExcelStudio', () => {
  it('letters column heads past Z into double letters', () => {
    const header = Array.from({ length: 28 }, (_, index) => `h${index}`)
    render(<ExcelStudio preview={xlsxPreview([sheet({ header, rows: [header.map((_, index) => ({ v: `v${index}` }))] })]) as XlsxPreview} />)
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Z' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'AA' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'AB' })).toBeTruthy()
  })

  it('renders no grid for a workbook that reports no sheets', () => {
    render(<ExcelStudio preview={xlsxPreview([]) as XlsxPreview} />)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('switches sheets through the tab strip and clears the selected cell', () => {
    render(<ExcelStudio preview={xlsxPreview([
      sheet({ name: 'Summary', rows: [[{ v: 'from-summary' }]] }),
      sheet({ name: '2025', rows: [[{ v: 'from-2025' }]] }),
    ]) as XlsxPreview} />)
    fireEvent.click(screen.getByText('from-summary'))
    expect(screen.getByText('A1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    expect(screen.getByText('from-2025')).toBeTruthy()
    expect(screen.queryByText('from-summary')).toBeNull()
    expect(screen.queryByText(/^[A-Z]{1,2}\d+$/)).toBeNull()
  })

  it('shows the selected cell reference and its value in the formula bar', () => {
    const rows = [
      [{ v: 'r0c0' }, { v: 'r0c1' }],
      [{ v: 'r1c0' }, { v: 'r1c1' }],
      [{ v: 'r2c0' }, { v: 'r2c1' }],
    ]
    render(<ExcelStudio preview={xlsxPreview([sheet({ header: ['c0', 'c1'], rows, total_rows: rows.length, total_cols: 2 })]) as XlsxPreview} />)
    // Nothing is selected before the first click, so no cell reference shows.
    expect(screen.queryByText(/^[A-Z]{1,2}\d+$/)).toBeNull()

    fireEvent.click(screen.getByText('r2c1'))
    expect(screen.getByText('B3')).toBeTruthy()
    // The value is mirrored from the grid into the formula bar.
    expect(screen.getAllByText('r2c1')).toHaveLength(2)
  })

  it('shows the cell formula in the formula bar and pads short rows with empty cells', () => {
    render(<ExcelStudio preview={xlsxPreview([
      sheet({ header: ['A', 'B'], rows: [[{ v: '7', f: '=SUM(B1:B2)' }]], total_cols: 2 }),
    ]) as XlsxPreview} />)
    fireEvent.click(screen.getByText('7'))
    expect(screen.getByText('A1')).toBeTruthy()
    expect(screen.getByText('=SUM(B1:B2)')).toBeTruthy()
    expect(screen.getAllByText('7')).toHaveLength(1)

    // The row carries no cell for the second column; the padded cell is empty.
    const cells = within(gridBodyRows()[0]!).getAllByRole('cell')
    expect(cells).toHaveLength(3)
    expect(cells[2]!.textContent).toBe('')
    fireEvent.click(cells[2]!)
    expect(screen.getByText('B1')).toBeTruthy()
    expect(screen.queryByText('=SUM(B1:B2)')).toBeNull()
  })

  it('caps the grid at two hundred rows', () => {
    const rows = Array.from({ length: 201 }, (_, index) => [{ v: `r${index}` }])
    render(<ExcelStudio preview={xlsxPreview([sheet({ rows, total_rows: rows.length })]) as XlsxPreview} />)
    expect(gridBodyRows()).toHaveLength(200)
    expect(screen.getByText('r199')).toBeTruthy()
    expect(screen.queryByText('r200')).toBeNull()
  })
})

describe('ArtifactStudioBody', () => {
  it('renders the spreadsheet studio for an xlsx preview', () => {
    render(<ArtifactStudioBody preview={xlsxPreview([sheet()]) as XlsxPreview} />)
    expect(screen.getByRole('button', { name: 'Sheet1' })).toBeTruthy()
    expect(screen.getByText('A1 value')).toBeTruthy()
  })

  it('renders the slide gallery for a pptx preview', () => {
    render(<ArtifactStudioBody preview={pptxPreview([{ title: 'One' }])} />)
    expect(screen.getByText('Deck')).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(screen.getByText('2 / 2')).toBeTruthy()
    expect(screen.getByText('One')).toBeTruthy()
  })

  it('renders the document page for a docx preview', () => {
    render(<ArtifactStudioBody preview={docxPreview({ title: 'Q3 report', blocks: [{ type: 'paragraph', text: 'Body copy' }] })} />)
    expect(screen.getByText('Q3 report')).toBeTruthy()
    expect(screen.getByText('Body copy')).toBeTruthy()
  })
})
