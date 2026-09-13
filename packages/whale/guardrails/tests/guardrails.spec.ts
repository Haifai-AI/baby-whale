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

  it('stands down for an in-workspace overwrite under the workspace-write preset', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const exec = {
      ...execution('write', { file_path: 'existing.txt' }),
      agent: { session: { header: { cwd: root }, events: [
        { type: 'permission/preset', data: { preset: 'workspace-write' } },
      ] } },
    } as unknown as ToolExecution
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    // The preset grants in-workspace writes outright — an overwrite ask
    // would contradict the promise the user just selected.
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('still asks a workspace-write session for an overwrite outside the workspace', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, '..', 'outside-guard.txt'), 'x')
    const exec = {
      ...execution('write', { file_path: '../outside-guard.txt' }),
      agent: { session: { header: { cwd: root }, events: [
        { type: 'permission/preset', data: { preset: 'workspace-write' } },
      ] } },
    } as unknown as ToolExecution
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'ask', reason: 'overwrite existing file "../outside-guard.txt"?' })
  })

  it('keeps asking without a recorded preset (conservative default)', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const exec = {
      ...execution('write', { file_path: 'existing.txt' }),
      agent: { session: { header: { cwd: root }, events: [] } },
    } as unknown as ToolExecution
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
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

  it('ignores tools with no overwrite path in the traversal guard', async () => {
    const { recorded } = await booted()
    expect(recorded(execution('read', { file_path: 'inside.txt' }))).toBeUndefined()
    expect(recorded(execution('read', {}))).toBeUndefined()
    expect(recorded(execution('read', undefined))).toBeUndefined()
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

  it('asks before a shell redirect overwrites an existing file', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo hi > existing.txt' }),
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
  })

  it('shares the overwrite approval memory between file tools and shell redirects', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const reason = 'overwrite existing file "existing.txt"?'
    const session = {
      header: { cwd: root },
      events: [
        { type: 'approval/asked', data: { id: 'a4', toolName: 'write', reason } },
        { type: 'approval/decided', data: { id: 'a4', outcome: 'allowed-once' } },
      ],
    }
    const exec: ToolExecution = {
      ...execution('bash', { command: 'printf x >> existing.txt' }),
      agent: { session } as never,
    }
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      exec,
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('allows a shell redirect to a fresh path', async () => {
    const { ctx } = await booted()
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('pwsh', { command: 'echo hi > fresh.txt' }),
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('ignores quoted literals, test and arithmetic spans, duplications, and /dev/null discards', async () => {
    const { ctx } = await booted()
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    for (const command of [
      'echo "a > b"',
      "echo 'a >> b'",
      "echo 'x>file'",
      '[[ $status > 1 ]] && echo done',
      '(( count > 3 )) && echo many',
      'noisy --verbose 2>&1 | head',
      'noisy "2>&1" | head',
      'run 2>&1 "note > ok"',
      'quiet --yes > /dev/null 2>&1',
      'run 1>&2',
      'run 2>&-',
      'cat < input.txt',
      'cat <input.txt',
      'cat <<\'EOF\'',
      'run <> rw.txt',
      'echo a \\> b',
      'run > >(tee copy.txt)',
      'echo a & echo b',
    ]) {
      const decision = await ctx.waterfall('tools/pre-execute', execution('bash', { command }), allow)
      expect(decision, command).toEqual({ kind: 'allow' })
    }
  })

  it('asks before a quoted or escaped redirect target overwrites an existing file', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    writeFileSync(join(root, 'existing file.txt'), 'x')
    writeFileSync(join(root, 'space name.txt'), 'x')
    writeFileSync(join(root, 'errors file.txt'), 'x')
    mkdirSync(join(root, 'dir name'), { recursive: true })
    writeFileSync(join(root, 'dir name', 'existing.txt'), 'x')
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    // The operator's word may be quoted, escaped, or concatenated: the
    // fence sees the decoded path the shell would actually open.
    for (const [command, target] of [
      ['echo hi>"existing file.txt"', 'existing file.txt'],
      ["echo hi > 'existing.txt'", 'existing.txt'],
      ["echo hi>'existing.txt'", 'existing.txt'],
      ['echo hi 2>"errors file.txt"', 'errors file.txt'],
      ['echo hi > space\\ name.txt', 'space name.txt'],
      ['echo hi>"dir name"/existing.txt', 'dir name/existing.txt'],
    ] as const) {
      const decision = await ctx.waterfall('tools/pre-execute', execution('bash', { command }), allow)
      expect(decision, command).toEqual({ kind: 'ask', reason: `overwrite existing file "${target}"?` })
    }
    const freshDecision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: "echo hi > 'fresh quoted.txt'" }),
      allow,
    )
    expect(freshDecision).toEqual({ kind: 'allow' })
  })

  it('denies a quoted or escaped shell redirect escaping the workspace', async () => {
    const { recorded } = await booted()
    expect(recorded(execution('bash', { command: "echo hi>'../outside.txt'" }))).toContain('escapes the session workspace')
    expect(recorded(execution('bash', { command: 'echo hi>"../outside.txt"' }))).toContain('escapes the session workspace')
    expect(recorded(execution('bash', { command: 'echo hi>"../outside dir/x.txt"' }))).toContain('escapes the session workspace')
    expect(recorded(execution('bash', { command: 'echo hi>../outside\\ name.txt' }))).toContain('escapes the session workspace')
    expect(recorded(execution('bash', { command: "echo hi>'ok.txt'" }))).toBeUndefined()
  })

  it('scans redirects inside double-quoted command substitutions, which the shell executes', async () => {
    const { ctx, recorded } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    // The substitution body runs, so its redirect hits the same fence as a
    // direct one.
    const traversal = recorded(execution('bash', { command: 'echo "$(printf x > ../outside.txt)"' }))
    expect(traversal).toContain('escapes the session workspace')
    for (const command of [
      'echo "$(printf x > existing.txt)"',
      'echo "$(printf x > \'existing.txt\')"',
      'echo "`printf x > existing.txt`"',
    ]) {
      const decision = await ctx.waterfall('tools/pre-execute', execution('bash', { command }), allow)
      expect(decision, command).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
    }
    // Quoted substitution text that redirects nothing stays unguarded.
    const allowDecision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo "$(seq 3 > /dev/null) done"' }),
      allow,
    )
    expect(allowDecision).toEqual({ kind: 'allow' })
  })

  it('scans top-level backtick substitution bodies without gluing the closer onto a target', async () => {
    const { ctx, recorded } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    // The decoded target must be the path the shell opens — the closing
    // backtick is body syntax, not part of the filename.
    const traversal = recorded(execution('bash', { command: 'echo `printf x > ../outside.txt`' }))
    expect(traversal).toContain('escapes the session workspace')
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo `printf x >> existing.txt`' }),
      allow,
    )
    expect(decision).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
    // Bodies that redirect nothing leave the surrounding command free to.
    const outside = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo `tag --rev` > fresh-backtick.txt' }),
      allow,
    )
    expect(outside).toEqual({ kind: 'allow' })
  })

  it('treats heredoc bodies as data while still guarding the operator line', async () => {
    const { ctx, recorded } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    // A `> existing.txt` written inside a heredoc body is text the command
    // reads — never a redirect — so the fence stays quiet on every common
    // delimiter form, and an unterminated body ends the scan.
    for (const command of [
      'cat <<EOF\na > existing.txt\nb\nEOF',
      "cat <<'EOF'\na > existing.txt\nEOF",
      'cat <<"EOF"\na > existing.txt\nEOF',
      'cat <<-EOF\n\ta > existing.txt\n\tEOF',
      'cat <<EOF\na\nb > x\nc\nEOF && echo z > w',
    ]) {
      const decision = await ctx.waterfall('tools/pre-execute', execution('bash', { command }), allow)
      expect(decision, command).toEqual({ kind: 'allow' })
    }
    // A real redirect beside the heredoc on the operator line still asks.
    const adjacent = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: "cat <<'EOF' > existing.txt\nbody\nEOF" }),
      allow,
    )
    expect(adjacent).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
    // And a substitution executed from the body-writing command is scanned.
    const traversal = recorded(execution('bash', { command: 'cat <<EOF > ../outside.txt\nbody\nEOF' }))
    expect(traversal).toContain('escapes the session workspace')
  })

  it('asks for an existing later target even when an earlier target is fresh', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo a > fresh-first.txt > existing.txt' }),
      allow,
    )
    expect(decision).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
  })

  it('asks once, for the first existing target among several, and never for all-fresh', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'first.txt'), 'x')
    writeFileSync(join(root, 'second.txt'), 'x')
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo a > first.txt > second.txt' }),
      allow,
    )
    expect(decision).toEqual({ kind: 'ask', reason: 'overwrite existing file "first.txt"?' })
    const fresh = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo a > fresh-a.txt > fresh-b.txt' }),
      allow,
    )
    expect(fresh).toEqual({ kind: 'allow' })
  })

  it('stands a multiple-target redirect down per existing target under workspace-write', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'in-workspace.txt'), 'x')
    const exec = {
      ...execution('bash', { command: 'echo a > fresh-ws.txt > in-workspace.txt' }),
      agent: { session: { header: { cwd: root }, events: [
        { type: 'permission/preset', data: { preset: 'workspace-write' } },
      ] } },
    } as unknown as ToolExecution
    const decision = await ctx.waterfall('tools/pre-execute', exec, () => Promise.resolve({ kind: 'allow' } as const))
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('asks before an unspaced shell redirect overwrites or appends to an existing file', async () => {
    const { ctx } = await booted()
    writeFileSync(join(root, 'existing.txt'), 'x')
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    // A redirect operator is a standalone lexer token, so the glued
    // spellings redirect exactly like the spaced ones and must hit the
    // same fence.
    for (const command of [
      'echo hi>existing.txt',
      'echo hi>>existing.txt',
      'echo hi>|existing.txt',
      'echo hi&>existing.txt',
      'printf x >>existing.txt',
      'noisy 2>existing.txt',
    ]) {
      const decision = await ctx.waterfall('tools/pre-execute', execution('bash', { command }), allow)
      expect(decision, command).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
    }
    const pwshDecision = await ctx.waterfall(
      'tools/pre-execute',
      execution('pwsh', { command: 'write-output hi*>existing.txt' }),
      allow,
    )
    expect(pwshDecision).toEqual({ kind: 'ask', reason: 'overwrite existing file "existing.txt"?' })
  })

  it('allows an unspaced shell redirect to a fresh path', async () => {
    const { ctx } = await booted()
    const allow = () => Promise.resolve({ kind: 'allow' } as const)
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 'echo glued >>existing-glued-fresh.txt' }),
      allow,
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('denies a shell redirect escaping the workspace, wherever it sits in the command', async () => {
    const { recorded } = await booted()
    expect(recorded(execution('bash', { command: 'echo x > ../outside.txt' }))).toContain('escapes the session workspace')
    expect(recorded(execution('bash', { command: 'echo a > ok.txt && echo b > ../outside.txt' }))).toContain('escapes the session workspace')
    expect(recorded(execution('pwsh', { command: 'echo a > ok.txt' }))).toBeUndefined()
  })

  it('denies an unspaced shell redirect escaping the workspace', async () => {
    const { recorded } = await booted()
    expect(recorded(execution('bash', { command: 'echo hi>../outside.txt' }))).toContain('escapes the session workspace')
    expect(recorded(execution('bash', { command: 'echo hi>>../outside.txt' }))).toContain('escapes the session workspace')
    expect(recorded(execution('bash', { command: 'echo hi>ok.txt' }))).toBeUndefined()
  })

  it('allows a shell call with a non-string command (malformed args fail downstream)', async () => {
    const { ctx } = await booted()
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      execution('bash', { command: 42 }),
      () => Promise.resolve({ kind: 'allow' } as const),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })
})
