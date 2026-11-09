const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const childProcess = require('node:child_process')

// "You on camera" vs "AI presenter", and the two short-clip templates (Their clip, then me / React, then my thoughts)
// in main: requests, the part of their clip, both recordings, the b-roll (your clips, stock, the plan), writing and making.

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function load(relative, mocks = {}, globals = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, setImmediate, process, AbortSignal, Response, ...globals,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks, globals)
      return require(id)
    }
  })
  return module.exports
}

const remixShared = load('shared/remix.ts')
const rt = load('shared/react-templates.ts')

test('Remix splits into You on camera and AI presenter: the cards on each side, and which side a format is on', () => {
  const { CAMERA_CARDS, AI_CARDS, remixMode } = remixShared
  assert.deepEqual(plain(CAMERA_CARDS.map((card) => card.label)), ['Pause & react', 'Their clip, then me', 'React, then my thoughts', 'Moment + my take', 'Article or post',
    'Green screen over their video', 'Scripted take'])
  assert.deepEqual(plain(AI_CARDS.map((card) => card.label)), ['Voiced take', 'React to a clip'])
  // One plain line each.
  for (const card of [...CAMERA_CARDS, ...AI_CARDS]) assert.ok(!card.detail.includes('.') && card.detail.length <= 80, card.detail)
  assert.equal(remixMode('commentary', 'still'), 'ai')
  assert.equal(remixMode('silent', 'voice'), 'ai')
  assert.equal(remixMode('commentary', 'camera'), 'camera')
  assert.equal(remixMode('silent', 'camera'), 'camera')
  for (const format of ['pause_react', 'moment_take', 'image', 'clip_then_me', 'react_thoughts']) assert.equal(remixMode(format, 'still'), 'camera', format)
  // Both new templates are recorded unscripted; React, then my thoughts has two parts.
  assert.deepEqual(plain(remixShared.partsFor('react_thoughts', 0)), ['reaction', 'thoughts'])
  assert.deepEqual(plain(remixShared.partsFor('clip_then_me', 0)), ['reaction'])
  assert.equal(remixShared.isRecordingPart('thoughts'), true)
  for (const format of ['clip_then_me', 'react_thoughts']) {
    assert.equal(remixShared.headlineOnly(format), true)
    assert.equal(remixShared.oneTake(format), true)
    assert.equal(remixShared.parseRemixDraft({ id: 0, format, headline: '', intro: '', close: '', beats: [] }).format, format)
  }
  // Existing prices only: transcribing up to three minutes twice and a short writing call (plus one b-roll call).
  assert.deepEqual(plain(remixShared.estimateRemixCost('camera', 1, 0, 'clip_then_me')), plain(remixShared.estimateRemixCost('camera', 1, 0, 'pause_react')))
  assert.ok(remixShared.estimateRemixCost('camera', 1, 0, 'react_thoughts').total > remixShared.estimateRemixCost('camera', 1, 0, 'clip_then_me').total)
})

test('b-roll plans from the review are checked: your clips, stock only when on, 1.5–4 s, clear of the first 2 s and the last 1.5 s, no overlaps', () => {
  const ids = new Set(['b0000000a', 'b0000000b'])
  const shot = (start, end, item = 'b0000000a', query = 'red car') => ({ start, end, item, query, words: 'the red car' })
  assert.deepEqual(plain(rt.parseBrollPlan([shot(5, 7), shot(2, 3.5, null)], ids, true, 12)),
    [{ start: 2, end: 3.5, item: null, query: 'red car', words: 'the red car' }, { start: 5, end: 7, item: 'b0000000a', query: 'red car', words: 'the red car' }])
  assert.deepEqual(plain(rt.parseBrollPlan([], ids, false, 12)), [])
  const cases = [
    [[shot(1, 3)], /2 seconds into your thoughts/],
    [[shot(2, 3)], /1\.5–4 seconds/],
    [[shot(2, 6.5)], /1\.5–4 seconds/],
    [[shot(9, 11)], /1\.5 seconds before your thoughts do/],
    [[shot(2, 4), shot(3.5, 5.5)], /overlap/],
    [[shot(2, 4, null)], /Turn on stock footage/],
    [[shot(2, 4, 'b0000000c')], /no longer in your b-roll/],
    [[{ ...shot(2, 4), item: '../x' }], /damaged/],
    [[shot(2, 4, null, '!!')], /no search/],
    ['nope', /damaged/],
    [Array.from({ length: 13 }, (_, i) => shot(2 + i * 5, 4 + i * 5)), /damaged/]
  ]
  for (const [plan, problem] of cases) assert.throws(() => rt.parseBrollPlan(plan, ids, plan[0]?.item === null && !/Turn on/.test(String(problem)), 12), problem, JSON.stringify(plan).slice(0, 80))
  // From the engine: read leniently (a shot for a removed clip is dropped).
  assert.deepEqual(plain(rt.readBrollPlan([{ start: 2, end: 3.5, item: 'b0000000a', query: 'x' }, { start: 5, end: 7, item: 'b0000000c' }, { start: 8, end: 9.5, item: null, query: 'sea' }, 'x'], ids)),
    [{ start: 2, end: 3.5, item: 'b0000000a', query: 'x', words: '' }, { start: 8, end: 9.5, item: null, query: 'sea', words: '' }])
  assert.equal(rt.brollKind('Clip.MOV'), 'video')
  assert.equal(rt.brollKind('photo.webp'), 'image')
  assert.equal(rt.brollKind('notes.txt'), null)
  assert.equal(rt.longClipNote(120), null)
  assert.match(rt.longClipNote(725), /^This video is 12:05 long\. Their clip, then me is for short clips: .*Moment \+ my take/)
  assert.equal(rt.longClipNote(null), null)
})

function engineMock(format, out) {
  const configs = []
  const results = { write: null, broll: null, render: { ok: true, remixes: [] } }
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0; child.exitCode = null; child.signalCode = null
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      let result = results.render
      if (config.mode === 'plan') {
        fs.mkdirSync(path.join(config.output_dir, '.work'), { recursive: true })
        fs.writeFileSync(path.join(config.output_dir, '.work', 'plan.json'), JSON.stringify({ sources: [{ video: results.video }] }))
        result = { ok: true, cost_usd: 0, source_seconds: 600, warnings: [], drafts: [{ id: 0, format, headline: '', intro: '', close: '', beats: [], start_ms: 0, end_ms: 60000,
          creator: '@coach', source_title: 'The ad' }] }
      } else if (config.mode === 'write') result = results.write
      else if (config.mode === 'broll') result = results.broll
      setImmediate(() => { child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0) })
    } }
    return child
  }
  return { configs, results, spawn, out }
}

function mainRemix(out, engine, settings) {
  return load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn: engine.spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
}

const REQUEST = {
  sources: ['https://www.instagram.com/reel/abc'], creator: '', angle: 'reaction', host: 'still', avatarId: null, voice: 'avatar', brandIdentityId: null, count: 5,
  captionPreset: 'pop', includeCaptions: true, aiLabelAck: false, clipRightsAck: true, camera: { layout: 'cutout', backdrop: 'blur', backdropColor: '#111111', talk: false }
}

function video(out, name, seconds, sound = true) {
  const file = path.join(out, name)
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=red:s=64x64:d=${seconds}:r=10`, ...(sound ? ['-f', 'lavfi', '-i', `sine=d=${seconds}`, '-shortest'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(sound ? ['-c:a', 'aac'] : []), file])
  return file
}

test('Their clip, then me in main: one short clip, on camera, the part of it (up to 3 minutes), one take, written then made', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-clip-'))
  const engine = engineMock('clip_then_me', out)
  const m = mainRemix(out, engine, { openrouterApiKey: 'or-key', outputDirectory: out, pythonPath: 'python3', pexelsApiKey: '' })
  const request = { ...REQUEST, format: 'clip_then_me' }
  try {
    const parsed = m.parseRemixRequest(request, out).request
    assert.deepEqual(plain([parsed.host, parsed.count, parsed.camera.talk, parsed.camera.layout, parsed.aiLabelAck, parsed.pause === undefined]), ['camera', 1, true, 'cutout', false, true])
    assert.throws(() => m.parseRemixRequest({ ...request, clipRightsAck: false }, out), /allowed to use this video: your video plays it/)
    assert.throws(() => m.parseRemixRequest({ ...request, sources: ['https://a.com/1', 'https://a.com/2'] }, out), /one video at a time/)
    assert.throws(() => m.parseRemixRequest({ ...request, camera: { ...request.camera, layout: 'greenscreen' } }, out), /Background removed” for Their clip, then me/)
    assert.throws(() => m.parseRemixRequest({ ...request, format: 'their_clip' }, out), /kind of remix/)

    engine.results.video = video(out, 'reel.mp4', 2)
    const started = await m.startRemix(request)
    assert.ok(Math.abs(started.estimateUsd - remixShared.estimateRemixCost('camera', 1, 0, 'clip_then_me').total) < 1e-9)
    for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(plain([engine.configs[0].mode, engine.configs[0].format, engine.configs[0].host]), ['plan', 'clip_then_me', 'camera'])
    assert.equal(m.brollView(), null, 'no b-roll in this one')
    // The part of their clip: up to three minutes (the source is 10 minutes long).
    await assert.rejects(m.setRemixTrim(0, 0, 200000), /up to 3 minutes/)
    await assert.rejects(m.setRemixTrim(0, 599900, 601000), /at least one second/)
    const { draft } = await m.setRemixTrim(0, 30000, 150000)
    assert.deepEqual(plain([draft.startMs, draft.endMs]), [30000, 150000])
    assert.equal((await m.remixMoment(0)).startSeconds, 30)

    // Your take: over three minutes is refused; a phone video is kept.
    await assert.rejects(m.uploadRecording(0, 'reaction', video(out, 'long.mp4', 190, false)), /Keep your take to 3 minutes/)
    await assert.rejects(m.uploadRecording(0, 'thoughts', video(out, 'take.mp4', 3)), /what to record/)
    await m.uploadRecording(0, 'reaction', path.join(out, 'take.mp4'))
    engine.results.write = { ok: true, cost_usd: 0.012, take_seconds: 3, drafts: [{ id: 0, format: 'clip_then_me', headline: 'This serum changed her skin? Not mine', intro: '', close: '', beats: [],
      post_caption: 'My take.', start_ms: 1, end_ms: 2, quote: 'Honestly I tried it' }] }
    await m.writeRemix()
    for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    const write = engine.configs.find((config) => config.mode === 'write')
    assert.deepEqual(plain(write.clip_trim), [30000, 150000])
    assert.equal(write.recordings[0].reaction.offset_s, 0)
    assert.equal(write.broll_items, undefined)
    const status = m.remixStatus()
    assert.deepEqual(plain([status.drafts[0].headline, status.drafts[0].format, status.drafts[0].startMs, status.drafts[0].endMs]), ['This serum changed her skin? Not mine', 'clip_then_me', 30000, 150000])
    assert.ok(Math.abs(status.costUsd - 0.012) < 1e-9)
    await m.renderRemix([{ id: 0, headline: 'This serum changed her skin? Not mine', intro: '', close: '', beats: [] }])
    const render = engine.configs[engine.configs.length - 1]
    assert.deepEqual(plain([render.mode, render.clip_trim, render.recordings[0].reaction.offset_s]), ['render', [30000, 150000], 0])
    await new Promise((resolve) => setTimeout(resolve, 50))
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

test('React, then my thoughts in main: both parts, your b-roll copied in, stock, the plan (written, changed, planned again), made with it', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-react-'))
  const engine = engineMock('react_thoughts', out)
  const settings = { openrouterApiKey: 'or-key', outputDirectory: out, pythonPath: 'python3', pexelsApiKey: '' }
  const m = mainRemix(out, engine, settings)
  const spent = []
  m.onRemixMomentSpend((usd, label) => spent.push([usd, label]))
  const wait = async () => { for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20)) }
  try {
    engine.results.video = video(out, 'ad.mp4', 2)
    await m.startRemix({ ...REQUEST, format: 'react_thoughts' })
    await wait()
    assert.deepEqual(plain(m.brollView()), { items: [], stock: false, pexels: false, plan: null, takeSeconds: null })
    await m.setRemixTrim(0, 5000, 20000)

    // Part 1 recorded here: the recorder says where their clip started (its microphone isn't used); part 2 uploaded.
    const take = video(out, 'take.mp4', 3)
    const token = await m.beginRecording(0, 'reaction', 'video/mp4')
    await m.appendRecording(token, new Uint8Array(fs.readFileSync(take)))
    await m.finishRecording(token, 1.25)
    await assert.rejects(m.writeRemix(), /Record both parts first/)
    // A phone video of you watching can be the clip's length plus a minute; your thoughts up to three minutes.
    await assert.rejects(m.uploadRecording(0, 'reaction', video(out, 'watch-long.mp4', 80, false)), /much longer than their clip/)
    await assert.rejects(m.uploadRecording(0, 'thoughts', video(out, 'long.mp4', 190, false)), /Keep your take to 3 minutes/)
    await m.uploadRecording(0, 'thoughts', take)
    assert.deepEqual(plain(Object.keys(m.remixRecordings()[0]).sort()), ['reaction', 'thoughts'])

    // Your b-roll: videos and pictures, copied into the run; other files refused; up to 12.
    const red = video(out, 'red car.mp4', 1, false)
    const pic = path.join(out, 'cream.png')
    childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=yellow:s=32x32:d=1', '-frames:v', '1', pic])
    fs.writeFileSync(path.join(out, 'notes.txt'), 'x')
    await assert.rejects(m.addBroll([path.join(out, 'notes.txt')]), /Choose videos/)
    await assert.rejects(m.addBroll(Array.from({ length: 13 }, () => red)), /up to 12/)
    let view = await m.addBroll([red, pic])
    assert.deepEqual(plain(view.items.map((item) => [item.name, item.kind])), [['red car.mp4', 'video'], ['cream.png', 'image']])
    const [own1, own2] = view.items.map((item) => item.id)
    // Two adds at once can't pass the limit together (room is held before copying); the refused one leaves no files.
    const before = fs.readdirSync(path.join(m.remixStatus().folder, '.broll')).length
    const both = await Promise.allSettled([m.addBroll(Array.from({ length: 6 }, () => red)), m.addBroll(Array.from({ length: 6 }, () => red))])
    assert.deepEqual(both.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
    assert.match(both.find((result) => result.status === 'rejected').reason.message, /up to 12 clips or pictures \(4 more\)/)
    const extra = m.brollView().items.slice(2)
    assert.equal(extra.length, 6)
    assert.equal(fs.readdirSync(path.join(m.remixStatus().folder, '.broll')).length, before + 6)
    for (const item of extra) await m.removeBroll(item.id)
    view = m.brollView()
    assert.ok(view.items.every((item) => /^b[0-9a-f]{8}$/.test(item.id) && item.path.startsWith(path.join(m.remixStatus().folder, '.broll')) && fs.existsSync(item.path)))
    // Stock on (no Pexels key: the review says so and links to it).
    view = m.setBrollStock(true)
    assert.deepEqual(plain([view.stock, view.pexels]), [true, false])
    assert.throws(() => m.setBrollStock('yes'), /stock footage/)

    // Writing: both parts, the part of their clip, your b-roll and stock go to the engine; the plan comes back.
    engine.results.write = { ok: true, cost_usd: 0.016, take_seconds: 12, broll_plan: [
      { start: 2, end: 3.5, item: own1, query: 'red car', words: 'the red car' }, { start: 4.5, end: 6, item: own2, query: 'skin cream', words: 'this cream' },
      { start: 7.5, end: 9.5, item: null, query: 'green field', words: 'outside' }],
    drafts: [{ id: 0, format: 'react_thoughts', headline: 'I tried the one week serum', intro: '', close: '', beats: [], post_caption: 'Mine.', start_ms: 1, end_ms: 2 }] }
    await m.writeRemix()
    await wait()
    const write = engine.configs.find((config) => config.mode === 'write')
    assert.deepEqual(plain(write.clip_trim), [5000, 20000])
    assert.equal(write.recordings[0].reaction.offset_s, 1.25)
    assert.equal(write.recordings[0].thoughts.offset_s, 0)
    assert.deepEqual(plain(write.broll_items.map((item) => [item.id, item.kind, item.name])), [[own1, 'video', 'red car.mp4'], [own2, 'image', 'cream.png']])
    assert.equal(write.broll_stock, true)
    assert.equal(write.broll_plan, undefined, 'writing plans it anew')
    view = m.brollView()
    assert.deepEqual(plain(view.plan.map((shot) => [shot.start, shot.item])), [[2, own1], [4.5, own2], [7.5, null]])
    assert.equal(view.takeSeconds, 12)
    assert.equal(m.remixStatus().drafts[0].startMs, 5000, 'the part of their clip stays as chosen')

    // Your changes: swap the stock shot for your clip, remove one; a bad plan is refused.
    view = m.setBrollPlan([{ ...view.plan[0] }, { ...view.plan[2], item: own2 }])
    assert.deepEqual(plain(view.plan.map((shot) => [shot.start, shot.item])), [[2, own1], [7.5, own2]])
    assert.throws(() => m.setBrollPlan([{ ...view.plan[0], start: 0.5 }]), /2 seconds into your thoughts/)
    assert.throws(() => m.setBrollPlan([{ ...view.plan[0], end: 11.5 }]), /1\.5–4 seconds|1\.5 seconds before/)
    // Stock off drops stock shots; removing a clip drops its shots.
    view = await m.removeBroll(own2)
    assert.deepEqual(plain(view.plan.map((shot) => shot.item)), [own1])
    await assert.rejects(m.removeBroll(own2), /no longer in your b-roll/)

    // "Plan my b-roll" again: one small engine call; its cost goes on the run (and so to the ledger); a failure's cost too.
    engine.results.broll = { ok: true, cost_usd: 0.004, take_seconds: 12, broll_plan: [{ start: 3, end: 5, item: own1, query: 'car', words: 'my car' }] }
    view = await m.planBroll()
    const call = engine.configs.find((config) => config.mode === 'broll')
    assert.deepEqual(plain([call.format, call.clip_trim, call.broll_items.length, call.recordings[0].thoughts.offset_s]), ['react_thoughts', [5000, 20000], 1, 0])
    assert.deepEqual(plain(view.plan.map((shot) => [shot.start, shot.end])), [[3, 5]])
    assert.ok(Math.abs(m.remixStatus().costUsd - 0.02) < 1e-9, String(m.remixStatus().costUsd))
    engine.results.broll = { ok: false, cost_usd: 0.003, error: 'Your b-roll couldn’t be planned this time. Try again.' }
    await assert.rejects(m.planBroll(), /couldn’t be planned/)
    assert.ok(Math.abs(m.remixStatus().costUsd - 0.023) < 1e-9)
    assert.deepEqual(plain(m.brollView().plan.map((shot) => shot.start)), [3], 'the plan is kept')

    // Changing the part of their clip after part 1: part 1 is recorded again (it was filmed with the old part playing).
    await m.setRemixTrim(0, 6000, 20000)
    assert.deepEqual(plain(Object.keys(m.remixRecordings()[0])), ['thoughts'])
    const again = await m.beginRecording(0, 'reaction', 'video/mp4')
    await m.appendRecording(again, new Uint8Array(fs.readFileSync(take)))
    await m.finishRecording(again, 0.5)

    // Making it: the plan as left, your clips, stock on, both parts.
    await m.renderRemix([{ id: 0, headline: 'I tried the one week serum', intro: '', close: '', beats: [] }])
    const render = engine.configs[engine.configs.length - 1]
    assert.equal(render.mode, 'render')
    assert.deepEqual(plain(render.clip_trim), [6000, 20000])
    assert.deepEqual(plain(render.broll_plan), [{ start: 3, end: 5, item: own1, query: 'car', words: 'my car' }])
    assert.deepEqual(plain([render.recordings[0].reaction.offset_s, render.broll_stock, render.broll_items.length]), [0.5, true, 1])
    assert.deepEqual(plain(spent), [], 'every cost went through the open review')
    await new Promise((resolve) => setTimeout(resolve, 50))
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})
