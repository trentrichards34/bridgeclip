// Avatar Studio's "Realistic talking avatar (HeyGen, Beta)": the create form and the avatar's status, in each state.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const bundled = buildSync({
  stdin: {
    contents: "export { HeygenCreateForm, HeygenStatus } from './src/renderer/components/avatar/HeygenAvatar';",
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  define: { __APP_VERSION__: JSON.stringify(require('../package.json').version) },
  jsx: 'automatic', write: false
}).outputFiles[0].text

const pending = () => new Promise(() => {})
globalThis.window = { bridgeclip: { heygen: { stockAvatars: pending, refresh: pending }, voices: { sample: pending } } }
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require)
const { HeygenCreateForm, HeygenStatus } = mod.exports

const noop = () => {}
const form = (props) => renderToStaticMarkup(React.createElement(HeygenCreateForm, { header: React.createElement('h2', null, 'New avatar'), onCreated: noop, onClose: noop, onOpenKeys: noop, ...props }))
const createButton = (html) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Create HeyGen avatar/s)?.[0] ?? ''

test('without a HeyGen key the form says what to add and cannot create', () => {
  const html = form({ heygenConfigured: false })
  assert.match(html, /Add your HeyGen key first/)
  assert.match(createButton(html), /disabled=""/)
})

test('from a video: the length rules, HeyGen’s consent step and the "This is me" box are shown; nothing can be created yet', () => {
  const html = form({ heygenConfigured: true })
  for (const label of ['A video of me', 'A photo of me', 'HeyGen stock person']) assert.ok(html.includes(label), label)
  assert.match(html, /15 seconds to 3 minutes of you talking to the camera/)
  assert.match(html, /Record with camera/)
  assert.match(html, /Choose video/)
  assert.match(html, /HeyGen asks for your consent/)
  assert.match(html, /read a short statement on camera/)
  assert.match(html, /This is me\. I’m the person in this video/)
  assert.match(html, /My voice, cloned by HeyGen/)
  assert.match(html, /HeyGen bills about \$1\.00 to create this avatar, then about \$0\.10 per second of video \(HeyGen’s API price, checked Oct 19, 2026\)/)
  assert.match(createButton(html), /disabled=""/)
})

test('from a photo: no consent page, still only a photo of the member', () => {
  const html = form({ heygenConfigured: true, initialSource: 'photo' })
  assert.match(html, /Choose photo/)
  assert.match(html, /only makes one from a photo of you/)
  assert.match(html, /This is me\. I’m the person in this photo/)
  assert.doesNotMatch(html, /HeyGen asks for your consent/)
  assert.doesNotMatch(html, /My voice, cloned by HeyGen/)
})

test('stock AI people: no "This is me" box, free to add, billed per second', () => {
  const html = form({ heygenConfigured: true, initialSource: 'stock' })
  assert.match(html, /Loading HeyGen’s stock avatars/)
  assert.doesNotMatch(html, /This is me/)
  assert.match(html, /Free to add\. Videos are billed by HeyGen per second/)
})

const LINK = { provider: 'heygen', source: 'twin', lookId: 'look_1', groupId: 'ag_1', status: 'completed', consentStatus: 'accepted', consentUrl: null, consentUrlAt: null, voiceId: 'voice_1', voice: 'heygen', engines: [], error: null, checkedAt: null }
const status = (heygen) => renderToStaticMarkup(React.createElement(HeygenStatus, {
  avatar: { id: 'abcdef1234567890', name: 'Maya', kind: 'self', heygen, pictures: [], reactions: [] }, busy: false, appVoiceLabel: 'Brian', onChange: noop, onError: noop
}))

test('the avatar’s HeyGen status: training, consent, rejected, failed and ready', () => {
  assert.match(status({ ...LINK, source: 'photo', status: 'processing', consentStatus: null }), /HeyGen is training this avatar/)
  const consent = status({ ...LINK, consentStatus: 'pending', status: 'pending_consent' })
  assert.match(consent, /HeyGen needs your consent before this avatar can make videos/)
  assert.match(consent, /Open HeyGen consent page/)
  assert.match(consent, /Check status/)
  const rejected = status({ ...LINK, consentStatus: 'rejected', status: 'failed', error: 'Please make sure your consent video is under 35s.' })
  assert.match(rejected, /didn’t accept the consent recording: Please make sure your consent video is under 35s\./)
  assert.match(rejected, /Record consent again/)
  assert.match(status({ ...LINK, status: 'failed', error: 'Footage too short' }), /could not make this avatar: Footage too short/)
  const ready = status(LINK)
  assert.match(ready, /Ready\. Talking-head videos of Maya are lip-synced by HeyGen/)
  assert.match(ready, /HeyGen voice clone/)
  assert.match(ready, /App voice · Brian/)
  assert.doesNotMatch(ready, /Open HeyGen consent page/)
  assert.match(ready, /doesn’t delete it from your HeyGen account/)
  assert.equal(status(null), '')
})
