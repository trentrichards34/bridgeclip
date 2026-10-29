// Screen share clips: the member's choice (Smart mix, Split screen, Presenter only) on Create requests,
// remembered styles, More clips, and the per-clip decision the Library reads back.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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

const security = { isWebUrl: (url) => /^https?:\/\//.test(url) }
const base = {
  workflow: 'automatic', videoUrl: 'https://example.com/v', maxClips: null, autoClipCount: true, durationRanges: null, aspectRatio: '9:16', layoutStyle: 'auto',
  layoutVision: false, pacing: 'tight', includeCaptions: true, captionPreset: 'pop', startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null
}

test('Create requests: the screen share choice is one of three, and optional', () => {
  const { validateJobConfig } = load('main/validation.ts', { './security': security })
  for (const screenFocus of ['smart', 'split', 'presenter']) assert.equal(validateJobConfig({ ...base, screenFocus }).screenFocus, screenFocus)
  assert.equal('screenFocus' in validateJobConfig(base), false)
  for (const screenFocus of ['mixed', '', 'Presenter', 1, null]) {
    assert.throws(() => validateJobConfig({ ...base, screenFocus }), /screen share framing/)
  }
})

test('remembered styles keep the screen share choice', () => {
  const prefs = load('shared/member-prefs.ts')
  assert.deepEqual(plain(prefs.parseCreateStyle({ screenFocus: 'presenter', layoutStyle: 'auto' })), { layoutStyle: 'auto', screenFocus: 'presenter' })
  assert.deepEqual(plain(prefs.parseCreateStyle({ screenFocus: 'mixed' })), {})
  assert.ok(prefs.CREATE_STYLE_KEYS.includes('screenFocus'))
  assert.deepEqual(plain(prefs.pickStyle('create', { screenFocus: 'split', source: 'x' })), { screenFocus: 'split' })
})

test('More clips from an older run reads the choice its metrics recorded', () => {
  const moreClips = load('main/more-clips.ts', {
    './security': security, './file-manager': {}, './settings-store': { loadSettings: () => ({}) }
  })
  const output = (settings) => ({ job_id: 'x', source_video_url: 'https://example.com/v', source_video_title: 't', source_video_duration_seconds: 60, clips: [],
    metrics: { requested_settings: settings } })
  assert.equal(moreClips.requestFromOutput(output({ screen_focus: 'presenter' })).screenFocus, 'presenter')
  assert.equal('screenFocus' in moreClips.requestFromOutput(output({ screen_focus: 'weird' })), false)
  // The headline voice is read back too (More clips and the editor keep writing in the creator's voice).
  assert.equal(moreClips.requestFromOutput(output({ headline_voice: 'creator' })).headlineVoice, 'creator')
  assert.equal('headlineVoice' in moreClips.requestFromOutput(output({ headline_voice: 'first' })), false)
  const { parseJobOutput } = load('shared/job-output.ts')
  const kept = parseJobOutput({ ...output({ headline_voice: 'creator' }), metrics: { requested_settings: { headline_voice: 'creator' } } })
  assert.equal(kept.metrics.requested_settings.headline_voice, 'creator')
  assert.equal(parseJobOutput(output({ headline_voice: 'third' })).metrics.requested_settings.headline_voice, undefined)
})

test('job output: each clip’s screen share decision is kept, bounded and checked', () => {
  const { parseJobOutput } = load('shared/job-output.ts')
  const output = parseJobOutput({
    job_id: 'j', source_video_url: 'https://example.com/v', source_video_title: 't', source_video_duration_seconds: 60, total_clips: 0, clips: [],
    metrics: {
      requested_settings: { screen_focus: 'split' },
      clip_layouts: [
        { clip_index: 0, layout_type: 'talking_head', screen_focus: { decision: 'presenter', reason: 'A story about quitting ads', source: 'planner', mode: 'smart', person_fits: true, extra: 1 } },
        { clip_index: 1, layout_type: 'screen_cam', screen_focus: { decision: 'mixed', reason: 'x'.repeat(500), source: '??', mode: 'nope' } },
        { clip_index: 2, layout_type: 'screen_cam', screen_focus: { decision: 'split' } },
        { clip_index: 3, layout_type: 'talking_head', screen_focus: null }
      ]
    }
  })
  const layouts = output.metrics.clip_layouts
  assert.deepEqual(plain(layouts[0].screen_focus), { decision: 'presenter', reason: 'A story about quitting ads', source: 'planner', mode: 'smart', person_fits: true })
  assert.deepEqual(plain(layouts[1].screen_focus), { decision: 'mixed', reason: 'x'.repeat(200), source: 'default', mode: 'smart', person_fits: true })
  assert.equal(layouts[2].screen_focus, undefined)
  assert.equal(layouts[3].screen_focus, undefined)
  assert.equal(output.metrics.requested_settings.screen_focus, 'split')
})
