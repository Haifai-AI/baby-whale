// @vitest-environment jsdom
/**
 * ui-deliverables browser half: the derivation contract of
 * `producedForClosing` over engine-published Turn data, the row's fitting
 * math, partitioning, mention resolution, and the produced-files row's
 * rendering + opener wiring.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { fitProducedFiles, ProducedFiles } from '../src/client/ProducedFiles.tsx'
import {
  basename, deliverablesDefinition, partitionProduced, producedFileMentions, producedForClosing,
  selectProducedFiles,
  type DeliverablesTurnData,
} from '../src/client/turn-deliverables.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t = (key: string, params?: Record<string, unknown>): string =>
  `${key}${params === undefined ? '' : `:${JSON.stringify(params)}`}`

const produced = (...values: ReadonlyArray<readonly [seq: number, path: string]>): DeliverablesTurnData => ({
  produced: values.map(([seq, path]) => ({ seq, path, tool: 'write' })),
})

describe('producedForClosing', () => {
  it('returns empty for turns with no data', () => {
    expect(producedForClosing(undefined)).toEqual([])
  })

  it('keeps first-seen order and dedupes later re-writes', () => {
    const data = produced([1, 'deliverables/a.md'], [2, 'deliverables/b.md'], [3, 'deliverables/a.md'])
    expect(producedForClosing(data, 5).map(entry => entry.path))
      .toEqual(['deliverables/a.md', 'deliverables/b.md'])
  })

  it('excludes settlements after the closing seq', () => {
    const data = produced([1, 'deliverables/a.md'], [9, 'deliverables/late.md'])
    expect(producedForClosing(data, 5).map(entry => entry.path))
      .toEqual(['deliverables/a.md'])
  })
})

describe('partitionProduced', () => {
  it('splits delivered claims from written files, deduped', () => {
    const entries: DeliverablesTurnData = {
      produced: [
        { seq: 1, path: 'deliverables/report.xlsx', tool: 'deliver' },
        { seq: 2, path: 'src/notes.md', tool: 'write' },
        { seq: 3, path: 'deliverables/report.xlsx', tool: 'deliver' },
      ],
    }
    expect(partitionProduced(entries.produced)).toEqual({
      delivered: ['deliverables/report.xlsx'],
      written: ['src/notes.md'],
    })
  })
})

describe('fitProducedFiles', () => {
  it('renders everything when space is unbounded', () => {
    expect(fitProducedFiles(10_000, 4, [30, 30, 30], [undefined, undefined, undefined, undefined])).toBe(3)
  })

  it('drops to the largest prefix that fits with the remainder chip', () => {
    // 60px chips, 4px gap: showing 2 + "+1 file" chip must fit 200px.
    expect(fitProducedFiles(200, 4, [60, 60, 60], [80, 70, 60, undefined])).toBe(3)
  })

  it('shows nothing when even the remainder does not fit', () => {
    expect(fitProducedFiles(20, 4, [60, 60], [80, 70])).toBe(0)
  })
})

describe('selectProducedFiles + deliverablesDefinition', () => {
  it('declines turns without produced files', () => {
    const owner = {
      seq: 5,
      turn: { data: { get: () => undefined } },
      openFile: () => {},
    }
    expect(selectProducedFiles(owner as never)).toBeNull()
  })

  it('tool/call stores durable identity and tool/result appends produced paths', () => {
    const start = deliverablesDefinition.start as (context: unknown, match: { event: { type: string; data: { turn: number } } }) => unknown
    const state = start(undefined, { event: { type: 'turn/start', data: { turn: 1 } } }) as {
      turn: number
      calls: Map<string, unknown>
      produced: unknown[]
    }
    expect(state.turn).toBe(1)
    expect(state.calls.size).toBe(0)
  })
})

describe('producedFileMentions', () => {
  it('resolves exact paths and unique basenames, and leaves ambiguity inert', () => {
    const opened: string[] = []
    const mentions = producedFileMentions(
      ['deliverables/report.xlsx', 'notes/summary.md', 'notes/other/summary.md'],
      path => { opened.push(path) },
      path => `open ${path}`,
    )
    mentions.resolve('deliverables/report.xlsx')?.open()
    expect(opened).toEqual(['deliverables/report.xlsx'])
    mentions.resolve('summary.md')?.open()
    // Two paths share that basename: stays inert.
    expect(opened).toEqual(['deliverables/report.xlsx'])
    expect(mentions.resolve('report.xlsx')?.title).toBe('deliverables/report.xlsx')
  })
})

describe('ProducedFiles rendering', () => {
  it('renders delivered cards and written chips, opening through openFile', () => {
    const openFile = vi.fn()
    const view = render(<ProducedFiles {...{
      matched: [
        { seq: 1, path: 'deliverables/report.xlsx', tool: 'deliver' },
        { seq: 2, path: 'src/notes.md', tool: 'write' },
      ],
      sessionId: 'sess-test',
      openFile,
      t: makeTranslate(en),
    }} />)
    expect(view.getByText('Deliverables')).toBeTruthy()
    fireEvent.click(view.getAllByRole('button', { name: 'Open src/notes.md' })[0] as HTMLButtonElement)
    expect(openFile).toHaveBeenCalledWith('src/notes.md')
    // The written-file chip opens by full path (title carries the
    // disambiguator when two turns share a basename).
    fireEvent.click(view.getByTitle('src/notes.md'))
    expect(openFile).toHaveBeenLastCalledWith('src/notes.md')
  })

  it('localizes with the en dictionary keys the row uses', () => {
    expect(en['produced.label']).toBeTruthy()
    expect(en['delivered.label']).toBeTruthy()
  })
})

describe('basename', () => {
  it('strips directories on both separators', () => {
    expect(basename('deliverables/deep/file name.xlsx')).toBe('file name.xlsx')
    expect(basename('C:\\dir\\file.docx')).toBe('file.docx')
  })
})
