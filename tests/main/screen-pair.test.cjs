const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { loadMain } = require('../zernio/support/load-main.cjs')

// Camera + screen: the start request's screen recording (and that only a file the member chose is used), the
// review's screen choices, the sync result, the layouts as editor scenes, the editor project's pair, and the chat's
// set_screen_layout ("show only my screen here").

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

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-pair-test-'))
const SETTINGS = { openrouterApiKey: 'or-key', outputDirectory: userData, pythonPath: 'python3', customVocabulary: '' }
const selected = new Set()
const engineCalls = []
const main = load('main/edit-recording.ts', {
  './brands': { brandMarkForRun: async () => null, isBrandId: (v) => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v), readBrandIdentity: async () => null },
  './ctas': { applyRunCtaInLock: async () => ({ failed: [] }), originalPath: (p) => p + '.original.mp4', withRunLock: async (_f, work) => work() },
  './graphics-render': { REEL_GRAPHICS_DIR: 'reel', graphicJob: () => null, renderGraphicJobs: async () => [] },
  './logger': { logger: { info() {}, warn() {} } },
  './member-prefs': { readMemberPrefs: () => ({ profile: { goals: [], platforms: [] } }) },
  './openrouter-media': { openRouterBase: () => 'https://openrouter.test/api/v1' },
  './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
  './remix': { parseRemixRecompose: (v) => v },
  './security': { assertMediaPath: (p) => { if (!selected.has(p)) throw new Error('Invalid media path') }, authorizeMedia: (p) => p },
  './settings-store': { loadSettings: () => SETTINGS, getSettingsForBridge: () => ({}), vocabularyTerms: () => [] },
  './tools': { resolveBinary: (name) => name },
  child_process: { ...require('node:child_process'), spawn: (...args) => { engineCalls.push(args); throw new Error('no engine in this test') } }
})
const pair = loadMain("export * from './src/shared/screen-pair'; export { parseEditorProject, parseCandidateEdit } from './src/shared/clip-editor'; export { applyChatTool, chatToolsFor, CHAT_TOOLS } from './src/shared/clip-chat'")

test('the start request takes one camera recording and a screen recording the member chose, with its offset', () => {
  const camera = path.join(userData, 'camera.mov'), screen = path.join(userData, 'screen.mov')
  selected.add(camera); selected.add(screen)
  const parsed = main.parseEditStart({ sources: [camera], brandIdentityId: null, screen: { path: screen, offsetMs: 2370 } }, userData)
  assert.deepEqual(plain(parsed.screen), { path: screen, offsetMs: 2370 })
  assert.equal(main.parseEditStart({ sources: [camera], brandIdentityId: null }, userData).screen, null)
  // Negative offsets (the screen started first) are fine; fractions and far-off ones aren't.
  assert.equal(main.parseEditStart({ sources: [camera], screen: { path: screen, offsetMs: -1500 } }, userData).screen.offsetMs, -1500)
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: { path: screen, offsetMs: 1.5 } }, userData), /Line up your screen recording again/)
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: { path: screen, offsetMs: 31 * 60_000 } }, userData), /Line up/)
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: { path: screen } }, userData), /Line up/)
})

test('the screen recording must be a video file the member chose (not any path), and not the camera file itself', () => {
  const camera = path.join(userData, 'camera.mov'), take2 = path.join(userData, 'take-2.mov')
  selected.add(camera); selected.add(take2)
  // Never chosen in the file dialog (or outside the Library): refused before anything reads it.
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: { path: '/home/someone/Desktop/private.mov', offsetMs: 0 } }, userData), /Choose your screen recording again/)
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: { path: '/etc/passwd', offsetMs: 0 } }, userData), /Choose a video for your screen recording/)
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: { path: 7, offsetMs: 0 } }, userData), /Choose a video/)
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: 'x' }, userData), /Add your screen recording again/)
  assert.throws(() => main.parseEditStart({ sources: [camera], screen: { path: camera, offsetMs: 0 } }, userData), /this one is your camera recording/)
  // One camera recording only: not with retakes, not with clips to combine.
  assert.throws(() => main.parseEditStart({ sources: [camera, take2], screen: { path: path.join(userData, 'screen.mov'), offsetMs: 0 } }, userData), /goes with one camera recording/)
  assert.throws(() => main.parseEditStart({ sources: [camera, take2], mode: 'combine', screen: { path: path.join(userData, 'screen.mov'), offsetMs: 0 } }, userData), /goes with one camera recording/)
})

test('lining up and the sync preview refuse files the member didn\'t choose before starting the engine', async () => {
  const camera = path.join(userData, 'camera.mov')
  selected.add(camera)
  await assert.rejects(main.syncScreen(camera, '/home/someone/secret.mov'), /Choose your screen recording again/)
  await assert.rejects(main.syncScreen('/x/y.mov', camera), /Choose your camera recording again/)
  await assert.rejects(main.syncScreen(camera, camera), /this one is your camera recording/)
  await assert.rejects(main.previewScreen(camera, '/tmp/other.mp4', 0, 0), /Choose your screen recording again/)
  const screen = path.join(userData, 'screen.mov')
  selected.add(screen)
  await assert.rejects(main.previewScreen(camera, screen, 0.5, 0), /Line up/)
  await assert.rejects(main.previewScreen(camera, screen, 0, -1), /moment to preview/)
  assert.equal(engineCalls.length, 0)
})

test('the review\'s screen choices are checked', () => {
  assert.deepEqual(plain(pair.parseScreenChoice({ style: 'face_top', split: 0.4567, fit: 'cover', zoom: false, auto: true })), { style: 'face_top', split: 0.46, fit: 'cover', zoom: false, auto: true })
  assert.throws(() => pair.parseScreenChoice({ ...pair.DEFAULT_SCREEN_CHOICE, style: 'face' }), /how your screen and camera/)
  assert.throws(() => pair.parseScreenChoice({ ...pair.DEFAULT_SCREEN_CHOICE, split: 0.9 }), /how much room/)
  assert.throws(() => pair.parseScreenChoice({ ...pair.DEFAULT_SCREEN_CHOICE, fit: 'stretch' }), /all of your screen/)
  assert.throws(() => pair.parseScreenChoice({ ...pair.DEFAULT_SCREEN_CHOICE, zoom: 'yes' }), /how your screen/)
  assert.throws(() => pair.parseScreenChoice(null), /how your screen/)
})

test('the sync result: by sound, by the files\' times, and where the two overlap', () => {
  const sync = pair.parseScreenSync({ offset_ms: 2370, method: 'audio', confidence: 0.9, camera_seconds: 45.2, screen_seconds: 40, screen_audio: true })
  assert.deepEqual(plain(sync), { offsetMs: 2370, method: 'audio', confidence: 0.9, cameraSeconds: 45.2, screenSeconds: 40, screenAudio: true, overlapMs: [2370, 42370] })
  assert.match(pair.syncWords(sync), /Lined up by sound: your screen recording starts 2\.37 s after your camera/)
  assert.match(pair.syncWords({ method: 'time', offsetMs: -1500 }), /by when each file was made: it starts 1\.50 s before your camera/)
  assert.equal(pair.parseScreenSync({ offset_ms: 0, method: 'guess', confidence: 1, camera_seconds: 1, screen_seconds: 1 }), null)
  assert.deepEqual(plain(pair.screenOverlap(-5000, 30, 20)), [0, 15000])
  assert.equal(pair.screenOverlap(31000, 30, 20), null)
})

const PAIR = { camera: [0, 0, 0.36, 1], screen: [0.36, 0, 0.64, 1], content: [0.36, 0.21875, 0.64, 0.5625], face: [0.1, 0.2, 0.15, 0.12], style: 'screen_top', split: 0.45, fit: 'fit' }
const FRAME = { width: 3000, height: 1920 }

test('each layout is a scene the editor can save, and reads back as the same layout', () => {
  for (const kind of pair.SCREEN_KINDS) {
    const scene = pair.screenScene(kind, 0, PAIR, FRAME)
    assert.equal(pair.screenKindOf(scene, PAIR), kind, kind)
    // Every crop stays inside the source.
    for (const [x, y, w, h] of scene.crops) assert.ok(x >= 0 && y >= 0 && x + w <= 1.000001 && y + h <= 1.000001, kind)
  }
  const top = pair.screenScene('screen_top', 0, PAIR, FRAME)
  assert.equal(top.layout, 'split'); assert.equal(top.split, 0.45)
  // Fit: the whole screen is inside the top crop; the face crop is inside the camera.
  const [sx, sy, sw, sh] = top.crops[0]
  assert.ok(sx <= 0.36 + 1e-6 && sx + sw >= 0.36 + 0.64 - 1e-6 && sy <= 0.21875 + 1e-6 && sy + sh >= 0.21875 + 0.5625 - 1e-6)
  // The top crop has the top panel's shape (1080 x 864 px).
  assert.ok(Math.abs((sw * 3000) / (sh * 1920) - 1080 / 864) < 0.01)
  const below = pair.screenScene('face_top', 0, PAIR, FRAME)
  assert.equal(below.split, 0.55)
  assert.equal(pair.screenShareOf(below, PAIR), 0.45)
  // Cover: the screen fills its panel (inside the screen itself).
  const cover = pair.screenScene('screen_top', 0, PAIR, FRAME, 0.45, 'cover')
  assert.ok(cover.crops[0][1] >= 0.21875 - 1e-6 && cover.crops[0][3] <= 0.5625 + 1e-6)
  assert.equal(pair.screenKindOf({ layout: 'fill', crops: [[0.5, 0, 0.3, 0.5]] }, PAIR), null)
})

test('the editor project keeps its camera + screen record and the inset and bubble layouts', () => {
  const scenes = [pair.screenScene('face', 0, PAIR, FRAME), pair.screenScene('screen_top', 2000, PAIR, FRAME), pair.screenScene('screen', 5000, PAIR, FRAME), pair.screenScene('bubble', 8000, PAIR, FRAME)]
  const candidate = { id: 'screen-reel', title: 'Demo', ranges: [[0, 10000]], scenes, captions: true, caption_preset: 'pop', video_speed: 1, status: 'baked', caption_edits: [], caption_suppression_ranges: [],
    caption_y: null, hook: null, score: 0, reason: '', review: null, exports: [0], library_clip: 0 }
  const project = { version: 1, revision: 0, title: 'Demo', duration_ms: 10000, width: 3000, height: 1920, aspect_ratio: '9:16', candidates: [candidate], transcript: [], pair: PAIR }
  const parsed = pair.parseEditorProject(project)
  assert.deepEqual(plain(parsed.pair), PAIR)
  assert.deepEqual(parsed.candidates[0].scenes.map((s) => s.layout), ['fill', 'split', 'inset', 'bubble'])
  assert.throws(() => pair.parseEditorProject({ ...project, pair: { ...PAIR, style: 'sideways' } }))
  // A bubble has two crops, an inset one; neither moves (no smooth movement into them).
  assert.throws(() => pair.parseCandidateEdit({ ...candidate, scenes: [{ at_ms: 0, layout: 'bubble', crops: [PAIR.content] }] }, 10000))
  assert.throws(() => pair.parseCandidateEdit({ ...candidate, scenes: [scenes[2], { ...scenes[2], at_ms: 3000, transition_ms: 600 }] }, 10000))
})

test('switching a part\'s layout: from a time to a time, the layout after it comes back', () => {
  const scenes = [pair.screenScene('screen_top', 0, PAIR, FRAME)]
  const next = pair.setScreenKind(scenes, 'screen', 3000, 6000, 10000, PAIR, FRAME)
  assert.deepEqual(next.map((s) => [s.at_ms, pair.screenKindOf(s, PAIR)]), [[0, 'screen_top'], [3000, 'screen'], [6000, 'screen_top']])
  const all = pair.setScreenKind(next, 'face', 0, null, 10000, PAIR, FRAME)
  assert.deepEqual(all.map((s) => [s.at_ms, pair.screenKindOf(s, PAIR)]), [[0, 'face']])
})

test('chat: "show only my screen here" switches that part of a camera + screen clip', () => {
  const project = { duration_ms: 10000, width: 3000, height: 1920, aspect_ratio: '9:16', transcriptCount: 0, pair: PAIR }
  const c = { id: 'screen-reel', title: 'Demo', ranges: [[0, 10000]], scenes: [pair.screenScene('screen_top', 0, PAIR, FRAME)], captions: true, caption_preset: 'pop', video_speed: 1,
    status: 'baked', caption_edits: [], caption_suppression_ranges: [], caption_y: null }
  const { step, candidate } = pair.applyChatTool(c, 'set_screen_layout', { layout: 'screen', at_ms: 4000, until_ms: 7000 }, project, () => 'x')
  assert.match(step.summary, /Layout set to Just my screen from 0:04\.0 to 0:07\.0/)
  assert.deepEqual(candidate.scenes.map((s) => [s.at_ms, s.layout]), [[0, 'split'], [4000, 'inset'], [7000, 'split']])
  const smaller = pair.applyChatTool(c, 'set_screen_layout', { layout: 'face_top', screen_share: 0.35 }, project, () => 'x').candidate
  assert.equal(smaller.scenes[0].split, 0.65)
  assert.throws(() => pair.applyChatTool(c, 'set_screen_layout', { layout: 'sideways' }, project, () => 'x'), /layout must be one of/)
  // Only for camera + screen clips; those don't get set_layout_at (its crops would show both recordings at once).
  assert.throws(() => pair.applyChatTool(c, 'set_screen_layout', { layout: 'face' }, { ...project, pair: undefined }, () => 'x'), /one video/)
  const names = (p) => pair.chatToolsFor(p).map((t) => t.name)
  assert.ok(names({ pair: PAIR }).includes('set_screen_layout') && !names({ pair: PAIR }).includes('set_layout_at'))
  assert.ok(!names({}).includes('set_screen_layout') && names({}).includes('set_layout_at'))
})

test('words said outside the screen recording are a cut reason the review can name', () => {
  const shared = load('shared/edit-recording.ts')
  assert.ok(shared.CUT_REASONS.includes('no_screen'))
  assert.equal(shared.CUT_LABELS.no_screen, 'Before or after your screen recording')
})
