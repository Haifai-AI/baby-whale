/**
 * node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
 * web carrier; the fetch-shaped handler itself is transport-agnostic).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Default carrier cap for all HTTP RPC bodies: sized for the default
 * aggregate image limit (200 MiB) after base64 expansion plus envelope
 * headroom (~267.7 MiB required), rounded up for slack. The bridge buffers
 * each body in memory, so this cap is also the per-request resident bound. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024

/**
 * Global in-flight request-body budget: the per-request cap bounds one
 * body, but concurrent giants multiply it — without a shared ceiling,
 * concurrent uploads exhaust host memory. One instance lives on the
 * connection service and every bridged request reserves against it.
 */
export class RequestMemoryBudget {
  private usedBytes = 0

  /** @param totalBytes - the in-flight ceiling; must be positive and finite. */
  constructor(private readonly totalBytes: number) {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error(`RequestMemoryBudget total must be a positive finite number, got ${String(totalBytes)}`)
    }
  }

  /** Currently reserved bytes. */
  get used(): number {
    return this.usedBytes
  }

  /**
   * Reserve bytes; false when insufficient — the caller must refuse the
   * request, never run it unbudgeted.
   * @param bytes - the reservation size (claimed, not yet read).
   * @returns true when reserved.
   */
  tryAcquire(bytes: number): boolean {
    if (!(bytes >= 0) || this.usedBytes + bytes > this.totalBytes) return false
    this.usedBytes += bytes
    return true
  }

  /**
   * Return a previous reservation. Over-release is an accounting bug and
   * throws rather than masking it with a clamp.
   * @param bytes - the exact size previously acquired.
   */
  release(bytes: number): void {
    if (!(bytes >= 0) || bytes > this.usedBytes) {
      throw new Error(`RequestMemoryBudget released ${String(bytes)} with ${String(this.usedBytes)} reserved`)
    }
    this.usedBytes -= bytes
  }
}

/** Transport-independent request handler consumed by the Host HTTP bridge. */
export interface FetchHandler {
  /**
   * Handle one standard Fetch request.
   * @param request - request produced by the active transport bridge.
   * @returns complete or streaming Fetch response.
   */
  fetch(request: Request): Promise<Response>
}

/**
 * Bridge one node:http request to the fetch-shaped handler (client close
 * aborts; SSE bodies stream out chunk by chunk).
 * @param req - incoming node:http request (fully read before dispatch).
 * @param res - node:http response the bridge writes and owns to completion.
 * @param apiHandler - fetch-shaped API carrier the request is dispatched to.
 * @param maxRequestBodyBytes - maximum body bytes buffered before dispatch.
 * @param budget - the service-wide in-flight budget this request reserves
 *   against (required: unbounded concurrency is never the default).
 */
export async function bridge(
  req: IncomingMessage,
  res: ServerResponse,
  apiHandler: FetchHandler,
  maxRequestBodyBytes: number,
  budget: RequestMemoryBudget,
): Promise<void> {
  const abort = new AbortController()
  // Client-disconnect detection MUST hang off the response, not the request:
  // since Node 16, IncomingMessage 'close' fires as soon as the request body is
  // fully consumed (immediately for a bodyless GET), which would abort every SSE
  // stream right after open. ServerResponse 'close' fires on connection teardown;
  // writableEnded distinguishes a normal end() from the client going away.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined && Number(declaredLength) > maxRequestBodyBytes) {
    res.writeHead(413, { connection: 'close' })
    res.end()
    req.destroy()
    return
  }
  // Reserve the declared size — or the whole per-request cap when undeclared
  // or garbage — BEFORE reading a byte. A second giant arriving while the
  // first is in flight gets 503 instead of OOMing the host; small API calls
  // declare small sizes and never contend.
  const declared = Number(declaredLength)
  const claim = declaredLength === undefined || !Number.isFinite(declared) || declared < 0
    ? maxRequestBodyBytes
    : Math.min(declared, maxRequestBodyBytes)
  if (!budget.tryAcquire(claim)) {
    res.writeHead(503, { connection: 'close' })
    res.end()
    req.destroy()
    return
  }
  try {
    await bridgeStreamed(req, res, apiHandler, maxRequestBodyBytes, abort.signal)
  } finally {
    budget.release(claim)
  }
}

/**
 * Read one body (413 past the cap), dispatch, and stream the response.
 * The caller holds the budget reservation across this whole span.
 */
async function bridgeStreamed(
  req: IncomingMessage,
  res: ServerResponse,
  apiHandler: FetchHandler,
  maxRequestBodyBytes: number,
  signal: AbortSignal,
): Promise<void> {
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > maxRequestBodyBytes) {
      res.writeHead(413, { connection: 'close' })
      res.end()
      req.destroy()
      return
    }
    chunks.push(buffer)
  }
  /* v8 ignore next 3 -- `??` arms: node:http always sets url/method on server
  requests; the fields are only optional on the client-side IncomingMessage type */
  const request = new Request(new URL(req.url ?? '/', 'http://dsh.internal'), {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][]),
    ...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
    signal,
  })
  const response = await apiHandler.fetch(request)
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) {
    res.end()
    return
  }
  for await (const chunk of response.body) {
    // Backpressure: a false return means the socket buffer is full — wait for drain
    // instead of buffering unboundedly (slow/suspended SSE consumers). 'close' also
    // resolves so a mid-wait disconnect can't park this loop forever; the close
    // handler above aborts the handler stream, which then ends the iteration.
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          res.off('drain', done)
          res.off('close', done)
          resolve()
        }
        res.once('drain', done)
        res.once('close', done)
      })
    }
  }
  res.end()
}
