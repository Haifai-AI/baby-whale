/**
 * Tool-run grouping for the Chat transcript.
 *
 * A turn renders as alternating `assistant-step` and `tool-call` Nodes, so a
 * run bounded by tool calls alone would never exceed the handful of calls one
 * step issues. A run is therefore the maximal contiguous slice of the flow
 * order whose Nodes are all *process*: tool calls, and assistant steps that
 * carry no prose.
 *
 * That is the boundary that matters. A step carrying prose is the answer, and
 * the answer is what the fold exists to protect — a run stops at it. A step
 * carrying only reasoning is work, and the work recedes with the calls around
 * it. Everything else in the transcript (a user message, a command, a
 * compaction marker, the turn tail) ends the run because it is content.
 *
 * The group carries only what the summary row prints. Per-call state stays in
 * each row's own model; this fold answers "how much work, and did any of it
 * fail", and nothing else.
 */
import type { ChatNodeStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

/** Minimum tool calls before a settled run is worth folding. */
export const MIN_FOLDABLE_RUN = 3

/** Mutable accumulator shared by the per-Node folds below. */
interface RunFacts {
  /** The run contains a call that has not settled, or a streaming step. */
  running: boolean
  /** A settled call failed or was interrupted. */
  failed: boolean
  /** Tool calls only; assistant steps are not calls. */
  calls: number
  startTime: number | null
  endTime: number | null
  /** Any Node in the run is unsettled, so the run has no end time yet. */
  open: boolean
}

/**
 * One contiguous slice of work in flow order.
 *
 * `running` and `failed` are the run's own facts, not decoration: `running`
 * keeps the rows visible while the agent works, and `failed` is why a settled
 * run refuses to fold. Both are read from the same Node data the row models
 * use, so the summary cannot disagree with the rows beneath it.
 */
export interface ToolRun {
  /** Stable run identity: the first Node key in the run. */
  readonly key: string
  /** Every Node the run covers, in flow order. */
  readonly keys: readonly string[]
  /** Tool calls in the run (the summary's count). */
  readonly calls: number
  readonly running: boolean
  readonly failed: boolean
  /** Earliest Node time in the run, or null when none carried one. */
  readonly startTime: number | null
  /** Latest settlement time, or null while any covered Node is unsettled. */
  readonly endTime: number | null
}

/** A flow entry: either a standalone Node key or a run of process Nodes. */
export type ChatFlowEntry =
  | { readonly kind: 'node'; readonly key: string }
  | { readonly kind: 'run'; readonly key: string; readonly run: ToolRun }

/**
 * Whether a step's blocks are work rather than content.
 *
 * Reasoning is work and tool-call blocks restate the call Nodes beside them,
 * so a step made only of those is process. Anything else — prose, an image, an
 * unrecognized block — is content, and content is never folded away.
 * @param node - the assistant step Node.
 * @returns true when the step carries nothing a reader must see.
 */
function stepIsProcess(node: ChatNode<'assistant-step'>): boolean {
  return node.data.blocks.every((block) => {
    if (block.kind === 'tool-call' || block.kind === 'reasoning') return true
    return block.kind === 'text' && block.text.trim() === ''
  })
}

/**
 * Fold one Node into the run, or decline it.
 * @param node - the Node at a run position.
 * @param facts - accumulator to extend in place.
 * @returns true when the Node belongs to the run.
 */
function foldNode(node: ChatNode, facts: RunFacts): boolean {
  if (node.kind === 'tool-call') {
    const block = node.data.root
    // Counted before the settled check: an in-flight call is still a call, and
    // a run that forgot it would report "0 tool calls" for the whole live turn.
    facts.calls += 1
    // `kind` is the settled discriminant: RunningToolCall carries no `kind`.
    if (!('kind' in block)) {
      facts.running = true
      facts.open = true
      facts.startTime = facts.startTime === null ? block.time : Math.min(facts.startTime, block.time)
      return true
    }
    if (block.isError || block.error?.code === 'interrupted') facts.failed = true
    const start = block.callTime ?? block.time
    facts.startTime = facts.startTime === null ? start : Math.min(facts.startTime, start)
    facts.endTime = facts.endTime === null ? block.time : Math.max(facts.endTime, block.time)
    return true
  }
  if (node.kind !== 'assistant-step') return false
  if (!stepIsProcess(node)) return false
  const step = node.data
  facts.startTime = facts.startTime === null ? step.time : Math.min(facts.startTime, step.time)
  if (step.status === 'running') {
    facts.running = true
    facts.open = true
    return true
  }
  facts.endTime = facts.endTime === null ? step.time : Math.max(facts.endTime, step.time)
  return true
}

/**
 * Group the flow order into runs of work and standalone Nodes.
 *
 * Reads each Node's kind and, for process Nodes, its data. Callers memoize
 * this on the flow order and the Node index; a streaming update mutates Node
 * data without moving the order, so the fold is not recomputed per token.
 * @param order - current flow order (Node keys).
 * @param nodes - the runtime's live per-key Node reader for the window.
 * @returns one entry per rendered flow child, in order.
 */
export function groupToolRuns(order: readonly string[], nodes: ChatNodeStore): ChatFlowEntry[] {
  const entries: ChatFlowEntry[] = []
  let runKey: string | null = null
  let keys: string[] = []
  let facts: RunFacts = { running: false, failed: false, calls: 0, startTime: null, endTime: null, open: false }

  const flush = (): void => {
    // A run with no calls is pure reasoning with no work to summarise; it
    // renders as its own Nodes rather than under a "0 tool calls" header.
    if (runKey !== null && facts.calls > 0) {
      entries.push({
        kind: 'run',
        key: runKey,
        // An unsettled run has no end: settled Nodes earlier in the run carry
        // their own times, and reporting the latest of those would print a
        // duration for work still in flight.
        run: {
          key: runKey,
          keys,
          calls: facts.calls,
          running: facts.running,
          failed: facts.failed,
          startTime: facts.startTime,
          endTime: facts.open ? null : facts.endTime,
        },
      })
    } else {
      for (const key of keys) entries.push({ kind: 'node', key })
    }
    runKey = null
    keys = []
    facts = { running: false, failed: false, calls: 0, startTime: null, endTime: null, open: false }
  }

  for (const key of order) {
    const node = nodes.get(key) as ChatNode | undefined
    // A Node absent from the index renders nothing (its seat falls back to
    // null), so it ends the run rather than joining it silently.
    if (node === undefined || !foldNode(node, facts)) {
      flush()
      entries.push({ kind: 'node', key })
      continue
    }
    runKey ??= key
    keys.push(key)
  }
  flush()
  return entries
}

/**
 * Whether a run's rows are replaced by its summary at rest.
 *
 * A run folds only when it is settled, clean, and long enough to be worth the
 * click. A failed run keeps its log open: the moment a run is worth reading is
 * the moment something in it went wrong, and a collapsed failure is a failure
 * the user has to go looking for.
 * @param run - the run to test.
 * @returns true when the summary replaces the rows by default.
 */
export function foldsByDefault(run: ToolRun): boolean {
  return !run.running && !run.failed && run.calls >= MIN_FOLDABLE_RUN
}

/**
 * Rows replaced by the summary, and rows a reader asked to see.
 *
 * `expanded` holds run keys the reader has explicitly OPENED. A run that does
 * not fold by default (running, failed, or short) offers no collapse, so the
 * set never needs a "closed" half — and an expanded run that later settles
 * stays open, because the reader's gesture outranks the default rather than
 * being re-evaluated against it.
 * @param run - the run to test.
 * @param expanded - run keys the reader has opened.
 * @returns true when the rows render instead of the summary.
 */
export function rowsVisible(run: ToolRun, expanded: ReadonlySet<string>): boolean {
  return expanded.has(run.key) || !foldsByDefault(run)
}
