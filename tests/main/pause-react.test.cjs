const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const childProcess = require('node:child_process')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, setImmediate, process,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const pr = load('shared/pause-react.ts')
const kinds = (timeline) => plain(timeline.segments.map((seg) => [seg.start, seg.end, seg.kind, seg.at]))

test('the recorder’s log becomes the timeline: held first frame, plays from where it was, holds where it paused', () => {
  const events = [
    { t: 400, o: 12000, kind: 'play' }, { t: 3400, o: 15000, kind: 'pause' }, { t: 3400, o: 15000, kind: 'pause' },
    { t: 6000, o: 15000, kind: 'play' }, { t: 9000, o: 18000, kind: 'pause' }
  ]
  const timeline = pr.timelineFromEvents(events, 10.5, 12, 40)
  assert.equal(timeline.source, 'app')
  assert.deepEqual([timeline.start, timeline.end], [0, 10.5])
  assert.deepEqual(kinds(timeline), [[0, 0.4, 'pause', 12], [0.4, 3.4, 'play', 12], [3.4, 6, 'pause', 15], [6, 9, 'play', 15], [9, 10.5, 'pause', 18]])
  assert.deepEqual(plain(pr.pauseSummary(timeline)), { pauses: 2, pausedSeconds: 4.5, playedSeconds: 6, seconds: 10.5 })
  // Never paused: one play; a log past the recording's end is cut at it; nothing logged holds the first frame.
  assert.deepEqual(kinds(pr.timelineFromEvents([{ t: 0, o: 12000, kind: 'play' }], 8, 12, 40)), [[0, 8, 'play', 12]])
  assert.deepEqual(kinds(pr.timelineFromEvents([{ t: 0, o: 0, kind: 'play' }, { t: 20000, o: 20000, kind: 'pause' }], 5, 0, 40)), [[0, 5, 'play', 0]])
  assert.deepEqual(kinds(pr.timelineFromEvents([], 5, 3, 40)), [[0, 5, 'pause', 3]])
  // A tap-tap (a 0.2 s pause) plays through: their video then runs 0.2 s ahead of the log; a 0.1 s play holds instead.
  const taps = [{ t: 0, o: 0, kind: 'play' }, { t: 2000, o: 2000, kind: 'pause' }, { t: 2200, o: 2000, kind: 'play' }, { t: 4000, o: 3800, kind: 'pause' },
    { t: 5000, o: 3800, kind: 'play' }, { t: 5100, o: 3900, kind: 'pause' }]
  assert.deepEqual(kinds(pr.timelineFromEvents(taps, 7, 0, 40)), [[0, 4, 'play', 0], [4, 7, 'pause', 4]])
  // Longer than five minutes: only the first five.
  assert.equal(pr.timelineFromEvents([], 400, 0, 40).end, pr.PAUSE_REACT_MAX_SECONDS)
  // The engine's form.
  assert.deepEqual(plain(pr.timelineForEngine(timeline)).segments[1], { start: 0.4, end: 3.4, kind: 'play', at: 12 })
  assert.deepEqual(Object.keys(pr.timelineForEngine(timeline)), ['start', 'end', 'trim_start', 'trim_end', 'source', 'segments'])
})

const detection = {
  duration: 20, offset: 2, confidence: 0.8, alignedBy: 'sound', firstVoice: 0.5, lastVoice: 19,
  raw: [[0, 2, 'pause'], [2, 6, 'play'], [6, 6.2, 'pause'], [6.2, 9, 'play'], [9, 12, 'pause'], [12, 12.3, 'play'], [12.3, 14, 'pause'], [14, 20, 'play']]
}

test('a phone recording’s timeline: lead-in held, short pauses and gaps tidied, the original placed as it plays', () => {
  const timeline = pr.uploadTimeline(detection, pr.DEFAULT_PAUSE_SETTINGS, 10, 60)
  assert.equal(timeline.source, 'upload')
  // Starts just before they first speak; the 0.2 s pause plays on; the 0.3 s gap stays paused.
  assert.deepEqual([timeline.start, timeline.end], [0.2, 20])
  assert.deepEqual(kinds(timeline), [[0.2, 2, 'pause', 10], [2, 9, 'play', 10], [9, 14, 'pause', 17], [14, 20, 'play', 17]])
  // Shorter limits: the 0.3 s gap plays (the 0.2 s pause is still under the shortest pause kept).
  const fine = pr.uploadTimeline(detection, { ...pr.DEFAULT_PAUSE_SETTINGS, minPause: 0.3, minPlay: 0.2 }, 10, 60)
  assert.deepEqual(kinds(fine).slice(2, 5), [[9, 12, 'pause', 17], [12, 12.3, 'play', 17], [12.3, 14, 'pause', 17.3]])
  // Nudged later: the original starts 1.5 s later and everything after shifts with it.
  const later = pr.uploadTimeline(detection, { ...pr.DEFAULT_PAUSE_SETTINGS, nudge: 1.5 }, 10, 60)
  assert.deepEqual(kinds(later).slice(0, 2), [[0.2, 3.5, 'pause', 10], [3.5, 9, 'play', 10]])
  // Nudged earlier: the original plays over the end of the lead-in.
  const earlier = pr.uploadTimeline(detection, { ...pr.DEFAULT_PAUSE_SETTINGS, nudge: -1 }, 10, 60)
  assert.deepEqual(kinds(earlier).slice(0, 2), [[0.2, 1, 'pause', 10], [1, 9, 'play', 10]])
  // A flipped stretch is kept as a time range.
  const flipped = pr.flipSegment(pr.DEFAULT_PAUSE_SETTINGS, timeline, 2)
  assert.deepEqual(plain(flipped.flips), [[9, 14, 'play']])
  assert.deepEqual(kinds(pr.uploadTimeline(detection, flipped, 10, 60)), [[0.2, 2, 'pause', 10], [2, 20, 'play', 10]])
  // The trim's end: the original holds after it, and the video stops shortly after they last speak.
  const short = pr.uploadTimeline({ ...detection, lastVoice: 13 }, pr.DEFAULT_PAUSE_SETTINGS, 10, 13)
  assert.equal(short.end, 13.6)
  assert.equal(short.segments[short.segments.length - 1].at, 13)
  // Never heard: starts at the recording's start.
  const unheard = pr.uploadTimeline({ ...detection, offset: 0, alignedBy: 'start', firstVoice: null, raw: [[0, 20, 'play']] }, pr.DEFAULT_PAUSE_SETTINGS, 0, 60)
  assert.deepEqual(kinds(unheard), [[0, 20, 'play', 0]])
})

test('logs, adjustments and detections from other processes are checked', () => {
  assert.deepEqual(plain(pr.parsePauseEvents([{ t: 1.4, o: 3000.2, kind: 'play' }], 1000)), [{ t: 1, o: 3000, kind: 'play' }])
  assert.deepEqual(plain(pr.parsePauseEvents(undefined, 1000)), [])
  for (const bad of [[{ t: -1, o: 0, kind: 'play' }], [{ t: 2000, o: 0, kind: 'play' }], [{ t: 1, o: 0, kind: 'stop' }], [{ t: 5, o: 0, kind: 'play' }, { t: 4, o: 0, kind: 'pause' }],
    [{ t: 1, o: Number.NaN, kind: 'play' }], [{ t: 1, o: 0, kind: 'play', extra: 1 }], 'x', Array.from({ length: 4001 }, () => ({ t: 0, o: 0, kind: 'play' }))]) {
    assert.throws(() => pr.parsePauseEvents(bad, 1000), /pause log/)
  }
  assert.deepEqual(plain(pr.parsePauseSettings({ minPause: 1, minPlay: 0.2, nudge: 0.123, flips: [[1, 2, 'pause']] })), { minPause: 1, minPlay: 0.2, nudge: 0.12, flips: [[1, 2, 'pause']] })
  for (const bad of [null, [], { minPause: 0.7, minPlay: 0.4, nudge: 0, flips: [] }, { minPause: 0.5, minPlay: 0.4, nudge: 11, flips: [] },
    { minPause: 0.5, minPlay: 0.4, nudge: 0, flips: [[2, 1, 'pause']] }, { minPause: 0.5, minPlay: 0.4, nudge: 0, flips: [[1, 2, 'jump']] },
    { minPause: 0.5, minPlay: 0.4, nudge: 0, flips: Array.from({ length: 201 }, () => [1, 2, 'play']) }, { minPause: 0.5, minPlay: 0.4, nudge: '1', flips: [] }]) {
    assert.throws(() => pr.parsePauseSettings(bad))
  }
  const parsed = pr.parsePauseDetection({ duration: 12, offset: 1.5, confidence: 2, aligned_by: 'sound', raw: [[0, 1.5, 'pause'], [1.5, 12, 'play'], [3, 2, 'play'], 'x'], first_voice: 0.3, last_voice: null })
  assert.deepEqual(plain(parsed), { duration: 12, offset: 1.5, confidence: 1, alignedBy: 'sound', raw: [[0, 1.5, 'pause'], [1.5, 12, 'play']], firstVoice: 0.3, lastVoice: null })
  assert.equal(pr.parsePauseDetection({ duration: 12, offset: 0, raw: [] }), null)
  assert.equal(pr.parsePauseDetection(null), null)
  assert.equal(pr.formatSeconds(65.25), '1:05.3')
  assert.equal(pr.formatSeconds(4), '4.0s')
})

function engineMock() {
  const configs = []
  const results = { write: null, pauses: null }
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      let result = { ok: true, remixes: [] }
      if (config.mode === 'plan') {
        // The engine fetches the video into the run and saves it for the review.
        fs.mkdirSync(path.join(config.output_dir, '.work'), { recursive: true })
        fs.writeFileSync(path.join(config.output_dir, '.work', 'plan.json'), JSON.stringify({ sources: [{ video: config.sources[0] }] }))
        result = { ok: true, cost_usd: 0, source_seconds: 30, drafts: [{ id: 0, format: 'pause_react', headline: '', intro: '', close: '', beats: [], start_ms: 0, end_ms: 30000, creator: '@coach', source_title: 'Coach clip' }] }
      } else if (config.mode === 'write') result = results.write
      else if (config.mode === 'pauses') result = results.pauses
      setImmediate(() => { child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0) })
    } }
    return child
  }
  return { configs, results, spawn }
}

test('Pause & react in main: fetched, trimmed, recorded here with a log or uploaded and its pauses found, written, then made', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-pause-'))
  const settings = { openrouterApiKey: 'or-key', outputDirectory: out, pythonPath: 'python3' }
  const engine = engineMock()
  const chosen = new Set()
  const m = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn: engine.spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: (p) => { if (!chosen.has(p)) throw new Error('Invalid media path') }, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const clip = path.join(out, 'coach.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
  chosen.add(clip)
  const request = {
    sources: [clip], creator: '@coach', angle: 'reaction', host: 'still', avatarId: null, voice: 'avatar', brandIdentityId: null, count: 3,
    captionPreset: 'pop', includeCaptions: true, aiLabelAck: false, format: 'pause_react', clipRightsAck: true,
    camera: { layout: 'cutout', backdrop: 'blur', backdropColor: '#111111', talk: false }, pause: { layout: 'split', captions: 'both' }
  }

  // Requests: one video, the permission promise, you on camera (always talking), no green screen.
  const parsed = m.parseRemixRequest(request, out).request
  assert.deepEqual([parsed.host, parsed.count, parsed.camera.talk, parsed.camera.layout, parsed.avatarId, parsed.aiLabelAck], ['camera', 1, true, 'cutout', null, false])
  assert.deepEqual(plain(parsed.pause), { layout: 'split', captions: 'both' })
  assert.deepEqual(plain(m.parseRemixRequest({ ...request, pause: undefined }, out).request.pause), { layout: 'box', captions: 'member' })
  assert.throws(() => m.parseRemixRequest({ ...request, clipRightsAck: false }, out), /allowed to use this video/)
  assert.throws(() => m.parseRemixRequest({ ...request, sources: ['https://a.com/1', 'https://a.com/2'] }, out), /one video at a time/)
  assert.throws(() => m.parseRemixRequest({ ...request, camera: { ...request.camera, layout: 'greenscreen' } }, out), /As filmed/)
  assert.throws(() => m.parseRemixRequest({ ...request, pause: { layout: 'side' } }, out), /where their video goes/)
  assert.throws(() => m.parseRemixRequest({ ...request, creator: '' }, out), /creator’s name/)

  // Starting fetches the video (no AI) and waits for review with one take.
  const started = await m.startRemix(request)
  assert.equal(started.phase, 'planning')
  const wait = async () => { for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20)) }
  await wait()
  const plan = engine.configs[0]
  assert.deepEqual([plan.mode, plan.format, plan.host, plan.pause_layout, plan.pause_captions, plan.camera_talk], ['plan', 'pause_react', 'camera', 'split', 'both', true])
  assert.equal(m.remixStatus().drafts[0].format, 'pause_react')
  assert.equal(m.pauseView(), null, 'nothing recorded yet')
  const moment = await m.remixMoment(0)
  assert.deepEqual([moment.path, moment.startSeconds, moment.endSeconds, moment.kind], [clip, 0, 30, 'video'])

  // Trimming: checked against the video's length.
  for (const [a, b] of [[0, 500], [-1, 4000], [0, 40000], [1.5, 4000], ['0', 4000]]) await assert.rejects(m.setRemixTrim(0, a, b), /at least one second/)
  const trimmed = await m.setRemixTrim(0, 12000, 24000)
  assert.deepEqual([trimmed.draft.startMs, trimmed.draft.endMs, trimmed.view], [12000, 24000, null])
  assert.deepEqual((await m.remixMoment(0)).startSeconds, 12)

  // Recorded here: the log comes with the recording, checked.
  const take = path.join(out, 'take.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=6', '-f', 'lavfi', '-i', 'sine=d=6', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', take])
  const bad = await m.beginRecording(0, 'reaction', 'video/mp4')
  await m.appendRecording(bad, new Uint8Array(fs.readFileSync(take)))
  await assert.rejects(m.finishRecording(bad, null, { events: [{ t: 5, o: 0, kind: 'play' }, { t: 1, o: 0, kind: 'pause' }], durationMs: 6000 }), /pause log/)
  assert.deepEqual(plain(m.remixRecordings()), {})
  const token = await m.beginRecording(0, 'reaction', 'video/mp4')
  await m.appendRecording(token, new Uint8Array(fs.readFileSync(take)))
  const events = [{ t: 300, o: 12000, kind: 'play' }, { t: 2300, o: 14000, kind: 'pause' }, { t: 4000, o: 14000, kind: 'play' }]
  await m.finishRecording(token, null, { events, durationMs: 6000 })
  const view = m.pauseView()
  assert.equal(view.source, 'app')
  assert.ok(Math.abs(view.timeline.end - 6) < 0.1)
  assert.deepEqual(kinds(view.timeline).slice(0, 3), [[0, 0.3, 'pause', 12], [0.3, 2.3, 'play', 12], [2.3, 4, 'pause', 14]])
  assert.throws(() => m.setPauseSettings({ ...pr.DEFAULT_PAUSE_SETTINGS, nudge: 1 }), /follow what you did/)

  // Writing: the engine gets the take and its timeline.
  engine.results.write = { ok: true, cost_usd: 0.02, drafts: [{ id: 0, format: 'pause_react', headline: 'This coach says lose weight first', intro: '', close: '', beats: [], quote: 'No way.', post_caption: 'My take.', start_ms: 0, end_ms: 1 }] }
  await m.writeRemix()
  await wait()
  const write = engine.configs.find((config) => config.mode === 'write')
  assert.equal(write.recordings[0].reaction.offset_s, 0)
  assert.equal(write.recordings[0].timeline.source, 'app')
  assert.equal(write.recordings[0].timeline.trim_start, 12)
  const written = m.remixStatus().drafts[0]
  assert.deepEqual([written.format, written.headline, written.startMs, written.endMs], ['pause_react', 'This coach says lose weight first', 12000, 24000])

  // Uploaded instead: its pauses are found from the sound, then adjusted.
  engine.results.pauses = { ok: true, detection: { duration: 6, offset: 1, confidence: 0.9, aligned_by: 'sound', raw: [[0, 1, 'pause'], [1, 3, 'play'], [3, 4.5, 'pause'], [4.5, 6, 'play']], first_voice: 0.6, last_voice: 4.4 } }
  const phone = path.join(out, 'phone.mp4')
  fs.copyFileSync(take, phone)
  await m.uploadRecording(0, 'reaction', phone)
  const pauses = engine.configs.filter((config) => config.mode === 'pauses')
  assert.equal(pauses.length, 1)
  assert.deepEqual(Object.keys(pauses[0]).sort(), ['mode', 'recording', 'source', 'trim_end', 'trim_start'])
  assert.deepEqual([pauses[0].source, pauses[0].trim_start, pauses[0].trim_end], [clip, 12, 24])
  let uploaded = m.pauseView()
  assert.equal(uploaded.source, 'upload')
  assert.deepEqual(plain(uploaded.detection), { offset: 1, confidence: 0.9, alignedBy: 'sound' })
  assert.deepEqual(kinds(uploaded.timeline), [[0.3, 1, 'pause', 12], [1, 3, 'play', 12], [3, 4.5, 'pause', 14], [4.5, 6, 'play', 14]])
  uploaded = m.setPauseSettings({ ...pr.DEFAULT_PAUSE_SETTINGS, nudge: 0.5 })
  assert.deepEqual(kinds(uploaded.timeline).slice(0, 2), [[0.3, 1.5, 'pause', 12], [1.5, 3, 'play', 12]])
  assert.throws(() => m.setPauseSettings({ ...pr.DEFAULT_PAUSE_SETTINGS, minPause: 7 }), /tidied/)
  // A new part of the video: the pauses are found again for it.
  await m.setRemixTrim(0, 10000, 24000)
  assert.equal(engine.configs.filter((config) => config.mode === 'pauses').length, 2)
  assert.equal(engine.configs.filter((config) => config.mode === 'pauses')[1].trim_start, 10)
  // An unreadable phone recording is refused and not kept.
  engine.results.pauses = { ok: false, error: 'We couldn’t hear anything in your recording. Upload one with sound.' }
  await assert.rejects(m.uploadRecording(0, 'reaction', phone), /couldn’t hear anything/)
  assert.equal(m.pauseView().source, 'upload', 'the earlier upload is kept')

  // Making it: the edited headline, the take and its timeline (nudge kept) go to the engine.
  await m.renderRemix([{ id: 0, headline: 'I tried lose weight first', intro: '', close: '', beats: [] }])
  const render = engine.configs[engine.configs.length - 1]
  assert.equal(render.mode, 'render')
  assert.equal(render.approved[0].headline, 'I tried lose weight first')
  assert.equal(render.recordings[0].timeline.source, 'upload')
  assert.equal(render.recordings[0].timeline.trim_start, 10)
  assert.equal(render.recordings[0].timeline.segments[1].start, 1.5)
  assert.deepEqual([render.pause_layout, render.pause_captions, render.camera_layout], ['split', 'both', 'cutout'])
  await new Promise((resolve) => setTimeout(resolve, 50))
  fs.rmSync(out, { recursive: true, force: true })
})

test('a buffering stall while their video plays holds the frame (logged as a pause), and play resumes from where it stalled', () => {
  // The recorder: 'waiting' counts only while playing; 'playing' after it is a play.
  assert.equal(pr.recorderEventKind('waiting', { t: 1000, o: 1000, kind: 'play' }), 'pause')
  assert.equal(pr.recorderEventKind('waiting', { t: 1000, o: 1000, kind: 'pause' }), null)
  assert.equal(pr.recorderEventKind('waiting', undefined), null)
  assert.equal(pr.recorderEventKind('playing', { t: 1000, o: 1000, kind: 'pause' }), 'play')
  assert.equal(pr.recorderEventKind('pause', undefined), 'pause')
  // Replaying a recorder log: plays at 0, stalls 3-5 s at 3 s in, plays on from 3 s, the member pauses at 8.
  const log = []
  const media = [['playing', 0, 0], ['waiting', 3000, 3000], ['playing', 5000, 3000], ['pause', 8000, 6000]]
  for (const [type, t, o] of media) { const kind = pr.recorderEventKind(type, log[log.length - 1]); if (kind) log.push({ t, o, kind }) }
  assert.deepEqual(kinds(pr.timelineFromEvents(log, 10, 0, 40)), [[0, 3, 'play', 0], [3, 5, 'pause', 3], [5, 8, 'play', 3], [8, 10, 'pause', 6]])
  // Before: the stall counted as play, so the original ran on through frames the member never saw while it stalled.
  const asPlay = media.filter(([type]) => type !== 'waiting').map(([type, t, o]) => ({ t, o, kind: type === 'pause' ? 'pause' : 'play' }))
  assert.deepEqual(kinds(pr.timelineFromEvents(asPlay, 10, 0, 40)).slice(0, 1), [[0, 5, 'play', 0]])
})
