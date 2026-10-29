// Screen zooms in the clip editor (src/shared/screen-zoom.ts): the moves and zoom area are checked like the engine
// checks them, the preview's crop path matches the engine's crop_at (same easing, holds, pans, intensity and caps),
// a clip's zooms can be turned on or off and made gentler or stronger, and the project keeps them. Also the graphics
// cap that grows with a YouTube video's length (reels keep 60).
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const sz = loadMain("export * from './src/shared/screen-zoom'; export { parseEditorProject, candidateEdit, renderEditKey } from './src/shared/clip-editor'; export { graphicsCap, MAX_GRAPHICS_PER_CLIP, MAX_GRAPHICS_LONG, parseGraphics, withGraphic, newGraphic } from './src/shared/motion-graphics'; export { editGraphicsLimit } from './src/shared/reel-graphics'; export { parseEditPlan } from './src/shared/edit-recording'")
const plain = (value) => JSON.parse(JSON.stringify(value))
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps)

const move = { at_ms: 1000, end_ms: 9000, keys: [[1000, 0.3, 0.3, 2], [5000, 0.7, 0.6, 2]], max: 2.2 }

test('the crop path eases in decelerating, holds, pans and eases out like the engine', () => {
  assert.deepEqual(sz.zoomCropAt(move, 500), [0, 0, 1, 1])
  assert.deepEqual(sz.zoomCropAt(move, 9500), [0, 0, 1, 1])
  const widths = Array.from({ length: 13 }, (_, k) => sz.zoomCropAt(move, 1000 + k * 50)[2])
  assert.ok(widths.every((w, i) => i === 0 || w < widths[i - 1]))
  assert.ok(1 - sz.zoomCropAt(move, 1300)[2] > 0.375)
  // The same numbers as screen_zoom.crop_at (engine/tests/test_screen_zoom.py).
  assert.ok(near(sz.zoomCropAt(move, 3000), [0.05, 0.05, 0.5, 0.5]))
  assert.ok(near(sz.zoomCropAt(move, 5000 + sz.PAN_MS + 10), [0.45, 0.35, 0.5, 0.5]))
  assert.ok(sz.zoomCropAt(move, 8990)[2] > 0.95)
  assert.ok(Math.abs(sz.zoomCropAt({ ...move, intensity: 0.5 }, 3000)[2] - 1 / 1.5) < 1e-9)
  assert.ok(Math.abs(sz.zoomCropAt({ ...move, intensity: 1.5 }, 3000)[2] - 1 / 2.2) < 1e-9)
  assert.deepEqual(sz.zoomCropAt({ ...move, on: false }, 3000), [0, 0, 1, 1])
  assert.deepEqual(sz.zoomsCropAt([move], 3000), sz.zoomCropAt(move, 3000))
  assert.deepEqual(sz.zoomsCropAt([move], 10000), [0, 0, 1, 1])
  const glow = { ...move, glow: { box: [0.1, 0.1, 0.1, 0.05], at_ms: 4000 } }
  assert.equal(sz.glowAt(glow, 3900), 0)
  assert.equal(sz.glowAt(glow, 5000), 1)
  assert.equal(sz.glowAt({ ...glow, on: false }, 5000), 0)
})

test('zoom moves and the zoom area are checked like the engine checks them', () => {
  const good = [{ at_ms: 0, end_ms: 2000, keys: [[0, 0.5, 0.5, 1.5]], max: 2, intensity: 1.2, clip: '0123456789abcdef.mp4', glow: { box: [0.1, 0.1, 0.2, 0.1], at_ms: 500 } }]
  assert.deepEqual(plain(sz.parseZooms(good, 5000)), good)
  for (const bad of [[{ ...good[0], clip: '../x.mp4' }], [{ ...good[0], keys: [[0, 0.5, 0.5, 3]] }], [{ ...good[0], end_ms: 6000 }], [{ ...good[0], extra: 1 }],
    [good[0], { ...good[0] }], [{ ...good[0], intensity: 3 }], [{ ...good[0], glow: { box: [0.9, 0, 0.2, 0.1], at_ms: 0 } }], 'x']) {
    assert.throws(() => sz.parseZooms(bad, 5000), /Invalid zooms/)
  }
  assert.deepEqual(plain(sz.parseZoomArea({ area: [0.02, 0.04, 0.6, 0.6], keep: [0.7, 0.2, 0.25, 0.5], radius: 0.02 })), { area: [0.02, 0.04, 0.6, 0.6], keep: [0.7, 0.2, 0.25, 0.5], radius: 0.02 })
  assert.throws(() => sz.parseZoomArea({ area: [0.5, 0.5, 0.6, 0.6] }))
})

test('a clip turns its zooms on or off and makes one gentler or stronger; the project keeps them', () => {
  const zooms = [move, { at_ms: 12000, end_ms: 15000, keys: [[12000, 0.5, 0.5, 1.6]] }]
  const off = sz.patchZoom(zooms, 12000, { on: false })
  assert.equal(off[1].on, false)
  assert.equal(sz.zoomsOn(off), 1)
  assert.equal('on' in sz.patchZoom(off, 12000, { on: true })[1], false)
  assert.equal(sz.patchZoom(zooms, 1000, { intensity: 0.6 })[0].intensity, 0.6)
  assert.equal('intensity' in sz.patchZoom(zooms, 1000, { intensity: 1 })[0], false)
  assert.equal(sz.zoomsOn(sz.setAllZooms(zooms, false)), 0)
  assert.equal(sz.zoomsOn(sz.setAllZooms(sz.setAllZooms(zooms, false), true)), 2)

  const project = plain(fixture)
  project.zoom = { area: [0, 0, 1, 1] }
  project.candidates[0].zooms = [{ at_ms: project.candidates[0].ranges[0][0] + 100, end_ms: project.candidates[0].ranges[0][0] + 2100, keys: [[project.candidates[0].ranges[0][0] + 100, 0.5, 0.5, 1.5]] }]
  const parsed = sz.parseEditorProject(project)
  assert.deepEqual(plain(parsed.zoom), { area: [0, 0, 1, 1] })
  assert.equal(parsed.candidates[0].zooms.length, 1)
  // Turning a zoom off changes what Bake makes.
  const edit = sz.candidateEdit(parsed.candidates[0])
  assert.notEqual(sz.renderEditKey(edit), sz.renderEditKey({ ...edit, zooms: sz.setAllZooms(edit.zooms, false) }))
  project.candidates[0].zooms[0].end_ms = project.duration_ms + 10
  assert.throws(() => sz.parseEditorProject(project))
})

test('a YouTube video may carry more graphics the longer it is; a reel keeps 60', () => {
  assert.equal(sz.graphicsCap({ aspect_ratio: '9:16', duration_ms: 3600000 }), 60)
  assert.equal(sz.graphicsCap({ aspect_ratio: '16:9', duration_ms: 5 * 60000 }), 60)
  assert.equal(sz.graphicsCap({ aspect_ratio: '16:9', duration_ms: 26 * 60000 }), 156)
  assert.equal(sz.graphicsCap({ aspect_ratio: '16:9', duration_ms: 45 * 60000 }), sz.MAX_GRAPHICS_LONG)
  assert.equal(sz.graphicsCap(null), sz.MAX_GRAPHICS_PER_CLIP)
  const many = Array.from({ length: 100 }, (_, i) => sz.newGraphic('title', 1000 + i * 100))
  assert.throws(() => sz.parseGraphics(many), /up to 60/)
  assert.equal(sz.parseGraphics(many, 156).length, 100)
  assert.equal(sz.withGraphic({ ranges: [[0, 1e6]], video_speed: 1, graphics: many }, sz.newGraphic('title', 5000), 156).length, 101)
  // The editor project: a 26-minute YouTube video keeps 100 graphics, a reel of the same length doesn't.
  const project = plain(fixture)
  project.duration_ms = 26 * 60000
  const at = project.candidates[0].ranges[0][0]
  project.candidates[0].graphics = many.map((g, i) => ({ ...g, at_ms: at + i * 10, duration_ms: 1000 }))
  assert.throws(() => sz.parseEditorProject(project))
  project.aspect_ratio = '16:9'; project.width = 1920; project.height = 1080
  assert.equal(sz.parseEditorProject(project).candidates[0].graphics.length, 100)
  // The review of a YouTube video's plan keeps more too.
  assert.equal(sz.editGraphicsLimit('youtube'), sz.MAX_GRAPHICS_LONG)
  assert.equal(sz.editGraphicsLimit(undefined), 60)
})
