import { memo } from 'react'
import { IconInspectOutline12, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, openFilePreview, forkAt, renderSlot, renderSlotChain, t, useSession,
  processControl,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useSession(snapshot =>
    snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key)
  const sessionId = useSession(snapshot => snapshot.sessionId)
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile, openFilePreview, sessionId }
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  // The process control lives in the turn's own footer, where the reader
  // arrives after reading it — one control per turn rather than a chevron on
  // every other row. It renders only when the turn can be toggled at all.
  const control = processControl === undefined ? null : (
    <Tooltip label={t(processControl.hidden ? 'chat.process.show' : 'chat.process.hide')}>
      <button
        type="button"
        className={clsx(css.processToggle, processControl.hidden && css.processToggleActive)}
        aria-pressed={processControl.hidden}
        aria-label={t(processControl.hidden ? 'chat.process.show' : 'chat.process.hide')}
        onClick={processControl.toggle}
      >
        <IconInspectOutline12 />
        <span>{t('chat.process.label')}</span>
      </button>
    </Tooltip>
  )
  if (closing === null) {
    if (tail === null && control === null) return null
    return (
      <div className={css.root}>
        {tail}
        {control}
      </div>
    )
  }
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  return (
    <div className={css.root} data-turn-tail={data.turn} data-time-hover-root>
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        runMs={runMs}
        ttftMs={data.ttftMs}
        tokensPerSecond={data.tokensPerSecond}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        branchUnavailable={data.branchUnavailable || hasLaterChatNode}
        className={css.actions}
        extraActions={control === null ? assistantActions : <>{control}{assistantActions}</>}
        t={t}
      />
    </div>
  )
})
