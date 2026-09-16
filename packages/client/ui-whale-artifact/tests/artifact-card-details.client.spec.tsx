// @vitest-environment jsdom
/**
 * Artifact card behavior beyond block numbering: the failure card for results
 * without a preview, the display-name fallback chain, the header actions, the
 * meta line, the spreadsheet sheet strip with its row cap, and the document
 * and slide bodies.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { OfficeArtifactCard, type OfficeArtifactCardProps } from '../src/client/OfficeArtifactCard.tsx'
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

const REPORT_PATH = 'deliverables/report.docx'

/** A settled result; the render-only tail stays empty (the card reads none of it). */
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

/** The card's props: the framework seats it never reads stay cast away. */
function propsOf(block: ToolCallBlock, overrides: Partial<OfficeArtifactCardProps> = {}): OfficeArtifactCardProps {
  return {
    callId: 'call-1',
    toolName: 'xlsx_create',
    block,
    openFile: () => {},
    openDetails: undefined,
    t,
    ...overrides,
  } as unknown as OfficeArtifactCardProps
}

function docxPreview(overrides: Partial<Extract<OfficePreviewData, { kind: 'docx' }>> = {}): OfficePreviewData {
  return { kind: 'docx', file_name: 'report.docx', truncated: false, blocks: [], ...overrides }
}

function xlsxPreview(sheets: Extract<OfficePreviewData, { kind: 'xlsx' }>['sheets'], truncated = false): OfficePreviewData {
  return { kind: 'xlsx', file_name: 'budget.xlsx', truncated, sheets }
}

/** The body rows of the rendered grid (the last row group is `<tbody>`). */
function gridBodyRows(): HTMLElement[] {
  const groups = screen.getAllByRole('rowgroup')
  return within(groups[groups.length - 1]!).getAllByRole('row')
}

describe('OfficeArtifactCard without a preview', () => {
  it('reports a failed artifact while the call is still running', () => {
    render(<OfficeArtifactCard {...propsOf(running())} />)
    expect(screen.getByText('生成失败')).toBeTruthy()
  })

  it('reports a failed artifact for an errored result', () => {
    render(<OfficeArtifactCard {...propsOf({ ...settled({ preview: docxPreview() }), isError: true })} />)
    expect(screen.getByText('生成失败')).toBeTruthy()
  })

  it('reports a failed artifact when the result carries no preview metadata', () => {
    render(<OfficeArtifactCard {...propsOf(settled({}))} />)
    expect(screen.getByText('生成失败')).toBeTruthy()
  })
})

describe('OfficeArtifactCard identity', () => {
  it('names the artifact from the file name the tool reported', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview({ file_name: 'budget.xlsx' }) }))} />)
    expect(screen.getByText('budget.xlsx')).toBeTruthy()
  })

  it('falls back to the basename of the parsed path when the result omits a file name', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview({ file_name: '' }) }))} />)
    expect(screen.getByText('report.docx')).toBeTruthy()
  })

  it('falls back to the tool name when neither a file name nor a path is available', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview({ file_name: '' }) }, null), { toolName: 'docx_create' })} />)
    expect(screen.getByText('docx_create')).toBeTruthy()
  })

  it('keeps the full path in the artifact name tooltip', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview() }))} />)
    expect(screen.getByTitle(REPORT_PATH).textContent).toBe('report.docx')
  })
})

describe('OfficeArtifactCard header actions', () => {
  it('opens the file at the full parsed path, labelled with its basename', () => {
    const opened: string[] = []
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview() }), { openFile: (path: string) => { opened.push(path) } })} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 report.docx' }))
    expect(opened).toEqual([REPORT_PATH])
  })

  it('offers no open action when the call arguments carry no usable path', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview() }, null))} />)
    expect(screen.queryByRole('button', { name: /^打开/ })).toBeNull()
  })

  it('offers no details action when the panel supplies none', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview() }))} />)
    expect(screen.queryByRole('button', { name: '详情预览' })).toBeNull()
  })

  it('asks the panel to inspect the addressed call', () => {
    const targets: { callId: string; toolName: string }[] = []
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview() }, { name: 'pptx_create', argsRaw: '{}' }), {
      toolName: 'pptx_create',
      openDetails: (target) => { targets.push(target) },
    })} />)
    fireEvent.click(screen.getByRole('button', { name: '详情预览' }))
    expect(targets).toEqual([{ callId: 'call-1', toolName: 'pptx_create' }])
  })
})

describe('OfficeArtifactCard meta line', () => {
  it('shows the artifact size beside the created-by copy when the result reports one', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview(), size: 2048 }))} />)
    expect(screen.getByText('由 Whale 生成 · 2 KB')).toBeTruthy()
  })

  it('shows only the created-by copy when the result reports no size', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: docxPreview() }))} />)
    expect(screen.getByText('由 Whale 生成')).toBeTruthy()
  })
})

describe('OfficeArtifactCard spreadsheet preview', () => {
  const sheets: Extract<OfficePreviewData, { kind: 'xlsx' }>['sheets'] = [
    { name: 'Summary', header: ['Note'], rows: [[{ v: 'from-summary' }]], total_rows: 1, total_cols: 1 },
    { name: '2025', header: ['Note'], rows: [[{ v: 'from-2025' }]], total_rows: 1, total_cols: 1 },
  ]

  it('renders one tab per sheet and switches the visible grid', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: xlsxPreview(sheets) }))} />)
    expect(screen.getByRole('button', { name: 'Summary' })).toBeTruthy()
    expect(screen.getByText('from-summary')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    expect(screen.getByText('from-2025')).toBeTruthy()
    expect(screen.queryByText('from-summary')).toBeNull()
  })

  it('renders no grid for a workbook that reports no sheets', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: xlsxPreview([]) }))} />)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('caps the grid at the first hundred rows', () => {
    const rows = Array.from({ length: 101 }, (_, index) => [{ v: `r${index}` }])
    render(<OfficeArtifactCard {...propsOf(settled({ preview: xlsxPreview([{ name: 'Sheet1', header: ['Note'], rows, total_rows: rows.length, total_cols: 1 }]) }))} />)
    expect(gridBodyRows()).toHaveLength(100)
    expect(screen.getByText('r99')).toBeTruthy()
    expect(screen.queryByText('r100')).toBeNull()
  })

  it('notes a truncated preview', () => {
    render(<OfficeArtifactCard {...propsOf(settled({ preview: xlsxPreview(sheets, true) }))} />)
    expect(screen.getByText('预览已截断')).toBeTruthy()
  })
})

describe('OfficeArtifactCard document preview', () => {
  it('renders every document block kind without a document title', () => {
    render(<OfficeArtifactCard {...propsOf(settled({
      preview: docxPreview({
        blocks: [
          { type: 'heading1', text: 'Heading one' },
          { type: 'heading2', text: 'Heading two' },
          { type: 'heading3', text: 'Heading three' },
          { type: 'quote', text: 'Quoted line' },
          { type: 'bullet', text: 'bullet text' },
          { type: 'number', text: 'numbered text' },
          { type: 'paragraph', text: 'Body copy' },
        ],
      }),
    }))} />)
    expect(screen.getByText('Heading one')).toBeTruthy()
    expect(screen.getByText('Heading two')).toBeTruthy()
    expect(screen.getByText('Heading three')).toBeTruthy()
    expect(screen.getByText('Quoted line')).toBeTruthy()
    expect(screen.getByText('• bullet text')).toBeTruthy()
    expect(screen.getByText('1. numbered text')).toBeTruthy()
    expect(screen.getByText('Body copy')).toBeTruthy()
    expect(screen.queryByText('Q3')).toBeNull()
  })
})

describe('OfficeArtifactCard slide preview', () => {
  it('renders a slide subtitle when the deck provides one', () => {
    render(<OfficeArtifactCard {...propsOf(settled({
      preview: {
        kind: 'pptx',
        file_name: 'deck.pptx',
        truncated: false,
        title: 'Deck',
        slides: [{ title: 'S1', subtitle: 'Sub one' }],
      },
    }))} />)
    expect(screen.getByText('S1')).toBeTruthy()
    expect(screen.getByText('Sub one')).toBeTruthy()
  })
})
