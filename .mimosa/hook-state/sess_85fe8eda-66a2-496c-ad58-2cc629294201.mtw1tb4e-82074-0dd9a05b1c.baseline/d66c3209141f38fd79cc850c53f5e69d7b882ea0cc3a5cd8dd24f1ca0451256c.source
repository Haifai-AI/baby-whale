// @vitest-environment jsdom
/**
 * Gallery date formatting: valid timestamps render localized, unparseable
 * values fall back instead of printing "Invalid Date".
 */

import { describe, expect, it } from 'vitest'
import { formatModifiedAt } from '../src/client/ArtifactsView.tsx'

describe('formatModifiedAt', () => {
  it('renders a valid epoch-millis timestamp localized', () => {
    const rendered = formatModifiedAt(Date.parse('2026-09-03T10:00:00.000Z'), 'time unknown')
    expect(rendered).not.toBe('time unknown')
    expect(rendered.length).toBeGreaterThan(0)
  })

  it('falls back on an unparseable value', () => {
    expect(formatModifiedAt(Number.NaN, 'time unknown')).toBe('time unknown')
  })
})
