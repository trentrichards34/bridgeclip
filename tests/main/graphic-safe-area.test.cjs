// Quality minimums that hold with any member's saved settings (a real run, Oct 24: a saved small serif hook look, a
// brand serif on every card, cards cut off at the band's edge): the safe-area check every drawn graphic goes through,
// its simpler fallback, the fonts a graphic draws with, the floating hook's minimum size and the recommended hook.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const m = loadMain("export * from './src/shared/graphic-safe-area'; export * from './src/shared/graphic-layout'; export * from './src/shared/headline-look'")
const plain = (value) => JSON.parse(JSON.stringify(value))
const spec = (over = {}) => ({ template: 'fx', fields: { effect: 'marker-highlight', text: "I'm not having to write any of it", word: 'having', theme: 'dark' },
  width: 1080, height: 1920, duration_ms: 3000, box: { top: 0.08, bottom: 0.35 }, placement: 'top', color: '#2F5BFF', font: 'clean', ...over })

test('a graphic paints inside the safe area and its band: inside stays put, a spill moves back in, a big one is drawn smaller', () => {
  const b = m.safeBounds(spec())
  // The sides keep 3.5% clear; the band gets a little slack for a glass margin.
  assert.equal(Math.round(b.x), Math.round(1080 * m.SAFE_AREA.side))
  assert.equal(Math.round(b.y), Math.round(1920 * (0.08 - m.BAND_SLACK)))
  assert.equal(Math.round(b.y + b.h), Math.round(1920 * (0.35 + m.BAND_SLACK)))
  assert.deepEqual(plain(m.safeFix({ x: 100, y: 200, w: 800, h: 300 }, b)), { scale: 1, dx: 0, dy: 0, overflow: false })
  // Cut off at the top (a note above the line, the real run's "people that don't know us"): moved down, same size.
  const up = m.safeFix({ x: 100, y: 40, w: 800, h: 300 }, b)
  assert.equal(up.scale, 1)
  assert.ok(up.dy > 0 && 40 + up.dy >= b.y - 0.5 && up.dx === 0 && !up.overflow)
  // Wider than the safe area (a long line that overflows): drawn a little smaller and centered inside.
  const wide = m.safeFix({ x: -40, y: 200, w: 1120, h: 300 }, b)
  assert.ok(wide.scale < 1 && wide.scale >= m.SAFE_MIN_SCALE && !wide.overflow)
  const w = 1120 * wide.scale, left = -40 + 560 - w / 2 + wide.dx
  assert.ok(left >= b.x - 0.5 && left + w <= b.x + b.w + 0.5)
  // Far too big: never below the minimum scale; it is flagged for a simpler graphic.
  assert.equal(m.safeFix({ x: 0, y: 0, w: 2400, h: 1200 }, b).overflow, true)
  assert.equal(m.safeFix({ x: 0, y: 0, w: 2400, h: 1200 }, b).scale, m.SAFE_MIN_SCALE)
  // Exempt by design: drawn behind the speaker or placed by main.
  for (const t of ['takeover', 'big_words', 'screen_frame']) assert.ok(m.SAFE_EXEMPT.includes(t))
})

test('an effect that cannot sit inside its band becomes a simpler card with the same words', () => {
  assert.deepEqual(plain(m.safeFallback(spec()).fields), { text: "I'm not having to write any of it", accent: 'having', variant: 'glass' })
  assert.equal(m.safeFallback(spec()).template, 'statement')
  const n = m.safeFallback(spec({ fields: { effect: 'count-up', value: '4,365', prefix: '$', suffix: 'on ads', theme: 'dark' } }))
  assert.equal(n.template, 'stat')
  assert.equal(n.fields.value, '$4,365 on ads')
  assert.equal(m.safeFallback(spec({ fields: { effect: 'number-pop-in', value: '1,400', unit: 'times' } })).fields.value, '1,400 times')
  const swap = m.safeFallback(spec({ fields: { effect: 'line-swap', first: 'A warm audience will buy anything.', second: 'we need a better sales page.', underline: 'better sales page' } }))
  assert.deepEqual(plain(swap.fields), { text: 'we need a better sales page.', accent: 'better sales page', variant: 'glass' })
  // Light video look: a light card. A picture effect, or a card that is not an effect: none.
  assert.equal(m.safeFallback(spec({ fields: { effect: 'marker-highlight', text: 'a b c', word: 'b', theme: 'light' } })).fields.variant, 'card')
  assert.equal(m.safeFallback(spec({ fields: { effect: 'browser-device-stage' } })), null)
  assert.equal(m.safeFallback(spec({ template: 'stat', fields: { value: '3' } })), null)
  // A Before & after too tall for its band: the same two lines as a crossed-out list.
  const ba = m.safeFallback(spec({ template: 'before_after', fields: { before: 'A warm audience will buy anything', after: 'A cold audience needs a better sales page', theme: 'dark' } }))
  assert.deepEqual([ba.template, plain(ba.fields)], ['strike_list', { items: 'A warm audience will buy anything', final: 'A cold audience needs a better sales page', theme: 'dark' }])
})

test('graphics draw their words in a bold sans whatever the hook font; the brand font is for accent words only', () => {
  const c = structuredClone(fixture.candidates[0])
  c.hook = { text: 'You do not have to be an influencer', look: { look: 'floating', font: 'serif', textBg: 'dark', color: '#FFFFFF', hideAfterS: 10 } }
  assert.deepEqual(plain(m.graphicStyle(c)), { color: m.GRAPHIC_DEFAULT_COLOR, font: 'clean', accent_font: 'serif' })
  // A font the member picked for the graphic is kept as is (no accent swap).
  assert.deepEqual(plain(m.graphicFonts(c.hook.look, { fields: { font: 'condensed' } })), { font: 'condensed' })
  // A plain sans hook: no accent font.
  assert.deepEqual(plain(m.graphicFonts({ font: 'clean' })), { font: 'clean' })
  assert.deepEqual(plain(m.graphicFonts(null)), { font: 'clean' })
})

test('a saved small floating hook still takes the big floating sizes, and the top band leaves room for it', () => {
  assert.deepEqual(plain(m.headlineSizes({ look: 'floating' })), plain(m.FLOATING_FONT_SIZES))
  assert.deepEqual(plain(m.headlineSizes({ look: 'white' })), plain(m.HEADLINE_FONT_SIZES))
  assert.ok(Math.min(...m.FLOATING_FONT_SIZES) >= 64 && Math.max(...m.HEADLINE_FONT_SIZES) <= 60)
  const c = structuredClone(fixture.candidates[0])
  c.hook = { text: 'You do not have to be an influencer', look: { look: 'floating', font: 'serif', textBg: 'dark', color: '#FFFFFF' } }
  const share = m.hookShare(c, '9:16')
  // Two lines at the floating size: about a fifth of the frame (it was a 17% label before).
  assert.ok(share > 0.19 && share <= 0.3, String(share))
  // A card at the top sits under it, in a band tall enough for its words.
  const box = m.graphicBox('top', { aspect: '9:16', hook: share, captions: { y: 1340 / 1920, bottom: false }, handle: null }, 'card')
  assert.ok(box.top >= share && box.bottom - box.top >= m.CARD_MIN_BAND - 1e-9, JSON.stringify(box))
})

test('the recommended hook look is Key words in color, in the brand color', () => {
  assert.deepEqual(plain(m.recommendedHookLook('#e11d48')), { look: 'floating', font: 'clean', color: '#E11D48', textBg: 'highlight' })
  assert.equal(m.recommendedHookLook().color, m.DEFAULT_BRAND_COLOR)
  assert.equal(m.recommendedHookLook('#FFFFFF').color, m.DEFAULT_BRAND_COLOR)
  assert.deepEqual(plain(m.parseHeadlineLook(m.recommendedHookLook('#123456'))), plain(m.recommendedHookLook('#123456')))
})
