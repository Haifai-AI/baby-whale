/**
 * Native chart cards for the workbook preview's Charts tab: the charts that
 * live inside the xlsx (`xl/charts/chartN.xml`) re-rendered as crisp themed
 * SVG — grouped columns, horizontal bars, lines, areas, pies, doughnuts and
 * scatters — mirroring the shapes the host's chart extractor emits.
 * @module @deepseek-ai/dsh-client-ui-whale-artifacts/src/client/WorkbookCharts
 */

import type { CSSProperties } from 'react'
import css from './ArtifactsView.module.css'

/** One cached series of a workbook chart. */
export interface WorkbookChartSeries {
  readonly name?: string
  readonly categories: readonly string[]
  readonly values: readonly number[]
}

/** One chart extracted from the workbook package. */
export interface WorkbookChart {
  readonly type: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter'
  readonly title?: string
  readonly sheet?: string
  readonly series: readonly WorkbookChartSeries[]
}

const PALETTE = ['#4e7fe8', '#43a878', '#e0a23c', '#9a68d5', '#d96a6a', '#3fa7bd', '#c971a8', '#83b546']
const W = 640
const H = 380
const MARGIN = { top: 14, right: 14, bottom: 40, left: 56 }
const PLOT_W = W - MARGIN.left - MARGIN.right
const PLOT_H = H - MARGIN.top - MARGIN.bottom

const AXIS_TEXT: CSSProperties = { fill: 'var(--dsw-alias-label-secondary)', fontSize: 11 }

/** Compact axis numbers (12.5K, 3.2M) without Intl — ICU builds differ. */
function compact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`
  if (abs >= 10_000) return `${Math.round((value / 1_000) * 10) / 10}K`
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '')
}

const truncate = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

/** Union of category labels across series (series may label slightly differently). */
function unionCategories(series: readonly WorkbookChartSeries[]): string[] {
  const best = series.find(candidate => candidate.categories.length > 0) ?? series[0]
  const count = best?.values.length ?? 0
  return Array.from({ length: count }, (_, index) => best?.categories[index] ?? String(index + 1))
}

/** Round an axis maximum up to a 1/2/2.5/5×10ᵏ multiple with 4 ticks. */
function niceMax(max: number): number {
  if (!(max > 0)) return 1
  const rough = max / 4
  const power = Math.pow(10, Math.floor(Math.log10(rough)))
  let step = power * 10
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (multiple * power >= rough) {
      step = multiple * power
      break
    }
  }
  return step * Math.ceil(max / step)
}

function ValueGrid({ max }: { max: number }) {
  return [0, 1, 2, 3, 4].map(index => {
    const y = MARGIN.top + PLOT_H - (PLOT_H * index) / 4
    return (
      <g key={index}>
        <line x1={MARGIN.left} x2={W - MARGIN.right} y1={y} y2={y} stroke="var(--dsw-alias-border-l2)" strokeWidth={1} />
        <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" style={AXIS_TEXT}>{compact((max / 4) * index)}</text>
      </g>
    )
  })
}

function CategoryLabels({ categories, horizontal }: { categories: readonly string[]; horizontal: boolean }) {
  if (horizontal) {
    const band = PLOT_H / Math.max(categories.length, 1)
    return categories.map((category, index) => (
      <text
        key={index}
        x={MARGIN.left - 8}
        y={MARGIN.top + band * index + band / 2 + 4}
        textAnchor="end"
        style={AXIS_TEXT}
      >
        {truncate(category, 16)}
      </text>
    ))
  }
  const band = PLOT_W / Math.max(categories.length, 1)
  return categories.map((category, index) => (
    <text
      key={index}
      x={MARGIN.left + band * index + band / 2}
      y={MARGIN.top + PLOT_H + 18}
      textAnchor="middle"
      style={AXIS_TEXT}
    >
      {truncate(category, 12)}
    </text>
  ))
}

function ColumnChart({ chart }: { chart: WorkbookChart }) {
  const { series } = chart
  const categories = unionCategories(series)
  const max = niceMax(Math.max(...series.flatMap(item => [...item.values]), 0))
  const band = PLOT_W / Math.max(categories.length, 1)
  const barWidth = Math.min((band * 0.72) / series.length, 34)
  return (
    <>
      <ValueGrid max={max} />
      {categories.map((_, index) => (
        series.map((candidate, seriesIndex) => {
          const value = candidate.values[index] ?? 0
          const height = Math.max((value / max) * PLOT_H, 0)
          const groupX = MARGIN.left + band * index + (band - barWidth * series.length) / 2
          return (
            <rect
              key={`${index}-${seriesIndex}`}
              x={groupX + seriesIndex * barWidth}
              y={MARGIN.top + PLOT_H - height}
              width={barWidth - 2}
              height={height}
              rx={2}
              fill={PALETTE[seriesIndex % PALETTE.length]}
            />
          )
        })
      ))}
      <CategoryLabels categories={categories} horizontal={false} />
    </>
  )
}

function BarChart({ chart }: { chart: WorkbookChart }) {
  const { series } = chart
  const categories = unionCategories(series)
  const max = niceMax(Math.max(...series.flatMap(item => [...item.values]), 0))
  // Horizontal bars read their category labels on the left: give the gutter
  // real room instead of truncating to the default axis margin.
  const left = 128
  const plotW = W - left - MARGIN.right
  const band = PLOT_H / Math.max(categories.length, 1)
  const barHeight = Math.min((band * 0.72) / series.length, 26)
  return (
    <>
      {[0, 1, 2, 3, 4].map(index => {
        const x = left + (plotW * index) / 4
        return (
          <g key={index}>
            <line x1={x} x2={x} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} stroke="var(--dsw-alias-border-l2)" strokeWidth={1} />
            <text x={x} y={MARGIN.top + PLOT_H + 16} textAnchor="middle" style={AXIS_TEXT}>{compact((max / 4) * index)}</text>
          </g>
        )
      })}
      {categories.map((_, index) => (
        series.map((candidate, seriesIndex) => {
          const value = candidate.values[index] ?? 0
          const width = Math.max((value / max) * plotW, 0)
          const groupY = MARGIN.top + band * index + (band - barHeight * series.length) / 2
          return (
            <rect
              key={`${index}-${seriesIndex}`}
              x={left + 1}
              y={groupY + seriesIndex * barHeight}
              width={width}
              height={Math.max(barHeight - 2, 0)}
              rx={2}
              fill={PALETTE[seriesIndex % PALETTE.length]}
            />
          )
        })
      ))}
      {categories.map((category, index) => {
        const bandY = PLOT_H / Math.max(categories.length, 1)
        return (
          <text
            key={index}
            x={left - 8}
            y={MARGIN.top + bandY * index + bandY / 2 + 4}
            textAnchor="end"
            style={AXIS_TEXT}
          >
            {truncate(category, 18)}
          </text>
        )
      })}
    </>
  )
}

function LineAreaChart({ chart, filled }: { chart: WorkbookChart; filled: boolean }) {
  const { series } = chart
  const max = niceMax(Math.max(...series.flatMap(item => [...item.values]), 0))
  const baseline = MARGIN.top + PLOT_H
  return (
    <>
      <ValueGrid max={max} />
      {series.map((candidate, seriesIndex) => {
        const count = candidate.values.length
        if (count === 0) return null
        const points = candidate.values.map((value, index) => {
          const x = MARGIN.left + (count === 1 ? PLOT_W / 2 : (PLOT_W * index) / (count - 1))
          const y = baseline - (value / max) * PLOT_H
          return `${x},${y}`
        })
        const color = PALETTE[seriesIndex % PALETTE.length]
        return (
          <g key={seriesIndex}>
            {filled && (
              <polygon
                points={`${MARGIN.left},${baseline} ${points.join(' ')} ${MARGIN.left + (count === 1 ? PLOT_W / 2 : PLOT_W)},${baseline}`}
                fill={color}
                opacity={0.16}
              />
            )}
            <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            {candidate.values.map((value, index) => {
              const x = MARGIN.left + (count === 1 ? PLOT_W / 2 : (PLOT_W * index) / (count - 1))
              const y = baseline - (value / max) * PLOT_H
              return <circle key={index} cx={x} cy={y} r={2.6} fill={color} />
            })}
          </g>
        )
      })}
      <CategoryLabels categories={unionCategories(series)} horizontal={false} />
    </>
  )
}

function ScatterChart({ chart }: { chart: WorkbookChart }) {
  const { series } = chart
  const maxY = niceMax(Math.max(...series.flatMap(item => [...item.values]), 0))
  const allX = series.flatMap(item => [...item.categories])
  const maxX = niceMax(Math.max(...allX.map(value => Number.parseFloat(value)).filter(Number.isFinite), 1))
  const baseline = MARGIN.top + PLOT_H
  const xOf = (raw: string): number => {
    const value = Number.parseFloat(raw)
    return Number.isFinite(value)
      ? MARGIN.left + (value / maxX) * PLOT_W
      : MARGIN.left + PLOT_W / 2
  }
  return (
    <>
      <ValueGrid max={maxY} />
      {series.map((candidate, seriesIndex) => (
        candidate.values.map((value, index) => (
          <circle
            key={`${seriesIndex}-${index}`}
            cx={xOf(candidate.categories[index] ?? '')}
            cy={baseline - (value / maxY) * PLOT_H}
            r={3.2}
            fill={PALETTE[seriesIndex % PALETTE.length]}
            opacity={0.85}
          />
        ))
      ))}
    </>
  )
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const close = rInner <= 0
  const largeArc = end - start > Math.PI ? 1 : 0
  const x = (radius: number, angle: number): number => cx + radius * Math.cos(angle)
  const y = (radius: number, angle: number): number => cy + radius * Math.sin(angle)
  if (close) {
    return [
      `M ${cx} ${cy}`,
      `L ${x(rOuter, start)} ${y(rOuter, start)}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x(rOuter, end)} ${y(rOuter, end)}`,
      'Z',
    ].join(' ')
  }
  return [
    `M ${x(rOuter, start)} ${y(rOuter, start)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x(rOuter, end)} ${y(rOuter, end)}`,
    `L ${x(rInner, end)} ${y(rInner, end)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x(rInner, start)} ${y(rInner, start)}`,
    'Z',
  ].join(' ')
}

function PieChart({ chart, doughnut }: { chart: WorkbookChart; doughnut: boolean }) {
  const first = chart.series[0]
  if (first === undefined) return null
  const total = first.values.reduce((sum, value) => sum + value, 0) || 1
  const cx = W / 2
  const cy = MARGIN.top + PLOT_H / 2
  const radius = Math.min(PLOT_W, PLOT_H) / 2 - 8
  const inner = doughnut ? radius * 0.58 : 0
  let cursor = -Math.PI / 2
  return first.values.map((value, index) => {
    const sweep = (value / total) * Math.PI * 2
    const path = arcPath(cx, cy, radius, inner, cursor, cursor + sweep)
    cursor += sweep
    return <path key={index} d={path} fill={PALETTE[index % PALETTE.length]} stroke="var(--dsw-alias-bg-layer-1)" strokeWidth={2} />
  })
}

/** Chart-specific legend items (series, or category shares for pies). */
function Legend({ chart }: { chart: WorkbookChart }) {
  if (chart.type === 'pie' || chart.type === 'doughnut') {
    const first = chart.series[0]
    if (first === undefined) return null
    const total = first.values.reduce((sum, value) => sum + value, 0) || 1
    return (
      <div className={css.chartLegend}>
        {first.values.map((value, index) => (
          <span key={index} className={css.legendItem}>
            <span className={css.legendSwatch} style={{ background: PALETTE[index % PALETTE.length] }} />
            {truncate(first.categories[index] ?? `Series ${index + 1}`, 18)} · {Math.round((value / total) * 100)}%
          </span>
        ))}
      </div>
    )
  }
  if (chart.series.length < 2) return null
  return (
    <div className={css.chartLegend}>
      {chart.series.map((candidate, index) => (
        <span key={index} className={css.legendItem}>
          <span className={css.legendSwatch} style={{ background: PALETTE[index % PALETTE.length] }} />
          {truncate(candidate.name ?? `Series ${index + 1}`, 20)}
        </span>
      ))}
    </div>
  )
}

function ChartBody({ chart }: { chart: WorkbookChart }) {
  switch (chart.type) {
    case 'column': return <ColumnChart chart={chart} />
    case 'bar': return <BarChart chart={chart} />
    case 'line': return <LineAreaChart chart={chart} filled={false} />
    case 'area': return <LineAreaChart chart={chart} filled />
    case 'pie': return <PieChart chart={chart} doughnut={false} />
    case 'doughnut': return <PieChart chart={chart} doughnut />
    case 'scatter': return <ScatterChart chart={chart} />
  }
}

function ChartCard({ chart }: { chart: WorkbookChart }) {
  return (
    <div className={css.chartCard}>
      <div className={css.chartHead}>
        <span className={css.chartTitle}>{chart.title ?? 'Chart'}</span>
        {chart.sheet !== undefined && <span className={css.chartSheet}>{chart.sheet}</span>}
      </div>
      <Legend chart={chart} />
      <svg viewBox={`0 0 ${W} ${H}`} className={css.chartSvg} role="img" aria-label={chart.title ?? 'Chart'}>
        <ChartBody chart={chart} />
      </svg>
    </div>
  )
}

/** The Charts tab body: one themed SVG card per embedded chart. */
export function WorkbookCharts({ charts }: { charts: readonly WorkbookChart[] }) {
  return (
    <div className={css.chartsWrap}>
      {charts.map((chart, index) => <ChartCard key={index} chart={chart} />)}
    </div>
  )
}
