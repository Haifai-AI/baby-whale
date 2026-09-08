// @vitest-environment jsdom
/**
 * Data-tab long-cell behavior: a value longer than the capped column still
 * clips in the grid while its full text stays reachable through the cell's
 * `title` tooltip and the formula bar on selection.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExcelStudio } from '../src/client/DetailsArtifact.tsx'
import type { OfficePreviewData } from '../src/client/whale-preview.ts'

afterEach(cleanup)

const LONG_VALUE = 'a very long piece of writing that must not stretch its column far to the right'

function preview(): Extract<OfficePreviewData, { kind: 'xlsx' }> {
  return {
    kind: 'xlsx',
    file_name: 'notes.xlsx',
    truncated: false,
    sheets: [{
      name: 'Sheet1',
      header: ['Note'],
      rows: [[{ v: LONG_VALUE }]],
      total_rows: 1,
      total_cols: 1,
    }],
  }
}

describe('ExcelStudio long cells', () => {
  it('keeps the full text in the cell tooltip', () => {
    render(<ExcelStudio preview={preview()} />)
    expect(screen.getByTitle(LONG_VALUE).textContent).toBe(LONG_VALUE)
  })

  it('shows the full text in the formula bar on selection', () => {
    render(<ExcelStudio preview={preview()} />)
    // Before selection the value lives only in the grid cell; selecting it
    // mirrors the value into the formula bar beside the A1 reference.
    expect(screen.getAllByText(LONG_VALUE)).toHaveLength(1)
    fireEvent.click(screen.getByTitle(LONG_VALUE))
    expect(screen.getByText('A1')).toBeTruthy()
    expect(screen.getAllByText(LONG_VALUE)).toHaveLength(2)
  })
})
