/**
 * Workspace upload intake: sanitize user-supplied filenames to a safe
 * basename, stamp them into `<workspace>/uploads/` without ever colliding
 * with an existing file, and enforce the byte budget before content lands.
 * Host-plane only — this module touches real disk.
 * @module @deepseek-ai/dsh-tool-apiproxy/src/uploads-intake
 */

import { mkdir, stat, writeFile } from 'node:fs/promises'
import nodePath from 'node:path'

/** Inclusive byte cap per uploaded file; mirrors the read tools' input cap. */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024

/** Directory created inside the session workspace for landed uploads. */
export const UPLOADS_DIRNAME = 'uploads'

/**
 * Reduce an arbitrary client filename to a safe basename.
 * @param filename - raw name from the query string or File handle.
 * @returns `[stamp]-safe.ext` style name parts before stamping, upper bound 120 chars.
 */
export function sanitizeFilename(filename: string): string {
  const base = nodePath.basename(filename.replaceAll('\\', '/')).trim()
  const cleaned = base.replace(/[^A-Za-z0-9._()\- ]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.\s-]+/, '')
  const safe = cleaned.length > 0 ? cleaned.slice(0, 120) : 'upload.bin'
  return safe
}

/**
 * Derive a non-colliding stamped filename inside the target directory plan.
 * Pure: the actual existence probe happens through the provided tester so the
 * collision strategy stays observable in tests.
 * @param directory - absolute target directory.
 * @param sanitized - output of {@link sanitizeFilename}.
 * @param stamp - millisecond timestamp prefix.
 * @param exists - probe answering whether a candidate path already exists.
 * @returns the first non-conflicting `<stamp>-<name>` / `<stamp>-<i>-<name>`.
 */
export async function stampedCandidate(
  directory: string,
  sanitized: string,
  stamp: number,
  exists: (absolute: string) => Promise<boolean>,
): Promise<string> {
  const first = `${stamp}-${sanitized}`
  if (!await exists(nodePath.join(directory, first))) return first
  for (let counter = 2;; counter++) {
    const candidate = `${stamp}-${counter}-${sanitized}`
    if (!await exists(nodePath.join(directory, candidate))) return candidate
  }
}

/**
 * Store one upload payload.
 * @param workspace - the session's workspace root (header cwd).
 * @param filename - raw proposed filename.
 * @param bytes - validated body bytes (must already respect {@link UPLOAD_MAX_BYTES}).
 * @param now - timestamp source for stamps (defaults to Date.now).
 * @returns the workspace-relative path plus stored size and final name.
 */
export async function storeUpload(
  workspace: string,
  filename: string,
  bytes: Uint8Array,
  now: () => number = Date.now,
): Promise<{ path: string; name: string; size: number }> {
  const directory = nodePath.join(workspace, UPLOADS_DIRNAME)
  await mkdir(directory, { recursive: true })
  const sanitized = sanitizeFilename(filename)
  const stamped = await stampedCandidate(
    directory,
    sanitized,
    now(),
    async (candidate) => {
      try {
        await stat(candidate)
        return true
      } catch {
        return false
      }
    },
  )
  const target = nodePath.join(directory, stamped)
  await writeFile(target, bytes)
  return { path: `${UPLOADS_DIRNAME}/${stamped}`, name: stamped, size: bytes.byteLength }
}
