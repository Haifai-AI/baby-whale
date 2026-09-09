/**
 * Invariant over the raw-serving content policy: the MIME table and the
 * force-download set must stay consistent, so a newly introduced active
 * same-origin document type (HTML, SVG, XML — script runs when the raw
 * URL is navigated directly) cannot silently serve inline, while safe
 * media/image/PDF previews stay inline (Content-Disposition on them would
 * only turn every preview into a download).
 * @module @deepseek-ai/dsh-host-apiproxy/tests/raw-content-policy
 */

import { describe, expect, it } from 'vitest'
import { FORCE_DOWNLOAD_EXTENSIONS, RAW_CONTENT_TYPES } from '../src/api-proxy.ts'

/** MIME types the browser treats as same-origin documents when navigated: rendering them executes their script. */
const ACTIVE_DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/xslt+xml',
])

describe('raw-serving content policy', () => {
  it('forces every served active document type to download', () => {
    for (const [ext, mime] of Object.entries(RAW_CONTENT_TYPES)) {
      if (ACTIVE_DOCUMENT_MIME_TYPES.has(mime)) {
        expect(FORCE_DOWNLOAD_EXTENSIONS.has(ext), `${ext} serves ${mime} same-origin and must force attachment`).toBe(true)
      }
    }
    // The known active type is actually covered (guards an emptied table
    // trivially passing the loop above).
    expect(FORCE_DOWNLOAD_EXTENSIONS.has('.svg')).toBe(true)
    expect(RAW_CONTENT_TYPES['.svg']).toBe('image/svg+xml')
  })

  it('keeps safe served types inline (no forced downloads for previews)', () => {
    for (const [ext, mime] of Object.entries(RAW_CONTENT_TYPES)) {
      if (!ACTIVE_DOCUMENT_MIME_TYPES.has(mime)) {
        expect(FORCE_DOWNLOAD_EXTENSIONS.has(ext), `${ext} (${mime}) previews inline and must not force attachment`).toBe(false)
      }
    }
  })

  it('keeps the force-download set anchored to the served table', () => {
    for (const ext of FORCE_DOWNLOAD_EXTENSIONS) {
      expect(RAW_CONTENT_TYPES, `${ext} is force-downloaded but never served`).toHaveProperty(ext)
    }
  })
})
