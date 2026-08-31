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

/** Human kind label + extension for the card subtitle ("Spreadsheet · XLSX"). */
const KIND_META: Record<Kind, { label: string }> = {
  xlsx: { label: 'Spreadsheet' },
  docx: { label: 'Document' },
  pptx: { label: 'Presentation' },
  csv: { label: 'Spreadsheet' },
  pdf: { label: 'PDF' },
  py: { label: 'Script' },
  other: { label: 'File' },
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toUpperCase()
}

/** Document glyph for the icon tile, tinted per kind by CSS. */
function KindGlyph({ kind }: { kind: Kind }) {
  const common = { width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  const stroke = { stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'xlsx' || kind === 'csv') {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="12" height="12" rx="1.6" {...stroke} />
        <path d="M2 6.2h12M2 10.2h12M6.2 2v12M10 2v12" {...stroke} />
      </svg>
    )
  }
  if (kind === 'docx') {
    return (
      <svg {...common}>
        <path d="M3.4 1.8h6L13 5.4v8.8H3.4z" {...stroke} />
        <path d="M5.4 7.4h5.2M5.4 9.6h5.2M5.4 11.8h3.4" {...stroke} />
      </svg>
    )
  }
  if (kind === 'pptx') {
    return (
      <svg {...common}>
        <rect x="2" y="2.4" width="12" height="9.2" rx="1.4" {...stroke} />
        <path d="M8 11.6v2M5.6 13.6h4.8M5.4 5.2h5.2v3H5.4z" {...stroke} />
      </svg>
    )
  }
  if (kind === 'pdf') {
    return (
      <svg {...common}>
        <path d="M3.4 1.8h6L13 5.4v8.8H3.4z" {...stroke} />
        <path d="M5.2 12.6c2.2-.4 4.6-2.8 5.6-5.4M5.4 9.2c1 .9 2.7 1.5 4.2 1.3" {...stroke} />
      </svg>
    )
  }
  if (kind === 'py') {
    return (
      <svg {...common}>
        <path d="M8 1.8c-2.4 0-3.4 1-3.4 2.4v1.6H8v.8H3.4C2 6.6 1.4 7.6 1.4 8.9c0 1.4.8 2.3 2.2 2.3h1.2v-1.6c0-1.2 1-2.2 2.2-2.2h3.4c1 0 1.9-.9 1.9-2V4.2c0-1.5-1.2-2.4-4.3-2.4z" {...stroke} />
        <circle cx="5.9" cy="4" r="0.9" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M3.4 1.8h6L13 5.4v8.8H3.4z" {...stroke} />
      <path d="M9.2 1.8v3.8H13" {...stroke} />
    </svg>
  )
}

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
      <div className={css.modal} role="dialog" aria-label={basename(path)} onClick={(event) => { event.stopPropagation() }}>
        <div className={css.modalHead}>
          <span className={css.modalTitle} title={path}>{basename(path).replace(/\.[^.]+$/, '')}</span>
          <span className={css.modalKind}>{extensionOf(path)}</span>
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
        {visible.map((path) => {
          const kind = kindOf(path)
          const mainAction = previewable(kind) || isImage(path)
            ? (): void => { setPreviewPath(path) }
            : (): void => { openFile(path) }
          const mainLabel = previewable(kind) || isImage(path) ? t('delivered.preview') : t('delivered.open')
          return (
            <div key={path} className={css.deliveredCard}>
              <span className={`${css.tile} ${css[`tile_${kind}`] ?? ''}`}>
                <KindGlyph kind={kind} />
              </span>
              <div className={css.cardTexts}>
                <button
                  type="button"
                  className={css.cardName}
                  title={path}
                  aria-label={t('produced.open', { name: path })}
                  onClick={() => { openFile(path) }}
                >
                  {basename(path)}
                </button>
                <span className={css.cardKind}>
                  {KIND_META[kind].label} · {extensionOf(path)}
                </span>
              </div>
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
