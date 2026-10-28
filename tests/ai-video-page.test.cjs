// AI explainers: the page that explains the skill, what it needs, and saves it to the member's computer.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { AiVideoPage, SETUP_PROMPT, REEL_PROMPTS } from './src/renderer/pages/AiVideoPage';
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
globalThis.window = { bridgeclip: { aiVideoSkill: { info: pending, save: pending, reveal: pending } } }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const { AiVideoPage, SETUP_PROMPT, REEL_PROMPTS, NAV_ITEMS } = mod.exports

function staticRender(element) {
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(element) } finally { React.useSyncExternalStore = original }
}

const decode = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

test('the sidebar has AI explainers under Make, with no shortcut', () => {
  const item = NAV_ITEMS.find((entry) => entry.id === 'aivideo')
  assert.equal(item.label, 'AI explainers')
  assert.equal(item.group, 'make')
  assert.equal(item.shortcut, '')
})

test('the page: why it runs in your Claude, what you need, and the five steps', () => {
  const html = decode(staticRender(React.createElement(AiVideoPage)))
  for (const text of [
    'Animated explainer videos, made by your Claude', '1080×1920',
    'Why it runs in your Claude', 'roughly 30-80 minutes', 'Claude Max plan', 'may come later',
    'What you need', 'A paid Claude plan with Claude Code', 'An ElevenLabs account for the voice', 'about 800 characters', 'About 10 minutes, once',
    '01 · Save the skill to my computer', '02 · Open that folder in Claude Code', '03 · Say: set up the AI video skill', '04 · Ask for a reel', '05 · Post it',
    'videos/<topic>/out/', 'DM automation', "don't resell or share it"
  ]) {
    assert.ok(html.includes(text), text)
  }
  // Prompts to copy, and no prices anywhere.
  assert.equal(SETUP_PROMPT, 'set up the AI video skill')
  assert.ok(REEL_PROMPTS.length >= 3 && REEL_PROMPTS.length <= 4)
  for (const { prompt } of REEL_PROMPTS) assert.ok(html.includes(prompt), prompt)
  assert.ok((html.match(/>Copy</g) ?? []).length >= 1 + REEL_PROMPTS.length)
  assert.doesNotMatch(html, /\$\d/)
  // Nothing saved yet: the save button, no path and no Show in Finder.
  assert.match(html, /data-testid="ai-video-save"/)
  assert.ok(html.includes('Save the skill to my computer'))
  assert.ok(!html.includes('Show in Finder'))
  assert.ok(!html.includes('Saved to'))
})
