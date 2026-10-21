// My B-roll library: the index and its checks, the catalog the engine reads, search, where b-roll comes from,
// AI shot requests, and the main-process library (adding, preparing, looking at shots, AI shots, run fields).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => value === undefined ? value : JSON.parse(JSON.stringify(value))
/** Deep equality across the vm realm (and without undefined fields). */
const eq = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message)

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, setImmediate, process, AbortController, AbortSignal, Response, Headers, structuredClone, DOMException,
    __dirname: dir,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/broll-library.ts')
const avatars = load('shared/avatars.ts')
const ITEM = 'l0123456789ab'

const analysis = (description, extra = {}) => ({ description, tags: ['desk'], subjects: [], setting: '', shotType: 'hands', motion: 'slow', mood: '', memberAppears: false, onScreenText: '', quality: '', model: 'm', analyzedAt: '2026-10-01T00:00:00.000Z', ...extra })
function item(extra = {}) {
  return {
    id: ITEM, kind: 'video', name: 'Desk', original: '/videos/desk.mp4', proxy: `${ITEM}-abc123.mp4`, poster: `${ITEM}-abc123.jpg`, durationS: 20, width: 1920, height: 1080,
    size: 10, mtimeMs: 1, addedAt: '2026-10-01T00:00:00.000Z', origin: 'member', tags: [], me: false, status: 'ready',
    shots: [{ id: 's0', inS: 0, outS: 8, analysis: analysis('Hands typing on a laptop') }, { id: 's1', inS: 8, outS: 20, analysis: null }], ...extra
  }
}

test('index.json: a newer or damaged file is an empty library; bad items and shots are dropped', () => {
  eq(plain(shared.parseLibraryIndex({ version: 2, items: [item()] })), { version: 1, items: [] })
  eq(plain(shared.parseLibraryIndex('nope')), { version: 1, items: [] })
  const parsed = shared.parseLibraryIndex({ version: 1, items: [
    item(), item(), // a duplicate id
    item({ id: '../x' }), item({ id: 'l111111111111', kind: 'gif' }), item({ id: 'l222222222222', original: 'x\0y' }),
    item({ id: 'l333333333333', proxy: '../../etc/passwd', poster: 'ok-1.jpg', name: '  A\nname  ', tags: ['Coffee', 'coffee', '<b>', 'x'.repeat(50)], me: 'yes',
      shots: [{ id: 's0', inS: 2, outS: 1 }, { id: 'bad', inS: 0, outS: 1 }, { id: 's2', inS: 1, outS: 99, analysis: { description: '' } }] })
  ] })
  eq(parsed.items.map((entry) => entry.id), [ITEM, 'l333333333333'])
  const odd = parsed.items[1]
  assert.equal(odd.proxy, null)
  assert.equal(odd.poster, 'ok-1.jpg')
  assert.equal(odd.name, 'A name')
  eq(plain(odd.tags), ['coffee', 'b', 'x'.repeat(30)])
  assert.equal(odd.me, false)
  // Only the good shot stays (clamped to the video), its damaged analysis dropped.
  eq(plain(odd.shots), [{ id: 's2', inS: 1, outS: 20, analysis: null }])
})

test('the vision model’s answer is checked and trimmed', () => {
  const parsed = shared.parseAnalysis('```json\n' + JSON.stringify({
    description: '  A cup of   coffee\non a desk ', tags: ['Coffee', 'Desk', 'coffee'], subjects: ['cup'], setting: 'kitchen', shot_type: 'close', motion: 'zoom',
    mood: 'calm', member_appears: true, on_screen_text: '', quality: 'slightly dark'
  }) + '\n```', 'google/gemini-3.8-flash', '2026-10-21T00:00:00.000Z')
  eq(plain(parsed), { description: 'A cup of coffee on a desk', tags: ['coffee', 'desk'], subjects: ['cup'], setting: 'kitchen', shotType: 'close', motion: 'slow', mood: 'calm',
    memberAppears: true, onScreenText: '', quality: 'slightly dark', model: 'google/gemini-3.8-flash', analyzedAt: '2026-10-21T00:00:00.000Z' })
  assert.equal(shared.parseAnalysis({ description: 'x', shot_type: 'drone' }, 'm').shotType, 'other')
  assert.throws(() => shared.parseAnalysis({ tags: [] }, 'm'), /no description/)
  assert.throws(() => shared.parseAnalysis('not json', 'm'), /not JSON/)
})

test('long clips are split into usable shots at scene changes', () => {
  eq(plain(shared.shotsFromScenes(8, [3])), [{ inS: 0, outS: 8 }], 'a short clip is one shot')
  // A sliver after a cut joins the scene before it; a long scene is cut into ~6 s pieces.
  eq(shared.shotsFromScenes(20, [7, 7.8]), [{ inS: 0, outS: 7.8 }, { inS: 7.8, outS: 11.867 }, { inS: 11.867, outS: 15.933 }, { inS: 15.933, outS: 20 }])
  const shots = shared.shotsFromScenes(30, [7, 7.8, 9])
  assert.equal(shots[0].inS, 0)
  assert.equal(shots.at(-1).outS, 30)
  for (const [i, shot] of shots.entries()) {
    assert.ok(shot.outS - shot.inS <= shared.MAX_SHOT_S + 0.001, JSON.stringify(shot))
    if (i) assert.equal(shot.inS, shots[i - 1].outS)
  }
  assert.ok(shots.every((shot) => shot.outS - shot.inS >= shared.MIN_SHOT_S - 0.001 || shot === shots[0]))
  assert.equal(shared.shotsFromScenes(3 * 3600, []).length, shared.MAX_SHOTS_PER_ITEM)
})

test('search: every word must be in the name, the member’s tags or what was seen', () => {
  const items = [item(), item({ id: 'l111111111111', name: 'Kitchen', tags: ['coffee'], me: true, shots: [{ id: 's0', inS: 0, outS: 5, analysis: analysis('Steam over a mug') }] }),
    item({ id: 'l222222222222', name: 'Made one', origin: 'ai', aiPrompt: 'a sunrise', shots: [] })]
  const ids = (query) => shared.searchLibrary(items, query).map((entry) => entry.id)
  eq(ids(''), [ITEM, 'l111111111111', 'l222222222222'])
  eq(ids('laptop'), [ITEM])
  eq(ids('MUG coffee'), ['l111111111111'])
  eq(ids('me'), ['l111111111111'])
  eq(ids('ai sunrise'), ['l222222222222'])
  eq(ids('nothing'), [])
})

test('the catalog: analyzed shots of ready items whose file is there, the member’s flags, poor shots last', () => {
  const items = [
    item({ tags: ['office'], me: true }),
    item({ id: 'l111111111111', origin: 'ai', shots: [{ id: 's0', inS: 0, outS: 5, analysis: analysis('Blurry street', { quality: 'blurry' }) }, { id: 's1', inS: 5, outS: 9, analysis: analysis('Clear sky') }] }),
    item({ id: 'l222222222222', status: 'new' }),
    item({ id: 'l333333333333' }) // its file is gone and has no proxy
  ]
  const catalog = shared.buildCatalog(items, (entry) => entry.id === 'l333333333333' ? null : `/use/${entry.id}.mp4`)
  eq(catalog.shots.map((shot) => shot.id), [`${ITEM}:s0`, 'l111111111111:s1', 'l111111111111:s0'])
  eq(plain(catalog.shots[0]), { id: `${ITEM}:s0`, path: `/use/${ITEM}.mp4`, kind: 'video', inS: 0, outS: 8, description: 'Hands typing on a laptop', tags: ['office', 'desk'], shotType: 'hands', me: true, ai: false })
  assert.equal(catalog.shots[1].ai, true)
  assert.equal(shared.catalogLine(catalog.shots[0]), `${ITEM}:s0 | 8.0s | hands | me | Hands typing on a laptop [office, desk]`)
})

test('where b-roll comes from: library by default when it has shots; stock only with a Pexels key; AI needs OpenRouter', () => {
  const ids = (context) => shared.brollSourceOptions(context).map((option) => `${option.id}${option.disabledReason ? ' (off)' : ''}`)
  eq(ids({ libraryShots: 0, pexels: false, openrouter: true }), ['library (off)', 'ai', 'library_ai (off)'])
  eq(ids({ libraryShots: 4, pexels: true, openrouter: true }), ['library', 'stock', 'ai', 'library_ai'])
  assert.equal(shared.defaultBrollSource({ libraryShots: 4, pexels: true }), 'library')
  assert.equal(shared.defaultBrollSource({ libraryShots: 0, pexels: true }), 'stock')
  assert.equal(shared.defaultBrollSource({ libraryShots: 0, pexels: false }), null, 'AI is never the default: it costs money')
  assert.equal(shared.effectiveBrollSource(null, { libraryShots: 0, pexels: false, openrouter: true }), null, 'old styles with b-roll on never start spending')
  assert.equal(shared.effectiveBrollSource('library_ai', { libraryShots: 0, pexels: false, openrouter: true }), null, 'an empty library does not fall back to AI')
  assert.equal(shared.effectiveBrollSource('ai', { libraryShots: 0, pexels: false, openrouter: true }), 'ai', 'AI runs when picked')
  assert.equal(shared.effectiveBrollSource('library_ai', { libraryShots: 3, pexels: false, openrouter: true }), 'library_ai')
  assert.equal(shared.effectiveBrollSource('stock', { libraryShots: 3, pexels: false, openrouter: true }), 'library', 'a pick that can’t run falls back')
  assert.match(shared.brollSourceProblem('library', { libraryShots: 0, pexels: true, openrouter: true }), /library first/)
  eq([shared.isBrollSource('library_ai'), shared.isBrollSource('giphy')], [true, false])
})

test('AI shots: settings, estimates and the OpenRouter requests (9:16, no sound, the rules in every prompt)', () => {
  eq(plain(shared.parseBrollAiSettings({})), { kind: 'video', model: 'x-ai/grok-imagine-video-1.5-lite', maxShots: 2 })
  eq(plain(shared.parseBrollAiSettings({ kind: 'image', model: 'evil/model', maxShots: 99 })), { kind: 'image', model: 'x-ai/grok-imagine-video-1.5-lite', maxShots: 2 })
  assert.throws(() => shared.checkBrollAiSettings({ kind: 'video', model: 'evil/model', maxShots: 1 }), /listed video models/)
  assert.throws(() => shared.checkBrollAiSettings({ kind: 'video', model: 'google/veo-3.1-lite', maxShots: 7 }), /0 to 6/)
  assert.equal(shared.aiShotEstimateUsd({ kind: 'video', model: 'bytedance/seedance-2.0-fast', maxShots: 2 }), 0.2)
  assert.ok(Math.abs(shared.aiShotEstimateUsd({ kind: 'video', model: 'bytedance/seedance-2.0', maxShots: 2 }) - 0.35) < 1e-9, 'listed "from" price: one 5 s shot x $0.07')
  assert.equal(shared.aiShotEstimateUsd({ kind: 'image', model: 'x', maxShots: 2 }), avatars.PRICES.image)
  assert.equal(shared.aiRunEstimateUsd({ kind: 'video', model: 'x-ai/grok-imagine-video-1.5-lite', maxShots: 2 }, 5), 1)
  assert.match(shared.aiEstimateLine({ kind: 'video', model: 'x-ai/grok-imagine-video-1.5-lite', maxShots: 2 }), /About \$0\.10 a shot, at most \$0\.20 a clip/)
  const video = shared.brollVideoRequest('Steam rising from a "coffee" cup', { kind: 'video', model: 'google/veo-3.1-lite', maxShots: 2 })
  eq({ ...plain(video), prompt: undefined }, { model: 'google/veo-3.1-lite', aspectRatio: '9:16', resolution: '720p', duration: 4, generateAudio: false })
  assert.match(video.prompt, /^Steam rising from a coffee cup\. Vertical 9:16 .*No text.*no logos.*No real or famous people/)
  assert.equal(shared.brollImageRequest('x').model, avatars.OPENROUTER_MODELS.image, 'the image model the app already uses')
})

// ---------------------------------------------------------------------------
// Main process
// ---------------------------------------------------------------------------

function ffmpegAvailable() {
  try { execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true } catch { return false }
}

function setup(t, { settings: extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broll-library-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(userData)
  const state = { settings: { openrouterApiKey: 'sk-or-test', pexelsApiKey: '', brollAiKind: 'video', brollAiModel: 'x-ai/grok-imagine-video-1.5-lite', brollAiMaxShots: '2', ...extra }, charges: [] }
  const electron = { app: { getPath: (name) => name === 'temp' ? os.tmpdir() : userData, isPackaged: false } }
  const media = load('main/openrouter-media.ts', { electron, './logger': { logger: { info() {}, warn() {}, error() {} } }, './network-policy': { assertPublicWebUrl: async () => undefined } })
  media.onMediaCharge((charge) => state.charges.push(plain(charge)))
  const library = load('main/broll-library.ts', {
    electron,
    './logger': { logger: { info() {}, warn() {}, error() {} } },
    './moment-take': { MOMENT_HELPER_MODEL: 'google/gemini-3.8-flash' },
    './openrouter-media': media,
    './security': {
      authorizeMedia: (p) => fs.realpathSync(p),
      isWithinDirectory: (p, dir) => { try { const rel = path.relative(fs.realpathSync(dir), fs.realpathSync(p)); return rel === '' || (!path.isAbsolute(rel) && !rel.startsWith('..')) } catch { return false } }
    },
    './settings-store': { loadSettings: () => state.settings, saveSettings: (next) => { state.settings = next; return next } },
    './tools': { resolveBinary: (name) => name }
  })
  return { root, userData, state, library, media }
}

function makeVideo(file, colors, seconds = 3) {
  const inputs = colors.flatMap((color) => ['-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=15:d=${seconds}`])
  const concat = colors.map((_, i) => `[${i}:v]`).join('') + `concat=n=${colors.length}:v=1:a=0[v]`
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', concat, '-map', '[v]', '-c:v', 'mpeg4', '-q:v', '5', file])
}

/** A stand-in for OpenRouter's chat completions: every look returns this description. */
function visionFetch(calls, describe = (n) => `Shot number ${n} on a desk`) {
  return async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ description: describe(calls.length), tags: ['desk'], subjects: [], setting: 'office', shot_type: 'wide', motion: 'still', mood: 'calm', member_appears: false, on_screen_text: '', quality: '' }) } }],
      usage: { cost: 0.001 }
    }), { status: 200 })
  }
}

test('main: add a folder, prepare proxies and shots, look at each shot once, search, rename, tag, remove', { skip: !ffmpegAvailable() && 'needs FFmpeg' }, async (t) => {
  const { root, userData, state, library } = setup(t)
  const folder = path.join(root, 'footage')
  fs.mkdirSync(path.join(folder, 'nested'), { recursive: true })
  makeVideo(path.join(folder, 'desk.mp4'), ['red'])
  makeVideo(path.join(folder, 'nested', 'long.mov'), ['red', 'blue', 'green', 'white', 'black'], 3) // 15 s, four cuts
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=200x300', '-frames:v', '1', path.join(folder, 'mug.jpg')])
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'not media')
  fs.writeFileSync(path.join(folder, '.hidden.mp4'), 'hidden')

  assert.rejects(library.addLibraryPaths(['relative/path']), /Choose videos/)
  const added = await library.addLibraryPaths([folder])
  assert.equal(added.added, 3)
  await library.prepareNewItems()
  let view = await library.libraryView()
  const byName = Object.fromEntries(view.items.map((entry) => [entry.name, entry]))
  eq(Object.keys(byName).sort(), ['desk', 'long', 'mug'])
  for (const entry of view.items) {
    assert.equal(entry.status, 'ready', entry.error)
    assert.ok(fs.existsSync(entry.proxyPath) && fs.existsSync(entry.posterPath))
    assert.equal(entry.originalPath, fs.realpathSync(entry.original), 'originals are used in place')
  }
  assert.ok(byName.long.shots.length >= 2, 'a long clip is split at its scene changes')
  assert.equal(byName.mug.kind, 'image')
  assert.equal(path.extname(byName.desk.proxyPath), '.mp4')
  assert.equal(view.pendingShots, byName.long.shots.length + 2)
  assert.equal(view.usableShots, 0, 'nothing is usable until it is looked at')
  // The same files again: skipped.
  assert.equal((await library.addLibraryPaths([path.join(folder, 'desk.mp4')])).added, 0)

  // Looking at the shots: one vision call each, its cost reported for the spending ledger.
  const calls = []
  const result = await library.indexLibrary({ fetch: visionFetch(calls) })
  assert.equal(result.phase, 'done')
  assert.equal(calls.length, view.pendingShots)
  assert.equal(result.costUsd.toFixed(3), (0.001 * calls.length).toFixed(3))
  assert.equal(calls[0].body.model, 'google/gemini-3.8-flash')
  assert.equal(calls[0].body.response_format.json_schema.strict, true)
  assert.ok(calls.every((call) => call.body.messages[1].content.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/jpeg;base64,'))))
  assert.equal(state.charges.length, calls.length)
  eq(state.charges[0], { what: 'text', model: 'google/gemini-3.8-flash', usd: 0.001 })
  view = await library.libraryView()
  assert.equal(view.pendingShots, 0)
  assert.equal(view.usableShots, calls.length)
  // Nothing new: nothing is looked at again.
  assert.equal((await library.indexLibrary({ fetch: visionFetch(calls) })).total, 0)

  // The index on disk is versioned and readable.
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'broll-library', 'index.json'), 'utf8'))
  assert.equal(saved.version, 1)
  assert.equal(saved.items.length, 3)

  // Rename, tag, "this is me".
  const desk = view.items.find((entry) => entry.name === 'desk')
  view = await library.updateLibraryItem(desk.id, { name: '  My desk  ', tags: ['Office', 'office', 'laptop'], me: true })
  const updated = view.items.find((entry) => entry.id === desk.id)
  eq([updated.name, plain(updated.tags), updated.me], ['My desk', ['office', 'laptop'], true])
  await assert.rejects(library.updateLibraryItem(desk.id, { name: '' }), /name/)
  await assert.rejects(library.updateLibraryItem('l000000000000', { me: true }), /no longer/)

  // The catalog: the member's own flag and tags travel with the shot.
  const catalog = await library.libraryCatalog()
  const deskShot = catalog.shots.find((shot) => shot.id.startsWith(desk.id))
  assert.equal(deskShot.me, true)
  eq(plain(deskShot.tags).slice(0, 2), ['office', 'laptop'])

  // An original that is gone: the proxy stands in, and the page says so.
  fs.rmSync(path.join(folder, 'desk.mp4'))
  view = await library.libraryView()
  const gone = view.items.find((entry) => entry.id === desk.id)
  assert.equal(gone.missing, true)
  assert.equal(gone.originalPath, null)
  assert.equal((await library.libraryCatalog()).shots.find((shot) => shot.id.startsWith(desk.id)).path, gone.proxyPath)

  // Remove: the proxy and poster go; a member's original is never deleted.
  const long = view.items.find((entry) => entry.name === 'long')
  view = await library.removeLibraryItems([long.id])
  assert.equal(view.items.some((entry) => entry.id === long.id), false)
  assert.equal(fs.existsSync(long.proxyPath), false)
  assert.ok(fs.existsSync(path.join(folder, 'nested', 'long.mov')))
})

test('main: the run fields for each source, and AI shots the engine left for the library join it', { skip: !ffmpegAvailable() && 'needs FFmpeg' }, async (t) => {
  const { root, userData, library } = setup(t)
  const work = path.join(root, 'work', 'job1')
  // An empty library can't be the source; stock needs a Pexels key; AI needs OpenRouter.
  assert.match(library.brollRunFields('library', { pexels: false, openrouter: true }, work).error, /library first/)
  assert.match(library.brollRunFields(undefined, { pexels: false, openrouter: true }, work).error, /Pexels/, 'older requests are stock, as before')
  eq(plain(library.brollRunFields('stock', { pexels: true, openrouter: true }, work)), { fields: { broll_source: 'stock' } })
  const ai = library.brollRunFields('ai', { pexels: false, openrouter: true }, work)
  eq({ ...plain(ai.fields), broll_ai_dir: undefined }, {
    broll_source: 'ai', broll_ai: { kind: 'video', model: 'x-ai/grok-imagine-video-1.5-lite', max_shots: 2, seconds: 5, per_second_usd: 0.02, image_usd: 0.08 }
  })
  assert.equal(ai.fields.broll_ai_dir, path.join(userData, 'broll-library', 'incoming'))
  assert.equal(library.brollRunEstimateUsd('library_ai', 3), 0.6)
  assert.equal(library.brollRunEstimateUsd('library', 3), null)

  // An AI shot the engine made during a run: video first, its details last.
  const incoming = await library.incomingFolder()
  makeVideo(path.join(incoming, 'ai-0123456789abcdef.mp4'), ['purple'])
  fs.writeFileSync(path.join(incoming, 'ai-0123456789abcdef.json'), JSON.stringify({ prompt: 'A sunrise over a quiet street', model: 'x-ai/grok-imagine-video-1.5-lite' }))
  fs.writeFileSync(path.join(incoming, 'ai-fedcba9876543210.mp4'), 'still being written: no details yet')
  // Left by a crash a day ago (no details), and one with damaged details: both are removed, not kept forever.
  const orphan = path.join(incoming, 'ai-00000000000000aa.mp4')
  fs.writeFileSync(orphan, 'orphan')
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  fs.utimesSync(orphan, old, old)
  fs.writeFileSync(path.join(incoming, 'ai-00000000000000bb.mp4'), 'video')
  fs.writeFileSync(path.join(incoming, 'ai-00000000000000bb.json'), '{not json')
  let view = await library.libraryView()
  assert.ok(!fs.existsSync(orphan) && !fs.existsSync(path.join(incoming, 'ai-00000000000000bb.mp4')) && !fs.existsSync(path.join(incoming, 'ai-00000000000000bb.json')))
  await library.prepareNewItems()
  view = await library.libraryView()
  assert.equal(view.items.length, 1)
  const shot = view.items[0]
  eq([shot.origin, plain(shot.tags), shot.aiPrompt, shot.status], ['ai', ['ai'], 'A sunrise over a quiet street', 'ready'])
  assert.equal(shot.shots[0].analysis.description, 'A sunrise over a quiet street', 'described by what was asked for')
  assert.equal(view.pendingShots, 0)
  assert.ok(fs.existsSync(path.join(incoming, 'ai-fedcba9876543210.mp4')), 'a file without its details waits')

  // Now the library has shots: the catalog is written into the run's private folder for the engine.
  const fields = library.brollRunFields('library_ai', { pexels: false, openrouter: true }, work).fields
  assert.equal(fields.broll_catalog_path, path.join(work, 'broll-catalog.json'))
  const catalog = JSON.parse(fs.readFileSync(fields.broll_catalog_path, 'utf8'))
  assert.equal(catalog.version, 1)
  assert.equal(catalog.shots[0].ai, true)
  assert.equal(catalog.shots[0].path, shot.original)

  // Removing an AI shot deletes its file (it belongs to the library).
  await library.removeLibraryItems([shot.id])
  assert.equal(fs.existsSync(shot.original), false)
})

test('main: "Make a shot with AI" sends one 9:16 silent video job, records it, and adds the shot tagged ai', { skip: !ffmpegAvailable() && 'needs FFmpeg' }, async (t) => {
  const { root, state, library } = setup(t)
  const clip = path.join(root, 'made.mp4')
  makeVideo(clip, ['teal'])
  const requests = []
  const fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (init.method === 'POST') return new Response(JSON.stringify({ id: 'job_1', status: 'queued' }), { status: 202 })
    if (url.includes('/content')) return new Response(fs.readFileSync(clip), { status: 200 })
    return new Response(JSON.stringify({ id: 'job_1', status: 'completed', usage: { cost: 0.1 } }), { status: 200 })
  }
  await assert.rejects(library.makeAiShot('', { fetch }), /Describe the shot/)
  const view = await library.makeAiShot('Steam rising from a coffee cup', { fetch, pollMs: 1 })
  assert.equal(requests[0].method, 'POST')
  assert.match(requests[0].url, /\/videos$/)
  eq({ ...requests[0].body, prompt: undefined }, { model: 'x-ai/grok-imagine-video-1.5-lite', aspect_ratio: '9:16', resolution: '720p', duration: 5, generate_audio: false })
  assert.match(requests[0].body.prompt, /^Steam rising from a coffee cup\. .*No text/)
  eq(state.charges, [{ what: 'video', model: 'x-ai/grok-imagine-video-1.5-lite', usd: 0.1, seconds: 5 }])
  assert.equal(view.items.length, 1)
  eq([view.items[0].origin, plain(view.items[0].tags), view.items[0].aiModel], ['ai', ['ai'], 'x-ai/grok-imagine-video-1.5-lite'])
})

test('main: a rejected OpenRouter key stops looking at shots with a plain message', { skip: !ffmpegAvailable() && 'needs FFmpeg' }, async (t) => {
  const { root, library } = setup(t)
  makeVideo(path.join(root, 'a.mp4'), ['red'])
  await library.addLibraryPaths([path.join(root, 'a.mp4')])
  await library.prepareNewItems()
  const result = await library.indexLibrary({ fetch: async () => new Response('', { status: 401 }) })
  assert.equal(result.phase, 'failed')
  assert.match(result.message, /rejected the API key/)
  assert.equal((await library.libraryView()).pendingShots, 1, 'the shot waits to be looked at')
})

test('Remix: a voiced take keeps where its b-roll comes from; other kinds of remix leave it out', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'broll-remix-'))
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }))
  const remix = load('main/remix.ts', {
    electron: { app: { getPath: () => userData } },
    './avatars': { portraitPath: () => '', voiceSamplePath: () => '', readAvatar: () => ({}), readReactions: () => [] },
    './logger': { logger: { info() {}, warn() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './security': { assertMediaPath: () => undefined },
    './settings-store': { loadSettings: () => ({ outputDirectory: userData }), getSettingsForBridge: () => ({}) },
    './tools': { resolveBinary: (name) => name }
  })
  const base = {
    sources: ['https://www.youtube.com/watch?v=abcdefghijk'], creator: '', angle: 'reaction', order: 'moment_first', host: 'lipsync', avatarId: 'a'.repeat(16),
    voice: 'avatar', brandIdentityId: null, count: 3, captionPreset: 'pop', includeCaptions: true, aiLabelAck: true
  }
  assert.equal(remix.parseRemixRequest({ ...base, brollSource: 'library_ai' }, userData).request.brollSource, 'library_ai')
  assert.equal('brollSource' in remix.parseRemixRequest(base, userData).request, false)
  assert.equal('brollSource' in remix.parseRemixRequest({ ...base, brollSource: 'giphy' }, userData).request, false)
  assert.equal('brollSource' in remix.parseRemixRequest({ ...base, format: 'silent', clipRightsAck: true, brollSource: 'library' }, userData).request, false)
})

test('More clips prices the earlier run’s AI b-roll before it starts (not a free pass past the spending check)', () => {
  const handlers = fs.readFileSync(path.join(ROOT, 'main/ipc-handlers.ts'), 'utf8')
  assert.doesNotMatch(handlers, /paid\('job:moreClips', 'openrouter', \(\) => null/)
  assert.match(handlers, /paid\('job:moreClips', 'openrouter', \(outputDir, choices\) => moreClipsEstimate\(outputDir, choices\)/)
  assert.match(handlers, /try \{ estimateUsd = await estimate\(\.\.\.args\) \}/, 'an estimate may be worked out from the saved run')
})

test('new clips are looked at on their own only in a small batch; a big folder waits for the priced button', () => {
  assert.equal(shared.autoIndexAllowed(0), false)
  assert.equal(shared.autoIndexAllowed(10), true)
  assert.equal(shared.autoIndexAllowed(125), true, 'about $0.25')
  assert.equal(shared.autoIndexAllowed(126), false)
  assert.equal(shared.autoIndexAllowed(20000), false, 'a 500-file folder never starts spending by itself')
  assert.equal(shared.indexEstimateUsd(3), 0.01)
  assert.equal(shared.indexEstimateUsd(500), 1)
  const page = fs.readFileSync(path.join(ROOT, 'renderer/pages/BrollLibraryPage.tsx'), 'utf8')
  assert.match(page, /!autoIndexAllowed\(view\.pendingShots\)\) return/)
})
