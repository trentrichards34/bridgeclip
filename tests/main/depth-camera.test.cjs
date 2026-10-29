// Depth and camera: a stage scene's frame escape and camera move (the shared scene contract and the editor's preview
// of the move), the Type takeover graphic (its lines, depth and sound), and what a bake sends the engine.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')

const m = loadMain("export * from './src/shared/scenes'; export * from './src/shared/motion-graphics'; export { bakeSoundEvents } from './src/shared/sound-design'")
const plain = (x) => JSON.parse(JSON.stringify(x))

test('a stage scene keeps its escape and camera move only when they differ from the defaults', () => {
  const scenes = m.parseScenes([
    { scene: 'stage', start_ms: 1000, end_ms: 3000, escape: false, transition: 'whip' },
    { scene: 'visual', start_ms: 3000, end_ms: 5000, escape: false, transition: 'zoom' },
    { scene: 'stage', start_ms: 6000, end_ms: 8000, escape: true, transition: 'slide' }
  ])
  // Escape is stage only and on unless turned off; zoom is the default move.
  assert.deepEqual(plain(scenes), [
    { scene: 'stage', start_ms: 1000, end_ms: 3000, escape: false, transition: 'whip' },
    { scene: 'visual', start_ms: 3000, end_ms: 5000 },
    { scene: 'stage', start_ms: 6000, end_ms: 8000, transition: 'slide' }
  ])
  assert.equal(m.sceneEscapes(scenes[0]), false)
  assert.equal(m.sceneEscapes(scenes[2]), true)
  assert.equal(m.sceneTransition(scenes[1]), 'zoom')
  for (const bad of [{ escape: 'yes' }, { transition: 'spin' }]) {
    assert.throws(() => m.parseScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000, ...bad }]))
  }
  // Editing: turning the escape back on drops the field; a different move or escape keeps neighbors apart.
  const on = m.updateScene(scenes, 0, { escape: undefined }, { start: 0, end: 12000 })
  assert.deepEqual(plain(on[0]), { scene: 'stage', start_ms: 1000, end_ms: 3000, transition: 'whip' })
  const merged = m.normalizeScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000 }, { scene: 'stage', start_ms: 2000, end_ms: 4000, escape: false }])
  assert.equal(merged.length, 2)
  // Through the cut to the engine's clock.
  assert.deepEqual(plain(m.outputScenes({ ranges: [[0, 10000]], video_speed: 1, stage_scenes: scenes })[0]),
    { scene: 'stage', start_ms: 1000, end_ms: 3000, escape: false, transition: 'whip' })
})

test('the preview places each camera move around its cut, in the entered scene’s style', () => {
  const scenes = m.parseScenes([{ scene: 'stage', start_ms: 1000, end_ms: 3000 }, { scene: 'visual', start_ms: 3000, end_ms: 5000, transition: 'whip' },
    { scene: 'stage', start_ms: 8000, end_ms: 10000, transition: 'slide' }, { scene: 'stage', start_ms: 11000, end_ms: 13000, transition: 'slide' },
    { scene: 'visual', start_ms: 13000, end_ms: 15000 }])
  assert.equal(m.sceneMove(scenes, 500), null)
  // Zoom with the face: the video scales into the card (MORPH_FRAMES), no camera push on top of it.
  assert.equal(m.sceneMove(scenes, 1000), null)
  assert.equal(m.MORPH_FRAMES, 11)
  // Zoom between stage and visual: 8 frames at 30 fps, the cut in the middle.
  assert.deepEqual(plain(m.sceneMove(scenes, 13000)), { kind: 'zoom', p: 0.5 })
  assert.equal(m.sceneMove(scenes, 13000 - 120).kind, 'zoom')
  assert.equal(m.sceneMove(scenes, 13000 + 140), null)
  // Stage to visual: the visual's whip; visual back to face: still the whip (the scene being left).
  assert.equal(m.sceneMove(scenes, 3000).kind, 'whip')
  assert.equal(m.sceneMove(scenes, 5000).kind, 'whip')
  // A slide has no camera move.
  assert.equal(m.sceneMove(scenes, 8000), null)
  assert.equal(m.TRANSITION_FRAMES.zoom, 8)
})

test('the scene sound lands on the cut, the middle of the camera move', () => {
  const c = { ranges: [[0, 10000]], video_speed: 1, stage_scenes: m.parseScenes([{ scene: 'stage', start_ms: 2000, end_ms: 6000, transition: 'whip' }]) }
  const events = m.bakeSoundEvents(c, false)
  assert.deepEqual(plain(events), [{ kind: 'scene', at_ms: 2000, end_ms: 6000 }])
  assert.equal(m.sceneMove(c.stage_scenes, events[0].at_ms).p, 0.5)
})

test('a Type takeover breaks its line into short lines and sits between the head and the chest', () => {
  assert.deepEqual(m.takeoverLines('This is the line that matters most'), [['This', 'is', 'the'], ['line', 'that'], ['matters'], ['most']])
  assert.deepEqual(m.takeoverLines('   '), [])
  assert.ok(m.takeoverLines('one two three four five six seven eight nine ten eleven').flat().length === m.MAX_TAKEOVER_WORDS)
  assert.ok(m.takeoverLines('a b c d e f g h i').length <= 5)
  const g = m.newGraphic('takeover', 1000, { fields: { text: 'Here is the thing', accent: 'thing' } })
  assert.equal(m.graphicDepth(g), 'between')
  assert.equal(g.depth, undefined)
  assert.ok(m.graphicHasContent(g))
  assert.ok(m.WORD_TIMED_TEMPLATES.includes('takeover'))
  assert.deepEqual(m.cardWords('takeover', g.fields), ['Here', 'is', 'the', 'thing'])
  // Set in front, it stays there; a takeover can't be "behind", and other templates can't be "between".
  const front = m.updateGraphic({ ranges: [[0, 10000]], video_speed: 1, graphics: [g] }, g.id, { depth: 'front' })[0]
  assert.equal(m.graphicDepth(front), 'front')
  assert.equal(m.parseGraphics([{ ...g, depth: 'behind' }])[0].depth, undefined)
  assert.equal(m.parseGraphics([{ ...g, id: 'abcd-1', template: 'title', depth: 'between' }])[0].depth, undefined)
  assert.equal(m.parseGraphics([{ ...g, depth: 'between' }])[0].depth, 'between')
})
