// The second reel's looks: grid / gradient backdrops and the arch card per scene, the Highlight box captions'
// rules, the Orbit, Feature tile and Screen recording templates, word-timed text cards, and the chat's new options.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const m = loadMain(`export * from './src/shared/scenes'; export * from './src/shared/motion-graphics'; export * from './src/shared/graphic-layout';
  export { parseCandidateEdit } from './src/shared/clip-editor'; export { applyChatTool, CHAT_TOOLS } from './src/shared/clip-chat';
  export { CAPTION_PRESETS, isCaptionPresetId } from './src/shared/caption-presets'; export { REEL_GRAPHIC_TEMPLATES, drawableGraphics } from './src/shared/reel-graphics'`)
const plain = (x) => JSON.parse(JSON.stringify(x))
const clip = (over = {}) => ({ ...plain(m.parseCandidateEdit(structuredClone(fixture.candidates[0]), 12000, 4)), ...over })
const project = { duration_ms: 12000, width: 1920, height: 1080, aspect_ratio: '9:16', transcriptCount: 4 }
const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message))
// "So I built my own ads manager" said from 2000 ms, 250 ms a word.
const WORDS = ['So', 'I', 'built', 'my', 'own', 'ads', 'manager'].map((word, i) => ({ word, start_ms: 2000 + i * 250, end_ms: 2200 + i * 250 }))

test('scenes: grid and gradient backdrops and the arch card parse, save and stay backward compatible', () => {
  assert.deepEqual(plain(m.parseScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000, backdrop: 'grid', card: 'arch' }, { scene: 'visual', start_ms: 2000, end_ms: 4000, backdrop: 'gradient', card: 'arch' }])),
    [{ scene: 'stage', start_ms: 0, end_ms: 2000, backdrop: 'grid', card: 'arch' }, { scene: 'visual', start_ms: 2000, end_ms: 4000, backdrop: 'gradient' }])
  // Rounded is the default (not stored); old scenes read as before.
  assert.deepEqual(plain(m.parseScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000, card: 'rounded' }])), [{ scene: 'stage', start_ms: 0, end_ms: 2000 }])
  assert.throws(() => m.parseScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000, card: 'oval' }]), /rounded, arch, cut-out or screen/)
  assert.throws(() => m.parseScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000, backdrop: 'neon' }]), /grid, gradient, solid or paper/)
  // Neighbors with different cards stay apart; a change of card is kept by updateScene.
  const two = m.normalizeScenes([{ scene: 'stage', start_ms: 0, end_ms: 2000 }, { scene: 'stage', start_ms: 2000, end_ms: 4000, card: 'arch' }])
  assert.equal(two.length, 2)
  const changed = m.updateScene([{ scene: 'stage', start_ms: 0, end_ms: 2000, backdrop: 'grid' }], 0, { card: 'arch' }, { start: 0, end: 12000 })
  assert.deepEqual(plain(changed), [{ scene: 'stage', start_ms: 0, end_ms: 2000, backdrop: 'grid', card: 'arch' }])
  assert.deepEqual(plain(m.setScene([], 1000, 3000, 'stage', 'grid', 12000, 'arch')), [{ scene: 'stage', start_ms: 1000, end_ms: 3000, backdrop: 'grid', card: 'arch' }])
  // The engine's field keeps the card through the cut.
  const c = clip({ stage_scenes: [{ scene: 'stage', start_ms: 1500, end_ms: 4000, backdrop: 'grid', card: 'arch' }] })
  assert.deepEqual(plain(m.outputScenes(c)).map((s) => [s.backdrop, s.card]), [['grid', 'arch']])
  // The preview knows the card's shape, also while it slides away.
  const scenes = [{ scene: 'stage', start_ms: 0, end_ms: 2000, card: 'arch' }]
  assert.equal(m.sceneMix(scenes, 1000).shape, 'arch')
  assert.equal(m.sceneMix(scenes, 2100).shape, 'arch')
  assert.equal(m.sceneMix([{ scene: 'stage', start_ms: 0, end_ms: 2000 }], 1000).shape, 'rounded')
})

test('scenes: the automatic look follows the brand color, and each backdrop has its caption look', () => {
  assert.deepEqual(plain(m.autoSceneLook('#7C3AED')), { backdrop: 'grid', card: 'arch' })
  assert.deepEqual(plain(m.autoSceneLook(null)), { backdrop: 'grid', card: 'rounded' })
  assert.deepEqual(plain(m.autoSceneLook('purple')), { backdrop: 'grid', card: 'rounded' })
  assert.deepEqual(['light', 'brand', 'grid', 'gradient', 'dark', undefined].map(m.sceneCaptionLook), ['dark_text', 'dark_text', 'box', 'box', 'own', 'dark_text'])
})

test('captions: Highlight box is a preset, and the descriptions use US spelling', () => {
  assert.ok(m.isCaptionPresetId('highlight_box'))
  assert.equal(m.CAPTION_PRESETS.find((p) => p.id === 'highlight_box').name, 'Highlight box')
  assert.equal(m.CAPTION_PRESETS.find((p) => p.id === 'sweep').description, 'Color follows the voice')
  assert.ok(!m.CAPTION_PRESETS.some((p) => /colour/i.test(p.description)))
})

test('new templates: contract, content, defaults and reel screens', () => {
  for (const id of ['orbit', 'feature_tile', 'screen_frame']) {
    assert.ok(m.isGraphicTemplate(id), id)
    assert.ok(m.GRAPHIC_DEFAULT_MS[id] >= 3000, id)
  }
  assert.equal(m.graphicHasContent({ template: 'orbit', fields: {} }), false)
  assert.equal(m.graphicHasContent({ template: 'orbit', fields: { items: 'Ads\nPages\nEmails' } }), true)
  assert.equal(m.graphicHasContent({ template: 'feature_tile', fields: { items: 'Competitor Research' } }), true)
  assert.equal(m.graphicHasContent({ template: 'screen_frame', fields: {} }), false)
  assert.equal(m.graphicHasContent({ template: 'screen_frame', fields: { video: 'source' } }), true)
  assert.equal(m.graphicHasContent({ template: 'screen_frame', fields: { video: '0123456789abcdef.mp4' } }), true)
  // Orbit: up to 6 nodes, generic icons only (a brand name draws the label's letter), labels optional.
  const nodes = m.orbitNodes({ items: 'A\nB\nC\nD\nE\nF\nG', icons: 'mail\nfacebook\nchart' })
  assert.equal(nodes.length, 6)
  assert.deepEqual(plain(nodes.slice(0, 3)), [{ icon: 'mail', label: 'A' }, { icon: null, label: 'B' }, { icon: 'chart', label: 'C' }])
  assert.deepEqual(plain(m.orbitNodes({ icons: 'mail\nvideo\nchat\nchart', labels: 'off' })).map((n) => n.label), ['', '', ''])
  assert.equal(m.graphicIcons({ items: 'One\nTwo\nThree\nFour', icons: 'search' }, 'feature_tile').length, 3)
  // The video must be one of the clip's videos.
  const base = { id: 'g-0000000001', template: 'screen_frame', at_ms: 1000, duration_ms: 3000, placement: 'top', fields: {} }
  assert.equal(m.parseGraphics([{ ...base, fields: { video: 'source' } }])[0].fields.video, 'source')
  assert.throws(() => m.parseGraphics([{ ...base, fields: { video: '../../etc/passwd' } }]), /videos/)
  // Reel screens (Remix, Edit my recording) don't offer or draw a Screen recording.
  assert.ok(!m.REEL_GRAPHIC_TEMPLATES.some((t) => t.id === 'screen_frame'))
  assert.equal(m.drawableGraphics([{ template: 'screen_frame', fields: { video: 'source' } }]).length, 0)
})

test('screen recording: the window fits its band at its shape, and the zoom target is a square of shares', () => {
  const spec = { width: 1080, height: 1920, box: { top: .1, bottom: .53 }, fields: { shape: 'wide' } }
  const wide = m.screenFrameLayout(spec)
  assert.ok(Math.abs(wide.hole.w / wide.hole.h - 16 / 9) < .02)
  assert.ok(wide.window.y >= .1 * 1920 && wide.window.y + wide.window.h <= .53 * 1920)
  assert.equal(wide.hole.x, wide.window.x + wide.border)
  assert.equal(wide.hole.y, wide.window.y + wide.bar)
  const tall = m.screenFrameLayout({ ...spec, fields: { shape: 'tall' } })
  assert.ok(tall.hole.h > tall.hole.w && tall.window.y + tall.window.h <= .53 * 1920)
  assert.equal(m.screenShape({ shape: 'odd' }), 'wide')
  // Centered on the region asked for (0.35 down), made square.
  assert.deepEqual(plain(m.screenZoom({ zoom: '0.1, 0.2, 0.5, 0.3' })), [0.1, 0.1, 0.5, 0.5])
  assert.deepEqual(plain(m.screenZoom({ zoom: '0.9, 0.9, 0.05, 0.05' })), [0.75, 0.75, 0.25, 0.25])
  assert.equal(m.screenZoom({ zoom: '1, 2' }), null)
  assert.equal(m.screenFrom({ from: '12.5' }), 12.5)
  assert.equal(m.screenFrom({ from: '-3' }), 0)
})

test('word timing: a text card snaps to its spoken words, each word on its own time, held after the last', () => {
  const g = { id: 'g-0000000002', template: 'big_words', at_ms: 1500, duration_ms: 2500, placement: 'top', fields: { text: 'ads manager' } }
  const timed = m.matchCardWords(g, WORDS)
  // "ads" at 3250, "manager" at 3500 (ends 3700): starts 100 ms early, holds 700 ms after the last word ends.
  assert.equal(timed.at_ms, 3150)
  assert.equal(timed.duration_ms, 3700 + 700 - 3150)
  assert.equal(timed.fields.word_ms, '100\n350')
  assert.deepEqual(plain(m.graphicWordTimes(timed.fields, 2, timed.duration_ms)), [100, 350])
  assert.equal(m.graphicWordTimes(timed.fields, 3, timed.duration_ms), null)
  // Words not said there (or out of order) don't match.
  assert.equal(m.matchCardWords({ ...g, fields: { text: 'manager ads' } }, WORDS), null)
  assert.equal(m.matchCardWords({ ...g, fields: { text: 'Paid Creators' } }, WORDS), null)
  // A filler word in between is fine; statement counts its subline too.
  const said = [...WORDS.slice(0, 5), { word: 'um', start_ms: 3200, end_ms: 3240 }, ...WORDS.slice(5).map((w) => ({ ...w, start_ms: w.start_ms + 60, end_ms: w.end_ms + 60 }))]
  assert.ok(m.matchCardWords({ ...g, template: 'statement', fields: { text: 'my own', subline: 'ads manager' } }, said))
  assert.deepEqual(plain(m.cardWords('headline_pill', { text: 'So I built', phrase: 'my own' })), ['So', 'I', 'built', 'my', 'own'])
  // Moving the card or changing its words drops the times (its own beats are used again).
  const c = clip({ graphics: [{ ...timed, at_ms: 3150 }] })
  assert.equal(m.updateGraphic(c, g.id, { at_ms: 3400 })[0].fields.word_ms, undefined)
  assert.equal(m.updateGraphic(c, g.id, { fields: { text: 'ads' } })[0].fields.word_ms, undefined)
  assert.equal(m.updateGraphic(c, g.id, { duration_ms: 2000 })[0].fields.word_ms, '100\n350')
})

test('word timing: the render spec carries each word on the finished clip clock', () => {
  // Cuts [1000,5000] and [7000,10000] at 1.25×: a card at 2000 with words at +0 and +500 ms.
  const c = clip({ graphics: [] })
  const g = { id: 'g-0000000003', template: 'title', at_ms: 2000, duration_ms: 2000, placement: 'top', fields: { text: 'Big idea', word_ms: '0\n500' } }
  const spec = m.graphicSpec({ aspect_ratio: '9:16', width: 1920, height: 1080 }, c, g)
  assert.equal(spec.fields.word_ms, '0\n400')
})

test('chat: scenes take the new backdrops and the arch card; graphics take size, depth and their words\' times', () => {
  const c = clip({ graphics: [] })
  let r = m.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4500, scene: 'stage', backdrop: 'grid', card: 'arch' }, project, () => 'x')
  assert.deepEqual(plain(r.candidate.stage_scenes), [{ scene: 'stage', start_ms: 2000, end_ms: 4500, backdrop: 'grid', card: 'arch' }])
  assert.match(r.step.summary, /grid backdrop with the arch card/)
  toolError(() => m.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4500, scene: 'visual', card: 'arch' }, project, () => 'x'), /Only a stage scene/)
  toolError(() => m.applyChatTool(c, 'set_scene', { start_ms: 2000, end_ms: 4500, scene: 'stage', card: 'oval' }, project, () => 'x'), /card must be/)
  // "Put the words behind me": depth on the graphic tools, big type only.
  const words = { ...project, words: WORDS }
  r = m.applyChatTool(c, 'add_graphic', { template: 'big_words', at_ms: 3000, fields: { text: 'ads manager' } }, words, () => 'g-0000000011')
  const added = r.candidate.graphics[0]
  assert.equal(added.depth, 'behind')
  assert.equal(added.at_ms, 3150)
  assert.equal(added.fields.word_ms, '100\n350')
  r = m.applyChatTool(r.candidate, 'update_graphic', { id: 'g-0000000011', depth: 'front' }, words, () => 'x')
  assert.equal(r.candidate.graphics[0].depth, 'front')
  toolError(() => m.applyChatTool(c, 'add_graphic', { template: 'stat', at_ms: 3000, depth: 'behind', fields: { value: '75%' } }, project, () => 'g-0000000012'), /can go behind/)
  r = m.applyChatTool(c, 'add_graphic', { template: 'orbit', at_ms: 3000, size: 'stage', fields: { items: 'Ads\nPages\nEmails', icons: 'megaphone\nglobe\nmail' } }, project, () => 'g-0000000013')
  assert.equal(r.candidate.graphics[0].size, 'stage')
  toolError(() => m.applyChatTool(c, 'add_graphic', { template: 'orbit', at_ms: 3000, fields: { items: 'Ads\nMeta', icons: 'megaphone\nmeta' } }, project, () => 'g-0000000014'), /never a brand logo/)
  // A Screen recording: part of this clip, or a video already on it; never a path.
  r = m.applyChatTool(c, 'add_graphic', { template: 'screen_frame', at_ms: 3000, fields: { video: 'source', from: '12', shape: 'square' } }, project, () => 'g-0000000015')
  assert.deepEqual(plain(r.candidate.graphics[0].fields), { video: 'source', from: '12', shape: 'square' })
  toolError(() => m.applyChatTool(c, 'add_graphic', { template: 'screen_frame', at_ms: 3000, fields: { video: '0123456789abcdef.mp4' } }, project, () => 'g-0000000016'), /fields.video/)
  const tools = Object.fromEntries(m.CHAT_TOOLS.map((t) => [t.name, t.parameters.properties]))
  assert.deepEqual(tools.add_graphic.depth.enum, ['front', 'behind'])
  assert.ok(tools.update_graphic.size && tools.set_scene.card)
  assert.ok(tools.set_scene.backdrop.enum.includes('grid') && tools.set_scene.backdrop.enum.includes('gradient'))
})

function renderModule(dir) {
  const { electron } = fakeElectron(dir, { isPackaged: true })
  electron.BrowserWindow = class {}
  electron.session = { fromPartition: () => ({ webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) }
  return loadMain("export * from './src/main/graphics-render'", { electron, './tools': { resolveBinary: () => 'ffmpeg' } })
}

test('main: a Screen recording\'s video is checked and copied by content, and its job carries what the engine plays', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-screen-frame-')
  t.after(cleanup)
  const mod = renderModule(dir)
  const run = path.join(dir, 'run'); fs.mkdirSync(run)
  const video = path.join(dir, 'screen.mp4')
  fs.writeFileSync(video, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]))
  const name = await mod.importGraphicVideo(run, video)
  assert.match(name, /^[a-f0-9]{16}\.mp4$/)
  assert.ok(fs.statSync(path.join(run, '.graphics', 'videos', name)).isFile())
  assert.equal(await mod.importGraphicVideo(run, video), name)
  const fake = path.join(dir, 'fake.mp4'); fs.writeFileSync(fake, 'not a video at all')
  await assert.rejects(mod.importGraphicVideo(run, fake), /MP4, MOV, M4V or WebM/)
  const text = path.join(dir, 'notes.txt'); fs.writeFileSync(text, 'x')
  await assert.rejects(mod.importGraphicVideo(run, text), /MP4, MOV, M4V or WebM/)
  assert.equal(mod.graphicVideoKind(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'webm')

  const c = { ...structuredClone(fixture.candidates[0]), graphics: [
    { id: 'g-0000000020', template: 'screen_frame', at_ms: 1500, duration_ms: 3000, placement: 'top', size: 'stage', fields: { video: name, from: '2.5', zoom: '0.2, 0.2, 0.4, 0.4' } },
    { id: 'g-0000000021', template: 'screen_frame', at_ms: 7200, duration_ms: 2000, placement: 'top', fields: { video: 'aaaaaaaaaaaaaaaa.mp4' } },
    { id: 'g-0000000022', template: 'screen_frame', at_ms: 8000, duration_ms: 1500, placement: 'top', fields: { video: 'source' } }] }
  const jobs = mod.candidateGraphicJobs(run, structuredClone(fixture), c)
  // The missing video's graphic is left out; the clip's own video is always there.
  assert.deepEqual(jobs.map((j) => j.id), ['g-0000000020', 'g-0000000022'])
  const inset = jobs[0].inset
  assert.equal(inset.video, name)
  assert.equal(inset.from_ms, 2500)
  assert.deepEqual(plain(inset.zoom), [0.2, 0.2, 0.4, 0.4])
  assert.equal(inset.fade_ms, m.SCREEN_FADE_MS)
  const hole = m.screenFrameLayout(jobs[0].spec).hole
  assert.ok(Math.abs(inset.rect[0] * 1080 - hole.x) < .5 && Math.abs(inset.rect[2] * 1080 - hole.w) < .5)
  // Rendered: the inset rides along to the engine (the cached render is the window only).
  const rendered = await (async () => {
    mod.setGraphicRendererFactory(async () => ({ render: async (_spec, out) => fs.writeFileSync(out, Buffer.alloc(128)), close() {} }))
    try { return await mod.renderGraphicJobs(run, jobs) } finally { mod.setGraphicRendererFactory(null) }
  })()
  assert.equal(rendered[0].inset.video, name)
  assert.equal(rendered[1].inset.video, 'source')
})

test('main: words behind the speaker go to the engine with the band\'s top', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-behind-band-')
  t.after(cleanup)
  const mod = renderModule(dir)
  const run = path.join(dir, 'run'); fs.mkdirSync(run)
  const c = { ...structuredClone(fixture.candidates[0]), graphics: [{ id: 'g-0000000030', template: 'big_words', at_ms: 1500, duration_ms: 2000, placement: 'top', fields: { text: 'Paid Creators' }, depth: 'behind' }] }
  const jobs = mod.candidateGraphicJobs(run, structuredClone(fixture), c)
  mod.setGraphicRendererFactory(async () => ({ render: async (_spec, out) => fs.writeFileSync(out, Buffer.alloc(128)), close() {} }))
  t.after(() => mod.setGraphicRendererFactory(null))
  const [g] = await mod.renderGraphicJobs(run, jobs)
  assert.equal(g.depth, 'behind')
  assert.equal(g.min_top, Math.round(jobs[0].spec.box.top * 10000) / 10000)
})
