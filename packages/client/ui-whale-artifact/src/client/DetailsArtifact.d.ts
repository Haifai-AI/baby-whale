/**
 * Right-side artifact studio: the keyed `conversation.details.toolview` entries
 * for the office tools. The xlsx entry renders Excel-style chrome — sheet-tab
 * strip, formula bar, column letters, row gutter, frozen navy header, and
 * gridlines — the pptx entry a slide gallery, and the docx entry a document
 * page. All rendered from the persisted preview meta, so the studio replays
 * identically and needs no file bytes.
 * @module @deepseek-ai/dsh-client-ui-whale-artifact/src/client/DetailsArtifact
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficePreviewData } from './whale-preview.ts'
import type { NS } from './locales.ts'
type DetailsArtifactProps = PropsRuntime<'conversation.details.toolview'> & PropsLocale<typeof NS>
/** The studio: header chrome plus the artifact kind's body. */
export declare function DetailsArtifactView({ block, cwd, t }: DetailsArtifactProps): import('react').JSX.Element
/** Studio body for any parsed office preview (shared with the Artifacts tab). */
export declare function ArtifactStudioBody({ preview }: {
  preview: OfficePreviewData
}): import('react').JSX.Element
/** Excel-style spreadsheet studio. */
export declare function ExcelStudio({ preview }: {
  preview: Extract<OfficePreviewData, {
    kind: 'xlsx'
  }>
}): import('react').JSX.Element | null
/** Slide gallery studio: larger 16:9 cards in one column, page-numbered. */
export declare function SlideGallery({ preview }: {
  preview: Extract<OfficePreviewData, {
    kind: 'pptx'
  }>
}): import('react').JSX.Element
/** Document studio: a readable paper page. */
export declare function DocPage({ preview }: {
  preview: Extract<OfficePreviewData, {
    kind: 'docx'
  }>
}): import('react').JSX.Element
export {}
//# sourceMappingURL=DetailsArtifact.d.ts.map
