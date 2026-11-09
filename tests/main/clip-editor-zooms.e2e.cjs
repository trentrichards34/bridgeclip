// Screen zooms and a long YouTube video in the clip editor, driven in the app: a 26-minute 16:9 project with 150
// graphics (its cap grows with its length) and planned zooms opens quickly; the timeline draws every graphic and the
// Zooms row; scrubbing stays smooth; the output preview zooms into the screen area during a zoom (and not when it is
// turned off); a zoom is turned off and made stronger, and the project saves it.
//
// ZOOMS_E2E_OUT=<dir> keeps screenshots and the timings.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

const MINUTES = 26
const DURATION = MINUTES * 60000
const GRAPHICS = 150
const TEMPLATES = [['stat', { value: '1,227', label: 'monthly revenue' }], ['title', { text: 'The whole plan' }], ['list', { title: 'Steps', items: 'Idea\nResearch\nOffer' }],
  ['lower_third', { name: 'Travis', role: 'Founder' }], ['quote', { text: 'Ship it this week', author: 'Me' }]]

test('a 26-minute YouTube video: 150 graphics and screen zooms in the editor, smooth to scrub, zooms previewed and changed', { timeout: 600000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const out = process.env.ZOOMS_E2E_OUT
  if (out) fs.mkdirSync(out, { recursive: true })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-zooms-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'zooms-run')
  fs.mkdirSync(run, { recursive: true })
  // A small, long "screen recording": a light page, a dark header, a box in the upper left with a checker pattern
  // (so a zoom into it is easy to see), and a bar drifting along the bottom. 320x180 keeps 26 minutes tiny.
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=0xF2F4F7:size=320x180:rate=30:duration=${DURATION / 1000}`, '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`,
    '-filter_complex', "[0:v]drawbox=x=0:y=0:w=320:h=20:c=0x1B1F2A:t=fill,drawgrid=x=20:y=40:w=8:h=8:t=4:c=0x2F5BFF,drawbox=x=0:y=110:w=320:h=70:c=0xF2F4F7:t=fill,drawbox=x=0:y=30:w=20:h=150:c=0xF2F4F7:t=fill,drawbox=x=120:y=30:w=200:h=80:c=0xF2F4F7:t=fill,drawbox=x=mod(t*20\\,280):y=150:w=40:h=12:c=0x9AA3B5:t=fill[v]",
    '-map', '[v]', '-map', '1:a', '-t', String(DURATION / 1000), ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const lines = Array.from({ length: DURATION / 6000 }, (_, i) => ({ start_ms: i * 6000 + 200, end_ms: i * 6000 + 5600, text: `This is line ${i + 1} of the walkthrough on my screen` }))
  const project = structuredClone(fixture)
  Object.assign(project, { title: 'Long walkthrough', width: 320, height: 180, duration_ms: DURATION, aspect_ratio: '16:9', transcript: lines,
    youtube: { pip: null, captions: 'key' }, zoom: { area: [0, 0, 1, 1] } })
  const graphics = Array.from({ length: GRAPHICS }, (_, i) => {
    const [template, fields] = TEMPLATES[i % TEMPLATES.length]
    return { id: `g${String(i).padStart(4, '0')}`, template, at_ms: 30000 + i * 10000, duration_ms: 3000, placement: 'bottom', fields, origin: 'member', ...(template === 'stat' ? { size: 'compact' } : {}) }
  })
  // Zooms into the checker box (upper left), one with a glowing box; none under a graphic's start.
  const zooms = [
    { at_ms: 35000, end_ms: 39000, keys: [[35000, 0.2, 0.35, 2]], max: 2.2 },
    { at_ms: 45000, end_ms: 49000, keys: [[45000, 0.25, 0.35, 1.8]], max: 2.2, glow: { box: [0.1, 0.25, 0.2, 0.15], at_ms: 46000 } },
    { at_ms: 125000, end_ms: 131000, keys: [[125000, 0.3, 0.4, 1.6], [128000, 0.6, 0.4, 1.6]], max: 2.2 }
  ]
  project.candidates = [{ ...project.candidates[0], title: 'Long walkthrough', ranges: [[0, DURATION]], scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: false,
    video_speed: 1, graphics, zooms }]
  delete project.candidates[0].review
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: lines.map((l) => ({ start_time_ms: l.start_ms, end_time_ms: l.end_ms, text: l.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'zooms-run', source_video_title: 'Long walkthrough', source_video_duration_seconds: DURATION / 1000, clips: [], total_clips: 0, editor_project: true, format: 'youtube' }))
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))
  const timings = {}
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  const opened = Date.now()
  await page.getByRole('button', { name: 'Open Long walkthrough', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  timings.openMs = Date.now() - opened
  const shot = async (name) => { if (out) await page.screenshot({ path: path.join(out, `${name}.png`) }) }

  // Every graphic is on the timeline (the clip is the whole video) and the Zooms row is there.
  await page.waitForFunction((n) => document.querySelectorAll('.editor-graphics-track .editor-graphic-block').length === n, GRAPHICS)
  const zoomBlocks = page.locator('.editor-zooms-track .editor-zoom-block')
  assert.equal(await zoomBlocks.count(), zooms.length)
  await shot('01-timeline')

  // Scrubbing: each step's frame is drawn quickly even with 150 graphics.
  const scrub = await page.evaluate(async (duration) => {
    const slider = document.querySelector('input[aria-label="Fine timeline position"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    // The main thread's work for each step: the input handled (React renders the timeline, graphics and preview
    // synchronously for it) and the effects that follow (a macrotask later). Animation frames are throttled in a
    // hidden test window, so they aren't timed.
    const steps = []
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now()
      setter.call(slider, String(Math.round(duration * (i + .5) / 40)))
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 0))
      steps.push(performance.now() - t0)
      await new Promise((r) => setTimeout(r, 30))
    }
    steps.sort((a, b) => a - b)
    return { median: steps[20], worst: steps[39] }
  }, DURATION)
  timings.scrub = scrub
  if (out) fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings, null, 1))
  assert.ok(scrub.median < 50, `scrubbing a step takes ${scrub.median.toFixed(0)} ms (median) with ${GRAPHICS} graphics`)
  assert.ok(timings.openMs < 30000, `the editor opened in ${timings.openMs} ms`)

  // The output preview: during the first zoom's hold the checker box fills the frame (lots of blue), outside it not.
  const seek = (ms) => page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(ms))
  // The output canvas as shown (a screenshot: the video taints the canvas for reading), its share of bright blue.
  const blueShare = async () => {
    const png = await page.locator('.editor-output-monitor canvas').screenshot()
    const d = execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: png, maxBuffer: 64 * 1024 * 1024 })
    let n = 0
    for (let i = 0; i < d.length; i += 12) if (d[i + 2] > 180 && d[i] < 120) n++
    return n / (d.length / 12)
  }
  const settle = async () => { await page.waitForTimeout(400); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))) }
  await seek(32000); await settle()
  const before = await blueShare()
  await seek(37000); await settle()
  const during = await blueShare()
  await shot('02-zoomed-preview')
  assert.ok(during > before * 2, `the preview zooms into the box: blue ${during.toFixed(3)} during vs ${before.toFixed(3)} before`)

  // Turn that zoom off: the preview shows the whole screen again; the project saves it off. Then make the second stronger.
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json'))).candidates[0]
  const savedWhen = async (check, what) => {
    for (let i = 0; i < 80; i++) { try { if (check(saved())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save ${what}: ${JSON.stringify(saved().zooms)}`)
  }
  await zoomBlocks.first().click()
  const bar = page.getByRole('group', { name: 'Zoom settings' })
  await bar.getByText('Zoom at').waitFor()
  await bar.getByRole('switch', { name: 'This zoom' }).click()
  await savedWhen((c) => c.zooms[0].on === false, 'the first zoom off')
  await seek(37000); await settle()
  const off = await blueShare()
  assert.ok(off < during / 2, `turned off, the preview shows the whole screen: ${off.toFixed(3)}`)
  await zoomBlocks.nth(1).click()
  await bar.getByText(/Zoom and box at/).waitFor()
  await bar.getByRole('radiogroup', { name: 'How far it zooms' }).getByRole('radio', { name: 'Strong' }).click()
  await savedWhen((c) => c.zooms[1].intensity === 1.4, 'the second zoom stronger')
  // All zooms off, then on again.
  await bar.getByRole('switch', { name: 'All zooms' }).click()
  await savedWhen((c) => c.zooms.every((z) => z.on === false), 'every zoom off')
  await bar.getByRole('switch', { name: 'All zooms' }).click()
  await savedWhen((c) => c.zooms.every((z) => z.on !== false), 'every zoom on')
  await shot('03-zoom-bar')
  assert.equal(saved().graphics.length, GRAPHICS)
  assert.deepEqual(errors, [])
})
