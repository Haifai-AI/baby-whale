// @vitest-environment jsdom
/**
 * RuntimeSetupCard behavior: hidden when the runtime is present; ambient
 * card with a working Set-up button when it is not; guided link on
 * platforms without the automatic flow.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
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
}

function stubConnection(overrides: StatusOverrides = {}): ConnectionHandle {
  const value = {
    soffice: { found: overrides.found ?? false, source: overrides.found === true ? 'system' : 'none' },
    install: { phase: overrides.phase ?? 'idle', progress: overrides.progress ?? 0 },
    managedSupported: overrides.managedSupported ?? true,
    ...(overrides.guideUrl !== undefined ? { guideUrl: overrides.guideUrl } : {}),
  }
  return {
    isLoopback: true,
    hostDescription: 'stub',
    api: {
      officeRuntime: {
        status: vi.fn(() => Promise.resolve({ rpcId: 'x' as never, result: { ok: true as const, value } })),
        install: vi.fn(() => Promise.resolve({ rpcId: 'x' as never, result: { ok: true as const, value: { install: value.install } } })),
      },
    },
  } as unknown as ConnectionHandle
}

describe('RuntimeSetupCard', () => {
  afterEach(cleanup)

  it('renders nothing once the runtime is present', async () => {
    const { container } = render(
      <RuntimeSetupCard connection={stubConnection({ found: true })} wide t={t} />,
    )
    await waitFor(() => expect(container.querySelector('.card')).toBeNull())
  })

  it('offers the one-click install when missing and calls it', async () => {
    const connection = stubConnection({ found: false })
    render(<RuntimeSetupCard connection={connection} wide t={t} />)
    const button = await screen.findByRole('button', { name: en['runtime.action'] })
    expect(screen.getByText(en['runtime.title'])).toBeTruthy()
    fireEvent.click(button)
    await waitFor(() => {
      expect((connection.api.officeRuntime.install as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    })
  })

  it('shows progress while downloading', async () => {
    render(
      <RuntimeSetupCard
        connection={stubConnection({ found: false, phase: 'downloading', progress: 0.42 })}
        wide
        t={t}
      />,
    )
    await screen.findByRole('progressbar')
    expect(screen.getByText(/42%/)).toBeTruthy()
  })

  it('links to the guide page on platforms without the automatic flow', async () => {
    render(
      <RuntimeSetupCard
        connection={stubConnection({ found: false, managedSupported: false, guideUrl: 'https://www.libreoffice.org/download/download-libreoffice/' })}
        wide
        t={t}
      />,
    )
    const link = await screen.findByRole('link', { name: en['runtime.guide'] })
    expect(link.getAttribute('href')).toBe('https://www.libreoffice.org/download/download-libreoffice/')
  })
})
