/**
 * Managed LibreOffice runtime routes and the converted-preview PDF channel:
 *
 * - `GET /api/office.runtime` — setup-banner snapshot: soffice presence and
 *   origin, install lifecycle, and whether this platform can auto-install.
 * - `POST /api/office.runtime.install` — begin (or join) the managed
 *   install; single-flight host-side. Returns the state at call time.
 * - `GET /api/artifacts.file` — serves ONE converted preview PDF from the
 *   gateway-owned cache directory. Any path outside the cache is refused —
 *   this is not a general file server.
 *
 * The connection service authenticates requests before these handlers run.
 * @module @deepseek-ai/dsh-api-session-controller/office-runtime
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  beginManagedSofficeInstall,
  findSoffice,
  managedInstallSupport,
  managedSofficePath,
  previewCacheDir,
  sofficeInstallState,
} from '@deepseek-ai/dsh-host-apiproxy'

const jsonOk = (value: unknown): Response => new Response(JSON.stringify(value), {
  headers: { 'content-type': 'application/json' },
})

async function status(): Promise<Response> {
  const managed = managedSofficePath()
  const found = managed !== undefined || findSoffice() !== undefined
  const source = managed !== undefined ? 'managed' : found ? 'system' : 'none'
  const support = managedInstallSupport()
  return jsonOk({
    soffice: {
      found,
      source,
      ...(managed !== undefined ? { path: managed } : {}),
    },
    install: sofficeInstallState(),
    managedSupported: support.supported,
    ...(support.guideUrl !== undefined ? { guideUrl: support.guideUrl } : {}),
  })
}

async function install(): Promise<Response> {
  const state = await beginManagedSofficeInstall()
  return jsonOk({ install: state })
}

/** Serve one converted preview PDF, jailed to the preview cache directory. */
async function servePreviewPdf(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const target = query.get('path') ?? ''
  const cache = resolve(previewCacheDir())
  const resolved = resolve(target)
  if (!resolved.startsWith(cache) || !resolved.endsWith('.pdf')) {
    return new Response('path is outside the preview cache', { status: 403 })
  }
  try {
    const bytes = await readFile(resolved)
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/pdf' } })
  } catch {
    return new Response('file not found', { status: 404 })
  }
}

/**
 * Whale office-runtime routes. The connection service supplies
 * authentication; the runtime state machine lives in
 * `@deepseek-ai/dsh-host-apiproxy`.
 */
export const SessionOfficeRuntime = {
  inject: ['connection'],
  apply(ctx: Context): void {
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/office.runtime',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => status(),
    }), 'session-controller: /api/office.runtime')
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/office.runtime.install',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => install(),
    }), 'session-controller: /api/office.runtime.install')
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/artifacts.file',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: request => servePreviewPdf(request),
    }), 'session-controller: /api/artifacts.file')
  },
}
