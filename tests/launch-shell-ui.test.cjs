// Launch shell in the renderer: the crash screen, Report an issue's privacy note, Your data,
// "How it works" on Make pages and the guides it opens.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: `export { ErrorBoundary, CrashScreen, crashDetails } from './src/renderer/components/ErrorBoundary';
      export { supportTargetCopy } from './src/renderer/components/SupportReport';
      export { YourData, dataDestinations } from './src/renderer/components/YourData';
      export { PageHeader } from './src/renderer/components/ui/PageHeader';
      export { PageToolContext } from './src/renderer/components/ui/page-tool';
      export { PAGE_GUIDES, requestGuide, peekGuide, takeGuide } from './src/renderer/lib/guide-focus';
      export { useSettingsStore } from './src/renderer/store/use-settings-store';
      export { GUIDES, TOOL_GUIDES } from './src/shared/onboarding';
      export { NAV_ITEMS } from './src/renderer/components/Sidebar';`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  define: { __APP_VERSION__: JSON.stringify('1.0.0') },
  jsx: 'automatic', write: false
}).outputFiles[0].text

const pending = () => new Promise(() => {})
const calls = []
globalThis.window = { bridgeclip: {
  diagnostics: { rendererError: (name) => { calls.push(['rendererError', name]); return Promise.resolve() }, dataPaths: pending, openUserData: pending, openLogFolder: pending },
  support: { prepare: pending, copyText: pending, save: pending, open: pending, report: pending },
  shell: { openPath: pending }
} }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const { ErrorBoundary, CrashScreen, crashDetails, supportTargetCopy, YourData, dataDestinations, PageHeader, PageToolContext, PAGE_GUIDES, requestGuide, peekGuide, takeGuide, useSettingsStore, GUIDES, TOOL_GUIDES, NAV_ITEMS } = mod.exports

function staticRender(element) {
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(element) } finally { React.useSyncExternalStore = original }
}
const decode = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

test('a render error shows Something went wrong with Reload, Copy details and Report an issue, and is logged by kind only', () => {
  const state = ErrorBoundary.getDerivedStateFromError(new TypeError('x is undefined'))
  assert.equal(state.error.message, 'x is undefined')
  const boundary = new ErrorBoundary({ children: null })
  boundary.state = { error: new TypeError('x is undefined'), componentStack: '\n    at ClipList\n    at LibraryPage' }
  const html = decode(staticRender(boundary.render()))
  assert.match(html, /Something went wrong/)
  for (const label of ['Reload', 'Copy details', 'Report an issue']) assert.match(html, new RegExp(label))
  // The page boundary leaves the sidebar alone and says it was this page.
  assert.match(decode(staticRender(React.createElement(CrashScreen, { details: 'x', scope: 'page' }))), /This page hit a problem/)
  // Copy details: version, error and where it happened.
  const details = crashDetails(new TypeError('x is undefined'), '\n    at ClipList\n    at LibraryPage')
  assert.match(details, /^CreatorClips 1\.0\.0\nError: TypeError: x is undefined\nWhere:\n {2}at ClipList\n {2}at LibraryPage$/)
  assert.match(crashDetails('plain'), /Error: plain/)
  // The main process hears the kind of error, never its message (it can hold personal text).
  boundary.setState = () => {}
  boundary.componentDidCatch(new TypeError('secret text'), { componentStack: '' })
  assert.deepEqual(calls.at(-1), ['rendererError', 'TypeError'])
  // No error: the app renders as normal.
  const fine = new ErrorBoundary({ children: 'the app' })
  assert.equal(fine.render(), 'the app')
})

test('Report an issue warns when the page is public and says where an email or link goes', () => {
  const issues = supportTargetCopy({ kind: 'link', url: 'https://github.com/trentrichards34/creatorclips-releases/issues', public: true })
  assert.equal(issues.tone, 'warning')
  assert.match(issues.note, /^This page is public — remove anything private\./)
  assert.match(issues.note, /save it to a file/)
  assert.equal(issues.open, 'Open the public issues page')
  const email = supportTargetCopy({ kind: 'email', url: 'mailto:help@example.com?subject=CreatorClips%20support', public: false })
  assert.match(email.note, /Opens an email to help@example\.com\. Paste the report into it, or attach the saved file\./)
  const link = supportTargetCopy({ kind: 'link', url: 'https://members.example.com/help', public: false })
  assert.match(link.note, /Opens members\.example\.com\./)
  assert.equal(link.open, 'Open support page')
})

test('Your data: where videos, settings, keys and logs are, what leaves the computer, and how to uninstall', () => {
  useSettingsStore.setState({ outputDirectory: '/Users/me/CreatorClips', falConfigured: false, heygenConfigured: false })
  const html = decode(staticRender(React.createElement(YourData)))
  for (const text of ['Your data', 'Your videos', '/Users/me/CreatorClips', 'Settings, projects and keys', 'Keychain', 'Logs', 'What leaves this computer', 'OpenRouter', 'Pexels', 'Zernio', 'Uninstall', 'drag it from Applications to the Trash', 'no server of its own']) {
    assert.ok(html.includes(text), text)
  }
  assert.match(html, /Show in Finder/)
  // fal.ai and HeyGen are Avatar Studio's: listed only when it's on or a key for them is saved.
  assert.deepEqual(dataDestinations({ fal: false, heygen: false }, false).map((row) => row.name), ['OpenRouter', 'Pexels', 'Zernio'])
  assert.deepEqual(dataDestinations({ fal: true, heygen: true }, false).map((row) => row.name), ['OpenRouter', 'Pexels', 'Zernio', 'fal.ai', 'HeyGen'])
  assert.match(dataDestinations({ fal: false, heygen: false }, false)[0].what, /ElevenLabs voices and transcription are used through OpenRouter/)
})

test('How it works: each Make page links to its guide, and Guides opens at it', () => {
  const make = NAV_ITEMS.filter((item) => item.group === 'make' && item.id !== 'avatar').map((item) => item.id)
  assert.deepEqual([...make].sort(), Object.keys(PAGE_GUIDES).sort(), 'every Make page (Avatar Studio is off) has a guide')
  for (const id of Object.values(PAGE_GUIDES)) assert.ok(GUIDES[id] || TOOL_GUIDES[id], id)
  let opened = 0
  const header = (tool) => decode(staticRender(React.createElement(PageToolContext.Provider, { value: tool }, React.createElement(PageHeader, { title: 'T' }))))
  assert.match(header({ tool: 'clip', label: 'Clip', icon: null, openGuide: () => { opened += 1 } }), /How it works/)
  assert.doesNotMatch(header({ tool: 'library', label: 'Library', icon: null }), /How it works/, 'not on pages without a guide')
  requestGuide('clips')
  assert.equal(peekGuide(), 'clips')
  assert.equal(takeGuide(), 'clips')
  assert.equal(takeGuide(), null, 'one-shot')
  assert.equal(opened, 0)
})

test('the Clip, Edit my recording and Remix guides cover the editor features', () => {
  const text = (guide) => [...guide.steps, ...guide.tips].join(' ')
  for (const phrase of ['Review & edit', 'What to clip', 'Open in editor', 'Design a custom graphic here', 'Best or Lower cost', 'Trial reel']) assert.ok(text(GUIDES.clips).includes(phrase), `Clip guide: ${phrase}`)
  for (const phrase of ['+ Add a screen recording', 'Custom graphics (Beta)', 'Scenes: Light, Standard or Full', 'Sound effects', 'Fix layout', 'Hook stays on screen', 'Trial reel', 'Open in editor', 'Design a custom graphic here']) {
    assert.ok(text(GUIDES['edit-recording']).includes(phrase), `Edit my recording guide: ${phrase}`)
  }
  assert.ok(text(GUIDES['camera-reactions']).includes('Open in editor'), 'Remix guide: Open in editor for graphics')
  // Short: no guide grows past 8 steps.
  for (const guide of [GUIDES.clips, GUIDES['edit-recording'], GUIDES['camera-reactions']]) assert.ok(guide.steps.length <= 8, guide.id)
})
