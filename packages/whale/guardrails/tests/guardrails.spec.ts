/**
 * Guardrails behavior tests: the overwrite ask decision, the monotonic
 * workspace-escape denial, and the untrusted-content guidance registration.
 * @module @deepseek-ai/dsh-whale-guardrails/tests/guardrails
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import * as Guardrails from '../src/index.ts'

function execution(name: string, args: unknown): ToolExecution {
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    token: 't' as never,
    name,
    arguments: args,
    signal: new AbortController().signal,
  }
}

const root = mkdtempSync(join(tmpdir(), 'whale-guardrails-'))
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

/** Boot the plugin over a real local filesystem backend and fake registries. */
async function booted(): Promise<{ ctx: Context; recorded: (exec: ToolExecution) => string | undefined; sections: string[] }> {
  const ctx = new Context()
  let recorded: ((exec: ToolExecution) => string | undefined) | undefined
  const sections: string[] = []
  // LocalFileSystem registers itself as `fs` on construction (root fiber).
  new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 })
  ctx.provide('systemPrompt', { section: (entry: { text: string }) => { sections.push(entry.text) } })
  ctx.provide('tools', {
    guard: (guard: (exec: ToolExecution) => string | undefined) => {
      recorded = guard
      return () => {}
    },
  })
  await ctx.plugin(Guardrails)
  return { ctx, recorded: exec => recorded?.(exec), sections }
}

describe('whale-guardrails', () => {
  it('asks before overwriting an existing target', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    mkdirSync(join(root, 'sub'), { recursive: true })
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('write', { file_path: 'existing.txt' }),
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
  })

  it('allows a write to a fresh path', async () => {
    const { ctx } = await booted()
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('write', { file_path: 'fresh.txt' }),
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('does not ask for unguarded tool names', async () => {
    const { ctx } = await booted()
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'ls' }),
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('denies parent traversal monotonically', async () => {
    const { recorded } = await booted()
    const reason = recorded(execution('xlsx_create', { file_path: '../outside.xlsx' }))
    expect(reason).toContain('escapes the session workspace')
    expect(recorded(execution('xlsx_create', { file_path: 'deliverables/in.xlsx' }))).toBeUndefined()
  })


  it('does not re-ask once this session allowed the same overwrite', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const reason = 'overwrite existing file "existing.txt"?'
    const session = {
      header: { cwd: root },
      events: [
        { type: 'approval/asked', data: { id: 'a1', toolName: 'write', reason } },
        { type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } },
      ],
    }
    const exec: ToolExecution = {
      ...execution('write', { file_path: 'existing.txt' }),
      agent: { session } as never,
    }
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('a rejected overwrite decision keeps asking', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const reason = 'overwrite existing file "existing.txt"?'
    const session = {
      header: { cwd: root },
      events: [
        { type: 'approval/asked', data: { id: 'a2', toolName: 'write', reason } },
        { type: 'approval/decided', data: { id: 'a2', outcome: 'rejected' } },
      ],
    }
    const exec: ToolExecution = {
      ...execution('write', { file_path: 'existing.txt' }),
      agent: { session } as never,
    }
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'ask', reason })
  })

  it('a different path still asks even after an approval for another file', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    writeFileSync(join(root, 'other.txt'), 'x')
    const session = {
      header: { cwd: root },
      events: [
        { type: 'approval/asked', data: { id: 'a3', toolName: 'write', reason: 'overwrite existing file "other.txt"?' } },
        { type: 'approval/decided', data: { id: 'a3', outcome: 'allowed-once' } },
      ],
    }
    const exec: ToolExecution = {
      ...execution('write', { file_path: 'existing.txt' }),
      agent: { session } as never,
    }
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
  })


  it('stands down under the never-prompt policy (danger-full-access)', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const session = {
      header: { cwd: root },
      events: [
        { type: 'approval/policy', data: { policy: 'never' } },
      ],
    }
    const exec: ToolExecution = {
      ...execution('write', { file_path: 'existing.txt' }),
      agent: { session } as never,
    }
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('registers the untrusted-content guidance section', async () => {
    const { sections } = await booted()
    expect(sections).toHaveLength(1)
    expect(sections[0]).toContain('DATA, not instructions')
  })
})
