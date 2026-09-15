// @vitest-environment jsdom
/**
 * Chart bodies: every extracted workbook chart type draws its own value axis,
 * category labels, marks (columns, bars, lines, areas, wedges, rings, points),
 * and legend, and degrades quietly when a series or the whole chart carries no
 * samples.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WorkbookCharts } from '../src/client/WorkbookCharts.tsx'
import type { WorkbookChart } from '../src/client/WorkbookCharts.tsx'

afterEach(cleanup)

/** A lone chart renders large with no selector interaction. */
function renderChart(chart: WorkbookChart) {
  return render(<WorkbookCharts charts={[chart]} allLabel="All charts" />)
}

/** The value-axis tick labels, in draw order. */
function ticks(container: Element): (string | null)[] {
  return Array.from(container.querySelectorAll('svg g text')).map(node => node.textContent)
}

/** One `attribute` per matched mark, in document order. */
function attrs(container: Element, selector: string, attribute: string): (string | null)[] {
  return Array.from(container.querySelectorAll(selector)).map(node => node.getAttribute(attribute))
}

describe('WorkbookCharts value axis', () => {
  it('groups thousands and shortens millions so the ticks stay readable', () => {
    const { container } = renderChart({
      type: 'column',
      title: 'Revenue',
      sheet: 'Q2',
      series: [{ name: 'Total', categories: ['Q2'], values: [2_000_000] }],
    })
    expect(ticks(container)).toEqual(['0', '500,000', '1M', '1.5M', '2M'])
  })

  it('keeps fractional ticks legible when the axis maximum is one', () => {
    const { container } = renderChart({ type: 'column', title: 'Empty', sheet: 'Data', series: [] })
    expect(ticks(container)).toEqual(['0', '0.25', '0.5', '0.75', '1'])
  })
})

describe('WorkbookCharts column chart', () => {
  it('draws grouped columns, skips a missing sample, and names each series', () => {
    const { container } = renderChart({
      type: 'column',
      title: 'Sales',
      sheet: 'Data',
      series: [
        { name: 'North America', categories: ['Jan', 'Feb'], values: [11648, 15314] },
        { name: 'Quarterly revenue total across regions', categories: ['Jan'], values: [8819] },
      ],
    })
    // The second category repeats both series names, so the legend truncates.
    expect(screen.getByText('North America')).toBeTruthy()
    expect(screen.getByText('Quarterly revenue t…')).toBeTruthy()
    const heights = attrs(container, 'svg rect', 'height')
    expect(heights).toHaveLength(4)
    // South has no February sample: its column there collapses to nothing.
    expect(heights[3]).toBe('0')
    expect(Number(heights[0])).toBeGreaterThan(Number(heights[3] ?? '0'))
  })

  it('shortens a long category label under the axis', () => {
    renderChart({
      type: 'column',
      title: 'Long labels',
      series: [{ name: 'A', categories: ['January 2026 sales by region'], values: [1] }],
    })
    expect(screen.getByText('January 202…')).toBeTruthy()
  })

  it('numbers the categories a series leaves unlabelled', () => {
    renderChart({
      type: 'column',
      title: 'Unlabelled',
      series: [{ name: 'A', categories: [], values: [10, 20] }],
    })
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })
})

describe('WorkbookCharts bar chart', () => {
  it('draws horizontal bars proportional to their values and truncates their labels', () => {
    const { container } = renderChart({
      type: 'bar',
      title: 'Pipeline',
      sheet: 'Deals',
      series: [
        { name: 'North', categories: ['January 2026 sales by region', 'Feb'], values: [100, 50] },
        { name: 'South', categories: ['January 2026 sales by region'], values: [80] },
      ],
    })
    expect(screen.getByText('January 2026 sale…')).toBeTruthy()
    expect(screen.getByText('Feb')).toBeTruthy()
    // Bars run along the horizontal axis: half the value, half the length, and
    // a series without a sample for that category draws no bar at all.
    const widths = attrs(container, 'svg rect', 'width').map(Number)
    expect(widths[0]).toBeCloseTo(498, 6)
    expect(widths[1]).toBeCloseTo(398.4, 6)
    expect(widths[2]).toBeCloseTo(249, 6)
    expect(widths[3]).toBe(0)
    expect(attrs(container, 'svg rect', 'height')).toEqual(['24', '24', '24', '24'])
    expect(ticks(container)).toEqual(['0', '25', '50', '75', '100'])
  })
})

describe('WorkbookCharts line and area charts', () => {
  it('centres a lone sample and leaves a sample-less series undrawn', () => {
    const { container } = renderChart({
      type: 'line',
      title: 'Trend',
      sheet: 'Data',
      series: [
        { name: 'Solo', categories: ['Only'], values: [100] },
        { categories: [], values: [] },
        { name: 'Revenue across every region and channel', categories: ['Only'], values: [50] },
      ],
    })
    // A single sample has no span to spread across, so it sits mid-plot.
    expect(attrs(container, 'svg polyline', 'points')).toEqual(['341,14', '341,177'])
    // A line chart draws no fill under its series.
    expect(container.querySelectorAll('svg polygon')).toHaveLength(0)
    expect(screen.getByText('Revenue across ever…')).toBeTruthy()
    expect(screen.getByText('Series 2')).toBeTruthy()
  })

  it('marks every sample of a multi-point line', () => {
    const { container } = renderChart({
      type: 'line',
      title: 'Trend',
      series: [{ name: 'Total', categories: ['Jan', 'Feb', 'Mar'], values: [0, 50, 100] }],
    })
    expect(attrs(container, 'svg circle', 'cx')).toEqual(['56', '341', '626'])
    expect(attrs(container, 'svg circle', 'cy')).toEqual(['340', '177', '14'])
  })

  it('fills an area chart between the baseline and its samples', () => {
    const { container } = renderChart({
      type: 'area',
      title: 'Load',
      series: [{ name: 'Load', categories: ['a', 'b'], values: [100, 0] }],
    })
    expect(attrs(container, 'svg polygon', 'points')).toEqual(['56,340 56,14 626,340 626,340'])
  })

  it('fills a single-sample area into the middle of the plot', () => {
    const { container } = renderChart({
      type: 'area',
      title: 'One sample',
      series: [{ name: 'Load', categories: ['only'], values: [100] }],
    })
    expect(attrs(container, 'svg polygon', 'points')).toEqual(['56,340 341,14 341,340'])
  })
})

describe('WorkbookCharts pie and doughnut charts', () => {
  it('draws one wedge per slice and lists each share in the legend', () => {
    const { container } = renderChart({
      type: 'pie',
      title: 'Channel mix',
      series: [{ name: 'Share', categories: ['Direct sales channel'], values: [75, 25] }],
    })
    const wedges = attrs(container, 'svg path', 'd')
    expect(wedges).toHaveLength(2)
    // Every wedge is a sector struck from the centre; the 75% slice spans more
    // than half the circle, the 25% slice does not.
    expect(wedges[0]?.startsWith('M 320 177 L')).toBe(true)
    expect(wedges[0]).toContain('A 155 155 0 1 1')
    expect(wedges[1]).toContain('A 155 155 0 0 1')
    expect(screen.getByText('Direct sales chan… · 75%')).toBeTruthy()
    expect(screen.getByText('Series 2 · 25%')).toBeTruthy()
  })

  it('draws a doughnut as a ring with an inner cut instead of a solid wedge', () => {
    const { container } = renderChart({
      type: 'doughnut',
      title: 'Ring',
      series: [{ name: 'Share', categories: ['A', 'B'], values: [50, 50] }],
    })
    const rings = attrs(container, 'svg path', 'd')
    expect(rings).toHaveLength(2)
    // A ring starts on the outer radius, not at the centre, and closes back
    // along an inner one 58% of the way out.
    expect(rings[0]?.startsWith('M 320 22 A 155 155 0 0 1')).toBe(true)
    for (const ring of rings) {
      const clipped = /A ([\d.]+) ([\d.]+) 0 0 0/.exec(ring ?? '')
      expect(clipped).not.toBeNull()
      expect(Number(clipped?.[1])).toBeCloseTo(155 * 0.58, 6)
    }
  })

  it('renders zero-valued slices without dividing by zero', () => {
    const { container } = renderChart({
      type: 'pie',
      title: 'No revenue',
      series: [{ name: 'Share', categories: ['A'], values: [0, 0] }],
    })
    expect(container.querySelectorAll('svg path')).toHaveLength(2)
    expect(screen.getByText('A · 0%')).toBeTruthy()
    expect(screen.getByText('Series 2 · 0%')).toBeTruthy()
  })

  it('falls back to a generic heading and a numbered pill for an untitled chart', () => {
    const { container } = renderChart({ type: 'pie', series: [] })
    expect(screen.getByRole('img', { name: 'Chart' })).toBeTruthy()
    expect(screen.getByText('Chart 1')).toBeTruthy()
    expect(container.querySelectorAll('svg path')).toHaveLength(0)
  })
})

describe('WorkbookCharts scatter chart', () => {
  it('places points by their numeric x and centres a non-numeric one', () => {
    const { container } = renderChart({
      type: 'scatter',
      title: 'Correlation',
      series: [{ name: 'Points', categories: ['0', '100'], values: [10, 20, 30] }],
    })
    const points = attrs(container, 'svg circle', 'cx')
    expect(points).toHaveLength(3)
    expect(points[0]).toBe('56')
    expect(points[1]).toBe('626')
    // The third sample has no matching category label, so it lands mid-plot.
    expect(points[2]).toBe('341')
    expect(attrs(container, 'svg circle', 'cy')[2]).toBe('14')
  })
})
