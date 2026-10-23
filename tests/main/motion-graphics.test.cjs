// Motion graphics: the shared contract's helpers (source → output time, parsing, layout) and main's offscreen
// render (sandboxed window options, cache by content, image import checks).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const mg = loadMain("export * from './src/shared/motion-graphics'; export * from './src/shared/graphic-layout'; export { parseCandidateEdit, candidateEdit, renderEditKey, refineEdit } from './src/shared/clip-editor'")
const clip = (over = {}) => ({ ...structuredClone(fixture.candidates[0]), ...over })
const plainCopy = (value) => JSON.parse(JSON.stringify(value))

test('source time maps through the cuts and the export speed; cut-out parts of a graphic are dropped', () => {
  // Cuts [1000,5000] and [7000,10000] at 1.25×.
  const c = clip()
  assert.equal(mg.outputTime(c, 1000), 0)
  assert.equal(mg.outputTime(c, 3500), 2000)
  assert.equal(mg.outputTime(c, 6000), null)
  assert.equal(mg.outputTime(c, 7000), 3200)
  // Inside one cut.
  assert.deepEqual(mg.graphicWindow(c, { at_ms: 2000, duration_ms: 2500 }), { start_ms: 800, duration_ms: 2000 })
  // Across the gap: 4000–5000 and 7000–8000 are kept and play back to back.
  assert.deepEqual(mg.graphicWindow(c, { at_ms: 4000, duration_ms: 4000 }), { start_ms: 2400, duration_ms: 1600 })
  // Starts in the gap: begins where the next cut does.
  assert.deepEqual(mg.graphicWindow(c, { at_ms: 6000, duration_ms: 2000 }), { start_ms: 3200, duration_ms: 800 })
  // Wholly cut out, or under 0.4 s left: dropped.
  assert.equal(mg.graphicWindow(c, { at_ms: 5200, duration_ms: 1500 }), null)
  assert.equal(mg.graphicWindow(c, { at_ms: 4700, duration_ms: 1000 }), null)
  assert.deepEqual(mg.graphicWindow({ ...c, video_speed: 1 }, { at_ms: 4500, duration_ms: 1000 }), { start_ms: 3500, duration_ms: 500 })
  assert.equal(mg.graphicWindow({ ...c, video_speed: 1 }, { at_ms: 4700, duration_ms: 1000 }), null)
  assert.deepEqual(mg.graphicWindow({ ...c, video_speed: 1 }, { at_ms: 4500, duration_ms: 3000 }), { start_ms: 3500, duration_ms: 1000 })
  // How far into its animation a graphic is at a source time.
  const g = { at_ms: 4000, duration_ms: 4000 }
  assert.equal(mg.graphicLocalMs(c, g, 4000), 0)
  assert.equal(mg.graphicLocalMs(c, g, 7500), 1200)
  assert.equal(mg.graphicLocalMs(c, g, 6000), null)
  assert.equal(mg.graphicLocalMs(c, g, 8100), null)
})

test('graphics parse with the clip, save when removed, and send a clip back to refining', () => {
  const g = mg.newGraphic('stat', 2000, { fields: { value: '$1,200/month', label: 'a month' } })
  assert.match(g.id, /^g-[a-f0-9]{10}$/)
  assert.deepEqual([g.duration_ms, g.placement, g.origin], [3500, 'top', 'member'])
  const c = clip({ graphics: [g] })
  const parsed = mg.parseCandidateEdit(c, 12000)
  assert.deepEqual(parsed.graphics, [g])
  assert.deepEqual(mg.candidateEdit({ ...parsed, graphics: [] }).graphics, [])
  // Legacy clips keep their render key; an empty list is the same render as none.
  const legacy = clip()
  assert.equal(mg.renderEditKey({ ...legacy, graphics: [] }), mg.renderEditKey(legacy))
  assert.notEqual(mg.renderEditKey(c), mg.renderEditKey(legacy))
  assert.equal(mg.refineEdit({ ...legacy, status: 'ready' }, { graphics: [g] }).status, 'refining')
  for (const bad of [[{ ...g, template: 'confetti' }], [{ ...g, duration_ms: 100 }], [{ ...g, id: 'X' }], [g, g], [{ ...g, fields: { image: '../x.png' } }]]) {
    assert.throws(() => mg.parseCandidateEdit(clip({ graphics: bad }), 12000))
  }
})

test('helpers keep graphics inside the clip, merge field edits and respect the limit', () => {
  const c = clip({ graphics: [] })
  let list = mg.withGraphic(c, mg.newGraphic('title', 50, { fields: { text: 'Hello there' } }))
  assert.equal(list[0].at_ms, 1000) // moved to the clip's start
  list = mg.withGraphic({ ...c, graphics: list }, mg.newGraphic('quote', 9900, { duration_ms: 3000 }))
  assert.deepEqual([list[1].at_ms, list[1].duration_ms], [7000, 3000])
  const id = list[0].id
  list = mg.updateGraphic({ ...c, graphics: list }, id, { duration_ms: 99999, fields: { text: 'New words', color: '#ff0000' } })
  assert.deepEqual([list[0].duration_ms, list[0].fields.text, list[0].fields.color], [8000, 'New words', '#ff0000'])
  assert.equal(mg.removeGraphic({ graphics: list }, id).length, 1)
  const full = { ...c, graphics: Array.from({ length: mg.MAX_GRAPHICS_PER_CLIP }, (_, i) => mg.newGraphic('title', 1000 + i)) }
  assert.equal(mg.MAX_GRAPHICS_PER_CLIP, 60)
  assert.throws(() => mg.withGraphic(full, mg.newGraphic('title', 2000)), /up to 60/)
  assert.equal(mg.graphicHasContent({ template: 'stat', fields: {} }), false)
  assert.equal(mg.graphicHasContent({ template: 'list', fields: { items: '\n  \nOne' } }), true)
  assert.deepEqual(mg.graphicItems('a\n\n b \nc\nd\ne\nf'), ['a', 'b', 'c', 'd', 'e'])
})

test('stat values count up keeping their prefix, separators, decimals and unit', () => {
  const money = mg.parseStatValue('$1,200/month')
  assert.deepEqual(money, { prefix: '$', number: 1200, decimals: 0, commas: true, suffix: '/month' })
  assert.equal(mg.formatStatValue(money, 0), '$0/month')
  assert.equal(mg.formatStatValue(money, .5), '$600/month')
  assert.equal(mg.formatStatValue(money, 1), '$1,200/month')
  assert.equal(mg.formatStatValue(mg.parseStatValue('15 billion'), .4), '6 billion')
  assert.equal(mg.formatStatValue(mg.parseStatValue('25%'), 1), '25%')
  assert.equal(mg.formatStatValue(mg.parseStatValue('3.5x faster'), .5), '1.8x faster')
  assert.equal(mg.formatStatValue(mg.parseStatValue('12,500,000 views'), 1), '12,500,000 views')
  assert.equal(mg.parseStatValue('No number here'), null)
})

test('graphic bands stay clear of the hook and the captions', () => {
  const frame = { aspect: '9:16', hook: .19, captions: { y: 1340 / 1920, bottom: false } }
  const top = mg.graphicBox('top', frame), middle = mg.graphicBox('middle', frame), bottom = mg.graphicBox('bottom', frame)
  for (const box of [top, middle, bottom]) {
    assert.ok(box.top >= .21 - 1e-9, `below the hook: ${JSON.stringify(box)}`)
    assert.ok(box.bottom <= 1340 / 1920 - .075, `above the captions: ${JSON.stringify(box)}`)
  }
  assert.ok(top.top < middle.top && middle.top < bottom.top)
  // Captions off: the bottom band sits near the bottom of the frame.
  assert.ok(mg.graphicBox('bottom', { ...frame, captions: null }).bottom > .8)
  // Captions moved to the top: the top band goes under them.
  assert.ok(mg.graphicBox('top', { ...frame, captions: { y: .3, bottom: false } }).top >= .375)
  // Landscape: no hook, captions at the bottom.
  const wide = mg.graphicBox('bottom', { aspect: '16:9', hook: 0, captions: { y: 1 - 100 / 1080, bottom: true } })
  assert.ok(wide.bottom <= 1 - 100 / 1080 - .13 && wide.top > .3)
})

test('a render spec uses the clip\'s output time, size, band, brand color and hook font', () => {
  const project = { aspect_ratio: '9:16', width: 1920, height: 1080 }
  const g = mg.newGraphic('stat', 2000, { fields: { value: '25%', color: 'nope' } })
  const c = clip({ graphics: [g], hook: { text: 'A two line hook for this clip', look: { look: 'brand', color: '#16a34a', font: 'condensed' } } })
  const spec = mg.graphicSpec(project, c, g)
  assert.deepEqual([spec.width, spec.height, spec.duration_ms, spec.color, spec.font, spec.fields.color], [1080, 1920, 2400, '#16A34A', 'condensed', undefined])
  assert.equal(mg.graphicSpec(project, c, { ...g, at_ms: 5100, duration_ms: 1500 }), null)
  assert.equal(mg.graphicStyle(clip(), { fields: { color: '#abcdef' } }).color, '#ABCDEF')
  assert.equal(mg.graphicStyle(clip()).color, mg.GRAPHIC_DEFAULT_COLOR)
})

function renderModule(t, dir) {
  const windows = []
  class FakeWindow {
    constructor(options) { this.options = options; this.destroyed = false; windows.push(this); this.events = {}
      this.webContents = {
        setFrameRate: () => {}, setWindowOpenHandler: (fn) => { this.openHandler = fn }, on: (name, fn) => { this.events[name] = fn },
        executeJavaScript: async (code) => code.startsWith('window.__graphic.load') ? true : true,
        capturePage: async () => ({ getSize: () => ({ width: 1080, height: 1920 }), toPNG: () => PNG })
      } }
    setContentSize(w, h) { this.size = [w, h] }
    async loadFile(file) { this.loaded = file }
    async loadURL(url) { this.loaded = url }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
  const requests = []
  const session = { webRequest: { onBeforeRequest: (fn) => { session.filter = fn } }, setPermissionRequestHandler: (fn) => { session.permission = fn }, setPermissionCheckHandler: (fn) => { session.check = fn } }
  const { electron } = fakeElectron(dir, { isPackaged: true })
  electron.BrowserWindow = FakeWindow
  electron.session = { fromPartition: (name) => { requests.push(name); return session } }
  const mod = loadMain("export * from './src/main/graphics-render'", { electron, './tools': { resolveBinary: () => 'ffmpeg' } })
  return { mod, windows, session, partitions: requests }
}
// A 1080×1920 transparent PNG with a red square.
const PNG = (() => {
  try { return execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.0:s=1080x1920,format=rgba,drawbox=x=100:y=100:w=200:h=200:color=red@1:t=fill', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-']) } catch { return null }
})()

test('graphics render offscreen in a sandboxed window and are cached by what they draw', { skip: !PNG && 'needs FFmpeg' }, async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-graphics-')
  t.after(cleanup)
  const { mod, windows, session, partitions } = renderModule(t, dir)
  const options = mod.offscreenWindowOptions(1080, 1920)
  assert.equal(options.show, false)
  assert.equal(options.transparent, true)
  for (const [key, value] of Object.entries({ offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false, devTools: false, partition: 'graphics-render' })) {
    assert.equal(options.webPreferences[key], value, key)
  }
  assert.ok(!options.webPreferences.partition.startsWith('persist:'))
  assert.equal(options.webPreferences.preload, undefined)
  // Only the app's own page and data URLs load.
  const base = 'file:///app/out/renderer/'
  assert.equal(mod.graphicsRequestAllowed('file:///app/out/renderer/graphics.html', base), true)
  assert.equal(mod.graphicsRequestAllowed('file:///app/out/renderer/assets/a.ttf', base), true)
  assert.equal(mod.graphicsRequestAllowed('data:image/png;base64,AAAA', base), true)
  assert.equal(mod.graphicsRequestAllowed('file:///etc/passwd', base), false)
  assert.equal(mod.graphicsRequestAllowed('https://example.com/x.js', base), false)
  assert.equal(mod.graphicsRequestAllowed('http://localhost:5173/graphics.html', 'http://localhost:5173/'), true)
  assert.equal(mod.graphicsRequestAllowed('http://localhost:9999/x', 'http://localhost:5173/'), false)

  const run = path.join(dir, 'run'); fs.mkdirSync(run)
  const project = { ...structuredClone(fixture), candidates: [] }
  const g = { id: 'g-0000000001', template: 'stat', at_ms: 2000, duration_ms: 1500, placement: 'top', fields: { value: '25%', label: 'of people' } }
  const empty = { id: 'g-0000000002', template: 'title', at_ms: 3000, duration_ms: 1500, placement: 'middle', fields: {} }
  const c = { ...clip(), graphics: [g, empty] }
  project.candidates = [c]
  const first = await mod.renderCandidateGraphics(run, project, c)
  assert.equal(first.length, 1) // the graphic without words is skipped
  assert.match(first[0].file, /^[a-f0-9]{64}\.mov$/)
  assert.deepEqual([first[0].start_ms, first[0].duration_ms], [800, 1200])
  const out = path.join(run, '.graphics', first[0].file)
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_frames', '-of', 'csv=p=0', out]).toString().trim()
  assert.equal(probe, 'qtrle,1080,1920,argb,36')
  assert.equal(windows.length, 1)
  assert.equal(windows[0].destroyed, true)
  assert.deepEqual(windows[0].size, [1080, 1920])
  assert.ok(windows[0].loaded.endsWith('graphics.html'))
  assert.deepEqual(partitions, ['graphics-render'])
  // The session refuses permissions and other URLs.
  let refused; session.permission(null, 'media', (ok) => { refused = ok }); assert.equal(refused, false)
  let cancelled; session.filter({ url: 'https://example.com/' }, (r) => { cancelled = r.cancel }); assert.equal(cancelled, true)
  assert.deepEqual(windows[0].openHandler(), { action: 'deny' })
  // Same graphic again: reused from the cache, no new window.
  const again = await mod.renderCandidateGraphics(run, project, c)
  assert.deepEqual(again, first)
  assert.equal(windows.length, 1)
  // Different words: a new render; the unused one is swept.
  const changed = { ...c, graphics: [{ ...g, fields: { ...g.fields, value: '30%' } }] }
  const second = await mod.renderCandidateGraphics(run, { ...project, candidates: [changed] }, changed)
  assert.notEqual(second[0].file, first[0].file)
  mod.sweepGraphicRenders(run, { ...project, candidates: [changed] })
  assert.deepEqual(fs.readdirSync(path.join(run, '.graphics')).sort(), [second[0].file])
  // The cache key covers what changes the pixels.
  const spec = mg.graphicSpec(project, changed, changed.graphics[0])
  const key = mod.graphicCacheKey(spec)
  assert.equal(mod.graphicCacheKey({ ...spec, fields: { label: spec.fields.label, value: spec.fields.value } }), key)
  for (const other of [{ ...spec, color: '#000000' }, { ...spec, font: 'serif' }, { ...spec, width: 1920, height: 1080 }, { ...spec, duration_ms: 1300 }, { ...spec, box: { top: .3, bottom: .5 } }]) assert.notEqual(mod.graphicCacheKey(other), key)
  assert.notEqual(mod.graphicCacheKey(spec, 'a'.repeat(64)), key)
})

test('images for a graphic are checked by their bytes and copied into the run under a content name', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-graphic-image-')
  t.after(cleanup)
  const { mod } = renderModule(t, dir)
  const run = path.join(dir, 'run'); fs.mkdirSync(run)
  const png = path.join(dir, 'logo.png')
  fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]))
  const name = mod.importGraphicImage(run, png)
  assert.match(name, /^[a-f0-9]{16}\.png$/)
  assert.ok(fs.statSync(path.join(run, '.graphics', 'images', name)).isFile())
  assert.equal(mod.importGraphicImage(run, png), name)
  assert.match(mod.graphicImageData(run, name).url, /^data:image\/png;base64,/)
  assert.equal(mod.graphicImageData(run, '../../logo.png'), null)
  const fake = path.join(dir, 'fake.png'); fs.writeFileSync(fake, 'not a picture')
  assert.throws(() => mod.importGraphicImage(run, fake), /PNG, JPEG or WebP/)
  const gif = path.join(dir, 'a.gif'); fs.writeFileSync(gif, 'GIF89a')
  assert.throws(() => mod.importGraphicImage(run, gif), /PNG, JPEG or WebP/)
  const big = path.join(dir, 'big.png'); fs.writeFileSync(big, Buffer.alloc(12 * 1024 * 1024 + 1))
  assert.throws(() => mod.importGraphicImage(run, big), /under 12 MB/)
})

test('automatic cards move off the speaker’s face: the placement covering the face least wins', () => {
  const project = { aspect_ratio: '9:16', width: 1920, height: 1080 }
  const c = clip({ captions: true, caption_y: 0.75, hook: { text: 'We made fifteen thousand in a month', look: { look: 'white', color: '#FFFFFF', font: 'clean' } } })
  const g = { id: 'auto-1', template: 'list', at_ms: 2000, duration_ms: 3000, placement: 'middle', fields: { title: 'Three steps', items: 'a\nb\nc' } }
  // A close-up: the face fills the middle of the frame.
  const face = [0.2, 0.4, 0.6, 0.3]
  const box = (p) => mg.graphicBox(p, { aspect: '9:16', hook: mg.hookShare(c, '9:16'), captions: mg.captionAnchorAt(project, c, 2000), handle: null })
  const cover = (p) => Math.max(0, Math.min(box(p).bottom, 0.7) - Math.max(box(p).top, 0.4))
  const chosen = mg.placementAvoidingFace(project, c, g, face)
  assert.notEqual(chosen, 'middle')
  assert.ok(cover(chosen) < cover('middle'), `${chosen} covers ${cover(chosen)} vs middle ${cover('middle')}`)
  // No face found, or the chosen placement is already clear: kept.
  assert.equal(mg.placementAvoidingFace(project, c, g, null), 'middle')
  assert.equal(mg.placementAvoidingFace(project, c, { ...g, placement: 'top' }, [0.3, 0.75, 0.3, 0.05]), 'top')
})

test('the new templates and the size parse, round-trip and keep older graphics as they were', () => {
  const ids = mg.GRAPHIC_TEMPLATES.map((t) => t.id)
  for (const id of ['statement', 'sticky_notes', 'strike_list', 'browser_frame', 'icon_pop', 'headline_pill', 'comment_cta']) {
    assert.ok(ids.includes(id), id)
    assert.ok(mg.GRAPHIC_DEFAULT_MS[id] >= mg.GRAPHIC_MIN_MS)
  }
  const old = { id: 'g-0000000001', template: 'stat', at_ms: 2000, duration_ms: 3000, placement: 'top', fields: { value: '25%' } }
  // An older graphic (no size) parses exactly as before.
  assert.deepEqual(plainCopy(mg.parseGraphics([old])), [old])
  const stage = { ...old, id: 'g-0000000002', template: 'browser_frame', size: 'stage', fields: { domain: 'example.com', title: 'A headline', highlights: '0.1, 0.2, 0.5, 0.1, 1.5' } }
  const parsed = mg.parseGraphics([stage, { ...old, id: 'g-0000000003', size: 'giant' }])
  assert.equal(parsed[0].size, 'stage')
  assert.equal('size' in parsed[1], false) // an unknown size is dropped (the usual card)
  assert.deepEqual(plainCopy(mg.parseGraphics(JSON.parse(JSON.stringify(parsed)))), plainCopy(parsed))
  assert.equal(mg.newGraphic('statement', 0, { size: 'compact' }).size, 'compact')
  assert.equal('size' in mg.newGraphic('statement', 0), false)
  // Changing the size: 'card' (the default) clears it.
  const c = clip({ graphics: [mg.newGraphic('statement', 2000, { fields: { text: 'Skip the scraping.' } })] })
  const id = c.graphics[0].id
  const big = mg.updateGraphic(c, id, { size: 'stage' })
  assert.equal(big[0].size, 'stage')
  assert.equal('size' in mg.updateGraphic({ ...c, graphics: big }, id, { size: 'card' })[0], false)
})

test('new templates only draw the words, picture or icons they were given', () => {
  const has = (template, fields) => mg.graphicHasContent({ template, fields })
  assert.equal(has('statement', {}), false); assert.equal(has('statement', { text: 'Skip the scraping.' }), true)
  assert.equal(has('sticky_notes', { items: '\n' }), false); assert.equal(has('sticky_notes', { items: 'One' }), true)
  assert.equal(has('strike_list', {}), false); assert.equal(has('strike_list', { final: 'just a typed client.' }), true)
  assert.equal(has('browser_frame', { domain: 'example.com' }), false); assert.equal(has('browser_frame', { title: 'Hi there' }), true); assert.equal(has('browser_frame', { image: 'a.png' }), true)
  assert.equal(has('icon_pop', {}), false); assert.equal(has('icon_pop', { items: 'Email' }), true)
  assert.equal(has('headline_pill', { phrase: 'hidden API' }), true); assert.equal(has('comment_cta', { lead: 'Comment' }), false); assert.equal(has('comment_cta', { keyword: 'API' }), true)
  assert.deepEqual(mg.templateItems('sticky_notes', 'a\nb\nc\nd'), ['a', 'b', 'c'])
  assert.deepEqual(mg.templateItems('strike_list', 'a\nb\nc\nd\ne'), ['a', 'b', 'c', 'd'])
  // The accent: the given words where they appear (any case, punctuation kept), else the last word; typed line breaks kept.
  assert.deepEqual(plainCopy(mg.accentWords('Skip the scraping.', 'Scraping')), { words: ['Skip', 'the', 'scraping.'], from: 2, to: 2, breaks: [] })
  assert.deepEqual(plainCopy(mg.accentWords('just a typed client.', 'typed client')), { words: ['just', 'a', 'typed', 'client.'], from: 2, to: 3, breaks: [] })
  assert.deepEqual(plainCopy(mg.accentWords('Skip the\nscraping.', 'nope')), { words: ['Skip', 'the', 'scraping.'], from: 2, to: 2, breaks: [2] })
  assert.equal(mg.accentWords('', 'x').from, -1)
  // Boxes on a screenshot: shares of the picture, an optional time in seconds; bad lines are skipped, at most 4.
  assert.deepEqual(plainCopy(mg.browserHighlights('0.1, 0.2, 0.5, 0.1, 1.5\nnope\n0.5 0.5 0.8 0.1\n0.2,0.3,0.4,0.05')), [
    { x: .1, y: .2, w: .5, h: .1, at_ms: 1500 }, { x: .2, y: .3, w: .4, h: .05, at_ms: 1600 }])
  assert.equal(mg.browserHighlights(Array(6).fill('0,0,0.5,0.1').join('\n')).length, 4)
  // Icons: known generic names only, one per item.
  assert.deepEqual(plainCopy(mg.graphicIcons({ items: 'Email\nVideo\nChat', icons: 'mail\ninstagram\n' })), ['mail', null, null])
  assert.ok(mg.GRAPHIC_ICONS.every((name) => /^[a-z]+$/.test(name)))
  assert.deepEqual(plainCopy(mg.GRAPHIC_IMAGE_TEMPLATES), ['logo', 'browser_frame', 'icon_pop', 'orbit'])
})

test('a stage-size graphic takes the top of a 9:16 frame and shares every band', () => {
  const frame = { aspect: '9:16', hook: 0, captions: { y: 1340 / 1920, bottom: false } }
  for (const placement of ['top', 'middle', 'bottom']) {
    const box = mg.graphicBox(placement, frame, 'stage')
    assert.ok(box.top <= .1 && Math.abs(box.bottom - mg.STAGE_BOTTOM) < 1e-9, JSON.stringify(box))
  }
  // Under a hook, clear of the captions.
  const hooked = mg.graphicBox('top', { ...frame, hook: .2 }, 'stage')
  assert.ok(hooked.top >= .22 - 1e-9 && hooked.bottom <= 1340 / 1920 - .075)
  // Compact is a shorter band than the card.
  const card = mg.graphicBox('top', frame), compact = mg.graphicBox('top', frame, 'compact')
  assert.ok(compact.bottom - compact.top < card.bottom - card.top)
  assert.deepEqual(mg.graphicBox('top', frame, 'card'), card)
  const a = { id: 'g-a', template: 'statement', at_ms: 1000, duration_ms: 2000, placement: 'top', size: 'stage' }
  const b = { id: 'g-b', template: 'stat', at_ms: 1500, duration_ms: 2000, placement: 'bottom' }
  assert.equal(mg.graphicsClash(a, b), true)
  assert.equal(mg.graphicsClash({ ...a, size: undefined }, b), false)
  assert.equal(mg.placeInFreeBand([b], a), a)
  // The render spec carries the size (and only when it isn't the usual card).
  const project = { aspect_ratio: '9:16', width: 1920, height: 1080 }
  const g = { ...mg.newGraphic('statement', 2000, { fields: { text: 'Skip the scraping.' } }), size: 'stage' }
  const c = clip({ graphics: [g] })
  assert.equal(mg.graphicSpec(project, c, g).size, 'stage')
  assert.equal('size' in mg.graphicSpec(project, c, { ...g, size: undefined }), false)
  assert.equal(mg.placementAvoidingFace(project, c, g, [0.2, 0.1, 0.6, 0.3]), g.placement)
})

test('a browser window or icon row draws without its picture when it has words; logo pop needs its picture', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-graphic-jobs-')
  t.after(cleanup)
  const { mod } = renderModule(t, dir)
  const run = path.join(dir, 'run'); fs.mkdirSync(run)
  const spec = (template, fields) => ({ template, fields, width: 1080, height: 1920, duration_ms: 2000, box: { top: .1, bottom: .5 }, placement: 'top', color: '#3B82F6', font: 'clean', size: 'stage' })
  const win = { start_ms: 0, duration_ms: 2000 }
  assert.equal(mod.graphicJob(run, 'g-1', spec('logo', {}), win), null)
  const titled = mod.graphicJob(run, 'g-2', spec('browser_frame', { title: 'A headline' }), win, 'missing0000000000.png')
  assert.ok(titled && !titled.spec.image)
  assert.equal(mod.graphicJob(run, 'g-3', spec('browser_frame', {}), win, '0123456789abcdef.png'), null)
  const png = path.join(dir, 'shot.png')
  fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]))
  const name = mod.importGraphicImage(run, png)
  const shot = mod.graphicJob(run, 'g-4', spec('browser_frame', {}), win, name)
  assert.match(shot.spec.image, /^data:image\/png;base64,/)
  assert.notEqual(shot.key, titled.key)
  const icons = mod.graphicJob(run, 'g-5', spec('icon_pop', { items: 'Email' }), win, name)
  assert.match(icons.spec.image, /^data:image\/png/)
})

test('automatic item times: checked against the item count, moved onto the finished clip, and a visual scene gives a stage card more room', () => {
  assert.deepEqual(plainCopy(mg.graphicItemTimes({ item_ms: '0\n800\n1600' }, 3, 4000)), [0, 800, 1600])
  // One more for a crossed-out list's final line; otherwise the even beats (null).
  assert.deepEqual(plainCopy(mg.graphicItemTimes({ item_ms: '0\n800\n1600' }, 2, 4000)), [0, 800, 1600])
  for (const item_ms of ['0\n800', '0\n900\n500', 'x\n1\n2', '0\n800\n9000', '']) assert.equal(mg.graphicItemTimes({ item_ms }, 3, 4000), null)
  // Cuts [1000,5000] and [7000,10000] at 1.25×: source offsets become output offsets from the graphic's start.
  const c = clip({ aspect_ratio: '9:16', captions: true, hook: null })
  const project = { aspect_ratio: '9:16', width: 1080, height: 1920 }
  const g = { id: 'g-list', template: 'list', at_ms: 2000, duration_ms: 2500, placement: 'top', size: 'stage', fields: { items: 'a\nb', item_ms: '0\n1000' } }
  const spec = mg.graphicSpec(project, c, g)
  assert.equal(spec.fields.item_ms, '0\n800')
  // A graphic that runs into cut-out footage keeps the even beats.
  assert.equal(mg.graphicSpec(project, c, { ...g, at_ms: 4000, fields: { items: 'a\nb', item_ms: '0\n1500' } }).fields.item_ms, undefined)
  // In a Visual scene the stage card reaches down to just over the captions.
  assert.ok(Math.abs(spec.box.bottom - mg.STAGE_BOTTOM) < 1e-9)
  const visual = mg.graphicSpec(project, { ...c, stage_scenes: [{ scene: 'visual', start_ms: 1500, end_ms: 5000 }] }, g)
  assert.ok(visual.box.bottom > .7 && visual.box.bottom < .8, JSON.stringify(visual.box))
})

test('depth: behind parses for big type only, Big words start behind, and the switch saves it', () => {
  const base = { id: 'g-0000000001', template: 'big_words', at_ms: 0, duration_ms: 2500, placement: 'top', fields: { text: 'Paid Creators', style: 'mixed' } }
  assert.equal(mg.parseGraphics([{ ...base, depth: 'behind' }])[0].depth, 'behind')
  assert.equal(mg.parseGraphics([{ ...base, depth: 'front' }])[0].depth, 'front')
  assert.equal(mg.parseGraphics([{ ...base, depth: 'under' }])[0].depth, undefined)
  // Older graphics (no depth) stay as they were; a template that can't go behind drops it.
  assert.equal('depth' in mg.parseGraphics([{ ...base, template: 'title' }])[0], false)
  assert.equal(mg.parseGraphics([{ ...base, template: 'stat', depth: 'behind' }])[0].depth, undefined)
  for (const t of ['big_words', 'title', 'statement', 'headline_pill']) assert.equal(mg.graphicCanGoBehind(t), true, t)
  for (const t of ['stat', 'list', 'lower_third', 'highlight', 'quote']) assert.equal(mg.graphicCanGoBehind(t), false, t)
  // Big words: behind unless set otherwise; the effective depth.
  assert.equal(mg.newGraphic('big_words', 0).depth, 'behind')
  assert.equal(mg.newGraphic('title', 0).depth, undefined)
  assert.equal(mg.graphicDepth({ template: 'big_words', depth: 'front' }), 'front')
  assert.equal(mg.graphicDepth({ template: 'stat', depth: 'behind' }), 'front')
  const c = clip({ ranges: [[0, 9000]], graphics: [{ ...base, depth: 'behind' }] })
  assert.equal(mg.updateGraphic(c, base.id, { depth: 'front' })[0].depth, 'front')
  const title = clip({ ranges: [[0, 9000]], graphics: [{ ...base, template: 'title', fields: { text: 'Hi' } }] })
  assert.equal(mg.updateGraphic(title, base.id, { depth: 'behind' })[0].depth, 'behind')
  // Switching to a template that can't go behind drops the depth.
  assert.equal(mg.updateGraphic({ ...title, graphics: mg.updateGraphic(title, base.id, { depth: 'behind' }) }, base.id, { template: 'stat' })[0].depth, undefined)
  // The fields round-trip; the words are only the ones given.
  assert.deepEqual(mg.parseGraphics([base])[0].fields, { text: 'Paid Creators', style: 'mixed' })
  assert.equal(mg.graphicHasContent({ template: 'big_words', fields: { text: '  ' } }), false)
  assert.equal(mg.graphicHasContent({ template: 'big_words', fields: { text: 'Go' } }), true)
})

test('big words: at most 3 words, stacked so each line can fill the width, options default sensibly', () => {
  assert.deepEqual(mg.bigWords('Paid Creators'), [['Paid'], ['Creators']])
  assert.deepEqual(mg.bigWords('Go viral'), [['Go', 'viral']])
  assert.deepEqual(mg.bigWords('Go viral', { mixed: true }), [['Go'], ['viral']])
  assert.deepEqual(mg.bigWords('Performance Marketing works well'), [['Performance'], ['Marketing', 'works']])
  assert.deepEqual(mg.bigWords('one two\nthree four'), [['one', 'two'], ['three']])
  assert.deepEqual(mg.bigWords('Virtual nobody', { stack: false }), [['Virtual', 'nobody']])
  assert.deepEqual(mg.bigWords(''), [])
  assert.deepEqual(mg.bigWordsOptions({}), { style: 'serif', vertical: null, motion: 'scale' })
  assert.deepEqual(mg.bigWordsOptions({ style: 'mixed', vertical: 'left', motion: 'reveal' }), { style: 'mixed', vertical: 'left', motion: 'reveal' })
  assert.deepEqual(mg.bigWordsOptions({ style: '<b>', vertical: 'up', motion: 'spin' }), { style: 'serif', vertical: null, motion: 'scale' })
  // Their band is the stage's height (room for two lines across the frame, set high).
  const project = { ...structuredClone(fixture) }
  const c = clip({ ranges: [[0, 9000]], video_speed: 1, captions: false, hook: undefined })
  const g = mg.newGraphic('big_words', 1000, { fields: { text: 'Paid Creators' } })
  const spec = mg.graphicSpec(project, c, g)
  assert.ok(spec.box.bottom - spec.box.top > .4, JSON.stringify(spec.box))
  assert.equal(mg.graphicSpec(project, c, { ...g, depth: 'front' }).box.top, spec.box.top)
})

test('a graphic behind the speaker keeps its depth through the render jobs, with the same cached render', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-graphic-depth-')
  t.after(cleanup)
  const { mod } = renderModule(t, dir)
  const run = path.join(dir, 'run'); fs.mkdirSync(run)
  const project = { ...structuredClone(fixture) }
  const g = { id: 'g-0000000009', template: 'big_words', at_ms: 1500, duration_ms: 2000, placement: 'top', fields: { text: 'Paid Creators' }, depth: 'behind' }
  const c = { ...clip(), graphics: [g, { ...g, id: 'g-0000000010', at_ms: 7200, depth: 'front' }] }
  const jobs = mod.candidateGraphicJobs(run, project, c)
  assert.deepEqual(jobs.map((j) => j.depth), ['behind', undefined])
  // Depth doesn't change the pixels: the same render serves both.
  const front = mod.graphicJob(run, 'x', jobs[0].spec, { start_ms: 0, duration_ms: 2000 })
  assert.equal(front.key, jobs[0].key)
  assert.equal(front.depth, undefined)
})

test('a graphic fitted into the cut keeps its item and word times on the words (audit)', () => {
  // Cuts [1000,5000] and [7000,10000]: a card running past the end starts 600 ms earlier, so its words come 600 ms later into it.
  const c = clip()
  const card = { at_ms: 8000, duration_ms: 2600, fields: { text: 'Big money moves', word_ms: '100\n500\n900' } }
  const fit = plainCopy(mg.fitGraphicInCut(card, c))
  assert.equal(fit.at_ms, 7400)
  assert.equal(fit.fields.word_ms, '700\n1100\n1500')
  assert.equal(fit.fields.text, 'Big money moves')
  // Started before the clip: moved later; words already said show at once.
  const early = plainCopy(mg.fitGraphicInCut({ at_ms: 700, duration_ms: 2000, fields: { items: 'a\nb', item_ms: '100\n800' } }, c))
  assert.equal(early.at_ms, 1000)
  assert.equal(early.fields.item_ms, '0\n500')
  // Unmoved: the same object.
  const inside = { at_ms: 2000, duration_ms: 1500, fields: { word_ms: '0\n200' } }
  assert.equal(mg.fitGraphicInCut(inside, c), inside)
})

test('looks: optional and backward compatible, mirrored by the engine, kept through parsing and editing', () => {
  // Every template with looks lists the engine's (auto_graphics.VARIANTS), the classic one first.
  const engine = JSON.parse(execFileSync(path.join(__dirname, '../../engine/.venv/bin/python'), ['-c', 'import json; from clip_engine.services import auto_graphics as ag; print(json.dumps({"v": ag.VARIANTS, "r": ag.ROTATION, "s": ag.SCREEN_VARIANTS}))'],
    { cwd: path.join(__dirname, '../../engine'), env: { ...process.env, PYTHONPATH: path.join(__dirname, '../../engine') } }).toString())
  assert.deepEqual(Object.fromEntries(Object.entries(mg.GRAPHIC_VARIANTS).map(([t, looks]) => [t, looks.map((v) => v.id)])), engine.v)
  for (const [t, order] of Object.entries(engine.r)) assert.deepEqual([...order].sort(), [...engine.v[t]].sort(), t)
  for (const [t, look] of Object.entries(engine.s)) assert.ok(engine.v[t].includes(look), t)
  // No look (an older graphic) or an unknown one draws the classic; one-look templates have none.
  assert.equal(mg.graphicVariant('statement', {}), 'card')
  assert.equal(mg.graphicVariant('statement', { variant: 'neon' }), 'card')
  assert.equal(mg.graphicVariant('statement', { variant: 'glass' }), 'glass')
  assert.equal(mg.graphicVariant('sticky_notes', {}), 'notes')
  assert.equal(mg.graphicVariant('orbit', { variant: 'glass' }), '')
  assert.deepEqual(plainCopy(mg.graphicVariants('orbit')), [])
  // A saved graphic keeps its look; changing it is a field change; switching template drops it.
  const [g] = mg.parseGraphics([{ id: 'g-look1', template: 'stat', at_ms: 1000, duration_ms: 3000, placement: 'top', fields: { value: '$5', variant: 'badge' } }])
  assert.equal(g.fields.variant, 'badge')
  const c = clip({ graphics: [g] })
  assert.equal(mg.updateGraphic(c, 'g-look1', { fields: { variant: 'gradient' } })[0].fields.variant, 'gradient')
  assert.equal(mg.switchGraphicTemplate(g, 'title').fields.variant, undefined)
  // A list's icon rows: one icon per item.
  assert.deepEqual(plainCopy(mg.graphicIcons({ items: 'a\nb\nc', icons: 'gift\n\nusers' }, 'list')), ['gift', null, 'users'])
  assert.ok(mg.templateInfo('list').fields.includes('icons') && mg.templateInfo('checklist').fields.includes('icons'))
})
