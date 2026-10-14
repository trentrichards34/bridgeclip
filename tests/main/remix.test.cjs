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
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process,
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
  // Lip-sync isn't available on OpenRouter yet: the avatar's photo presents.
  assert.equal(main.parseRemixRequest({ ...base, host: 'lipsync' }, userData).request.host, 'still')
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
  assert.equal(shared.ctaLine('SALES', ''), "Comment SALES and I'll send you the full breakdown.")
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
  assert.ok(lipsync.perRemixLow >= 0.5 && lipsync.perRemixHigh <= 1.25 && lipsync.perRemixHigh > lipsync.perRemixLow)
  assert.ok(voice.perRemixHigh < 0.05)
  assert.ok(shared.estimateRemixCost('lipsync', 3, 1).total > lipsync.total)
  assert.equal(shared.remixSourceUrl('ftp://x.com/a'), null)
  assert.equal(shared.remixSourceUrl('https://localhost/a'), null)
})
