/**
 * Whale artifact preview parsers. Upstream dissolved the API gateway this
 * package once hosted into the session/workspace controllers; Baby Whale
 * keeps exactly one thing here — the bounded, read-only preview extraction
 * (xlsx grid + charts, pptx slides, docx blocks, text/code, media identity)
 * that the artifacts routes in `@deepseek-ai/dsh-api-session-controller`
 * serve. The LibreOffice conversion pipeline was dropped with the gateway:
 * office previews parse, they no longer render.
 * @module @deepseek-ai/dsh-host-apiproxy
 */
export { loadWorkbookResilient, mediaPreviewKind, parseDocxPreview, parseMediaPreview, parsePptxPreview, parseTextPreview, parseXlsxCharts, parseXlsxPreview, textPreviewKind, TEXT_PREVIEW_BYTES, type ParsedPreview, type PreviewBlock, type PreviewChart, type PreviewChartSeries, type PreviewCell, type PreviewSheet, type PreviewSlide } from './artifacts-preview.ts'
/** One artifact row of the gallery (wire shape of /api/artifacts.list). */
export interface ArtifactEntry {
  /** Workspace-relative path (the model-facing spelling, e.g. `deliverables/q2.xlsx`). */
  readonly path: string
  /** Base name for display. */
  readonly name: string
  /** Kind bucket driving the icon and preview mode. */
  readonly kind: 'xlsx' | 'docx' | 'pptx' | 'csv' | 'pdf' | 'image' | 'markdown' | 'text' | 'video' | 'audio' | 'other'
  /** Stored byte length. */
  readonly size: number
  /** Last-modified instant (epoch ms). */
  readonly modifiedAt: number
  /** Where the file came from. */
  readonly origin: 'deliverable' | 'upload'
}
//# sourceMappingURL=index.d.ts.map
