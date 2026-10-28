// "Design a custom graphic here" in the clip editor (editor:designCustom): the request is built from the words said at
// the playhead (and the member's note), in the project's theme and the video's world (proposed once, then kept);
// only the words said in that moment may appear on it; it refuses without an OpenRouter key, outside the cut or where
// nothing is said; its estimate is shown before it runs and what it spent goes to the ledger. A fake model and a fake
// sandbox stand in (the real ones are in editor-design-custom.e2e.cjs).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadMain } = require('../zernio/support/load-main.cjs')

const ROOT = path.resolve(__dirname, '../..')
const FAKE = path.join(__dirname, 'fake-custom-graphics')
const shared = loadMain("export * from './src/shared/custom-graphics'")
const fixture = require('../fixtures/editor/project.json')
// '../shared/clip-editor' and './clip-editor' share the specifier the stand-in replaces: it is the shared module plus openEditor.
const { MAX_GRAPHICS_PER_CLIP: MAX_GRAPHICS } = loadMain("export { MAX_GRAPHICS_PER_CLIP } from './src/shared/motion-graphics'")
const sharedEditor = loadMain("export * from './src/shared/clip-editor'")

const SCRIPT = 'so we only need three things a product an offer and a way to attract eyeballs. that is it. and later on we talk about the whole plan'
const WORDS = SCRIPT.split(' ').map((word, i) => ({ word, start_ms: 800 + i * 320, end_ms: 800 + i * 320 + 260 }))
const at = (word) => WORDS.find((w) => w.word.replace(/\W/g, '') === word).start_ms
const WORLD = { idea: 'Your business: three blocks that stack up as each one is said', elements: ['blocks', 'eyeballs'], style: 'flat, bold', accent: null }

function project() {
  const p = structuredClone(fixture)
  Object.assign(p, { width: 540, height: 960, duration_ms: 12000, aspect_ratio: '9:16', transcript: [{ start_ms: 800, end_ms: 11000, text: SCRIPT }] })
  p.candidates = [{ ...p.candidates[0], ranges: [[0, 11500]], video_speed: 1, scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], hook: { text: 'Only three things', look: { look: 'brand', color: '#2F5BFF', font: 'clean' } } }]
  delete p.candidates[0].review
  return p
}

function load({ key = 'sk-or-test' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-design-'))
  const run = path.join(tmp, 'run')
  fs.mkdirSync(run)
  const state = { project: project(), transcriptCalls: 0 }
  const m = loadMain("export * from './src/main/editor-custom-graphics'", {
    electron: { app: { isPackaged: false, getPath: () => tmp } },
    './clip-editor': { ...sharedEditor, openEditor: async () => ({ project: state.project, sourcePath: '', previewPath: '' }) },
    './clip-chat': { readChatTranscript: async (_run, from, to) => { state.transcriptCalls++; return [{ start_ms: 800, end_ms: 11000, text: SCRIPT, speaker: null, events: [], words: WORDS.filter((w) => w.end_ms >= from && w.start_ms <= to) }] } },
    './custom-render': { customSandbox: () => { throw new Error('use the fake') } },
    './beat-stills': { beatFrame: async () => { throw new Error('no frame') } },
    './motion-library': { readLibraryTemplate: () => null, keepInLibrary: () => {}, libraryMatch: () => { throw new Error('a new design never comes from the library') }, noteLibraryUse: () => {} },
    './security': { authorizeMedia: (p) => p },
    './settings-store': { loadSettings: () => ({ openrouterApiKey: key }) },
    './member-prefs': { readMemberPrefs: () => ({ create: {} }) },
    './openrouter-models': { getModelCatalog: async () => ({ planning: [] }) },
    './logger': { logger: { info() {}, warn() {} } }
  })
  return { m, run, tmp, state, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) }
}

const MODEL = { model: 'anthropic/claude-opus-5.5', price: { ...shared.DEFAULT_PRICE }, vision: true, key: 'sk-or-test', endpoint: 'http://127.0.0.1:9/never' }

/** The fake model: a world, a composition (lasting what the brief asks) and a passing grade; every request kept. */
function fakeModel() {
  const requests = []
  const html = fs.readFileSync(path.join(FAKE, 'staircase.html'), 'utf8')
  const call = async (request) => {
    requests.push(request)
    if (request.purpose === 'world') return { text: JSON.stringify(WORLD), costUsd: 0.01 }
    if (request.purpose === 'grade') return { text: '{"pass": true, "score": 8, "failed": [], "fixes": []}', costUsd: 0.02 }
    const seconds = /data-duration="([\d.]+)"/.exec(request.user)?.[1] ?? /(\d+(?:\.\d+)?) ?s\b/.exec(request.user)?.[1]
    return { text: '```html\n' + html.replace(/data-duration="[\d.]+"/, `data-duration="${Number(seconds).toFixed(2)}"`) + '\n```', costUsd: 0.08 }
  }
  return { call, requests }
}

const sandboxShowing = (texts) => ({ calls: 0, async stills() { this.calls++; return { transparent: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c'), Buffer.from('d')], composite: Buffer.from('jpg'), texts, problems: [] } } })

test('a new custom graphic at the playhead: built from the words said there and the note, in the project\'s theme and world, and recorded', async () => {
  const { m, run, cleanup } = load()
  try {
    const fake = fakeModel()
    const spent = []
    const atMs = at('three')
    const result = await m.editorDesignCustom(run, 'candidate-1', atMs, '  make it   a rocket ', { model: MODEL, call: fake.call, sandbox: sandboxShowing(['three things', 'a product', 'an offer']), library: null, onSpend: (usd) => spent.push(usd) })
    assert.equal(result.reason, null)
    const g = result.graphic
    assert.equal(g.template, 'custom'); assert.equal(g.at_ms, atMs); assert.equal(g.origin, 'member')
    assert.match(g.fields.comp, /^[0-9a-f]{16}$/)
    assert.ok(g.duration_ms >= 3000 && g.duration_ms <= 8000, `3-8 s: ${g.duration_ms}`)
    // The first 6 s of a reel keep the hook: a card under it.
    assert.equal(g.fields.scene, 'card'); assert.equal(g.placement, 'bottom')
    // One world call (none was kept), then the writer and the grade.
    assert.deepEqual(fake.requests.map((r) => r.purpose), ['world', 'write', 'grade'])
    const write = fake.requests[1].user
    // The words said at the playhead are its cues; the note is in the brief, with the world and the stressed words.
    assert.match(write, /three/); assert.match(write, /product/); assert.match(write, /make it a rocket/)
    assert.match(write, /three blocks that stack up/)
    assert.match(write, /STRESSED WORDS/)
    // The world is proposed from the video's words, and kept; so is the theme (Dark product UI by default).
    assert.match(fake.requests[0].user, /attract eyeballs/)
    assert.equal(JSON.parse(fs.readFileSync(path.join(run, '.graphics', 'custom', 'world.json'), 'utf8')).idea, WORLD.idea)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run, '.graphics', 'custom', 'theme.json'), 'utf8')), { theme: 'dark' })
    const meta = JSON.parse(fs.readFileSync(path.join(run, '.graphics', 'custom', `${g.fields.comp}.json`), 'utf8'))
    assert.equal(meta.look.theme, 'dark'); assert.equal(meta.note, 'make it a rocket'); assert.equal(meta.fallback, null)
    // What it cost goes to the ledger: the world, the write and the grade.
    assert.equal(spent.length, 1); assert.ok(Math.abs(spent[0] - 0.11) < 1e-9, String(spent[0]))
    assert.ok(Math.abs(result.costUsd - 0.11) < 1e-9)

    // A later design in the same project keeps the world and the theme (no world call), and needs no note.
    const again = fakeModel()
    const later = await m.editorDesignCustom(run, 'candidate-1', at('attract'), undefined, { model: MODEL, call: again.call, sandbox: sandboxShowing(['attract', 'eyeballs']), library: null })
    assert.ok(later.graphic, later.reason)
    assert.deepEqual(again.requests.map((r) => r.purpose), ['write', 'grade'])
    assert.match(again.requests[0].user, /three blocks that stack up/)
    assert.doesNotMatch(again.requests[0].user, /rocket/)
  } finally { cleanup() }
})

test('only the words said in that moment may appear on it: a word said elsewhere in the video fails it, and nothing is added', async () => {
  const { m, run, cleanup } = load()
  try {
    const fake = fakeModel()
    // "whole plan" is said in the clip, but seconds later: not in this moment.
    const result = await m.editorDesignCustom(run, 'candidate-1', at('three'), 'a rocket', { model: { ...MODEL, vision: false }, call: fake.call, sandbox: sandboxShowing(['three things', 'the whole plan']), library: null })
    assert.equal(result.graphic, null)
    assert.match(result.reason, /didn’t pass our checks, so nothing was added/)
    assert.match(result.reason, /not said/)
    // Every try was sent back with the words that weren't said there, and the revisions ran out.
    const writes = fake.requests.filter((r) => r.purpose === 'write')
    assert.equal(writes.length, 1 + shared.revisionCap(1))
    assert.match(writes[1].user, /whole/)
    assert.ok(result.costUsd > 0)
  } finally { cleanup() }
})

test('it refuses without an OpenRouter key, outside the cut, where nothing is said, and on a full clip — before any call', async () => {
  const noKey = load({ key: '' })
  try {
    const fake = fakeModel()
    await assert.rejects(noKey.m.editorDesignCustom(noKey.run, 'candidate-1', at('three'), 'a rocket', { call: fake.call, sandbox: sandboxShowing([]) }), /Add your OpenRouter key in Settings → API keys/)
    assert.equal(fake.requests.length, 0)
    // Its estimate: none to check without a key; the info says why.
    assert.equal(await noKey.m.editorDesignEstimate(noKey.run), null)
    const info = await noKey.m.editorDesignInfo(noKey.run)
    assert.equal(info.available, false); assert.match(info.reason, /OpenRouter key/)
  } finally { noKey.cleanup() }
  const { m, run, state, cleanup } = load()
  try {
    const fake = fakeModel()
    const deps = { model: MODEL, call: fake.call, sandbox: sandboxShowing([]), library: null }
    state.project.candidates[0].ranges = [[0, 4000], [6000, 11500]]
    await assert.rejects(m.editorDesignCustom(run, 'candidate-1', 5000, '', deps), /inside the clip’s cut/)
    await assert.rejects(m.editorDesignCustom(run, 'candidate-1', 11200, '', deps), /Nothing is said here/)
    await assert.rejects(m.editorDesignCustom(run, 'nope', 1000, '', deps), /no longer in the editor/)
    await assert.rejects(m.editorDesignCustom(run, 'candidate-1', -5, '', deps), /Choose a time/)
    state.project.candidates[0].graphics = Array.from({ length: MAX_GRAPHICS }, (_, i) => ({ id: `g${i}`, template: 'title', at_ms: 1000, duration_ms: 1000, placement: 'top', fields: { text: 'three' } }))
    await assert.rejects(m.editorDesignCustom(run, 'candidate-1', at('three'), '', deps), /up to \d+ graphics/)
    assert.equal(fake.requests.length, 0)
  } finally { cleanup() }
})

test('the estimate shown before it runs: one design with its revisions, plus the world call only while the project has none', async () => {
  const { m, run, cleanup } = load()
  try {
    const first = await m.editorDesignInfo(run, { model: MODEL })
    const expected = shared.customDesignEstimate(MODEL.price, false)
    assert.equal(first.available, true); assert.equal(first.theme, 'dark'); assert.equal(first.world, '')
    assert.equal(first.expectedUsd, expected.expectedUsd); assert.equal(first.mostUsd, expected.mostUsd)
    assert.ok(first.expectedUsd > 0.05 && first.mostUsd >= first.expectedUsd && first.mostUsd < 1, JSON.stringify(first))
    // With a world kept, the world call drops out.
    fs.mkdirSync(path.join(run, '.graphics', 'custom'), { recursive: true })
    fs.writeFileSync(path.join(run, '.graphics', 'custom', 'world.json'), JSON.stringify(WORLD))
    const later = await m.editorDesignInfo(run, { model: MODEL })
    assert.ok(later.mostUsd < first.mostUsd)
    assert.ok(Math.abs(first.mostUsd - later.mostUsd - shared.worldCallCost(MODEL.price)) < 0.002)
    assert.match(later.world, /three blocks/)
    // The spending check gets the most it can cost (the member's model through customModel: list price without the catalog).
    assert.equal(await m.editorDesignEstimate(run), shared.customDesignEstimate(shared.DEFAULT_PRICE, true).mostUsd)
    // A theme kept by an earlier design (or an edited recording's custom graphic) is the project's.
    fs.writeFileSync(path.join(run, '.graphics', 'custom', 'theme.json'), JSON.stringify({ theme: 'paper' }))
    assert.equal((await m.editorDesignInfo(run, { model: MODEL })).theme, 'paper')
  } finally { cleanup() }
})

test('the IPC is paid: gated, estimated before spending, recorded in the ledger, and reached through the gate dialog', () => {
  const handlers = fs.readFileSync(path.join(ROOT, 'src/main/ipc-handlers.ts'), 'utf8')
  assert.match(handlers, /paid\('editor:designCustom', 'openrouter', \(path\) => editorDesignEstimate\(path\)/)
  assert.match(handlers, /editorDesignCustom\(path, candidateId, atMs, note, \{\s*onSpend: \(usd\) => \{ void recordSpend\(\{ kind: 'edit', provider: 'openrouter', usd/)
  assert.match(handlers, /handle\('editor:designInfo'/)
  const spending = fs.readFileSync(path.join(ROOT, 'src/main/spending.ts'), 'utf8')
  assert.match(spending, /GATED_CHANNELS = new Set\(\[[^\]]*'editor:designCustom'/)
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf8')
  assert.match(preload, /designCustom: \(path, candidateId, atMs, note\) => paid\('editor:designCustom'/)
})

test('what a design shows: the note first, then the words said there', () => {
  assert.equal(shared.designKindFor('we went from zero to $8,188 in a month'), 'proof')
  assert.equal(shared.designKindFor('first you build it then you sell it'), 'process')
  assert.equal(shared.designKindFor('organic content versus ads'), 'comparison')
  assert.equal(shared.designKindFor('there are three things you need'), 'list')
  assert.equal(shared.designKindFor('you do not have to be an influencer'), 'claim')
  assert.equal(shared.designKindFor('$8,188 in a month', 'show it as steps'), 'process')
  assert.equal(shared.designKindFor('first you build it', 'make it a rocket'), 'process')
})
