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
      export { isCreateOutput } from './src/renderer/components/ClipList';
      export { GraphicForm as ReelGraphicForm } from './src/renderer/components/ReelGraphics';
      export { EditProgressView } from './src/renderer/components/EditProgressView';
      export { BeatSheet } from './src/renderer/components/BeatSheet';
      export { initialDecisions } from './src/shared/edit-recording';
      export { SceneAmountPicker } from './src/renderer/components/SceneAmountPicker';`,
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
const { EditRecordingPage, EditReview, lookFromBrand, transcriptLines, parseEditPlan, useSettingsStore, useEditRecordingStore, isCreateOutput, ReelGraphicForm, EditProgressView, BeatSheet, initialDecisions, SceneAmountPicker } = mod.exports

function staticRender(element) {
  const original = React.useSyncExternalStore
  React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  try { return renderToStaticMarkup(element) } finally { React.useSyncExternalStore = original }
}

test('the first screen: choose or film a recording, the look, the cost line, and Not sure what to film?', () => {
  useSettingsStore.setState({ openrouterConfigured: false })
  const html = staticRender(React.createElement(EditRecordingPage, { onNavigate: () => {} }))
  assert.match(html, /Edit my recording/)
  assert.match(html, /Add your OpenRouter key to start/)
  assert.match(html, /Choose recordings/)
  assert.match(html, /data-testid="edit-sources-drop"/)
  assert.match(html, /You can also drop recordings here\./)
  assert.match(html, /Film it here/)
  assert.match(html, /Not sure what to film\?/)
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
  // Sound effects follow the graphics: how much plays (Teaching by default); the hook text's own sound isn't listed.
  assert.match(html, /aria-label="Style"/)
  assert.match(html, /aria-checked="true"[^>]*>Teaching</)
  assert.doesNotMatch(html, /as the hook text appears/)
  assert.match(html, /Make my reel/)
  // The beat sheet is one click away: a view toggle at the top and a button by the on-screen extras.
  assert.match(html, /aria-label="Review view"/)
  assert.match(html, /aria-checked="true"[^>]*>Your edit</)
  assert.match(html, />Beat sheet</)
  assert.match(html, /See the beat sheet/)
})

test('the beat sheet: numbered beats with what shows, the words said, the sound and the actions', () => {
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, showHandle: false }
  const decisions = { ...initialDecisions(PLAN), popups: [{ id: 0, on: true, text: 'coaches' }], graphics: [{ id: 'gaaaaaaa', template: 'fx', word: 4, duration_ms: 3000, placement: 'top', fields: { effect: 'count-up', value: '40' }, origin: 'member' }] }
  const sources = [{ path: '/a/take-1.mp4', name: 'take-1.mp4', seconds: 2 }, { path: '/a/take-2.mp4', name: 'take-2.mp4', seconds: 4 }]
  const html = staticRender(React.createElement(BeatSheet, { runId: 'r1', plan: PLAN, decisions, look, brand: null, sources, images: [], disabled: false, chatState: decisions, chatReady: false,
    choice: 'ask', onChoice: () => {}, onChange: () => {} }))
  assert.match(html, /Beat sheet/)
  assert.match(html, /3 beats · stills 0 of 3 ready/)
  assert.match(html, /aria-label="Beat 1"[^>]*data-beat="hook"/)
  assert.match(html, /Hook text: “Here is why”/)
  assert.match(html, /aria-label="Beat 3"[^>]*data-beat="g:gaaaaaaa"/)
  assert.match(html, /Count up: 40/)
  assert.match(html, /“undercharge\.”/)
  assert.match(html, /Sound: Swipe/)
  for (const action of ['Keep beat 2', 'Remove beat 2', 'Swap the visual of beat 3', 'Edit the text of beat 3', 'Move beat 3 a word earlier', 'Preview motion of beat 3', 'Add a note to beat 3']) assert.match(html, new RegExp(`aria-label="${action}"`))
  assert.match(html, /aria-checked="true"[^>]*>Ask me</)
  assert.match(html, />Always show it</)
  assert.match(html, />Skip it</)
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
  assert.match(html, /aria-pressed="false"[^>]*>Zoom</)
  assert.match(html, /Half-screen graphic 1 · List/)
  // One "On-screen extras" section with sub-groups, in the page's order; the header says what costs money.
  assert.match(html, /Making the reel is free\. Chat messages use your OpenRouter credit\./)
  const order = ['>Chat<', '>Opens with<', '>Your words<', '>Skills<', '>Edit style<', '>On-screen extras<', '>Graphics', '>Half-screen graphics<', '>Pop-ups<', '>My images<', '>How it opens<', '>Look<'].map((label) => html.indexOf(label))
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), JSON.stringify(order))
  assert.doesNotMatch(html, /Cards, pop-ups and sounds/)
  // "What changed" is one line until opened; the pop-up row is a boxed row with its switch last.
  assert.match(html, /aria-label="What changed"[^>]*><button[^>]*aria-expanded="false"/)
  assert.match(html, /data-testid="edit-popup-0"(?:(?!<\/div><\/div>).)*role="switch"[^>]*aria-label="Pop-up 1"/s)
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

test('a reel graphic form: Orbit and Feature tile get icon pickers and switches, never raw "labels" or "dot" boxes (audit)', () => {
  const frame = { aspect: '9:16', hook: 0, captions: null, handle: null }
  const form = (template, fields) => staticRender(React.createElement(ReelGraphicForm, {
    g: { id: 'g1', template, at: 1, where: 'at 0:01', problem: null, duration_ms: 3000, placement: 'top', fields }, frame, look: null, disabled: false,
    cursorLabel: 'here', onField: () => {}, onPatch: () => {}, onMoveHere: () => {}, onRemove: () => {}
  }))
  const orbit = form('orbit', { items: 'Ads\nPages\nEmails', icons: 'megaphone\nfile\nmail' })
  assert.doesNotMatch(orbit, /aria-label="Orbit labels"/)
  assert.match(orbit, /aria-label="Labels under the icons"/)
  assert.match(orbit, /aria-label="Icon for Ads"/)
  const tiles = form('feature_tile', { items: 'Auto reports' })
  assert.doesNotMatch(tiles, /aria-label="Feature tile dot"/)
  assert.match(tiles, /aria-label="Red dot on the first tile"/)
  assert.match(tiles, /aria-label="Icon for Auto reports"/)
})

test('the progress view: the job’s steps with times, the clip strip with the current clip, the words heard, and Cancel', () => {
  const now = Date.now()
  const sources = Array.from({ length: 13 }, (_, i) => ({ path: `/clips/IMG_${i}.MOV`, name: `IMG_${i}.MOV`, seconds: 5 }))
  const status = {
    id: 'p1', phase: 'transcribing', detail: 'Listening to your clips (7 of 13)', percent: 59, folder: '/out/edit-1', plan: null, transcriber: 'scribe', output: null,
    costUsd: 0, estimateUsd: 0.02, error: null, warnings: [], mode: 'combine', sources,
    progress: { startedAt: now - 150000, renderStartedAt: null, step: { n: 7, of: 13 }, clip: 6, wordsHeard: 80, found: {}, order: null,
      stages: [{ id: 'ready', startedAt: now - 150000, endedAt: now - 90000 }, { id: 'listen', startedAt: now - 90000, endedAt: null }],
      heard: [{ src: 5, text: 'And that is how I doubled my rate.' }] }
  }
  const html = staticRender(React.createElement(EditProgressView, { status, onCancel: () => {} }))
  assert.match(html, /Listening to your clips/)
  assert.match(html, /<ol aria-label="Steps"/)
  assert.match(html, /data-state="done"[^>]*>.*Getting your clips ready.*1:00/s)
  assert.match(html, /aria-current="step"[^>]*>.*Listening/s)
  assert.match(html, /Planning the edit/)
  assert.match(html, /Saving your reel/)
  assert.match(html, /Listening to clip 7 of 13/)
  assert.match(html, /<ul aria-label="Your clips"/)
  assert.equal((html.match(/aria-label="Clip \d+, done"/g) ?? []).length, 6)
  assert.match(html, /aria-label="Clip 7, working on it"/)
  assert.match(html, /Heard in clip 6/)
  assert.match(html, /doubled/)
  // Six clips in 90 s of listening: about 2 minutes left for the other 7 (from what was measured). With no earlier runs to
  // go on, the planning time isn't known, so there's no total: only this step's time left.
  assert.match(html, /this step: about 2 min left/)
  assert.match(html, /Timing it as it goes: 13 clips, 1:05 of video\./)
  assert.match(html, />Cancel</)
})

test('the review: a kept headline says so and offers the AI’s new one; one that no longer fits says a new one was written', () => {
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, showHandle: false }
  const render = (keptHook, id) => {
    const plan = parseEditPlan({
      words: [['Most', 300, 500, 0, null], ['coaches', 520, 800, 0, null], ['undercharge.', 920, 1400, 0, null]],
      hooks: [{ id: 0, start: 0, end: 2, text: keptHook.kept ? keptHook.text : keptHook.fresh, why: '' }], hook: 0, cta: null, popups: [], sounds: [], planned: 'ai', notes: [], warnings: [], kept_hook: keptHook
    }, 1)
    const status = { id, phase: 'review', detail: '', percent: 100, folder: '/out/edit-1', plan, transcriber: 'scribe', output: null, costUsd: 0, estimateUsd: 0, error: null, warnings: [],
      sources: [{ path: '/a/take-1.mp4', name: 'take-1.mp4', seconds: 2 }] }
    return staticRender(React.createElement(EditReview, { status, brand: null, look, onLook: () => {}, onError: () => {} }))
  }
  const kept = render({ kept: true, text: 'Most coaches undercharge', fresh: 'Coaches charge too little' }, 'kept-1')
  assert.match(kept, /value="Most coaches undercharge"/)
  assert.match(kept, /Same headline as last time you made this video\./)
  assert.match(kept, />New headline<\/button>/)
  const fresh = render({ kept: false, text: '', fresh: 'Coaches charge too little' }, 'kept-2')
  assert.match(fresh, /value="Coaches charge too little"/)
  assert.match(fresh, /Your last headline used words that aren’t in this recording, so the AI wrote a new one\./)
})

test('the review: the headline and the Triple Hook, quoted, with one-click headline options of said words', () => {
  const look = { includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, showHandle: false }
  const words = 'You do not need ads. I can’t stress this enough. I sold 40 courses last week.'.split(' ')
  const plan = parseEditPlan({
    words: words.map((w, i) => [w, i * 300, i * 300 + 260, 0, null]),
    hooks: [{ id: 0, start: 0, end: 4, text: 'I sold 40 courses last week', why: '', repeated: 'You do not need ads',
      options: [{ text: 'I can’t stress this enough: I sold 40 courses last week', adds: ['qualifier'] }] }], hook: 0,
    cta: null, popups: [], sounds: [], planned: 'ai', notes: [], warnings: []
  }, 1)
  const status = { id: 'headline-1', phase: 'review', detail: '', percent: 100, folder: '/out/edit-1', plan, transcriber: 'scribe', output: null, costUsd: 0, estimateUsd: 0, error: null, warnings: [],
    sources: [{ path: '/a/take-1.mp4', name: 'take-1.mp4', seconds: 5 }] }
  const html = staticRender(React.createElement(EditReview, { status, brand: null, look, onLook: () => {}, onError: () => {} }))
  assert.match(html, /data-testid="edit-headline-check"/)
  assert.match(html, /data-testid="edit-headline-label">Triple Hook: main statement \(headline\) \+ twist · no qualifier</)
  assert.match(html, /data-role="twist"><span[^>]*>Twist<\/span><span[^>]*>“You do not need ads\.” <span[^>]*>\(you say it\)/)
  assert.match(html, /data-role="main_statement">.*?“I sold 40 courses last week” <span[^>]*>\(headline\)/)
  assert.match(html, /data-role="qualifier"><span[^>]*>Qualifier<\/span><span[^>]*>Missing/)
  assert.match(html, /The planned headline, “You do not need ads”, only repeated what you say/)
  assert.match(html, /“I can’t stress this enough: I sold 40 courses last week”<\/p><p[^>]*>Triple Hook: qualifier \(headline\) \+ main statement \(headline\) \+ twist · all three<\/p><\/div><button[^>]*>.*?Use this headline<\/button>/)
})

test('the Scenes choice of custom graphics: Light, Standard and Full, each with its estimate for this reel, Full by default', () => {
  const estimates = { light: { scenes: 4, expectedUsd: 5.7, mostUsd: 6.1 }, standard: { scenes: 6, expectedUsd: 7.64, mostUsd: 8.17 }, full: { scenes: 8, expectedUsd: 9.58, mostUsd: 10.25 } }
  const html = staticRender(React.createElement(SceneAmountPicker, { value: undefined, estimates, onChange: () => {} }))
  assert.match(html, /aria-label="Scenes"/)
  assert.match(html, /Light · ~\$5\.70/); assert.match(html, /Standard · ~\$7\.64/); assert.match(html, /Full · ~\$9\.58/)
  assert.match(html, /aria-checked="true"[^>]*>Full/)
  assert.match(html, /About 8 scenes on this reel, about \$9\.58 \(at most \$10\.25\)/)
  const light = staticRender(React.createElement(SceneAmountPicker, { value: 'light', estimates, onChange: () => {} }))
  assert.match(light, /aria-checked="true"[^>]*>Light/); assert.match(light, /About 4 scenes on this reel, about \$5\.70 \(at most \$6\.10\)/)
  assert.match(light, /same quality/)
  // No estimates yet: the choices alone.
  assert.match(staticRender(React.createElement(SceneAmountPicker, { value: 'standard', estimates: null, onChange: () => {} })), />Standard</)
})
