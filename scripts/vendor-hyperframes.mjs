#!/usr/bin/env node
/**
 * Copies the curated HyperFrames units (https://github.com/heygen-com/hyperframes, Apache-2.0) into
 * src/renderer/graphics/fx/vendor/, the source of CreatorClips' "Effects" graphics.
 *
 *   node scripts/vendor-hyperframes.mjs <path to a hyperframes checkout>
 *
 * Each file is the unit's own HTML with a notice of what CreatorClips changed at the top (Apache-2.0 §4b):
 * the GSAP <script src> tags are dropped (GSAP is bundled from npm), Google Fonts links are dropped (the
 * bundled fonts are used), and a few snippets get a small paused timeline built from their own
 * "Timeline integration" notes (ADAPT below). Everything else is unchanged; fonts are mapped and the
 * scripts scoped at build time (src/shared/fx-html.ts), not here.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/renderer/graphics/fx/vendor')

/** The units, by registry folder (components unless noted). Keep in step with FX_EFFECTS (src/shared/fx-catalog.ts). */
export const UNITS = [
  'count-up', 'number-pop-in', 'conic-progress-ring', 'star-rating-fill', 'chart-story', 'decline-chart', 'trust-strip',
  'testimonial-card', 'testimonial-proof-card',
  'headline-slam', 'per-word-rise', 'kinetic-type-swap', 'kinetic-center-build', 'text-stagger', 'line-swap', 'caret-swap', 'scramble-reveal',
  'text-shimmer', 'titlecard-lockup', 'char-slam-explode', 'stitched-text-draw', 'wordmark-tiles', 'ticker-takeover', 'typed-prompt',
  'marker-highlight', 'vox-annotate', 'strikethrough-replace',
  'marker-checklist-card', 'constellation-hub', 'locked-nucleus-orbit', 'radial-surround', 'overwhelm-surround', 'state-chip-rail', 'whiteboard-ink',
  'typing-indicator', 'notification-stack',
  'cta-close', 'cta-lockup', 'gloss-sweep', 'spring-pop'
]

/**
 * Motion follows CreatorClips' shared constants (src/renderer/graphics/fx/motion.ts, passed as window.__ccMotion):
 * decelerating entries from slight oversize, speech-rhythm staggers, no springs.
 */
const M = "var M = window.__ccMotion || { move_s: 0.333, enter: 'expo.out', exit: 'power2.in', from_scale: 1.08, stagger_s: 0.2 };"

/**
 * Snippets ship markup + CSS and a "Timeline integration" note instead of a registered timeline: these scripts
 * build that note's paused timeline (and set the words where a snippet hard-codes them) so it renders like the rest.
 */
export const ADAPT = {
  'number-pop-in': `
  (function () {
    ${M}
    var tl = gsap.timeline({ paused: true });
    // The note's back.out spring is retuned: each digit settles from slight oversize, decelerating.
    tl.fromTo('.hf-transition-number-pop-in span, .hf-transition-number-pop-in small', { opacity: 0, '--hf-number-y': '24px', '--hf-number-scale': 1.18, '--hf-number-blur': '8px' }, { opacity: 1, '--hf-number-y': '0px', '--hf-number-scale': 1, '--hf-number-blur': '0px', duration: M.move_s, stagger: 0.06, ease: M.enter }, 0.15);
    window.__timelines = window.__timelines || {};
    window.__timelines['number-pop-in'] = tl;
  })();`,
  'text-stagger': `
  (function () {
    ${M}
    var tl = gsap.timeline({ paused: true });
    tl.fromTo('.hf-transition-text-stagger span', { opacity: 0, y: 48, filter: 'blur(14px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.54, stagger: M.stagger_s, ease: M.enter }, 0.35);
    tl.to('.hf-transition-text-stagger span', { backgroundPosition: '100% 0%', duration: 0.72, stagger: 0.04, ease: 'power2.inOut' }, 1.05);
    window.__timelines = window.__timelines || {};
    window.__timelines['text-stagger'] = tl;
  })();`,
  'strikethrough-replace': `
  (function () {
    var vars = window.__hyperframes && window.__hyperframes.getVariables ? window.__hyperframes.getVariables() : {};
    var root = document.querySelector('.hf-catalog-strikethrough-replace');
    if (typeof vars.before === 'string' && vars.before) root.querySelector('span').textContent = vars.before;
    if (typeof vars.after === 'string' && vars.after) root.querySelector('strong').textContent = vars.after;
    ${M}
    var tl = gsap.timeline({ paused: true });
    tl.fromTo('.hf-catalog-strikethrough-replace i', { '--hf-strike-progress': 0 }, { '--hf-strike-progress': 1, duration: 0.28, ease: M.enter }, 0.6);
    tl.fromTo('.hf-catalog-strikethrough-replace strong', { '--hf-replace-opacity': 0, y: 14 }, { '--hf-replace-opacity': 1, y: 0, duration: M.move_s, ease: M.enter }, 0.84);
    window.__timelines = window.__timelines || {};
    window.__timelines['strikethrough-replace'] = tl;
  })();`,
  'typing-indicator': `
  (function () {
    var tl = gsap.timeline({ paused: true });
    var end = Math.max(0.6, parseFloat(document.getElementById('root').dataset.duration || '3') - 0.05);
    ${M}
    tl.fromTo('#hf-ti-1', { scale: M.from_scale, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: M.move_s, ease: M.enter }, 0.1);
    var dots = gsap.utils.toArray('#hf-ti-1 .hf-ti-dot');
    dots.forEach(function (dot, i) {
      tl.to(dot, { y: -6, duration: 0.28, ease: 'sine.inOut', yoyo: true, repeat: 5 }, 0.2 + i * 0.14);
    });
    tl.set('#hf-ti-1', { autoAlpha: 0 }, end);
    window.__timelines = window.__timelines || {};
    window.__timelines['typing-indicator'] = tl;
  })();`
}

/** Exact replacements: units that hard-code their accent colors take the member's brand color (--brand) instead. */
export const PATCH = {
  'text-stagger': [['green: "#34d399"', 'green: "var(--brand, #34d399)"']],
  'gloss-sweep': [[`surface: "#123b2c",
                surfaceBright: "#1a513c",
                edge: "#39d98a",
                label: "#ecfff5",`, `surface: "color-mix(in srgb, var(--brand, #39d98a) 34%, #0b0d12)",
                surfaceBright: "color-mix(in srgb, var(--brand, #39d98a) 52%, #0b0d12)",
                edge: "var(--brand, #39d98a)",
                label: "#ffffff",`]]
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- a plain Node script
function vendor(hf) {
  const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: hf, encoding: 'utf8' }).trim() } catch { return 'unknown' } })()
  mkdirSync(OUT, { recursive: true })
  for (const name of UNITS) {
    const dir = existsSync(join(hf, 'registry/components', name)) ? join(hf, 'registry/components', name) : join(hf, 'registry/blocks', name)
    const kind = dir.includes('/blocks/') ? 'blocks' : 'components'
    let html = readFileSync(join(dir, `${name}.html`), 'utf8')
    const changes = []
    const before = html
    html = html.replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"]+"\s*><\/script>/g, '<!-- CreatorClips: GSAP is bundled from npm (gsap), not loaded from a CDN. -->')
    if (html !== before) changes.push('the GSAP CDN <script> tags are replaced by the npm package bundled with the app')
    const linked = html
    html = html.replace(/<link\b[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '<!-- CreatorClips: web fonts are mapped to the app\'s bundled fonts. -->')
    if (html !== linked) changes.push('Google Fonts links are removed (bundled fonts are used)')
    for (const [from, to] of PATCH[name] ?? []) {
      if (!html.includes(from)) throw new Error(`${name}: patch target not found`)
      html = html.replace(from, to)
    }
    if (PATCH[name]) changes.push('its hard-coded green accent takes the brand color (--brand)')
    if (ADAPT[name]) {
      html = `${html.trimEnd()}\n\n<!-- CreatorClips adaptation: the paused timeline from this snippet's "Timeline integration" note. -->\n<script>${ADAPT[name]}\n</script>\n`
      changes.push('a paused timeline built from the snippet\'s own "Timeline integration" note is added at the end')
    }
    const header = `<!--\n  Vendored from HyperFrames (https://github.com/heygen-com/hyperframes), registry/${kind}/${name}/${name}.html at ${commit}.\n` +
      `  Copyright 2026 HeyGen, Inc. Licensed under the Apache License, Version 2.0 (see LICENSE and NOTICE in this folder).\n` +
      `  Changed by CreatorClips: ${changes.length ? changes.join('; ') : 'nothing'}. Fonts are mapped and scripts scoped at build time (src/shared/fx-html.ts).\n-->\n`
    writeFileSync(join(OUT, `${name}.html`), header + html)
    copyFileSync(join(dir, 'registry-item.json'), join(OUT, `${name}.registry-item.json`))
  }
  copyFileSync(join(hf, 'LICENSE'), join(OUT, 'LICENSE'))
  writeFileSync(join(OUT, 'NOTICE'), `CreatorClips "Effects" graphics\n\nThe .html files in this folder (and their .registry-item.json metadata) are from HyperFrames\nhttps://github.com/heygen-com/hyperframes (commit ${commit}), Copyright 2026 HeyGen, Inc.,\nlicensed under the Apache License, Version 2.0 (LICENSE in this folder).\n\ncaret-swap.html is HyperFrames' port of Remocn's caret-swap (Copyright (c) 2026 Remocn, MIT License);\nthat notice is kept at the top of the file.\n\nEach file starts with a notice saying what CreatorClips changed. CreatorClips is not affiliated with HeyGen.\n`)
  console.log(`Vendored ${UNITS.length} units from ${hf} (${commit}) into ${OUT}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hf = process.argv[2]
  if (!hf || !existsSync(join(hf, 'registry/components'))) { console.error('Usage: node scripts/vendor-hyperframes.mjs <hyperframes checkout>'); process.exit(1) }
  vendor(resolve(hf))
}
