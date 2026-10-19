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
      export { useSettingsStore } from './src/renderer/store/use-settings-store';`,
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
const { EditRecordingPage, EditReview, lookFromBrand, transcriptLines, parseEditPlan, useSettingsStore } = mod.exports

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
