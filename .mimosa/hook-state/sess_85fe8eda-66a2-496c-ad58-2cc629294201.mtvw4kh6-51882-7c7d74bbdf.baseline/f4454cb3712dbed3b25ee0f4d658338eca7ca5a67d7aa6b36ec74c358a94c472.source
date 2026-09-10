// FilePreviewPane: the details panel's whole-panel deliverable preview. One
// component behind the `conversation.details.fileview` seat — produced-file
// cards (and any future entry point) hand it a workspace path and it fetches
// `artifacts.preview` and renders the file with the shared preview atoms.
// Replaces the old in-chat modal: the chat stays live beside the rendered
// file, which is also what makes future file watching a natural fit here.

import { useEffect, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { CodeFilePreview, MarkdownFilePreview, ZoomableImage } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArtifactStudioBody, type OfficePreviewData } from '@deepseek-ai/dsh-client-ui-whale-artifact/client'
import { basename } from './turn-deliverables.ts'
import css from './ProducedFiles.module.css'

/** The preview payload served by `artifacts.preview` (narrowed client-side). */
interface ParsedPreview {
  readonly kind: string
  readonly pdfPath?: string
  readonly text?: string
  readonly language?: string
  readonly truncated?: boolean
  readonly notice?: string
}

/** Image extensions the raw channel serves natively (mirrors the card gate). */
function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path)
}

/**
 * Whole-panel file preview for one deliverable. Images and PDFs ride the raw
 * channel (browser-native); everything else parses through the preview RPC
 * and renders with the shared atoms. Bare text on unsupported kinds. Media
 * extensions dispatch to native players — keep that list in sync with the
 * host media classifier (artifacts-preview.ts) and DeliveredCards.kindOf
 * (.mov is excluded: no Chromium/Firefox playback).
 */
export function FilePreviewPane({ path, sessionId, connection, t }: {
  path: string
  sessionId: SessionId
  connection: ConnectionHandle
  t: TranslateNS<'deliverables'>
}) {
  const [preview, setPreview] = useState<
    { readonly status: 'loading' } | { readonly status: 'unsupported' }
    | { readonly status: 'ready'; readonly data: ParsedPreview }
  >({ status: 'loading' })
  const mode = isImage(path) ? 'image' : (/\.pdf$/i.test(path) ? 'pdf'
    : /\.(mp4|m4v|webm)$/i.test(path) ? 'video'
      : /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i.test(path) ? 'audio'
        : 'rpc')
  const rawQuery = new URLSearchParams({ session: sessionId, path })
  // Race guard across rapid pane retargets: the flag is PER EFFECT RUN (a
  // closure local, not a shared ref) — cleanup(A) must not cancel effect(B),
  // and A's late response must never render under B's path. The state reset
  // below also keeps the previous file's content from lingering while the
  // new one loads.
  useEffect(() => {
    if (mode !== 'rpc') return
    let cancelled = false
    setPreview({ status: 'loading' })
    void (async () => {
      try {
        const response = await connection.api.artifacts.preview({ sessionId, path })
        const value = response.result.ok ? response.result.value : undefined
        const parsed = value?.preview as ParsedPreview | undefined
        if (!cancelled) {
          setPreview(parsed !== undefined && typeof parsed.kind === 'string'
            ? { status: 'ready', data: parsed }
            : { status: 'unsupported' })
        }
      } catch {
        if (!cancelled) setPreview({ status: 'unsupported' })
      }
    })()
    return () => { cancelled = true }
  }, [connection, mode, path, sessionId])

  const rawUrl = `/api/artifacts.raw?${rawQuery.toString()}`
  if (mode === 'image') {
    return (
      <div className={css.filePreviewPane}>
        <ZoomableImage src={rawUrl} alt={basename(path)} />
      </div>
    )
  }
  if (mode === 'pdf') {
    return <iframe title={basename(path)} src={rawUrl} className={css.filePreviewFrame} />
  }
  if (mode === 'video') {
    return (
      <div className={css.filePreviewMedia}>
        {/* keyed by path: swapping files must reset the player element, not
            just its src, so playback state never leaks across retargets. */}
        <video key={path} src={rawUrl} controls preload="metadata" className={css.filePreviewVideo} />
      </div>
    )
  }
  if (mode === 'audio') {
    return (
      <div className={css.filePreviewMedia}>
        <audio key={path} src={rawUrl} controls preload="metadata" className={css.filePreviewAudio} />
      </div>
    )
  }
  return (
    <div className={css.filePreviewPane}>
      {preview.status === 'loading' && <p className={css.filePreviewNote}>{t('preview.loading')}</p>}
      {preview.status === 'unsupported' && <p className={css.filePreviewNote}>{t('preview.unsupported')}</p>}
      {preview.status === 'ready' && preview.data.kind === 'pdf' && (
        <iframe
          title={basename(path)}
          src={`/api/artifacts.file?path=${encodeURIComponent(preview.data.pdfPath ?? '')}`}
          className={css.filePreviewFrame}
        />
      )}
      {preview.status === 'ready' && preview.data.kind === 'markdown' && (
        <div className={css.filePreviewScroll}>
          <MarkdownFilePreview text={preview.data.text ?? ''} />
        </div>
      )}
      {preview.status === 'ready' && preview.data.kind === 'text' && (
        <div className={css.filePreviewScroll}>
          <CodeFilePreview text={preview.data.text ?? ''} language={preview.data.language} />
        </div>
      )}
      {preview.status === 'ready' && preview.data.kind !== 'pdf' && preview.data.kind !== 'markdown'
        && preview.data.kind !== 'text' && (
        <div className={css.filePreviewStudio}>
          {preview.data.notice === 'soffice-missing' && (
            <p className={css.sofficeNotice}>{t('preview.sofficeMissing')}</p>
          )}
          <ArtifactStudioBody preview={preview.data as OfficePreviewData} />
        </div>
      )}
    </div>
  )
}
