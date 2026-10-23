// Effects in the app: three effect graphics (HyperFrames units) on a clip preview live in the editor (in their own
// shadow roots), the gallery offers every effect, and baking the clip renders each one offscreen into a transparent
// .mov whose frames carry real alpha (drawn pixels over clear ones), layered into the baked clip.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

/** Alpha of one frame of a rendered graphic (.mov, ARGB) at `seconds`: share of drawn pixels and whether the corners are clear. */
function alphaAt(ffmpeg, mov, seconds) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', mov, '-frames:v', '1', '-vf', 'scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
  let drawn = 0
  for (let i = 3; i < raw.length; i += 4) if (raw[i] > 16) drawn++
  const corner = (x, y) => raw[(y * 270 + x) * 4 + 3]
  return { drawn: drawn / (raw.length / 4), clearCorners: [corner(0, 0), corner(269, 0), corner(0, 479), corner(269, 479)].every((a) => a === 0) }
}

const EFFECTS = [
  { id: 'g-fx-count', template: 'fx', at_ms: 1000, duration_ms: 2600, placement: 'top', fields: { effect: 'count-up', value: '1200', prefix: '$' }, origin: 'member' },
  { id: 'g-fx-rise', template: 'fx', at_ms: 7100, duration_ms: 2600, placement: 'middle', fields: { effect: 'per-word-rise', text: 'Words as you say them' }, origin: 'member' },
  { id: 'g-fx-swap', template: 'fx', at_ms: 1000, duration_ms: 2000, placement: 'middle', fields: { effect: 'line-swap', first: 'Everyone wants more views', second: 'You need better hooks', underline: 'hooks' }, origin: 'member' },
  { id: 'g-fx-kin', template: 'fx', at_ms: 7100, duration_ms: 2400, placement: 'top', fields: { effect: 'kinetic-type-swap', prefix: 'Make it', options: 'faster\nyours' }, origin: 'member' },
  { id: 'g-fx-ask', template: 'fx', at_ms: 3200, duration_ms: 1600, placement: 'bottom', fields: { effect: 'cta-close', line: 'Make it happen', button: 'Start now' }, origin: 'member' }
]

/**
 * In the page: for each visible effect, the gaps (in em of its font) between the words of `selector`'s text, measured
 * word by word with Ranges, so spans inside a line (an underlined word) count too.
 */
const WORD_GAPS = (selector) => {
  const out = []
  for (const stage of document.querySelectorAll('.editor-graphics-overlay .fx-stage')) {
    if (!stage.shadowRoot || getComputedStyle(stage).visibility !== 'visible') continue
    for (const el of stage.shadowRoot.querySelectorAll(selector)) {
      const words = []
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (const m of n.data.matchAll(/\S+/g)) {
          const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length)
          const box = r.getBoundingClientRect()
          words.push({ word: m[0], left: box.left, right: box.right, top: Math.round(box.top), em: parseFloat(getComputedStyle(n.parentElement).fontSize) })
        }
      }
      // On screen the frame is scaled down to the monitor (and the stage by its own scale): gaps are in em of the font as drawn.
      const scale = stage.getBoundingClientRect().width / stage.offsetWidth
      for (let i = 1; i < words.length; i++) if (words[i].top === words[i - 1].top) out.push({ pair: `${words[i - 1].word} ${words[i].word}`, gap: (words[i].left - words[i - 1].right) / (words[i].em * scale) })
    }
  }
  return out
}

test('effect graphics preview live, appear in the gallery and bake into transparent renders', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-fx-effects-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'fx-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 640; project.height = 360
  for (const c of project.candidates) c.captions = false
  project.candidates[0].graphics = EFFECTS
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'fx-run', source_video_title: 'Effects run', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Effects run', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)

  // Live preview: at 2 s the count is on screen, drawn by its unit inside a shadow root.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('2000')
  await page.waitForFunction(() => [...document.querySelectorAll('.editor-graphics-overlay .fx-stage')].some((stage) =>
    !!stage.shadowRoot?.querySelector('.cu-value')?.textContent && getComputedStyle(stage).visibility === 'visible'))
  // Words keep their spaces (the bundled stand-in for Inter has a narrow word space): every gap is a real space.
  await page.waitForFunction(() => [...document.querySelectorAll('.editor-graphics-overlay .fx-stage')].some((s) => s.shadowRoot?.querySelector('.ls-line-b')))
  const swapGaps = await page.evaluate(WORD_GAPS, '.ls-line-b')
  assert.deepEqual(swapGaps.map((g) => g.pair), ['You need', 'need better', 'better hooks'])
  for (const g of swapGaps) assert.ok(g.gap > 0.2, `line-swap “${g.pair}”: gap ${g.gap.toFixed(3)} em`)
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('9000')
  await page.waitForFunction(() => document.querySelectorAll('.editor-graphics-overlay .fx-stage').length >= 2 && [...document.querySelectorAll('.editor-graphics-overlay .fx-stage')].some((s) => s.shadowRoot?.querySelector('.pwr-unit')))
  const riseGaps = await page.evaluate(WORD_GAPS, '.pwr-stage')
  assert.equal(riseGaps.length, 4)
  for (const g of riseGaps) assert.ok(g.gap > 0.2, `per-word-rise “${g.pair}”: gap ${g.gap.toFixed(3)} em`)
  const kinGaps = await page.evaluate(WORD_GAPS, '.kts-sentence')
  assert.ok(kinGaps.some((g) => g.pair === 'Make it'), JSON.stringify(kinGaps))
  for (const g of kinGaps.filter((x) => x.pair === 'Make it' || x.pair.startsWith('it '))) assert.ok(g.gap > 0.2, `kinetic-type-swap “${g.pair}”: gap ${g.gap.toFixed(3)} em`)
  // The gallery lists every effect; the inspector edits an effect's own fields.
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('button', { name: 'Add effect Count up', exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: /^Add effect / }).count() >= 38)
  await page.keyboard.press('Escape')

  // Bake: each effect renders offscreen into a transparent .mov the engine lays over the clip.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 200000 })
  const renders = fs.readdirSync(path.join(run, '.graphics')).filter((n) => n.endsWith('.mov'))
  assert.equal(renders.length, 5)
  for (const name of renders) {
    const mov = path.join(run, '.graphics', name)
    const mid = alphaAt(tools.ffmpeg, mov, 1.0)
    assert.ok(mid.drawn > 0.002 && mid.drawn < 0.6, `${name}: drawn share ${mid.drawn}`)
    assert.ok(mid.clearCorners, `${name}: the frame around the effect stays transparent`)
  }
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json')))
  assert.ok(fs.statSync(output.clips[0].s3_url).size > 10000)
  assert.deepEqual(errors, [])
})
