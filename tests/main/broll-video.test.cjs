const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// B-roll video: the request the page sends (checked), the estimate shown before starting, which shots a pick uses,
// the title, and main's own checks (a voiceover chosen here, the run folder for a swap, the script's speech pieces).

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, Uint8Array, console, setTimeout, clearTimeout, process, DOMException, AbortSignal, AbortController, Response,
    fetch: () => { throw new Error('unexpected network call') },
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/broll-video.ts')
const LOOK = shared.defaultBrollVideoLook()
const REQUEST = {
  title: '', voice: { kind: 'recording', path: '/home/me/voice.m4a' }, broll: { all: true }, fillWithAi: false,
  look: { ...LOOK, hookText: 'I planned every day for a month' }, audio: { voiceCleanup: true, music: true, musicTrack: 'calm-pad' }, ctaId: null
}

test('the request is checked: a voiceover, a script with a known voice, or both', () => {
  const ok = shared.parseBrollVideoRequest(REQUEST)
  assert.deepEqual(plain(ok.voice), { kind: 'recording', path: '/home/me/voice.m4a' })
  assert.deepEqual(plain(ok.broll), { all: true, itemIds: [], tags: [] })
  assert.equal(ok.look.aspect, '9:16')
  assert.equal(ok.look.hookLook.hideAfterS, 5)
  const script = shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'script', script: 'First   the coffee.\r\n\r\n\r\nThen the plan.', voice: 'brian' } })
  assert.deepEqual(plain(script.voice), { kind: 'script', script: 'First the coffee.\n\nThen the plan.', voice: 'Brian' })
  assert.equal(shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'both', path: '/a/take.mov', script: 'one two three' } }).voice.kind, 'both')
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'recording', path: '' } }), /Choose your voiceover first/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'recording', path: '/a/notes.txt' } }), /audio or video file/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'script', script: 'hi there', voice: 'Brian' } }), /few more words/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'script', script: 'word '.repeat(600), voice: 'Brian' } }), /under 2,500/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'script', script: 'one two three', voice: 'Somebody Famous' } }), /Choose a voice/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, voice: { kind: 'tts' } }), /Choose your voiceover, or write a script/)
  assert.throws(() => shared.parseBrollVideoRequest(null), /Choose your voiceover/)
})

test('the b-roll pick, the look and the extras are checked', () => {
  const picked = shared.parseBrollVideoRequest({ ...REQUEST, broll: { all: false, itemIds: ['l0123456789ab', 'l0123456789ab', 'bad', 'l0123456789ab:s2'], tags: ['Coffee', 3] } })
  assert.deepEqual(plain(picked.broll), { all: false, itemIds: ['l0123456789ab', 'l0123456789ab:s2'], tags: ['coffee'] })
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, broll: { all: false, itemIds: [], tags: [] } }), /Pick some b-roll/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, look: { ...LOOK, aspect: '1:1' } }), /9:16 or 16:9/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, look: { ...LOOK, captionPreset: 'nope' } }), /caption style/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, look: { ...LOOK, graphics: 'yes' } }), /look settings/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, look: { ...LOOK, hookLook: { look: 'neon' } } }), /hook text’s look/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, look: { ...LOOK, hookText: 'x'.repeat(121) } }), /under 120/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, fillWithAi: 'on' }), /AI shots/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, audio: { music: true } }), /music/)
  assert.throws(() => shared.parseBrollVideoRequest({ ...REQUEST, ctaId: 'x' }), /call to action/)
  const wide = shared.parseBrollVideoRequest({ ...REQUEST, look: { ...LOOK, aspect: '16:9', crossfade: true, captions: false } })
  assert.equal(wide.look.aspect, '16:9'); assert.equal(wide.look.crossfade, true); assert.equal(wide.look.captions, false)
})

test('the estimate: word timings, the plan, a script’s voice and at most the AI shots allowed', () => {
  const recording = shared.estimateBrollVideo(shared.parseBrollVideoRequest(REQUEST), 45, null)
  assert.equal(recording.voiceUsd, 0)
  assert.ok(Math.abs(recording.transcribeUsd - 45 * 0.000061) < 1e-9)
  assert.equal(recording.planUsd, 0.01)
  assert.equal(recording.aiShots, 0)
  assert.match(shared.estimateLine(recording), /^On your OpenRouter key: listening for word timings under 1¢, planning the shots and graphics about \$0\.01\. Putting the video together is free\.$/)
  const script = shared.parseBrollVideoRequest({ ...REQUEST, fillWithAi: true, voice: { kind: 'script', script: 'word '.repeat(200), voice: 'Brian' } })
  const ai = { kind: 'image', model: 'x-ai/grok-imagine-video-1.5-lite', maxShots: 2 }
  const withAi = shared.estimateBrollVideo(script, shared.scriptSeconds(script.voice.script), ai)
  assert.ok(withAi.voiceUsd > 0)
  assert.equal(withAi.aiShots, 2)
  assert.equal(withAi.aiUsd, 0.16)
  assert.ok(withAi.totalUsd > 0.17)
  assert.match(shared.estimateLine(withAi), /voicing your script about \$0\.\d\d, .*up to 2 AI shots at most \$0\.16/)
  // AI off: none counted even with settings.
  assert.equal(shared.estimateBrollVideo({ ...script, fillWithAi: false }, 30, ai).aiShots, 0)
  assert.equal(shared.shotsNeeded(45), 17)
})

test('a pick uses the shots of the picked clips and tags; the title falls back to the hook, then the words', () => {
  const catalog = [{ id: 'l000000000001:s0', tags: ['coffee'] }, { id: 'l000000000001:s1', tags: ['kitchen'] }, { id: 'l000000000002:s0', tags: ['Laptop', 'desk'] }, { id: 'l000000000003:s0', tags: [] }]
  assert.deepEqual(shared.pickedShots(catalog, { all: true, itemIds: [], tags: [] }).length, 4)
  assert.deepEqual(shared.pickedShots(catalog, { all: false, itemIds: ['l000000000001'], tags: ['laptop'] }), ['l000000000001:s0', 'l000000000001:s1', 'l000000000002:s0'])
  assert.deepEqual(shared.pickedShots(catalog, { all: false, itemIds: ['l000000000003:s0'], tags: [] }), ['l000000000003:s0'])
  const request = shared.parseBrollVideoRequest(REQUEST)
  assert.equal(shared.brollVideoTitle(request), 'I planned every day for a month')
  assert.equal(shared.brollVideoTitle({ ...request, title: 'Morning plan' }), 'Morning plan')
  assert.equal(shared.brollVideoTitle({ ...request, look: { ...request.look, hookText: '' } }, 'now I cannot stress this enough I am a virtual nobody when'), 'now I cannot stress this enough I am a virtual')
  assert.equal(shared.brollVideoTitle({ ...request, look: { ...request.look, hookText: '' } }), 'B-roll video')
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadMain(outputDirectory, overrides = {}) {
  const calls = { engine: [], editor: [] }
  const mocks = {
    electron: { app: { getPath: () => path.join(outputDirectory, '..', 'user-data'), isPackaged: false } },
    './broll-library': { brollAiSettings: () => ({ kind: 'video', model: 'x-ai/grok-imagine-video-1.5-lite', maxShots: 2 }), brollRunFields: () => ({ fields: {} }),
      libraryCatalog: async () => overrides.catalog ?? { version: 1, shots: [] }, writeRunCatalog: async () => null },
    './ctas': { readCta: () => ({}), parseCtaChoice: load('shared/ctas.ts').parseCtaChoice },
    './clip-editor': { cancelEditor: () => undefined, runEditor: async (...args) => { calls.editor.push(args) }, withEditorPreparation: async () => undefined },
    // Main's and shared's './edit-recording' share one mock here: the shared constants, main's transcription stood in.
    './edit-recording': { ...load('shared/edit-recording.ts'), ScribeUnavailable: class extends Error {}, transcribeWithScribe: async () => ({ words: [], costUsd: 0 }) },
    './logger': { logger: { info() {}, warn() {}, error() {} } },
    './music': { audioForEngine: () => undefined, parseAudioChoice: load('shared/music.ts').parseAudioChoice },
    './openrouter-media': { synthesizeSpeech: async () => new Uint8Array(10) },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x/engine', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { authorizeMedia: (p) => p },
    './settings-store': { getSettingsForBridge: () => ({}), loadSettings: () => ({ outputDirectory, openrouterApiKey: overrides.key ?? 'sk-test', customVocabulary: '', pythonPath: '' }), vocabularyTerms: () => [] },
    './tools': { resolveBinary: (name) => name }
  }
  return { main: load('main/broll-video.ts', mocks), calls }
}

test('main: a voiceover must have been chosen here; the key comes first; an empty library is refused', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broll-video-test-'))
  const library = path.join(root, 'library')
  fs.mkdirSync(library)
  const file = path.join(root, 'voice.m4a')
  fs.writeFileSync(file, 'not really audio')
  try {
    const { main } = loadMain(library)
    await assert.rejects(main.startBrollVideo({ ...REQUEST, voice: { kind: 'recording', path: file } }), /Choose your voiceover again/)
    await assert.rejects(main.startBrollVideo({ ...REQUEST, voice: { kind: 'recording', path: path.join(root, 'gone.m4a') } }), /was moved/)
    const noKey = loadMain(library, { key: '' }).main
    await assert.rejects(noKey.startBrollVideo(REQUEST), /Add your OpenRouter key/)
    await assert.rejects(main.startBrollVideo({ ...REQUEST, voice: { kind: 'script', script: 'one two three four', voice: 'Brian' } }), /no shots ready/)
    const picky = loadMain(library, { catalog: { version: 1, shots: [{ id: 'l000000000001:s0', tags: ['coffee'] }] } }).main
    await assert.rejects(picky.startBrollVideo({ ...REQUEST, voice: { kind: 'script', script: 'one two three four', voice: 'Brian' }, broll: { all: false, itemIds: [], tags: ['laptop'] } }), /None of the b-roll you picked/)
    // Nothing was made.
    assert.deepEqual(fs.readdirSync(library), [])
    // The spending check is always an estimate (word timings and the plan at least).
    const check = main.brollVideoSpendCheck(REQUEST)
    assert.ok(check >= 0.01, String(check))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('main: only a b-roll video run in the output folder can have its shots swapped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broll-video-test-'))
  const library = path.join(root, 'library')
  fs.mkdirSync(library)
  const run = path.join(library, 'broll-video-12345678-1234-1234-1234-123456789abc')
  fs.mkdirSync(run)
  fs.writeFileSync(path.join(run, 'broll-plan.json'), JSON.stringify({ shots: [{ slot: 0, start_ms: 0, end_ms: 2400, shot_id: 'l000000000001:s0', words: 'hello', reused: false },
    { slot: 1, start_ms: 2400, end_ms: 5000, shot_id: null, ai_prompt: 'A rocket', words: 'there' }, { slot: 'x' }] }))
  try {
    const { main } = loadMain(library)
    assert.deepEqual(plain(await main.brollVideoShots(run)), [
      { slot: 0, startMs: 0, endMs: 2400, shotId: 'l000000000001:s0', ai: false, reused: false, words: 'hello' },
      { slot: 1, startMs: 2400, endMs: 5000, shotId: null, ai: true, reused: false, words: 'there' }])
    await assert.rejects(main.brollVideoShots(path.join(library, 'edit-12345678-1234-1234-1234-123456789abc')), /Only b-roll videos/)
    await assert.rejects(main.brollVideoShots(path.join(root, 'broll-video-12345678-1234-1234-1234-123456789abc')), /Only b-roll videos/)
    await assert.rejects(main.swapBrollShot(run, -1, null), /Choose a shot to swap/)
    await assert.rejects(main.swapBrollShot(run, 0, '../etc'), /Choose a shot from your library/)
    assert.equal(main.isBrollVideoRun(run), true)
    assert.equal(main.brollVideoRunBusy(run), null)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('main: a script is voiced in pieces at sentence ends, and its distinctive words help the transcription', () => {
  const { main } = loadMain(os.tmpdir())
  const script = `${'This is a sentence. '.repeat(60)}And a last one!`
  const chunks = main.speechChunks(script, 200)
  assert.ok(chunks.length > 5)
  assert.ok(chunks.every((chunk) => chunk.length <= 200 && /[.!]$/.test(chunk)), plain(chunks))
  assert.equal(chunks.join(' '), script.replace(/\s+/g, ' ').trim())
  const long = main.speechChunks(`${'word '.repeat(100)}end.`, 60)
  assert.ok(long.every((chunk) => chunk.length <= 60))
  assert.deepEqual(plain(main.scriptKeyterms('I use CreatorClips and OpenRouter every day, with my productivity system. creatorclips again.')), ['CreatorClips', 'OpenRouter', 'productivity'])
})

test('the run is a B-roll video in the Library: not a Create run, kept in the metrics', () => {
  const output = load('shared/job-output.ts')
  const parsed = output.parseJobOutput({ job_id: 'broll-video-x', source_video_url: '', source_video_title: 'B-roll video · Hi', total_clips: 0, clips: [], editor_project: true,
    metrics: { broll_video: true, broll_video_shots: 12 } })
  assert.equal(parsed.metrics.broll_video, true)
  assert.equal(parsed.editor_project, true)
  const plan = load('shared/daily-plan.ts')
  assert.equal(plan.planKindOf({ madeWith: 'broll', status: 'completed', date: '', finishedAt: null, outputDir: '', videoTitle: '' }), 'talking')
})

test('the library catalog marks shots with words written on them (kept from under hook text)', () => {
  const library = load('shared/broll-library.ts')
  const analysis = (onScreenText) => ({ description: 'A shot', tags: [], subjects: [], setting: '', shotType: 'screen', motion: 'slow', mood: '', memberAppears: false, onScreenText, quality: '', model: 'm', analyzedAt: '2026-10-20T10:00:00Z' })
  const item = (id, text) => ({ id, kind: 'video', name: id, original: `/f/${id}.mp4`, proxy: null, poster: null, durationS: 4, width: 1, height: 1, size: 1, mtimeMs: 1, addedAt: '2026-10-20T10:00:00Z',
    origin: 'member', tags: [], me: false, status: 'ready', shots: [{ id: 's0', inS: 0, outS: 4, analysis: analysis(text) }] })
  const catalog = library.buildCatalog([item('l000000000001', 'Total earnings $8,188'), item('l000000000002', '')], (entry) => entry.original)
  assert.deepEqual(plain(catalog.shots.map((shot) => shot.text === true)), [true, false])
})
