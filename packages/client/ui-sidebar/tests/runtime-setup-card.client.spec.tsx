// @vitest-environment jsdom
/**
 * RuntimeSetupCard behavior: hidden when the runtime is present; ambient
 * card with a working Set-up button when it is not; guided link on
 * platforms without the automatic flow.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { RuntimeSetupCard } from '../src/client/RuntimeSetupCard.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: string): string => (en as unknown as Record<string, string>)[key] ?? key

type StatusOverrides = {
  found?: boolean
  phase?: 'idle' | 'downloading' | 'installing' | 'done' | 'error'
  progress?: number
  managedSupported?: boolean
  guideUrl?: string
  message?: string
  error?: string
  /** Answer the status RPC with a failed envelope instead of a value. */
  statusFails?: boolean
  /** Answer the install RPC with a failed envelope. */
  installFails?: boolean
}

/** A stub connection returned alongside its install RPC mock for call assertions. */
function stubConnection(overrides: StatusOverrides = {}): {
  readonly connection: ConnectionHandle
  readonly installRpc: Mock
} {
  const value = {
    soffice: { found: overrides.found ?? false, source: overrides.found === true ? 'system' : 'none' },
    install: {
      phase: overrides.phase ?? 'idle',
      progress: overrides.progress ?? 0,
      ...(overrides.message !== undefined ? { message: overrides.message } : {}),
      ...(overrides.error !== undefined ? { error: overrides.error } : {}),
    },
    managedSupported: overrides.managedSupported ?? true,
    ...(overrides.guideUrl !== undefined ? { guideUrl: overrides.guideUrl } : {}),
  }
  const installRpc = vi.fn(() => Promise.resolve({
    rpcId: 'x' as never,
    result: overrides.installFails === true
      ? { ok: false as const, error: { code: 'internal' as const, message: 'install refused' } }
      : { ok: true as const, value: { install: value.install } },
  }))
  return {
    installRpc,
    connection: {
      isLoopback: true,
      hostDescription: 'stub',
      api: {
        officeRuntime: {
          status: vi.fn(() => Promise.resolve({
            rpcId: 'x' as never,
            result: overrides.statusFails === true
              ? { ok: false as const, error: { code: 'internal' as const, message: 'unavailable' } }
              : { ok: true as const, value },
          })),
          install: installRpc,
        },
      },
    } as unknown as ConnectionHandle,
  }
}

describe('RuntimeSetupCard', () => {
  afterEach(cleanup)

  it('renders nothing once the runtime is present', async () => {
    const { connection } = stubConnection({ found: true })
    const { container } = render(
      <RuntimeSetupCard connection={connection} wide t={t} />,
    )
    await waitFor(() => { expect(container.querySelector('.card')).toBeNull() })
  })

  it('offers the one-click install when missing and calls it', async () => {
    const { connection, installRpc } = stubConnection({ found: false })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    const button = await screen.findByRole('button', { name: en['runtime.action'] })
    expect(screen.getByText(en['runtime.title'])).toBeTruthy()
    fireEvent.click(button)
    await waitFor(() => {
      expect(installRpc).toHaveBeenCalled()
    })
  })

  it('stays hidden while the host refuses to answer', async () => {
    // A refused status is not a missing runtime: the card must not claim an
    // install is needed when the host never said so.
    const { connection } = stubConnection({ found: false, statusFails: true })
    const { container } = render(<RuntimeSetupCard connection={connection} wide t={t} />)
    await waitFor(() => { expect(screen.queryByText(en['runtime.title'])).toBeNull() })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('leaves the card standing and re-enables the button when the host refuses the install', async () => {
    // The host owns the error state and the poll reports it; the button must
    // not stay disabled on a refusal the caller cannot act on.
    const { connection, installRpc } = stubConnection({ found: false, installFails: true })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    const button = await screen.findByRole('button', { name: en['runtime.action'] })
    fireEvent.click(button)
    await waitFor(() => { expect(installRpc).toHaveBeenCalled() })
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
    expect(screen.getByText(en['runtime.title'])).toBeTruthy()
  })

  it('reports the finished install once the phase settles', async () => {
    const { connection } = stubConnection({ found: false, phase: 'done' })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    expect(await screen.findByText(en['runtime.done'])).toBeTruthy()
  })

  it('keeps its action reachable in the compact sidebar layout', async () => {
    // The card renders at two sidebar widths; the compact one drops the wide
    // layout flag and must still offer the same single action.
    const { connection } = stubConnection({ found: false })
    render(<RuntimeSetupCard connection={connection} wide={false} t={t} />)
    expect(await screen.findByRole('button', { name: en['runtime.action'] })).toBeTruthy()
    expect(screen.getByText(en['runtime.title'])).toBeTruthy()
  })

  it('shows the host error text for a failed install phase', async () => {
    const { connection } = stubConnection({ found: false, phase: 'error', error: 'disk full' })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    expect(await screen.findByText(en['runtime.errorTitle'])).toBeTruthy()
    expect(screen.getByText('disk full')).toBeTruthy()
  })

  it('falls back to the generic error body when the host names no reason', async () => {
    const { connection } = stubConnection({ found: false, phase: 'error' })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    expect(await screen.findByText(en['runtime.errorBody'])).toBeTruthy()
  })

  it('prefers the host message over the percentage while downloading', async () => {
    const { connection } = stubConnection({ found: false, phase: 'downloading', progress: 0.42, message: 'fetching 12 of 40 MB' })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    expect(await screen.findByText('fetching 12 of 40 MB')).toBeTruthy()
    expect(screen.queryByText(/42%/)).toBeNull()
  })

  it('polls the status while an install runs and stops once it settles', async () => {
    vi.useFakeTimers()
    try {
      const { connection } = stubConnection({ found: false, phase: 'installing', progress: 0.5 })
      const statusRpc = (connection.api as unknown as { officeRuntime: { status: Mock } }).officeRuntime.status
      render(<RuntimeSetupCard connection={connection} wide t={t} />)
      await vi.waitFor(() => { expect(statusRpc).toHaveBeenCalledTimes(1) })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(statusRpc.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers the install button when a guided platform names no guide page', async () => {
    // Guided but linkless: the card must still offer the one action it has.
    const { connection } = stubConnection({ found: false, managedSupported: false })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    expect(await screen.findByRole('button', { name: en['runtime.action'] })).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows progress while downloading', async () => {
    const { connection } = stubConnection({ found: false, phase: 'downloading', progress: 0.42 })
    render(
      <RuntimeSetupCard connection={connection} wide t={t} />,
    )
    await screen.findByRole('progressbar')
    expect(screen.getByText(/42%/)).toBeTruthy()
  })

  it('links to the guide page on platforms without the automatic flow', async () => {
    const { connection } = stubConnection({ found: false, managedSupported: false, guideUrl: 'https://www.libreoffice.org/download/download-libreoffice/' })
    render(
      <RuntimeSetupCard connection={connection} wide t={t} />,
    )
    const link = await screen.findByRole('link', { name: en['runtime.guide'] })
    expect(link.getAttribute('href')).toBe('https://www.libreoffice.org/download/download-libreoffice/')
  })
})
