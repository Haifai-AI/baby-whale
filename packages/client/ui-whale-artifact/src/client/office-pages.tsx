/**
 * Office preview page bodies shared by the artifact card and the details
 * studio: both render the persisted presentationMeta, so the slide card and
 * the document page are defined once here, parameterized by each surface's
 * CSS-module locals.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/office-pages
 */

import type { OfficePreviewData } from './whale-preview.ts'

/** One slide preview from the pptx payload. */
type PreviewSlide = Extract<OfficePreviewData, { kind: 'pptx' }>['slides'][number]

/**
 * One slide card: accent bar, title, optional subtitle, and bullet list. The
 * studio carries a page label; the compact card caps the bullets and carries
 * the overflow note instead.
 * @param props - the slide, the surface's class locals, and the surface's extras.
 * @returns the slide card element.
 */
export function SlideCard({ slide, css, pageLabel, maxBullets, overflowNote }: {
  slide: PreviewSlide
  /** The surface's CSS module; reads the slide/slideAccent/slideTitleText/slideSubtitle/slideBullets (+ slidePage/truncated) locals. */
  css: Record<string, string>
  /** Page label ("2 / 3"); the studio passes it, the compact card does not. */
  pageLabel?: string | undefined
  /** Bullet cap; undefined keeps every bullet. */
  maxBullets?: number | undefined
  /** Overflow note rendered under a capped bullet list. */
  overflowNote?: string | undefined
}) {
  return (
    <div className={css.slide}>
      <span className={css.slideAccent} />
      <span className={css.slideTitleText}>{slide.title}</span>
      {slide.subtitle !== undefined && <span className={css.slideSubtitle}>{slide.subtitle}</span>}
      {slide.bullets !== undefined && (
        <ul className={css.slideBullets}>
          {(maxBullets === undefined ? slide.bullets : slide.bullets.slice(0, maxBullets))
            .map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}
        </ul>
      )}
      {overflowNote !== undefined && <div className={css.truncated}>{overflowNote}</div>}
      {pageLabel !== undefined && <span className={css.slidePage}>{pageLabel}</span>}
    </div>
  )
}

/**
 * The document page: a readable paper rendering of the capped docx blocks.
 * Numbered blocks number among themselves — headings and paragraphs must not
 * shift the sequence (the card's numbering rule, pinned by its spec).
 * @param props - the docx preview and the surface's class locals.
 * @returns the page element.
 */
export function DocxPage({ preview, css }: {
  preview: Extract<OfficePreviewData, { kind: 'docx' }>
  /** The surface's CSS module; reads the page/docTitle/h1/h2/h3/quote/bullet/paragraph locals. */
  css: Record<string, string>
}) {
  let number = 0
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
          case 'number':
            number += 1
            return <div key={index} className={css.bullet}>{number}. {block.text}</div>
          case 'paragraph': return <div key={index} className={css.paragraph}>{block.text}</div>
        }
      })}
    </div>
  )
}
