/**
 * Office artifact preview plugin, browser half: registers the keyed tool views
 * for the three office tools (each rendering the bounded preview carried in
 * the tool result's `presentationMeta`) plus their details-panel studios.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { type WhaleArtifactKey } from './locales.ts'
export { ArtifactStudioBody } from './DetailsArtifact.tsx'
export type { OfficePreviewData } from './whale-preview.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Office artifact preview card copy. */
    'whale-artifact': WhaleArtifactKey
  }
}
/** Required services for the keyed tool-view registration and its dictionaries. */
export declare const inject: string[]
/**
 * Client plugin body: register the dictionaries and the keyed tool views plus
 * the right-side details studios.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void
//# sourceMappingURL=index.d.ts.map
