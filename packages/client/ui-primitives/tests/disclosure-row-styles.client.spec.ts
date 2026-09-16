/**
 * The shared process-row chrome as CSS text.
 *
 * Every row in the transcript that reports process composes this atom, so
 * these declarations are the one place the row geometry and hierarchy are
 * decided. jsdom has no layout and the rendering specs assert behavior rather
 * than appearance, so nothing else catches a value drifting here — and the
 * consumers that hand-roll the chrome instead of composing it (the Bash and
 * Skill rows) repeat these numbers by hand, which is exactly why they need a
 * single documented source to be checked against in review.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const text = readFileSync(fileURLToPath(new URL('../src/DisclosureRow.module.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  // The selector is escaped as a whole: attribute selectors like
  // `.row[data-expandable]:hover` are regex character classes if they land in
  // the pattern raw, and would silently match the wrong rule.
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\})\\s*${pattern}\\s*\\{([^{}]*)\\}`).exec(text)
  if (rule === null) throw new Error(`DisclosureRow.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('DisclosureRow.module.css chrome', () => {
  it('ranks the verb above the meta run by weight and ink, with no separator', () => {
    // The hierarchy is carried by ink and weight alone. The 3px dot this
    // replaced measured 1.98:1 on the canvas and read as neither punctuation
    // nor a boundary, so a reintroduced separator is a regression, not a style.
    expect(declarations('.title')).toEqual(expect.arrayContaining([
      'font-weight: 500',
      'color: var(--dsw-alias-label-primary)',
    ]))
  })

  it('draws the leading glyph as a 20px tile on the raised fill', () => {
    // The tile gives every row a definite left edge. Its size is also the
    // first term of the transcript text axis (tile width + row gap), which
    // the folded-run summary matches in ui-conversation.
    expect(declarations('.leading')).toEqual(expect.arrayContaining([
      'width: 20px',
      'height: 20px',
      'border-radius: var(--dsw-radius-sm)',
      'background: var(--dsw-alias-fill-l2)',
    ]))
  })

  it('washes the whole row on hover, because the row is the target', () => {
    // The negative-offset case: an expandable row is one click target, and
    // the wash is the only thing that says so.
    expect(declarations('.row[data-expandable]:hover')).toEqual(expect.arrayContaining([
      'background: var(--dsw-alias-interactive-bg-hover)',
    ]))
  })
})
