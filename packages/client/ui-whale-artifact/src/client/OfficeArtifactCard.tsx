/**
 * Keyed tool view for the office artifact tools (`xlsx_create`, `pptx_create`,
 * `docx_create`): renders the bounded preview embedded in the tool result's
 * `presentationMeta` as a Cowork-style artifact card — spreadsheet chrome,
 * slide-deck thumbnails, or a document page.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/OfficeArtifactCard
 */

import { useState } from 'react'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { OfficeMeta, OfficePreviewData } from './whale-preview.ts'
import { basename, filePathOf, formatBytes, previewOf } from './whale-preview.ts'
import { DocxPage, SlideCard } from './office-pages.tsx'
import type { NS } from './locales.ts'
import css from './OfficeArtifactCard.module.css'

/** Full props: the toolview runtime share plus the plugin's dictionary seat. */
export type OfficeArtifactCardProps = ToolCallViewProps & PropsLocale<typeof NS>

/** Brand mini-labels per artifact kind. */
const KINDS = {
  xlsx: { label: 'XLSX', tone: css.iconXlsx },
  pptx: { label: 'PPTX', tone: css.iconPptx },
  docx: { label: 'DOCX', tone: css.iconDocx },
} as const

/**
 * The artifact card: header (icon, file name, meta, open action) plus the
 * preview body for the artifact's format.
 */
export function OfficeArtifactCard({ callId, toolName, block, openFile, openDetails, t }: OfficeArtifactCardProps) {
  const preview = previewOf(block)
  const path = filePathOf(block)
  if (preview === undefined) {
    return (
      <div className={css.card}>
        <div className={css.header}>
          <span className={`${css.icon} ${css.iconOther}`}>DOC</span>
          <span className={css.name}>{t('artifact.failed')}</span>
        </div>
      </div>
    )
  }
  const kind = KINDS[preview.kind]
  const displayName = preview.file_name || (path !== undefined ? basename(path) : toolName)
  const meta = 'kind' in block ? block.meta as OfficeMeta | undefined : undefined
  return (
    <div className={css.card} data-whale-artifact={preview.kind}>
      <div className={css.header}>
        <span className={`${css.icon} ${kind.tone}`}>{kind.label}</span>
        <div className={css.headText}>
          <span className={css.name} title={path}>{displayName}</span>
          <span className={css.meta}>{t('artifact.createdBy')}{meta?.size !== undefined ? ` · ${formatBytes(meta.size)}` : ''}</span>
        </div>
        {path !== undefined && (
          <button type="button" className={css.open} onClick={() => { openFile(path) }}>
            {t('artifact.open', { name: basename(path) })}
          </button>
        )}
        {openDetails !== undefined && (
          <button
            type="button"
            className={css.open}
            data-whale-details-button=""
            onClick={() => { openDetails({ callId, toolName }) }}
          >
            {t('artifact.details')}
          </button>
        )}
      </div>
      <div className={css.body}>
        {preview.kind === 'xlsx' && <SpreadsheetPreview preview={preview} />}
        {preview.kind === 'pptx' && <SlidesPreview preview={preview} t={t} />}
        {preview.kind === 'docx' && <DocumentPreview preview={preview} />}
        {preview.truncated && <div className={css.truncated}>{t('artifact.truncated')}</div>}
      </div>
    </div>
  )
}

/** Spreadsheet chrome: sheet tabs + Excel-style grid. */
function SpreadsheetPreview({ preview }: { preview: Extract<OfficePreviewData, { kind: 'xlsx' }> }) {
  const [active, setActive] = useState(0)
  const sheet = preview.sheets[active] ?? preview.sheets[0]
  if (sheet === undefined) return null
  const shownRows = Math.min(sheet.rows.length, 100)
  return (
    <div className={css.sheet}>
      <div className={css.tabs}>
        {preview.sheets.map((s, index) => (
          <button
            type="button"
            key={`${s.name}-${index}`}
            className={`${css.tab} ${index === active ? css.tabActive : ''}`}
            onClick={() => { setActive(index) }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className={css.gridWrap}>
        <table className={css.grid}>
          <thead>
            <tr>
              <th className={css.rowHead} />
              {sheet.header.map((cell, index) => <th key={index} className={css.colHead}>{cell}</th>)}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.slice(0, shownRows).map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className={css.rowNum}>{rowIndex + 1}</td>
                {row.map((cell, cellIndex) => <td key={cellIndex} className={css.cell}>{cell.v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Slide bullets shown per card before the overflow note. */
const MAX_SLIDE_BULLETS = 12

/** Slide-deck chrome: 16:9 thumbnail cards. */
function SlidesPreview({ preview, t }: { preview: Extract<OfficePreviewData, { kind: 'pptx' }>; t: TranslateNS<typeof NS> }) {
  return (
    <div className={css.deck}>
      <div className={`${css.slideCard} ${css.slideTitle}`}>
        <span className={css.slideDeckTitle}>{preview.title}</span>
      </div>
      {preview.slides.map((slide, index) => (
        <SlideCard
          key={index}
          slide={slide}
          css={css}
          maxBullets={MAX_SLIDE_BULLETS}
          overflowNote={slide.bullets !== undefined && slide.bullets.length > MAX_SLIDE_BULLETS
            ? t('artifact.more', { count: slide.bullets.length - MAX_SLIDE_BULLETS })
            : undefined}
        />
      ))}
    </div>
  )
}

/** Document chrome: a readable paper page (shared body, card locals). */
function DocumentPreview({ preview }: { preview: Extract<OfficePreviewData, { kind: 'docx' }> }) {
  return <DocxPage preview={preview} css={css} />
}
