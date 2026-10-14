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

test('voices are OpenRouter presets (any case, retired ones mapped) or the avatar clone; anything else is rejected', () => {
  assert.deepEqual(plain(shared.parseVoice({ provider: 'elevenlabs', voice: 'Brian' })), { provider: 'elevenlabs', voice: 'Brian' })
  assert.deepEqual(plain(shared.parseVoice({ provider: 'elevenlabs', voice: 'harry' })), { provider: 'elevenlabs', voice: 'Harry' })
  // Voices fal offered that OpenRouter doesn't move to the closest match.
  assert.equal(shared.parseVoice({ provider: 'elevenlabs', voice: 'Aria' }).voice, 'Bella')
  assert.equal(shared.parseVoice({ provider: 'elevenlabs', voice: 'Charlotte' }).voice, 'Alice')
  assert.deepEqual(plain(shared.parseVoice({ provider: 'clone', clonedAt: '2026-10-14' })), { provider: 'clone', clonedAt: '2026-10-14' })
  assert.throws(() => shared.parseVoice({ provider: 'elevenlabs', voice: 'Taylor Swift' }), /Choose a voice/)
  assert.throws(() => shared.parseVoice({ provider: 'minimax-clone', voiceId: 'voice_123', clonedAt: 'now' }), /Choose a voice/)
  // Every preset is one OpenRouter lists for ElevenLabs v3.
  const listed = ['george', 'sarah', 'adam', 'alice', 'bella', 'bill', 'brian', 'callum', 'charlie', 'chris', 'daniel', 'eric', 'harry', 'jessica', 'laura', 'liam', 'lily', 'matilda', 'river', 'roger', 'will']
  for (const id of shared.PRESET_VOICE_IDS) assert.ok(listed.includes(id.toLowerCase()), id)
})

test('scene lengths follow the narration and stay within what the video model renders', () => {
  const scenes = [{ narration: 'one two three' }, { narration: Array.from({ length: 60 }, () => 'w').join(' ') }, { narration: 'a' }]
  const durations = plain(shared.sceneDurations(scenes, 30))
  assert.deepEqual(durations, [3, 15, 3])
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
  // 259 characters of text at ElevenLabs v3's $0.08/1k; the talking head itself (photo + voice) is made locally.
  assert.equal(shared.estimateRenderCost({ style: 'talking', script }), Math.round(0.259 * 0.08 * 100) / 100)
  assert.ok(shared.estimateRenderCost({ style: 'cinematic', script }) > 0.08)
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
    './pipeline-runner': { getBridgeRunnerPath: () => '/b/bridge_runner.py', getEnginePath: () => '/engine', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './settings-store': settingsStub,
    './tools': { resolveBinary: (name) => name },
    ...overrides
  })
}

test('render requests are validated before any paid call', () => {
  const studio = loadStudio()
  const base = { avatarId: 'abcdef1234567890', style: 'talking', captionPreset: 'beast', script: { title: 'Hook', scenes: [{ narration: 'Say this.' }] } }
  assert.equal(studio.parseRenderRequest(base).lipSync, 'avatar-iv')
  assert.equal(studio.parseRenderRequest({ ...base, lipSync: 'omnihuman' }).lipSync, 'avatar-iv')
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
    './fal': { falInputUrl: async () => 'data:' },
    './logger': { logger: { warn() {}, info() {} } },
    './openrouter-media': mediaStub()
  })
}

class OpenRouterMediaError extends Error {}
function mediaStub(overrides = {}) {
  return {
    OpenRouterMediaError, openRouterBase: () => 'https://openrouter.test/api/v1',
    generateImage: async () => { throw new Error('no network in tests') },
    synthesizeSpeech: async () => { throw new Error('no network in tests') },
    ...overrides
  }
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
  // A cloned voice can only come from cloning, never from the renderer.
  await assert.rejects(lib.updateAvatar(id, { voice: { provider: 'clone', clonedAt: 'x' } }), /Clone a voice/)
  await assert.rejects(lib.cloneVoice(id, photo, false), /Confirm this is your voice/)
  await assert.rejects(lib.updateAvatar('../escape', { name: 'x' }), /Invalid avatar/)
  assert.deepEqual(plain(await lib.removeAvatar(id)), [])
})

// ---------------------------------------------------------------------------
// Review fixes: failure containment, timing, orientation, safe messages
// ---------------------------------------------------------------------------

test('a failed scene stops new scenes from starting and aborts the rest', async () => {
  const studio = loadStudio()
  const controller = new AbortController()
  const started = []
  const pending = studio.pool([0, 1, 2, 3, 4, 5], 2, controller, async (item) => {
    started.push(item)
    if (item === 1) throw new Error('content blocked')
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 50)
      controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) })
    })
  })
  await assert.rejects(pending, /content blocked/)
  assert.ok(controller.signal.aborted)
  assert.deepEqual(started, [0, 1])
})

test('caption timing skips silent lead-in and tail in the narration', () => {
  const studio = loadStudio()
  const log = 'silence_start: 0\nsilence_end: 0.42 | silence_duration: 0.42\nsilence_start: 3.1\nsilence_end: 3.5\nsilence_start: 9.65\nsilence_end: 10.0 | silence_duration: 0.35'
  assert.deepEqual(plain(studio.parseSpeechBounds(log, 10_000)), { startMs: 420, endMs: 9650 })
  assert.deepEqual(plain(studio.parseSpeechBounds('silence_start: 0.000\n', 10_000)), { startMs: 0, endMs: 10_000 })
  assert.deepEqual(plain(studio.parseSpeechBounds('', 8000)), { startMs: 0, endMs: 8000 })
})

test('render errors never show local paths', () => {
  const studio = loadStudio()
  assert.equal(studio.renderErrorMessage(new Error('Your fal.ai balance is empty. Add credits at fal.ai/dashboard/billing, then try again.')), 'Your fal.ai balance is empty. Add credits at fal.ai/dashboard/billing, then try again.')
  const enoent = Object.assign(new Error("ENOENT: no such file, open '/Users/trent/Library/x/portrait.jpg'"), { code: 'ENOENT' })
  assert.doesNotMatch(studio.renderErrorMessage(enoent), /Users/)
  assert.match(studio.renderErrorMessage(Object.assign(new Error('x'), { code: 'ENOSPC' })), /disk is full/)
  assert.equal(studio.renderErrorMessage(new DOMException('Aborted', 'AbortError')), 'Generation failed. Try again.')
})

test('over-long drafts from the writer stay editable; rendering still enforces the limit', () => {
  const long = Array.from({ length: 175 }, () => 'word').join(' ')
  const script = shared.parseAvatarScript({ title: 'Hook', scenes: [{ narration: long }] }, 'talking', true)
  assert.equal(shared.wordCount(shared.scriptText(script)), 175)
  assert.throws(() => shared.parseAvatarScript(script, 'talking'), /about a minute/)
})

test('downloads only follow redirects that stay on fal hosts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dl-'))
  const seen = []
  const redirect = (to) => new Response(null, { status: 302, headers: { location: to } })
  await assert.rejects(fal.downloadFalFile('https://v3.fal.media/a.mp4', path.join(dir, 'a.mp4'), {
    fetch: async (url, init) => { seen.push([url, init.redirect]); return redirect('http://169.254.169.254/latest') }
  }), /unexpected host/)
  assert.deepEqual(seen, [['https://v3.fal.media/a.mp4', 'manual']])
  const hops = [redirect('https://cdn.fal.media/b.mp4'), new Response('video-bytes', { status: 200 })]
  await fal.downloadFalFile('https://v3.fal.media/a.mp4', path.join(dir, 'b.mp4'), { fetch: async () => hops.shift() })
  assert.equal(fs.readFileSync(path.join(dir, 'b.mp4'), 'utf8'), 'video-bytes')
  assert.equal(fs.existsSync(path.join(dir, 'b.mp4.part')), false)
})

test('phone photos report their EXIF orientation', () => {
  const lib = loadLibrary(os.tmpdir())
  const exif = (orientation, little) => {
    const tiff = Buffer.alloc(26)
    tiff.write(little ? 'II' : 'MM', 0, 'latin1')
    const u16 = (v, at) => little ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at)
    const u32 = (v, at) => little ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at)
    u16(42, 2); u32(8, 4); u16(1, 8)
    u16(0x0112, 10); u16(3, 12); u32(1, 14); u16(orientation, 18)
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
    const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(payload.length + 2, 2)
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, payload, Buffer.from([0xff, 0xda, 0, 2])])
  }
  assert.equal(lib.jpegOrientation(exif(6, true)), 6)
  assert.equal(lib.jpegOrientation(exif(8, false)), 8)
  assert.equal(lib.jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1)
  assert.equal(lib.jpegOrientation(Buffer.from('not a jpeg')), 1)
})

test('a cloned voice survives switching to a preset and back', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-clone-'))
  const lib = loadLibrary(userData)
  const photo = path.join(userData, 'me.jpg'); fs.writeFileSync(photo, 'photo-bytes')
  const draft = await lib.draftFromPhoto(photo)
  const [created] = plain(await lib.createAvatar({ draftId: draft.draftId, name: 'Me', kind: 'self', voice: { provider: 'elevenlabs', voice: 'Brian' }, consent: true }))
  // Simulate a finished clone on disk: the recording plus its record.
  const dir = path.join(userData, 'avatars', created.id)
  const file = path.join(dir, 'avatar.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  fs.writeFileSync(path.join(dir, 'voice-sample.mp3'), 'audio')
  fs.writeFileSync(file, JSON.stringify({ ...saved, clonedVoice: { clonedAt: 'x', transcript: 'hello' }, voice: { provider: 'clone', clonedAt: 'x' } }))
  let [avatar] = plain(await lib.updateAvatar(created.id, { voice: { provider: 'elevenlabs', voice: 'Sarah' } }))
  assert.equal(avatar.voice.voice, 'Sarah')
  assert.equal(avatar.clonedVoice.clonedAt, 'x')
  ;[avatar] = plain(await lib.updateAvatar(created.id, { voice: { provider: 'clone', clonedAt: 'forged' } }))
  assert.deepEqual(avatar.voice, { provider: 'clone', clonedAt: 'x' })
  // The clone speaks through Fish Audio with the recording (and transcript) as the reference.
  const speech = plain(await lib.speechFor(created.id, avatar.voice, 'Hi.'))
  assert.equal(speech.model, 'fish-audio/s2.1-pro')
  assert.equal(speech.references[0].transcript, 'hello')
  assert.equal(plain(await lib.speechFor(created.id, { provider: 'elevenlabs', voice: 'Sarah' }, 'Hi.')).voice, 'sarah')
})

test('avatars made on the fal version open with their voices moved to OpenRouter', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-migrate-'))
  const lib = loadLibrary(userData)
  const photo = path.join(userData, 'me.jpg'); fs.writeFileSync(photo, 'photo-bytes')
  const write = async (voice, clonedVoice) => {
    const draft = await lib.draftFromPhoto(photo)
    const [created] = plain(await lib.createAvatar({ draftId: draft.draftId, name: 'Old', kind: 'self', voice: { provider: 'elevenlabs', voice: 'Brian' }, consent: true }))
    const file = path.join(userData, 'avatars', created.id, 'avatar.json')
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), voice, clonedVoice }))
    return created.id
  }
  const aria = await write({ provider: 'elevenlabs', voice: 'Aria' }, null)
  const minimax = await write({ provider: 'minimax-clone', voiceId: 'old_clone', clonedAt: 'x' }, { voiceId: 'old_clone', clonedAt: 'x' })
  const list = plain(await lib.listAvatars())
  assert.deepEqual(list.find((a) => a.id === aria).voice, { provider: 'elevenlabs', voice: 'Bella' })
  const old = list.find((a) => a.id === minimax)
  assert.deepEqual(old.voice, { provider: 'elevenlabs', voice: 'Brian' })
  assert.equal(old.clonedVoice, null)
})

// ---------------------------------------------------------------------------
// Recreate a video with the avatar
// ---------------------------------------------------------------------------

test('recreate windows are 3-30 seconds inside the source; costs follow fal billing', () => {
  assert.deepEqual(plain(shared.validateRecreateWindow(1.234, 12.5, 60)), { startSeconds: 1.23, endSeconds: 12.5 })
  assert.deepEqual(plain(shared.validateRecreateWindow(0, 99, 20)), { startSeconds: 0, endSeconds: 20 })
  assert.throws(() => shared.validateRecreateWindow(5, 6, 60), /at least 3 seconds/)
  assert.throws(() => shared.validateRecreateWindow(0, 31, 60), /at most 30 seconds/)
  assert.throws(() => shared.validateRecreateWindow(10, 5, 60), /start and end/)
  assert.throws(() => shared.validateRecreateWindow('0', 5, 60), /start and end/)
  // 10s at 24 fps = 240 frames = 15 billed chunks of 16 frames at $0.08.
  assert.equal(shared.estimateRecreateCost({ startSeconds: 0, endSeconds: 10, mode: 'replace' }), 1.2)
  assert.equal(shared.estimateRecreateCost({ startSeconds: 0, endSeconds: 10, mode: 'move' }), 0.6)
  assert.equal(shared.estimateRecreateCost({ startSeconds: 0, endSeconds: 10, mode: 'motion' }), 1.26)
})

const ENGINE_PYTHON = path.join(__dirname, '../../engine/.venv/bin/python')
const hasEngine = fs.existsSync(ENGINE_PYTHON)

test('a recreate run keeps phone rotation, retimes to the window, restores audio and finishes at 9:16', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cc recreate '))
  const flat = path.join(output, 'flat.mp4')
  const source = path.join(output, 'phone clip.mov')
  // A "portrait phone video": stored 640x360 with a 90 degree rotation flag, plus audio.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', flat])
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-display_rotation:v:0', '90', '-i', flat, '-c', 'copy', source])
  const calls = []
  const statuses = []
  const settings = { ...SETTINGS, outputDirectory: output, openrouterApiKey: '' }
  const studio = loadStudio({
    './settings-store': { loadSettings: () => settings },
    './security': { assertMediaPath: (p) => { if (!String(p).startsWith(output)) throw new Error('nope') } },
    './avatars': { portraitInput: async () => 'data:image/jpeg;base64,AA==', readAvatar: () => ({ name: 'Maya' }) },
    './pipeline-runner': {
      getBridgeRunnerPath: () => path.join(__dirname, '../../bridge/bridge_runner.py'), getEnginePath: () => path.join(__dirname, '../../engine'),
      resolvePythonPath: () => ENGINE_PYTHON, runtimeEnvironment: () => ({ PATH: process.env.PATH, HOME: process.env.HOME }), validatePython: async () => ({ ok: true })
    },
    './fal': {
      falInputUrl: async (bytes, type) => { calls.push(['upload', type, bytes.length]); return 'https://v3.fal.media/source.mp4' },
      falRun: async (model, input) => { calls.push(['run', model, input]); return { video: { url: 'https://v3.fal.media/out.mp4' } } },
      falFileUrl: (outputJson) => outputJson.video.url,
      // The model "returns" the prepared clip, but 1s short, to exercise retiming.
      downloadFalFile: async (_url, destination) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(path.dirname(destination), 'source.mp4'), '-t', '4', '-c', 'copy', destination])
    }
  })
  studio.onAvatarRenderStatus((status) => statuses.push(status))
  const request = { avatarId: 'abcdef1234567890', sourcePath: source, startSeconds: 2, endSeconds: 7, mode: 'motion', keepAudio: true, title: 'POV test', captionPreset: 'pop', includeCaptions: false, includeTitle: true, rightsConfirmed: true }
  await assert.rejects(studio.startAvatarRecreate({ ...request, rightsConfirmed: false }), /own this video/)
  await assert.rejects(studio.startAvatarRecreate({ ...request, sourcePath: '/etc/passwd.mp4' }), /Choose the source video again/)
  await assert.rejects(studio.startAvatarRecreate({ ...request, endSeconds: 3.5 }), /at least 3 seconds/)
  await assert.rejects(studio.startAvatarRecreate({ ...request, mode: 'bogus' }), /how to recreate/)
  await studio.startAvatarRecreate(request)
  for (let i = 0; i < 600 && !['done', 'failed'].includes(statuses.at(-1)?.phase); i++) await new Promise((r) => setTimeout(r, 100))
  const last = statuses.at(-1)
  assert.equal(last.phase, 'done', last.error)
  const run = calls.find((c) => c[0] === 'run')
  assert.equal(run[1], 'fal-ai/kling-video/v3/standard/motion-control')
  assert.deepEqual(plain(run[2]), { video_url: 'https://v3.fal.media/source.mp4', image_url: 'data:image/jpeg;base64,AA==', character_orientation: 'video', keep_original_sound: false })
  const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }))
  const folder = path.dirname(last.outputPath)
  const sent = probe(path.join(folder, 'parts', 'source.mp4')).streams[0]
  assert.deepEqual([sent.width, sent.height, sent.r_frame_rate], [360, 640, '24/1'], 'portrait stays portrait, at 24 fps')
  const assembled = probe(path.join(folder, 'parts', 'assembled.mp4'))
  assert.ok(Math.abs(Number(assembled.format.duration) - 5) < 0.15, `retimed to the 5s window: ${assembled.format.duration}`)
  assert.ok(assembled.streams.some((s) => s.codec_type === 'audio'), 'original audio kept')
  if (hasEngine) {
    assert.equal(path.basename(last.outputPath), 'final.mp4', last.warning)
    const final = probe(last.outputPath).streams.find((s) => s.codec_type === 'video')
    assert.deepEqual([final.width, final.height], [1080, 1920])
  } else {
    assert.match(last.warning, /Captions could not be added/)
  }
})

// ---------------------------------------------------------------------------
// Audit fixes: model tiers, long scenes, paid-result resilience, clone safety
// ---------------------------------------------------------------------------

test('standard and pro scene tiers change the estimate', () => {
  const words = (n) => Array.from({ length: n }, () => 'word').join(' ')
  const talking = { title: '', scenes: [{ narration: words(52), visual: '', featuresAvatar: true }] }
  const cinematic = { title: '', scenes: [{ narration: words(26), visual: 'a', featuresAvatar: true }, { narration: words(26), visual: 'b', featuresAvatar: false }] }
  assert.ok(shared.estimateRenderCost({ style: 'cinematic', lipSync: 'fabric', sceneQuality: 'standard', script: cinematic }) < shared.estimateRenderCost({ style: 'cinematic', lipSync: 'fabric', sceneQuality: 'pro', script: cinematic }))
  const studio = loadStudio()
  const base = { avatarId: 'abcdef1234567890', captionPreset: 'pop' }
  assert.equal(studio.parseRenderRequest({ ...base, style: 'talking', script: talking }).lipSync, 'avatar-iv')
  assert.equal(studio.parseRenderRequest({ ...base, style: 'cinematic', script: cinematic }).sceneQuality, 'standard')
  assert.equal(studio.parseRenderRequest({ ...base, style: 'cinematic', sceneQuality: 'pro', script: cinematic }).sceneQuality, 'pro')
})

test('a scene with more narration than one shot is caught before paying', () => {
  const words = (n) => Array.from({ length: n }, () => 'word').join(' ')
  const script = { title: '', scenes: [{ narration: words(130), visual: 'a', featuresAvatar: true }, { narration: words(10), visual: 'b', featuresAvatar: false }] }
  assert.deepEqual(plain(shared.overlongScenes(script)), [1])
  const studio = loadStudio()
  assert.throws(() => studio.parseRenderRequest({ avatarId: 'abcdef1234567890', captionPreset: 'pop', style: 'cinematic', script }), /Scene 1 has more narration than one 15-second shot/)
})

test('brief fal outages while polling or fetching a paid result are waited out', async () => {
  const responses = [
    jsonResponse({ status_url: `${Q}/status`, response_url: Q, cancel_url: `${Q}/cancel` }),
    new Response('busy', { status: 503 }),
    jsonResponse({ status: 'COMPLETED' }),
    new Response('busy', { status: 502 }),
    jsonResponse({ video: { url: 'https://v3.fal.media/files/out.mp4' } })
  ]
  const urls = []
  const result = await fal.falRun('fal-ai/x', {}, { key: 'k', pollMs: 1, fetch: async (url) => { urls.push(url); return responses.shift() } })
  assert.equal(result.video.url, 'https://v3.fal.media/files/out.mp4')
  assert.equal(urls.filter((u) => u === Q).length, 2, 'result fetch retried')
})

test('giving up on a job cancels it so it stops billing', async () => {
  const calls = []
  const responses = [jsonResponse({ status_url: `${Q}/status`, response_url: Q, cancel_url: `${Q}/cancel` }), jsonResponse({ detail: 'bad' }, 422)]
  await assert.rejects(fal.falRun('fal-ai/x', {}, { key: 'k', pollMs: 1, fetch: async (url, init) => { calls.push([url, init?.method]); return responses.shift() ?? jsonResponse({}) } }), /could not process/)
  assert.deepEqual(calls.at(-1), [`${Q}/cancel`, 'PUT'])
})

test('a dropped download is retried; the body is not cut off by the header timeout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dl2-'))
  let attempts = 0
  await fal.downloadFalFile('https://v3.fal.media/a.mp4', path.join(dir, 'a.mp4'), {
    fetch: async () => { attempts++; if (attempts === 1) throw new TypeError('socket hang up'); return new Response('ok-bytes', { status: 200 }) }
  })
  assert.equal(attempts, 2)
  assert.equal(fs.readFileSync(path.join(dir, 'a.mp4'), 'utf8'), 'ok-bytes')
})

test('timeouts are not mistaken for file errors', () => {
  const studio = loadStudio()
  const timeout = new DOMException('The operation timed out.', 'TimeoutError')
  assert.equal(studio.renderErrorMessage(timeout), 'The operation timed out.')
})

test('cloning keeps a trimmed recording with the avatar, proves it speaks, and changes nothing if OpenRouter refuses it', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-clone2-'))
  const calls = []
  let refuse = false
  const image = { isEmpty: () => false, getSize: () => ({ width: 900, height: 1600 }), resize: () => image, toJPEG: () => Buffer.from('jpeg') }
  const lib = load('main/avatars.ts', {
    electron: { app: { getPath: () => userData }, nativeImage: { createFromBuffer: () => image } },
    './security': { authorizeMedia: (p) => p },
    './settings-store': settingsStub,
    './tools': { resolveBinary: (name) => name },
    './fal': { falInputUrl: async () => 'data:' },
    './logger': { logger: { warn() {}, info() {} } },
    './openrouter-media': mediaStub({
      synthesizeSpeech: async (request) => {
        calls.push(request)
        if (refuse) throw new OpenRouterMediaError('OpenRouter could not record the voice: the request was rejected. Try a different description or recording.')
        return new Uint8Array([1, 2, 3])
      }
    })
  })
  const photo = path.join(userData, 'me.jpg'); fs.writeFileSync(photo, 'photo')
  const sample = path.join(userData, 'voice.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=60', sample])
  const draft = await lib.draftFromPhoto(photo)
  const [avatar] = plain(await lib.createAvatar({ draftId: draft.draftId, name: 'Me', kind: 'self', voice: { provider: 'elevenlabs', voice: 'Brian' }, consent: true }))
  const [cloned] = plain(await lib.cloneVoice(avatar.id, sample, true))
  assert.equal(cloned.voice.provider, 'clone')
  assert.ok(cloned.clonedVoice.clonedAt)
  assert.equal(calls[0].model, 'fish-audio/s2.1-pro')
  assert.equal(calls[0].references[0].mime, 'audio/mpeg')
  const reference = path.join(userData, 'avatars', avatar.id, 'voice-sample.mp3')
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', reference]).toString())
  assert.ok(seconds <= lib.CLONE_REFERENCE_SECONDS + 0.5, `trimmed to ${seconds}s`)

  // A refused recording leaves the existing clone untouched.
  refuse = true
  await assert.rejects(lib.cloneVoice(avatar.id, sample, true), /could not clone that recording/)
  const [after] = plain(await lib.listAvatars())
  assert.equal(after.clonedVoice.clonedAt, cloned.clonedVoice.clonedAt)
  assert.ok(!fs.existsSync(path.join(userData, 'avatars', avatar.id, 'voice-sample.new.mp3')))
})

// ---------------------------------------------------------------------------
// OpenRouter media client
// ---------------------------------------------------------------------------

function loadMedia() {
  return load('main/openrouter-media.ts', { electron: { app: { isPackaged: true } }, './logger': { logger: { warn() {}, info() {} } },
    './network-policy': { assertPublicWebUrl: async (url) => { if (/localhost|127\.0\.0\.1|169\.254/.test(url)) throw new Error('Local network sources are not allowed') } } })
}

test('images: Nano Banana request with the reference photo inline; base64 result decoded', async () => {
  const media = loadMedia()
  const seen = []
  const fetch = async (url, init) => { seen.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return jsonResponse({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64'), media_type: 'image/png' }] }) }
  const bytes = await media.generateImage({ model: 'google/gemini-3.1-flash-image', prompt: 'A face', aspectRatio: '9:16', references: [{ bytes: new Uint8Array([1, 2]), mime: 'image/jpeg' }] }, { key: 'k', fetch })
  assert.equal(Buffer.from(bytes).toString(), 'png-bytes')
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/images')
  assert.equal(seen[0].auth, 'Bearer k')
  assert.equal(seen[0].body.aspect_ratio, '9:16')
  assert.deepEqual(seen[0].body.input_references, [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQI=' } }])
  await assert.rejects(media.generateImage({ model: 'm', prompt: 'p' }, { key: 'k', fetch: async () => jsonResponse({ data: [] }) }), /no image/)
  await assert.rejects(media.generateImage({ model: 'm', prompt: 'p' }, { key: 'k', fetch: async () => jsonResponse({ error: 'x' }, 402) }), /insufficient credits/)
})

test('speech: preset voices by name, cloned voices by reference recording; raw audio back', async () => {
  const media = loadMedia()
  const seen = []
  const fetch = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return new Response(new Uint8Array([9, 9, 9]), { status: 200 }) }
  assert.deepEqual([...await media.synthesizeSpeech({ model: 'elevenlabs/eleven-v3', input: 'Hi', voice: 'brian' }, { key: 'k', fetch })], [9, 9, 9])
  await media.synthesizeSpeech({ model: 'fish-audio/s2.1-pro', input: 'Hi', references: [{ audio: new Uint8Array([7]), mime: 'audio/mpeg', transcript: 'hello there' }] }, { key: 'k', fetch })
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/audio/speech')
  assert.equal(seen[0].body.voice, 'brian')
  assert.equal(seen[0].body.response_format, 'mp3')
  assert.deepEqual(seen[1].body.input_references, [{ type: 'input_audio', input_audio: { data: 'data:audio/mpeg;base64,Bw==' } }, { type: 'text', text: 'hello there' }])
  assert.equal(seen[1].body.voice, undefined)
  await assert.rejects(media.synthesizeSpeech({ model: 'm', input: 'x' }, { key: 'k', fetch: async () => new Response(new Uint8Array(), { status: 200 }) }), /empty/)
})

test('video jobs: submit, poll until done, download (following the file-host redirect without the key), report cost', async () => {
  const media = loadMedia()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-video-'))
  const calls = []
  let polls = 0
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null })
    if (url.endsWith('/videos') && init.method === 'POST') return jsonResponse({ id: 'job_1', status: 'pending' }, 202)
    if (url.endsWith('/videos/job_1')) return jsonResponse(++polls < 2 ? { id: 'job_1', status: 'in_progress' } : { id: 'job_1', status: 'completed', usage: { cost: 0.42 } })
    if (url.includes('/videos/job_1/content')) return new Response(null, { status: 302, headers: { location: 'https://files.example/video.mp4' } })
    if (url === 'https://files.example/video.mp4') return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200 })
    throw new Error(`unexpected ${url}`)
  }
  const out = path.join(dir, 'talking.mp4')
  const statuses = []
  const result = await media.generateVideo({
    model: 'heygen/avatar-iv', prompt: 'Say it', aspectRatio: '9:16', resolution: '720p',
    references: [{ kind: 'image', bytes: new Uint8Array([1]), mime: 'image/jpeg' }, { kind: 'audio', bytes: new Uint8Array([2]), mime: 'audio/mpeg' }]
  }, out, { key: 'k', fetch, pollMs: 1, onStatus: (s) => statuses.push(s) })
  assert.equal(result.costUsd, 0.42)
  assert.equal(fs.readFileSync(out).length, 8)
  assert.deepEqual(calls[0].body.input_references, [
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQ==' } },
    { type: 'input_audio', input_audio: { data: 'data:audio/mpeg;base64,Ag==' } }
  ])
  assert.ok(statuses.length >= 1)
  const fileHost = calls.find((call) => call.url === 'https://files.example/video.mp4')
  assert.equal(fileHost.auth, undefined)
  // A redirect into the local network is refused.
  const local = async (url, init = {}) => init.method === 'POST' ? jsonResponse({ id: 'job_9', status: 'completed' })
    : new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } })
  await assert.rejects(media.generateVideo({ model: 'm', prompt: 'p' }, path.join(dir, 'local.mp4'), { key: 'k', fetch: local, pollMs: 1 }), /could not be downloaded/)

  // Image-to-video sends the still as the first frame.
  const sent = []
  const kling = async (url, init = {}) => {
    if (init.method === 'POST') { sent.push(JSON.parse(init.body)); return jsonResponse({ id: 'job_2', status: 'completed' }) }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }
  await media.generateVideo({ model: 'kwaivgi/kling-v3.0-std', prompt: 'Pan', aspectRatio: '9:16', duration: 5, generateAudio: false, firstFrame: { bytes: new Uint8Array([5]), mime: 'image/png' } },
    path.join(dir, 'scene.mp4'), { key: 'k', fetch: kling, pollMs: 1 })
  assert.deepEqual(sent[0].frame_images, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,BQ==' }, frame_type: 'first_frame' }])
  assert.equal(sent[0].duration, 5)
  assert.equal(sent[0].generate_audio, false)

  // A failed job is reported, and nothing is left behind.
  const failed = async (url, init = {}) => init.method === 'POST' ? jsonResponse({ id: 'job_3', status: 'failed', error: 'content policy' }) : jsonResponse({})
  await assert.rejects(media.generateVideo({ model: 'm', prompt: 'p' }, path.join(dir, 'x.mp4'), { key: 'k', fetch: failed, pollMs: 1 }), /could not be made/)
  assert.ok(!fs.existsSync(path.join(dir, 'x.mp4')))
  await assert.rejects(media.generateVideo({ model: 'm', prompt: 'p' }, path.join(dir, 'y.mp4'), { key: 'k', fetch: async () => jsonResponse({ id: '../evil' }) }), /invalid video job/)
})

test('a talking-head and a cinematic render run end to end on OpenRouter (mocked) and produce a 9:16 video', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-render-'))
  const narration = path.join(out, 'voice.mp3')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', '-c:a', 'libmp3lame', narration])
  const clip = path.join(out, 'clip.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3355ff:s=720x1280:d=6:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
  const portrait = path.join(out, 'portrait.jpg')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xcc8844:s=720x1280', '-frames:v', '1', portrait])
  const calls = []
  const media = {
    synthesizeSpeech: async (request) => { calls.push(['speech', request]); return new Uint8Array(fs.readFileSync(narration)) },
    generateImage: async (request) => { calls.push(['image', request]); return new Uint8Array([0x89, 0x50, 1]) },
    generateVideo: async (request, destination) => { calls.push(['video', request]); fs.copyFileSync(clip, destination); return { costUsd: 0.1 } }
  }
  const studio = loadStudio({
    './openrouter-media': media,
    './avatars': {
      openRouterKey: () => 'or-key', portraitBytes: async () => new Uint8Array(fs.readFileSync(portrait)), portraitInput: async () => 'data:',
      readAvatar: () => ({ name: 'Maya', voice: { provider: 'elevenlabs', voice: 'Brian' } }),
      speechFor: async (id, voice, text) => ({ model: 'elevenlabs/eleven-v3', input: text, voice: voice.voice.toLowerCase() })
    }
  })
  SETTINGS.outputDirectory = out
  const finished = () => new Promise((resolve) => studio.onAvatarRenderStatus((status) => { if (['done', 'failed', 'cancelled'].includes(status.phase)) resolve(status) }))
  const base = { avatarId: 'abcdef1234567890', captionPreset: 'pop', includeCaptions: false, includeTitle: false }

  let done = finished()
  await studio.startAvatarRender({ ...base, style: 'talking', script: { title: 'Hook', scenes: [{ narration: 'Stop doing this. Do that instead, it works.' }] } })
  let status = await done
  assert.equal(status.phase, 'done', status.error ?? '')
  assert.ok(fs.existsSync(status.outputPath))
  // No paid video call: the talking head is the photo with the voice, made locally.
  assert.equal(calls.filter(([kind]) => kind === 'video').length, 0)
  assert.equal(calls[0][1].voice, 'brian')
  const talking = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', status.outputPath]).toString())
  assert.deepEqual([talking.streams.find((s) => s.codec_type === 'video').width, talking.streams.find((s) => s.codec_type === 'video').height], [1080, 1920])
  assert.ok(Math.abs(Number(talking.format.duration) - 6) < 0.5, `matches the voiceover (${talking.format.duration}s)`)

  calls.length = 0
  done = finished()
  await studio.startAvatarRender({ ...base, style: 'cinematic', sceneQuality: 'pro', script: { title: 'Hook', scenes: [
    { narration: 'First the hook line here.', visual: 'A person at a desk', featuresAvatar: true },
    { narration: 'Then the payoff line here.', visual: 'A city street at dusk', featuresAvatar: false }
  ] } })
  status = await done
  assert.equal(status.phase, 'done', status.error ?? '')
  const images = calls.filter(([kind]) => kind === 'image').map(([, r]) => r)
  assert.equal(images.length, 2)
  assert.equal(images.filter((r) => r.references?.length).length, 1, 'only the avatar shot carries the portrait')
  const videos = calls.filter(([kind]) => kind === 'video').map(([, r]) => r)
  assert.ok(videos.every((r) => r.model === 'kwaivgi/kling-v3.0-pro' && r.firstFrame.mime === 'image/png' && r.generateAudio === false && r.duration >= 3))
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_type', '-of', 'json', status.outputPath]).toString())
  const video = probe.streams.find((s) => s.codec_type === 'video')
  assert.deepEqual([video.width, video.height], [1080, 1920])
  assert.ok(probe.streams.some((s) => s.codec_type === 'audio'))
})

test('"AI version of me": new pictures from the person’s own photo, then swapped in without touching the voice', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-restyle-'))
  const requests = []
  const image = { isEmpty: () => false, getSize: () => ({ width: 900, height: 1600 }), resize: () => image, toJPEG: () => Buffer.from('jpeg') }
  const lib = load('main/avatars.ts', {
    electron: { app: { getPath: () => userData }, nativeImage: { createFromBuffer: () => image } },
    './security': { authorizeMedia: (p) => p },
    './settings-store': settingsStub,
    './tools': { resolveBinary: (name) => name },
    './fal': { falInputUrl: async () => 'data:' },
    './logger': { logger: { warn() {}, info() {} } },
    './openrouter-media': mediaStub({ generateImage: async (request) => { requests.push(request); return new Uint8Array([0xff, 0xd8, requests.length]) } })
  })
  const photo = path.join(userData, 'me.jpg'); fs.writeFileSync(photo, 'my-photo')
  const draft = await lib.draftFromPhoto(photo)

  // Before the avatar exists: from the chosen photo, only with consent, with an allowed look.
  await assert.rejects(lib.restyleDrafts({ draftId: draft.draftId }, 'studio', '', false), /Confirm this is you/)
  await assert.rejects(lib.restyleDrafts({ draftId: draft.draftId }, 'anime', '', true), /Choose a look/)
  await assert.rejects(lib.restyleDrafts({ draftId: draft.draftId }, 'studio', 'looks like a famous actor', true), /another real person/)
  const made = plain(await lib.restyleDrafts({ draftId: draft.draftId }, 'podcast', 'navy blazer', true))
  assert.equal(made.length, 2)
  assert.equal(requests[0].model, 'google/gemini-3.1-flash-image')
  assert.equal(requests[0].aspectRatio, '9:16')
  assert.equal(Buffer.from(requests[0].references[0].bytes).toString(), 'jpeg', 'the person’s photo is the reference')
  assert.match(requests[0].prompt, /same person as in the reference photo/i)
  assert.match(requests[0].prompt, /podcast studio/)
  assert.match(requests[0].prompt, /navy blazer/)

  // Create with an AI version, then restyle the saved avatar: the voice and clone stay.
  const [created] = plain(await lib.createAvatar({ draftId: made[0].draftId, name: 'Me', kind: 'self', voice: { provider: 'elevenlabs', voice: 'Brian' }, consent: true }))
  const dir = path.join(userData, 'avatars', created.id)
  fs.writeFileSync(path.join(dir, 'voice-sample.mp3'), 'audio')
  const json = path.join(dir, 'avatar.json')
  fs.writeFileSync(json, JSON.stringify({ ...JSON.parse(fs.readFileSync(json, 'utf8')), clonedVoice: { clonedAt: 'x', transcript: '' }, voice: { provider: 'clone', clonedAt: 'x' } }))
  const again = plain(await lib.restyleDrafts({ avatarId: created.id }, 'studio', '', true))
  const [after] = plain(await lib.setPortrait(created.id, again[1].draftId))
  assert.match(path.basename(after.portraitPath), /^portrait-[a-f0-9]{8}\.jpg$/, 'a new file name, so no stale cached image')
  assert.ok(!fs.existsSync(path.join(dir, 'portrait.jpg')), 'the old picture is removed')
  assert.deepEqual(after.voice, { provider: 'clone', clonedAt: 'x' })
  assert.equal(lib.portraitPath(created.id), after.portraitPath)
  await assert.rejects(lib.setPortrait(created.id, again[1].draftId), /expired/)

  // Fictional AI avatars aren't restyled from a photo.
  const aiDraft = await lib.draftFromPhoto(photo)
  const [ai] = plain(await lib.createAvatar({ draftId: aiDraft.draftId, name: 'Maya', kind: 'ai', description: 'A fictional person with red hair', voice: { provider: 'elevenlabs', voice: 'Sarah' } }))
  await assert.rejects(lib.restyleDrafts({ avatarId: ai.id }, 'studio', '', true), /made from your photo/)
})

test('reaction library: AI reactions from the picture (failed ones reported), own uploads normalized to 1080x1920 silent', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-reactions-'))
  const image = { isEmpty: () => false, getSize: () => ({ width: 900, height: 1600 }), resize: () => image, toJPEG: () => Buffer.from('jpeg') }
  const mocks = {
    electron: { app: { getPath: () => userData }, nativeImage: { createFromBuffer: () => image } },
    './security': { authorizeMedia: (p) => p },
    './settings-store': settingsStub,
    './tools': { resolveBinary: (name) => name },
    './fal': { falInputUrl: async () => 'data:' },
    './logger': { logger: { warn() {}, info() {} } },
    './openrouter-media': mediaStub()
  }
  const lib = load('main/avatars.ts', mocks)
  const reactions = load('main/reactions.ts', { ...mocks, './avatars': lib })
  const photo = path.join(userData, 'me.jpg'); fs.writeFileSync(photo, 'photo')
  const draft = await lib.draftFromPhoto(photo)
  const [avatar] = plain(await lib.createAvatar({ draftId: draft.draftId, name: 'Me', kind: 'self', voice: { provider: 'elevenlabs', voice: 'Brian' }, consent: true }))
  assert.deepEqual(avatar.reactions, [])

  const clip = path.join(userData, 'clip.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x336699:s=720x1280:d=5:r=24', '-f', 'lavfi', '-i', 'sine=d=5', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip])
  const requests = []
  const generate = async (request, destination) => {
    requests.push(request)
    if (request.prompt.includes('laughs')) throw new Error('The video could not be made on OpenRouter.')
    fs.copyFileSync(clip, destination)
    return { costUsd: 0.42 }
  }
  const result = plain(await reactions.makeReactions(avatar.id, undefined, { generate }))
  assert.equal(requests.length, 6)
  assert.ok(requests.every((r) => r.model === 'kwaivgi/kling-v3.0-std' && r.duration === 5 && r.generateAudio === false && r.firstFrame.mime === 'image/jpeg'))
  assert.match(requests.find((r) => r.prompt.includes('points up')).prompt, /do not speak/)
  assert.equal(result.made, 5)
  assert.deepEqual(result.failed, ['Laughing'])
  const listed = result.avatars[0].reactions
  assert.deepEqual(listed.map((r) => r.id), ['listen', 'nod', 'point', 'surprised', 'skeptical'])
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', listed[0].path]).toString())
  assert.deepEqual(probe.streams.map((s) => s.codec_type), ['video'], 'stored silent')
  assert.deepEqual([probe.streams[0].width, probe.streams[0].height], [1080, 1920])

  // A second run only makes what's missing; an own clip replaces one and is marked as yours.
  requests.length = 0
  await reactions.makeReactions(avatar.id, undefined, { generate: async (request, destination) => { requests.push(request); fs.copyFileSync(clip, destination) } })
  assert.equal(requests.length, 1)
  const [mine] = plain(await reactions.uploadReaction(avatar.id, 'nod', clip))
  assert.equal(mine.reactions.find((r) => r.id === 'nod').source, 'own')
  await assert.rejects(reactions.uploadReaction(avatar.id, 'wave', clip), /Choose a reaction/)
  await assert.rejects(reactions.uploadReaction(avatar.id, 'nod', photo), /Choose a video/)
  const [removed] = plain(await reactions.removeReaction(avatar.id, 'nod'))
  assert.ok(!removed.reactions.some((r) => r.id === 'nod'))
})
