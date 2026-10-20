// Motion graphics on Edit my recording reels and on the member's part of a Remix: checking what the page sends, and
// the bands that keep a graphic clear of the hook, the captions, their clip's box and the split line.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')

const shared = loadMain("export * from './src/shared/reel-graphics'; export { graphicBox } from './src/shared/graphic-layout'; export { parseEditDecisions, initialDecisions, parseEditPlan } from './src/shared/edit-recording'")
const plain = (x) => JSON.parse(JSON.stringify(x))
const g = (extra) => ({ id: 'g-aaaa0001', template: 'stat', duration_ms: 3000, placement: 'top', fields: { value: '40%' }, ...extra })

test('Edit graphics start on a word of the plan; Logo pop stays in the clip editor', () => {
  assert.deepEqual(plain(shared.parseEditGraphics([g({ word: 4, id: 'g-bbbb0002' }), g({ word: 2 })], 10)).map((x) => [x.id, x.word]), [['g-aaaa0001', 2], ['g-bbbb0002', 4]])
  assert.deepEqual(plain(shared.parseEditGraphics(undefined, 10)), [])
  assert.throws(() => shared.parseEditGraphics([g({ word: 10 })], 10), /start time/)
  assert.throws(() => shared.parseEditGraphics([g({ word: 1, template: 'logo', fields: { image: 'aaaaaaaaaaaaaaaa.png' } })], 10), /only in the clip editor/)
  assert.throws(() => shared.parseEditGraphics(Array.from({ length: 9 }, (_, i) => g({ word: i, id: `g-aaaa000${i}` })), 10), /up to 8/)
  assert.throws(() => shared.parseEditGraphics([g({ word: 1, duration_ms: 20000 })], 10), /0\.8 and 8 seconds/)
  // The review's choices carry them (and older saved choices without any still parse).
  const plan = shared.parseEditPlan({ words: [['Most', 0, 300, 0, null], ['coaches', 320, 700, 0, null], ['lose', 720, 900, 0, null], ['clients.', 920, 1300, 0, null]], hooks: [], popups: [], sounds: [] }, 1)
  const decisions = shared.initialDecisions(plan)
  assert.deepEqual(plain(shared.parseEditDecisions({ ...decisions, graphics: [g({ word: 1 })] }, plan).graphics).map((x) => x.word), [1])
  const older = { ...decisions }
  delete older.graphics
  assert.deepEqual(plain(shared.parseEditDecisions(older, plan).graphics), [])
  assert.throws(() => shared.parseEditDecisions({ ...decisions, graphics: [g({ word: 1, template: 'nope' })] }, plan), /Check your graphics: Choose one of the graphic templates/)
})

test('Remix graphics stay in the member’s part, after the “My take” label', () => {
  assert.equal(shared.parseRemixGraphics([g({ at_ms: 1300 })], 'clip_then_me', 9000)[0].at_ms, 1300)
  assert.throws(() => shared.parseRemixGraphics([g({ at_ms: 500 })], 'moment_take', 9000), /after the “My take” label/)
  assert.equal(shared.parseRemixGraphics([g({ at_ms: 0 })], 'pause_react', 9000)[0].at_ms, 0)
  assert.throws(() => shared.parseRemixGraphics([g({ at_ms: 8800 })], 'clip_then_me', 9000), /after your part ends/)
  const fitted = shared.fitRemixGraphic({ ...g({ at_ms: 8500 }), duration_ms: 3000 }, 'clip_then_me', 9000)
  assert.deepEqual([fitted.at_ms, fitted.duration_ms], [6000, 3000])
})

test('bands: under the hook text and clear of the captions, their clip’s box, the split line and the banner', () => {
  const edit = shared.editGraphicFrame('Most coaches lose clients', { headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, includeCaptions: true })
  assert.ok(edit.hook > 0.16 && edit.captions.y > 0.7)
  const top = shared.graphicBox('top', edit)
  assert.ok(top.top >= edit.hook && top.bottom <= edit.captions.y - 0.075)
  assert.equal(shared.editGraphicFrame('Hi', { headlineLook: { look: 'none', color: '#FFFFFF', font: 'clean' }, includeCaptions: false }).hook, 0)
  const ctx = { format: 'pause_react', pauseLayout: 'box', hookAt: 'top', headlineLook: null, includeCaptions: true, momentPip: false }
  // Pause & react with their video in a box at the top: never over the box (here, over the captions' line instead).
  const pause = shared.remixGraphicFrame(ctx, 'He says scam ads run every day')
  const [boxTop, boxBottom] = pause.blocked[0]
  for (const placement of ['top', 'middle', 'bottom']) {
    const band = shared.graphicBox(placement, pause)
    assert.ok(band.top >= boxBottom || band.bottom <= boxTop, `${placement}: ${JSON.stringify(band)} vs the box ${boxTop}–${boxBottom}`)
  }
  // Split, with the hook text on the split line: the lower half, clear of the line.
  const split = shared.remixGraphicFrame({ ...ctx, pauseLayout: 'split', hookAt: 'seam' }, 'He says scam ads run every day')
  assert.equal(split.hook, 0)
  for (const placement of ['top', 'middle', 'bottom']) assert.ok(shared.graphicBox(placement, split).top >= 0.53, placement)
  // React, then my thoughts with the comment banner; Moment + my take with the moment in its box.
  const banner = shared.remixGraphicFrame({ ...ctx, format: 'react_thoughts' }, 'He says scam ads run every day', true)
  assert.ok(shared.graphicBox('top', banner).top >= banner.blocked[0][1])
  const pip = shared.remixGraphicFrame({ ...ctx, format: 'moment_take', momentPip: true }, 'He says scam ads run every day')
  assert.ok(shared.graphicBox('top', pip).top >= pip.blocked[0][1])
  // The clip editor's frames (no blocked bands) are unchanged.
  assert.deepEqual(plain(shared.graphicBox('top', { aspect: '9:16', hook: 0.2, captions: null })), { top: 0.22, bottom: 0.49 })
})

test('a stat’s words from the model: only the template’s fields, plain text, something to show', () => {
  assert.deepEqual(plain(shared.graphicFields('stat', {}, { value: ' $1,200 ', label: 'a\nmonth' })), { value: '$1,200', label: 'a month' })
  assert.deepEqual(plain(shared.graphicFields('list', {}, { title: 'Steps', items: 'One\n\nTwo\nThree\nFour\nFive\nSix' })).items, 'One\nTwo\nThree\nFour\nFive')
  assert.throws(() => shared.graphicFields('stat', {}, { image: 'x.png' }), /can’t add images/)
  assert.throws(() => shared.graphicFields('quote', {}, {}), /its text/)
})
