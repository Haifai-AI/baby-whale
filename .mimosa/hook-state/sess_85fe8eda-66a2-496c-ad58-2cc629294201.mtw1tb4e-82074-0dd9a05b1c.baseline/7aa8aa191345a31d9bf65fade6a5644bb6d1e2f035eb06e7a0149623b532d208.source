/**
 * Shared plumbing for the office read tools: resolve a workspace-relative
 * path through the same sandboxed seam as artifact writes, bounded byte
 * reads, and JSON-safe cell shaping shared by xlsx/csv extraction.
 * @module @deepseek-ai/dsh-tool-office/src/read-shared
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveOfficePolicy, sessionResolveOptions } from './session-cwd.ts'

/** Inclusive cap on one read tool's input payload (25 MB covers real workbooks). */
export const MAX_READ_BYTES = 25 * 1024 * 1024

/**
 * Resolve and read a workspace file as bytes through the sandboxed seam.
 * @param ctx - the plugin context providing the fs seam.
 * @param exec - the tool-execution context (session cwd + cancellation).
 * @param filePath - model-supplied workspace-relative path.
 * @returns the file content.
 */
export async function readWorkspaceBytes(
  ctx: Context,
  exec: ToolExecution,
  filePath: string,
): Promise<Uint8Array> {
  let policyRoot: string | undefined
  try {
    policyRoot = (await resolveOfficePolicy(ctx, exec))?.workspaceRoot
  } catch {
    policyRoot = undefined
  }
  const target = await ctx.fs.resolve(filePath, sessionResolveOptions(exec, filePath, policyRoot))
  return ctx.fs.readBytes(target, exec.signal, MAX_READ_BYTES)
}

/** A JSON-safe table cell produced by the extraction layer. */
export type ReadCell = string | number | { formula: string }

/**
 * Shape an exceljs cell value into a JSON-safe cell.
 * @param value - the raw exceljs cell value union.
 * @returns strings/numbers pass through; formulas keep their text with cached results when numeric.
 */
export function shapeCellValue(value: unknown): ReadCell {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.formula === 'string') {
      const formulaText = typeof record.formula === 'string' ? record.formula : ''
      return { formula: `=${formulaText}` }
    }
    if (typeof record.richText !== 'undefined' && Array.isArray(record.richText)) {
      return record.richText.map(part => typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : String(part)).join('')
    }
    if (typeof record.text === 'string') return record.text
    if (record.error !== undefined) {
      return typeof record.error === 'string' ? `{error:${record.error}}` : '{error}'
    }
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return value
  return ''
}

/**
 * Infer a compact column-type hint from sampled cells.
 * @param cells - shaped sample values for one column.
 * @returns one of number, formula, text.
 */
export function inferColumnType(cells: ReadCell[]): 'number' | 'formula' | 'text' {
  let sawNumber = false
  let sawText = false
  for (const cell of cells) {
    if (typeof cell === 'number') sawNumber = true
    else if (typeof cell !== 'string' || cell.length > 0) sawText = true
    if (typeof cell === 'object') return 'formula'
  }
  if (sawNumber && !sawText) return 'number'
  return sawText ? 'text' : 'number'
}
