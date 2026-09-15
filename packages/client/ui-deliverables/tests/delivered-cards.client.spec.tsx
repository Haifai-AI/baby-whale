// @vitest-environment jsdom
/**
 * DeliveredCards: the `deliver` claims a finished turn ends with. One rich card
 * per claimed file carrying its human kind label and extension, the Preview
 * split-button routing previewable and image claims into the artifacts pane
 * (rootless claims jailed to `deliverables/`) while every other file goes to the
 * host opener, the chevron menu's Download (raw channel) and Open actions, the
 * outside-press/Escape/retarget dismissal paths, and the counted show-all
 * remainder.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DeliveredCards, type DeliveredCardsProps } from '../src/client/DeliveredCards.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const sessionId = 'sess-delivered' as SessionId

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function props(overrides: Partial<DeliveredCardsProps> = {}): DeliveredCardsProps {
  return {
    matched: [],
    openFile: () => {},
    openFilePreview: () => {},
    sessionId,
    isLoopback: true,
    useHostDescription: selector => selector({ canOpenPath: true }),
    connection: {} as never,
    t,
    ...overrides,
  }
}

/** The clickable document glyph of one card (the first of its two open-labelled controls). */
function thumb(view: ReturnType<typeof render>, path: string): HTMLElement {
  const [element] = view.getAllByRole('button', { name: `打开 ${path}` })
  if (element === undefined) throw new Error(`no card rendered for ${path}`)
  return element
}

describe('DeliveredCards', () => {
  it('labels every claim with its human kind and extension, revealing the counted remainder', () => {
    const matched = [
      'decks/q1.xlsx', 'decks/legacy.xlsm', 'docs/report.docx', 'slides/talk.pptx',
      'tables/data.csv', 'tables/export.tsv', 'docs/paper.pdf', 'scripts/tool.py',
      'docs/readme.md', 'docs/notes.markdown', 'docs/page.mdx', 'src/app.ts',
      'media/demo.mp4', 'media/clip.m4v', 'media/song.mp3', 'media/tone.flac',
      'archive/bundle.zip', 'Makefile',
    ]
    const view = render(<DeliveredCards {...props({ matched })} />)

    expect(view.getByText('交付文件')).toBeTruthy()
    // Only the leading window renders; the other ten stay counted.
    expect(view.queryByText('Video · MP4')).toBeNull()
    expect(view.getByRole('button', { name: '+ 10 个文件' })).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: '+ 10 个文件' }))
    for (const [path, subtitle] of [
      ['decks/q1.xlsx', 'Spreadsheet · XLSX'],
      ['decks/legacy.xlsm', 'Spreadsheet · XLSM'],
      ['docs/report.docx', 'Document · DOCX'],
      ['slides/talk.pptx', 'Presentation · PPTX'],
      ['tables/data.csv', 'Spreadsheet · CSV'],
      ['tables/export.tsv', 'Spreadsheet · TSV'],
      ['docs/paper.pdf', 'PDF · PDF'],
      ['scripts/tool.py', 'Script · PY'],
      ['docs/readme.md', 'Markdown · MD'],
      ['docs/notes.markdown', 'Markdown · MARKDOWN'],
      ['docs/page.mdx', 'Markdown · MDX'],
      ['src/app.ts', 'Code · TS'],
      ['media/demo.mp4', 'Video · MP4'],
      ['media/clip.m4v', 'Video · M4V'],
      ['media/song.mp3', 'Audio · MP3'],
      ['media/tone.flac', 'Audio · FLAC'],
      ['archive/bundle.zip', 'File · ZIP'],
      // A separator-free claim has no extension to state.
      ['Makefile', 'File ·'],
    ] as const) {
      expect(view.getByText(subtitle)).toBeTruthy()
      expect(view.getAllByRole('button', { name: `打开 ${path}` })).toHaveLength(2)
    }
    expect(view.queryByRole('button', { name: '+ 10 个文件' })).toBeNull()
  })

  it('previews previewable and image claims, opening every other file through the host', () => {
    const openFile = vi.fn<(path: string) => void>()
    const openFilePreview = vi.fn<(path: string) => void>()
    const view = render(<DeliveredCards {...props({
      matched: ['decks/q1.xlsx', 'pics/photo.png', 'archive/bundle.zip'],
      openFile,
      openFilePreview,
    })} />)

    // The split button states the action it performs; only the previewable
    // claims and the image carry the Preview label, the zip carries Open.
    const previewButtons = view.getAllByText('预览')
    expect(previewButtons).toHaveLength(2)
    fireEvent.click(previewButtons[0]!)
    expect(openFilePreview).toHaveBeenLastCalledWith('deliverables/q1.xlsx')
    fireEvent.click(previewButtons[1]!)
    expect(openFilePreview).toHaveBeenLastCalledWith('deliverables/photo.png')
    fireEvent.click(view.getByText('打开'))
    expect(openFile).toHaveBeenLastCalledWith('archive/bundle.zip')

    // The filename control always opens in the Host, whatever the card kind.
    fireEvent.click(view.getAllByRole('button', { name: '打开 decks/q1.xlsx' })[1]!)
    expect(openFile).toHaveBeenLastCalledWith('decks/q1.xlsx')
  })

  it('jails a rootless claim to deliverables before it reaches the preview pane', () => {
    const openFilePreview = vi.fn<(path: string) => void>()
    const matched = ['deliverables/deck.xlsx', 'uploads/photo.png', 'notes.md', './deliverables/a.pdf']
    const view = render(<DeliveredCards {...props({ matched, openFilePreview })} />)

    for (const [path, expected] of [
      ['deliverables/deck.xlsx', 'deliverables/deck.xlsx'],
      ['uploads/photo.png', 'uploads/photo.png'],
      ['notes.md', 'deliverables/notes.md'],
      ['./deliverables/a.pdf', 'deliverables/a.pdf'],
    ] as const) {
      fireEvent.click(thumb(view, path))
      expect(openFilePreview).toHaveBeenLastCalledWith(expected)
    }
  })

  it('offers Download and Open from the chevron menu and closes on the chosen action', () => {
    const openFile = vi.fn<(path: string) => void>()
    const downloads: Array<{ href: string; name: string }> = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.href, name: this.download })
    })
    const view = render(<DeliveredCards {...props({ matched: ['deliverables/deck.xlsx'], openFile })} />)
    const chevron = view.getByRole('button', { name: '打开' })

    expect(chevron.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByRole('menu')).toBeNull()

    fireEvent.click(chevron)
    expect(chevron.getAttribute('aria-expanded')).toBe('true')
    const menu = view.getByRole('menu')
    // A press on the menu's own surface is not an outside press.
    fireEvent.mouseDown(menu)
    expect(view.getByRole('menu')).toBeTruthy()

    fireEvent.click(within(menu).getByRole('menuitem', { name: '打开' }))
    expect(openFile).toHaveBeenCalledWith('deliverables/deck.xlsx')
    expect(view.queryByRole('menu')).toBeNull()

    fireEvent.click(chevron)
    expect(view.getByRole('button', { name: '打开' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: '下载' }))
    expect(view.queryByRole('menu')).toBeNull()
    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.name).toBe('deck.xlsx')
    const query = new URLSearchParams(downloads[0]!.href.slice(downloads[0]!.href.indexOf('?') + 1))
    expect(query.get('session')).toBe(sessionId)
    expect(query.get('path')).toBe('deliverables/deck.xlsx')
    expect(query.get('download')).toBe('1')
  })

  it('dismisses the menu on an outside press, Escape, or a retargeted card list', () => {
    const view = render(<DeliveredCards {...props({
      matched: ['deliverables/one.xlsx', 'deliverables/two.xlsx'],
    })} />)
    const chevrons = view.getAllByRole('button', { name: '打开' })

    fireEvent.click(chevrons[0]!)
    expect(view.getByRole('menu')).toBeTruthy()
    // The same chevron closes the menu it opened.
    fireEvent.click(chevrons[0]!)
    expect(view.queryByRole('menu')).toBeNull()

    fireEvent.click(chevrons[0]!)
    expect(view.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(view.queryByRole('menu')).toBeNull()

    fireEvent.click(chevrons[1]!)
    expect(view.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()

    // Any other key leaves the menu where the user put it.
    fireEvent.click(view.getAllByRole('button', { name: '打开' })[0]!)
    fireEvent.keyDown(document, { key: 'a' })
    expect(view.getByRole('menu')).toBeTruthy()

    // The open card disappearing detaches the menu ref; the document listener
    // installed for it must not act on a surface that is no longer mounted.
    view.rerender(<DeliveredCards {...props({ matched: [] })} />)
    expect(view.queryByRole('menu')).toBeNull()
    fireEvent.mouseDown(document.body)
    expect(view.queryByRole('menu')).toBeNull()
  })

  it('offers the host Open action only on a loopback host that can open paths', () => {
    for (const [isLoopback, canOpenPath, offered] of [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [true, undefined, false],
    ] as const) {
      const view = render(<DeliveredCards {...props({
        matched: ['deliverables/deck.xlsx'],
        isLoopback,
        useHostDescription: selector => selector(
          canOpenPath === undefined ? undefined : { canOpenPath },
        ),
      })} />)
      fireEvent.click(view.getByRole('button', { name: '打开' }))
      expect(view.queryByRole('menuitem', { name: '打开' }) !== null).toBe(offered)
      expect(view.getByRole('menuitem', { name: '下载' })).toBeTruthy()
      view.unmount()
    }
  })
})
