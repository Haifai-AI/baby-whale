// FilePreviewPane: the details panel's whole-panel deliverable preview. One
// component behind the `conversation.details.fileview` seat — produced-file
// cards (and any future entry point) hand it a workspace path and it fetches
// `artifacts.preview` and renders the file with the shared preview atoms.
// Replaces the old in-chat modal: the chat stays live beside the rendered
// file, which is also what makes future file watching a natural fit here.

import { useEffect, useRef, useState } from 'react'
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
 * and renders with the shared atoms. Bare text on unsupported kinds.
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
  const mode = isImage(path) ? 'image' : (/\.pdf$/i.test(path) ? 'pdf' : 'rpc')
  const rawQuery = new URLSearchParams({ session: sessionId, path })
  // Race guard across rapid pane retargets (cards spam-open the same seat).
  const cancelled = useRef(false)
  useEffect(() => {
    if (mode !== 'rpc') return
    cancelled.current = false
    void (async () => {
      try {
        const response = await connection.api.artifacts.preview({ sessionId, path })
        const value = response.result.ok ? response.result.value : undefined
        const parsed = value?.preview as ParsedPreview | undefined
        if (!cancelled.current) {
          setPreview(parsed !== undefined && typeof parsed.kind === 'string'
            ? { status: 'ready', data: parsed }
            : { status: 'unsupported' })
        }
      } catch {
        if (!cancelled.current) setPreview({ status: 'unsupported' })
      }
    })()
    return () => { cancelled.current = true }
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
