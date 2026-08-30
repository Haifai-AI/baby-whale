/**
 * Skills settings surface, browser half — one section whose rows come from the
 * gateway `skill.list` projection and whose toggles write the `skills`
 * namespace through the shared client settings scope. The resolved
 * `skills.disabled` value is the single source of truth: the model catalog
 * (tool-skill), `/name` invocation injection, and this list all read it.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: settings shell's SlotMap merge + ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { SkillsSettingsSection } from './SkillsSettingsSection.tsx'
import type { SkillRow, SkillsSettingsView } from './SkillsSettingsSection.tsx'
import { en, zh } from './locales.ts'

export type {
  SkillsSettingsSectionInjected, SkillsSettingsSectionProps, SkillsSettingsView, SkillRow,
} from './SkillsSettingsSection.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.skills'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/** Catalog refresh cadence while mounted (ms): new preset skills join live. */
const REFRESH_MS = 30_000

/** Resolved shape of the gateway-owned `skills` settings namespace. */
interface SkillsScopeValue {
  readonly disabled?: readonly string[]
}

/**
 * Mount the Skills settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skills: dictionaries')

  const scope = ctx.settingsScope.bind<SkillsScopeValue>({ namespace: 'skills' })

  // Controller state lives in this closure (one mount per browser session).
  let status: SkillsSettingsView['status'] = 'loading'
  let rows: readonly SkillRow[] = []
  let refreshTimer: ReturnType<typeof setInterval> | undefined

  const readDisabled = (): ReadonlySet<string> => {
    const list = scope.getSnapshot().value?.disabled
    return new Set(Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : [])
  }

  // Snapshot replacement is the notification: useSyncExternalStore-style
  // consumers rerender on reference change, so every mutation builds the next
  // snapshot explicitly and `publish()` only fans out.
  let snapshot: SkillsSettingsView & { saving: boolean } = { status: 'loading', rows, saving: false }
  const listeners = new Set<() => void>()
  const publish = (next: SkillsSettingsView & { saving: boolean }): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const viewHooks = {
    view: {
      getSnapshot: () => snapshot,
      subscribe(listener: () => void): () => void {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }

  const toggleFn = (name: string, nextEnabled: boolean): void => { void toggle(name, nextEnabled) }

  const loadCatalog = async (): Promise<void> => {
    const { api } = ctx.get('connection') as ConnectionHandle
    try {
      const sessions = await api.sessions.list({})
      const sessionId = pickSessionId(sessions.result.ok ? sessions.result.value.items : [])
      if (sessionId === undefined) {
        status = 'unavailable'
        publish({ status, rows, saving: false })
        return
      }
      const listing = await api.skills.list({ sessionId })
      if (!listing.result.ok) throw new Error('skill.list failed')
      status = 'ready'
      const disabled = readDisabled()
      rows = listing.result.value.skills.map(entry => ({
        name: entry.name,
        description: entry.description,
        ...(entry.source !== undefined ? { source: entry.source } : {}),
        modelInvocable: entry.modelInvocable,
        userDisabled: disabled.has(entry.name),
      }))
      publish({ status, rows, saving: false })
    } catch {
      status = 'unavailable'
      publish({ status, rows, saving: false })
    }
  }

  const toggle = async (name: string, nextEnabled: boolean): Promise<void> => {
    const next = new Set(readDisabled())
    if (nextEnabled) next.delete(name)
    else next.add(name)
    rows = rows.map(row => row.name === name ? { ...row, userDisabled: !nextEnabled } : row)
    publish({ status, rows, saving: true })
    await scope.set('disabled', [...next])
    publish({ status: status === 'loading' ? status : 'ready', rows, saving: false })
  }

  ctx.effect(() => {
    const unsubscribeScope = scope.subscribe(() => {
      if (status !== 'ready') return
      const disabled = readDisabled()
      rows = rows.map(row => ({ ...row, userDisabled: disabled.has(row.name) }))
      publish({ status, rows, saving: false })
    })
    void loadCatalog()
    refreshTimer = setInterval(() => { void loadCatalog() }, REFRESH_MS)
    return () => {
      clearInterval(refreshTimer)
      unsubscribeScope()
    }
  }, 'ui-settings-skills: catalog lifecycle')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 16,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({
      hooks: {
        ...viewHooks,
        toggle: {
          // useSyncExternalStore caches by reference: a fresh closure per
          // getSnapshot call reads as "store changed" on every render and
          // loops React into a maximum-depth crash — keep one stable fn.
          getSnapshot: () => toggleFn,
          subscribe: () => () => {},
        },
      },
    }),
  }, SkillsSettingsSection))
}

function pickSessionId<T extends { readonly sessionId: unknown; readonly running?: boolean }>(
  items: readonly T[],
): T['sessionId'] | undefined {
  const running = items.find(item => item.running === true)
  return running?.sessionId ?? items[0]?.sessionId
}
