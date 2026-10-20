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
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, AbortController,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/remix.ts')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-test-'))
const SETTINGS = { openrouterApiKey: 'or-key', outputDirectory: userData, pythonPath: 'python3' }
const selected = new Set()
const main = load('main/remix.ts', {
  electron: { app: { getPath: () => userData } },
  './avatars': { portraitPath: (id) => path.join(userData, id, 'portrait.jpg'), voiceSamplePath: (id) => path.join(userData, id, 'voice-sample.mp3'), readAvatar: () => ({}), readReactions: () => [] },
  './logger': { logger: { info() {}, warn() {} } },
  './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
  './security': { assertMediaPath: (p) => { if (!selected.has(p)) throw new Error('Invalid media path') } },
  './settings-store': { loadSettings: () => SETTINGS, getSettingsForBridge: () => ({}) },
  './tools': { resolveBinary: (name) => name }
})

const base = {
  sources: ['https://www.youtube.com/watch?v=abcdefghijk'], creator: '', angle: 'reaction', order: 'moment_first', host: 'lipsync', avatarId: 'a'.repeat(16),
  voice: 'avatar', brandIdentityId: null, count: 3, captionPreset: 'pop', includeCaptions: true, aiLabelAck: true
}

test('remix requests: links or chosen files, a style, a presenter, a voice, and the AI-label promise', () => {
  const { request, sourceIsUrl } = main.parseRemixRequest(base, userData)
  assert.equal(sourceIsUrl, true)
  assert.deepEqual(plain(request.sources), ['https://www.youtube.com/watch?v=abcdefghijk'])
  assert.equal(main.parseRemixRequest({ ...base, angle: 'mix', order: 'take_first' }, userData).request.order, 'take_first')
  // Several links, de-duplicated; the creator name only applies to a single video.
  assert.deepEqual([request.ctaKeyword, request.ctaOffer], ['', ''])
  const cta = main.parseRemixRequest({ ...base, ctaKeyword: ' sales ', ctaOffer: '  my   free playbook ' }, userData).request
  assert.deepEqual([cta.ctaKeyword, cta.ctaOffer], ['SALES', 'my free playbook'])
  assert.equal(main.parseRemixRequest({ ...base, ctaKeyword: '', ctaOffer: 'ignored without a keyword' }, userData).request.ctaOffer, '')
  assert.throws(() => main.parseRemixRequest({ ...base, ctaKeyword: 'two words' }, userData), /one word/)
  assert.throws(() => main.parseRemixRequest({ ...base, ctaKeyword: 'SALES', ctaOffer: 'x'.repeat(81) }, userData), /under 80/)
  // Word counts and the close's call to action match the engine.
  assert.equal(shared.wordCount('Stop #hustling now'), 2)
  assert.equal(shared.closeWithoutCta('Train the pull first. Comment SALES and I’ll send you my $9.99 course.'), 'Train the pull first.')
  // A call-to-action clip from the library: optional, by id only.
  assert.equal('ctaId' in main.parseRemixRequest(base, userData).request, false)
  assert.equal(main.parseRemixRequest({ ...base, ctaId: 'a1b2c3d4e5f60718' }, userData).request.ctaId, 'a1b2c3d4e5f60718')
  assert.throws(() => main.parseRemixRequest({ ...base, ctaId: '../../etc/passwd' }, userData), /call to action from your library/)
  // Hook text look: optional, normalized, strict.
  assert.equal('headlineLook' in main.parseRemixRequest(base, userData).request, false)
  assert.deepEqual(plain(main.parseRemixRequest({ ...base, headlineLook: { look: 'brand', color: '#ff8800', font: 'serif' } }, userData).request.headlineLook),
    { look: 'brand', color: '#FF8800', font: 'serif' })
  for (const headlineLook of [{ look: 'neon' }, { font: 'comic' }, { color: 'red' }, { look: 'white', extra: 1 }, 'white']) {
    assert.throws(() => main.parseRemixRequest({ ...base, headlineLook }, userData), /headline look/)
  }
  const many = main.parseRemixRequest({ ...base, creator: 'X', sources: ['https://a.com/1', ' https://a.com/1 ', 'https://b.com/2'] }, userData).request
  assert.deepEqual(plain(many.sources), ['https://a.com/1', 'https://b.com/2'])
  assert.equal(main.parseRemixRequest({ ...base, sources: ['https://a.com', 'https://a.com/'] }, userData).request.sources.length, 1)
  assert.equal(many.creator, '')
  assert.throws(() => main.parseRemixRequest({ ...base, sources: Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`) }, userData), /up to 10/)
  assert.throws(() => main.parseRemixRequest({ ...base, order: 'random' }, userData), /order/)
  assert.equal(main.parseRemixRequest({ ...base, host: 'voice', voice: 'Sarah', avatarId: 'junk' }, userData).request.avatarId, null)
  // Voice only can still borrow an avatar's voice; a preset is matched in any case.
  assert.equal(main.parseRemixRequest({ ...base, host: 'voice' }, userData).request.avatarId, 'a'.repeat(16))
  assert.throws(() => main.parseRemixRequest({ ...base, host: 'voice', avatarId: null }, userData), /whose voice/)
  assert.equal(main.parseRemixRequest({ ...base, voice: 'sarah' }, userData).request.voice, 'Sarah')
  // Silent react: needs an avatar (its reactions) and the clip-permission promise.
  assert.throws(() => main.parseRemixRequest({ ...base, format: 'silent' }, userData), /allowed to use these clips/)
  const silent = main.parseRemixRequest({ ...base, format: 'silent', clipRightsAck: true, host: 'voice', voice: 'Sarah' }, userData).request
  assert.deepEqual([silent.format, silent.clipRightsAck, silent.avatarId], ['silent', true, 'a'.repeat(16)])
  assert.throws(() => main.parseRemixRequest({ ...base, format: 'silent', clipRightsAck: true, avatarId: null }, userData), /reactions/)
  assert.throws(() => main.parseRemixRequest({ ...base, format: 'dance' }, userData), /kind of remix/)
  assert.equal(main.parseRemixRequest(base, userData).request.format, 'commentary')
  // Avatar on camera is made on HeyGen for a Voiced take; a clip reaction with it uses the avatar's photo.
  assert.equal(main.parseRemixRequest({ ...base, host: 'lipsync' }, userData).request.host, 'lipsync')
  assert.equal(main.parseRemixRequest({ ...base, host: 'lipsync', format: 'silent', clipRightsAck: true }, userData).request.host, 'still')
  assert.throws(() => main.parseRemixRequest({ ...base, voice: 'onyx' }, userData), /voice/)

  assert.throws(() => main.parseRemixRequest({ ...base, sources: [] }, userData), /video link/)
  assert.throws(() => main.parseRemixRequest({ ...base, sources: ['https://user:pw@example.com/v'] }, userData), /full video links/)
  assert.throws(() => main.parseRemixRequest({ ...base, sources: ['/etc/passwd'] }, userData), /full video links/)
  assert.throws(() => main.parseRemixRequest({ ...base, angle: 'repost' }, userData), /remix style/)
  assert.throws(() => main.parseRemixRequest({ ...base, host: 'clone' }, userData), /presenter/)
  assert.throws(() => main.parseRemixRequest({ ...base, avatarId: null }, userData), /Choose an avatar/)
  assert.throws(() => main.parseRemixRequest({ ...base, voice: 'Morgan Freeman' }, userData), /voice/)
  assert.throws(() => main.parseRemixRequest({ ...base, count: 11 }, userData), /between 1 and 10/)
  assert.throws(() => main.parseRemixRequest({ ...base, captionPreset: 'nope' }, userData), /caption style/)
  assert.throws(() => main.parseRemixRequest({ ...base, aiLabelAck: false }, userData), /AI-content label/)
  assert.throws(() => main.parseRemixRequest({ ...base, brandIdentityId: '../x' }, userData), /brand identity/)

  // A local file must have been chosen in the file dialog and needs the creator's name for the credit.
  const file = path.join(userData, 'clip.mp4')
  selected.add(file)
  assert.throws(() => main.parseRemixRequest({ ...base, sources: [file] }, userData), /original creator/)
  assert.equal(main.parseRemixRequest({ ...base, sources: [file], creator: ' Coach  Example ' }, userData).request.creator, 'Coach Example')
  const image = path.join(userData, 'photo.jpg')
  selected.add(image)
  assert.throws(() => main.parseRemixRequest({ ...base, sources: [image], creator: 'X' }, userData), /video file/)
  assert.throws(() => main.parseRemixRequest({ ...base, sources: [file, 'https://a.com/1'], creator: 'X' }, userData), /one file at a time/)
})

test('brand identities are saved, listed newest first, updated in place and removed', async () => {
  assert.deepEqual(plain(await main.listBrandIdentities()), [])
  await assert.rejects(main.saveBrandIdentity({ name: '', text: 'x'.repeat(100) }), /name/)
  await assert.rejects(main.saveBrandIdentity({ name: 'Pull-Up Lab', text: 'too short' }), /Paste the brand identity/)
  const text = 'We believe strength comes before weight loss. Our clients get their first pull-up in 6 weeks.'
  let list = await main.saveBrandIdentity({ name: '  Pull-Up   Lab ', text })
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'Pull-Up Lab')
  const id = list[0].id
  list = await main.saveBrandIdentity({ id, name: 'Pull-Up Lab v2', text: `${text} Updated.` })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, id)
  assert.equal(list[0].name, 'Pull-Up Lab v2')
  assert.equal((await main.readBrandIdentity(id)).text.endsWith('Updated.'), true)
  await assert.rejects(main.saveBrandIdentity({ id: 'f'.repeat(16), name: 'X', text }), /could not be found/)
  assert.deepEqual(plain(await main.removeBrandIdentity(id)), [])
})

test('brand identity files: text or markdown only', async () => {
  const md = path.join(userData, 'Pull Up Brand.md')
  fs.writeFileSync(md, '# Beliefs\r\nStrength first.\r\n')
  assert.deepEqual(plain(await main.readBrandIdentityFile(md)), { name: 'Pull Up Brand', text: '# Beliefs\nStrength first.', truncated: false })
  const pdf = path.join(userData, 'brand.pdf')
  fs.writeFileSync(pdf, '%PDF')
  await assert.rejects(main.readBrandIdentityFile(pdf), /\.txt or \.md/)
})

test('engine results are parsed defensively', () => {
  assert.equal(shared.parseRemixOutput(null), null)
  assert.equal(shared.parseRemixOutput({ path: 1 }), null)
  const out = shared.parseRemixOutput({
    path: '/o/01 x.mp4', manifest_path: '/o/01 x.json', headline: '  He   said what ', stance: 'evil', excerpt_seconds: 4.2, duration_seconds: 'x',
    cost_usd: 0.61, checks: [{ id: 'credited', ok: true, label: 'Credited' }, { bogus: 1 }], warnings: ['w', 5]
  })
  assert.deepEqual(plain(out), {
    path: '/o/01 x.mp4', manifestPath: '/o/01 x.json', headline: 'He said what', stance: 'add_nuance', excerptSeconds: 4.2, durationSeconds: 0, costUsd: 0.61,
    checks: [{ id: 'credited', ok: true, label: 'Credited' }], warnings: ['w'], style: 'reaction', grade: null, creator: '', postCaption: ''
  })
  assert.equal(shared.parseRemixOutput({ path: '/a.mp4', manifest_path: '/a.json', post_caption: 'Hook\r\n\n\n\n1.   One\n2. Two  ' }).postCaption, 'Hook\n\n1. One\n2. Two')
})

test('drafts from the engine and edits from the renderer are checked', () => {
  const draft = shared.parseRemixDraft({
    id: 2, source_title: 'Pull-ups 101', creator: 'Coach', start_ms: 4000, end_ms: 8000, quote: 'you must lose weight', why: 'claim',
    style: 'myth_truth', stance: 'disagree_correct', headline: 'This coach says lose weight first', intro: 'He is wrong.', close: 'Train the pull.',
    beats: [{ text: 'Strength first.', broll: 'pull up bar' }, 'junk'], notes: ['n'], grade: { letter: 'A', score: 12, verdict: 'v', fix: 'f' }, estimate_usd: 0.6,
    post_caption: 'Stop dieting first.\n\n1. Strength first.\n\nComment SALES and I\'ll send you my plan.'
  })
  assert.equal(draft.grade.score, 10)
  assert.equal(draft.postCaption, 'Stop dieting first.\n\n1. Strength first.\n\nComment SALES and I\'ll send you my plan.')
  assert.equal(draft.beats.length, 1)
  assert.equal(shared.parseRemixDraft({ id: -1, headline: 'x', intro: 'y', close: 'z', beats: [] }), null)
  assert.equal(shared.parseRemixDraft({ ...draft, id: 'x' }), null)

  const ids = new Set([0, 2])
  const edits = shared.parseRemixEdits([
    { id: 2, headline: 'This coach says lose weight first', intro: 'Wrong.', close: 'Done.', beats: [{ text: 'Do negatives.', broll: 'gym' }, { text: ' ' }] },
    { id: 2, headline: 'Duplicate is ignored here', intro: 'x', close: 'y', beats: [{ text: 'z' }] },
    { id: 7, headline: 'Not a planned draft at all', intro: 'x', close: 'y', beats: [{ text: 'z' }] }
  ], ids)
  assert.deepEqual(plain(edits), [{ id: 2, headline: 'This coach says lose weight first', intro: 'Wrong.', close: 'Done.', beats: [{ text: 'Do negatives.', broll: 'gym' }] }])
  assert.throws(() => shared.parseRemixEdits([], ids), /at least one/)
  assert.throws(() => shared.parseRemixEdits([{ id: 0, headline: 'Too short', intro: 'x', close: 'y', beats: [{ text: 'z' }] }], ids), /at least 3 words/)
  const long = Array.from({ length: 50 }, () => 'word').join(' ')
  assert.throws(() => shared.parseRemixEdits([{ id: 0, headline: 'A fine long headline', intro: long, close: 'y', beats: [{ text: 'z' }] }], ids), /“A fine long headline”: Keep the opening to 35 words/)
  assert.equal(shared.remixEditProblem({ headline: 'A fine long headline', intro: 'x', close: 'y', beats: [{ text: ' ' }] }), 'Keep at least one voice-over beat.')
  assert.throws(() => shared.parseRemixEdits([{ id: 9 }], ids), /at least one/)
  const captioned = shared.parseRemixEdits([{ id: 0, headline: 'A fine long headline', intro: 'x', close: 'y', beats: [{ text: 'z' }], postCaption: 'Line one\n\n1. Two' }], ids)
  assert.equal(captioned[0].postCaption, 'Line one\n\n1. Two')
  assert.throws(() => shared.parseRemixEdits([{ id: 0, headline: 'A fine long headline', intro: 'x', close: 'y', beats: [{ text: 'z' }], postCaption: 'x'.repeat(2300) }], ids), /caption to 2,000/)
})

test('silent drafts: headline and caption only, reactions parsed; edits skip the spoken lines', () => {
  const draft = shared.parseRemixDraft({ id: 0, headline: 'This creator says your reel made nothing', intro: '', close: '', beats: [], format: 'silent',
    cues: [{ at: 0, reaction: 'listen' }, { at: 6.5, reaction: 'point' }, { at: 'x', reaction: 'nod' }], post_caption: 'Take.', estimate_usd: 0 })
  assert.equal(draft.format, 'silent')
  assert.deepEqual(plain(draft.cues), [{ at: 0, reaction: 'listen' }, { at: 6.5, reaction: 'point' }])
  assert.equal(shared.remixEditProblem({ headline: 'A fine long headline', intro: '', beats: [], close: '' }, 'silent'), null)
  assert.equal(shared.remixEditProblem({ headline: 'Too short', intro: '', beats: [], close: '' }, 'silent'), 'The headline needs at least 3 words.')
  const edits = shared.parseRemixEdits([{ id: 0, headline: 'A fine long headline', intro: '', close: '', beats: [], postCaption: 'My take.' }], new Set([0]), new Set([0]))
  assert.equal(edits[0].postCaption, 'My take.')
  assert.throws(() => shared.parseRemixEdits([{ id: 0, headline: 'A fine long headline', intro: '', close: '', beats: [] }], new Set([0])), /opening line/)
  assert.equal(shared.estimateRemixCost('still', 3, 1, 'silent').perRemixHigh, 0)
})

test('comment-keyword call to action', () => {
  assert.equal(shared.normalizeCtaKeyword(' sales '), 'SALES')
  assert.equal(shared.normalizeCtaKeyword(''), '')
  assert.equal(shared.normalizeCtaKeyword(undefined), '')
  for (const bad of ['two words', 'x', 'a'.repeat(21), '-dash', 5]) assert.equal(shared.normalizeCtaKeyword(bad), null)
  assert.equal(shared.brandCtaKeyword('CALL TO ACTION: Comment "PULL-UP" for the free plan'), 'PULL-UP')
  assert.equal(shared.brandCtaKeyword('Comment below what you think'), '')
  assert.equal(shared.brandCtaKeyword("comment 'guide' and we'll DM you"), 'GUIDE')
  assert.equal(shared.brandCtaKeyword('No call to action here'), '')
  assert.equal(shared.ctaLine('SALES', ' my playbook. '), "Comment SALES and I'll send you my playbook.")
  assert.equal(shared.ctaLine('SALES', ''), 'Comment SALES.')
  // The call to action doesn't count toward the close's 35 words.
  const thirty = Array.from({ length: 22 }, () => 'word').join(' ')
  assert.equal(shared.closeWithoutCta(`${thirty}. Comment SALES and I'll send you my free playbook.`), `${thirty}.`)
  assert.equal(shared.closeWithoutCta('Comment SALES now.'), '')
  assert.equal(shared.closeWithoutCta('Train the pull, not the scale.'), 'Train the pull, not the scale.')
  const edit = { headline: 'A fine long headline', intro: 'x', beats: [{ text: 'z' }] }
  assert.equal(shared.remixEditProblem({ ...edit, close: `${thirty}. Comment SALES and I'll send you my free playbook.` }), null)
  assert.match(shared.remixEditProblem({ ...edit, close: `${thirty} one two three four. Comment SALES.` }), /25 words/)
})

test('cleanup removes leftovers of abandoned runs but never finished videos', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-clean-'))
  const id = () => `remix-${require('node:crypto').randomUUID()}`
  const abandoned = path.join(out, id()), finished = path.join(out, id()), cancelled = path.join(out, id()), other = path.join(out, 'remix-notes')
  for (const dir of [abandoned, finished, cancelled, other]) fs.mkdirSync(path.join(dir, '.work'), { recursive: true })
  fs.writeFileSync(path.join(abandoned, '.presenter.jpg'), 'x')
  fs.writeFileSync(path.join(finished, 'job_output.json'), '{}')
  fs.writeFileSync(path.join(cancelled, 'clip_00.mp4'), 'video')
  await main.cleanupAbandoned(out)
  assert.equal(fs.existsSync(abandoned), false)
  assert.equal(fs.existsSync(path.join(finished, 'job_output.json')), true)
  assert.equal(fs.existsSync(path.join(cancelled, 'clip_00.mp4')), true)
  assert.equal(fs.existsSync(path.join(cancelled, '.work')), false)
  assert.equal(fs.existsSync(path.join(other, '.work')), true, 'only remix-<uuid> folders are touched')
})

test('variety guard: too many remixes of one creator in a week gets a warning', async () => {
  fs.writeFileSync(path.join(userData, 'remix-ledger.json'), JSON.stringify([
    ...Array.from({ length: 4 }, () => ({ creator: 'coach', at: new Date().toISOString() })),
    { creator: 'coach', at: '2020-01-01T00:00:00Z' }
  ]))
  const drafts = [{ creator: 'Coach' }, { creator: 'Coach' }, { creator: 'Other' }]
  const warnings = await main.varietyWarnings(drafts)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /6 remixes of Coach/)
})

test('the presenter speaks with the avatar’s clone, its preset, or the preset chosen in Remix', () => {
  const clone = { clonedAt: 'x', transcript: 'hi' }
  assert.deepEqual(plain(main.remixVoice('avatar', { voice: { provider: 'clone', clonedAt: 'x' }, clonedVoice: clone })), { preset: 'brian', cloned: clone })
  assert.deepEqual(plain(main.remixVoice('avatar', { voice: { provider: 'elevenlabs', voice: 'Harry' }, clonedVoice: clone })), { preset: 'harry', cloned: null })
  assert.deepEqual(plain(main.remixVoice('Sarah', { voice: { provider: 'clone', clonedAt: 'x' }, clonedVoice: clone })), { preset: 'sarah', cloned: null })
  assert.deepEqual(plain(main.remixVoice('avatar', null)), { preset: 'brian', cloned: null })
})

test('cost estimate: the on-camera avatar is the main cost, voice-only is cents', () => {
  const lipsync = shared.estimateRemixCost('lipsync', 1, 0.5)
  const voice = shared.estimateRemixCost('voice', 1, 0.5)
  // HeyGen's published Avatar IV price for the opening and closing lines (10-23 seconds), plus the voice.
  assert.equal(shared.REMIX_PRICES.avatarPerSecond, 0.1)
  assert.ok(Math.abs(lipsync.perRemixLow - 1.03) < 1e-9 && Math.abs(lipsync.perRemixHigh - 2.33) < 1e-9)
  assert.ok(voice.perRemixHigh < 0.05)
  assert.ok(shared.estimateRemixCost('lipsync', 3, 1).total > lipsync.total)
  assert.equal(shared.remixSourceUrl('ftp://x.com/a'), null)
  assert.equal(shared.remixSourceUrl('https://localhost/a'), null)
})

test('Me, on camera: requests need no avatar or AI label; the background choice is checked', () => {
  const camera = main.parseRemixRequest({ ...base, host: 'camera', avatarId: null, aiLabelAck: false, camera: { layout: 'cutout', backdrop: 'brand', backdropColor: '#ff8800' } }, userData).request
  assert.deepEqual([camera.host, camera.avatarId], ['camera', null])
  assert.deepEqual(plain(camera.camera), { layout: 'cutout', backdrop: 'brand', backdropColor: '#FF8800', talk: false })
  // Silent react on camera: no reactions to make, but the clip-permission promise still applies.
  const silent = main.parseRemixRequest({ ...base, host: 'camera', avatarId: null, aiLabelAck: false, format: 'silent', clipRightsAck: true, camera: { layout: 'greenscreen', backdrop: 'blur', backdropColor: '#111111', talk: true } }, userData).request
  assert.equal(silent.camera.talk, true)
  assert.throws(() => main.parseRemixRequest({ ...base, host: 'camera', format: 'silent' }, userData), /allowed to use these clips/)
  for (const bad of [{ layout: 'hologram', backdrop: 'blur', backdropColor: '#111111' }, { layout: 'cutout', backdrop: 'blur', backdropColor: 'red' }, 'filmed']) {
    assert.throws(() => main.parseRemixRequest({ ...base, host: 'camera', camera: bad }, userData), /how you appear on camera/)
  }
  // The avatar presenter still needs the AI label.
  assert.throws(() => main.parseRemixRequest({ ...base, host: 'still', aiLabelAck: false }, userData), /AI-content label/)
  assert.deepEqual(plain(shared.partsFor('silent', 3)), ['reaction'])
  assert.deepEqual(plain(shared.partsFor('commentary', 2)), ['intro', 'beat0', 'beat1', 'close'])
})

test('Me, on camera: recordings are saved per take and part, uploads copied in, and passed to the engine', async () => {
  const { EventEmitter } = require('node:events')
  const childProcess = require('node:child_process')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-camera-'))
  const settings = { ...SETTINGS, outputDirectory: out }
  const configs = []
  const plan = (config) => {
    const work = path.join(config.output_dir, '.work')
    fs.mkdirSync(work, { recursive: true })
    const video = path.join(work, 'source.mp4')
    childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
    fs.writeFileSync(path.join(work, 'plan.json'), JSON.stringify({ sources: [{ video }] }))
    return { ok: true, cost_usd: 0.02, drafts: [
      { id: 0, source_index: 0, headline: 'This coach says lose weight first', intro: 'He is wrong.', close: 'Train the pull.', beats: [{ text: 'Strength first.', broll: 'gym' }], start_ms: 1000, end_ms: 4000, estimate_usd: 0.01 },
      { id: 1, source_index: 0, headline: 'Another take on the same claim', intro: 'Hold on.', close: 'Pull first.', beats: [{ text: 'Do negatives.', broll: 'bar' }], estimate_usd: 0.01 }
    ] }
  }
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      const result = config.mode === 'plan' ? plan(config) : { ok: true, remixes: [] }
      setImmediate(() => { child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0) })
    } }
    return child
  }
  const camera = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const statuses = []
  camera.onRemixStatus((status) => statuses.push(status))
  await assert.rejects(camera.beginRecording(0, 'intro', 'video/webm'), /once your takes are ready/)
  await camera.startRemix({ ...base, host: 'camera', avatarId: null, aiLabelAck: false, camera: { layout: 'greenscreen', backdrop: 'blur', backdropColor: '#111111' } })
  for (let i = 0; i < 100 && camera.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  const status = camera.remixStatus()
  assert.equal(status.phase, 'review')
  assert.equal(status.onCamera, true)
  assert.deepEqual([configs[0].host, configs[0].camera_layout, configs[0].camera_talk, configs[0].avatar_photo], ['camera', 'greenscreen', false, null])

  // The moment to react to.
  const moment = await camera.remixMoment(0)
  assert.deepEqual([moment.startSeconds, moment.endSeconds], [1, 4])
  assert.match(moment.path, /source\.mp4$/)
  await assert.rejects(camera.remixMoment(9), /no longer in this review/)

  // Recording in chunks; an empty recording isn't kept; parts are checked.
  await assert.rejects(camera.beginRecording(0, 'reaction', 'video/webm'), /what to record/)
  await assert.rejects(camera.beginRecording(0, '../x', 'video/webm'), /what to record/)
  const empty = await camera.beginRecording(0, 'intro', 'video/webm')
  await assert.rejects(camera.finishRecording(empty, null), /Nothing was recorded/)
  const clip = path.join(out, 'take.webm')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=160x120:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-c:v', 'libvpx', '-c:a', 'libopus', clip])
  const bytes = fs.readFileSync(clip)
  const token = await camera.beginRecording(0, 'intro', 'video/webm;codecs=vp9,opus')
  await camera.appendRecording(token, new Uint8Array(bytes.subarray(0, 500)))
  await camera.appendRecording(token, new Uint8Array(bytes.subarray(500)))
  let list = await camera.finishRecording(token, 2)
  assert.equal(fs.readFileSync(list[0].intro.path).equals(bytes), true)
  assert.equal(list[0].intro.uploaded, false)
  assert.ok(list[0].intro.seconds > 0.5)
  assert.equal(path.dirname(list[0].intro.path), path.join(status.folder, '.recordings'))
  await assert.rejects(camera.appendRecording(token, new Uint8Array(4)), /stopped/)

  // A redo replaces the earlier file.
  const first = list[0].intro.path
  const again = await camera.beginRecording(0, 'intro', 'video/webm')
  await camera.appendRecording(again, new Uint8Array(bytes))
  list = await camera.finishRecording(again, null)
  assert.notEqual(list[0].intro.path, first)
  assert.equal(fs.existsSync(first), false)

  // Uploads from a phone: videos only.
  const phone = path.join(out, 'phone.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', phone])
  list = await camera.uploadRecording(0, 'beat0', phone)
  assert.equal(list[0].beat0.uploaded, true)
  await assert.rejects(camera.uploadRecording(0, 'close', path.join(out, 'notes.txt')), /Choose a video/)

  // Making them needs every part of every approved take.
  const edit = (id) => ({ id, headline: status.drafts[id].headline, intro: status.drafts[id].intro, close: status.drafts[id].close, beats: status.drafts[id].beats })
  await assert.rejects(camera.renderRemix([edit(0)]), /Record “This coach says lose weight first” first \(1 part left\)/)
  await assert.rejects(camera.renderRemix([edit(1)]), /nothing recorded yet/)
  list = await camera.uploadRecording(0, 'close', phone)
  list = await camera.removeRecording(0, 'close')
  assert.equal(list[0].close, undefined)
  list = await camera.uploadRecording(0, 'close', phone)
  await camera.renderRemix([edit(0)])
  const render = configs[1]
  assert.equal(render.mode, 'render')
  assert.deepEqual(Object.keys(render.recordings), ['0'])
  assert.deepEqual(render.recordings['0'], { intro: list[0].intro.path, beats: [list[0].beat0.path], close: list[0].close.path })
  for (let i = 0; i < 100 && camera.remixStatus()?.phase === 'rendering'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  // The recordings are removed once the videos are made.
  assert.equal(fs.existsSync(path.join(status.folder, '.recordings')), false)
  fs.rmSync(out, { recursive: true, force: true })
})

test('Article or post: a screenshot run starts in review, writes its headline from the recording, then renders over the image', async () => {
  const { EventEmitter } = require('node:events')
  const childProcess = require('node:child_process')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-image-'))
  const settings = { ...SETTINGS, outputDirectory: out }
  const configs = []
  let writeResult = null
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      const result = config.mode === 'write' ? writeResult : { ok: true, remixes: [] }
      setImmediate(() => { child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0) })
    } }
    return child
  }
  const chosen = new Set()
  const camera = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: (p) => { if (!chosen.has(p)) throw new Error('Invalid media path') }, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const shot = path.join(out, 'article.png')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=400x1200', '-frames:v', '1', shot])
  chosen.add(shot)
  const imageBase = { ...base, sources: [shot], format: 'image', creator: 'The Daily Example', clipRightsAck: true, aiLabelAck: false, host: 'still', avatarId: null }

  // Requests: one chosen screenshot, a credit, the sharing promise; always you, always talking, one take.
  const request = camera.parseRemixRequest(imageBase, out).request
  assert.deepEqual([request.host, request.format, request.count, request.camera.layout, request.camera.talk], ['camera', 'image', 1, 'greenscreen', true])
  assert.equal(camera.parseRemixRequest({ ...imageBase, camera: { layout: 'cutout', backdrop: 'blur', backdropColor: '#111111', talk: false } }, out).request.camera.talk, true)
  assert.throws(() => camera.parseRemixRequest({ ...imageBase, creator: '' }, out), /where the screenshot is from/)
  assert.throws(() => camera.parseRemixRequest({ ...imageBase, clipRightsAck: false }, out), /share this screenshot/)
  assert.throws(() => camera.parseRemixRequest({ ...imageBase, sources: ['https://example.com/a.png'] }, out), /screenshot again/)
  assert.throws(() => camera.parseRemixRequest({ ...imageBase, sources: [shot, shot + 'x'] }, out), /one screenshot/)
  const video = path.join(out, 'clip.mp4'); fs.writeFileSync(video, 'x'); chosen.add(video)
  assert.throws(() => camera.parseRemixRequest({ ...imageBase, sources: [video] }, out), /JPG, PNG or WebP/)

  // Starting goes straight to review with one take to record; the engine isn't run yet.
  const started = await camera.startRemix(imageBase)
  assert.equal(started.phase, 'review')
  assert.equal(configs.length, 0)
  assert.equal(started.drafts.length, 1)
  assert.deepEqual([started.drafts[0].format, started.drafts[0].headline, started.drafts[0].creator], ['image', '', 'The Daily Example'])
  const moment = await camera.remixMoment(0)
  assert.equal(moment.kind, 'image')
  assert.equal(path.dirname(moment.path), path.join(started.folder, '.work'))
  assert.equal(fs.readFileSync(moment.path).equals(fs.readFileSync(shot)), true)
  await assert.rejects(camera.writeRemix(), /Record your take first/)
  await assert.rejects(camera.renderRemix([{ id: 0, headline: '', intro: '', close: '', beats: [] }]), /headline/)

  // Record (here: an upload), then write: the engine gets the screenshot, the credit and the take.
  const phone = path.join(out, 'phone.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', phone])
  const list = await camera.uploadRecording(0, 'reaction', phone)
  const wait = async () => { for (let i = 0; i < 100 && camera.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20)) }
  // A failed write keeps the take and the recording.
  writeResult = { ok: false, error: 'We couldn’t hear you in that recording. Record it again with your microphone on.' }
  assert.equal((await camera.writeRemix()).phase, 'planning')
  await wait()
  assert.match(camera.remixStatus().error, /couldn’t hear you/)
  assert.equal(camera.remixRecordings()[0].reaction.path, list[0].reaction.path)
  writeResult = { ok: true, cost_usd: 0.015, drafts: [{ id: 0, format: 'image', headline: 'This paper says remote work is over', intro: '', close: '', beats: [], quote: 'So this article claims…', post_caption: 'My take.\n\nSource: The Daily Example', estimate_usd: 0.01 }] }
  await camera.writeRemix()
  await wait()
  const write = configs[1]
  assert.equal(write.mode, 'write')
  assert.deepEqual(write.sources, [])
  assert.deepEqual(write.image_source, { path: moment.path, credit: 'The Daily Example' })
  assert.deepEqual(write.recordings, { 0: { reaction: { path: list[0].reaction.path, offset_s: 0 } } })
  assert.equal(write.camera_talk, true)
  const reviewed = camera.remixStatus()
  assert.equal(reviewed.error, null)
  assert.equal(reviewed.drafts[0].headline, 'This paper says remote work is over')
  assert.equal(reviewed.drafts[0].postCaption, 'My take.\n\nSource: The Daily Example')
  assert.ok(Math.abs(reviewed.costUsd - 0.015) < 1e-9)

  // Make it: the edited headline and the take go to the engine.
  await camera.renderRemix([{ id: 0, headline: 'Remote work is over, says this paper', intro: '', close: '', beats: [] }])
  const render = configs[configs.length - 1]
  assert.equal(render.mode, 'render')
  assert.equal(render.approved[0].headline, 'Remote work is over, says this paper')
  assert.deepEqual(render.recordings, { 0: { reaction: { path: list[0].reaction.path, offset_s: 0 } } })
  fs.rmSync(out, { recursive: true, force: true })
})

test('on-camera review safety: saving blocks making, edits survive a failed start, unknown offsets stay unknown, long uploads are refused', async () => {
  const { EventEmitter } = require('node:events')
  const childProcess = require('node:child_process')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-safety-'))
  const settings = { ...SETTINGS, outputDirectory: out }
  const configs = []
  let failSpawn = false
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      setImmediate(() => {
        if (failSpawn) { child.emit('error', new Error('ENOENT')); return }
        if (config.mode === 'plan') {
          const work = path.join(config.output_dir, '.work'); fs.mkdirSync(work, { recursive: true })
          fs.writeFileSync(path.join(work, 'plan.json'), JSON.stringify({ sources: [] }))
          child.stdout.emit('data', JSON.stringify({ ok: true, drafts: [{ id: 0, source_index: 0, format: 'silent', headline: 'This coach says lose weight first', intro: '', close: '', beats: [], start_ms: 0, end_ms: 3000 }] }) + '\n')
        }
        child.emit('close', 0)
      })
    } }
    return child
  }
  const chosen = new Set()
  const m = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: (p) => { if (!chosen.has(p)) throw new Error('Invalid media path') }, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const waitFor = async (phase) => { for (let i = 0; i < 100 && m.remixStatus()?.phase !== phase; i++) await new Promise((resolve) => setTimeout(resolve, 20)) }
  await m.startRemix({ ...base, host: 'camera', avatarId: null, aiLabelAck: false, format: 'silent', clipRightsAck: true })
  await waitFor('review')

  // A reaction whose clip never played keeps an unknown offset (the engine lines it up by sound).
  const clip = path.join(out, 'take.webm')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=160x120:d=1', '-c:v', 'libvpx', clip])
  const token = await m.beginRecording(0, 'reaction', 'video/webm')
  await m.appendRecording(token, new Uint8Array(fs.readFileSync(clip)))
  // Still recording: nothing can be made yet.
  const edit = { id: 0, headline: 'My edited headline for this', intro: '', close: '', beats: [] }
  await assert.rejects(m.renderRemix([edit]), /finish saving/)
  await m.finishRecording(token, null)

  // The engine can't start: back to review with the edit and the recording kept.
  failSpawn = true
  await m.renderRemix([edit])
  await waitFor('review')
  const back = m.remixStatus()
  assert.match(back.error, /could not start/)
  assert.equal(back.drafts[0].headline, 'My edited headline for this')
  assert.equal(Object.keys(m.remixRecordings()[0]).length, 1)
  failSpawn = false
  await m.renderRemix([edit])
  const render = configs[configs.length - 1]
  assert.equal(render.recordings['0'].reaction.offset_s, null)
  await waitFor('done')
  fs.rmSync(out, { recursive: true, force: true })
})

test('article or post: a phone take longer than 3 minutes is refused; a review closed mid-upload keeps nothing', async () => {
  const childProcess = require('node:child_process')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-long-'))
  const settings = { ...SETTINGS, outputDirectory: out }
  const chosen = new Set()
  const m = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: (p) => { if (!chosen.has(p)) throw new Error('Invalid media path') }, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const shot = path.join(out, 'post.png')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=200x200', '-frames:v', '1', shot])
  chosen.add(shot)
  await m.startRemix({ ...base, sources: [shot], format: 'image', creator: '@someone', clipRightsAck: true, aiLabelAck: false, avatarId: null })
  const long = path.join(out, 'long.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=185:r=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', long])
  await assert.rejects(m.uploadRecording(0, 'reaction', long), /3 minutes/)
  assert.deepEqual(plain(m.remixRecordings()), {})
  const short = path.join(out, 'short.mp4')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', short])
  const upload = m.uploadRecording(0, 'reaction', short)
  await m.discardRemix()
  await assert.rejects(upload, /review was closed/)
  fs.rmSync(out, { recursive: true, force: true })
})

test('re-editing a finished remix: checked, rebuilt from its saved parts, call to action added back, Library updated', async () => {
  const { EventEmitter } = require('node:events')
  const childProcess = require('node:child_process')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-recompose-'))
  const settings = { ...SETTINGS, outputDirectory: out }
  const configs = []
  let fail = false
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      setImmediate(() => {
        const result = fail ? { ok: false, error: 'This video was made before editing was possible. Make it again to edit it.' }
          : (fs.writeFileSync(config.output_path, 'NEW VIDEO'), { ok: true, path: config.output_path, duration_seconds: 12.5,
            editable: { split: true, split_value: config.split ?? 0.28, settings: { headline: config.headline, headline_look: config.headline_look, include_captions: config.include_captions, caption_preset: config.caption_preset, split: config.split } } })
        child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0)
      })
    } }
    return child
  }
  const ctaCalls = []
  let locked = 0, ctaMissing = false
  const m = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn },
    './ctas': { applyRunCta: async () => ({ failed: [], cancelled: false }), readCta: () => ({}),
      applyRunCtaInLock: async (run, id, indices) => {
        ctaCalls.push([run, id, indices])
        if (id && ctaMissing) throw new Error('That call to action is no longer in your library. Choose another.')
        if (!id) { fs.copyFileSync(path.join(run, 'clip_00.original.mp4'), path.join(run, 'clip_00.mp4')); fs.rmSync(path.join(run, 'clip_00.original.mp4')) }
        return { failed: [], cancelled: false }
      },
      withRunLock: async (_run, work) => { locked++; try { return await work() } finally { locked-- } },
      originalPath: (p) => p.replace(/\.mp4$/, '.original.mp4') },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const folder = path.join(out, 'remix-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b')
  fs.mkdirSync(path.join(folder, '.edit', 'clip_00'), { recursive: true })
  fs.writeFileSync(path.join(folder, '.edit', 'clip_00', 'edit.json'), '{"version":1}')
  fs.writeFileSync(path.join(folder, 'clip_00.mp4'), 'WITH CTA')
  fs.writeFileSync(path.join(folder, 'clip_00.original.mp4'), 'OLD VIDEO')
  fs.writeFileSync(path.join(folder, 'clip_01.mp4'), 'OLD')
  fs.writeFileSync(path.join(folder, 'job_output.json'), JSON.stringify({ job_id: 'x', clips: [
    { clip_index: 0, headline: 'Old hook text here', cta: { id: 'a1b2c3d4e5f60718', name: 'Book a call' }, editable: { split: true, split_value: 0.28 } },
    { clip_index: 1, headline: 'Made before editing existed' }] }))
  const edit = { headline: 'A brand new hook  for this', headlineLook: { look: 'black', color: '#FFFFFF', font: 'serif' }, includeCaptions: false, captionPreset: 'pop', split: 0.45 }

  // Checked first: only remix runs in the output folder, a real clip, sensible settings.
  await assert.rejects(m.recomposeRemix(path.join(os.tmpdir(), 'remix-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'), 0, edit), /Only Remix videos/)
  await assert.rejects(m.recomposeRemix(path.join(out, 'my-run'), 0, edit), /Only Remix videos/)
  await assert.rejects(m.recomposeRemix(folder, 7, edit), /no longer in this run/)
  await assert.rejects(m.recomposeRemix(folder, 0, { ...edit, headline: 'Too short' }), /at least 3 words/)
  await assert.rejects(m.recomposeRemix(folder, 0, { ...edit, headline: Array.from({ length: 17 }, () => 'word').join(' ') }), /16 words/)
  await assert.rejects(m.recomposeRemix(path.join(out, 'remix-' + '-'.repeat(36)), 0, edit), /Only Remix videos/)
  await assert.rejects(m.recomposeRemix(folder, 0, { ...edit, split: 0.9 }), /between 30% and 70%/)
  await assert.rejects(m.recomposeRemix(folder, 0, { ...edit, headlineLook: { look: 'neon' } }), /headline look/i)
  await assert.rejects(m.recomposeRemix(folder, 1, edit), /made before editing was possible/)
  assert.equal(configs.length, 0, 'nothing ran')

  // While it's being re-made, the Library leaves the run alone.
  const pending = m.recomposeRemix(folder, 0, edit)
  assert.match(m.remixRunBusy(folder), /being re-made/)
  await assert.rejects(m.recomposeRemix(folder, 0, edit), /Another video is being re-made/)
  assert.equal(await pending, null)
  assert.equal(m.remixRunBusy(folder), null)
  assert.equal(locked, 0)
  assert.deepEqual(configs[0], { mode: 'recompose', output_dir: folder, clip: 'clip_00', output_path: configs[0].output_path, headline: 'A brand new hook for this',
    headline_look: { look: 'black', color: '#FFFFFF', font: 'serif' }, include_captions: false, caption_preset: 'pop', split: 0.45, final_name: 'clip_00.mp4' })
  assert.equal(path.dirname(configs[0].output_path), folder)
  // The plain video (.original) is replaced and the call to action added back on top.
  assert.equal(fs.readFileSync(path.join(folder, 'clip_00.original.mp4'), 'utf8'), 'NEW VIDEO')
  assert.deepEqual(plain(ctaCalls), [[folder, 'a1b2c3d4e5f60718', [0]]])
  assert.ok(JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8')).clips[0].edited_at)
  const job = JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8'))
  assert.equal(job.clips[0].headline, 'A brand new hook for this')
  assert.equal(job.clips[0].editable.split_value, 0.45)
  assert.equal(fs.readdirSync(folder).some((name) => name.startsWith('.recompose-') || name.startsWith('.job_output-')), false, 'no temp files left')
  // The Library reads the new settings and size.
  const full = (clip) => ({ s3_url: 'file:///x.mp4', duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, virality_score: 1, ...clip })
  const parsed = load('shared/job-output.ts').parseJobOutput({ ...job, clips: job.clips.map(full) })
  assert.equal(parsed.clips[0].remix_settings.split, 0.45)
  assert.equal(parsed.clips[0].remix_settings.headline, 'A brand new hook for this')
  assert.equal(parsed.clips[1].editable, null)

  // The call to action was deleted from the library: the new video is kept, without it, and the member is told.
  ctaMissing = true
  const note = await m.recomposeRemix(folder, 0, edit)
  assert.match(note, /couldn’t be added back/)
  assert.equal(fs.readFileSync(path.join(folder, 'clip_00.mp4'), 'utf8'), 'NEW VIDEO')
  assert.equal(fs.existsSync(path.join(folder, 'clip_00.original.mp4')), false)
  // A clip without a call to action (and a stray .original) is simply replaced.
  fs.writeFileSync(path.join(folder, 'clip_00.original.mp4'), 'STRAY')
  const plainJob = JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8'))
  plainJob.clips[0].cta = null
  fs.writeFileSync(path.join(folder, 'job_output.json'), JSON.stringify(plainJob))
  assert.equal(await m.recomposeRemix(folder, 0, edit), null)
  assert.equal(fs.existsSync(path.join(folder, 'clip_00.original.mp4')), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8')).clips[0].duration_ms, 12500)
  // An engine failure keeps the video as it was.
  fail = true
  await assert.rejects(m.recomposeRemix(folder, 0, edit), /made before editing was possible/)
  assert.equal(fs.readFileSync(path.join(folder, 'clip_00.mp4'), 'utf8'), 'NEW VIDEO')
  fs.rmSync(out, { recursive: true, force: true })
})

test('editing a take in review: held to the same rules, saved on the status, marked as edited, and used when made', async () => {
  const { EventEmitter } = require('node:events')
  const childProcess = require('node:child_process')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-edit-'))
  const settings = { ...SETTINGS, outputDirectory: out }
  const configs = []
  const take = (id, format = 'commentary') => ({ id, format, headline: 'You do not need to lose weight', intro: 'Here is the truth.', close: 'Train the pull first.', beats: [{ text: 'Strength first.', broll: 'gym' }],
    quote: 'q', post_caption: 'My take.', estimate_usd: 0.03, grade: { letter: 'B', score: 7, verdict: 'ok', fix: 'f' } })
  const spawn = () => {
    const child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdin = { on() {}, end(text) {
      const config = JSON.parse(text)
      configs.push(config)
      const result = config.mode === 'plan' ? { ok: true, cost_usd: 0.1, drafts: [take(0), { ...take(1, 'silent'), intro: '', close: '', beats: [] }] } : { ok: true, remixes: [] }
      setImmediate(() => { child.stdout.emit('data', JSON.stringify(result) + '\n'); child.emit('close', 0) })
    } }
    return child
  }
  const remix = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => null, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => {}, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const seen = []
  remix.onRemixStatus((status) => seen.push(status))
  assert.throws(() => remix.editRemixDraft({ id: 0, headline: 'A new hook here' }), /no takes waiting/)
  await remix.startRemix({ ...base, host: 'voice', voice: 'Brian', avatarId: null })
  for (let i = 0; i < 100 && remix.remixStatus()?.phase !== 'review'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(remix.remixStatus().phase, 'review')

  assert.throws(() => remix.editRemixDraft({ id: 7, headline: 'A new hook here' }), /no longer in this review/)
  assert.throws(() => remix.editRemixDraft({ id: 0, headline: 'Too short' }), /at least 3 words/)
  assert.throws(() => remix.editRemixDraft({ id: 0, intro: Array.from({ length: 40 }, () => 'word').join(' ') }), /opening to 35 words/)
  assert.throws(() => remix.editRemixDraft({ id: 0, beats: [{ text: Array.from({ length: 40 }, () => 'w').join(' '), broll: '' }] }), /beat 1 to 35 words/)
  // Unchanged: nothing is marked edited or sent.
  const before = seen.length
  assert.equal(remix.editRemixDraft({ id: 0, headline: 'You do not need to lose weight' }).grade.edited, false)
  assert.equal(seen.length, before)

  const saved = remix.editRemixDraft({ id: 0, headline: 'Lose weight first? Not true', beats: [{ text: 'Strength comes first.', broll: 'gym' }] })
  assert.deepEqual([saved.headline, saved.intro, saved.beats[0].text, saved.grade.edited], ['Lose weight first? Not true', 'Here is the truth.', 'Strength comes first.', true])
  assert.equal(remix.remixStatus().drafts[0].headline, 'Lose weight first? Not true', 'kept on the status the Remix page shows')
  assert.equal(seen.at(-1).drafts[0].headline, 'Lose weight first? Not true', 'the page is told')
  // A silent take only has a headline and caption.
  assert.equal(remix.editRemixDraft({ id: 1, headline: 'Watch what happens next here', intro: 'ignored' }).intro, '')
  assert.throws(() => remix.editRemixDraft({ id: 1, postCaption: 'x'.repeat(2001) }), /caption to 2,000/)

  await remix.renderRemix([{ ...remix.remixStatus().drafts[0] }])
  assert.equal(configs.at(-1).approved[0].headline, 'Lose weight first? Not true')
  fs.rmSync(out, { recursive: true, force: true })
})


test('Avatar on camera (HeyGen): each spoken line is made on HeyGen from main, answered to the engine, gated, priced and cancelable', async () => {
  const { EventEmitter } = require('node:events')
  const childProcess = require('node:child_process')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-heygen-'))
  const settings = { ...SETTINGS, outputDirectory: out }
  const avatarDir = path.join(out, 'avatar')
  fs.mkdirSync(avatarDir)
  fs.writeFileSync(path.join(avatarDir, 'portrait.jpg'), 'JPEG')
  const link = { provider: 'heygen', source: 'twin', lookId: 'look_1', groupId: 'g1', status: 'completed', consentStatus: 'accepted', consentUrl: null, consentUrlAt: null,
    voiceId: 'v1', voice: 'app', engines: [], error: null, checkedAt: null }
  let avatar = { name: 'Me', voice: { provider: 'elevenlabs', voice: 'Harry' }, clonedVoice: null, heygen: link }
  const configs = [], answers = [], renders = []
  // The stand-in engine for a render: `scenario` runs once main has sent the request; `onAnswer` sees each HeyGen answer.
  let scenario = () => undefined, onAnswer = () => undefined, child = null
  const reply = (message) => setImmediate(() => child.stdout.emit('data', JSON.stringify(message) + '\n'))
  const finishEngine = (message, code = 0) => { reply(message); setTimeout(() => child.emit('close', code), 10) }
  const plan = (config) => {
    const work = path.join(config.output_dir, '.work')
    fs.mkdirSync(work, { recursive: true })
    fs.writeFileSync(path.join(work, 'plan.json'), '{}')
    return { ok: true, cost_usd: 0.02, drafts: [{ id: 0, source_index: 0, headline: 'He says lose weight first', intro: 'He is wrong.', close: 'Train the pull.',
      beats: [{ text: 'Strength first.', broll: 'gym' }], start_ms: 1000, end_ms: 4000, estimate_usd: 1.2, heygen_estimate_usd: 1 }] }
  }
  const spawn = () => {
    child = new EventEmitter()
    child.pid = 0
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    const self = child
    child.stdin = { on() {}, writable: true, destroyed: false,
      // Plan: the whole request, then closed. Render with HeyGen: one line, then HeyGen's answers.
      end(text) { if (text) { const config = JSON.parse(text); configs.push(config); setImmediate(() => { self.stdout.emit('data', JSON.stringify(plan(config)) + '\n'); self.emit('close', 0) }) } },
      write(text) {
        const message = JSON.parse(text)
        if (message.type === 'heygen_result') { answers.push(message); onAnswer(message); return true }
        configs.push(message)
        setImmediate(() => scenario())
        return true
      } }
    return child
  }
  const heygen = {
    failWith: null,
    ready: async () => { if (!avatar.heygen) throw new Error('not heygen'); return avatar.heygen },
    render: async (request) => {
      renders.push(request)
      // HeyGen accepted the video (it bills it from here).
      request.onStarted?.('vid')
      request.onStatus?.('HeyGen is animating your avatar', 0.5)
      await new Promise((resolve, reject) => {
        if (request.signal?.aborted) { reject(new Error('aborted')); return }
        const timer = setTimeout(resolve, request.text === 'slow' ? 5000 : 5)
        request.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('The operation was aborted')) })
      })
      if (heygen.failWith) throw new Error(heygen.failWith)
      fs.writeFileSync(request.outPath, 'MP4')
      return { videoId: 'vid', path: request.outPath, seconds: 6, estimatedUsd: 0.6 }
    }
  }
  const m = load('main/remix.ts', {
    electron: { app: { getPath: () => out, isPackaged: true } },
    child_process: { ...childProcess, spawn },
    './avatars': { portraitPath: () => path.join(avatarDir, 'portrait.jpg'), voiceSamplePath: () => '', readAvatar: () => avatar, readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined, authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => settings, getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const statuses = []
  m.onRemixStatus((status) => statuses.push(status))
  const settle = async (phase) => { for (let i = 0; i < 300 && m.remixStatus()?.phase === phase; i++) await new Promise((resolve) => setTimeout(resolve, 10)) }
  const request = { ...base, host: 'lipsync', voice: 'avatar' }
  const edit = { id: 0, headline: 'He says lose weight first', intro: 'He is wrong.', close: 'Train the pull.', beats: [{ text: 'Strength first.', broll: 'gym' }] }
  const line = (id, extra) => ({ type: 'heygen', id, key: 'intro', audio: null, text: null, label: 'Remix 1 of 1, opening line', ...extra })

  // Not connected, or not a HeyGen avatar: a plain reason, nothing started.
  await assert.rejects(m.startRemix(request), /HeyGen, which isn’t available/)
  m.setRemixHeygen(heygen)
  avatar = { ...avatar, heygen: null }
  await assert.rejects(m.startRemix(request), /Choose an avatar made with HeyGen/)
  avatar = { ...avatar, heygen: link }

  // Planned like any Voiced take; the config says HeyGen makes the lines (lip-synced to the app's voice here).
  await m.startRemix(request)
  await settle('planning')
  assert.equal(m.remixStatus().phase, 'review')
  assert.deepEqual([configs[0].host, configs[0].presenter, configs[0].heygen_voice, configs[0].heygen_usd_per_second], ['lipsync', 'heygen', false, 0.1])
  let folder = m.remixStatus().folder
  const work = path.join(folder, '.work', 'remix-1')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'intro.mp3'), 'MP3')
  fs.writeFileSync(path.join(work, 'close.mp3'), 'MP3')
  // The gate: the takes' estimates (HeyGen's lines included by the engine) for the monthly limit, and only OpenRouter's
  // share (the voice) for the OpenRouter balance.
  assert.deepEqual(plain(m.remixRenderCheck([{ id: 0 }])), { provider: 'openrouter', estimateUsd: 1.2, openrouterUsd: 0.2 })

  // Making it: the engine asks for the opening and closing lines (and two bad requests); main answers each.
  scenario = () => {
    reply(line(1, { audio: path.join(work, 'intro.mp3'), out: path.join(work, 'intro-heygen.mp4') }))
    reply(line(2, { key: 'close', audio: path.join(work, 'close.mp3'), out: path.join(work, 'close-heygen.mp4'), label: 'Remix 1 of 1, closing line' }))
    reply(line(3, { audio: '/etc/passwd', out: path.join(work, 'x-heygen.mp4') }))
    reply(line(4, { audio: path.join(work, 'close.mp3'), out: path.join(out, 'outside.mp4') }))
  }
  onAnswer = () => { if (answers.length === 4) finishEngine({ ok: true, cost_usd: 0.05, remixes: [] }) }
  await m.renderRemix([edit])
  await settle('rendering')
  assert.equal(configs[1].mode, 'render')
  const byId = Object.fromEntries(answers.map((a) => [a.id, a]))
  assert.deepEqual([byId[1].ok, byId[1].path, byId[2].ok], [true, fs.realpathSync(path.join(work, 'intro-heygen.mp4')), true])
  assert.deepEqual([byId[3].ok, byId[3].error, byId[4].ok], [false, 'That line could not be sent to HeyGen.', false])
  assert.equal(renders.length, 2)
  assert.deepEqual([renders[0].audioPath, renders[0].spendKind, renders[0].text, renders[0].title], [fs.realpathSync(path.join(work, 'intro.mp3')), 'remix', undefined, 'CreatorClips remix: Remix 1 of 1, opening line'])
  // Progress shows HeyGen's status; the finished run says what HeyGen made and its estimate.
  assert.ok(statuses.some((s) => s.detail === 'Remix 1 of 1, opening line: HeyGen is animating your avatar'))
  const final = m.remixStatus()
  assert.equal(final.phase, 'done')
  assert.ok(final.warnings.includes('HeyGen made 2 avatar videos for these remixes: about $1.20 on your HeyGen account (estimated at HeyGen’s published price, and recorded in Spending).'), final.warnings)

  // The avatar speaking in its HeyGen voice: the text goes to HeyGen; HeyGen is the main provider.
  avatar = { ...avatar, heygen: { ...link, voice: 'heygen' } }
  answers.length = 0; renders.length = 0
  await m.startRemix(request)
  await settle('planning')
  assert.equal(configs[2].heygen_voice, true)
  assert.deepEqual(plain(m.remixRenderCheck([{ id: 0 }])), { provider: 'heygen', estimateUsd: 1.2, openrouterUsd: 0.2 })
  // A HeyGen failure is answered plainly; one that would repeat stops the rest (stop_all).
  heygen.failWith = 'Your HeyGen balance is too low for this. Add credit on HeyGen, then try again.'
  folder = m.remixStatus().folder
  fs.mkdirSync(path.join(folder, '.work'), { recursive: true })
  scenario = () => reply(line(1, { text: 'He is wrong.', out: path.join(folder, '.work', 'intro-heygen.mp4') }))
  onAnswer = (answer) => finishEngine({ ok: false, error: answer.error }, 1)
  await m.renderRemix([edit])
  await settle('rendering')
  assert.deepEqual([answers[0].ok, answers[0].stop_all, renders[0].text, renders[0].audioPath], [false, true, 'He is wrong.', undefined])
  assert.equal(m.remixStatus().error, 'Your HeyGen balance is too low for this. Add credit on HeyGen, then try again.')

  // The engine stops (one line failed, say) while HeyGen is still making another: main stops waiting for it and
  // says HeyGen may still bill it, though the member didn't cancel.
  heygen.failWith = null
  answers.length = 0; renders.length = 0
  scenario = () => reply(line(1, { text: 'slow', out: path.join(folder, '.work', 'intro-heygen.mp4') }))
  onAnswer = () => undefined
  await m.renderRemix([edit])
  for (let i = 0; i < 200 && !renders.length; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  finishEngine({ ok: false, error: 'Remix 1: HeyGen could not make this video.' }, 1)
  await settle('rendering')
  for (let i = 0; i < 100 && !renders[0].signal.aborted; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(renders[0].signal.aborted, true, 'waiting stopped when the engine did')
  const stopped = m.remixStatus()
  assert.equal(stopped.phase, 'review')
  assert.ok(stopped.warnings.includes('HeyGen may still finish an avatar video it had already started and bill it on your HeyGen account.'), stopped.warnings)

  // Cancel while HeyGen is working: it stops waiting (the signal), and says HeyGen may still bill a video it started.
  answers.length = 0; renders.length = 0
  scenario = () => reply(line(1, { text: 'slow', out: path.join(folder, '.work', 'intro-heygen.mp4') }))
  onAnswer = () => undefined
  await m.renderRemix([edit])
  for (let i = 0; i < 200 && !renders.length; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(m.cancelRemix(), true)
  assert.equal(renders[0].signal.aborted, true)
  child.emit('close', null)
  await settle('rendering')
  const canceled = m.remixStatus()
  assert.equal(canceled.phase, 'cancelled')
  assert.ok(canceled.warnings.includes('HeyGen may still finish an avatar video it had already started and bill it on your HeyGen account.'), canceled.warnings)
  m.setRemixHeygen(null)
  fs.rmSync(out, { recursive: true, force: true })
})
