/**
 * Model-facing office READ tools (`xlsx_read`, `csv_read`, `docx_text`):
 * bounded, sandboxed extraction over uploaded workspace files so analysis
 * starts from real user data. Office CREATION is code-first — the model
 * writes and runs Python (openpyxl / python-pptx / python-docx / reportlab)
 * through the bash tool — with finished files surfaced via `deliver`.
 * @module @deepseek-ai/dsh-tool-office
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyReadTools } from './read-tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-office'

/** Services required by the office read suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/**
 * Register the office read tools plus their shared system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 */
export function apply(ctx: Context): void {
  applyReadTools(ctx)
  ctx.systemPrompt.section({
    name: 'tool:office',
    order: 105,
    text: 'Reading user files: use xlsx_read/csv_read/docx_text on uploaded spreadsheets and documents before analyzing them. Creating office files is done by WRITING AND RUNNING PYTHON CODE (openpyxl / python-pptx / python-docx / reportlab) through the bash tool using $DSH_OFFICE_PYTHON, then surfacing finished outputs with the deliver tool.',
  })
}
