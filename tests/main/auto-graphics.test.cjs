// Motion graphics: Auto, after a Create run: main reads the engine's plan (checked like an editor project),
// draws each card on its own (a card that can't be drawn leaves only itself out), lays them over the clips in
// one engine worker run (hook preview offset applied), records only what was drawn for the editor, and turns
// failures into a run note. Also: the bands keep cards clear of an Automatic run's handle and title card.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { loadMain, tempDir } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const FILE = 'a'.repeat(64) + '.mov'
const stat = (id, at_ms, value = '$15,000') => ({ id, template: 'stat', at_ms, duration_ms: 3000, placement: 'top', fields: { value, label: 'in one month' }, origin: 'auto' })

function candidate(index, graphics) {
  const c = structuredClone(fixture.candidates[0])
  return { ...c, id: `clip-${String(index).padStart(3, '0')}`, status: 'baked', library_clip: index, exports: [index], graphics }
}

function makeRun(dir, { plan = true, version = 1, graphics0, graphics1 } = {}) {
  const run = path.join(dir, 'run')
  fs.mkdirSync(run, { recursive: true })
  const g0 = graphics0 ?? [stat('g-aaaaaaaaaa', 1500), stat('g-bbbbbbbbbb', 7200, '25%')]
  const g1 = graphics1 ?? [stat('g-cccccccccc', 2000)]
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'run', clips: [], metrics: { clip_layouts: [
    { clip_index: 0, kept_source_ms: [[1000, 10000]], graphics: g0, teaser_ms: 0 },
    { clip_index: 1, kept_source_ms: [[1000, 10000]], graphics: g1, teaser_ms: 1500 },
    { clip_index: 2, kept_source_ms: [[1000, 10000]] }
  ] } }))
  if (plan) {
    const project = { ...structuredClone(fixture), candidates: [candidate(0, g0), candidate(1, g1)], automatic: { omitted: [], estimated_cuts: 0, brand_mark: { handle: '@me', logo: false, position: 'top-right' } } }
    fs.writeFileSync(path.join(run, 'auto-graphics.json'), JSON.stringify({ version, project, clips: { 'clip-000': { offset_ms: 0, top: 0.17 }, 'clip-001': { offset_ms: 1500, top: 0 } } }))
  }
  return run
}

/** The engine's overlay worker: reports each clip as told, then a final line. */
function fakeSpawn(outcome, calls) {
  return (command, args, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
    let input = ''
    child.stdin.on('data', (chunk) => { input += chunk })
    child.stdin.on('finish', () => {
      const request = JSON.parse(input)
      calls.push({ command, args, options, request })
      setImmediate(() => {
        for (const c of request.clips) child.stdout.write(JSON.stringify({ type: 'progress', clip_index: c.clip_index, ok: outcome(c.clip_index) }) + '\n')
        child.stdout.write(JSON.stringify({ ok: true }) + '\n')
        child.stdout.end()
        child.emit('close', 0, null)
      })
    })
    child.kill = () => {}
    return child
  }
}

function load({ fail = () => false, outcome = () => true, sound = false } = {}) {
  const calls = [], drawn = []
  const mod = loadMain("export * from './src/main/auto-graphics'", {
    ...(sound ? {
      './sound-library': { soundPaletteForEngine: () => [{ path: '/sounds/pop/mine.wav', action: 'pop' }] },
      './music': { readMusicSettings: () => ({ levelDb: -22, duringTheirClip: false }) }
    } : {}),
    './graphics-render': {
      renderCandidateGraphics: async (run, project, c, cancelled, extra) => {
        const g = c.graphics[0]
        drawn.push({ id: g.id, clip: c.library_clip, extra, handle: project.automatic?.brand_mark?.position })
        if (fail(g)) throw new Error('The graphic page did not load')
        return [{ id: g.id, file: FILE, start_ms: 800, duration_ms: 2000 }]
      }
    },
    './ctas': { withRunLock: async (_run, work) => work() },
    './logger': { logger: { info() {}, warn() {}, error() {} } },
    child_process: { spawn: fakeSpawn(outcome, calls) }
  })
  return { mod, calls, drawn }
}

const WORKER = { python: '/py', env: { PATH: '/bin' }, script: '/bridge/graphics_runner.py', cwd: '/engine', library: '/library' }

test('cards are drawn one by one, laid over in one worker run, and only what was drawn is recorded', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-auto-graphics-')
  t.after(cleanup)
  const run = makeRun(dir)
  // The second card of clip 1 can't be drawn; the engine can't lay clip 1's file.
  const { mod, calls, drawn } = load({ fail: (g) => g.id === 'g-bbbbbbbbbb', outcome: (index) => index !== 1 })
  const progress = []
  const result = await mod.applyRunGraphics(run, WORKER, { onProgress: (...args) => progress.push(args) })
  assert.deepEqual(drawn.map((d) => [d.id, d.clip, d.extra.top]), [['g-aaaaaaaaaa', 0, 0.17], ['g-bbbbbbbbbb', 0, 0.17], ['g-cccccccccc', 1, 0]])
  assert.equal(drawn[0].handle, 'top-right')
  // One worker run for the run, with the hook preview's offset added to clip 1.
  assert.equal(calls.length, 1)
  assert.deepEqual([calls[0].command, calls[0].args, calls[0].options.cwd], ['/py', ['/bridge/graphics_runner.py'], '/engine'])
  assert.deepEqual(calls[0].request, { run, library: '/library', clips: [
    { clip_index: 0, graphics: [{ file: FILE, start_ms: 800, duration_ms: 2000 }] },
    { clip_index: 1, graphics: [{ file: FILE, start_ms: 2300, duration_ms: 2000 }] }] })
  assert.deepEqual(progress.filter(([step]) => step === 'draw').map(([, done, total]) => [done, total]), [[0, 3], [1, 3], [2, 3], [3, 3]])
  assert.deepEqual(progress.filter(([step]) => step === 'lay').map(([, done, total]) => [done, total]), [[1, 2], [2, 2]])
  assert.deepEqual(result, { clips: 2, applied: 1, failed: [0, 1], cancelled: false })
  // The editor will show exactly the cards in each clip.
  const layouts = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).metrics.clip_layouts
  assert.deepEqual(layouts[0].graphics.map((g) => g.id), ['g-aaaaaaaaaa'])
  assert.equal(layouts[1].graphics, undefined)
  assert.equal(layouts[1].teaser_ms, undefined)
  assert.equal(fs.existsSync(path.join(run, 'auto-graphics.json')), false, 'the plan is used once')
  assert.match(mod.graphicsNotice(result), /^Done\. Some motion graphics couldn’t be drawn on 2 clips, so they were made without them\. Add graphics to any clip in the editor\.$/)
  assert.equal(mod.graphicsNotice({ clips: 2, applied: 2, failed: [], cancelled: false }), null)
})

test('every card drawn and laid: no note; a cancel stops before the worker and says so', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-auto-graphics-')
  t.after(cleanup)
  const run = makeRun(dir)
  const { mod } = load()
  const result = await mod.applyRunGraphics(run, WORKER)
  assert.deepEqual(result, { clips: 2, applied: 2, failed: [], cancelled: false })
  const layouts = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).metrics.clip_layouts
  assert.deepEqual(layouts.map((e) => (e.graphics ?? []).length), [2, 1, 0])

  const again = makeRun(path.join(dir, 'b'))
  const second = load()
  const abort = new AbortController(); abort.abort()
  const stopped = await second.mod.applyRunGraphics(again, WORKER, { signal: abort.signal })
  assert.equal(stopped.cancelled, true)
  assert.equal(second.calls.length, 0)
  assert.match(second.mod.graphicsNotice(stopped), /^Done\. You stopped the motion graphics partway/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(again, 'job_output.json'), 'utf8')).metrics.clip_layouts[0].graphics, undefined)
})

test('a missing or malformed plan draws nothing, and the editor then shows no cards', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-auto-graphics-')
  t.after(cleanup)
  const none = makeRun(path.join(dir, 'none'), { plan: false })
  const { mod, calls } = load()
  assert.deepEqual(await mod.applyRunGraphics(none, WORKER), { clips: 0, applied: 0, failed: [], cancelled: false })
  assert.equal(calls.length, 0)
  for (const [name, options] of [['version', { version: 2 }], ['template', { graphics0: [{ ...stat('g-aaaaaaaaaa', 1500), template: 'confetti' }] }], ['id', { graphics1: [{ ...stat('X', 1500) }] }]]) {
    const run = makeRun(path.join(dir, name), options)
    assert.equal(mod.readGraphicsPlan(run), null, name)
    await mod.applyRunGraphics(run, WORKER)
    const layouts = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).metrics.clip_layouts
    assert.deepEqual(layouts.map((e) => e.graphics), [undefined, undefined, undefined], name)
    assert.equal(fs.existsSync(path.join(run, 'auto-graphics.json')), false)
  }
  assert.equal(calls.length, 0)
})

test('bands stay clear of an Automatic run’s handle and title card', () => {
  const layout = loadMain("export * from './src/shared/graphic-layout'")
  const frame = { aspect: '9:16', hook: 0, captions: null }
  const top = layout.graphicBox('top', frame), bottom = layout.graphicBox('bottom', frame)
  assert.ok(layout.graphicBox('top', { ...frame, handle: 'top' }).top >= top.top + 0.05)
  assert.ok(layout.graphicBox('bottom', { ...frame, handle: 'bottom' }).bottom <= bottom.bottom - 0.05)
  const project = { ...structuredClone(fixture), automatic: { omitted: [], estimated_cuts: 0, brand_mark: { handle: '@me', logo: false, position: 'top-left' } } }
  const c = { ...structuredClone(fixture.candidates[0]), captions: false, hook: null }
  const g = stat('g-aaaaaaaaaa', 2000)
  const plain = layout.graphicSpec({ ...project, automatic: undefined }, c, g)
  const marked = layout.graphicSpec(project, c, g)
  assert.ok(marked.box.top > plain.box.top, 'a top-corner handle pushes the card down')
  // A title card drawn by the run (not in the project): the card goes under it.
  const titled = layout.graphicSpec({ ...project, automatic: undefined }, c, g, { top: 0.17 })
  assert.ok(titled.box.top >= 0.19)
  assert.equal(layout.handleEdge(project), 'top')
  assert.equal(layout.handleEdge({ automatic: { brand_mark: { position: 'bottom-right' } } }), 'bottom')
  assert.equal(layout.handleEdge({}), null)
})

test('a card moved off the speaker’s face is recorded where it was drawn, so the editor matches the clip', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-auto-graphics-')
  t.after(cleanup)
  const run = makeRun(dir)
  const planFile = path.join(run, 'auto-graphics.json')
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  // The face fills the top of clip 0's picture, where both cards were planned.
  plan.clips['clip-000'] = { offset_ms: 0, top: 0, face: [0.25, 0.02, 0.5, 0.4] }
  fs.writeFileSync(planFile, JSON.stringify(plan))
  const { mod } = load()
  await mod.applyRunGraphics(run, WORKER)
  const layouts = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).metrics.clip_layouts
  assert.equal(layouts[0].graphics.length, 2)
  for (const g of layouts[0].graphics) assert.notEqual(g.placement, 'top', 'recorded where it was laid, not where it was planned')
  // A clip without a face keeps its planned placement.
  assert.deepEqual(layouts[1].graphics.map((g) => g.placement), ['top'])
})

test('Create sound effects: each laid clip gets events for its drawn cards (hook preview offset added), the style, the music level and the member’s sounds; the editor keeps them', async (t) => {
  const { dir, cleanup } = tempDir('bridgeclip-auto-graphics-')
  t.after(cleanup)
  const run = makeRun(dir)
  // Card g-bbbbbbbbbb can't be drawn: it gets no sound either.
  const { mod, calls } = load({ sound: true, fail: (g) => g.id === 'g-bbbbbbbbbb' })
  const result = await mod.applyRunGraphics(run, WORKER, { sound: { register: 'story', music: true } })
  assert.equal(result.applied, 2)
  const request = calls[0].request
  assert.deepEqual(request.sound_palette, [{ path: '/sounds/pop/mine.wav', action: 'pop' }])
  // Source 1500 ms in a cut from 1000 at 1.25x: 400 ms into the clip; clip 1's card (2000 ms) after a 1.5 s hook preview.
  assert.deepEqual(request.clips[0].sound, { register: 'story', music_db: -22, events: [{ kind: 'graphic', template: 'stat', at_ms: 400, end_ms: 2800, size: 'card' }] })
  assert.deepEqual(request.clips[1].sound, { register: 'story', music_db: -22, events: [{ kind: 'graphic', template: 'stat', at_ms: 2300, end_ms: 4700, size: 'card' }] })
  const layouts = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).metrics.clip_layouts
  assert.deepEqual(layouts[0].sound, { on: true, register: 'story', music_db: -22, cues: [] })
  assert.equal(layouts[2].sound, undefined)

  // Off (no sound option): no events and no palette; an unset style plays as Teaching.
  const quiet = load({ sound: true })
  await quiet.mod.applyRunGraphics(makeRun(path.join(dir, 'quiet')), WORKER)
  assert.equal(quiet.calls[0].request.sound_palette, undefined)
  assert.equal(quiet.calls[0].request.clips[0].sound, undefined)
  const teaching = load({ sound: true })
  await teaching.mod.applyRunGraphics(makeRun(path.join(dir, 'teach')), WORKER, { sound: { music: false } })
  assert.equal(teaching.calls[0].request.clips[0].sound.register, 'teaching')
  assert.equal(teaching.calls[0].request.clips[0].sound.music_db, undefined)
})
