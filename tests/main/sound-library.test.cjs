// Sound design in main: My sounds (copy in under safe names, tag with an action, play, move, remove, hand to the
// engine), the IPC checks, an editor clip's saved sounds, and the events a bake sends the engine.
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

const shared = load('shared/sound-design.ts')
const editor = load('shared/clip-editor.ts')

function library(userData) {
  return load('main/sound-library.ts', { electron: { app: { getPath: () => userData } } })
}

function tempDirs() {
  return { userData: fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sounds-')), sources: fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sounds-src-')) }
}

test('sound ids: an action and a plain file name, nothing else', () => {
  for (const ok of ['whoosh/swoosh.mp3', 'pop/My Pop (2).WAV', 'riser/build_up.ogg', 'tick/key.m4a']) assert.ok(shared.parseOwnSoundId(ok), ok)
  for (const bad of ['', 'whoosh', 'whoosh/', 'laser/zap.mp3', 'whoosh/../x.mp3', 'whoosh/a/b.mp3', 'whoosh/.hidden.mp3', 'whoosh/x.exe',
    '../whoosh/x.mp3', '/whoosh/x.mp3', 'pop/' + 'a'.repeat(121) + '.wav', 5, null]) {
    assert.equal(shared.parseOwnSoundId(bad), null, String(bad))
  }
  assert.deepEqual(plain(shared.SOUND_ACTIONS), ['whoosh', 'swipe', 'pop', 'tick', 'click', 'impact', 'riser', 'paper'])
  // The same actions as the engine's library.
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../engine/assets/sfx/manifest.json'), 'utf8'))
  assert.deepEqual(Object.keys(manifest.actions).sort(), [...shared.SOUND_ACTIONS].sort())
})

test('my sounds: files are copied in for an action (MP3, WAV, M4A, Ogg up to 5 MB), played, moved, removed, and handed to the engine', async () => {
  const { userData, sources } = tempDirs()
  const lib = library(userData)
  const swoosh = path.join(sources, 'Big Swoosh ✨.wav')
  const notes = path.join(sources, 'notes.txt')
  const empty = path.join(sources, 'empty.mp3')
  const big = path.join(sources, 'big.ogg')
  fs.writeFileSync(swoosh, 'RIFF sound')
  fs.writeFileSync(notes, 'x')
  fs.writeFileSync(empty, '')
  const handle = fs.openSync(big, 'w')
  fs.ftruncateSync(handle, shared.MAX_SOUND_BYTES + 1)
  fs.closeSync(handle)

  await assert.rejects(lib.addSounds('laser', [swoosh]), /what the sound is for/)
  const added = await lib.addSounds('whoosh', [swoosh, notes, empty, big, path.join(sources, 'missing.wav')])
  assert.deepEqual(plain(added.added), ['whoosh/Big Swoosh.wav'])
  assert.deepEqual(plain(added.skipped), ['notes.txt', 'empty.mp3', 'big.ogg', 'missing.wav'])
  assert.deepEqual(plain(added.library.own), [{ id: 'whoosh/Big Swoosh.wav', action: 'whoosh', name: 'Big Swoosh', sizeBytes: 10 }])
  // The same file again gets its own name.
  const again = await lib.addSounds('pop', [swoosh])
  assert.deepEqual(plain(again.added), ['pop/Big Swoosh (2).wav'])

  const preview = await lib.soundPreview('whoosh/Big Swoosh.wav')
  assert.equal(preview.mime, 'audio/wav')
  assert.equal(Buffer.from(preview.data).toString(), 'RIFF sound')
  for (const bad of ['../music/x.mp3', 'whoosh/../../secret.wav', 'whoosh/nope.wav', 7]) await assert.rejects(lib.soundPreview(bad))

  // Tagged with another action: it moves to that folder, keeping its name.
  const moved = await lib.setSoundAction('whoosh/Big Swoosh.wav', 'impact')
  assert.deepEqual(plain(moved.own.map((s) => s.id)), ['pop/Big Swoosh (2).wav', 'impact/Big Swoosh.wav'])
  await assert.rejects(lib.setSoundAction('impact/Big Swoosh.wav', 'laser'), /what the sound is for/)
  await assert.rejects(lib.setSoundAction('whoosh/Big Swoosh.wav', 'pop'), /no longer/)

  assert.deepEqual(plain(lib.soundPaletteForEngine()), [
    { path: path.join(userData, 'sounds', 'pop', 'Big Swoosh (2).wav'), action: 'pop' },
    { path: path.join(userData, 'sounds', 'impact', 'Big Swoosh.wav'), action: 'impact' }
  ])
  const left = await lib.removeSound('pop/Big Swoosh (2).wav')
  assert.deepEqual(plain(left.own.map((s) => s.id)), ['impact/Big Swoosh.wav'])
  await assert.rejects(lib.removeSound('pop/../../x.wav'), /Choose one of your sounds/)
  // A stray file in a folder (not a sound name) is never listed or handed on.
  fs.writeFileSync(path.join(userData, 'sounds', 'impact', '.hidden.wav'), 'x')
  assert.equal(lib.soundPaletteForEngine().length, 1)
})

test('Add sounds: the action is checked before the file dialog opens; a cancel adds nothing', async () => {
  const { userData, sources } = tempDirs()
  const lib = library(userData)
  let dialogs = 0
  const pick = (paths) => async () => { dialogs++; return paths }
  for (const bad of ['laser', '', null, 3, '../whoosh', { action: 'pop' }]) {
    await assert.rejects(lib.addSoundsFromPicker(bad, pick([])), /what the sound is for/)
  }
  assert.equal(dialogs, 0)
  const cancelled = await lib.addSoundsFromPicker('pop', pick(null))
  assert.deepEqual(plain(cancelled), { library: { own: [] }, added: [], skipped: [] })
  const file = path.join(sources, 'tap.mp3')
  fs.writeFileSync(file, 'ID3')
  const many = Array.from({ length: 25 }, () => file)
  const result = await lib.addSoundsFromPicker('click', pick(many))
  // At most 20 files a time from one dialog.
  assert.equal(result.added.length + result.skipped.length, 20)
  assert.equal(dialogs, 2)
})

test('an editor clip keeps its sounds: checked, and part of what a bake renders', () => {
  const sound = { on: true, register: 'story', music_db: -20, cues: [{ at_ms: 1500, kind: 'punch' }, { at_ms: 4000, end_ms: 6000, kind: 'broll' }, { at_ms: 7000, kind: 'extra', sound: 'ding' }] }
  assert.deepEqual(plain(shared.parseCandidateSound(sound, 10000)), sound)
  for (const bad of [null, [], { on: 'yes', register: 'story' }, { on: true, register: 'loud' }, { on: true, register: 'story', music_db: 3 },
    { on: true, register: 'story', cues: [{ at_ms: 20000, kind: 'punch' }] }, { on: true, register: 'story', cues: [{ at_ms: 5, kind: 'graphic' }] },
    { on: true, register: 'story', cues: [{ at_ms: 5, end_ms: 2, kind: 'broll' }] }, { on: true, register: 'story', cues: [{ at_ms: 5, kind: 'extra', sound: 'laser' }] }]) {
    assert.throws(() => shared.parseCandidateSound(bad, 10000), /Invalid sound/, JSON.stringify(bad))
  }
  const clip = { id: 'c1', title: 'Reel', ranges: [[0, 10000]], scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: true,
    caption_preset: 'pop', video_speed: 1, status: 'ready', caption_edits: [], caption_suppression_ranges: [], sound }
  const parsed = editor.parseCandidateEdit(clip, 10000, 0)
  assert.deepEqual(plain(parsed.sound), sound)
  assert.deepEqual(plain(editor.candidateEdit(parsed).sound), sound)
  // A new register means a new render.
  assert.notEqual(editor.renderEditKey(parsed), editor.renderEditKey({ ...parsed, sound: { ...sound, register: 'teaching' } }))
  assert.equal(editor.refineEdit(parsed, { sound: { ...sound, on: false } }).status, 'refining')
})

test('a bake sends what happens on the finished clip: the hook, graphics, stage scenes and the clip\'s cues through its cuts', () => {
  const clip = {
    ranges: [[0, 4000], [6000, 12000]], video_speed: 1,
    graphics: [
      { id: 'g-stat', template: 'stat', at_ms: 1000, duration_ms: 2000, placement: 'top', fields: { value: '15', label: 'clients' } },
      { id: 'g-cut1', template: 'title', at_ms: 4200, duration_ms: 1500, placement: 'top', fields: { text: 'Gone' } },
      { id: 'g-empty', template: 'title', at_ms: 7000, duration_ms: 2000, placement: 'top', fields: { text: ' ' } },
      { id: 'g-cta', template: 'link_cta', at_ms: 9000, duration_ms: 2500, placement: 'bottom', size: 'stage', fields: { text: 'Click the link', label: 'Get it' } }
    ],
    stage_scenes: [{ scene: 'stage', start_ms: 6500, end_ms: 8500 }],
    sound: { on: true, register: 'teaching', cues: [{ at_ms: 2000, kind: 'punch' }, { at_ms: 5000, kind: 'punch' }, { at_ms: 7000, end_ms: 9000, kind: 'broll' }, { at_ms: 10000, kind: 'extra', sound: 'pop' }] }
  }
  const events = plain(shared.bakeSoundEvents(clip, true))
  const brief = events.map((e) => [e.kind, e.at_ms, e.template ?? e.sound ?? ''])
  assert.deepEqual(brief, [['hook', 0, ''], ['graphic', 1000, 'stat'], ['punch', 2000, ''], ['scene', 4500, ''], ['broll', 5000, ''],
    ['graphic', 7000, 'link_cta'], ['extra', 8000, 'pop']])
  assert.equal(events.find((e) => e.template === 'link_cta').size, 'stage')
  assert.equal(events.find((e) => e.kind === 'broll').end_ms, 7000)
  // No hook drawn: no hook sound.
  assert.equal(shared.bakeSoundEvents(clip, false).some((e) => e.kind === 'hook'), false)
})
