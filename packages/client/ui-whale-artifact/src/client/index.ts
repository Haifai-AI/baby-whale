/**
 * Office artifact preview plugin, browser half: registers the keyed tool views
 * for the three office tools (each rendering the bounded preview carried in
 * the tool result's `presentationMeta`) plus their details-panel studios.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OfficeArtifactCard } from './OfficeArtifactCard.tsx'
import { DetailsArtifactView } from './DetailsArtifact.tsx'
import { en, NS, zh, type WhaleArtifactKey } from './locales.ts'
import { OFFICE_TOOLS } from './whale-preview.ts'
export { ArtifactStudioBody } from './DetailsArtifact.tsx'
export type { OfficePreviewData } from './whale-preview.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Office artifact preview card copy. */
    'whale-artifact': WhaleArtifactKey
  }
}

/** Required services for the keyed tool-view registration and its dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the keyed tool views plus
 * the right-side details studios.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-whale-artifact: dictionaries')
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const tool of OFFICE_TOOLS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: tool, locale: NS }, OfficeArtifactCard)
    }
  })
  ctx.slots.inject('conversation.details.toolview', function* () {
    for (const tool of OFFICE_TOOLS) {
      yield ctx.slots.register({ name: 'conversation.details.toolview', key: tool, locale: NS }, DetailsArtifactView)
    }
  })
}
