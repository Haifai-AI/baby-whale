/**
 * First-party host API credential. The server mints a per-instance token and
 * hands it to the operator's browser exactly once — as the `#token=…`
 * fragment of the entry URL — because any token served over HTTP would be
 * readable by the same local processes it must keep out. The fragment never
 * reaches the server (fragments stay client-side), so the page captures it
 * into tab-scoped storage, scrubs it from the address bar, and presents it
 * on every API call: an `Authorization` header for fetch, a `token` query
 * parameter where headers cannot go (WebSocket upgrades, subresource URLs).
 * @module @deepseek-ai/dsh-client-connection/api-token
 */

/** Tab-scoped storage key for the captured instance token. */
const STORAGE_KEY = 'dsh.apiToken'

/**
 * Capture the entry-URL token into tab storage and scrub it from the address
 * bar, so shoulder-surfed history and copied links carry no credential.
 * @returns the captured token, when the URL carries one.
 */
function captureFragmentToken(): string | undefined {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return undefined
  const match = /[#&]token=([^&#]*)/.exec(window.location.hash)
  const token = match?.[1] === undefined || match[1].length === 0 ? undefined : match[1]
  if (token === undefined) return undefined
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // Storage or history unavailable (locked-down contexts): the in-URL
    // token still authenticates this page load via the return below.
  }
  return token
}

/**
 * The instance token for this tab: stored capture, else the entry-URL
 * fragment. Undefined on fixture transports and token-less navigations —
 * those callers fail the server fence rather than sending a guess.
 * @returns the token, or undefined when this tab holds none.
 */
export function resolveApiToken(): string | undefined {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      if (stored !== null && stored.length > 0) return stored
    }
  } catch {
    // Storage unavailable: fall through to the fragment.
  }
  return captureFragmentToken()
}

/**
 * Append the instance token to a URL that cannot carry headers (WebSocket
 * upgrades, `<img>`/`<video>` subresource URLs). Token-less callers pass the
 * URL through unchanged and fail the server fence.
 * @param url - the request URL, with or without an existing query.
 * @returns the URL with the `token` parameter, or unchanged without a token.
 */
export function withApiTokenQuery(url: string): string {
  const token = resolveApiToken()
  if (token === undefined) return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${token}`
}
