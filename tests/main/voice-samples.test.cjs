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
const SETTINGS = { openrouterApiKey: 'or-key', falApiKey: 'fal-key' }
const samples = load('main/voice-samples.ts', {
  electron: { app: { getPath: () => userData, isPackaged: false } },
  './fal': { falRun: async () => { throw new Error('not mocked') }, falFileUrl: (output) => output.audio.url, downloadFalFile: async () => { throw new Error('not mocked') } },
  './settings-store': { loadSettings: () => SETTINGS }
})

const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3])

test('Remix voices: one OpenRouter call per voice, then served from the cache', async () => {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization })
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { ok: true, status: 200, arrayBuffer: async () => MP3.buffer.slice(0) }
  }
  // Two clicks at once share one request.
  const [a, b] = await Promise.all([samples.voiceSample({ kind: 'remix', voice: 'nova' }, { fetch }), samples.voiceSample({ kind: 'remix', voice: 'nova' }, { fetch })])
  assert.deepEqual([...a], [...MP3])
  assert.deepEqual([...b], [...MP3])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/audio/speech')
  assert.equal(calls[0].auth, 'Bearer or-key')
  assert.equal(calls[0].body.model, samples.REMIX_TTS_MODEL)
  assert.equal(calls[0].body.voice, 'nova')
  assert.equal(calls[0].body.input, samples.SAMPLE_TEXT)
  // Replays come from disk.
  await samples.voiceSample({ kind: 'remix', voice: 'nova' }, { fetch })
  assert.equal(calls.length, 1)
  assert.equal(fs.readdirSync(path.join(userData, 'voice-samples')).filter((f) => f.endsWith('.mp3')).length, 1)
})

test('failures explain themselves and leave nothing half-written in the cache', async () => {
  const failing = (status) => async () => ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) })
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'onyx' }, { fetch: failing(402) }), /insufficient credits/)
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'onyx' }, { fetch: failing(401) }), /rejected the API key/)
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'onyx' }, { fetch: async () => { throw new Error('offline') } }), /could not be reached/)
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'onyx' }, { fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }) }), /unusable/)
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'robot' }), /Choose a voice/)
  await assert.rejects(samples.voiceSample({ kind: 'other', voice: 'nova' }), /Choose a voice/)
  assert.equal(fs.readdirSync(path.join(userData, 'voice-samples')).filter((f) => f.endsWith('.part')).length, 0)
  SETTINGS.openrouterApiKey = ''
  await assert.rejects(samples.voiceSample({ kind: 'remix', voice: 'onyx' }, { fetch: failing(500) }), /OpenRouter key/)
  SETTINGS.openrouterApiKey = 'or-key'
})

test('Avatar voices: ElevenLabs presets and cloned voices through fal', async () => {
  const runs = []
  const falRun = async (model, input, options) => { runs.push({ model, input, key: options.key }); return { audio: { url: 'https://v3.fal.media/files/sample.mp3' } } }
  const download = async (url, destination) => { fs.writeFileSync(destination, Buffer.from(MP3)) }
  const preset = await samples.voiceSample({ kind: 'avatar', voice: { provider: 'elevenlabs', voice: 'Brian' } }, { falRun, download })
  assert.deepEqual([...preset], [...MP3])
  assert.equal(runs[0].model, 'fal-ai/elevenlabs/tts/eleven-v3')
  assert.equal(runs[0].input.voice, 'Brian')
  assert.equal(runs[0].key, 'fal-key')
  await samples.voiceSample({ kind: 'avatar', voice: { provider: 'minimax-clone', voiceId: 'voice_abc', clonedAt: '2026-10-01' } }, { falRun, download })
  assert.equal(runs[1].model, 'fal-ai/minimax/speech-2.8-hd')
  assert.equal(runs[1].input.voice_setting.voice_id, 'voice_abc')
  await samples.voiceSample({ kind: 'avatar', voice: { provider: 'elevenlabs', voice: 'Brian' } }, { falRun, download })
  assert.equal(runs.length, 2, 'cached')
  await assert.rejects(samples.voiceSample({ kind: 'avatar', voice: { provider: 'elevenlabs', voice: 'Nobody' } }, { falRun, download }), /Choose a voice/)
  SETTINGS.falApiKey = ''
  await assert.rejects(samples.voiceSample({ kind: 'avatar', voice: { provider: 'elevenlabs', voice: 'Sarah' } }, { falRun, download }), /fal\.ai key/)
  SETTINGS.falApiKey = 'fal-key'
})
