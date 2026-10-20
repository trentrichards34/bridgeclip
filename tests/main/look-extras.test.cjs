// Look extras (motion effects members pick on Create, Remix and Edit my recording): the request field is
// checked in main and reaches the engine as `look_extras` (with the brand color they use); older requests have none.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const engine = load('shared/look-extras-engine.ts')

test('the extras field: missing is none, unknown ids are dropped, anything but a list is refused', () => {
  assert.deepEqual(plain(engine.parseLookExtrasField(undefined)), [])
  assert.deepEqual(plain(engine.parseLookExtrasField(null)), [])
  assert.deepEqual(plain(engine.parseLookExtrasField(['progress_bar', 'glow', 'punch_zoom', 'progress_bar', 7])), ['punch_zoom', 'progress_bar'])
  for (const bad of ['punch_zoom', { punch_zoom: true }, 3, Array(33).fill('punch_zoom')]) {
    assert.throws(() => engine.parseLookExtrasField(bad), /extras/)
  }
})

test('engine fields: the extras and the brand color (else the brand hook bar color), nothing when none are picked', () => {
  assert.deepEqual(plain(engine.lookExtrasForEngine(undefined, '#2f6bff')), {})
  assert.deepEqual(plain(engine.lookExtrasForEngine([], '#2f6bff')), {})
  assert.deepEqual(plain(engine.lookExtrasForEngine(['progress_bar'], '#2f6bff', { look: 'brand', color: '#FF0000', font: 'clean' })),
    { look_extras: ['progress_bar'], look_extras_color: '#2F6BFF' })
  assert.deepEqual(plain(engine.lookExtrasForEngine(['keyword_pill'], null, { look: 'brand', color: '#ff8800', font: 'clean' })),
    { look_extras: ['keyword_pill'], look_extras_color: '#FF8800' })
  // A white or black bar isn't a brand color: each effect's own default.
  assert.deepEqual(plain(engine.lookExtrasForEngine(['keyword_pill'], 'red', { look: 'white', color: '#FFFFFF', font: 'clean' })), { look_extras: ['keyword_pill'] })
})

test('a screenshot highlight: four shares of the picture, inside it', () => {
  assert.equal(engine.parseImageHighlight(undefined), undefined)
  assert.deepEqual(plain(engine.parseImageHighlight({ x: 0.1, y: 0.2, w: 0.3, h: 0.05 })), { x: 0.1, y: 0.2, w: 0.3, h: 0.05 })
  for (const bad of [[0, 0, 1, 1], { x: 0.9, y: 0, w: 0.2, h: 0.1 }, { x: 0, y: 0, w: 0, h: 0.1 }, { x: 0, y: 0, w: 0.1, h: 0.1, z: 1 }, { x: '0', y: 0, w: 0.1, h: 0.1 }, { x: NaN, y: 0, w: 0.1, h: 0.1 }]) {
    assert.throws(() => engine.parseImageHighlight(bad), /Mark the number/)
  }
})

test('Create requests keep extras for Automatic runs only, and older requests have none', () => {
  const { validateJobConfig } = load('main/validation.ts', { './security': { isWebUrl: (url) => /^https?:\/\//.test(url) } })
  const base = {
    workflow: 'automatic', videoUrl: 'https://example.com/v', maxClips: null, autoClipCount: true, durationRanges: null, aspectRatio: '9:16', layoutStyle: 'auto',
    layoutVision: false, pacing: 'tight', includeCaptions: true, captionPreset: 'pop', startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null
  }
  assert.equal('lookExtras' in validateJobConfig(base), false)
  assert.deepEqual(plain(validateJobConfig({ ...base, lookExtras: ['comment_box', 'glow', 'keyword_pill'] }).lookExtras), ['keyword_pill', 'comment_box'])
  assert.equal('lookExtras' in validateJobConfig({ ...base, lookExtras: [] }), false)
  assert.equal('lookExtras' in validateJobConfig({ ...base, workflow: 'review', lookExtras: ['progress_bar'] }), false)
  assert.throws(() => validateJobConfig({ ...base, lookExtras: 'progress_bar' }), /extras/)
})

test('Remix requests carry the extras and, for a screenshot, the highlight', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'look-extras-remix-'))
  const main = load('main/remix.ts', {
    electron: { app: { getPath: () => userData } },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => ({}), readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined },
    './settings-store': { loadSettings: () => ({ outputDirectory: userData }), getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const base = {
    sources: ['https://www.youtube.com/watch?v=abcdefghijk'], creator: '', angle: 'reaction', order: 'moment_first', host: 'lipsync', avatarId: 'a'.repeat(16),
    voice: 'avatar', brandIdentityId: null, count: 3, captionPreset: 'pop', includeCaptions: true, aiLabelAck: true
  }
  assert.equal('lookExtras' in main.parseRemixRequest(base, userData).request, false)
  const picked = main.parseRemixRequest({ ...base, lookExtras: ['broll_tags', 'punch_zoom'], imageHighlight: { x: 0, y: 0, w: 1, h: 1 } }, userData).request
  assert.deepEqual(plain(picked.lookExtras), ['punch_zoom', 'broll_tags'])
  assert.equal('imageHighlight' in picked, false) // only a screenshot has one
  assert.throws(() => main.parseRemixRequest({ ...base, lookExtras: 'punch_zoom' }, userData), /extras/)
  fs.rmSync(userData, { recursive: true, force: true })
})
