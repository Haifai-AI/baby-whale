// @vitest-environment jsdom
/**
 * ui-whale-artifacts plugin halves: the browser entry registers its
 * dictionaries and one `conversation.view` tab whose label and injected
 * connection/session face come from the apply closure, with fiber teardown
 * proving removal (HMR safety); the node entry is inert and the invariant
 * companion reserves package ownership.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as WhaleArtifactsInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** The connection handle the apply closure reads once and hands to the view. */
const connection = { api: { artifacts: {}, host: {} }, isLoopback: false }

/** The tab the browser half contributes, with its derived faces surfaced. */
interface TabEntry {
  id?: string | undefined
  order?: number | undefined
  locale: string | undefined
  label: (() => string) | undefined
  inject: ((sessionId: SessionId) => unknown) | undefined
}

function tab(ctx: Context): TabEntry | undefined {
  const entry = ctx.slots.entries('conversation.view')[0]
  if (entry === undefined) return undefined
  return {
    ...entry.options,
    locale: entry.locale,
    label: entry.options.label as (() => string) | undefined,
    inject: entry.inject as ((sessionId: SessionId) => unknown) | undefined,
  }
}

/** Boot the browser half over a real slot tree that declares the view ring. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  ctx.provide('connection', connection as never)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-whale-artifacts browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'connection', 'locale'])
  })

  it('contributes one Artifacts tab and drops it with the fiber (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(tab(ctx)).toMatchObject({ id: 'whale-artifacts', order: 11, locale: NS })
    await fiber.dispose()
    expect(tab(ctx)).toBeUndefined()
  })

  it('labels the tab in the active locale and hands the view its connection and session', async () => {
    const { ctx } = await bench()
    const entry = tab(ctx)
    expect(entry?.label?.()).toBe(zh['view.artifacts'])

    const face = entry?.inject?.('session-1' as SessionId) as { connection: unknown; sessionId: SessionId }
    expect(face.connection).toBe(connection)
    expect(face.sessionId).toBe('session-1')

    // The label is derived per call, so a locale switch reaches the live tab.
    ctx.locale.setLocale('en')
    expect(entry?.label?.()).toBe(en['view.artifacts'])
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('preview')).toBe(zh['preview'])
    ctx.locale.setLocale('en')
    expect(translate('preview')).toBe(en['preview'])

    // Withdrawn dictionaries leave the key unresolved: it falls back to itself.
    await fiber.dispose()
    expect(translate('preview')).toBe('preview')
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-whale-artifacts node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(() => { applyNode() }).not.toThrow()
  })
})

describe('ui-whale-artifacts invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(WhaleArtifactsInvariant)
    await fiber.await()
    expect(WhaleArtifactsInvariant.name).toBe('client-ui-whale-artifacts-invariant')
    expect(WhaleArtifactsInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
