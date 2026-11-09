// Effects on the member's own pictures: a browser screenshot with a hand-drawn circle, a before and after and a light
// sweep over a proof, each with a fixture picture in the run. The editor previews them with the picture in the unit's
// slot (inside its shadow root) and the mark drawn over it; baking renders each into a transparent .mov whose frames
// carry real alpha and show the picture's own colors.
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

/** One frame of a render (.mov, ARGB) at `seconds`: share of drawn pixels, clear corners, and the share of pixels near each color. */
function frameAt(ffmpeg, mov, seconds, colors) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', mov, '-frames:v', '1', '-vf', 'scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
  let drawn = 0
  const near = Object.fromEntries(Object.keys(colors).map((k) => [k, 0]))
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] > 16) drawn++
    if (raw[i + 3] < 200) continue
    for (const [k, [r, g, b]] of Object.entries(colors)) if (Math.abs(raw[i] - r) < 50 && Math.abs(raw[i + 1] - g) < 50 && Math.abs(raw[i + 2] - b) < 50) near[k]++
  }
  const total = raw.length / 4
  const corner = (x, y) => raw[(y * 270 + x) * 4 + 3]
  return { drawn: drawn / total, clearCorners: [corner(0, 0), corner(269, 0), corner(0, 479), corner(269, 479)].every((a) => a === 0), near: Object.fromEntries(Object.entries(near).map(([k, v]) => [k, v / total])) }
}

/** A picture in the run's .graphics/images (named by its content, as the editor names one it copies in). */
function picture(ffmpeg, run, color, size = '800x500') {
  const tmp = path.join(run, `.pic-${color}.png`)
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-vf', 'drawbox=x=40:y=40:w=300:h=60:color=white:t=fill', '-frames:v', '1', tmp])
  const bytes = fs.readFileSync(tmp)
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.png`
  fs.mkdirSync(path.join(run, '.graphics', 'images'), { recursive: true })
  fs.renameSync(tmp, path.join(run, '.graphics', 'images', name))
  return name
}

test('picture effects preview with the member’s picture and mark, and bake into transparent renders that show the picture', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-fx-media-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'fx-media-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const magenta = picture(tools.ffmpeg, run, 'magenta'), cyan = picture(tools.ffmpeg, run, 'cyan')
  const project = structuredClone(fixture); project.width = 360; project.height = 640; project.aspect_ratio = '9:16'
  for (const c of project.candidates) c.captions = false
  // The whole source is the clip, so each effect plays its full length.
  project.candidates[0].ranges = [[0, 12000]]
  project.candidates[0].graphics = [
    { id: 'g-media-browser', template: 'fx', at_ms: 1000, duration_ms: 3500, placement: 'middle', size: 'stage', origin: 'member',
      fields: { effect: 'browser-device-stage', image: magenta, mark: 'circle', mark_box: '0.05, 0.08, 0.4, 0.12' } },
    { id: 'g-media-wipe', template: 'fx', at_ms: 5000, duration_ms: 3000, placement: 'middle', size: 'stage', origin: 'member',
      fields: { effect: 'before-after-wipe', image: magenta, image_b: cyan, label_a: 'Before', label_b: 'After' } },
    { id: 'g-media-sweep', template: 'fx', at_ms: 8500, duration_ms: 3000, placement: 'middle', size: 'stage', origin: 'member',
      fields: { effect: 'light-sweep-pass', image: cyan, mark: 'underline', mark_box: '0.05, 0.08, 0.4, 0.12' } }
  ]
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'fx-media-run', source_video_title: 'Picture effects run', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); if (!process.env.KEEP_FX_RUN) fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Picture effects run', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)

  // Live preview: the screenshot sits in the browser window's slot, and the circle is drawn over it once it settles.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('3200')
  await page.waitForFunction(() => [...document.querySelectorAll('.editor-graphics-overlay .fx-stage')].some((stage) => {
    const img = stage.shadowRoot?.querySelector('.bds-screen .cc-media img')
    const mark = stage.shadowRoot?.querySelector('.cc-media .cc-mark path')
    return img?.complete && img.naturalWidth === 800 && mark && getComputedStyle(mark).opacity === '1' && getComputedStyle(stage).visibility === 'visible'
  }))
  // The gallery offers the picture effects (they ask for a picture); the inspector shows the picture and the mark's box.
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('button', { name: 'Add effect Browser screenshot (choose your picture)', exact: true }).waitFor()
  await page.keyboard.press('Escape')

  // Bake: each one renders offscreen with its picture in it.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 200000 })
  const renders = fs.readdirSync(path.join(run, '.graphics')).filter((n) => n.endsWith('.mov'))
  assert.equal(renders.length, 3)
  const colors = { magenta: [255, 0, 255], cyan: [0, 255, 255] }
  // Late in each one (its picture has settled), on the finished clip's clock.
  const seconds = (mov) => {
    const probe = spawnSync(tools.ffmpeg, ['-hide_banner', '-i', mov], { encoding: 'utf8' })
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe.stderr)
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 2
  }
  const frames = renders.map((name) => { const mov = path.join(run, '.graphics', name); return frameAt(tools.ffmpeg, mov, seconds(mov) * 0.8, colors) })
  for (const [i, f] of frames.entries()) {
    assert.ok(f.drawn > 0.02 && f.drawn < 0.9, `${renders[i]}: drawn share ${f.drawn}`)
    assert.ok(f.clearCorners, `${renders[i]}: the frame around the effect stays transparent`)
    assert.ok(f.near.magenta + f.near.cyan > 0.01, `${renders[i]}: the picture shows (${JSON.stringify(f.near)})`)
  }
  // The before and after shows both pictures, side by side at its divider.
  assert.ok(frames.some((f) => f.near.magenta > 0.005 && f.near.cyan > 0.005), JSON.stringify(frames.map((f) => f.near)))
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json')))
  assert.ok(fs.statSync(output.clips[0].s3_url).size > 10000)
  assert.deepEqual(errors, [])
})
