/**
 * Pure helpers for the office artifact preview cards: preview-data shapes
 * (mirroring `@deepseek-ai/dsh-tool-office`'s bounded preview payloads), the
 * artifact path extracted from a tool call, and byte formatting.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/whale-preview
 */
/** The three office tool names this package renders. */
export const OFFICE_TOOLS = ['xlsx_create', 'pptx_create', 'docx_create'];
/**
 * Extract the preview from a settled tool-result block, or `undefined` when the
 * block is still running, errored, or carries no preview metadata.
 * @param block - the frozen running or settled tool call.
 * @returns the preview data, or undefined.
 */
export function previewOf(block) {
    if (!('kind' in block) || block.isError)
        return undefined;
    const meta = block.meta;
    return meta?.preview;
}
/**
 * Parse the `file_path` argument back out of a tool call's raw args JSON.
 * @param block - the frozen running or settled tool call.
 * @returns the model-facing artifact path, or undefined when unavailable.
 */
export function filePathOf(block) {
    const argsRaw = 'kind' in block ? block.call?.argsRaw : block.argsRaw;
    if (argsRaw === undefined)
        return undefined;
    try {
        const parsed = JSON.parse(argsRaw);
        return typeof parsed.file_path === 'string' ? parsed.file_path : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * The final path segment for display.
 * @param path - a model-facing artifact path.
 * @returns the basename, or the path itself when it has no separator.
 */
export function basename(path) {
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return index >= 0 ? path.slice(index + 1) : path;
}
/**
 * Format a byte count for the artifact meta line.
 * @param size - byte count.
 * @returns a compact string like "42 KB".
 */
export function formatBytes(size) {
    if (size < 1024)
        return `${size} B`;
    if (size < 1024 * 1024)
        return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
//# sourceMappingURL=whale-preview.js.map