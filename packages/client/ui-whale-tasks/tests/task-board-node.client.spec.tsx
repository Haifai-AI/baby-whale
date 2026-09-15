// @vitest-environment jsdom
/**
 * TaskBoardNode presentation: the compact scheduled-task card renders the
 * workspace snapshot as one row per task (name, schedule summary, localized
 * status, next-run line, missed marker) and fires the local completion
 * notification only for a fresh delivery while the tab is hidden.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { TaskBoardNode } from '../src/client/TaskBoardNode.tsx'
import { zh, type WhaleTaskKey } from '../src/client/locales.ts'
import type { WhaleTaskView } from '../src/client/task-board.ts'

afterEach(cleanup)
afterEach(() => {
  vi.unstubAllGlobals()
  // `hidden` is installed as an own property per spec; dropping it restores
  // the jsdom prototype getter (a visible tab).
  Reflect.deleteProperty(document, 'hidden')
})

/** Minimal interpolating translator over the real zh dictionary. */
const t = (key: WhaleTaskKey, params?: Record<string, unknown>): string => {
  const template: string = zh[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

/** One task row as the host sends it; only the rendered fields vary per spec. */
const task = (overrides: Partial<WhaleTaskView> = {}): WhaleTaskView => ({
  id: 't-1',
  name: 'nightly report',
  status: 'active',
  scheduleKind: 'cron',
  scheduleSummary: '每天 09:00',
  tz: 'Asia/Shanghai',
  nextRunAt: null,
  lastRunAt: null,
  workspaceCwd: '/work/repo',
  ...overrides,
})

/** The only props the component reads: the node payload and the `t` seat. */
const boardProps = (tasks: readonly WhaleTaskView[]): ComponentProps<typeof TaskBoardNode> =>
  ({ node: { data: { tasks } }, t } as unknown as ComponentProps<typeof TaskBoardNode>)

/** A log instant relative to now, so the 90s grace window decides the outcome. */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number): string => new Date(Date.now() + ms).toISOString()

/** jsdom reports the tab as visible; pin the flag the notification path gates on. */
function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

interface SentNotification { title: string; body: string | undefined }

/**
 * Install a Notification double (jsdom ships none) and record what it delivers.
 * @param granted - the permission the double reports.
 * @returns the deliveries observed by the double.
 */
function installNotification(granted: NotificationPermission = 'granted'): SentNotification[] {
  const sent: SentNotification[] = []
  class FakeNotification {
    static readonly permission = granted
    constructor(title: string, options?: NotificationOptions) {
      sent.push({ title, body: options?.body })
    }
  }
  vi.stubGlobal('Notification', FakeNotification)
  return sent
}

describe('TaskBoardNode task list', () => {
  it('shows the empty-board copy and no rows when the snapshot carries no tasks', () => {
    render(<TaskBoardNode {...boardProps([])} />)
    expect(screen.getByText(t('board.title'))).toBeTruthy()
    expect(screen.getByText(t('board.empty'))).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders one row per task with its name, schedule summary, and localized status', () => {
    render(<TaskBoardNode {...boardProps([
      task({ id: 't-1', name: 'nightly report', status: 'active', scheduleSummary: '每天 09:00' }),
      task({ id: 't-2', name: 'backup', status: 'paused', scheduleSummary: '每周日 02:00' }),
      task({ id: 't-3', name: 'cleanup', status: 'done', scheduleSummary: '仅一次' }),
    ])} />)
    expect(screen.getByText(t('board.title'))).toBeTruthy()
    expect(screen.queryByText(t('board.empty'))).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('nightly report')).toBeTruthy()
    expect(screen.getByText(`每天 09:00 · ${t('status.active')}`)).toBeTruthy()
    expect(screen.getByText('backup')).toBeTruthy()
    expect(screen.getByText(`每周日 02:00 · ${t('status.paused')}`)).toBeTruthy()
    expect(screen.getByText('cleanup')).toBeTruthy()
    expect(screen.getByText(`仅一次 · ${t('status.done')}`)).toBeTruthy()
  })
})

describe('TaskBoardNode next-run line', () => {
  it('shows the localized instant for a valid future run', () => {
    const nextRunAt = ahead(3_600_000)
    render(<TaskBoardNode {...boardProps([task({ nextRunAt })])} />)
    expect(screen.getByText(t('board.runAt', { time: new Date(nextRunAt).toLocaleString() }))).toBeTruthy()
    expect(screen.queryByText(t('board.missed'))).toBeNull()
  })

  it('shows the dash when the run instant is absent or unreadable', () => {
    render(<TaskBoardNode {...boardProps([
      task({ id: 't-1', nextRunAt: null }),
      task({ id: 't-2', nextRunAt: 'not-a-date' }),
    ])} />)
    expect(screen.getAllByText(t('board.runAt', { time: t('board.none') }))).toHaveLength(2)
  })
})

describe('TaskBoardNode overdue marker', () => {
  it('reports an active task that passed its run instant by more than the grace window as missed', () => {
    const { container } = render(<TaskBoardNode {...boardProps([task({ nextRunAt: ago(120_000) })])} />)
    expect(screen.getByText(t('board.missed'))).toBeTruthy()
    expect(screen.getByText(t('board.runAt', { time: t('board.overdue') }))).toBeTruthy()
    expect(container.querySelector('[data-overdue]')?.getAttribute('data-overdue')).toBe('true')
  })

  it('leaves a stale instant unmarked for a non-active task, and inside the grace window', () => {
    const withinGrace = ago(30_000)
    const { container } = render(<TaskBoardNode {...boardProps([
      task({ id: 't-1', name: 'paused', status: 'paused', nextRunAt: ago(120_000) }),
      task({ id: 't-2', name: 'done', status: 'done', nextRunAt: ago(120_000) }),
      task({ id: 't-3', name: 'grace', status: 'active', nextRunAt: withinGrace }),
      task({ id: 't-4', name: 'absent', status: 'active', nextRunAt: null }),
      task({ id: 't-5', name: 'unreadable', status: 'active', nextRunAt: 'not-a-date' }),
    ])} />)
    expect(screen.queryByText(t('board.missed'))).toBeNull()
    expect(container.querySelectorAll('[data-overdue]')).toHaveLength(0)
    // The in-grace row still reads as a normal localized instant.
    expect(screen.getByText(t('board.runAt', { time: new Date(withinGrace).toLocaleString() }))).toBeTruthy()
  })
})

describe('TaskBoardNode completion notification', () => {
  it('notifies once for a fresh delivery while the tab is hidden', () => {
    const sent = installNotification()
    setDocumentHidden(true)
    render(<TaskBoardNode {...boardProps([
      task({ name: 'nightly report', scheduleSummary: '每天 09:00', lastRunAt: ago(30_000) }),
    ])} />)
    expect(sent).toEqual([{ title: 'Whale', body: 'nightly report — 每天 09:00' }])
  })

  it('notifies for only the first fresh delivery in one snapshot', () => {
    const sent = installNotification()
    setDocumentHidden(true)
    render(<TaskBoardNode {...boardProps([
      task({ id: 't-1', name: 'first', scheduleSummary: '每小时', lastRunAt: ago(10_000) }),
      task({ id: 't-2', name: 'second', scheduleSummary: '每小时', lastRunAt: ago(20_000) }),
    ])} />)
    expect(sent).toEqual([{ title: 'Whale', body: 'first — 每小时' }])
  })

  it('stays silent for a stale delivery, a task that never ran, and an unreadable instant', () => {
    const sent = installNotification()
    setDocumentHidden(true)
    render(<TaskBoardNode {...boardProps([
      task({ id: 't-1', name: 'stale', lastRunAt: ago(120_000) }),
      task({ id: 't-2', name: 'never', lastRunAt: null }),
      task({ id: 't-3', name: 'unreadable', lastRunAt: 'not-a-date' }),
    ])} />)
    expect(sent).toHaveLength(0)
  })

  it('stays silent while the tab is visible', () => {
    const sent = installNotification()
    setDocumentHidden(false)
    render(<TaskBoardNode {...boardProps([task({ lastRunAt: ago(10_000) })])} />)
    expect(sent).toHaveLength(0)
  })

  it('stays silent without a granted permission', () => {
    const sent = installNotification('default')
    setDocumentHidden(true)
    render(<TaskBoardNode {...boardProps([task({ lastRunAt: ago(10_000) })])} />)
    expect(sent).toHaveLength(0)
  })

  it('renders without a Notification implementation at all', () => {
    vi.stubGlobal('Notification', undefined)
    setDocumentHidden(true)
    const view = render(<TaskBoardNode {...boardProps([task({ lastRunAt: ago(10_000) })])} />)
    expect(view.getByText(t('board.title'))).toBeTruthy()
  })
})
