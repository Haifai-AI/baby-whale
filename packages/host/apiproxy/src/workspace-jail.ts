/**
 * Workspace jail: the single choke point for host-plane file access under a
 * session workspace (or any root, e.g. the preview cache). String-prefix
 * containment without a directory-boundary separator admits same-prefix
 * siblings (`/work` vs `/workspace-evil`), and lexical resolution alone
 * follows symlinks — so every access anchors through the real path: resolve
 * lexically, require containment, resolve symlinks with `realpath`, require
 * containment again, and hand callers the anchored path for all downstream
 * use (reads AND subprocess inputs, which would otherwise re-follow links).
 *
 * Residual: a swap between the anchor check and use (an attacker with
 * workspace write winning a microsecond race) is not closed — it upgrades a
 * deterministic escape into a race, which is the best a non-privileged
 * process can do without `O_NOFOLLOW` (unavailable portably).
 *
 * @module @deepseek-ai/dsh-host-apiproxy/workspace-jail
 */

import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * The containment boundary for a root: the real path (symlink-realified,
 * so macOS `/var` vs `/private/var` style aliases compare equal) with a
 * trailing separator, so `/work/` never contains `/workspace-evil/x`.
 * A vanished root falls back to its lexical form rather than throwing.
 * @param root - the jail root directory.
 * @returns `{ real, boundary }`: the real root and its separator-terminated form.
 */
function boundaryFor(root: string): { real: string; boundary: string } {
  let real = resolve(root)
  try {
    real = resolve(realpathSync(real))
  } catch {
    // Vanished root: the lexical form is the best remaining evidence.
  }
  return { real, boundary: real.endsWith('/') ? real : `${real}/` }
}

/**
 * Whether an absolute path sits inside a root: equal to it, or under its
 * separator-terminated boundary (so `/work/` never contains
 * `/workspace-evil/x`). Pure and directly unit-tested — every file and
 * preview gate funnels through here. Both sides are expected in canonical
 * (realpath) spelling, which keeps the comparison casing-consistent even on
 * case-insensitive filesystems.
 * @param root - the jail root directory.
 * @param absolute - the candidate absolute path.
 * @returns true for the root itself and paths strictly beneath it.
 */
export function containedPath(root: string, absolute: string): boolean {
  const { real, boundary } = boundaryFor(root)
  return absolute === real || absolute.startsWith(boundary)
}

/**
 * Anchor a workspace-relative request to its real path, or refuse it.
 * `resolve` normalizes `.`/`..` lexically first (so `..` cannot smuggle
 * past), then a single `realpath` both proves existence and resolves the
 * full link chain — parent directories AND the final component — against
 * the real root. Comparing real-against-real keeps casing consistent on
 * case-insensitive filesystems (no `C:\Work` vs `c:\work` false refusal).
 * Missing files refuse exactly like escapes: callers already map a refused
 * anchor to their not-found/unreadable response, and a missing file has no
 * safe anchored form.
 * @param workspaceRoot - the session workspace root (header cwd).
 * @param rel - the client-supplied relative path (absolute inputs resolve
 *   against the root per `resolve` semantics and then face the same check).
 * @returns the symlink-free absolute path, or undefined when outside the
 *   jail, unreachable through links that stay inside, or missing.
 */
export async function anchorWorkspacePath(workspaceRoot: string, rel: string): Promise<string | undefined> {
  const real = await realpath(resolve(workspaceRoot, rel)).catch(() => undefined)
  // Downstream reads AND subprocess inputs must use this anchored result —
  // re-resolving the request path would re-follow links.
  if (real === undefined || !containedPath(workspaceRoot, real)) return undefined
  return real
}
