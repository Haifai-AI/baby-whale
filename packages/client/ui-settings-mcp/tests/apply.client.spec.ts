/**
 * What the MCP tab registers, and that it leaves with the fiber.
 *
 * The tab's own rendering is covered by `tab.client.spec.tsx`; this file is
 * about the registration: the dictionary, the one `settings.plugins.tab`
 * contribution, its label, and the folder chooser's optional wiring.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply as pluginsApply, inject as pluginsInject } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-mcp/client'
import type { McpSettingsTabInjected } from '@deepseek-ai/dsh-client-ui-settings-mcp/client'

// The spec asserts the shipped Chinese label; the lane has no browser-language
// detection, so the locale is staged explicitly.
/**
 * @param withWorkspaces - provide the workspace service, and with it the
 * native folder chooser the Filesystem preset offers.
 */
async function bench(withWorkspaces = false) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx)
  const mcpStatus = {
    list: vi.fn(async () => ({ ok: true as const, value: { servers: [] } })),
    restart: vi.fn(async () => ({ ok: true as const, value: { servers: [] } })),
  }
  // Both halves of the Remote seam: the `remote.mcpStatus` service satisfies
  // the fiber's inject, and the generated `ctx.remote.<ns>` accessor is what
  // the injected closures actually call through. TestRemote registers itself
  // as `ctx.remote`, so the accessor hangs off that instance.
  ;(remote as unknown as { mcpStatus: typeof mcpStatus }).mcpStatus = mcpStatus
  ctx.provide('remote.mcpStatus', mcpStatus)
  const pickDirectory = vi.fn(async () => '/tmp/picked')
  if (withWorkspaces) ctx.provide('workspaces', { pickDirectory } as never)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 's',
          result: {
            ok: true,
            value: {
              writable: true, hasDocument: true,
              namespaces: [{ ns: 'mcp', schema: {}, value: {}, applies: 'live', secrets: [], revision: 0 }],
            },
          },
        })),
      },
      credentials: { describe: vi.fn(() => Promise.resolve({ rpcId: 'c', result: { ok: false, error: {} } })) },
    },
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  // The Plugins section owns the seat this tab injects into, and `slots.inject`
  // waits on that declaration: without the owner there is nothing to join.
  await ctx.plugin({ inject: [...pluginsInject], apply: pluginsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, pickDirectory, mcpStatus }
}

/** The Plugins section declares the tab seat; the tab cannot register without it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-mcp apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.mcpStatus', 'settingsScope'])
  })

  it('registers one MCP tab under the Plugins section', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    // The seat is shared with the section's own tab, so select by id.
    const tab = slots.entries('settings.plugins.tab').find(entry => entry.options.id === 'mcp')!
    expect(tab.options).toMatchObject({ id: 'mcp', order: 5 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(tab.options.label)).toBe('MCP 服务器')
  })

  it('removes the tab and the dictionary when the fiber is disposed', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const before = slots.entries('settings.plugins.tab').length
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const withTab = slots.entries('settings.plugins.tab')
    expect(withTab).toHaveLength(before + 1)
    expect(withTab.some(entry => entry.options.id === 'mcp')).toBe(true)

    await fiber.dispose()
    // The contribution leaves with its fiber, and the section's own tab stays.
    const after = slots.entries('settings.plugins.tab')
    expect(after.some(entry => entry.options.id === 'mcp')).toBe(false)
    expect(after).toHaveLength(before)
  })

  it('unwraps the status Remote for reads and restarts', async () => {
    const { ctx, slots, mcpStatus } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const tab = slots.entries('settings.plugins.tab').find(entry => entry.options.id === 'mcp')!
    const face = (tab.inject as unknown as () => McpSettingsTabInjected)()
    // A successful call hands the tab the Remote's value, not its envelope.
    await expect(face.list()).resolves.toEqual({ servers: [] })
    await expect(face.restart('srv-1')).resolves.toEqual({ servers: [] })
    expect(mcpStatus.restart).toHaveBeenCalledWith({ id: 'srv-1' })
  })

  it('surfaces a failed Remote call as a named error', async () => {
    // The tab renders a retry affordance on a rejection, so a broken Remote
    // must reject with the code and message rather than resolve to nothing.
    const { ctx, slots, mcpStatus } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    mcpStatus.list.mockResolvedValueOnce({
      ok: false as const, error: { code: 'unavailable', message: 'bridge offline' },
    } as never)

    const tab = slots.entries('settings.plugins.tab').find(entry => entry.options.id === 'mcp')!
    const face = (tab.inject as unknown as () => McpSettingsTabInjected)()
    await expect(face.list()).rejects.toThrow('mcpStatus.list failed: unavailable: bridge offline')

    // The restart path reports the same way, so the tab's retry affordance
    // covers a failed remount and not only a failed read.
    mcpStatus.restart.mockResolvedValueOnce({
      ok: false as const, error: { code: 'not-found', message: 'no such server' },
    } as never)
    await expect(face.restart('gone')).rejects.toThrow('mcpStatus.restart failed: not-found: no such server')
  })

  it('hands the tab the workspace folder chooser when that service is present', async () => {
    const { ctx, slots, pickDirectory } = await bench(true)
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    // The injection face is built per render; read it the way the renderer does.
    const tab = slots.entries('settings.plugins.tab').find(entry => entry.options.id === 'mcp')!
    const face = (tab.inject as unknown as () => McpSettingsTabInjected)()
    expect(face.chooseFolder).toBeDefined()
    await expect(face.chooseFolder?.()).resolves.toBe('/tmp/picked')
    expect(pickDirectory).toHaveBeenCalledOnce()
  })

  it('leaves the chooser out when no workspace service is mounted', async () => {
    // A tree without workspaces still gets a usable tab: the folder stays
    // typeable rather than the tab failing to render a control it cannot back.
    const { ctx, slots } = await bench(false)
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const tab = slots.entries('settings.plugins.tab').find(entry => entry.options.id === 'mcp')!
    const face = (tab.inject as unknown as () => McpSettingsTabInjected)()
    expect(face.chooseFolder).toBeUndefined()
  })
})
