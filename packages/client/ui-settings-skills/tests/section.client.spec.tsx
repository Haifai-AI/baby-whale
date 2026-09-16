// @vitest-environment jsdom
/**
 * What the skills section shows: the catalog grouped by discovery source with
 * one switch per skill, the states where there is no list to draw, and the
 * toggle each row hands back to the controller.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SkillsSettingsSection } from '../src/client/SkillsSettingsSection.tsx'
import type {
  SkillRow, SkillsSettingsSectionProps, SkillsSettingsView, ToggleSkill,
} from '../src/client/SkillsSettingsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en)

/** One catalog row, enabled and model-invocable unless the case says otherwise. */
function skill(name: string, rest: Partial<SkillRow> = {}): SkillRow {
  return { name, description: `${name} does things`, modelInvocable: true, userDisabled: false, ...rest }
}

/**
 * Render the section over one controller view.
 * @param view - the status and rows the controller projected.
 * @param toggle - the flip action the renderer binds from the controller face.
 */
function renderSection(view: SkillsSettingsView, toggle: ToggleSkill = vi.fn()) {
  const viewStore = createSnapshotStore<SkillsSettingsView & { saving: boolean }>({ ...view, saving: false })
  const toggleStore = createSnapshotStore<ToggleSkill>(toggle)
  const props = {
    t,
    close: vi.fn(),
    useView: bindSnapshotSelector(viewStore),
    useToggle: bindSnapshotSelector(toggleStore),
  } as unknown as SkillsSettingsSectionProps
  render(<SkillsSettingsSection {...props} />)
  return { toggle }
}

/**
 * One skill's list row. The switch carries the state word as its accessible
 * name (it draws its own label), so the row is the scope that tells two
 * skills apart.
 * @param name - the skill whose row to find.
 * @returns the row element.
 */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name, { exact: true }).closest('li')!
}

/** The switch inside one skill's row. */
function switchFor(name: string): HTMLInputElement {
  return within(rowOf(name)).getByRole('checkbox') as HTMLInputElement
}

describe('SkillsSettingsSection states', () => {
  it('points at the workspace session when no scope is open', () => {
    renderSection({ status: 'unavailable', rows: [] })

    expect(screen.getByText(en['scope.unavailable'])).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reports that it is still reading the catalog', () => {
    renderSection({ status: 'loading', rows: [] })

    expect(screen.getByText(en['scope.loading'])).toBeTruthy()
  })

  it('says so when the catalog came back empty', () => {
    renderSection({ status: 'ready', rows: [] })

    expect(screen.getByText(en['scope.none'])).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('keeps the empty line but adds the failure when a save did not land', () => {
    renderSection({ status: 'saving-failed', rows: [] })

    expect(screen.getByRole('alert').textContent).toBe(en['save.failed'])
    expect(screen.getByText(en['scope.none'])).toBeTruthy()
  })

  it('keeps the catalog on screen while a save failure is reported', () => {
    renderSection({ status: 'saving-failed', rows: [skill('alpha', { source: 'bundled' })] })

    expect(screen.getByRole('alert').textContent).toBe(en['save.failed'])
    expect(screen.getByText('alpha')).toBeTruthy()
  })

  it('falls back to the empty line when the view carries no row list', () => {
    // The controller always publishes an array; a section handed anything else
    // (an older shape surviving a hot reload) states the empty catalog rather
    // than throwing while drawing.
    renderSection({ status: 'ready', rows: { length: 0 } as unknown as readonly SkillRow[] })

    expect(screen.getByText(en['scope.none'])).toBeTruthy()
  })
})

describe('SkillsSettingsSection catalog', () => {
  const CATALOG: readonly SkillRow[] = [
    skill('zebra', { source: 'user-dsh', modelInvocable: false, userDisabled: true }),
    skill('alpha', { source: 'user-dsh' }),
    skill('gamma', { source: '' }),
    skill('beta'),
    skill('delta', { source: 'plugin-x' }),
    skill('epsilon', { source: 'bundled' }),
  ]

  it('groups by discovery source, known sources first and unknown ones last', () => {
    renderSection({ status: 'ready', rows: CATALOG })

    const groups = screen.getAllByRole('region').map(node => node.getAttribute('aria-label'))
    expect(groups).toEqual(['bundled', 'user dsh', 'custom', 'plugin x'])
  })

  it('orders each group by skill name', () => {
    renderSection({ status: 'ready', rows: CATALOG })

    const userGroup = screen.getByRole('region', { name: 'user dsh' })
    expect(within(userGroup).getAllByRole('listitem').map(item => item.textContent))
      .toEqual([expect.stringContaining('alpha'), expect.stringContaining('zebra')])
  })

  it('collects a missing or empty source under the custom group', () => {
    renderSection({ status: 'ready', rows: CATALOG })

    const custom = within(screen.getByRole('region', { name: 'custom' }))
    expect(custom.getByText('beta')).toBeTruthy()
    expect(custom.getByText('gamma')).toBeTruthy()
  })

  it('states each skill\'s availability and stored state on its row', () => {
    renderSection({ status: 'ready', rows: CATALOG })

    const enabled = within(screen.getByRole('region', { name: 'bundled' }))
    expect(enabled.getByText(en['tag.modelOnly'])).toBeTruthy()
    expect(enabled.getByText(en['state.on'])).toBeTruthy()
    expect(switchFor('epsilon').checked).toBe(true)

    const disabled = within(screen.getByRole('region', { name: 'user dsh' }))
    expect(disabled.getByText(en['tag.userOnly'])).toBeTruthy()
    expect(switchFor('zebra').checked).toBe(false)
    expect(within(screen.getByRole('region', { name: 'user dsh' })).getByText(en['state.off'])).toBeTruthy()
  })

  it('explains what disabling a skill costs', () => {
    renderSection({ status: 'ready', rows: CATALOG })

    expect(screen.getByText(en['hint.disable'])).toBeTruthy()
  })
})

describe('SkillsSettingsSection toggles', () => {
  it('hands the switch position back for the skill it belongs to', () => {
    const toggle = vi.fn()
    renderSection({
      status: 'ready',
      rows: [skill('alpha', { source: 'bundled' }), skill('zebra', { source: 'bundled', userDisabled: true })],
    }, toggle)

    fireEvent.click(switchFor('alpha'))
    fireEvent.click(switchFor('zebra'))

    expect(toggle.mock.calls).toEqual([
      ['alpha', false],
      ['zebra', true],
    ])
  })
})
