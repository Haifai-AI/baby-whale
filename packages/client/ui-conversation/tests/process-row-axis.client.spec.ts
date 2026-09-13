/**
 * The transcript's text axis, as arithmetic over two stylesheets.
 *
 * Every process row — a tool call, a reasoning block, a command, an injected
 * context — draws its verb at `leading width + row gap` from the row's own
 * left edge, and the consumer files that hand-roll the chrome instead of
 * composing `DisclosureRow` repeat those two numbers by hand. The folded-run
 * summary replaces a run of those rows, so its label has to land on the same
 * axis: it carries the same leading slot and gap, and cancels its own inline
 * padding with a negative margin.
 *
 * jsdom has no layout, so no rendering spec can catch this. The two sides live
 * in different files and different packages, and a change to either number
 * alone silently drops every folded run's label one step off the prose around
 * it. These read the declarations that the alignment is made of.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function declarationsOf(relativePath: string, selector: string): string[] {
  const css = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  // The selector is escaped as a whole: an attribute selector landing in the
  // pattern raw is a regex character class and matches the wrong rule.
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\})\\s*${pattern}\\s*\\{([^{}]*)\\}`).exec(css)
  if (rule === null) throw new Error(`${relativePath} has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

/** The px value of one declaration, for the arithmetic the axis is made of. */
function px(declarations: string[], property: string): number {
  const found = declarations.find(entry => entry.startsWith(`${property}:`))
  if (found === undefined) throw new Error(`no \`${property}\` declaration`)
  const value = /(-?\d+(?:\.\d+)?)px/.exec(found)
  if (value === null) throw new Error(`\`${found}\` is not a px length`)
  return Number(value[1])
}

const CHROME = '../../ui-primitives/src/DisclosureRow.module.css'

describe('the transcript text axis', () => {
  it('puts a process row verb and a folded run label on the same axis', () => {
    const chromeRow = declarationsOf(CHROME, '.row')
    const chromeLeading = declarationsOf(CHROME, '.leading')
    const foldSummary = declarationsOf('../src/client/chat/ToolRunGroup.module.css', '.summary')
    const foldIcon = declarationsOf('../src/client/chat/ToolRunGroup.module.css', '.icon')

    const rowAxis = px(chromeLeading, 'width') + px(chromeRow, 'gap')
    const foldAxis = px(foldIcon, 'width') + px(foldSummary, 'gap')

    // The folded summary's own left edge sits `padding` left of the column
    // because of the negative margin, so its label's absolute x is
    // `-margin + padding + foldAxis`. That must equal `rowAxis`.
    const foldLeftOffset = px(foldSummary, 'margin-left') + px(foldSummary, 'padding')
    expect(foldLeftOffset + foldAxis).toBe(rowAxis)
  })
})
