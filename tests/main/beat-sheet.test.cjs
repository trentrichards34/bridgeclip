// The beat sheet (Edit my recording / Combine clips review): beats from the plan in play order, numbered, with
// moments that start together merged; per-beat edits change only that beat; the words-said rule on typed numbers;
// notes scoped to one beat; the "before each reel" choice; and the frames' cache.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadMain } = require('../zernio/support/load-main.cjs')

const lib = loadMain(`export * from './src/shared/beat-sheet'
  export { parseEditPlan, initialDecisions, reelWordStarts } from './src/shared/edit-recording'`)
const plain = (x) => JSON.parse(JSON.stringify(x))

const TEXT = 'Fifteen billion messages wait. Most coaches lose clients. Here are three steps. First write hooks. Follow me for more.'.split(' ')
const PLAN = lib.parseEditPlan({
  words: TEXT.map((w, i) => [w, i * 300, i * 300 + 260, 0, null]),
  hooks: [{ id: 0, start: 0, end: 3, text: '15 billion messages wait', why: 'A number' }], hook: 0,
  cta: { start: 15, end: 18 },
  popups: [
    { id: 0, word: 1, text: '15 billion', kind: 'number' },
    { id: 1, word: 5, kind: 'card', card: { type: 'stat', title: '40%', items: ['of coaches'] }, seconds: 2.5 },
    { id: 2, word: 13, text: 'hooks', kind: 'keyword' }
  ],
  sounds: [], planned: 'ai', notes: [], warnings: []
}, 1)
const graphic = (id, template, word, duration_ms, fields, extra = {}) => ({ id, template, word, duration_ms, placement: 'top', fields, origin: 'auto', ...extra })
function start(extra = {}) {
  const d = lib.initialDecisions(PLAN)
  return { ...d, popups: d.popups.map((p) => ({ ...p, on: true })), motionGraphics: true, stageLayouts: true, graphics: [
    graphic('gaaaaaaa', 'stat', 6, 2000, { value: '40%', label: 'lose clients' }),
    graphic('gbbbbbbb', 'fx', 10, 3500, { effect: 'count-up', value: '3', suffix: ' steps' }),
    graphic('gccccccc', 'title', 12, 1500, { text: 'Write hooks' })
  ], ...extra }
}
const hashes = (beats) => Object.fromEntries(beats.map((b) => [b.key, b.hash]))

test('beats come in play order, numbered from 1: the hook, each moment, the call to action last', () => {
  const beats = lib.deriveBeats(PLAN, start())
  assert.deepEqual(beats.map((b) => b.number), beats.map((_, i) => i + 1))
  assert.deepEqual(beats.map((b) => b.key), ['hook', 'p:0', 'p:1', 'g:gbbbbbbb', 'g:gccccccc', 'cta'])
  for (let i = 1; i < beats.length; i++) assert.ok(beats[i].start >= beats[i - 1].start, 'in time order')
  const [hook, popup, , count, , cta] = beats
  assert.equal(hook.start, 0)
  assert.equal(hook.shown, 'Hook text: “15 billion messages wait”')
  assert.equal(hook.words, 'Fifteen billion messages wait.')
  assert.equal(hook.sound, 'Swipe')
  assert.equal(popup.shown, 'Pop-up: 15 billion')
  assert.equal(count.shown, 'Count up: 3 · steps', 'the effect’s name and its words')
  assert.equal(count.words.split(' ')[0], 'three', 'the words said as it starts')
  assert.equal(cta.kind, 'cta')
  assert.match(cta.shown, /^Call to action: “Follow me for more\.”$/)
  // A short call to action that ends the reel: its button is left out (engine spoken_cta), and the sheet says so.
  assert.match(cta.problem, /ends too soon after it for its button to show/)
  assert.equal(cta.visual, null)
  const longer = lib.parseEditPlan({ words: [...TEXT, 'tips', 'every', 'single', 'week', 'here.'].map((w, i) => [w, i * 300, i * 300 + 260, 0, null]), hooks: [], hook: null,
    cta: { start: 15, end: 23 }, popups: [], sounds: [], planned: 'ai', notes: [], warnings: [] }, 1)
  const ask = lib.deriveBeats(longer, { ...lib.initialDecisions(longer), motionGraphics: true }).at(-1)
  assert.equal(ask.problem, null)
  assert.equal(ask.visual.graphic.template, 'link_cta')
  assert.equal(ask.sound, 'Riser, then click', 'Teaching builds a riser into the call to action')
  // Each beat's still: a frame of its clip at its key moment, after its start.
  for (const b of beats) { assert.equal(b.frame.src, 0); assert.ok(b.at >= b.start && b.at <= Math.max(b.end, b.start + 2)) }
  assert.ok(count.frame.ms >= 10 * 300, 'the count-up still is taken after its word starts')
  assert.equal(count.visual.type, 'graphic')
  assert.ok(count.visual.atMs > 0 && count.visual.atMs < 3500, 'drawn settled, inside its length')
  // The hook text shows over the first seconds only.
  assert.equal(hook.hookText, '15 billion messages wait')
})

test('moments that start together, and a pop-up while a graphic is up, are one beat', () => {
  const beats = lib.deriveBeats(PLAN, start())
  const card = beats.find((b) => b.key === 'p:1')
  // The stat on "lose" starts 0.3 s after the card on "coaches": one beat, led by the card (and it is left out under it).
  assert.deepEqual(card.parts.map((p) => p.ref), ['p:1', 'g:gaaaaaaa'])
  assert.equal(card.kind, 'card')
  assert.match(card.shown, /^Half-screen big number: 40% \+ stat counter$/)
  assert.match(card.problem, /half-screen graphic, so it will be left out/)
  assert.equal(card.scene, 'stage', 'a half-screen graphic plays on the stage with Stage layouts on')
  assert.equal(card.sound, 'Whoosh')
  const title = beats.find((b) => b.key === 'g:gccccccc')
  assert.deepEqual(title.parts.map((p) => p.ref), ['g:gccccccc', 'p:2'], 'the pop-up on "write" plays while the title is up')
  // A graphic 2 s away from another stays its own beat; the hook never takes in another moment.
  assert.equal(beats.find((b) => b.key === 'p:0').parts.length, 1)
  assert.equal(beats.find((b) => b.key === 'hook').parts.length, 1)
  // Far apart: no merge.
  const apart = lib.deriveBeats(PLAN, start({ popups: start().popups.map((p) => p.id === 2 ? p : { ...p, on: false }), graphics: [graphic('gccccccc', 'title', 9, 800, { text: 'Write hooks' })] }))
  assert.deepEqual(apart.filter((b) => b.kind !== 'hook' && b.kind !== 'cta').map((b) => b.parts.length), [1, 1])
})

test('what will not show is not a beat: a cut word, Motion graphics off, the Minimal style', () => {
  const cut = lib.deriveBeats(PLAN, start({ cut: [10] }))
  assert.ok(!cut.some((b) => b.key === 'g:gbbbbbbb'))
  const off = lib.deriveBeats(PLAN, start({ motionGraphics: false }))
  assert.ok(!off.some((b) => b.kind === 'graphic' || b.parts.some((p) => p.kind === 'graphic')), 'automatic graphics are off')
  assert.ok(!off.some((b) => b.kind === 'cta'), 'no call-to-action graphic without motion graphics')
  const minimal = lib.deriveBeats(PLAN, start({ soundStyle: 'minimal' }))
  assert.ok(minimal.some((b) => b.key === 'g:gbbbbbbb'), 'a count-up stays in Minimal')
  assert.ok(!minimal.some((b) => b.key === 'g:gccccccc'), 'a title does not')
  assert.equal(lib.deriveBeats(PLAN, start({ soundEffects: false }))[0].sound, null)
  // A popup that is off is not on the sheet.
  assert.ok(!lib.deriveBeats(PLAN, start({ popups: start().popups.map((p) => ({ ...p, on: p.id !== 0 })) })).some((b) => b.key === 'p:0'))
})

test('removing a beat changes only that beat, and Bring back restores it exactly', () => {
  const d = start()
  const before = lib.deriveBeats(PLAN, d)
  const count = before.find((b) => b.key === 'g:gbbbbbbb')
  const { decisions, undo } = lib.removeBeat(d, count)
  const after = lib.deriveBeats(PLAN, decisions)
  assert.ok(!after.some((b) => b.key === count.key))
  const rest = hashes(before); delete rest[count.key]
  assert.deepEqual(hashes(after), rest, 'every other beat (and its still) is unchanged')
  assert.deepEqual(plain(decisions.popups), plain(d.popups))
  assert.deepEqual(hashes(lib.deriveBeats(PLAN, lib.restoreBeat(decisions, undo))), hashes(before))
  // A merged beat goes with all its parts; a pop-up is switched off, not deleted.
  const card = before.find((b) => b.key === 'p:1')
  const gone = lib.removeBeat(d, card).decisions
  assert.equal(gone.popups.find((p) => p.id === 1).on, false)
  assert.ok(!gone.graphics.some((g) => g.id === 'gaaaaaaa'))
  // The hook loses its text (its words still open the reel); the call to action stays where it was said.
  const hook = lib.removeBeat(d, before[0])
  assert.equal(hook.decisions.hookText, '')
  assert.equal(lib.restoreBeat(hook.decisions, hook.undo).hookText, d.hookText)
  assert.equal(lib.removeBeat(d, before.at(-1)).decisions.endOnCta, false)
})

test('swap, move and edit text change only that beat', () => {
  const d = start()
  const before = lib.deriveBeats(PLAN, d)
  const count = before.find((b) => b.key === 'g:gbbbbbbb')
  const others = (beats, key) => { const h = hashes(beats); delete h[key]; return h }

  const swapped = lib.swapBeatVisual(d, count, 'fx', { value: '3', label: 'steps' }, 'chart-story')
  assert.equal(swapped.key, count.key, 'a graphic keeps its id and word')
  const g = swapped.decisions.graphics.find((x) => x.id === 'gbbbbbbb')
  assert.equal(g.fields.effect, 'chart-story'); assert.equal(g.word, 10); assert.equal(g.origin, 'member')
  const afterSwap = lib.deriveBeats(PLAN, swapped.decisions)
  assert.notEqual(hashes(afterSwap)[count.key], count.hash)
  assert.deepEqual(others(afterSwap, count.key), others(before, count.key))

  // A pop-up swapped for a graphic: the pop-up is switched off and the graphic starts on its word.
  const popup = before.find((b) => b.key === 'p:0')
  const turned = lib.swapBeatVisual(d, popup, 'stat', { value: '15 billion' })
  assert.match(turned.key, /^g:/)
  assert.equal(turned.decisions.popups.find((p) => p.id === 0).on, false)
  assert.equal(turned.decisions.graphics.find((x) => `g:${x.id}` === turned.key).word, 1)
  const afterTurn = lib.deriveBeats(PLAN, turned.decisions)
  assert.deepEqual(others(afterTurn, turned.key), others(before, 'p:0'))

  const moved = lib.moveBeat(PLAN, d, count, -1)
  assert.equal(moved.decisions.graphics.find((x) => x.id === 'gbbbbbbb').word, 9)
  // A word later it starts 0.3 s before the title: the two become one beat.
  assert.deepEqual(lib.deriveBeats(PLAN, lib.moveBeat(PLAN, d, count, 1).decisions).find((b) => b.key === count.key).parts.map((p) => p.ref), ['g:gbbbbbbb', 'g:gccccccc', 'p:2'])
  assert.deepEqual(others(lib.deriveBeats(PLAN, moved.decisions), count.key), others(before, count.key))
  assert.equal(lib.moveBeat(PLAN, d, before[0], 1), null, 'the hook does not move')
  assert.deepEqual(plain(lib.beatActions(before[0])), { swap: false, move: false, text: true })

  const edited = lib.editBeatText(d, count, { fields: { label: 'simple steps' } })
  assert.equal(edited.graphics.find((x) => x.id === 'gbbbbbbb').fields.label, 'simple steps')
  assert.deepEqual(others(lib.deriveBeats(PLAN, edited), count.key), others(before, count.key))
  assert.equal(lib.editBeatText(d, popup, { text: '15B' }).popups.find((p) => p.id === 0).text, '15B')
  assert.equal(lib.editBeatText(d, before[0], { hookText: 'New hook here' }).hookText, 'New hook here')
})

test('the words-said rule: a typed number must be one that is said in the reel', () => {
  const d = start()
  assert.equal(lib.unsaidNumber(PLAN, d, ['15 billion', 'messages']), null, '"Fifteen billion" is said')
  assert.equal(lib.unsaidNumber(PLAN, d, ['15,000,000,000']), null)
  assert.equal(lib.unsaidNumber(PLAN, d, ['3 steps']), null, '"three" is said')
  assert.match(lib.unsaidNumber(PLAN, d, ['$4,215']), /“\$?4,215” isn’t a number you say/)
  assert.match(lib.unsaidNumber(PLAN, { ...d, cut: [10] }, ['3 steps']), /“3”/, 'a cut word is not said in the reel')
  assert.deepEqual(plain(lib.unsaidWords(PLAN, d, ['Write better hooks'])), ['better'])
})

test('a note goes to the chat for one beat: changes elsewhere are left out', () => {
  const d = start()
  const beats = lib.deriveBeats(PLAN, d)
  const count = beats.find((b) => b.key === 'g:gbbbbbbb')
  const message = lib.beatNoteMessage(count, 'use a chart here')
  assert.match(message, /^Beat 4 only \(Count up: 3 · steps, at 0:03\.0, while I say “three/)
  assert.match(message, /graphic gbbbbbbb/)
  assert.match(message, /use a chart here\. Change only this beat/)
  const graphics = d.graphics.map((g) => g.id === 'gbbbbbbb' ? { ...g, fields: { effect: 'chart-story', data: '3' } } : g.id === 'gccccccc' ? { ...g, duration_ms: 3000 } : g)
  const scoped = lib.scopeBeatPatch(PLAN, d, count, { graphics: [...graphics, graphic('gddddddd', 'stat', 11, 2000, { value: '3' }), graphic('geeeeeee', 'stat', 1, 2000, { value: '15' })], hookText: 'Other', cut: [] })
  assert.deepEqual(scoped.patch.graphics.map((g) => g.id), ['gaaaaaaa', 'gbbbbbbb', 'gddddddd', 'gccccccc'], 'its own change and a new graphic within the beat')
  assert.equal(scoped.patch.graphics.find((g) => g.id === 'gbbbbbbb').fields.effect, 'chart-story')
  assert.equal(scoped.patch.graphics.find((g) => g.id === 'gccccccc').duration_ms, 1500, 'another beat stays as it was')
  assert.equal(scoped.patch.hookText, undefined)
  assert.deepEqual(plain(scoped.dropped).sort(), ['cut', 'hookText', 'other graphics'])
  assert.equal(lib.scopeBeatPatch(PLAN, d, beats[0], { hookText: 'Fifteen billion wait' }).patch.hookText, 'Fifteen billion wait')
})

test('before each reel: ask, open the beat sheet, or make it', () => {
  assert.equal(lib.beforeRender(undefined, false), 'ask')
  assert.equal(lib.beforeRender('ask', false), 'ask')
  assert.equal(lib.beforeRender('always', false), 'sheet')
  assert.equal(lib.beforeRender('skip', false), 'render')
  assert.equal(lib.beforeRender('always', true), 'render', 'from the beat sheet, "Looks good, render" makes it')
})

test('frames are cached by the file and the moment, made once, at most two at a time', async () => {
  const stills = loadMain("export * from './src/main/beat-stills'", { './tools': { resolveBinary: (name) => name } })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-stills-'))
  try {
    const video = path.join(dir, 'take.mp4')
    fs.writeFileSync(video, 'video')
    const calls = []
    let running = 0, most = 0
    const run = async (file, ms, out) => { calls.push(ms); running++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, 20)); fs.writeFileSync(out, `jpg ${ms}`); running-- }
    const folder = path.join(dir, '.work', 'beats')
    const first = await stills.beatFrame(folder, video, 1000, run)
    assert.match(path.basename(first), /^[a-f0-9]{32}\.jpg$/)
    assert.equal(await stills.beatFrame(folder, video, 1010, run), first, 'the same frame (to 40 ms) comes from the cache')
    assert.equal(calls.length, 1)
    // Several at once: two at a time; the same one asked twice is made once.
    const many = await Promise.all([2000, 3000, 4000, 5000, 5000].map((ms) => stills.beatFrame(folder, video, ms, run)))
    assert.equal(new Set(many).size, 4)
    assert.equal(calls.length, 5)
    assert.ok(most <= stills.BEAT_FRAME_CONCURRENCY, `at most ${stills.BEAT_FRAME_CONCURRENCY} at once (${most})`)
    // A changed file is a new frame.
    fs.writeFileSync(video, 'video, edited')
    assert.notEqual(await stills.beatFrame(folder, video, 1000, run), first)
    assert.notEqual(stills.beatFrameKey(video, 5, 1, 1000), stills.beatFrameKey(video, 5, 2, 1000))
    // A failed seek leaves nothing behind.
    await assert.rejects(stills.beatFrame(folder, video, 9000, async () => { throw new Error('no frame') }), /no frame/)
    assert.ok(!fs.readdirSync(folder).some((name) => name.startsWith('.tmp-')))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Flat stretches: where nothing on the graphics layer or scene changes for too long
// ---------------------------------------------------------------------------

function flatPlan(sentences) {
  const words = sentences.join(' ').split(' ')
  return lib.parseEditPlan({ words: words.map((w, i) => [w, i * 300, i * 300 + 260, 0, null]), hooks: [], hook: null, cta: null, popups: [], sounds: [], planned: 'ai', notes: [], warnings: [] }, 1)
}
const TALK = ['We made 4365 dollars on ads yesterday.', 'The offer brings people in every single week.', 'Then the product does the selling for us.', 'Most coaches never test a paid offer at all.',
  'They post and hope the right people see it.', 'Ads put the offer in front of buyers every day.', 'That is the whole machine in three parts.', 'Follow along and build yours this month.']

test('flat stretches: a graphic that holds still, and long plain-face stretches outside personal lines', () => {
  const plan = flatPlan(TALK)
  const d = { ...lib.initialDecisions(plan), motionGraphics: true, stageLayouts: true, graphics: [graphic('gstatone', 'stat', 2, 6000, { value: '$4,365', label: 'on ads' })] }
  const beats = lib.deriveBeats(plan, d)
  const flats = plain(lib.reelFlatStretches(plan, d, beats))
  // The stat has settled after about 1.5 s and holds still until its exit: frozen.
  const frozen = flats.find((f) => f.why === 'frozen')
  assert.ok(frozen, JSON.stringify(flats)); assert.equal(frozen.ref, 'g:gstatone')
  assert.ok(frozen.from >= 2 && frozen.from < 3 && frozen.to > 6 && frozen.to < 7, JSON.stringify(frozen))
  // After it, the face talks for many seconds with nothing new on screen: one stretch, with a word to add a visual on.
  const nothing = flats.filter((f) => f.why === 'nothing')
  assert.equal(nothing.length, 1); assert.ok(nothing[0].to - nothing[0].from > lib.REEL_FACE_FLAT_SECONDS)
  assert.ok(Number.isInteger(nothing[0].word))
  // A custom graphic counts as moving, except where its motion check measured it flat.
  const custom = { ...d, graphics: [graphic('gcustom1', 'custom', 2, 6000, { comp: 'a'.repeat(16), idea: 'Drawn for the proof', scene: 'stage' }, { size: 'stage' })] }
  assert.ok(!lib.reelFlatStretches(plan, custom, lib.deriveBeats(plan, custom)).some((f) => f.why === 'frozen'))
  const measured = plain(lib.reelFlatStretches(plan, custom, lib.deriveBeats(plan, custom), { customFlat: { ['a'.repeat(16)]: [{ fromMs: 1500, toMs: 4000 }] } }))
  assert.ok(measured.some((f) => f.why === 'frozen' && f.ref === 'g:gcustom1'), JSON.stringify(measured))
  // Shorten a frozen template graphic: it ends soon after it settles.
  const shorter = lib.shortenFrozen(d, 'g:gstatone')
  assert.ok(shorter.graphics[0].duration_ms < 6000)
  assert.equal(lib.shortenFrozen(custom, 'g:gcustom1'), null)
})

test('flat stretches: personal lines stay on the face; "Add a visual here" adds one with the words said there', () => {
  assert.equal(lib.personalLine('I remember how scared I felt when my family had nothing.'), true)
  assert.equal(lib.personalLine('Ads put the offer in front of buyers every day.'), false)
  const story = ['I remember how scared I felt that first year with my family.', 'Honestly I thought I would lose everything I loved back then.', 'My kids would ask me why I worked so late every night.',
    'I was a nobody and I felt it every single day of that year.', 'I remember my wife telling me to keep going when I was afraid.', 'And I felt that I owed it to my family to keep going.']
  const plan = flatPlan(story)
  const d = { ...lib.initialDecisions(plan), motionGraphics: true, graphics: [] }
  assert.deepEqual(plain(lib.reelFlatStretches(plan, d, lib.deriveBeats(plan, d))), [], 'a personal story is left on the face')
  const talk = flatPlan(TALK)
  const td = { ...lib.initialDecisions(talk), motionGraphics: true, graphics: [] }
  const flats = lib.reelFlatStretches(talk, td, lib.deriveBeats(talk, td))
  assert.ok(flats.length >= 1)
  const added = lib.addVisualAt(talk, td, flats[0].word)
  assert.ok(added, 'a visual fits')
  assert.equal(added.decisions.graphics.length, 1); assert.equal(added.graphic.origin, 'member')
  // Only words said there (an effect the director uses, filled from the transcript).
  const shown = Object.entries(added.graphic.fields).filter(([k]) => k !== 'effect' && k !== 'style').map(([, v]) => v).join(' ')
  assert.ok(shown.length > 0)
  for (const word of shown.split(/\s+/).filter((w) => /[a-z]{3,}/i.test(w))) assert.ok(TALK.join(' ').toLowerCase().includes(word.toLowerCase().replace(/[^a-z0-9']/g, '')), word)
  // A number said soon after counts up.
  const atNumber = lib.addVisualAt(talk, td, 0)
  assert.equal(atNumber.graphic.fields.effect, 'count-up')
  // With the stretch filled, it is gone (or shorter).
  const after = lib.reelFlatStretches(talk, added.decisions, lib.deriveBeats(talk, added.decisions))
  assert.ok(!after.some((f) => f.from === flats[0].from && f.to === flats[0].to))
})
