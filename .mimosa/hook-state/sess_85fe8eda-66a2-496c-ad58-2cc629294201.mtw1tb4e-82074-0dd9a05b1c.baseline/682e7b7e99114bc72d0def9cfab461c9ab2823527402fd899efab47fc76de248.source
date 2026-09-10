/**
 * Artifact preview parsing: bounded, read-only extraction that turns an
 * xlsx/docx/pptx in the workspace into the SAME JSON preview shapes the
 * right-side studio renders (the shapes the removed generator tools used to
 * emit). Code-first files get first-class previews without serving bytes.
 * @module @deepseek-ai/dsh-tool-apiproxy/src/artifacts-preview
 */
import ExcelJS from 'exceljs'
export interface PreviewCell {
  /** Display value (formula cells carry their cached computed result). */
  readonly v: string
  /** Formula text (`=SUM(A1:A2)`) when the cell is a formula. */
  readonly f?: string
}
export interface PreviewSheet {
  readonly name: string
  readonly header: string[]
  readonly rows: PreviewCell[][]
  readonly total_rows: number
  readonly total_cols: number
}
export interface PreviewSlide {
  readonly title: string
  readonly bullets?: string[]
}
export interface PreviewBlock {
  readonly type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'quote' | 'bullet' | 'number' | 'callout' | 'caption' | 'image' | 'table'
  readonly text: string
}
/** One series of a workbook chart: cached labels and cached numbers. */
export interface PreviewChartSeries {
  readonly name?: string
  readonly categories: readonly string[]
  readonly values: readonly number[]
}
/** One chart parsed from a workbook's `xl/charts/chartN.xml` part. */
export interface PreviewChart {
  readonly type: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter'
  readonly title?: string
  /** Sheet the chart is anchored to, when resolvable. */
  readonly sheet?: string
  readonly series: readonly PreviewChartSeries[]
}
/** The parse result union — mirrors ui-whale-artifact's OfficePreviewData. */
export type ParsedPreview = {
  kind: 'xlsx'
  file_name: string
  sheets: PreviewSheet[]
  truncated: boolean
  charts?: PreviewChart[]
  /** LibreOffice single-page-per-sheet render for the "Original" tab. */
  pdfPath?: string
} | {
  kind: 'pptx'
  file_name: string
  title: string
  slides: PreviewSlide[]
  truncated: boolean
  /** Set when LibreOffice is absent and the pixel-true PDF preview is unavailable. */
  notice?: 'soffice-missing'
} | {
  kind: 'docx'
  file_name: string
  blocks: PreviewBlock[]
  truncated: boolean
  /** Set when LibreOffice is absent and the pixel-true PDF preview is unavailable. */
  notice?: 'soffice-missing'
}
/** LibreOffice-converted PDF served through the artifacts.file GET route. */
 | {
   kind: 'pdf'
   file_name: string
   pdfPath: string
 }
/** Markdown source, rendered client-side by the shared markdown renderer. */
 | {
   kind: 'markdown'
   file_name: string
   text: string
   truncated: boolean
 }
/** Text/code source, rendered client-side by the highlighted line viewer. */
 | {
   kind: 'text'
   file_name: string
   text: string
   language?: string
   truncated: boolean
 }
/** Video file — identity only; bytes stream from the raw channel with Range support. */
 | {
   kind: 'video'
   file_name: string
 }
/** Audio file — identity only; bytes stream from the raw channel with Range support. */
 | {
   kind: 'audio'
   file_name: string
 }
/** Decode cap for whole-file text previews (markdown/code/JSON). */
export declare const TEXT_PREVIEW_BYTES: number
/** Which preview bucket a text-ish extension maps to: 'markdown', 'text', or undefined. */
export declare function textPreviewKind(ext: string): 'markdown' | 'text' | undefined
/** Media preview bucket for an extension; undefined when the type is not a playable medium. */
export declare function mediaPreviewKind(ext: string): 'video' | 'audio' | undefined
/**
 * Build the media preview payload. Bytes are never parsed — the player rides
 * the raw channel (Range-capable), so the preview only carries identity.
 */
export declare function parseMediaPreview(filePath: string): ParsedPreview
/** Shiki grammar hint for a text extension; undefined renders plain monospace. */
export declare function textPreviewLanguage(ext: string): string | undefined
/**
 * Parse a text-ish artifact (markdown or code/JSON/whatever) into the
 * bounded preview payload: decoded source capped at {@link TEXT_PREVIEW_BYTES},
 * plus the renderer hint. Binary content decodes to replacement characters —
 * acceptable for a preview of a file the caller believes is text.
 */
export declare function parseTextPreview(bytes: Uint8Array, filePath: string): ParsedPreview
/**
 * exceljs 4.4 crashes in XLSX.reconcile on openpyxl-written workbooks that
 * carry charts/drawings (`drawing.anchors` undefined). Charts carry no text
 * preview value, so on that failure strip drawing/chart/media parts and the
 * sheets' `<drawing>` references, then reload.
 */
export declare function loadWorkbookResilient(bytes: Uint8Array): Promise<ExcelJS.Workbook | undefined>
/** Parse an .xlsx payload into capped worksheet previews. */
export declare function parseXlsxPreview(bytes: Uint8Array, fileName: string): Promise<ParsedPreview | undefined>
/** Parse a .pptx payload into capped slide previews by harvesting shape text. */
export declare function parsePptxPreview(bytes: Uint8Array, fileName: string): ParsedPreview | undefined
/** Parse a .docx payload into capped block previews off word/document.xml. */
export declare function parseDocxPreview(bytes: Uint8Array, fileName: string): ParsedPreview | undefined
/** Result of one LibreOffice conversion. */
export interface ConvertedPdf {
  /** Absolute path of the converted PDF inside the preview cache. */
  readonly pdfPath: string
}
/**
 * Extract the workbook's embedded charts for the Charts tab. Excel writes
 * cached series values into the chart part; XlsxWriter does not, so ranges
 * are resolved against the worksheet data (loaded lazily, only when a
 * reference lacks a cache) via the same resilient loader the grid uses.
 */
export declare function parseXlsxCharts(bytes: Uint8Array): Promise<PreviewChart[]>
/**
 * Locate a usable LibreOffice binary. Cached: the probe spawns `--version`
 * once, so a broken install does not re-probe on every preview.
 * @returns absolute binary path, or undefined when LibreOffice is absent.
 */
export declare function findSoffice(): string | undefined
/**
 * Drop the cached soffice lookup — e.g. when the user installs LibreOffice
 * while the app is already running.
 */
export declare function resetSofficeLookup(): void
/**
 * Convert an office document to PDF via headless LibreOffice, cached by
 * source mtime. A unique user-profile per conversion avoids soffice's
 * single-instance profile lock.
 * @param soffice - LibreOffice binary path.
 * @param sourcePath - absolute office document path.
 * @param cacheDir - directory receiving the PDF.
 * @param sourceMtimeMs - source modification time for cache validation.
 * @param filterSpec - optional `--convert-to` spec overriding plain `pdf`
 *   (e.g. Calc's SinglePageSheets export); when the spec yields nothing the
 *   conversion retries with plain `pdf` for older LibreOffice installs.
 * @returns the cached PDF path, or undefined when conversion failed.
 */
export declare function convertToPdfCached(soffice: string, sourcePath: string, cacheDir: string, sourceMtimeMs: number, filterSpec?: string): Promise<string | undefined>
/** The gateway-owned directory receiving converted preview PDFs. */
export declare function previewCacheDir(): string
/**
 * Whether any grid cell displays a formula string because the workbook (as
 * XlsxWriter and openpyxl write them) carried no cached computed result.
 * Such previews show `=SUM(...)` where Excel would show the value — the cue
 * for the recalc round-trip below.
 */
export declare function xlsxHasUncachedFormulas(preview: ParsedPreview): boolean
/**
 * Recalculate a workbook by round-tripping it through headless LibreOffice
 * (`--convert-to xlsx`): Calc computes every formula on load and the
 * converted copy carries cached results the parser can read. Cached by
 * source mtime under the preview cache.
 * @returns the recalculated workbook bytes, or undefined on failure.
 */
export declare function recalcXlsxBytes(soffice: string, sourcePath: string, cacheDir: string, sourceMtimeMs: number): Promise<Uint8Array | undefined>
//# sourceMappingURL=artifacts-preview.d.ts.map
