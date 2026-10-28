'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')

const plain = (value) => JSON.parse(JSON.stringify(value))

function writeRun(library, name, { title = name, clips = [], createdAt } = {}) {
  const run = path.join(library, name)
  fs.mkdirSync(run, { recursive: true })
  const list = clips.map((clip, index) => {
    const file = path.join(run, `clip_${index}.mp4`)
    fs.writeFileSync(file, `${name}-${index}`)
    return { clip_index: index, s3_url: `file://${file}`, summary: `Clip ${index}`, duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, virality_score: 0.5, ...clip }
  })
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ source_video_title: title, clips: list, ...(createdAt ? { created_at: createdAt } : {}) }))
  return { run, files: list.map((clip) => clip.s3_url.slice(7)) }
}

function fixture() {
  const temp = tempDir('bridgeclip-ready-')
  const library = path.join(temp.dir, 'library')
  fs.mkdirSync(library, { recursive: true })
  const posts = []
  const { electron } = fakeElectron(temp.dir)
  const main = loadMain("export * from './src/main/ready-to-post'; export * as settings from './src/main/settings-store'; export { setLibraryPosted } from './src/main/library-management'", {
    electron,
    './zernio/posts': { listPosts: () => posts },
    './automations': { listAutomations: () => [], automationMediaMatcher: () => () => false }
  })
  main.settings.savePublicSettings({ outputDirectory: library, pythonPath: 'python3' })
  main.settings.replaceApiKey('zernioApiKey', 'test-key')
  return { ...temp, main, library, posts }
}

test('Ready to post lists unposted clips from every kind of run, leaving out published and manually marked ones', async () => {
  const f = fixture()
  try {
    const create = writeRun(f.library, '11111111-1111-4111-8111-111111111111', { title: 'Podcast episode', createdAt: '2026-10-01T00:00:00.000Z',
      clips: [{ summary: 'Posted one' }, { summary: 'Scheduled one' }, { summary: 'Marked one' }, { summary: 'Fresh one', headline: 'Big hook', post_caption: 'Caption words' }] })
    writeRun(f.library, 'remix-22222222-2222-4222-8222-222222222222', { title: 'A remix', createdAt: '2026-10-02T00:00:00.000Z', clips: [{ summary: 'Remix take' }] })
    writeRun(f.library, 'avatar-33333333-3333-4333-8333-333333333333', { title: 'Avatar Studio · Tips', createdAt: '2026-10-03T00:00:00.000Z', clips: [{ summary: 'Avatar video', ai_generated: true }] })
    writeRun(f.library, '.deleting-old', { clips: [{}] })
    fs.mkdirSync(path.join(f.library, 'empty-folder'))
    f.posts.push({ id: 'p1', clipPath: create.files[0], status: 'published', targets: [{ platform: 'youtube', status: 'published' }] })
    f.posts.push({ id: 'p2', clipPath: create.files[1], status: 'scheduled', targets: [{ platform: 'youtube', status: 'pending' }] })
    assert.equal(await f.main.setLibraryPosted(create.run, 2, true), true)

    const result = await f.main.readyToPost()
    assert.equal(result.runs, 3)
    assert.equal(result.postingHistory, true)
    assert.equal(result.unreadableRuns, 0)
    const byTitle = Object.fromEntries(result.clips.map((clip) => [clip.title, clip]))
    assert.deepEqual(Object.keys(byTitle).sort(), ['Avatar video', 'Fresh one', 'Remix take', 'Scheduled one'])
    assert.equal(byTitle['Scheduled one'].state, 'scheduled', 'scheduled clips stay ready to post, like a run’s Not Posted group')
    assert.deepEqual(plain(byTitle['Fresh one']), {
      outputDir: create.run, runTitle: 'Podcast episode', kind: 'create', runDate: '2026-10-01T00:00:00.000Z', clipIndex: 3, title: 'Fresh one',
      headline: 'Big hook', postCaption: 'Caption words', grade: null, gradeScore: null, viralityScore: 0.5, durationMs: 1000,
      s3Url: `file://${create.files[3]}`, tags: [], aiGenerated: false, state: 'not_posted'
    })
    assert.equal(byTitle['Remix take'].kind, 'remix')
    assert.equal(byTitle['Avatar video'].kind, 'avatar')
    assert.equal(byTitle['Avatar video'].aiGenerated, true)

    // Unmarking brings it back; with no Zernio key only manual marks count.
    await f.main.setLibraryPosted(create.run, 2, false)
    f.main.settings.replaceApiKey('zernioApiKey', '')
    const offline = await f.main.readyToPost()
    assert.equal(offline.postingHistory, false)
    assert.equal(offline.clips.length, 6)
    await f.main.setLibraryPosted(create.run, 0, true)
    assert.equal((await f.main.readyToPost()).clips.some((clip) => clip.title === 'Posted one'), false)
  } finally { f.cleanup() }
})

test('the index reads each job_output.json once and again only when it changes', async () => {
  const f = fixture()
  try {
    const runs = Array.from({ length: 5 }, (_, index) => writeRun(f.library, `0000000${index}-1111-4111-8111-111111111111`, { clips: [{ summary: `Run ${index}` }] }))
    await f.main.readyToPost()
    assert.equal(f.main.readyIndexReads(), 5)
    await f.main.readyToPost()
    assert.equal(f.main.readyIndexReads(), 5, 'unchanged runs come from the cache')
    const file = path.join(runs[2].run, 'job_output.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    data.clips[0].summary = 'Renamed clip'
    fs.writeFileSync(file, JSON.stringify(data))
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(file, later, later)
    const result = await f.main.readyToPost()
    assert.equal(f.main.readyIndexReads(), 6, 'only the changed run is read again')
    assert.ok(result.clips.some((clip) => clip.title === 'Renamed clip'))
    fs.rmSync(runs[0].run, { recursive: true })
    assert.equal((await f.main.readyToPost()).runs, 4)
    assert.equal(f.main.readyIndexReads(), 6)
  } finally { f.cleanup() }
})

test('filters: grade at least, kind, newest or best first, and search over titles, hooks and captions', () => {
  const { filterReadyClips, meetsGrade, runKindOf, DEFAULT_READY_FILTERS } = loadMain("export * from './src/shared/ready-to-post'")
  const clip = (over) => ({ outputDir: '/l/r', runTitle: 'Run', kind: 'create', runDate: '2026-10-01T00:00:00.000Z', clipIndex: 0, title: 'Clip', headline: null, postCaption: null,
    grade: null, gradeScore: null, viralityScore: 0.5, durationMs: 1000, s3Url: '/x.mp4', tags: [], aiGenerated: false, state: 'not_posted', ...over })
  const clips = [
    clip({ title: 'A clip', grade: 'A', gradeScore: 9, runDate: '2026-10-01T00:00:00.000Z', clipIndex: 0 }),
    clip({ title: 'B clip', grade: 'B', gradeScore: 7, runDate: '2026-10-03T00:00:00.000Z', kind: 'remix', outputDir: '/l/remix', headline: 'Secret hook' }),
    clip({ title: 'C clip', grade: 'C', gradeScore: 5, runDate: '2026-10-02T00:00:00.000Z', kind: 'avatar', outputDir: '/l/avatar', postCaption: 'Follow for part two' }),
    clip({ title: 'Ungraded', viralityScore: 0.95, runDate: '2026-10-04T00:00:00.000Z', outputDir: '/l/new', tags: ['money'] })
  ]
  const titles = (filters) => filterReadyClips(clips, { ...DEFAULT_READY_FILTERS, ...filters }).map((item) => item.title)
  assert.deepEqual(titles({}), ['Ungraded', 'B clip', 'C clip', 'A clip'], 'newest run first')
  assert.deepEqual(titles({ sort: 'best' }), ['Ungraded', 'A clip', 'B clip', 'C clip'], 'best first uses the grade score, else virality on the same scale')
  assert.deepEqual(titles({ minGrade: 'A' }), ['A clip'])
  assert.deepEqual(titles({ minGrade: 'B', sort: 'best' }), ['A clip', 'B clip'], 'ungraded clips leave while a grade filter is on')
  assert.deepEqual(titles({ minGrade: 'C' }), ['B clip', 'C clip', 'A clip'])
  assert.deepEqual(titles({ kind: 'remix' }), ['B clip'])
  assert.deepEqual(titles({ kind: 'avatar' }), ['C clip'])
  assert.deepEqual(titles({ query: 'secret' }), ['B clip'], 'headline')
  assert.deepEqual(titles({ query: 'PART two' }), ['C clip'], 'post caption, any case, every word')
  assert.deepEqual(titles({ query: 'money' }), ['Ungraded'], 'tags')
  assert.deepEqual(titles({ query: 'run clip' }), ['B clip', 'C clip', 'A clip'], 'run title and clip title together')
  assert.deepEqual(titles({ query: 'nothing here' }), [])
  assert.equal(meetsGrade('D', 'C'), false)
  assert.equal(meetsGrade(null, 'any'), true)
  assert.equal(runKindOf('remix-abc'), 'remix')
  assert.equal(runKindOf('avatar-abc'), 'avatar')
  assert.equal(runKindOf('legacy', 'Avatar Studio · Old'), 'avatar')
  assert.equal(runKindOf('11111111-1111-4111-8111-111111111111', 'Podcast'), 'create')
})

test('setup checklist items tick off from state, and optional items never block', () => {
  const { setupItems, remainingSetup, setAvatarStudioForTests } = loadMain("export * from './src/shared/setup-checklist'; export { setAvatarStudioForTests } from './src/shared/features'")
  const none = { openrouter: false, toolsOk: null, zernioKey: false, postingAccounts: 0, brandIdentities: 0, ctas: 0, avatars: 0, runs: 0 }
  // Avatar Studio switched off (shared/features): no "Make an avatar" step.
  assert.deepEqual(setupItems(none).map((item) => item.id), ['openrouter', 'tools', 'posting', 'brand', 'cta', 'first-clip'])
  setAvatarStudioForTests(true)
  const items = setupItems(none)
  assert.deepEqual(items.map((item) => item.id), ['openrouter', 'tools', 'posting', 'brand', 'cta', 'avatar', 'first-clip'])
  assert.ok(items.every((item) => !item.done))
  assert.equal(remainingSetup(items), 6)
  assert.equal(setupItems({ ...none, postingAccounts: 2 }).find((item) => item.id === 'posting').done, false, 'accounts need the Zernio key')
  assert.match(setupItems({ ...none, zernioKey: true }).find((item) => item.id === 'posting').detail, /connect an account/i)
  const all = setupItems({ openrouter: true, toolsOk: true, zernioKey: true, postingAccounts: 1, brandIdentities: 1, ctas: 1, avatars: 0, runs: 1 })
  assert.equal(remainingSetup(all), 0, 'the avatar is optional')
  assert.equal(all.find((item) => item.id === 'avatar').done, false)
  assert.equal(setupItems({ ...none, toolsOk: false }).find((item) => item.id === 'tools').done, false)
})

test('member prefs keep the checklist dismissal and an optional sample video link, validated', () => {
  const shared = loadMain("export * from './src/shared/member-prefs'")
  assert.equal(shared.DEFAULT_MEMBER_PREFS.setupChecklistDismissed, false)
  assert.equal(shared.DEFAULT_MEMBER_PREFS.sampleVideoLink, '', 'no sample video is configured by default')
  assert.equal(shared.parseMemberPrefs({ setupChecklistDismissed: 'yes', sampleVideoLink: 'javascript:alert(1)' }).setupChecklistDismissed, false)
  assert.equal(shared.parseMemberPrefs({ sampleVideoLink: 'javascript:alert(1)' }).sampleVideoLink, '')
  assert.equal(shared.parseMemberPrefs({ setupChecklistDismissed: true, sampleVideoLink: ' https://example.com/watch?v=1 ' }).sampleVideoLink, 'https://example.com/watch?v=1')
  assert.equal(shared.parseSampleVideoLink(''), '')
  assert.throws(() => shared.parseSampleVideoLink('https://user:pw@example.com/v'), /https/)
  assert.throws(() => shared.parseSampleVideoLink('file:///etc/passwd'), /https/)
  const temp = tempDir('bridgeclip-prefs-setup-')
  try {
    const { electron } = fakeElectron(temp.dir)
    const main = loadMain("export * from './src/main/member-prefs'", { electron })
    let prefs = main.saveAppPrefs({ setupChecklistDismissed: true, sampleVideoLink: 'https://example.com/video' })
    assert.equal(prefs.setupChecklistDismissed, true)
    assert.equal(prefs.sampleVideoLink, 'https://example.com/video')
    assert.throws(() => main.saveAppPrefs({ setupChecklistDismissed: 'no' }), /checklist/)
    assert.throws(() => main.saveAppPrefs({ sampleVideoLink: 'ftp://example.com/v' }), /https/)
    prefs = main.saveAppPrefs({ sampleVideoLink: '' })
    assert.equal(prefs.sampleVideoLink, '')
    assert.equal(prefs.setupChecklistDismissed, true)
  } finally { temp.cleanup() }
})
