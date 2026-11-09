// Combine clips (Edit my recording): filming order, moving and removing clips, the plan with clip boundaries, the
// review's play order, "What changed", the chat's clip tools, and unpacking a .zip of clips safely.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { loadMain } = require('../zernio/support/load-main.cjs')

const combine = loadMain("export * from './src/shared/combine-clips'")
const recording = loadMain("export * from './src/shared/edit-recording'")
const chat = loadMain("export * from './src/shared/edit-chat'")
const log = loadMain("export * from './src/shared/edit-log'")
const zip = loadMain("export * from './src/main/combine-import'")
const plain = (x) => JSON.parse(JSON.stringify(x))
const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message), `expected ${pattern}`)

test('filming order: by when the camera wrote each file, else by file name (IMG_2 before IMG_10)', () => {
  const clips = [{ name: 'IMG_2957.MOV', createdAt: '2026-10-21T13:28:00Z' }, { name: 'IMG_2955.MOV', createdAt: '2026-10-21T13:27:06Z' }, { name: 'IMG_2956.MOV', createdAt: '2026-10-21T13:27:18Z' }]
  assert.deepEqual(plain(combine.filmingOrder(clips)), [1, 2, 0])
  assert.equal(combine.orderedBy(clips), 'time')
  // One clip without a time: all by name, naturally.
  const named = [{ name: 'clip 10.mp4' }, { name: 'clip 2.mp4', createdAt: '2026-01-01T00:00:00Z' }, { name: 'Clip 1.mp4' }]
  assert.deepEqual(plain(combine.filmingOrder(named)), [2, 1, 0])
  assert.equal(combine.orderedBy(named), 'name')
  // Same time: by name.
  assert.deepEqual(plain(combine.filmingOrder([{ name: 'b.mov', createdAt: '2026-01-01T00:00:00Z' }, { name: 'a.mov', createdAt: '2026-01-01T00:00:00Z' }])), [1, 0])
})

test('moving, removing and putting back clips; a play order is checked', () => {
  assert.deepEqual(plain(combine.moveClip([0, 1, 2, 3], 2, -1)), [0, 2, 1, 3])
  assert.deepEqual(plain(combine.moveClip([0, 1, 2, 3], 0, -1)), [0, 1, 2, 3])
  assert.deepEqual(plain(combine.moveClip([0, 1, 2, 3], 3, 0, 0)), [3, 0, 1, 2])
  assert.deepEqual(plain(combine.moveClip([0, 1, 2, 3], 0, 0, 9)), [1, 2, 3, 0])
  assert.deepEqual(plain(combine.removeClip([2, 0, 1], 0)), [2, 1])
  assert.deepEqual(plain(combine.removeClip([1], 1)), [1], 'the last clip stays')
  assert.deepEqual(plain(combine.restoreClip([3, 0, 2], 1)), [1, 3, 0, 2], 'put back before the first playing clip filmed after it')
  assert.deepEqual(plain(combine.restoreClip([0, 2, 3], 1)), [0, 1, 2, 3])
  assert.deepEqual(plain(combine.parseClipOrder([2, 0], 3)), [2, 0])
  for (const bad of [[], [0, 0], [3], [0.5], 'x', [0, 1, 2, 0]]) assert.equal(combine.parseClipOrder(bad, 3), null, JSON.stringify(bad))
})

/** Clip 1 (screen) shows a dashboard; clip 2 (face) has the hook and the call to action; clip 3 is a short aside. */
function samplePlan(extra = {}) {
  const words = []
  const say = (text, start, src) => text.split(' ').forEach((word, i) => words.push([word, Math.round((start + i * 0.32) * 1000), Math.round((start + i * 0.32 + 0.28) * 1000), src, null]))
  say('Look at my dashboard. Total earnings $8,188 this month.', 1.2, 0) // 0-8, starts 1.2 s in (dead air)
  say('You don’t need a big audience. Follow me for the steps.', 0.3, 1) // 9-19
  say('One more thing to say.', 0.3, 2) // 20-24
  return recording.parseEditPlan({
    words, hooks: [{ id: 0, start: 9, end: 14, text: 'You don’t need a big audience', why: 'A bold claim' }], hook: 0, cta: { start: 15, end: 19 },
    popups: [], sounds: [], planned: 'ai', notes: [], warnings: [],
    combine: { ai_order: [2, 1, 3].map((n) => n - 1), order_why: 'Your claim first, then the proof.', proof: [{ word: 6, value: '$8,188', label: 'Total earnings' }], ...extra }
  }, 3)
}
const SOURCES = [{ path: '/a', name: 'IMG_2955.MOV', seconds: 7.7, shot: 'screen', steadied: true }, { path: '/b', name: 'IMG_2956.MOV', seconds: 5.0, shot: 'face' }, { path: '/c', name: 'IMG_2957.MOV', seconds: 3.0, shot: 'face' }]

test('the plan keeps the clips: the AI order and proof graphics are checked, the review starts in filming order', () => {
  const plan = samplePlan()
  assert.deepEqual(plain(plan.combine), { aiOrder: [1, 0, 2], orderWhy: 'Your claim first, then the proof.', proof: [{ word: 6, value: '$8,188', label: 'Total earnings' }], startOrder: [0, 1, 2] })
  // An order that isn't every clip once makes the plan unreadable; a missing one is fine.
  assert.equal(samplePlan({ ai_order: [0, 0, 1] }), null)
  assert.equal(samplePlan({ ai_order: null }).combine.aiOrder, null)
  assert.equal(samplePlan({ ai_order: null }).combine.orderWhy, '')
  const d = recording.initialDecisions(plan)
  assert.deepEqual(plain(d.clipOrder), [0, 1, 2])
  assert.equal(d.transitions, false)
  // The proof graphic: a stat on "$8,188", marked as added by the app.
  assert.equal(d.graphics.length, 1)
  assert.deepEqual(plain([d.graphics[0].template, d.graphics[0].word, d.graphics[0].fields, d.graphics[0].origin]), ['stat', 6, { value: '$8,188', label: 'Total earnings' }, 'auto'])
})

test('the reel plays the hook first, then clip by clip in the member’s order; a left-out clip plays nothing', () => {
  const plan = samplePlan()
  const d = recording.initialDecisions(plan)
  const text = (order) => order.map((i) => plan.words[i].text).join(' ')
  assert.equal(text(recording.reelOrder(plan, d)), 'You don’t need a big audience. Look at my dashboard. Total earnings $8,188 this month. One more thing to say. Follow me for the steps.')
  const moved = { ...d, clipOrder: [2, 0, 1] }
  assert.equal(text(recording.reelOrder(plan, moved)), 'You don’t need a big audience. One more thing to say. Look at my dashboard. Total earnings $8,188 this month. Follow me for the steps.')
  const removed = { ...d, clipOrder: [1, 0] }
  assert.ok(!text(recording.reelOrder(plan, removed)).includes('One more thing'))
  // Removing the hook's clip removes the hook too.
  assert.ok(!text(recording.reelOrder(plan, { ...d, clipOrder: [0, 2] })).includes('audience'))
  // Checked like Make my reel: a bad order is refused, transitions must be true or false.
  const checked = recording.parseEditDecisions({ ...plain(d), clipOrder: [2, 0] }, plan)
  assert.deepEqual(plain(checked.clipOrder), [2, 0])
  assert.throws(() => recording.parseEditDecisions({ ...plain(d), clipOrder: [0, 0] }, plan), /Put your clips in order again/)
  assert.throws(() => recording.parseEditDecisions({ ...plain(d), clipOrder: [5] }, plan), /Put your clips in order again/)
  assert.throws(() => recording.parseEditDecisions({ ...plain(d), transitions: 'yes' }, plan), /transitions/)
  // A plan without clips ignores both.
  assert.equal(recording.reelOrder(plan, { ...d, clipOrder: undefined }).length, 25)
})

test('What changed: the order, the dead air trimmed, clips evened out, screens steadied, proof graphics', () => {
  const plan = samplePlan()
  const d = recording.initialDecisions(plan)
  const lines = log.editRecordingLog(plan, d, SOURCES)
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]))
  assert.equal(byId.order.text, 'Ordered 3 clips by their file names (the order they were filmed)')
  assert.equal(byId['dead-air-start'].text, 'Trimmed 1.1 s of dead air from 1 clip start')
  assert.match(byId['dead-air-end'].text, /^Trimmed \d+(\.\d)? s of dead air from 3 clip ends$/)
  assert.equal(byId.evened.text, 'Evened out brightness and loudness across 3 clips')
  assert.equal(byId.screens.text, 'Steadied and zoomed in on the screen in 1 screen clip')
  assert.equal(byId.proof.text, 'Added a $8,188 stat on what you said')
  // Restore: the proof graphic goes; the AI's order goes back to filming order.
  assert.deepEqual(plain(byId.proof.restore.graphics), [])
  const timed = SOURCES.map((s, i) => ({ ...s, createdAt: `2026-10-21T13:2${i}:00Z` }))
  const ai = log.editRecordingLog(plan, { ...d, clipOrder: [1, 0, 2] }, timed)
  const order = ai.find((l) => l.id === 'order')
  assert.equal(order.text, 'Put 3 clips in the AI’s order: Your claim first, then the proof.')
  assert.deepEqual(plain(order.restore), { clipOrder: [0, 1, 2] })
  assert.equal(log.editRecordingLog(plan, d, timed).find((l) => l.id === 'order').text, 'Ordered 3 clips by when they were filmed')
  // Moved by hand: no order line (the member did that).
  assert.ok(!log.editRecordingLog(plan, { ...d, clipOrder: [2, 1, 0] }, SOURCES).some((l) => l.id === 'order'))
})

test('chat: move, remove and put back clips, the AI order, transitions; errors go back to the model', () => {
  const plan = samplePlan()
  const ctx = { plan, images: [] }
  const d = plain(recording.initialDecisions(plan))
  let r = chat.applyEditChatTool(d, 'move_clip', { clip: 3, position: 1, reason: 'start with the aside' }, ctx)
  assert.deepEqual(plain(r.step.patch), { clipOrder: [2, 0, 1] })
  assert.equal(r.step.summary, 'Moved clip 3 to play first (start with the aside).')
  r = chat.applyEditChatTool(r.decisions, 'remove_clip', { clip: 1 }, ctx)
  assert.deepEqual(plain(r.decisions.clipOrder), [2, 1])
  toolError(() => chat.applyEditChatTool(r.decisions, 'move_clip', { clip: 1, position: 1 }, ctx), /was removed/)
  r = chat.applyEditChatTool(r.decisions, 'restore_clip', { clip: 1 }, ctx)
  assert.deepEqual(plain(r.decisions.clipOrder), [0, 2, 1])
  r = chat.applyEditChatTool(d, 'order_clips', { order: 'ai' }, ctx)
  assert.deepEqual(plain(r.step.patch), { clipOrder: [1, 0, 2] })
  assert.match(r.step.summary, /^Put the clips in the AI’s order: Your claim first/)
  toolError(() => chat.applyEditChatTool(d, 'order_clips', { order: 'filmed' }, ctx), /already in the order they were filmed/)
  toolError(() => chat.applyEditChatTool(d, 'order_clips', { order: 'random' }, ctx), /"ai" or "filmed"/)
  r = chat.applyEditChatTool(d, 'set_transitions', { on: true }, ctx)
  assert.deepEqual(plain(r.step.patch), { transitions: true })
  toolError(() => chat.applyEditChatTool(d, 'move_clip', { clip: 9, position: 1 }, ctx), /clip number from 1 to 3/)
  toolError(() => chat.applyEditChatTool(d, 'move_clip', { clip: 1, position: 1 }, ctx), /already plays there/)
  toolError(() => chat.applyEditChatTool({ ...d, clipOrder: [0] }, 'remove_clip', { clip: 1 }, ctx), /only clip left/)
  // The page applies the steps (checked again like Make my reel).
  assert.deepEqual(plain(chat.mergeEditChatSteps(d, [r.step, chat.applyEditChatTool(d, 'remove_clip', { clip: 3 }, ctx).step], ctx)), { transitions: true, clipOrder: [0, 1] })
  // The context shows the clips, their order and shots; a recording of takes doesn't get the clip tools.
  const context = chat.editChatContext(d, ctx, SOURCES)
  assert.match(context, /COMBINED from 3 clips/)
  assert.match(context, /clip 1: IMG_2955\.MOV \(screen\)/)
  assert.match(context, /They play in this order: clip 1, clip 2, clip 3\./)
  assert.match(context, /— Clip 2 —/)
  const takes = recording.parseEditPlan({ ...plain(plan), combine: undefined, words: plan.words.map((w) => [w.text, w.startMs, w.endMs, w.src, w.cut]) }, 3)
  toolError(() => chat.applyEditChatTool(plain(recording.initialDecisions(takes)), 'move_clip', { clip: 1, position: 2 }, { plan: takes, images: [] }), /not clips to combine/)
  assert.deepEqual(plain(chat.COMBINE_CHAT_TOOLS), ['move_clip', 'remove_clip', 'restore_clip', 'order_clips', 'set_transitions'])
})

test('dead air: the silence before the first word and after the last of each playing clip', () => {
  const plan = samplePlan()
  const air = combine.deadAir(plan.words, SOURCES, [0, 1, 2])
  assert.equal(air.starts, 1)
  assert.equal(air.startMs, 1200 - 80)
  // A removed clip doesn't count.
  assert.equal(combine.deadAir(plan.words, SOURCES, [1, 2]).starts, 0)
})

// ---------------------------------------------------------------------------
// A .zip of clips
// ---------------------------------------------------------------------------

/** A zip from entries {name, data, method (0 stored, 8 deflate), flags, unixMode, crc, size} (the last two override what's written). */
function makeZip(entries) {
  const locals = [], centrals = []
  let offset = 0
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '')
    const body = e.method === 8 ? zlib.deflateRawSync(data) : data
    const name = Buffer.from(e.name)
    const crc = e.crc ?? zlib.crc32(data)
    const size = e.size ?? data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE((e.flags ?? 0) | 0x800, 6); local.writeUInt16LE(e.method ?? 0, 8)
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(e.unixMode ? (3 << 8) | 20 : 20, 4); central.writeUInt16LE(20, 6)
    central.writeUInt16LE((e.flags ?? 0) | 0x800, 8); central.writeUInt16LE(e.method ?? 0, 10); central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(e.unixMode ? (e.unixMode << 16) >>> 0 : 0, 38); central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'combine-zip-'))
test.after(() => fs.rmSync(temp, { recursive: true, force: true }))
const writeZip = (name, entries) => { const file = path.join(temp, name); fs.writeFileSync(file, makeZip(entries)); return file }

test('a .zip of clips: only videos, flattened to their names, outside nothing; __MACOSX, dotfiles and folders skipped', async () => {
  const big = 'x'.repeat(200000)
  const file = writeZip('clips.zip', [
    { name: 'Trip/IMG_2955.MOV', data: 'first clip', method: 0 },
    { name: '../../escape/IMG_2956.mov', data: big, method: 8 },
    { name: '__MACOSX/Trip/._IMG_2955.MOV', data: 'resource fork' },
    { name: 'Trip/.hidden.mp4', data: 'hidden' },
    { name: '.git/x.mp4', data: 'x' },
    { name: 'Trip/notes.txt', data: 'notes' },
    { name: 'Trip/', data: '' },
    { name: 'Other/IMG_2955.MOV', data: 'same name, other folder', method: 8 }
  ])
  const folder = path.join(temp, 'out-1')
  const seen = []
  const written = await zip.extractZipClips(file, folder, (files) => seen.push(files))
  assert.deepEqual(written.map((f) => path.relative(folder, f)), ['IMG_2955.MOV', 'IMG_2956.mov', 'IMG_2955 (2).MOV'])
  assert.equal(fs.readFileSync(written[1], 'utf8'), big)
  assert.deepEqual(fs.readdirSync(folder).sort(), ['IMG_2955 (2).MOV', 'IMG_2955.MOV', 'IMG_2956.mov'])
  assert.ok(!fs.existsSync(path.join(temp, 'escape')))
  // Each file's progress: copying, then checking.
  const last = seen[seen.length - 1]
  assert.deepEqual(last.map((f) => f.phase), ['checking', 'checking', 'checking'])
  assert.ok(seen.some((files) => files[1].phase === 'copying'))
  assert.equal(zip.isClipEntry({ name: 'a/b/c.MKV' }), true)
  assert.equal(zip.isClipEntry({ name: 'a/.b/c.mp4' }), false)
})

test('a .zip that can’t be used is refused and leaves nothing behind', async () => {
  const cases = [
    [[{ name: 'a.mp4', data: 'abc', crc: 1 }], /damaged/],
    // Says 3 bytes, unpacks to more: stopped (a zip bomb can't fill the disk).
    [[{ name: 'a.mp4', data: 'x'.repeat(50000), method: 8, size: 3 }], /bigger than the \.zip says/],
    [[{ name: 'a.mp4', data: 'abc', flags: 1 }], /password-protected/],
    [[{ name: 'a.mp4', data: '/etc/passwd', unixMode: 0o120777 }], /link/],
    [[{ name: 'notes.txt', data: 'abc' }], /no video clips/],
    [Array.from({ length: 31 }, (_, i) => ({ name: `c${i}.mp4`, data: 'a' })), /Use up to 30/]
  ]
  for (const [n, [entries, pattern]] of cases.entries()) {
    const folder = path.join(temp, `bad-${n}`)
    await assert.rejects(zip.extractZipClips(writeZip(`bad-${n}.zip`, entries), folder), pattern)
    assert.ok(!fs.existsSync(folder), `case ${n} left files`)
  }
  fs.writeFileSync(path.join(temp, 'not.zip'), 'not a zip at all, just text that is long enough to scan')
  await assert.rejects(zip.extractZipClips(path.join(temp, 'not.zip'), path.join(temp, 'bad-x')), /damaged/)
  // Too much unpacked in all.
  await assert.rejects(zip.extractZipClips(writeZip('big.zip', [{ name: 'a.mp4', data: 'abcdef' }]), path.join(temp, 'bad-y'), () => {}, { clips: 30, bytes: 3 }), /add up to over/)
})

test('imports not in use are cleaned up; one in use stays', async () => {
  const out = path.join(temp, 'library')
  const used = zip.importFolder(out), stale = zip.importFolder(out)
  for (const dir of [used, stale]) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'a.mp4'), 'x') }
  await zip.cleanupImports(out, [path.join(used, 'a.mp4')])
  assert.ok(fs.existsSync(used))
  assert.ok(!fs.existsSync(stale))
})
