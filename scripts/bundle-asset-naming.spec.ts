/**
 * The bundle's version string and asset name are agreed by three files that
 * never import each other: the POSIX packer writes
 * `dist/baby-whale-<platform>-<arch>-<version>.zip`, the PowerShell packer
 * writes the same name, and the launcher reconstructs it from the git tag to
 * find the asset. A prerelease tag is where they drift — the launcher strips
 * only the `v`, so whatever the packers do to the rest must leave the version
 * intact and must accept a suffix instead of falling back to the app version.
 * Each case below drives the real guard from the file rather than restating it.
 * @module dsh-scripts/tests/bundle-asset-naming
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(relative: string): string {
  return readFileSync(resolve(root, relative), 'utf8')
}

/** The POSIX packer's version guard, as the shell evaluates it. */
function posixVersion(rawTag: string): string {
  const source = read('scripts/make-bundle.sh')
  const guard = /if \[\[ ! "\$VERSION" =~ (\S+) \]\]; then/u.exec(source)
  if (guard?.[1] === undefined) throw new Error('make-bundle.sh must keep its version guard')
  // Run the shipped pattern through bash rather than a JavaScript translation
  // of it, so this exercises the guard the packer actually evaluates.
  const script = `
VERSION="${rawTag}"
VERSION="\${VERSION#v}"
if [[ ! "$VERSION" =~ ${guard[1]} ]]; then
  VERSION="fallback"
fi
printf '%s' "$VERSION"
`
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`bash guard failed: ${result.stderr}`)
  return result.stdout
}

/**
 * The PowerShell packer's version guard. Its `-match` pattern is extracted from
 * the script and evaluated as a regular expression: the syntax used here means
 * the same thing to .NET and to JavaScript, so this exercises the shipped
 * pattern rather than a copy of it.
 */
function powershellVersion(rawTag: string): string {
  const source = read('scripts/make-bundle.ps1')
  const guard = /if \(\$VERSION -notmatch '([^']+)'\)/.exec(source)
  if (guard?.[1] === undefined) throw new Error('make-bundle.ps1 must keep its version guard')
  const pattern = new RegExp(guard[1], 'u')
  const version = rawTag.replace(/^v/u, '')
  return pattern.test(version) ? version : 'fallback'
}

/** The launcher's asset name for a release tag, from its own template. */
function launcherAssetName(tag: string, platform: string, arch: string): string {
  const source = read('npm/bwhale/bin/bwhale.js')
  const template = /return `([^`]*baby-whale-[^`]*)`/u.exec(source)
  if (template?.[1] === undefined) throw new Error('bwhale.js must build the asset name from a template')
  return template[1]
    .replace('${p}', platform)
    .replace('${a}', arch)
    .replace('${version.replace(/^v/, \'\')}', tag.replace(/^v/u, ''))
}

describe('bundle asset naming', () => {
  it.each(['v0.2.0-preview', 'v0.2.0-rc.1', 'v0.2.0', 'v0.1.9'])(
    'keeps the tag version in the asset name for %s',
    (tag) => {
      const version = tag.replace(/^v/u, '')
      // Both packers keep a prerelease suffix; neither falls back to the app
      // version, which would name the asset something the launcher never asks
      // for and publish a release with no bundle for that platform.
      expect(posixVersion(tag), 'make-bundle.sh').toBe(version)
      expect(powershellVersion(tag), 'make-bundle.ps1').toBe(version)
      // The launcher derives the same name from the tag alone.
      expect(launcherAssetName(tag, 'linux', 'x64')).toBe(`baby-whale-linux-x64-${version}.zip`)
    },
  )

  it.each(['main', 'v0.2', 'v0.2.0-', ''])('falls back for a non-release ref %s', (ref) => {
    expect(posixVersion(ref)).toBe('fallback')
    expect(powershellVersion(ref)).toBe('fallback')
  })

  it('writes the same asset name from both packers', () => {
    // The two packers name their output with this exact template; a change to
    // one that the launcher cannot follow is what this pins.
    const template = 'dist/baby-whale-$PLATFORM-$ARCH-$VERSION.zip'
    expect(read('scripts/make-bundle.sh')).toContain(`OUT="${template}"`)
    expect(read('scripts/make-bundle.ps1')).toContain(`$OUT = "${template}"`)
  })
})
