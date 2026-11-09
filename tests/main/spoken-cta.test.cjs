// The spoken call to action (src/shared/spoken-cta.ts, the editor's twin of the engine's detector), the Call to action
// graphic's contract (link_cta), its starting words at the playhead and the chat's "add a call to action graphic".
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadMain } = require('../zernio/support/load-main.cjs')

const s = loadMain("export * from './src/shared/spoken-cta'; export * from './src/shared/motion-graphics'; export * from './src/shared/graphic-prefill'; export * from './src/shared/edit-log'")
const chat = loadMain("export * from './src/shared/clip-chat'")
const { cases } = require(path.join(__dirname, '../../engine/tests/fixtures/spoken_cta_cases.json'))
const plain = (value) => JSON.parse(JSON.stringify(value))

/** Words 300 ms apart (250 ms long); '/' is a 700 ms pause (the engine test's clock). */
function timed(text, start = 0) {
  const out = []
  let t = start
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word === '/') { t += 700; continue }
    out.push({ word, start_ms: t, end_ms: t + 250 })
    t += 300
  }
  return out
}

test('the same calls to action as the engine (shared cases)', () => {
  for (const c of cases) {
    const words = timed(c.text)
    // The engine counts only the video's tail; here the editor asks from a point on (the whole tail: the window's last 25 s).
    const from = c.window ? c.window[1] - Math.max(25000, (c.window[1] - c.window[0]) * .3) : undefined
    const found = s.spokenCta(words, from === undefined ? {} : { from_ms: from })
    if (c.expect === null) { assert.equal(found, null, c.name); continue }
    assert.ok(found, c.name)
    assert.deepEqual({ kind: found.kind, text: found.text, where: found.where, keyword: found.keyword, lead: found.lead }, c.expect, c.name)
  }
})

test('pick first: the call to action from the playhead on', () => {
  const words = timed('follow me for more. / and click the link below.')
  assert.equal(s.spokenCta(words).kind, 'link')
  assert.equal(s.spokenCta(words, { pick: 'first' }).kind, 'follow')
  assert.equal(s.spokenCta(words, { from_ms: words[4].start_ms, pick: 'first' }).text, 'Click the link')
  assert.equal(s.spokenCta(words, { from_ms: 60000 }), null)
  assert.equal(s.spokenCta(words, { until_ms: 500, pick: 'first' }).kind, 'follow')
})

test('the Call to action graphic contract', () => {
  const info = s.templateInfo('link_cta')
  assert.equal(info.label, 'Call to action')
  assert.deepEqual([...info.fields], ['text', 'where', 'kind', 'lead'])
  assert.equal(s.GRAPHIC_DEFAULT_MS.link_cta, 3500)
  assert.equal(s.graphicHasContent({ template: 'link_cta', fields: { text: 'Click the link' } }), true)
  assert.equal(s.graphicHasContent({ template: 'link_cta', fields: { where: 'below' } }), false)
  // A new one sits at the top (over a talking head, clear of the face), card size.
  const g = s.newGraphic('link_cta', 1000)
  assert.equal(g.placement, 'top')
  assert.equal(g.size, undefined)
  assert.equal(s.ctaKind({ kind: 'follow' }), 'follow')
  assert.equal(s.ctaKind({ kind: 'instagram' }), 'link')
  assert.equal(s.ctaPointsDown({ where: 'in my bio' }), true)
  assert.equal(s.ctaPointsDown({ text: 'Link below' }), true)
  assert.equal(s.ctaPointsDown({ text: 'Hit the link', where: 'where you see it' }), false)
  assert.equal(s.graphicPhrase({ template: 'link_cta', fields: { text: 'Hit the link' } }), '“Hit the link” call to action')
  // Saved and reloaded as is.
  const parsed = s.parseGraphics([{ id: 'g-cta01', template: 'link_cta', at_ms: 10, duration_ms: 3000, placement: 'bottom', fields: { text: 'Hit the link', where: 'below', kind: 'link' }, origin: 'auto' }])
  assert.equal(parsed[0].template, 'link_cta')
})

test('starting words at the playhead: the call to action said there, nothing made up', () => {
  const words = timed('that is how it works. hit the link below to get the guide. see you soon', 5000)
  const at = words[5].start_ms
  assert.deepEqual(plain(s.prefillGraphic('link_cta', words, at).fields), { text: 'Hit the link', where: 'below', lead: 'Get the guide' })
  const dm = timed('so dm me SCALE for the checklist', 1000)
  assert.deepEqual(plain(s.prefillGraphic('link_cta', dm, 1000).fields), { text: 'DM me SCALE', kind: 'dm' })
  // No call to action said: no words.
  assert.deepEqual(plain(s.prefillGraphic('link_cta', timed('we grew forty percent last year'), 0).fields), {})
})

test('the chat can add a call to action graphic', () => {
  const tool = chat.CHAT_TOOLS.find((t) => t.name === 'add_graphic')
  assert.ok(tool.parameters.properties.template.enum.includes('link_cta'))
  assert.match(tool.parameters.properties.fields.description, /link_cta \(a call to action graphic/)
})
