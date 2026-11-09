// Starting words for a new graphic (only words said where it goes), switching a graphic to another template
// (its words carry over), per-graphic fonts, and the chat's "make this a staircase".
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const p = loadMain("export * from './src/shared/graphic-prefill'; export * from './src/shared/motion-graphics'; export * from './src/shared/graphic-layout'")
const chat = loadMain("export * from './src/shared/clip-chat'")
const plain = (value) => JSON.parse(JSON.stringify(value))
const timed = (text, from = 1000, step = 320) => text.split(' ').map((word, i) => ({ word, start_ms: from + i * step, end_ms: from + i * step + 260 }))
const said = (words) => new Set(words.map((w) => w.word.toLowerCase().replace(/[^a-z0-9']/g, '')))
const onlySaid = (words, text) => text.split(/\s+/).filter(Boolean).every((w) => said(words).has(w.toLowerCase().replace(/[^a-z0-9']/g, '')) || /^\d[\d,.%$]*$/.test(w))

test('a new graphic starts with the words said at the playhead, and nothing else', () => {
  const words = timed('so we only need three things a product an offer and a way to attract eyeballs that is the whole plan')
  const at = words[2].start_ms
  for (const template of ['title', 'statement', 'big_words', 'headline_pill', 'quote', 'chapter', 'list', 'staircase', 'funnel', 'idea_hub', 'sticky_notes', 'before_after', 'strike_list']) {
    const { fields } = p.prefillGraphic(template, words, at)
    const text = Object.values(fields).join(' ')
    assert.ok(text.trim(), `${template} starts with words`)
    assert.ok(onlySaid(words, text), `${template}: ${JSON.stringify(fields)}`)
  }
  // A number said in words is written in digits, with the words after it.
  assert.deepEqual(plain(p.prefillGraphic('stat', words, at).fields), { value: '3', label: 'things' })
  assert.deepEqual(plain(p.prefillGraphic('stat', timed('i posted fourteen hundred times online'), 1000).fields), { value: '1,400', label: 'times online' })
  assert.deepEqual(plain(p.prefillGraphic('stat', timed('we grew 40 percent last year'), 1000).fields), { value: '40%', label: 'last year' })
  // Big words: at most 3 of the strongest words said together.
  const big = p.prefillGraphic('big_words', timed('you do not have to be a virtual nobody'), 1000).fields.text
  assert.equal(big, 'Virtual nobody')
  // No words there (a picture, a name): nothing made up.
  assert.deepEqual(plain(p.prefillGraphic('lower_third', words, at).fields), {})
  assert.deepEqual(plain(p.prefillGraphic('logo', words, at).fields), {})
  assert.deepEqual(plain(p.prefillGraphic('stat', timed('no numbers in this one at all'), 1000).fields), {})
  // A run without word times: the transcript line.
  assert.equal(p.prefillGraphic('title', [], 0, { line: 'Here is the setup.' }).fields.text, 'Setup')
  // Items of a list said with the same opener each start a new item.
  const list = p.prefillGraphic('list', timed('we need a product that sells we need an offer people love we need real attention online'), 1000).fields.items.split('\n')
  assert.deepEqual(list, ['Product that sells', 'Offer people love', 'Real attention online'])
})

test('steps the speaker names become chapter headers with their own words', () => {
  const words = timed('step one pick your idea then we move on step two find your buyer and finally number three sell it today', 0, 400)
  const steps = plain(p.spokenSteps(words, [[0, 20000]]))
  assert.deepEqual(steps.map((s) => [s.label, s.title]), [['Step #1.', 'Pick Your Idea'], ['Step #2.', 'Find Your Buyer'], ['Number #3.', 'Sell it Today']])
  assert.equal(steps[0].at_ms, 0)
  // Outside the cut: not used.
  assert.equal(p.spokenSteps(words, [[0, 3000]]).length, 1)
})

test('switching a graphic to another template keeps its words, time, place and color', () => {
  const g = p.newGraphic('list', 2000, { fields: { title: 'Three things', items: 'A product\nAn offer\nAttract eyeballs', color: '#FF0000', item_ms: '0\n500\n900' }, placement: 'bottom' })
  const stairs = p.switchGraphicTemplate(g, 'staircase')
  assert.equal(stairs.template, 'staircase')
  assert.equal(stairs.fields.items, 'A product\nAn offer\nAttract eyeballs')
  assert.equal(stairs.fields.title, 'Three things')
  assert.equal(stairs.fields.color, '#FF0000')
  assert.equal(stairs.fields.item_ms, undefined, 'item times are matched again')
  assert.equal(stairs.size, 'stage')
  assert.deepEqual([stairs.at_ms, stairs.placement, stairs.id], [g.at_ms, g.placement, g.id])
  // Back to a card: card size again; a title takes the first line; a stat finds the number.
  assert.equal(p.switchGraphicTemplate(stairs, 'checklist').size, undefined)
  assert.equal(p.switchGraphicTemplate(p.newGraphic('statement', 0, { fields: { text: 'Only three things' } }), 'stat').fields.value, undefined)
  const stat = p.switchGraphicTemplate(p.newGraphic('title', 0, { fields: { text: 'We grew 40% this year' } }), 'stat')
  assert.deepEqual(plain(stat.fields), { value: '40%', label: 'We grew this year' })
  const words = p.switchGraphicTemplate(p.newGraphic('title', 0, { fields: { text: 'A virtual nobody online' } }), 'big_words')
  assert.deepEqual([words.fields.text, words.depth], ['A virtual nobody', 'behind'])
  // Something that can't go behind loses the depth.
  assert.equal(p.switchGraphicTemplate(words, 'list').depth, undefined)
})

test('a graphic can carry its own font; the render spec uses it and leaves the field out', () => {
  const c = { ...structuredClone(fixture.candidates[0]), hook: { text: 'Two words here', look: { look: 'brand', color: '#123456', font: 'serif' } } }
  const g = p.newGraphic('title', 1200, { fields: { text: 'Hello there', font: 'condensed' } })
  c.graphics = [g]
  assert.deepEqual(plain(p.graphicStyle(c, g)), { color: '#123456', font: 'condensed' })
  // An unknown font: the bold sans (the hook's serif only for accent words).
  assert.deepEqual(plain(p.graphicStyle(c, { fields: { font: 'nope' } })), { color: '#123456', font: 'clean', accent_font: 'serif' })
  const spec = p.graphicSpec(fixture, c, g)
  assert.equal(spec.font, 'condensed')
  assert.equal(spec.fields.font, undefined)
})

test('the chat turns the selected graphic into another template ("make this a staircase")', () => {
  const c = { ...structuredClone(fixture.candidates[0]), graphics: [p.newGraphic('list', 1200, { fields: { items: 'Idea\nAvatar\nPitch' }, taken: [] })] }
  const id = c.graphics[0].id
  const project = { duration_ms: 12000, width: 1920, height: 1080, aspect_ratio: '9:16', transcriptCount: 4 }
  const { step } = chat.applyChatTool(c, 'update_graphic', { id, template: 'staircase' }, project, () => 'g-new')
  const after = step.patch.graphics.find((g) => g.id === id)
  assert.equal(after.template, 'staircase')
  assert.equal(after.fields.items, 'Idea\nAvatar\nPitch')
  assert.match(step.summary, /Changed the numbered list at .* to a staircase/)
  assert.throws(() => chat.applyChatTool(c, 'update_graphic', { id, template: 'nope' }, project, () => 'g-new'), /template must be one of/)
  // The suggestions in the editor: one at the playhead, two for a selected graphic.
  assert.deepEqual(plain(chat.CHAT_GRAPHIC_SUGGESTIONS), ['Add a graphic here'])
  assert.deepEqual(plain(chat.CHAT_SELECTED_GRAPHIC_SUGGESTIONS), ['Make this a staircase', 'Put the words behind me'])
})
