const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8')
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: (id) => mocks[id] ?? require(id), URL, Set, Map })
  return module.exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const grades = load('shared/framework-grade.ts')
const progress = load('shared/job-progress.ts')
const jobOutput = load('shared/job-output.ts', {
  './editorial': load('shared/editorial.ts'), './framework-grade': grades, './job-progress': progress,
  './run-diagnostics': load('shared/run-diagnostics.ts', { './job-progress': progress })
})

const engineGrade = {
  grade: 'A', score: 8.9, scores: { triple_hook: 9, twist: 8.5, hook_speed: 9, story_arc: 8, payoff: 9, specificity: 9, emotion_stance: 7 },
  hook_elements: { qualifier: "You're not going to believe this", main_statement: 'we made $53,847', twist: 'without ads', stakes: null },
  hook_type: 'direct_response', story_beats: { hook: true, background: true, conflict: true, resolution: true, call_to_action: false },
  hard_fails: [], verdict: 'Full Triple Hook, delivered.', fix: 'Tighten the ending.', suggested_title: '$53K Without Ads'
}

test('engine grades are parsed into the app shape', () => {
  const parsed = plain(grades.parseFrameworkGrade(engineGrade))
  assert.equal(parsed.grade, 'A')
  assert.equal(parsed.hookElements.twist, 'without ads')
  assert.equal(parsed.hookElements.stakes, null)
  assert.equal(parsed.storyBeats.conflict, true)
  assert.equal(parsed.suggestedTitle, '$53K Without Ads')
})

test('untrusted grade data is bounded and sanitized', () => {
  assert.equal(grades.parseFrameworkGrade({ ...engineGrade, grade: 'A+' }), null)
  assert.equal(grades.parseFrameworkGrade('A'), null)
  const parsed = plain(grades.parseFrameworkGrade({ ...engineGrade, score: 50, scores: { triple_hook: -3, payoff: 'x' }, hook_type: '<script>', hard_fails: ['payoff_cut_off', 'bogus'], verdict: 'x'.repeat(5000) }))
  assert.equal(parsed.score, 10)
  assert.equal(parsed.scores.triple_hook, 0)
  assert.equal(parsed.scores.payoff, 0)
  assert.equal(parsed.hookType, 'none')
  assert.deepEqual(parsed.hardFails, ['payoff_cut_off'])
  assert.equal(parsed.verdict.length, 300)
})

test('job output keeps each clip grade', () => {
  const output = jobOutput.parseJobOutput({ job_id: 'j', clips: [
    { clip_index: 0, s3_url: 'file:///a.mp4', duration_ms: 1, start_time_ms: 0, end_time_ms: 1, virality_score: 0.5, framework: engineGrade },
    { clip_index: 1, s3_url: 'file:///b.mp4', duration_ms: 1, start_time_ms: 0, end_time_ms: 1, virality_score: 0.5 }
  ] })
  assert.equal(output.clips[0].framework.grade, 'A')
  assert.equal(output.clips[1].framework, null)
})
