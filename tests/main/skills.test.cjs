const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Skills (one on/off list over existing settings) and "Say what it's for" (purpose and reference image).

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function load(relative) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, { module, exports: module.exports, URL, console, require: (id) => id.startsWith('.') ? load(path.relative(ROOT, path.join(dir, id)) + '.ts') : require(id) })
  return module.exports
}

const skills = load('shared/skills.ts')
const purpose = load('shared/purpose.ts')
const prefs = load('shared/member-prefs.ts')

const CREATE = { pacing: 'tight', includeCaptions: true, motionGraphics: false, lookExtras: ['keyword_pill'], broll: 'off', backgroundVideo: 'minecraft.mp4', music: false, voiceCleanup: false }
const on = (rows) => plain(Object.fromEntries(rows.map((row) => [row.id, row.on])))

test('Create: every skill reads and writes the existing field, and turning it back restores the same fields', () => {
  const rows = skills.createSkillRows(CREATE, { pexels: true })
  assert.deepEqual(plain(rows.map((row) => row.id)), ['rough_cut', 'captions', 'motion_graphics', 'stage_layouts', 'zoom', 'broll', 'music', 'voice_cleanup'])
  assert.deepEqual(on(rows), { rough_cut: true, captions: true, motion_graphics: false, stage_layouts: false, zoom: false, broll: false, music: false, voice_cleanup: false })
  const fields = { rough_cut: ['pacing'], captions: ['includeCaptions'], motion_graphics: ['motionGraphics'], zoom: ['lookExtras'], broll: ['broll', 'backgroundVideo'], music: ['music'], voice_cleanup: ['voiceCleanup'] }
  // (Stage layouts ride on motion graphics: their own test below.)
  for (const row of rows.filter((item) => item.id !== 'stage_layouts')) {
    const flipped = { ...CREATE, ...skills.createSkillPatch(CREATE, row.id, !row.on) }
    // Only the skill's own fields change (nothing else is stored for the panel)...
    const changed = Object.keys(CREATE).filter((key) => JSON.stringify(flipped[key]) !== JSON.stringify(CREATE[key]))
    assert.ok(changed.length > 0 && changed.every((key) => fields[row.id].includes(key)), `${row.id} changed ${changed}`)
    // ...and the panel reads the change straight back from them.
    assert.equal(on(skills.createSkillRows(flipped, { pexels: true }))[row.id], !row.on)
    const back = { ...flipped, ...skills.createSkillPatch(flipped, row.id, row.on) }
    assert.equal(on(skills.createSkillRows(back, { pexels: true }))[row.id], row.on)
  }
  // Zoom is one extra among the others; Rough cut is "Cut dead air".
  assert.deepEqual(plain(skills.createSkillPatch(CREATE, 'zoom', true).lookExtras), ['punch_zoom', 'keyword_pill'])
  assert.deepEqual(plain(skills.createSkillPatch({ ...CREATE, lookExtras: ['punch_zoom', 'keyword_pill'] }, 'zoom', false).lookExtras), ['keyword_pill'])
  assert.deepEqual(plain(skills.createSkillPatch(CREATE, 'rough_cut', false)), { pacing: 'natural' })
  // B-roll: after the hook by default, a mode already picked is kept, and the gameplay background gives way.
  assert.deepEqual(plain(skills.createSkillPatch(CREATE, 'broll', true)), { broll: 'after-hook', backgroundVideo: null })
  assert.equal(skills.createSkillPatch({ ...CREATE, broll: 'full' }, 'broll', true).broll, 'full')
})

test('Create: the switch shows what a detailed control set, with no copy of its own', () => {
  // Changing the field elsewhere (the style board, the Format step) is what the panel shows.
  assert.equal(on(skills.createSkillRows({ ...CREATE, includeCaptions: false }, { pexels: true })).captions, false)
  assert.equal(on(skills.createSkillRows({ ...CREATE, pacing: 'natural' }, { pexels: true })).rough_cut, false)
  assert.equal(on(skills.createSkillRows({ ...CREATE, broll: 'full' }, { pexels: true })).broll, true)
  // B-roll needs a Pexels key to turn on (it can still be turned off).
  const noKey = skills.createSkillRows(CREATE, { pexels: false }).find((row) => row.id === 'broll')
  assert.match(noKey.disabledReason, /Pexels/)
  assert.equal(skills.createSkillRows({ ...CREATE, broll: 'after-hook' }, { pexels: false }).find((row) => row.id === 'broll').disabledReason, null)
  // Stage layouts, music and voice cleanup carry the Beta chip.
  assert.deepEqual(plain(skills.createSkillRows(CREATE, { pexels: true }).filter((row) => row.beta).map((row) => row.id)), ['stage_layouts', 'music', 'voice_cleanup'])
})

test('Create: Stage layouts sit next to Motion graphics and need it, a vertical clip and no gameplay background', () => {
  const ready = { ...CREATE, backgroundVideo: null, motionGraphics: true, aspectRatio: '9:16' }
  const row = (fields) => skills.createSkillRows(fields, { pexels: true }).find((item) => item.id === 'stage_layouts')
  assert.equal(row(ready).on, false)
  assert.equal(row(ready).disabledReason, null)
  const on = { ...ready, ...skills.createSkillPatch(ready, 'stage_layouts', true) }
  assert.deepEqual(plain(skills.createSkillPatch(ready, 'stage_layouts', true)), { stageLayouts: true })
  assert.equal(row(on).on, true)
  assert.equal(skills.stageLayoutsOn(on), true)
  // Remembered, but off (and not switchable) while something blocks them.
  for (const [patch, reason] of [[{ motionGraphics: false }, /Motion graphics first/], [{ aspectRatio: '16:9' }, /vertical/], [{ backgroundVideo: 'minecraft.mp4' }, /gameplay/]]) {
    const blocked = { ...on, ...patch }
    assert.equal(row(blocked).on, false)
    assert.match(row(blocked).disabledReason, reason)
    assert.equal(skills.stageLayoutsOn(blocked), false)
  }
  assert.equal(skills.createSkillPatch(on, 'stage_layouts', false).stageLayouts, false)
})

const PLAN = { words: [{ cut: 'filler' }, { cut: null }, { cut: 'retake' }, { cut: null }, { cut: null }], sounds: [{ id: 0 }, { id: 1 }] }
const EDIT = { cut: [0, 2, 4], sounds: [{ id: 0, on: true }, { id: 1, on: false }], lookExtras: [], look: { includeCaptions: true } }

test('Edit my recording: rows only for what the plan has; Rough cut changes only the plan’s own cuts', () => {
  const context = { brollSource: 'library' }
  const rows = skills.editSkillRows(PLAN, EDIT, context)
  assert.deepEqual(plain(rows.map((row) => row.id)), ['rough_cut', 'captions', 'zoom', 'broll', 'sound_effects', 'music', 'voice_cleanup'])
  assert.deepEqual(on(rows), { rough_cut: true, captions: true, zoom: false, broll: false, sound_effects: true, music: false, voice_cleanup: false })
  assert.deepEqual(plain(skills.editSkillRows({ words: [{ cut: null }], sounds: [] }, EDIT).map((row) => row.id)), ['captions', 'zoom', 'broll', 'music', 'voice_cleanup'])
  // B-roll: on with the page's source (My library when it has shots); it can't be turned on when no source can run.
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, EDIT, 'broll', true, context)), { look: { broll: 'library' } })
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, { ...EDIT, look: { ...EDIT.look, broll: 'ai' } }, 'broll', false, context)), { look: { broll: null } })
  assert.match(skills.editSkillRows(PLAN, EDIT).find((row) => row.id === 'broll').disabledReason, /B-roll library/)
  // Off keeps the plan's cut words (word 4, cut by the member, stays cut); on cuts them again.
  const off = skills.editSkillPatch(PLAN, EDIT, 'rough_cut', false)
  assert.deepEqual(plain(off), { decisions: { cut: [4] } })
  const back = skills.editSkillPatch(PLAN, { ...EDIT, cut: [4] }, 'rough_cut', true)
  assert.deepEqual(plain(back.decisions.cut), [0, 2, 4])
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, EDIT, 'sound_effects', false).decisions.sounds), [{ id: 0, on: false }, { id: 1, on: false }])
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, EDIT, 'captions', false)), { look: { includeCaptions: false } })
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, EDIT, 'zoom', true)), { decisions: { lookExtras: ['punch_zoom'] } })
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, EDIT, 'music', true)), { look: { music: true } })
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, EDIT, 'motion_graphics', true)), { decisions: { motionGraphics: true } })
  assert.deepEqual(plain(skills.editSkillPatch(PLAN, EDIT, 'stage_layouts', false)), { decisions: { stageLayouts: false } })
  // Round trip through the same state.
  for (const row of rows) {
    const patch = skills.editSkillPatch(PLAN, EDIT, row.id, !row.on, context)
    const next = { ...EDIT, ...(patch.decisions ?? {}), look: { ...EDIT.look, ...(patch.look ?? {}) } }
    assert.equal(on(skills.editSkillRows(PLAN, next, context))[row.id], !row.on, row.id)
  }
})

test('Remix: captions, zoom, music and voice cleanup over the form’s fields', () => {
  const form = { includeCaptions: true, lookExtras: ['progress_bar'], music: false, voiceCleanup: false }
  const rows = skills.remixSkillRows(form)
  assert.deepEqual(plain(rows.map((row) => row.id)), ['captions', 'zoom', 'music', 'voice_cleanup'])
  for (const row of rows) {
    const next = { ...form, ...skills.remixSkillPatch(form, row.id, !row.on) }
    assert.equal(on(skills.remixSkillRows(next))[row.id], !row.on)
  }
  assert.deepEqual(plain(skills.remixSkillPatch(form, 'zoom', true).lookExtras), ['punch_zoom', 'progress_bar'])
})

test('audio skills on a request: booleans, a safe track id only with music, off left out', () => {
  assert.deepEqual(plain(skills.parseAudioSkills({ music: true, musicTrack: 'calm-pad', voiceCleanup: true })), { music: true, musicTrack: 'calm-pad', voiceCleanup: true })
  assert.deepEqual(plain(skills.parseAudioSkills({ music: false, musicTrack: 'calm-pad' })), {})
  assert.deepEqual(plain(skills.parseAudioSkills({})), {})
  assert.throws(() => skills.parseAudioSkills({ music: 'yes' }), /music/)
  assert.throws(() => skills.parseAudioSkills({ voiceCleanup: 1 }), /voice/)
  assert.throws(() => skills.parseAudioSkills({ music: true, musicTrack: '../song.mp3' }), /music/)
  // Music on without a pick: the first built-in track.
  assert.deepEqual(plain(skills.parseAudioSkills({ music: true })), { music: true, musicTrack: 'calm-pad' })
})

test('music and voice cleanup are remembered with Create and Remix styles', () => {
  assert.deepEqual(plain(prefs.parseCreateStyle({ music: true, musicTrack: 'lofi-beat', voiceCleanup: true })), { music: true, musicTrack: 'lofi-beat', voiceCleanup: true })
  assert.deepEqual(plain(prefs.parseRemixStyle({ music: true, musicTrack: '', voiceCleanup: false })), { music: true, musicTrack: '', voiceCleanup: false })
  assert.deepEqual(plain(prefs.parseCreateStyle({ music: 'on', musicTrack: '../x', voiceCleanup: null })), {})
  // The purpose and the picture belong to one video: never remembered.
  assert.deepEqual(plain(prefs.parseCreateStyle({ purpose: 'x', reference: { id: 'a' } })), {})
})

test('the purpose line: one plain line of up to 200 characters', () => {
  assert.equal(purpose.parsePurpose('  Instagram reel\n selling   my coaching call '), 'Instagram reel selling my coaching call')
  assert.equal(purpose.parsePurpose(undefined), '')
  assert.equal(purpose.parsePurpose('x'.repeat(200)).length, 200)
  assert.throws(() => purpose.parsePurpose('x'.repeat(201)), /200 characters/)
  assert.throws(() => purpose.parsePurpose('<script>'), /plain words/)
  assert.throws(() => purpose.parsePurpose(5), /short line/)
  assert.equal(purpose.isReferenceId('ab'.repeat(12)), true)
  for (const id of ['../x', 'AB'.repeat(12), 'ab'.repeat(13), null]) assert.equal(purpose.isReferenceId(id), false)
  assert.equal(purpose.plannerModelFor('economy'), purpose.ECONOMY_PLANNER_MODEL)
  assert.equal(purpose.plannerModelFor('advanced', 'google/gemini-3.8-flash'), 'google/gemini-3.8-flash')
  assert.equal(purpose.plannerModelFor(undefined), purpose.DEFAULT_PLANNER_MODEL)
})

function png(width, height) {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

test('the reference picture: its kind and size from its bytes, and the token estimate', () => {
  assert.equal(purpose.referenceKind(png(10, 10)), 'png')
  assert.deepEqual(plain(purpose.imageDimensions(png(1920, 1080))), { width: 1920, height: 1080 })
  // A baseline JPEG: SOI, an APP0 segment, then SOF0 with height 600 and width 800.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x02, 0x58, 0x03, 0x20, 3, 0, 0, 0, 0])
  assert.deepEqual(plain(purpose.imageDimensions(jpeg)), { width: 800, height: 600 })
  // An extended WebP (VP8X): canvas sizes stored minus one, 24 bits each.
  const webp = new Uint8Array(30)
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58])
  webp.set([0x1f, 0x03, 0x00, 0xdf, 0x01, 0x00], 24)
  assert.deepEqual(plain(purpose.imageDimensions(webp)), { width: 800, height: 480 })
  assert.equal(purpose.referenceKind(new Uint8Array([1, 2, 3, 4])), null)
  assert.equal(purpose.imageDimensions(new TextEncoder().encode('not a picture at all')), null)
  // Scaled to 1024 on the long side, about one token per 750 pixels.
  assert.equal(purpose.referenceImageTokens(2048, 1024), Math.ceil((1024 * 512) / 750))
  assert.equal(purpose.referenceImageTokens(500, 500), Math.ceil(250000 / 750))
  assert.equal(purpose.referenceCostUsd(1000, 0.000003), 0.003)
  assert.equal(purpose.referenceCostUsd(1000, null), null)
  // Plain words on the page; the token estimate stays available in the details.
  const support = { model: 'm', modelName: 'M', supportsImages: true, tokens: 699, costUsd: 0.0021 }
  assert.equal(purpose.referenceCostLine(support), 'Adds a little to the AI cost (under 1¢).')
  assert.equal(purpose.referenceCostLine({ ...support, costUsd: null }), 'Adds a little to the AI cost.')
  assert.match(purpose.referenceCostDetail(support), /^About 699 extra input tokens on each planning call, about \$0\.0021 at M’s listed price\. An estimate\.$/)
  assert.equal(purpose.referenceCostDetail({ ...support, supportsImages: false }), null)
  assert.equal(purpose.referenceCostLine({ model: 'm', modelName: 'M', supportsImages: false, tokens: 699, costUsd: null }), purpose.REFERENCE_SKIPPED_NOTE)
})

test('a suggested look from the picture: its strongest common color, and light or dark', () => {
  const pixels = (colors) => Uint8ClampedArray.from(colors.flatMap(([rgb, n]) => Array.from({ length: n }, () => [...rgb, 255]).flat()))
  // Mostly white with a red block: red is the brand color, Paper for a light picture.
  const light = purpose.deriveReferenceLook(pixels([[[250, 250, 250], 70], [[220, 30, 40], 30]]))
  assert.deepEqual(plain(light), { color: '#DC1E28', light: true, captionPreset: 'paper' })
  // Dark with a teal accent.
  const dark = purpose.deriveReferenceLook(pixels([[[10, 12, 14], 80], [[20, 160, 150], 20]]))
  assert.deepEqual(plain(dark), { color: '#14A096', light: false, captionPreset: 'pop' })
  // Only grays: the average color.
  assert.equal(purpose.deriveReferenceLook(pixels([[[100, 100, 100], 10]])).color, '#646464')
  assert.equal(purpose.deriveReferenceLook(new Uint8ClampedArray(0)), null)
})

test('music with an empty track (a fresh form) gets the first built-in track; music off with an empty track is fine', () => {
  assert.deepEqual(plain(skills.parseAudioSkills({ music: true, musicTrack: '' })), { music: true, musicTrack: 'calm-pad' })
  assert.deepEqual(plain(skills.parseAudioSkills({ music: false, musicTrack: '' })), {})
})
