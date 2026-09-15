/**
 * Office read tool registration and surface behavior: the three tools register
 * with their shared prompt guidance, extract real workspace files through the
 * sandboxed filesystem seam, and project their calls, results, and content.
 * @module @deepseek-ai/dsh-tool-office/tests/read-tools-registration
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { applyReadTools } from '../src/read-tools.ts'

const ROOT_BASE = mkdtempSync(join(tmpdir(), 'tool-office-reads-'))
afterAll(() => { rmSync(ROOT_BASE, { recursive: true, force: true }) })

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** The execution identity a tool call sees: a session workspace plus cancellation. */
function execution(cwd: string): ToolRunContext {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: 'token',
    name: 'csv_read',
    arguments: {},
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
    deferContext: () => {},
    concludeTurn: () => {},
  } as unknown as ToolRunContext
}

interface SandboxPolicyStub {
  resolve(request: { session?: unknown }): { workspaceRoot: string }
}

async function booted(options: { sandboxPolicy?: SandboxPolicyStub } = {}): Promise<{
  fs: LocalFileSystem
  root: string
  sections: Array<Record<string, unknown>>
  tools: Map<string, ToolDefinition>
}> {
  const root = mkdtempSync(join(ROOT_BASE, 'case-'))
  const ctx = new Context()
  const fs = new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 })
  const sections: Array<Record<string, unknown>> = []
  ctx.provide('systemPrompt', { section: (spec: Record<string, unknown>) => { sections.push(spec) } })
  const tools = new Map<string, ToolDefinition>()
  ctx.provide('tools', {
    register: (definition: ToolDefinition) => {
      tools.set(definition.name, definition)
      return () => {}
    },
  } as never)
  if (options.sandboxPolicy !== undefined) ctx.provide('sandboxPolicy', options.sandboxPolicy as never)
  applyReadTools(ctx)
  return { fs, root, sections, tools }
}

/** Make the local backend report the confining mode a sandboxing backend would. */
function confine(fs: LocalFileSystem): void {
  Object.defineProperty(fs, 'sandboxMode', { value: 'workspace-write' })
}

function tool(tools: Map<string, ToolDefinition>, name: string): ToolDefinition {
  const definition = tools.get(name)
  if (definition === undefined) throw new Error(`${name} was not registered`)
  return definition
}

async function xlsxBytes(rows: Array<Array<string | number>>): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Sheet1')
  for (const row of rows) sheet.addRow(row)
  return new Uint8Array(await book.xlsx.writeBuffer())
}

const DOCX_MARKDOWN = [
  '# Quarterly',
  '## Overview',
  '### Revenue',
  '#### By region',
  '- Grew by 12%',
  '1. 1. First item',
  'Closing note',
  'Region | Rev',
  'North | 10',
].join('\n')

function docxBytes(): Uint8Array {
  return zipSync({
    'word/document.xml': utf8(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Revenue</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>By region</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Grew by 12%</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>1. First item</w:t></w:r></w:p>
<w:p><w:r><w:t>Closing note</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rev</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`),
  })
}

function csvBytes(rows: number): Uint8Array {
  return utf8(`region\n${Array.from({ length: rows }, (_, index) => `r${index}`).join('\n')}\n`)
}

describe('office read tool registration', () => {
  it('registers the three read tools with their shared prompt guidance', async () => {
    const { sections, tools } = await booted()
    expect([...tools.keys()]).toEqual(['xlsx_read', 'csv_read', 'docx_text'])
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ name: 'tool:office-reads', order: 105 })
    expect(sections[0]?.text).toEqual(expect.stringContaining('csv_read'))
    expect(sections[0]?.text).toEqual(expect.stringContaining('docx_text'))
  })
})

describe('xlsx_read tool', () => {
  it('extracts a workbook sheet with its header, rows, and column hints', async () => {
    const { root, tools } = await booted()
    writeFileSync(join(root, 'sales.xlsx'), await xlsxBytes([
      ['Region', 'Revenue'],
      ['North', 120000],
      ['South', 98000],
    ]))
    const result = await tool(tools, 'xlsx_read').execute({ file_path: 'sales.xlsx', max_rows: 1 }, execution(root)) as {
      path: string
      format: string
      sheet_count: number
      truncated: boolean
      sheets: Array<{ name: string; header?: string[]; rows: unknown[] }>
    }
    expect(result.path).toBe('sales.xlsx')
    expect(result.format).toBe('xlsx')
    expect(result.sheet_count).toBe(1)
    expect(result.truncated).toBe(true)
    expect(result.sheets[0]?.name).toBe('Sheet1')
    expect(result.sheets[0]?.header).toEqual(['Region', 'Revenue'])
    expect(result.sheets[0]?.rows).toEqual([['North', 120000]])
  })

  it('fails the call for a workbook path that is not on disk', async () => {
    const { root, tools } = await booted()
    await expect(tool(tools, 'xlsx_read').execute({ file_path: 'missing.xlsx' }, execution(root)))
      .rejects.toThrow()
  })

  it('presents an xlsx call as a read of the workbook path', async () => {
    const { tools } = await booted()
    const definition = tool(tools, 'xlsx_read')
    expect(definition.presentCall?.({ file_path: 'sales.xlsx' })).toEqual({
      card: 'generic',
      title: 'Read workbook sales.xlsx',
      kind: 'read',
      locations: [{ path: 'sales.xlsx' }],
    })
    expect(definition.presentResult?.({ file_path: 'sales.xlsx' }, { content: [], isError: false })).toBeUndefined()
  })

  it('renders the xlsx result as one typed content block', async () => {
    const { tools } = await booted()
    const value = { path: 'sales.xlsx', format: 'xlsx', sheet_count: 1, sheets: [], truncated: false }
    expect(tool(tools, 'xlsx_read').output.render({ file_path: 'sales.xlsx' }, value as never)).toEqual([{
      type: 'text',
      text: `<path>sales.xlsx</path>\n<type>xlsx</type>\n<content>\n${JSON.stringify(value)}\n</content>`,
    }])
    expect(tool(tools, 'xlsx_read').output.render({}, {}))
      .toEqual([{ type: 'text', text: '<path></path>\n<type>xlsx</type>\n<content>\n{}\n</content>' }])
  })
})

describe('csv_read tool', () => {
  it('extracts a delimited workspace file as one sheet', async () => {
    const { root, tools } = await booted()
    writeFileSync(join(root, 'regions.csv'), 'region;revenue\nNorth;120000\n')
    const result = await tool(tools, 'csv_read').execute({ file_path: 'regions.csv' }, execution(root)) as {
      path: string
      format: string
      sheet: { header?: string[]; rows: unknown[]; truncated: boolean }
    }
    expect(result.path).toBe('regions.csv')
    expect(result.format).toBe('csv')
    expect(result.sheet.header).toEqual(['region', 'revenue'])
    expect(result.sheet.rows).toEqual([['North', 120000]])
    expect(result.sheet.truncated).toBe(false)
  })

  it('samples the default row budget when max_rows is absent or non-positive', async () => {
    const { root, tools } = await booted()
    writeFileSync(join(root, 'many.csv'), csvBytes(150))
    const forArgs = async (maxRows?: number): Promise<{ sheet: { rows: unknown[] } }> => await tool(tools, 'csv_read').execute(
      maxRows === undefined ? { file_path: 'many.csv' } : { file_path: 'many.csv', max_rows: maxRows },
      execution(root),
    ) as { sheet: { rows: unknown[] } }
    expect((await forArgs()).sheet.rows).toHaveLength(100)
    expect((await forArgs(0)).sheet.rows).toHaveLength(100)
    expect((await forArgs(-4)).sheet.rows).toHaveLength(100)
  })

  it('floors a fractional budget and clamps a large one to the hard cap', async () => {
    const { root, tools } = await booted()
    writeFileSync(join(root, 'many.csv'), csvBytes(450))
    const read = async (maxRows: number): Promise<number> => {
      const result = await tool(tools, 'csv_read').execute({ file_path: 'many.csv', max_rows: maxRows }, execution(root)) as {
        sheet: { rows: unknown[] }
      }
      return result.sheet.rows.length
    }
    expect(await read(2.7)).toBe(2)
    expect(await read(500)).toBe(400)
  })

  it('presents a csv call as a read of the file path', async () => {
    const { tools } = await booted()
    const definition = tool(tools, 'csv_read')
    expect(definition.presentCall?.({ file_path: 'regions.csv' })).toEqual({
      card: 'generic',
      title: 'Read csv regions.csv',
      kind: 'read',
      locations: [{ path: 'regions.csv' }],
    })
    expect(definition.presentResult?.({ file_path: 'regions.csv' }, { content: [], isError: false })).toBeUndefined()
  })

  it('renders the csv result as one typed content block', async () => {
    const { tools } = await booted()
    const value = { path: 'regions.csv', format: 'csv', sheet: { name: 'csv', rows: [] } }
    expect(tool(tools, 'csv_read').output.render({ file_path: 'regions.csv' }, value as never)).toEqual([{
      type: 'text',
      text: `<path>regions.csv</path>\n<type>csv</type>\n<content>\n${JSON.stringify(value)}\n</content>`,
    }])
    expect(tool(tools, 'csv_read').output.render({}, {}))
      .toEqual([{ type: 'text', text: '<path></path>\n<type>csv</type>\n<content>\n{}\n</content>' }])
  })
})

describe('docx_text tool', () => {
  it('extracts paragraphs and renders them as markdown lines', async () => {
    const { root, tools } = await booted()
    writeFileSync(join(root, 'report.docx'), docxBytes())
    const result = await tool(tools, 'docx_text').execute({ file_path: 'report.docx' }, execution(root)) as {
      path: string
      format: string
      char_count: number
      truncated: boolean
      text: string
    }
    expect(result.path).toBe('report.docx')
    expect(result.format).toBe('docx')
    expect(result.truncated).toBe(false)
    expect(result.char_count).toBe(92)
    expect(result.text).toBe(DOCX_MARKDOWN)
  })

  it('fails the call for bytes that are not a docx package', async () => {
    const { root, tools } = await booted()
    writeFileSync(join(root, 'notes.txt'), 'plain text')
    await expect(tool(tools, 'docx_text').execute({ file_path: 'notes.txt' }, execution(root)))
      .rejects.toThrow()
  })

  it('presents a docx call as a read of the document path', async () => {
    const { tools } = await booted()
    const definition = tool(tools, 'docx_text')
    expect(definition.presentCall?.({ file_path: 'report.docx' })).toEqual({
      card: 'generic',
      title: 'Read document report.docx',
      kind: 'read',
      locations: [{ path: 'report.docx' }],
    })
    expect(definition.presentResult?.({ file_path: 'report.docx' }, { content: [], isError: false })).toBeUndefined()
  })

  it('renders the extracted text inside the docx content block', async () => {
    const { tools } = await booted()
    const value = { path: 'report.docx', format: 'docx', char_count: 7, truncated: false, text: '# Title' }
    expect(tool(tools, 'docx_text').output.render({ file_path: 'report.docx' }, value as never)).toEqual([{
      type: 'text',
      text: `<path>report.docx</path>\n<type>docx</type>\n<content>\n${value.text}\n</content>`,
    }])
    expect(tool(tools, 'docx_text').output.render({}, {}))
      .toEqual([{ type: 'text', text: '<path></path>\n<type>docx</type>\n<content>\n\n</content>' }])
  })
})

describe('office read policy seam', () => {
  it('reads through the session workspace when a confining backend mounts no policy', async () => {
    const { fs, root, tools } = await booted()
    confine(fs)
    writeFileSync(join(root, 'regions.csv'), 'region\nNorth\n')
    const result = await tool(tools, 'csv_read').execute({ file_path: 'regions.csv' }, execution(root)) as {
      sheet: { header?: string[] }
    }
    expect(result.sheet.header).toEqual(['region'])
  })

  it('resolves a relative read against the workspace root the mounted policy returns', async () => {
    const policyRoot = mkdtempSync(join(ROOT_BASE, 'policy-'))
    const requests: Array<{ session?: unknown }> = []
    const { fs, root, tools } = await booted({
      sandboxPolicy: { resolve: (request) => { requests.push(request); return { workspaceRoot: policyRoot } } },
    })
    confine(fs)
    writeFileSync(join(policyRoot, 'rooted.csv'), 'region\nSouth\n')
    const result = await tool(tools, 'csv_read').execute({ file_path: 'rooted.csv' }, execution(root)) as {
      sheet: { rows: unknown[] }
    }
    expect(result.sheet.rows).toEqual([['South']])
    expect(requests).toEqual([{ session: { header: { cwd: root } } }])
  })
})
