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
  'cta-close', 'cta-lockup', 'gloss-sweep', 'spring-pop',
  // Media units: the member's own screenshots and photos go in their slots (mount.ts fills them).
  'browser-device-stage', 'device-frame-stage', 'before-after-wipe', 'comparison-split', 'split-tilt-cards',
  'paper-collage-reveal', 'torn-paper-rip', 'light-sweep-pass'
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

/**
 * Units whose slots are host-page <template>s read them through `root.ownerDocument`; CreatorClips hands them the
 * member's picture through `window.__ccSlotDoc` instead (mount.ts), so one effect never sees another's slots.
 */
const SLOT_DOC = ['var hostDoc = root.ownerDocument;', 'var hostDoc = window.__ccSlotDoc || root.ownerDocument;']

/**
 * Exact replacements: units that hard-code their accent colors take the member's brand color (--brand) instead;
 * slotted units take the member's pictures (SLOT_DOC); sample words baked into a unit are replaced by its variables.
 */
export const PATCH = {
  'browser-device-stage': [SLOT_DOC],
  // Its screen is measured with the layout width (getBoundingClientRect includes its own entrance scale and the
  // preview's zoom, which left a strip of the screen empty).
  'device-frame-stage': [[`            var rect = screen.getBoundingClientRect();
            if (rect.width > 0)
              viewport.style.setProperty("--screen-scale", String(rect.width / logicalWidth));`, `            var width = screen.offsetWidth || screen.getBoundingClientRect().width;
            if (width > 0)
              viewport.style.setProperty("--screen-scale", String(width / logicalWidth));`]],
  'paper-collage-reveal': [SLOT_DOC, ['aria-hidden="true">Revealed</span>', 'aria-hidden="true"></span>']],
  'torn-paper-rip': [SLOT_DOC,
    ['aria-hidden="true">Chapter two</span>', 'aria-hidden="true"></span>'],
    ['aria-hidden="true">Chapter one</span>', 'aria-hidden="true"></span>'],
    ['mountSlot("torn-paper-rip-from", fromClip);', `// CreatorClips: the sheets' words are variables (first_text on the top sheet, second_text under it), never sample words.
            var ccFirst = root.querySelector(".tpr-from .tpr-default-mark");
            var ccSecond = root.querySelector(".tpr-to .tpr-default-mark");
            if (ccFirst) ccFirst.textContent = vars.first_text == null ? "" : String(vars.first_text);
            if (ccSecond) ccSecond.textContent = vars.second_text == null ? "" : String(vars.second_text);
            mountSlot("torn-paper-rip-from", fromClip);`]],
  // The swap is clean: each line moves a short way and fades, and the second comes in once the first is gone (rolled
  // through its tall mask, the outgoing line showed outside the words' backing for a moment).
  'line-swap': [
    ["            var LAG_BASE = 0.22; // line_b starts this long after the beat",
      "            // CreatorClips: line_b starts once line_a is gone (no frame shows both lines).\n            var LAG_BASE = 0.3; // line_b starts this long after the beat"],
    ["            var EXIT_A_BASE = 0.35;",
      "            var EXIT_A_BASE = 0.3;"],
    ["            gsap.set(lineBEl, { yPercent: 115 });",
      "            // CreatorClips: each line moves a short way and fades (the mask is taller than the words, so a line rolling\n            // through it showed outside the words' backing on its way out).\n            var SHIFT = 10;\n            gsap.set(lineBEl, { yPercent: SHIFT, opacity: 0 });"],
    ["            tl.fromTo(\n              lineAEl,\n              { yPercent: 115 },\n              { yPercent: 0, duration: IN_A, ease: \"power4.out\" },\n              0,\n            );",
      "            tl.fromTo(lineAEl, { yPercent: SHIFT }, { yPercent: 0, duration: IN_A, ease: \"power4.out\" }, 0);\n            tl.fromTo(lineAEl, { opacity: 0 }, { opacity: 1, duration: IN_A * 0.7, ease: \"power1.in\" }, 0);"],
    ["            tl.fromTo(\n              lineAEl,\n              { yPercent: 0 },\n              { yPercent: -115, duration: EXIT_A, ease: \"power2.in\", immediateRender: false },\n              swapAt,\n            );\n            tl.fromTo(\n              lineBEl,\n              { yPercent: 115 },\n              { yPercent: 0, duration: IN_B, ease: \"power4.out\" },\n              swapAt + LAG,\n            );",
      "            tl.fromTo(\n              lineAEl,\n              { yPercent: 0 },\n              { yPercent: -SHIFT, duration: EXIT_A, ease: \"power2.in\", immediateRender: false },\n              swapAt,\n            );\n            tl.fromTo(\n              lineAEl,\n              { opacity: 1 },\n              { opacity: 0, duration: EXIT_A * 0.8, ease: \"power1.out\", immediateRender: false },\n              swapAt,\n            );\n            tl.set(lineAEl, { opacity: 0 }, swapAt + EXIT_A);\n            tl.fromTo(\n              lineBEl,\n              { yPercent: SHIFT },\n              { yPercent: 0, duration: IN_B, ease: \"power3.out\", immediateRender: false },\n              swapAt + LAG,\n            );\n            tl.fromTo(\n              lineBEl,\n              { opacity: 0 },\n              { opacity: 1, duration: IN_B * 0.7, ease: \"power1.in\", immediateRender: false },\n              swapAt + LAG,\n            );"]],
  'text-stagger': [['green: "#34d399"', 'green: "var(--brand, #34d399)"']],
  'gloss-sweep': [[`surface: "#123b2c",
                surfaceBright: "#1a513c",
                edge: "#39d98a",
                label: "#ecfff5",`, `surface: "color-mix(in srgb, var(--brand, #39d98a) 34%, #0b0d12)",
                surfaceBright: "color-mix(in srgb, var(--brand, #39d98a) 52%, #0b0d12)",
                edge: "var(--brand, #39d98a)",
                label: "#ffffff",`]]
}

/** What each PATCH changes, for the file's notice (default: the accent). */
const NOTES = {
  'device-frame-stage': 'its screen is measured by its layout width (not its transformed box), so the screen content fills it',
  'browser-device-stage': 'its screen slot reads the member\'s picture from window.__ccSlotDoc (not the page)',
  'paper-collage-reveal': 'its content slot reads the member\'s picture from window.__ccSlotDoc (not the page); its sample word ("Revealed") is removed',
  'line-swap': 'the swap is clean: each line moves a short way and fades, and the second line comes in only once the first is gone (no frame shows both)',
  'torn-paper-rip': 'its slots read the member\'s picture from window.__ccSlotDoc (not the page); its sample words ("Chapter one", "Chapter two") are replaced by the variables first_text and second_text'
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
    if (PATCH[name]) changes.push(NOTES[name] ?? 'its hard-coded green accent takes the brand color (--brand)')
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
