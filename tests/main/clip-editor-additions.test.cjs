// Clip editor: "Use this style on every clip", clips from transcript lines,
// "Duplicate as variant" and "Suggest hooks".
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')
const schema = loadMain("export * from './src/shared/clip-editor'")
const jobOutput = loadMain("export * from './src/shared/job-output'")
const plain = (x) => JSON.parse(JSON.stringify(x))
const look = (color) => ({ look: 'brand', color, font: 'condensed' })

function project() { return plain(schema.parseEditorProject(structuredClone(fixture))) }

test('"Use this style on every clip" copies captions, hook look, CTA and speed to every clip that is not discarded', () => {
  const p = project()
  const base = p.candidates[0]
  const clips = ['ready', 'ready', 'discarded', 'baked'].map((status, i) => ({ ...structuredClone(base), id: `c${i}`, status,
    captions: i !== 0, caption_preset: 'pop', caption_y: null, video_speed: 1, hook: { text: `Words ${i}`, look: look('#111111') } }))
  Object.assign(clips[0], { captions: false, caption_preset: 'boxed', caption_y: .7, video_speed: 1.5, cta_id: 'abcdef0123456789', hook: { text: 'Source words', look: look('#FF0000') } })
  clips[1].hook = null
  const { candidates, changed } = schema.applyStyleToAll(clips, 0)
  assert.equal(changed, 2)
  assert.equal(candidates[0], clips[0])
  assert.equal(candidates[2], clips[2], 'discarded clips are left alone')
  for (const i of [1, 3]) {
    const c = candidates[i]
    assert.deepEqual([c.captions, c.caption_preset, c.caption_y, c.video_speed, c.cta_id], [false, 'boxed', .7, 1.5, 'abcdef0123456789'])
    assert.equal(c.status, 'refining', 'a clip whose look changes goes back to refining')
  }
  assert.equal(candidates[1].hook, null, 'a clip without hook text keeps none')
  assert.deepEqual(candidates[3].hook, { text: 'Words 3', look: look('#FF0000') }, 'the look is copied, never the words')
  // Applying again changes nothing.
  assert.equal(schema.applyStyleToAll(candidates, 0).changed, 0)
  // A call-to-action-only change needs no new render, so a ready clip stays ready.
  const ctaOnly = structuredClone(candidates); ctaOnly[1].status = 'ready'; ctaOnly[0].cta_id = null
  const result = schema.applyStyleToAll(ctaOnly, 0)
  assert.equal(result.candidates[1].status, 'ready')
  assert.equal(result.candidates[1].cta_id, null)
  // Back to "same as the run": the field is removed, not set to undefined.
  ctaOnly[0].cta_id = undefined; delete ctaOnly[0].cta_id
  assert.equal('cta_id' in schema.applyStyleToAll(result.candidates, 0).candidates[1], false)
  // Every result still passes the save check.
  for (const c of candidates) schema.parseCandidateEdit(c, p.duration_ms, p.transcript.length)
})

test('transcript lines snap to whole lines between 3 seconds and 3 minutes', () => {
  const p = project()
  // Lines: 0–2 s, 3–5 s, 6–8 s, 9–11 s of a 12 s source.
  assert.deepEqual(plain(schema.transcriptRange(p.transcript, 0, 0, p.duration_ms)), [0, 5000], 'a 2 s line takes in the next')
  assert.deepEqual(plain(schema.transcriptRange(p.transcript, 2, 1, p.duration_ms)), [3000, 8000], 'either selection order')
  assert.deepEqual(plain(schema.transcriptRange(p.transcript, 3, 3, p.duration_ms)), [9000, 12000], 'the last line is padded with footage')
  assert.equal(schema.transcriptRange(p.transcript, 2, 9, p.duration_ms), null)
  const long = Array.from({ length: 10 }, (_, i) => ({ start_ms: i * 30000, end_ms: i * 30000 + 29000, text: `Line ${i}` }))
  assert.deepEqual(plain(schema.transcriptRange(long, 0, 9, 300000)), [0, 179000], 'cut to the last whole line within 3 minutes')
  assert.deepEqual(plain(schema.transcriptRange([{ start_ms: 1000, end_ms: 400000, text: 'Monologue' }], 0, 0, 400000)), [1000, 181000])
  assert.deepEqual(plain(schema.transcriptRange([{ start_ms: 0, end_ms: 1000, text: 'Hi' }], 0, 0, 2000)), [0, 2000], 'a short source gives what it has')
})

test('a clip from transcript lines takes framing from the nearest clip and the run hook look, without AI', () => {
  const p = project()
  p.candidates[0].hook = { text: 'One', look: look('#00FF00') }
  p.candidates[1].hook = { text: 'Two', look: look('#00FF00') }
  p.transcript[2].text = '  The   real reason most creators quit early is simple, honestly.'
  const clip = schema.transcriptClip(p, p.candidates, 2, 3)
  assert.deepEqual(clip.ranges, [[6000, 11000]])
  assert.equal(clip.title, 'The real reason most creators quit early is…')
  assert.deepEqual(clip.hook, { text: clip.title, look: look('#00FF00') })
  assert.equal(clip.status, 'refining')
  // candidate-2 (5–11 s) is nearest; its framing at the clip's start, as one layout.
  assert.equal(clip.scenes.length, 1)
  assert.equal(clip.scenes[0].at_ms, 0)
  assert.deepEqual(clip.scenes[0].crops, plain(schema.framingAt(p.candidates[1], 6000).crops))
  schema.parseCandidateEdit(clip, p.duration_ms, p.transcript.length)
  // No clip to copy from: a centered full-frame crop and the default look.
  const lonely = schema.transcriptClip(p, [], 0, 0)
  assert.equal(lonely.scenes[0].layout, 'fill')
  assert.deepEqual(lonely.scenes[0].crops, [schema.defaultCrop(p.width, p.height, 9 / 16)])
  assert.deepEqual(lonely.hook.look, { look: 'white', color: '#FFFFFF', font: 'clean' })
})

test('variants are copies with their own letter', () => {
  const p = project()
  const v = schema.variantOf(p.candidates[0], p.candidates)
  assert.equal(v.title, 'The result (variant B)')
  assert.deepEqual({ ...v, id: undefined, title: undefined }, { ...schema.candidateEdit(p.candidates[0]), id: undefined, title: undefined, status: 'refining' })
  assert.equal(schema.variantTitle('The result (variant B)', ['The result (variant B)']), 'The result (variant C)')
  assert.equal(schema.variantTitle('x'.repeat(200), []).length, 200)
})

test('hook ideas from the worker are bounded and malformed ones dropped', () => {
  const good = { text: ' Most  creators quit for this reason ', grade: 'B', score: 7.26, hook_type: 'contrarian', elements: { qualifier: null, main_statement: 'Most creators quit', twist: 7 }, evidence: 'most creators quit', why: 'Bold claim.' }
  const ideas = schema.parseHookIdeas([good, { ...good, grade: 'Z' }, { ...good, text: 'bad\u0007' }, null, 'x', { ...good, score: NaN },
    ...Array.from({ length: 6 }, (_, i) => ({ ...good, text: `Idea ${i}`, hook_type: 'made_up' }))])
  assert.equal(ideas.length, 5)
  assert.deepEqual(plain(ideas[0]), { text: 'Most creators quit for this reason', grade: 'B', score: 7.3, hook_type: 'contrarian',
    elements: { qualifier: null, main_statement: 'Most creators quit', twist: null }, evidence: 'most creators quit', why: 'Bold claim.' })
  assert.equal(ideas[1].hook_type, 'none')
  assert.deepEqual(schema.parseHookIdeas({ hooks: [] }), [])
})

test('job output keeps the editor hook-ideas cost', () => {
  const parsed = jobOutput.parseJobOutput({ job_id: 'j', clips: [], metrics: { api_costs: { total_estimated_cost_usd: .5,
    editor_hooks: { provider: 'openrouter', model: 'm/x', estimated_cost_usd: .02, attempts: 2, secret: 'no' } } } })
  assert.deepEqual(plain(parsed.metrics.api_costs.editor_hooks), { provider: 'openrouter', model: 'm/x', estimated_cost_usd: .02, attempts: 2 })
})

function setup(spawn) {
  const temp = tempDir('bridgeclip-editor-add-')
  const library = path.join(temp.dir, 'library'), run = path.join(library, 'review-run')
  fs.mkdirSync(run, { recursive: true })
  for (const file of ['editor-source.mp4', 'editor-preview.mp4']) fs.writeFileSync(path.join(run, file), 'video')
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(fixture))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'review-run', clips: [], editor_project: true,
    metrics: { api_costs: { total_estimated_cost_usd: 0.1, planning: { estimated_cost_usd: 0.1 } }, other: 'kept' } }))
  const mocks = { electron: fakeElectron(temp.dir).electron, ...(spawn ? { child_process: { ...require('node:child_process'), spawn } } : {}) }
  const main = loadMain("export * from './src/main/clip-editor'; export * as settings from './src/main/settings-store'", mocks)
  main.settings.savePublicSettings({ outputDirectory: library, pythonPath: 'python3' })
  const read = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const write = (p) => fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(p))
  return { ...temp, run, main, read, write }
}

test('adding a clip from transcript lines: main assigns the id, checks revision, range and limits', async () => {
  const f = setup()
  try {
    const opened = await f.main.openEditor(f.run)
    const draft = schema.transcriptClip(opened.project, opened.project.candidates, 0, 0)
    await assert.rejects(f.main.addEditorCandidate(f.run, 5, draft), /changed/)
    for (const bad of [{ ...draft, ranges: [[0, 1000], [2000, 5000]] }, { ...draft, ranges: [[0, 2000]] }, { ...draft, title: ' ' }, { ...draft, scenes: [] }, null])
      await assert.rejects(f.main.addEditorCandidate(f.run, 0, bad), /Invalid/)
    const session = await f.main.addEditorCandidate(f.run, 0, { ...draft, status: 'baked', id: 'candidate-1', review: { forged: true }, exports: [3], score: 99 })
    assert.equal(session.project.revision, 1)
    assert.equal(session.project.candidates.length, 3)
    const added = session.project.candidates[2]
    assert.match(added.id, /^clip-[a-f0-9]{12}$/)
    assert.deepEqual([added.status, added.score, added.reason, added.review, added.exports], ['refining', 0, '', null, []])
    assert.deepEqual(added.ranges, [[0, 5000]])
    // The whole list (with the new clip) saves normally afterwards.
    const edits = session.project.candidates; edits[2].title = 'Renamed'
    const saved = await f.main.saveEditor(f.run, 1, edits)
    assert.equal(saved.project.candidates[2].title, 'Renamed')
    // A full project and freed media are refused.
    const full = f.read()
    full.candidates = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(full.candidates[0]), id: `c${i}` }))
    f.write(full)
    await assert.rejects(f.main.addEditorCandidate(f.run, 2, draft), /up to 100 clips/)
    f.write({ ...f.read(), candidates: full.candidates.slice(0, 2), media_freed: true })
    await assert.rejects(f.main.addEditorCandidate(f.run, 2, draft), /read-only/)
  } finally { f.cleanup() }
})

test('a variant copies settings, score, reason and camera scan from its source', async () => {
  const f = setup()
  try {
    const p = f.read()
    p.candidates[0].camera_scan = { start_ms: 1000, end_ms: 10000, frames: [1000, 2000], markers: [{ at_ms: 2000, score: .5 }] }
    p.candidates[0].reason = 'Strong moment'
    p.candidates[0].status = 'baked'; p.candidates[0].exports = [0]
    f.write(p)
    const opened = await f.main.openEditor(f.run)
    const draft = schema.variantOf(opened.project.candidates[0], opened.project.candidates)
    await assert.rejects(f.main.addEditorCandidate(f.run, 0, draft, 'missing'), /missing/)
    await assert.rejects(f.main.addEditorCandidate(f.run, 0, draft, 42), /missing/)
    const session = await f.main.addEditorCandidate(f.run, 0, draft, 'candidate-1')
    const [source, , copy] = session.project.candidates
    assert.equal(copy.title, 'The result (variant B)')
    assert.deepEqual(copy.ranges, source.ranges)
    assert.deepEqual(copy.scenes, source.scenes)
    assert.deepEqual([copy.score, copy.reason, copy.status, copy.exports, copy.review], [source.score, 'Strong moment', 'refining', [], null])
    assert.deepEqual(copy.camera_scan, source.camera_scan)
    assert.notEqual(copy.id, source.id)
  } finally { f.cleanup() }
})

function hookWorker() {
  const workers = []
  const spawn = () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
    child.stdin.end = (data) => workers.push({ config: JSON.parse(data), reply(message, code = 0) { child.stdout.write(JSON.stringify(message) + '\n'); child.emit('close', code) } })
    return child
  }
  return { workers, spawn }
}
const nextWorker = async (workers, count) => {
  const deadline = Date.now() + 5000
  while (workers.length < count && Date.now() < deadline) await new Promise(r => setTimeout(r, 5))
  assert.equal(workers.length, count)
  return workers[count - 1]
}

test('"Suggest hooks" needs the OpenRouter key, locks the editor, returns parsed ideas and records their cost', async () => {
  const { workers, spawn } = hookWorker()
  const f = setup(spawn)
  try {
    await assert.rejects(f.main.suggestEditorHooks(f.run, 0, 'candidate-1'), /OpenRouter key/)
    f.main.settings.replaceApiKey('openrouterApiKey', 'fixture-key')
    await assert.rejects(f.main.suggestEditorHooks(f.run, 3, 'candidate-1'), /changed/)
    await assert.rejects(f.main.suggestEditorHooks(f.run, 0, 'nope'), /changed/)
    const idea = { text: 'The event changed everything', grade: 'B', score: 7, hook_type: 'story', elements: {}, evidence: 'The event happened', why: '' }
    const pending = f.main.suggestEditorHooks(f.run, 0, 'candidate-1')
    const worker = await nextWorker(workers, 1)
    assert.deepEqual([worker.config.action, worker.config.candidate_id, worker.config.revision], ['suggest-hooks', 'candidate-1', 0])
    assert.equal((await f.main.openEditor(f.run)).operation, 'suggest-hooks')
    await assert.rejects(f.main.saveEditor(f.run, 0, fixture.candidates), /Wait/)
    worker.reply({ ok: true, hooks: [idea, { text: 7 }], cost_usd: 0.0123, cost_incomplete: false, model: 'anthropic/claude-opus-5.5' })
    const { hooks } = await pending
    assert.deepEqual(plain(hooks).map(h => h.text), ['The event changed everything'])
    assert.equal((await f.main.openEditor(f.run)).project.revision, 0, 'ideas never change the project')
    const output = JSON.parse(fs.readFileSync(path.join(f.run, 'job_output.json')))
    assert.equal(output.metrics.other, 'kept')
    assert.deepEqual(output.metrics.api_costs.planning, { estimated_cost_usd: 0.1 })
    assert.deepEqual(output.metrics.api_costs.editor_hooks, { provider: 'openrouter', model: 'anthropic/claude-opus-5.5', estimated_cost_usd: 0.0123, attempts: 1 })
    assert.equal(output.metrics.api_costs.total_estimated_cost_usd, 0.1123)
    // A second request adds up; an unreported price marks the cost incomplete.
    const again = f.main.suggestEditorHooks(f.run, 0, 'candidate-1')
    ;(await nextWorker(workers, 2)).reply({ ok: true, hooks: [], cost_usd: 0.01, cost_incomplete: true, model: 'bad model name!' })
    assert.deepEqual(plain((await again).hooks), [])
    const costs = JSON.parse(fs.readFileSync(path.join(f.run, 'job_output.json'))).metrics.api_costs
    assert.deepEqual([costs.editor_hooks.estimated_cost_usd, costs.editor_hooks.attempts, costs.editor_hooks.cost_incomplete, costs.cost_incomplete], [0.0223, 2, true, true])
    // A provider failure maps to its own message.
    const failed = f.main.suggestEditorHooks(f.run, 0, 'candidate-1')
    ;(await nextWorker(workers, 3)).reply({ ok: false, error: 'hooks_unavailable' }, 1)
    await assert.rejects(failed, /Could not get hook ideas\. Check your OpenRouter key/)
    assert.equal((await f.main.openEditor(f.run)).operation, null)
  } finally { f.cleanup() }
})

test('trial reels: a variant per hook, named after it, its hook set, graphics and scenes kept', () => {
  const p = project()
  const c = { ...p.candidates[0], hook: { text: 'The original hook', look: look('#E84BD8') } }
  const v = schema.trialVariant(c, p.candidates, '  Most   creators quit too early ')
  assert.equal(v.title, 'Most creators quit too early')
  assert.deepEqual(plain(v.hook), { text: 'Most creators quit too early', look: look('#E84BD8') })
  assert.equal(v.status, 'refining'); assert.equal(v.id, 'new')
  assert.deepEqual(plain(v.ranges), plain(c.ranges)); assert.deepEqual(plain(v.scenes), plain(c.scenes))
  // A second reel with the same words gets its own name; one word is not a hook.
  assert.equal(schema.trialVariant(c, [...p.candidates, v], 'Most creators quit too early').title, 'Most creators quit too early (trial 2)')
  assert.throws(() => schema.trialVariant(c, p.candidates, 'Hello'), /two words/)
  assert.equal(schema.MAX_TRIAL_REELS, 5)
})

test('"Fix layout" asks the engine for the scenes from the clip\'s graphics and returns them checked (overlaps trimmed)', async () => {
  const { workers, spawn } = hookWorker()
  const f = setup(spawn)
  try {
    await assert.rejects(f.main.fixEditorLayout(f.run, 3, 'candidate-1', []), /changed/)
    const graphics = [{ id: 'g-0001', template: 'statement', at_ms: 1000, duration_ms: 3000, placement: 'top', fields: { text: 'The event' }, size: 'stage' }]
    const pending = f.main.fixEditorLayout(f.run, 0, 'candidate-1', graphics)
    const worker = await nextWorker(workers, 1)
    assert.deepEqual([worker.config.action, worker.config.candidate_id, worker.config.revision], ['fix-layout', 'candidate-1', 0])
    assert.equal(worker.config.graphics.length, 1)
    worker.reply({ ok: true, stage_scenes: [{ scene: 'stage', start_ms: 1000, end_ms: 4070, backdrop: 'dark' }, { scene: 'stage', start_ms: 4000, end_ms: 6000, backdrop: 'dark', card: 'screen' }] })
    const { stage_scenes } = await pending
    assert.deepEqual(plain(stage_scenes), [{ scene: 'stage', start_ms: 1000, end_ms: 4070, backdrop: 'dark' }, { scene: 'stage', start_ms: 4070, end_ms: 6000, backdrop: 'dark', card: 'screen' }])
    assert.equal((await f.main.openEditor(f.run)).project.revision, 0, 'the project is not changed (the editor applies them as an edit)')
  } finally { f.cleanup() }
})
