/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-skills`.
 * @module @deepseek-ai/dsh-client-ui-settings-skills/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-skills'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-skills-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a browser-only settings surface whose node half owns
 * no event stream or mutable runtime data; namespace ownership lives in the
 * API gateway and filtering lives in tool-skill.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
