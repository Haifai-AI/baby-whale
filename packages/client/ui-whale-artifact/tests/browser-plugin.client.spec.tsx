// @vitest-environment jsdom
/**
 * ui-whale-artifact plugin halves: the browser entry registers a keyed tool
 * view and a details studio for each office tool plus its dictionaries (with
 * fiber teardown proving removal — HMR safety), the node entry is inert, and
 * the invariant companion reserves package ownership.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as WhaleArtifactInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** The three office tools this package renders, in registration order. */
const TOOL_KEYS = ['xlsx_create', 'pptx_create', 'docx_create']

/** Registered dispatch keys of one keyed slot. */
function entryKeys(ctx: Context, slot: 'tool.call.toolview' | 'conversation.details.toolview'): (string | undefined)[] {
  return ctx.slots.entries(slot).map(entry => entry.options.key)
}

/** Boot the browser half over a real slot tree that declares both keyed seats. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      'conversation.details.toolview': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy. There is no browser-language
  // detection to run, so the locale comes from the explicit switch.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-whale-artifact browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers a keyed tool view per office tool, and fiber teardown removes them (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(entryKeys(ctx, 'tool.call.toolview')).toEqual(TOOL_KEYS)
    expect(ctx.slots.entries('tool.call.toolview').map(entry => entry.locale)).toEqual([NS, NS, NS])

    await fiber.dispose()
    expect(ctx.slots.entries('tool.call.toolview')).toEqual([])
  })

  it('registers a details studio per office tool, and fiber teardown removes them (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(entryKeys(ctx, 'conversation.details.toolview')).toEqual(TOOL_KEYS)
    expect(ctx.slots.entries('conversation.details.toolview').map(entry => entry.locale)).toEqual([NS, NS, NS])

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.details.toolview')).toEqual([])
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('artifact.createdBy')).toBe(zh['artifact.createdBy'])
    ctx.locale.setLocale('en')
    expect(translate('artifact.createdBy')).toBe(en['artifact.createdBy'])

    // Withdrawn dictionaries leave the key unresolved: it falls back to itself.
    await fiber.dispose()
    expect(translate('artifact.createdBy')).toBe('artifact.createdBy')
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-whale-artifact node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(() => { applyNode() }).not.toThrow()
  })
})

describe('ui-whale-artifact invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(WhaleArtifactInvariant)
    await fiber.await()
    expect(WhaleArtifactInvariant.name).toBe('client-ui-whale-artifact-invariant')
    expect(WhaleArtifactInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
