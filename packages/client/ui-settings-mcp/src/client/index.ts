/** MCP servers management tab registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { McpSettingsTab, type McpSettingsTabInjected, type McpSettingsView } from './McpSettingsTab.tsx'
import { en, zh, type McpSettingsLocaleKey } from './locales.ts'

export type { McpSettingsTabInjected, McpSettingsTabProps, McpServerEntryView, McpSettingsView } from './McpSettingsTab.tsx'
export type { McpSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP servers management copy. */
    'settings.mcp': McpSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcp'

/** Services required by the Settings registration, the writes, and the Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpStatus', 'settingsScope']

/** Contribute the MCP servers tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: McpSettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.mcpStatus.list()
    if (!result.ok) {
      throw new Error(`mcpStatus.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const restart: McpSettingsTabInjected['restart'] = async (id) => {
    const result = await ctx.remote.mcpStatus.restart({ id })
    if (!result.ok) {
      throw new Error(`mcpStatus.restart failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const scope = ctx.settingsScope.bind<McpSettingsView>({ namespace: 'mcp' })
  const injected = (): McpSettingsTabInjected => ({ list, restart, scope })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'mcp',
    order: 5,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, McpSettingsTab))
}
