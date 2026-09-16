/**
 * Egress gate for the anonymous HTTP(S) fetch provider: default-deny for
 * non-public destinations (SSRF / private-network blocking). Literal IPs are
 * judged against fixed blocklists (a security invariant, not deployment
 * tuning); hostnames resolve with `dns.lookup({ all: true })` and refuse
 * when ANY returned address is blocked, which defeats static malicious DNS.
 * WHATWG URL parsing already normalizes numeric-IP obfuscation
 * (`0x7f.0.0.1`, `2130706433`), so only canonical spellings reach the
 * checks below.
 *
 * Residual, stated honestly: the lookup and the later `fetch` are two
 * resolutions, so adversarial DNS that flips between them (rebinding) can
 * still win a race — closing that needs connect-to-the-validated-IP at the
 * transport layer. What this gate fully kills: literal private/loopback/
 * link-local/metadata targets, internal-resolving hostnames under stable
 * DNS, and per-hop redirect escapes (every hop re-validates).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/egress
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { WebError } from '@deepseek-ai/dsh-web'

/** DNS resolver shape: hostname to all known address literals. */
export type DnsLookup = (host: string) => Promise<readonly string[]>

/** `dns.lookup` with every address (v4+v6), verbatim order. */
async function lookupAllAddresses(host: string): Promise<readonly string[]> {
  const results = await dnsLookup(host, { all: true, order: 'verbatim' })
  return results.map(result => result.address)
}

/**
 * Canonical hostname spelling for comparison: lowercased, one trailing dot
 * removed, IPv6 brackets stripped.
 * @param hostname - a URL hostname.
 * @returns the normalized form.
 */
function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase()
  const dotted = lower.endsWith('.') ? lower.slice(0, -1) : lower
  return dotted.startsWith('[') && dotted.endsWith(']') ? dotted.slice(1, -1) : dotted
}

/**
 * Dotted quad to uint32. Precondition: `net.isIP(ip) === 4`, which guarantees
 * four 1–3-digit groups ≤ 255 — the guards below are unreachable and exist
 * so an input that somehow violates the contract refuses instead of
 * miscomputing.
 * @param ip - IPv4 literal.
 * @returns the address value, or undefined when malformed.
 */
function parseIPv4(ip: string): number | undefined {
  const parts = ip.split('.')
  /* v8 ignore next -- isIP(ip) === 4 guarantees exactly four groups. */
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    /* v8 ignore next -- isIP(ip) === 4 guarantees 1-3 digits per group. */
    if (!/^\d{1,3}$/.test(part)) return undefined
    const byte = Number.parseInt(part, 10)
    /* v8 ignore next -- isIP(ip) === 4 guarantees each group ≤ 255. */
    if (byte > 255) return undefined
    value = value * 256 + byte
  }
  return value
}

/**
 * IPv6 literal to a 128-bit bigint. Precondition: `net.isIP(ip) === 6`
 * (unbracketed, zoneless) — same unreachable-guard contract as
 * {@link parseIPv4}. Handles `::` compression (once), leading/trailing
 * `::`, and embedded IPv4 in the last 32 bits.
 * @param ip - IPv6 literal.
 * @returns the address value, or undefined when malformed.
 */
function parseIPv6(ip: string): bigint | undefined {
  const compression = ip.indexOf('::')
  /* v8 ignore next -- isIP(ip) === 6 rejects repeated '::'. */
  if (compression !== -1 && ip.indexOf('::', compression + 2) !== -1) return undefined
  const headText = compression === -1 ? ip : ip.slice(0, compression)
  const tailText = compression === -1 ? '' : ip.slice(compression + 2)
  const parseSide = (side: string): number[] | undefined => {
    if (side === '') return []
    const out: number[] = []
    for (const group of side.split(':')) {
      if (group.includes('.')) {
        // Embedded IPv4 occupies the last 32 bits.
        const inner = parseIPv4(group)
        /* v8 ignore next -- isIP(ip) === 6 guarantees a valid embedded quad. */
        if (inner === undefined) return undefined
        out.push(Math.floor(inner / 65536), inner % 65536)
      } else {
        /* v8 ignore next -- isIP(ip) === 6 guarantees 1-4 hex digits. */
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined
        out.push(Number.parseInt(group, 16))
      }
    }
    return out
  }
  const head = parseSide(headText)
  const tail = parseSide(tailText)
  /* v8 ignore next -- isIP(ip) === 6 guarantees parseable sides. */
  if (head === undefined || tail === undefined) return undefined
  /* v8 ignore next -- isIP(ip) === 6 guarantees at most 8 groups. */
  if (head.length + tail.length > 8) return undefined
  /* v8 ignore next -- a '::'-less valid literal has exactly 8 groups. */
  if (compression === -1 && head.length !== 8) return undefined
  const groups = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail]
  let value = 0n
  for (const group of groups) value = value * 65536n + BigInt(group)
  return value
}

/** Blocked IPv4 ranges as [base, prefixBits]: loopback, private, link-local, multicast, reserved, documentation, benchmark, CGNAT. */
const BLOCKED_V4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // "this network"
  [0x0a000000, 8], // RFC1918 private
  [0x64400000, 10], // CGNAT shared space
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local (cloud metadata lives here)
  [0xac100000, 12], // RFC1918 private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // TEST-NET-1 (documentation)
  [0xc0a80000, 16], // RFC1918 private
  [0xc6336400, 24], // TEST-NET-2 (documentation)
  [0xcb007100, 24], // TEST-NET-3 (documentation)
  [0xc6120000, 15], // benchmarking
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved (incl. broadcast)
]

/** Whether a uint32 IPv4 address falls in a blocked range. */
function isBlockedIPv4(value: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)))
}

/**
 * Whether one address literal is a non-public destination. IPv4-mapped,
 * compatible, 6to4, and NAT64 embeddings unwrap to their inner IPv4 and face
 * the v4 rules; Teredo, documentation, link-local, unique-local, and
 * multicast are refused outright. A zone id (`%eth0`) is link-local by
 * definition and refused. Unparseable literals refuse (fail closed).
 * @param ip - unbracketed address literal (may carry a `%zone`).
 * @returns true when the destination must not be fetched.
 */
export function isBlockedAddress(ip: string): boolean {
  if (ip.includes('%')) return true
  if (isIP(ip) === 4) {
    const value = parseIPv4(ip)
    return value === undefined || isBlockedIPv4(value)
  }
  if (isIP(ip) === 6) {
    const value = parseIPv6(ip.toLowerCase())
    /* v8 ignore next -- isIP(ip) === 6 guarantees parseability; unparseable refuses. */
    if (value === undefined) return true
    if (value >> 96n === 0x20010000n || value >> 96n === 0x20010db8n) return true // Teredo, documentation
    // Unwrap IPv4 embeddings to their inner address: compatible ::/96
    // (covers :: and ::1, which land in blocked 0/8 space), mapped
    // ::ffff:0:0/96, NAT64 64:ff9b::/96, and 6to4 2002::/16 (v4 in groups
    // 2–3, i.e. bits 64..95).
    const high96 = value >> 32n
    if (high96 === 0n || high96 === 0xffffn || high96 === 0x64ff9b0000000000000000n) {
      return isBlockedIPv4(Number(value & 0xffffffffn))
    }
    if (value >> 112n === 0x2002n) {
      return isBlockedIPv4(Number((value >> 64n) & 0xffffffffn))
    }
    if ((value & 0xffc00000000000000000000000000000n) === 0xfe800000000000000000000000000000n) return true // link-local
    if ((value & 0xfe000000000000000000000000000000n) === 0xfc000000000000000000000000000000n) return true // unique-local
    if ((value & 0xff000000000000000000000000000000n) === 0xff000000000000000000000000000000n) return true // multicast
    return false
  }
  return true
}

/**
 * Whether a hostname is explicitly allowlisted for private-destination
 * egress (operator opt-in for internal hosts such as dev servers).
 * @param host - the request hostname (any spelling; normalized here).
 * @param allowHosts - configured bare-host entries.
 * @returns true on exact normalized match.
 */
export function isAllowlisted(host: string, allowHosts: readonly string[]): boolean {
  const normal = normalizeHostname(host)
  return allowHosts.some(entry => normalizeHostname(entry) === normal)
}

/**
 * Refuse non-public fetch destinations. Literal IPs face
 * {@link isBlockedAddress}; hostnames resolve (every address, v4+v6) and
 * refuse when ANY address is blocked. A resolver failure falls through —
 * the subsequent fetch fails identically against the same resolver, so
 * there is nothing to validate. Expects a `validateFetchUrl`-passing URL.
 * @param url - the parsed request (initial or redirect-target) URL.
 * @param allowHosts - configured bare-host egress exceptions.
 * @param lookup - DNS resolver (injectable for hermetic tests).
 */
export async function assertEgressAllowed(
  url: URL,
  allowHosts: readonly string[],
  lookup: DnsLookup = lookupAllAddresses,
): Promise<void> {
  const host = normalizeHostname(url.hostname)
  if (isAllowlisted(host, allowHosts)) return
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new WebError(`refusing to fetch non-public address "${host}"`, 'WEB_BLOCKED_URL')
    }
    return
  }
  const addresses = await lookup(host).catch(() => undefined)
  if (addresses === undefined) return
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new WebError(`refusing to fetch "${host}": it resolves to a non-public address`, 'WEB_BLOCKED_URL')
    }
  }
}

/**
 * Validate configured egress exceptions at load: bare hosts only (no
 * scheme, credentials, path, query, or port — ports never participate in
 * matching, so `host:port` would be a silently useless grant).
 * @param entries - the configured `egressAllowHosts` value.
 */
export function assertEgressAllowHosts(entries: readonly string[]): void {
  for (const entry of entries) {
    const bare = entry.trim()
    if (bare === '' || bare !== entry || /[\s/@?#]/.test(entry)
      || (normalizeHostname(entry).includes(':') && isIP(normalizeHostname(entry)) === 0)) {
      throw new Error(`web-fetch-http: egressAllowHosts entries must be bare hosts, got ${JSON.stringify(entry)}`)
    }
  }
}
