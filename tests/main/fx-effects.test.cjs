// Effects (HyperFrames units as `fx` graphics): the build-time compiler, the vendored units and their notices, the
// catalog (fields ↔ the units' registry variables, the engine's JSON copy), the adapter's variables and timing, and
// the graphics contract (validation, cue times through the cut, words matching).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const ROOT = path.join(__dirname, '../..')
const VENDOR = path.join(ROOT, 'src/renderer/graphics/fx/vendor')
const OWN = path.join(ROOT, 'src/renderer/graphics/fx/own')
/** A unit's folder: vendored from HyperFrames, or CreatorClips' own remake (fx/own). */
const dirOf = (e) => e.own ? OWN : VENDOR
const m = loadMain("export * from './src/shared/fx-html'; export * from './src/shared/fx-catalog'; export * from './src/shared/motion-graphics'; export { graphicSpec } from './src/shared/graphic-layout'; export { prefillEffect } from './src/shared/graphic-prefill'")
const plain = (v) => JSON.parse(JSON.stringify(v))
const clip = (over = {}) => ({ ...structuredClone(fixture.candidates[0]), ...over })

test('the compiler drops CDN and module scripts, keeps inline scripts in order, strips font loads and maps web fonts', () => {
  const html = `<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><style>@import url(x.css); @font-face { font-family: "Caveat"; src: url(a.woff2) } .a { font-family: "Inter", system-ui }</style></head>
    <body><template><div id="root"><style>.b { font-family: ui-monospace }</style><template id="star"><span>★</span></template><p class="a">Hi</p>
    <script>var one = 1;</script><script type="module">import x from "https://x"</script><script>window.__timelines = { t: one };</script></div></template></body></html>`
  const c = m.compileEffectHtml(html)
  assert.equal(c.snippet, false)
  assert.doesNotMatch(c.styles, /@import|@font-face|Inter\b/)
  assert.match(c.styles, /"MG Jakarta", system-ui/)
  assert.match(c.styles, /MG Mono, ui-monospace/)
  assert.match(c.script, /var one = 1;[\s\S]*__timelines/)
  assert.doesNotMatch(c.script, /import x/)
  // The outer <template> is the unit; a nested one stays a template.
  assert.match(c.markup, /^<div id="root">/)
  assert.match(c.markup, /<template id="star">/)
  assert.doesNotMatch(c.markup, /<script|<style|<link/)
  // A snippet without its own #root is wrapped in one that fills the box.
  const s = m.compileEffectHtml('<div class="x">5</div><style>.x{}</style><script>1</script>')
  assert.equal(s.snippet, true)
  assert.equal(s.markup, '<div id="root" class="cc-fx-snippet"><div class="x">5</div></div>')
  // Font names inside script strings keep valid JavaScript.
  assert.equal(m.mapFonts(`el.style.fontFamily = "Inter, sans-serif"; var f = "Inter";`), `el.style.fontFamily = "MG Jakarta, sans-serif"; var f = "MG Jakarta";`)
  const mod = m.effectModule(html)
  assert.match(mod, /^export const styles = /)
  assert.match(mod, /export function run\(gsap, CustomEase, window, document\) \{/)
})

test('every catalog effect is vendored (or remade) with its license notice, compiles, loads nothing from the network and runs as a function', () => {
  const ids = m.FX_EFFECTS.map((e) => e.id)
  assert.ok(ids.length >= 50 && ids.length <= 60, `${ids.length} effects`)
  assert.equal(new Set(ids).size, ids.length)
  assert.match(fs.readFileSync(path.join(VENDOR, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/)
  assert.match(fs.readFileSync(path.join(VENDOR, 'NOTICE'), 'utf8'), /HeyGen[\s\S]*Apache License/)
  const listed = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort()
  assert.deepEqual(listed(VENDOR), m.FX_EFFECTS.filter((e) => !e.own).map((e) => e.id).sort())
  assert.deepEqual(listed(OWN), m.FX_EFFECTS.filter((e) => e.own).map((e) => e.id).sort())
  for (const e of m.FX_EFFECTS) {
    const id = e.id
    const html = fs.readFileSync(path.join(dirOf(e), `${id}.html`), 'utf8')
    if (e.own) assert.match(html.slice(0, 700), /CreatorClips unit[\s\S]*remade from HyperFrames[\s\S]*Apache License 2\.0/, id)
    else assert.match(html.slice(0, 600), /Vendored from HyperFrames[\s\S]*Apache License, Version 2\.0[\s\S]*Changed by CreatorClips/, id)
    const c = m.compileEffectHtml(html)
    for (const text of [c.styles, c.markup]) assert.doesNotMatch(text.replace(/http:\/\/www\.w3\.org[^"' )]*/g, ''), /https?:\/\/|@font-face/, id)
    assert.doesNotMatch(c.script, /cdn\.jsdelivr|fonts\.googleapis/, id)
    assert.match(c.script, /__timelines/, `${id} registers a timeline`)
    // The compiled module parses (strict mode, like the ES module it becomes).
    assert.doesNotThrow(() => new Function('gsap', 'CustomEase', 'window', 'document', `"use strict";\n${c.script}`), id)
  }
})

test('catalog fields map onto the units’ own variables, with field keys the graphics contract accepts', () => {
  for (const e of m.FX_EFFECTS) {
    const item = JSON.parse(fs.readFileSync(path.join(dirOf(e), `${e.id}.registry-item.json`), 'utf8'))
    const vars = new Map((item.variables ?? []).map((v) => [v.id, v]))
    // Variables CreatorClips' snippet timelines and patches add (scripts/vendor-hyperframes.mjs ADAPT, PATCH).
    const added = e.id === 'strikethrough-replace' ? ['before', 'after'] : e.id === 'torn-paper-rip' ? ['first_text', 'second_text'] : []
    for (const f of e.fields) {
      // Pictures and the mark on them are the adapter's own fields (mount.ts), never a unit variable.
      if (f.kind === 'image' || f.kind === 'region' || f.key === 'mark') { assert.equal(f.variable, '', `${e.id}.${f.key}`); assert.equal(f.said, false); continue }
      assert.match(f.key, /^[a-z_]{1,20}$/, `${e.id}.${f.key}`)
      assert.ok(vars.has(f.variable) || added.includes(f.variable), `${e.id}: ${f.variable} is a unit variable`)
      if (f.kind === 'choice') for (const o of f.options) assert.ok(vars.get(f.variable).options.some((x) => x.value === o.value), `${e.id}.${f.key}=${o.value}`)
    }
    for (const key of Object.keys(e.fixed ?? {})) assert.ok(vars.has(key), `${e.id}: fixed ${key}`)
    if (e.cue?.variable) assert.ok(vars.has(e.cue.variable), `${e.id}: cue variable ${e.cue.variable}`)
    if (e.cue) assert.ok(e.fields.some((f) => f.key === e.cue.field), `${e.id}: cue field`)
    assert.ok(['whoosh', 'pop', 'tick', 'riser', 'none'].includes(e.sound))
    assert.ok(e.use_when && e.avoid_when && e.jobs.length && e.hold_s > 0 && e.default_ms >= 800 && e.default_ms <= 8000, e.id)
    // Every field the planner must have said is shown text or a number; choices never are.
    for (const f of e.fields) if (f.kind === 'choice') assert.equal(f.said, false)
  }
})

test('the engine’s JSON copy of the catalog is up to date', () => {
  const { catalogJson, OUT } = require('../../scripts/export-fx-catalog.cjs')
  assert.equal(fs.readFileSync(OUT, 'utf8'), catalogJson())
  const json = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  assert.equal(json.effects.length, m.FX_EFFECTS.length)
  const count = json.effects.find((e) => e.id === 'count-up')
  assert.deepEqual(plain(count.fields.find((f) => f.key === 'value')), { key: 'value', kind: 'number', said: true, required: true })
  assert.equal(count.sound, 'tick')
})

test('variables: numbers parsed, lists joined, choices checked, empty words never fall back to a unit’s sample words', () => {
  const count = m.fxEffect('count-up')
  assert.deepEqual(plain(m.fxVariables(count, { effect: 'count-up', value: '$1,200', suffix: '' })), { accent: 'green', exit: 'up', start: 0, end: 1200, prefix: '​', suffix: '​' })
  const chart = m.fxEffect('chart-story')
  const v = m.fxVariables(chart, { effect: 'chart-story', data: '12\n28\n45', labels: '', type: 'pie', unit: '%' })
  assert.equal(v.data, '12,28,45')
  assert.equal(v.labels, ',')
  assert.equal(v.type, undefined)
  assert.equal(v.unit, '%')
  // A list item never carries the unit's separator.
  assert.equal(m.fxVariables(m.fxEffect('constellation-hub'), { nodes: 'Plan, then build\nShip' }).nodes, 'Plan  then build,Ship')
  assert.equal(m.fxNumber('4.8 stars'), 4.8)
  assert.equal(m.fxNumber('none'), null)
})

test('timing: spoken cue times become a unit’s cues, or shift it so its beat lands on the word', () => {
  const rise = m.fxEffect('per-word-rise'), count = m.fxEffect('count-up'), hub = m.fxEffect('constellation-hub')
  const t = m.fxTiming(rise, { cue_ms: '200\n700\n1500' }, 3000)
  assert.deepEqual(plain(t), { lead_ms: 0, unit_ms: 3000, cues: [0.2, 0.7, 1.5] })
  assert.equal(m.fxVariables(rise, { text: 'a b c' }, t).cues, '0.20,0.70,1.50')
  // Count up lands 1.72 s in: said at 2.5 s, it starts 0.78 s in.
  assert.deepEqual(plain(m.fxTiming(count, { cue_ms: '2500' }, 4000)), { lead_ms: 780, unit_ms: 3220, cues: null })
  // Never so late that less than 1.2 s is left; times out of order or range are ignored.
  assert.equal(m.fxTiming(m.fxEffect('headline-slam'), { cue_ms: '2900' }, 3000).lead_ms, 1800)
  assert.deepEqual(plain(m.fxTiming(hub, { cue_ms: '900\n300' }, 4000)), { lead_ms: 0, unit_ms: 4000, cues: null })
  assert.deepEqual(plain(m.fxTiming(hub, {}, 4000)), { lead_ms: 0, unit_ms: 4000, cues: null })
})

test('graphics contract: fx graphics validate, need their words, keep cue times on the words through cuts and edits', () => {
  const g = { id: 'g-fx01', template: 'fx', at_ms: 2000, duration_ms: 3000, placement: 'top', fields: { effect: 'count-up', value: '75', cue_ms: '500' } }
  const [parsed] = m.parseGraphics([g])
  assert.equal(parsed.template, 'fx')
  assert.throws(() => m.parseGraphics([{ ...g, fields: { effect: 'x-follow-card' } }]), /Choose one of the effects/)
  assert.equal(m.graphicHasContent(g), true)
  assert.equal(m.graphicHasContent({ template: 'fx', fields: { effect: 'count-up' } }), false)
  assert.equal(m.graphicHasContent({ template: 'fx', fields: { effect: 'chart-story', data: '1\n2' } }), true)
  // Cue times are source ms from the graphic's start; the render spec has them on the finished clip's clock.
  const c = clip({ graphics: [g] })
  const spec = m.graphicSpec(fixture, c, g)
  assert.equal(spec.fields.cue_ms, String(Math.round((m.outputTime(c, 2500) - m.graphicWindow(c, g).start_ms))))
  // Moved by the cut fitter, they move with it; reworded or moved by hand, they go.
  const fitted = m.fitGraphicInCut({ ...g, at_ms: 500 }, c)
  assert.equal(fitted.fields.cue_ms, String(Math.max(0, 500 + 500 - fitted.at_ms)))
  const reworded = m.updateGraphic(c, g.id, { fields: { value: '80' } }).find((x) => x.id === g.id)
  assert.equal(reworded.fields.cue_ms, undefined)
  const recolored = m.updateGraphic(c, g.id, { fields: { color: '#FF0000' } }).find((x) => x.id === g.id)
  assert.equal(recolored.fields.cue_ms, '500')
  // Switching to another template keeps the words.
  assert.equal(m.switchGraphicTemplate({ ...g, fields: { effect: 'headline-slam', text: 'Ship it today' } }, 'title').fields.text, 'Ship it today')
  assert.equal(m.GRAPHICS_VERSION, 6)
})

test('words: an effect’s beats match the words said; its starting words are only words said', () => {
  const words = [['We', 0], ['grew', 300], ['to', 600], ['twelve', 800], ['hundred', 1100], ['members', 1500], ['plan', 2400], ['make', 2900], ['share', 3400]].map(([word, t]) => ({ word, start_ms: t, end_ms: t + 250 }))
  const hub = { template: 'fx', at_ms: 2200, duration_ms: 3000, fields: { effect: 'constellation-hub', hub: 'Growth', nodes: 'Plan\nMake\nShare' } }
  assert.equal(m.matchFxCues(hub, words).fields.cue_ms, '200\n700\n1200')
  assert.equal(m.matchFxCues({ ...hub, fields: { ...hub.fields, nodes: 'Plan\nSell' } }, words), null)
  const count = { template: 'fx', at_ms: 0, duration_ms: 3500, fields: { effect: 'count-up', value: '1200' } }
  assert.equal(m.matchFxCues(count, words), null, 'the number is said in words, not digits')
  const pre = m.prefillEffect('count-up', words, 600)
  assert.equal(pre.fields.value, '1200')
  assert.equal(pre.first_ms, 800)
  const rise = m.prefillEffect('per-word-rise', words, 2300)
  assert.ok(rise.fields.text && rise.fields.text.split(' ').every((w) => words.some((x) => x.word.toLowerCase() === w.toLowerCase())), rise.fields.text)
  assert.deepEqual(plain(m.prefillEffect('star-rating-fill', words.slice(6), 2300).fields), {})
})

test('testimonials: no invented name; a name only when typed or said, and nothing shows for one not given', () => {
  for (const id of ['testimonial-card', 'testimonial-proof-card']) {
    const e = m.fxEffect(id)
    for (const f of e.fields.filter((x) => ['author', 'handle', 'name', 'role', 'company'].includes(x.key))) {
      assert.equal(f.manual, true, `${id}.${f.key} is never filled from the transcript`)
      assert.equal(f.sample, '', `${id}.${f.key} has no sample name`)
      assert.equal(f.said, true, `${id}.${f.key} must be said when the planner places it`)
    }
    // An empty name reaches the unit as blank, never its own default ("Ken Tanaka", "Maya Chen").
    const v = m.fxVariables(e, { effect: id, quote: 'It works' })
    for (const key of ['author', 'name']) if (key in v) assert.equal(v[key], '\u200B')
    // The parts hidden while empty exist in the unit's markup.
    const markup = m.compileEffectHtml(fs.readFileSync(path.join(VENDOR, `${id}.html`), 'utf8')).markup
    for (const h of e.hide_empty) assert.match(markup, new RegExp(`class="${h.selector.slice(1)}"`), `${id}: ${h.selector}`)
  }
  const words = ['Sarah', 'said', 'this', 'changed', 'how', 'I', 'work'].map((word, i) => ({ word, start_ms: i * 300, end_ms: i * 300 + 250 }))
  const pre = m.prefillEffect('testimonial-card', words, 0)
  assert.deepEqual(Object.keys(pre.fields), ['quote'])
})

test('words built into a unit that no field sets are never shown (they would be words nobody said)', () => {
  // Unit markup or script with fixed copy, and the rule that keeps it off screen.
  const builtIn = { 'ticker-takeover': ['<div class="tt-label">signal</div>', '.tt-label { display: none'],
    'locked-nucleus-orbit': ['"signal", "motion", "frames"', '.lno-copy { display: none'], 'overwhelm-surround': ['"Inbox"', '.os-chip { color: transparent'] }
  for (const [id, [copy, rule]] of Object.entries(builtIn)) {
    const effect = m.fxEffect(id)
    assert.ok(fs.readFileSync(path.join(dirOf(effect), `${id}.html`), 'utf8').includes(copy), `${id} still has its built-in copy`)
    assert.ok((effect.css_rules ?? '').includes(rule), `${id} hides its built-in copy`)
  }
})
