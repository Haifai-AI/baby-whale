import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { bridge, RequestMemoryBudget } from '../src/http-bridge.ts'

/** A budget that never contends (existing tests predate the global bound). */
function roomyBudget(): RequestMemoryBudget {
  return new RequestMemoryBudget(Number.MAX_SAFE_INTEGER)
}

describe('HTTP bridge abort', () => {
  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000, roomyBudget())
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'host.pickDirectory', payload: {},
    })
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/host.pickDirectory',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(request, response, {
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER, roomyBudget())
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })
})

describe('RequestMemoryBudget', () => {
  it('rejects non-positive budgets at construction', () => {
    for (const total of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new RequestMemoryBudget(total)).toThrow('must be a positive finite number')
    }
  })

  it('acquires up to the ceiling and tracks reservations', () => {
    const budget = new RequestMemoryBudget(100)
    expect(budget.tryAcquire(60)).toBe(true)
    expect(budget.used).toBe(60)
    expect(budget.tryAcquire(50)).toBe(false)
    expect(budget.used).toBe(60)
    budget.release(60)
    expect(budget.used).toBe(0)
    expect(budget.tryAcquire(100)).toBe(true)
  })

  it('rejects over-release and negative reservations', () => {
    const budget = new RequestMemoryBudget(100)
    expect(() => { budget.release(1) }).toThrow('with 0 reserved')
    expect(budget.tryAcquire(-1)).toBe(false)
    expect(budget.used).toBe(0)
    budget.tryAcquire(10)
    expect(() => { budget.release(11) }).toThrow('with 10 reserved')
  })
})

describe('HTTP bridge memory budget', () => {
  interface BridgedPair {
    body: Buffer[]
    contentLength: string | undefined
    maxBytes: number
    budget: RequestMemoryBudget
    handler: (input: Request) => Promise<Response>
  }
  function bridgedPair({ body, contentLength, maxBytes, budget, handler }: BridgedPair) {
    const destroyed: true[] = []
    const request = Readable.from(body) as unknown as IncomingMessage
    // Delegate to the real destroy: a no-op stub breaks the Readable async
    // iterator (chunks are never delivered and bridgeStreamed hangs).
    const realDestroy = request.destroy.bind(request)
    request.destroy = (...args: [error?: Error]) => {
      destroyed.push(true)
      return realDestroy(...args)
    }
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(contentLength === undefined ? {} : { 'content-length': contentLength }),
      },
    })
    let status: number | undefined
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number) { status = code; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse
    const done = bridge(request, response, { fetch: handler }, maxBytes, budget)
    return { done, destroyed, status: () => status }
  }

  it('refuses a second giant while the first is in flight with 503', async () => {
    const budget = new RequestMemoryBudget(1000)
    let entered!: () => void
    const enteredGate = new Promise<void>((resolve) => { entered = resolve })
    let releaseFirst!: () => void
    const releaseGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstHandler = async (): Promise<Response> => {
      entered()
      await releaseGate
      return new Response('one')
    }
    const secondHandler = (): Promise<Response> => {
      throw new Error('a refused request must never reach the handler')
    }
    const first = bridgedPair({ body: [Buffer.alloc(1000)], contentLength: '1000', maxBytes: 5000, budget, handler: firstHandler })
    await enteredGate
    expect(budget.used).toBe(1000)
    const second = bridgedPair({ body: [Buffer.alloc(1000)], contentLength: '1000', maxBytes: 5000, budget, handler: secondHandler })
    await second.done
    expect(second.status()).toBe(503)
    expect(second.destroyed).toHaveLength(1)
    releaseFirst()
    await first.done
    expect(first.status()).toBe(200)
    expect(budget.used).toBe(0)
  })

  it('releases the reservation after dispatch and after a mid-read 413', async () => {
    const budget = new RequestMemoryBudget(5000)
    const ok = bridgedPair({ body: [Buffer.from('{}')], contentLength: '2', maxBytes: 5000, budget, handler: async () => new Response('{}') })
    await ok.done
    expect(ok.status()).toBe(200)
    expect(budget.used).toBe(0)
    const over = bridgedPair({ body: [Buffer.alloc(10)], contentLength: '5', maxBytes: 5, budget, handler: async () => new Response('never') })
    await over.done
    expect(over.status()).toBe(413)
    expect(budget.used).toBe(0)
  })
})
