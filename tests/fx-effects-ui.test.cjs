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
    contents: `export { GraphicGallery, galleryPreview } from './src/renderer/components/GraphicGallery';
      export { EffectFields, draftGraphic, graphicsWithEffect, graphicSummary, effectSample } from './src/renderer/components/ClipGraphics';
      export { FX_EFFECTS, FX_GROUPS } from './src/shared/fx-catalog';
      export { GRAPHIC_TEMPLATES } from './src/shared/motion-graphics';
      export { REEL_GRAPHIC_TEMPLATES, REEL_CHAT_TEMPLATES } from './src/shared/reel-graphics';
      export { GraphicForm } from './src/renderer/components/ReelGraphics';`,
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
  const html = renderToStaticMarkup(React.createElement(m.GraphicGallery, { templates: m.GRAPHIC_TEMPLATES, where: 'at 0:03', style: STYLE, full: false, limitNote: '', onPick: (...a) => picked.push(a), onClose: () => {} }))
  for (const group of m.FX_GROUPS) if (m.FX_EFFECTS.some((e) => e.group === group.id)) assert.match(html, new RegExp(`aria-label="${group.label.replace(/&/g, '&amp;')}"`))
  const tiles = [...html.matchAll(/aria-label="Add effect ([^"]+)"/g)].map((x) => x[1])
  assert.equal(tiles.length, m.FX_EFFECTS.length)
  assert.ok(tiles.includes('Count up') && tiles.includes('Word rise'))
  // The Effect template itself is never a plain tile.
  assert.doesNotMatch(html, /aria-label="Add Effect"/)
  // Text templates still come first.
  assert.ok(html.indexOf('Add Title slam') < html.indexOf('Add effect Count up'))
  // Edit my recording and Remix galleries list every effect too (the chats add templates only).
  const reel = renderToStaticMarkup(React.createElement(m.GraphicGallery, { templates: m.REEL_GRAPHIC_TEMPLATES, where: 'here', style: STYLE, full: false, limitNote: '', onPick: () => {}, onClose: () => {} }))
  assert.equal([...reel.matchAll(/aria-label="Add effect ([^"]+)"/g)].length, m.FX_EFFECTS.length)
  assert.ok(!m.REEL_CHAT_TEMPLATES.some((t) => t.id === 'fx') && m.REEL_GRAPHIC_TEMPLATES.some((t) => t.id === 'fx'))
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
