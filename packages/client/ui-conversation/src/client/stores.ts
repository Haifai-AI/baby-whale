/**
 * Per-session chat store shared by conversation and details registrations.
 * The plugin creates its handle at apply time so identity follows the fiber.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { CallId, ChatStoreState, SelectionTarget } from './contract/views.ts'

/** Declared action shape used to give the exported factory a stable return type. */
type ChatActions = {
  select: (draft: ChatStoreState, target: SelectionTarget | null) => void
  pin: (draft: ChatStoreState, target: SelectionTarget) => void
  unpin: (draft: ChatStoreState, callId: CallId) => void
  setDraft: (draft: ChatStoreState, text: string) => void
  setView: (draft: ChatStoreState, view: string) => void
  setInspect: (draft: ChatStoreState, target: { callId: CallId } | null) => void
  openFilePreview: (draft: ChatStoreState, path: string) => void
  closeFilePreview: (draft: ChatStoreState) => void
  toggleRun: (draft: ChatStoreState, runKey: string) => void
}

/**
 * Declares the per-session chat state and write surface.
 * @returns the store handle.
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  return defineStore({
    // Anchored to the contract shape: consumers read the store through
    // PropsStore<ChatStore>'s SnapshotSelectorHook<ChatStoreState>, so init
    // and the contract cannot drift.
    init: (): ChatStoreState => ({ selection: null, draft: '', view: null, inspect: null, filePreview: null }),
    persist: 'dsh.conversation.chat',
    actions: {
      select: (d, target: SelectionTarget | null) => { d.selection = target },
      pin: (d, target: SelectionTarget) => {
        const pins = d.pins ?? []
        if (pins.some(pin => pin.callId === target.callId)) return
        d.pins = [...pins.slice(-7), target]
        d.selection = target
      },
      unpin: (d, callId: CallId) => {
        d.pins = (d.pins ?? []).filter(pin => pin.callId !== callId)
      },
      setDraft: (d, text: string) => { d.draft = text },
      setView: (d, view: string) => { d.view = view },
      setInspect: (d, target: { callId: CallId } | null) => { d.inspect = target },
      openFilePreview: (d, path: string) => { d.filePreview = path },
      closeFilePreview: (d) => { d.filePreview = null },
      toggleRun: (d, runKey) => {
        const open = d.expandedRuns ?? []
        d.expandedRuns = open.includes(runKey)
          ? open.filter(key => key !== runKey)
          : [...open, runKey]
      },
    },
  })
}
