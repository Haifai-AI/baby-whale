/**
 * Office artifact studios. The bodies render from the persisted preview meta
 * (xlsx: Excel-style chrome — sheet tabs, formula bar, column letters, frozen
 * navy header, gridlines; pptx: slide gallery; docx: document page), so the
 * studio replays identically and needs no file bytes.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/DetailsArtifact
 */

import { useState } from 'react'
import type { OfficePreviewData } from './whale-preview.ts'
import css from './DetailsArtifact.module.css'

/** Column letter for a 0-based index (A..Z, AA..). */
function columnLetter(index: number): string {
  let letter = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    value = Math.floor((value - 1) / 26)
  }
  return letter
}

/** The studio body for any parsed office preview (shared with the Artifacts tab). */
export function ArtifactStudioBody({ preview }: { preview: OfficePreviewData }) {
  if (preview.kind === 'xlsx') return <ExcelStudio preview={preview} />
  if (preview.kind === 'pptx') return <SlideGallery preview={preview} />
  return <DocPage preview={preview} />
}

/** Excel-style spreadsheet studio. */
export function ExcelStudio({ preview }: { preview: Extract<OfficePreviewData, { kind: 'xlsx' }> }) {
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const sheet = preview.sheets[active] ?? preview.sheets[0]
  if (sheet === undefined) return null
  const ref = selected === null ? '' : `${columnLetter(selected.col)}${selected.row + 1}`
  const cell = selected === null ? undefined : sheet.rows[selected.row]?.[selected.col]
  const value = cell?.v ?? ''
  const rowCount = Math.min(sheet.rows.length, 200)
  const colCount = Math.max(sheet.header.length, 1)
  return (
    <div className={css.sheet}>
      <div className={css.sheetTabs}>
        {preview.sheets.map((candidate, index) => (
          <button
            type="button"
            key={`${candidate.name}-${index}`}
            className={`${css.sheetTab} ${index === active ? css.sheetTabActive : ''}`}
            onClick={() => { setActive(index); setSelected(null) }}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      <div className={css.formulaBar}>
        <span className={css.cellRef}>{ref}</span>
        <span className={css.formula}>{cell?.f ?? (value !== '' ? value : '')}</span>
      </div>
      <div className={css.gridWrap}>
        <table className={css.grid}>
          <thead>
            <tr>
              <th className={css.corner} />
              {Array.from({ length: colCount }, (_, col) => (
                <th key={`h-${col}`} className={css.columnHead}>
                  {columnLetter(col)}
                </th>
              ))}
            </tr>
            <tr>
              <th className={css.corner} />
              {sheet.header.map((cell, col) => (
                <th key={`c-${col}`} className={css.headerCell} title={cell}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.slice(0, rowCount).map((row, rowIndex) => (
              <tr key={`r-${rowIndex}`}>
                <td className={css.rowNum}>{rowIndex + 1}</td>
                {Array.from({ length: colCount }, (_, col) => {
                  const cell = row[col]?.v ?? ''
                  const isSelected = selected !== null && selected.row === rowIndex && selected.col === col
                  return (
                    <td
                      key={`c-${rowIndex}-${col}`}
                      className={`${css.cell} ${isSelected ? css.cellSelected : ''}`}
                      onClick={() => { setSelected({ row: rowIndex, col }) }}
                      title={cell}
                    >
                      {cell}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Slide gallery studio: larger 16:9 cards in one column, page-numbered. */
export function SlideGallery({ preview }: { preview: Extract<OfficePreviewData, { kind: 'pptx' }> }) {
  const total = preview.slides.length + 1
  return (
    <div className={css.gallery}>
      <div className={`${css.slide} ${css.slideTitle}`}>
        <span className={css.slideDeckTitle}>{preview.title}</span>
        <span className={css.slidePage}>1 / {total}</span>
      </div>
      {preview.slides.map((slide, index) => (
        <div key={index} className={css.slide}>
          <span className={css.slideAccent} />
          <span className={css.slideTitleText}>{slide.title}</span>
          {slide.subtitle !== undefined && <span className={css.slideSubtitle}>{slide.subtitle}</span>}
          {slide.bullets !== undefined && (
            <ul className={css.slideBullets}>
              {slide.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}
            </ul>
          )}
          <span className={css.slidePage}>{index + 2} / {total}</span>
        </div>
      ))}
    </div>
  )
}

/** Document studio: a readable paper page. */
export function DocPage({ preview }: { preview: Extract<OfficePreviewData, { kind: 'docx' }> }) {
  return (
    <div className={css.page}>
      {preview.title !== undefined && <div className={css.docTitle}>{preview.title}</div>}
      {preview.blocks.map((block, index) => {
        switch (block.type) {
          case 'heading1': return <div key={index} className={css.h1}>{block.text}</div>
          case 'heading2': return <div key={index} className={css.h2}>{block.text}</div>
          case 'heading3': return <div key={index} className={css.h3}>{block.text}</div>
          case 'quote': return <div key={index} className={css.quote}>{block.text}</div>
          case 'bullet': return <div key={index} className={css.bullet}>• {block.text}</div>
          case 'number': return <div key={index} className={css.bullet}>{index + 1}. {block.text}</div>
          case 'paragraph': return <div key={index} className={css.paragraph}>{block.text}</div>
        }
      })}
    </div>
  )
}
