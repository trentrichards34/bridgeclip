// Edit my recording: the page's first screen, the review screen's transcript, and the look taken from a brand.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { EditRecordingPage, lookFromBrand } from './src/renderer/pages/EditRecordingPage';
      export { EditReview, transcriptLines } from './src/renderer/components/EditReview';
      export { parseEditPlan } from './src/shared/edit-recording';
      export { useSettingsStore } from './src/renderer/store/use-settings-store';
      export { useEditRecordingStore } from './src/renderer/store/use-edit-recording-store';
      export { isCreateOutput } from './src/renderer/components/ClipList';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  define: { __APP_VERSION__: JSON.stringify(require('../package.json').version) },
  jsx: 'automatic', write: false
}).outputFiles[0].text

const pending = () => new Promise(() => {})
globalThis.window = { bridgeclip: { edit: { status: pending, onStatus: () => () => {} }, brandIdentities: { list: pending }, settings: { load: pending } } }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const { EditRecordingPage, EditReview, lookFromBrand, transcriptLines, parseEditPlan, useSettingsStore, useEditRecordingStore, isCreateOutput } = mod.exports

function staticRender(element) {
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(element) } finally { React.useSyncExternalStore = original }
}

test('the first screen: choose or film a recording, a brand, the cost line, and What should I film?', () => {
  useSettingsStore.setState({ openrouterConfigured: false })
  const html = staticRender(React.createElement(EditRecordingPage, { onNavigate: () => {} }))
  assert.match(html, /Edit my recording/)
  assert.match(html, /Add your OpenRouter key to start/)
  assert.match(html, /Choose recordings/)
  assert.match(html, /data-testid="edit-sources-drop"/)
  assert.match(html, /You can also drop recordings here\./)
  assert.match(html, /Film it here/)
  assert.match(html, /What should I film\?/)
  assert.match(html, /reviewing and making the reel are free/)
  // Nothing chosen: the start button is off.
  assert.match(html, /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Edit my recording<\/button>/s)
})

const PLAN = parseEditPlan({
  words: [['Hi', 0, 200, 0, 'off_topic'], ['Most', 300, 500, 0, null], ['coaches', 520, 800, 0, null], ['um', 820, 900, 0, 'filler'], ['undercharge.', 920, 1400, 0, null],
    ['Here', 3000, 3200, 1, null], ['is', 3220, 3300, 1, null], ['why.', 3320, 3700, 1, null]],
  hooks: [{ id: 0, start: 5, end: 7, text: 'Here is why', why: 'A promise' }, { id: 1, start: 1, end: 4, text: 'Most coaches undercharge', why: '' }], hook: 0,
  cta: null, popups: [{ id: 0, word: 2, text: 'coaches', kind: 'keyword' }], sounds: [{ id: 0, at: 'title', sound: 'whoosh' }], planned: 'ai', notes: ['Cut 1 filler word.'], warnings: []
}, 2)

test('the review: cut words are struck through and can be kept, the hook opens it, pop-ups and sounds can be switched off', () => {
  assert.ok(PLAN)
  const status = {
    id: 'r1', phase: 'review', detail: '', percent: 100, folder: '/out/edit-1', plan: PLAN, transcriber: 'scribe', output: null, costUsd: 0.01, estimateUsd: 0.02, error: null, warnings: [],
    sources: [{ path: '/a/take-1.mp4', name: 'take-1.mp4', seconds: 2 }, { path: '/a/take-2.mp4', name: 'take-2.mp4', seconds: 4 }]
  }
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, showHandle: false }
  const html = staticRender(React.createElement(EditReview, { status, brand: null, look, onLook: () => {}, onError: () => {} }))
  assert.match(html, /Review your edit/)
  assert.match(html, /2 words cut · from 2 takes/)
  assert.match(html, /Transcribed with ElevenLabs Scribe v2\./)
  assert.match(html, /data-testid="edit-hook">“Here is why\.”/)
  assert.match(html, /Use a different hook/)
  assert.match(html, /value="Here is why"/)
  // "um" is cut (struck through, not pressed) and says why; "Most" is kept.
  assert.match(html, /data-word="3" aria-pressed="false" title="Filler word\. Click to keep it\."[^>]*line-through/)
  assert.match(html, /data-word="1" aria-pressed="true"/)
  assert.match(html, /Take 2 · take-2\.mp4/)
  assert.match(html, /Pops up when you say “coaches”/)
  assert.match(html, /Soft whoosh as the hook text appears/)
  assert.match(html, /Make my reel/)
})

test('transcript lines split at sentence ends and take changes; a brand’s look starts the review', () => {
  assert.deepEqual(transcriptLines(PLAN).map((line) => line.words), [[0, 1, 2, 3, 4], [5, 6, 7]])
  const look = lookFromBrand({ id: 'b', name: 'B', text: '', createdAt: '', updatedAt: '', look: { color: '#FF8800', captionPreset: 'impact', handle: '@sam' } })
  assert.deepEqual(look, { includeCaptions: true, captionPreset: 'impact', headlineLook: { look: 'white', color: '#FF8800', font: 'clean' }, showHandle: true })
  assert.equal(lookFromBrand(null).captionPreset, 'pop')
})

test('leaving the page keeps the brand, look and the review’s choices (by run), so coming back restores them', () => {
  const fs = require('node:fs')
  const page = fs.readFileSync(path.join(__dirname, '../src/renderer/pages/EditRecordingPage.tsx'), 'utf8')
  assert.doesNotMatch(page, /useState<EditLook>/, 'the look is not page state')
  assert.doesNotMatch(page, /\[brandId, setBrandId\] = useState/, 'the brand is not page state')
  const look = { includeCaptions: false, captionPreset: 'impact', headlineLook: { look: 'black', color: '#FF8800', font: 'serif' }, showHandle: false }
  useEditRecordingStore.getState().setBrand('b'.repeat(16), look)
  assert.equal(useEditRecordingStore.getState().brandId, 'b'.repeat(16))
  assert.deepEqual(useEditRecordingStore.getState().look, look)

  const status = {
    id: 'run-a', phase: 'review', detail: '', percent: 100, folder: '/out/edit-1', plan: PLAN, transcriber: 'scribe', output: null, costUsd: 0, estimateUsd: 0, error: null, warnings: [],
    sources: [{ path: '/a/take-1.mp4', name: 'take-1.mp4', seconds: 2 }, { path: '/a/take-2.mp4', name: 'take-2.mp4', seconds: 4 }]
  }
  const render = (id) => staticRender(React.createElement(EditReview, { status: { ...status, id }, brand: null, look, onLook: () => {}, onError: () => {} }))
  assert.match(render('run-a'), /2 words cut/)
  // The member kept every word and switched the pop-up off, then left the page.
  assert.equal(useEditRecordingStore.getState().reviewFor('run-a'), null)
  useEditRecordingStore.getState().saveReview('run-a', { cut: [], hookId: 0, hookText: 'Here is why', endOnCta: false, popups: [{ id: 0, on: false, text: 'coaches' }], sounds: [{ id: 0, on: true }], look })
  const back = render('run-a')
  assert.match(back, /0 words cut/)
  // Another run starts fresh.
  assert.match(render('run-b'), /2 words cut/)
})

test('an Edit my recording reel is not a Create run, so the Library offers no Edit clips button for it', () => {
  assert.equal(isCreateOutput({ clips: [], metrics: { edit_recording: true } }), false)
  assert.equal(isCreateOutput({ clips: [], metrics: { remix: true } }), false)
  assert.equal(isCreateOutput({ clips: [], metrics: {} }), true)
})

test('the review: an edit style, half-screen cards to edit or switch off, my images to pin, and two openings (off by default)', () => {
  useEditRecordingStore.setState({ review: null, recipe: 'fast' })
  const plan = parseEditPlan({
    words: [['Here', 0, 200, 0, null], ['are', 220, 400, 0, null], ['three', 420, 700, 0, null], ['steps.', 720, 1100, 0, null], ['Write', 1500, 1800, 0, null], ['hooks.', 1820, 2200, 0, null]],
    hooks: [], hook: null, cta: null, sounds: [], planned: 'ai', notes: [], warnings: [],
    popups: [{ id: 0, word: 2, text: 'three', kind: 'keyword' }, { id: 1, word: 4, kind: 'card', seconds: 3, card: { type: 'list', title: 'Three steps', items: ['Write hooks', 'Film once'] } }]
  }, 1)
  const status = {
    id: 'run-cards', phase: 'review', detail: '', percent: 100, folder: '/out/edit-2', plan, transcriber: 'scribe', output: null, costUsd: 0, estimateUsd: 0, error: null, warnings: [],
    sources: [{ path: '/a/take.mp4', name: 'take.mp4', seconds: 3 }], images: [{ id: 'aaaaaaaaaaaa', name: 'logo.png', path: '/out/edit-2/images/aaaaaaaaaaaa.png' }]
  }
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, showHandle: false }
  const html = staticRender(React.createElement(EditReview, { status, brand: null, look, onLook: () => {}, onError: () => {} }))
  assert.match(html, /Edit style/)
  // The last style picked is used: Fast explainer, with its extras on.
  assert.match(html, /role="radio" aria-checked="true"[^>]*>(?:(?!<\/button>).)*Fast explainer/s)
  assert.match(html, /aria-pressed="true"[^>]*>Keyword pill</)
  assert.match(html, /aria-pressed="false"[^>]*>Zoom punch</)
  assert.match(html, /Card 1 · List/)
  assert.match(html, /Fills the top half for 3 s when you say “Write”/)
  assert.match(html, /value="Three steps"/)
  assert.match(html, /My images/)
  assert.match(html, /logo\.png/)
  assert.match(html, /Pin to a word/)
  assert.match(html, /data-testid="edit-images-drop"/)
  assert.match(html, /Cut-out opening/)
  assert.match(html, /role="switch" aria-checked="false" aria-label="Raw-to-edited opening"/)
  useEditRecordingStore.setState({ recipe: 'clean' })
})
