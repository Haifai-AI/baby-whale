/**
 * Skills settings section: the catalog grouped by discovery source with a
 * per-skill toggle. Toggling writes the `skills.disabled` list through the
 * standard settings scope — the same resolved value tool-skill and the
 * gateway read, so model catalogs, `/name` invocations, and this list all
 * agree.
 * @module @deepseek-ai/dsh-client-ui-settings-skills/src/client/SkillsSettingsSection
 */

import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsSettingsLocaleKey } from './locales.ts'
import css from './SkillsSettingsSection.module.css'

/** One renderable row of the skills table. */
export interface SkillRow {
  readonly name: string
  readonly description: string
  readonly source?: string
  readonly modelInvocable: boolean
  readonly userDisabled: boolean
}

/** View state the controller projects. */
export interface SkillsSettingsView {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'saving-failed'
  readonly rows: readonly SkillRow[]
}

/** Flip-one-skill action handed through the controller's hook pair. */
export type ToggleSkill = (name: string, nextEnabled: boolean) => void

/** Registration-side business face for the section. */
export interface SkillsSettingsSectionInjected {
  hooks: {
    /** The controller-owned catalog view plus pending-write marker. */
    view: HostObservable<SkillsSettingsView & { saving: boolean }>
    /** The flip action, as an observable so it rides the same inject face. */
    toggle: HostObservable<ToggleSkill>
  }
}

/** Props the renderer binds for the section. */
export type SkillsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsSettingsSectionInjected>

const SOURCE_ORDER = ['bundled', 'harness', 'user-dsh', 'project-dsh', 'project-agents', 'runtime', 'custom']

/** Human label for one discovery source token. */
function sourceLabel(source: string | undefined): string {
  if (source === undefined || source === '') return 'custom'
  return source.replaceAll('-', ' ')
}

/**
 * Render the skills management page.
 * @param props - runtime-bound props plus the controller face.
 * @returns the section contents.
 */
export function SkillsSettingsSection({ t, useView, useToggle }: SkillsSettingsSectionProps) {
  const view = useView(value => value)
  const toggle = useToggle(value => value)
  const groups = groupRows(Array.isArray(view.rows) ? view.rows : [])

  if (view.status === 'unavailable') {
    return <p className={css.empty}>{t('scope.unavailable')}</p>
  }
  if (view.status === 'loading') {
    return <p className={css.empty} aria-live="polite">{t('scope.loading')}</p>
  }

  if (view.rows.length === 0) {
    return (
      <div className={css.root}>
        {view.status === 'saving-failed' && <p className={css.error} role="alert">{t('save.failed')}</p>}
        <p className={css.empty}>{t('scope.none')}</p>
      </div>
    )
  }

  return (
    <div className={css.root}>
      {view.status === 'saving-failed' && <p className={css.error} role="alert">{t('save.failed')}</p>}
      {[...groups.entries()].map(([sourceLabel_, rows]) => (
        <section key={`source-${sourceLabel_}`} className={css.group} aria-label={sourceLabel_}>
          <h3 className={css.source}>{sourceLabel_}</h3>
          <ul className={css.list}>
            {rows.map(row => (
              <li key={row.name} className={row.userDisabled ? css.rowOff : css.rowOn}>
                <div className={css.text}>
                  <span className={css.name}>{row.name}</span>
                  <span className={css.tag}>{row.modelInvocable ? t('tag.modelOnly') : t('tag.userOnly')}</span>
                </div>
                <p className={css.desc}>{row.description}</p>
                <label className={css.toggleRow}>
                  <input
                    type="checkbox"
                    checked={!row.userDisabled}
                    onChange={(event) => { toggle(row.name, event.currentTarget.checked) }}
                  />
                  <span>{!row.userDisabled ? t('state.on') : t('state.off')}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className={css.hint}>{t('hint.disable')}</p>
    </div>
  )

  function groupRows(rows: readonly SkillRow[]): Map<string, SkillRow[]> {
    const map = new Map<string, SkillRow[]>()
    for (const row of rows) {
      const key = sourceLabel(row.source)
      const bucket = map.get(key) ?? []
      bucket.push(row)
      map.set(key, bucket)
    }
    for (const rows_ of map.values()) rows_.sort((a, b) => a.name.localeCompare(b.name))
    const rank = (label: string): number => {
      const index = SOURCE_ORDER.indexOf(label.replaceAll(' ', '-'))
      return index === -1 ? SOURCE_ORDER.length : index
    }
    return new Map([...map.entries()].sort(([a], [b]) => rank(a) - rank(b)))
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skills section copy. */
    'settings.skills': SkillsSettingsLocaleKey
  }
}
