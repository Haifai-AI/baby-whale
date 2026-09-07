// DetailsPanel: close button + the selected call's args and
// result — args as JSON, the result raw except for a terminal-card call, whose
// Output section is the command's terminal card. Reads the
// selection from the shared chat
// store (conversation writes, this panel reads — the cross-registration
// share the store seat exists for) and derives the call material from the
// session snapshot — no data of its own.

import { Fragment, useMemo } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { DetailsSlotProps } from '../contract/slots.ts'
import { findToolCall } from '../chat/tool-node-reader.ts'
import type { SelectionTarget } from '../contract/views.ts'
import css from './DetailsPanel.module.css'

/** Full props composed by reference from the contract (automatic shares & injected share). */
export type DetailsPanelProps = DetailsSlotProps

/**
 * Selected call material: the call's display name and args plus the frozen
 * block slice it came from. `block` is a snapshot-cached reference, so the
 * wrapper stays shallow-equal across unrelated snapshot frames; the settled /
 * running split is read off it with the `'kind' in block` discrimination
 * instead of duplicated as flags.
 */
interface CallMaterial {
  name: string
  argsRaw: string | null
  block: ToolCallBlock
}

/** Material of a settled result node (native call or run_code sub-dispatch). */
function settledMaterial(node: ToolResultNode, callId: string): CallMaterial {
  return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node }
}

/** Material of an in-flight call (native call or run_code sub-dispatch). */
function runningMaterial(call: RunningToolCall): CallMaterial {
  return { name: call.name, argsRaw: call.argsRaw, block: call }
}

function materialFor(s: ConversationSnapshot, callId: string): CallMaterial | null {
  const found = findToolCall(s, callId)
  if (found === undefined) return null
  return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // Not JSON (streaming fragment or plain text): show verbatim.
    return raw
  }
}

/** Flatten a settled result for the no-ui-tool fallback. */
function rawResultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

/** Tab label for a pinned call: the artifact basename when resolvable. */
function pinLabel(s: ConversationSnapshot | null, callId: string, toolName: string): string {
  const found = s === null ? undefined : findToolCall(s, callId)
  const block = found !== undefined && 'kind' in found ? found : undefined
  const argsRaw = block?.call?.argsRaw
  if (argsRaw !== undefined) {
    try {
      const parsed = JSON.parse(argsRaw) as { file_path?: unknown }
      if (typeof parsed.file_path === 'string') {
        const path = parsed.file_path
        const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
        return index >= 0 ? path.slice(index + 1) : path
      }
    } catch { /* streaming fragment: fall through to tool name */ }
  }
  return toolName
}

export function DetailsPanel({
  useSession, useSessions, sessionId, useStore, actions, renderSlot, closeDetails, setDetailsExpanded, expanded, toggleExpanded, t,
}: DetailsPanelProps) {
  const selectPin = actions.select
  const unpin = (callId: NonNullable<SelectionTarget['callId']>): void => { actions.unpin(callId) }
  const closeAll = (): void => {
    for (const pin of pins) { if (pin.callId !== undefined) actions.unpin(pin.callId) }
    closeDetails()
  }
  const selection = useStore(s => s.selection)
  const pins = useStore(s => s.pins ?? [])
  // Whole-panel deliverable preview (produced-file cards write it): when set,
  // the panel shows the rendered file instead of the call details.
  const filePreview = useStore(s => s.filePreview ?? null)
  // Session workspace root: an omitted or relative terminal cwd resolves
  // against it, which the pure presenter cannot see.
  const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const callId = selection?.callId
  // materialFor builds a fresh wrapper; shallowEqual short-circuits on its
  // stable members (result node reference rides the snapshot's structural sharing).
  const material = useSession(
    s => (callId === undefined ? null : materialFor(s, callId)),
    (a, b) => shallowEqual(a, b))

  // Active target prefers an explicit plain selection; otherwise the pinned
  // artifact tabs drive the panel like a persistent workspace.
  const snapshotForLabels = useSession(s => s)
  const labels = useMemo(
    () => new Map(pins.map(pin => [pin.callId ?? '', pinLabel(snapshotForLabels, pin.callId ?? '', pin.toolName ?? 'artifact')])),
    [pins, snapshotForLabels])
  const activeCallId = callId ?? pins.at(-1)?.callId

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.tabs} role="tablist">
          {(filePreview !== null
            ? (
              <Fragment key="file-preview">
                <button
                  type="button"
                  role="tab"
                  aria-selected
                  data-active
                  className={css.tab}
                  title={filePreview}
                >
                  {filePreview.slice(Math.max(filePreview.lastIndexOf('/'), filePreview.lastIndexOf('\\')) + 1)}
                </button>
                <button
                  type="button" className={css.tabClose}
                  aria-label={t('details.close')}
                  onClick={() => { actions.closeFilePreview(); setDetailsExpanded(false) }}
                >
                  ×
                </button>
              </Fragment>
            )
            : (pins.length > 0
              ? pins.map((pin, index) => (
                <Fragment key={pin.callId ?? index}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={(activeCallId ?? '') === pin.callId}
                    data-active={(activeCallId ?? '') === pin.callId || undefined}
                    className={css.tab}
                    onClick={() => {
                      if (pin.callId === undefined) return
                      actions.closeFilePreview()
                      setDetailsExpanded(false)
                      const callId2: NonNullable<SelectionTarget['callId']> = pin.callId
                      selectPin({
                        ...(pin.turnSeq !== undefined ? { turnSeq: pin.turnSeq } : {}),
                        ...(pin.stepSeq !== undefined ? { stepSeq: pin.stepSeq } : {}),
                        callId: callId2,
                        ...(pin.toolName !== undefined ? { toolName: pin.toolName } : {}),
                      })
                    }}
                  >
                    {labels.get(pin.callId ?? '') ?? pin.toolName ?? t('details.title')}
                  </button>
                  <button
                    type="button" className={css.tabClose}
                    aria-label={t('details.close')}
                    onClick={() => { if (pin.callId !== undefined) unpin(pin.callId) }}
                  >
                    ×
                  </button>
                </Fragment>
              ))
              : null))}
          <div className={css.title}>
            {filePreview !== null || pins.length > 0
              ? null
              : selection === null
                ? t('details.title')
                : material?.name ?? selection.toolName ?? t('details.title')}
          </div>
        </div>
        {filePreview !== null && toggleExpanded !== undefined && (
          <button
            type="button" className={css.close} aria-label={expanded ? t('details.collapse') : t('details.expand')}
            title={expanded ? t('details.collapse') : t('details.expand')}
            onClick={() => { toggleExpanded() }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden data-expanded={expanded || undefined}>
              {expanded
                ? <path d="M9 3h4v4M7 13H3V9M13 3l-5 5M3 13l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                : <path d="M10 3h3v3M6 13H3v-3M13 3L8 8M3 13l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />}
            </svg>
          </button>
        )}
        <button
          type="button" className={css.close} aria-label={t('details.close')}
          onClick={() => { actions.closeFilePreview(); closeAll() }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body}>
        {filePreview !== null
          ? renderSlot('conversation.details.fileview', { path: filePreview }, {
            fallback: <div className={css.empty}>{t('details.empty')}</div>,
          })
          : activeCallId === undefined
            ? <div className={css.empty}>{t('details.empty')}</div>
            : material === null
              ? <div className={css.empty}>{t('details.notInWindow')}</div>
              : (
                <>
                  {material.argsRaw !== null && (
                    <section className={css.section}>
                      <div className={css.sectionLabel}>{t('details.input')}</div>
                      <CodeBlock code={pretty(material.argsRaw)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
                    </section>
                  )}
                  <section className={css.section}>
                    <div className={css.sectionLabel}>{t('details.output')}</div>
                    {/* Keyed by the selected call: the body owns per-call view
                      state (the terminal card's expand and copy), which React
                      would otherwise carry into the next selection because the
                      panel does not unmount between calls. */}
                    <Fragment key={activeCallId}>
                      {renderSlot('conversation.details.toolview', { block: material.block, cwd: sessionCwd }, {
                        entryKey: 'kind' in material.block
                          ? material.block.call?.name ?? ''
                          : material.block.name,
                        fallback: renderSlot('conversation.details.tool', { block: material.block, cwd: sessionCwd }, {
                          fallback: 'kind' in material.block
                            ? (
                              <pre className={css.code} data-error={material.block.isError || undefined}>
                                {rawResultText(material.block)}
                              </pre>
                            )
                            : <div className={css.empty}>{t('details.running')}</div>,
                        }),
                      })}
                    </Fragment>
                  </section>
                </>
              )}
      </div>
    </div>
  )
}
