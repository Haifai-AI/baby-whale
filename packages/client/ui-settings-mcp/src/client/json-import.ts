/**
 * Ecosystem JSON import for the MCP servers tab: a claude_desktop_config-style
 * `{ "mcpServers": { name: cfg } }` block or a bare `{ name: cfg }` map becomes
 * new section entries. Names are legalized to the model-facing contract and
 * collision-suffixed against the names already saved.
 * @module settings.mcp/json-import
 */

import type { McpServerEntryView } from './McpSettingsTab.tsx'

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** New id for a server entry; falls back off the secure-context UUID. */
export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Smallest positive integer suffix making `stem-suffix` unused. */
function nextSuffix(stem: string, used: ReadonlySet<string>): string {
  for (let n = 2; ; n += 1) {
    if (!used.has(`${stem.slice(0, 30)}-${n}`)) return String(n)
  }
}

/** Keep a model-legal, unused namespace for a pasted server key. */
function legalizeName(raw: string, used: Set<string>, index: number): string {
  let name = raw.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 32)
  if (!NAME_PATTERN.test(name)) name = `server-${index + 1}`
  while (used.has(name)) {
    if (!/-\d+$/.test(name)) name = `${name.slice(0, 30)}-2`
    while (used.has(name)) {
      const stem = name.replace(/-\d+$/, '')
      name = `${stem.slice(0, 30)}-${nextSuffix(stem, used)}`
    }
  }
  used.add(name)
  return name
}

/** String-valued object fields only; everything else is dropped. */
function stringRecord(field: unknown): Record<string, string> {
  if (typeof field !== 'object' || field === null || Array.isArray(field)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(field as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

/**
 * Parse pasted ecosystem JSON into new section entries.
 * @param text - the pasted JSON text.
 * @param existingNames - server names already saved (collisions get suffixed).
 * @returns entries on success, or the parse failure reason.
 */
export function parseImport(text: string, existingNames: ReadonlySet<string>):
  { ok: true; entries: McpServerEntryView[] } | { ok: false; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'expected a JSON object' }
  }
  const root = parsed as Record<string, unknown>
  const map = (typeof root.mcpServers === 'object' && root.mcpServers !== null && !Array.isArray(root.mcpServers)
    ? root.mcpServers
    : root) as Record<string, unknown>
  const entries: McpServerEntryView[] = []
  const used = new Set(existingNames)
  for (const [name, value] of Object.entries(map)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const cfg = value as Record<string, unknown>
    const command = typeof cfg.command === 'string' ? cfg.command : ''
    const url = typeof cfg.url === 'string' ? cfg.url : ''
    if (command.length === 0 && url.length === 0) continue
    const args = Array.isArray(cfg.args)
      ? cfg.args.map(arg => String(arg))
      : typeof cfg.args === 'string'
        ? cfg.args.split(/\s+/).filter(part => part.length > 0)
        : []
    entries.push({
      id: newId(),
      name: legalizeName(name, used, entries.length),
      enabled: cfg.disabled !== true,
      transport: command.length > 0 ? 'stdio' : 'streamable-http',
      command,
      args,
      env: stringRecord(cfg.env),
      cwd: typeof cfg.cwd === 'string' ? cfg.cwd : '',
      url,
      headers: stringRecord(cfg.headers),
      toolCallTimeoutMs: 60_000,
    })
  }
  return { ok: true, entries }
}
