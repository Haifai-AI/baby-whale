/**
 * Workspace artifact scanning: bounded metadata-only walk over a session
 * workspace's `uploads/` and `deliverables/` directories. No byte reads —
 * stat alone feeds the gallery, so even huge workspaces answer cheaply.
 * @module @deepseek-ai/dsh-tool-apiproxy/src/artifacts-scan
 */

import { readdir, stat } from 'node:fs/promises'
import nodePath from 'node:path'

/** One scanned artifact (host-side; the wire projection lives in api/artifacts.ts). */
export interface ScannedArtifact {
  readonly path: string
  readonly name: string
  readonly kind: 'xlsx' | 'docx' | 'pptx' | 'csv' | 'pdf' | 'image' | 'text' | 'other'
  readonly size: number
  readonly modifiedAt: number
  readonly origin: 'deliverable' | 'upload'
}

/** Directories scanned, in gallery priority order. */
const SCAN_DIRS: ReadonlyArray<{ dir: string; origin: 'deliverable' | 'upload' }> = [
  { dir: 'deliverables', origin: 'deliverable' },
  { dir: 'uploads', origin: 'upload' },
]

/** Hard cap so pathological workspaces can never stall the response. */
const MAX_ENTRIES = 200

/** Map a file extension to its gallery kind bucket. */
function kindOf(name: string): ScannedArtifact['kind'] {
  const ext = nodePath.extname(name).toLowerCase()
  switch (ext) {
    case '.xlsx': case '.xlsm': return 'xlsx'
    case '.docx': return 'docx'
    case '.pptx': return 'pptx'
    case '.csv': case '.tsv': return 'csv'
    case '.pdf': return 'pdf'
    case '.png': case '.jpg': case '.jpeg': case '.gif': case '.webp': case '.svg': return 'image'
    case '.txt': case '.md': case '.json': return 'text'
    default: return 'other'
  }
}

/**
 * Scan one session workspace's artifact directories.
 * @param workspace - absolute workspace root.
 * @returns metadata rows, newest first, bounded at {@link MAX_ENTRIES}.
 */
export async function scanArtifacts(workspace: string): Promise<ScannedArtifact[]> {
  const found: ScannedArtifact[] = []
  for (const { dir, origin } of SCAN_DIRS) {
    const absolute = nodePath.join(workspace, dir)
    let names: string[]
    try {
      names = await readdir(absolute)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = nodePath.join(absolute, name)
      try {
        const info = await stat(full)
        if (!info.isFile()) continue
        found.push({
          path: `${dir}/${name}`,
          name,
          kind: kindOf(name),
          size: info.size,
          modifiedAt: Math.round(info.mtimeMs),
          origin,
        })
      } catch {
        // Raced deletion or permission oddity: skip the entry, keep scanning.
      }
    }
  }
  found.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return found.slice(0, MAX_ENTRIES)
}
