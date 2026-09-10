/**
 * The office read tools (`xlsx_read`, `csv_read`, `docx_text`): bounded,
 * sandboxed extraction over uploaded workspace files so analysis can start
 * from real user data instead of only generating new artifacts.
 * @module @deepseek-ai/dsh-tool-office/src/read-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolResult, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { readWorkspaceBytes } from './read-shared.ts'
import { parseCsvText, parseXlsxBytes } from './read-xlsx.ts'
import type { ReadSheet } from './read-xlsx.ts'
import { extractDocxText } from './read-docx.ts'

/**
 * Boundary cast for extraction payloads: every reader output is JSON-safe by
 * construction (shaped cells, strings/numbers only), but `ReadSheet` lacks a
 * string index signature so the inferred tool value type wants an explicit
 * bridge here rather than erasing structure everywhere downstream.
 */
function jsonValue(value: unknown): JsonValue {
  return value as JsonValue
}

/** Upper bound accepted for max_rows arguments. */
const MAX_ROWS_LIMIT = 400

/**
 * Register all office read tools with their system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 */
export function applyReadTools(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:office-reads',
    order: 105,
    text: 'Reading user files: use xlsx_read on uploaded .xlsx workbooks (per-sheet header, sampled rows, column-type hints, merged ranges, formulas), csv_read on delimited text, and docx_text on .docx documents before analyzing or transforming them. Extraction is bounded; request follow-up slices only when genuinely needed. Analysis outputs still go through the create tools.',
  })
  applyXlsxReadTool(ctx)
  applyCsvReadTool(ctx)
  applyDocxTextTool(ctx)
}

/** Register `xlsx_read`. */
function applyXlsxReadTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'xlsx_read',
    description: 'Read an uploaded .xlsx workbook: sheet names, headers, up to N sampled rows as JSON-safe cells (formulas preserved), per-column type hints, merged ranges.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Workspace-relative path of the workbook.' },
      max_rows: { type: 'number', description: 'Data rows returned per sheet (default 100, hard cap 400).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true, const: 'xlsx' },
          sheet_count: { type: 'integer' },
          sheets: { type: 'json', description: 'Bounded per-sheet extractions.' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${(value as { path?: string }).path ?? ''}</path>
<type>xlsx</type>
<content>
${JSON.stringify(value)}
</content>`,
      }],
    },
    async execute(args: { file_path: string; max_rows?: number }, exec: ToolExecution) {
      const bytes = await readWorkspaceBytes(ctx, exec, args.file_path)
      const parsed = await parseXlsxBytes(bytes, clampRows(args.max_rows))
      return {
        path: args.file_path,
        format: 'xlsx' as const,
        sheet_count: parsed.sheet_count,
        sheets: jsonValue(parsed.sheets),
        truncated: parsed.truncated,
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read workbook ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
    presentResult(_args, _result: ToolResult): undefined {
      return undefined
    },
  }))
}

/** Register `csv_read`. */
function applyCsvReadTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'csv_read',
    description: 'Read a delimited text file (csv/tsv): delimiter sniffing, quoted fields, numeric coercion, bounded sample.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Workspace-relative path of the file.' },
      max_rows: { type: 'number', description: 'Data rows returned (default 200, hard cap 400).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true, const: 'csv' },
          sheet: { type: 'json', description: 'Single-sheet bounded extraction.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${(value as { path?: string }).path ?? ''}</path>
<type>csv</type>
<content>
${JSON.stringify(value)}
</content>`,
      }],
    },
    async execute(args: { file_path: string; max_rows?: number }, exec: ToolExecution) {
      const bytes = await readWorkspaceBytes(ctx, exec, args.file_path)
      const sheet: ReadSheet & { truncated: boolean } = parseCsvText(new TextDecoder().decode(bytes), clampRows(args.max_rows))
      return {
        path: args.file_path,
        format: 'csv' as const,
        sheet: jsonValue(sheet),
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read csv ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
    presentResult(_args, _result: ToolResult): undefined {
      return undefined
    },
  }))
}

/** Register `docx_text`. */
function applyDocxTextTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'docx_text',
    description: 'Extract structured text from a .docx document: headings, paragraphs, list items, and table cell rows as markdown-like lines.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Workspace-relative path of the document.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true, const: 'docx' },
          char_count: { type: 'integer' },
          truncated: { type: 'boolean' },
          text: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${(value as { path?: string }).path ?? ''}</path>
<type>docx</type>
<content>
${(value as { text?: string }).text ?? ''}
</content>`,
      }],
    },
    async execute(args: { file_path: string }, exec: ToolExecution) {
      const bytes = await readWorkspaceBytes(ctx, exec, args.file_path)
      const model = extractDocxText(bytes)
      return {
        path: args.file_path,
        format: 'docx' as const,
        char_count: model.char_count,
        truncated: model.truncated,
        text: renderDocxMarkdown(model.paragraphs),
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read document ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
    presentResult(_args, _result: ToolResult): undefined {
      return undefined
    },
  }))
}

/** Clamp the model-supplied row budget into the supported window. */
function clampRows(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_ROWS
  return Math.min(Math.floor(value), MAX_ROWS_LIMIT)
}

/** Default sampling depth when no explicit budget is provided. */
const DEFAULT_ROWS = 100

/** Render extracted paragraphs as markdown-flavored lines the model parses naturally. */
function renderDocxMarkdown(paragraphs: Array<{ style: string; text: string }>): string {
  return paragraphs.map((paragraph) => {
    switch (paragraph.style) {
      case 'title': return `# ${paragraph.text}`
      case 'heading1': return `## ${paragraph.text}`
      case 'heading2': return `### ${paragraph.text}`
      case 'heading3': return `#### ${paragraph.text}`
      case 'bullet': return `- ${paragraph.text}`
      case 'number': return `1. ${paragraph.text}`
      case 'table-cell': return paragraph.text
      default: return paragraph.text
    }
  }).join('\n')
}
