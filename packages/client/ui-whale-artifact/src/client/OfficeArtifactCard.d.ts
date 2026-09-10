/**
 * Keyed tool view for the office artifact tools (`xlsx_create`, `pptx_create`,
 * `docx_create`): renders the bounded preview embedded in the tool result's
 * `presentationMeta` as a Cowork-style artifact card — spreadsheet chrome,
 * slide-deck thumbnails, or a document page.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/OfficeArtifactCard
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { NS } from './locales.ts'
/** Full props: the toolview runtime share plus the plugin's dictionary seat. */
export type OfficeArtifactCardProps = ToolCallViewProps & PropsLocale<typeof NS>
/**
 * The artifact card: header (icon, file name, meta, open action) plus the
 * preview body for the artifact's format.
 */
export declare function OfficeArtifactCard({ callId, toolName, block, openFile, openDetails, t }: OfficeArtifactCardProps): import('react').JSX.Element
//# sourceMappingURL=OfficeArtifactCard.d.ts.map
