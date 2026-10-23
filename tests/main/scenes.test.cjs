// Scenes (face / stage / visual): the shared contract (parse, sceneAt, editing helpers, the engine's
// output-clock field through cuts and speed), saved edits, and the chat's set_scene tool.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const sc = loadMain("export * from './src/shared/scenes'; export { parseCandidateEdit, candidateEdit, renderEditKey, refineEdit } from './src/shared/clip-editor'; export { applyChatTool, mergeChatSteps, CHAT_TOOLS } from './src/shared/clip-chat'")
const plain = (x) => JSON.parse(JSON.stringify(x))
const clip = (over = {}) => ({ ...plain(sc.parseCandidateEdit(structuredClone(fixture.candidates[0]), 12000, 4)), ...over })
const project = { duration_ms: 12000, width: 1920, height: 1080, aspect_ratio: '9:16', transcriptCount: 4 }
const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message))

test('parseScenes accepts well-formed scenes and refuses everything else', () => {
  assert.deepEqual(plain(sc.parseScenes([{ scene: 'stage', start_ms: 1000.4, end_ms: 3000 }, { scene: 'visual', start_ms: 3000, end_ms: 5000, backdrop: 'dark' }, { scene: 'face', start_ms: 6000, end_ms: 7500 }], 12000)),
    [{ scene: 'stage', start_ms: 1000, end_ms: 3000 }, { scene: 'visual', start_ms: 3000, end_ms: 5000, backdrop: 'dark' }, { scene: 'face', start_ms: 6000, end_ms: 7500 }])
  // Light is the default backdrop (not stored); face never keeps one.
  assert.deepEqual(plain(sc.parseScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000, backdrop: 'light' }, { scene: 'face', start_ms: 2000, end_ms: 4000, backdrop: 'dark' }])),
    [{ scene: 'stage', start_ms: 0, end_ms: 2000 }, { scene: 'face', start_ms: 2000, end_ms: 4000 }])
  assert.deepEqual(sc.parseScenes(undefined), [])
  for (const bad of [
    {}, 'stage', [null], [{ scene: 'zoom', start_ms: 0, end_ms: 2000 }], [{ scene: 'stage', start_ms: 0, end_ms: 1000 }],
    [{ scene: 'stage', start_ms: -5, end_ms: 2000 }], [{ scene: 'stage', start_ms: 0, end_ms: 2000, backdrop: 'red' }],
    [{ scene: 'stage', start_ms: 0, end_ms: 2000, extra: true }], [{ scene: 'stage', start_ms: 0, end_ms: Infinity }],
    [{ scene: 'stage', start_ms: 0, end_ms: 3000 }, { scene: 'visual', start_ms: 2000, end_ms: 4000 }],
    Array.from({ length: 61 }, (_, i) => ({ scene: 'stage', start_ms: i * 2000, end_ms: i * 2000 + 1500 }))
  ]) assert.throws(() => sc.parseScenes(bad))
  assert.throws(() => sc.parseScenes([{ scene: 'stage', start_ms: 11000, end_ms: 13000 }], 12000), /inside the video/)
})

test('sceneAt finds the scene at a time and face in the gaps', () => {
  const scenes = sc.parseScenes([{ scene: 'stage', start_ms: 1000, end_ms: 3000 }, { scene: 'visual', start_ms: 3000, end_ms: 5000, backdrop: 'dark' }])
  assert.equal(sc.sceneAt(scenes, 500).scene, 'face')
  assert.equal(sc.sceneAt(scenes, 1000).scene, 'stage')
  assert.equal(sc.sceneAt(scenes, 2999).scene, 'stage')
  assert.deepEqual(plain(sc.sceneAt(scenes, 3000)), { scene: 'visual', start_ms: 3000, end_ms: 5000, backdrop: 'dark' })
  assert.equal(sc.sceneAt(scenes, 5000).scene, 'face')
  assert.equal(sc.sceneAt(undefined, 5000).scene, 'face')
})

test('normalize, set, update and add keep scenes in order, apart and at least 1.2 s', () => {
  // Later wins an overlap; same neighbors merge; short pieces go with minMs.
  assert.deepEqual(plain(sc.normalizeScenes([{ scene: 'stage', start_ms: 0, end_ms: 4000 }, { scene: 'visual', start_ms: 3000, end_ms: 5000 }, { scene: 'visual', start_ms: 5000, end_ms: 6000 }])),
    [{ scene: 'stage', start_ms: 0, end_ms: 3000 }, { scene: 'visual', start_ms: 3000, end_ms: 6000 }])
  assert.deepEqual(plain(sc.normalizeScenes([{ scene: 'stage', start_ms: 0, end_ms: 4000 }, { scene: 'visual', start_ms: 1000, end_ms: 3800 }], { minMs: 1200 })),
    [{ scene: 'stage', start_ms: 0, end_ms: 1000 }, { scene: 'visual', start_ms: 1000, end_ms: 3800 }].filter((s) => s.end_ms - s.start_ms >= 1200))
  // Painting a scene over the middle of another splits it; face takes the time back.
  let scenes = sc.setScene([], 1000, 9000, 'stage')
  scenes = sc.setScene(scenes, 4000, 6000, 'visual', 'dark')
  assert.deepEqual(plain(scenes), [{ scene: 'stage', start_ms: 1000, end_ms: 4000 }, { scene: 'visual', start_ms: 4000, end_ms: 6000, backdrop: 'dark' }, { scene: 'stage', start_ms: 6000, end_ms: 9000 }])
  assert.deepEqual(plain(sc.setScene(scenes, 3500, 8500, 'face')), [{ scene: 'stage', start_ms: 1000, end_ms: 3500 }])
  // Moving keeps the length and stays clear of the neighbors and the clip.
  const bounds = { start: 1000, end: 10000 }
  assert.deepEqual(plain(sc.updateScene(scenes, 1, { start_ms: 2000, end_ms: 4000 }, bounds)[1]), { scene: 'visual', start_ms: 4000, end_ms: 6000, backdrop: 'dark' })
  const moved = sc.updateScene([{ scene: 'stage', start_ms: 2000, end_ms: 4000 }], 0, { start_ms: 9000, end_ms: 11000 }, bounds)
  assert.deepEqual(plain(moved), [{ scene: 'stage', start_ms: 8000, end_ms: 10000 }])
  // An edge can't make it shorter than 1.2 s.
  assert.deepEqual(plain(sc.updateScene([{ scene: 'stage', start_ms: 2000, end_ms: 4000 }], 0, { end_ms: 2100 }, bounds)), [{ scene: 'stage', start_ms: 2000, end_ms: 3200 }])
  assert.deepEqual(plain(sc.updateScene([{ scene: 'stage', start_ms: 2000, end_ms: 4000 }], 0, { backdrop: 'brand', scene: 'visual' }, bounds)), [{ scene: 'visual', start_ms: 2000, end_ms: 4000, backdrop: 'brand' }])
  // A new scene at the playhead fits the free time there.
  assert.deepEqual(plain(sc.newSceneAt([], 2000, bounds)), { scene: 'stage', start_ms: 2000, end_ms: 5000 })
  assert.deepEqual(plain(sc.newSceneAt([], 9500, bounds)), { scene: 'stage', start_ms: 7000, end_ms: 10000 })
  assert.deepEqual(plain(sc.newSceneAt([{ scene: 'stage', start_ms: 1000, end_ms: 3000 }, { scene: 'stage', start_ms: 5000, end_ms: 9000 }], 3500, bounds)), { scene: 'stage', start_ms: 3000, end_ms: 5000 })
  assert.equal(sc.newSceneAt([{ scene: 'stage', start_ms: 1000, end_ms: 3000 }], 2000, bounds), null, 'the playhead is in a scene')
  assert.equal(sc.newSceneAt([{ scene: 'stage', start_ms: 1000, end_ms: 3000 }, { scene: 'stage', start_ms: 4000, end_ms: 9000 }], 3500, bounds), null, 'no room')
})

test('the engine field is on the finished clip\'s clock: through a cut and at 1.25x', () => {
  // The fixture clip: [1000, 5000] and [7000, 10000] at 1.25x (5.6 s long).
  const c = clip({ stage_scenes: [
    { scene: 'stage', start_ms: 2000, end_ms: 4000 },
    // Across the cut: 4500–5000 and 7000–8000 are kept and play back to back.
    { scene: 'visual', start_ms: 4500, end_ms: 8000, backdrop: 'dark' },
    { scene: 'face', start_ms: 8000, end_ms: 9500 },
    // Wholly in the cut-out part: dropped.
    { scene: 'stage', start_ms: 5200, end_ms: 6800 }
  ] })
  assert.deepEqual(plain(sc.outputScenes(c)), [
    { scene: 'stage', start_ms: 800, end_ms: 2400 },
    { scene: 'visual', start_ms: 2800, end_ms: 4000, backdrop: 'dark' }
  ])
  assert.deepEqual(plain(sc.outputScenes({ ...c, video_speed: 1 })), [
    { scene: 'stage', start_ms: 1000, end_ms: 3000 },
    { scene: 'visual', start_ms: 3500, end_ms: 5000, backdrop: 'dark' }
  ])
  assert.deepEqual(plain(sc.outputScenes(clip())), [])
  // The preview's mix: the card slides up over 350 ms from a stage start, the backdrop fades.
  const out = sc.outputScenes(c)
  assert.deepEqual(plain(sc.sceneMix(out, 500)), { backdrop: null, under: null, alpha: 0, card: 0, shape: 'rounded' })
  const rising = sc.sceneMix(out, 800 + 175)
  assert.equal(rising.backdrop, 'light'); assert.ok(Math.abs(rising.card - 0.5) < 1e-9 && Math.abs(rising.alpha - 0.5) < 1e-9)
  assert.deepEqual(plain(sc.sceneMix(out, 2000)), { backdrop: 'light', under: null, alpha: 1, card: 1, shape: 'rounded' })
  const leaving = sc.sceneMix(out, 4000 + 350)
  assert.deepEqual(plain(leaving), { backdrop: 'dark', under: null, alpha: 0, card: 0, shape: 'rounded' })
})

test('saved edits keep scenes beside the graphics, and a change needs a new render', () => {
  const raw = { ...structuredClone(fixture.candidates[0]), stage_scenes: [{ scene: 'stage', start_ms: 2000, end_ms: 4000, backdrop: 'dark' }] }
  const c = sc.parseCandidateEdit(raw, 12000, 4)
  assert.deepEqual(plain(c.stage_scenes), [{ scene: 'stage', start_ms: 2000, end_ms: 4000, backdrop: 'dark' }])
  assert.deepEqual(plain(sc.candidateEdit(c).stage_scenes), plain(c.stage_scenes))
  assert.deepEqual(plain(sc.candidateEdit({ ...c, stage_scenes: [] }).stage_scenes), [], 'kept when empty, so removing the last one saves')
  assert.equal(sc.parseCandidateEdit(structuredClone(fixture.candidates[0]), 12000, 4).stage_scenes, undefined)
  assert.throws(() => sc.parseCandidateEdit({ ...raw, stage_scenes: [{ scene: 'stage', start_ms: 2000, end_ms: 2500 }] }, 12000, 4))
  const ready = { ...c, status: 'ready' }
  assert.equal(sc.refineEdit(ready, { stage_scenes: [{ scene: 'visual', start_ms: 2000, end_ms: 4000 }] }).status, 'refining')
  assert.equal(sc.renderEditKey({ ...c, stage_scenes: [] }), sc.renderEditKey({ ...c, stage_scenes: undefined }))
})

test('the chat sets a scene over part of the clip and says where in clip time', () => {
  const c = clip()
  let r = sc.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4500, scene: 'stage', reason: 'to give the stat room' }, project, () => 'x')
  assert.deepEqual(plain(r.step.patch), { stage_scenes: [{ scene: 'stage', start_ms: 2000, end_ms: 4500 }] })
  assert.equal(r.step.summary, 'Stage scene on the light backdrop from 0:00.8 to 0:02.8 to give the stat room.')
  r = sc.applyChatTool(r.candidate, 'set_scene', { start_ms: 3000, end_ms: 4500, scene: 'visual', backdrop: 'dark' }, project, () => 'x')
  assert.deepEqual(plain(r.candidate.stage_scenes), [{ scene: 'stage', start_ms: 2000, end_ms: 3000 }, { scene: 'visual', start_ms: 3000, end_ms: 4500, backdrop: 'dark' }].filter((s) => s.end_ms - s.start_ms >= 1200))
  r = sc.applyChatTool(r.candidate, 'set_scene', { start_ms: 0, end_ms: 12000, scene: 'face' }, project, () => 'x')
  assert.deepEqual(plain(r.candidate.stage_scenes), [])
  // Clipped to the clip; checked.
  r = sc.applyChatTool(c, 'set_scene', { start_ms: 0, end_ms: 3000, scene: 'stage', backdrop: 'brand' }, project, () => 'x')
  assert.deepEqual(plain(r.candidate.stage_scenes), [{ scene: 'stage', start_ms: 1000, end_ms: 3000, backdrop: 'brand' }])
  toolError(() => sc.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 2600, scene: 'stage' }, project, () => 'x'), /at least 1.2 seconds/)
  toolError(() => sc.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4000, scene: 'zoom' }, project, () => 'x'), /scene must be/)
  toolError(() => sc.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4000, scene: 'face', backdrop: 'dark' }, project, () => 'x'), /no backdrop/)
  toolError(() => sc.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4000, scene: 'stage' }, { ...project, aspect_ratio: '16:9' }, () => 'x'), /vertical/)
  // The renderer's check merges and re-validates the patch.
  const steps = [sc.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4500, scene: 'stage' }, project, () => 'x').step]
  assert.deepEqual(plain(sc.mergeChatSteps(c, steps, project)), { stage_scenes: [{ scene: 'stage', start_ms: 2000, end_ms: 4500 }] })
  assert.throws(() => sc.mergeChatSteps(c, [{ ...steps[0], patch: { stage_scenes: [{ scene: 'stage', start_ms: 2000, end_ms: 2100 }] } }], project))
  assert.ok(sc.CHAT_TOOLS.some((t) => t.name === 'set_scene' && t.parameters.required.includes('scene')))
})

test('stage layout: a tall speaker card (head and shoulders), the stage down to half the frame, captions between', () => {
  const L = sc.STAGE_LAYOUT
  assert.equal(L.cardHeight, 0.42); assert.equal(L.stageBottom, 0.5); assert.equal(L.cardBottom, 32 / 1920)
  const cardTop = 1 - L.cardBottom - L.cardHeight
  // The caption band (the engine: stage_scenes.geometry) is at least 120 px tall at 1920.
  assert.ok((cardTop - L.stageBottom) * 1920 >= 120)
  assert.ok(Math.abs(sc.sceneCaptionY('stage') - (L.stageBottom + cardTop) / 2) < 1e-12)
})

test('the hook hands over to the first stage scene (not one in the first 2.5 s); stage graphics after it take the top', () => {
  const gl = loadMain("export * from './src/shared/graphic-layout'")
  // Cuts [1000, 5000] and [7000, 10000] at 1.25x.
  const timing = { ranges: [[1000, 5000], [7000, 10000]], video_speed: 1.25 }
  assert.equal(sc.stageHookEndMs({ ...timing, stage_scenes: [{ scene: 'stage', start_ms: 7000, end_ms: 9500 }] }), 3200)
  assert.equal(sc.stageHookEndMs({ ...timing, stage_scenes: [{ scene: 'stage', start_ms: 3000, end_ms: 4500 }] }), null)
  assert.equal(sc.stageHookEndMs({ ...timing, stage_scenes: [] }), null)
  const hook = { text: 'No huge audience needed to make money online', look: { look: 'floating', color: '#FFFFFF', font: 'clean' } }
  const c = clip({ ...timing, captions: true, hook, stage_scenes: [{ scene: 'stage', start_ms: 7000, end_ms: 9500 }] })
  const project9 = { aspect_ratio: '9:16', width: 1080, height: 1920 }
  const g = { id: 'g-s', template: 'statement', at_ms: 7400, duration_ms: 1500, placement: 'top', size: 'stage', fields: { text: 'Three things' } }
  const staged = gl.graphicSpec(project9, c, g)
  assert.ok(gl.hookShare(c, '9:16') > 0.1 && staged.box.top < 0.1, JSON.stringify(staged.box))
  assert.ok(Math.abs(staged.box.bottom - sc.STAGE_LAYOUT.stageBottom) < 1e-9)
  // Without the stage the hook keeps its band and the graphic stays under it.
  const plain9 = gl.graphicSpec(project9, { ...c, stage_scenes: [] }, g)
  assert.ok(plain9.box.top > gl.hookShare(c, '9:16'), JSON.stringify(plain9.box))
})
