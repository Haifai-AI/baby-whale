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
export { loadWorkbookResilient, mediaPreviewKind, parseDocxPreview, parseMediaPreview, parsePptxPreview, parseTextPreview, parseXlsxCharts, parseXlsxPreview, textPreviewKind, TEXT_PREVIEW_BYTES, } from "./artifacts-preview.js";
//# sourceMappingURL=index.js.map