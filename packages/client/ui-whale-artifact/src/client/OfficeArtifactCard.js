import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Keyed tool view for the office artifact tools (`xlsx_create`, `pptx_create`,
 * `docx_create`): renders the bounded preview embedded in the tool result's
 * `presentationMeta` as a Cowork-style artifact card — spreadsheet chrome,
 * slide-deck thumbnails, or a document page.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/OfficeArtifactCard
 */
import { useState } from 'react';
import { basename, filePathOf, formatBytes, previewOf } from "./whale-preview.js";
import css from './OfficeArtifactCard.module.css';
/** Brand mini-labels per artifact kind. */
const KINDS = {
    xlsx: { label: 'XLSX', tone: css.iconXlsx },
    pptx: { label: 'PPTX', tone: css.iconPptx },
    docx: { label: 'DOCX', tone: css.iconDocx },
};
/**
 * The artifact card: header (icon, file name, meta, open action) plus the
 * preview body for the artifact's format.
 */
export function OfficeArtifactCard({ callId, toolName, block, openFile, openDetails, t }) {
    const preview = previewOf(block);
    const path = filePathOf(block);
    if (preview === undefined) {
        return (_jsx("div", { className: css.card, children: _jsxs("div", { className: css.header, children: [_jsx("span", { className: `${css.icon} ${css.iconOther}`, children: "DOC" }), _jsx("span", { className: css.name, children: t('artifact.failed') })] }) }));
    }
    const kind = KINDS[preview.kind];
    const displayName = preview.file_name || (path !== undefined ? basename(path) : toolName);
    const meta = 'kind' in block ? block.meta : undefined;
    return (_jsxs("div", { className: css.card, "data-whale-artifact": preview.kind, children: [_jsxs("div", { className: css.header, children: [_jsx("span", { className: `${css.icon} ${kind.tone}`, children: kind.label }), _jsxs("div", { className: css.headText, children: [_jsx("span", { className: css.name, title: path, children: displayName }), _jsxs("span", { className: css.meta, children: [t('artifact.createdBy'), meta?.size !== undefined ? ` · ${formatBytes(meta.size)}` : ''] })] }), path !== undefined && (_jsx("button", { type: "button", className: css.open, onClick: () => { openFile(path); }, children: t('artifact.open', { name: basename(path) }) })), openDetails !== undefined && (_jsx("button", { type: "button", className: css.open, "data-whale-details-button": "", onClick: () => { openDetails({ callId, toolName }); }, children: t('artifact.details') }))] }), _jsxs("div", { className: css.body, children: [preview.kind === 'xlsx' && _jsx(SpreadsheetPreview, { preview: preview }), preview.kind === 'pptx' && _jsx(SlidesPreview, { preview: preview, t: t }), preview.kind === 'docx' && _jsx(DocumentPreview, { preview: preview }), preview.truncated && _jsx("div", { className: css.truncated, children: t('artifact.truncated') })] })] }));
}
/** Spreadsheet chrome: sheet tabs + Excel-style grid. */
function SpreadsheetPreview({ preview }) {
    const [active, setActive] = useState(0);
    const sheet = preview.sheets[active] ?? preview.sheets[0];
    if (sheet === undefined)
        return null;
    const shownRows = Math.min(sheet.rows.length, 100);
    return (_jsxs("div", { className: css.sheet, children: [_jsx("div", { className: css.tabs, children: preview.sheets.map((s, index) => (_jsx("button", { type: "button", className: `${css.tab} ${index === active ? css.tabActive : ''}`, onClick: () => { setActive(index); }, children: s.name }, `${s.name}-${index}`))) }), _jsx("div", { className: css.gridWrap, children: _jsxs("table", { className: css.grid, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: css.rowHead }), sheet.header.map((cell, index) => _jsx("th", { className: css.colHead, children: cell }, index))] }) }), _jsx("tbody", { children: sheet.rows.slice(0, shownRows).map((row, rowIndex) => (_jsxs("tr", { children: [_jsx("td", { className: css.rowNum, children: rowIndex + 1 }), row.map((cell, cellIndex) => _jsx("td", { className: css.cell, children: cell.v }, cellIndex))] }, rowIndex))) })] }) })] }));
}
/** Slide bullets shown per card before the overflow note. */
const MAX_SLIDE_BULLETS = 12;
/** Slide-deck chrome: 16:9 thumbnail cards. */
function SlidesPreview({ preview, t }) {
    return (_jsxs("div", { className: css.deck, children: [_jsx("div", { className: `${css.slideCard} ${css.slideTitle}`, children: _jsx("span", { className: css.slideDeckTitle, children: preview.title }) }), preview.slides.map((slide, index) => (_jsxs("div", { className: css.slideCard, children: [_jsx("span", { className: css.slideAccent }), _jsx("span", { className: css.slideTitleText, children: slide.title }), slide.subtitle !== undefined && _jsx("span", { className: css.slideSubtitle, children: slide.subtitle }), slide.bullets !== undefined && (_jsx("ul", { className: css.slideBullets, children: slide.bullets.slice(0, MAX_SLIDE_BULLETS).map((bullet, bulletIndex) => _jsx("li", { children: bullet }, bulletIndex)) })), slide.bullets !== undefined && slide.bullets.length > MAX_SLIDE_BULLETS && (_jsx("div", { className: css.truncated, children: t('artifact.more', { count: slide.bullets.length - MAX_SLIDE_BULLETS }) }))] }, index)))] }));
}
/** Document chrome: a readable page. */
function DocumentPreview({ preview }) {
    // Running counter: numbered items number among themselves, not by their
    // flat position (headings and paragraphs must not shift the sequence).
    let number = 0;
    return (_jsxs("div", { className: css.page, children: [preview.title !== undefined && _jsx("div", { className: css.docTitle, children: preview.title }), preview.blocks.map((block, index) => {
                switch (block.type) {
                    case 'heading1':
                        return _jsx("div", { className: css.h1, children: block.text }, index);
                    case 'heading2':
                        return _jsx("div", { className: css.h2, children: block.text }, index);
                    case 'heading3':
                        return _jsx("div", { className: css.h3, children: block.text }, index);
                    case 'quote':
                        return _jsx("div", { className: css.quote, children: block.text }, index);
                    case 'bullet':
                        return _jsxs("div", { className: css.bullet, children: ["\u2022 ", block.text] }, index);
                    case 'number':
                        number += 1;
                        return _jsxs("div", { className: css.bullet, children: [number, ". ", block.text] }, index);
                    case 'paragraph':
                        return _jsx("div", { className: css.paragraph, children: block.text }, index);
                }
            })] }));
}
//# sourceMappingURL=OfficeArtifactCard.js.map