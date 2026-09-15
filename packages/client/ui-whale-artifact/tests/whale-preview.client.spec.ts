// @vitest-environment jsdom
/**
 * Pure preview helpers: which tool-call blocks carry a bounded preview, how
 * the artifact path comes back out of the raw tool arguments, and the path and
 * byte formatting the card's meta line and open action use.
 */

import { describe, expect, it } from 'vitest'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { basename, filePathOf, formatBytes, previewOf } from '../src/client/whale-preview.ts'
import type { OfficePreviewData } from '../src/client/whale-preview.ts'

const PREVIEW: OfficePreviewData = {
  kind: 'docx',
  file_name: 'report.docx',
  truncated: false,
  title: 'Q3',
  blocks: [{ type: 'paragraph', text: 'intro' }],
}

const CALL = { name: 'docx_create', argsRaw: '{"file_path":"deliverables/report.docx"}' }

/** A settled tool result; the render-only tail stays empty (nothing reads it). */
function settled(meta: unknown, call: ToolResultNode['call'] = CALL): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'call-1',
    call,
    callTime: null,
    content: [],
    isError: false,
    meta,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

/** A still-running call: no `kind` tag yet, so only the running fields exist. */
function running(argsRaw: string): ToolCallBlock {
  return {
    callId: 'call-2',
    name: 'docx_create',
    argsRaw,
    turn: 1,
    step: 1,
    time: 0,
    callView: null,
    subCalls: [],
  }
}

describe('previewOf', () => {
  it('yields no preview while the call is still running', () => {
    expect(previewOf(running('{"file_path":"deliverables/report.docx"}'))).toBeUndefined()
  })

  it('yields no preview for an errored tool result', () => {
    expect(previewOf({ ...settled({ preview: PREVIEW }), isError: true })).toBeUndefined()
  })

  it('yields no preview when the result carries no preview metadata', () => {
    expect(previewOf(settled(undefined))).toBeUndefined()
    expect(previewOf(settled({}))).toBeUndefined()
  })

  it('yields the bounded preview of a settled result', () => {
    expect(previewOf(settled({ preview: PREVIEW }))).toBe(PREVIEW)
  })
})

describe('filePathOf', () => {
  it('parses the artifact path back out of a settled call arguments JSON', () => {
    expect(filePathOf(settled({ preview: PREVIEW }))).toBe('deliverables/report.docx')
  })

  it('yields no path when the call head fell outside the loaded window', () => {
    expect(filePathOf(settled({ preview: PREVIEW }, null))).toBeUndefined()
  })

  it('yields no path when the arguments carry no string file_path', () => {
    expect(filePathOf(settled({ preview: PREVIEW }, { name: 'docx_create', argsRaw: '{"path":"x.docx"}' }))).toBeUndefined()
    expect(filePathOf(settled({ preview: PREVIEW }, { name: 'docx_create', argsRaw: '{"file_path":7}' }))).toBeUndefined()
  })

  it('yields no path when the arguments are not valid JSON', () => {
    expect(filePathOf(settled({ preview: PREVIEW }, { name: 'docx_create', argsRaw: '{oops' }))).toBeUndefined()
  })

  it('reads the running call arguments directly', () => {
    expect(filePathOf(running('{"file_path":"deliverables/report.docx"}'))).toBe('deliverables/report.docx')
  })
})

describe('basename', () => {
  it('takes the last segment of a POSIX path', () => {
    expect(basename('/work/deliverables/q3.xlsx')).toBe('q3.xlsx')
  })

  it('takes the last segment of a Windows path', () => {
    expect(basename('C:\\work\\deliverables\\deck.pptx')).toBe('deck.pptx')
  })

  it('keeps a bare name that has no separator', () => {
    expect(basename('notes.docx')).toBe('notes.docx')
  })
})

describe('formatBytes', () => {
  it('reports sub-kilobyte sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('rounds kilobyte sizes to whole kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1500)).toBe('1 KB')
  })

  it('reports megabyte sizes with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1572864)).toBe('1.5 MB')
  })
})
