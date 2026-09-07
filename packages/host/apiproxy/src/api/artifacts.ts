/**
 * artifacts domain contract: one session's produced-and-uploaded files as a
 * flat, metadata-only gallery. The scan is bounded (top level of `uploads/`
 * and `deliverables/` under the session's workspace) so a huge workspace
 * still answers cheaply; bytes stay on the host — preview rides `host`-owned
 * file URLs, and opening uses `host.openPath`.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'
/** Preview payloads are JSON-safe by construction (see artifacts-preview.ts). */
type PreviewValue = unknown

/** One artifact row of the gallery. */
export interface ArtifactEntry {
  /** Workspace-relative path (the model-facing spelling, e.g. `deliverables/q2.xlsx`). */
  readonly path: string
  /** Base name for display. */
  readonly name: string
  /** Kind bucket driving the icon and preview mode. */
  readonly kind: 'xlsx' | 'docx' | 'pptx' | 'csv' | 'pdf' | 'image' | 'markdown' | 'text' | 'other'
  /** Stored byte length. */
  readonly size: number
  /** Last-modified instant (epoch ms). */
  readonly modifiedAt: number
  /** Where the file came from. */
  readonly origin: 'deliverable' | 'upload'
}

/** Artifacts-domain unary methods. */
export interface ArtifactsApi {
  /**
   * Lists the calling session's artifacts: files one level under the
   * workspace's `deliverables/` and `uploads/`, newest first.
   */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ artifacts: readonly ArtifactEntry[] }>>

  /**
   * Parses one workspace artifact into the bounded preview shapes the
   * right-side studio renders. Read-only; undefined preview for kinds we
   * cannot parse (the caller falls back to Open-in-app).
   */
  preview(request: RpcRequest<{ sessionId: SessionId; path: string }>):
  Promise<RpcResponse<{ preview?: PreviewValue; size: number }>>

  /**
   * Host-only GET channel: serves ONE converted preview PDF from the
   * gateway-owned cache directory. Any path outside the cache is refused —
   * this is not a general file server.
   */
  file(query: { path: string }, signal: AbortSignal): Promise<Response>

  /**
   * Host-only GET channel: serves the ORIGINAL bytes of one file under the
   * session workspace's `deliverables/` or `uploads/`. Path is canonicalized
   * host-side and jailed to those two directories. `download` switches the
   * response to a `Content-Disposition: attachment` download.
   */
  raw(query: { sessionId: SessionId; path: string; download?: '1' }, signal: AbortSignal): Promise<Response>
}
