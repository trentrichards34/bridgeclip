const assert = require('node:assert/strict')
const { test } = require('node:test')
const vm = require('node:vm')
const path = require('node:path')
const { buildSync } = require('esbuild')

const bundle = buildSync({
  stdin: {
    contents: `export { useJobStore } from './src/renderer/store/use-job-store';
      export { useSettingsStore } from './src/renderer/store/use-settings-store';
      export { parseTimecode } from './src/renderer/lib/utils';
      export { parseJobOutput } from './src/shared/job-output';
      export { loadThumbnail } from './src/renderer/lib/thumbnails';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false
}).outputFiles[0].text

function load(api = {}) {
  const module = { exports: {} }
  vm.runInNewContext(bundle, { module, exports: module.exports, require, window: { bridgeclip: api } })
  return module.exports
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const settings = {
  openrouterConfigured: false, outputDirectory: '/clips',
  pythonPath: 'python3', 
}

function snapshot(id, revision, patch = {}) {
  return {
    id, revision, request: { videoUrl: '/source.mp4' }, status: 'queued', percent: 0, step: '', clipsDone: 0, clipsTotal: 0,
    error: null, errorHint: null, output: null, outputDir: `/clips/${id}`, queuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null, finishedAt: null, ...patch
  }
}

test('job snapshots apply in revision order, so a late update cannot undo a newer one', () => {
  const { useJobStore } = load()
  const state = useJobStore.getState()
  state.upsert(snapshot('one', 3, { status: 'rendering', percent: 75 }))
  state.upsert(snapshot('one', 2, { status: 'transcribing', percent: 20 }))
  assert.equal(useJobStore.getState().jobs.one.status, 'rendering')
  assert.equal(useJobStore.getState().jobs.one.percent, 75)
  state.upsert(snapshot('one', 4, { status: 'cancelled' }))
  state.upsert(snapshot('one', 3, { status: 'rendering', percent: 90 }))
  assert.equal(useJobStore.getState().jobs.one.status, 'cancelled')
})

test('hydrating from the main process adds missing jobs without replacing newer live updates', () => {
  const { useJobStore } = load()
  const state = useJobStore.getState()
  // An update pushed while the list request was in flight is newer than the list.
  state.upsert(snapshot('live', 5, { status: 'completed', percent: 100 }))
  state.hydrate([snapshot('live', 4, { status: 'rendering', percent: 80 }), snapshot('other', 1, { status: 'pending' })])
  assert.equal(useJobStore.getState().jobs.live.status, 'completed')
  assert.equal(useJobStore.getState().jobs.other.status, 'pending')
})

test('removing the focused job returns the jobs page to its list', () => {
  const { useJobStore } = load()
  const state = useJobStore.getState()
  state.upsert(snapshot('one', 1, { status: 'failed' }))
  state.focusJob('one')
  state.remove('one')
  assert.equal(useJobStore.getState().focusedJobId, null)
  assert.equal(useJobStore.getState().jobs.one, undefined)
})

test('finished job snapshots stay bounded while active jobs remain visible', () => {
  const { useJobStore } = load()
  const state = useJobStore.getState()
  state.upsert(snapshot('active', 1, { status: 'rendering' }))
  for (let index = 0; index < 60; index++) {
    state.upsert(snapshot(`done-${index}`, 1, {
      status: 'completed', finishedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    }))
  }
  const jobs = useJobStore.getState().jobs
  assert.equal(Object.keys(jobs).length, 51)
  assert.ok(jobs.active)
  assert.equal(jobs['done-0'], undefined)
  assert.ok(jobs['done-59'])
})

test('overlapping settings writes merge at dispatch and retain saving state', async () => {
  const first = deferred()
  const writes = []
  const { useSettingsStore } = load({ settings: {
    load: async () => settings,
    save: async (next) => {
      writes.push(next)
      if (writes.length === 1) await first.promise
      return next
    }
  } })
  await useSettingsStore.getState().load()
  const a = useSettingsStore.getState().save({ pythonPath: '/usr/bin/python3' })
  const b = useSettingsStore.getState().save({ outputDirectory: '/new-clips' })
  await Promise.resolve()
  assert.equal(writes.length, 1)
  assert.equal(useSettingsStore.getState().saving, true)
  first.resolve()
  await Promise.all([a, b])
  assert.equal(writes[1].pythonPath, '/usr/bin/python3')
  assert.equal(useSettingsStore.getState().outputDirectory, '/new-clips')
  assert.equal(useSettingsStore.getState().saving, false)
})

test('failed settings write does not poison subsequent writes', async () => {
  let calls = 0
  const { useSettingsStore } = load({ settings: {
    load: async () => settings,
    save: async (next) => {
      if (++calls === 1) throw new Error('Unavailable')
      return next
    }
  } })
  await useSettingsStore.getState().load()
  const a = useSettingsStore.getState().save({ outputDirectory: '/failed' })
  const b = useSettingsStore.getState().save({ pythonPath: '/usr/bin/python3' })
  await assert.rejects(a, /Unavailable/)
  await b
  assert.equal(useSettingsStore.getState().outputDirectory, '/clips')
  assert.equal(useSettingsStore.getState().pythonPath, '/usr/bin/python3')
  assert.equal(useSettingsStore.getState().saving, false)
})

test('API key changes share the settings queue and keep the saving indicator active', async () => {
  const first = deferred()
  const keyWrite = deferred()
  const calls = []
  const { useSettingsStore } = load({ settings: {
    load: async () => settings,
    save: async (next) => {
      calls.push('settings')
      await first.promise
      return next
    },
    replaceApiKey: async (key) => {
      calls.push(key)
      await keyWrite.promise
      return { ...settings, outputDirectory: '/new-clips', openrouterConfigured: true }
    }
  } })
  await useSettingsStore.getState().load()
  const folder = useSettingsStore.getState().save({ outputDirectory: '/new-clips' })
  const key = useSettingsStore.getState().replaceApiKey('openrouterApiKey', 'test-key')
  await Promise.resolve()
  assert.deepEqual(calls, ['settings'])
  first.resolve()
  await folder
  assert.deepEqual(calls, ['settings', 'openrouterApiKey'])
  assert.equal(useSettingsStore.getState().saving, true)
  keyWrite.resolve()
  await key
  assert.equal(useSettingsStore.getState().openrouterConfigured, true)
  assert.equal(useSettingsStore.getState().saving, false)
})

test('tool check errors clear stale successful status and remain retryable', async () => {
  const { useSettingsStore } = load({ system: { checkTools: async () => { throw new Error('Check failed') } } })
  useSettingsStore.setState({ toolStatus: { python: true } })
  await useSettingsStore.getState().checkTools()
  assert.equal(useSettingsStore.getState().toolStatus, null)
  assert.equal(useSettingsStore.getState().checkingTools, false)
  assert.ok(useSettingsStore.getState().toolError)
})

test('late system check result cannot replace a newer result', async () => {
  const first = deferred()
  let calls = 0
  const { useSettingsStore } = load({ system: { checkTools: async () => {
    if (++calls === 1) return first.promise
    return { python: true, ffmpeg: true }
  } } })
  const oldCheck = useSettingsStore.getState().checkTools()
  await useSettingsStore.getState().checkTools()
  assert.equal(useSettingsStore.getState().toolStatus.ffmpeg, true)
  first.resolve({ python: false, ffmpeg: false })
  await oldCheck
  assert.equal(useSettingsStore.getState().toolStatus.ffmpeg, true)
  assert.equal(useSettingsStore.getState().checkingTools, false)
})

test('timecode parser rejects invalid minute/second fields and infinity', () => {
  const { parseTimecode } = load()
  assert.equal(parseTimecode('1:02:03.5'), 3723.5)
  assert.equal(parseTimecode('90'), 90)
  assert.equal(parseTimecode(''), null)
  assert.ok(Number.isNaN(parseTimecode('1:99')))
  assert.ok(Number.isNaN(parseTimecode('1:60:00')))
  assert.ok(Number.isNaN(parseTimecode('9'.repeat(400))))
})

test('failed thumbnail generation can retry and successful results stay cached', async () => {
  let calls = 0
  const { loadThumbnail } = load({ thumbnails: {
    generate: async () => ++calls === 1 ? null : '/clip_thumb.jpg'
  } })
  assert.equal(await loadThumbnail('/clip.mp4'), null)
  assert.equal(await loadThumbnail('/clip.mp4'), '/clip_thumb.jpg')
  assert.equal(await loadThumbnail('/clip.mp4'), '/clip_thumb.jpg')
  assert.equal(calls, 2)
})

test('historical clip results reject paths, duplicate indexes, and impossible time ranges', () => {
  const { parseJobOutput } = load()
  const clip = {
    clip_index: 0,
    s3_url: 'file:///clips/clip.mp4',
    duration_ms: 6000,
    start_time_ms: 10_000,
    end_time_ms: 16_000,
    virality_score: 0.8
  }
  const valid = parseJobOutput({ job_id: 'old-run', clips: [clip] })
  assert.equal(valid.clips[0].summary, null)
  assert.equal(valid.clips[0].render_fallback, null)
  assert.equal(valid.total_clips, 1)
  assert.equal(parseJobOutput({ clips: [{ ...clip, s3_url: ' ' }] }), null)
  assert.equal(parseJobOutput({ clips: [clip, { ...clip }] }), null)
  assert.equal(parseJobOutput({ clips: [{ ...clip, start_time_ms: 20_000 }] }), null)
})

test('clip results retain bounded framing, pacing, and complete cost metrics', () => {
  const { parseJobOutput } = load()
  const output = parseJobOutput({
    job_id: 'run-one', clips: [], metrics: {
      analysis_duration_seconds: 120,
      smart_framing_available: true, failed_clip_count: 1,
      stage_durations_seconds: { rendering: 12.5, 'invalid/name': 99 },
      clip_layouts: [{ clip_index: 0, layout_type: 'screen_cam', pacing_removed_ms: 1200,
        render_fallback: 'letterbox', shots: [{ start_ms: 0, end_ms: 5000,
          layout: 'screen_cam', source: 'vision', cam_box: [0.5, 0.5, 0.4, 0.4],
          screen_box: [0, 0, 1, 1], secret: 'ignored' }] }],
      api_costs: { total_estimated_cost_usd: 0.04,
        planning: { provider: 'openrouter', model: 'example', prompt_tokens: 100,
          completion_tokens: 20, total_tokens: 120, attempts: 1, estimated_cost_usd: 0.03, secret: 'ignored' } },
      secret: 'ignored'
    }
  })
  assert.equal(output.metrics.clip_layouts[0].pacing_removed_ms, 1200)
  assert.deepEqual(Array.from(output.metrics.clip_layouts[0].shots[0].cam_box), [0.5, 0.5, 0.4, 0.4])
  assert.equal(output.metrics.clip_layouts[0].shots[0].secret, undefined)
  assert.equal(output.metrics.api_costs.planning.prompt_tokens, 100)
  assert.equal(output.metrics.api_costs.planning.completion_tokens, 20)
  assert.equal(output.metrics.stage_durations_seconds['invalid/name'], undefined)
  assert.equal(output.metrics.secret, undefined)
  assert.equal(output.metrics.analysis_duration_seconds, 120)
})


test('Jev custom thresholds survive unrelated queued settings saves and failed writes', async () => {
  let persisted = { ...settings, jevCutThreshold: '0.91', jevThreshold: '0.82' }
  const { useSettingsStore } = load({ settings: {
    load: async () => persisted,
    save: async (next) => { if (next.jevCutThreshold === 'invalid') throw new Error('Invalid threshold'); persisted = next; return next }
  } })
  await useSettingsStore.getState().load()
  assert.equal(useSettingsStore.getState().jevCutThreshold, '0.91')
  await Promise.all([useSettingsStore.getState().save({ jevThreshold: '0.81' }), useSettingsStore.getState().save({ customVocabulary: 'Jev' })])
  assert.equal(persisted.jevThreshold, '0.81')
  assert.equal(persisted.jevCutThreshold, '0.91')
  await assert.rejects(useSettingsStore.getState().save({ jevCutThreshold: 'invalid' }))
  assert.equal(useSettingsStore.getState().jevCutThreshold, '0.91')
  assert.equal(useSettingsStore.getState().saving, false)
})

test('Jev review and web research show as opt-in betas, with thresholds editable while Jev is off', async () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const code = buildSync({
    stdin: {
      contents: `export { JevSettings } from './src/renderer/components/JevSettings';
        export { useSettingsStore } from './src/renderer/store/use-settings-store';`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic', write: false
  }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, window: { bridgeclip: { settings: { load: async () => settings } } } })
  const { JevSettings, useSettingsStore } = mod.exports
  // Before settings load, and when an older main process omits the fields.
  assert.equal(useSettingsStore.getState().jevEnabled, 'off')
  assert.equal(useSettingsStore.getState().sourceContextWebResearch, 'off')
  await useSettingsStore.getState().load()
  assert.equal(useSettingsStore.getState().jevEnabled, 'off')
  assert.equal(useSettingsStore.getState().sourceContextWebResearch, 'off')
  // Server rendering reads the store's initial state; mark it loaded.
  useSettingsStore.getInitialState().loaded = true
  const html = renderToStaticMarkup(React.createElement(JevSettings))
  assert.match(html, /Beta/)
  assert.match(html, /extra OpenRouter credit/)
  assert.match(html, /aria-checked="false"/)
  assert.match(html, /Review &amp; edit still uses Jev with the thresholds below/)
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/)
  assert.doesNotMatch(html, /inert|data-open/)
  assert.match(html, /type="range"/)
})

test('Pause & react form: its own defaults, kept when a Library clip is remixed, and a brand color reaches its cut-out', () => {
  const bundle = buildSync({
    stdin: {
      contents: `export { useRemixForm } from './src/renderer/store/use-remix-form-store';
        export { brandFormPatch } from './src/shared/brand-kit';
        export { REMIX_FORMATS, REMIX_HOSTS, headlineOnly, oneTake, partsFor } from './src/shared/remix';`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false
  }).outputFiles[0].text
  const module = { exports: {} }
  vm.runInNewContext(bundle, { module, exports: module.exports, require })
  const { useRemixForm, brandFormPatch, REMIX_FORMATS, REMIX_HOSTS, headlineOnly, oneTake, partsFor } = module.exports
  const form = useRemixForm.getState()
  assert.deepEqual([form.pauseLayout, form.pauseCaptions, form.pauseCamera.layout, form.pauseCamera.talk], ['box', 'member', 'filmed', true])
  assert.equal(REMIX_FORMATS[0].id, 'pause_react')
  assert.equal(REMIX_FORMATS[0].label, 'Pause & react')
  assert.deepEqual([headlineOnly('pause_react'), oneTake('pause_react'), oneTake('silent'), [...partsFor('pause_react', 3)].join()], [true, true, false, 'reaction'])
  // The AI presenters are marked beta; you on camera is not.
  assert.equal(REMIX_HOSTS.filter((host) => host.beta).map((host) => host.id).join(), 'still,voice')
  form.update({ format: 'pause_react', clipRightsAck: true })
  useRemixForm.getState().setSourceFile('/Users/me/CreatorClips/run/clip_00.mp4', '@coach')
  const after = useRemixForm.getState()
  assert.deepEqual([after.format, after.filePath, after.creator, after.clipRightsAck], ['pause_react', '/Users/me/CreatorClips/run/clip_00.mp4', '@coach', true])
  assert.equal(brandFormPatch({ color: '#FF8800' }, after).pauseCamera.backdropColor, '#FF8800')
})

test('Moment + my take form: its defaults, typed ranges checked against the file, a brand color for its cut-out, and the review shows each moment', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const code = buildSync({
    stdin: {
      contents: `export { useRemixForm } from './src/renderer/store/use-remix-form-store';
        export { brandFormPatch } from './src/shared/brand-kit';
        export { REMIX_FORMATS, headlineOnly, oneTake, partsFor, momentMakeNote } from './src/shared/remix';
        export { readRanges } from './src/shared/moment-take';
        export { MomentRanges, screenshotRow } from './src/renderer/components/MomentRanges';
        export { MomentTakeReview } from './src/renderer/components/MomentTakeReview';
        export { momentCost } from './src/renderer/pages/RemixPage';`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic', write: false
  }).outputFiles[0].text
  const mod = { exports: {} }
  const api = { remix: { recordings: async () => ({}), moment: async () => ({ path: '/v.mp4', startSeconds: 0, endSeconds: 1, kind: 'video' }) } }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, window: { bridgeclip: api }, navigator: {} })
  const { useRemixForm, brandFormPatch, REMIX_FORMATS, headlineOnly, oneTake, partsFor, readRanges, MomentRanges, MomentTakeReview, momentCost, momentMakeNote, screenshotRow } = mod.exports
  const form = useRemixForm.getState()
  assert.deepEqual(JSON.parse(JSON.stringify([form.momentRanges, form.momentPip, form.momentCamera.layout, form.momentCamera.talk])), [[{ start: '', end: '' }], true, 'filmed', true])
  const at = REMIX_FORMATS.findIndex((item) => item.id === 'moment_take')
  assert.deepEqual([REMIX_FORMATS[at - 1].id, REMIX_FORMATS[at].label], ['pause_react', 'Moment + my take'])
  assert.deepEqual([headlineOnly('moment_take'), oneTake('moment_take'), [...partsFor('moment_take', 3)].join()], [true, true, 'reaction'])
  // Typed ranges; a Library clip keeps the format; a brand color reaches the cut-out.
  form.update({ format: 'moment_take', clipRightsAck: true, momentRanges: [{ start: '37:00', end: '42:00' }, { start: '1:05:00', end: '1:07:30' }] })
  useRemixForm.getState().setSourceFile('/Users/me/CreatorClips/run/clip_00.mp4', '@host')
  const after = useRemixForm.getState()
  assert.deepEqual([after.format, after.clipRightsAck, after.momentRanges.length], ['moment_take', true, 2])
  assert.equal(readRanges(after.momentRanges, null).problem, null)
  assert.equal(readRanges(after.momentRanges, 3000).problem, 'Range 2: It starts after the video ends (50:00).')
  assert.equal(brandFormPatch({ color: '#FF8800' }, after).momentCamera.backdropColor, '#FF8800')
  assert.equal(momentCost(0.041, 0.0849), 'About $0.04–$0.08 in all.')
  assert.equal(momentCost(0.05, 0.051), 'About $0.05 in all.')

  // The ranges: what a screenshot read is shown for the member to check, with its charge; a bad range says why.
  const ranges = renderToStaticMarkup(React.createElement(MomentRanges, { lengthSeconds: 2400, disabled: false, onChange: () => {},
    value: [{ start: '34:42', end: '39:42', read: { seconds: 2232, lengthSeconds: null, app: 'YouTube', text: '37:12', costUsd: 0.0004 } }, { start: '41:00', end: '43:00' }] }))
  assert.match(ranges, /Read 37:12 from your screenshot \(YouTube\), so this range is 34:42–39:42\. Check it matches, and fix it if not\. Reading it cost \$0\.0004\./)
  assert.match(ranges, /It starts after the video ends \(40:00\)\./)
  assert.match(ranges, /Add a range/)
  assert.match(ranges, /a range 2:30 either side of it/)
  // A pasted or dropped screenshot: the row it was dropped on, the first empty row, a new row, or none when all 3 are filled.
  const row = (start, end) => ({ start, end })
  assert.equal(screenshotRow([row('1:00', '2:00'), row('', '')], null), 1)
  assert.equal(screenshotRow([row('1:00', '2:00')], null), 1)
  assert.equal(screenshotRow([row('1:00', '2:00'), row('3:00', '4:00'), row('5:00', '6:00')], null), null)
  assert.equal(screenshotRow([row('1:00', '2:00'), row('3:00', '4:00'), row('5:00', '6:00')], 2), 2)

  // The review: each moment from its range, nudges, another moment, talking points, record or upload.
  const draft = (id, start, end, extra = {}) => ({ id, sourceIndex: 0, sourceTitle: 'Podcast', creator: '@host', startMs: start, endMs: end, quote: `Moment ${id} words`, why: 'A shocking number.',
    style: 'reaction', stance: 'add_nuance', headline: '', intro: '', beats: [], close: '', notes: [], grade: null, estimateUsd: 0, postCaption: '', format: 'moment_take', cues: [],
    moment: { rangeStartMs: 2220000, rangeEndMs: 2520000, said: '', picks: 1, points: [] }, ...extra })
  const status = { id: 'r1', phase: 'review', detail: 'Ready for review', percent: 100, folder: '/out/remix-x', estimateUsd: 0, outputs: [], costUsd: 0.04, warnings: ['Range 3 (0:45–1:00) starts after the video ends (0:40). Choose a time inside the video.'], error: null,
    drafts: [draft(0, 2230000, 2241000), draft(1, 2400000, 2410000, { headline: 'He says attention is the new oil', postCaption: 'My take.', moment: { rangeStartMs: 2220000, rangeEndMs: 2520000, said: 'I think so', picks: 2, points: ['Agree?', 'A story', 'A tip'] } })] }
  const review = renderToStaticMarkup(React.createElement(MomentTakeReview, { status, onError: () => {} }))
  assert.match(review, /Your moments · 2/)
  assert.match(review, /So far this has cost about \$0\.04\./)
  assert.match(review, /From your range 37:00–42:00/)
  assert.match(review, /Starts at 37:10\.0/)
  assert.match(review, /Find another moment in this range/)
  assert.match(review, /Give me talking points/)
  assert.match(review, /• Agree\?/)
  assert.match(review, /You said: “I think so”/)
  assert.match(review, /Upload a phone video/)
  assert.match(review, /Range 3 \(0:45–1:00\) starts after the video ends/)
  assert.match(review, /Make 2 videos/)
  // Free only when every chosen take's hook text was written from its current recording; otherwise those takes are transcribed.
  assert.match(review, /transcribes 2 of your takes for the captions/)
  const take = (written) => ({ reaction: { path: '/t.webm', uploaded: false, seconds: 10, ...(written ? { written: true } : {}) } })
  assert.match(momentMakeNote([0, 1], { 0: take(true), 1: take(true) }), /^Making the videos is free/)
  assert.equal(momentMakeNote([0, 1], { 0: take(true), 1: take(false) }),
    'Making the videos transcribes 1 of your takes for the captions (the hook text wasn’t written from that recording), which costs a little: up to about $0.02.')
  assert.equal(momentMakeNote([1], { 1: take(false) }),
    'Making the video transcribes your take for the captions (the hook text wasn’t written from that recording), which costs a little: up to about $0.02.')
})

test('a deleted brand is cleared from Create and Remix once the brand list is read; a failed read clears nothing', async () => {
  const brands = buildSync({
    stdin: {
      contents: `export { useBrands, isStaleBrandId } from './src/renderer/store/use-brand-store';
        export { useDraftStore } from './src/renderer/store/use-draft-store';
        export { useRemixForm } from './src/renderer/store/use-remix-form-store';`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false
  }).outputFiles[0].text
  let list = async () => { throw new Error('offline') }
  const module = { exports: {} }
  vm.runInNewContext(brands, { module, exports: module.exports, require, window: { bridgeclip: { brandIdentities: { list: () => list() } } } })
  const { useBrands, useDraftStore, useRemixForm, isStaleBrandId } = module.exports
  const GONE = 'a1b2c3d4e5f60718'
  const KEPT = 'b1b2c3d4e5f60718'
  useDraftStore.getState().update({ brandIdentityId: GONE, showHandle: true })
  useRemixForm.getState().update({ brandIdentityId: GONE, showHandle: true })
  await useBrands.getState().load()
  assert.equal(useBrands.getState().listed, false)
  assert.equal(isStaleBrandId(GONE), false)
  assert.equal(useDraftStore.getState().brandIdentityId, GONE, 'kept while the list is unknown')
  list = async () => [{ id: KEPT, name: 'Kept', text: 'x'.repeat(40), updatedAt: '' }]
  await useBrands.getState().load(true)
  assert.equal(useDraftStore.getState().brandIdentityId, null)
  assert.equal(useDraftStore.getState().showHandle, false)
  assert.equal(useRemixForm.getState().brandIdentityId, null)
  assert.equal(useRemixForm.getState().showHandle, false)
  // A brand still in the list stays chosen; one removed later is cleared then.
  useDraftStore.getState().update({ brandIdentityId: KEPT, showHandle: true })
  assert.equal(useDraftStore.getState().brandIdentityId, KEPT)
  useBrands.getState().setBrands([])
  assert.equal(useDraftStore.getState().brandIdentityId, null)
})

test('opening an Automatic run in the editor: the same moments and headlines; a cut note only when the run didn’t save its cuts', () => {
  const code = buildSync({
    stdin: { contents: `export { automaticEditSummary } from './src/renderer/components/EditAutomaticDialog';`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic', write: false
  }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, window: { bridgeclip: {} }, navigator: {} })
  const { automaticEditSummary } = mod.exports
  const info = { state: 'convert', source: 'kept', videoLabel: 'talk.mp4', clipCount: 3 }
  const recorded = automaticEditSummary(info)
  assert.equal(recorded[0], 'Your 3 clips open in the editor with the same moments and headlines. No AI is used.')
  assert.ok(!recorded.some((line) => /cuts/.test(line)))
  const older = automaticEditSummary({ ...info, estimatedCuts: true })
  assert.equal(older[1], 'This run didn’t save its exact cuts, so they are worked out again and may differ slightly from your clips. Check them before baking.')
})

test('Remix on camera: easy starts, a folded look summary, plain errors, the recorder frame guide and the pause fine-tune', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const code = buildSync({
    stdin: {
      contents: `export { useRemixForm, libraryClipFormat, LONG_CLIP_SECONDS } from './src/renderer/store/use-remix-form-store';
        export { startGoal } from './src/renderer/store/use-onboarding-store';
        export { REMIX_FORMATS } from './src/shared/remix';
        export { lookSummary } from './src/renderer/pages/RemixPage';
        export { friendlyError, FRIENDLY_ERROR } from './src/renderer/lib/friendly-error';
        export { FriendlyError } from './src/renderer/components/FriendlyError';
        export { frameGuide } from './src/renderer/components/RemixRecorder';
        export { PauseEditor } from './src/renderer/components/PauseReactReview';`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic', write: false
  }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, window: { bridgeclip: {} }, navigator: {} })
  const { useRemixForm, libraryClipFormat, LONG_CLIP_SECONDS, startGoal, REMIX_FORMATS, lookSummary, friendlyError, FRIENDLY_ERROR, FriendlyError, frameGuide, PauseEditor } = mod.exports

  // "Reactions on camera" opens Pause & react, you on camera.
  useRemixForm.getState().update({ format: 'commentary', host: 'still' })
  assert.equal(startGoal('camera-reactions'), 'remix')
  assert.deepEqual([useRemixForm.getState().format, useRemixForm.getState().host], ['pause_react', 'camera'])

  // Library → Remix this clip: an AI-presenter or screenshot format becomes a reaction on camera; a long video, Moment + my take.
  assert.equal(LONG_CLIP_SECONDS, 600)
  // A short Library clip opens in Their clip, then me (their clip, then the member's context); a long one in Moment + my take.
  assert.equal(libraryClipFormat('commentary', 'still', 40), 'clip_then_me')
  assert.equal(libraryClipFormat('silent', 'still', undefined), 'clip_then_me')
  assert.equal(libraryClipFormat('image', 'camera', 30), 'clip_then_me')
  assert.equal(libraryClipFormat('commentary', 'voice', 600), 'clip_then_me')
  assert.equal(libraryClipFormat('silent', 'lipsync', 601), 'moment_take')
  assert.equal(libraryClipFormat('pause_react', 'camera', 30), 'pause_react')
  assert.equal(libraryClipFormat('clip_then_me', 'camera', 30), 'clip_then_me')
  assert.equal(libraryClipFormat('react_thoughts', 'camera', 30), 'react_thoughts')
  assert.equal(libraryClipFormat('commentary', 'voice', 1200), 'moment_take')
  assert.equal(libraryClipFormat('commentary', 'camera', 1200), 'commentary')
  assert.equal(libraryClipFormat('silent', 'camera', 30), 'silent')
  assert.equal(libraryClipFormat('moment_take', 'still', 30), 'moment_take')
  useRemixForm.getState().update({ format: 'commentary', host: 'still', clipRightsAck: true })
  useRemixForm.getState().setSourceFile('/Users/me/CreatorClips/run/clip_00.mp4', '@coach', 900)
  assert.deepEqual([useRemixForm.getState().format, useRemixForm.getState().clipRightsAck], ['moment_take', false])

  // The silent format's new name.
  const silent = REMIX_FORMATS.find((item) => item.id === 'silent')
  assert.deepEqual([silent.label, silent.detail], ['React to a clip', 'Their moment plays with its sound; you (or your avatar) react on top'])

  // The folded "Look & call to action" says what's chosen.
  const base = { pauseLayout: null, momentPip: null, background: null, talk: null, includeCaptions: true, captionPreset: 'pop', headlineLook: 'white', brandName: null, keyword: null, ctaClip: false }
  assert.equal(lookSummary(base), 'Pop captions · White bar · No brand · No call to action')
  assert.equal(lookSummary({ ...base, pauseLayout: 'box', background: 'filmed', brandName: 'Pull-Up Lab', keyword: 'SALES', ctaClip: true }),
    'Box at the top · As filmed · Pop captions · White bar · Brand: Pull-Up Lab · Comment SALES + CTA clip')
  assert.equal(lookSummary({ ...base, momentPip: true, includeCaptions: false, headlineLook: 'none', ctaClip: true }),
    'Moment small on screen while you talk · No captions · No hook text · No brand · CTA clip')

  const plain_ = (value) => JSON.parse(JSON.stringify(value))
  // Raw engine text becomes one plain sentence, with the detail kept; the engine's own plain messages pass through.
  const raw = 'Remix failed: transcribe_audio() missing 1 required positional argument: \'language\''
  assert.deepEqual(plain_(friendlyError(raw)), { message: FRIENDLY_ERROR, detail: raw })
  assert.deepEqual(plain_(friendlyError('Traceback (most recent call last):\n  File "x.py", line 3, in <module>\nKeyError: \'a\'')), { message: FRIENDLY_ERROR, detail: 'Traceback (most recent call last):\n  File "x.py", line 3, in <module>\nKeyError: \'a\'' })
  for (const plain of ['Your disk is full. Free up some space, then try again.', 'your recording is too short. Record it again.', 'The video could not be made again. Try again.']) {
    assert.deepEqual(plain_(friendlyError(plain)), { message: plain, detail: null })
  }
  const shown = renderToStaticMarkup(React.createElement(FriendlyError, { error: raw, suffix: 'Your takes are still here.' }))
  assert.match(shown, /Something went wrong while making this\. Try again; if it keeps happening, use Report an issue\. Your takes are still here\./)
  assert.match(shown, /<summary[^>]*>Details<\/summary>/)
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(FriendlyError, { error: 'Your disk is full.' })), /Details/)

  // The recorder's frame guide: 9:16 of a 16:9 camera; Pause & react's box covers the top fifth; 50/50 keeps a wider frame.
  assert.ok(Math.abs(frameGuide().width - 0.3164) < 0.001)
  assert.deepEqual([frameGuide('box').covered, frameGuide('split').covered], [0.2, 0])
  assert.ok(frameGuide('split').width > 0.7)
  assert.ok(frameGuide(undefined, 'greenscreen').width > 0.6)

  // Pause & react: the summary and the bar stay; nudging and thresholds wait under "Fine-tune" when the sound lined it up.
  const timeline = { start: 0, end: 10, trimStart: 0, trimEnd: 10, duration: 10, source: 'upload', segments: [{ kind: 'play', start: 0, end: 4, at: 0 }, { kind: 'pause', start: 4, end: 7, at: 4 }, { kind: 'play', start: 7, end: 10, at: 4 }] }
  const view = (alignedBy) => ({ source: 'upload', timeline, settings: { nudge: 0, minPause: 0.6, minPlay: 0.5, flips: [] }, detection: { offset: 0.5, confidence: 0.9, alignedBy }, recordingPath: '/r.mp4', seconds: 10 })
  const found = renderToStaticMarkup(React.createElement(PauseEditor, { view: view('sound'), disabled: false, onChange: () => {} }))
  assert.match(found, /data-testid="pause-summary"/)
  assert.match(found, /Pauses timeline/)
  assert.match(found, /Fine-tune \(only if it looks off\)/)
  assert.match(found, /aria-expanded="false"/)
  assert.doesNotMatch(found, /Nudge their video|Ignore pauses shorter than/)
  const unheard = renderToStaticMarkup(React.createElement(PauseEditor, { view: view('start'), disabled: false, onChange: () => {} }))
  assert.match(unheard, /Nudge their video/)
})

test('Remix: You on camera / AI presenter, setup goals land on the right side, and the two short-clip templates’ review', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const code = buildSync({
    stdin: {
      contents: `export { useRemixForm } from './src/renderer/store/use-remix-form-store';
        export { startGoal } from './src/renderer/store/use-onboarding-store';
        export { remixMode, CAMERA_CARDS, AI_CARDS } from './src/shared/remix';
        export { partLabel } from './src/renderer/components/RemixRecorder';
        export { ClipTakeReview } from './src/renderer/components/ClipTakeReview';
        export { GUIDES } from './src/shared/onboarding';`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic', write: false
  }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, window: { bridgeclip: {} }, navigator: {} })
  const { useRemixForm, startGoal, remixMode, CAMERA_CARDS, AI_CARDS, partLabel, ClipTakeReview, GUIDES } = mod.exports
  const side = () => remixMode(useRemixForm.getState().format, useRemixForm.getState().host)

  // AI reactions land in "AI presenter" even from an on-camera template; on-camera goals land in "You on camera".
  useRemixForm.getState().update({ format: 'react_thoughts', host: 'camera' })
  startGoal('ai-reactions')
  assert.deepEqual([useRemixForm.getState().format, useRemixForm.getState().host, side()], ['commentary', 'still', 'ai'])
  useRemixForm.getState().update({ format: 'silent', host: 'voice' })
  startGoal('ai-reactions')
  assert.deepEqual([useRemixForm.getState().format, side()], ['silent', 'ai'])
  startGoal('camera-reactions')
  assert.equal(side(), 'camera')
  startGoal('article')
  assert.deepEqual([useRemixForm.getState().format, side()], ['image', 'camera'])
  assert.ok(CAMERA_CARDS.some((card) => card.id === 'react_thoughts') && !AI_CARDS.some((card) => card.id === 'pause_react'))
  // The guides name the new templates briefly.
  const steps = GUIDES['camera-reactions'].steps.join(' ')
  assert.match(steps, /Their clip, then me/)
  assert.match(steps, /React, then my thoughts/)
  assert.match(GUIDES['ai-reactions'].steps.join(' '), /AI presenter \(Beta\)/)

  assert.equal(partLabel('reaction', 'react_thoughts'), 'Part 1 · Watch & react')
  assert.equal(partLabel('thoughts', 'react_thoughts'), 'Part 2 · Your thoughts')
  assert.equal(partLabel('reaction', 'clip_then_me'), 'Your take')

  const status = (format) => ({ id: 'r1', phase: 'review', detail: '', percent: 100, folder: '/out/remix-x', estimateUsd: 0, outputs: [], costUsd: 0, warnings: [], error: null, onCamera: true,
    drafts: [{ id: 0, format, headline: '', intro: '', beats: [], close: '', postCaption: '', quote: '', why: '', startMs: 0, endMs: 15000, sourceIndex: 0, sourceTitle: 'The ad',
      creator: '@brand', style: 'reaction', stance: 'add_nuance', notes: [], grade: null, estimateUsd: 0, cues: [] }] })
  const react = renderToStaticMarkup(React.createElement(ClipTakeReview, { status: status('react_thoughts'), onError() {}, onOpenKeys() {} }))
  for (const heading of ['1 · Their clip', '2 · Part 1 · Watch &amp; react', '3 · Part 2 · Your thoughts', '5 · Hook text and caption']) assert.ok(react.includes(heading), heading)
  assert.match(react, /credited on screen as @brand/)
  const clip = renderToStaticMarkup(React.createElement(ClipTakeReview, { status: status('clip_then_me'), onError() {}, onOpenKeys() {} }))
  assert.ok(clip.includes('2 · Your take') && clip.includes('3 · Hook text and caption') && !clip.includes('b-roll'))
})

test('Remix first visit: opens on You on camera (the AI presenter only for an AI-only profile), says what is missing next to the button, labels the take style and folds the look on both sides', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const code = buildSync({
    stdin: {
      contents: `export { useRemixForm, remixStartStyle } from './src/renderer/store/use-remix-form-store';
        export { useSettingsStore } from './src/renderer/store/use-settings-store';
        export { RemixPage } from './src/renderer/pages/RemixPage';
        export { MomentRanges } from './src/renderer/components/MomentRanges';`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic', write: false
  }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, window: { bridgeclip: {} }, navigator: {}, requestAnimationFrame: (fn) => fn() })
  const { useRemixForm, remixStartStyle, useSettingsStore, RemixPage, MomentRanges } = mod.exports
  // (Server rendering reads a store's initial state, so a change goes there too.)
  const set = (store, patch) => { store.setState(patch); Object.assign(store.getInitialState(), patch) }
  const render = () => renderToStaticMarkup(React.createElement(RemixPage, { onNavigate() {} }))
  const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

  // No remembered choice: You on camera, Pause & react. Only a profile whose Remix goal is AI reactions alone opens the AI presenter.
  assert.deepEqual([useRemixForm.getState().format, useRemixForm.getState().host], ['pause_react', 'camera'])
  assert.deepEqual(JSON.parse(JSON.stringify(remixStartStyle([]))), {})
  assert.deepEqual(JSON.parse(JSON.stringify(remixStartStyle(['clips', 'ai-reactions']))), { format: 'commentary', host: 'still' })
  assert.deepEqual(JSON.parse(JSON.stringify(remixStartStyle(['ai-reactions', 'camera-reactions']))), {})
  assert.deepEqual(JSON.parse(JSON.stringify(remixStartStyle(['ai-reactions', 'article']))), {})

  let html = render()
  assert.match(html, /role="radio" aria-checked="true"[^>]*>(?:(?!<\/button>).)*You on camera/)
  // Why the button is off, said next to it (not only in a tooltip), with the way to fix it.
  assert.match(text(html), /Add your OpenRouter key in Settings first\. Open API keys/)
  assert.match(text(html), /All prices here are estimates: OpenRouter prices checked October 2026\. What your accounts bill is what counts\./)
  // One-video formats ask for one link; the creator's handle placeholder isn't the member's own.
  assert.match(html, /placeholder="https:\/\/www\.youtube\.com\/watch\?v=…"/)
  assert.match(text(html), /One video link/)
  assert.match(html, /placeholder="e\.g\. @theircreator"/)
  assert.doesNotMatch(html, /@coachname/)

  // A chosen file makes the creator required, and says so.
  set(useSettingsStore, { openrouterConfigured: true })
  set(useRemixForm, { filePath: '/Users/me/their video.mp4' })
  html = text(render())
  assert.match(html, /Original creator \(required\)/)
  assert.match(html, /Required: who made this video\./)
  assert.match(html, /Add the original creator’s name for the credit\. Show me/)
  set(useRemixForm, { creator: '@coach' })
  assert.match(text(render()), /Confirm you’re allowed to use this video\. Show me/)

  // Scripted take on camera: the take's style is labeled and says "you".
  set(useRemixForm, { format: 'commentary', host: 'camera', filePath: null, creator: '' })
  html = text(render())
  assert.match(html, /Style of your take/)
  assert.match(html, /you break it down and give the truth/)
  assert.match(html, /Their viral moment hooks the viewer, then you react/)
  assert.doesNotMatch(html, /your presenter/i)
  assert.match(html, /One link per line, up to 10/)
  assert.match(html, /3 · Look & call to action/)

  // The AI presenter: the presenter, then the same folded look (closed, with its summary line).
  set(useRemixForm, { format: 'commentary', host: 'voice' })
  const ai = render()
  assert.match(text(ai), /3 · Presenter .*4 · Look & call to action Pop captions · White bar · No brand · No call to action .*5 · Write the takes/)
  assert.match(ai, /aria-expanded="false" aria-controls="remix-look"/)

  // Moment + my take: times that are clearly placeholders.
  const ranges = renderToStaticMarkup(React.createElement(MomentRanges, { value: [{ start: '', end: '' }], lengthSeconds: null, disabled: false, onChange() {} }))
  assert.equal(ranges.match(/placeholder="mm:ss"/g).length, 2)
  assert.doesNotMatch(ranges, /placeholder="37:00"/)
})
