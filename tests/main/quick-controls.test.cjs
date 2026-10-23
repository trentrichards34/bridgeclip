// Quick controls on the Edit my recording review: "Dress it up" / "Keep it clean" (no AI call, what changed, Undo by
// the page), the color grade (footage only, carried into the editor project) and "Save as my look" / the remembered
// Style and sound (member prefs round-trip).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))
const cache = new Map()

function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const module = { exports: {} }
  cache.set(relative, module.exports)
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, { module, exports: module.exports, URL, console, require: (id) => id.startsWith('.') ? load(path.relative(ROOT, path.join(dir, id)) + '.ts') : require(id) })
  cache.set(relative, module.exports)
  return module.exports
}

const shared = load('shared/edit-recording.ts')
const density = load('shared/edit-density.ts')
const grade = load('shared/color-grade.ts')
const myLook = load('shared/my-look.ts')
const prefs = load('shared/member-prefs.ts')
const editor = load('shared/clip-editor.ts')

const stat = (id, word, value = '$15,000') => ({ id, template: 'stat', word, duration_ms: 3000, placement: 'top', fields: { value, label: 'in one month' }, origin: 'auto' })
const quote = (id, word, origin = 'auto') => ({ id, template: 'quote', word, duration_ms: 3000, placement: 'top', fields: { text: 'Charge what it is worth' }, origin })
const diagram = (id, word) => ({ id, template: 'staircase', word, duration_ms: 6000, placement: 'top', fields: { items: 'One\nTwo\nThree' }, origin: 'auto' })

function samplePlan(extra = {}) {
  const words = Array.from({ length: 60 }, (_, i) => [`w${i}${i % 10 === 9 ? '.' : ''}`, i * 300, i * 300 + 250, 0, null])
  return shared.parseEditPlan({
    words, hooks: [{ id: 0, start: 0, end: 2, text: 'w0 w1 w2', why: '' }], hook: 0, cta: null,
    popups: [{ id: 0, word: 12, text: '40%', kind: 'number' }, { id: 1, word: 30, text: 'coaches', kind: 'keyword' }],
    sounds: [], planned: 'ai', notes: [], warnings: [], graphics: [stat('g-aaaaaaaaaa', 5)], register: 'story',
    spare_graphics: [stat('g-bbbbbbbbbb', 7, '12'), stat('g-cccccccccc', 25, '3x'), stat('g-dddddddddd', 45, '90%')], ...extra
  }, 1)
}

test('the plan keeps the graphics it didn’t use (only checked ones) for Dress it up', () => {
  const plan = samplePlan()
  assert.deepEqual(plain(plan.spareGraphics.map((g) => g.id)), ['g-bbbbbbbbbb', 'g-cccccccccc', 'g-dddddddddd'])
  // A spare graphic on a word past the end, or one already in the plan, is left out; a member's one isn't spare.
  const odd = samplePlan({ spare_graphics: [stat('g-eeeeeeeeee', 999), stat('g-aaaaaaaaaa', 9), quote('g-ffffffffff', 20, 'member')] })
  assert.equal(odd.spareGraphics, undefined)
})

test('Dress it up: Teaching, the spare graphics that fit (not near another, not on a cut word), pop-ups and sound on, with a count', () => {
  const plan = samplePlan()
  const start = { ...shared.initialDecisions(plan), cut: [45], soundEffects: false, popups: [{ id: 0, on: true, text: '40%' }, { id: 1, on: false, text: 'coaches' }] }
  assert.equal(start.soundStyle, 'story')
  const change = density.dressItUp(plan, start)
  // g-bbb is 2 words from the planned one; g-ddd's word is cut: only g-ccc goes in.
  assert.deepEqual(plain(change.decisions.graphics.map((g) => g.id)), ['g-aaaaaaaaaa', 'g-cccccccccc'])
  assert.equal(change.decisions.soundStyle, 'teaching')
  assert.equal(change.decisions.soundEffects, true)
  assert.deepEqual(plain(change.decisions.popups.map((p) => p.on)), [true, true])
  assert.deepEqual([change.added, change.popupsOn, change.styleChanged, change.soundOn], [1, 1, true, true])
  assert.equal(density.densityCount(change), 4)
  assert.equal(density.densitySummary(change), 'Dressed it up: added 1 graphic, turned on 1 pop-up, set the style to Teaching, turned on sound effects.')
  // The original choices are untouched (the page's Undo puts them back).
  assert.deepEqual(plain(start.graphics.map((g) => g.id)), ['g-aaaaaaaaaa'])
  // Again: nothing more to add, and it says so.
  const again = density.dressItUp(plan, change.decisions)
  assert.equal(density.densityCount(again), 0)
  assert.match(density.densitySummary(again), /^Nothing more to add/)
})

test('Keep it clean: only the hook, numbers, up to two key diagrams and the call to action keep their automatic graphics; the member’s stay', () => {
  const plan = samplePlan()
  const graphics = [stat('g-aaaaaaaaaa', 5), quote('g-bbbbbbbbbb', 10), diagram('g-cccccccccc', 15), diagram('g-dddddddddd', 25), diagram('g-eeeeeeeeee', 35),
    quote('g-ffffffffff', 40, 'member'), { ...quote('g-gggggggggg', 50), template: 'comment_cta', fields: { keyword: 'GUIDE' } }]
  const start = { ...shared.initialDecisions(plan), graphics }
  const change = density.keepItClean(plan, start)
  assert.deepEqual(plain(change.decisions.graphics.map((g) => g.id)), ['g-aaaaaaaaaa', 'g-cccccccccc', 'g-dddddddddd', 'g-ffffffffff', 'g-gggggggggg'])
  // The keyword pop-up goes off; the number pop-up stays.
  assert.deepEqual(plain(change.decisions.popups.map((p) => p.on)), [true, false])
  assert.deepEqual([change.removed, change.popupsOff], [2, 1])
  assert.equal(density.densitySummary(change), 'Kept it clean: removed 2 graphics, turned off 1 pop-up.')
  assert.equal(density.densityCount(density.keepItClean(plan, change.decisions)), 0)
})

test('color grades: known ids only, a CSS preview, carried on the review look and the editor candidate', () => {
  assert.deepEqual(plain(grade.COLOR_GRADES), ['none', 'warm', 'cinematic', 'film', 'cool', 'mono'])
  assert.equal(grade.gradePreviewFilter('none'), undefined)
  assert.equal(grade.gradePreviewFilter('mono'), 'grayscale(1) contrast(1.06)')
  const plan = samplePlan()
  const d = shared.initialDecisions(plan)
  const parsed = shared.parseEditDecisions({ ...d, look: { ...d.look, grade: 'film' } }, plan, [])
  assert.equal(parsed.look.grade, 'film')
  assert.equal(shared.parseEditDecisions({ ...d, look: { ...d.look, grade: 'none' } }, plan, []).look.grade, undefined)
  assert.throws(() => shared.parseEditDecisions({ ...d, look: { ...d.look, grade: 'sepia' } }, plan, []), /color grade/)
  // The editor keeps the grade (and refuses an unknown one).
  const fixture = require('../fixtures/editor/project.json')
  const c = fixture.candidates[0]
  const edit = editor.parseCandidateEdit({ ...c, grade: 'warm' }, fixture.duration_ms, fixture.transcript.length)
  assert.equal(edit.grade, 'warm')
  assert.equal(editor.candidateEdit(edit).grade, 'warm')
  assert.equal(editor.parseCandidateEdit({ ...c, grade: 'none' }, fixture.duration_ms, fixture.transcript.length).grade, undefined)
  assert.throws(() => editor.parseCandidateEdit({ ...c, grade: 'neon' }, fixture.duration_ms, fixture.transcript.length))
  // A new grade means a new render.
  assert.notEqual(editor.renderEditKey(edit), editor.renderEditKey({ ...edit, grade: undefined }))
})

test('Save as my look: the reel’s look round-trips through member prefs and starts the next review; Style and sound are remembered', () => {
  const plan = samplePlan()
  const d = { ...shared.initialDecisions(plan), soundStyle: 'minimal', soundEffects: false, lookExtras: ['progress_bar'], transitions: true }
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { ...shared.DEFAULT_EDIT_LOOK.headlineLook, look: 'white' }, showHandle: false, grade: 'cinematic' }
  const saved = myLook.myLookFrom(look, d, '2026-10-23T00:00:00.000Z')
  const stored = prefs.parseMemberPrefs(JSON.parse(JSON.stringify({ myLook: saved, useMyLook: false, editStyle: { register: 'story', soundEffects: true } })))
  assert.deepEqual(plain(stored.myLook), plain(saved))
  assert.equal(stored.useMyLook, false)
  assert.deepEqual(plain(stored.editStyle), { register: 'story', soundEffects: true })
  // Defaults: no look, start from it when there is one; junk is dropped field by field.
  const empty = prefs.parseMemberPrefs({})
  assert.deepEqual([empty.myLook, empty.useMyLook, plain(empty.editStyle)], [null, true, {}])
  assert.deepEqual(plain(prefs.parseMemberPrefs({ myLook: { register: 'loud', grade: 'neon', captionPreset: 'pop', savedAt: 'x' } }).myLook), { savedAt: new Date(0).toISOString(), captionPreset: 'pop' })
  // The next review: the setup look gets the captions, hook text and grade; the review its style, sound, extras and transitions.
  const next = myLook.lookWithMyLook({ ...shared.DEFAULT_EDIT_LOOK, grade: 'warm' }, stored.myLook)
  assert.deepEqual([next.captionPreset, next.headlineLook.look, next.grade], ['pop', 'white', 'cinematic'])
  const fresh = shared.initialDecisions(samplePlan({ combine: undefined }))
  const started = myLook.decisionsWithMyLook(fresh, stored.myLook)
  assert.deepEqual([started.soundStyle, started.soundEffects, plain(started.lookExtras)], ['minimal', false, ['progress_bar']])
  assert.equal(started.transitions, undefined, 'transitions only for Combine')
  assert.equal(myLook.decisionsWithMyLook({ ...fresh, clipOrder: [0] }, stored.myLook).transitions, true)
  const remembered = myLook.decisionsWithEditStyle(fresh, stored.editStyle)
  assert.deepEqual([remembered.soundStyle, remembered.soundEffects], ['story', true])
  assert.match(myLook.myLookSummary(stored.myLook), /Minimal · Captions: pop · Hook text: white · Grade: Cinematic · No sound effects/)
})
