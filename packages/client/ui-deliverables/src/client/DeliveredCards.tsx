/**
 * Delivered-cards tail row: the user-facing deliverables the model claimed
 * via the `deliver` tool, rendered as rich cards (kind badge, filename,
 * Preview split-button). Preview opens an in-chat modal fed by the same
 * preview pipeline the Artifacts tab uses; the chevron dropdown carries
 * Download (attachment fetch) and Open (Host opener).
 * @module @deepseek-ai/dsh-client-ui-deliverables/src/client/DeliveredCards
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Cross-package render reuse (client bundle face): the studio is public API.
import { ArtifactStudioBody, type OfficePreviewData } from '@deepseek-ai/dsh-client-ui-whale-artifact/client'
import css from './ProducedFiles.module.css'
import { basename } from './turn-deliverables.ts'

/** Kind bucket from extension, for the badge glyph. */
type Kind = 'xlsx' | 'docx' | 'pptx' | 'csv' | 'pdf' | 'py' | 'other'

function kindOf(path: string): Kind {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx'
  if (ext === '.docx') return 'docx'
  if (ext === '.pptx') return 'pptx'
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.py') return 'py'
  return 'other'
}

function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path)
}

/** Kinds the preview pipeline can render. */
function previewable(kind: Kind): boolean {
  return kind === 'xlsx' || kind === 'docx' || kind === 'pptx' || kind === 'csv' || kind === 'pdf'
}

/** Registration-side capability facts (mirrors ProducedFilesInjected). */
export interface DeliveredCardsInjected {
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
    /** The session connection: preview RPC + raw/download channel. */
    connection: ConnectionHandle
  }
}

/** Props composed by reference from the contract + the injected face. */
export type DeliveredCardsProps = Pick<TurnTailOwnerProps, 'openFile' | 'sessionId'> & {
  matched: readonly string[]
  isLoopback: boolean
  useHostDescription: (selector: (value: { canOpenPath?: boolean } | undefined) => boolean) => boolean
  connection: ConnectionHandle
  t: TranslateNS<'deliverables'>
}

/** The preview payload served by `artifacts.preview` (narrowed client-side). */
interface ParsedPreview {
  readonly kind: string
  readonly pdfPath?: string
}

/** Trigger a browser download of one artifact through the raw channel. */
function download(path: string, sessionId: string): void {
  const query = new URLSearchParams({ session: sessionId, path: artifactPath(path), download: '1' })
  const anchor = document.createElement('a')
  anchor.href = `/api/artifacts.raw?${query.toString()}`
  anchor.download = basename(path)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Older deliver claims carry bare or workspace-root paths; the raw channel
 * jails to `deliverables/` and `uploads/`, so rootless claims normalize to
 * deliverables (where the deliver pipeline writes them).
 */
function artifactPath(path: string): string {
  const trimmed = path.replace(/^\.\//, '')
  if (trimmed.startsWith('deliverables/') || trimmed.startsWith('uploads/')) return trimmed
  return `deliverables/${basename(trimmed)}`
}

/** In-chat preview modal: the same pipeline the Artifacts pane renders. */
function PreviewModal({ path, sessionId, connection, openFile, canOpenPath, t, onClose }: {
  path: string
  sessionId: SessionId
  connection: ConnectionHandle
  openFile: (path: string) => void
  canOpenPath: boolean
  t: TranslateNS<'deliverables'>
  onClose: () => void
}) {
  const [preview, setPreview] = useState<
    { readonly status: 'loading' } | { readonly status: 'unsupported' }
    | { readonly status: 'ready'; readonly data: ParsedPreview }
  >({ status: 'loading' })
  // PDFs and images render straight from the raw channel (browser-native),
  // exactly like the Artifacts pane; other kinds ride the preview RPC.
  const servedPath = artifactPath(path)
  const mode = isImage(servedPath) ? 'image' : (/\.pdf$/i.test(servedPath) ? 'pdf' : 'rpc')
  useEffect(() => {
    if (mode !== 'rpc') return
    let cancelled = false
    void (async () => {
      try {
        const response = await connection.api.artifacts.preview({ sessionId, path: servedPath })
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
  }, [connection, mode, path, servedPath, sessionId])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div className={css.scrim} role="presentation" onClick={onClose}>
      <div className={css.modal} role="dialog" aria-label={basename(path)} onClick={event => { event.stopPropagation() }}>
        <div className={css.modalHead}>
          <span className={css.modalTitle} title={path}>{basename(path)}</span>
          <div className={css.modalActions}>
            <a className={css.modalAction} href={`/api/artifacts.raw?${new URLSearchParams({ session: sessionId, path, download: '1' }).toString()}`}>
              {t('delivered.download')}
            </a>
            {canOpenPath && (
              <button type="button" className={css.modalAction} onClick={() => { openFile(path) }}>
                {t('delivered.open')}
              </button>
            )}
            <button type="button" className={css.modalClose} aria-label={t('preview.close')} onClick={onClose}>×</button>
          </div>
        </div>
        <div className={css.modalBody}>
          {mode === 'image' && <img src={`/api/artifacts.raw?${new URLSearchParams({ session: sessionId, path: servedPath }).toString()}`} alt={basename(path)} className={css.modalImage} />}
          {mode === 'pdf' && <iframe title={basename(path)} src={`/api/artifacts.raw?${new URLSearchParams({ session: sessionId, path: servedPath }).toString()}`} className={css.modalFrame} />}
          {mode === 'rpc' && preview.status === 'loading' && <p className={css.modalNote}>{t('preview.loading')}</p>}
          {mode === 'rpc' && preview.status === 'unsupported' && <p className={css.modalNote}>{t('preview.unsupported')}</p>}
          {mode === 'rpc' && preview.status === 'ready' && preview.data.kind === 'pdf' && (
            <iframe
              title={basename(path)}
              src={`/api/artifacts.file?path=${encodeURIComponent(preview.data.pdfPath ?? '')}`}
              className={css.modalFrame}
            />
          )}
          {mode === 'rpc' && preview.status === 'ready' && preview.data.kind !== 'pdf' && (
            <div className={css.modalStudio}>
              <ArtifactStudioBody preview={preview.data as OfficePreviewData} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The delivered row: label + one card per claimed file. */
export function DeliveredCards({
  matched, openFile, sessionId, isLoopback, useHostDescription, connection, t,
}: DeliveredCardsProps) {
  const hostCanOpenPath = useHostDescription(description => description?.canOpenPath === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  const [showAll, setShowAll] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (menuOpenFor === null) return
    const onDown = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setMenuOpenFor(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpenFor(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpenFor])
  const visible = useMemo(
    () => (showAll ? matched : matched.slice(0, 8)),
    [matched, showAll])
  const hidden = matched.length - visible.length
  return (
    <div className={css.root}>
      <span className={css.label}>{t('delivered.label')}</span>
      <div className={css.cardRow}>
        {visible.map(path => {
          const kind = kindOf(path)
          const mainAction = previewable(kind) || isImage(path)
            ? (): void => { setPreviewPath(path) }
            : (): void => { openFile(path) }
          const mainLabel = previewable(kind) || isImage(path) ? t('delivered.preview') : t('delivered.open')
          return (
            <div key={path} className={css.deliveredCard}>
              <span className={`${css.badge} ${css[`badge_${kind}`] ?? ''}`}>
                {kind === 'py' ? 'PY' : kind.toUpperCase()}
              </span>
              <button
                type="button"
                className={css.cardName}
                title={path}
                aria-label={t('produced.open', { name: path })}
                onClick={() => { openFile(path) }}
              >
                {basename(path)}
              </button>
              <div
                className={css.split}
                ref={menuOpenFor === path ? menuRef : undefined}
              >
                <button type="button" className={css.splitMain} onClick={mainAction}>
                  {mainLabel}
                </button>
                <button
                  type="button"
                  className={css.splitChevron}
                  aria-haspopup="menu"
                  aria-expanded={menuOpenFor === path}
                  aria-label={t('delivered.open')}
                  onClick={() => { setMenuOpenFor(current => current === path ? null : path) }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {menuOpenFor === path && (
                  <div className={css.menu} role="menu">
                    <button
                      type="button" role="menuitem" className={css.menuItem}
                      onClick={() => { setMenuOpenFor(null); download(path, sessionId) }}
                    >
                      {t('delivered.download')}
                    </button>
                    {canOpenPath && (
                      <button
                        type="button" role="menuitem" className={css.menuItem}
                        onClick={() => { setMenuOpenFor(null); openFile(path) }}
                      >
                        {t('delivered.open')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {hidden > 0 && (
        <button type="button" className={css.showFolder} onClick={() => { setShowAll(true) }}>
          {t('produced.more', { count: hidden })}
        </button>
      )}
      {previewPath !== null && (
        <PreviewModal
          path={previewPath}
          sessionId={sessionId}
          connection={connection}
          openFile={openFile}
          canOpenPath={canOpenPath}
          t={t}
          onClose={() => { setPreviewPath(null) }}
        />
      )}
    </div>
  )
}
