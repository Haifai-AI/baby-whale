// File preview atoms shared by the Artifacts gallery and the delivered-file
// modal: a code/text viewer over ReadBlock's highlighted gutter, a markdown
// renderer surface, and a zoomable image. Locale-free on purpose — every
// visible string here is a symbol (+/−/1:1) or caller-supplied content; the
// surrounding surfaces own any localized chrome.

import { useCallback, useMemo, useRef, useState } from 'react'
import { MarkdownText } from './markdown/MarkdownText.tsx'
import { ReadBlock, type ReadBlockLine } from './ReadBlock.tsx'
import css from './FilePreviews.module.css'

/** Lines rendered before ReadBlock's middle-collapse kicks in. */
const CODE_MAX_LINES = 400
/** Hard ceiling on rendered lines — beyond this the collapse note shows. */
const CODE_RENDER_CAP = 20_000

/**
 * Whole-file code/text preview: line-numbered, syntax-highlighted via the
 * shared shiki path. Unknown or absent languages render as plain monospace
 * (ReadBlock's own fallback). Copy and expand come with the block.
 */
export function CodeFilePreview({ text, language }: {
  /** Full file text (already truncated by the server when oversized). */
  text: string
  /** Shiki grammar alias; undefined renders plain monospace. */
  language?: string | undefined
}) {
  const lines = useMemo<readonly ReadBlockLine[]>(() => {
    const all = text.split('\n')
    // A trailing newline yields a final empty line — file viewers do not show it.
    if (all.length > 1 && all[all.length - 1] === '') all.pop()
    const shown = all.length > CODE_RENDER_CAP ? all.slice(0, CODE_RENDER_CAP) : all
    return shown.map((line, index) => ({ number: index + 1, text: line }))
  }, [text])
  return (
    <div className={css.codeFile}>
      <ReadBlock lines={lines} totalLines={lines.length} lang={language} maxLines={CODE_MAX_LINES} />
    </div>
  )
}

/** Whole-file markdown preview through the chat renderer (raw HTML disabled). */
export function MarkdownFilePreview({ text }: { text: string }) {
  return (
    <div className={css.markdownFile}>
      <MarkdownText text={text} />
    </div>
  )
}

/** Zoom steps multiplier per click. */
const ZOOM_STEP = 1.25
/** Zoom bounds. */
const ZOOM_MIN = 0.1
const ZOOM_MAX = 8

/**
 * Image preview with fit-by-default and manual zoom. `null` zoom = fit the
 * pane (image scales down to width, never up); a number = natural size times
 * the factor, scrollable in the pane.
 */
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState<number | null>(null)
  const [natural, setNatural] = useState(0)
  const frameRef = useRef<HTMLDivElement | null>(null)

  const step = useCallback((direction: 1 | -1) => {
    setZoom((current) => {
      const base = current ?? 1
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(base * ZOOM_STEP ** direction * 100) / 100))
    })
  }, [])

  const onNatural = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    setNatural(event.currentTarget.naturalWidth)
  }, [])

  const percent = zoom === null ? null : Math.round(zoom * 100)
  return (
    <div className={css.zoomRoot}>
      <div className={css.zoomBar}>
        <button type="button" className={css.zoomBtn} aria-label="zoom out" onClick={() => step(-1)}>−</button>
        <span className={css.zoomLevel}>{percent === null ? 'Fit' : `${percent}%`}</span>
        <button type="button" className={css.zoomBtn} aria-label="zoom in" onClick={() => step(1)}>+</button>
        <button type="button" className={css.zoomBtn} onClick={() => { setZoom(null) }}>⤢</button>
        <button
          type="button" className={css.zoomBtn} aria-label="actual size"
          onClick={() => { setZoom(1) }} disabled={natural === 0}
        >1:1</button>
      </div>
      <div ref={frameRef} className={`${css.zoomFrame} ${zoom === null ? css.zoomFit : css.zoomFree}`}>
        <img
          src={src} alt={alt} onLoad={onNatural}
          style={zoom === null || natural === 0 ? undefined : { width: Math.round(natural * zoom) }}
          className={css.zoomImg}
        />
      </div>
    </div>
  )
}
