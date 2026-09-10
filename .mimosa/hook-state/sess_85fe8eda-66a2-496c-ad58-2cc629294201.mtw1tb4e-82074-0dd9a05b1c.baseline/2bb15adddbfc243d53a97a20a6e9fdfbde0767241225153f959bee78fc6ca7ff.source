/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-whale-guardrails`.
 * @module @deepseek-ai/dsh-whale-guardrails/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-whale-guardrails'

/** Cordis companion plugin name. */
export const name = 'whale-guardrails-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin's fence, guard, and prompt section are
 * effect-owned registrations whose disposal rides the hosting fiber; it owns
 * no mutable state of its own.
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
