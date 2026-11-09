// YouTube videos (landscape, long) from Edit my recording: the format suggestion, the member's YouTube choices, the
// landscape graphic bands (full-screen brand card, lower third, side panel), chapters text, the start request and the
// editor project keeping its YouTube layout.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const lf = loadMain("export * from './src/shared/longform'; export { graphicSpec } from './src/shared/graphic-layout'; export { parseEditorProject } from './src/shared/clip-editor'; export { parseEditDecisions, parseEditPlan, initialDecisions } from './src/shared/edit-recording'")
const plain = (value) => JSON.parse(JSON.stringify(value))

test('long or landscape recordings are suggested as YouTube videos, short vertical ones as reels', () => {
  assert.equal(lf.suggestFormat([{ seconds: 45, width: 1080, height: 1920 }]), 'reel')
  assert.equal(lf.suggestFormat([{ seconds: 179, width: 1080, height: 1920 }]), 'reel')
  assert.equal(lf.suggestFormat([{ seconds: 1561, width: 1920, height: 1080 }]), 'youtube')
  assert.equal(lf.suggestFormat([{ seconds: 120, width: 1080, height: 1920 }, { seconds: 70, width: 1080, height: 1920 }]), 'youtube')
  assert.equal(lf.suggestFormat([{ seconds: 90, width: 1920, height: 1080 }]), 'youtube')
  // A short landscape take (a webcam reel) stays a reel; a size that couldn't be read goes by length.
  assert.equal(lf.suggestFormat([{ seconds: 8, width: 640, height: 360 }]), 'reel')
  assert.equal(lf.suggestFormat([{ seconds: 200 }]), 'youtube')
  assert.equal(lf.suggestFormat([]), 'reel')
  assert.equal(lf.suggestionReason([{ seconds: 1561, width: 1920, height: 1080 }]), 'Long and landscape')
  assert.equal(lf.suggestionReason([{ seconds: 30, width: 1080, height: 1920 }]), 'Short and vertical')
})

test('the YouTube choices are checked and go to the engine in its own words', () => {
  assert.deepEqual(plain(lf.parseYoutubeChoice(undefined)), { layout: 'pip', pipSize: 'large', pipCorner: 'right', captions: 'key' })
  assert.deepEqual(plain(lf.parseYoutubeChoice({ pipSize: 'small', pipCorner: 'bottom_right', captions: 'all' })), { layout: 'pip', pipSize: 'small', pipCorner: 'bottom_right', captions: 'all' })
  for (const bad of [{ pipSize: 'huge' }, { pipCorner: 'left' }, { captions: 'none' }, { layout: 'split' }, []]) assert.throws(() => lf.parseYoutubeChoice(bad))
  assert.deepEqual(plain(lf.youtubeForEngine({ layout: 'pip', pipSize: 'medium', pipCorner: 'right', captions: 'key' })), { layout: 'pip', pip_size: 'medium', pip_corner: 'right', captions: 'key' })
})

test('landscape bands: a full-screen card, a lower third clear of the webcam card, and a side panel on the right 42%', () => {
  const full = lf.landscapeBand('full', null)
  assert.ok(full.left > 0 && full.right < 1 && full.top > 0 && full.bottom < 1)
  const side = lf.landscapeBand('side', null)
  assert.ok(Math.abs(side.right - side.left - 0.4) < 0.03 && side.left >= 0.55, JSON.stringify(side))
  // With a tall webcam card on the right, cards go to the lower third left of it.
  const pip = [0.679, 0.144, 0.3, 0.711]
  const lower = lf.landscapeBand('lower', pip)
  assert.ok(lower.right <= pip[0] && lower.top >= 0.55 && lower.bottom <= 0.86, JSON.stringify(lower))
  assert.deepEqual(plain(lf.landscapeBand('side', pip)), plain(lower))
  assert.equal(lf.landscapeKind({ template: 'fx', size: 'stage' }), 'full')
  assert.equal(lf.landscapeKind({ template: 'stat' }), 'lower')
  assert.equal(lf.landscapeKind({ template: 'fx', size: 'compact' }), 'lower')
  assert.equal(lf.landscapeKind({ template: 'checklist', size: 'card' }), 'side')
})

test('chapters read as YouTube expects: 0:00 first, one per line; hours when the video is that long', () => {
  const chapters = lf.parseChapters([{ at_ms: 0, title: 'I made 1,220 dollars' }, { at_ms: 75_400, title: 'The idea' }, { at_ms: 'x', title: 'bad' }, { at_ms: 600_000, title: '  Build\nit  ' }])
  assert.equal(lf.chaptersText(chapters), '0:00 I made 1,220 dollars\n1:15 The idea\n10:00 Build it')
  assert.equal(lf.chaptersText([{ at_ms: 0, title: 'A' }, { at_ms: 3_725_000, title: 'B' }]), '0:00:00 A\n1:02:05 B')
  assert.equal(lf.formatSuffix('youtube'), '-youtube')
  assert.equal(lf.formatSuffix('reel'), '')
})

test('a 16:9 editor project keeps its YouTube layout and its graphics take landscape bands; a reel is unchanged', () => {
  const base = structuredClone(fixture)
  const wide = { ...base, aspect_ratio: '16:9', width: 1920, height: 1080, youtube: { pip: [0.679, 0.144, 0.3, 0.711], captions: 'key' },
    brand_mark: { handle: '@travis', logo: false, position: 'bottom-right' } }
  const parsed = lf.parseEditorProject(wide)
  assert.deepEqual(plain(parsed.youtube), { pip: [0.679, 0.144, 0.3, 0.711], captions: 'key' })
  assert.equal(lf.parseEditorProject(base).youtube, undefined)
  assert.throws(() => lf.parseEditorProject({ ...wide, youtube: { pip: [2, 0, 0, 0] } }))
  const c = parsed.candidates[0]
  const at = c.ranges[0][0] + 100
  const card = { id: 'g-cold01', template: 'fx', at_ms: at, duration_ms: 3000, placement: 'top', size: 'stage', fields: { effect: 'per-word-rise', text: 'Brand new tool' } }
  const spec = lf.graphicSpec(parsed, { ...c, graphics: [card] }, card)
  assert.deepEqual([spec.width, spec.height, spec.size], [1920, 1080, 'stage'])
  assert.equal(spec.backdrop.mark, '@travis')
  assert.ok(spec.box.left > 0 && spec.box.right < 1)
  const stat = { id: 'g-stat01', template: 'stat', at_ms: at, duration_ms: 3000, placement: 'top', fields: { value: '$1,227' } }
  const low = lf.graphicSpec(parsed, { ...c, graphics: [stat] }, stat)
  assert.equal(low.backdrop, undefined)
  assert.ok(low.box.top >= 0.55 && low.box.right <= 0.68, JSON.stringify(low.box))
  // A reel's graphic: no backdrop, no side range.
  const reel = lf.graphicSpec(lf.parseEditorProject(base), { ...base.candidates[0], graphics: [stat] }, { ...stat, at_ms: base.candidates[0].ranges[0][0] + 100 })
  assert.equal(reel.backdrop, undefined)
  assert.equal(reel.box.left, undefined)
})

test('the plan keeps its chapter titles and the review keeps the YouTube choices', () => {
  const words = [['I', 0, 200, 0, null], ['made', 250, 500, 0, null], ['money.', 550, 900, 0, null], ['Here', 1000, 1200, 0, null], ['is', 1250, 1400, 0, null], ['how.', 1450, 1800, 0, null]]
  const plan = lf.parseEditPlan({ words, hooks: [], hook: null, cta: null, popups: [], sounds: [], planned: 'ai', notes: [], warnings: [],
    chapters: [{ word: 0, title: 'I made money' }, { word: 3, title: '<b>' }, { word: 99, title: 'x' }] }, 1)
  assert.deepEqual(plain(plan.chapters), [{ word: 0, title: 'I made money' }])
  const decisions = { ...lf.initialDecisions(plan), youtube: { pipSize: 'medium' } }
  assert.equal(lf.parseEditDecisions(decisions, plan).youtube.pipSize, 'medium')
  assert.equal(lf.parseEditDecisions({ ...decisions, youtube: undefined }, plan).youtube, undefined)
  assert.throws(() => lf.parseEditDecisions({ ...decisions, youtube: { pipCorner: 'left' } }, plan), /YouTube layout/)
})
