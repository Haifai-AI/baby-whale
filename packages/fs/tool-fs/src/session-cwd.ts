/**
 * The filesystem tools' working-directory rule: resolve against the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`), so each
 * session's `read`/`write`/`edit` acts on ITS workspace, not the server's
 * launch dir. The rule is shared with the other path-resolving tool families
 * (`dsh-sandbox/session-cwd`) so they cannot drift.
 * @module @deepseek-ai/dsh-tool-fs/session-cwd
 */

export { sessionCwd, sessionResolveOptions } from '@deepseek-ai/dsh-sandbox'
