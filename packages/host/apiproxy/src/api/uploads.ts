/**
 * uploads domain contract: host-only intake channel landing user files into
 * the calling session's workspace `uploads/` directory — the POST twin of the
 * downloads GET channel family. No wire envelope: the carrier's POST route
 * consumes the raw request body directly, and the browser `IApiClient` never
 * exposes it.
 *
 * Every served session records its workspace at create time (`header.cwd`);
 * files land under `<cwd>/uploads/<stamp>-<safe-name>` so sandboxed tool reads
 * (`xlsx_read`, image embedding, office generation inputs) see them without
 * granting the browser any other filesystem reach. The workspace escape guard
 * stays host-side: names are basename-only and sanitized to a safe charset.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** JSON body produced by one successful upload. */
export interface WorkspaceUploadOutcome {
  /** Workspace-relative path of the stored file (mention this in prompts). */
  readonly path: string
  /** The de-conflicted display name actually used on disk. */
  readonly name: string
  /** Stored byte length. */
  readonly size: number
}

/**
 * Upload-domain unary methods. Listing nothing else: invocation-free by
 * design — uploads are plain bytes-in, path-out with no model involvement.
 */
export interface UploadsApi {
  /**
   * Store one uploaded file into the session's workspace `uploads/` dir.
   * @param query - target session plus proposed filename.
   * @param signal - cancellation for the underlying write.
   * @param request - the original POST carrying raw octet-stream bytes.
   * @returns the JSON outcome response; missing session answers 404, an
   * over-limit or non-octet-stream body 415/413 before any byte is written.
   */
  workspaceFile(
    query: { sessionId: SessionId; filename: string },
    signal: AbortSignal,
    request: Request,
  ): Promise<Response>
}
