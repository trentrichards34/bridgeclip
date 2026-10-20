const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { FormatStep, ClipsStep, CaptionsStep, JobForm, formatSummary, clipsSummary, createBoardPatch, createBoardStyle, createReferencePatch, buildJobRequest, buildJobRequests, draftSources, parseTrimRange, SCREEN_FOCUS_OPTIONS, ReviewStep } from './src/renderer/components/JobForm';
      export { screenFocusLabel } from './src/renderer/components/ClipCard';
      export { reuseSummary, moreClipsBlocked } from './src/renderer/components/MoreClipsDialog';
      export { JobProgress } from './src/renderer/components/JobProgress';
      export { SetupCard } from './src/renderer/components/SetupCard';
      export { useSettingsStore } from './src/renderer/store/use-settings-store';
      export { useDraftStore } from './src/renderer/store/use-draft-store';
      export { SourcePicker, isValidSourceLink } from './src/renderer/components/SourcePicker';
      export { framingProblem, sourceAnalysisNotice, screenFocusByIndex } from './src/renderer/components/ClipList';
      export { parseJobOutput } from './src/shared/job-output';
      export { twitchVodId, normalizeVideoSource } from './src/shared/video-source';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  loader: { '.css': 'empty' },
  define: { __APP_VERSION__: JSON.stringify(require('../package.json').version) },
  jsx: 'automatic',
  write: false
}).outputFiles[0].text

const form = { exports: {} }
new Function('module', 'exports', 'require', bundled)(form, form.exports, require)
const { FormatStep, JobForm, isValidSourceLink, parseTrimRange, framingProblem, sourceAnalysisNotice, parseJobOutput } = form.exports

test('setup needs only OpenRouter for clipping', () => {
  const { SetupCard, useSettingsStore } = form.exports
  useSettingsStore.setState({ openrouterConfigured: false })
  const setup = renderToStaticMarkup(React.createElement(SetupCard, { onOpenSettings() {} }))
  assert.match(setup, /OpenRouter/)
  assert.doesNotMatch(setup, /ElevenLabs/)
  useSettingsStore.setState({ openrouterConfigured: false, toolStatus: null })
})

test('source picker accepts full HTTP(S) links and rejects malformed or credentialed links', () => {
  assert.equal(isValidSourceLink(' https://www.youtube.com/watch?v=abc '), true)
  assert.equal(isValidSourceLink('http://example.com/video.mp4'), true)
  assert.equal(isValidSourceLink('https://'), false)
  assert.equal(isValidSourceLink('https://user:pass@example.com/video'), false)
  assert.equal(isValidSourceLink('file:///tmp/video.mp4'), false)
})

test('trim validation matches main process bounds, including an end at zero', () => {
  assert.equal(parseTrimRange(true, '', '0').error, 'End must be after the start.')
  assert.equal(parseTrimRange(true, '1:30', '90').error, 'End must be after the start.')
  assert.deepEqual(parseTrimRange(true, '', '1:30'), { start: null, end: 90, error: null })
  assert.deepEqual(parseTrimRange(false, 'oops', '0'), { start: null, end: null, error: null })
})

test('the wizard opens on the video step with the steps listed in order', () => {
  const html = renderToStaticMarkup(React.createElement(JobForm, { onSubmit() {} }))
  const labels = [...html.matchAll(/aria-label="Create steps"[^>]*>(.*?)<\/nav>/gs)][0]?.[1] ?? ''
  const order = ['Video', 'Format', 'Clips', 'Captions', 'Review'].map((label) => labels.indexOf(label))
  assert.ok(order.every((index, i) => index > -1 && (i === 0 || index > order[i - 1])))
  assert.match(html, /aria-current="step"[^>]*>.*?Video/s)
  assert.match(html, /Choose a video/)
  assert.equal(form.exports.useDraftStore.getState().workflow, null)
  const allRadios = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? []
  // The workflow choice (nothing picked yet), then whose video it is (third-person headlines by default).
  assert.equal(allRadios.length, 4)
  const radios = allRadios.slice(0, 2)
  assert.ok(radios.every((radio) => radio.includes('aria-checked="false"')))
  assert.match(html, /Whose video is this\?/)
  assert.ok(allRadios[2].includes('aria-checked="true"') && allRadios[3].includes('aria-checked="false"'), 'Someone else’s is the default')
  assert.equal(radios.filter((radio) => radio.includes('tabindex="0"')).length, 1)
  assert.match(html, /Beginner friendly/)
  assert.match(html, /For advanced users/)
})

test('a job requires an explicit workflow and each new video resets that choice', () => {
  const { useDraftStore, buildJobRequest } = form.exports
  const original = useDraftStore.getState()
  const trim = { start: null, end: null }
  try {
    original.update({ source: 'https://example.com/video', workflow: null })
    assert.throws(() => buildJobRequest(useDraftStore.getState(), trim), /Choose a workflow/)
    for (const workflow of ['automatic', 'review']) {
      original.update({ workflow })
      original.setStep('format')
      original.setStep('video')
      assert.equal(useDraftStore.getState().workflow, workflow)
      assert.equal(buildJobRequest(useDraftStore.getState(), trim).workflow, workflow)
      original.startAnother()
      assert.equal(useDraftStore.getState().workflow, null)
    }
  } finally { useDraftStore.setState(original) }
})

test('B-roll and a background video are sent only for Automatic jobs, never together', () => {
  const { useDraftStore, buildJobRequest } = form.exports
  const original = useDraftStore.getState()
  const trim = { start: null, end: null }
  try {
    const base = { source: 'https://example.com/video', workflow: 'automatic', aspectRatio: '9:16' }
    original.update({ ...base, broll: 'off', backgroundVideo: 'gameplay.mp4' })
    let request = buildJobRequest(useDraftStore.getState(), trim)
    assert.equal(request.backgroundVideo, 'gameplay.mp4')
    assert.equal(request.broll, undefined)
    original.update({ broll: 'after-hook' })
    request = buildJobRequest(useDraftStore.getState(), trim)
    assert.equal(request.broll, 'after-hook')
    assert.equal(request.backgroundVideo, undefined)
    original.update({ hookPreview: true })
    assert.equal(buildJobRequest(useDraftStore.getState(), trim).hookPreview, true)
    assert.equal(buildJobRequest(useDraftStore.getState(), trim).motionGraphics, undefined, 'motion graphics start Off')
    original.update({ motionGraphics: true })
    assert.equal(buildJobRequest(useDraftStore.getState(), trim).motionGraphics, true)
    original.update({ workflow: 'review' })
    request = buildJobRequest(useDraftStore.getState(), trim)
    assert.equal(request.broll, undefined)
    assert.equal(request.hookPreview, undefined)
    assert.equal(request.motionGraphics, undefined)
    assert.equal(request.backgroundVideo, undefined)
  } finally { useDraftStore.setState(original) }
})

test('Skills on Create (Automatic): one list over the draft’s own fields, with purpose and reference sent along', () => {
  const { CaptionsStep, useDraftStore, buildJobRequest, createBoardPatch, createReferencePatch } = form.exports
  const original = useDraftStore.getState()
  const trim = { start: null, end: null }
  try {
    original.update({ source: 'https://example.com/video', workflow: 'automatic', aspectRatio: '9:16' })
    const html = renderToStaticMarkup(React.createElement(CaptionsStep, { draft: useDraftStore.getState(), update() {} }))
    assert.match(html, /data-testid="skills-panel"/)
    for (const name of ['Rough cut', 'Captions', 'Motion graphics', 'Zoom', 'B-roll', 'Music', 'Voice cleanup']) assert.match(html, new RegExp(`aria-label="${name}"`))
    assert.equal((html.match(/>Beta</g) ?? []).length, 2)
    assert.match(html, /What’s this video for\?/)
    assert.match(html, /A look you like/)
    // Review & edit has no Skills list (its look is set in the editor), but can still say what it's for.
    const review = renderToStaticMarkup(React.createElement(CaptionsStep, { draft: { ...useDraftStore.getState(), workflow: 'review' }, update() {} }))
    assert.doesNotMatch(review, /data-testid="skills-panel"/)
    assert.match(review, /What’s this video for\?/)
    // The style board's captions switch and the Skills switch are the same field.
    original.update(createBoardPatch(useDraftStore.getState(), { captions: false }))
    assert.match(renderToStaticMarkup(React.createElement(CaptionsStep, { draft: useDraftStore.getState(), update() {} })), /aria-checked="false" aria-label="Captions"/)
    // Requests: audio skills for Automatic only, purpose and the picture's id for both.
    original.update({ music: true, musicTrack: 'lofi', voiceCleanup: true, purpose: '  Instagram reel  selling my call ', reference: { id: 'a'.repeat(24), name: 'look.png', path: '/x/look.png', width: 10, height: 10, bytes: 99 } })
    let request = buildJobRequest(useDraftStore.getState(), trim)
    assert.deepEqual([request.music, request.musicTrack, request.voiceCleanup, request.purpose, request.referenceImage], [true, 'lofi', true, 'Instagram reel selling my call', 'a'.repeat(24)])
    request = buildJobRequest({ ...useDraftStore.getState(), workflow: 'review' }, trim)
    assert.deepEqual([request.music, request.voiceCleanup, request.purpose], [undefined, undefined, 'Instagram reel selling my call'])
    // "Use colors from my reference": the color on the hook bar and the caption style.
    const patch = createReferencePatch(useDraftStore.getState(), { color: '#DC1E28', light: true, captionPreset: 'paper' })
    assert.equal(patch.captionPreset, 'paper')
    assert.equal(patch.headlineLook.color, '#DC1E28')
    assert.equal(patch.headlineLook.look, 'brand')
    // Clip another video: the purpose and picture belong to the last one.
    useDraftStore.getState().startAnother()
    assert.deepEqual([useDraftStore.getState().purpose, useDraftStore.getState().reference, useDraftStore.getState().music], ['', null, true])
  } finally { useDraftStore.setState(original) }
})

test('clipping mode is selectable and economy disables paid vision in the submitted request', () => {
  const { ClipsStep, buildJobRequest } = form.exports
  const draft = {
    workflow: 'automatic', source: 'https://example.com/video', clippingMode: 'economy', aspectRatio: '9:16', layoutStyle: 'auto',
    layoutVision: true, pacing: 'tight', durations: ['short'], autoClipCount: true, maxClips: 5,
    includeCaptions: true, captionPreset: 'pop'
  }
  const html = renderToStaticMarkup(React.createElement(ClipsStep, { draft, update() {} }))
  // Lower cost differs from the defaults, so the options start open, and the help describes the selected mode.
  assert.match(html, /aria-label="Clipping mode"/)
  assert.match(html, /Lower cost/)
  assert.match(html, /data-testid="clipping-mode-help"[^>]*>Uses lower-cost AI/)
  assert.doesNotMatch(html, /Uses the most accurate AI/)
  const quality = renderToStaticMarkup(React.createElement(ClipsStep, { draft: { ...draft, clippingMode: 'quality' }, update() {}, customize: true }))
  assert.match(quality, /data-testid="clipping-mode-help"[^>]*>Uses the most accurate AI/)
  assert.doesNotMatch(quality, /lower-cost AI/)
  // Model names only under Details.
  assert.doesNotMatch(quality.replace(/<details.*?<\/details>/s, ''), /GPT-6|GLM|Whisper|MAI Transcribe|Jev/)
  assert.match(quality, /<details[^>]*><summary[^>]*>Details<\/summary><p[^>]*>Planning: GPT-6 Sol/)
  const request = buildJobRequest(draft, { start: null, end: null })
  assert.equal(request.clippingMode, 'economy')
  assert.equal(Object.hasOwn(request, 'debugCapture'), false)
  assert.equal(request.layoutVision, false)
  assert.equal(buildJobRequest({ ...draft, clippingMode: 'quality' }, { start: null, end: null }).layoutVision, true)
})

test('the title card is shown by default and can be turned off for automatic runs', () => {
  const { CaptionsStep, useDraftStore, buildJobRequest } = form.exports
  const original = useDraftStore.getState()
  try {
    assert.equal(original.includeTitle, true)
    original.update({ workflow: 'automatic', source: 'https://example.com/video' })
    const automatic = renderToStaticMarkup(React.createElement(CaptionsStep, { draft: useDraftStore.getState(), update() {} }))
    // The style board's hook row: the headline looks, the title card, or no hook text (the old "title at the top" switch).
    assert.match(automatic, /aria-label="Hook text look"/)
    assert.match(automatic, /role="radio" aria-checked="true" aria-label="White bar"/)
    assert.match(automatic, /aria-label="No hook text"/)
    assert.equal(buildJobRequest(useDraftStore.getState(), { start: null, end: null }).includeTitle, true)
    // Choosing "No hook text" on the board turns the title off.
    const { createBoardPatch } = form.exports
    original.update(createBoardPatch(useDraftStore.getState(), { hook: 'none' }))
    assert.equal(buildJobRequest(useDraftStore.getState(), { start: null, end: null }).includeTitle, false)
    original.startAnother()
    assert.equal(useDraftStore.getState().includeTitle, false)
    // Review exports never draw a title card, so the switch is not offered there.
    const review = renderToStaticMarkup(React.createElement(CaptionsStep, { draft: { ...useDraftStore.getState(), workflow: 'review' }, update() {} }))
    assert.doesNotMatch(review, /Hook text look/)
    assert.match(review, /aria-label="Caption style"/)
  } finally { useDraftStore.setState(original) }
})

test('what to clip is optional, trimmed into the request and cleared for the next video', () => {
  const { ClipsStep, useDraftStore, buildJobRequest } = form.exports
  const original = useDraftStore.getState()
  try {
    assert.equal(original.clipRequest, '')
    original.update({ workflow: 'automatic', source: 'https://example.com/video' })
    const html = renderToStaticMarkup(React.createElement(ClipsStep, { draft: useDraftStore.getState(), update() {} }))
    assert.match(html, /aria-label="What to clip"/)
    assert.match(html, /maxLength="1000"/)
    assert.match(html, /aria-describedby="clip-request-help"/)
    assert.match(html, /id="clip-request-help"[^>]*>Only matching moments are clipped/)
    assert.equal(Object.hasOwn(buildJobRequest(useDraftStore.getState(), { start: null, end: null }), 'clipRequest'), false)
    original.update({ clipRequest: '   ' })
    assert.equal(Object.hasOwn(buildJobRequest(useDraftStore.getState(), { start: null, end: null }), 'clipRequest'), false)
    original.update({ clipRequest: '  every time they talk about pricing \n' })
    assert.equal(buildJobRequest(useDraftStore.getState(), { start: null, end: null }).clipRequest, 'every time they talk about pricing')
    original.startAnother()
    assert.equal(useDraftStore.getState().clipRequest, '')
  } finally { useDraftStore.setState(original) }
})

test('a running job shows what the user asked to clip', () => {
  const { JobProgress } = form.exports
  const job = {
    id: 'job', revision: 1, status: 'planning', percent: 40, step: 'Finding moments', clipsDone: 0, clipsTotal: 0,
    queuedAt: Date.now(), startedAt: Date.now(),
    request: { videoUrl: 'https://www.youtube.com/watch?v=abc123def45', workflow: 'automatic', clipRequest: ' every time they talk about pricing ' }
  }
  const html = renderToStaticMarkup(React.createElement(JobProgress, { job, onCancel() {} }))
  assert.match(html, /title="every time they talk about pricing"><span class="sr-only">What to clip: <\/span>every time they talk about pricing</)
  const plain = renderToStaticMarkup(React.createElement(JobProgress, { job: { ...job, request: { ...job.request, clipRequest: undefined } }, onCancel() {} }))
  assert.doesNotMatch(plain, /What to clip/)
})

test('format and framing radio groups each expose one keyboard tab stop', () => {
  const draft = { aspectRatio: '9:16', layoutStyle: 'auto', layoutVision: true, pacing: 'tight' }
  const html = renderToStaticMarkup(React.createElement(FormatStep, { draft, update() {}, customize: true }))
  for (const label of ['Format', 'Framing', 'Video speed']) {
    const group = html.match(new RegExp(`role="radiogroup" aria-label="${label}"[^>]*>(.*?)<\\/div>`, 's'))?.[1]
    assert.ok(group)
    assert.equal((group.match(/tabindex="0"/g) ?? []).length, 1)
  }
})

test('speed survives navigation and another job, and appears in the submitted request', () => {
  const { useDraftStore, buildJobRequest, ClipsStep } = form.exports
  const original = useDraftStore.getState()
  try {
    assert.equal(original.videoSpeed, 1)
    original.update({ workflow: 'automatic', source: 'https://example.com/video', videoSpeed: 1.5 })
    original.setStep('review')
    assert.equal(useDraftStore.getState().step, 'review')
    const lengths = renderToStaticMarkup(React.createElement(ClipsStep, { draft: useDraftStore.getState(), update() {}, customize: true }))
    assert.match(lengths, /60 seconds becomes about 40 seconds/)
    assert.equal(buildJobRequest(useDraftStore.getState(), { start: 10, end: 70 }).videoSpeed, 1.5)
    original.startAnother()
    assert.equal(useDraftStore.getState().videoSpeed, 1.5)
    assert.equal(useDraftStore.getState().step, 'video')
  } finally { useDraftStore.setState(original) }
})

test('saved run speed is retained while invalid speed metadata is discarded', () => {
  assert.equal(parseJobOutput({ clips: [], metrics: { requested_settings: { video_speed: 1.5 } } }).metrics.requested_settings.video_speed, 1.5)
  for (const video_speed of ['2', null, Infinity, 0, 3]) {
    assert.equal(parseJobOutput({ clips: [], metrics: { requested_settings: { video_speed } } }).metrics.requested_settings.video_speed, undefined)
  }
})

test('advanced selections travel with the job while presets ignore retained custom choices', () => {
  const { ClipsStep, buildJobRequest } = form.exports
  const draft = {
    workflow: 'automatic', source: 'https://example.com/video', clippingMode: 'advanced',
    plannerModel: 'provider/planning', transcriptionModel: 'provider/speech',
    aspectRatio: '9:16', layoutStyle: 'auto', layoutVision: true, pacing: 'tight',
    durations: ['short'], autoClipCount: true, maxClips: 5, includeCaptions: true, captionPreset: 'pop'
  }
  const html = renderToStaticMarkup(React.createElement(ClipsStep, { draft, update() {} }))
  // Advanced differs from the defaults: the options start open.
  assert.match(html, /Clip planning model/)
  assert.match(html, /Transcription model/)
  assert.equal((html.match(/role="combobox"/g) ?? []).length, 2)
  const request = buildJobRequest(draft, { start: null, end: null })
  assert.equal(request.plannerModel, 'provider/planning')
  assert.equal(request.transcriptionModel, 'provider/speech')
  assert.equal(request.layoutVision, true)
  for (const clippingMode of ['quality', 'economy']) {
    const preset = buildJobRequest({ ...draft, clippingMode }, { start: null, end: null })
    assert.equal(preset.plannerModel, undefined)
    assert.equal(preset.transcriptionModel, undefined)
  }
})

test('clip list explains when smart framing intentionally keeps the whole frame', () => {
  const clip = (index) => ({
    clip_index: index, s3_url: `/tmp/clip-${index}.mp4`, duration_ms: 5000,
    start_time_ms: index * 5000, end_time_ms: (index + 1) * 5000, virality_score: 0.5
  })
  const output = parseJobOutput({
    clips: [clip(0), clip(1)],
    metrics: { clip_layouts: [
      { clip_index: 0, framing_status: 'whole_frame_auto' },
      { clip_index: 0, framing_status: 'whole_frame_auto' },
      { clip_index: 9, framing_status: 'whole_frame_auto' }
    ] }
  })
  assert.ok(output)
  assert.match(framingProblem(output, true), /whole frame for clip 1/)
  assert.equal(framingProblem(output, false), null)
  const classic = parseJobOutput({ clips: [clip(0)], metrics: {
    smart_framing_available: false, requested_settings: { aspect_ratio: '9:16', layout_style: 'fit' }
  } })
  assert.ok(classic)
  assert.equal(framingProblem(classic, true), null)
})

test('visual-only runs disclose unavailable captions and preserve analysis status', () => {
  const output = parseJobOutput({ clips: [], metrics: {
    transcription_status: 'no_speech', planning_source: 'visual', visual_frame_count: 12,
    captions_status: 'unavailable_without_transcript'
  } })
  assert.ok(output)
  assert.equal(output.metrics.visual_frame_count, 12)
  assert.equal(output.metrics.captions_status, 'unavailable_without_transcript')
  assert.match(sourceAnalysisNotice(output), /No speech was detected/)
  // More clips that had to transcribe again says so; one that reused the transcript says nothing.
  const more = (reused) => parseJobOutput({ clips: [], metrics: { transcription_status: 'available', planning_source: 'transcript', transcript_reused: reused, requested_settings: { more_clips: true } } })
  assert.match(sourceAnalysisNotice(more(false)), /transcribed again/)
  assert.equal(sourceAnalysisNotice(more(true)), null)
})

test('Twitch VOD links canonicalize while other Twitch pages are rejected', () => {
  const { normalizeVideoSource, twitchVodId, SourcePicker } = form.exports
  for (const host of ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv']) {
    const source = `https://${host}/videos/12345/?t=1h&tracking=secret`
    assert.equal(isValidSourceLink(source), true)
    assert.equal(normalizeVideoSource(source), 'https://www.twitch.tv/videos/12345')
    assert.equal(twitchVodId(source), '12345')
  }
  for (const source of ['https://twitch.tv/channel', 'https://clips.twitch.tv/Clip', 'https://player.twitch.tv/?video=123', 'https://twitch.tv/videos/nope', 'https://twitch.tv:8443/videos/123']) assert.equal(isValidSourceLink(source), false)
  assert.equal(twitchVodId('https://twitch.tv.evil.test/videos/123'), null)
  const html = renderToStaticMarkup(React.createElement(SourcePicker, { value: 'https://www.twitch.tv/videos/12345', onChange() {} }))
  assert.match(html, /Twitch VOD/)
  assert.match(html, /Public, completed videos only/)
  assert.doesNotMatch(html, /<img/)
})


test('Review & edit shows the quality check as required even when automatic review is off', () => {
  const { ClipsStep, useDraftStore, useSettingsStore } = form.exports
  const original = useSettingsStore.getState()
  const initialState = useSettingsStore.getInitialState()
  const initialJev = initialState.jevEnabled
  try {
    useSettingsStore.setState({ jevEnabled: 'off' })
    initialState.jevEnabled = 'off'
    const draft = useDraftStore.getState()
    const review = renderToStaticMarkup(React.createElement(ClipsStep, { draft: { ...draft, workflow: 'review' }, update() {}, customize: true }))
    const automatic = renderToStaticMarkup(React.createElement(ClipsStep, { draft: { ...draft, workflow: 'automatic' }, update() {}, customize: true }))
    assert.match(review, /A quality check reviews every candidate before you edit/)
    assert.match(review, /Quality check: Jev \(required\)/)
    assert.doesNotMatch(review, /Jev \(off\)/)
    assert.match(automatic, /The quality check for automatic clips is off/)
    assert.match(automatic, /Quality check: Jev \(off\)/)
    assert.equal(useSettingsStore.getState().jevEnabled, 'off')
  } finally { initialState.jevEnabled = initialJev; useSettingsStore.setState(original) }
})


test('several videos become one request each with the same settings; a preferred range is for one video only', () => {
  const { useDraftStore, buildJobRequests, draftSources, SourcePicker } = form.exports
  const original = useDraftStore.getState()
  try {
    const sources = ['https://example.com/a.mp4', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', '/videos/talk.mp4']
    original.update({ workflow: 'automatic', source: sources[0], sources, captionLanguage: 'es', trimOpen: true, trimStart: '10', trimEnd: '20' })
    const draft = useDraftStore.getState()
    assert.deepEqual(draftSources(draft), sources)
    const requests = buildJobRequests(draft, { start: 10, end: 20 })
    assert.deepEqual(requests.map((r) => r.videoUrl), sources)
    assert.ok(requests.every((r) => r.captionLanguage === 'es' && r.startTimeSeconds === null && r.endTimeSeconds === null))
    // A stale list that no longer starts with the chosen video is ignored.
    assert.deepEqual(draftSources({ source: 'https://example.com/b.mp4', sources }), ['https://example.com/b.mp4'])
    const single = buildJobRequests({ ...draft, sources: [] }, { start: 10, end: 20 })
    assert.equal(single.length, 1)
    assert.equal(single[0].startTimeSeconds, 10)
    const html = renderToStaticMarkup(React.createElement(SourcePicker, { value: sources[0], sources, onChange() {}, onSourcesChange() {} }))
    assert.match(html, /3 videos will be clipped/)
    assert.match(html, /Remove talk\.mp4/)
  } finally { useDraftStore.setState(original) }
})

test('caption language: original sends nothing; the form says the speech stays as recorded', () => {
  const { CaptionsStep, buildJobRequest } = form.exports
  const draft = { workflow: 'automatic', source: 'https://example.com/v', clippingMode: 'quality', aspectRatio: '9:16', layoutStyle: 'auto', layoutVision: true,
    pacing: 'tight', durations: [], autoClipCount: true, maxClips: 5, includeCaptions: true, captionPreset: 'pop', includeTitle: true, captionLanguage: 'original' }
  assert.equal('captionLanguage' in buildJobRequest(draft, { start: null, end: null }), false)
  assert.equal(buildJobRequest({ ...draft, captionLanguage: 'ja' }, { start: null, end: null }).captionLanguage, 'ja')
  // Review & edit exports are not translated.
  assert.equal(buildJobRequest({ ...draft, workflow: 'review', captionLanguage: 'ja' }, { start: null, end: null }).captionLanguage, undefined)
  const html = renderToStaticMarkup(React.createElement(CaptionsStep, { draft: { ...draft, captionLanguage: 'ja' }, update() {} }))
  assert.match(html, /Caption language/)
  assert.match(html, /The speech stays in its original language: only the captions are translated/)
})

test('more clips explains what it reuses and when it can’t run', () => {
  const { reuseSummary, moreClipsBlocked } = form.exports
  const lines = reuseSummary({ source: 'download', transcriptSaved: true, excludedCount: 4 })
  assert.match(lines.join(' '), /saved transcript when it still matches this video/)
  assert.match(reuseSummary({ source: 'original', transcriptSaved: true, excludedCount: 0, note: 'The brand the earlier run used was deleted, so these clips use no brand.' }).join(' '), /use no brand/)
  assert.match(lines.join(' '), /downloaded again/)
  assert.match(lines.join(' '), /Skips the 4 moments already clipped/)
  assert.match(reuseSummary({ source: 'kept', transcriptSaved: true, excludedCount: 1 }).join(' '), /copy of the video kept with this run.*1 moment already/)
  assert.equal(moreClipsBlocked({ source: 'original', transcriptSaved: true }), null)
  assert.match(moreClipsBlocked({ source: 'missing', transcriptSaved: true }), /no longer on this computer/)
  assert.match(moreClipsBlocked({ source: 'download', transcriptSaved: false }), /no saved transcript/)
})

test('screen share clips: a choice under Smart framing, sent only when it is not the smart mix, and shown on Review', () => {
  const { buildJobRequest, useDraftStore, SCREEN_FOCUS_OPTIONS } = form.exports
  const draft = { workflow: 'automatic', source: 'https://example.com/v', clippingMode: 'quality', aspectRatio: '9:16', layoutStyle: 'auto', layoutVision: true,
    pacing: 'tight', durations: [], autoClipCount: true, maxClips: 5, includeCaptions: true, captionPreset: 'pop', includeTitle: true, screenFocus: 'smart' }
  const html = renderToStaticMarkup(React.createElement(FormatStep, { draft, update() {}, customize: true }))
  const group = html.match(/role="radiogroup" aria-label="Screen share clips"[^>]*>(.*?)<\/div>/s)?.[1]
  assert.ok(group, 'the choice is shown under Smart framing')
  assert.deepEqual([...group.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '')), ['Smart mix', 'Split screen', 'Presenter only'])
  assert.match(group, /aria-checked="true"[^>]*>(<[^>]+>)*Smart mix/)
  assert.match(html, /Each clip shows just you, or your screen above you/)
  assert.match(html, /Other videos aren’t affected/)
  for (const layoutStyle of ['fill', 'fit']) {
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(FormatStep, { draft: { ...draft, layoutStyle }, update() {}, customize: true })), /Screen share clips/)
  }
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(FormatStep, { draft: { ...draft, aspectRatio: '16:9' }, update() {}, customize: true })), /Screen share clips/)
  const trim = { start: null, end: null }
  assert.equal('screenFocus' in buildJobRequest(draft, trim), false)
  assert.equal(buildJobRequest({ ...draft, screenFocus: 'presenter' }, trim).screenFocus, 'presenter')
  assert.equal(buildJobRequest({ ...draft, workflow: 'review', screenFocus: 'split' }, trim).screenFocus, 'split')
  assert.equal('screenFocus' in buildJobRequest({ ...draft, layoutStyle: 'fill', screenFocus: 'presenter' }, trim), false)
  assert.equal(useDraftStore.getState().screenFocus, 'smart')
  assert.deepEqual(SCREEN_FOCUS_OPTIONS.map((option) => option.id), ['smart', 'split', 'presenter'])
  const { ReviewStep } = form.exports
  const review = (extra) => renderToStaticMarkup(React.createElement(ReviewStep, { draft: { ...draft, sources: [], headlineVoice: 'clipper', qualityBar: 'b', ...extra }, trim, onEdit() {} }))
  assert.match(review({ screenFocus: 'presenter' }), /Screen share.*?Just you in every clip/s)
  assert.match(review({}), /Screen share.*?Smart mix · just you or split, clip by clip/s)
  assert.doesNotMatch(review({ layoutStyle: 'fit', screenFocus: 'presenter' }), /Screen share/)
})

test('the Library labels how each screen share clip was framed', () => {
  const { screenFocusLabel, screenFocusByIndex } = form.exports
  assert.equal(screenFocusLabel(null), null)
  const presenter = screenFocusLabel({ decision: 'presenter', reason: 'A story about quitting ads', source: 'planner', mode: 'smart', person_fits: true })
  assert.deepEqual(presenter, { label: 'Presenter only', title: 'How this screen share clip was framed. Why: A story about quitting ads' })
  assert.equal(screenFocusLabel({ decision: 'mixed', reason: '', source: 'speech', mode: 'smart', person_fits: true }).label, 'Presenter + screen')
  assert.match(screenFocusLabel({ decision: 'screen', reason: 'x', source: 'mode', mode: 'split', person_fits: true }).title, /You chose this style/)
  const small = screenFocusLabel({ decision: 'presenter', reason: '', source: 'mode', mode: 'presenter', person_fits: false })
  assert.equal(small.label, 'Split screen')
  assert.match(small.title, /webcam was too small/)
  const output = parseJobOutput({ job_id: 'j', source_video_url: 'u', source_video_title: 't', source_video_duration_seconds: 60, total_clips: 0, clips: [],
    metrics: { clip_layouts: [{ clip_index: 1, screen_focus: { decision: 'screen', reason: 'A walkthrough', source: 'planner', mode: 'smart' } }, { clip_index: 2 }] } })
  const map = screenFocusByIndex(output)
  assert.deepEqual([...map.keys()], [1])
  assert.equal(map.get(1).decision, 'screen')
})

test('Format and Clips open on a recommended summary; changed options start open and are named', () => {
  const { FormatStep, ClipsStep, useDraftStore, formatSummary, clipsSummary } = form.exports
  const defaults = { ...useDraftStore.getInitialState(), workflow: 'automatic', source: 'https://example.com/v' }
  const format = renderToStaticMarkup(React.createElement(FormatStep, { draft: defaults, update() {} }))
  assert.match(format, /data-testid="format-summary".*?Recommended.*?AI checks tricky shots, dead air cut, normal speed, no B-roll\./s)
  assert.match(format, /aria-expanded="false"[^>]*>Customize/)
  assert.match(format, /aria-label="Format"/)
  assert.match(format, /aria-label="Framing"/)
  for (const hidden of ['Video speed', 'Screen share clips', 'B-roll', 'Cut dead air']) assert.doesNotMatch(format, new RegExp(`aria-label="${hidden}`))
  const clips = renderToStaticMarkup(React.createElement(ClipsStep, { draft: defaults, update() {} }))
  assert.match(clips, /aria-label="What to clip"/)
  assert.match(clips, /Recommended.*?Best quality, 30–60s clips, B grade or better, AI decides how many\./s)
  assert.doesNotMatch(clips, /aria-label="Clipping mode"/)
  assert.doesNotMatch(clips, /aria-label="Quality bar"/)
  // Changed from the defaults: the options start open and the summary names the change.
  const fast = renderToStaticMarkup(React.createElement(FormatStep, { draft: { ...defaults, videoSpeed: 1.5, pacing: 'natural' }, update() {} }))
  assert.match(fast, /Your settings/)
  assert.match(fast, /data-testid="format-changed"[^>]*>Changed from recommended: (<!-- -->)?pauses kept, 1.5× speed/)
  assert.match(fast, /aria-expanded="true"[^>]*>Hide options/)
  assert.match(fast, /aria-label="Video speed"/)
  // The member's own choice wins either way.
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(FormatStep, { draft: { ...defaults, videoSpeed: 1.5 }, update() {}, customize: false })), /aria-label="Video speed"/)
  assert.ok(formatSummary(defaults).every((part) => !part.changed))
  assert.ok(clipsSummary(defaults).every((part) => !part.changed))
  assert.deepEqual(clipsSummary({ ...defaults, clippingMode: 'economy', durations: [], autoClipCount: false, maxClips: 3 }).filter((p) => p.changed).map((p) => p.text), ['Lower cost', 'any length', 'up to 3 clips'])
  assert.deepEqual(formatSummary({ ...defaults, broll: 'full' }).filter((p) => p.changed).map((p) => p.text), ['B-roll: pexels footage for the whole clip'])
  assert.deepEqual(formatSummary({ ...defaults, backgroundVideo: 'gameplay.mp4' }).filter((p) => p.changed).map((p) => p.text), ['gameplay.mp4 under the speaker'])
})

test('a valid link left in the video field counts: Next is enabled and uses it', () => {
  const { JobForm, useDraftStore } = form.exports
  const original = useDraftStore.getState()
  // Server rendering reads the store's initial state.
  const initial = useDraftStore.getInitialState()
  const kept = { workflow: initial.workflow, pendingLink: initial.pendingLink }
  try {
    Object.assign(initial, { workflow: 'automatic', pendingLink: 'not a link' })
    const blocked = renderToStaticMarkup(React.createElement(JobForm, { onSubmit() {} }))
    assert.match(blocked, /<button[^>]*disabled=""[^>]*>Next: Format/)
    initial.pendingLink = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const ready = renderToStaticMarkup(React.createElement(JobForm, { onSubmit() {} }))
    assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*>Next: Format/)
    assert.match(ready, /Next: Format/)
    // Format and the later steps can be reached too.
    assert.doesNotMatch(ready, /<button type="button" disabled=""[^>]*>.*?Format<\/span>/)
    useDraftStore.setState({ pendingLink: 'https://example.com/v.mp4' })
    useDraftStore.getState().startAnother()
    assert.equal(useDraftStore.getState().pendingLink, '')
  } finally { Object.assign(initial, kept); useDraftStore.setState(original) }
})

test('the Video step explains whose video in one line and points to Remix for reactions', () => {
  const { JobForm, useDraftStore } = form.exports
  const original = useDraftStore.getState()
  try {
    const html = renderToStaticMarkup(React.createElement(JobForm, { onSubmit() {}, onOpenRemix() {} }))
    assert.match(html, /id="headline-voice-help"[^>]*>Headlines talk about the speaker when it’s someone else’s video, or speak in your voice when it’s yours\./)
    assert.match(html, /data-testid="remix-note".*?Use Remix/s)
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(JobForm, { onSubmit() {} })), /remix-note/)
  } finally { useDraftStore.setState(original) }
})

test('the setup card leaves the key to the checklist when asked', () => {
  const { SetupCard, useSettingsStore } = form.exports
  useSettingsStore.setState({ openrouterConfigured: false })
  assert.equal(renderToStaticMarkup(React.createElement(SetupCard, { onOpenSettings() {}, askForKey: false })), '')
  assert.match(renderToStaticMarkup(React.createElement(SetupCard, { onOpenSettings() {} })), /OpenRouter key/)
})
