import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { settingsNamespace, SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import WhaleMcpService, { name as PLUGIN_NAME } from '../src/index.ts'
import { decideMcpApproval, mcpAskReason, MCP_TOOL_PREFIX } from '../src/approval.ts'
import { McpSettingsSchema, mountFingerprint, toBridgeConfig } from '../src/config.ts'
import type { McpServerEntry, McpSettings } from '../src/config.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

// ---- approval unit tests ----

function execOf(name: string, events: readonly unknown[] = []): ToolExecution {
  return {
    name,
    arguments: {},
    signal: new AbortController().signal,
    agent: { session: { events } },
  } as unknown as ToolExecution
}

function auditPair(id: string, reason: string, outcome: string): readonly unknown[] {
  return [
    { type: 'approval/asked', data: { id, reason } },
    { type: 'approval/decided', data: { id, outcome } },
  ]
}

describe('decideMcpApproval', () => {
  it('leaves non-MCP tools alone', () => {
    expect(decideMcpApproval(execOf('bash'), new Set(['bash']))).toBeUndefined()
    expect(decideMcpApproval(execOf('write'), new Set(['write']))).toBeUndefined()
  })

  it('asks on first use with a reason naming the tool and configured server', () => {
    const decision = decideMcpApproval(execOf('mcp__github__create_issue'), new Set(['github']))
    expect(decision).toEqual({ kind: 'ask', reason: 'run MCP tool "mcp__github__create_issue" from server "github"?' })
  })

  it('stands down under the never-prompt policy', () => {
    const events = [{ type: 'approval/policy', data: { policy: 'never' } }]
    expect(decideMcpApproval(execOf('mcp__a__b', events), new Set(['a']))).toBeUndefined()
  })

  it('does not re-ask within the session once allowed-once for the same reason', () => {
    const tool = 'mcp__web__search'
    const servers = new Set(['web'])
    const reason = mcpAskReason(tool, servers)
    const events = auditPair('ask-1', reason, 'allowed-once')
    expect(decideMcpApproval(execOf(tool, events), servers)).toBeUndefined()
  })

  it('keeps asking after a rejected or cancelled ask', () => {
    const tool = 'mcp__web__search'
    const servers = new Set(['web'])
    const reason = mcpAskReason(tool, servers)
    for (const outcome of ['rejected', 'cancelled']) {
      const events = auditPair('ask-1', reason, outcome)
      expect(decideMcpApproval(execOf(tool, events), servers)).toMatchObject({ kind: 'ask' })
    }
  })

  it('scopes the grant per tool, not per server', () => {
    const servers = new Set(['web'])
    const allowed = mcpAskReason('mcp__web__search', servers)
    const events = auditPair('ask-1', allowed, 'allowed-once')
    expect(decideMcpApproval(execOf('mcp__web__fetch', events), servers)).toMatchObject({ kind: 'ask' })
  })

  it('attributes tools by literal configured prefix, longest match first', () => {
    // A server named `a__b` registers `mcp__a__b__t`; splitting the name at
    // the first `__` would misattribute it to a server `a`. Both configured,
    // each tool must name its own server.
    const servers = new Set(['a', 'a__b'])
    expect(mcpAskReason('mcp__a__b__t', servers)).toBe('run MCP tool "mcp__a__b__t" from server "a__b"?')
    expect(mcpAskReason('mcp__a__t', servers)).toBe('run MCP tool "mcp__a__t" from server "a"?')
  })

  it('asks without a server clause for a tool no configured server owns', () => {
    expect(mcpAskReason('mcp__gone__t', new Set(['web']))).toBe('run MCP tool "mcp__gone__t"?')
  })
})

// ---- config unit tests ----

const stdioEntry: McpServerEntry = {
  id: 'srv-1',
  name: 'files',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'server-files'],
  env: { TOKEN: 't' },
  cwd: '/tmp',
  url: '',
  headers: {},
  toolCallTimeoutMs: 5000,
}

describe('toBridgeConfig / mountFingerprint', () => {
  it('maps a stdio entry with failOnStartupError so failures are observable', () => {
    const config = toBridgeConfig(stdioEntry)
    expect(config).toMatchObject({
      transport: 'stdio', serverName: 'files', command: 'npx',
      args: ['-y', 'server-files'], env: { TOKEN: 't' }, cwd: '/tmp',
      toolCallTimeoutMs: 5000, failOnStartupError: true,
    })
  })

  it('maps a streamable-http entry', () => {
    const config = toBridgeConfig({ ...stdioEntry, transport: 'streamable-http', url: 'http://x/mcp', headers: { Authorization: 'Bearer t' } })
    expect(config).toMatchObject({ transport: 'streamable-http', url: 'http://x/mcp', headers: { Authorization: 'Bearer t' } })
  })

  it('carries the manager-owned startup bound into the bridge config', () => {
    // Omitted at the pure-projection level (fingerprints stay mount-stable);
    // the manager always passes its bound at mount time.
    expect(toBridgeConfig(stdioEntry).startupTimeoutMs).toBeUndefined()
    expect(toBridgeConfig(stdioEntry, 250).startupTimeoutMs).toBe(250)
  })

  it('fingerprints bridge-relevant fields only: edits remount, name edits included', () => {
    expect(mountFingerprint(stdioEntry)).toBe(mountFingerprint({ ...stdioEntry, id: 'other' }))
    expect(mountFingerprint(stdioEntry)).not.toBe(mountFingerprint({ ...stdioEntry, name: 'files2' }))
    expect(mountFingerprint(stdioEntry)).not.toBe(mountFingerprint({ ...stdioEntry, args: [] }))
  })
})

// ---- integration: settings-driven mounts over a real stdio server ----

/** Minimal in-memory provider so the settings seam exists without a document file. */

/* jscpd:ignore-start */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(
    ctx: ConstructorParameters<typeof SettingsProvider>[0],
    options?: { doc?: Record<string, unknown> },
  ) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean { return true }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
  }
}
/* jscpd:ignore-end */

/** Writes a newline-delimited JSON-RPC MCP fixture server and returns its launch entry. */
async function writeEchoFixture(): Promise<{ entry: McpServerEntry; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'whale-mcp-'))
  const script = [
    'let buffer = ""',
    'const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n")',
    'process.stdin.on("data", (chunk) => {',
    '  buffer += chunk',
    '  let index',
    '  while ((index = buffer.indexOf("\\n")) !== -1) {',
    '    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)',
    '    if (!line.trim()) continue',
    '    let msg; try { msg = JSON.parse(line) } catch { continue }',
    '    if (msg.method === "initialize") {',
    '      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1.0.0" } } })',
    '    } else if (msg.method === "tools/list") {',
    '      send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "Echo.", inputSchema: { type: "object", properties: { message: { type: "string" } } } }] } })',
    '    } else if (msg.method === "tools/call") {',
    '      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo:${msg.params.arguments.message}` }] } })',
    '    }',
    '  }',
    '})',
  ].join('\n')
  const scriptPath = join(dir, 'echo-server.mjs')
  await writeFile(scriptPath, script)
  return {
    dir,
    entry: {
      id: 'srv-echo', name: 'whale', enabled: true, transport: 'stdio',
      command: process.execPath, args: [scriptPath], env: {}, cwd: '',
      url: '', headers: {}, toolCallTimeoutMs: 10_000,
    },
  }
}

/** A server process that stays alive but never answers `initialize` — the deterministic stand-in for a hanging external server. */
async function writeHangingFixture(): Promise<{ entry: McpServerEntry; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'whale-mcp-hang-'))
  const script = [
    'process.stdin.resume()',
    'setTimeout(() => process.exit(0), 15_000).unref()',
  ].join('\n')
  const scriptPath = join(dir, 'hang-server.mjs')
  await writeFile(scriptPath, script)
  return {
    dir,
    entry: {
      id: 'srv-hang', name: 'hang', enabled: true, transport: 'stdio',
      command: process.execPath, args: [scriptPath], env: {}, cwd: '',
      url: '', headers: {}, toolCallTimeoutMs: 10_000,
    },
  }
}

async function harness(doc: Record<string, unknown> = {}): Promise<{
  ctx: Context
  manager: WhaleMcpService
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemorySettings, { doc })
  await ctx.plugin(WhaleMcpService)
  return { ctx, manager: ctx.get('mcpStatus') as WhaleMcpService }
}

/** Poll the manager snapshot until the named predicate holds (or time out). */
async function until(manager: WhaleMcpService, id: string, state: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const row = manager.list().servers.find(server => server.id === id)
    if (row !== undefined && row.state === state) return
    if (Date.now() > deadline) {
      throw new Error(`server ${id} never reached ${state}: ${JSON.stringify(manager.list())}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** The manager's live cell map — cells are internal, tests observe them through this narrow cast. */
function cellsOf(manager: WhaleMcpService): Map<string, unknown> {
  return (manager as unknown as { cells: Map<string, unknown> }).cells
}

/** Poll until the internal cell map satisfies the predicate (or time out). */
async function untilCells(manager: WhaleMcpService, predicate: (cells: Map<string, unknown>) => boolean): Promise<void> {
  const deadline = Date.now() + 15_000
  while (!predicate(cellsOf(manager))) {
    if (Date.now() > deadline) throw new Error(`cells never settled: ${JSON.stringify(manager.list())}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

describe('WhaleMcpService', () => {
  it('exposes the mcpStatus Remote with list and restart', async () => {
    const { manager } = await harness()
    expect(PLUGIN_NAME).toBe('whale-mcp')
    expect(manager.typertRemote).toMatchObject({ serviceKey: 'mcpStatus', namespace: 'mcpStatus' })
    expect(remoteMethods(manager).map(method => method.method).sort()).toEqual(['list', 'restart'])
  })

  it('registers tools from the saved section and reports them with status', async () => {
    const { entry, dir } = await writeEchoFixture()
    try {
      const { ctx, manager } = await harness()
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry)] } as McpSettings)
      await until(manager, entry.id, 'connected')

      const names = ctx.tools.schemas().map(schema => schema.name)
      expect(names).toContain('mcp__whale__echo')

      const row = manager.list().servers[0]
      expect(row).toMatchObject({ name: 'whale', transport: 'stdio', state: 'connected', enabled: true })
      expect(row?.toolNames).toEqual(['mcp__whale__echo'])
      expect(row?.target).toContain('echo-server.mjs')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('calls through to the server under the namespaced name', async () => {
    const { entry, dir } = await writeEchoFixture()
    try {
      const { ctx, manager } = await harness()
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry)] } as McpSettings)
      await until(manager, entry.id, 'connected')
      const definition = ctx.tools.get('mcp__whale__echo')
      expect(definition).toBeDefined()
      const echoArgs = { message: 'hi' }
      const runContext = { signal: new AbortController().signal } as ToolRunContext
      const runTool = definition!.execute.bind(definition!)
      const result = await runTool(echoArgs, runContext)
      expect(JSON.stringify(result)).toContain('echo:hi')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('records a failed status for a server that cannot start, without blocking others', async () => {
    const { entry, dir } = await writeEchoFixture()
    try {
      const { ctx, manager } = await harness()
      const broken: McpServerEntry = { ...structuredClone(entry), id: 'srv-bad', name: 'bad', command: 'definitely-not-a-binary-xyz' }
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry), broken] } as McpSettings)
      await until(manager, entry.id, 'connected')
      await until(manager, broken.id, 'failed')
      const rows = new Map(manager.list().servers.map(row => [row.id, row]))
      expect(rows.get(entry.id)?.state).toBe('connected')
      expect(rows.get(broken.id)?.error).toBeTruthy()
      expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mcp__whale__echo')
      expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('mcp__bad__echo')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps a server named a__b unambiguous end-to-end: registry, status grouping, and approval', async () => {
    const { entry, dir } = await writeEchoFixture()
    try {
      const { ctx, manager } = await harness()
      const ambiguous = { ...structuredClone(entry), id: 'srv-amb', name: 'a__b' }
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry), ambiguous] } as McpSettings)
      await until(manager, entry.id, 'connected')
      await until(manager, ambiguous.id, 'connected')

      // Registry names: each server's tool lives under its own literal prefix.
      const names = ctx.tools.schemas().map(schema => schema.name)
      expect(names).toContain('mcp__a__b__echo')
      expect(names).toContain('mcp__whale__echo')

      // Status grouping by configured literal prefix, never first-delimiter parsing.
      const rows = new Map(manager.list().servers.map(row => [row.name, row]))
      expect(rows.get('a__b')?.toolNames).toEqual(['mcp__a__b__echo'])
      expect(rows.get('whale')?.toolNames).toEqual(['mcp__whale__echo'])

      // The live fence attributes the tool to `a__b`, not to a server `a`.
      // The runtime dispatches through a scoped carrier (scopeTarget); an
      // unscoped execution passes the unscoped runtime as the thisArg.
      const decision = await ctx.waterfall(
        ctx.tools as never,
        'tools/pre-execute',
        execOf('mcp__a__b__echo'),
        () => Promise.resolve({ kind: 'allow' } as const),
      )
      expect(decision).toEqual({ kind: 'ask', reason: 'run MCP tool "mcp__a__b__echo" from server "a__b"?' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('bounds a hanging startup: a healthy later server still mounts and the queue stays responsive', async () => {
    const { entry: hanging, dir: hangDir } = await writeHangingFixture()
    const { entry, dir } = await writeEchoFixture()
    try {
      const { ctx, manager } = await harness()
      manager.startupTimeoutMs = 400
      // The hanging server is FIRST in the section: serialized mounts would
      // strand the healthy one behind it without a bounded startup.
      await ctx.settings.update(settingsNamespace('mcp'), {
        servers: [structuredClone(hanging), structuredClone(entry)],
      } as McpSettings)

      await until(manager, entry.id, 'connected')
      await until(manager, hanging.id, 'failed')
      const failed = manager.list().servers.find(row => row.id === hanging.id)
      expect(failed?.error).toContain('initial connection or tool synchronization failed')

      // Restart stays responsive: the remount attempt re-fails within the
      // bound and the snapshot comes back.
      const snapshot = await manager.restart({ id: hanging.id })
      expect(snapshot.servers.find(row => row.id === hanging.id)).toMatchObject({ state: 'failed' })

      // Reconcile stays responsive: a settings edit settles afterwards.
      await ctx.settings.update(settingsNamespace('mcp'), {
        servers: [{ ...structuredClone(hanging), enabled: false }, structuredClone(entry)],
      } as McpSettings)
      await until(manager, hanging.id, 'disabled')
      await until(manager, entry.id, 'connected')
      expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mcp__whale__echo')
    } finally {
      await rm(hangDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('drops cells for removed and failed-removed servers instead of accumulating tombstones', async () => {
    const { entry, dir } = await writeEchoFixture()
    try {
      const { ctx, manager } = await harness()
      const broken: McpServerEntry = { ...structuredClone(entry), id: 'srv-bad', name: 'bad', command: 'definitely-not-a-binary-xyz' }
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry), broken] } as McpSettings)
      await until(manager, entry.id, 'connected')
      await until(manager, broken.id, 'failed')
      // A still-configured enabled entry keeps its failed status.
      expect(manager.list().servers.find(row => row.id === broken.id)).toMatchObject({ state: 'failed' })

      // Removing both entries drops every record, including the failed one.
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [] } as McpSettings)
      await untilCells(manager, cells => cells.size === 0)
      expect(manager.list().servers).toEqual([])

      // Re-adding a previously removed id mounts fresh rather than showing a stale state.
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry)] } as McpSettings)
      await until(manager, entry.id, 'connected')
      expect(cellsOf(manager).size).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('unwinds tools on disable and remounts on restart', async () => {
    const { entry, dir } = await writeEchoFixture()
    try {
      const { ctx, manager } = await harness()
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry)] } as McpSettings)
      await until(manager, entry.id, 'connected')

      const disabled = { ...structuredClone(entry), enabled: false }
      await ctx.settings.update(settingsNamespace('mcp'), { servers: [disabled] } as McpSettings)
      await until(manager, entry.id, 'disabled')
      expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('mcp__whale__echo')

      await ctx.settings.update(settingsNamespace('mcp'), { servers: [structuredClone(entry)] } as McpSettings)
      await until(manager, entry.id, 'connected')

      const snapshot = await manager.restart({ id: entry.id })
      expect(snapshot.servers[0]).toMatchObject({ state: 'connected' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('runs with no settings service composed (headless): empty snapshot, no crash', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WhaleMcpService)
    const manager = ctx.get('mcpStatus') as WhaleMcpService
    expect(manager.list()).toEqual({ servers: [] })
  })
})

describe('McpSettingsSchema', () => {
  it('resolves an empty section to no servers', () => {
    const resolved = McpSettingsSchema({} as never) as McpSettings
    expect(resolved.servers).toEqual([])
  })
})

describe('MCP_TOOL_PREFIX', () => {
  it('matches the ecosystem shape', () => {
    expect(MCP_TOOL_PREFIX).toBe('mcp__')
  })
})
