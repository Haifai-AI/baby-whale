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
import { withApiTokenQuery } from '@deepseek-ai/dsh-client-connection/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ProducedFiles.module.css'
import { basename } from './turn-deliverables.ts'

/** Kind bucket from extension, for the badge glyph. Media buckets mirror the
 * host media classifier (artifacts-preview.ts) and FilePreviewPane's
 * dispatch; .mov stays 'other' (no Chromium/Firefox playback). */
type Kind = 'xlsx' | 'docx' | 'pptx' | 'csv' | 'pdf' | 'py' | 'md' | 'text' | 'video' | 'audio' | 'other'

/** Human kind label + extension for the card subtitle ("Spreadsheet · XLSX"). */
const KIND_META: Record<Kind, { label: string }> = {
  xlsx: { label: 'Spreadsheet' },
  docx: { label: 'Document' },
  pptx: { label: 'Presentation' },
  csv: { label: 'Spreadsheet' },
  pdf: { label: 'PDF' },
  py: { label: 'Script' },
  md: { label: 'Markdown' },
  text: { label: 'Code' },
  video: { label: 'Video' },
  audio: { label: 'Audio' },
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
  if (kind === 'video') {
    return (
      <svg {...common}>
        <rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.6" {...stroke} />
        <path d="M6.6 6.2l3.6 1.8-3.6 1.8z" {...stroke} />
      </svg>
    )
  }
  if (kind === 'audio') {
    return (
      <svg {...common}>
        <path d="M6.2 11.4V3.6l6-1.2v7.8" {...stroke} />
        <circle cx="4.6" cy="11.6" r="1.7" {...stroke} />
        <circle cx="10.6" cy="10.4" r="1.7" {...stroke} />
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
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'md'
  if (TEXT_PREVIEW_KINDS.test(ext)) return 'text'
  if (/\.(mp4|m4v|webm)$/i.test(ext)) return 'video'
  if (/\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i.test(ext)) return 'audio'
  return 'other'
}

function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path)
}

/** Extensions that preview as text/code (mirrors the server's textPreviewKind). */
const TEXT_PREVIEW_EXTENSIONS = [
  'txt', 'log', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyw', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'dart', 'scala', 'clj',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'cs', 'php', 'lua', 'pl', 'ex', 'exs', 'erl',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'html', 'htm', 'xml', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  'sql', 'graphql', 'gql', 'prisma', 'proto', 'tf', 'hcl', 'r', 'jl', 'zig', 'nim',
]
const TEXT_PREVIEW_KINDS = new RegExp(`\\.(${TEXT_PREVIEW_EXTENSIONS.join('|')})$`, 'i')

/** Kinds the preview pipeline can render. */
function previewable(kind: Kind): boolean {
  return kind === 'xlsx' || kind === 'docx' || kind === 'pptx' || kind === 'csv' || kind === 'pdf'
    || kind === 'md' || kind === 'text' || kind === 'py' || kind === 'video' || kind === 'audio'
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
export type DeliveredCardsProps = Pick<TurnTailOwnerProps, 'openFile' | 'openFilePreview' | 'sessionId'> & {
  matched: readonly string[]
  isLoopback: boolean
  useHostDescription: (selector: (value: { canOpenPath?: boolean } | undefined) => boolean) => boolean
  connection: ConnectionHandle
  t: TranslateNS<'deliverables'>
}

/** Trigger a browser download of one artifact through the raw channel. */
function download(path: string, sessionId: string): void {
  const query = new URLSearchParams({ session: sessionId, path: artifactPath(path), download: '1' })
  const anchor = document.createElement('a')
  anchor.href = withApiTokenQuery(`/api/artifacts.raw?${query.toString()}`)
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


/** The delivered row: label + one card per claimed file. */
export function DeliveredCards({
  matched, openFile, openFilePreview, sessionId, isLoopback, useHostDescription, t,
}: DeliveredCardsProps) {
  const hostCanOpenPath = useHostDescription(description => description?.canOpenPath === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  const [showAll, setShowAll] = useState(false)
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
            ? (): void => { openFilePreview(artifactPath(path)) }
            : (): void => { openFile(path) }
          const mainLabel = previewable(kind) || isImage(path) ? t('delivered.preview') : t('delivered.open')
          return (
            <div key={path} className={css.deliveredCard}>
              <button
                type="button"
                className={css.thumb}
                title={path}
                aria-label={t('produced.open', { name: path })}
                onClick={mainAction}
              >
                <span className={css.thumbPaper}>
                  <KindGlyph kind={kind} />
                </span>
              </button>
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
                  <span className={`${css.btnLogo} ${css[`tile_${kind}`] ?? ''}`}>
                    <KindGlyph kind={kind} />
                  </span>
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
    </div>
  )
}
