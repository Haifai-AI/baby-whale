/**
 * Shared read plumbing behavior: exceljs cell values become JSON-safe cells,
 * sampled columns get a compact type hint, and a workspace read goes through
 * the sandboxed filesystem seam.
 * @module @deepseek-ai/dsh-tool-office/tests/read-shared
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { inferColumnType, MAX_READ_BYTES, readWorkspaceBytes, shapeCellValue } from '../src/read-shared.ts'

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'tool-office-shared-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

function execution(cwd: string): ToolExecution {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: 'token',
    name: 'csv_read',
    arguments: {},
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  } as unknown as ToolExecution
}

describe('shapeCellValue', () => {
  it('passes strings and numbers through and blanks absent cells', () => {
    expect(shapeCellValue('North')).toBe('North')
    expect(shapeCellValue(120000)).toBe(120000)
    expect(shapeCellValue(null)).toBe('')
    expect(shapeCellValue(undefined)).toBe('')
  })

  it('renders a date cell as its calendar day', () => {
    expect(shapeCellValue(new Date('2026-03-14T05:30:00.000Z'))).toBe('2026-03-14')
  })

  it('keeps a formula cell as its formula text', () => {
    expect(shapeCellValue({ formula: 'B4/B6', result: 0.55 })).toEqual({ formula: '=B4/B6' })
  })

  it('joins rich-text runs and stringifies the parts that carry no text', () => {
    expect(shapeCellValue({ richText: [{ text: 'bold' }, 'plain', null, { font: { bold: true } }] }))
      .toBe('boldplainnull[object Object]')
  })

  it('reads a hyperlink cell through its text field', () => {
    expect(shapeCellValue({ text: 'Annual report', hyperlink: 'https://example.test/a.xlsx' })).toBe('Annual report')
    expect(shapeCellValue({ richText: 'not a run list', text: 'fallback' })).toBe('fallback')
  })

  it('renders an error cell with its code, or bare when the code is not text', () => {
    expect(shapeCellValue({ error: '#DIV/0!' })).toBe('{error:#DIV/0!}')
    expect(shapeCellValue({ error: new Error('boom') })).toBe('{error}')
  })

  it('renders booleans as spreadsheet literals', () => {
    expect(shapeCellValue(true)).toBe('TRUE')
    expect(shapeCellValue(false)).toBe('FALSE')
  })

  it('blanks any other value shape', () => {
    expect(shapeCellValue({})).toBe('')
  })
})

describe('inferColumnType', () => {
  it('reports a formula column as soon as one cell holds a formula', () => {
    expect(inferColumnType([{ formula: '=A1' }])).toBe('formula')
    expect(inferColumnType(['North', { formula: '=A1' }])).toBe('formula')
  })

  it('reports number only for a column of numbers', () => {
    expect(inferColumnType([120000, 98000])).toBe('number')
    expect(inferColumnType([120000, ''])).toBe('number')
    expect(inferColumnType([])).toBe('number')
  })

  it('reports text as soon as one cell carries text', () => {
    expect(inferColumnType(['North', 'South'])).toBe('text')
    expect(inferColumnType([120000, 'South'])).toBe('text')
  })
})

describe('readWorkspaceBytes', () => {
  it('reads a workspace-relative file through the filesystem seam', async () => {
    const root = mkdtempSync(join(ROOT_BASE, 'case-'))
    const ctx = new Context()
    new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 })
    writeFileSync(join(root, 'notes.csv'), 'region,revenue\nNorth,10\n')
    const bytes = await readWorkspaceBytes(ctx, execution(root), 'notes.csv')
    expect(new TextDecoder().decode(bytes)).toBe('region,revenue\nNorth,10\n')
    expect(MAX_READ_BYTES).toBe(25 * 1024 * 1024)
  })
})
