const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Edit my recording: the start request, Scribe v2 through OpenRouter (request shape and answers), film ideas, the
// review's choices, and the spending check. Main-process code runs in a vm with its Electron-side modules stubbed.

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, FormData, Blob, AbortSignal, AbortController, Response,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/edit-recording.ts')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-recording-test-'))
const SETTINGS = { openrouterApiKey: 'or-key', outputDirectory: userData, pythonPath: 'python3', customVocabulary: 'CreatorClips, Paid Creators' }
const selected = new Set()
const BRAND = { id: 'b'.repeat(16), name: 'Coach Sam', text: 'I help coaches price their offers. Clients went from $500 to $2,000 offers.', createdAt: '', updatedAt: '' }
// The offscreen graphics render (Electron) is stood in for: each job "renders" to a name from its cache key.
const drawnGraphics = []
const graphicsRender = {
  REEL_GRAPHICS_DIR: 'reel',
  graphicJob: (_run, id, spec, window) => ({ id, spec, key: 'a'.repeat(63) + String(drawnGraphics.length % 10), ...window }),
  renderGraphicJobs: async (_run, jobs, _cancelled, sub) => jobs.map((job) => { drawnGraphics.push({ ...job, sub }); return { id: job.id, file: `${job.key}.mov`, start_ms: job.start_ms, duration_ms: job.duration_ms } }),
  importGraphicImage: (_run, file) => `${'b'.repeat(16)}.${path.extname(file).slice(1)}`
}
// The clip editor's bake (main's runEditor) is stood in for: each call is recorded, and can be told to fail.
const editorCalls = []
let editorFails = false
const clipEditor = {
  runEditor: async (...args) => { editorCalls.push(args); if (editorFails) throw new Error('bake failed'); return {} },
  cancelEditor: (folder) => { editorCalls.push(['cancel', folder]) }
}
const main = load('main/edit-recording.ts', {
  './brands': { brandMarkForRun: async () => null, isBrandId: (v) => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v), readBrandIdentity: async () => BRAND },
  './ctas': { applyRunCtaInLock: async () => ({ failed: [] }), originalPath: (p) => p + '.original.mp4', withRunLock: async (_f, work) => work() },
  './graphics-render': graphicsRender,
  './clip-editor': clipEditor,
  './hook-memory': { rememberHeadline() {}, rememberRunHeadline() {}, savedHeadline: () => null, sourcesKey: async () => null },
  './logger': { logger: { info() {}, warn() {} } },
  './member-prefs': { readMemberPrefs: () => ({ profile: { goals: ['clips', 'edit-recording'], platforms: ['tiktok'] } }) },
  './openrouter-media': { openRouterBase: () => 'https://openrouter.test/api/v1' },
  './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
  './remix': { parseRemixRecompose: (v) => v },
  './security': { assertMediaPath: (p) => { if (!selected.has(p)) throw new Error('Invalid media path') }, authorizeMedia: (p) => p },
  './settings-store': { loadSettings: () => SETTINGS, getSettingsForBridge: () => ({}), vocabularyTerms: (v) => v.split(',').map((t) => t.trim()).filter(Boolean) },
  './tools': { resolveBinary: (name) => name }
})

test('the start request takes recordings chosen here (or in the Library), a brand and a planned hook', () => {
  const file = path.join(userData, 'take-1.mp4')
  selected.add(file)
  const parsed = main.parseEditStart({ sources: [file, file], brandIdentityId: BRAND.id, hookHint: '  Most   coaches undercharge ' }, userData)
  assert.deepEqual(plain(parsed), { sources: [file], brandIdentityId: BRAND.id, hookHint: 'Most coaches undercharge', purpose: '', referenceImage: null, mode: 'takes', order: 'filmed', screen: null, newHeadline: false })
  // "Say what it's for": one plain line of up to 200 characters, and a reference picture's id.
  const REF = 'a'.repeat(24)
  const withPurpose = main.parseEditStart({ sources: [file], brandIdentityId: null, purpose: '  Instagram reel   selling my call ', referenceImage: REF }, userData)
  assert.deepEqual([withPurpose.purpose, withPurpose.referenceImage], ['Instagram reel selling my call', REF])
  assert.throws(() => main.parseEditStart({ sources: [file], purpose: 'x'.repeat(201) }, userData), /200 characters/)
  assert.throws(() => main.parseEditStart({ sources: [file], purpose: 'a <script>' }, userData), /plain words/)
  assert.throws(() => main.parseEditStart({ sources: [file], purpose: 7 }, userData), /short line/)
  assert.throws(() => main.parseEditStart({ sources: [file], referenceImage: '../../x.png' }, userData), /reference image again/)
  assert.throws(() => main.parseEditStart({ sources: [] }, userData), /Choose your recording/)
  assert.throws(() => main.parseEditStart({ sources: ['/etc/passwd'] }, userData), /Choose a video/)
  assert.throws(() => main.parseEditStart({ sources: ['/elsewhere/secret.mp4'] }, userData), /Choose your recording again/)
  assert.throws(() => main.parseEditStart({ sources: Array.from({ length: 6 }, (_, i) => `/a/${i}.mp4`) }, userData), /up to 5 takes/)
  assert.throws(() => main.parseEditStart({ sources: [file], brandIdentityId: '../x' }, userData), /one of your brands/)
  assert.throws(() => main.parseEditStart({ sources: [file], hookHint: 'x'.repeat(601) }, userData), /too long/)
  assert.throws(() => main.parseEditStart('nope', userData), /Choose your recording/)
  // The spending check estimates only from recordings checked here (their length is known).
  assert.equal(main.startEstimate({ sources: [file] }), null)
})

function fakeFetch(answer, status = 200) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), { status })
  }
  return { fetcher, calls }
}

test('Scribe v2: multipart to OpenRouter with word timestamps and key terms; words in milliseconds, spacing and sound events left out', async () => {
  const { fetcher, calls } = fakeFetch({
    text: 'Hello coaches (laughs) welcome.', language: 'en', duration: 3,
    words: [{ word: 'Hello', start: 0.1, end: 0.45, type: 'word' }, { word: ' ', start: 0.45, end: 0.5, type: 'spacing' },
      { word: 'coaches', start: 0.5, end: 0.9 }, { word: '(laughs)', start: 1, end: 1.5, type: 'audio_event' }, { word: 'welcome.', start: 1.6, end: 2.1, type: 'word' }],
    usage: { cost: 0.00009, seconds: 3 }
  })
  const result = await main.transcribeWithScribe({ bytes: new Uint8Array([1, 2, 3]), name: 'audio-0.mp3', type: 'audio/mpeg', seconds: 3 }, ['Coach Sam', 'CreatorClips'], 'or-key', { fetch: fetcher })
  assert.equal(calls.length, 1)
  const { url, init } = calls[0]
  assert.equal(url, 'https://openrouter.test/api/v1/audio/transcriptions')
  assert.equal(init.method, 'POST')
  assert.equal(init.redirect, 'error')
  assert.equal(init.headers.Authorization, 'Bearer or-key')
  const form = init.body
  assert.equal(form.get('model'), 'elevenlabs/scribe-v2')
  assert.equal(form.get('response_format'), 'verbose_json')
  assert.deepEqual(form.getAll('timestamp_granularities[]'), ['word'])
  assert.deepEqual(form.getAll('keyterms[]'), ['Coach Sam', 'CreatorClips'])
  const file = form.get('file')
  assert.equal(file.name, 'audio-0.mp3')
  assert.equal(file.type, 'audio/mpeg')
  assert.equal(file.size, 3)
  assert.deepEqual(plain(result.words), [['Hello', 100, 450], ['coaches', 500, 900], ['welcome.', 1600, 2100]])
  assert.equal(result.costUsd, 0.00009)
  assert.equal(result.estimated, false)
})

test('Scribe v2: no reported cost is estimated from the listed price; a bad key or no credit stops; other failures fall back', async () => {
  const noCost = fakeFetch({ text: 'Hi.', words: [{ word: 'Hi.', start: 0, end: 0.3 }] })
  const estimated = await main.transcribeWithScribe({ bytes: new Uint8Array(1), name: 'a.flac', type: 'audio/flac', seconds: 100 }, [], 'k', { fetch: noCost.fetcher })
  assert.equal(estimated.estimated, true)
  assert.ok(Math.abs(estimated.costUsd - 100 * shared.SCRIBE_PRICE_PER_SECOND) < 1e-12)
  assert.equal(noCost.calls[0].init.body.getAll('keyterms[]').length, 0)
  const statusOf = async (status) => {
    try { await main.transcribeWithScribe({ bytes: new Uint8Array(1), name: 'a.mp3', type: 'audio/mpeg', seconds: 1 }, [], 'k', { fetch: fakeFetch({}, status).fetcher }); return null } catch (error) { return error }
  }
  for (const status of [401, 403, 402]) assert.equal((await statusOf(status)).final, true, `status ${status}`)
  assert.match((await statusOf(402)).message, /insufficient credits/)
  for (const status of [400, 404, 429, 500, 503]) assert.equal((await statusOf(status)).final, false, `status ${status}`)
  // Words missing from a paid answer: it falls back, and what was paid is kept.
  const noWords = fakeFetch({ text: 'Something was said.', words: [], usage: { cost: 0.002 } })
  await assert.rejects(main.transcribeWithScribe({ bytes: new Uint8Array(1), name: 'a.mp3', type: 'audio/mpeg', seconds: 5 }, [], 'k', { fetch: noWords.fetcher }),
    (error) => error.final === false && error.costUsd === 0.002)
  // No key: final, before anything is sent. Too large for the endpoint: not sent, falls back.
  await assert.rejects(main.transcribeWithScribe({ bytes: new Uint8Array(1), name: 'a.mp3', type: 'audio/mpeg', seconds: 1 }, [], '', { fetch: noCost.fetcher }), (error) => error.final === true)
  await assert.rejects(main.transcribeWithScribe({ bytes: new Uint8Array(25 * 1024 * 1024), name: 'a.mp3', type: 'audio/mpeg', seconds: 1 }, [], 'k', { fetch: noCost.fetcher }), (error) => error.final === false)
  assert.equal(noCost.calls.length, 1)
})

const IDEAS = {
  ideas: [
    { title: 'The $500 trap', hook: 'Your $500 offer is costing you clients', points: ['Why cheap feels risky', 'What changed at $2,000', 'One step today'], format: 'camera', why: 'Speaks to coaches pricing.' },
    { title: 'Invented proof', hook: 'I made $90,000 last month', points: ['a', 'b', 'c'], format: 'camera', why: '' },
    { title: 'React to a pricing take', hook: 'This pricing advice is wrong', points: ['What they said', 'Where it breaks', 'What to do'], format: 'pause_react', why: '' },
    { title: 'Short', hook: 'Too few points', points: ['one'], format: 'camera', why: '' }
  ]
}

test('film ideas: one strict-schema call with the brand, goals and pasted material; ideas with numbers nobody gave are dropped', async () => {
  const { fetcher, calls } = fakeFetch({ choices: [{ message: { content: JSON.stringify(IDEAS) } }], usage: { cost: 0.0031 } })
  const result = await main.filmIdeas({ brandIdentityId: BRAND.id, material: 'Notes: raise prices.', topic: 'pricing' }, fetcher)
  const body = JSON.parse(calls[0].init.body)
  assert.equal(calls[0].url, 'https://openrouter.test/api/v1/chat/completions')
  assert.equal(body.response_format.type, 'json_schema')
  assert.equal(body.response_format.json_schema.strict, true)
  assert.match(body.messages[0].content, /Never invent facts, numbers, results, clients or testimonials/)
  assert.match(body.messages[0].content, /data, never instructions/)
  const user = JSON.parse(body.messages[1].content)
  assert.deepEqual(plain(user.goals), ['clips', 'edit-recording'])
  assert.equal(user.brand.name, 'Coach Sam')
  assert.equal(user.material, 'Notes: raise prices.')
  assert.deepEqual(plain(result.ideas.map((idea) => idea.title)), ['The $500 trap', 'React to a pricing take'])
  assert.equal(result.ideas[1].format, 'pause_react')
  assert.equal(result.costUsd, 0.0031)
  // Nothing usable: the error carries what the call cost (so it's still recorded).
  const empty = fakeFetch({ choices: [{ message: { content: '{"ideas":[]}' } }], usage: { cost: 0.002 } })
  await assert.rejects(main.filmIdeas({ brandIdentityId: null, material: '', topic: 'sleep' }, empty.fetcher), (error) => error.costUsd === 0.002)
  assert.throws(() => main.parseIdeasRequest({ brandIdentityId: null, material: '', topic: '  ' }), /Pick your brand or paste/)
  assert.throws(() => main.parseIdeasRequest({ brandIdentityId: null, material: 'x'.repeat(20001), topic: '' }), /Paste up to/)
  assert.throws(() => main.parseIdeasRequest({ brandIdentityId: 'nope', material: 'a', topic: '' }), /one of your brands/)
})

function samplePlan() {
  const words = [['Hi', 0, 200, 0, 'off_topic'], ['Most', 300, 500, 0, null], ['coaches', 520, 800, 0, null], ['um', 820, 900, 0, 'filler'], ['undercharge.', 920, 1400, 0, null],
    ['Here', 2000, 2200, 0, null], ['is', 2220, 2300, 0, null], ['why.', 2320, 2700, 0, null], ['Follow', 3000, 3300, 0, null], ['me.', 3320, 3600, 0, null]]
  return shared.parseEditPlan({
    words, hooks: [{ id: 0, start: 5, end: 7, text: 'Here is why', why: 'A promise' }, { id: 1, start: 1, end: 4, text: 'Most coaches undercharge', why: '' }], hook: 0,
    cta: { start: 8, end: 9 }, popups: [{ id: 0, word: 2, text: 'coaches', kind: 'keyword' }], sounds: [{ id: 0, at: 'title', sound: 'whoosh' }, { id: 1, at: 2, sound: 'pop' }],
    planned: 'ai', notes: ['Cut 1 filler word.'], warnings: []
  }, 1)
}

test('the review: words toggle, a span toggles, another hook comes with its text, and the reel order is hook, body, call to action', () => {
  const plan = samplePlan()
  assert.equal(shared.parseEditPlan({ ...plan, words: [['x', 10, 5, 0, null]] }, 1), null)
  assert.equal(shared.parseEditPlan({ words: [['x', 0, 5, 3, null]] }, 1), null)
  let decisions = shared.initialDecisions(plan)
  assert.deepEqual(plain(decisions.cut), [0, 3])
  assert.equal(decisions.hookText, 'Here is why')
  assert.deepEqual(plain(shared.reelOrder(plan, decisions)), [5, 6, 7, 1, 2, 4, 8, 9])
  decisions = shared.toggleWord(decisions, 0)
  assert.deepEqual(plain(decisions.cut), [3])
  decisions = shared.toggleSpan(decisions, 4, 1)
  assert.deepEqual(plain(decisions.cut), [1, 2, 3, 4])
  decisions = shared.toggleSpan(decisions, 1, 4)
  assert.deepEqual(plain(decisions.cut), [])
  decisions = shared.chooseHook(plan, { ...decisions, cut: [2] }, 1)
  // Its words play again (only filler stays cut), and its title text comes with it.
  assert.deepEqual(plain(decisions.cut), [])
  assert.equal(decisions.hookText, 'Most coaches undercharge')
  const typed = shared.chooseHook(plan, { ...decisions, hookText: 'My own words' }, 0)
  assert.equal(typed.hookText, 'My own words')
  assert.deepEqual(plain(shared.reelOrder(plan, { ...decisions, endOnCta: false })), [1, 2, 3, 4, 0, 5, 6, 7, 8, 9])
  assert.ok(shared.reelSeconds(plan, shared.initialDecisions(plan)) > 2)
})

test('the review choices are checked against the plan before a reel is made', () => {
  const plan = samplePlan()
  const good = { ...shared.initialDecisions(plan), look: { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false } }
  assert.deepEqual(plain(shared.parseEditDecisions(good, plan).cut), [0, 3])
  const bad = (patch, pattern) => assert.throws(() => shared.parseEditDecisions({ ...good, ...patch }, plan), pattern)
  bad({ cut: [99] }, /Choose the words/)
  bad({ cut: 'all' }, /Choose the words/)
  bad({ hookId: 7 }, /one of the hooks/)
  bad({ hookText: 'x'.repeat(91) }, /90 characters/)
  bad({ hookText: 'Use <b>tags</b>' }, /plain text/)
  bad({ endOnCta: 'yes' }, /call to action/)
  bad({ popups: [{ id: 5, on: true, text: 'x' }] }, /pop-ups/)
  bad({ popups: [{ id: 0, on: true, text: '' }] }, /28 characters/)
  bad({ sounds: [{ id: 9, on: true }] }, /sounds/)
  bad({ look: { ...good.look, captionPreset: 'comic-sans' } }, /captions and look/)
  bad({ look: { ...good.look, lookExtras: 'keyword_pill' } }, /extras/)
  // Extras ride along with the look: known ids only, left out when none.
  assert.equal('lookExtras' in shared.parseEditDecisions(good, plan).look, false)
  assert.deepEqual(plain(shared.parseEditDecisions({ ...good, look: { ...good.look, lookExtras: ['comment_box', 'punch_zoom', 'glitter'] } }, plan).look.lookExtras),
    ['punch_zoom', 'comment_box'])
  // Skills on the look: music (a track only with music) and voice cleanup; off is left out.
  const audio = shared.parseEditDecisions({ ...good, look: { ...good.look, music: true, musicTrack: 'upbeat-pulse', voiceCleanup: true } }, plan).look
  assert.deepEqual([audio.music, audio.musicTrack, audio.voiceCleanup], [true, 'upbeat-pulse', true])
  assert.deepEqual(['music', 'musicTrack', 'voiceCleanup'].filter((key) => key in shared.parseEditDecisions({ ...good, look: { ...good.look, music: false, musicTrack: 'upbeat-pulse' } }, plan).look), [])
  bad({ look: { ...good.look, music: 'yes' } }, /music/)
  bad({ look: { ...good.look, voiceCleanup: 1 } }, /voice/)
  bad({ cut: [0, 1, 2, 3, 4, 5, 6, 7, 8] }, /Keep a few more words/)
})

test('film ideas are checked: three talking points, a known format, and only numbers from the member’s own text', () => {
  const ideas = shared.parseFilmIdeas(IDEAS, 'Clients went from $500 to $2,000 offers.')
  assert.deepEqual(plain(ideas.map((idea) => idea.title)), ['The $500 trap', 'React to a pricing take'])
  assert.deepEqual(plain(shared.digitNumbers('From $1,200 to 3.5 and 15.')), ['1200', '3.5', '15'])
  assert.equal(shared.parseFilmIdeas({ ideas: [{ ...IDEAS.ideas[0], format: 'dance' }] }, '$500 $2,000')[0].format, 'camera')
  assert.equal(shared.parseFilmIdeas('nope', '').length, 0)
})

test('estimates use the listed Scribe price and the app’s planning price; transcribing and planning pass the spending check', () => {
  const minute = shared.editEstimate(60)
  assert.ok(Math.abs(minute.transcribeUsd - 60 * 0.000061) < 1e-12)
  assert.ok(Math.abs(minute.planUsd - 0.35 * 0.05) < 1e-12)
  assert.equal(shared.formatUsd(0.004), 'under 1¢')
  assert.equal(shared.aboutUsd(0.004), 'under 1¢')
  assert.equal(shared.aboutUsd(0.12), 'about $0.12')
  const spending = fs.readFileSync(path.join(ROOT, 'main/spending.ts'), 'utf8')
  assert.match(spending, /'edit:start', 'edit:ideas'/)
  const handlers = fs.readFileSync(path.join(ROOT, 'main/ipc-handlers.ts'), 'utf8')
  assert.match(handlers, /paid\('edit:start', 'openrouter'/)
  assert.match(handlers, /paid\('edit:ideas', 'openrouter', \(\) => IDEAS_ESTIMATE_USD/)
  // Making the reel is local: not a paid channel.
  assert.match(handlers, /handle\('edit:render'/)
  // A paid ideas call that gave nothing usable is still recorded.
  assert.match(handlers, /const cost = \(error as \{ costUsd\?: unknown \} \| null\)\?\.costUsd/)
  const preload = fs.readFileSync(path.join(ROOT, 'preload/index.ts'), 'utf8')
  assert.match(preload, /start: \(request\) => paid\('edit:start', request\)/)
  assert.match(preload, /ideas: \(request\) => paid\('edit:ideas', request\)/)
})

test('recordings made here are saved to My recordings, checked, and only video types are accepted', async () => {
  await assert.rejects(main.beginEditRecording('audio/ogg'), /format isn’t supported/)
  const token = await main.beginEditRecording('video/webm;codecs=vp9,opus')
  await assert.rejects(main.beginEditRecording('video/webm'), /already being saved/)
  await assert.rejects(main.appendEditRecording(token, 'not bytes'), /Invalid recording data/)
  await assert.rejects(main.appendEditRecording('nope', new Uint8Array(1)), /was stopped/)
  await main.appendEditRecording(token, new Uint8Array([1, 2, 3]))
  const folder = path.join(userData, 'My recordings')
  assert.equal(fs.readdirSync(folder).length, 1)
  // Not a real video: it can't be read, so it isn't kept.
  await assert.rejects(main.finishEditRecording(token), /could not be read/)
  assert.equal(fs.readdirSync(folder).length, 0)
  const second = await main.beginEditRecording('video/mp4')
  await main.abortEditRecording(second)
  assert.equal(fs.readdirSync(folder).length, 0)
})

test('Library re-makes are only for edited recordings in the output folder', async () => {
  assert.equal(main.isEditRunFolder(path.join(userData, 'edit-12345678-1234-1234-1234-123456789abc')), true)
  assert.equal(main.isEditRunFolder(path.join(userData, 'remix-12345678-1234-1234-1234-123456789abc')), false)
  await assert.rejects(main.recomposeEditRun('/tmp/edit-12345678-1234-1234-1234-123456789abc', 0, {}), /Only edited recordings/)
  await assert.rejects(main.recomposeEditRun(path.join(userData, 'edit-12345678-1234-1234-1234-123456789abc'), 0, {}), /Only edited recordings/)
})

// ---------------------------------------------------------------------------
// The run itself, with FFmpeg, the engine and OpenRouter faked
// ---------------------------------------------------------------------------

const { EventEmitter } = require('node:events')
const { promisify } = require('node:util')

function loadWithGlobals(relative, mocks, globals) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, FormData, Blob, AbortSignal, AbortController, Response, ...globals,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

/** An edit-recording module whose FFmpeg extraction waits for `extract` and whose engine answers from `engine`. */
const NO_HOOK_MEMORY = { rememberHeadline() {}, rememberRunHeadline() {}, savedHeadline: () => null, sourcesKey: async () => null }
function runHarness({ brandMark = async () => null, hookMemory = NO_HOOK_MEMORY } = {}) {
  const state = { extractions: [], fetches: 0, engineModes: [], statuses: [], configs: [] }
  const execFile = (bin, args, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {} }
    if (bin === 'ffprobe') { callback(null, { stdout: '10\n', stderr: '' }); return }
    if (args.includes('-encoders')) { callback(null, { stdout: ' A..... libmp3lame\n', stderr: '' }); return }
    if (args.includes('-version')) { callback(null, { stdout: 'ffmpeg', stderr: '' }); return }
    // The audio extraction: finishes after a moment unless its signal stops it first.
    const out = args[args.length - 1]
    const entry = { signal: options.signal, done: false }
    state.extractions.push(entry)
    const timer = setTimeout(() => { entry.done = true; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, 'audio'); callback(null, { stdout: '', stderr: '' }) }, 80)
    options.signal?.addEventListener('abort', () => { clearTimeout(timer); callback(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  }
  const spawn = () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = undefined
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      state.engineModes.push(config.mode)
      state.configs.push(config)
      const answer = config.mode === 'plan'
        ? { ok: true, cost_usd: 0.01, words: [['Most', 0, 400, 0, null], ['coaches', 450, 900, 0, null], ['undercharge.', 950, 1500, 0, null], ['Here', 2000, 2200, 0, null], ['is', 2250, 2400, 0, null], ['why.', 2450, 2900, 0, null]],
          hooks: [{ id: 0, start: 3, end: 5, text: 'Here is why', why: '' }], hook: 0, cta: null, popups: [], sounds: [], planned: 'ai', notes: [], warnings: [],
          ...(config.direction ? { graphics: [{ id: 'g-plan01', template: 'statement', word: 0, duration_ms: 2500, placement: 'top', fields: { text: 'Most coaches undercharge.', accent: 'undercharge' }, origin: 'auto' }] } : {}) }
        : { ok: true, duration_seconds: 3, warnings: [], ...(config.editor ? { editor: true } : {}) }
      setTimeout(() => { child.stdout.emit('data', JSON.stringify(answer) + '\n'); child.emit('close', 0) }, 10)
    } }
    return child
  }
  const fetchStub = async () => {
    state.fetches += 1
    return new Response(JSON.stringify({ text: 'Most coaches undercharge.', words: [{ word: 'Most', start: 0, end: 0.4 }, { word: 'coaches', start: 0.45, end: 0.9 }], usage: { cost: 0.001 } }))
  }
  const module = loadWithGlobals('main/edit-recording.ts', {
    child_process: { execFile, execFileSync: () => '', spawn },
    util: { promisify },
    './brands': { brandMarkForRun: brandMark, isBrandId: () => false, readBrandIdentity: async () => null },
    './ctas': { applyRunCtaInLock: async () => ({ failed: [] }), originalPath: (p) => p + '.original.mp4', withRunLock: async (_f, work) => work() },
    './graphics-render': graphicsRender,
  './clip-editor': clipEditor,
    './hook-memory': hookMemory,
    './logger': { logger: { info() {}, warn() {} } },
    './member-prefs': { readMemberPrefs: () => ({ profile: { goals: [], platforms: [] } }) },
    './openrouter-media': { openRouterBase: () => 'https://openrouter.test/api/v1' },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './remix': { parseRemixRecompose: (v) => v },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => SETTINGS, getSettingsForBridge: () => ({}), vocabularyTerms: () => [] },
    './tools': { resolveBinary: (name) => name }
  }, { fetch: fetchStub })
  module.onEditStatus((status) => state.statuses.push(plain(status)))
  return { main: module, state }
}

async function waitFor(check, label) {
  for (let i = 0; i < 300; i += 1) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)) }
  throw new Error(`timed out waiting for ${label}`)
}

test('canceling while the audio is read out stops FFmpeg, and the paid transcription is never sent', async () => {
  const { main: edit, state } = runHarness()
  await edit.startEdit({ sources: [path.join(userData, 'cancel-take.mp4')] })
  await waitFor(() => state.extractions.length === 1, 'the extraction')
  assert.ok(state.extractions[0].signal, 'FFmpeg gets the run’s abort signal')
  assert.equal(edit.cancelEdit(), true)
  await waitFor(() => edit.editStatus()?.phase === 'cancelled', 'the run to cancel')
  // Let a late extraction (if it wasn't stopped) finish, then check nothing paid went out.
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(state.extractions[0].done, false)
  assert.equal(state.fetches, 0)
  assert.equal(edit.editStatus().costUsd, 0)
})

test('making the reel can only start once: a second click, Start over or Cancel during setup are safe', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let marks = 0
  const { main: edit, state } = runHarness({ brandMark: async () => { marks += 1; await gate; return null } })
  await edit.startEdit({ sources: [path.join(userData, 'render-take.mp4')] })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the review')
  assert.equal(state.fetches, 1)
  const plan = edit.editStatus().plan
  const decisions = { ...shared.initialDecisions(plan), look: { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false } }
  const first = edit.renderEdit(decisions)
  // Rendering is set before the brand mark is read, so a second click is turned away.
  assert.equal(edit.editStatus().phase, 'rendering')
  await assert.rejects(edit.renderEdit(decisions), /no edit waiting for review/)
  assert.equal(await edit.discardEdit(), false, 'Start over waits while the reel is being made')
  await assert.rejects(edit.startEdit({ sources: [path.join(userData, 'render-take.mp4')] }), /being edited/)
  // Cancel while the brand mark is read: back to review, nothing rendered.
  assert.equal(edit.cancelEdit(), true)
  release()
  await first
  assert.equal(marks, 1)
  assert.equal(edit.editStatus().phase, 'review')
  assert.equal(edit.editStatus().error, null)
  assert.deepEqual(state.engineModes, ['plan'])
  // And it can be made afterward.
  await edit.renderEdit(decisions)
  await waitFor(() => edit.editStatus()?.phase === 'done', 'the reel')
  assert.deepEqual(state.engineModes, ['plan', 'render'])
  fs.rmSync(edit.editStatus().folder, { recursive: true, force: true })
})

test('the progress view: each status carries the stages so far, the first words heard and what the reel is made of', async () => {
  const { main: edit, state } = runHarness()
  await edit.startEdit({ sources: [path.join(userData, 'progress-take.mp4')] })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the review')
  const listening = state.statuses.find((status) => status.phase === 'transcribing' && /^Listening/.test(status.detail))
  assert.deepEqual(listening.progress.stages.map((stage) => [stage.id, stage.endedAt === null]), [['listen', true]])
  let progress = plain(edit.editStatus().progress)
  assert.deepEqual(progress.stages.map((stage) => stage.id), ['listen', 'plan', 'review'])
  assert.ok(progress.stages.slice(0, 2).every((stage) => stage.endedAt >= stage.startedAt))
  assert.deepEqual(plain(progress.heard), [{ src: 0, text: 'Most coaches' }])
  assert.equal(progress.wordsHeard, 2)
  const decisions = { ...shared.initialDecisions(edit.editStatus().plan), look: { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false } }
  await edit.renderEdit(decisions)
  const making = state.statuses.find((status) => status.phase === 'rendering')
  assert.equal(making.progress.stages.at(-1).id, 'cut')
  assert.ok(making.progress.renderStartedAt >= progress.startedAt)
  assert.deepEqual(plain(making.progress.found), { hook: 'Here is why', cuts: 0, popups: 0, graphics: 1, broll: false })
  await waitFor(() => edit.editStatus()?.phase === 'done', 'the reel')
  progress = plain(edit.editStatus().progress)
  assert.ok(progress.stages.every((stage) => stage.endedAt !== null))
  fs.rmSync(edit.editStatus().folder, { recursive: true, force: true })
})

test('voice cleanup and music: on the decisions (or the look), checked, and sent to the engine as one "audio" option', async () => {
  const plan = samplePlan()
  const good = { ...shared.initialDecisions(plan), look: { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false } }
  const parsed = shared.parseEditDecisions({ ...good, voiceCleanup: true, music: true, musicTrack: 'calm-pad' }, plan)
  assert.deepEqual([parsed.voiceCleanup, parsed.music, parsed.musicTrack], [true, true, 'calm-pad'])
  const fromLook = shared.parseEditDecisions({ ...good, look: { ...good.look, voiceCleanup: true, music: true, musicTrack: 'my:theme.mp3' } }, plan)
  assert.deepEqual([fromLook.voiceCleanup, fromLook.music, fromLook.musicTrack], [true, true, 'my:theme.mp3'])
  assert.equal('music' in shared.parseEditDecisions(good, plan), false)
  // Music switched on without a pick (the Skills panel) gets the first built-in track.
  assert.equal(shared.parseEditDecisions({ ...good, music: true }, plan).look.musicTrack, 'calm-pad')

  const { main: edit, state } = runHarness()
  await edit.startEdit({ sources: [path.join(userData, 'music-take.mp4')] })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the review')
  const review = edit.editStatus().plan
  const decisions = { ...shared.initialDecisions(review), look: good.look, voiceCleanup: true, music: true, musicTrack: 'lofi-beat' }
  await edit.renderEdit(decisions)
  await waitFor(() => edit.editStatus()?.phase === 'done', 'the reel')
  const render = state.configs.find((config) => config.mode === 'render')
  assert.deepEqual(render.audio, { voice_cleanup: true, music: { track: 'lofi-beat' }, music_level_db: -20 })
  fs.rmSync(edit.editStatus().folder, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Edit styles, cards, my images and the openings
// ---------------------------------------------------------------------------

function cardPlan() {
  const plan = samplePlan()
  return shared.parseEditPlan({
    ...plan, words: plan.words.map((w) => [w.text, w.startMs, w.endMs, w.src, w.cut]),
    popups: [{ id: 0, word: 2, text: 'coaches', kind: 'keyword' }, { id: 1, word: 4, text: '3x', kind: 'number' },
      { id: 2, word: 5, kind: 'card', seconds: 9, card: { type: 'list', title: 'Why coaches undercharge', items: ['Fear', 'Habit'] } },
      { id: 3, word: 8, kind: 'card', card: { type: 'stat', title: '<b>', items: ['x'] } },
      { id: 4, word: 7, kind: 'card', card: { type: 'compare', title: '', items: ['Before'] } }]
  }, 1)
}

test('edit styles: each sets its pacing and extras, and which pop-ups and cards start on; typed text stays', () => {
  const recipes = load('shared/edit-recipes.ts')
  assert.deepEqual(plain(recipes.EDIT_RECIPES.map((r) => r.id)), ['clean', 'fast', 'story', 'tutorial'])
  for (const recipe of recipes.EDIT_RECIPES) {
    assert.ok(recipe.detail.length > 20 && recipe.pacing.keepPause < recipe.pacing.maxPause)
    assert.ok(!/[A-Z][a-z]+ [A-Z][a-z]+'s/.test(recipe.label), 'not named after a person')
  }
  const plan = cardPlan()
  // A card with markup or a compare missing a side is dropped; the list's time is held to 5 seconds.
  assert.deepEqual(plain(plan.popups.map((p) => p.kind)), ['keyword', 'number', 'card'])
  assert.equal(plan.popups[2].seconds, 5)
  let decisions = shared.initialDecisions(plan)
  assert.equal(decisions.recipe, 'clean')
  assert.deepEqual(plain(decisions.popups.map((p) => p.on)), [true, true, false])
  assert.deepEqual(plain(decisions.lookExtras), [])
  decisions = { ...decisions, popups: decisions.popups.map((p) => p.id === 0 ? { ...p, text: 'Coaches!' } : p) }
  const story = shared.applyRecipe(plan, decisions, 'story')
  assert.deepEqual(plain(story.popups.map((p) => [p.on, p.text])), [[true, 'Coaches!'], [true, '3x'], [true, 'Why coaches undercharge']])
  assert.deepEqual(plain(story.lookExtras), ['accent_words'])
  const fast = shared.applyRecipe(plan, decisions, 'fast')
  assert.deepEqual(plain(fast.lookExtras), ['keyword_pill', 'progress_bar'])
  // Fast pacing tightens pauses more than the clean style; the raw opening adds its seconds.
  const asRecorded = (d) => ({ ...d, hookId: null, endOnCta: false })
  assert.ok(shared.reelSeconds(plan, asRecorded(fast)) < shared.reelSeconds(plan, asRecorded(story)))
  assert.ok(Math.abs(shared.reelSeconds(plan, { ...fast, rawIntro: true }) - shared.reelSeconds(plan, fast) - shared.RAW_INTRO_SECONDS) < 1e-9)
})

test('cards, pins and openings on the review are checked before a reel is made', () => {
  const plan = cardPlan()
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false }
  const images = [{ id: 'aaaaaaaaaaaa', name: 'logo.png', path: '/out/edit-1/images/aaaaaaaaaaaa.png' }]
  const good = { ...shared.applyRecipe(plan, shared.initialDecisions(plan), 'fast'), look, pins: [{ image: 'aaaaaaaaaaaa', word: 6 }], rawIntro: true }
  const parsed = shared.parseEditDecisions(good, plan, images)
  assert.equal(parsed.recipe, 'fast')
  assert.deepEqual(plain(parsed.pins), [{ image: 'aaaaaaaaaaaa', word: 6 }])
  assert.equal(parsed.rawIntro, true)
  assert.equal(parsed.cutoutIntro, false)
  assert.deepEqual(plain(parsed.popups[2].card), { type: 'list', title: 'Why coaches undercharge', items: ['Fear', 'Habit'] })
  const card = (patch) => ({ ...good, popups: good.popups.map((p) => p.id === 2 ? { ...p, ...patch } : p) })
  const bad = (value, pattern) => assert.throws(() => shared.parseEditDecisions(value, plan, images), pattern)
  bad(card({ card: { type: 'list', title: 'Why', items: ['Only one'] } }), /at least two items/)
  bad(card({ card: { type: 'stat', title: '5', items: ['x'] } }), /pop-ups|card text/)
  bad(card({ card: { type: 'list', title: 'x'.repeat(49), items: ['a', 'b'] } }), /card text plain and short/)
  bad(card({ card: { type: 'list', title: 'Why <script>', items: ['a', 'b'] } }), /card text plain and short/)
  // An unfinished card that's off is fine.
  assert.equal(shared.parseEditDecisions(card({ on: false, card: { type: 'list', title: '', items: ['a'] } }), plan, images).popups[2].on, false)
  bad({ ...good, pins: [{ image: 'bbbbbbbbbbbb', word: 6 }] }, /Pin each image/)
  bad({ ...good, pins: [{ image: 'aaaaaaaaaaaa', word: 99 }] }, /Pin each image/)
  bad({ ...good, recipe: 'viral' }, /edit styles/)
  bad({ ...good, rawIntro: 'yes' }, /how your video opens/)
  // Unknown extras are dropped.
  assert.deepEqual(plain(shared.parseEditDecisions({ ...good, lookExtras: ['glow', 'progress_bar'] }, plan, images).lookExtras), ['progress_bar'])
})

test('my images: pictures are checked by their bytes and kept in the run; the render gets the style, cards, pins and openings', async () => {
  const { main: edit, state } = runHarness()
  assert.equal(edit.imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png')
  assert.equal(edit.imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg')
  assert.equal(edit.imageKind(new TextEncoder().encode('RIFF....WEBPVP8 ')), 'webp')
  assert.equal(edit.imageKind(new TextEncoder().encode('<svg>')), null)
  await assert.rejects(edit.addEditImage('logo.png', new Uint8Array([0x89, 0x50])), /while you review/)
  await edit.startEdit({ sources: [path.join(userData, 'images-take.mp4')] })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the review')
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  await assert.rejects(edit.addEditImage('fake.png', new TextEncoder().encode('<svg onload=x>')), /PNG, JPEG or WebP/)
  await assert.rejects(edit.addEditImage('../x.png', 'not bytes'), /could not be read/)
  const images = await edit.addEditImage('../../My Logo.png', png)
  assert.equal(images.length, 1)
  assert.equal(images[0].name, 'My Logo.png')
  assert.equal(path.dirname(images[0].path), path.join(edit.editStatus().folder, 'images'))
  assert.ok(images[0].path.endsWith('.png') && fs.readFileSync(images[0].path).equals(Buffer.from(png)))
  assert.equal(edit.editStatus().images.length, 1)
  const plan = edit.editStatus().plan
  const decisions = { ...shared.applyRecipe(plan, shared.initialDecisions(plan), 'tutorial'),
    look: { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false },
    pins: [{ image: images[0].id, word: 1 }], cutoutIntro: true, rawIntro: true }
  await edit.renderEdit(decisions)
  await waitFor(() => edit.editStatus()?.phase === 'done', 'the reel')
  const config = state.configs.find((c) => c.mode === 'render')
  assert.equal(config.recipe, 'tutorial')
  assert.deepEqual(config.pacing, { max_gap: 0.5, short_pause: 0.2, punch_on_cuts: false })
  assert.deepEqual(config.look_extras, ['progress_bar', 'broll_tags'])
  assert.deepEqual(config.images, [images[0].path])
  assert.deepEqual(config.pins, [{ image: images[0].path, word: 1 }])
  assert.equal(config.cutout_intro, true)
  assert.equal(config.raw_intro, true)
  fs.rmSync(edit.editStatus().folder, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// The automatic direction: the plan's graphics, Skills, and the reel as a clip editor project
// ---------------------------------------------------------------------------

test('the plan asks for graphics, the review starts with them on, and the reel is baked by the clip editor', async () => {
  editorCalls.length = 0
  editorFails = false
  const { main: edit, state } = runHarness()
  await edit.startEdit({ sources: [path.join(userData, 'direction-take.mp4')] })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the review')
  const planRequest = state.configs.find((c) => c.mode === 'plan')
  assert.deepEqual(planRequest.direction, { stage: true })
  const plan = edit.editStatus().plan
  assert.deepEqual(plain(plan.graphics.map((g) => [g.template, g.word, g.origin])), [['statement', 0, 'auto']])
  const decisions = { ...shared.initialDecisions(plan), look: { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false } }
  assert.equal(decisions.motionGraphics, true)
  assert.equal(decisions.stageLayouts, true)
  assert.equal(decisions.graphics.length, 1)
  await edit.renderEdit(decisions)
  await waitFor(() => edit.editStatus()?.phase === 'done', 'the reel')
  const render = state.configs.find((c) => c.mode === 'render')
  assert.deepEqual(plain(render.editor), { graphics: [{ id: 'g-plan01', template: 'statement', word: 0, duration_ms: 2500, placement: 'top', fields: { text: 'Most coaches undercharge.', accent: 'undercharge' }, origin: 'auto' }],
    pins: [], motion: true, stage: true })
  // Nothing is drawn before the engine: the editor's bake draws the graphics.
  assert.equal(render.graphics, undefined)
  assert.deepEqual(plain(editorCalls), [[edit.editStatus().folder, 0, 'edit-reel', 'export']])
  assert.equal(edit.editStatus().editor, true)
  fs.rmSync(edit.editStatus().folder, { recursive: true, force: true })
})

test('motion graphics or stage layouts off go to the engine; a failed bake leaves the reel in the editor with a note', async () => {
  editorCalls.length = 0
  editorFails = true
  const { main: edit, state } = runHarness()
  await edit.startEdit({ sources: [path.join(userData, 'direction-off.mp4')] })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the review')
  const plan = edit.editStatus().plan
  const decisions = { ...shared.initialDecisions(plan), motionGraphics: false, look: { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false } }
  await edit.renderEdit(decisions)
  await waitFor(() => edit.editStatus()?.phase === 'done', 'the reel')
  const render = state.configs.find((c) => c.mode === 'render')
  assert.equal(render.editor.motion, false)
  assert.equal(render.editor.stage, false)
  assert.equal(editorCalls.length, 1)
  assert.match(edit.editStatus().warnings.join(' '), /Open it in the editor and press Bake/)
  editorFails = false
  fs.rmSync(edit.editStatus().folder, { recursive: true, force: true })
})

test('the plan\'s graphics are checked; proof stats join them without doubling; the Skills switch them', () => {
  const skills = load('shared/skills.ts')
  const base = samplePlan()
  const raw = { ...base, words: base.words.map((w) => [w.text, w.startMs, w.endMs, w.src, w.cut]),
    graphics: [
      { id: 'g-good01', template: 'stat', word: 4, duration_ms: 3000, placement: 'top', fields: { value: '3x', label: 'more' }, origin: 'auto' },
      { id: 'g-bad001', template: 'nope', word: 2, duration_ms: 3000, placement: 'top', fields: {} },
      { id: 'g-far001', template: 'title', word: 999, duration_ms: 3000, placement: 'top', fields: { text: 'x' } }
    ] }
  const plan = shared.parseEditPlan(raw, 1)
  assert.deepEqual(plain(plan.graphics.map((g) => g.id)), ['g-good01'])
  // A plan without the direction (camera + screen) has none, and no Motion graphics row.
  assert.equal(shared.parseEditPlan({ ...raw, graphics: undefined }, 1).graphics, undefined)
  const decisions = shared.initialDecisions(plan)
  const rows = skills.editSkillRows(plan, { ...decisions, look: decisions.look })
  const row = (id, list = rows) => list.find((r) => r.id === id)
  assert.equal(row('motion_graphics').on, true)
  assert.equal(row('stage_layouts').on, true)
  const off = skills.editSkillPatch(plan, { ...decisions, look: decisions.look }, 'motion_graphics', false)
  assert.deepEqual(plain(off), { decisions: { motionGraphics: false } })
  const offRows = skills.editSkillRows(plan, { ...decisions, ...off.decisions, look: decisions.look })
  assert.equal(row('stage_layouts', offRows).on, false)
  assert.match(row('stage_layouts', offRows).disabledReason, /Motion graphics first/)
  assert.equal(skills.editSkillRows({ ...plan, graphics: undefined }, { ...decisions, look: decisions.look }).some((r) => r.id === 'motion_graphics'), false)
  // The review sends them back checked; more than the reel's limit is refused.
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, showHandle: false }
  const parsed = shared.parseEditDecisions({ ...decisions, look, motionGraphics: false, stageLayouts: false }, plan)
  assert.deepEqual([parsed.motionGraphics, parsed.stageLayouts, parsed.graphics.length], [false, false, 1])
  assert.throws(() => shared.parseEditDecisions({ ...decisions, look, motionGraphics: 'yes' }, plan), /skills/)
  const many = Array.from({ length: 61 }, (_, i) => ({ ...decisions.graphics[0], id: `g-many${String(i).padStart(3, '0')}` }))
  assert.throws(() => shared.parseEditDecisions({ ...decisions, look, graphics: many }, plan), /up to 60 graphics/)
  // Changing a planned graphic's words makes it the member's (kept as typed on the reel).
  const reel = load('shared/reel-graphics.ts')
  const patched = reel.patchEditGraphic(decisions.graphics, 'g-good01', { fields: { label: 'more money' } })
  assert.equal(patched[0].origin, 'member')
  assert.equal(reel.patchEditGraphic(decisions.graphics, 'g-good01', { duration_ms: 2000 })[0].origin, 'auto')
})

test('an editor clip carries its look extras (keyword pill, accent words, progress bar, comment box), checked', () => {
  const editor = load('shared/clip-editor.ts')
  assert.deepEqual(plain(editor.parseCandidateLookExtras({ ids: ['keyword_pill', 'proof_underline', 'nope', 'comment_box'], color: '#ff5500', keyword: 'GUIDE' })),
    { ids: ['keyword_pill', 'comment_box'], color: '#FF5500', keyword: 'GUIDE' })
  for (const bad of [null, [], { ids: 'x' }, { ids: [], color: 'red' }, { ids: [], keyword: '<b>' }]) assert.throws(() => editor.parseCandidateLookExtras(bad))
  const base = { id: 'edit-reel', title: 'Reel', ranges: [[0, 5000]], scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: true, caption_preset: 'pop',
    video_speed: 1, status: 'ready', caption_edits: [], caption_suppression_ranges: [] }
  const withExtras = editor.parseCandidateEdit({ ...base, look_extras: { ids: ['accent_words'] } }, 5000, 1)
  assert.deepEqual(plain(withExtras.look_extras), { ids: ['accent_words'] })
  // Switching one changes what the bake makes (a baked clip goes back to refining).
  assert.notEqual(editor.renderEditKey(withExtras), editor.renderEditKey(editor.parseCandidateEdit(base, 5000, 1)))
})

test('the same recording keeps its last headline: sent to the plan, saved when the reel is made, unless a new one is asked for', async () => {
  const saved = new Map([['takes:' + 'a'.repeat(64), 'Most coaches undercharge']])
  const remembered = []
  const keys = []
  const hookMemory = {
    sourcesKey: async (mode, sources) => { keys.push([mode, sources.map((source) => source.path)]); return 'takes:' + 'a'.repeat(64) },
    savedHeadline: (key) => saved.get(key) ?? null,
    rememberHeadline: (key, headline, run) => remembered.push([key, headline, run]),
    rememberRunHeadline() {}
  }
  const { main: edit, state } = runHarness({ hookMemory })
  const take = path.join(userData, 'kept-take.mp4')
  await edit.startEdit({ sources: [take] })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the review')
  assert.deepEqual(plain(keys), [['takes', [take]]])
  assert.equal(state.configs.find((config) => config.mode === 'plan').fixed_hook, 'Most coaches undercharge')
  const plan = edit.editStatus().plan
  await edit.renderEdit({ ...shared.initialDecisions(plan), hookText: 'Coaches charge too little' })
  await waitFor(() => edit.editStatus()?.phase === 'done', 'the reel')
  assert.deepEqual(remembered, [['takes:' + 'a'.repeat(64), 'Coaches charge too little', path.basename(edit.editStatus().folder)]])

  // "Keep my last headline" off: the plan writes a new one.
  await edit.startEdit({ sources: [take], newHeadline: true })
  await waitFor(() => edit.editStatus()?.phase === 'review', 'the second review')
  const plans = state.configs.filter((config) => config.mode === 'plan')
  assert.equal(plans.length, 2)
  assert.equal('fixed_hook' in plans[1], false)
  await assert.rejects(edit.startEdit({ sources: [take], newHeadline: 'yes' }), /keep your last headline/)
})

test('a plan that kept (or could not keep) the last headline says so on the review', () => {
  const base = { words: [['Hi', 0, 300, 0, null], ['there', 300, 600, 0, null]], hooks: [{ id: 0, start: 0, end: 1, text: 'Hi there', why: '' }], hook: 0, cta: null, popups: [], sounds: [] }
  assert.deepEqual(plain(shared.parseEditPlan({ ...base, kept_hook: { kept: true, text: 'Hi there', fresh: 'Hello' } }, 1).keptHook), { kept: true, text: 'Hi there', fresh: 'Hello' })
  assert.deepEqual(plain(shared.parseEditPlan({ ...base, kept_hook: { kept: false, text: '', fresh: 'Hi there' } }, 1).keptHook), { kept: false, text: '', fresh: 'Hi there' })
  assert.equal(shared.parseEditPlan({ ...base, kept_hook: { kept: 'yes' } }, 1).keptHook, undefined)
  assert.equal(shared.parseEditPlan(base, 1).keptHook, undefined)
})
