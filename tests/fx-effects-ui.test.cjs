// Effects in the clip editor: the gallery's Effects groups (one live tile per effect), each effect's field form, the
// gallery preview spec, and adding / switching effects (words said, beats on the words).
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { GraphicGallery, galleryPreview, galleryEffects } from './src/renderer/components/GraphicGallery';
      export { FX_SAMPLE_PICTURES } from './src/renderer/graphics/fx/samples';
      export { fxNeedsPicture, fxHasContent, fxVariables, fxEffect, fxMark, fxRegion } from './src/shared/fx-catalog';
      export { EditScreenshots } from './src/renderer/components/EditScreenshots';
      export { EffectFields, draftGraphic, graphicsWithEffect, graphicSummary, effectSample } from './src/renderer/components/ClipGraphics';
      export { FX_EFFECTS, FX_GROUPS } from './src/shared/fx-catalog';
      export { GRAPHIC_TEMPLATES } from './src/shared/motion-graphics';
      export { REEL_GRAPHIC_TEMPLATES, REEL_CHAT_TEMPLATES } from './src/shared/reel-graphics';
      export { GraphicForm } from './src/renderer/components/ReelGraphics';
      export { fxFit, fxAnchorShift, fxMinType, fxGlassLeft } from './src/renderer/graphics/fx/fit';
      export { pushOrigin, pushScale, PUSH_ZOOM } from './src/renderer/graphics/fx/media';
      export { textMinType, largestFitting, textTheme, TEXT_FILL, TEXT_MAX_FILL, CAP_RATIO } from './src/renderer/graphics/text-fit';
      export { highlightSplit, highlightLayout, highlightColors, highlightPlacement } from './src/shared/headline-look';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  loader: { '.svg': 'dataurl', '.css': 'empty', '.png': 'dataurl' },
  jsx: 'automatic', write: false, logLevel: 'silent'
}).outputFiles[0].text

globalThis.window = { bridgeclip: {} }
const mod = { exports: {} }
// The gallery is a dialog portaled to document.body: render it in place.
globalThis.document = { body: {}, activeElement: null }
const requireShim = (id) => id === 'react-dom' ? { ...require('react-dom'), createPortal: (children) => children } : require(id)
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, requireShim)
const m = mod.exports
const fixture = require('./fixtures/editor/project.json')

const STYLE = { color: '#7C3AED', font: 'clean' }

test('the gallery lists every effect as its own tile, in Effects groups after the templates', () => {
  const picked = []
  const html = renderToStaticMarkup(React.createElement(m.GraphicGallery, { templates: m.GRAPHIC_TEMPLATES, where: 'at 0:03', style: STYLE, full: false, limitNote: '', pictures: true, onPick: (...a) => picked.push(a), onClose: () => {} }))
  for (const group of m.FX_GROUPS) if (m.FX_EFFECTS.some((e) => e.group === group.id)) assert.match(html, new RegExp(`aria-label="${group.label.replace(/&/g, '&amp;')}"`))
  const tiles = [...html.matchAll(/aria-label="Add effect ([^"]+)"/g)].map((x) => x[1])
  assert.equal(tiles.length, m.FX_EFFECTS.length)
  assert.ok(tiles.includes('Count up') && tiles.includes('Word rise'))
  // The Effect template itself is never a plain tile.
  assert.doesNotMatch(html, /aria-label="Add Effect"/)
  // Text templates still come first.
  assert.ok(html.indexOf('Add Title slam') < html.indexOf('Add effect Count up'))
  // Edit my recording and Remix galleries list every effect too (the chats add templates only), except the ones on
  // the member's own pictures where no picture can be added.
  const reel = renderToStaticMarkup(React.createElement(m.GraphicGallery, { templates: m.REEL_GRAPHIC_TEMPLATES, where: 'here', style: STYLE, full: false, limitNote: '', onPick: () => {}, onClose: () => {} }))
  assert.equal([...reel.matchAll(/aria-label="Add effect ([^"]+)"/g)].length, m.FX_EFFECTS.filter((e) => !m.fxNeedsPicture(e)).length)
  assert.ok(!m.REEL_CHAT_TEMPLATES.some((t) => t.id === 'fx') && m.REEL_GRAPHIC_TEMPLATES.some((t) => t.id === 'fx'))
})

test('picture effects: the gallery asks for a picture, previews them with plain stand-ins, and they never draw without one', () => {
  const needing = m.FX_EFFECTS.filter((e) => m.fxNeedsPicture(e)).map((e) => e.id)
  assert.deepEqual(needing.sort(), ['before-after-wipe', 'browser-device-stage', 'comparison-split', 'device-frame-stage', 'light-sweep-pass', 'paper-collage-reveal', 'split-tilt-cards'])
  // Offered only where pictures can be added.
  assert.ok(m.galleryEffects(false).every((e) => !m.fxNeedsPicture(e)))
  assert.equal(m.galleryEffects(true).length, m.FX_EFFECTS.length)
  const html = renderToStaticMarkup(React.createElement(m.GraphicGallery, { templates: m.GRAPHIC_TEMPLATES, where: 'here', style: STYLE, full: false, limitNote: '', pictures: true, onPick: () => {}, onClose: () => {} }))
  assert.match(html, /aria-label="Add effect Browser screenshot \(choose your picture\)"/)
  assert.match(html, /Needs your picture/)
  // The tile's preview: stand-in pictures (plain shapes, no words) and a sample mark; never the words said there.
  const spec = m.galleryPreview('fx', STYLE, { title: 'said words' }, 'before-after-wipe')
  assert.equal(spec.image, m.FX_SAMPLE_PICTURES.before)
  assert.equal(spec.image_b, m.FX_SAMPLE_PICTURES.after)
  assert.equal(spec.fields.title, undefined)
  for (const url of Object.values(m.FX_SAMPLE_PICTURES)) assert.doesNotMatch(decodeURIComponent(url), /<text/)
  const browser = m.galleryPreview('fx', STYLE, {}, 'browser-device-stage')
  assert.ok(browser.image.startsWith('data:image/svg+xml'))
  assert.deepEqual(m.fxMark(browser.fields), { shape: 'box', on: 'image', box: [0.06, 0.36, 0.58, 0.56] })
  // Without its picture it has no content (it is never drawn or placed empty); the picture is never a unit variable.
  assert.equal(m.fxHasContent({ effect: 'browser-device-stage' }), false)
  assert.equal(m.fxHasContent({ effect: 'browser-device-stage', image: '0123456789abcdef.png' }), true)
  assert.equal(m.fxHasContent({ effect: 'before-after-wipe', image: '0123456789abcdef.png' }), false)
  assert.equal(m.fxHasContent({ effect: 'torn-paper-rip', first: 'The old way' }), false, 'a picture or words under the sheet')
  assert.equal(m.fxHasContent({ effect: 'torn-paper-rip', first: 'The old way', second: 'The new way' }), true)
  const vars = m.fxVariables(m.fxEffect('browser-device-stage'), { effect: 'browser-device-stage', image: '0123456789abcdef.png', mark: 'circle', mark_box: '0.1, 0.1, 0.2, 0.2', title: '' })
  assert.deepEqual(Object.keys(vars).sort(), ['accent', 'title'])
  assert.equal(vars.title, '\u200B', 'no address shows unless one is typed or said')
  // A mark only with a shape and a box inside the picture.
  assert.equal(m.fxMark({ effect: 'light-sweep-pass', mark: 'underline', mark_box: '0.5, 0.5, 0.6, 0.1' }), null)
  assert.equal(m.fxMark({ effect: 'light-sweep-pass', mark: '', mark_box: '0.1, 0.1, 0.2, 0.2' }), null)
  assert.deepEqual(m.fxRegion('0.1,0.2 0.3 0.4'), [0.1, 0.2, 0.3, 0.4])
})

test('the effect form shows a picture effect’s pictures and, with a mark, the picture to drag its box on', () => {
  const pictures = { url: (v) => v ? `local-file:///run/${v}` : undefined, choose: async () => null }
  const none = renderToStaticMarkup(React.createElement(m.EffectFields, { fields: { effect: 'browser-device-stage' }, onField: () => {}, pictures }))
  assert.match(none, /Choose picture/)
  assert.match(none, /Choose a picture to show it\./)
  const marked = renderToStaticMarkup(React.createElement(m.EffectFields, { fields: { effect: 'browser-device-stage', image: 'abc.png', mark: 'circle' }, onField: () => {}, pictures }))
  assert.match(marked, /Change picture/)
  assert.match(marked, /drag on the picture to box what the mark points at/)
  assert.match(marked, /src="local-file:\/\/\/run\/abc.png"/)
  // An edited reel picks one of its screenshots instead.
  const reel = renderToStaticMarkup(React.createElement(m.EffectFields, { fields: { effect: 'before-after-wipe', image: 'id1', image_b: 'id2' }, onField: () => {},
    pictures: { url: () => undefined, options: [{ value: 'id1', label: 'home.png' }, { value: 'id2', label: 'new.png' }] } }))
  assert.match(reel, /aria-label="Before picture"/)
  assert.match(reel, /aria-label="After picture"/)
  // Edit my recording's setup lists the screenshots with their boxes.
  const setup = renderToStaticMarkup(React.createElement(m.EditScreenshots, { value: [{ path: '/v/home.png', name: 'home.png', box: [0.1, 0.1, 0.3, 0.2] }], onChange: () => {}, onError: () => {}, disabledReason: null }))
  assert.match(setup, /\+ Add screenshots/)
  assert.match(setup, /home\.png: drag to box the part that matters/)
  assert.match(setup, /Clear box/)
})

test('a tile previews the words said there when they fill the effect, else its sample words', () => {
  const sample = m.galleryPreview('fx', STYLE, {}, 'count-up')
  assert.equal(sample.template, 'fx')
  assert.deepEqual(sample.fields, m.effectSample('count-up'))
  const own = m.galleryPreview('fx', STYLE, { value: '1200', prefix: '$' }, 'count-up')
  assert.deepEqual(own.fields, { value: '1200', prefix: '$', effect: 'count-up' })
  assert.equal(own.color, STYLE.color)
})

test('an effect’s form has one control per field: text and numbers, lists one per line, choices, and its backing', () => {
  const html = renderToStaticMarkup(React.createElement(m.EffectFields, { fields: { effect: 'chart-story', data: '1\n2' }, onField: () => {} }))
  assert.match(html, /aria-label="Chart numbers \(one per line\)"/)
  assert.match(html, /<textarea[^>]*aria-label="Chart labels \(one per line\)"/)
  assert.match(html, /aria-label="Chart chart"/)
  const count = renderToStaticMarkup(React.createElement(m.EffectFields, { fields: { effect: 'count-up' }, onField: () => {} }))
  assert.match(count, /inputMode="decimal"|inputmode="decimal"/)
  assert.match(count, /Dark glass behind it/)
  assert.equal(renderToStaticMarkup(React.createElement(m.EffectFields, { fields: { effect: 'nope' }, onField: () => {} })), '')
})

test('adding an effect fills it with words said there and lands its beats on them; switching keeps the words', () => {
  const c = { ...structuredClone(fixture.candidates[0]), graphics: [] }
  const start = c.ranges[0][0]
  const words = [['Plan', 0], ['make', 400], ['and', 700], ['share', 900], ['every', 1300], ['week', 1600]].map(([word, t]) => ({ word, start_ms: start + 200 + t, end_ms: start + 450 + t }))
  const g = m.draftGraphic(fixture, c, 'fx', start + 200, words, 'per-word-rise')
  assert.equal(g.template, 'fx')
  assert.equal(g.fields.effect, 'per-word-rise')
  assert.ok(g.fields.text, 'words said fill it')
  for (const w of g.fields.text.split(' ')) assert.ok(words.some((x) => x.word.toLowerCase() === w.toLowerCase()), w)
  assert.ok(g.fields.cue_ms, 'its words are timed')
  assert.match(m.graphicSummary(g), /^Word rise · /)
  const [switched] = m.graphicsWithEffect({ ...c, graphics: [g] }, g, 'headline-slam', words)
  assert.equal(switched.fields.effect, 'headline-slam')
  assert.equal(switched.fields.text, g.fields.text)
  // An unknown effect falls back to the first one; nothing is made up without words.
  const empty = m.draftGraphic(fixture, c, 'fx', start + 200, [], 'count-up')
  assert.deepEqual(Object.keys(empty.fields), ['effect'])
})

test('a reel graphic form edits an effect with its own fields', () => {
  const g = { id: 'g-1', template: 'fx', fields: { effect: 'count-up', value: '1200', prefix: '$' }, duration_ms: 3500, placement: 'top', at: 2, where: 'at 0:02', problem: null }
  const frame = { aspect: '9:16', hook: 0.2, captions: null }
  const html = renderToStaticMarkup(React.createElement(m.GraphicForm, { g, frame, look: null, disabled: false, cursorLabel: 'here', onField: () => {}, onPatch: () => {}, onMoveHere: () => {}, onRemove: () => {} }))
  assert.match(html, /Count up/)
  assert.match(html, /inputMode="decimal"|inputmode="decimal"/)
  // No raw "effect" text box.
  assert.doesNotMatch(html, /aria-label="Effect effect"/)
})

test('an effect card at the top or bottom keeps to that edge of its band, not out over the speaker', () => {
  // A line of words 80 px tall drawn at 1.5x in a 518 px band, 30 px kept around it: 151 px of spare room a side.
  assert.equal(m.fxAnchorShift(80, 1.5, 518, 30, 'top'), -169)
  assert.equal(m.fxAnchorShift(80, 1.5, 518, 30, 'bottom'), 169)
  assert.equal(m.fxAnchorShift(80, 1.5, 518, 30, 'center'), 0)
  // A drawing that fills its band stays.
  assert.equal(m.fxAnchorShift(330, 1.5, 518, 30, 'top'), 0)
  const fit = m.fxFit({ x: 100, y: 200, w: 600, h: 80 }, { w: 972, h: 518 }, 'card', 1, { x: 40, y: 30 })
  assert.equal(fit.dy, 518 / 2 - 240)
})

test('a screenshot pushes in slowly and keeps the part that matters whole; words effects and stage frameworks read on a phone', () => {
  const pic = { width: 1440, height: 900 }, slot = { w: 900, h: 560 }
  assert.equal(m.pushScale(0, 5), 1)
  assert.ok(Math.abs(m.pushScale(5, 5) - (1 + m.PUSH_ZOOM)) < 1e-9 && m.pushScale(2, 5) > 1 && m.pushScale(2, 5) < 1 + m.PUSH_ZOOM)
  const k = 1 + m.PUSH_ZOOM
  for (const box of [null, [0.6, 0.6, 0.3, 0.2], [0.02, 0.05, 0.3, 0.1]]) {
    const o = m.pushOrigin(pic, slot, 'top', box)
    const r = { x: 0, w: slot.w, y: 0, h: 900 * slot.w / 1440 }
    const [bx, by, bw, bh] = box ?? [0.03, 0.15, 0.5, 0.3]
    const map = (q, p) => p + k * (q - p)
    // The focus part, zoomed about the origin, stays inside the slot.
    assert.ok(map(r.x + bx * r.w, o.x) >= -1 && map(r.x + (bx + bw) * r.w, o.x) <= slot.w + 1, JSON.stringify({ box, o }))
    assert.ok(map(r.y + by * r.h, o.y) >= -1 && map(r.y + (by + bh) * r.h, o.y) <= slot.h + 1, JSON.stringify({ box, o }))
  }
  assert.equal(m.fxMinType('card', 'words', 4), 75)
  assert.equal(m.fxMinType('card', 'words', 9), 60)
  assert.equal(m.fxMinType('stage', 'ideas', 0), 64)
  assert.equal(m.fxMinType('card', 'numbers', 1), 36)
  // A glass backing stays whole until its unit's last 460 ms, then leaves with the words (never left behind empty).
  assert.equal(m.fxGlassLeft(2000, 460), 1)
  assert.equal(m.fxGlassLeft(230, 460), 0.5)
  assert.equal(m.fxGlassLeft(0, 460), 0)
})

test('text templates keep the on-phone minimums: a short line at a cap height of about 54 px, cards across most of the frame', () => {
  // 1-6 words: about 54 px caps (the bold sans at 0.72 of its size, the italic serif at 0.62); longer lines about 43 px.
  assert.equal(m.textMinType(4), 75)
  assert.equal(m.textMinType(4, 'serif'), 88)
  assert.equal(m.textMinType(9), 60)
  assert.ok(m.textMinType(3) * m.CAP_RATIO.sans >= 54 && m.textMinType(6, 'serif') * m.CAP_RATIO.serif >= 54)
  // Fill: a card at least 70% of the width, the stage 88%.
  assert.equal(m.TEXT_FILL.card, .7)
  assert.equal(m.TEXT_FILL.stage, .88)
  assert.ok(m.TEXT_MAX_FILL.card > m.TEXT_FILL.card && m.TEXT_MAX_FILL.stage > m.TEXT_FILL.stage)
  // The biggest size that fits, never under the minimum (it may then spill a little: big type first).
  assert.equal(m.largestFitting(75, 160, (s) => s <= 120), 120)
  assert.equal(m.largestFitting(75, 160, () => false), 75)
  // The one look travels as `theme`.
  assert.equal(m.textTheme({ theme: 'dark' }), 'dark')
  assert.equal(m.textTheme({ theme: 'neon' }), '')
})

test('Key words in color: the lead words big on white, the last third in the serif on the color, at the biggest size that fits', () => {
  assert.deepEqual(m.highlightSplit('You do not have to be an influencer'), { lead: 'You do not have to', phrase: 'be an influencer' })
  assert.deepEqual(m.highlightSplit('Two words'), { lead: 'Two', phrase: 'words' })
  const measure = (line, size, phrase) => line.length * size * (phrase ? .5 : .58)
  const layout = m.highlightLayout('You do not have to be an influencer', measure, 950)
  assert.ok(layout.lead.length <= 2 && layout.phrase.length <= 2 && layout.lead.length + layout.phrase.length <= 3)
  assert.ok(layout.size >= 78, `a big hook (${layout.size})`)
  const placed = m.highlightPlacement('You do not have to be an influencer', measure, 1080, 1920)
  assert.ok(placed.leadPath.startsWith('M') && placed.phrasePath.startsWith('M'))
  assert.ok(placed.lines.filter((l) => l.phrase).every((l) => l.center > placed.lines.find((x) => !x.phrase).center))
  // Never white on white: a white color keeps the default blue for the key words' box.
  assert.equal(m.highlightColors({ color: '#FFFFFF' }).phraseBg, '#2563EB')
  assert.equal(m.highlightColors({ color: '#E11D48' }).phraseBg, '#E11D48')
})
