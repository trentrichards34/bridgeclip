const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Several videos per Create job, More clips from a finished run (reuse plan and
// exclusions), caption language validation and the clip's captions file field.

const cache = new Map()
function transpile(file) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8')
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
function loadShared(name) {
  if (!cache.has(name)) {
    const module = { exports: {} }
    cache.set(name, module.exports)
    vm.runInNewContext(transpile(`shared/${name}.ts`), { module, exports: module.exports, require: (id) => id.startsWith('./') ? loadShared(id.slice(2)) : require(id), URL, Set, Map })
    cache.set(name, module.exports)
  }
  return cache.get(name)
}
function loadMain(file, mocks = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transpile(`main/${file}`), {
    module, exports: module.exports, URL, Set, Map, process, Buffer, console, setTimeout, clearTimeout, queueMicrotask,
    require: (id) => mocks[id] ?? (id.startsWith('../shared/') ? loadShared(id.slice('../shared/'.length)) : require(id))
  })
  return module.exports
}

const jobOutput = loadShared('job-output')
const createSources = loadShared('create-sources')
const captionLanguage = loadShared('caption-language')
const plain = (value) => JSON.parse(JSON.stringify(value))

const isWebUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false } }
const security = { isWebUrl, assertMediaPath: () => {}, authorizeMedia: (p) => p }
const validation = loadMain('validation.ts', { './security': security })

function library() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'more-clips-'))
  return fs.realpathSync(dir)
}
function moreClipsModule(lib) {
  return loadMain('more-clips.ts', {
    './settings-store': { loadSettings: () => ({ outputDirectory: lib }) },
    './security': security,
    './validation': validation,
    './file-manager': { getJobOutput: async (run) => { try { return jobOutput.parseJobOutput(JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))) } catch { return null } } }
  })
}

const RUN = '11111111-2222-4333-8444-555555555555'
const BASE = {
  workflow: 'automatic', videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', clippingMode: 'quality', maxClips: 5, autoClipCount: false,
  durationRanges: ['short'], aspectRatio: '9:16', layoutStyle: 'auto', layoutVision: true, pacing: 'tight', videoSpeed: 1, includeCaptions: true,
  captionPreset: 'bold', includeTitle: true, titleStyle: 'headline', qualityBar: 'b', startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null
}
function makeRun(lib, { videoUrl = BASE.videoUrl, clips = [[0, 30000], [60000, 95000]], transcript = true, request = BASE, editorSource = false } = {}) {
  const run = path.join(lib, RUN)
  fs.mkdirSync(run, { recursive: true })
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({
    job_id: RUN, source_video_url: videoUrl, source_video_title: 'The talk', source_video_duration_seconds: 300, total_clips: clips.length,
    clips: clips.map(([start, end], i) => ({ clip_index: i, s3_url: `file://${run}/clip_0${i}.mp4`, duration_ms: end - start, start_time_ms: start, end_time_ms: end, virality_score: 0.8, layout_type: 'fit', summary: `Clip ${i}`, tags: [], render_fallback: null })),
    transcript_url: null, plan_url: null, processing_time_seconds: 1, metrics: { requested_settings: { aspect_ratio: '16:9', quality_bar: 'c', pacing: 'natural' } }
  }))
  if (transcript) fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: [], status: 'available' }))
  if (request) moreClipsModule(lib).writeCreateRequest(run, request, [[200000, 230000]])
  if (editorSource) {
    fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify({ source_id: null }))
    fs.writeFileSync(path.join(run, 'editor-source.mp4'), 'video')
  }
  return run
}

test('pasted text with several links becomes several sources, in order, without repeats', () => {
  const text = 'https://www.youtube.com/watch?v=aaaaaaaaaaa\nhttps://twitch.tv/videos/123?t=1h  https://example.com/a.mp4,\n# comment\n1. https://www.youtube.com/watch?v=aaaaaaaaaaa\nnot a link\nhttps://twitch.tv/somechannel'
  const parsed = createSources.parseSourceText(text)
  assert.deepEqual(plain(parsed.links), ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://www.twitch.tv/videos/123', 'https://example.com/a.mp4'])
  assert.deepEqual(plain(parsed.invalid), ['not a link', 'https://twitch.tv/somechannel'])
  assert.deepEqual(plain(createSources.parseSourceText('https://user:pw@example.com/v').links), [])
})

test('adding sources keeps at most 10 and skips ones already added', () => {
  const ten = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.mp4`)
  const merged = createSources.mergeSources(ten, ['https://example.com/0.mp4', 'https://example.com/new.mp4', 'https://example.com/over.mp4'])
  assert.equal(merged.sources.length, createSources.MAX_CREATE_SOURCES)
  assert.equal(merged.sources.at(-1), 'https://example.com/new.mp4')
  assert.equal(merged.duplicates, 1)
  assert.equal(merged.overLimit, 1)
  assert.equal(createSources.sourceCountLabel(3), '3 videos will be clipped')
  assert.equal(createSources.sourceCountLabel(1), '1 video will be clipped')
})

test('caption language: only listed languages pass validation; original sends nothing', () => {
  assert.equal(captionLanguage.CAPTION_LANGUAGES.length, 11)
  assert.equal(validation.validateJobConfig({ ...BASE, captionLanguage: 'es' }).captionLanguage, 'es')
  assert.equal('captionLanguage' in validation.validateJobConfig(BASE), false)
  for (const bad of ['xx', 'original', 'ES', 3, null]) {
    assert.throws(() => validation.validateJobConfig({ ...BASE, captionLanguage: bad }), /caption language/i, String(bad))
  }
  assert.throws(() => validation.validateJobConfig({ ...BASE, reuseFrom: '../escape' }), /finished run/)
  assert.throws(() => validation.validateJobConfig({ ...BASE, workflow: 'review', reuseFrom: RUN }), /Automatic/)
  // The reuse plan is built in main, never accepted from the renderer.
  const config = validation.validateJobConfig({ ...BASE, reuseFrom: RUN, reuse: { transcriptPath: '/etc/passwd' } })
  assert.equal(config.reuseFrom, RUN)
  assert.equal(config.reuse, undefined)
})

test('the clip captions file is recorded as an absolute .srt path', () => {
  const clip = { clip_index: 0, s3_url: 'file:///lib/run/clip_00.mp4', duration_ms: 1, start_time_ms: 0, end_time_ms: 1, virality_score: 1, tags: [] }
  const parse = (extra) => jobOutput.parseJobOutput({ clips: [{ ...clip, ...extra }] }).clips[0]
  assert.equal(parse({ captions_srt: '/lib/run/clip_00.srt', caption_language: 'ja' }).captions_srt, '/lib/run/clip_00.srt')
  assert.equal(parse({ captions_srt: 'C:\\Clips\\run\\clip_00.srt' }).captions_srt, 'C:\\Clips\\run\\clip_00.srt')
  assert.equal(parse({ caption_language: 'ja' }).caption_language, 'ja')
  for (const bad of ['clip_00.srt', '/lib/run/clip_00.txt', '/lib/../etc/clip.srt', 'file:///lib/clip.srt', 7]) {
    assert.equal(parse({ captions_srt: bad }).captions_srt, undefined, String(bad))
  }
  assert.equal(parse({ caption_language: 'klingon' }).caption_language, undefined)
  // job-output keeps its own copy of the codes: it must match the list.
  for (const language of captionLanguage.CAPTION_LANGUAGES) assert.equal(parse({ caption_language: language.id }).caption_language, language.id)
  const output = jobOutput.parseJobOutput({ clips: [], metrics: { transcript_reused: true, api_costs: { total_estimated_cost_usd: 0.01, caption_translation: { estimated_cost_usd: 0.004, attempts: 2 } } } })
  assert.equal(output.metrics.transcript_reused, true)
  assert.equal(output.metrics.api_costs.caption_translation.attempts, 2)
})

test('more clips: reuses the transcript, downloads a link again and skips earlier moments', async () => {
  const lib = library()
  const run = makeRun(lib)
  const more = moreClipsModule(lib)
  const info = await more.moreClipsInfo(run)
  assert.equal(info.source, 'download')
  assert.equal(info.transcriptSaved, true)
  assert.equal(info.savedSettings, true)
  assert.equal(info.excludedCount, 3)
  assert.equal(info.request.captionPreset, 'bold')
  const plan = await more.resolveReuse(RUN, BASE.videoUrl)
  assert.equal(plan.transcriptPath, path.join(run, 'transcript.json'))
  assert.equal(plan.sourcePath, null)
  assert.deepEqual(plain(plan.excludeRangesMs), [[200000, 230000], [0, 30000], [60000, 95000]])
  assert.equal(plan.expectedDurationSeconds, 300)
  await assert.rejects(more.resolveReuse(RUN, 'https://www.youtube.com/watch?v=zzzzzzzzzzz'), /same video/)
  await assert.rejects(more.resolveReuse('../x', BASE.videoUrl), /finished run/)
})

test('more clips: a local file is used in place, then a kept copy, else it can’t start', async () => {
  const lib = library()
  const file = path.join(lib, 'source.mp4')
  fs.writeFileSync(file, 'video')
  makeRun(lib, { videoUrl: file, request: { ...BASE, videoUrl: file } })
  const more = moreClipsModule(lib)
  assert.equal((await more.resolveReuse(RUN, file)).source, 'original')
  fs.rmSync(file)
  await assert.rejects(more.resolveReuse(RUN, file), /no longer on this computer/)
  assert.equal((await more.moreClipsInfo(path.join(lib, RUN))).source, 'missing')
  // A Review & edit run keeps a copy of its source.
  fs.writeFileSync(path.join(lib, RUN, 'editor-project.json'), JSON.stringify({ source_id: null }))
  fs.writeFileSync(path.join(lib, RUN, 'editor-source.mp4'), 'video')
  const plan = await more.resolveReuse(RUN, file)
  assert.equal(plan.source, 'kept')
  assert.equal(plan.sourcePath, path.join(lib, RUN, 'editor-source.mp4'))
  assert.equal(plan.sourceMeta.title, 'The talk')
  fs.writeFileSync(path.join(lib, RUN, 'editor-project.json'), JSON.stringify({ media_freed: true }))
  await assert.rejects(more.resolveReuse(RUN, file), /no longer on this computer/)
})

test('more clips: no saved transcript means no reuse; older runs start from their recorded settings', async () => {
  const lib = library()
  makeRun(lib, { transcript: false, request: null })
  const more = moreClipsModule(lib)
  await assert.rejects(more.resolveReuse(RUN, BASE.videoUrl), /no saved transcript/)
  const info = await more.moreClipsInfo(path.join(lib, RUN))
  assert.equal(info.transcriptSaved, false)
  assert.equal(info.savedSettings, false)
  assert.equal(info.request.aspectRatio, '16:9')
  assert.equal(info.request.qualityBar, 'c')
  assert.equal(info.request.pacing, 'natural')
  // The rebuilt settings are a valid request.
  assert.doesNotThrow(() => validation.validateJobConfig(info.request))
})

test('more clips: the member’s choices replace count, length, quality bar, clip request and language', async () => {
  const lib = library()
  makeRun(lib, { request: { ...BASE, clipRequest: 'old request', captionLanguage: 'fr' } })
  const more = moreClipsModule(lib)
  const info = await more.moreClipsInfo(path.join(lib, RUN))
  const choices = more.parseMoreClipsChoices({ autoClipCount: false, maxClips: 8, durationRanges: ['xshort', 'medium'], qualityBar: 'a', clipRequest: 'the pricing story', captionLanguage: 'de' })
  const request = more.moreClipsRequest(info, choices)
  assert.equal(request.reuseFrom, RUN)
  assert.equal(request.maxClips, 8)
  assert.deepEqual(plain(request.durationRanges), ['xshort', 'medium'])
  assert.equal(request.qualityBar, 'a')
  assert.equal(request.clipRequest, 'the pricing story')
  assert.equal(request.captionLanguage, 'de')
  assert.equal(request.captionPreset, 'bold')
  assert.doesNotThrow(() => validation.validateJobConfig(request))
  const plainChoices = more.moreClipsRequest(info, more.parseMoreClipsChoices({ autoClipCount: true, maxClips: null, durationRanges: [], qualityBar: 'b' }))
  assert.equal(plainChoices.clipRequest, undefined)
  assert.equal(plainChoices.captionLanguage, undefined)
  assert.equal(plainChoices.durationRanges, null)
  for (const bad of [null, { autoClipCount: 'yes' }, { autoClipCount: false, maxClips: 0, durationRanges: null, qualityBar: 'b' },
    { autoClipCount: true, maxClips: null, durationRanges: ['huge'], qualityBar: 'b' }, { autoClipCount: true, maxClips: null, durationRanges: null, qualityBar: 'z' },
    { autoClipCount: true, maxClips: null, durationRanges: null, qualityBar: 'b', captionLanguage: 'xx' }]) {
    assert.throws(() => more.parseMoreClipsChoices(bad), undefined, JSON.stringify(bad))
  }
})

function startHarness(lib, brands = { brandForJob: () => null }) {
  const progress = loadShared('job-progress')
  const starts = []
  const runner = {
    startClipJob: (jobId, config) => starts.push({ jobId, config }), cancelJob: () => true, ctaStepRunning: () => false,
    getBridgeRunnerPath: () => '/bridge.py', getEnginePath: () => '/engine', resolvePythonPath: () => 'python3',
    preflightCheck: () => ({ ok: true }), validatePython: async () => ({ ok: true })
  }
  const records = []
  const runHistory = {
    createRunRecord: (dir, jobId) => { fs.mkdirSync(path.join(dir, jobId), { recursive: true }); records.push(jobId) },
    finishRunRecord: () => {}
  }
  const logger = { logger: { info() {}, warn() {}, error() {} } }
  const manager = loadMain('job-manager.ts', { './pipeline-runner': runner, './run-history': runHistory, './logger': logger, '../shared/job-progress': progress })
  manager.initJobManager(() => null)
  const settings = { loadSettings: () => ({ openrouterApiKey: 'key', outputDirectory: lib, pythonPath: '' }) }
  const authorized = []
  const start = loadMain('job-start.ts', {
    './settings-store': settings, './file-manager': { ensureOutputDir: () => {} }, './pipeline-runner': runner, './run-history': runHistory,
    './job-manager': manager, './logger': logger, './security': { ...security, authorizeMedia: (p) => { authorized.push(p); return p } },
    './network-policy': { assertPublicWebUrl: async () => {} }, './validation': validation, './openrouter-models': { resolveAdvancedModels: async () => ({}) },
    './tools': { supportsCaptionFilter: async () => true }, './brands': brands, './more-clips': loadMain('more-clips.ts', {
      './settings-store': settings, './security': security, './validation': validation,
      './file-manager': { getJobOutput: async (run) => { try { return jobOutput.parseJobOutput(JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))) } catch { return null } } }
    })
  })
  return { start, manager, starts, records, authorized }
}

test('several videos: one job each with the same settings, at most MAX_PARALLEL_JOBS running', async () => {
  const lib = library()
  const { start, manager, starts, records } = startHarness(lib)
  const links = ['https://example.com/1.mp4', 'https://example.com/2.mp4', 'https://example.com/3.mp4']
  const result = await start.startClipJobRequests(links.map((videoUrl) => ({ ...BASE, videoUrl, captionLanguage: 'es' })))
  assert.equal(result.started.length, 3)
  assert.deepEqual(plain(result.failed), [])
  assert.deepEqual(plain(result.started.map((item) => item.queued)), [false, false, true])
  assert.equal(starts.length, 2)
  assert.deepEqual(starts.map((item) => item.config.videoUrl), links.slice(0, 2))
  assert.ok(starts.every((item) => item.config.captionLanguage === 'es' && item.config.captionPreset === 'bold'))
  assert.equal(manager.listJobs().length, 3)
  assert.equal(records.length, 3)
  // Each run saves its settings for More clips.
  for (const jobId of records) assert.ok(fs.existsSync(path.join(lib, jobId, 'create-request.json')))
  assert.match((await start.startClipJobRequests([])).error, /Add a video/)
  assert.match((await start.startClipJobRequests(Array.from({ length: 11 }, (_, i) => ({ ...BASE, videoUrl: `https://e.com/${i}` })))).error, /up to 10/)
  assert.match((await start.startClipJobRequests([BASE, BASE])).error, /once/)
  const mixed = await start.startClipJobRequests([{ ...BASE, videoUrl: 'https://example.com/4.mp4' }, { ...BASE, videoUrl: 'https://example.com/5.mp4', aspectRatio: '1:1' }])
  assert.equal(mixed.started.length, 1)
  assert.equal(mixed.failed[0].videoUrl, 'https://example.com/5.mp4')
})

test('more clips start: the reuse plan rides along to the runner and a local source is authorized', async () => {
  const lib = library()
  const file = path.join(lib, 'talk.mp4')
  fs.writeFileSync(file, 'video')
  makeRun(lib, { videoUrl: file, request: { ...BASE, videoUrl: file } })
  const { start, starts, authorized } = startHarness(lib)
  const result = await start.startMoreClips(path.join(lib, RUN), { autoClipCount: true, maxClips: null, durationRanges: null, qualityBar: 'b' })
  assert.ok(result.jobId, result.error)
  assert.deepEqual(authorized, [file])
  const config = starts[0].config
  assert.equal(config.reuseFrom, RUN)
  assert.equal(config.reuse.source, 'original')
  assert.equal(config.reuse.transcriptPath, path.join(lib, RUN, 'transcript.json'))
  assert.deepEqual(plain(config.reuse.excludeRangesMs), [[200000, 230000], [0, 30000], [60000, 95000]])
  // The new run remembers what it skipped, so a later More clips skips those too.
  const saved = JSON.parse(fs.readFileSync(path.join(lib, result.jobId, 'create-request.json'), 'utf8'))
  assert.equal(saved.excludedRangesMs.length, 3)
  assert.equal(saved.request.reuseFrom, RUN)
  assert.match((await start.startMoreClips(path.join(lib, RUN), { autoClipCount: 'x' })).error, /Invalid options/)
})

test('more clips: an earlier run on part of the video is marked, so an older transcript isn’t reused for more', async () => {
  const lib = library()
  makeRun(lib, { request: { ...BASE, startTimeSeconds: 30, endTimeSeconds: 120 } })
  const more = moreClipsModule(lib)
  assert.equal((await more.resolveReuse(RUN, BASE.videoUrl)).transcriptPartial, true)
  makeRun(lib)
  assert.equal((await more.resolveReuse(RUN, BASE.videoUrl)).transcriptPartial, false)
  // Runs from before settings were saved: the analyzed length tells.
  const output = (analyzed) => jobOutput.parseJobOutput({ clips: [], source_video_duration_seconds: 300, metrics: { analysis_duration_seconds: analyzed } })
  assert.equal(more.earlierRangeWasPartial(output(90), null), true)
  assert.equal(more.earlierRangeWasPartial(output(299.5), null), false)
  assert.equal(more.earlierRangeWasPartial(jobOutput.parseJobOutput({ clips: [], source_video_duration_seconds: 300, metrics: {} }), null), false)
})

test('more clips: the plan is checked again when a queued run starts', async () => {
  const lib = library()
  const file = path.join(lib, 'source.mp4')
  fs.writeFileSync(file, 'video')
  const run = makeRun(lib, { videoUrl: file, request: { ...BASE, videoUrl: file }, editorSource: true })
  const keptCopy = path.join(run, 'editor-source.mp4')
  const more = moreClipsModule(lib)
  const plan = await more.resolveReuse(RUN, file)
  assert.equal(plan.source, 'original')
  assert.deepEqual(plain(more.refreshReusePlan(plan, file)), plain({ plan }))
  // The original went while the run waited: the kept copy is used, with the earlier title.
  fs.rmSync(file)
  const kept = more.refreshReusePlan(plan, file)
  assert.equal(kept.plan.source, 'kept')
  assert.equal(kept.plan.sourcePath, keptCopy)
  assert.equal(kept.plan.sourceMeta.title, 'The talk')
  // Neither: a clear error.
  fs.rmSync(keptCopy)
  assert.match(more.refreshReusePlan(plan, file).error, /no longer on this computer/)
  // The kept copy went but the original is back: the original is used.
  fs.writeFileSync(file, 'video')
  const original = more.refreshReusePlan({ ...plan, source: 'kept', sourcePath: keptCopy }, file)
  assert.equal(original.plan.source, 'original')
  assert.equal(original.plan.sourcePath, null)
  // A link whose kept copy went is downloaded again.
  const linked = more.refreshReusePlan({ ...plan, source: 'kept', sourcePath: keptCopy }, BASE.videoUrl)
  assert.equal(linked.plan.source, 'download')
  assert.equal(linked.plan.sourcePath, null)
})

test('more clips: a brand deleted since the earlier run is dropped with a note', () => {
  const lib = library()
  const more = moreClipsModule(lib)
  const request = { ...BASE, brandIdentityId: 'a1b2c3d4e5f60718', showHandle: true }
  assert.deepEqual(plain(more.withoutMissingBrand(request, () => true)), { request: plain(request), note: null })
  const dropped = more.withoutMissingBrand(request, () => false)
  assert.equal(dropped.request.brandIdentityId, undefined)
  assert.equal(dropped.request.showHandle, undefined)
  assert.match(dropped.note, /deleted.*no brand/)
  assert.doesNotThrow(() => validation.validateJobConfig(dropped.request))
})

test('more clips start: a deleted brand is left out with a note instead of failing', async () => {
  const lib = library()
  makeRun(lib, { request: { ...BASE, brandIdentityId: 'a1b2c3d4e5f60718', showHandle: true } })
  const { start, starts } = startHarness(lib, { brandForJob: () => { throw new Error('That brand identity was deleted. Choose another brand, or no brand, and start again.') } })
  const info = await start.moreClipsInfo(path.join(lib, RUN))
  assert.match(info.note, /deleted/)
  assert.equal(info.request.brandIdentityId, undefined)
  const result = await start.startMoreClips(path.join(lib, RUN), { autoClipCount: true, maxClips: null, durationRanges: null, qualityBar: 'b' })
  assert.ok(result.jobId, result.error)
  assert.match(result.note, /no brand/)
  assert.equal(starts[0].config.brandIdentityId, undefined)
  assert.equal(starts[0].config.showHandle, undefined)
  // A new Create run with that brand still can't start.
  assert.ok((await start.startClipJobRequest({ ...BASE, brandIdentityId: 'a1b2c3d4e5f60718' })).error)
})
