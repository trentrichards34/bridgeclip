const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

/** Load a src module in a sandbox; `mocks` replaces imports by specifier. */
function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, DOMException, AbortSignal, AbortController, Response,
    fetch: () => { throw new Error('unexpected network call') },
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/avatars.ts')
const SETTINGS = { openrouterApiKey: 'or-key', falApiKey: 'fal-key', outputDirectory: os.tmpdir(), pythonPath: 'python3' }
const settingsStub = { loadSettings: () => SETTINGS, getSettingsForBridge: () => ({}) }

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

test('scripts are validated: narration required, cinematic shots described, about a minute max', () => {
  const ok = shared.parseAvatarScript({ title: '  Stop  wasting money ', scenes: [{ narration: 'Hook line. Payoff line.', visual: '', featuresAvatar: true }] }, 'talking')
  assert.deepEqual(plain(ok), { title: 'Stop wasting money', scenes: [{ narration: 'Hook line. Payoff line.', visual: '', featuresAvatar: true }] })
  assert.throws(() => shared.parseAvatarScript({ title: '', scenes: [] }, 'talking'), /Write a script/)
  assert.throws(() => shared.parseAvatarScript({ title: '', scenes: [{ narration: '  ' }] }, 'talking'), /no narration/)
  assert.throws(() => shared.parseAvatarScript({ title: '', scenes: [{ narration: 'Hi there', visual: '' }] }, 'cinematic'), /Describe what scene 1 shows/)
  assert.throws(() => shared.parseAvatarScript({ title: 'x'.repeat(81), scenes: [{ narration: 'Hi' }] }, 'talking'), /80 characters/)
  const long = Array.from({ length: 170 }, () => 'word').join(' ')
  assert.throws(() => shared.parseAvatarScript({ title: '', scenes: [{ narration: long }] }, 'talking'), /about a minute/)
  assert.throws(() => shared.parseAvatarScript({ title: '', scenes: Array.from({ length: 9 }, () => ({ narration: 'a', visual: 'b' })) }, 'cinematic'), /at most 8/)
})

test('voices are preset names or cloned ids; anything else is rejected', () => {
  assert.deepEqual(plain(shared.parseVoice({ provider: 'elevenlabs', voice: 'Brian' })), { provider: 'elevenlabs', voice: 'Brian' })
  assert.throws(() => shared.parseVoice({ provider: 'elevenlabs', voice: 'Taylor Swift' }), /Choose a voice/)
  assert.throws(() => shared.parseVoice({ provider: 'minimax-clone', voiceId: '../x', clonedAt: 'now' }), /Choose a voice/)
  assert.equal(shared.parseVoice({ provider: 'minimax-clone', voiceId: 'voice_123', clonedAt: '2026-10-13' }).voiceId, 'voice_123')
})

test('scene lengths follow the narration and stay within what the video model renders', () => {
  const scenes = [{ narration: 'one two three' }, { narration: Array.from({ length: 60 }, () => 'w').join(' ') }, { narration: 'a' }]
  const durations = plain(shared.sceneDurations(scenes, 30))
  assert.deepEqual(durations, [3, 10, 3])
})

test('estimated word timings are ordered, non-overlapping and fit the audio', () => {
  const timings = plain(shared.estimateWordTimings('Stop. Doing this, now please!', 4000))
  assert.equal(timings.length, 5)
  for (let i = 0; i < timings.length; i++) {
    assert.ok(timings[i].endMs > timings[i].startMs)
    if (i) assert.ok(timings[i].startMs >= timings[i - 1].endMs)
  }
  assert.ok(timings.at(-1).endMs <= 4000)
  assert.deepEqual(plain(shared.estimateWordTimings('', 4000)), [])
})

test('cost estimates use the listed per-second prices', () => {
  const script = { title: '', scenes: [{ narration: Array.from({ length: 52 }, () => 'word').join(' '), visual: 'x', featuresAvatar: true }] }
  // 52 words ≈ 20s; 259 characters of text.
  assert.equal(shared.estimateRenderCost({ style: 'talking', lipSync: 'fabric', script }), Math.round((0.0259 + 20 * 0.15) * 100) / 100)
  assert.ok(shared.estimateRenderCost({ style: 'cinematic', lipSync: 'fabric', script }) > 0.08)
})

test('render folders are safe names', () => {
  const name = shared.renderFolderName('Stop: buying ../coffee?!', new Date(2026, 9, 13, 9, 5, 7))
  assert.equal(name, '2026-10-13 090507 Stop buying coffee')
  assert.equal(shared.renderFolderName('', new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02 030405')
})

// ---------------------------------------------------------------------------
// fal client
// ---------------------------------------------------------------------------

const fal = load('main/fal.ts')
const Q = 'https://queue.fal.run/fal-ai/x/requests/abc'

test('falRun submits, polls and returns the result through fal’s own URLs', async () => {
  const calls = []
  const responses = [
    jsonResponse({ request_id: 'abc', status_url: `${Q}/status`, response_url: Q, cancel_url: `${Q}/cancel` }),
    jsonResponse({ status: 'IN_QUEUE', queue_position: 0 }),
    jsonResponse({ status: 'COMPLETED' }),
    jsonResponse({ video: { url: 'https://v3.fal.media/files/out.mp4' } })
  ]
  const statuses = []
  const result = await fal.falRun('fal-ai/x/y', { prompt: 'p' }, {
    key: 'secret', pollMs: 1, onStatus: (s) => statuses.push(s),
    fetch: async (url, init) => { calls.push({ url, init }); return responses.shift() }
  })
  assert.equal(calls[0].url, 'https://queue.fal.run/fal-ai/x/y')
  assert.equal(calls[0].init.headers.Authorization, 'Key secret')
  assert.deepEqual(JSON.parse(calls[0].init.body), { prompt: 'p' })
  assert.deepEqual(calls.slice(1).map((c) => c.url), [`${Q}/status`, `${Q}/status`, Q])
  assert.deepEqual(statuses, ['In queue (position 1)'])
  assert.equal(fal.falFileUrl(result, 'video'), 'https://v3.fal.media/files/out.mp4')
})

test('fal errors become fixed, user-facing messages', async () => {
  const run = (response) => fal.falRun('fal-ai/x', {}, { key: 'k', fetch: async () => response })
  await assert.rejects(run(new Response('nope', { status: 401 })), /rejected the API key/)
  await assert.rejects(run(new Response('{"detail":"User is locked. Reason: Exhausted balance."}', { status: 403 })), /balance is empty/)
  await assert.rejects(run(jsonResponse({ detail: [{ msg: 'Audio longer than 60s' }] }, 422)), /Audio longer than 60s/)
  await assert.rejects(run(jsonResponse({ detail: [{ msg: 'content policy violation' }] }, 422)), /content rules/)
  await assert.rejects(run(jsonResponse({ status_url: 'https://evil.example/status', response_url: Q })), /unexpected response/)
  await assert.rejects(fal.falRun('../../etc', {}, { key: 'k', fetch: async () => jsonResponse({}) }), /Invalid fal.ai model/)
})

test('aborting a queued request cancels it on fal', async () => {
  const controller = new AbortController()
  const calls = []
  const responses = [jsonResponse({ status_url: `${Q}/status`, response_url: Q, cancel_url: `${Q}/cancel` }), jsonResponse({ status: 'IN_PROGRESS' })]
  const pending = fal.falRun('fal-ai/x', {}, { key: 'k', pollMs: 50, signal: controller.signal, fetch: async (url, init) => { calls.push([url, init?.method]); return responses.shift() ?? jsonResponse({}) } })
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(pending, (error) => error.name === 'AbortError')
  assert.deepEqual(calls.at(-1), [`${Q}/cancel`, 'PUT'])
})

test('results are only accepted from fal hosts; small inputs go inline', async () => {
  assert.equal(fal.isFalResultUrl('https://v3.fal.media/a.mp4'), true)
  assert.equal(fal.isFalResultUrl('https://fal.media/a.png'), true)
  assert.equal(fal.isFalResultUrl('http://v3.fal.media/a.mp4'), false)
  assert.equal(fal.isFalResultUrl('https://fal.media.evil.com/a.mp4'), false)
  assert.equal(fal.isFalResultUrl('https://user:pw@fal.media/a.mp4'), false)
  assert.throws(() => fal.falFileUrl({ images: [{ url: 'https://evil.com/x.png' }] }, 'images'), /no usable file/)
  const url = await fal.falInputUrl(Buffer.from('hi'), 'image/jpeg', 'a.jpg', { key: 'k', fetch: async () => { throw new Error('no upload for small files') } })
  assert.equal(url, 'data:image/jpeg;base64,aGk=')
})

// ---------------------------------------------------------------------------
// Studio: scripts, requests and scene assembly
// ---------------------------------------------------------------------------

function loadStudio(overrides = {}) {
  return load('main/avatar-studio.ts', {
    electron: { app: { isPackaged: true } },
    './avatars': { portraitInput: async () => 'data:', readAvatar: () => ({}) },
    './backgrounds': { resolveBackground: (name) => `/library/${name}` },
    './logger': { logger: { warn() {}, info() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/b/bridge_runner.py', getEnginePath: () => '/engine', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}) },
    './settings-store': settingsStub,
    './tools': { resolveBinary: (name) => name },
    ...overrides
  })
}

test('render requests are validated before any paid call', () => {
  const studio = loadStudio()
  const base = { avatarId: 'abcdef1234567890', style: 'talking', captionPreset: 'beast', script: { title: 'Hook', scenes: [{ narration: 'Say this.' }] } }
  assert.equal(studio.parseRenderRequest(base).lipSync, 'fabric')
  assert.throws(() => studio.parseRenderRequest({ ...base, avatarId: '../x' }), /Choose an avatar/)
  assert.throws(() => studio.parseRenderRequest({ ...base, captionPreset: 'nope' }), /caption style/)
  assert.throws(() => studio.parseRenderRequest({ ...base, style: 'cinematic', backgroundVideo: 'game.mp4', script: { title: '', scenes: [{ narration: 'a', visual: 'b' }] } }), /talking-head videos only/)
  assert.throws(() => studio.parseRenderRequest({ ...base, backgroundVideo: '../game.mp4' }), /talking-head videos only/)
  assert.equal(studio.parseRenderRequest({ ...base, backgroundVideo: 'game.mp4' }).backgroundVideo, 'game.mp4')
})

test('the script writer sends the playbook with a strict schema and returns a validated script', async () => {
  let sent
  const studio = loadStudio()
  const content = { title: 'Stop wasting money', scenes: [{ narration: 'You are losing money.', visual: 'x', featuresAvatar: true }, { narration: 'Here is the fix.', visual: 'y', featuresAvatar: false }] }
  const script = await studio.writeAvatarScript({ topic: 'saving money', niche: '', seconds: 30, style: 'talking' }, async (url, init) => {
    sent = { url, init }
    return jsonResponse({ choices: [{ message: { content: JSON.stringify(content) } }] })
  })
  assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions')
  const body = JSON.parse(sent.init.body)
  assert.equal(body.response_format.json_schema.strict, true)
  assert.match(body.messages[0].content, /HOOK -> PROMISE -> PAYOFF/)
  assert.match(body.messages[0].content, /Never invent statistics/)
  assert.equal(JSON.parse(body.messages[1].content).scenes, 1)
  // Talking-head scripts collapse to one narration.
  assert.deepEqual(plain(script), { title: 'Stop wasting money', scenes: [{ narration: 'You are losing money. Here is the fix.', visual: '', featuresAvatar: true }] })
  await assert.rejects(studio.writeAvatarScript({ topic: 'x', niche: '', seconds: 30, style: 'talking' }), /3-500 characters/)
  await assert.rejects(studio.writeAvatarScript({ topic: 'saving money', niche: '', seconds: 31, style: 'talking' }), /video length/)
  await assert.rejects(studio.writeAvatarScript({ topic: 'saving money', niche: '', seconds: 30, style: 'talking' }, async () => new Response('', { status: 402 })), /insufficient credits/)
})

test('scene prompts keep the avatar’s identity and keep faceless shots faceless', () => {
  const studio = loadStudio()
  assert.match(studio.scenePrompt({ visual: 'At a desk.', featuresAvatar: true }), /same person from the reference photo/)
  assert.doesNotMatch(studio.scenePrompt({ visual: 'A city at night.', featuresAvatar: false }), /reference photo/)
  assert.equal(studio.scriptSceneCount(60, 'cinematic'), 6)
  assert.equal(studio.scriptSceneCount(15, 'cinematic'), 2)
  assert.equal(studio.scriptSceneCount(45, 'talking'), 1)
})

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('scenes are cut to the narration and joined into one 1080x1920 video', { skip: !hasFfmpeg && 'ffmpeg not installed' }, () => {
  const studio = loadStudio()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-scenes-'))
  const clip = (name, size, seconds) => { const file = path.join(dir, name); execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24`, '-t', String(seconds), '-pix_fmt', 'yuv420p', file]); return file }
  const clips = [clip('a.mp4', '720x1280', 3), clip('b.mp4', '1280x720', 5), clip('c.mp4', '540x960', 3)]
  const narration = path.join(dir, 'n.m4a')
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300', '-t', '9.5', narration])
  const scenes = [{ narration: 'one two' }, { narration: 'three four five six seven eight' }, { narration: 'nine ten' }]
  const shares = plain(studio.narrationShares(scenes, 9.5))
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 9.5) < 1e-9)
  const out = path.join(dir, 'out.mp4')
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...clips.flatMap((c) => ['-i', c]), '-i', narration, '-filter_complex', studio.sceneFilter(shares),
    '-map', '[v]', '-map', '3:a:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out])
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out], { encoding: 'utf8' })
  const info = JSON.parse(probe)
  assert.equal(info.streams[0].width, 1080)
  assert.equal(info.streams[0].height, 1920)
  // Scene b's share (~5.7s) is longer than its 5s clip: its last frame holds instead of cutting the narration short.
  assert.ok(Math.abs(Number(info.format.duration) - 9.5) < 0.2, info.format.duration)
})

// ---------------------------------------------------------------------------
// Avatar library
// ---------------------------------------------------------------------------

function loadLibrary(userData) {
  const image = { isEmpty: () => false, getSize: () => ({ width: 900, height: 1600 }), resize: () => image, toJPEG: () => Buffer.from('jpeg') }
  return load('main/avatars.ts', {
    electron: { app: { getPath: () => userData }, nativeImage: { createFromBuffer: (bytes) => bytes.length ? image : { isEmpty: () => true } } },
    './security': { authorizeMedia: (p) => p },
    './settings-store': settingsStub,
    './tools': { resolveBinary: (name) => name },
    './fal': { falRun: async () => { throw new Error('no network in tests') }, falFileUrl: () => '', falInputUrl: async () => 'data:', downloadFalFile: async () => {}, FalError: Error }
  })
}

test('avatars need consent for a real likeness and must otherwise be fictional', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-avatars-'))
  const lib = loadLibrary(userData)
  const photo = path.join(userData, 'me.jpg')
  fs.writeFileSync(photo, 'photo-bytes')
  const draft = await lib.draftFromPhoto(photo)
  assert.match(draft.draftId, /^[a-f0-9]{16}$/)
  const voice = { provider: 'elevenlabs', voice: 'Brian' }
  await assert.rejects(lib.createAvatar({ draftId: draft.draftId, name: 'Me', kind: 'self', description: '', voice, consent: false }), /Confirm this is you/)
  await assert.rejects(lib.createAvatar({ draftId: '../../x', name: 'Me', kind: 'self', voice, consent: true }), /Choose a photo/)
  await assert.rejects(lib.createAvatar({ draftId: draft.draftId, name: 'Fake', kind: 'ai', description: 'looks like a famous actor', voice }), /must be fictional/)
  await assert.rejects(lib.draftsFromDescription('A celebrity lookalike with red hair'), /must be fictional/)
  await assert.rejects(lib.draftFromPhoto(path.join(userData, 'notes.txt')), /JPG or PNG/)

  const list = plain(await lib.createAvatar({ draftId: draft.draftId, name: '  Me  ', kind: 'self', description: '', voice, consent: true }))
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'Me')
  assert.equal(list[0].kind, 'self')
  assert.ok(list[0].consentAt)
  assert.ok(fs.existsSync(list[0].portraitPath))

  const id = list[0].id
  assert.equal(plain(await lib.updateAvatar(id, { voice: { provider: 'elevenlabs', voice: 'Sarah' } }))[0].voice.voice, 'Sarah')
  // A cloned voice id can only come from cloning, never from the renderer.
  await assert.rejects(lib.updateAvatar(id, { voice: { provider: 'minimax-clone', voiceId: 'someone_elses', clonedAt: 'x' } }), /Clone a voice/)
  await assert.rejects(lib.cloneVoice(id, photo, false), /Confirm this is your voice/)
  await assert.rejects(lib.updateAvatar('../escape', { name: 'x' }), /Invalid avatar/)
  assert.deepEqual(plain(await lib.removeAvatar(id)), [])
})
