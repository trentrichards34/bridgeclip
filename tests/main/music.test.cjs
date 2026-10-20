// Background music and voice cleanup: the shared request fields, the member's music library (copy in, remove, play,
// settings), and the "audio" option Create, Edit my recording and Remix send the engine.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, setImmediate, process, AbortController,
    __dirname: dir,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/music.ts')

function library(userData) {
  return load('main/music.ts', { electron: { app: { getPath: () => userData, isPackaged: false } } })
}

test('track ids: the built-in tracks and plain file names in the music folder, nothing else', () => {
  assert.deepEqual(plain(shared.MUSIC_TRACKS.map((t) => t.id)), ['calm-pad', 'upbeat-pulse', 'lofi-beat', 'cinematic-swell'])
  for (const ok of ['calm-pad', 'my:song.mp3', 'my:My Track (2).M4A', 'my:take_1.wav']) assert.ok(shared.isMusicTrackId(ok), ok)
  for (const bad of ['', 'calm', 'my:', 'my:../x.mp3', 'my:a/b.mp3', 'my:.hidden.mp3', 'my:song.ogg', 'my:song', 'song.mp3', 5, null, 'my:' + 'a'.repeat(121) + '.mp3']) {
    assert.equal(shared.isMusicTrackId(bad), false, String(bad))
  }
  assert.equal(shared.musicTrackLabel('lofi-beat'), 'Lo-fi beat')
  assert.equal(shared.musicTrackLabel('my:Intro theme.mp3'), 'Intro theme')
  assert.equal(shared.musicTrackLabel(null), 'None')
  // The built-in files are there, and their list matches the engine's.
  const listing = JSON.parse(fs.readFileSync(path.join(__dirname, '../../engine/assets/music/tracks.json'), 'utf8')).tracks
  assert.deepEqual(listing.map((t) => [t.id, t.name, t.mood]), plain(shared.MUSIC_TRACKS.map((t) => [t.id, t.name, t.mood])))
})

test('the sound fields: booleans, music needs a track, a track without music is dropped', () => {
  assert.deepEqual(plain(shared.parseAudioChoice({})), {})
  assert.deepEqual(plain(shared.parseAudioChoice({ voiceCleanup: false, music: false, musicTrack: 'calm-pad' })), {})
  assert.deepEqual(plain(shared.parseAudioChoice({ voiceCleanup: true, music: true, musicTrack: 'my:song.mp3' })), { voiceCleanup: true, music: true, musicTrack: 'my:song.mp3' })
  assert.throws(() => shared.parseAudioChoice({ voiceCleanup: 'yes' }), /clean up the voice/)
  assert.throws(() => shared.parseAudioChoice({ music: true }), /Choose the music/)
  assert.throws(() => shared.parseAudioChoice({ music: 1, musicTrack: 'calm-pad' }), /add music/)
  assert.throws(() => shared.parseAudioChoice({ music: true, musicTrack: '../../etc/passwd' }), /Choose the music/)
  assert.deepEqual(plain(shared.parseMusicSettings({ levelDb: -24.4, duringTheirClip: true })), { levelDb: -24, duringTheirClip: true })
  assert.deepEqual(plain(shared.parseMusicSettings(null)), { levelDb: -20, duringTheirClip: false })
  for (const bad of [{ levelDb: -40 }, { levelDb: 0 }, { levelDb: '20' }, { levelDb: NaN }, { duringTheirClip: 'on' }]) assert.throws(() => shared.parseMusicSettings(bad))
})

test('my music: files are copied in under safe names (MP3, WAV, M4A up to 30 MB), played, removed, and resolved for the engine', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-music-'))
  const sources = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-music-src-'))
  const lib = library(userData)
  const song = path.join(sources, 'My Song ✨.mp3')
  const notes = path.join(sources, 'notes.txt')
  const big = path.join(sources, 'big.wav')
  const empty = path.join(sources, 'empty.m4a')
  fs.writeFileSync(song, 'ID3 music')
  fs.writeFileSync(notes, 'x')
  fs.writeFileSync(empty, '')
  const handle = fs.openSync(big, 'w')
  fs.ftruncateSync(handle, shared.MAX_MUSIC_BYTES + 1)
  fs.closeSync(handle)

  assert.deepEqual(plain((await lib.listMusic()).own), [])
  const first = await lib.addMusic([song, notes, big, empty, path.join(sources, 'missing.mp3')])
  assert.deepEqual(plain(first.added), ['my:My Song.mp3'])
  assert.deepEqual(plain(first.skipped), ['notes.txt', 'big.wav', 'empty.m4a', 'missing.mp3'])
  assert.deepEqual(plain(first.library.own), [{ id: 'my:My Song.mp3', name: 'My Song', sizeBytes: 9 }])
  const again = await lib.addMusic([song])
  assert.deepEqual(plain(again.added), ['my:My Song (2).mp3'])
  for (const track of again.library.own) assert.ok(shared.isMusicTrackId(track.id), track.id)

  // The play button gets the bytes (never a path): own tracks and the built-in ones.
  const preview = await lib.musicPreview('my:My Song.mp3')
  assert.equal(preview.mime, 'audio/mpeg')
  assert.equal(Buffer.from(preview.data).toString(), 'ID3 music')
  const builtIn = await lib.musicPreview('calm-pad')
  assert.equal(builtIn.mime, 'audio/ogg')
  assert.equal(Buffer.from(builtIn.data.slice(0, 4)).toString(), 'OggS')
  await assert.rejects(lib.musicPreview('../settings.json'), /Choose one of the tracks/)

  // For the engine: a built-in track by id, the member's own by its path in the music folder.
  assert.deepEqual(plain(lib.resolveMusic('lofi-beat')), { track: 'lofi-beat' })
  assert.deepEqual(plain(lib.resolveMusic('my:My Song.mp3')), { path: path.join(userData, 'music', 'My Song.mp3') })
  await lib.removeMusic('my:My Song.mp3')
  assert.throws(() => lib.resolveMusic('my:My Song.mp3'), /no longer in your music/)
  await assert.rejects(lib.removeMusic('calm-pad'), /one of your tracks/)
  await assert.rejects(lib.removeMusic('my:../x.mp3'), /one of your tracks/)
  assert.deepEqual(plain((await lib.listMusic()).own.map((t) => t.id)), ['my:My Song (2).mp3'])
})

test('the music settings are saved beside the files and shape the engine option', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-music-settings-'))
  const lib = library(userData)
  assert.equal(lib.audioForEngine({}), undefined)
  assert.equal(lib.audioForEngine({ music: true }), undefined)
  assert.deepEqual(plain(lib.audioForEngine({ voiceCleanup: true })), { voice_cleanup: true })
  assert.deepEqual(plain(lib.audioForEngine({ music: true, musicTrack: 'calm-pad' })), { voice_cleanup: false, music: { track: 'calm-pad' }, music_level_db: -20 })
  const saved = await lib.saveMusicSettings({ levelDb: -26, duringTheirClip: true })
  assert.deepEqual(plain(saved.settings), { levelDb: -26, duringTheirClip: true })
  assert.deepEqual(plain(lib.audioForEngine({ voiceCleanup: true, music: true, musicTrack: 'upbeat-pulse' }, true)),
    { voice_cleanup: true, music: { track: 'upbeat-pulse' }, music_level_db: -26, music_during_clip: true })
  await assert.rejects(lib.saveMusicSettings({ levelDb: 5 }), /between -30 and -10/)
  assert.throws(() => lib.audioForEngine({ music: true, musicTrack: 'my:gone.mp3' }), /no longer in your music/)
  // A damaged settings file falls back to the defaults.
  fs.writeFileSync(path.join(userData, 'music', 'settings.json'), '{')
  assert.deepEqual(plain(lib.readMusicSettings()), { levelDb: -20, duringTheirClip: false })
})

test('Create: the switch and the track ride along on the request, checked', () => {
  const validation = load('main/validation.ts', { './security': { isWebUrl: (v) => typeof v === 'string' && v.startsWith('https://') } })
  const base = { videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', autoClipCount: true, includeCaptions: true, layoutVision: true, maxClips: null,
    aspectRatio: '9:16', layoutStyle: 'auto', pacing: 'tight', captionPreset: 'pop', durationRanges: null, startTimeSeconds: null, endTimeSeconds: null,
    bannerPlatform: null, bannerChannelUrl: null }
  const plainRun = validation.validateJobConfig(base)
  assert.equal('voiceCleanup' in plainRun || 'music' in plainRun || 'musicTrack' in plainRun, false)
  const run = validation.validateJobConfig({ ...base, voiceCleanup: true, music: true, musicTrack: 'cinematic-swell' })
  assert.deepEqual([run.voiceCleanup, run.music, run.musicTrack], [true, true, 'cinematic-swell'])
  const off = validation.validateJobConfig({ ...base, voiceCleanup: false, music: false, musicTrack: 'calm-pad' })
  assert.equal('musicTrack' in off || 'voiceCleanup' in off, false)
  assert.equal(validation.validateJobConfig({ ...base, music: true }).musicTrack, 'calm-pad', 'music on without a pick gets the first built-in track')
  assert.throws(() => validation.validateJobConfig({ ...base, voiceCleanup: 'on' }), /clean up the voice/)
})

test('Remix: the request keeps the sound fields and the run sends the engine its "audio" option', async () => {
  const { EventEmitter } = require('node:events')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-music-'))
  const configs = []
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      configs.push(JSON.parse(text))
      setImmediate(() => { child.stdout.emit('data', JSON.stringify({ ok: false, error: 'stopped for the test' }) + '\n'); child.emit('close', 1) })
    } }
    return child
  }
  const remix = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...require('node:child_process'), spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => ({ openrouterApiKey: 'k', outputDirectory: out, pythonPath: 'python3' }), getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const base = { sources: ['https://www.youtube.com/watch?v=abcdefghijk'], creator: '', angle: 'reaction', order: 'moment_first', host: 'camera', avatarId: null,
    voice: 'avatar', brandIdentityId: null, count: 1, captionPreset: 'pop', includeCaptions: true, aiLabelAck: false }
  const parsed = remix.parseRemixRequest({ ...base, voiceCleanup: true, music: true, musicTrack: 'lofi-beat' }, out).request
  assert.deepEqual([parsed.voiceCleanup, parsed.music, parsed.musicTrack], [true, true, 'lofi-beat'])
  assert.equal('music' in remix.parseRemixRequest(base, out).request, false)
  assert.throws(() => remix.parseRemixRequest({ ...base, music: true, musicTrack: 'nope' }, out), /Choose the music/)
  await remix.startRemix({ ...base, voiceCleanup: true, music: true, musicTrack: 'lofi-beat' })
  for (let i = 0; i < 100 && !configs.length; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(configs[0].audio, { voice_cleanup: true, music: { track: 'lofi-beat' }, music_level_db: -20, music_during_clip: false })
  for (let i = 0; i < 100 && remix.remixStatus()?.phase === 'planning'; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  // A track of their own that's gone stops the run before anything starts.
  await assert.rejects(remix.startRemix({ ...base, music: true, musicTrack: 'my:gone.mp3' }), /no longer in your music/)
})
