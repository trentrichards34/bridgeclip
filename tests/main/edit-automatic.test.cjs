const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Opening an Automatic Create run in the clip editor: what it takes (kept copy,
// original file, download), the run's settings sent to the engine, and the
// conversion's commit, retry and cleanup.

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
const plain = (value) => JSON.parse(JSON.stringify(value))
const isWebUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) } catch { return false } }
const RUN = '11111111-2222-4333-8444-555555555555'

function setup({ videoUrl = 'https://www.youtube.com/watch?v=abcdefghijk', metrics = {}, kept = false, transcript = true, request = null, live = false } = {}) {
  const lib = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'edit-automatic-')))
  const run = path.join(lib, RUN)
  fs.mkdirSync(run)
  fs.writeFileSync(path.join(run, 'clip_00.mp4'), 'clip')
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({
    job_id: RUN, source_video_url: videoUrl, source_video_title: 'The talk', source_video_duration_seconds: 300, total_clips: 1,
    clips: [{ clip_index: 0, s3_url: `file://${run}/clip_00.mp4`, duration_ms: 30000, start_time_ms: 0, end_time_ms: 30000, virality_score: 0.8, layout_type: 'fit', summary: 'Clip', tags: [], render_fallback: null }],
    transcript_url: null, plan_url: null, processing_time_seconds: 1, metrics
  }))
  if (transcript) fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: [] }))
  if (kept) fs.writeFileSync(path.join(run, 'editor-source.mp4'), 'kept video')
  const calls = { worker: [], authorized: [], checkedUrls: [], opened: [] }
  const security = {
    isWebUrl,
    authorizeMedia: (file) => { calls.authorized.push(file); return file },
    openAuthorizedMedia: async (file) => { calls.opened.push(file); const handle = await fs.promises.open(file, 'r'); return { handle, size: (await handle.stat()).size, canonical: file } }
  }
  const settingsStore = { loadSettings: () => ({ outputDirectory: lib }) }
  const fileManager = { getJobOutput: async (dir) => { try { return jobOutput.parseJobOutput(JSON.parse(fs.readFileSync(path.join(dir, 'job_output.json'), 'utf8'))) } catch { return null } } }
  const validation = loadMain('validation.ts', { './security': security })
  const moreClips = loadMain('more-clips.ts', { './settings-store': settingsStore, './security': security, './validation': validation, './file-manager': fileManager })
  if (request) moreClips.writeCreateRequest(run, request)
  let workerResult = (req) => {
    // The engine's commit: the project file, written last.
    fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project({ ...(req.source === 'kept' ? { preview_id: req.media_id } : { source_id: req.media_id }) })))
    fs.writeFileSync(path.join(run, `editor-preview-${req.media_id}.mp4`), 'preview')
    return { ok: true }
  }
  const prep = (dir) => ({
    run: dir, signal: new AbortController().signal, cancelled: () => false, setProgress: () => {},
    worker: async (req) => { calls.worker.push(plain(req)); return workerResult(req) }
  })
  const module = loadMain('edit-automatic.ts', {
    './settings-store': settingsStore, './security': security, './file-manager': fileManager, './more-clips': moreClips,
    './network-policy': { assertPublicWebUrl: async (url) => { calls.checkedUrls.push(url) } },
    './brands': { brandForJob: () => ({ name: 'Me', text: '', mark: { handle: '@me', logo_path: null, position: 'top-left' } }) },
    './job-manager': { liveJobIds: () => new Set(live ? [RUN] : []) },
    './clip-editor': { withEditorPreparation: async (dir, work) => work(prep(fs.realpathSync(dir))) },
    './logger': { logger: { info() {}, warn() {} } }
  })
  return { lib, run, module, calls, moreClips, setWorker: (fn) => { workerResult = fn } }
}

function project(extra = {}) {
  return { version: 1, revision: 0, title: 'The talk', width: 1920, height: 1080, duration_ms: 300000, aspect_ratio: '9:16', transcript: [],
    candidates: [{ id: 'clip-000', title: 'Clip', ranges: [[0, 30000]], scenes: [{ at_ms: 0, layout: 'fit', crops: [[0, 0, 1, 1]] }], captions: true,
      caption_preset: 'pop', video_speed: 1, status: 'baked', caption_edits: [], caption_suppression_ranges: [], score: 0, reason: '', review: null,
      exports: [0], library_clip: 0, hook: null, cta_id: null }],
    automatic: { omitted: [], estimated_cuts: 0 }, ...extra }
}

const read = (run, name) => JSON.parse(fs.readFileSync(path.join(run, name), 'utf8'))

test('what opening a run takes: the kept copy, the original file, a download, or nothing', async () => {
  // Recorded cuts (the run saved where each clip cut): nothing is worked out again.
  const recorded = { clip_layouts: [{ clip_index: 0, kept_source_ms: [[0, 12000], [14000, 30000]] }] }
  const kept = setup({ kept: true, metrics: recorded })
  assert.deepEqual(plain(await kept.module.automaticEditInfo(kept.run)), { videoLabel: 'https://www.youtube.com/watch?v=abcdefghijk', clipCount: 1, state: 'convert', source: 'kept' })
  const link = setup()
  assert.equal((await link.module.automaticEditInfo(link.run)).source, 'download')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-original-'))
  const file = path.join(dir, 'talk.mp4')
  fs.writeFileSync(file, 'original bytes')
  const original = setup({ videoUrl: file })
  assert.deepEqual(plain(await original.module.automaticEditInfo(original.run)), { videoLabel: 'talk.mp4', clipCount: 1, state: 'convert', source: 'original', copyBytes: 14, estimatedCuts: true })
  const gone = setup({ videoUrl: path.join(dir, 'deleted.mp4') })
  assert.equal((await gone.module.automaticEditInfo(gone.run)).source, 'missing')
})

test('an older run that didn’t save its cuts says so; recorded cuts, a framing record, an audit or natural pacing don’t', async () => {
  // No cut saved and tight pacing: the cuts are worked out again.
  const older = setup()
  assert.equal((await older.module.automaticEditInfo(older.run)).estimatedCuts, true)
  const framing = setup()
  fs.writeFileSync(path.join(framing.run, 'clip_00.framing.json'), JSON.stringify({ window: { start_ms: 0 }, keeps: [[0, 9000], [9500, 30000]] }))
  assert.equal((await framing.module.automaticEditInfo(framing.run)).estimatedCuts, undefined)
  const audited = setup()
  fs.writeFileSync(path.join(audited.run, 'edit_audit.json'), JSON.stringify({ candidates: [{ clip_index: 0, status: 'rendered', report: { retained_source: [[0, 30000]] } }] }))
  assert.equal((await audited.module.automaticEditInfo(audited.run)).estimatedCuts, undefined)
  const natural = setup({ metrics: { requested_settings: { pacing: 'natural' } } })
  assert.equal((await natural.module.automaticEditInfo(natural.run)).estimatedCuts, undefined)
})

test('Remix, Avatar Studio, running, transcript-less and outside runs are refused with plain words', async () => {
  const remix = setup({ metrics: { remix: true } })
  await assert.rejects(remix.module.automaticEditInfo(remix.run), /Remix and Avatar Studio videos are edited from their own menus/)
  const avatar = setup({ metrics: { avatar_studio: 'v1' } })
  await assert.rejects(avatar.module.automaticEditInfo(avatar.run), /own menus/)
  const live = setup({ live: true })
  await assert.rejects(live.module.automaticEditInfo(live.run), /Wait for this run to finish/)
  const bare = setup({ transcript: false })
  await assert.rejects(bare.module.automaticEditInfo(bare.run), /no saved transcript/)
  const other = setup()
  await assert.rejects(other.module.automaticEditInfo(path.join(os.tmpdir(), RUN)), /no longer in your Library|current output folder/)
  await assert.rejects(other.module.automaticEditInfo('relative/run'), /Choose a run in your Library/)
  const link = path.join(other.lib, 'link-run')
  fs.symlinkSync(other.run, link)
  await assert.rejects(other.module.automaticEditInfo(link), /no longer in your Library/)
})

test('the run\'s saved Create settings go to the engine; older runs use what their metrics recorded', () => {
  const look = { look: 'black', color: '#000000', font: 'serif' }
  const saved = setup({ request: { workflow: 'automatic', videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', clippingMode: 'quality', maxClips: 5, autoClipCount: false,
    durationRanges: null, aspectRatio: '9:16', layoutStyle: 'fill', layoutVision: true, pacing: 'natural', videoSpeed: 1.5, includeCaptions: false,
    captionPreset: 'boxed', includeTitle: true, titleStyle: 'headline', headlineLook: look, headlineVoice: 'creator', broll: 'full', hookPreview: true,
    ctaKeyword: 'GUIDE', ctaOffer: 'the guide', brandIdentityId: 'a'.repeat(16), showHandle: true,
    qualityBar: 'b', startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null } })
  fs.writeFileSync(path.join(saved.run, '.brand-logo.png'), 'logo')
  const output = jobOutput.parseJobOutput(read(saved.run, 'job_output.json'))
  const settings = plain(saved.module.editSettings(saved.run, output))
  assert.deepEqual(settings, { aspect_ratio: '9:16', layout_style: 'fill', include_captions: false, caption_preset: 'boxed', include_title: true, title_style: 'headline',
    headline_look: look, video_speed: 1.5, pacing: 'natural', background: false, broll: true, hook_preview: true, headline_voice: 'creator',
    cta_keyword: 'GUIDE', cta_offer: 'the guide', brand_mark: { handle: '@me', logo: true, position: 'top-left' } })
  const old = setup({ metrics: { requested_settings: { aspect_ratio: '9:16', title_style: 'card', include_title: true, broll: { enabled: true }, hook_preview: true, background_video: 'game.mp4' } } })
  const oldSettings = old.module.editSettings(old.run, jobOutput.parseJobOutput(read(old.run, 'job_output.json')))
  assert.equal(oldSettings.title_style, 'card')
  assert.equal(oldSettings.broll, true)
  assert.equal(oldSettings.hook_preview, true)
  assert.equal(oldSettings.background, true)
  assert.equal(oldSettings.headline_voice, 'clipper')
  assert.equal(oldSettings.brand_mark, null)
  // A run without create-request.json keeps the headline voice its metrics recorded.
  const creator = setup({ metrics: { requested_settings: { headline_voice: 'creator' } } })
  assert.equal(creator.module.editSettings(creator.run, jobOutput.parseJobOutput(read(creator.run, 'job_output.json'))).headline_voice, 'creator')
})

test('a kept copy converts without a download; the run is marked once the project is committed', async () => {
  const { run, module, calls } = setup({ kept: true })
  const info = await module.prepareAutomaticEditor(run)
  assert.equal(info.state, 'ready')
  const [request] = calls.worker
  assert.equal(request.mode, 'convert')
  assert.equal(request.source, 'kept')
  assert.match(request.media_id, /^[a-f0-9]{32}$/)
  assert.equal(request.url, undefined)
  assert.equal(request.settings.aspect_ratio, '9:16')
  assert.equal(read(run, 'job_output.json').editor_project, true)
  assert.ok(fs.existsSync(path.join(run, `editor-preview-${request.media_id}.mp4`)))
  assert.deepEqual(calls.checkedUrls, [])
  // Ready now: no second conversion.
  await module.prepareAutomaticEditor(run)
  assert.equal(calls.worker.length, 1)
})

test('a link is checked and downloaded by the engine; the original file is copied in after authorizing it', async () => {
  const link = setup()
  await link.module.prepareAutomaticEditor(link.run)
  assert.deepEqual(link.calls.checkedUrls, ['https://www.youtube.com/watch?v=abcdefghijk'])
  assert.equal(link.calls.worker[0].source, 'download')
  assert.equal(link.calls.worker[0].url, 'https://www.youtube.com/watch?v=abcdefghijk')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-original-'))
  const file = path.join(dir, 'talk.mp4')
  fs.writeFileSync(file, 'original bytes')
  const original = setup({ videoUrl: file })
  await original.module.prepareAutomaticEditor(original.run)
  const request = original.calls.worker[0]
  assert.equal(request.source, 'file')
  assert.deepEqual(original.calls.authorized, [file])
  assert.equal(fs.readFileSync(path.join(original.run, `editor-source-${request.media_id}.mp4`), 'utf8'), 'original bytes')
  assert.equal(fs.statSync(path.join(original.run, `editor-source-${request.media_id}.mp4`)).mode & 0o777, 0o600)
})

test('a failed conversion leaves the run as it was, and can be retried', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-original-'))
  const file = path.join(dir, 'talk.mp4')
  fs.writeFileSync(file, 'original bytes')
  const { run, module, calls, setWorker } = setup({ videoUrl: file })
  const before = fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')
  setWorker((req) => {
    fs.writeFileSync(path.join(run, `editor-preview-${req.media_id}.mp4.partial.mp4`), 'half')
    throw new Error('Could not download this video again. It may now be private, removed or need a sign-in.')
  })
  await assert.rejects(module.prepareAutomaticEditor(run), /private, removed/)
  assert.equal(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'), before)
  assert.deepEqual(fs.readdirSync(run).filter((name) => name.startsWith('editor-')), [])
  // The project was written but the run not yet marked (a crash in between): finishing needs no new video.
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project({ source_id: 'b'.repeat(32) })))
  calls.worker.length = 0
  assert.equal((await module.automaticEditInfo(run)).state, 'convert')
  await module.prepareAutomaticEditor(run)
  assert.equal(calls.worker.length, 0)
  assert.equal(read(run, 'job_output.json').editor_project, true)
})

test('a converted project whose video was freed gets it back; a chosen file must be a video', async () => {
  const { run, module, calls, setWorker } = setup()
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project({ media_freed: true, revision: 7 })))
  const output = read(run, 'job_output.json'); output.editor_project = true
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify(output))
  assert.equal((await module.automaticEditInfo(run)).state, 'restore')
  setWorker((req) => {
    fs.writeFileSync(path.join(run, `editor-source-${req.media_id}.mp4`), 'video')
    fs.writeFileSync(path.join(run, `editor-preview-${req.media_id}.mp4`), 'preview')
    fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project({ revision: 8, source_id: req.media_id })))
    return { ok: true }
  })
  await assert.rejects(module.prepareAutomaticEditor(run, '/tmp/notes.txt'), /Choose a video file/)
  await assert.rejects(module.prepareAutomaticEditor(run, 'relative.mp4'), /Choose a video file/)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-chosen-'))
  const chosen = path.join(dir, 'same.mov')
  fs.writeFileSync(chosen, 'same video')
  assert.equal((await module.prepareAutomaticEditor(run, chosen)).state, 'ready')
  const [request] = calls.worker
  assert.deepEqual({ mode: request.mode, source: request.source, revision: request.revision }, { mode: 'restore', source: 'file', revision: 7 })
  // A chosen file is never authorized here: only one the open dialog authorized can be read.
  assert.deepEqual(calls.authorized, [])
  assert.deepEqual(calls.opened, [chosen])
  // A Review & edit run is always ready (its editor works as before).
  const review = setup({ kept: true })
  fs.writeFileSync(path.join(review.run, 'editor-project.json'), JSON.stringify({ ...project(), automatic: undefined }))
  const reviewOutput = read(review.run, 'job_output.json'); reviewOutput.editor_project = true
  fs.writeFileSync(path.join(review.run, 'job_output.json'), JSON.stringify(reviewOutput))
  assert.equal((await review.module.automaticEditInfo(review.run)).state, 'ready')
})

test('More clips reuses the source an Automatic run kept', () => {
  const { run, moreClips } = setup({ kept: true })
  assert.equal(moreClips.keptSourcePath(run), path.join(run, 'editor-source.mp4'))
  fs.rmSync(path.join(run, 'editor-source.mp4'))
  fs.symlinkSync('/etc/hosts', path.join(run, 'editor-source.mp4'))
  assert.equal(moreClips.keptSourcePath(run), null)
})
