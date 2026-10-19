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

const mt = load('shared/moment-take.ts')
const remixShared = load('shared/remix.ts')

test('timecodes: typed the ways people write them, and shown back plainly', () => {
  const cases = { '37:00': 2220, '37:12.5': 2232.5, '1:02:03': 3723, '125:30': 7530, '0:05': 5, '45': 45, '1h2m3s': 3723, '37m': 2220, '90s': 90, '37 min': 2220,
    ' 37∶00 ': 2220, '1:2:03': 3723 }
  for (const [text, seconds] of Object.entries(cases)) assert.equal(mt.parseTimecode(text), seconds, text)
  for (const bad of ['', 'abc', '37:60', '1:60:00', '37:0', '12:34:56:78', '-5', '1e3', '37:00 to 42:00', 'x'.repeat(30)]) assert.equal(mt.parseTimecode(bad), null, bad)
  assert.equal(mt.formatTimecode(2220), '37:00')
  assert.equal(mt.formatTimecode(3723.4), '1:02:03')
  assert.equal(mt.formatTimecode(-3), '0:00')
  // A screenshot's time: two and a half minutes either side, kept inside the video.
  assert.deepEqual(plain(mt.rangeAround(2232)), { startS: 2082, endS: 2382 })
  assert.deepEqual(plain(mt.rangeAround(60)), { startS: 0, endS: 210 })
  assert.deepEqual(plain(mt.rangeAround(2300, 2350)), { startS: 2150, endS: 2350 })
})

test('ranges: checked one by one, named by number, and against the video’s length once known', () => {
  const rows = (...pairs) => pairs.map(([start, end]) => ({ start, end }))
  assert.deepEqual(plain(mt.readRanges(rows(['37:00', '42:00'], ['', ''], ['1:05:00', '1:07:30']))), { ranges: [{ startS: 2220, endS: 2520 }, { startS: 3900, endS: 4050 }], problem: null })
  assert.equal(mt.readRanges(rows(['', ''])).problem, 'Add a time range, like 37:00 to 42:00.')
  assert.equal(mt.readRanges(rows(['37:00', 'soon'])).problem, 'Range 1: use times like 37:00 or 1:02:30.')
  assert.equal(mt.readRanges(rows(['1:00', '5:00'], ['42:00', '37:00'])).problem, 'Range 2: The end must come after the start.')
  assert.equal(mt.readRanges(rows(['37:00', '37:05'])).problem, 'Range 1: Make it at least 10 seconds long.')
  assert.equal(mt.readRanges(rows(['0:00', '25:00'])).problem, 'Range 1: Keep it to 20 minutes or less.')
  assert.equal(mt.readRanges(rows(['37:00', '42:00'], ['37:00', '42:00'])).problem, 'Range 2 is the same as another range.')
  assert.equal(mt.readRanges(rows(['1:00', '2:00'], ['3:00', '4:00'], ['5:00', '6:00'], ['7:00', '8:00'])).problem, 'Add up to 3 ranges.')
  // A 38:12 video: a range after its end, or running past it, is caught.
  assert.equal(mt.readRanges(rows(['40:00', '42:00']), 2292).problem, 'Range 1: It starts after the video ends (38:12).')
  assert.equal(mt.readRanges(rows(['36:00', '40:00']), 2292).problem, 'Range 1: It ends after the video ends (38:12).')
  // From another process.
  assert.deepEqual(plain(mt.parseMomentRanges([{ startS: 2220, endS: 2520.123 }])), [{ startS: 2220, endS: 2520.12 }])
  for (const bad of [undefined, [], [{ startS: '1', endS: 30 }], [[0, 30]], [{ startS: 0, endS: 5 }], Array.from({ length: 4 }, (_, i) => ({ startS: i * 60, endS: i * 60 + 30 }))]) {
    assert.throws(() => mt.parseMomentRanges(bad))
  }
  assert.throws(() => mt.parseMomentRanges([{ startS: 2400, endS: 2520 }], 2292), /^Error: Range 1: It starts after the video ends \(38:12\)\.$/)
})

test('a screenshot’s reading, talking points and a moment’s details from other processes are checked', () => {
  assert.deepEqual(plain(mt.parseTimecodeRead({ found: true, position: '37:12', length: '1:58:03', app: ' YouTube ' }, 0.00031)),
    { seconds: 2232, lengthSeconds: 7083, app: 'YouTube', text: '37:12', costUsd: 0.00031 })
  // The length is ignored when it can't be one (shorter than the position).
  assert.equal(mt.parseTimecodeRead({ found: true, position: '37:12', length: '-12:00', app: '' }).lengthSeconds, null)
  for (const bad of [null, 'x', [], { found: false, position: '1:00' }, { found: true, position: 'soon' }, { found: true, position: '9:00:00' }, { found: true }]) {
    assert.equal(mt.parseTimecodeRead(bad), null)
  }
  assert.deepEqual(plain(mt.parseTalkingPoints({ points: ['1. Do you agree?  ', '- A story from your own work', '', 7, 'Your takeaway', 'A fourth one'] })),
    ['Do you agree?', 'A story from your own work', 'Your takeaway'])
  assert.deepEqual(plain(mt.parseTalkingPoints({ points: 'no' })), [])
  assert.deepEqual(plain(mt.parseMomentInfo({ range_start_ms: 5000, range_end_ms: 35000, said: ' I  think ', picks: 2 })),
    { rangeStartMs: 5000, rangeEndMs: 35000, said: 'I think', picks: 2, points: [] })
  assert.equal(mt.parseMomentInfo({ range_start_ms: 9, range_end_ms: 2 }), null)
  const range = { rangeStartMs: 5000, rangeEndMs: 35000 }
  assert.equal(mt.momentBoundsProblem(7000, 12000, range), null)
  assert.match(mt.momentBoundsProblem(4000, 12000, range), /inside your range \(0:05–0:35\)/)
  assert.match(mt.momentBoundsProblem(7000, 8000, range), /at least 2 seconds/)
  assert.match(mt.momentBoundsProblem(5000, 34000, { rangeStartMs: 0, rangeEndMs: 60000 }) ?? '', /^$|./)
  assert.match(mt.momentBoundsProblem(0, 41000, { rangeStartMs: 0, rangeEndMs: 60000 }), /40 seconds or less/)
  assert.match(mt.momentBoundsProblem(7000.5, 12000, range), /Choose where/)
  // A draft from the engine keeps its moment.
  const draft = remixShared.parseRemixDraft({ id: 1, format: 'moment_take', headline: '', intro: '', close: '', beats: [], start_ms: 7250, end_ms: 12610, quote: 'Then he says…',
    moment: { range_start_ms: 5000, range_end_ms: 35000, said: '', picks: 1 } })
  assert.deepEqual([draft.format, draft.moment.rangeStartMs, draft.moment.picks], ['moment_take', 5000, 1])
  assert.equal(remixShared.parseRemixDraft({ id: 1, format: 'image', headline: '', intro: '', close: '', beats: [], moment: { range_start_ms: 0, range_end_ms: 9 } }).moment, undefined)
})

test('the cost line: transcribing the ranges and a planning call per range, then a writing call per video (existing prices only)', () => {
  const { REMIX_PRICES } = remixShared
  // Three five-minute ranges.
  const cost = remixShared.estimateRemixCost('camera', 3, 0.25, 'moment_take')
  const low = REMIX_PRICES.sourcePerHour * 0.25 + 0.03
  const high = REMIX_PRICES.sourcePerHour * 0.3 + 0.06
  assert.ok(Math.abs(cost.perRemixLow * 3 - low) < 1e-9 && Math.abs(cost.total - high) < 1e-9, JSON.stringify(cost))
  assert.ok(cost.total > cost.perRemixLow * 3)
  assert.equal(remixShared.REMIX_FORMATS.findIndex((item) => item.id === 'moment_take'), remixShared.REMIX_FORMATS.findIndex((item) => item.id === 'pause_react') + 1)
  assert.deepEqual(plain(remixShared.partsFor('moment_take', 0)), ['reaction'])
  assert.equal(remixShared.headlineOnly('moment_take'), true)
})

function helpers(responses) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    const next = responses.shift()
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status ?? 200 })
  }
  const m = load('main/moment-take.ts', { electron: { app: { isPackaged: true } } })
  return { m, calls, fetcher }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const answer = (content, cost = 0.0004) => ({ body: { choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost } } })

test('reading a screenshot’s time: one small vision call, the picture checked first, the answer checked after', async () => {
  const { m, calls, fetcher } = helpers([answer({ found: true, position: '37:12', length: '1:58:03', app: 'YouTube' }), answer({ found: false, position: '', length: '', app: '' }, 0.0002),
    { status: 402, body: {} }, { status: 401, body: {} }])
  const result = await m.readTimecodeScreenshot(PNG, 'or-key', fetcher)
  assert.deepEqual(plain(result), { read: { seconds: 2232, lengthSeconds: 7083, app: 'YouTube', text: '37:12', costUsd: 0.0004 }, costUsd: 0.0004 })
  const [call] = calls
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(call.body.model, m.MOMENT_HELPER_MODEL)
  assert.equal(call.headers.Authorization, 'Bearer or-key')
  assert.equal(call.body.response_format.json_schema.name, 'player_timecode')
  assert.deepEqual(call.body.usage, { include: true })
  assert.match(call.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,iVBORw0KGgo/)
  assert.match(call.body.messages[0].content, /never instructions/)
  // Nothing read: null, but the call was still charged (so it's recorded).
  assert.deepEqual(plain(await m.readTimecodeScreenshot(PNG, 'or-key', fetcher)), { read: null, costUsd: 0.0002 })
  await assert.rejects(m.readTimecodeScreenshot(PNG, 'or-key', fetcher), /insufficient credits/)
  await assert.rejects(m.readTimecodeScreenshot(PNG, 'or-key', fetcher), /rejected the API key/)
  // Checked before anything is sent.
  for (const bad of ['png', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), new Uint8Array(0), new Uint8Array(11 * 1024 * 1024).fill(0x89)]) {
    await assert.rejects(m.readTimecodeScreenshot(bad, 'or-key', fetcher), /screenshot/)
  }
  await assert.rejects(m.readTimecodeScreenshot(PNG, '', fetcher), /OpenRouter key/)
  assert.equal(calls.length, 4)
  assert.equal(m.screenshotType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(m.screenshotType(new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), 0])), 'image/webp')
})

test('talking points: three short prompts from the moment (and the brand), never a script', async () => {
  const { m, calls, fetcher } = helpers([answer({ points: ['Do you agree with the number?', 'A scam you nearly fell for', 'How to check an ad'] }, 0.0003), answer({ points: [] })])
  const result = await m.suggestTalkingPoints({ quote: 'Fifteen billion scam ads a day.', title: 'The podcast', creator: '@host', brandName: 'Safe Money', brand: 'We teach safety.' }, 'or-key', fetcher)
  assert.deepEqual(plain(result), { points: ['Do you agree with the number?', 'A scam you nearly fell for', 'How to check an ad'], costUsd: 0.0003 })
  const user = JSON.parse(calls[0].body.messages[1].content)
  assert.deepEqual([user.moment, user.video.creator, user.brand.name], ['Fifteen billion scam ads a day.', '@host', 'Safe Money'])
  assert.match(calls[0].body.messages[0].content, /never invent facts/)
  await assert.rejects(m.suggestTalkingPoints({ quote: 'x', title: '', creator: '', brandName: '', brand: '' }, 'or-key', fetcher), /No talking points/)
})

function engineMock() {
  const configs = []
  const results = { write: null, moment: null, render: { ok: true, remixes: [] }, holdMoment: false }
  const children = []
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0; child.exitCode = null; child.signalCode = null
    children.push(child)
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      let result = results.render
      if (config.mode === 'plan') {
        fs.mkdirSync(path.join(config.output_dir, '.work'), { recursive: true })
        fs.writeFileSync(path.join(config.output_dir, '.work', 'plan.json'), JSON.stringify({ sources: [{ video: results.video ?? config.sources[0] }] }))
        const moment = (id, a, b, ra, rb) => ({ id, format: 'moment_take', headline: '', intro: '', close: '', beats: [], start_ms: a, end_ms: b, quote: `Moment ${id}`,
          creator: '@host', source_title: 'Podcast', moment: { range_start_ms: ra, range_end_ms: rb, said: '', picks: 1 } })
        result = { ok: true, cost_usd: 0.03, source_seconds: 3000, warnings: ['Range 3 (0:45–1:00) starts after the video ends (0:40). Choose a time inside the video.'],
          drafts: [moment(0, 2230000, 2241000, 2220000, 2520000), moment(1, 3910000, 3925000, 3900000, 4050000)] }
      } else if (config.mode === 'write') result = results.write
      else if (config.mode === 'moment') {
        result = results.moment
        // Still finding it: the test (or a kill) ends it.
        if (results.holdMoment) { child.pid = 4242; child.config = config; return }
      }
      setImmediate(() => { child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0) })
    } }
    return child
  }
  return { configs, results, spawn, children }
}

test('Moment + my take in main: ranges, moments, nudges, another moment, talking points, takes written one by one, then made', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-moment-'))
  const settings = { openrouterApiKey: 'or-key', outputDirectory: out, pythonPath: 'python3' }
  const engine = engineMock()
  const pointsCalls = []
  const m = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn: engine.spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name },
    // (shared/remix.ts imports the shared module by the same name: it gets the real one plus this stand-in.)
    './moment-take': { ...mt, suggestTalkingPoints: async (input, key) => { pointsCalls.push([input, key]); return { points: ['Agree?', 'A story', 'One tip'], costUsd: 0.001 } } }
  })
  const statuses = []
  m.onRemixStatus((status) => statuses.push(status))
  const request = {
    sources: ['https://www.youtube.com/watch?v=podcast'], creator: '', angle: 'reaction', host: 'still', avatarId: null, voice: 'avatar', brandIdentityId: null, count: 5,
    captionPreset: 'pop', includeCaptions: true, aiLabelAck: false, format: 'moment_take', clipRightsAck: true,
    camera: { layout: 'cutout', backdrop: 'blur', backdropColor: '#111111', talk: false },
    moment: { ranges: [{ startS: 2220, endS: 2520 }, { startS: 3900, endS: 4050 }], pip: true }
  }

  // Requests: one video, ranges checked, you on camera (talking), no green screen, the permission promise.
  const parsed = m.parseRemixRequest(request, out).request
  assert.deepEqual([parsed.host, parsed.count, parsed.camera.talk, parsed.camera.layout, parsed.aiLabelAck], ['camera', 2, true, 'cutout', false])
  assert.deepEqual(plain(parsed.moment), { ranges: [{ startS: 2220, endS: 2520 }, { startS: 3900, endS: 4050 }], pip: true })
  assert.throws(() => m.parseRemixRequest({ ...request, clipRightsAck: false }, out), /allowed to use this video/)
  assert.throws(() => m.parseRemixRequest({ ...request, sources: ['https://a.com/1', 'https://a.com/2'] }, out), /one long video/)
  assert.throws(() => m.parseRemixRequest({ ...request, camera: { ...request.camera, layout: 'greenscreen' } }, out), /As filmed/)
  assert.throws(() => m.parseRemixRequest({ ...request, moment: { ranges: [] } }, out), /Add a time range/)
  assert.throws(() => m.parseRemixRequest({ ...request, moment: { ranges: [{ startS: 10, endS: 12 }] } }, out), /Range 1: Make it at least 10 seconds/)
  assert.throws(() => m.parseRemixRequest({ ...request, moment: { ...request.moment, pip: 'yes' } }, out), /stays on screen/)
  assert.throws(() => m.parseRemixRequest({ ...request, moment: undefined }, out), /Add a time range/)

  // A chosen file's length is known before anything starts: a range past its end is refused there.
  const file = path.join(out, 'pod.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file])
  await assert.rejects(m.startRemix({ ...request, sources: [file], creator: '@host', moment: { ranges: [{ startS: 40, endS: 60 }], pip: false } }), /Range 1: It starts after the video ends \(0:30\)/)

  engine.results.video = file
  // Finding the moments: one run, the ranges and box option to the engine; the estimate is for the ranges.
  const started = await m.startRemix(request)
  assert.equal(started.phase, 'planning')
  const expected = remixShared.estimateRemixCost('camera', 2, 450 / 3600, 'moment_take').total
  assert.ok(Math.abs(started.estimateUsd - expected) < 1e-9)
  const wait = async () => { for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20)) }
  await wait()
  const plan = engine.configs[0]
  assert.deepEqual([plan.mode, plan.format, plan.host, plan.camera_talk, plan.moment_pip], ['plan', 'moment_take', 'camera', true, true])
  assert.deepEqual(plan.moment_ranges, [[2220, 2520], [3900, 4050]])
  let status = m.remixStatus()
  assert.deepEqual(plain(status.drafts.map((draft) => [draft.id, draft.startMs, draft.moment.rangeStartMs])), [[0, 2230000, 2220000], [1, 3910000, 3900000]])
  assert.match(status.warnings[0], /^Range 3/)
  assert.equal((await m.remixMoment(1)).startSeconds, 3910)

  // Nudging: free, inside the range.
  const nudged = m.setMomentBounds(0, 2229500, 2242000)
  assert.deepEqual([nudged.startMs, nudged.endMs], [2229500, 2242000])
  assert.throws(() => m.setMomentBounds(0, 2219000, 2242000), /inside your range/)
  assert.throws(() => m.setMomentBounds(0, 2230000, 2230500), /at least 2 seconds/)
  assert.throws(() => m.setMomentBounds(7, 2230000, 2240000), /no longer in this review/)

  // Another moment in the range: one engine call with only the run and the take; its cost is added.
  engine.results.moment = { ok: true, cost_usd: 0.02, draft: { id: 1, format: 'moment_take', headline: '', intro: '', close: '', beats: [], start_ms: 3950000, end_ms: 3962000, quote: 'Another one',
    moment: { range_start_ms: 3900000, range_end_ms: 4050000, said: '', picks: 2 } } }
  const another = await m.anotherMoment(1)
  const call = engine.configs.find((config) => config.mode === 'moment')
  assert.deepEqual(Object.keys(call).sort(), ['draft_id', 'mode', 'output_dir'])
  assert.equal(call.draft_id, 1)
  assert.deepEqual([another.startMs, another.quote, another.moment.picks], [3950000, 'Another one', 2])
  assert.ok(Math.abs(m.remixStatus().costUsd - 0.05) < 1e-9)
  engine.results.moment = { ok: false, error: 'Range 2 (1:05:00–1:07:30): no other moment stood out in it. Keep the one you have, or choose another part.' }
  await assert.rejects(m.anotherMoment(1), /no other moment stood out/)
  assert.equal(m.remixStatus().drafts[1].startMs, 3950000, 'the moment is kept')

  // Talking points: the moment and the brand go to the small call; kept on the moment.
  const pointed = await m.momentTalkingPoints(0)
  assert.deepEqual(plain(pointed.moment.points), ['Agree?', 'A story', 'One tip'])
  assert.equal(pointsCalls[0][0].quote, 'Moment 0')
  assert.equal(pointsCalls[0][1], 'or-key')

  // Takes: a webcam recording (its length read from its frames) and an upload; over three minutes is refused.
  const take = path.join(out, 'take.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=4', '-f', 'lavfi', '-i', 'sine=d=4', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', take])
  const token = await m.beginRecording(0, 'reaction', 'video/mp4')
  await m.appendRecording(token, new Uint8Array(fs.readFileSync(take)))
  await m.finishRecording(token, null)
  const long = path.join(out, 'long.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=190:r=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', long])
  await assert.rejects(m.uploadRecording(1, 'reaction', long), /Keep your take to 3 minutes/)
  await m.uploadRecording(1, 'reaction', take)
  const recordings = m.remixRecordings()
  assert.ok(recordings[0].reaction.seconds > 3.5 && recordings[1].reaction.uploaded)

  // Writing take 0 only: the engine gets that take (from its start) and its id; the moment stays as nudged.
  engine.results.write = { ok: true, cost_usd: 0.02, drafts: [{ id: 0, format: 'moment_take', headline: 'He says 15 billion scam ads a day', intro: '', close: '', beats: [],
    post_caption: 'My take.', start_ms: 1, end_ms: 2, moment: { range_start_ms: 2220000, range_end_ms: 2520000, said: 'Honestly it scared me', picks: 1 } }],
  warnings: [] }
  await m.writeRemix([0, 9])
  await wait()
  const write = engine.configs.filter((config) => config.mode === 'write')
  assert.deepEqual(write[0].write_ids, [0])
  assert.deepEqual(Object.keys(write[0].recordings), ['0'])
  assert.equal(write[0].recordings[0].reaction.offset_s, 0)
  status = m.remixStatus()
  assert.deepEqual([status.drafts[0].headline, status.drafts[0].startMs, status.drafts[0].moment.said, status.drafts[0].moment.points.length],
    ['He says 15 billion scam ads a day', 2229500, 'Honestly it scared me', 3])
  // Take 0's hook text was written from its recording (making it reuses those words); take 1's wasn't yet.
  assert.deepEqual([m.remixRecordings()[0].reaction.written, m.remixRecordings()[1].reaction.written], [true, undefined])
  assert.equal(status.drafts[1].headline, '')
  // Both, one of which couldn't be heard: the other is written and the problem is named.
  engine.results.write = { ok: true, cost_usd: 0.02, drafts: [{ id: 1, format: 'moment_take', headline: 'Attention is the new oil, he says', intro: '', close: '', beats: [], post_caption: 'Yes.',
    start_ms: 1, end_ms: 2, moment: { range_start_ms: 3900000, range_end_ms: 4050000, said: 'Yes', picks: 2 } }],
  warnings: ['Video 1: We couldn’t hear you in that recording. Record it again with your microphone on.'] }
  await m.writeRemix()
  await wait()
  assert.deepEqual(engine.configs.filter((config) => config.mode === 'write')[1].write_ids, [0, 1])
  status = m.remixStatus()
  assert.equal(status.drafts[1].headline, 'Attention is the new oil, he says')
  assert.equal(status.drafts[0].headline, 'He says 15 billion scam ads a day', 'the first take keeps its hook text')
  assert.match(status.error, /^Video 1: We couldn’t hear you/)
  assert.equal(m.remixRecordings()[1].reaction.written, true)
  // Recording take 1 again: its hook text no longer comes from this recording.
  await m.uploadRecording(1, 'reaction', take)
  assert.equal(m.remixRecordings()[1].reaction.written, undefined)
  assert.equal(m.remixRecordings()[0].reaction.written, true)

  // Making them: each approved take carries its moment as left (nudged, or the new one), and the recordings.
  await m.renderRemix([{ id: 0, headline: 'He says 15 billion scam ads a day', intro: '', close: '', beats: [] },
    { id: 1, headline: 'Attention is the new oil, he says', intro: '', close: '', beats: [], postCaption: 'Mine.' }])
  const render = engine.configs[engine.configs.length - 1]
  assert.equal(render.mode, 'render')
  assert.deepEqual(render.approved.map((edit) => [edit.id, edit.start_ms, edit.end_ms]), [[0, 2229500, 2242000], [1, 3950000, 3962000]])
  assert.deepEqual([render.recordings[0].reaction.offset_s, render.recordings[1].reaction.offset_s], [0, 0])
  assert.equal(render.moment_pip, true)
  // Costs reached the status (planning, another moment, talking points, two writes).
  assert.ok(statuses.some((item) => item.phase === 'review' && Math.abs(item.costUsd - 0.091) < 1e-9))
  await new Promise((resolve) => setTimeout(resolve, 50))
  fs.rmSync(out, { recursive: true, force: true })
})

test('Moment + my take: making waits for another moment; Discard stops it first; a cost after closing still reaches the ledger', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-moment-close-'))
  const settings = { openrouterApiKey: 'or-key', outputDirectory: out, pythonPath: 'python3' }
  const engine = engineMock()
  const killed = []
  const fakeProcess = Object.create(process)
  fakeProcess.kill = (pid, signal) => {
    const child = engine.children.find((item) => item.pid === -pid)
    killed.push({ signal, folderThere: child ? fs.existsSync(child.config.output_dir) : null })
    if (child) setImmediate(() => { child.signalCode = signal; child.emit('close', null, signal) })
  }
  let releasePoints
  const m = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn: engine.spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name },
    './moment-take': { ...mt, suggestTalkingPoints: () => new Promise((resolve) => { releasePoints = () => resolve({ points: ['Agree?', 'A story', 'One tip'], costUsd: 0.004 }) }) }
  }, { process: fakeProcess })
  const spent = []
  m.onRemixMomentSpend((usd, label, runId) => spent.push({ usd, label, runId }))
  const request = {
    sources: ['https://www.youtube.com/watch?v=podcast'], creator: '', angle: 'reaction', host: 'still', avatarId: null, voice: 'avatar', brandIdentityId: null, count: 5,
    captionPreset: 'pop', includeCaptions: true, aiLabelAck: false, format: 'moment_take', clipRightsAck: true,
    camera: { layout: 'cutout', backdrop: 'blur', backdropColor: '#111111', talk: false },
    moment: { ranges: [{ startS: 2220, endS: 2520 }, { startS: 3900, endS: 4050 }], pip: true }
  }
  const wait = async () => { for (let i = 0; i < 100 && m.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20)) }
  try {
    await m.startRemix(request)
    await wait()
    const folder = m.remixStatus().folder
    engine.results.holdMoment = true
    const another = m.anotherMoment(1)
    const anotherDone = assert.rejects(another)
    await new Promise((resolve) => setImmediate(resolve))
    await assert.rejects(m.renderRemix([{ id: 0, headline: '', intro: '', close: '', beats: [] }]), /Wait for the moment or talking points you asked for/)
    assert.equal(engine.configs.filter((config) => config.mode === 'render').length, 0)
    // Discard: the engine finding a moment is stopped before its folder is removed.
    assert.equal(await m.discardRemix(), true)
    await anotherDone
    assert.deepEqual(killed, [{ signal: 'SIGKILL', folderThere: true }])
    assert.equal(fs.existsSync(folder), false)

    // Talking points that come back after the review was closed: their cost still reaches the ledger.
    engine.results.holdMoment = false
    await m.startRemix(request)
    await wait()
    const runId = path.basename(m.remixStatus().folder)
    const points = m.momentTalkingPoints(0)
    const pointsDone = assert.rejects(points, /This review was closed/)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(await m.discardRemix(), true)
    releasePoints()
    await pointsDone
    assert.deepEqual(spent, [{ usd: 0.004, label: 'Remix planning', runId }])
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})
