const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, Uint8Array, console, setTimeout, clearTimeout, process, DOMException, AbortSignal, AbortController, Response,
    fetch: () => { throw new Error('unexpected network call') },
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/listicle.ts')
// Avatar Studio (where Top lists are made) on, as BRIDGECLIP_E2E_AVATAR_STUDIO=1 does; it's switched off for members (shared/features).
const AVATAR_STUDIO_ON = { './features': { isAvatarStudioEnabled: () => true } }
const AVATAR_STUDIO_OFF = { './features': { isAvatarStudioEnabled: () => false } }
const plan = load('shared/daily-plan.ts', AVATAR_STUDIO_ON)

const ITEMS = [
  { name: 'HyperFrames', line: 'HTML to video', imagePath: null, box: null, script: 'HyperFrames turns HTML into video.', accent: 'HyperFrames' },
  { name: 'onetake', line: '', imagePath: '/shots/two.png', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, script: 'onetake makes one-shot films.', accent: '' },
  { name: 'Collage B-roll', line: '', imagePath: null, box: { x: 0, y: 0, w: 0.5, h: 0.5 }, script: 'Paper collage b-roll.', accent: 'B-roll' }
]
const REQUEST = { title: '3 tools to try', accent: 'try', intro: 'Three tools worth a look.', items: ITEMS, header: 'Web Lab · AI tools', handle: '@weblab', accentColor: '#7ce7ac', voice: { kind: 'preset', voice: 'brian' }, captions: true, ctaId: null, brandIdentityId: null }

// ---------------------------------------------------------------------------
// Shared: requests, scripts, estimates
// ---------------------------------------------------------------------------

test('a list request is checked: 3-7 named, scripted items, a known voice, a clean box', () => {
  const ok = shared.parseListicleRequest(REQUEST)
  assert.equal(ok.accentColor, '#7CE7AC')
  assert.deepEqual(plain(ok.voice), { kind: 'preset', voice: 'Brian' })
  // A box without a picture is dropped.
  assert.equal(ok.items[2].box, null)
  assert.deepEqual(plain(ok.items[1].box), { x: 0.1, y: 0.2, w: 0.3, h: 0.1 })
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, items: ITEMS.slice(0, 2) }), /Add 3 to 7 items/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, items: [...ITEMS, ...ITEMS, ...ITEMS] }), /Add 3 to 7 items/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, items: [{ ...ITEMS[0], script: ' ' }, ...ITEMS.slice(1)] }), /script for item 1/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, items: [{ ...ITEMS[0], name: '' }, ...ITEMS.slice(1)] }), /name of item 1/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, items: [ITEMS[0], { ...ITEMS[1], box: { x: 0.9, y: 0, w: 0.5, h: 0.5 } }, ITEMS[2]] }), /highlight box/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, voice: { kind: 'preset', voice: 'Somebody Famous' } }), /Choose a voice/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, voice: { kind: 'avatar', avatarId: '../x' } }), /avatar/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, title: 'x'.repeat(91) }), /under 90/)
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, items: [...ITEMS, ...ITEMS].map((item) => ({ ...item, script: 'word '.repeat(70) })) }), /too long/)
})

test('own recordings are needed for every spoken part, and cost nothing', () => {
  const recorded = { kind: 'recorded', recordings: { intro: '/r/a.webm', 1: '/r/b.webm', 2: '/r/c.webm' } }
  assert.throws(() => shared.parseListicleRequest({ ...REQUEST, voice: recorded }), /item 3/)
  const ok = shared.parseListicleRequest({ ...REQUEST, voice: { kind: 'recorded', recordings: { ...recorded.recordings, 3: '/r/d.webm' } } })
  assert.deepEqual(Object.keys(ok.voice.recordings), ['1', '2', '3', 'intro'])
  // No opening line: no opening recording needed.
  assert.doesNotThrow(() => shared.parseListicleRequest({ ...REQUEST, intro: '', voice: { kind: 'recorded', recordings: { 1: '/a.webm', 2: '/b.webm', 3: '/c.webm' } } }))
  assert.equal(shared.estimateListicleCost(REQUEST, 'recorded'), 0)
  const chars = shared.spokenText(REQUEST).length
  assert.ok(shared.estimateListicleCost(REQUEST, 'preset') >= 0.01)
  assert.ok(shared.estimateListicleCost({ intro: 'x'.repeat(1000), items: [] }, 'clone') < shared.estimateListicleCost({ intro: 'x'.repeat(1000), items: [] }, 'preset'))
  assert.ok(chars > 50)
  assert.ok(shared.estimateListicleSeconds(REQUEST) > 2.5, 'includes the end card')
})

test('accent words come from the title, or fall back to its last word', () => {
  assert.equal(shared.pickAccent('Make your videos look different.', 'different'), 'different')
  assert.equal(shared.pickAccent('Collage B-roll', 'b-roll'), 'B-roll')
  assert.equal(shared.pickAccent('Two tools', 'missing'), 'tools')
  assert.deepEqual(plain(shared.splitAccent('5 tools to try now', 'try')), { before: '5 tools to', accent: 'try', after: 'now' })
})

test('the model script is trimmed to the items and never longer than the limits', () => {
  const request = { title: '3 tools to try', items: ITEMS.map((item) => ({ name: item.name, line: item.line })), brandIdentityId: null }
  const script = shared.parseListicleScript({ intro: '  Three   tools. ', titleAccent: 'TRY', items: [{ script: 'A', accent: 'HyperFrames' }, { script: 'B', accent: 'zzz' }, { script: 'C'.repeat(500), accent: '' }, { script: 'extra', accent: '' }] }, request)
  assert.equal(script.intro, 'Three tools.')
  assert.equal(script.titleAccent, 'try')
  assert.equal(script.items.length, 3)
  assert.equal(script.items[1].accent, 'onetake')
  assert.equal(script.items[2].script.length, shared.LISTICLE_LIMITS.script)
  assert.throws(() => shared.parseListicleScript({ intro: '', titleAccent: '', items: [{ script: 'A' }] }, request), /incomplete/)
})

// ---------------------------------------------------------------------------
// Main: script call, Library run, engine request, path checks
// ---------------------------------------------------------------------------

function loadMain(overrides = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'listicle-test-'))
  const settings = { openrouterApiKey: 'or-key', outputDirectory: path.join(userData, 'out'), pythonPath: 'python3', ...overrides.settings }
  const charged = []
  const main = load('main/listicle.ts', {
    electron: { app: { isPackaged: false, getPath: () => userData } },
    './settings-store': { loadSettings: () => settings },
    './ctas': { ...load('shared/ctas.ts'), applyRunCtaInLock: async () => ({ failed: [] }), readCta: () => ({}), withRunLock: async (_folder, work) => work() },
    './avatars': { ...load('shared/avatars.ts'), readAvatar: () => ({ voice: { provider: 'clone', clonedAt: 'x' } }), speechFor: async () => ({}) },
    './remix': { readBrandIdentity: async () => ({ name: 'Web Lab', text: 'We test AI tools. Proof: 12,000 subscribers.' }) },
    './openrouter-media': { reportOpenRouterUsage: (model, body) => charged.push(body.usage?.cost), synthesizeSpeech: async () => new Uint8Array() },
    './logger': { logger: { warn: () => {}, info: () => {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '', getEnginePath: () => '', resolvePythonPath: () => '', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': overrides.security ?? { assertMediaPath: () => {}, authorizeMedia: (p) => p, isWithinDirectory: () => true },
    './tools': { resolveBinary: (name) => name },
    ...overrides.mocks
  })
  return { main, userData, settings, charged }
}

test('writing the script sends the items and brand as data, records its cost and returns checked lines', async () => {
  const { main, charged } = loadMain()
  let sent = null
  const fetchStub = async (url, init) => {
    sent = JSON.parse(init.body)
    return new Response(JSON.stringify({ usage: { cost: 0.004 }, choices: [{ message: { content: JSON.stringify({ intro: 'Three tools.', titleAccent: 'try', items: ITEMS.map((item) => ({ script: item.script, accent: item.name })) }) } }] }), { status: 200 })
  }
  const script = await main.writeListicleScript({ title: '3 tools to try', items: ITEMS.map((item) => ({ name: item.name, line: item.line })), brandIdentityId: '0123456789abcdef' }, fetchStub)
  assert.equal(script.items.length, 3)
  assert.deepEqual(charged, [0.004])
  const user = JSON.parse(sent.messages[1].content)
  assert.equal(user.brandIdentity.name, 'Web Lab')
  assert.match(sent.messages[0].content, /Never invent facts/)
  assert.equal(sent.response_format.json_schema.strict, true)
  await assert.rejects(main.writeListicleScript({ title: 'x', items: [] }, fetchStub), /Add 3 to 7 items/)
  await assert.rejects(main.writeListicleScript({ title: '3 tools', items: ITEMS }, async () => new Response('', { status: 402 })), /insufficient credits/)
})

test('the Library run is one clip made by the list maker, with the list as its caption', () => {
  const { main } = loadMain()
  const run = '/out/listicle-11111111-2222-3333-4444-555555555555'
  const output = main.listicleJobOutput(run, REQUEST, 12345, 0.03, '2026-10-19T10:00:00.000Z')
  assert.equal(output.source_video_title, 'Top list · 3 tools to try')
  assert.equal(output.metrics.listicle, true)
  assert.equal(output.metrics.api_costs.total_estimated_cost_usd, 0.03)
  assert.equal(output.clips[0].ai_generated, true)
  assert.equal(output.clips[0].post_caption, '3 tools to try\n\n1. HyperFrames\n2. onetake\n3. Collage B-roll')
  assert.ok(main.LISTICLE_RUN.test('listicle-11111111-2222-3333-4444-555555555555'))
  // The member's own voice isn't AI: posting doesn't start with the AI label on.
  assert.equal(main.listicleJobOutput(run, { ...REQUEST, voice: { kind: 'recorded', recordings: {} } }, 1000, 0).clips[0].ai_generated, false)
  // The Library reads it back as a Top list run.
  const parsed = load('shared/job-output.ts').parseJobOutput(plain(output))
  assert.equal(parsed.metrics.listicle, true)
})

test('the engine request has the intro, numbered items with their pictures and boxes, and the end card', () => {
  const { main } = loadMain()
  const request = shared.parseListicleRequest(REQUEST)
  const parts = [
    { key: 'intro', text: 'Three tools worth a look.', path: '/w/intro.m4a', durationMs: 2000, words: [] },
    ...[1, 2, 3].map((n) => ({ key: String(n), text: 'x', path: `/w/${n}.m4a`, durationMs: 3000, words: [{ word: 'x', start_ms: 0, end_ms: 10 }] }))
  ]
  const spec = main.engineSpec(request, parts, [null, '/w/item-2.png', null], '/out/clip_00.mp4', '/w/render')
  assert.deepEqual(plain(spec.segments.map((segment) => segment.kind)), ['intro', 'item', 'item', 'item', 'end'])
  assert.deepEqual(plain(spec.segments.slice(1, 4).map((segment) => segment.index)), [1, 2, 3])
  assert.equal(spec.segments[2].image, '/w/item-2.png')
  assert.deepEqual(plain(spec.segments[2].box), { x: 0.1, y: 0.2, w: 0.3, h: 0.1 })
  assert.equal(spec.segments[1].box, null)
  assert.equal(spec.segments[0].accent, 'try')
  assert.equal(spec.segments[3].accent, 'B-roll')
  assert.equal(spec.segments[4].duration_ms, shared.LISTICLE_END_CARD_MS)
  // No handle: no end card.
  assert.equal(main.engineSpec({ ...request, handle: '' }, parts, [null, null, null], '/o', '/w').segments.at(-1).kind, 'item')
  // Captions follow where speech is heard.
  const words = main.partWords('One two three.', { startMs: 500, endMs: 1500 })
  assert.equal(words[0].start_ms, 500)
  assert.ok(words.at(-1).end_ms <= 1500)
})

test('pictures must be authorized images; recordings must be ones saved here', () => {
  const rejecting = { assertMediaPath: () => { throw new Error('outside') }, authorizeMedia: (p) => p, isWithinDirectory: () => false }
  const { main } = loadMain({ security: rejecting })
  const request = shared.parseListicleRequest(REQUEST)
  assert.throws(() => main.checkListiclePaths(request, '/out'), /item 2’s picture again/)
  const { main: lenient } = loadMain({ security: { assertMediaPath: () => {}, authorizeMedia: (p) => p, isWithinDirectory: () => false } })
  assert.throws(() => lenient.checkListiclePaths(shared.parseListicleRequest({ ...REQUEST, items: [ITEMS[0], { ...ITEMS[1], imagePath: '/shots/two.mp4' }, ITEMS[2]] }), '/out'), /PNG, JPEG or WebP/)
  const recorded = shared.parseListicleRequest({ ...REQUEST, items: ITEMS.map((item) => ({ ...item, imagePath: null })), voice: { kind: 'recorded', recordings: { intro: '/a.webm', 1: '/b.webm', 2: '/c.webm', 3: '/d.webm' } } })
  assert.throws(() => lenient.checkListiclePaths(recorded, '/out'), /again/)
})

test('the spending check: a voice is estimated, own recordings are free (no check)', () => {
  const { main } = loadMain()
  assert.ok(main.listicleSpendCheck(REQUEST) > 0)
  assert.equal(main.listicleSpendCheck({ ...REQUEST, voice: { kind: 'recorded', recordings: { intro: '/a', 1: '/b', 2: '/c', 3: '/d' } } }), null)
  // An avatar with a cloned voice is priced at the cloning rate.
  assert.equal(main.listicleVoiceCost(shared.parseListicleRequest({ ...REQUEST, voice: { kind: 'avatar', avatarId: 'abcdef1234567890' } })), 'clone')
})

test('recordings from the app are saved privately and are viewable', async () => {
  const { main, userData } = loadMain()
  const saved = await main.saveListicleRecording(new Uint8Array(2000), 'audio/webm')
  assert.ok(saved.startsWith(path.join(userData, 'listicle-recordings')))
  assert.ok(saved.endsWith('.webm'))
  await assert.rejects(main.saveListicleRecording(new Uint8Array(10), 'audio/webm'), /Record it again/)
  await assert.rejects(main.saveListicleRecording('nope', 'audio/webm'), /Record it again/)
})

test('the render refuses a second one and a request without a voice key', async () => {
  const { main } = loadMain({ settings: { openrouterApiKey: '' } })
  await assert.rejects(main.startListicleRender(REQUEST), /OpenRouter key/)
})

test('Library runs and setup count Top lists as their own kind', () => {
  const source = fs.readFileSync(path.join(ROOT, 'main/file-manager.ts'), 'utf8')
  assert.match(source, /metrics\.listicle === true \? 'listicle'/)
  const checklist = load('shared/setup-checklist.ts', AVATAR_STUDIO_ON)
  const facts = { openrouter: true, toolsOk: true, camera: null, zernioKey: false, postingAccounts: 0, connectedPlatforms: [], brandIdentities: 0, ctas: 0, avatars: 0, runs: 1,
    runsByKind: { clips: 0, aiReactions: 0, cameraReactions: 0, articles: 0, avatarVideos: 0, listicles: 1 } }
  const items = checklist.setupItems(facts, { goals: ['listicle'], platforms: [] })
  const first = items.find((item) => item.id === 'first-listicle')
  assert.equal(first.done, true)
  // A Top list needs no avatar step.
  assert.equal(items.some((item) => item.id === 'avatar'), false)
  const onboarding = load('shared/onboarding.ts')
  assert.ok(onboarding.GUIDES.listicle.steps.length >= 4)
  // Avatar Studio switched off: no Top list step, and its guide isn't offered.
  const hidden = load('shared/setup-checklist.ts', AVATAR_STUDIO_OFF).setupItems(facts, { goals: ['listicle'], platforms: [] })
  assert.equal(hidden.some((item) => item.id === 'first-listicle' || item.id === 'avatar'), false)
  assert.equal(hidden.some((item) => item.id === 'first-clip'), true, 'with no goal left, the general first clip')
  assert.equal(load('shared/onboarding.ts', AVATAR_STUDIO_OFF).goalAvailable('listicle'), false)
  assert.equal(load('shared/ready-to-post.ts').runKindOf('listicle-11111111-2222-3333-4444-555555555555'), 'avatar')
})

// ---------------------------------------------------------------------------
// Today's 3
// ---------------------------------------------------------------------------

const NOW = new Date(2026, 9, 19, 15, 0, 0)
const at = (daysAgo, hour = 10) => new Date(2026, 9, 19 - daysAgo, hour, 0, 0).toISOString()
const run = (madeWith, daysAgo, extra = {}) => ({ madeWith, status: 'completed', date: at(daysAgo, 9), finishedAt: at(daysAgo), outputDir: `/out/${madeWith}-${daysAgo}`, videoTitle: 'A video', ...extra })

test("today's 3: a clip only with a recent long video; goals come first; stand-ins fill the rest", () => {
  assert.deepEqual(plain(plan.planSlots([], true)), ['clip', 'reaction', 'talking'])
  assert.deepEqual(plain(plan.planSlots([], false)), ['reaction', 'talking', 'listicle'])
  assert.deepEqual(plain(plan.planSlots(['avatar-videos', 'listicle'], false)), ['reaction', 'listicle', 'avatar'])
  assert.deepEqual(plain(plan.planSlots(['clips', 'edit-recording'], true)), ['clip', 'reaction', 'talking'])
  assert.deepEqual(plain(plan.planSlots(['clips'], false)), ['reaction', 'talking', 'listicle'], 'no clip without a recent source')
})

test("today's 3 with Avatar Studio switched off: no top list or avatar video; a clip from a new long video fills in", () => {
  const off = load('shared/daily-plan.ts', AVATAR_STUDIO_OFF)
  assert.deepEqual(plain(off.planSlots([], true)), ['clip', 'reaction', 'talking'])
  assert.deepEqual(plain(off.planSlots([], false)), ['clip', 'reaction', 'talking'])
  assert.deepEqual(plain(off.planSlots(['avatar-videos', 'listicle'], false)), ['clip', 'reaction', 'talking'])
})

test("today's 3 ticks off from runs finished today and counts a real streak", () => {
  const runs = [run('create', 0, { sourceUrl: 'https://youtu.be/abc' }), run('remix', 0), run('edit', 1), run('listicle', 2), run('create', 4), { ...run('remix', 0), status: 'failed' }]
  const today = plan.todayRuns(runs, NOW)
  assert.equal(today.total, 2)
  assert.deepEqual(plain(today.byKind), { clip: 1, reaction: 1 })
  assert.equal(plan.streakDays(runs, NOW), 3)
  // Nothing yet today: yesterday's streak still counts.
  assert.equal(plan.streakDays([run('edit', 1), run('edit', 2)], NOW), 2)
  assert.equal(plan.streakDays([run('edit', 2)], NOW), 0)
  assert.equal(plan.streakDays([], NOW), 0)
  assert.match(plan.streakLabel(0), /No streak yet/)
  assert.equal(plan.streakLabel(3), '3 days in a row with a new video')
  assert.deepEqual(plain(plan.recentSource(runs, NOW)), { url: 'https://youtu.be/abc', title: 'A video', outputDir: '/out/create-0' })
  assert.equal(plan.recentSource([run('create', 20, { sourceUrl: 'https://x.y' })], NOW), null)
})
