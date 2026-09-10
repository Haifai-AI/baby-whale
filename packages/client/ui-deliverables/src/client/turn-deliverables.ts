/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: the vocabulary comes from successful first-party mutation
 * calls, never presentation data or the closing prose.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'
import { basename, isPresentedData, isPresentedFile } from '../presented.ts'

/** A declared file with its authorized open coordinates. */
export interface PresentedPath extends PresentedFile {
  readonly seq: number
  readonly index: number
}

export interface ProducedPath {
  readonly seq: number
  readonly path: string
  /** Producing tool ('write' | 'edit' | 'deliver' | …). */
  readonly tool: string
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
  readonly presented?: readonly PresentedPath[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, CallRecord>
}

/** What one tool call contributes: its durable identity, read back on settle. */
interface CallRecord {
  readonly tool: string
  /** Parsed raw arguments; undefined when absent or unparseable. */
  readonly args: unknown
}

/**
 * Produced paths straight from durable call arguments. Extraction is
 * intentionally conservative (unregistered tool, malformed arguments) —
 * without a produced-paths fallback one viewless rebuild silently drops an
 * old turn's entire tail, leaving only the closing prose behind. Only the
 * fence's own mutation names qualify.
 */
function argsPaths(tool: string, args: unknown): readonly string[] {
  if (typeof args !== 'object' || args === null) return []
  const record = args as Record<string, unknown>
  if (tool === 'deliver') {
    const paths = record.paths
    if (!Array.isArray(paths)) return []
    return paths.filter((entry): entry is string => typeof entry === 'string')
  }
  if (tool === 'write' || tool === 'edit') {
    return typeof record.file_path === 'string' ? [record.file_path] : []
  }
  return []
}

/** Best-effort JSON parse of stored tool-call arguments. */
function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the arguments of successful `write`, `edit`, and mutating
 * `str_replace_editor` calls, not the closing prose: a produced file must be
 * listed whether or not the model remembered to name it. Reads, unsupported
 * tools, malformed calls, and failed results contribute nothing. Paths keep
 * first-seen order and appear once, so a file written and then edited in the
 * same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly ProducedPath[] {
  if (data === undefined) return []
  const entries: ProducedPath[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    entries.push(produced)
  }
  return entries
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly ProducedPath[] | null {
  const data = owner.turn.data.get('deliverables')
  if (data === undefined) return null
  // One chain entry owns the whole tail: the component splits delivered
  // claims (cards) from written working files (chips) at render time.
  const entries = producedForClosing(data, owner.seq)
  return entries.length === 0 ? null : entries
}

/** Partition tail entries: delivered claims first, written files second. */
export function partitionProduced(entries: readonly ProducedPath[]): {
  readonly delivered: readonly string[]
  readonly written: readonly string[]
} {
  const delivered: string[] = []
  const written: string[] = []
  const seenD = new Set<string>()
  const seenW = new Set<string>()
  for (const entry of entries) {
    if (entry.tool === 'deliver') {
      if (!seenD.has(entry.path)) { seenD.add(entry.path); delivered.push(entry.path) }
    } else if (!seenW.has(entry.path)) {
      seenW.add(entry.path); written.push(entry.path)
    }
  }
  return { delivered, written }
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'deliverables/presented') return isPresentedData(event.data) ? { id: String(event.data.turn), role: 'update' } : null
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'deliverables/presented') {
      const { files } = match.event.data
      const seq = match.event.seq
      const presented: PresentedPath[] = []
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        if (isPresentedFile(file)) presented.push({ ...file, seq, index })
      }
      if (presented.length === 0) return context.state
      return { ...context.state, presented: [...context.state.presented ?? [], ...presented] }
    }
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      const data = match.event.data as { callId?: unknown; name?: unknown; arguments?: unknown }
      calls.set(
        String(data.callId),
        {
          tool: typeof data.name === 'string' ? data.name : '',
          args: parseArgs(data.arguments),
        },
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const call = context.state.calls.get(callId) ?? null
    if (call === null) return context.state
    const paths = argsPaths(call.tool, call.args)
    const additions = paths
      .map(path => ({ seq: match.event.seq, path, tool: call.tool }))
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'deliverables'
      && previous.value.produced === context.state.produced
      && previous.value.presented === context.state.presented) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced, ...context.state.presented === undefined ? {} : { presented: context.state.presented } },
    }
  },
}

/**
 * Select the latest declaration of each path before the closing reply.
 * @param owner - closing turn and sequence.
 * @returns replayable deliveries in first-seen path order.
 */
export function presentedForClosing(owner: TurnTailOwnerProps): PresentedPath[] {
  const files = new Map<string, PresentedPath>()
  for (const file of owner.turn.data.get('deliverables')?.presented ?? []) {
    if (file.seq < owner.seq) files.set(file.path, file)
  }
  return [...files.values()]
}

export { basename } from '../presented.ts'

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than
 * guessing, so a mention link can never open the wrong file or 404.
 * @param paths - The turn's produced paths (tool order, already deduped).
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/** The single produced path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Files claimed through the deliver tool in this Turn — the user-facing
 * deliverables (distinct from every written file above).
 */
export function deliveredFiles(data: DeliverablesTurnData): readonly ProducedPath[] {
  return data.produced.filter(entry => entry.tool === 'deliver')
}

/** Written files EXCLUDING deliver claims (the working-files chips row). */
export function writtenFiles(data: DeliverablesTurnData): readonly ProducedPath[] {
  return data.produced.filter(entry => entry.tool !== 'deliver')
}
