import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { McpStatusSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14,
  IconPlusOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpSettingsLocaleKey } from './locales.ts'
import css from './McpSettingsTab.module.css'

/** One saved server as the client sees the `mcp` settings section. */
export interface McpServerEntryView {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly transport: 'stdio' | 'streamable-http'
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly toolCallTimeoutMs: number
}

/** The whole `mcp` settings section shape. */
export interface McpSettingsView {
  readonly servers: readonly McpServerEntryView[]
}

/** Registration-side Host faces used by the tab. */
export interface McpSettingsTabInjected {
  /** Read a current Host status snapshot. */
  list: () => Promise<McpStatusSnapshot>
  /** Force one server's remount and read the snapshot after it settles. */
  restart: (id: string) => Promise<McpStatusSnapshot>
  /** The bound `mcp` settings scope (section value, writes, writability). */
  scope: SettingsScope<McpSettingsView>
}

type McpServerStatus = McpStatusSnapshot['servers'][number]
type ServerState = McpServerStatus['state']

/** Full component props assembled by the Settings slot renderer. */
export type McpSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpSettingsTabInjected>

/** Staged editable form over one server entry. */
interface Draft {
  readonly id: string | null
  name: string
  enabled: boolean
  transport: 'stdio' | 'streamable-http'
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
  timeoutText: string
}

import { parseImport, newId } from './json-import.ts'

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

const STATE_KEYS: Record<ServerState, McpSettingsLocaleKey> = {
  connected: 'stateConnected',
  connecting: 'stateConnecting',
  failed: 'stateFailed',
  disabled: 'stateDisabled',
} as const

/** Locale key coloring the status dot per state (via CSS `data-state`). */
function stateKey(state: ServerState): McpSettingsLocaleKey {
  return STATE_KEYS[state]
}

/** One KEY=VALUE per line → record (last line wins a duplicate key). */
function linesToRecord(text: string): Record<string, string> {
  const record: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    record[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return record
}

/** Record → sorted KEY=VALUE lines, stable across edit rounds. */
function recordToLines(record: Readonly<Record<string, string>>): string {
  return Object.keys(record).sort()
    .map(key => `${key}=${record[key]}`)
    .join('\n')
}

/** Entry → staged form. */
function draftOf(entry: McpServerEntryView): Draft {
  return {
    id: entry.id,
    name: entry.name,
    enabled: entry.enabled,
    transport: entry.transport,
    command: entry.command,
    argsText: [...entry.args].join('\n'),
    envText: recordToLines(entry.env),
    cwd: entry.cwd,
    url: entry.url,
    headersText: recordToLines(entry.headers),
    timeoutText: String(Math.round(entry.toolCallTimeoutMs / 1000)),
  }
}

/** Blank staged form for a new server. */
function blankDraft(transport: 'stdio' | 'streamable-http'): Draft {
  return {
    id: null, name: '', enabled: true, transport,
    command: '', argsText: '', envText: '', cwd: '',
    url: '', headersText: '', timeoutText: '60',
  }
}

/** Staged form → savable entry, or the first blocking problem. */
function entryOf(draft: Draft): { ok: true; entry: McpServerEntryView } | { ok: false } {
  if (!NAME_PATTERN.test(draft.name)) return { ok: false }
  const timeoutSeconds = Number.parseInt(draft.timeoutText, 10)
  const entry: McpServerEntryView = {
    id: draft.id ?? newId(),
    name: draft.name,
    enabled: draft.enabled,
    transport: draft.transport,
    command: draft.command.trim(),
    args: draft.argsText.split('\n').map(line => line.trim()).filter(line => line.length > 0),
    env: linesToRecord(draft.envText),
    cwd: draft.cwd.trim(),
    url: draft.url.trim(),
    headers: linesToRecord(draft.headersText),
    toolCallTimeoutMs: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 60_000,
  }
  if (entry.transport === 'stdio' && entry.command.length === 0) return { ok: false }
  if (entry.transport === 'streamable-http' && entry.url.length === 0) return { ok: false }
  return { ok: true, entry }
}

/** Render the MCP servers management tab. */
export function McpSettingsTab({ list, restart, scope, t }: McpSettingsTabProps): ReactNode {
  // The scope controller's methods are class members: bind through stable
  // closures so useSyncExternalStore sees fixed identities and `this` lands.
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const [statuses, setStatuses] = useState<McpStatusSnapshot | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [statusRequest, setStatusRequest] = useState(0)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importFailure, setImportFailure] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const servers = useMemo(
    () => (snapshot.value !== undefined && Array.isArray(snapshot.value.servers) ? snapshot.value.servers : []),
    [snapshot.value],
  )
  const writable = snapshot.writable && snapshot.mode === 'host'

  const refreshStatuses = useCallback(() => { setStatusRequest(value => value + 1) }, [])

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => {
        if (!current) return
        setStatuses(snapshot)
        setStatusError(false)
      },
      () => { if (current) setStatusError(true) },
    )
    return () => { current = false }
  }, [list, statusRequest])

  // Settling refetches: a save/restart leaves a server `connecting`; these
  // land after the bridge connect (or failure) so the dot tells the truth.
  const scheduleRefresh = useCallback(() => {
    for (const delay of [600, 2500]) {
      timers.current.push(setTimeout(refreshStatuses, delay))
    }
  }, [refreshStatuses])

  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
  }, [])

  const statusById = useMemo(() => {
    const byId = new Map<string, McpServerStatus>()
    for (const row of statuses?.servers ?? []) byId.set(row.id, row)
    return byId
  }, [statuses])

  /**
   * Write the whole servers array; the write is the unit of save (the Host
   * validates the section, the scope folds the answer back).
   */
  const writeServers = useCallback(async (next: readonly McpServerEntryView[]): Promise<boolean> => {
    setBusy(true)
    setSaveFailed(false)
    try {
      await scope.set('servers', next.map(entry => ({ ...entry })))
      const landed = scope.getSnapshot().value?.servers ?? []
      return JSON.stringify(landed) === JSON.stringify(next)
    } catch {
      return false
    } finally {
      setBusy(false)
    }
  }, [scope])

  const saveDraft = (): void => {
    if (editing === null) return
    const parsed = entryOf(editing)
    if (!parsed.ok) return
    const next = editing.id === null
      ? [...servers, parsed.entry]
      : servers.map(entry => entry.id === editing.id ? parsed.entry : entry)
    void writeServers(next).then((landed) => {
      if (!landed) {
        setSaveFailed(true)
        return
      }
      setEditing(null)
      setExpandedId(parsed.entry.id)
      scheduleRefresh()
    })
  }

  const toggleEnabled = (entry: McpServerEntryView): void => {
    const next = servers.map(candidate => candidate.id === entry.id
      ? { ...candidate, enabled: !candidate.enabled }
      : candidate)
    void writeServers(next).then((landed) => {
      if (landed) scheduleRefresh()
      else setSaveFailed(true)
    })
  }

  const removeServer = (id: string): void => {
    setConfirmingId(null)
    void writeServers(servers.filter(entry => entry.id !== id)).then((landed) => {
      if (landed) scheduleRefresh()
      else setSaveFailed(true)
    })
  }

  const applyImport = (): void => {
    const parsed = parseImport(importText, new Set(servers.map(entry => entry.name)))
    if (!parsed.ok) {
      setImportFailure(parsed.reason)
      return
    }
    if (parsed.entries.length === 0) {
      setImportFailure(t('toolEmpty'))
      return
    }
    setImportFailure(null)
    setImportOpen(false)
    setImportText('')
    void writeServers([...servers, ...parsed.entries]).then((landed) => {
      if (landed) scheduleRefresh()
      else setSaveFailed(true)
    })
  }

  const restartServer = (id: string): void => {
    void restart(id).then(() => scheduleRefresh())
  }

  const openEdit = (entry: McpServerEntryView): void => {
    setEditing(draftOf(entry))
    setSaveFailed(false)
  }

  if (snapshot.status === 'unavailable') {
    return <div className={css.section}><p className={css.status}>{t('error')}</p></div>
  }

  const enabledCount = servers.filter(entry => entry.enabled).length

  return (
    <div className={css.section} aria-busy={snapshot.status === 'loading' || busy}>
      <div className={css.header}>
        <div className={css.heading}>
          <h3>{t('tab')}</h3>
          <span className={css.count} data-count={enabledCount}>{t('serverCount', { count: enabledCount })}</span>
        </div>
        <div className={css.actions}>
          {writable ? (
            <>
              <button type="button" className={css.ghostButton} onClick={() => { setImportFailure(null); setImportOpen(true) }}>
                {t('importJson')}
              </button>
              <button type="button" className={css.primaryButton} onClick={() => { setEditing(blankDraft('stdio')); setSaveFailed(false) }}>
                <IconPlusOutline16 aria-hidden="true" size={14} />
                {t('add')}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {saveFailed ? <p className={css.failure} role="alert">{t('saveFailed')}</p> : null}
      {statusError ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={refreshStatuses}>{t('retry')}</button>
        </div>
      ) : null}

      {snapshot.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}

      {editing !== null ? (
        <form className={`${css.card} ${css.editorCard}`} onSubmit={(event) => { event.preventDefault(); saveDraft() }}>
          <strong className={css.cardTitle}>{editing.id === null ? t('add') : `${t('edit')} — ${editing.name}`}</strong>
          <div className={css.formGrid}>
            <label className={css.field}>
              <span>{t('name')}</span>
              <input
                type="text"
                value={editing.name}
                onChange={(event) => { setEditing({ ...editing, name: event.currentTarget.value }) }}
                placeholder={t('name')}
                spellCheck={false}
              />
              <small>{t('nameHint')}</small>
            </label>
            <label className={css.field}>
              <span>{t('transport')}</span>
              <select
                value={editing.transport}
                onChange={(event) => { setEditing({ ...editing, transport: event.currentTarget.value === 'http' ? 'streamable-http' : 'stdio' }) }}
              >
                <option value="stdio">{t('transportStdio')}</option>
                <option value="http">{t('transportHttp')}</option>
              </select>
            </label>
            {editing.transport === 'stdio' ? (
              <>
                <label className={css.field}>
                  <span>{t('command')}</span>
                  <input
                    type="text"
                    value={editing.command}
                    onChange={(event) => { setEditing({ ...editing, command: event.currentTarget.value }) }}
                    placeholder="npx"
                    spellCheck={false}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('args')}</span>
                  <textarea
                    value={editing.argsText}
                    onChange={(event) => { setEditing({ ...editing, argsText: event.currentTarget.value }) }}
                    placeholder={t('argsHint')}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('env')}</span>
                  <textarea
                    value={editing.envText}
                    onChange={(event) => { setEditing({ ...editing, envText: event.currentTarget.value }) }}
                    placeholder={t('envHint')}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('timeout')}</span>
                  <input
                    type="number"
                    min={1}
                    value={editing.timeoutText}
                    onChange={(event) => { setEditing({ ...editing, timeoutText: event.currentTarget.value }) }}
                  />
                </label>
              </>
            ) : (
              <>
                <label className={css.field}>
                  <span>{t('url')}</span>
                  <input
                    type="text"
                    value={editing.url}
                    onChange={(event) => { setEditing({ ...editing, url: event.currentTarget.value }) }}
                    placeholder="https://example.com/mcp"
                    spellCheck={false}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('headers')}</span>
                  <textarea
                    value={editing.headersText}
                    onChange={(event) => { setEditing({ ...editing, headersText: event.currentTarget.value }) }}
                    placeholder={t('headersHint')}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('timeout')}</span>
                  <input
                    type="number"
                    min={1}
                    value={editing.timeoutText}
                    onChange={(event) => { setEditing({ ...editing, timeoutText: event.currentTarget.value }) }}
                  />
                </label>
              </>
            )}
          </div>
          <label className={css.switchRow}>
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(event) => { setEditing({ ...editing, enabled: event.currentTarget.checked }) }}
            />
            <span>{t('enabledSwitch')}</span>
          </label>
          <div className={css.cardActions}>
            <button type="submit" className={css.primaryButton} disabled={!entryOf(editing).ok}>{t('save')}</button>
            <button type="button" className={css.ghostButton} onClick={() => { setEditing(null); setSaveFailed(false) }}>{t('cancel')}</button>
          </div>
        </form>
      ) : null}

      {servers.length === 0 && snapshot.status === 'ready' && editing === null ? (
        <p className={css.empty}>{t('empty')}</p>
      ) : null}

      <ul className={css.cards}>
        {servers.map((entry) => {
          const status = statusById.get(entry.id)
          const state: ServerState = entry.enabled ? (status?.state ?? 'connecting') : 'disabled'
          const open = expandedId === entry.id && editing === null
          const detailId = `mcp-details-${entry.id}`
          const stateLabel = t(stateKey(state))
          return (
            <li className={css.card} key={entry.id} data-open={open ? 'true' : undefined}>
              <button
                className={css.cardContent}
                type="button"
                aria-expanded={open}
                aria-controls={detailId}
                onClick={() => { setExpandedId(current => current === entry.id ? null : entry.id) }}
              >
                <strong className={css.cardTitle}>{entry.name}</strong>
                <span className={css.transportTag} data-transport={entry.transport}>
                  {t(entry.transport === 'stdio' ? 'transportStdio' : 'transportHttp')}
                </span>
                <span className={css.cardTrailing}>
                  {entry.enabled ? (
                    <span className={css.statusDot} data-state={state} role="img" aria-label={stateLabel} title={stateLabel} />
                  ) : null}
                  <span className={css.stateLabel} data-state={state}>{stateLabel}</span>
                  <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                </span>
              </button>
              {open ? (
                <div className={css.cardDetails} id={detailId}>
                  <code className={css.entryValue}>{status?.target ?? (entry.transport === 'stdio'
                    ? [entry.command, ...entry.args].join(' ')
                    : entry.url)}</code>
                  {status?.error ? <p className={css.errorText} role="alert">{status.error}</p> : null}
                  <div className={css.toolBlock}>
                    <span className={css.toolHeading}>{t('tools')}</span>
                    {status !== undefined && status.toolNames.length > 0 ? (
                      <ul className={css.toolChips}>
                        {status.toolNames.map(toolName => (
                          <li className={css.toolChip} key={toolName} title={toolName}>
                            {toolName.replace(`mcp__${entry.name}__`, '')}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className={css.toolEmpty}>{status === undefined ? t('loading') : t('toolEmpty')}</span>
                    )}
                  </div>
                  <div className={css.cardActions}>
                    {writable ? (
                      <>
                        <label className={css.switchRow}>
                          <input
                            type="checkbox"
                            checked={entry.enabled}
                            disabled={busy}
                            onChange={() => toggleEnabled(entry)}
                          />
                          <span>{t('enabledSwitch')}</span>
                        </label>
                        <button type="button" className={css.ghostButton} onClick={() => openEdit(entry)}>{t('edit')}</button>
                        {confirmingId === entry.id ? (
                          <span className={css.confirmRow}>
                            <span>{t('removeConfirm', { name: entry.name })}</span>
                            <button type="button" className={css.dangerButton} onClick={() => removeServer(entry.id)}>{t('remove')}</button>
                            <button type="button" className={css.ghostButton} onClick={() => setConfirmingId(null)}>{t('cancel')}</button>
                          </span>
                        ) : (
                          <button type="button" className={css.dangerButton} onClick={() => setConfirmingId(entry.id)}>{t('remove')}</button>
                        )}
                      </>
                    ) : null}
                    {entry.enabled ? (
                      <button type="button" className={css.ghostButton} disabled={busy} onClick={() => restartServer(entry.id)}>
                        {t('restart')}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {importOpen ? (
        <div className={css.importOverlay} role="dialog" aria-modal="true" aria-label={t('importTitle')}>
          <div className={css.importPanel}>
            <strong className={css.cardTitle}>{t('importTitle')}</strong>
            <p className={css.importHint}>{t('importHint')}</p>
            <textarea
              className={css.importArea}
              value={importText}
              onChange={(event) => { setImportText(event.currentTarget.value) }}
              placeholder={t('importPlaceholder')}
              rows={10}
              spellCheck={false}
            />
            {importFailure !== null ? <p className={css.errorText} role="alert">{t('importError', { reason: importFailure })}</p> : null}
            <div className={css.cardActions}>
              <button type="button" className={css.primaryButton} onClick={applyImport}>{t('importApply')}</button>
              <button type="button" className={css.ghostButton} onClick={() => { setImportOpen(false); setImportFailure(null) }}>{t('importCancel')}</button>
            </div>
          </div>
        </div>
      ) : null}

      {servers.length > 0 ? <p className={css.tip}>{t('noIdeas')}</p> : null}
    </div>
  )
}
