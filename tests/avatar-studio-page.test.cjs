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
      export { useAvatarList } from './src/renderer/pages/AvatarStudioPage';
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
const { AvatarStudioPage, useAvatarList, useSettingsStore } = mod.exports

const MAYA = { id: 'abcdef1234567890', name: 'Maya', kind: 'ai', description: '', portraitPath: '/tmp/maya.jpg', pictures: [], reactions: [], voice: { provider: 'elevenlabs', voice: 'Brian' }, clonedVoice: null, consentAt: null, createdAt: '2026-10-01T00:00:00.000Z' }

function render(state, avatars = null) {
  useSettingsStore.setState(state)
  useAvatarList.setState({ avatars })
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
  for (const step of ['>Video style<', '>Script<', '>Look<', 'Customize for this video']) assert.ok(html.includes(step), step)
  assert.match(html, /<button[^>]*disabled=""[^>]*>.*?Generate video/s)
})

test('an OpenRouter key alone is enough; fal.ai is only for Recreate', () => {
  const html = render({ falConfigured: false, openrouterConfigured: true }, [])
  assert.doesNotMatch(html, /Add your (OpenRouter|fal\.ai) key to start/)
  assert.match(html, /No avatars yet/)
})

test('with no avatar yet, the page leads to making one before the script steps', () => {
  const html = render({ falConfigured: false, openrouterConfigured: true }, [])
  assert.match(html, /<button[^>]*>(?:(?!<\/button>).)*From a photo(?:(?!<\/button>).)*<\/button>/s)
  assert.match(html, /<button[^>]*>(?:(?!<\/button>).)*Describe a person(?:(?!<\/button>).)*<\/button>/s)
  assert.match(html, /Make an avatar first/)
  assert.doesNotMatch(html, /Hook, promise, payoff|Generate video/)
  assert.doesNotMatch(html, /faceless channels/)
})

test('with an avatar, the look is the shared Style board, and lip-sync points to HeyGen', () => {
  const html = render({ falConfigured: false, openrouterConfigured: true, heygenConfigured: false }, [MAYA])
  for (const step of ['>Video style<', '>Script<', '>Look<', 'Customize for this video']) assert.ok(html.includes(step), step)
  // The look is summed up on its card; "Customize for this video" opens the shared Style board.
  assert.match(html, /aria-expanded="false" aria-controls="avatar-look"/)
  assert.match(html, /Pop captions · White bar/)
  assert.doesNotMatch(html, /Lip-sync is coming/)
  assert.match(html, /make a HeyGen avatar \(Beta\)/)
  assert.match(html, /Add HeyGen key/)
})
