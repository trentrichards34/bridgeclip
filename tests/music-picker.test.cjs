// The Music picker (Create, Edit my recording and Remix open it from their Music row) and Settings → My music.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { MusicPicker, MusicSettingsPanel, MUSIC_VOLUMES, musicVolumeOf } from './src/renderer/components/MusicPicker';
      export { MUSIC_TRACKS } from './src/shared/music';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  jsx: 'automatic', write: false
}).outputFiles[0].text

globalThis.window = { bridgeclip: { music: { list: () => new Promise(() => {}) } } }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const m = mod.exports

const LIBRARY = {
  tracks: m.MUSIC_TRACKS,
  own: [{ id: 'my:Intro theme.mp3', name: 'Intro theme', sizeBytes: 2_400_000 }],
  settings: { levelDb: -22, duringTheirClip: false }
}

const radios = (html) => [...html.matchAll(/role="radio" aria-checked="(true|false)"[^>]*>(.*?)<\/button>/g)].map((match) => ({ checked: match[1] === 'true', text: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))

test('the picker: None, the four built-in tracks and my own, each with a play button, and "My own music…"', () => {
  const html = renderToStaticMarkup(React.createElement(m.MusicPicker, { value: 'lofi-beat', onChange: () => {}, initialLibrary: LIBRARY }))
  assert.match(html, /role="radiogroup" aria-label="Background music"/)
  const options = radios(html)
  assert.deepEqual(options.map((o) => o.text.split(' ')[0]), ['None', 'Calm', 'Upbeat', 'Lo-fi', 'Cinematic', 'Intro'])
  assert.deepEqual(options.filter((o) => o.checked).map((o) => o.text), ['Lo-fi beat Mellow, laid-back groove.'])
  assert.match(options[5].text, /Intro theme My music/)
  for (const name of ['Calm pad', 'Upbeat pulse', 'Lo-fi beat', 'Cinematic swell', 'Intro theme']) assert.match(html, new RegExp(`aria-label="Play ${name}"`))
  assert.doesNotMatch(html, /aria-label="Play None"/)
  assert.match(html, /My own music…/)
  assert.match(html, /Only add music you own or have the rights to use/)
  assert.match(html, /drops while someone talks/)
  // Two columns, nothing wider than its column: fits a 300 px panel.
  assert.match(html, /grid grid-cols-2/)
  assert.doesNotMatch(html, /w-\[(?:[3-9]\d\d|\d{4,})px\]|min-w-\[/)
})

test('nothing picked: None is selected and the note says the built-in tracks are free to use', () => {
  const html = renderToStaticMarkup(React.createElement(m.MusicPicker, { value: null, onChange: () => {}, initialLibrary: LIBRARY }))
  assert.deepEqual(radios(html).filter((o) => o.checked).map((o) => o.text), ['None'])
  assert.match(html, /made for CreatorClips and free to use in any video/)
})

test('Settings → My music: my tracks to play or remove, the music volume and Remix’s choice', () => {
  const html = renderToStaticMarkup(React.createElement(m.MusicSettingsPanel, { initialLibrary: LIBRARY }))
  assert.match(html, /aria-label="Play Intro theme"/)
  assert.match(html, /aria-label="Remove Intro theme from my music"/)
  assert.match(html, /2\.3 MB/)
  assert.match(html, /Add music/)
  // Volume in words, no dB: -22 (saved earlier) shows as the nearest, Medium.
  assert.match(html, /role="radiogroup" aria-label="Music volume"/)
  assert.match(html, /role="radio" aria-checked="true"[^>]*>Medium</)
  assert.doesNotMatch(html, /dB/)
  assert.deepEqual(['quiet', 'medium', 'loud'].map((id) => m.MUSIC_VOLUMES.find((v) => v.id === id).levelDb), [-26, -20, -14])
  assert.deepEqual([-30, -24, -20, -16, -10].map(m.musicVolumeOf), ['quiet', 'quiet', 'medium', 'loud', 'loud'])
  assert.match(html, /role="switch" aria-checked="false" aria-label="Music under their clip in Remix"/)
  const empty = renderToStaticMarkup(React.createElement(m.MusicSettingsPanel, { initialLibrary: { ...LIBRARY, own: [] } }))
  assert.match(empty, /No music of your own yet/)
})
