/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-whale-trash`.
 * @module @deepseek-ai/dsh-whale-trash/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-whale-trash'

/** Cordis companion plugin name. */
export const name = 'whale-trash-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: backups live in the workspace filesystem (the fs
 * backend's own data), the wrapper and tools own no mutable stream, and every
 * registration here is effect-scoped to this plugin's fiber.
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
