'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')

const plain = (value) => JSON.parse(JSON.stringify(value))
const NO_RUNS = { clips: 0, aiReactions: 0, cameraReactions: 0, articles: 0, avatarVideos: 0 }
const facts = (extra = {}) => ({
  openrouter: false, toolsOk: true, camera: null, zernioKey: false, postingAccounts: 0, connectedPlatforms: [],
  brandIdentities: 0, ctas: 0, avatars: 0, runs: 0, runsByKind: NO_RUNS, ...extra
})

test('profile: stored values are read leniently, updates strictly, and a new profile opens the guided setup', () => {
  const shared = loadMain("export * from './src/shared/onboarding'")
  assert.deepEqual(plain(shared.readProfile(null)), { goals: [], platforms: [], onboarding: 'new' })
  assert.deepEqual(plain(shared.readProfile({ goals: ['posting', 'nope', 'clips', 'clips'], platforms: ['youtube', 'myspace', 'tiktok'], onboarding: 'weird' })),
    { goals: ['clips', 'posting'], platforms: ['tiktok', 'youtube'], onboarding: 'new' }, 'unknown values dropped, app order kept, unknown state is new')
  const current = shared.readProfile({ goals: ['clips'], onboarding: 'done' })
  assert.deepEqual(plain(shared.parseProfileUpdate({ platforms: ['instagram'] }, current)), { goals: ['clips'], platforms: ['instagram'], onboarding: 'done' })
  assert.throws(() => shared.parseProfileUpdate({ goals: ['clips', 'nope'] }, current), /Choose what you want to make/)
  assert.throws(() => shared.parseProfileUpdate({ platforms: 'tiktok' }, current), /Choose where you post/)
  assert.throws(() => shared.parseProfileUpdate({ onboarding: 'later' }, current), /setup state/)
  assert.throws(() => shared.parseProfileUpdate(null, current), /Invalid profile/)
  // Every goal has a guide with steps; every video goal is on a page that makes it.
  for (const goal of shared.GOALS) {
    assert.ok(shared.GUIDES[goal.id].steps.length >= 3, goal.id)
    assert.ok(!/\d+%|\$\d/.test(JSON.stringify(shared.GUIDES[goal.id])), `${goal.id}: the guide states no made-up numbers`)
  }
})

test('member prefs keep the profile and saveProfile validates it', () => {
  const temp = tempDir('bridgeclip-prefs-profile-')
  try {
    const { electron } = fakeElectron(temp.dir)
    const main = loadMain("export * from './src/main/member-prefs'", { electron })
    assert.equal(main.readMemberPrefs().profile.onboarding, 'new')
    let prefs = main.saveProfile({ goals: ['camera-reactions', 'clips'], platforms: ['tiktok'] })
    assert.deepEqual(plain(prefs.profile), { goals: ['clips', 'camera-reactions'], platforms: ['tiktok'], onboarding: 'new' })
    prefs = main.saveProfile({ onboarding: 'done' })
    assert.deepEqual(plain(prefs.profile.goals), ['clips', 'camera-reactions'], 'a partial update keeps the rest')
    assert.throws(() => main.saveProfile({ goals: ['everything'] }))
    const saved = JSON.parse(fs.readFileSync(path.join(temp.dir, 'userData', 'member-prefs.json'), 'utf8'))
    assert.equal(saved.profile.onboarding, 'done')
  } finally { temp.cleanup() }
})

test('setup path: only the steps the goals need, a first-run step per kind of video, platforms to connect', () => {
  const { setupItems, remainingSetup, firstRunGoal } = loadMain("export * from './src/shared/setup-checklist'")
  const ids = (profile, extra) => setupItems(facts(extra), profile).map((item) => item.id)

  assert.deepEqual(ids({ goals: ['clips'], platforms: [] }), ['openrouter', 'tools', 'brand', 'cta', 'first-clip'], 'clips only: no camera, avatar or posting')
  assert.deepEqual(ids({ goals: ['camera-reactions', 'article'], platforms: [] }),
    ['openrouter', 'tools', 'camera', 'brand', 'cta', 'first-camera-reaction', 'first-article'])
  assert.deepEqual(ids({ goals: ['ai-reactions', 'avatar-videos', 'posting'], platforms: ['tiktok'] }),
    ['openrouter', 'tools', 'posting', 'brand', 'cta', 'avatar', 'first-ai-reaction', 'first-avatar-video'])

  const path = setupItems(facts(), { goals: ['ai-reactions'], platforms: [] })
  assert.equal(path.find((item) => item.id === 'avatar').optional, false, 'an AI reaction needs an avatar')
  assert.equal(firstRunGoal('first-ai-reaction'), 'ai-reactions')
  assert.equal(firstRunGoal('brand'), null)
  for (const item of path.filter((step) => !step.goal)) assert.ok(item.why && item.how?.length, `${item.id} explains why and how`)

  // Posting: every chosen platform must be connected.
  const posting = (extra) => setupItems(facts({ zernioKey: true, ...extra }), { goals: ['posting'], platforms: ['tiktok', 'instagram'] }).find((item) => item.id === 'posting')
  assert.equal(posting({}).title, 'Connect TikTok and Instagram')
  assert.equal(posting({ postingAccounts: 1, connectedPlatforms: ['tiktok'] }).done, false)
  assert.match(posting({ postingAccounts: 1, connectedPlatforms: ['tiktok'] }).detail, /Still to connect: Instagram/)
  assert.equal(posting({ postingAccounts: 2, connectedPlatforms: ['instagram', 'tiktok'] }).done, true)

  // First runs tick off from runs of their own kind only.
  const first = (runsByKind) => setupItems(facts({ runs: 1, runsByKind: { ...NO_RUNS, ...runsByKind } }), { goals: ['clips', 'article'], platforms: [] })
  assert.deepEqual(first({ clips: 1 }).filter((item) => item.goal).map((item) => item.done), [true, false])
  assert.deepEqual(first({ articles: 2 }).filter((item) => item.goal).map((item) => item.done), [false, true])
  // Camera: unknown and refused aren't done.
  assert.equal(setupItems(facts({ camera: false }), { goals: ['article'], platforms: [] }).find((item) => item.id === 'camera').done, false)
  assert.equal(remainingSetup(setupItems(facts({ openrouter: true, camera: true, brandIdentities: 1, ctas: 1, runsByKind: { ...NO_RUNS, articles: 1 } }), { goals: ['article'], platforms: [] })), 0)
})

test('Library runs say what made them: Create, Remix (and which kind) or Avatar Studio', async () => {
  const temp = tempDir('bridgeclip-made-with-')
  try {
    const library = path.join(temp.dir, 'library')
    const write = (name, metrics, clips = [{}]) => {
      const run = path.join(library, name)
      fs.mkdirSync(run, { recursive: true })
      fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({
        source_video_title: name, metrics,
        clips: clips.map((clip, index) => ({ clip_index: index, s3_url: `file://${path.join(run, `clip_${index}.mp4`)}`, summary: 'c', duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, virality_score: 0, ...clip }))
      }))
    }
    write('create', { api_costs: { total_estimated_cost_usd: 0.1 } })
    write('remix-new', { remix: true, remix_kinds: ['image', 'bogus'] })
    write('remix-old', { remix: true }, [{ ai_generated: false }, { ai_generated: true }])
    write('avatar', { avatar_studio: 'script' })
    const { electron } = fakeElectron(temp.dir)
    const { getJobHistory } = loadMain("export * from './src/main/file-manager'", { electron })
    const entries = Object.fromEntries((await getJobHistory(library)).map((entry) => [entry.videoTitle, entry]))
    assert.equal(entries.create.madeWith, 'create')
    assert.equal(entries.create.remixKinds, undefined)
    assert.equal(entries['remix-new'].madeWith, 'remix')
    assert.deepEqual(plain(entries['remix-new'].remixKinds), ['image'])
    assert.deepEqual(plain(entries['remix-old'].remixKinds).sort(), ['ai', 'camera'], 'older remix runs: on camera when there is no AI presenter')
    assert.equal(entries.avatar.madeWith, 'avatar')
  } finally { temp.cleanup() }
})
