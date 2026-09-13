/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-whale-mcp`.
 * @module @deepseek-ai/dsh-whale-mcp/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-whale-mcp'

/** Cordis companion plugin name. */
export const name = 'whale-mcp-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: mounts, status cells, and the approval fence are all
 * effect-owned registrations whose disposal rides the hosting fiber. One
 * deliberate exception lives in the manager: a fiber whose disposal never
 * settles stays retained (cell or stranded record) until it settles or the
 * process restarts — observed ownership, never a leaked invisible child.
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
