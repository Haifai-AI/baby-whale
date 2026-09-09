/**
 * Egress gate: fixed blocklists for literal IPs (v4 ranges, v6 ranges and
 * IPv4 embeddings), DNS-resolve-then-validate for hostnames, and load-time
 * validation of the operator allowlist. DNS is injected in every test —
 * except `localhost`, which resolves via the hosts file with no network.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  assertEgressAllowed,
  assertEgressAllowHosts,
  isAllowlisted,
  isBlockedAddress,
} from '../src/egress.ts'

describe('isBlockedAddress', () => {
  it('blocks IPv4 loopback, private, link-local, and special ranges', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.1',
      '169.254.169.254', '0.0.0.0', '224.0.0.1', '255.255.255.255', '100.64.0.1',
      '192.0.0.1', '192.0.2.1', '198.51.100.7', '203.0.113.7', '198.18.0.1',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })

  it('blocks IPv6 loopback, link-local, unique-local, multicast, Teredo, documentation', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'ff02::1', '2001::1', '2001:db8::1']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('unwraps IPv4 embeddings and judges the inner address', () => {
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isBlockedAddress('::10.0.0.1')).toBe(true)
    expect(isBlockedAddress('2002:0a00:0001::')).toBe(true)
    expect(isBlockedAddress('64:ff9b::10.0.0.1')).toBe(true)
    expect(isBlockedAddress('64:ff9b::a00:1')).toBe(true)
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false)
    expect(isBlockedAddress('::8.8.8.8')).toBe(false)
    expect(isBlockedAddress('2002:0808:0808::')).toBe(false)
    expect(isBlockedAddress('64:ff9b::808:808')).toBe(false)
  })

  it('allows public IPv6, full and compressed', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
    expect(isBlockedAddress('1:2:3:4:5:6:7:8')).toBe(false)
  })

  it('refuses zone ids and non-addresses (fail closed)', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true)
    expect(isBlockedAddress('not-an-ip')).toBe(true)
  })
})

describe('isAllowlisted', () => {
  it('matches case-insensitively with trailing dots and brackets normalized', () => {
    expect(isAllowlisted('Example.COM.', ['example.com'])).toBe(true)
    expect(isAllowlisted('[::1]', ['::1'])).toBe(true)
    expect(isAllowlisted('x.com', [])).toBe(false)
    expect(isAllowlisted('x.com', ['y.com'])).toBe(false)
  })
})

describe('assertEgressAllowed', () => {
  it('rejects blocked literals without consulting DNS', async () => {
    const lookup = vi.fn(async (_host: string) => ['8.8.8.8'] as const)
    await expect(assertEgressAllowed(new URL('http://169.254.169.254/'), [], lookup))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(lookup).not.toHaveBeenCalled()
  })

  it('allows public literals without consulting DNS, brackets stripped', async () => {
    const lookup = vi.fn(async (_host: string) => [] as const)
    await expect(assertEgressAllowed(new URL('http://8.8.8.8/'), [], lookup)).resolves.toBeUndefined()
    await expect(assertEgressAllowed(new URL('http://[2606:4700:4700::1111]/'), [], lookup)).resolves.toBeUndefined()
    await expect(assertEgressAllowed(new URL('http://[::1]/'), [], lookup))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuses hostnames resolving to blocked addresses (any match blocks)', async () => {
    const lookup = vi.fn(async (host: string) => host === 'mixed.example' ? ['93.184.216.34', '10.0.0.1'] : ['10.0.0.1'])
    await expect(assertEgressAllowed(new URL('http://internal.example/'), [], lookup))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(lookup).toHaveBeenCalledWith('internal.example')
    await expect(assertEgressAllowed(new URL('http://mixed.example/'), [], lookup))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })

  it('allows hostnames resolving to public addresses', async () => {
    const lookup = vi.fn(async (_host: string) => ['93.184.216.34'])
    await expect(assertEgressAllowed(new URL('https://public.example/x'), [], lookup)).resolves.toBeUndefined()
  })

  it('falls through on resolver failure (the fetch fails identically)', async () => {
    const lookup = vi.fn(async (_host: string): Promise<readonly string[]> => { throw new Error('EAI_AGAIN') })
    await expect(assertEgressAllowed(new URL('https://typo.invalid/'), [], lookup)).resolves.toBeUndefined()
  })

  it('short-circuits allowlisted hosts before DNS', async () => {
    const lookup = vi.fn(async (_host: string) => ['127.0.0.1'])
    await expect(assertEgressAllowed(new URL('http://internal.example/'), ['Internal.Example.'], lookup))
      .resolves.toBeUndefined()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('blocks localhost through the real resolver (hosts file, no network)', async () => {
    await expect(assertEgressAllowed(new URL('http://localhost:3000/'), []))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })
})

describe('assertEgressAllowHosts', () => {
  it('accepts bare hostnames and IP literals', () => {
    expect(() => { assertEgressAllowHosts([]) }).not.toThrow()
    expect(() => { assertEgressAllowHosts(['example.com', 'internal', '10.0.0.5', '::1', '[::1]']) }).not.toThrow()
  })

  it('rejects empty, padded, and non-bare entries', () => {
    for (const entry of ['', '  ', ' padded ', 'http://x', 'a/b', 'user@h', 'a?b', 'a#b', 'h:8080', '1::2::3']) {
      expect(() => { assertEgressAllowHosts([entry]) }, entry).toThrow('egressAllowHosts')
    }
  })
})
