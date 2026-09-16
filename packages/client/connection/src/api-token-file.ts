/**
 * Durable storage for this installation's host API token.
 *
 * The token is what keeps "reachable over loopback" from meaning "authorized":
 * it is the credential other local processes do not hold. Minting one per boot
 * satisfies that and costs something a local app cannot pay. A page loaded
 * before a restart still presents the retired token, so the fence refuses
 * every request it makes — and because a refused request carries no
 * user-facing state, the app renders as though the user's sessions were gone.
 * Restarting is routine (an upgrade, a reboot, a config change), so the
 * credential outlives the process instead.
 *
 * The file is owner-only, inside a home directory the harness already creates
 * owner-only. A process running as the same user can therefore read it, which
 * the per-boot design prevented; that process can already read this
 * directory's credentials, settings, and session logs, so the token grants no
 * reach it did not have. What the fence still refuses is what it was built to
 * refuse: another origin's page, a rebound Host name, and every other user on
 * the machine.
 *
 * @module client-connection/api-token-file
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { createApiToken } from './api-request-trust.ts'

/** The stored token's own name inside the harness home. */
export const API_TOKEN_FILE_NAME = '.api-token'

/**
 * A stored value is reusable only on the terms a configured pin must meet:
 * the same alphabet and length floor the server validates against. A file
 * holding anything else is treated as absent, so a truncated or hand-edited
 * token recovers by re-minting instead of wedging every request to 403.
 */
const STORED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,}$/

/** Owner-only file and directory: the token is a credential, not a setting. */
const TOKEN_FILE_MODE = 0o600
const TOKEN_DIR_MODE = 0o700

/** The credential {@link loadOrCreateApiToken} resolved, and whether it outlives the process. */
export interface ResolvedApiToken {
  /** The token the request fence verifies against. */
  token: string
  /** True when the token was read from, or written to, the durable file. */
  durable: boolean
}

/**
 * Read this installation's token, minting and storing one on first use.
 *
 * A storage failure is deliberately not fatal. The caller still receives a
 * usable token for this process and the next boot mints another, which is
 * exactly the behavior that would apply anyway if the write could not happen —
 * so refusing to start would trade a degraded restart for an outage.
 * @param path - the token file to read or create.
 * @returns the token, and whether it is durable.
 */
export async function loadOrCreateApiToken(path: string): Promise<ResolvedApiToken> {
  const stored = await readStoredToken(path)
  if (stored !== undefined) return { token: stored, durable: true }
  const token = createApiToken()
  try {
    await writeFileAtomic(path, `${token}\n`, { mode: TOKEN_FILE_MODE, dirMode: TOKEN_DIR_MODE })
    return { token, durable: true }
  } catch {
    // Swallowed: an unwritable home (read-only mount, foreign ownership) must
    // not stop the harness from serving. `durable: false` is the whole report,
    // and the caller decides whether that is worth a warning.
    return { token, durable: false }
  }
}

/**
 * The stored token when the file holds a usable one.
 *
 * A missing file, an unreadable file, and unreadable content are one outcome
 * here — no stored token. The caller mints and overwrites, so damage recovers
 * on the next boot rather than permanently refusing every request.
 * @param path - the token file to read.
 * @returns the stored token, or undefined when there is none to reuse.
 */
async function readStoredToken(path: string): Promise<string | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    // Swallowed: ENOENT on first run is the expected path, and any other
    // failure (permissions, a directory in the way) is reported the same way —
    // by minting and trying to write, which surfaces it as `durable: false`.
    return undefined
  }
  const token = raw.trim()
  return STORED_TOKEN_PATTERN.test(token) ? token : undefined
}
