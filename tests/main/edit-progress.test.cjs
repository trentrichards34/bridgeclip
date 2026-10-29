// Edit my recording's progress view: the stages, steps and finds built from what a run reports (src/shared/edit-progress.ts).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require })
  return module.exports
}
const p = load('shared/edit-progress.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))

test('progress lines map to stages by phase; unknown lines leave the run where it is', () => {
  assert.equal(p.editStageOf('transcribing', 'Starting', true), 'ready')
  assert.equal(p.editStageOf('transcribing', 'Starting', false), 'listen')
  assert.equal(p.editStageOf('transcribing', 'Looking at your clips (3 of 13)', true), 'ready')
  assert.equal(p.editStageOf('transcribing', 'Listening to your clips (7 of 13)', true), 'listen')
  assert.equal(p.editStageOf('transcribing', 'Listening to your recording with the usual transcription', false), 'listen')
  assert.equal(p.editStageOf('planning', 'anything', false), 'plan')
  assert.equal(p.editStageOf('rendering', 'Drawing your graphics', false), 'graphics')
  assert.equal(p.editStageOf('rendering', 'Getting your clips ready (2 of 3)', true), 'cut')
  assert.equal(p.editStageOf('rendering', 'Cutting (6 of 40)', true), 'cut')
  assert.equal(p.editStageOf('rendering', 'Cutting you out for the opening', true), 'layers')
  assert.equal(p.editStageOf('rendering', 'Mixing the sound', true), 'sound')
  assert.equal(p.editStageOf('rendering', 'Adding your hook text, captions and pop-ups', true), 'layers')
  assert.equal(p.editStageOf('rendering', 'Done', true), 'save')
  assert.equal(p.editStageOf('rendering', 'Something new from the engine', true), null)
  assert.deepEqual(plain(p.stepOf('Listening to your clips (7 of 13)')), { n: 7, of: 13 })
  assert.equal(p.stepOf('Listening (14 of 13)'), null)
  assert.equal(p.stepOf('Mixing the sound'), null)
})

test('stages open and close in order; going back to the review drops the reel’s stages; finds are bounded', () => {
  let run = p.newEditProgress(1000)
  run = p.enterStage(run, 'ready', 1000)
  run = p.enterStage(run, 'ready', 1500)
  run = p.enterStage(run, 'listen', 2000)
  run = p.enterStage(run, 'plan', 5000)
  run = p.enterStage(run, 'review', 6000)
  run = p.enterStage(run, 'cut', 9000)
  run = p.enterStage(run, 'sound', 9500)
  assert.deepEqual(plain(run.stages.map((s) => [s.id, s.startedAt, s.endedAt])), [['ready', 1000, 2000], ['listen', 2000, 5000], ['plan', 5000, 6000], ['review', 6000, 9000], ['cut', 9000, 9500], ['sound', 9500, null]])
  // The reel failed: back to the review, and the reel's stages start over next time.
  run = p.enterStage(run, 'review', 12000)
  assert.deepEqual(plain(run.stages.map((s) => s.id)), ['ready', 'listen', 'plan', 'review'])
  assert.deepEqual(plain(p.closeStages(run, 13000).stages.map((s) => s.endedAt)), [2000, 5000, 6000, 13000])
  assert.deepEqual(plain(p.parseFound({ fillers: 3, retakes: 9, hook: '  Here   is why ', cuts: -1, popups: 2.5, other: 'x' })), { fillers: 3, retakes: 9, hook: 'Here is why' })
  assert.deepEqual(plain(p.parseFound('nope')), {})
  assert.equal(p.firstWords(['First', 'I', 'filmed', 'this', 'one', 'sideways.', 'Then', 'more']), 'First I filmed this one sideways.')
  assert.deepEqual(plain(p.editStagePlan(true, { ...run, found: { graphics: 2 } })), ['ready', 'listen', 'plan', 'review', 'graphics', 'cut', 'sound', 'layers', 'save'])
  assert.deepEqual(plain(p.editStagePlan(false, undefined)), ['listen', 'plan', 'review', 'cut', 'sound', 'layers', 'save'])
})
