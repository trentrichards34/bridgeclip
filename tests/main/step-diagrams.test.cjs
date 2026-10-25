// Chapter headers and diagrams: the shared contract (fields, lengths, parse, defaults), the layout (the chapter's
// own band at the top, others kept under it, a diagram's panel and green accent), item timing to the words said,
// the hook handing over to the first chapter, chat tools, the edit log and the solid backdrop.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const mg = loadMain(`export * from './src/shared/motion-graphics'; export * from './src/shared/graphic-layout'; export * from './src/shared/scenes';
  export { graphicPhrase } from './src/shared/edit-log'; export { REEL_GRAPHIC_TEMPLATES, reelGraphicSpec } from './src/shared/reel-graphics';
  export { CAPTION_PRESETS } from './src/shared/caption-presets'`)
const chat = loadMain("export * from './src/shared/clip-chat'; export { parseCandidateEdit } from './src/shared/clip-editor'")
const plain = (value) => JSON.parse(JSON.stringify(value))
const clip = (over = {}) => ({ ...structuredClone(fixture.candidates[0]), ranges: [[0, 60000]], video_speed: 1, ...over })
const project = { aspect_ratio: '9:16', width: 1080, height: 1920, duration_ms: 60000 }
const words = (text, start = 0, step = 400) => text.split(' ').map((word, i) => ({ word, start_ms: start + i * step, end_ms: start + i * step + step - 50 }))

test('the new templates are in the contract with their fields, lengths and defaults', () => {
  const ids = mg.GRAPHIC_TEMPLATES.map((t) => t.id)
  for (const id of ['chapter', 'staircase', 'funnel', 'journey', 'growth', 'idea_hub', 'compare_marks']) assert.ok(ids.includes(id), id)
  assert.deepEqual(plain(mg.templateInfo('chapter').fields), ['label', 'title', 'style'])
  assert.deepEqual(plain(mg.templateInfo('compare_marks').fields), ['items', 'notes', 'wrong'])
  // A chapter can last the section, a diagram up to 16 s, the rest 8 s.
  assert.equal(mg.graphicMaxMs('chapter'), 180000)
  assert.equal(mg.graphicMaxMs('staircase'), 16000)
  assert.equal(mg.graphicMaxMs('stat'), 8000)
  assert.equal(mg.clampGraphicMs(60000, 'chapter'), 60000)
  assert.equal(mg.clampGraphicMs(60000, 'funnel'), 16000)
  assert.equal(mg.clampGraphicMs(60000), 8000)
  const parsed = mg.parseGraphics([{ id: 'g-chapter1', template: 'chapter', at_ms: 0, duration_ms: 45000, placement: 'top', fields: { label: 'Step #1.', title: 'Come Up With Your Idea' } }])
  assert.equal(parsed[0].duration_ms, 45000)
  assert.throws(() => mg.parseGraphics([{ id: 'g-stairs01', template: 'staircase', at_ms: 0, duration_ms: 20000, placement: 'top', fields: {} }]), /16 seconds/)
  assert.throws(() => mg.parseGraphics([{ id: 'g-stat0001', template: 'stat', at_ms: 0, duration_ms: 9000, placement: 'top', fields: {} }]), /8 seconds/)
  // Diagrams start stage size in the middle; nothing is filled in for the member.
  const d = mg.newGraphic('idea_hub', 1000)
  assert.equal(d.size, 'stage'); assert.equal(d.placement, 'middle'); assert.deepEqual(d.fields, {})
  assert.equal(mg.newGraphic('chapter', 0).duration_ms, 15000)
  // Content: a diagram needs 3 items (Wrong / right: 2); a chapter its title or label.
  assert.equal(mg.graphicHasContent({ template: 'funnel', fields: { items: 'a\nb' } }), false)
  assert.equal(mg.graphicHasContent({ template: 'funnel', fields: { items: 'a\nb\nc' } }), true)
  assert.equal(mg.graphicHasContent({ template: 'compare_marks', fields: { items: 'a\nb' } }), true)
  assert.equal(mg.graphicHasContent({ template: 'chapter', fields: {} }), false)
  assert.equal(mg.templateItems('staircase', 'a\nb\nc\nd\ne\nf\ng').length, 6)
  assert.equal(mg.templateItems('compare_marks', 'a\nb\nc').length, 2)
  assert.equal(mg.chapterStyle({ style: 'pill' }), 'pill'); assert.equal(mg.chapterStyle({ style: 'x' }), 'serif_caps')
  assert.equal(mg.hubIcon({ icon: 'target' }), 'target'); assert.equal(mg.hubIcon({ icon: 'brand' }), 'idea')
  assert.equal(mg.compareWrong({ wrong: 'second' }), 1); assert.equal(mg.compareWrong({}), 0)
  // Each card's mark pops just after its side is said: the ✗ on the wrong one, the ✓ on the right one.
  assert.deepEqual(plain(mg.compareTimes({ item_ms: '100\n900' }, 6000)), { cards: [100, 900], cross: 350, check: 1150 })
  assert.deepEqual(plain(mg.compareTimes({ item_ms: '100\n900', wrong: 'second' }, 6000)), { cards: [100, 900], cross: 1150, check: 350 })
  // A diagram of five items or more needs the whole frame; fewer (and a Wrong / right) keep the speaker on the stage.
  assert.equal(mg.diagramNeedsFullFrame({ template: 'staircase', fields: { items: 'a\nb\nc\nd\ne' } }), true)
  assert.equal(mg.diagramNeedsFullFrame({ template: 'staircase', fields: { items: 'a\nb\nc' } }), false)
  assert.equal(mg.diagramNeedsFullFrame({ template: 'compare_marks', fields: { items: 'a\nb\nc\nd\ne' } }), false)
  assert.equal(mg.diagramNeedsFullFrame({ template: 'stat', fields: { items: 'a\nb\nc\nd\ne' } }), false)
  assert.deepEqual(plain(mg.compareTimes({ item_ms: '100\n900\n1200\n2000' }, 6000)), { cards: [100, 900], cross: 1200, check: 2000 })
  assert.equal(mg.compareTimes({ item_ms: '900\n100' }, 6000), null)
  // Only the clip editor has chapters (they belong to a clip's sections).
  assert.ok(!mg.REEL_GRAPHIC_TEMPLATES.some((t) => t.id === 'chapter'))
  assert.ok(mg.REEL_GRAPHIC_TEMPLATES.some((t) => t.id === 'staircase'))
})

test('a chapter header has its own band at the top; other graphics keep under it while it shows', () => {
  const chapter = mg.newGraphic('chapter', 0, { duration_ms: 30000, fields: { label: 'Step #1.', title: 'Come Up With Your Idea' } })
  const stat = mg.newGraphic('stat', 5000, { fields: { value: '50', label: 'sales' }, placement: 'top' })
  const later = mg.newGraphic('stat', 40000, { fields: { value: '50', label: 'sales' }, placement: 'top' })
  const c = clip({ hook: null, captions: true, graphics: [chapter, stat, later] })
  // Never a clash with the chapter; two chapters at once do clash.
  assert.equal(mg.graphicsClash(chapter, stat), false)
  assert.equal(mg.graphicsClash(chapter, { ...chapter, id: 'g-other00' }), true)
  assert.equal(mg.placeInFreeBand([stat], chapter), chapter)
  const head = mg.graphicSpec(project, c, chapter)
  assert.ok(head.box.top < 0.06 && head.box.bottom <= 0.17)
  const under = mg.graphicSpec(project, c, stat), free = mg.graphicSpec(project, c, later)
  assert.ok(under.box.top >= mg.CHAPTER_SHARE, 'kept under the header while it shows')
  assert.ok(free.box.top < under.box.top, 'back up top once it is gone')
  // Over a white hook bar the header is drawn in dark ink.
  const barred = clip({ hook: { text: 'How to sell digital products', look: { look: 'white', color: '#FFFFFF', font: 'clean' } }, graphics: [chapter] })
  assert.equal(mg.graphicSpec(project, barred, chapter).fields.ink, 'dark')
  assert.equal(head.fields.ink, undefined)
})

test('the hook hands over to the first chapter header', () => {
  const c = clip({ ranges: [[1000, 5000], [7000, 20000]], video_speed: 1 })
  assert.equal(mg.hookEndMs(c), null)
  assert.equal(mg.firstChapterSourceMs(c), null)
  const second = mg.newGraphic('chapter', 12000, { duration_ms: 5000, fields: { title: 'Two' } })
  const first = mg.newGraphic('chapter', 8000, { duration_ms: 3000, fields: { title: 'One' } })
  const empty = mg.newGraphic('chapter', 2000, { duration_ms: 3000, fields: {} })
  const cut = mg.newGraphic('chapter', 5200, { duration_ms: 1000, fields: { title: 'Cut out' } })
  c.graphics = [second, first, empty, cut]
  assert.equal(mg.firstChapterSourceMs(c), 8000)
  assert.equal(mg.hookEndMs(c), 4000 + 1000)
})

test('a diagram is drawn green on a blue panel over the video, right on a solid or dark backdrop', () => {
  const g = mg.newGraphic('staircase', 2000, { fields: { items: 'a\nb\nc' } })
  const over = mg.graphicSpec(project, clip({ graphics: [g] }), g)
  assert.equal(over.fields.panel, 'on'); assert.equal(over.color, '#7CB82F'); assert.equal(over.size, 'stage')
  const onSolid = mg.graphicSpec(project, clip({ graphics: [g], stage_scenes: [{ scene: 'visual', start_ms: 1000, end_ms: 15000, backdrop: 'solid' }] }), g)
  assert.equal(onSolid.fields.panel, undefined)
  // In a Visual scene it fills the middle of the frame (under a chapter header, over the captions).
  assert.ok(onSolid.box.bottom >= 0.7)
  const onLight = mg.graphicSpec(project, clip({ graphics: [g], stage_scenes: [{ scene: 'visual', start_ms: 1000, end_ms: 15000 }] }), g)
  assert.equal(onLight.fields.panel, 'on')
  // Its own color wins (the member can pick the brand color).
  const own = { ...g, fields: { ...g.fields, color: '#FF0000' } }
  assert.equal(mg.graphicSpec(project, clip({ graphics: [own] }), own).color, '#FF0000')
  // On a reel: always on its panel.
  assert.equal(mg.reelGraphicSpec(g, { aspect: '9:16', hook: 0, captions: null }, 5000, null).fields.panel, 'on')
  // The solid backdrop.
  assert.ok(mg.SCENE_BACKDROPS.includes('solid'))
  assert.equal(mg.sceneCaptionLook('solid'), 'own')
  assert.equal(mg.parseScenes([{ scene: 'visual', start_ms: 0, end_ms: 2000, backdrop: 'solid' }])[0].backdrop, 'solid')
})

test('diagram items are timed to the words as said, in order; changed items lose the times', () => {
  const said = words('it has to be urgent useful unique and problem solving', 10000)
  const g = mg.newGraphic('idea_hub', 11000, { duration_ms: 6000, fields: { items: 'Urgent\nUseful\nUnique\nProblem solving' } })
  const timed = mg.matchItemTimes(g, said)
  assert.deepEqual(timed.fields.item_ms.split('\n').map(Number), [1600 - 1000 + 0, 2000 - 1000, 2400 - 1000, 3200 - 1000].map((t) => t + 0))
  assert.equal(mg.matchItemTimes({ ...g, fields: { items: 'Useful\nUrgent\nUnique' } }, said), null)
  assert.equal(mg.matchItemTimes({ ...g, fields: { items: 'Urgent\nUseful\nViral' } }, said), null)
  const c = clip({ graphics: [timed] })
  assert.equal(mg.updateGraphic(c, g.id, { fields: { items: 'Urgent\nUseful\nNew' } })[0].fields.item_ms, undefined)
  assert.ok(mg.updateGraphic(c, g.id, { fields: { title: 'Ideas' } })[0].fields.item_ms)
})

test('the chat adds a chapter and diagrams (timed to the words), checks their fields and lengths', () => {
  const said = words('step one is to come up with your idea it has to be urgent useful and unique', 2000)
  const c = chat.parseCandidateEdit({ ...structuredClone(fixture.candidates[0]), ranges: [[0, 30000]], video_speed: 1 }, 30000, 4)
  const proj = { duration_ms: 30000, width: 1080, height: 1920, aspect_ratio: '9:16', transcriptCount: 4, words: said }
  let n = 0
  const run = (cand, name, args) => chat.applyChatTool(cand, name, args, proj, () => `chat-step${String(++n).padStart(4, '0')}`)
  const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message))
  const r1 = run(c, 'add_graphic', { template: 'chapter', at_ms: 1900, duration_ms: 25000, placement: 'top', fields: { label: 'Step #1.', title: 'Come Up With Your Idea' } })
  assert.equal(r1.candidate.graphics.find((g) => g.template === 'chapter').duration_ms, 25000)
  const r2 = run(r1.candidate, 'add_graphic', { template: 'idea_hub', at_ms: 6000, duration_ms: 6000, placement: 'middle', fields: { items: 'Urgent\nUseful\nUnique', icon: 'idea' } })
  const hub = r2.candidate.graphics.find((x) => x.template === 'idea_hub')
  assert.ok(hub.fields.item_ms, 'timed to the words')
  toolError(() => run(c, 'add_graphic', { template: 'staircase', at_ms: 6000, duration_ms: 20000, placement: 'middle', fields: { items: 'a\nb\nc' } }), /16000/)
  toolError(() => run(c, 'add_graphic', { template: 'compare_marks', at_ms: 6000, duration_ms: 5000, placement: 'middle', fields: { items: 'a\nb', wrong: 'third' } }), /first or second/)
  toolError(() => run(c, 'add_graphic', { template: 'idea_hub', at_ms: 6000, duration_ms: 5000, placement: 'middle', fields: { items: 'a\nb\nc', icon: 'nike' } }), /fields.icon/)
  toolError(() => run(c, 'add_graphic', { template: 'chapter', at_ms: 6000, duration_ms: 5000, placement: 'top', fields: { title: 'x', style: 'comic' } }), /serif_caps/)
})

test('the edit log names them; Serif clean captions are offered', () => {
  assert.equal(mg.graphicPhrase({ template: 'chapter', fields: { label: 'Step #1.', title: 'Your Idea' } }), '“Step #1. Your Idea” chapter header')
  assert.equal(mg.graphicPhrase({ template: 'staircase', fields: { items: 'a\nb\nc' } }), '3-step staircase')
  assert.equal(mg.graphicPhrase({ template: 'compare_marks', fields: { items: 'a\nb' } }), 'wrong/right')
  assert.equal(mg.graphicPhrase({ template: 'funnel', fields: { title: 'Optimize', items: 'a\nb\nc' } }), '“Optimize” funnel')
  assert.ok(mg.CAPTION_PRESETS.some((p) => p.id === 'serif_clean'))
})
