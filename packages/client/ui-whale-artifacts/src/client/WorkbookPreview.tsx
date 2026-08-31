/**
 * The workbook preview card: Claude-style tabs over one xlsx payload —
 * `Data` (the native grid studio), `Charts (n)` (the workbook's embedded
 * charts re-rendered as themed SVG), and `Original` (LibreOffice's
 * single-page-per-sheet render of the real file). Each tab degrades away
 * independently when its source is unavailable.
 * @module @deepseek-ai/dsh-client-ui-whale-artifacts/src/client/WorkbookPreview
 */

import { useState } from 'react'
import { ArtifactStudioBody, type OfficePreviewData } from '@deepseek-ai/dsh-client-ui-whale-artifact/client'
import type { WhaleArtifactsKey } from './locales.ts'
import { WorkbookCharts, type WorkbookChart } from './WorkbookCharts.tsx'
import css from './ArtifactsView.module.css'

/** The workbook preview payload served by `artifacts.preview`. */
export interface WorkbookPreviewData {
  readonly kind: 'xlsx'
  readonly file_name: string
  readonly truncated?: boolean
  readonly pdfPath?: string
  readonly charts?: readonly WorkbookChart[]
  // The sheet grid mirrors ui-whale-artifact's xlsx OfficePreviewData; the
  // studio re-owns the narrowing at its boundary.
  readonly sheets: unknown
}

type Tab = 'data' | 'charts' | 'original'

/** Small stroked tab icons, sized to the 16px tab row. */
function TabIcon({ kind }: { kind: Tab }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  if (kind === 'data') {
    return (
      <svg {...common} stroke="currentColor" strokeWidth={1.4}>
        <ellipse cx="8" cy="3.6" rx="5.4" ry="2.2" />
        <path d="M2.6 3.6v8.8c0 1.2 2.4 2.2 5.4 2.2s5.4-1 5.4-2.2V3.6" />
        <path d="M2.6 8c0 1.2 2.4 2.2 5.4 2.2s5.4-1 5.4-2.2" />
      </svg>
    )
  }
  if (kind === 'charts') {
    return (
      <svg {...common} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
        <path d="M3 13.5V9" />
        <path d="M8 13.5v-11" />
        <path d="M13 13.5V6" />
      </svg>
    )
  }
  return (
    <svg {...common} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <path d="M4 1.8h5.2L13 5.6v8.6H4z" />
      <path d="M9.2 1.8v3.8H13" />
    </svg>
  )
}

/**
 * The tabbed workbook lens. Remounted (keyed) per selected file so the tab
 * resets to Data.
 */
export function WorkbookPreview({ data, t }: {
  data: WorkbookPreviewData
  t: (key: WhaleArtifactsKey) => string
}) {
  const [tab, setTab] = useState<Tab>('data')
  const chartCount = data.charts?.length ?? 0
  const hasOriginal = typeof data.pdfPath === 'string' && data.pdfPath.length > 0
  const tabButton = (kind: Tab, label: string, badge?: number): JSX.Element => (
    <button
      type="button"
      className={`${css.wbTab} ${tab === kind ? css.wbTabActive : ''}`}
      onClick={() => { setTab(kind) }}
    >
      <TabIcon kind={kind} />
      {label}
      {badge !== undefined && <span className={css.wbBadge}>{badge}</span>}
    </button>
  )
  return (
    <div className={css.workbook} data-whale-workbook="">
      <div className={css.wbTabs}>
        {tabButton('data', t('tab.data'))}
        {chartCount > 0 && tabButton('charts', t('tab.charts'), chartCount)}
        {hasOriginal && tabButton('original', t('tab.original'))}
      </div>
      <div className={css.wbBody}>
        {tab === 'data' && <ArtifactStudioBody preview={data as unknown as OfficePreviewData} />}
        {tab === 'charts' && <WorkbookCharts charts={data.charts ?? []} allLabel={t('charts.all')} />}
        {tab === 'original' && hasOriginal && (
          <iframe
            title={data.file_name}
            src={`/api/artifacts.file?path=${encodeURIComponent(data.pdfPath ?? '')}`}
            className={css.pdfFrame}
          />
        )}
      </div>
    </div>
  )
}
