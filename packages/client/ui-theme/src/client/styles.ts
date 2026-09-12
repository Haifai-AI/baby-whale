import type { Context } from '@deepseek-ai/cordis'
import base from '../styles/base.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import surfaces from '../styles/surfaces.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import shiki from '../styles/shiki.css?inline'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'

const STYLES = [
  ['base.css', base],
  ['design-platform.css', designPlatform],
  ['scrollbar.css', scrollbar],
  // After design-platform.css: surfaces.css consumes the --dsw-alias-* layer
  // that sheet declares, and a custom property resolves against the cascade
  // position of the rule that reads it, not the sheet order alone.
  ['surfaces.css', surfaces],
  ['gradient-shadow-text.css', gradientShadowText],
  ['shiki.css', shiki],
] as const

/**
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, `ui-theme: ${name} stylesheet`)
  }
}
