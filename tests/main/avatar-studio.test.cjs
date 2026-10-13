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
    './pipeline-runner': { getBridgeRunnerPath: () => '/b/bridge_runner.py', getEnginePath: () => '/engine', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
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
  // Simulate a finished clone on disk.
  const file = path.join(userData, 'avatars', created.id, 'avatar.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  fs.writeFileSync(file, JSON.stringify({ ...saved, clonedVoice: { voiceId: 'my_clone', clonedAt: 'x' }, voice: { provider: 'minimax-clone', voiceId: 'my_clone', clonedAt: 'x' } }))
  let [avatar] = plain(await lib.updateAvatar(created.id, { voice: { provider: 'elevenlabs', voice: 'Sarah' } }))
  assert.equal(avatar.voice.voice, 'Sarah')
  assert.equal(avatar.clonedVoice.voiceId, 'my_clone')
  ;[avatar] = plain(await lib.updateAvatar(created.id, { voice: { provider: 'minimax-clone', voiceId: 'my_clone', clonedAt: 'forged' } }))
  assert.deepEqual(avatar.voice, { provider: 'minimax-clone', voiceId: 'my_clone', clonedAt: 'x' })
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
})

test('source frames are scaled to even sizes within 1280px', () => {
  const studio = loadStudio()
  assert.deepEqual(plain(studio.fitWithin(1920, 1080)), { width: 1280, height: 720 })
  assert.deepEqual(plain(studio.fitWithin(1080, 1920)), { width: 720, height: 1280 })
  assert.deepEqual(plain(studio.fitWithin(641, 359)), { width: 642, height: 360 })
})

test('a recreate run cuts the window, sends it with the portrait and puts the original audio back', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-recreate-'))
  const source = path.join(output, 'dance.mp4')
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source])
  const calls = []
  const statuses = []
  const settings = { ...SETTINGS, outputDirectory: output, openrouterApiKey: '' }
  const studio = loadStudio({
    './settings-store': { loadSettings: () => settings },
    './security': { assertMediaPath: (p) => { if (!String(p).startsWith(output)) throw new Error('nope') } },
    './avatars': { portraitInput: async () => 'data:image/jpeg;base64,AA==', readAvatar: () => ({ name: 'Maya' }) },
    './fal': {
      falInputUrl: async (bytes, type) => { calls.push(['upload', type, bytes.length]); return 'https://v3.fal.media/source.mp4' },
      falRun: async (model, input) => { calls.push(['run', model, input]); return { video: { url: 'https://v3.fal.media/out.mp4' } } },
      falFileUrl: (outputJson) => outputJson.video.url,
      // The "recreated" video is the prepared source clip itself.
      downloadFalFile: async (_url, destination) => fs.copyFileSync(path.join(path.dirname(destination), 'source.mp4'), destination)
    }
  })
  studio.onAvatarRenderStatus((status) => statuses.push(status))
  const request = { avatarId: 'abcdef1234567890', sourcePath: source, startSeconds: 2, endSeconds: 7, mode: 'replace', keepAudio: true, title: '', captionPreset: 'pop', includeCaptions: false, includeTitle: false, rightsConfirmed: true }
  await assert.rejects(studio.startAvatarRecreate({ ...request, rightsConfirmed: false }), /own this video/)
  await assert.rejects(studio.startAvatarRecreate({ ...request, sourcePath: '/etc/passwd.mp4' }), /Choose the source video again/)
  await assert.rejects(studio.startAvatarRecreate({ ...request, endSeconds: 3.5 }), /at least 3 seconds/)
  await studio.startAvatarRecreate(request)
  for (let i = 0; i < 200 && !['done', 'failed'].includes(statuses.at(-1)?.phase); i++) await new Promise((r) => setTimeout(r, 100))
  const last = statuses.at(-1)
  assert.equal(last.phase, 'done', last.error)
  const run = calls.find((c) => c[0] === 'run')
  assert.equal(run[1], 'fal-ai/wan/v2.2-14b/animate/replace')
  assert.deepEqual(plain(run[2]), { video_url: 'https://v3.fal.media/source.mp4', image_url: 'data:image/jpeg;base64,AA==', resolution: '720p', video_quality: 'high' })
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', last.outputPath], { encoding: 'utf8' }))
  const v = info.streams.find((s) => s.codec_type === 'video')
  assert.equal(v.width, 1280); assert.equal(v.height, 720); assert.equal(v.r_frame_rate, '24/1')
  assert.ok(info.streams.some((s) => s.codec_type === 'audio'), 'original audio kept')
  assert.ok(Math.abs(Number(info.format.duration) - 5) < 0.15, info.format.duration)
})
