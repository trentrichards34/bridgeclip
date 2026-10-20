// The style board: its choices as each page's own fields, Shuffle's curated combos, "Use my brand",
// keyboard navigation through the swatch rows, and the one-line summary.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export * from './src/renderer/lib/style-board';
      export { StyleBoard, previewFrame } from './src/renderer/components/StyleBoard';
      export { onRadioKeyDown } from './src/renderer/components/ui/Segmented';
      export { createBoardPatch, createBoardStyle, createHooks, buildJobRequest } from './src/renderer/components/JobForm';
      export { useDraftStore } from './src/renderer/store/use-draft-store';
      export { CAPTION_PRESETS } from './src/shared/caption-presets';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  define: { __APP_VERSION__: JSON.stringify(require('../package.json').version) },
  jsx: 'automatic', write: false
}).outputFiles[0].text

const pending = () => new Promise(() => {})
globalThis.window = { bridgeclip: { brandIdentities: { list: pending }, ctas: { list: pending }, settings: { load: pending } } }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const m = mod.exports

function staticRender(element) {
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(element) } finally { React.useSyncExternalStore = original }
}

const BASE = { captions: true, captionPreset: 'pop', hook: 'white', font: 'clean', color: '#FFFFFF', handle: false, ctaId: null, keyword: '', offer: '' }
const ALL_ROWS = { hooks: m.LOOK_HOOKS, handle: true, cta: true, keyword: true }
const BRAND = { id: 'b1', name: 'Pull-Up Lab', text: 'x', createdAt: '', updatedAt: '',
  look: { color: '#FF8800', headlineLook: { look: 'brand', color: '#FF8800', font: 'serif' }, captionPreset: 'boxed', ctaKeyword: 'PULL', ctaOffer: 'my plan', handle: '@pulluplab', handlePosition: 'top-right' } }

/** A seeded random number generator, so the shuffle test covers many draws the same way each run. */
function seeded(seed) {
  let value = seed
  return () => { value = (value * 1664525 + 1013904223) % 4294967296; return value / 4294967296 }
}

test('Create: board choices become the same draft fields the separate pickers set', () => {
  const draft = { ...m.useDraftStore.getState(), workflow: 'automatic', source: 'https://example.com/v', aspectRatio: '9:16', includeTitle: true, titleStyle: 'headline' }
  assert.deepEqual(m.createBoardPatch(draft, { captions: false }), { includeCaptions: false })
  assert.deepEqual(m.createBoardPatch(draft, { captions: true, captionPreset: 'impact' }), { includeCaptions: true, captionPreset: 'impact' })
  assert.deepEqual(m.createBoardPatch(draft, { hook: 'none' }), { includeTitle: false })
  assert.deepEqual(m.createBoardPatch(draft, { hook: 'card' }), { includeTitle: true, titleStyle: 'card' })
  assert.deepEqual(m.createBoardPatch(draft, { hook: 'brand', color: '#7C5CFF' }),
    { includeTitle: true, titleStyle: 'headline', headlineLook: { look: 'brand', color: '#7C5CFF', font: 'clean' } })
  assert.deepEqual(m.createBoardPatch(draft, { font: 'condensed' }), { headlineLook: { look: 'white', color: '#FFFFFF', font: 'condensed' } })
  assert.deepEqual(m.createBoardPatch(draft, { handle: true, ctaId: 'c1', keyword: 'SALES', offer: 'my guide' }),
    { showHandle: true, ctaId: 'c1', ctaKeyword: 'SALES', ctaOffer: 'my guide' })
  // And back: what the board shows for a draft.
  assert.equal(m.createBoardStyle({ ...draft, includeTitle: false }).hook, 'none')
  assert.equal(m.createBoardStyle({ ...draft, titleStyle: 'card' }).hook, 'card')
  assert.equal(m.createBoardStyle({ ...draft, headlineLook: { look: 'floating', color: '#FFFFFF', font: 'serif' } }).hook, 'floating')
  // 16:9 clips and a gameplay background only have the title card (or none).
  assert.deepEqual(m.createHooks({ ...draft, aspectRatio: '16:9' }), ['card', 'none'])
  assert.equal(m.createBoardStyle({ ...draft, aspectRatio: '16:9' }).hook, 'card')
  assert.deepEqual(m.createHooks({ ...draft, backgroundVideo: 'Minecraft parkour', broll: 'off' }), ['card', 'none'])
  // The request: the board's choice ends up in the same fields.
  const chosen = { ...draft, ...m.createBoardPatch(draft, { captions: true, captionPreset: 'neon', hook: 'black', font: 'serif' }) }
  const request = m.buildJobRequest(chosen, { start: null, end: null })
  assert.equal(request.captionPreset, 'neon')
  assert.equal(request.includeTitle, true)
  assert.equal(request.titleStyle, 'headline')
  assert.deepEqual(request.headlineLook, { look: 'black', color: '#FFFFFF', font: 'serif' })
})

test('Remix and Edit my recording: board choices become the headline look and the form fields', () => {
  const form = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, showHandle: false, ctaId: null, ctaKeyword: '', ctaOffer: '' }
  assert.deepEqual(m.boardFromLook(form), BASE)
  assert.deepEqual(m.lookPatch(form, { hook: 'none' }), { headlineLook: { look: 'none', color: '#FFFFFF', font: 'clean' } })
  assert.deepEqual(m.lookPatch(form, { color: '#C6FF3D', hook: 'brand' }), { headlineLook: { look: 'brand', color: '#C6FF3D', font: 'clean' } })
  assert.deepEqual(m.lookPatch(form, { captions: false, handle: true, ctaId: 'c1', keyword: 'GO', offer: 'a list' }),
    { includeCaptions: false, showHandle: true, ctaId: 'c1', ctaKeyword: 'GO', ctaOffer: 'a list' })
  // Edit my recording's look has no call to action: nothing extra appears.
  const edit = { includeCaptions: true, captionPreset: 'pop', headlineLook: form.headlineLook, showHandle: false }
  assert.deepEqual(Object.keys(m.lookPatch(edit, { captionPreset: 'glow', captions: true })).sort(), ['captionPreset', 'includeCaptions'])
})

test('hook and color choices: the brand bar starts from the brand color; a color puts the hook on a bar', () => {
  assert.deepEqual(m.hookPatch(BASE, 'brand', '#FF8800'), { hook: 'brand', color: '#FF8800' })
  assert.deepEqual(m.hookPatch(BASE, 'brand'), { hook: 'brand', color: '#2563EB' })
  assert.deepEqual(m.hookPatch({ ...BASE, color: '#123456' }, 'brand', '#FF8800'), { hook: 'brand' })
  assert.deepEqual(m.hookPatch(BASE, 'black'), { hook: 'black' })
  assert.deepEqual(m.colorPatch('#7c5cff', m.LOOK_HOOKS), { color: '#7C5CFF', hook: 'brand' })
  assert.deepEqual(m.colorPatch('#7c5cff', ['card', 'none']), { color: '#7C5CFF' })
})

test('Shuffle only ever picks a curated combo, never the one already showing, and every combo is valid', () => {
  const presets = new Set(m.CAPTION_PRESETS.map((preset) => preset.id))
  for (const combo of m.CURATED_COMBOS) {
    assert.ok(presets.has(combo.captionPreset), combo.id)
    assert.ok(['white', 'black', 'brand', 'floating'].includes(combo.hook), combo.id)
    assert.ok(['clean', 'serif', 'condensed'].includes(combo.font), combo.id)
    assert.match(combo.color, /^#[0-9A-F]{6}$/, combo.id)
  }
  assert.equal(new Set(m.CURATED_COMBOS.map((combo) => combo.id)).size, m.CURATED_COMBOS.length)
  const random = seeded(7)
  let value = BASE
  const seen = new Set()
  for (let i = 0; i < 300; i++) {
    const before = m.matchingCombo(value)
    const combo = m.shuffleCombo(value, random)
    assert.ok(m.CURATED_COMBOS.includes(combo))
    assert.notEqual(combo, before, 'never the same combo twice in a row')
    value = { ...value, ...m.comboPatch(combo, m.LOOK_HOOKS) }
    assert.equal(m.matchingCombo(value), combo, 'the board shows exactly the combo')
    seen.add(combo.id)
  }
  assert.equal(seen.size, m.CURATED_COMBOS.length, 'every combo comes up')
  // Even the extremes of the random number stay in the list.
  assert.ok(m.CURATED_COMBOS.includes(m.shuffleCombo(BASE, () => 0)))
  assert.ok(m.CURATED_COMBOS.includes(m.shuffleCombo(BASE, () => 0.9999999)))
  // A page without those hook looks (16:9 Create) keeps its own hook.
  assert.equal('hook' in m.comboPatch(m.CURATED_COMBOS[0], ['card', 'none']), false)
})

test('Use my brand puts back the brand kit (only what differs), and does nothing without a kit', () => {
  const patch = m.brandBoardPatch(BRAND.look, { ...BASE, captionPreset: 'neon', hook: 'floating' }, m.LOOK_HOOKS)
  assert.deepEqual(patch, { hook: 'brand', font: 'serif', color: '#FF8800', captionPreset: 'boxed', keyword: 'PULL', offer: 'my plan', handle: true })
  const applied = { ...BASE, ...patch }
  assert.deepEqual(m.brandBoardPatch(BRAND.look, applied, m.LOOK_HOOKS), {}, 'already the brand: nothing changes')
  assert.deepEqual(m.brandBoardPatch(undefined, BASE, m.LOOK_HOOKS), {})
  // Captions turned off come back on with the brand's style.
  assert.equal(m.brandBoardPatch(BRAND.look, { ...BASE, captions: false }, m.LOOK_HOOKS).captions, true)
  // A brand with only a color sets the bar color; a page without the brand bar keeps its hook.
  assert.deepEqual(m.brandBoardPatch({ color: '#123456' }, BASE, m.LOOK_HOOKS), { color: '#123456' })
  assert.equal('hook' in m.brandBoardPatch(BRAND.look, BASE, ['card', 'none']), false)
})

test('the summary line names each choice', () => {
  assert.equal(m.styleSummary(BASE, ALL_ROWS), 'Pop captions · White bar · Clean font · No CTA clip')
  assert.equal(m.styleSummary({ ...BASE, captions: false, hook: 'none' }, { hooks: m.LOOK_HOOKS }), 'No captions · No hook text')
  assert.equal(m.styleSummary({ ...BASE, captionPreset: 'boxed', hook: 'brand', font: 'serif', color: '#FF8800', handle: true, ctaId: 'c', keyword: 'PULL' }, ALL_ROWS,
    { brandColor: '#FF8800', corner: 'top-right', hasMark: true, ctaName: 'Free plan' }),
  'Boxed captions · Brand color · Serif font · Brand #FF8800 · Handle top right · Ends with Free plan · Comment PULL')
  assert.equal(m.styleSummary({ ...BASE, hook: 'brand', color: '#7C5CFF' }, { hooks: m.LOOK_HOOKS }), 'Pop captions · Brand color · Clean font · Violet #7C5CFF')
  assert.equal(m.styleSummary({ ...BASE, hook: 'card' }, { hooks: ['card', 'none'] }), 'Pop captions · Title card')
  assert.equal(m.styleSummary({ ...BASE, handle: false }, { handle: true }, { hasMark: true }), 'Pop captions · No handle')
})

test('every swatch row is a radio group with one tab stop, and the arrow keys move and choose', () => {
  const html = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, hook: 'brand', color: '#FF8800', handle: true }, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
  const groups = [...html.matchAll(/<div role="radiogroup" aria-label="([^"]+)"[^>]*>(.*?)<\/div>(?=<button|<label|<p|<\/div>)/gs)]
  const names = groups.map((group) => group[1])
  for (const name of ['Caption style', 'Hook text look', 'Hook text font', 'Bar color', 'Handle corner', 'Call to action']) assert.ok(names.includes(name), name)
  for (const [, name, body] of groups) {
    const radios = body.match(/<button[^>]*role="radio"[^>]*>/g) ?? []
    assert.ok(radios.length >= 1, name)
    assert.equal(radios.filter((radio) => radio.includes('tabindex="0"')).length, 1, `${name}: one tab stop`)
    assert.equal(radios.filter((radio) => radio.includes('aria-checked="true"')).length, 1, `${name}: one choice`)
  }
  assert.match(html, /aria-checked="true" aria-label="Brand #FF8800"/)
  assert.match(html, /aria-label="Next captions"/)
  assert.match(html, /role="switch" aria-checked="true" aria-label="Show my handle"/)
  assert.match(html, /role="img" aria-label="Preview: Pop captions · Brand color · Clean font · Brand #FF8800 · Handle top right · No CTA clip"/)
  assert.match(html, /data-testid="style-board-summary"[^>]*>Pop captions · Brand color/)

  // The rows' keyboard handler: Right/Down to the next radio, Left/Up back (wrapping), Home and End; each focuses and chooses.
  const log = []
  const radios = ['a', 'b', 'c'].map((id) => ({ id, focus: () => log.push(`focus ${id}`), click: () => log.push(`click ${id}`) }))
  const parent = { querySelectorAll: () => radios }
  const press = (key, at) => {
    let prevented = false
    m.onRadioKeyDown({ key, currentTarget: Object.assign(radios[at], { parentElement: parent }), preventDefault: () => { prevented = true } })
    return prevented
  }
  assert.equal(press('ArrowRight', 0), true); assert.deepEqual(log.splice(0), ['focus b', 'click b'])
  press('ArrowLeft', 0); assert.deepEqual(log.splice(0), ['focus c', 'click c'])
  press('ArrowDown', 2); assert.deepEqual(log.splice(0), ['focus a', 'click a'])
  press('End', 0); assert.deepEqual(log.splice(0), ['focus c', 'click c'])
  press('Home', 2); assert.deepEqual(log.splice(0), ['focus a', 'click a'])
  assert.equal(press('x', 0), false); assert.deepEqual(log, [])
})

test('rows a page doesn’t use are left out, and the font waits for a hook look that uses it', () => {
  const html = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: {}, brand: null }))
  assert.match(html, /aria-label="Caption style"/)
  for (const name of ['Hook text look', 'Hook text font', 'Bar color', 'Handle corner', 'Call to action', 'Comment keyword']) assert.doesNotMatch(html, new RegExp(`aria-label="${name}"`))
  // A title card has no font choice: the font radios are disabled (and have no tab stop).
  const card = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, hook: 'card' }, onChange() {}, rows: { hooks: ['white', 'card', 'none'] }, brand: null }))
  const fonts = card.match(/aria-label="Hook text font"[^>]*>(.*?)<\/div>/s)[1].match(/<button[^>]*>/g)
  assert.ok(fonts.every((radio) => radio.includes('disabled') && radio.includes('tabindex="-1"')))
  // Without a brand mark there is no handle switch, just how to add one.
  const plain = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: { handle: true }, brand: { ...BRAND, look: {} } }))
  assert.doesNotMatch(plain, /Show my handle/)
  assert.match(plain, /Add your handle or logo to Pull-Up Lab/)
  assert.match(plain, /<button[^>]*>.*?Add a handle<\/button>/s, 'a button to add one right there')
})

test('without a brand, "Set up my brand" replaces a greyed-out "Use my brand", and the handle row offers the same', () => {
  const html = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: ALL_ROWS, brand: null }))
  assert.doesNotMatch(html, />Use my brand</)
  assert.equal((html.match(/>Set up my brand<\/button>/g) ?? []).length, 2)
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Use my brand/)
  const branded = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
  assert.match(branded, />Use my brand<\/button>/)
  assert.doesNotMatch(branded, /Set up my brand/)
})

test('rows wrap (no sideways strips); captions show a first set with "Show all"', () => {
  const html = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
  assert.doesNotMatch(html, /overflow-x-auto/)
  const captions = html.match(/aria-label="Caption style"[^>]*>(.*?)<\/div><button/s)[1]
  const radios = captions.match(/role="radio"/g)
  assert.equal(radios.length, 10, 'No captions and the first nine')
  assert.match(html, new RegExp(`aria-expanded="false"[^>]*>Show all ${m.CAPTION_PRESETS.length + 1}`))
  assert.doesNotMatch(captions, /aria-label="Vintage"/)
  // A chosen style past the first set is still shown (and chosen).
  const later = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, captionPreset: 'vintage' }, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
  assert.match(later.match(/aria-label="Caption style"[^>]*>(.*?)<\/div><button/s)[1], /aria-checked="true" aria-label="Vintage"/)
})

test('the color row only shows for a Brand color bar, the one look it changes', () => {
  for (const hook of ['white', 'black', 'floating', 'none']) {
    const html = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, hook }, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
    assert.doesNotMatch(html, /aria-label="Bar color"/, hook)
    assert.doesNotMatch(html, /For a Brand color bar/)
  }
  const brand = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, hook: 'brand', color: '#7C5CFF' }, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
  assert.match(brand, /aria-label="Bar color"/)
  assert.match(brand, /data-testid="style-row-bar-color-current"[^>]*>Violet #7C5CFF/)
})

test('the comment keyword has one heading and one keyword field beside "What they get"', () => {
  const html = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: ALL_ROWS, brand: BRAND, keywordLabel: 'Comment keyword (optional)' }))
  assert.equal((html.match(/>Comment keyword</g) ?? []).length, 1)
  assert.doesNotMatch(html, /Comment keyword \(optional\)/)
  assert.match(html, /aria-label="Comment keyword"/)
  assert.match(html, />Keyword</)
  assert.match(html, />What they get</)
})

test('the preview frame: a local video, a YouTube thumbnail, or the neutral stand-in', () => {
  assert.deepEqual(m.previewFrame('/videos/talk.mp4'), { kind: 'video', src: '/videos/talk.mp4' })
  assert.deepEqual(m.previewFrame('/shots/post.png', 'image'), { kind: 'image', src: '/shots/post.png' })
  assert.deepEqual(m.previewFrame('https://youtu.be/abcdefghijk'), { kind: 'image', src: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' })
  assert.equal(m.previewFrame('https://example.com/video.mp4'), null)
  assert.equal(m.previewFrame(''), null)
  assert.equal(m.previewFrame(null), null)
})

test('the preview’s measurements follow the engine', () => {
  // Every caption preset has the engine's size and font metrics.
  for (const preset of m.CAPTION_PRESETS) {
    assert.ok(m.ENGINE_CAPTIONS[preset.id], preset.id)
    assert.ok(m.LIBASS_EM_RATIO[m.ENGINE_CAPTIONS[preset.id].font], preset.id)
  }
  // Pop: Fontsize 84 in Montserrat Black (win ascent + descent 1.562 em).
  assert.ok(Math.abs(m.captionEm('pop') - 84 / 1.562) < 0.01)
  // brand_mark.mark_position on 1080×1920 with a 77 px mark under a 348 px bar.
  assert.deepEqual(m.markPosition('top-right', 1080, 1920, 300, 77, 348, 0), { x: 1080 - 300 - 40, y: 368 })
  assert.deepEqual(m.markPosition('bottom-left', 1080, 1920, 300, 77, 0, 1558), { x: 40, y: 1578 })
  assert.deepEqual(m.markPosition('bottom-left', 1080, 1920, 300, 77, 0, 0), { x: 40, y: 1536 })
  assert.equal(m.captionsBottom(1920, 348, true, 1), 348 + Math.round(1572 * 0.7) + 110)
  assert.equal(m.captionsBottom(1920, 0, true, 1), Math.round(1920 * 0.78))
  assert.equal(m.captionsBottom(1920, 348, false, 1), 0)
})
