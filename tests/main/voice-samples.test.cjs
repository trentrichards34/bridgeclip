const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, AbortSignal, Uint8Array, JSON,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-samples-'))
const SETTINGS = { openrouterApiKey: 'or-key' }
const AVATARS = { abcdef1234567890: { clonedVoice: { clonedAt: '2026-10-14T10:00:00Z', transcript: 'hi' } } }
const samples = load('main/voice-samples.ts', {
  electron: { app: { getPath: () => userData, isPackaged: false } },
  './avatars': {
    readAvatar: (id) => { if (!AVATARS[id]) throw new Error('That avatar is no longer in your library.'); return AVATARS[id] },
    speechFor: async (id, voice, text) => voice.provider === 'elevenlabs'
      ? { model: 'elevenlabs/eleven-v3', input: text, voice: voice.voice.toLowerCase() }
      : { model: 'fish-audio/s2.1-pro', input: text, references: [{ audio: new Uint8Array([1]), mime: 'audio/mpeg' }] }
  },
  './openrouter-media': { synthesizeSpeech: async () => { throw new Error('not mocked') } },
  './settings-store': { loadSettings: () => SETTINGS }
})

const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3])

test('Remix voices: one OpenRouter request per voice, then served from the cache', async () => {
  const calls = []
  const speak = async (request, options) => { calls.push({ request, key: options.key }); await new Promise((r) => setTimeout(r, 20)); return MP3 }
  // Two clicks at once share one request.
  const [a, b] = await Promise.all([samples.voiceSample({ kind: 'remix', voice: 'nova' }, { speak }), samples.voiceSample({ kind: 'remix', voice: 'nova' }, { speak })])
  assert.deepEqual([...a], [...MP3])
  assert.deepEqual([...b], [...MP3])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].key, 'or-key')
  assert.equal(calls[0].request.model, samples.REMIX_TTS_MODEL)
  assert.equal(calls[0].request.voice, 'nova')
  assert.equal(calls[0].request.input, samples.SAMPLE_TEXT)
  await samples.voiceSample({ kind: 'remix', voice: 'nova' }, { speak })
  assert.equal(calls.length, 1, 'replayed from disk')
})

test('Avatar voices: ElevenLabs presets and the avatar clone, both on OpenRouter', async () => {
  const calls = []
  const speak = async (request) => { calls.push(request); return MP3 }
  await samples.voiceSample({ kind: 'avatar', voice: { provider: 'elevenlabs', voice: 'Brian' } }, { speak })
  assert.equal(calls[0].model, 'elevenlabs/eleven-v3')
  assert.equal(calls[0].voice, 'brian')
  await samples.voiceSample({ kind: 'avatar', voice: { provider: 'clone', clonedAt: '2026-10-14T10:00:00Z' }, avatarId: 'abcdef1234567890' }, { speak })
  assert.equal(calls[1].model, 'fish-audio/s2.1-pro')
  // A new clone is a new sample.
  AVATARS.abcdef1234567890.clonedVoice.clonedAt = '2026-10-15T09:00:00Z'
  await samples.voiceSample({ kind: 'avatar', voice: { provider: 'clone', clonedAt: '2026-10-15T09:00:00Z' }, avatarId: 'abcdef1234567890' }, { speak })
  assert.equal(calls.length, 3)
  await assert.rejects(samples.voiceSample({ kind: 'avatar', voice: { provider: 'clone', clonedAt: 'x' } }, { speak }), /Choose an avatar/)
  await assert.rejects(samples.voiceSample({ kind: 'avatar', voice: { provider: 'elevenlabs', voice: 'Nobody' } }, { speak }), /Choose a voice/)
})

test('failures pass through and leave nothing in the cache; no key, no request', async () => {
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'onyx' }, { speak: async () => { throw new Error('OpenRouter reports insufficient credits.') } }), /insufficient credits/)
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'robot' }), /Choose a voice/)
  await assert.rejects(samples.voiceSample({ kind: 'other', voice: 'nova' }), /Choose a voice/)
  const files = fs.existsSync(path.join(userData, 'voice-samples')) ? fs.readdirSync(path.join(userData, 'voice-samples')) : []
  assert.equal(files.filter((f) => f.endsWith('.part')).length, 0)
  SETTINGS.openrouterApiKey = ''
  let called = false
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'echo' }, { speak: async () => { called = true; return MP3 } }), /OpenRouter key/)
  assert.equal(called, false)
  SETTINGS.openrouterApiKey = 'or-key'
})
