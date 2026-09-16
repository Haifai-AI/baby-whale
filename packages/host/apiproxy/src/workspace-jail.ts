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
import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Drop Windows' extended-length prefix. Node's synchronous and promise
 * `realpath` spellings disagree about adding `\\?\`, and `path.relative`
 * treats a prefixed and an unprefixed path as living on different roots — so
 * comparing a realpathed root against a realpathed candidate refused every
 * honest file inside a workspace on Windows. A UNC root keeps its own leading
 * pair rather than losing both.
 * @param path - an absolute path, with or without the prefix.
 * @returns the same path without it.
 */
export const withoutExtendedPrefix = (path: string): string =>
  path.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '')

/**
 * The real, symlink-resolved form of a root, so macOS `/var` versus
 * `/private/var` aliases compare equal. A vanished root falls back to its
 * lexical form rather than throwing.
 * @param root - the jail root directory.
 * @returns the real root.
 */
function realRootOf(root: string): string {
  const resolved = resolve(root)
  try {
    return resolve(realpathSync(resolved))
  } catch {
    // Vanished root: the lexical form is the best remaining evidence.
    return resolved
  }
}

/**
 * Whether an absolute path sits inside a root: equal to it, or beneath it.
 * Containment is decided by `path.relative`, never by string prefix. A prefix
 * comparison has to append the platform's own separator to the root, and the
 * two sides then disagree on Windows — the root ends `C:\ws\` while the
 * candidate continues `C:\ws\file`, so `startsWith` was false and every file
 * inside the workspace was refused. `relative` also settles the same-prefix
 * sibling case (`/work` versus `/workspace-evil/x` yields `..`), and reports
 * a candidate on a different Windows drive as absolute rather than relative.
 * Pure and directly unit-tested — every file and preview gate funnels here.
 * @param root - the jail root directory.
 * @param absolute - the candidate absolute path.
 * @returns true for the root itself and paths strictly beneath it.
 */
export function containedPath(root: string, absolute: string): boolean {
  const rel = relative(withoutExtendedPrefix(realRootOf(root)), withoutExtendedPrefix(absolute))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
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
