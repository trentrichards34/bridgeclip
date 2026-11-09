const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const childProcess = require('node:child_process')

// The reels' layouts in main: the choices on Remix (their captions, the hook on the split line or beside you, the phone
// card) and, in the review, part 2 over a screen recording (banner, circles) and proof screenshots, all sent to the engine.

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, setImmediate, process, AbortSignal, Response,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const layouts = load('shared/remix-layouts.ts')

test('layout choices: their captions from the link, the hook placements each format offers, and bad choices refused', () => {
  assert.equal(layouts.defaultTheirCaptions('https://www.instagram.com/reel/abc'), 'yes')
  assert.equal(layouts.defaultTheirCaptions('https://vm.tiktok.com/xyz'), 'yes')
  assert.equal(layouts.defaultTheirCaptions('https://youtube.com/shorts/x'), 'auto')
  assert.equal(layouts.defaultTheirCaptions('/Users/me/reel.mp4'), 'auto')
  assert.deepEqual(plain(layouts.hookChoices('pause_react', 'split', 'box')), ['seam', 'top'])
  assert.deepEqual(plain(layouts.hookChoices('pause_react', 'box', 'box')), ['top'])
  assert.deepEqual(plain(layouts.hookChoices('react_thoughts', null, 'phone')), ['beside', 'top'])
  // Not given: the default for the layout (the split line for a split Pause & react).
  assert.deepEqual(plain(layouts.parseLayoutChoice(undefined, 'pause_react', 'split')), { theirCaptions: 'auto', hookAt: 'seam', part1: 'box' })
  assert.deepEqual(plain(layouts.parseLayoutChoice({ theirCaptions: 'yes', part1: 'phone' }, 'react_thoughts', null)), { theirCaptions: 'yes', hookAt: 'beside', part1: 'phone' })
  assert.deepEqual(plain(layouts.parseLayoutChoice({ hookAt: 'top', part1: 'phone' }, 'react_thoughts', null)).hookAt, 'top')
  for (const [value, format, pause, problem] of [
    [{ hookAt: 'seam' }, 'clip_then_me', null, /hook text/], [{ hookAt: 'seam' }, 'pause_react', 'box', /hook text/], [{ part1: 'phone' }, 'clip_then_me', null, /their clip shows/],
    [{ hookAt: 'beside' }, 'react_thoughts', null, /hook text/], [{ theirCaptions: 'maybe' }, 'clip_then_me', null, /captions/], [{ x: 1 }, 'clip_then_me', null, /layout again/], ['top', 'pause_react', null, /layout again/]
  ]) assert.throws(() => layouts.parseLayoutChoice(value, format, pause), problem, JSON.stringify(value))
  // The engine's form: the choice, plus what the review added (a screen recording's circles only with the recording).
  const extras = { part2: 'screen', screen: { id: 's00000000', name: 'x.mov', path: '/run/.layout/s00000000.mov' }, banner: true, circles: [{ at: 3, x: 0.5, y: 0.5 }],
    proofs: [{ id: 'p0000000a', name: 'a.png', path: '/run/.layout/p0000000a.png', at: null, label: 'Thread', highlight: null }] }
  assert.deepEqual(plain(layouts.engineLayout({ theirCaptions: 'yes', hookAt: 'beside', part1: 'phone' }, extras)), {
    their_captions: 'yes', hook_at: 'beside', part1: 'phone', part2: 'screen', screen: { path: '/run/.layout/s00000000.mov' }, circles: [{ at: 3, x: 0.5, y: 0.5 }], banner: true,
    proofs: [{ id: 'p0000000a', path: '/run/.layout/p0000000a.png', at: null, label: 'Thread', highlight: null }] })
  assert.deepEqual(plain(layouts.engineLayout({ theirCaptions: 'auto', hookAt: 'top', part1: 'box' }, { ...extras, screen: null })).part2, 'camera')
  // Default proof times spread over the take (2 s in, 1.5 s before the end), the member's own kept.
  assert.deepEqual(plain(layouts.proofStarts([{ at: null }, { at: 9 }, { at: null }], 20)), [2.3, 9, 13.3])
})

test('review changes are checked: part 2, banner, circles, and each screenshot (known ids, times, labels, highlight boxes)', () => {
  const ids = new Set(['p0000000a', 'p0000000b'])
  const patch = layouts.parseExtrasPatch({ part2: 'screen', banner: true, circles: [{ at: 9, x: 0.2, y: 0.4 }, { at: 3.33, x: 1, y: 0 }],
    proofs: [{ id: 'p0000000b', at: 4.26, label: ' My\npost ', highlight: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 } }, { id: 'p0000000a', at: null, label: '', highlight: null }] }, 'react_thoughts', ids)
  assert.deepEqual(plain(patch.circles.map((c) => c.at)), [3.33, 9])
  assert.deepEqual(plain(patch.proofs[0]), { id: 'p0000000b', at: 4.3, label: 'My post', highlight: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 } })
  for (const [value, format, problem] of [
    [{ part2: 'screen' }, 'clip_then_me', /part 2 looks/], [{ banner: true }, 'clip_then_me', /banner/], [{ circles: Array(9).fill({ at: 1, x: 0, y: 0 }) }, 'react_thoughts', /up to 8/],
    [{ circles: [{ at: 1, x: 2, y: 0 }] }, 'react_thoughts', /circle/], [{ proofs: [{ id: 'p0000000c', at: null }] }, 'clip_then_me', /no longer here/],
    [{ proofs: [{ id: 'p0000000a' }, { id: 'p0000000a' }] }, 'clip_then_me', /no longer here/], [{ proofs: [{ id: 'p0000000a', at: -1 }] }, 'clip_then_me', /time within/],
    [{ proofs: [{ id: 'p0000000a', highlight: { x: 0.8, y: 0, w: 0.5, h: 0.2 } }] }, 'clip_then_me', /inside the screenshot/],
    [{ proofs: [{ id: 'p0000000a', highlight: { x: 0, y: 0, w: 0.5 } }] }, 'clip_then_me', /damaged/], [{ other: 1 }, 'clip_then_me', /could not be read/]
  ]) assert.throws(() => layouts.parseExtrasPatch(value, format, ids), problem, JSON.stringify(value))
})

function engineMock(format) {
  const configs = []
  const results = { video: null, render: { ok: true, remixes: [] } }
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
        result = { ok: true, cost_usd: 0, source_seconds: 20, warnings: [], drafts: [{ id: 0, format, headline: '', intro: '', close: '', beats: [], start_ms: 0, end_ms: 8000,
          creator: '@coach', source_title: 'The ad' }] }
      }
      setImmediate(() => { child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0) })
    } }
    return child
  }
  return { configs, results, spawn }
}

function mainRemix(out, engine) {
  return load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn: engine.spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => ({ openrouterApiKey: 'or-key', outputDirectory: out, pythonPath: 'python3', pexelsApiKey: '' }), getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
}

const REQUEST = {
  sources: ['https://www.instagram.com/reel/abc'], creator: '', angle: 'reaction', host: 'camera', avatarId: null, voice: 'avatar', brandIdentityId: null, count: 1,
  captionPreset: 'pop', includeCaptions: true, aiLabelAck: false, clipRightsAck: true, ctaKeyword: 'FLY', ctaOffer: 'the prompt',
  camera: { layout: 'filmed', backdrop: 'blur', backdropColor: '#111111', talk: false }
}

function video(out, name, seconds, sound = false) {
  const file = path.join(out, name)
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=red:s=64x64:d=${seconds}:r=10`, ...(sound ? ['-f', 'lavfi', '-i', `sine=d=${seconds}`, '-shortest'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(sound ? ['-c:a', 'aac'] : []), file])
  return file
}

test('requests carry the layout for the reaction templates only', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-layout-req-'))
  const m = mainRemix(out, engineMock('react_thoughts'))
  try {
    const parsed = m.parseRemixRequest({ ...REQUEST, format: 'react_thoughts', layout: { theirCaptions: 'yes', part1: 'phone', hookAt: 'beside' } }, out).request
    assert.deepEqual(plain(parsed.layout), { theirCaptions: 'yes', hookAt: 'beside', part1: 'phone' })
    assert.deepEqual(plain(m.parseRemixRequest({ ...REQUEST, format: 'pause_react', pause: { layout: 'split', captions: 'both' } }, out).request.layout),
      { theirCaptions: 'auto', hookAt: 'seam', part1: 'box' })
    assert.throws(() => m.parseRemixRequest({ ...REQUEST, format: 'clip_then_me', layout: { hookAt: 'seam' } }, out), /hook text/)
    assert.throws(() => m.parseRemixRequest({ ...REQUEST, format: 'moment_take', moment: { ranges: [{ startS: 0, endS: 60 }] }, layout: { theirCaptions: 'yes' } }, out), /layout again/)
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

test('React, then my thoughts review: a screen recording with circles and the banner, proof screenshots copied in, all sent when made', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-layout-'))
  const engine = engineMock('react_thoughts')
  const m = mainRemix(out, engine)
  try {
    engine.results.video = video(out, 'ad.mp4', 2)
    await m.startRemix({ ...REQUEST, format: 'react_thoughts', layout: { theirCaptions: 'yes', part1: 'phone', hookAt: 'beside' } })
    for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(plain(engine.configs[0].layout), { their_captions: 'yes', hook_at: 'beside', part1: 'phone' })
    let view = m.layoutExtrasView()
    assert.deepEqual(plain(view), { format: 'react_thoughts', part2: 'camera', screen: null, banner: false, circles: [], keyword: 'FLY', proofs: [] })
    // Circles and part 2 on a screen recording need the recording first.
    assert.throws(() => m.setLayoutExtras({ part2: 'screen' }), /screen recording first/)
    assert.throws(() => m.setLayoutExtras({ circles: [{ at: 1, x: 0.5, y: 0.5 }] }), /screen recording first/)
    fs.writeFileSync(path.join(out, 'notes.txt'), 'x')
    await assert.rejects(m.addScreenRecording(path.join(out, 'notes.txt')), /Choose a screen recording/)
    view = await m.addScreenRecording(video(out, 'tool demo.mov', 1))
    assert.equal(view.part2, 'screen')
    assert.ok(/^s[0-9a-f]{8}$/.test(view.screen.id) && view.screen.name === 'tool demo.mov' && view.screen.path.startsWith(path.join(m.remixStatus().folder, '.layout')))
    view = m.setLayoutExtras({ banner: true, circles: [{ at: 4.5, x: 0.3, y: 0.6 }] })
    assert.deepEqual(plain([view.banner, view.circles]), [true, [{ at: 4.5, x: 0.3, y: 0.6 }]])

    // Proof screenshots: pictures only, up to six; each gets a time, a label and a highlight box.
    const shot = path.join(out, 'post.png')
    childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=yellow:s=32x32:d=1', '-frames:v', '1', shot])
    await assert.rejects(m.addProofs([path.join(out, 'notes.txt')]), /JPG, PNG or WebP/)
    await assert.rejects(m.addProofs(Array(7).fill(shot)), /up to 6/)
    view = await m.addProofs([shot, shot])
    assert.deepEqual(plain(view.proofs.map((proof) => [proof.name, proof.at, proof.label, proof.highlight])), [['post.png', null, '', null], ['post.png', null, '', null]])
    const [a, b] = view.proofs.map((proof) => proof.id)
    view = m.setLayoutExtras({ proofs: [{ id: b, at: 6, label: 'Thread', highlight: { x: 0.1, y: 0.5, w: 0.4, h: 0.1 } }, { id: a, at: null, label: '', highlight: null }] })
    assert.deepEqual(plain(view.proofs.map((proof) => [proof.id, proof.at, proof.label])), [[b, 6, 'Thread'], [a, null, '']])
    assert.throws(() => m.setLayoutExtras({ proofs: [{ id: a, at: null, label: '', highlight: null }] }), /out of date/)
    view = await m.removeLayoutItem(a)
    assert.equal(view.proofs.length, 1)
    await assert.rejects(m.removeLayoutItem(a), /no longer here/)

    // Made with all of it (once both parts are recorded).
    const take = video(out, 'take.mp4', 3, true)
    await m.uploadRecording(0, 'reaction', take)
    await m.uploadRecording(0, 'thoughts', take)
    await m.renderRemix([{ id: 0, headline: 'How to do this', intro: '', close: '', beats: [] }])
    const render = engine.configs[engine.configs.length - 1]
    assert.equal(render.mode, 'render')
    assert.deepEqual(plain(render.layout), {
      their_captions: 'yes', hook_at: 'beside', part1: 'phone', part2: 'screen', screen: { path: view.screen.path }, circles: [{ at: 4.5, x: 0.3, y: 0.6 }], banner: true,
      proofs: [{ id: b, path: view.proofs[0].path, at: 6, label: 'Thread', highlight: { x: 0.1, y: 0.5, w: 0.4, h: 0.1 } }] })
    await new Promise((resolve) => setTimeout(resolve, 50))
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

test('Their clip, then me review: proof screenshots, but no screen recording or banner', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-layout-clip-'))
  const engine = engineMock('clip_then_me')
  const m = mainRemix(out, engine)
  try {
    engine.results.video = video(out, 'reel.mp4', 2)
    await m.startRemix({ ...REQUEST, format: 'clip_then_me', layout: { theirCaptions: 'auto' } })
    for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(m.layoutExtrasView().format, 'clip_then_me')
    await assert.rejects(m.addScreenRecording(video(out, 'screen.mp4', 1)), /Only React, then my thoughts/)
    assert.throws(() => m.setLayoutExtras({ banner: true }), /banner/)
    await m.uploadRecording(0, 'reaction', video(out, 'take.mp4', 3, true))
    await m.renderRemix([{ id: 0, headline: 'My honest take on this', intro: '', close: '', beats: [] }])
    const render = engine.configs[engine.configs.length - 1]
    assert.deepEqual(plain(render.layout), { their_captions: 'auto', hook_at: 'top', part1: 'box', part2: 'camera', banner: false, proofs: [] })
    await new Promise((resolve) => setTimeout(resolve, 50))
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})
