/**
 * Pure helpers for the office artifact preview cards: preview-data shapes
 * (mirroring `@deepseek-ai/dsh-tool-office`'s bounded preview payloads), the
 * artifact path extracted from a tool call, and byte formatting.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/whale-preview
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One capped spreadsheet preview cell (display value + backing formula). */
interface PreviewCell {
  v: string
  /** Formula text (`=SUM(A1:A2)`) when the cell is a formula. */
  f?: string
}

/** One capped worksheet preview. */
interface PreviewSheet {
  name: string
  header: string[]
  rows: PreviewCell[][]
  total_rows: number
  total_cols: number
}

/** One capped slide preview. */
interface PreviewSlide {
  title: string
  subtitle?: string
  bullets?: string[]
}

/** One capped document block preview. */
interface PreviewBlock {
  type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'quote' | 'bullet' | 'number'
  text: string
}

/** The bounded preview carried in a tool result's `presentationMeta`. */
export type OfficePreviewData =
  | { kind: 'xlsx'; file_name: string; truncated: boolean; sheets: PreviewSheet[] }
  | { kind: 'pptx'; file_name: string; truncated: boolean; title: string; slides: PreviewSlide[] }
  | { kind: 'docx'; file_name: string; truncated: boolean; title?: string; blocks: PreviewBlock[] }

/** The `presentationMeta` payload of an office tool result. */
export interface OfficeMeta {
  preview?: OfficePreviewData
  /** Byte length of the artifact, when the tool result carried it. */
  size?: number
}

/** The three office tool names this package renders. */
export const OFFICE_TOOLS = ['xlsx_create', 'pptx_create', 'docx_create'] as const

/**
 * Extract the preview from a settled tool-result block, or `undefined` when the
 * block is still running, errored, or carries no preview metadata.
 * @param block - the frozen running or settled tool call.
 * @returns the preview data, or undefined.
 */
export function previewOf(block: ToolCallBlock): OfficePreviewData | undefined {
  if (!('kind' in block) || block.isError) return undefined
  const meta = block.meta as OfficeMeta | undefined
  return meta?.preview
}

/**
 * Parse the `file_path` argument back out of a tool call's raw args JSON.
 * @param block - the frozen running or settled tool call.
 * @returns the model-facing artifact path, or undefined when unavailable.
 */
export function filePathOf(block: ToolCallBlock): string | undefined {
  const argsRaw = 'kind' in block ? block.call?.argsRaw : block.argsRaw
  if (argsRaw === undefined) return undefined
  try {
    const parsed = JSON.parse(argsRaw) as { file_path?: unknown }
    return typeof parsed.file_path === 'string' ? parsed.file_path : undefined
  } catch {
    return undefined
  }
}

/**
 * The final path segment for display.
 * @param path - a model-facing artifact path.
 * @returns the basename, or the path itself when it has no separator.
 */
export function basename(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}

/**
 * Format a byte count for the artifact meta line.
 * @param size - byte count.
 * @returns a compact string like "42 KB".
 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
