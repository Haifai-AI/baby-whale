// @vitest-environment jsdom
/**
 * File-preview atoms: the whole-file code viewer (one row per source line with
 * the trailing newline trimmed, the hard render ceiling, the shared viewer's
 * own head/tail collapse), the markdown surface, and the zoomable image (fit by
 * default, stepped zoom clamped at both bounds, the natural-size reset, and the
 * inline size read from the loaded image).
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeFilePreview, MarkdownFilePreview, ZoomableImage } from '../src/FilePreviews.tsx'

afterEach(cleanup)

/** The rendered line rows of a code preview. */
function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[class^="_line_"]')]
}

/** The rendered image of a zoomable preview. */
function image(container: HTMLElement): HTMLImageElement {
  const element = container.querySelector('img')
  if (element === null) throw new Error('zoomable image missing')
  return element
}

describe('CodeFilePreview', () => {
  it('renders one row per source line and drops the trailing newline', () => {
    const view = render(<CodeFilePreview text={'const a = 1\nconst b = 2\n'} language="ts" />)

    expect(rows(view.container)).toHaveLength(2)
    expect(view.container.querySelector('[class^="_content_"]')?.textContent).toBe('const a = 1')
    // The language hint reaches the shared viewer's banner.
    expect(view.container.textContent).toContain('ts')
  })

  it('keeps a final empty line that the file itself carries', () => {
    const view = render(<CodeFilePreview text={'first\n\n'} />)

    const lines = rows(view.container)
    expect(lines).toHaveLength(2)
    expect(lines[1]?.textContent).toBe('2')
  })

  it('renders a single blank row for an empty file', () => {
    const view = render(<CodeFilePreview text="" />)

    expect(rows(view.container)).toHaveLength(1)
  })

  it('stops at the hard render ceiling when a file is longer than it', () => {
    const text = Array.from({ length: 20_001 }, (_value, index) => `line ${index}`).join('\n')
    const view = render(<CodeFilePreview text={text} />)

    // The viewer draws the file's head and tail; the line beyond the ceiling is
    // never part of the content it renders.
    expect(view.container.textContent).toContain('line 19999')
    expect(view.container.textContent).not.toContain('line 20000')
  })
})

describe('MarkdownFilePreview', () => {
  it('renders the file through the chat markdown renderer', () => {
    const view = render(<MarkdownFilePreview text={'# Title\n\nBody copy'} />)

    expect(view.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(view.getByText('Body copy')).toBeTruthy()
  })
})

describe('ZoomableImage', () => {
  it('fits by default, steps through levels, and clamps at both bounds', () => {
    const view = render(<ZoomableImage src="blob:chart" alt="chart" />)
    const zoomIn = view.getByRole('button', { name: 'zoom in' })
    const zoomOut = view.getByRole('button', { name: 'zoom out' })

    expect(view.getByText('Fit')).toBeTruthy()
    // Natural size is unknown until the image loads, so the 1:1 jump is off.
    expect(view.getByRole('button', { name: 'actual size' }).hasAttribute('disabled')).toBe(true)
    expect(image(view.container).style.width).toBe('')

    fireEvent.click(zoomIn)
    expect(view.getByText('125%')).toBeTruthy()
    fireEvent.click(zoomOut)
    expect(view.getByText('100%')).toBeTruthy()
    fireEvent.click(zoomOut)
    expect(view.getByText('80%')).toBeTruthy()

    for (let step = 0; step < 20; step += 1) fireEvent.click(zoomIn)
    expect(view.getByText('800%')).toBeTruthy()
    for (let step = 0; step < 40; step += 1) fireEvent.click(zoomOut)
    expect(view.getByText('10%')).toBeTruthy()

    // The fit control returns the image to its default framing.
    fireEvent.click(view.getByText('⤢'))
    expect(view.getByText('Fit')).toBeTruthy()
  })

  it('sizes the frame from the loaded image and returns to fit on demand', () => {
    const view = render(<ZoomableImage src="blob:chart" alt="chart" />)
    const element = image(view.container)
    Object.defineProperty(element, 'naturalWidth', { value: 400, configurable: true })
    fireEvent.load(element)

    const actualSize = view.getByRole('button', { name: 'actual size' })
    expect(actualSize.hasAttribute('disabled')).toBe(false)
    fireEvent.click(actualSize)
    expect(view.getByText('100%')).toBeTruthy()
    expect(element.style.width).toBe('400px')

    // Fitting never upscales: no inline width while the zoom is unfixed.
    fireEvent.click(view.getByText('⤢'))
    expect(image(view.container).style.width).toBe('')
    // Stepping out of fit starts from the image's own size.
    fireEvent.click(view.getByRole('button', { name: 'zoom in' }))
    expect(image(view.container).style.width).toBe('500px')
  })
})
