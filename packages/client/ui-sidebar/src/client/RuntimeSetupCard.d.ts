import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** Props for the always-visible setup card (hidden entirely once found). */
export interface RuntimeSetupCardProps {
    readonly wide: boolean;
    readonly t: PropsLocale<'sidebar'>['t'];
}
/**
 * Ambient setup card: reappears every launch until the pixel-preview
 * runtime is present, then never again. Never blocks — the app works
 * degraded the whole time.
 * @param props - layout width and translate.
 * @returns the card, or null when the runtime is present or status is unknown.
 */
export declare function RuntimeSetupCard({ wide, t }: RuntimeSetupCardProps): JSX.Element | null;
//# sourceMappingURL=RuntimeSetupCard.d.ts.map