/** Sidebar runtime-setup card: one-time LibreOffice download for previews. */
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './RuntimeSetupCard.module.css'


/** Minimal slice of the officeRuntime.status payload the card renders. */
interface RuntimeStatus {
  readonly soffice: { readonly found: boolean; readonly source: string }
  readonly install: {
    readonly phase: 'idle' | 'downloading' | 'installing' | 'done' | 'error'
    readonly progress: number
    readonly message?: string
    readonly error?: string
  }
  readonly managedSupported: boolean
  readonly guideUrl?: string
}

/** Props for the always-visible setup card (hidden entirely once found). */
export interface RuntimeSetupCardProps {
  readonly connection: ConnectionHandle
  readonly wide: boolean
  readonly t: PropsLocale<'sidebar'>['t']
}

/**
 * Ambient setup card: reappears every launch until the pixel-preview
 * runtime is present, then never again. Never blocks — the app works
 * degraded the whole time.
 * @param props - connection for the officeRuntime RPCs, layout width, translate.
 * @returns the card, or null when the runtime is present or status is unknown.
 */
export function RuntimeSetupCard({ connection, wide, t }: RuntimeSetupCardProps): JSX.Element | null {
  const [status, setStatus] = useState<RuntimeStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await connection.api.officeRuntime.status({})
      const value = response.result.ok ? response.result.value : undefined
      if (value !== undefined) setStatus(value)
    } catch {
      // The card simply stays hidden when the host does not answer.
    }
  }, [connection])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const phase = status?.install.phase
  const running = phase === 'downloading' || phase === 'installing'
  useEffect(() => {
    if (!running) return undefined
    const poll = window.setInterval(() => { void refresh() }, 1_500)
    return () => { window.clearInterval(poll) }
  }, [running, refresh])

  if (status === undefined || status.soffice.found) return null
  const pct = Math.round(status.install.progress * 100)

  const start = (): void => {
    setBusy(true)
    void (async () => {
      try {
        const response = await connection.api.officeRuntime.install({})
        const value = response.result.ok ? response.result.value : undefined
        if (value !== undefined) setStatus({ ...status, install: value.install })
      } catch {
        // The poll picks up the host-side error state.
      } finally {
        setBusy(false)
      }
    })()
  }

  const guided = !status.managedSupported

  return (
    <div className={css.card} data-wide={wide ? '' : undefined} role="status">
      <p className={css.title}>{phase === 'error' ? t('runtime.errorTitle') : t('runtime.title')}</p>
      {phase === 'error' && <p className={css.note}>{status.install.error ?? t('runtime.errorBody')}</p>}
      {phase !== 'error' && <p className={css.note}>{t('runtime.body')}</p>}
      {running && (
        <div className={css.progress} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={css.progressFill} style={{ width: `${pct}%` }} />
        </div>
      )}
      {running && <p className={css.note}>{status.install.message ?? `${pct}%`}</p>}
      {(phase === 'done' || phase === 'installing') && <p className={css.note}>{t('runtime.done')}</p>}
      {(phase === 'idle' || phase === 'error') && (
        guided && status.guideUrl !== undefined
          ? (
            <a className={css.button} href={status.guideUrl} target="_blank" rel="noreferrer">
              {t('runtime.guide')}
            </a>
          )
          : (
            <button type="button" className={css.button} onClick={start} disabled={busy}>
              {t('runtime.action')}
            </button>
          )
      )}
    </div>
  )
}
