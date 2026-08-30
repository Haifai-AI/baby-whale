/**
 * Skills settings surface, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half owns the section.
 * The `skills` settings namespace itself is registered by the API gateway on
 * first skill listing, so this package owns no namespace of its own — exactly
 * like ui-settings-plugins, every page it renders edits a Host-owned section.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
