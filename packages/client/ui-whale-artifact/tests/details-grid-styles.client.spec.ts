/**
 * The Data-tab grid column contract as CSS text. jsdom has no layout, so a
 * render spec can pin that a long cell keeps its full text in `title` but not
 * whether the column stays collapsed; these read the declarations the fixed
 * grid widths depend on.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/DetailsArtifact.module.css', import.meta.url)), 'utf8')
/** Declarations only: the sheet's prose names the properties it explains. */
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  // Anchored at a rule boundary: an unanchored match would silently read a
  // compound rule that merely contains the selector (`.gridWrap .grid`) if one
  // ever lands above the base rule.
  const rule = new RegExp(`(?:^|\\})\\s*\\${selector}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`DetailsArtifact.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('DetailsArtifact.module.css grid columns', () => {
  it('hugs the capped columns instead of stretching across the panel', () => {
    // With fixed layout and an auto width, a few-column sheet distributes the
    // whole panel width to its columns, so one long cell blows the grid out
    // to the right. `max-content` keeps Excel-like widths and scrolls the
    // `.gridWrap` horizontally instead.
    expect(declarations('.grid')).toEqual(expect.arrayContaining([
      'table-layout: fixed',
      'width: max-content',
    ]))
  })

  it('pins data columns to the header width with an ellipsis cap', () => {
    // Fixed layout sizes columns from the first row, so the letter heads
    // carry the pin and the body cells only need the matching cap; without
    // both, long values size the column instead of clipping.
    expect(declarations('.columnHead')).toEqual(expect.arrayContaining([
      'width: 90px',
      'max-width: 200px',
    ]))
    expect(declarations('.headerCell')).toEqual(expect.arrayContaining([
      'width: 90px',
      'max-width: 200px',
    ]))
    expect(declarations('.cell')).toEqual(expect.arrayContaining([
      'max-width: 200px',
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
    ]))
  })
})
