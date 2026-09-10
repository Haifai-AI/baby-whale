/**
 * Artifacts tab, browser half — one `conversation.view` entry beside Chat and
 * Trajectory. The gallery lists every file under the session workspace's
 * `deliverables/` and `uploads/` via the `artifacts.list` gateway RPC, and
 * opens entries through `host.openPath` (Excel / Word / whatever owns the
 * type). Pure display: no services, no events.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ArtifactsView } from './ArtifactsView.tsx'
import type { WhaleArtifactsKey } from './locales.ts'
import { en, NS, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Artifacts tab copy. */
    'whale-artifacts': WhaleArtifactsKey
  }
}

/** Required services: the conversation view slot, connection for the RPCs, and the locale service. */
export const inject = ['slots', 'connection', 'locale']

/**
 * Client plugin body: register the dictionaries and the Artifacts view tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-whale-artifacts: dictionaries')
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'whale-artifacts',
    order: 11,
    locale: NS,
    label: () => t('view.artifacts'),
    inject: (sessionId: SessionId) => ({
      connection,
      sessionId,
    }),
  }, ArtifactsView))
}
