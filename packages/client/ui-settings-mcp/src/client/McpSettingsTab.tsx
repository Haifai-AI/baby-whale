import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { McpStatusSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14,
  IconDataOutline16,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  IconSparkle16,
  IconThinkOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpSettingsLocaleKey } from './locales.ts'
import {
  MCP_PRESETS, PRESET_PATH_TOKEN, presetArgs, presetById, presetNeedsPath, uniqueName,
  type McpPreset, type McpPresetGlyph,
} from './presets.ts'
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
  /**
   * Open the Host's own folder chooser, for a preset that reads a directory.
   * Absent when no workspace service is mounted, which hides the button and
   * leaves the path typeable rather than failing the tab.
   */
  chooseFolder?: (() => Promise<string | null>) | undefined
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
  /**
   * The preset this draft came from, when it came from one. Non-null hides the
   * command and argument fields behind Advanced: the preset already decided
   * them, and showing `npx -y @modelcontextprotocol/...` to someone who picked
   * "Filesystem" is the confusion the preset exists to remove.
   */
  readonly presetId: string | null
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
  /**
   * The folder a path-taking preset reads. Held apart from `argsText` so the
   * picker and the text field cannot disagree, and substituted into the args
   * only when the entry is built.
   */
  folder: string
}

import { parseImport, newId } from './json-import.ts'

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

const STATE_KEYS: Record<ServerState, McpSettingsLocaleKey> = {
  connected: 'stateConnected',
  connecting: 'stateConnecting',
  failed: 'stateFailed',
  stuck: 'stateStuck',
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

/**
 * The keyed view of one visited JSON value.
 * @param visited - the value the JSON replacer is visiting.
 * @returns the record for a plain object, undefined for a leaf or an array.
 */
function plainObject(visited: unknown): Record<string, unknown> | undefined {
  if (visited === null || typeof visited !== 'object') return undefined
  if (Array.isArray(visited)) return undefined
  return visited as Record<string, unknown>
}

/**
 * Canonical JSON: object keys sorted at every depth, so two structurally
 * equal sections stringify identically regardless of key order. The
 * landed/save settlement check must compare meaning, not key insertion order
 * (the Host folds a saved section through the schema, which may reorder).
 * @param value - any JSON-shaped value.
 * @returns the order-insensitive JSON form.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, visited: unknown): unknown => {
    const record = plainObject(visited)
    if (record === undefined) return visited
    return Object.keys(record).sort().map(key => [key, record[key]] as const)
      .reduce<Record<string, unknown>>((sorted, [key, item]) => { sorted[key] = item; return sorted }, {})
  })
}

/** Entry → staged form. */
function draftOf(entry: McpServerEntryView): Draft {
  return {
    id: entry.id,
    presetId: matchPreset(entry),
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
    folder: '',
  }
}

/**
 * The preset an existing entry was built from, when its command line still
 * matches one exactly.
 *
 * Editing a preset-backed server keeps the preset's affordances (the folder
 * field rather than a raw argument list) only while nothing has diverged. A
 * hand-edited command drops back to the general form, which is the honest
 * reading: it is no longer that preset.
 * @param entry - the saved entry to classify.
 * @returns the matching preset id, or null for a general server.
 */
function matchPreset(entry: McpServerEntryView): string | null {
  if (entry.transport !== 'stdio') return null
  for (const preset of MCP_PRESETS) {
    if (entry.args.length !== preset.args.length) continue
    // A `{path}` slot matches whatever folder the entry carries; every literal
    // argument must agree, so a hand-edited tail drops the preset reading.
    const matches = preset.args.every((arg, index) => arg === PRESET_PATH_TOKEN
      ? true
      : entry.args[index] === arg)
    if (matches && entry.command === preset.command) return preset.id
  }
  return null
}

/** Blank staged form for a new server. */
function blankDraft(transport: 'stdio' | 'streamable-http'): Draft {
  return {
    id: null, presetId: null, name: '', enabled: true, transport,
    command: '', argsText: '', envText: '', cwd: '',
    url: '', headersText: '', timeoutText: '60', folder: '',
  }
}

/** A draft pre-filled from one catalog entry, named clear of what exists. */
function presetDraft(preset: McpPreset, taken: readonly string[]): Draft {
  return {
    ...blankDraft('stdio'),
    presetId: preset.id,
    name: uniqueName(preset.name, taken),
    command: preset.command,
    argsText: preset.args.join('\n'),
  }
}

/**
 * The first reason this draft cannot be saved, or null when it can.
 *
 * The form reports this beside the offending field and keeps Save enabled, so
 * a disabled button never has to be decoded: the reader is told what to fix
 * rather than left to guess which of nine fields is wrong.
 * @param draft - the staged form.
 * @param taken - names already used by other entries.
 * @returns the locale key naming the problem, or null.
 */
function draftProblem(draft: Draft, taken: readonly string[]): McpSettingsLocaleKey | null {
  if (draft.name.length === 0) return 'nameRequired'
  if (!NAME_PATTERN.test(draft.name)) return 'nameInvalid'
  if (taken.includes(draft.name)) return 'nameTaken'
  if (draft.transport === 'stdio' && draft.command.trim().length === 0) return 'commandRequired'
  const preset = draft.transport === 'stdio' ? presetById(draft.presetId ?? '') : undefined
  if (preset !== undefined && presetNeedsPath(preset) && draft.folder.trim().length === 0) return 'folderRequired'
  if (draft.transport === 'streamable-http' && !/^https?:\/\/\S+$/.test(draft.url.trim())) return 'urlRequired'
  return null
}

/**
 * The folder-taking preset this draft is bound to, when it still is one.
 *
 * A preset describes a stdio command line, so the binding is stdio-only:
 * switching the transport to HTTP abandons it rather than substituting a
 * folder into a server that will never be spawned.
 * @param draft - the staged form.
 * @returns the preset whose folder field the form should show, or undefined.
 */
function draftPreset(draft: Draft): McpPreset | undefined {
  if (draft.presetId === null || draft.transport !== 'stdio') return undefined
  const preset = presetById(draft.presetId)
  return preset !== undefined && presetNeedsPath(preset) ? preset : undefined
}

/** Staged form → the entry to save. Only called once {@link draftProblem} is null. */
function entryOf(draft: Draft): McpServerEntryView {
  const timeoutSeconds = Number.parseInt(draft.timeoutText, 10)
  const preset = draftPreset(draft)
  const args = preset !== undefined
    ? presetArgs(preset, draft.folder.trim())
    : draft.argsText.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  return {
    id: draft.id ?? newId(),
    name: draft.name,
    enabled: draft.enabled,
    transport: draft.transport,
    command: draft.command.trim(),
    args,
    env: linesToRecord(draft.envText),
    cwd: draft.cwd.trim(),
    url: draft.url.trim(),
    headers: linesToRecord(draft.headersText),
    toolCallTimeoutMs: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 60_000,
  }
}

/** The catalog's leading glyph per preset. */
const PRESET_ICONS: Record<McpPresetGlyph, ReactNode> = {
  folder: <IconFolderOpenOutline16 size={14} />,
  memory: <IconDataOutline16 size={14} />,
  steps: <IconThinkOutline16 size={14} />,
  sparkle: <IconSparkle16 size={14} />,
}

/** Render the MCP servers management tab. */
export function McpSettingsTab({ list, restart, scope, chooseFolder, t }: McpSettingsTabProps): ReactNode {
  // The scope controller's methods are class members: bind through stable
  // closures so useSyncExternalStore sees fixed identities and `this` lands.
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const [statuses, setStatuses] = useState<McpStatusSnapshot | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [statusRequest, setStatusRequest] = useState(0)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importFailure, setImportFailure] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // The scope's decoder validates the section against the namespace's wire
  // schema, so `servers` is present whenever a value is. An `Array.isArray`
  // guard here would widen the readonly entry list to `any[]`.
  const servers = useMemo(() => snapshot.value?.servers ?? [], [snapshot.value])
  const writable = snapshot.writable && snapshot.mode === 'host'

  /**
   * Change handler for one draft text field: every call site otherwise repeated
   * the null-draft guard inline and overran the line budget.
   * @param patch - folds the field's new value into the draft.
   * @returns the change handler for that field.
   */
  const draftField = (patch: (draft: Draft, value: string) => Draft) =>
    (event: { currentTarget: { value: string } }): void => {
      const value = event.currentTarget.value
      setEditing(current => current === null ? current : patch(current, value))
    }

  /** The enable switch folds a boolean rather than an input value. */
  const draftToggle = (event: { currentTarget: { checked: boolean } }): void => {
    const enabled = event.currentTarget.checked
    setEditing(current => current === null ? current : { ...current, enabled })
  }

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
      return canonicalJson(landed) === canonicalJson(next)
    } catch {
      return false
    } finally {
      setBusy(false)
    }
  }, [scope])

  const saveDraft = (): void => {
    /* v8 ignore next -- the form that submits renders only while a draft is open, so this arm narrows `editing` and never branches */
    if (editing === null) return
    setAttempted(true)
    if (problem !== null) return
    const next = editing.id === null
      ? [...servers, entryOf(editing)]
      : servers.map(entry => entry.id === editing.id ? entryOf(editing) : entry)
    void writeServers(next).then((landed) => {
      if (!landed) {
        setSaveFailed(true)
        return
      }
      setEditing(null)
      setAttempted(false)
      setExpandedId(editing.id)
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
    void restart(id).then(() => { scheduleRefresh() })
  }

  const openEdit = (entry: McpServerEntryView): void => {
    setEditing(draftOf(entry))
    setChoosing(false)
    setShowAdvanced(matchPreset(entry) === null)
    setSaveFailed(false)
  }

  /** Open the catalog: the default way in, since a blank form is the hard way. */
  const openChooser = (): void => {
    setChoosing(true)
    setEditing(null)
    setSaveFailed(false)
  }

  const startPreset = (preset: McpPreset): void => {
    setEditing(presetDraft(preset, servers.map(entry => entry.name)))
    setChoosing(false)
    setShowAdvanced(false)
    setSaveFailed(false)
  }

  const startBlank = (): void => {
    setEditing(blankDraft('stdio'))
    setChoosing(false)
    setShowAdvanced(true)
    setSaveFailed(false)
  }

  const pickFolder = (): void => {
    /* v8 ignore next -- the button that calls this renders only with a chooser and an open draft, so this arm never branches */
    if (chooseFolder === undefined || editing === null) return
    void chooseFolder().then((path) => {
      if (path === null) return
      setEditing(current => current === null ? current : { ...current, folder: path })
    })
  }

  if (snapshot.status === 'unavailable') {
    return <div className={css.section}><p className={css.status}>{t('error')}</p></div>
  }

  const enabledCount = servers.filter(entry => entry.enabled).length
  // Names this draft must avoid: every other entry, so editing a server does
  // not collide with itself.
  const takenNames = servers.filter(entry => entry.id !== editing?.id).map(entry => entry.name)
  const problem = editing === null ? null : draftProblem(editing, takenNames)
  const presetForDraft = editing === null ? undefined : draftPreset(editing)

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
              <button type="button" className={css.primaryButton} onClick={openChooser}>
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

      {choosing ? (
        // The catalog as a source list rather than a card grid: every row is
        // one server, the same shape as the list it joins, so choosing reads
        // as picking from a menu instead of browsing a gallery.
        <section className={css.catalog} aria-label={t('quickStart')}>
          <div className={css.catalogHead}>
            <strong className={css.catalogTitle}>{t('quickStart')}</strong>
            <p className={css.catalogHint}>{t('quickStartHint')}</p>
          </div>
          <ul className={css.presetList}>
            {MCP_PRESETS.map(preset => (
              <li key={preset.id}>
                <button type="button" className={css.presetRow} onClick={() => { startPreset(preset) }}>
                  <span className={css.presetIcon} aria-hidden="true">{PRESET_ICONS[preset.glyph]}</span>
                  <span className={css.presetText}>
                    <span className={css.presetName}>{t(preset.name === 'filesystem' ? 'presetFilesystem'
                      : preset.name === 'memory' ? 'presetMemory'
                        : preset.name === 'sequential-thinking' ? 'presetThinking' : 'presetEverything')}</span>
                    <span className={css.presetBlurb}>{t(preset.blurb)}</span>
                  </span>
                  <span className={css.presetAdd}>{t('addPreset')}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={css.manualRow} onClick={startBlank}>
            <span className={css.presetText}>
              <span className={css.presetName}>{t('manual')}</span>
              <span className={css.presetBlurb}>{t('manualHint')}</span>
            </span>
          </button>
          <div className={css.cardActions}>
            <button type="button" className={css.ghostButton} onClick={() => { setChoosing(false) }}>{t('cancel')}</button>
          </div>
        </section>
      ) : null}

      {editing !== null ? (
        <form className={`${css.card} ${css.editorCard}`} onSubmit={(event) => { event.preventDefault(); saveDraft() }}>
          <div className={css.editorHead}>
            <strong className={css.cardTitle}>{editing.id === null ? t('add') : `${t('edit')} — ${editing.name}`}</strong>
            {editing.presetId !== null ? <span className={css.presetTag}>{t('presetTag')}</span> : null}
          </div>
          <div className={css.formGrid}>
            <label className={css.field}>
              <span>{t('name')}</span>
              <input
                type="text"
                value={editing.name}
                onChange={draftField((draft, name) => ({ ...draft, name }))}
                placeholder={t('name')}
                spellCheck={false}
              />
              {/* The naming rule stated as its consequence rather than as a
                  regex: the reader sees the name the model will actually call. */}
              <small className={css.namespacePreview}>
                {editing.name.length > 0 && NAME_PATTERN.test(editing.name)
                  ? t('namespacePreview', { prefix: `mcp__${editing.name}__` })
                  : t('nameHint')}
              </small>
            </label>
            <label className={css.field}>
              <span>{t('transport')}</span>
              <select
                value={editing.transport}
                onChange={(event) => {
                  const transport = event.currentTarget.value as Draft['transport']
                  setEditing((current) => {
                    if (current === null) return current
                    // Leaving stdio abandons a preset: its command line is a
                    // local process, so the name, tag, and Advanced state must
                    // stop claiming otherwise.
                    return transport === 'stdio'
                      ? { ...current, transport }
                      : { ...current, transport, presetId: null, command: '', argsText: '', folder: '' }
                  })
                  setShowAdvanced(transport !== 'stdio')
                }}
              >
                <option value="stdio">{t('transportStdio')}</option>
                <option value="streamable-http">{t('transportHttp')}</option>
              </select>
            </label>

            {editing.transport === 'stdio' && presetForDraft !== undefined ? (
              // The one value a preset cannot know. A native chooser beats a
              // typed path: it cannot be mistyped, and it shows what was picked.
              <div className={`${css.field} ${css.fieldWide}`}>
                <span>{t('folder')}</span>
                <div className={css.folderRow}>
                  <input
                    type="text"
                    aria-label={t('folder')}
                    value={editing.folder}
                    onChange={draftField((draft, folder) => ({ ...draft, folder }))}
                    placeholder="/Users/you/Documents"
                    spellCheck={false}
                  />
                  {chooseFolder !== undefined ? (
                    <button type="button" className={css.ghostButton} onClick={pickFolder}>{t('chooseFolder')}</button>
                  ) : null}
                </div>
                <small>{t('folderHint')}</small>
              </div>
            ) : null}

            {editing.transport === 'stdio' && presetForDraft === undefined ? (
              <label className={css.field}>
                <span>{t('command')}</span>
                <input
                  type="text"
                  value={editing.command}
                  onChange={draftField((draft, command) => ({ ...draft, command }))}
                  placeholder="npx"
                  spellCheck={false}
                />
              </label>
            ) : null}

            {editing.transport === 'streamable-http' ? (
              <>
                <label className={css.field}>
                  <span>{t('url')}</span>
                  <input
                    type="text"
                    value={editing.url}
                    onChange={draftField((draft, url) => ({ ...draft, url }))}
                    placeholder="https://example.com/mcp"
                    spellCheck={false}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('headers')}</span>
                  <textarea
                    value={editing.headersText}
                    onChange={draftField((draft, headersText) => ({ ...draft, headersText }))}
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
                    onChange={draftField((draft, timeoutText) => ({ ...draft, timeoutText }))}
                  />
                </label>
              </>
            ) : null}
          </div>

          {editing.transport === 'stdio' ? (
            <div className={css.advanced}>
              <button
                type="button"
                className={css.advancedToggle}
                aria-expanded={showAdvanced}
                onClick={() => { setShowAdvanced(value => !value) }}
              >
                <IconChevronDownOutline14 size={12} className={css.chevron} aria-hidden="true" />
                <span>{t('advanced')}</span>
                <small>{t('advancedHint')}</small>
              </button>
              {showAdvanced ? (
                <div className={css.formGrid}>
                  {presetForDraft !== undefined ? (
                    <p className={`${css.presetNote} ${css.fieldWide}`}>
                      {t('presetCommandNote', { command: editing.command })}
                    </p>
                  ) : null}
                  <label className={css.field}>
                    <span>{t('args')}</span>
                    <textarea
                      value={editing.argsText}
                      onChange={draftField((draft, argsText) => ({ ...draft, argsText }))}
                      placeholder={t('argsHint')}
                      rows={3}
                      spellCheck={false}
                    />
                  </label>
                  <label className={css.field}>
                    <span>{t('env')}</span>
                    <textarea
                      value={editing.envText}
                      onChange={draftField((draft, envText) => ({ ...draft, envText }))}
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
                      onChange={draftField((draft, timeoutText) => ({ ...draft, timeoutText }))}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          <label className={css.switchRow}>
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={draftToggle}
            />
            <span>{t('enabledSwitch')}</span>
          </label>
          {/* The reason Save will not land, named beside the button rather than
              hidden behind a disabled control the reader has to decode. */}
          {attempted && problem !== null ? <p className={css.fieldProblem} role="alert">{t(problem)}</p> : null}
          <div className={css.cardActions}>
            <button type="submit" className={css.primaryButton} disabled={busy}>{t('save')}</button>
            <button type="button" className={css.ghostButton} onClick={() => { setEditing(null); setChoosing(false); setSaveFailed(false); setAttempted(false) }}>{t('cancel')}</button>
          </div>
        </form>
      ) : null}

      {servers.length === 0 && snapshot.status === 'ready' && editing === null && !choosing ? (
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
                    {status !== undefined && status.localToolNames.length > 0 ? (
                      <ul className={css.toolChips}>
                        {status.localToolNames.map(localName => (
                          // The payload's local names are already display-safe
                          // and owner-exact (the Host attributes each tool by
                          // its mount's recorded identity): render verbatim
                          // instead of stripping a prefix off the public name.
                          <li className={css.toolChip} key={localName} title={localName}>
                            {localName}
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
                            onChange={() => { toggleEnabled(entry) }}
                          />
                          <span>{t('enabledSwitch')}</span>
                        </label>
                        <button type="button" className={css.ghostButton} onClick={() => { openEdit(entry) }}>{t('edit')}</button>
                        {confirmingId === entry.id ? (
                          <span className={css.confirmRow}>
                            <span>{t('removeConfirm', { name: entry.name })}</span>
                            <button type="button" className={css.dangerButton} onClick={() => { removeServer(entry.id) }}>{t('remove')}</button>
                            <button type="button" className={css.ghostButton} onClick={() => { setConfirmingId(null) }}>{t('cancel')}</button>
                          </span>
                        ) : (
                          <button type="button" className={css.dangerButton} onClick={() => { setConfirmingId(entry.id) }}>{t('remove')}</button>
                        )}
                      </>
                    ) : null}
                    {entry.enabled ? (
                      <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { restartServer(entry.id) }}>
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
