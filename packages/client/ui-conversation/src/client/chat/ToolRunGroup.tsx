/**
 * One settled tool run, summarised in a single line.
 *
 * The transcript is the answer; the process that produced it is evidence. A
 * long turn's calls previously pushed the answer off-screen, so a run that
 * settled cleanly collapses to its count and duration and opens on request.
 * A run that is still working, or that failed, keeps its rows: the rows are
 * the point exactly when something is live or wrong.
 *
 * The count and duration come from the run's own reads (see tool-run.ts), not
 * from a second pass over the transcript, so the summary cannot drift from the
 * rows it replaces.
 */
import { IconThinkOutline14, IconChevronDownOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import { formatRunDuration } from './message-chrome.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ToolRun } from './tool-run.ts'
import css from './ToolRunGroup.module.css'

/** Props for one run's summary row. */
export interface ToolRunSummaryProps {
  /** The run being summarised. */
  readonly run: ToolRun
  /** Whether the run's rows are currently visible. */
  readonly rowsVisible: boolean
  /** Toggle the rows. */
  readonly onToggle: () => void
  /** The owning view's locale seat. */
  readonly t: ChatViewSlotProps['t']
}

/**
 * Render the summary row that stands in for a folded tool run.
 * @param props - see {@link ToolRunSummaryProps}.
 * @returns the summary button element.
 */
export function ToolRunSummary({ run, rowsVisible, onToggle, t }: ToolRunSummaryProps) {
  const count = run.calls
  // Both ends are present whenever this row renders (a running run never
  // folds), so the un-timed label is a guard rather than a normal state.
  const label = run.startTime === null || run.endTime === null
    ? t('chat.run.summaryUntimed', { count })
    : t('chat.run.summary', { count, duration: formatRunDuration(run.endTime - run.startTime, t) })
  return (
    <Tooltip label={t('chat.run.summaryHint', { count })}>
      <button
        type="button"
        className={css.summary}
        aria-expanded={rowsVisible}
        aria-label={t(rowsVisible ? 'chat.run.collapse' : 'chat.run.expand', { count })}
        onClick={onToggle}
      >
        <IconThinkOutline14 className={css.icon} />
        <span className={css.label}>{label}</span>
        <IconChevronDownOutline14
          className={clsx(css.chevron, rowsVisible && css.chevronOpen)}
          size={12}
        />
      </button>
    </Tooltip>
  )
}
