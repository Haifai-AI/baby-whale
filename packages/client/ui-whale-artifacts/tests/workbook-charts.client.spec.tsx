// @vitest-environment jsdom
/**
 * Charts-tab selector behavior: one pill per chart plus the all-charts wall,
 * selection swaps the large card.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkbookCharts } from '../src/client/WorkbookCharts.tsx'
import type { WorkbookChart } from '../src/client/WorkbookCharts.tsx'

const charts: WorkbookChart[] = [
  { type: 'column', title: 'Monthly Sales by Region', sheet: 'Sales Data', series: [
    { name: 'North', categories: ['Jan', 'Feb'], values: [11648, 15314] },
    { name: 'South', categories: ['Jan', 'Feb'], values: [8819, 12572] },
  ] },
  { type: 'line', title: 'Total Sales Trend', sheet: 'Sales Data', series: [
    { name: 'Total', categories: ['Jan', 'Feb'], values: [20467, 27886] },
  ] },
]

afterEach(cleanup)

describe('WorkbookCharts', () => {
  it('renders a selector pill per chart plus the all-charts pill', () => {
    render(<WorkbookCharts charts={charts} allLabel="All charts" />)
    expect(screen.getAllByText('Monthly Sales by Region').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Total Sales Trend').length).toBeGreaterThan(0)
    expect(screen.getByText('All charts')).toBeTruthy()
  })

  // CSS-module class names are hashed — match by substring.
  const cards = (container: Element | null | undefined): number =>
    container?.querySelectorAll('[class*="chartCard"]').length ?? 0
  const target_trend = (value: Element | undefined): value is HTMLElement =>
    value instanceof HTMLElement

  it('shows the first chart large by default and swaps on selection', () => {
    const { container } = render(<WorkbookCharts charts={charts} allLabel="All charts" />)
    expect(cards(container)).toBe(1)
    const trend = screen.getAllByText('Total Sales Trend').at(0)
    if (target_trend(trend)) fireEvent.click(trend)
    expect(cards(container)).toBe(1)
    // wall of all charts
    fireEvent.click(screen.getByText('All charts'))
    expect(cards(container)).toBe(2)
  })

  it('renders nothing for a chartless workbook', () => {
    const { container } = render(<WorkbookCharts charts={[]} allLabel="All charts" />)
    expect(container.querySelector('[class*="chartTabs"]')).toBeNull()
  })
})
