/**
 * Whale play-demo seeder (dev tool, not a test): materializes a demo home with
 * one settled session whose log holds real xlsx_create/pptx_create/docx_create
 * calls (with preview metadata + a task-board snapshot), and writes the actual
 * artifact files into the demo workspace. Run from the repo root:
 *   pnpm exec tsx apps/web/tests/whale-play-seed.ts
 *
 * The generator tools were removed from @deepseek-ai/dsh-tool-office (creation
 * is code-first now), so — like whale-office-artifacts.e2e.ts — this seeder
 * carries local builders: bounded preview payloads mirroring
 * dsh-client-ui-whale-artifact's shapes, plus minimal-but-valid OOXML writers
 * (fflate zipSync over hand-built XML parts) for the artifact bytes.
 */
import { zipSync, strToU8 } from 'fflate'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SESSION_FORMAT_VERSION, type JsonValue } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-whale-core/src/types.ts'

const ROOT = resolve(import.meta.dirname, '../../..')
const HOME = join(ROOT, '.dsh-whale-play-home')
const WORKSPACE = join(ROOT, 'whale-play-workspace')
const SESSION_ID = SessionId('whale-play-demo')

interface SeedSheet { name: string; header: string[]; rows: (string | number)[][] }
interface SeedSlide { title: string; subtitle?: string; bullets: string[] }
type SeedBlockType = 'paragraph' | 'heading1' | 'heading2' | 'quote' | 'bullet' | 'number'
interface SeedBlock { type: SeedBlockType; text: string }

const SHEETS: SeedSheet[] = [
  {
    name: 'Revenue',
    header: ['Region', 'Revenue', 'Growth', 'Markup'],
    rows: [
      ['North', 120000, 1.12, 0.42],
      ['South', 98000, 0.97, 0.38],
      ['West', 132000, 1.21, 0.45],
      ['East', 88000, 0.89, 0.35],
      ['Online', 210000, 1.65, 0.52],
      ['Nordics', 45000, 1.02, 0.41],
    ],
  },
  { name: 'Summary', header: ['Metric', 'Value'], rows: [['Total revenue', 693000], ['Best region', 'Online'], ['Avg growth', 1.14]] },
]
const SLIDES: SeedSlide[] = [
  { title: 'Revenue highlights', bullets: ['Online leads growth at +65%', 'North strongest region at 120k', 'Markup stable across regions'] },
  { title: 'Next quarter', subtitle: 'Focus areas', bullets: ['Onboard West retail partners', 'Launch mid-tier plan', 'Hire 2 account managers'] },
  { title: 'Risks', bullets: ['Currency headwinds in Nordics', 'Channel concentration'] },
]
const BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Overview' },
  { type: 'paragraph', text: 'Revenue grew across all regions this quarter. The online channel was the strongest driver of margin, and markup held steady.' },
  { type: 'heading2', text: 'Key findings' },
  { type: 'bullet', text: 'North delivered the fastest baseline growth.' },
  { type: 'bullet', text: 'Online contributed 30% of total revenue.' },
  { type: 'quote', text: 'Consistent pipeline hygiene remains the single largest lever.' },
  { type: 'number', text: 'Review channel attribution models.' },
  { type: 'number', text: 'Re-baseline quotas next week.' },
]

// ---- Bounded preview payloads (dsh-client-ui-whale-artifact shapes) ---------

// Type aliases (not interfaces) so the plain payloads stay assignable to
// session events' `JsonValue` metadata slots without casts.
/** One capped spreadsheet preview cell (display value; no backing formula here). */
type PreviewCell = { v: string }
/** One capped worksheet preview. */
type PreviewSheet = { name: string; header: string[]; rows: PreviewCell[][]; total_rows: number; total_cols: number }
/** One capped slide preview. */
type PreviewSlide = { title: string; subtitle?: string; bullets?: string[] }
/** One capped document block preview. */
type PreviewBlock = { type: SeedBlockType | 'heading3'; text: string }

/** Preview row/col caps, mirroring the removed tool-office generator bounds. */
const PREVIEW_MAX_ROWS = 100
const PREVIEW_MAX_COLS = 60

/**
 * Cap a preview string the way the removed generators did.
 * @param value - raw cell/heading text.
 * @returns the value truncated to the bounded preview length.
 */
function cap(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

/**
 * Basename of a model-facing artifact path.
 * @param path - a model-facing artifact path.
 * @returns the final path segment.
 */
function basename(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}

/**
 * Build the bounded xlsx preview for a seeded workbook.
 * @param filePath - model-facing artifact path.
 * @param sheets - the seeded workbook's sheets.
 * @returns the presentationMeta preview payload.
 */
function xlsxPreview(filePath: string, sheets: readonly SeedSheet[]): JsonValue {
  const capped = sheets.slice(0, PREVIEW_MAX_ROWS).map(sheet => ({
    name: cap(sheet.name),
    header: sheet.header.slice(0, PREVIEW_MAX_COLS).map(cell => cap(cell)),
    rows: sheet.rows.slice(0, PREVIEW_MAX_ROWS).map(row =>
      row.slice(0, PREVIEW_MAX_COLS).map(cell => ({ v: cap(String(cell)) }) satisfies PreviewCell)) as PreviewCell[][],
    total_rows: sheet.rows.length,
    total_cols: Math.max(sheet.header.length, ...sheet.rows.map(row => row.length)),
  }))
  return { kind: 'xlsx', file_name: basename(filePath), sheets: capped satisfies PreviewSheet[], truncated: false }
}

/**
 * Build the bounded pptx preview for a seeded deck.
 * @param filePath - model-facing artifact path.
 * @param title - deck title.
 * @param slides - the seeded deck's slides.
 * @returns the presentationMeta preview payload.
 */
function pptxPreview(filePath: string, title: string, slides: readonly SeedSlide[]): JsonValue {
  return {
    kind: 'pptx',
    file_name: basename(filePath),
    title: cap(title),
    slides: slides.map(slide => ({
      title: cap(slide.title),
      ...(slide.subtitle !== undefined ? { subtitle: cap(slide.subtitle) } : {}),
      bullets: slide.bullets.map(cap),
    })) satisfies PreviewSlide[],
    truncated: false,
  }
}

/**
 * Build the bounded docx preview for a seeded report.
 * @param filePath - model-facing artifact path.
 * @param title - document title.
 * @param blocks - the seeded document's blocks.
 * @returns the presentationMeta preview payload.
 */
function docxPreview(filePath: string, title: string, blocks: readonly SeedBlock[]): JsonValue {
  return {
    kind: 'docx',
    file_name: basename(filePath),
    title: cap(title),
    blocks: blocks.map(block => ({ type: block.type, text: cap(block.text) })) satisfies PreviewBlock[],
    truncated: false,
  }
}

// ---- Minimal OOXML writers (valid containers for the demo artifacts) --------

/** XML declaration shared by every part. */
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
/** Root package relationships pointing at the one office document part. */
const ROOT_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="TARGET"/></Relationships>`

/**
 * Escape text for inclusion in an XML text node or attribute.
 * @param text - raw text.
 * @returns the XML-escaped text.
 */
function xmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, ch =>
    (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&apos;'))
}

/**
 * Zero-based column index to spreadsheet letters (0 -> A, 26 -> AA).
 * @param index - zero-based column index.
 * @returns the spreadsheet column letters.
 */
function columnName(index: number): string {
  let letters = ''
  let rest = index
  while (rest >= 0) {
    letters = String.fromCharCode(65 + (rest % 26)) + letters
    rest = Math.floor(rest / 26) - 1
  }
  return letters
}

/**
 * Render one xlsx cell: inline string for text, plain value for numbers.
 * @param ref - A1 cell reference.
 * @param value - cell value.
 * @returns the `<c>` element XML.
 */
function xlsxCell(ref: string, value: string | number): string {
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
}

/**
 * Build a valid minimal .xlsx workbook (inline-string cells, no shared parts).
 * @param sheets - workbook sheets to write.
 * @returns the .xlsx file bytes.
 */
function buildXlsxBytes(sheets: readonly SeedSheet[]): Uint8Array {
  const parts = sheets.map((sheet, index) => {
    const rows = [sheet.header, ...sheet.rows]
    const body = rows.map((cells, r) =>
      `<row r="${r + 1}">${cells.map((cell, c) => xlsxCell(`${columnName(c)}${r + 1}`, cell)).join('')}</row>`).join('')
    return [`xl/worksheets/sheet${index + 1}.xml`, strToU8(
      `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
    )] as const
  })
  return zipSync({
    '[Content_Types].xml': strToU8(`${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(ROOT_RELS.replace('TARGET', 'xl/workbook.xml')),
    'xl/workbook.xml': strToU8(`${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`),
    ...Object.fromEntries(parts),
  })
}

/** Drawingml namespace bundle shared by the pptx slide parts. */
const PPTX_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
/** Slide shape-tree prologue (group properties every slide part needs). */
const PPTX_SP_TREE_OPEN = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
/** One text shape: a placeholder with paragraph lines. */
const PPTX_TITLE_SHAPE = (text: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`

/**
 * One body-paragraph run line for a pptx text body.
 * @param text - bullet/subtitle line text.
 * @param level - nesting level (0-based).
 * @returns the `<a:p>` element XML.
 */
function pptxLine(text: string, level: number): string {
  return `<a:p><a:pPr lvl="${level}"/><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p>`
}

/**
 * One seeded slide as a minimal pptx slide part (title + body placeholders).
 * @param slide - the slide to write.
 * @param id - slide shape id base.
 * @returns the slideN.xml part content.
 */
function pptxSlideXml(slide: SeedSlide, id: number): string {
  const lines = [
    ...(slide.subtitle !== undefined ? [pptxLine(slide.subtitle, 0)] : []),
    ...slide.bullets.map(bullet => pptxLine(bullet, 0)),
  ].join('')
  return `${XML_DECL}<p:sld ${PPTX_NS}><p:cSld><p:spTree>${PPTX_SP_TREE_OPEN}${PPTX_TITLE_SHAPE(slide.title)}<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${lines}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

/** Minimal theme: full clr/font/fmt scheme lists the spec requires. */
const PPTX_THEME = `${XML_DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Seed"><a:themeElements><a:clrScheme name="Seed"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Seed"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Seed"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
/** Minimal slide master: shape tree, color map, and the one layout reference. */
const PPTX_MASTER = `${XML_DECL}<p:sldMaster ${PPTX_NS}><p:cSld><p:spTree>${PPTX_SP_TREE_OPEN}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
/** Minimal slide layout backing every seeded slide. */
const PPTX_LAYOUT = `${XML_DECL}<p:sldLayout ${PPTX_NS} type="obj" preserve="1"><p:cSld name="Seed"><p:spTree>${PPTX_SP_TREE_OPEN}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

/**
 * Build a valid minimal .pptx deck (master + layout + theme + title/body
 * slides over the 16:9 12.2M-EMU canvas).
 * @param title - deck title.
 * @param slides - deck slides to write.
 * @returns the .pptx file bytes.
 */
function buildPptxBytes(title: string, slides: readonly SeedSlide[]): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(`${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(ROOT_RELS.replace('TARGET', 'ppt/presentation.xml').replace('</Relationships>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')),
    'docProps/core.xml': strToU8(`${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title)}</dc:title></cp:coreProperties>`),
    'ppt/presentation.xml': strToU8(`${XML_DECL}<p:presentation ${PPTX_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}<Relationship Id="rId${slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`),
    'ppt/slideMasters/slideMaster1.xml': strToU8(PPTX_MASTER),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(PPTX_LAYOUT),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`),
    'ppt/theme/theme1.xml': strToU8(PPTX_THEME),
    ...Object.fromEntries(slides.map((slide, index) => [
      `ppt/slides/slide${index + 1}.xml`, strToU8(pptxSlideXml(slide, index + 3)),
    ])),
    ...Object.fromEntries(slides.map((_, index) => [
      `ppt/slides/_rels/slide${index + 1}.xml.rels`, strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`),
    ])),
  })
}

/** docx paragraph run text with escaping. */
const docxRun = (text: string): string => `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`
/** docx list numbering for bullet + decimal seeds (numId 1 = bullets, 2 = numbers). */
const DOCX_NUMBERING = `${XML_DECL}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
/** Named paragraph styles the seeded blocks reference. */
const DOCX_STYLES = `${XML_DECL}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style></w:styles>`

/**
 * One seeded block as a docx paragraph.
 * @param block - the block to write.
 * @returns the `<w:p>` element XML.
 */
function docxParagraph(block: SeedBlock): string {
  if (block.type === 'heading1' || block.type === 'heading2') {
    const style = block.type === 'heading1' ? 'Heading1' : 'Heading2'
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${docxRun(block.text)}</w:p>`
  }
  if (block.type === 'quote') return `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${docxRun(block.text)}</w:p>`
  if (block.type === 'bullet' || block.type === 'number') {
    const numId = block.type === 'bullet' ? 1 : 2
    return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${docxRun(block.text)}</w:p>`
  }
  return `<w:p>${docxRun(block.text)}</w:p>`
}

/**
 * Build a valid minimal .docx report (headings, quote, and list numbering).
 * @param title - document title.
 * @param blocks - document blocks to write.
 * @returns the .docx file bytes.
 */
function buildDocxBytes(title: string, blocks: readonly SeedBlock[]): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(`${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`),
    '_rels/.rels': strToU8(ROOT_RELS.replace('TARGET', 'word/document.xml')),
    'word/document.xml': strToU8(`${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t xml:space="preserve">${xmlEscape(title)}</w:t></w:r></w:p>${blocks.map(docxParagraph).join('')}<w:sectPr/></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`),
    'word/styles.xml': strToU8(DOCX_STYLES),
    'word/numbering.xml': strToU8(DOCX_NUMBERING),
  })
}

async function main(): Promise<void> {
  rmSync(HOME, { recursive: true, force: true })
  rmSync(WORKSPACE, { recursive: true, force: true })
  mkdirSync(join(HOME, 'sessions'), { recursive: true })
  mkdirSync(join(WORKSPACE, 'deliverables'), { recursive: true })
  writeFileSync(join(HOME, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: "2026-08-13.1"\n')

  const xlsxBytes = buildXlsxBytes(SHEETS)
  const pptxBytes = buildPptxBytes('Q1 Review', SLIDES)
  const docxBytes = buildDocxBytes('Quarterly Summary', BLOCKS)
  writeFileSync(join(WORKSPACE, 'deliverables/sales-q1.xlsx'), xlsxBytes)
  writeFileSync(join(WORKSPACE, 'deliverables/quarterly-review.pptx'), pptxBytes)
  writeFileSync(join(WORKSPACE, 'deliverables/summary-report.docx'), docxBytes)

  const calls = [
    { name: 'xlsx_create', callId: CallId('play-xlsx'), preview: xlsxPreview('deliverables/sales-q1.xlsx', SHEETS), path: 'deliverables/sales-q1.xlsx', size: xlsxBytes.byteLength },
    { name: 'pptx_create', callId: CallId('play-pptx'), preview: pptxPreview('deliverables/quarterly-review.pptx', 'Q1 Review', SLIDES), path: 'deliverables/quarterly-review.pptx', size: pptxBytes.byteLength },
    { name: 'docx_create', callId: CallId('play-docx'), preview: docxPreview('deliverables/summary-report.docx', 'Quarterly Summary', BLOCKS), path: 'deliverables/summary-report.docx', size: docxBytes.byteLength },
  ]

  const session = Session.create(SESSION_ID)
  const t0 = Date.now() - 60_000
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Build the quarterly pack: a revenue workbook, a review deck, and a summary report.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Whale Demo — Quarterly Pack', messageSeqs: [1], source: { kind: 'fallback' } })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1, step: 1,
    message: createAssistantMessage({
      content: calls.map(call => ({ type: 'tool-call' as const, id: call.callId, name: call.name, arguments: JSON.stringify({ file_path: call.path }) })),
      source: { provider: 'deepseek-official', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append' })
  for (const call of calls) {
    const source = session.append('tool/call', { turn: 1, step: 1, callId: call.callId, name: call.name, arguments: JSON.stringify({ file_path: call.path }) })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: call.callId, content: [{ type: 'text', text: `path: ${call.path}\nsize: ${call.size}` }], isError: false }),
      meta: { preview: call.preview, size: call.size },
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/start', { turn: 1, step: 2 })
  session.append('whale/task-board', {
    tasks: [{
      id: 'task-daily-brief', name: 'Daily brief', status: 'active', scheduleKind: 'cron',
      scheduleSummary: 'cron "0 9 * * 1-5" in Asia/Shanghai', tz: 'Asia/Shanghai',
      nextRunAt: new Date(Date.now() + 86_400_000).toISOString(), lastRunAt: null, workspaceCwd: WORKSPACE,
    }],
  })
  session.append('assistant/message', {
    turn: 1, step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Done. The workbook, deck, and report are under `deliverables/` in your workspace.' }],
      source: { provider: 'deepseek-official', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const seeder = new Context()
  try {
    await seeder.plugin(SessionStore)
    await seeder.plugin(JsonlSessionPersistence, { root: join(HOME, 'sessions') })
    await seeder.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: SESSION_ID,
      createdAt: t0,
      cwd: WORKSPACE,
      delegationDepth: 0,
    })
    await seeder.sessionPersistence.append(SESSION_ID, session.events.map((event, index) => ({ ...event, time: t0 + index * 1000 })))
  } finally {
    await seeder.fiber.dispose()
  }
  console.log(`SEED_OK home=${HOME} workspace=${WORKSPACE}`)
}

void main().catch((error: unknown) => { console.error('SEED_FAILED', error); process.exitCode = 1 })
