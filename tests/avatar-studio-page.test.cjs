// Avatar Studio page renders its three steps and gates paid actions on keys.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { AvatarStudioPage } from './src/renderer/pages/AvatarStudioPage';
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
globalThis.window = { bridgeclip: { avatars: { list: pending, renderStatus: pending, onStatus: () => () => {} }, backgrounds: { list: pending }, settings: { load: pending } } }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const { AvatarStudioPage, useSettingsStore } = mod.exports

function render(state) {
  useSettingsStore.setState(state)
  // Static rendering reads zustand's server snapshot; use the live state under test.
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(React.createElement(AvatarStudioPage, { onNavigate: () => {} })) }
  finally { React.useSyncExternalStore = original }
}

test('without an OpenRouter key the page explains what to add and disables generation', () => {
  const html = render({ falConfigured: true, openrouterConfigured: false })
  assert.match(html, /Avatar Studio/)
  assert.match(html, /Add your OpenRouter key to start/)
  for (const step of ['1 · Script', '2 · Look', '3 · Generate']) assert.ok(html.includes(step), step)
  assert.match(html, /<button[^>]*disabled=""[^>]*>.*?Generate video/s)
})

test('an OpenRouter key alone is enough; fal.ai is only for Recreate', () => {
  const html = render({ falConfigured: false, openrouterConfigured: true })
  assert.doesNotMatch(html, /Add your (OpenRouter|fal\.ai) key to start/)
  assert.match(html, /No avatars yet/)
})
