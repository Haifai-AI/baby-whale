/** The package's node half: an empty host body and an explained empty invariant companion. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SkillsInvariant from '../src/invariant.ts'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SkillsInvariant).await()).resolves.toBeDefined()
  })

  it('has an empty node half', async () => {
    const { apply } = await import('../src/index.ts')

    // The host body exists only so the plugin appears in the host cordis.yml;
    // every surface this package ships lives in the browser half, and the
    // `skills` namespace it edits is registered by the API gateway.
    apply()

    expect(typeof apply).toBe('function')
  })
})
