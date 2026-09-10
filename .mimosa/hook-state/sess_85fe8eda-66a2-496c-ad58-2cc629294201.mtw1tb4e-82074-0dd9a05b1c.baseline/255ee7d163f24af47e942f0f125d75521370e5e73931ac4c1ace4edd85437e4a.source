import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Right-side artifact studio: the keyed `conversation.details.toolview` entries
 * for the office tools. The xlsx entry renders Excel-style chrome — sheet-tab
 * strip, formula bar, column letters, row gutter, frozen navy header, and
 * gridlines — the pptx entry a slide gallery, and the docx entry a document
 * page. All rendered from the persisted preview meta, so the studio replays
 * identically and needs no file bytes.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/DetailsArtifact
 */
import { useState } from 'react';
import { filePathOf, formatBytes, previewOf } from "./whale-preview.js";
import css from './DetailsArtifact.module.css';
/** Column letter for a 0-based index (A..Z, AA..). */
function columnLetter(index) {
    let letter = '';
    let value = index + 1;
    while (value > 0) {
        const remainder = (value - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        value = Math.floor((value - 1) / 26);
    }
    return letter;
}
/** The studio: header chrome plus the artifact kind's body. */
export function DetailsArtifactView({ block, cwd, t }) {
    const preview = previewOf(block);
    const path = filePathOf(block);
    const toolName = 'kind' in block ? block.call?.name ?? '' : block.name;
    const meta = 'kind' in block ? block.meta : undefined;
    if (preview === undefined) {
        return _jsx("div", { className: css.card, children: t('artifact.failed') });
    }
    return (_jsxs("div", { className: css.card, "data-whale-artifact-details": preview.kind, children: [_jsxs("div", { className: css.header, children: [_jsx("span", { className: `${css.icon} ${css[`icon${preview.kind}`]}`, children: preview.kind.toUpperCase() }), _jsxs("div", { className: css.headText, children: [_jsx("span", { className: css.name, title: path ?? preview.file_name, children: preview.file_name }), _jsxs("span", { className: css.meta, children: [t('artifact.createdBy'), meta?.size !== undefined ? ` · ${formatBytes(meta.size)}` : '', cwd !== undefined && path !== undefined ? ` · ${path}` : ''] })] })] }), preview.kind === 'xlsx' && _jsx(ExcelStudio, { preview: preview }), preview.kind === 'pptx' && _jsx(SlideGallery, { preview: preview }), preview.kind === 'docx' && _jsx(DocPage, { preview: preview }), preview.truncated && _jsx("div", { className: css.truncated, children: t('artifact.truncated') }), _jsx("div", { className: css.footer, children: toolName })] }));
}
/** Studio body for any parsed office preview (shared with the Artifacts tab). */
export function ArtifactStudioBody({ preview }) {
    if (preview.kind === 'xlsx')
        return _jsx(ExcelStudio, { preview: preview });
    if (preview.kind === 'pptx')
        return _jsx(SlideGallery, { preview: preview });
    return _jsx(DocPage, { preview: preview });
}
/** Excel-style spreadsheet studio. */
export function ExcelStudio({ preview }) {
    const [active, setActive] = useState(0);
    const [selected, setSelected] = useState(null);
    const sheet = preview.sheets[active] ?? preview.sheets[0];
    if (sheet === undefined)
        return null;
    const ref = selected === null ? '' : `${columnLetter(selected.col)}${selected.row + 1}`;
    const cell = selected === null ? undefined : sheet.rows[selected.row]?.[selected.col];
    const value = cell?.v ?? '';
    const rowCount = Math.min(sheet.rows.length, 200);
    const colCount = Math.max(sheet.header.length, 1);
    return (_jsxs("div", { className: css.sheet, children: [_jsx("div", { className: css.sheetTabs, children: preview.sheets.map((candidate, index) => (_jsx("button", { type: "button", className: `${css.sheetTab} ${index === active ? css.sheetTabActive : ''}`, onClick: () => { setActive(index); setSelected(null); }, children: candidate.name }, `${candidate.name}-${index}`))) }), _jsxs("div", { className: css.formulaBar, children: [_jsx("span", { className: css.cellRef, children: ref }), _jsx("span", { className: css.formula, children: cell?.f ?? (value !== '' ? value : '') })] }), _jsx("div", { className: css.gridWrap, children: _jsxs("table", { className: css.grid, children: [_jsxs("thead", { children: [_jsxs("tr", { children: [_jsx("th", { className: css.corner }), Array.from({ length: colCount }, (_, col) => (_jsx("th", { className: css.columnHead, children: columnLetter(col) }, `h-${col}`)))] }), _jsxs("tr", { children: [_jsx("th", { className: css.corner }), sheet.header.map((cell, col) => (_jsx("th", { className: css.headerCell, title: cell, children: cell }, `c-${col}`)))] })] }), _jsx("tbody", { children: sheet.rows.slice(0, rowCount).map((row, rowIndex) => (_jsxs("tr", { children: [_jsx("td", { className: css.rowNum, children: rowIndex + 1 }), Array.from({ length: colCount }, (_, col) => {
                                        const cell = row[col]?.v ?? '';
                                        const isSelected = selected !== null && selected.row === rowIndex && selected.col === col;
                                        return (_jsx("td", { className: `${css.cell} ${isSelected ? css.cellSelected : ''}`, onClick: () => { setSelected({ row: rowIndex, col }); }, title: cell, children: cell }, `c-${rowIndex}-${col}`));
                                    })] }, `r-${rowIndex}`))) })] }) })] }));
}
/** Slide gallery studio: larger 16:9 cards in one column, page-numbered. */
export function SlideGallery({ preview }) {
    const total = preview.slides.length + 1;
    return (_jsxs("div", { className: css.gallery, children: [_jsxs("div", { className: `${css.slide} ${css.slideTitle}`, children: [_jsx("span", { className: css.slideDeckTitle, children: preview.title }), _jsxs("span", { className: css.slidePage, children: ["1 / ", total] })] }), preview.slides.map((slide, index) => (_jsxs("div", { className: css.slide, children: [_jsx("span", { className: css.slideAccent }), _jsx("span", { className: css.slideTitleText, children: slide.title }), slide.subtitle !== undefined && _jsx("span", { className: css.slideSubtitle, children: slide.subtitle }), slide.bullets !== undefined && (_jsx("ul", { className: css.slideBullets, children: slide.bullets.map((bullet, bulletIndex) => _jsx("li", { children: bullet }, bulletIndex)) })), _jsxs("span", { className: css.slidePage, children: [index + 2, " / ", total] })] }, index)))] }));
}
/** Document studio: a readable paper page. */
export function DocPage({ preview }) {
    return (_jsxs("div", { className: css.page, children: [preview.title !== undefined && _jsx("div", { className: css.docTitle, children: preview.title }), preview.blocks.map((block, index) => {
                switch (block.type) {
                    case 'heading1': return _jsx("div", { className: css.h1, children: block.text }, index);
                    case 'heading2': return _jsx("div", { className: css.h2, children: block.text }, index);
                    case 'heading3': return _jsx("div", { className: css.h3, children: block.text }, index);
                    case 'quote': return _jsx("div", { className: css.quote, children: block.text }, index);
                    case 'bullet': return _jsxs("div", { className: css.bullet, children: ["\u2022 ", block.text] }, index);
                    case 'number': return _jsxs("div", { className: css.bullet, children: [index + 1, ". ", block.text] }, index);
                    case 'paragraph': return _jsx("div", { className: css.paragraph, children: block.text }, index);
                }
            })] }));
}
//# sourceMappingURL=DetailsArtifact.js.map