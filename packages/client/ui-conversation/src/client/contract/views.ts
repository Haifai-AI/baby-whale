/** Shared conversation view, selection, and store-state contracts. */

/** Tool call identity as carried on the wire (branded upstream in connection). */
export type CallId = string

/** Selection target for the details linkage channel (toolcall is the step special case). */
export interface SelectionTarget { turnSeq?: number; stepSeq?: number; callId?: CallId; toolName?: string }

/**
 * One conversation view tab, projected from a 'conversation.view' slot
 * entry's registration options (label falls back to the entry id).
 */
export interface ViewTab { id: string; label: string }

/**
 * Per-session state shared by conversation, chat-view, and details slots.
 * Unknown persisted view ids fall back to the stable Chat view.
 */
export interface ChatStoreState {
  /** Details-linkage channel (conversation writes, details reads). */
  selection: SelectionTarget | null
  /**
   * Pinned office artifacts in the details panel (open order). Office tool
   * selections pin automatically; plain selections only focus. Persisted
   * snapshots from before this field rehydrate with `?? []` semantics.
   */
  pins?: SelectionTarget[]
  /** Composer draft (persisted; survives session switches and reloads). */
  draft: string
  /** Active conversation view id ('conversation.view' entry id); null falls back to Chat. */
  view: string | null
  /**
   * One-shot inspect handoff: chat writes the call to reveal, the trajectory
   * view consumes it and acknowledges by clearing. Read with `?? null` —
   * persisted snapshots from before this field rehydrate without it.
   */
  inspect: { callId: CallId } | null
  /**
   * Workspace-relative path of the deliverable shown in the details panel's
   * file-preview mode (chat produced-file cards write it; null = no preview).
   * Rehydrates as null on persisted snapshots from before this field.
   */
  filePreview?: string | null
}
