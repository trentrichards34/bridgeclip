/**
 * Effects (HyperFrames units, Apache-2.0, vendored in src/renderer/graphics/fx/vendor/) compiled at BUILD time into
 * a module the render page can run under its Content-Security-Policy (no inline scripts, no eval):
 *
 * - `styles`: every <style> block, with @import and @font-face rules removed (nothing is fetched) and the
 *   web fonts they name mapped onto the app's bundled fonts (MG_FONTS);
 * - `markup`: the unit's HTML (its <template>, else its <body>, else the whole snippet) without scripts or styles;
 *   a snippet without its own #root is wrapped in one that fills the box and centers it;
 * - `run(gsap, CustomEase, window, document)`: the unit's inline scripts, in order, in one function. The adapter
 *   (src/renderer/graphics/fx/mount.ts) passes a scoped `window` and `document` (the unit's shadow root), so units
 *   never touch the page or each other.
 *
 * Scripts that load from a URL (the GSAP CDN tag: GSAP is bundled from npm) and module scripts are dropped. This
 * file is pure string work: the Vite plugin (electron.vite.config.ts) and the tests both use it.
 */

/**
 * Web fonts named by the units → the bundled faces (graphics.css and fx.css declare them). A quoted name keeps its
 * quotes; an unquoted one stays unquoted (it may sit inside a script's string), which CSS reads the same.
 */
export const MG_FONTS: [RegExp, string][] = [
  [/(["'])?\bInter\b\1/g, '$1MG Jakarta$1'],
  [/(["'])?\b(?:Outfit|Gabarito|Space Grotesk|Roboto Flex(?: Variable)?|Helvetica Neue)\b\1/g, '$1MG Jakarta$1'],
  [/(["'])?\bCaveat\b\1/g, '$1MG Caveat Brush$1'],
  [/(["'])?\bPermanent Marker\b\1/g, '$1MG Caveat Brush$1'],
  [/(["'])?\b(?:Instrument Serif|Playfair Display|EB Garamond|Libre Baskerville)\b\1/g, '$1MG Instrument Serif$1'],
  [/(["'])?\bMontserrat\b\1/g, '$1MG Montserrat$1'],
  [/(["'])?\bPoppins\b\1/g, '$1MG Poppins$1'],
  [/(["'])?\bAnton\b\1/g, '$1MG Anton$1'],
  [/(["'])?\b(?:SF Mono|JetBrains Mono|IBM Plex Mono|Courier Prime)\b\1/g, '$1MG Mono$1'],
  [/\bui-monospace\b/g, 'MG Mono, ui-monospace']
]

export function mapFonts(text: string): string {
  return MG_FONTS.reduce((out, [pattern, face]) => out.replace(pattern, face), text)
}

/** Removes @import and @font-face rules (the page loads no fonts or styles from anywhere else). */
export function stripFontLoads(css: string): string {
  return css.replace(/@import[^;]*;/g, '').replace(/@font-face\s*\{[^}]*\}/g, '')
}

export interface CompiledEffect { styles: string; markup: string; script: string; snippet: boolean }

const between = (html: string, tag: string): string | null => {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'i').exec(html)
  if (!open) return null
  const close = html.toLowerCase().lastIndexOf(`</${tag}>`)
  return close > open.index ? html.slice(open.index + open[0].length, close) : null
}

/** One vendored unit's HTML → its styles, markup and script body (see the file comment). */
export function compileEffectHtml(html: string): CompiledEffect {
  const source = html.replace(/<!--[\s\S]*?-->/g, '')
  const scripts: string[] = []
  const styles: string[] = []
  for (const m of source.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? ''
    if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["']?module/i.test(attrs)) continue
    scripts.push(m[2])
  }
  for (const m of source.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi)) styles.push(m[2])
  const region = between(source, 'template') ?? between(source, 'body') ?? source
  const markup = region.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/gi, '').replace(/<style(\s[^>]*)?>[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*>/gi, '').replace(/<\/?(html|head|body)\b[^>]*>/gi, '').replace(/<meta\b[^>]*>|<title>[\s\S]*?<\/title>/gi, '').trim()
  const snippet = !/\bid\s*=\s*["']root["']/.test(markup)
  return {
    styles: mapFonts(stripFontLoads(styles.join('\n'))),
    markup: snippet ? `<div id="root" class="cc-fx-snippet">${markup}</div>` : markup,
    script: mapFonts(scripts.join('\n;\n')),
    snippet
  }
}

/** The ES module the Vite plugin serves for `<file>.html?fx`. */
export function effectModule(html: string): string {
  const { styles, markup, script, snippet } = compileEffectHtml(html)
  return `export const styles = ${JSON.stringify(styles)};\nexport const markup = ${JSON.stringify(markup)};\nexport const snippet = ${snippet};\n` +
    `export function run(gsap, CustomEase, window, document) {\n${script}\n}\n`
}
