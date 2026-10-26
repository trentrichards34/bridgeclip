// The Explainer style's shared part: sections cut at the turns of what is said, the plan checked against the words,
// a section's brief (zones, hero object, continuity, counters), the counters' allowance in the words check, the
// canvas band and paper look, and the estimate.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain } = require('../zernio/support/load-main.cjs')

const x = loadMain("export * from './src/shared/explainer'; export * as cg from './src/shared/custom-graphics'; export * as scenes from './src/shared/scenes'")
const RUN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/custom-graphics-run.json'), 'utf8')).words
const words = RUN.map((w) => ({ word: w.word, start_ms: w.start_ms, end_ms: w.end_ms }))
const end = words.at(-1).end_ms + 300

test('the owner\'s run is cut into sections at sentence ends, about 15 s each, none longer than 30 s, end to end', () => {
  const sections = x.explainerSections(words, end)
  assert.ok(sections.length >= 4 && sections.length <= x.EXPLAINER_MAX_SECTIONS, String(sections.length))
  assert.equal(sections[0].startMs, 0); assert.equal(sections.at(-1).endMs, end)
  for (const [i, s] of sections.entries()) {
    // What is said in a section fits one canvas (a stretch with nothing said, like a filmed screen, may trail it).
    assert.ok(s.words.at(-1).start_ms - s.startMs <= x.EXPLAINER_MAX_MS, `${i}: ${s.words.at(-1).start_ms - s.startMs}`)
    if (i > 0) assert.equal(s.startMs, sections[i - 1].endMs)
  }
  // Most cuts land at a sentence's end.
  assert.ok(sections.slice(0, -1).filter((s) => /[.?!]["”’)]*$/.test(s.words.at(-1).word)).length >= 2)
  assert.equal(sections.reduce((n, s) => n + s.words.length, 0), words.length)
  assert.deepEqual(x.explainerSections([], 0), [])
})

test('the plan is checked against what was said: a label never said is dropped (the writer picks one)', () => {
  const sections = x.explainerSections(words, end).slice(0, 3)
  const said = x.cg.saidIndex(words)
  const plan = x.parseExplainerPlan('```json\n' + JSON.stringify({ hero: { label: 'your product', look: 'a flat card' },
    sections: [{ label: 'eyeballs', idea: 'a', starts: 'b', ends: 'c' }, { label: 'quantum leap', idea: 'd', starts: 'e', ends: 'f' }] }) + '\n```', sections, said)
  assert.equal(plan.hero.look, 'a flat card'); assert.equal(plan.sections.length, 3)
  assert.equal(plan.sections[0].label, 'eyeballs'); assert.equal(plan.sections[1].label, ''); assert.equal(plan.sections[2].idea, '')
  assert.equal(x.parseExplainerPlan('no json here', sections, said), null)
})

test('a section\'s brief: its line, the captions\' zone to keep empty, the hero object, continuity and counters', () => {
  const sections = x.explainerSections(words, end)
  const s = sections.find((v) => x.sectionNumbers(v).length) ?? sections[1]
  const g = x.cg.customGeometry('explainer', {})
  assert.deepEqual([g.root.x, g.root.y, g.root.width], [0, Math.round(x.cg.EXPLAINER_BAND.top * 1920), 1080])
  const plan = { hero: { label: 'product', look: 'a card' }, sections: sections.map(() => ({ label: 'proof', idea: 'the card sells', starts: 'the card alone', ends: 'the card stamped' })) }
  const b = x.explainerBriefLines({ section: s, count: sections.length, plan, rootTop: g.root.y, frameHeight: 1920, previous: 'the card made' })
  const text = b.lines.join('\n')
  assert.match(text, new RegExp(`// ${String(s.index + 1).padStart(2, '0')} — proof`))
  assert.match(text, /THE CAPTIONS' ZONE, y \d+-\d+: keep it completely EMPTY/)
  assert.match(text, /THE HERO OBJECT of the whole video \("product"\): a card/)
  assert.match(text, /the last section ended with: the card made/)
  assert.match(text, /become counters or odometers INSIDE the drawing/)
  assert.match(b.grade, /illustrated explainer/)
  // The writer's prompt takes the section's lines in place of the moment's kind and the template hint.
  const look = x.cg.customLook({ kind: 'explainer' })
  assert.equal(look.ground, x.cg.EXPLAINER_PAPER); assert.equal(look.accent, x.cg.EXPLAINER_ACCENT); assert.equal(look.ink, x.cg.EXPLAINER_INK)
  const user = x.cg.writerUserPrompt({ kind: 'process', frame: 'explainer', cues: [], before: '', after: '', planned: 'IGNORED', durationMs: 12000, geometry: g, look, explainer: b })
  assert.match(user, /^SECTION: section/); assert.doesNotMatch(user, /IGNORED/); assert.doesNotMatch(user, /hook text/)
})

test('counters may tick up to a said number; a number above any said one is still refused', () => {
  const said = { ...x.cg.saidIndex([{ word: '$4,365', start_ms: 0, end_ms: 400 }]), upTo: [4365] }
  assert.deepEqual(x.cg.unsaidOnScreen(['$2,180', '$4,365'], said), [])
  assert.deepEqual(x.cg.unsaidOnScreen(['$9,000'], said), ['9,000'])
  assert.deepEqual(x.cg.unsaidOnScreen(['$2,180'], x.cg.saidIndex([{ word: '$4,365', start_ms: 0, end_ms: 400 }])), ['2,180'])
})

test('the paper backdrop and the cut-out card are scenes the editor keeps; the captions go to the top there', () => {
  const s = x.scenes.parseScenes([{ scene: 'stage', start_ms: 0, end_ms: 5000, backdrop: 'paper', card: 'cutout', transition: 'slide' }])
  assert.equal(s[0].backdrop, 'paper'); assert.equal(s[0].card, 'cutout')
  assert.equal(x.scenes.sceneCaptionY('stage', 'cutout'), x.scenes.EXPLAINER_CAPTION_Y)
  assert.equal(x.scenes.normalizeScenes(s)[0].card, 'cutout')
})

test('the estimate: a 4-minute reel\'s sections cost a few dollars at a frontier model\'s price', () => {
  const sections = x.explainerSections(words, end).length
  const e = x.explainerEstimate(sections)
  assert.ok(e.expectedUsd > 0.5 && e.expectedUsd < e.mostUsd && e.mostUsd < 6, JSON.stringify({ sections, e }))
  assert.equal(x.explainerEstimate(10).revisions, x.EXPLAINER_REVISIONS)
  assert.deepEqual(x.explainerEstimate(0), { expectedUsd: 0, mostUsd: 0, revisions: 0 })
})
