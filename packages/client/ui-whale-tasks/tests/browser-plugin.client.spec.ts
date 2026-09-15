// @vitest-environment jsdom
/**
 * ui-whale-tasks plugin halves: the browser entry's dictionary, event
 * definition, and keyed chat-node registrations against the real registries
 * (with fiber teardown proving removal — HMR safety), the inert node entry,
 * and the invariant companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { ConversationEventRegistry, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { TaskBoardNode } from '../src/client/TaskBoardNode.tsx'
import { whaleTaskBoardDefinition } from '../src/client/task-board.ts'
import { apply as applyNode } from '../src/index.ts'
import * as WhaleTasksInvariant from '../src/invariant.ts'

/** Boot the browser half over a real slot tree that declares the chat-node ring. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin(ConversationEventRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } },
  } as never, () => null)
  // The locale plugin binds a settings scope, which reads the connection
  // handle and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy; browser-language detection
  // never runs ahead of an explicit setLocale.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-whale-tasks browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'conversationEvents'])
  })

  it('registers the task-board definition and its keyed renderer, and removes both (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['whale-task-board'])
    expect(ctx.conversationEvents.entries()[0]).toBe(whaleTaskBoardDefinition)
    const entry = ctx.slots.entries('conversation.chat.node')[0]!
    expect(entry.options.key).toBe('whale-task-board')
    expect(entry.locale).toBe(NS)
    expect(entry.component).toBe(TaskBoardNode)

    await fiber.dispose()
    expect(ctx.conversationEvents.entries()).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])

    const replacement = ctx.plugin({ inject: [...inject], apply })
    await replacement.await()
    expect(ctx.conversationEvents.entries().map(e => e.kind)).toEqual(['whale-task-board'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    await replacement.dispose()
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('board.title')).toBe(zh['board.title'])
    expect(translate('board.empty')).toBe(zh['board.empty'])
    ctx.locale.setLocale('en')
    expect(translate('board.title')).toBe(en['board.title'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('board.title')).not.toBe(en['board.title'])
    expect(translate('board.title')).not.toBe(zh['board.title'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-whale-tasks node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(() => { applyNode() }).not.toThrow()
  })
})

describe('ui-whale-tasks invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(WhaleTasksInvariant)
    await fiber.await()
    expect(WhaleTasksInvariant.name).toBe('client-ui-whale-tasks-invariant')
    expect(WhaleTasksInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
