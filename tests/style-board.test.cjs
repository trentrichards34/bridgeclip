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
      export { CAPTION_PRESETS } from './src/shared/caption-presets';
      export { StylePreview } from './src/renderer/components/StylePreview';
      export { LookFrame, boxedHookLayout } from './src/renderer/components/LookFrame';
      export { HeadlineLookPicker } from './src/renderer/components/HeadlineLookPicker';
      export { HEADLINE_FONTS, HEADLINE_TEXT_BGS, accentWordIndex, parseHeadlineLook, headlineLookForEngine, headlineTextColor, headlineTextBox, textBoxOutline, textBoxPath, wrapHeadline } from './src/shared/headline-look';
      export { LOOK_EXTRAS } from './src/shared/look-extras';`,
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

/** A radio group's (or checkbox group's) markup: from its opening tag to the next group. */
function group(html, label) {
  const start = html.indexOf(`aria-label="${label}"`)
  if (start < 0) return null
  const rest = html.slice(start + 1)
  const next = rest.search(/role="(radiogroup|group)"/)
  return next < 0 ? rest : rest.slice(0, next)
}

function staticRender(element) {
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(element) } finally { React.useSyncExternalStore = original }
}

const BASE = { captions: true, captionPreset: 'pop', hook: 'white', font: 'clean', color: '#FFFFFF', handle: false, ctaId: null, keyword: '', offer: '', extras: [] }
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
    assert.ok(['clean', 'serif', 'condensed', 'marker', 'sans_serif_accent'].includes(combo.font), combo.id)
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
  const names = [...html.matchAll(/role="radiogroup" aria-label="([^"]+)"/g)].map((match) => match[1])
  const groups = names.map((name) => [null, name, group(html, name)])
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
  const fonts = group(card, 'Hook text font').match(/<button[^>]*role="radio"[^>]*>/g)
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
  const captions = group(html, 'Caption style')
  const radios = captions.match(/role="radio"/g)
  assert.equal(radios.length, 10, 'No captions and the first nine')
  assert.match(html, new RegExp(`aria-expanded="false"[^>]*>Show all ${m.CAPTION_PRESETS.length + 1}`))
  assert.doesNotMatch(captions, /aria-label="Vintage"/)
  // A chosen style past the first set is still shown (and chosen).
  const later = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, captionPreset: 'vintage' }, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
  assert.match(group(later, 'Caption style'), /aria-checked="true" aria-label="Vintage"/)
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

test('extras: toggled in app order, named in the summary, and kept in each page\'s fields and requests', () => {
  assert.deepEqual(m.toggleExtra([], 'progress_bar'), ['progress_bar'])
  assert.deepEqual(m.toggleExtra(['progress_bar'], 'keyword_pill'), ['keyword_pill', 'progress_bar'], 'app order, not click order')
  assert.deepEqual(m.toggleExtra(['keyword_pill', 'progress_bar'], 'keyword_pill'), ['progress_bar'])
  assert.equal(m.extrasName([]), 'None')
  assert.equal(m.extrasName(['comment_box', 'keyword_pill']), 'Keyword pill, Comment box')
  assert.equal(m.styleSummary({ ...BASE, extras: ['keyword_pill', 'progress_bar'] }, { ...ALL_ROWS, extras: true }),
    'Pop captions · White bar · Clean font · No CTA clip · Extras: Keyword pill, Progress bar')
  assert.equal(m.styleSummary({ ...BASE, extras: ['keyword_pill'] }, ALL_ROWS), 'Pop captions · White bar · Clean font · No CTA clip', 'no Extras row, no extras')
  // Remix / Edit my recording fields.
  const form = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, showHandle: false }
  assert.deepEqual(m.boardFromLook({ ...form, lookExtras: ['tag', 'progress_bar'] }).extras, ['progress_bar'], 'unknown ids dropped')
  assert.deepEqual(m.lookPatch(form, { extras: ['comment_box'] }), { lookExtras: ['comment_box'] })
  // Create: the draft field and the request (Automatic only).
  const draft = { ...m.useDraftStore.getState(), workflow: 'automatic', source: 'https://example.com/v', aspectRatio: '9:16' }
  assert.deepEqual(m.useDraftStore.getState().lookExtras, [])
  assert.deepEqual(m.createBoardPatch(draft, { extras: ['accent_words'] }), { lookExtras: ['accent_words'] })
  assert.deepEqual(m.createBoardStyle({ ...draft, lookExtras: ['broll_tags'] }).extras, ['broll_tags'])
  assert.deepEqual(m.buildJobRequest({ ...draft, lookExtras: ['keyword_pill', 'comment_box'] }, { start: null, end: null }).lookExtras, ['keyword_pill', 'comment_box'])
  assert.equal('lookExtras' in m.buildJobRequest(draft, { start: null, end: null }), false, 'none: left out')
  assert.equal('lookExtras' in m.buildJobRequest({ ...draft, workflow: 'review', lookExtras: ['keyword_pill'] }, { start: null, end: null }), false, 'Manual clips have no look')
})

test('the Extras row is a checkbox group of tiles; the board starts with a choice of how to start', () => {
  const html = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, extras: ['progress_bar'] }, onChange() {}, rows: { ...ALL_ROWS, extras: true }, brand: BRAND }))
  const extras = group(html, 'Extras: pick as many as you like')
  const boxes = extras.match(/<button[^>]*role="checkbox"[^>]*>/g)
  assert.equal(boxes.length, m.LOOK_EXTRAS.length)
  assert.ok(boxes.every((box) => !box.includes('tabindex="-1"')), 'every checkbox is a tab stop')
  assert.equal(boxes.filter((box) => box.includes('aria-checked="true"')).length, 1)
  assert.match(extras, /aria-checked="true" aria-label="Progress bar"/)
  assert.match(html, /data-testid="style-row-extras-current"[^>]*>Progress bar</)
  // Each tile is the member's frame with the effect drawn on it.
  const drawn = { keyword_pill: 'data-extra="pill"', accent_words: 'data-extra="accent"' }
  for (const extra of m.LOOK_EXTRAS) assert.ok(extras.includes(drawn[extra.id] ?? `data-testid="look-extra-${extra.id}"`), extra.id)
  // How to start: build my own (the rows) by default.
  assert.match(group(html, 'How to start'), /aria-checked="true"[^>]*>.*?Build my own/s)
  assert.match(html, /aria-label="Caption style"/)
  assert.doesNotMatch(html, /aria-label="Ready-made look"/)
  // Pages without the row don't show it.
  assert.doesNotMatch(staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: ALL_ROWS, brand: BRAND })), /role="checkbox"/)
})

test('"Start from a ready-made look" shows the curated looks as tiles of the member\'s frame (remembered per viewer)', () => {
  const stored = new Map([['creatorclips.styleBoard.start', 'ready']])
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  try {
    const html = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: { ...ALL_ROWS, extras: true }, brand: BRAND, frame: m.previewFrame('https://youtu.be/abcdefghijk') }))
    const looks = group(html, 'Ready-made look')
    assert.equal((looks.match(/role="radio"/g) ?? []).length, m.CURATED_COMBOS.length)
    assert.match(looks, /aria-checked="true" aria-label="Classic"/)
    assert.match(looks, /src="https:\/\/i\.ytimg\.com\/vi\/abcdefghijk\/hqdefault\.jpg"/, 'the member\'s own frame')
    assert.doesNotMatch(html, /aria-label="Caption style"/, 'the rows wait behind Build my own')
    assert.match(html, />Change anything</)
    assert.match(html, /aria-label="Extras: pick as many as you like"/, 'extras stay')
  } finally { delete globalThis.localStorage }
})

test('option tiles: the member\'s frame (or a stand-in) with the option on it, captions in their preset and fonts on the hook', () => {
  const html = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: ALL_ROWS, brand: BRAND, frame: { kind: 'image', src: 'https://i.ytimg.com/vi/x/hqdefault.jpg' } }))
  const captions = group(html, 'Caption style')
  assert.equal((captions.match(/data-look-tile/g) ?? []).length, 10)
  assert.match(captions, /data-caption-preset="impact"/)
  const fonts = group(html, 'Hook text font')
  for (const font of m.HEADLINE_FONTS) assert.match(fonts, new RegExp(`aria-label="${font.label.replace('+', '\\+')}"`), font.id)
  assert.match(fonts, /Caveat Brush/, 'Marker draws in its font')
  assert.match(fonts, /data-hook-accent/, 'one word in the italic serif')
  assert.match(group(html, 'Hook text look'), /data-look-tile/)
  // No frame: the neutral stand-in, never a broken image.
  const plain = staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows: ALL_ROWS, brand: BRAND }))
  assert.doesNotMatch(group(plain, 'Caption style'), /<img/)
})

test('new hook fonts: Marker and Sans + italic serif, valid end to end; the accent word matches the engine', () => {
  assert.deepEqual(m.HEADLINE_FONTS.map((font) => font.id), ['clean', 'serif', 'condensed', 'marker', 'sans_serif_accent'])
  assert.equal(m.parseHeadlineLook({ look: 'black', color: '#FFFFFF', font: 'marker' }).font, 'marker')
  assert.equal(m.parseHeadlineLook({ look: 'white', color: '#FFFFFF', font: 'sans_serif_accent' }).font, 'sans_serif_accent')
  assert.throws(() => m.parseHeadlineLook({ font: 'comic' }))
  // Same cases as engine/tests/test_headline_look.py.
  assert.equal(m.accentWordIndex('Make your videos look different.'.split(' ')), 4)
  assert.equal(m.accentWordIndex('Two: onetake'.split(' ')), 1)
  assert.equal(m.accentWordIndex('This is it'.split(' ')), 0)
  assert.equal(m.accentWordIndex('a b'.split(' ')), 1)
  assert.equal(m.fontName('marker'), 'Marker')
})

test('the live preview draws the chosen extras', () => {
  const render = (extras, rows = { ...ALL_ROWS, extras: true }) => staticRender(React.createElement(m.StylePreview, { value: { ...BASE, extras }, rows, frame: null, brand: null, label: 'Preview' }))
  const all = render(['punch_zoom', 'keyword_pill', 'accent_words', 'progress_bar', 'broll_tags', 'proof_underline'])
  assert.match(all, /data-extras="punch_zoom keyword_pill accent_words progress_bar broll_tags proof_underline"/)
  assert.match(all, /data-extra="pill"[^>]*>captions</, 'the punch word in the pill')
  assert.match(all, /data-extra="accent"[^>]*>come</, 'the next word in the italic serif')
  for (const id of ['progress_bar', 'broll_tags', 'proof_underline']) assert.match(all, new RegExp(`data-testid="look-extra-${id}"`), id)
  assert.match(all, /scale\(1\.35\)|data-extras/)
  // The comment box waits for the end of the loop (not shown on the paused first frame).
  assert.doesNotMatch(render(['comment_box']), /look-extra-comment_box/)
  // A page without the Extras row draws none.
  assert.doesNotMatch(render(['progress_bar'], ALL_ROWS), /look-extra-progress_bar/)
  // The comment box itself types the keyword.
  const box = staticRender(React.createElement('div', null, React.createElement(m.LookFrame, { value: { ...BASE, extras: ['comment_box'] }, rows: {}, background: null, width: 200,
    time: 4800, loop: 4900, ending: true, extras: ['comment_box'], keyword: 'GUIDE' })))
  assert.match(box, /data-testid="look-extra-comment_box"/)
  assert.match(box, />GUI/)
})

// ---------------------------------------------------------------------------
// Floating text's background: a snug rounded box behind each line.
// ---------------------------------------------------------------------------

test('text background: parsed, validated, left out when none, and only sent to the engine with floating text', () => {
  assert.deepEqual(m.parseHeadlineLook({ look: 'floating', color: '#e11d48', font: 'clean', textBg: 'brand' }), { look: 'floating', color: '#E11D48', font: 'clean', textBg: 'brand' })
  assert.deepEqual(m.parseHeadlineLook({ look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'none' }), { look: 'floating', color: '#FFFFFF', font: 'clean' })
  assert.throws(() => m.parseHeadlineLook({ look: 'floating', textBg: 'neon' }))
  assert.throws(() => m.parseHeadlineLook({ look: 'floating', textBg: 1 }))
  const look = m.parseHeadlineLook({ look: 'floating', color: '#FFFFFF', font: 'serif', textBg: 'dark' })
  assert.deepEqual(m.parseHeadlineLook(JSON.parse(JSON.stringify(look))), look, 'round-trips')
  assert.deepEqual(m.headlineLookForEngine(look), look)
  assert.deepEqual(m.headlineLookForEngine({ look: 'black', color: '#FFFFFF', font: 'clean', textBg: 'dark' }), { look: 'black', color: '#FFFFFF', font: 'clean' })
  assert.equal(m.headlineLookForEngine({ look: 'white', color: '#FFFFFF', font: 'clean', textBg: 'dark' }), undefined)
  // Text color: white on the dark box, black on the light one, by contrast on the brand box; outlined white without one.
  assert.equal(m.headlineTextColor({ look: 'floating', color: '#FFFFFF', font: 'clean' }), '#FFFFFF')
  assert.equal(m.headlineTextColor({ look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'dark' }), '#FFFFFF')
  assert.equal(m.headlineTextColor({ look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'light' }), '#000000')
  assert.equal(m.headlineTextColor({ look: 'floating', color: '#FFE600', font: 'clean', textBg: 'brand' }), '#000000')
  assert.equal(m.headlineTextColor({ look: 'floating', color: '#1D3BB3', font: 'clean', textBg: 'brand' }), '#FFFFFF')
  assert.deepEqual(m.headlineTextBox({ look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'dark' }), { color: '#000000', opacity: 0.9 })
  assert.equal(m.headlineTextBox({ look: 'black', color: '#FFFFFF', font: 'clean', textBg: 'dark' }), null, 'bars ignore it')
})

test('text background on the board: Create, Remix and Edit my recording fields, Shuffle and the summary', () => {
  const draft = { ...m.useDraftStore.getState(), workflow: 'automatic', source: 'https://example.com/v', aspectRatio: '9:16', includeTitle: true, titleStyle: 'headline' }
  const chosen = { ...draft, ...m.createBoardPatch(draft, { hook: 'floating', textBg: 'dark' }) }
  assert.deepEqual(chosen.headlineLook, { look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'dark' })
  assert.equal(m.createBoardStyle(chosen).textBg, 'dark')
  assert.deepEqual(m.buildJobRequest(chosen, { start: null, end: null }).headlineLook, { look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'dark' })
  assert.deepEqual(m.createBoardPatch(chosen, { textBg: 'none' }).headlineLook, { look: 'floating', color: '#FFFFFF', font: 'clean' })
  const form = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'floating', color: '#FFFFFF', font: 'clean' }, showHandle: false }
  assert.deepEqual(m.lookPatch(form, { textBg: 'light' }), { headlineLook: { look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'light' } })
  assert.equal(m.boardFromLook({ ...form, headlineLook: { ...form.headlineLook, textBg: 'light' } }).textBg, 'light')
  // The brand box starts from the brand color while the color is still white.
  assert.deepEqual(m.textBgPatch(BASE, 'brand', '#FF8800'), { textBg: 'brand', color: '#FF8800' })
  assert.deepEqual(m.textBgPatch({ ...BASE, color: '#123456' }, 'brand'), { textBg: 'brand' })
  assert.deepEqual(m.textBgPatch(BASE, 'dark'), { textBg: 'dark' })
  // The ready-made "Reel caption" look: floating text on a dark box.
  const reel = m.CURATED_COMBOS.find((combo) => combo.id === 'reel-caption')
  const value = { ...BASE, ...m.comboPatch(reel, m.LOOK_HOOKS) }
  assert.equal(value.textBg, 'dark')
  assert.equal(m.matchingCombo(value), reel)
  assert.notEqual(m.matchingCombo({ ...value, textBg: 'none' }), reel)
  assert.equal(m.styleSummary(value, { hooks: m.LOOK_HOOKS }), 'Subtle captions · Floating text · Clean font · Dark box')
  assert.equal(m.styleSummary({ ...value, textBg: 'brand', color: '#7C5CFF' }, { hooks: m.LOOK_HOOKS }), 'Subtle captions · Floating text · Clean font · Violet #7C5CFF box')
})

test('box outline: the same corners as the engine (text_box_outline), and the preview places snug per-line boxes', () => {
  const outline = m.textBoxOutline([[100, 0, 900, 70], [300, 70, 700, 140]], 15)
  assert.deepEqual(outline.map(([x, y]) => [x, y]), [[100, 0], [900, 0], [900, 70], [700, 70], [700, 140], [300, 140], [300, 70], [100, 70]])
  assert.deepEqual(m.textBoxOutline([[100, 0, 900, 70], [105, 70, 895, 140]], 15, 15).map(([x, y]) => [x, y]), [[100, 0], [900, 0], [900, 140], [100, 140]])
  assert.equal(Math.min(...m.textBoxOutline([[100, 0, 900, 70], [120, 70, 880, 140]], 15).map(([, , r]) => r)), 10)
  assert.match(m.textBoxPath(outline), /^M[\d. ]+Q[\d. ]+(L[\d. ]+Q[\d. ]+){7}Z$/)
  // The engine's wrap: the biggest size that fits, balanced lines.
  const measure = (line, size) => line.length * size * 0.5
  const wrapped = m.wrapHeadline('I quit my job and this happened to my business in under ninety days', measure, 1080 - 2 * 65)
  assert.equal(wrapped.size, 60)
  assert.ok(wrapped.lines.length >= 2 && wrapped.lines.length <= 3)
  const layout = m.boxedHookLayout('I quit my job and this happened to my business', 'clean', 1080, 1920, 1, (line, _css, size) => line.length * size * 0.5)
  assert.ok(layout.lines.length > 1)
  assert.equal(new Set(layout.lines.map((line) => line.width)).size, layout.lines.length, 'each box follows its own line')
  assert.equal(layout.lines[1].center - layout.lines[0].center, layout.lineH, 'boxes touch')
  assert.match(layout.path, /^M.*Z$/)
})

test('Text background row: shown with floating text, a tile per option on the member\'s frame; the preview draws the boxes', () => {
  const rows = { hooks: m.LOOK_HOOKS }
  const frame = { kind: 'image', src: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }
  assert.doesNotMatch(staticRender(React.createElement(m.StyleBoard, { value: BASE, onChange() {}, rows, brand: null, frame })), /aria-label="Text background"/)
  const html = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, hook: 'floating', textBg: 'dark' }, onChange() {}, rows, brand: null, frame }))
  const row = group(html, 'Text background')
  assert.ok(row, 'the row is there')
  assert.equal((row.match(/role="radio"/g) ?? []).length, 4)
  for (const bg of m.HEADLINE_TEXT_BGS) assert.match(row, new RegExp(`aria-label="${bg.label}"`), bg.id)
  assert.match(row, /aria-checked="true" aria-label="Dark box"/)
  assert.equal((row.match(/data-look-tile/g) ?? []).length, 4)
  assert.match(row, /hqdefault\.jpg/, 'on the member\'s frame')
  // The live preview: one outline behind the lines, in the box color.
  assert.match(html, /data-testid="hook-text-box" data-text-bg="dark"[^]*?<path d="M[^"]+Z" fill="#000000" fill-opacity="0.9"/)
  // The brand box adds the Color row (the box's color, not the bar's).
  const brand = staticRender(React.createElement(m.StyleBoard, { value: { ...BASE, hook: 'floating', textBg: 'brand', color: '#7C5CFF' }, onChange() {}, rows, brand: null }))
  assert.ok(group(brand, 'Box color'))
  assert.match(brand, /fill="#7C5CFF" fill-opacity="1"/)
})

test('clip editor hook look picker: a Text background row with floating text (compact)', () => {
  const render = (value) => staticRender(React.createElement(m.HeadlineLookPicker, { value, onChange() {}, compact: true }))
  assert.doesNotMatch(render({ look: 'white', color: '#FFFFFF', font: 'clean' }), /Text background/)
  const html = render({ look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'light' })
  assert.match(html, /Text background/)
  for (const bg of m.HEADLINE_TEXT_BGS) assert.match(html, new RegExp(`aria-label="${bg.label}"`))
  assert.match(html, /aria-checked="true" aria-label="Light box"/)
  assert.match(html, /data-text-bg="light"/)
  assert.match(render({ look: 'floating', color: '#7C5CFF', font: 'clean', textBg: 'brand' }), /aria-label="Box color"/)
})
