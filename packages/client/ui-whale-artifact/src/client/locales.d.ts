/**
 * `whale-artifact` namespace dictionaries: the renderer copy for the office
 * artifact preview cards.
 */
/** Dictionary namespace owned by this plugin. */
export declare const NS = 'whale-artifact'
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
  'artifact.createdBy': string
  'artifact.open': string
  'artifact.rows': string
  'artifact.slides': string
  'artifact.blocks': string
  'artifact.truncated': string
  'artifact.more': string
  'artifact.failed': string
  'artifact.details': string
}
/** English dictionary (same key set). */
export declare const en: Record<WhaleArtifactKey, string>
/** Union of this namespace's dictionary keys. */
export type WhaleArtifactKey = keyof typeof zh
//# sourceMappingURL=locales.d.ts.map
