import { OfficeArtifactCard } from "./OfficeArtifactCard.js";
import { DetailsArtifactView } from "./DetailsArtifact.js";
import { en, NS, zh } from "./locales.js";
import { OFFICE_TOOLS } from "./whale-preview.js";
export { ArtifactStudioBody } from "./DetailsArtifact.js";
/** Required services for the keyed tool-view registration and its dictionaries. */
export const inject = ['slots', 'locale'];
/**
 * Client plugin body: register the dictionaries and the keyed tool views plus
 * the right-side details studios.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-whale-artifact: dictionaries');
    ctx.slots.inject('tool.call.toolview', function* () {
        for (const tool of OFFICE_TOOLS) {
            yield ctx.slots.register({ name: 'tool.call.toolview', key: tool, locale: NS }, OfficeArtifactCard);
        }
    });
    ctx.slots.inject('conversation.details.toolview', function* () {
        for (const tool of OFFICE_TOOLS) {
            yield ctx.slots.register({ name: 'conversation.details.toolview', key: tool, locale: NS }, DetailsArtifactView);
        }
    });
}
//# sourceMappingURL=index.js.map