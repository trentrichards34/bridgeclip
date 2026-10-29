// B-roll video: the form (words, b-roll, look), the request it sends, and the result with its shots.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { BrollVideoPage } from './src/renderer/pages/BrollVideoPage';
      export { useBrollVideoDraft, useBrollVideoStatus, brollVideoRequest } from './src/renderer/store/use-broll-video-store';
      export { useBrollLibrary } from './src/renderer/store/use-broll-library-store';
      export { useSettingsStore } from './src/renderer/store/use-settings-store';
      export { parseBrollVideoRequest } from './src/shared/broll-video';
      export { NAV_ITEMS } from './src/renderer/components/Sidebar';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  define: { __APP_VERSION__: JSON.stringify(require('../package.json').version) },
  jsx: 'automatic', write: false
}).outputFiles[0].text

const pending = () => new Promise(() => {})
globalThis.window = { bridgeclip: { brollVideo: { status: pending, onStatus: () => () => {}, estimate: pending }, brollLibrary: { view: pending, onChanged: () => () => {}, onProgress: () => () => {} },
  settings: { load: pending }, music: { list: pending }, ctas: { list: pending } } }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const { BrollVideoPage, useBrollVideoDraft, useBrollVideoStatus, brollVideoRequest, useBrollLibrary, useSettingsStore, parseBrollVideoRequest, NAV_ITEMS } = mod.exports

function staticRender(element) {
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(element) } finally { React.useSyncExternalStore = original }
}

const VIEW = {
  items: [{ id: 'l000000000001', kind: 'video', name: 'desk.mp4', original: '/f/desk.mp4', proxy: null, poster: null, durationS: 8, width: 1, height: 1, size: 1, mtimeMs: 1, addedAt: '2026-10-20T10:00:00Z',
    origin: 'member', tags: ['work'], me: false, status: 'ready', missing: false, proxyPath: null, posterPath: null, originalPath: '/f/desk.mp4',
    shots: [{ id: 's0', inS: 0, outS: 8, analysis: { description: 'Hands typing on a laptop', tags: ['laptop', 'typing'], subjects: [], setting: '', shotType: 'hands', motion: 'slow', mood: '', memberAppears: false, onScreenText: '', quality: '', model: 'm', analyzedAt: '2026-10-20T10:00:00Z' } }] }],
  pendingShots: 0, usableShots: 3, preparing: 0, indexing: null, ai: { kind: 'video', model: 'x-ai/grok-imagine-video-1.5-lite', maxShots: 2 }
}

test('the sidebar has B-roll video under Make, with no shortcut', () => {
  const item = NAV_ITEMS.find((entry) => entry.id === 'brollvideo')
  assert.equal(item.label, 'B-roll video')
  assert.equal(item.group, 'make')
  assert.equal(item.shortcut, '')
})

test('the form: your words, your b-roll and the look; nothing chosen keeps the start button off', () => {
  useSettingsStore.setState({ openrouterConfigured: true })
  useBrollLibrary.setState({ view: VIEW })
  useBrollVideoStatus.setState({ status: null })
  const html = staticRender(React.createElement(BrollVideoPage, { onNavigate: () => {}, onViewLibrary: () => {} }))
  for (const text of ['Your words, covered in b-roll', '01 · Your words', 'My voiceover', 'A script (AI voice)', 'Script + my recording', 'Choose a file', 'Record',
    '02 · Your b-roll', '3 shots ready in your B-roll library.', 'My whole library', 'Only some clips', 'Fill gaps with AI shots', 'Off: every moment uses your own b-roll.',
    '03 · The look', 'Hook text', 'Captions', 'Motion graphics', 'Quick crossfades', 'Voice cleanup', 'Music', 'Call to action', 'Choose or record your voiceover first.']) {
    assert.ok(html.includes(text), text)
  }
  assert.match(html, /<button[^>]*data-testid="broll-video-start"[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-testid="broll-video-start"/)
})

test('a script with a voice; picking clips and tags; AI gaps show their estimate line', () => {
  useBrollVideoDraft.setState({ voiceKind: 'script', script: 'Here is my morning plan in three steps.', all: false, fillWithAi: true })
  const html = staticRender(React.createElement(BrollVideoPage, { onNavigate: () => {}, onViewLibrary: () => {} }))
  assert.ok(html.includes('Voice'))
  assert.ok(html.includes('Pick clips or tags to use.'))
  assert.ok(html.includes('desk.mp4'))
  assert.ok(html.includes('laptop'))
  assert.match(html, /Moments nothing in your library fits get a new AI shot/)
  assert.ok(!html.includes('Choose a file'))
})

test('the request the page sends is the one main accepts', () => {
  const draft = { ...useBrollVideoDraft.getState(), voiceKind: 'both', voiceover: { path: '/v/take.mov', name: 'take.mov', seconds: 30 }, script: 'one two three four',
    all: false, itemIds: ['l000000000001'], tags: ['laptop'], musicTrack: 'calm-pad', voiceCleanup: true, ctaId: null }
  const request = brollVideoRequest(draft)
  const parsed = parseBrollVideoRequest(request)
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.voice)), { kind: 'both', path: '/v/take.mov', script: 'one two three four' })
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.broll)), { all: false, itemIds: ['l000000000001'], tags: ['laptop'] })
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.audio)), { voiceCleanup: true, music: true, musicTrack: 'calm-pad' })
  assert.equal(parsed.fillWithAi, true)
})

test('the result: the video, open in the editor, and each shot with what is said over it and Swap', () => {
  useBrollVideoStatus.setState({ status: { id: 'x', phase: 'done', detail: 'Ready', percent: 100, outputDir: '/lib/broll-video-1', outputPath: '/lib/broll-video-1/clip_00.mp4', error: null,
    warnings: [], costUsd: 0.0123, estimateUsd: 0.02, startedAt: '2026-10-21T10:00:00Z',
    shots: [{ slot: 0, startMs: 0, endMs: 2400, shotId: 'l000000000001:s0', ai: false, reused: false, words: 'My morning starts' },
      { slot: 1, startMs: 2400, endMs: 5000, shotId: null, ai: true, reused: false, words: 'with a rocket' }] } })
  const html = staticRender(React.createElement(BrollVideoPage, { onNavigate: () => {}, onViewLibrary: () => {} }))
  for (const text of ['Your b-roll video is ready', '2 shots over 0:05 · $0.012 spent', 'Open in the editor', 'See it in the Library', 'Make another',
    '“My morning starts”', 'desk.mp4', 'AI shot', 'Swap shot 1 for the next best match']) assert.ok(html.includes(text), text)
  assert.match(html, /data-testid="broll-video-player"/)
})
