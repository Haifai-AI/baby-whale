/**
 * Text-ish artifact previews: the extension picks the renderer bucket
 * (markdown, highlighted source, or plain text), the decode is capped at
 * TEXT_PREVIEW_BYTES so a huge source file never becomes a huge payload, and
 * the payload names the file the way a user sees it — basename only.
 * @module @deepseek-ai/dsh-host-apiproxy/tests/artifacts-preview-text
 */

import { describe, expect, it } from 'vitest'
import {
  TEXT_PREVIEW_BYTES,
  parseMediaPreview,
  parseTextPreview,
  textPreviewKind,
  textPreviewLanguage,
} from '../src/artifacts-preview.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('textPreviewKind', () => {
  it('buckets every markdown spelling as markdown', () => {
    expect(textPreviewKind('.md')).toBe('markdown')
    expect(textPreviewKind('.markdown')).toBe('markdown')
    expect(textPreviewKind('.mdx')).toBe('markdown')
  })

  it('buckets source, config, and markup extensions as highlighted text', () => {
    expect(textPreviewKind('.ts')).toBe('text')
    expect(textPreviewKind('.toml')).toBe('text')
    expect(textPreviewKind('.zig')).toBe('text')
    expect(textPreviewKind('.psm1')).toBe('text')
  })

  it('leaves binary, office, and unknown extensions unclassified', () => {
    expect(textPreviewKind('.png')).toBeUndefined()
    expect(textPreviewKind('.xlsx')).toBeUndefined()
    expect(textPreviewKind('')).toBeUndefined()
  })
})

describe('textPreviewLanguage', () => {
  it('names the highlight grammar for a tabulated extension', () => {
    expect(textPreviewLanguage('.tsx')).toBe('tsx')
    expect(textPreviewLanguage('.yml')).toBe('yaml')
    expect(textPreviewLanguage('.bash')).toBe('shell')
  })

  it('leaves extensions with no grammar alias to plain monospace', () => {
    expect(textPreviewLanguage('.log')).toBeUndefined()
    expect(textPreviewLanguage('.txt')).toBeUndefined()
  })
})

describe('parseTextPreview', () => {
  it('returns markdown source for the shared client-side renderer', () => {
    expect(parseTextPreview(utf8('# Title\n\nbody\n'), 'notes/readme.md')).toEqual({
      kind: 'markdown',
      file_name: 'readme.md',
      text: '# Title\n\nbody\n',
      truncated: false,
    })
  })

  it('carries the highlight language for a known source extension', () => {
    expect(parseTextPreview(utf8('const x = 1\n'), 'src/x.ts')).toEqual({
      kind: 'text',
      file_name: 'x.ts',
      text: 'const x = 1\n',
      language: 'ts',
      truncated: false,
    })
  })

  it('omits the language for a text extension with no grammar alias', () => {
    expect(parseTextPreview(utf8('boot ok\n'), 'run.log')).toEqual({
      kind: 'text',
      file_name: 'run.log',
      text: 'boot ok\n',
      truncated: false,
    })
  })

  it('decodes at most TEXT_PREVIEW_BYTES and flags the cut', () => {
    const bytes = new Uint8Array(TEXT_PREVIEW_BYTES + 5).fill(0x61)
    const preview = parseTextPreview(bytes, 'logs/huge.txt')
    if (preview.kind !== 'text') throw new Error('expected a text preview')
    expect(preview.truncated).toBe(true)
    expect(preview.text).toHaveLength(TEXT_PREVIEW_BYTES)
  })

  it('keeps a separator-free path as its own file name', () => {
    expect(parseTextPreview(utf8('body'), 'README.md')).toEqual({
      kind: 'markdown',
      file_name: 'README.md',
      text: 'body',
      truncated: false,
    })
  })

  it('refuses an extension that has no text preview', () => {
    expect(() => parseTextPreview(utf8('x'), 'deliverables/clip.mp4')).toThrow(
      'not a text preview extension: .mp4',
    )
  })

  it('treats an extensionless path as an unpresentable text file', () => {
    expect(() => parseTextPreview(utf8('x'), 'deliverables/Makefile')).toThrow(
      'not a text preview extension: ',
    )
  })
})

describe('parseMediaPreview', () => {
  it('keeps a separator-free path as its own file name', () => {
    expect(parseMediaPreview('clip.mp4')).toEqual({ kind: 'video', file_name: 'clip.mp4' })
  })

  it('reads Windows-separated paths down to the basename', () => {
    expect(parseMediaPreview('deliverables\\tone.flac')).toEqual({ kind: 'audio', file_name: 'tone.flac' })
  })
})
