'use strict'
// Post performance: parsing Zernio's GET /v1/analytics answer, keeping the
// last real numbers, rate limits, the stored history, the Library stats line
// and the "what's working" summary. No real key or account.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createMockZernio } = require('./support/mock-zernio.cjs')
const { createPostingMock } = require('./support/mock-posts.cjs')
const { loadMain, tempDir, fakeElectron, ROOT } = require('./support/load-main.cjs')

const KEY = 'stats-zernio-key'
const FFMPEG = fs.existsSync(path.join(ROOT, 'engine-bin', 'ffmpeg')) ? path.join(ROOT, 'engine-bin', 'ffmpeg') : 'ffmpeg'
const MINUTE = 60_000
const historyPath = (dir) => path.join(dir, `zernio-posts-${crypto.createHash('sha256').update(KEY).digest('hex')}.json`)

const pure = loadMain(`
  export * as stats from './src/main/zernio/post-stats'
  export * as shared from './src/shared/zernio-posts'
  export * as insights from './src/shared/post-insights'
  export { clipPostingStatus } from './src/shared/library-posting'
  export { PostsStore, parseStoredStats } from './src/main/zernio/posts-store'
`, { electron: {} })
const plain = (value) => JSON.parse(JSON.stringify(value))

const A = 'a'.repeat(24)
const B = 'b'.repeat(24)
const POST_ID = 'c'.repeat(24)

function record(overrides = {}) {
  return {
    id: POST_ID, clipPath: '/library/run/clip.mp4', clipTitle: 'Clip',
    targets: [
      { platform: 'youtube', accountId: A, handle: '@a', status: 'published', error: null, url: 'https://youtube.com/shorts/x', inbox: false },
      { platform: 'instagram', accountId: B, handle: '@b', status: 'published', error: null, url: 'https://instagram.com/reel/x', inbox: false }
    ],
    scheduledFor: null, timezone: null, status: 'published', error: null,
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), uploadedAt: new Date().toISOString(), refreshedAt: null,
    ...overrides
  }
}

const ANSWER = {
  postId: POST_ID, status: 'published', syncStatus: 'synced',
  analytics: { impressions: 5000, reach: 4200, likes: 210, comments: 14, shares: 9, saves: 3, clicks: 0, views: 4800, lastUpdated: '2026-10-16T10:00:00.000Z' },
  platformAnalytics: [
    { platform: 'youtube', accountId: A, status: 'published', syncStatus: 'synced', analytics: { views: 3000, likes: 100, comments: 10, shares: 4 } },
    { platform: 'instagram', accountId: { _id: B }, status: 'published', syncStatus: 'synced', analytics: { views: 1800, likes: 110, comments: 4, shares: 5, saves: 3 } },
    { platform: 'tiktok', accountId: 'd'.repeat(24), syncStatus: 'synced', analytics: { views: 99 } }
  ]
}

test('analytics answers become stats: totals, per account, and nothing invented', () => {
  const now = '2026-10-17T12:00:00.000Z'
  const stats = plain(pure.stats.parsePostAnalytics(ANSWER, 200, record(), now))
  assert.equal(stats.fetchedAt, now)
  assert.equal(stats.updatedAt, '2026-10-16T10:00:00.000Z')
  assert.equal(stats.syncStatus, 'synced')
  assert.deepEqual(stats.total, { views: 4800, likes: 210, comments: 14, shares: 9, saves: 3, impressions: 5000, reach: 4200 })
  assert.deepEqual(stats.targets.map((t) => [t.platform, t.metrics.views]), [['youtube', 3000], ['instagram', 1800]], 'only accounts this post went to')
  assert.equal(stats.targets[0].metrics.saves, null, 'a metric the platform left out stays unknown, not zero')

  // 202: Zernio is still syncing. No numbers means no total.
  const pending = plain(pure.stats.parsePostAnalytics({ syncStatus: 'pending', message: 'Analytics are syncing', platformAnalytics: [] }, 202, record(), now))
  assert.equal(pending.syncStatus, 'pending')
  assert.equal(pending.total, null)
  assert.equal(pending.message, 'Analytics are syncing')

  // 424: every platform failed. Provider text is sanitized.
  const failed = plain(pure.stats.parsePostAnalytics({ platformAnalytics: [{ platform: 'youtube', accountId: A, syncStatus: 'unavailable', analytics: null, errorMessage: 'Token sk_live_abcdefghijkl expired, see https://example.com' }] }, 424, record(), now))
  assert.equal(failed.syncStatus, 'unavailable')
  assert.equal(failed.targets[0].metrics, null)
  assert.doesNotMatch(failed.targets[0].message, /sk_live|https/)

  // Junk numbers are dropped.
  const junk = plain(pure.stats.parsePostAnalytics({ analytics: { views: -5, likes: 'many', comments: Infinity, shares: 2 } }, 200, record(), now))
  assert.deepEqual(junk.total, { views: null, likes: null, comments: null, shares: 2, saves: null, impressions: null, reach: null })

  // A platform-only row matches when the post has one account on that platform.
  const loose = plain(pure.stats.parsePostAnalytics({ platformAnalytics: [{ platform: 'youtube', analytics: { views: 7 } }] }, 200, record(), now))
  assert.equal(loose.targets[0].metrics.views, 7)
})

test('merging keeps the last real numbers when a newer answer has none', () => {
  const first = pure.stats.parsePostAnalytics(ANSWER, 200, record(), '2026-10-17T12:00:00.000Z')
  const later = pure.stats.parsePostAnalytics({ syncStatus: 'pending', platformAnalytics: [{ platform: 'youtube', accountId: A, syncStatus: 'pending', analytics: null }] }, 202, record(), '2026-10-17T13:00:00.000Z')
  const merged = plain(pure.stats.mergePostStats(first, later))
  assert.equal(merged.fetchedAt, '2026-10-17T13:00:00.000Z')
  assert.equal(merged.syncStatus, 'pending')
  assert.equal(merged.total.views, 4800)
  assert.equal(merged.targets.find((t) => t.platform === 'youtube').metrics.views, 3000)
  assert.equal(merged.targets.find((t) => t.platform === 'instagram').metrics.views, 1800, 'an account missing from the newer answer keeps its numbers')
  const fresh = plain(pure.stats.mergePostStats(first, pure.stats.parsePostAnalytics({ analytics: { views: 5000 } }, 200, record(), '2026-10-17T14:00:00.000Z')))
  assert.equal(fresh.total.views, 5000, 'newer numbers win')
})

test('rate limits: which posts are due, and in what order', () => {
  const now = Date.parse('2026-10-17T12:00:00.000Z')
  const at = (minutesAgo) => new Date(now - minutesAgo * MINUTE).toISOString()
  const due = (post, force = false) => pure.stats.statsDue(post, now, force)
  assert.equal(due(record()), true, 'never fetched')
  assert.equal(due(record({ status: 'scheduled' })), false)
  assert.equal(due(record({ status: 'failed' })), false)
  assert.equal(due(record({ targets: [{ ...record().targets[0], inbox: true }] })), false, 'a TikTok inbox draft has no public stats')
  assert.equal(due(record({ createdAt: new Date(now - 400 * 86_400_000).toISOString() })), false, 'past Zernio’s 366-day range')
  const synced = (minutesAgo, syncStatus = 'synced') => record({ stats: { fetchedAt: at(minutesAgo), updatedAt: null, syncStatus, total: null, targets: [], message: null } })
  assert.equal(due(synced(10)), false, 'asked 10 minutes ago')
  assert.equal(due(synced(31)), true)
  assert.equal(due(synced(10), true), true, 'a refresh the person asked for waits only 5 minutes')
  assert.equal(due(synced(3), true), false)
  assert.equal(due(synced(11, 'pending')), true, 'pending syncs are asked about again sooner')
  const order = [synced(40), record({ createdAt: at(10) }), synced(90)].sort(pure.stats.statsOrder)
  assert.equal(order[0].stats, undefined, 'never fetched first')
  assert.equal(order[1].stats.fetchedAt, at(90))
  assert.equal(pure.stats.statsFromDate({ createdAt: '2026-10-17T00:30:00.000Z' }), '2026-10-16')
})

test('stored stats survive a reload, and damaged ones are dropped instead of trusted', () => {
  const { dir, cleanup } = tempDir()
  try {
    const store = new pure.PostsStore(path.join(dir, 'posts.json'))
    const stats = pure.stats.parsePostAnalytics(ANSWER, 200, record(), '2026-10-17T12:00:00.000Z')
    store.save(record({ stats }))
    assert.deepEqual(plain(store.get(POST_ID).stats), plain(stats))
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'posts.json'), 'utf8'))
    raw.posts[0].stats.total.views = 'lots'
    fs.writeFileSync(path.join(dir, 'posts.json'), JSON.stringify(raw))
    assert.equal(store.get(POST_ID).stats, null)
    assert.equal(store.get(POST_ID).status, 'published', 'the post itself is kept')
    assert.equal(pure.parseStoredStats({ fetchedAt: 'yesterday' }), null)
  } finally { cleanup() }
})

test('the Library stats line adds up a clip’s posts and the caption line reads plainly', () => {
  const one = record({ stats: pure.stats.parsePostAnalytics(ANSWER, 200, record(), '2026-10-17T12:00:00.000Z') })
  const two = record({ id: 'e'.repeat(24), stats: pure.stats.parsePostAnalytics({ analytics: { views: 200, likes: 1 } }, 200, record(), '2026-10-17T13:00:00.000Z') })
  const status = plain(pure.clipPostingStatus(0, [one, two, record({ id: 'f'.repeat(24) })]))
  assert.equal(status.stats.posts, 2)
  assert.equal(status.stats.metrics.views, 5000)
  assert.equal(status.stats.metrics.comments, 14, 'a post without comments counted adds nothing')
  assert.equal(status.stats.fetchedAt, '2026-10-17T13:00:00.000Z')
  assert.equal(pure.shared.statsLine(status.stats.metrics), '5K views · 211 likes · 14 comments · 9 shares')
  assert.equal(pure.shared.statsLine({ views: 1, likes: null, comments: null, shares: null, saves: null, impressions: null, reach: null }), '1 view')
  assert.equal(pure.shared.statsLine(null), null)
  assert.equal(pure.clipPostingStatus(0, [record()]).stats, undefined, 'no stats fetched, no line')
  assert.equal(pure.shared.formatCount(1250), '1.3K')
  assert.equal(pure.shared.formatCount(2_500_000), '2.5M')
})

test('what’s working: averages by grade, hook look and caption style, only with enough posts', () => {
  const labels = { hookLook: (id) => `look:${id}`, captionStyle: (id) => `style:${id}` }
  const post = (views, grade, hookLook = null, captionStyle = null) => ({ views, grade, hookLook, captionStyle })
  const few = plain(pure.insights.summarizeInsights([post(100, 'A'), post(50, 'B')], labels))
  assert.deepEqual(few, { posts: 2, needed: 4, groups: [], notes: [] }, 'says how many more posts are needed')
  const result = plain(pure.insights.summarizeInsights([
    post(1000, 'A', 'white', 'pop'), post(800, 'A', 'white', 'pop'), post(300, 'B', 'black', 'none'),
    post(100, 'B', 'black', 'none'), post(50, 'C'), post(70, null, 'floating')
  ], labels))
  assert.equal(result.posts, 6)
  assert.equal(result.needed, 0)
  const grade = result.groups.find((g) => g.id === 'grade')
  assert.deepEqual(grade.rows.map((r) => [r.label, r.posts, r.averageViews]), [['Grade A', 2, 900], ['Grade B', 2, 200]], 'a grade with one post is left out')
  assert.deepEqual(result.groups.find((g) => g.id === 'hookLook').rows.map((r) => [r.label, r.posts, r.averageViews]), [['look:black', 2, 200], ['look:white', 2, 900]])
  assert.deepEqual(result.groups.find((g) => g.id === 'captionStyle').rows.map((r) => r.label), ['style:none', 'style:pop'])
  const gradesOnly = plain(pure.insights.summarizeInsights([post(1, 'A'), post(2, 'A'), post(3, 'B'), post(4, 'B'), post(5, 'C'), post(6, 'D')], labels))
  assert.deepEqual(gradesOnly.groups.map((g) => g.id), ['grade'])
  assert.equal(gradesOnly.notes.length, 2, 'says why hook looks and caption styles are missing')
})

function makeClip(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:d=3:r=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-shortest', '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'aac', file])
  return file
}

async function withStats(t) {
  const { dir, cleanup } = tempDir()
  const posting = createPostingMock()
  const mock = await createMockZernio({ apiKey: KEY, extraRoutes: posting.routes })
  const previous = { url: process.env.BRIDGECLIP_ZERNIO_API_URL, path: process.env.PATH }
  process.env.BRIDGECLIP_ZERNIO_API_URL = mock.apiUrl
  process.env.PATH = `${previous.path}${path.delimiter}${path.join(ROOT, 'engine-bin')}`
  const realNow = Date.now
  t.after(async () => {
    Date.now = realNow
    if (previous.url === undefined) delete process.env.BRIDGECLIP_ZERNIO_API_URL
    else process.env.BRIDGECLIP_ZERNIO_API_URL = previous.url
    process.env.PATH = previous.path
    await mock.close(); cleanup()
  })
  const library = path.join(dir, 'library')
  const clipPath = makeClip(path.join(library, 'run-1', 'clip_01.mp4'))
  const writeRun = (extra = {}) => fs.writeFileSync(path.join(path.dirname(clipPath), 'job_output.json'), JSON.stringify({
    job_id: 'run-1', source_video_url: '', source_video_title: 'Run', source_video_duration_seconds: 10, total_clips: 1,
    clips: [{ clip_index: 0, s3_url: `file://${clipPath}`, duration_ms: 3000, start_time_ms: 0, end_time_ms: 3000, virality_score: 0.5, layout_type: '', summary: 'Stats clip', tags: [], render_fallback: null, ...extra }],
    transcript_url: null, plan_url: null, processing_time_seconds: 1, metrics: null
  }))
  writeRun()
  const { electron } = fakeElectron(dir)
  const main = loadMain(`
    export * as posts from './src/main/zernio/posts'
    export * as settings from './src/main/settings-store'
    export * as libraryPosting from './src/main/library-posting'
  `, { electron })
  main.settings.replaceApiKey('zernioApiKey', KEY)
  main.settings.savePublicSettings({ outputDirectory: library, pythonPath: 'python3' })
  const [profile] = mock.state.profiles
  const youtube = mock.addAccount('youtube', profile._id, { username: 'channel' })
  let attempt = 0
  const publish = (caption) => main.posts.publishClip({
    attemptId: `attempt-stats-${++attempt}`, clipPath, clipTitle: 'Stats clip', durationMs: 3000, caption,
    targets: [{ platform: 'youtube', accountId: youtube._id }], timing: { mode: 'now' },
    options: { youtube: { title: 'Stats clip', visibility: 'public', madeForKids: false } }
  }, () => {})
  // Jumps the clock forward; the rate limits use Date.now.
  let offset = 0
  const advance = (ms) => { offset += ms; Date.now = () => realNow() + offset }
  return { main, mock, posting, youtube, publish, advance, writeRun, userData: path.join(dir, 'userData'), library, clipPath }
}

test('stats refresh asks Zernio once per post, stores the answer, and respects the rate limits', async (t) => {
  const f = await withStats(t)
  const first = await f.publish('First caption')
  const second = await f.publish('Second caption')
  f.posting.state.analytics.set(first.post.id, { body: { ...ANSWER, postId: first.post.id, platformAnalytics: [{ platform: 'youtube', accountId: f.youtube._id, syncStatus: 'synced', analytics: { views: 1234, likes: 56, comments: 7, shares: 1 } }] } })
  f.posting.state.analytics.set(second.post.id, { status: 202, body: { syncStatus: 'pending', message: 'Syncing', platformAnalytics: [] } })

  let result = await f.main.posts.refreshPostStats(false)
  assert.equal(result.error, null)
  assert.equal(f.posting.state.analyticsRequests.length, 2)
  assert.ok(f.posting.state.analyticsRequests.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.fromDate)), 'fromDate covers the post')
  const stored = JSON.parse(fs.readFileSync(historyPath(f.userData), 'utf8')).posts
  assert.equal(stored.find((p) => p.id === first.post.id).stats.targets[0].metrics.views, 1234)
  assert.equal(stored.find((p) => p.id === second.post.id).stats.syncStatus, 'pending')
  assert.equal(result.posts.find((p) => p.id === first.post.id).stats.total.views, 4800)

  // Opening Posts again right away asks nothing.
  await f.main.posts.refreshPostStats(false)
  await f.main.posts.refreshPostStats(true)
  assert.equal(f.posting.state.analyticsRequests.length, 2, 'whole passes are spaced out')
  // Eleven minutes on: only the pending post is due without a forced refresh.
  f.advance(11 * MINUTE)
  await f.main.posts.refreshPostStats(false)
  assert.deepEqual(f.posting.state.analyticsRequests.slice(2).map((r) => r.postId), [second.post.id])
  // A forced refresh after the short pass gap asks about the rest too.
  f.advance(MINUTE)
  await f.main.posts.refreshPostStats(true)
  assert.deepEqual(f.posting.state.analyticsRequests.slice(3).map((r) => r.postId), [first.post.id])

  // A workspace without analytics access: one clear message, and no more requests for a while.
  f.advance(31 * MINUTE)
  f.posting.state.analyticsOverride = { status: 403, body: { error: 'Analytics add-on required', code: 'insufficient_permissions' } }
  result = await f.main.posts.refreshPostStats(false)
  assert.equal(result.unavailable, true)
  assert.match(result.error, /Open each post on its platform/)
  const before = f.posting.state.analyticsRequests.length
  f.advance(31 * MINUTE)
  await f.main.posts.refreshPostStats(false)
  assert.equal(f.posting.state.analyticsRequests.length, before, 'not asked again soon after Zernio refused')
  assert.equal(result.posts.find((p) => p.id === first.post.id).stats.total.views, 4800, 'earlier numbers stay')

  // The Library card's status carries the numbers.
  const [status] = await f.main.libraryPosting.libraryPostingStatus(path.dirname(f.clipPath))
  assert.equal(status.stats.metrics.views, 4800)
})

test('what’s working reads grades from the Library run and counts only real views', async (t) => {
  const f = await withStats(t)
  f.writeRun({ framework: { grade: 'A', score: 8.5 }, remix_settings: { headline: 'Hook', headline_look: { look: 'black', color: '#000000', font: 'clean' }, include_captions: true, caption_preset: 'spotlight', split: null } })
  const made = []
  for (let i = 0; i < 3; i++) made.push((await f.publish(`Caption ${i}`)).post)
  // Posts a day old or more count; give them views (one has none yet).
  const history = JSON.parse(fs.readFileSync(historyPath(f.userData), 'utf8'))
  for (const [i, post] of history.posts.entries()) {
    post.createdAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
    if (i < 2) post.stats = { fetchedAt: new Date().toISOString(), updatedAt: null, syncStatus: 'synced', total: { views: 100 * (i + 1), likes: 1, comments: 0, shares: 0, saves: null, impressions: null, reach: null }, targets: [], message: null }
  }
  fs.writeFileSync(historyPath(f.userData), JSON.stringify(history))
  const insights = plain(await f.main.libraryPosting.postPerformanceInsights())
  assert.equal(insights.posts, 2, 'the post without views is not counted')
  assert.equal(insights.needed, 4)
  assert.deepEqual(insights.groups, [], 'nothing is compared with too little data')
  assert.equal(made.length, 3)
})
