// "What changed": the edit log after automatic edits, and its Restore patches,
// for Automatic clips in the editor, Edit my recording and remix reviews.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')
const log = loadMain("export * from './src/shared/edit-log'")
const schema = loadMain("export * from './src/shared/clip-editor'")
const recording = loadMain("export * from './src/shared/edit-recording'")
const plain = (x) => JSON.parse(JSON.stringify(x))
const look = { look: 'black', color: '#000000', font: 'serif' }

const stat = (id, origin = 'auto') => ({ id, template: 'stat', at_ms: 1200, duration_ms: 3000, placement: 'top', fields: { value: '$1,200/month', label: 'in revenue' }, origin })
const list = { id: 'g-list', template: 'list', at_ms: 7200, duration_ms: 4000, placement: 'top', fields: { title: 'Steps', items: 'One\nTwo\nThree' }, origin: 'auto' }

/** A project like one made from an Automatic run, with clip 0's baseline. */
function project(auto) {
  const p = structuredClone(fixture)
  p.automatic = { omitted: [], estimated_cuts: 0 }
  const c = p.candidates[0]
  // The run cut three pauses, started 0.6 s into the picked moment and ended 1.5 s before it ended.
  c.ranges = [[1000, 2400], [2900, 5000], [7000, 8200], [8600, 10000]]
  c.hook = { text: 'He admits he was wrong', look }
  c.graphics = [stat('g-stat'), list, stat('g-mine', 'member')]
  c.auto = auto ?? { moment: [400, 11500], ranges: structuredClone(c.ranges), before_words: 'So uh Joe', hook: 'He admits he was wrong', captions: true, caption_preset: 'pop', split_at: [8000] }
  return plain(schema.parseEditorProject(p))
}
const lineOf = (lines, id) => lines.find((l) => l.id === id)
const restore = (c, line) => schema.refineEdit(c, line.restore)

test('an Automatic clip lists what the run did, counted from what was saved', () => {
  const p = project(), c = p.candidates[0]
  const lines = log.clipEditLog(p, c)
  assert.deepEqual(plain(lines.map((l) => l.id)), ['start', 'end', 'pauses', 'graphics', 'split', 'captions', 'hook'])
  assert.equal(lineOf(lines, 'start').text, 'Started at 0:01 (left out 0.6 s before: “So uh Joe”)')
  assert.equal(lineOf(lines, 'end').text, 'Ended at 0:10 (left out 1.5 s after)')
  assert.equal(lineOf(lines, 'pauses').text, 'Cut 3 pauses (2.9 s)')
  assert.equal(lineOf(lines, 'graphics').text, 'Added 2 graphics: $1,200/month stat, 3-step list', 'only the ones the app added')
  // The split runs from 8.0 s in the source to the clip's end: 3.6 s to 4.9 s into the cut clip at 1.25×.
  assert.equal(lineOf(lines, 'split').text, 'Split screen 0:03–0:04')
  assert.equal(lineOf(lines, 'captions').text, 'Captions: Pop')
  assert.equal(lineOf(lines, 'hook').text, 'Hook text: “He admits he was wrong”')
  for (const line of lines) assert.ok(line.restore && line.restoreHint, `${line.id} can be restored`)
})

test('each Restore puts back just its piece, through an ordinary edit, and its line goes away', () => {
  const p = project(), c = p.candidates[0]
  const lines = log.clipEditLog(p, c)
  const checks = {
    start: (n) => assert.deepEqual(plain(n.ranges), [[400, 2400], [2900, 5000], [7000, 8200], [8600, 10000]]),
    end: (n) => assert.deepEqual(plain(n.ranges.at(-1)), [8600, 11500]),
    pauses: (n) => assert.deepEqual(plain(n.ranges), [[1000, 10000]]),
    graphics: (n) => assert.deepEqual(plain(n.graphics.map((g) => g.id)), ['g-mine']),
    split: (n) => {
      assert.deepEqual(plain(n.scenes.map((s) => s.layout)), ['fill', 'fill'])
      assert.equal(n.scenes[1].at_ms, 8000)
      // A full-frame crop shaped for 9:16, around the top half's framing.
      assert.ok(Math.abs(n.scenes[1].crops[0][2] * 1920 / (n.scenes[1].crops[0][3] * 1080) - 9 / 16) < .01)
    },
    captions: (n) => assert.equal(n.captions, false),
    hook: (n) => assert.equal(n.hook, null)
  }
  for (const line of lines) {
    const next = restore(c, line)
    checks[line.id](next)
    assert.equal(next.status, 'refining', 'a restored baked clip is refined again, like any edit')
    // Still a valid edit (what main checks on save).
    schema.parseCandidateEdit(plain(schema.candidateEdit(next)), p.duration_ms, p.transcript.length)
    const after = log.clipEditLog(p, { ...next, auto: c.auto })
    assert.ok(!after.some((l) => l.id === line.id), `${line.id} is gone after its Restore`)
    assert.equal(after.length, lines.length - 1, `${line.id}: the other lines stay`)
  }
})

test('lines follow the member: a changed start, a re-cut pause or a new hook drop out', () => {
  const p = project(), c = p.candidates[0]
  const edited = { ...c, ranges: [[1500, 2400], [2900, 5000], [7000, 10000]], hook: { text: 'My own hook', look } }
  const ids = log.clipEditLog(p, edited).map((l) => l.id)
  assert.ok(!ids.includes('start') && !ids.includes('hook'))
  assert.equal(lineOf(log.clipEditLog(p, edited), 'pauses').text, 'Cut 2 pauses (2.5 s)', 'only the pauses still cut where the run cut them')
})

test('a clip the run started early, and older projects without a saved record', () => {
  const early = project({ moment: [2000, 10000], ranges: [[1000, 2400], [2900, 5000], [7000, 8200], [8600, 10000]], hook: null, captions: false, caption_preset: 'pop', split_at: [] })
  const lines = log.clipEditLog(early, early.candidates[0])
  assert.equal(lineOf(lines, 'start').text, 'Started 1 s before the picked moment (at 0:01)')
  assert.deepEqual(plain(restore(early.candidates[0], lineOf(lines, 'start')).ranges[0]), [2000, 2400])
  assert.ok(!lineOf(lines, 'end'), 'an end within 0.4 s is the cut snapping to words')
  // No baseline (opened before the app kept one): only the graphics marked as the app's.
  const old = project(), c = { ...old.candidates[0] }
  delete c.auto
  assert.deepEqual(plain(log.clipEditLog(old, c).map((l) => l.id)), ['graphics'])
})

test('the saved baseline is checked: a malformed one is dropped, the project still opens', () => {
  const p = structuredClone(fixture)
  p.candidates[0].auto = { ranges: [[5000, 1000]], hook: null, captions: true, caption_preset: 'pop', split_at: [] }
  p.candidates[1].auto = { moment: [0, 12000], hook: 'x'.repeat(500), captions: true, caption_preset: 'pop', split_at: [12], before_words: '  a   b ' }
  const parsed = plain(schema.parseEditorProject(p))
  assert.equal(parsed.candidates[0].auto, undefined)
  assert.equal(parsed.candidates[1].auto.hook.length, 200)
  assert.equal(parsed.candidates[1].auto.before_words, 'a b')
  // Never part of an edit sent back to main.
  assert.equal(schema.candidateEdit(parsed.candidates[1]).auto, undefined)
})

function samplePlan() {
  const words = [['So', 0, 200, 0, 'false_start'], ['Most', 300, 500, 0, 'retake'], ['coaches', 520, 800, 0, 'retake'], ['um', 820, 900, 0, 'filler'], ['Most', 1000, 1200, 0, null],
    ['coaches', 1220, 1500, 0, null], ['undercharge.', 1520, 1900, 0, null], ['like', 1950, 2050, 0, 'filler'], ['Here', 2400, 2600, 0, null], ['is', 2620, 2700, 0, null],
    ['why.', 2720, 3100, 0, null], ['Follow', 3500, 3800, 0, null], ['me.', 3820, 4100, 0, null]]
  return recording.parseEditPlan({
    words, hooks: [{ id: 0, start: 8, end: 10, text: 'Here is why', why: 'A promise' }], hook: 0, cta: { start: 11, end: 12 },
    popups: [{ id: 0, word: 5, text: 'coaches', kind: 'keyword' }, { id: 1, word: 6, text: '3x', kind: 'number' }, { id: 2, word: 9, kind: 'card', card: { type: 'list', title: 'Why', items: ['Fear', 'Habit'] } }],
    sounds: [{ id: 0, at: 'title', sound: 'whoosh' }, { id: 1, at: 5, sound: 'pop' }], planned: 'ai', notes: [], warnings: []
  }, 1)
}

test('Edit my recording: retakes, filler, the opening, cards, pop-ups and sounds, each with its own Restore', () => {
  const plan = samplePlan()
  const d = { ...recording.initialDecisions(plan, undefined, 'fast'), cutoutIntro: true }
  const lines = log.editRecordingLog(plan, d)
  assert.deepEqual(plain(lines.map((l) => [l.id, l.text])), [
    ['retakes', 'Cut 1 retake (0.5 s)'], ['false-starts', 'Cut 1 false start (0.2 s)'], ['filler', 'Cut 2 filler words (0.2 s)'],
    ['hook', 'Opened with “Here is why.” (moved from 0:02)'], ['cta', 'Moved your call to action to the end'],
    ['cards', 'Added 1 card'], ['popups', 'Added 2 pop-ups'], ['sounds', 'Sound effects ×2 (soft whoosh, pop)'], ['cutout', 'Cut-out opening on']])
  const apply = (id) => ({ ...d, ...lineOf(lines, id).restore })
  assert.deepEqual(plain(apply('retakes').cut), [0, 3, 7], 'only the retake’s words come back')
  assert.deepEqual(plain(apply('filler').cut), [0, 1, 2])
  const opened = apply('hook')
  assert.equal(opened.hookId, null)
  assert.equal(opened.hookText, '')
  assert.equal(apply('cta').endOnCta, false)
  assert.deepEqual(plain(apply('cards').popups.map((p) => p.on)), [true, true, false])
  assert.deepEqual(plain(apply('popups').popups.map((p) => p.on)), [false, false, true])
  assert.deepEqual(plain(apply('sounds').sounds.map((s) => s.on)), [false, false])
  assert.equal(apply('cutout').cutoutIntro, false)
  // After a Restore its line is gone and the rest stay.
  for (const line of lines) {
    const after = log.editRecordingLog(plan, apply(line.id)).map((l) => l.id)
    assert.ok(!after.includes(line.id), line.id)
  }
  // The member kept a word of the retake: it no longer counts as cut by the app.
  assert.ok(!log.editRecordingLog(plan, recording.toggleWord(d, 1)).some((l) => l.id === 'retakes'))
})

test('remix reviews: the part of their clip, the take trim (Restore uses all of it) and the AI hook', () => {
  const lines = log.remixEditLog({ startMs: 3000, endMs: 11400, take: { seconds: 40, trim: { startMs: 2000, endMs: 31500 } }, aiHeadline: 'She was wrong about pricing', headline: 'She was wrong about pricing' })
  assert.deepEqual(plain(lines.map((l) => [l.id, l.text, l.restore ?? null])), [
    ['their-clip', 'Used 0:03–0:11 of their clip (8.4 s)', null],
    ['take-trim', 'Your take trimmed to 0:02.0–0:31.5 (30 s of 40 s)', 'use-whole-take'],
    ['hook', 'Hook: “She was wrong about pricing”', null]])
  const edited = log.remixEditLog({ startMs: 0, endMs: 5000, take: { seconds: 12 }, aiHeadline: 'AI words', headline: 'My words' })
  assert.deepEqual(plain(edited.map((l) => l.id)), ['their-clip'])
})

test('wording: plain, and numbers come from the data', () => {
  assert.equal(log.logSeconds(31000), '31 s')
  assert.equal(log.logSeconds(2400), '2.4 s')
  assert.equal(log.logSeconds(1000), '1 s')
  assert.equal(log.logClock(864000), '14:24')
  assert.equal(log.graphicPhrase({ template: 'title', fields: { text: 'Raise your prices now please everyone' } }), '“Raise your prices now p…” title')
})
