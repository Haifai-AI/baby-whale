/**
 * What the Skills settings plugin does: the catalog read that feeds the
 * section, the disabled-list write behind each toggle, the refresh cadence,
 * and the teardown that leaves no listener or timer behind.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import type { SkillsSettingsSectionInjected, SkillsSettingsView } from '../src/client/index.ts'

/** One catalog entry as the gateway projects it. */
interface SkillListing {
  readonly name: string
  readonly description: string
  readonly source?: string
  readonly modelInvocable: boolean
}

/** Resolved shape of the `skills` namespace this plugin reads. */
interface SkillsScopeValue {
  readonly disabled?: readonly string[]
}

type SessionsReply =
  | { result: { ok: true; value: { items: readonly { sessionId: string; running?: boolean }[] } } }
  | { result: { ok: false; error: { code: string; message: string } } }

type SkillsReply =
  | { result: { ok: true; value: { skills: readonly SkillListing[] } } }
  | { result: { ok: false; error: { code: string; message: string } } }

/** In-memory settings scope: writes are recorded, publication is test-driven. */
function fakeScope() {
  let snapshot: SettingsScopeSnapshot<SkillsScopeValue> = {
    status: 'ready', value: {}, base: undefined, user: undefined,
    revision: 1, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(() => Promise.resolve())
  const scope: SettingsScope<SkillsScopeValue> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset: () => Promise.resolve(),
  }
  return {
    scope,
    set,
    bind: vi.fn(() => scope),
    listenerCount: () => listeners.size,
    /** Replace the stored value and notify, as an accepted Host write does. */
    publish(value: SkillsScopeValue | undefined): void {
      snapshot = { ...snapshot, value }
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Resolve a reply the first time it is awaited, so a test can hold it open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const READY_SESSIONS: SessionsReply = {
  result: { ok: true, value: { items: [{ sessionId: 's-running', running: true }, { sessionId: 's-idle' }] } },
}

/**
 * Mount the plugin over stub services, with the section seat already declared.
 * @param options - the session/skill/settings replies this bench answers with.
 */
async function bench(options: {
  sessions?: SessionsReply | Promise<SessionsReply>
  skills?: SkillsReply | Promise<SkillsReply>
  scope?: ReturnType<typeof fakeScope>
  locale?: 'zh' | 'en'
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale(options.locale ?? 'zh')
  ctx.provide('locale', locale)

  const sessionsList = vi.fn(() => Promise.resolve(options.sessions ?? READY_SESSIONS))
  const skillsList = vi.fn(() => Promise.resolve(options.skills ?? { result: { ok: true, value: { skills: [] } } }))
  ctx.provide('connection', { api: { sessions: { list: sessionsList }, skills: { list: skillsList } } } as never)

  const settings = options.scope ?? fakeScope()
  ctx.provide('settingsScope', { bind: settings.bind } as never)

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const registration = slots.entries('settings.section')[0]!
  const face = (registration.inject as unknown as () => SkillsSettingsSectionInjected)()
  return { ctx, fiber, slots, registration, face, settings, sessionsList, skillsList, locale }
}

/** Wait for the catalog read to leave the loading status. */
async function catalogSettled(face: SkillsSettingsSectionInjected): Promise<SkillsSettingsView & { saving: boolean }> {
  await vi.waitFor(() => { expect(face.hooks.view.getSnapshot().status).not.toBe('loading') })
  return face.hooks.view.getSnapshot()
}

afterEach(() => { vi.useRealTimers() })

describe('ui-settings-skills apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'settingsScope'])
  })

  it('registers one Skills section whose label follows the locale', async () => {
    const { registration, locale } = await bench()

    expect(registration.options).toMatchObject({ id: 'skills', order: 16 })
    expect(resolveSlotLabel(registration.options.label)).toBe('技能')

    locale.setLocale('en')
    expect(resolveSlotLabel(registration.options.label)).toBe('Skills')
  })

  it('binds the scope to the skills namespace and loads the catalog into it', async () => {
    const { face, settings, sessionsList, skillsList } = await bench({
      skills: {
        result: {
          ok: true,
          value: {
            skills: [
              { name: 'alpha', description: 'A', source: 'bundled', modelInvocable: true },
              { name: 'beta', description: 'B', modelInvocable: false },
            ],
          },
        },
      },
    })

    const view = await catalogSettled(face)
    expect(settings.bind).toHaveBeenCalledWith({ namespace: 'skills' })
    expect(view.status).toBe('ready')
    expect(view.saving).toBe(false)
    // The running session hosts the catalog; a skill without a discovery source
    // carries no key at all rather than one with no value.
    expect(sessionsList).toHaveBeenCalledWith({})
    expect(skillsList).toHaveBeenCalledWith({ sessionId: 's-running' })
    expect(view.rows).toEqual([
      { name: 'alpha', description: 'A', source: 'bundled', modelInvocable: true, userDisabled: false },
      { name: 'beta', description: 'B', modelInvocable: false, userDisabled: false },
    ])
    expect('source' in view.rows[1]!).toBe(false)
  })

  it('marks the skills stored as disabled', async () => {
    const scope = fakeScope()
    scope.publish({ disabled: ['beta'] })
    const { face } = await bench({
      skills: {
        result: {
          ok: true,
          value: {
            skills: [
              { name: 'alpha', description: 'A', modelInvocable: true },
              { name: 'beta', description: 'B', modelInvocable: true },
            ],
          },
        },
      },
      scope,
    })

    const view = await catalogSettled(face)
    expect(view.rows.map(row => [row.name, row.userDisabled])).toEqual([['alpha', false], ['beta', true]])
  })

  it('falls back to the first session when none is running', async () => {
    const { face, skillsList } = await bench({
      sessions: { result: { ok: true, value: { items: [{ sessionId: 's-idle' }] } } },
    })

    await catalogSettled(face)
    expect(skillsList).toHaveBeenCalledWith({ sessionId: 's-idle' })
  })

  it('reports the section unavailable when no session can host a catalog', async () => {
    const { face, skillsList } = await bench({ sessions: { result: { ok: true, value: { items: [] } } } })

    expect((await catalogSettled(face)).status).toBe('unavailable')
    expect(skillsList).not.toHaveBeenCalled()
  })

  it('reads the empty item list from a session read the Host refused', async () => {
    const { face, skillsList } = await bench({
      sessions: { result: { ok: false, error: { code: 'unavailable', message: 'bridge offline' } } },
    })

    expect((await catalogSettled(face)).status).toBe('unavailable')
    expect(skillsList).not.toHaveBeenCalled()
  })

  it('reports the section unavailable when the catalog read fails', async () => {
    const { face } = await bench({
      skills: { result: { ok: false, error: { code: 'not-found', message: 'no such session' } } },
    })

    expect((await catalogSettled(face)).status).toBe('unavailable')
  })

  it('reports the section unavailable when the transport rejects', async () => {
    const pending = deferred<SessionsReply>()
    const { face } = await bench({ sessions: pending.promise })

    pending.reject(new Error('offline'))

    expect((await catalogSettled(face)).status).toBe('unavailable')
  })

  it('tolerates a stored disabled list that is not a list of names', async () => {
    const scope = fakeScope()
    scope.publish({ disabled: 'yes' as unknown as readonly string[] })
    const { face } = await bench({
      skills: { result: { ok: true, value: { skills: [{ name: 'alpha', description: 'A', modelInvocable: true }] } } },
      scope,
    })

    expect((await catalogSettled(face)).rows[0]?.userDisabled).toBe(false)

    // A mixed list keeps the names and drops everything else.
    scope.publish({ disabled: ['alpha', 7 as unknown as string] })
    await vi.waitFor(() => { expect(face.hooks.view.getSnapshot().rows[0]?.userDisabled).toBe(true) })
  })
})

describe('ui-settings-skills catalog refresh', () => {
  it('re-reads the disabled list when the Host publishes one', async () => {
    const scope = fakeScope()
    const { face } = await bench({
      skills: {
        result: {
          ok: true,
          value: {
            skills: [
              { name: 'alpha', description: 'A', modelInvocable: true },
              { name: 'beta', description: 'B', modelInvocable: true },
            ],
          },
        },
      },
      scope,
    })
    await catalogSettled(face)

    scope.publish({ disabled: ['beta'] })

    await vi.waitFor(() => {
      expect(face.hooks.view.getSnapshot().rows.map(row => row.userDisabled)).toEqual([false, true])
    })

    // A write from this section answers through the same channel.
    scope.publish({ disabled: [] })
    await vi.waitFor(() => {
      expect(face.hooks.view.getSnapshot().rows.map(row => row.userDisabled)).toEqual([false, false])
    })
  })

  it('ignores a scope publication that arrives before the first catalog', async () => {
    const scope = fakeScope()
    const pending = deferred<SessionsReply>()
    const { face } = await bench({ sessions: pending.promise, scope })

    scope.publish({ disabled: ['alpha'] })

    expect(face.hooks.view.getSnapshot()).toMatchObject({ status: 'loading', rows: [] })
    pending.resolve(READY_SESSIONS)
    await catalogSettled(face)
  })

  it('re-reads the catalog on its own cadence and stops with the fiber', async () => {
    vi.useFakeTimers()
    const { face, fiber, settings, sessionsList } = await bench()

    await vi.advanceTimersByTimeAsync(0)
    expect(face.hooks.view.getSnapshot().status).toBe('ready')
    expect(sessionsList).toHaveBeenCalledTimes(1)
    expect(settings.listenerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(sessionsList).toHaveBeenCalledTimes(2)

    await fiber.dispose()
    expect(settings.listenerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(sessionsList).toHaveBeenCalledTimes(2)
  })
})

describe('ui-settings-skills toggles', () => {
  it('writes the disabled list and shows the switch position while the write is in flight', async () => {
    const scope = fakeScope()
    const { face } = await bench({
      skills: {
        result: {
          ok: true,
          value: {
            skills: [
              { name: 'alpha', description: 'A', modelInvocable: true },
              { name: 'beta', description: 'B', modelInvocable: true },
            ],
          },
        },
      },
      scope,
    })
    await catalogSettled(face)

    const published: (SkillsSettingsView & { saving: boolean })[] = []
    const unsubscribe = face.hooks.view.subscribe(() => {
      published.push(face.hooks.view.getSnapshot())
    })

    face.hooks.toggle.getSnapshot()('alpha', false)
    await vi.waitFor(() => { expect(scope.set).toHaveBeenCalledWith('disabled', ['alpha']) })
    // The optimistic redraw lands before the write settles.
    expect(published[0]).toMatchObject({ saving: true })
    expect(published[0]?.rows[0]?.userDisabled).toBe(true)

    face.hooks.toggle.getSnapshot()('alpha', true)
    await vi.waitFor(() => { expect(scope.set).toHaveBeenLastCalledWith('disabled', []) })
    expect(face.hooks.view.getSnapshot().rows[0]?.userDisabled).toBe(false)
    expect(face.hooks.view.getSnapshot().saving).toBe(false)

    unsubscribe()
  })

  it('keeps the loading status when a toggle lands before the first catalog', async () => {
    const pending = deferred<SessionsReply>()
    const scope = fakeScope()
    const { face } = await bench({ sessions: pending.promise, scope })

    face.hooks.toggle.getSnapshot()('alpha', false)
    await vi.waitFor(() => { expect(scope.set).toHaveBeenCalledWith('disabled', ['alpha']) })

    expect(face.hooks.view.getSnapshot().status).toBe('loading')
    pending.resolve(READY_SESSIONS)
    await catalogSettled(face)
  })

  it('publishes one stable toggle function and a subscribable view', async () => {
    const { face } = await bench()
    await catalogSettled(face)

    // useSyncExternalStore caches by reference, so a fresh closure per read
    // would loop React; the view snapshot is stable until a change lands.
    expect(face.hooks.toggle.getSnapshot()).toBe(face.hooks.toggle.getSnapshot())
    expect(face.hooks.view.getSnapshot()).toBe(face.hooks.view.getSnapshot())

    const toggleListener = vi.fn()
    const disposeToggle = face.hooks.toggle.subscribe(toggleListener)
    disposeToggle()
    expect(toggleListener).not.toHaveBeenCalled()

    const viewListener = vi.fn()
    const unsubscribe = face.hooks.view.subscribe(viewListener)
    face.hooks.toggle.getSnapshot()('alpha', false)
    await vi.waitFor(() => { expect(viewListener).toHaveBeenCalled() })
    unsubscribe()
  })
})
