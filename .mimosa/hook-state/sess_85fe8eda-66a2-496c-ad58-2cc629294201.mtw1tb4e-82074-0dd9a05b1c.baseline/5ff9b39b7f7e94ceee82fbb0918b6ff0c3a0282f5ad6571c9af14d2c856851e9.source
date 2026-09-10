/**
 * The E2B control-plane URL, derived the way the SDK derives it.
 * @module @deepseek-ai/dsh-e2b/src/api-url.ts
 */
/**
 * The control-plane URL the SDK will actually call, derived the way the SDK derives it: an explicit
 * `E2B_API_URL` first, then the debug substitute, then the domain default. Choosing a proxy for
 * anything else would pick the wrong scheme's proxy, ignore a bypass entry naming the real host, and
 * — for the loopback debug plane — hand a proxy the control-plane traffic and its API key.
 *
 * @param env - the process environment to read; overridable so tests need no ambient state.
 * @returns the absolute control-plane URL.
 */
export declare function e2bApiUrl(env?: NodeJS.ProcessEnv): string;
//# sourceMappingURL=api-url.d.ts.map