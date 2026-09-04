/**
 * Artifacts gallery view with right-side preview: the conversation.view tab
 * body. Left column lists workspace `deliverables/` + `uploads/` metadata;
 * clicking Preview parses the file via `artifacts.preview` and renders the
 * SAME studio the tool-details panel uses; Open hands the path to the OS.
 * @module @deepseek-ai/dsh-client-ui-whale-artifacts/src/client/ArtifactsView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ArtifactEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-client-runtime/client'
// Cross-package render reuse (client bundle face): the studio is public API.
import { ArtifactStudioBody, type OfficePreviewData } from '@deepseek-ai/dsh-client-ui-whale-artifact/client'
import type { NS } from './locales.ts'
import type { WorkbookChart } from './WorkbookCharts.tsx'
import { WorkbookPreview, type WorkbookPreviewData } from './WorkbookPreview.tsx'
import css from './ArtifactsView.module.css'

type ArtifactsViewProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<typeof NS>

interface ParsedPreview {
  readonly kind: string
  readonly pdfPath?: string
  readonly truncated?: boolean
  readonly charts?: readonly WorkbookChart[]
}

/** Human byte size. */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Text badge per kind bucket. */
function KindIcon({ kind }: { kind: ArtifactEntry['kind'] }) {
  const label = kind === 'image' ? 'IMG' : kind.toUpperCase()
  return <span className={`${css.icon} ${css[`icon_${kind}`] ?? ''}`}>{label.slice(0, 4)}</span>
}

/** Modified-at stamp (epoch millis), with a fallback for unparseable values. */
export function formatModifiedAt(value: number, fallback: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? fallback : time.toLocaleString()
}

/** Whether this entry has a right-side preview. */
function previewable(kind: ArtifactEntry['kind']): boolean {
  return kind === 'xlsx' || kind === 'docx' || kind === 'pptx' || kind === 'csv'
    || kind === 'pdf' || kind === 'image'
}

/**
 * The gallery + preview split. `useSessions` rides the global standard kit,
 * `sessionId` the session kit; connection arrives through ctx at apply().
 */
export function ArtifactsView({ sessionId, useSessions, connection, t }: ArtifactsViewProps & {
  connection: ConnectionHandle
}) {
  const [artifacts, setArtifacts] = useState<readonly ArtifactEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<ArtifactEntry | null>(null)
  const [preview, setPreview] = useState<
    { readonly status: 'loading' } | { readonly status: 'unsupported' }
    | { readonly status: 'ready'; readonly data: ParsedPreview }
    | { readonly status: 'raw'; readonly url: string }
    | null
  >(null)
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  // Mutable race guard for the async preview parse below. A ref (not a
  // closure local) so the linter cannot constant-fold the "still current"
  // checks away — the cleanup really does flip it after unmounts/reselects.
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const response = await connection.api.artifacts.list({ sessionId })
      if (response.result.ok) {
        setArtifacts(response.result.value.artifacts)
        setFailed(false)
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    }
  }, [connection, sessionId])

  useEffect(() => { void load() }, [load])

  // Reset + parse whenever the selection changes; cancelled-flag guards races.
  useEffect(() => {
    if (selected === null) {
      setPreview(null)
      return
    }
    cancelledRef.current = false
    if (selected.kind === 'pdf' || selected.kind === 'image') {
      // Browser-native rendering: serve the original bytes directly.
      const query = new URLSearchParams({ session: sessionId, path: selected.path })
      setPreview({ status: 'raw', url: `/api/artifacts.raw?${query.toString()}` })
      return
    }
    setPreview({ status: 'loading' })
    void (async () => {
      try {
        const response = await connection.api.artifacts.preview({ sessionId, path: selected.path })
        const value = response.result.ok ? response.result.value : undefined
        const parsed = value?.preview as ParsedPreview | undefined
        if (!cancelledRef.current && parsed !== undefined && typeof parsed.kind === 'string') {
          setPreview({ status: 'ready', data: parsed })
        } else if (!cancelledRef.current) {
          setPreview({ status: 'unsupported' })
        }
      } catch {
        if (!cancelledRef.current) setPreview({ status: 'unsupported' })
      }
    })()
    return () => { cancelledRef.current = true }
  }, [connection, selected, sessionId])

  const open = (entry: ArtifactEntry): void => {
    void connection.api.host.openPath({ path: resolveWorkspacePath(cwd, entry.path) })
  }

  return (
    <div className={`${css.split} ${selected !== null ? css.splitOpen : ''}`}>
      <div className={css.root}>
        {artifacts === null || artifacts.length === 0 ? (
          <p className={css.empty}>
            {artifacts !== null || failed ? t('gallery.empty') : t('gallery.loading')}
          </p>
        ) : (
          <>
            <div className={css.header}>
              <span className={css.count}>{t('gallery.count', { count: artifacts.length })}</span>
              <button type="button" className={css.refresh} onClick={() => { void load() }}>{t('refresh')}</button>
            </div>
            <ul className={css.grid}>
              {artifacts.map(entry => (
                <li key={entry.path} className={`${css.card} ${selected?.path === entry.path ? css.selected : ''}`}>
                  <KindIcon kind={entry.kind} />
                  <div className={css.text}>
                    <span className={css.name} title={entry.path}>{entry.name}</span>
                    <span className={css.meta}>
                      {t(entry.origin === 'upload' ? 'from.upload' : 'from.deliverable')}
                      {' · '}{formatBytes(entry.size)}
                      {' · '}{formatModifiedAt(entry.modifiedAt, t('gallery.unknownDate'))}
                    </span>
                  </div>
                  {previewable(entry.kind) && (
                    <button type="button" className={css.previewBtn} onClick={() => { setSelected(entry) }}>
                      {t('preview')}
                    </button>
                  )}
                  <button type="button" className={css.open} onClick={() => { open(entry) }}>{t('open.app')}</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {selected !== null && (
        <div className={css.pane}>
          <div className={css.paneHeader}>
            <span className={css.paneTitle} title={selected.path}>{selected.name}</span>
            <button type="button" className={css.open} onClick={() => { open(selected) }}>{t('open.app')}</button>
            <button
              type="button" className={css.closePane}
              aria-label={t('preview.close')}
              onClick={() => { setSelected(null); setPreview(null) }}
            >×</button>
          </div>
          <div
            className={`${css.paneBody} ${preview?.status === 'ready' && preview.data.kind !== 'pdf' ? css.paneStudio : ''}`}
            data-whale-artifact-preview=""
          >
            {preview?.status === 'loading' && <p className={css.empty}>{t('gallery.loading')}</p>}
            {preview?.status === 'unsupported' && <p className={css.empty}>{t('preview.unsupported')}</p>}
            {preview?.status === 'ready' && preview.data.kind === 'pdf' && (
              <iframe
                title={selected.name}
                src={`/api/artifacts.file?path=${encodeURIComponent(preview.data.pdfPath ?? '')}`}
                className={css.pdfFrame}
              />
            )}
            {preview?.status === 'raw' && selected.kind === 'image' && (
              <img src={preview.url} alt={selected.name} className={css.rawImage} />
            )}
            {preview?.status === 'raw' && selected.kind !== 'image' && (
              <iframe title={selected.name} src={preview.url} className={css.pdfFrame} />
            )}
            {preview?.status === 'ready' && preview.data.kind === 'xlsx' && (
              <WorkbookPreview key={selected.path} data={preview.data as unknown as WorkbookPreviewData} t={t} />
            )}
            {preview?.status === 'ready' && preview.data.kind !== 'pdf' && preview.data.kind !== 'xlsx' && (
              <>
                <ArtifactStudioBody preview={preview.data as OfficePreviewData} />
                {preview.data.truncated === true && <p className={css.truncNote}>{t('preview.truncated')}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
