// Depth and camera in the clip editor, driven in the app on a real person (the portrait fixture): a Stage scene's
// "Head out" switch and camera move save with the edit; a Type takeover graphic has its "Head between the lines"
// switch; the bake draws the head breaking out of the card and the takeover's darkened room with its lines around
// the head.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

const PERSON = path.join(__dirname, '../../engine/tests/fixtures/portrait_person.jpg')

function frame(ffmpeg, video, seconds) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
  return { at: (x, y) => [raw[(y * 1080 + x) * 3], raw[(y * 1080 + x) * 3 + 1], raw[(y * 1080 + x) * 3 + 2]] }
}
const mean = (f, x0, y0, w, h) => {
  const sum = [0, 0, 0]
  for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) { const p = f.at(x, y); for (let c = 0; c < 3; c++) sum[c] += p[c] }
  const n = Math.ceil(w / 2) * Math.ceil(h / 2)
  return sum.map((s) => s / n)
}

test('a stage scene’s head breaks out and a type takeover puts the head between its lines, edited and baked', { timeout: 420000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-depth-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'depth-run')
  fs.mkdirSync(run, { recursive: true })
  // The portrait as a 9:16 selfie that sways a little.
  execFileSync(tools.ffmpeg, ['-v', 'error', '-loop', '1', '-r', '30', '-i', PERSON, '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '10',
    '-filter_complex', "[0:v]scale=764:1306:flags=lanczos,crop=720:1280:x='22+14*sin(2*PI*t/4)':y='13+9*sin(2*PI*t/3)',format=yuv420p[v]",
    '-map', '[v]', '-map', '1:a', ...tools.encoder, '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const transcript = [{ start_ms: 0, end_ms: 4000, text: 'Most people post every day.' }, { start_ms: 6200, end_ms: 8200, text: 'Post less. Say more. Every single day.' }]
  const project = {
    version: 1, revision: 1, title: 'Depth', width: 720, height: 1280, duration_ms: 10000, aspect_ratio: '9:16', transcript,
    candidates: [{ id: 'candidate-1', title: 'Depth', ranges: [[0, 9000]], scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: false,
      caption_preset: 'pop', video_speed: 1, score: 0.8, reason: '', exports: [],
      graphics: [{ id: 'takeover-1', template: 'takeover', at_ms: 6200, duration_ms: 2000, placement: 'middle', fields: { text: 'Post less. Say more. Every single day.', accent: 'day.' } }] }]
  }
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'depth-run', source_video_title: 'Depth', source_video_duration_seconds: 10, clips: [], total_clips: 0, editor_project: true }))
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(15000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Depth', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const savedWhen = async (check) => {
    for (let i = 0; i < 60; i++) { try { if (check(saved().candidates[0])) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save as expected: ${JSON.stringify(saved().candidates[0].stage_scenes)}`)
  }

  // A Stage scene at 2 s: the head breaks out by default; a whip into it; off and on again.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('2000')
  await page.getByRole('button', { name: 'Add scene at playhead', exact: true }).click()
  await savedWhen((c) => c.stage_scenes?.length === 1)
  const tools_ = page.getByRole('group', { name: 'Selected scene' })
  const headOut = tools_.getByRole('switch', { name: 'Head breaks out of the card', exact: true })
  assert.equal(await headOut.getAttribute('aria-checked'), 'true')
  await tools_.getByRole('radio', { name: 'Whip', exact: true }).click()
  await savedWhen((c) => c.stage_scenes[0].transition === 'whip')
  await headOut.click()
  await savedWhen((c) => c.stage_scenes[0].escape === false)
  await headOut.click()
  await savedWhen((c) => c.stage_scenes[0].escape === undefined)
  assert.deepEqual(saved().candidates[0].stage_scenes, [{ scene: 'stage', start_ms: 2000, end_ms: 5000, transition: 'whip' }])
  // The preview says what the export does.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('3500')
  await page.getByText('Head breaks out of the card in the export', { exact: true }).waitFor()

  // The takeover: its inspector has the depth switch, on.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('7000')
  await page.locator('.editor-graphic-block').first().click()
  const between = page.getByRole('switch', { name: 'Head between the lines', exact: true })
  assert.equal(await between.getAttribute('aria-checked'), 'true')
  await page.getByText('Head between the lines in the export', { exact: true }).waitFor()
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'editor-depth.png') }) }
  await page.getByText('All changes saved', { exact: true }).waitFor()

  // Bake.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 300000 })
  const video = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'))).clips[0].s3_url
  if (shots) for (const s of [3.5, 7.6]) execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', String(s), '-i', video, '-frames:v', '1', '-y', path.join(shots, `baked-depth-${s}.png`)])
  // Stage: just above the card's top edge (1920 − 32 − 806 = 1082), over the middle, is the speaker, not the backdrop.
  const stage = frame(tools.ffmpeg, video, 3.5)
  const head = mean(stage, 500, 1040, 80, 30), side = mean(stage, 40, 1040, 80, 30)
  assert.ok(Math.abs(head[0] - side[0]) + Math.abs(head[1] - side[1]) + Math.abs(head[2] - side[2]) > 90, `the head over the card's edge: ${head.map(Math.round)} vs ${side.map(Math.round)}`)
  // The escape matte is kept for the next bake.
  assert.ok(fs.readdirSync(path.join(run, '.graphics', 'mattes')).some((n) => n.startsWith('escape-')))
  // Takeover: the room is softened, not blacked out; white type shows either side of the head in the upper half.
  const takeover = frame(tools.ffmpeg, video, 7.6)
  assert.ok(Math.max(...mean(takeover, 20, 1800, 120, 100)) > 20, 'the room still shows')
  let left = 0, right = 0
  for (let y = 100; y < 960; y += 4) for (let x = 0; x < 1080; x += 4) {
    const p = takeover.at(x, y)
    if (Math.min(...p) > 225) { if (x < 270) left++; else if (x >= 810) right++ }
  }
  assert.ok(left > 80 && right > 80, `type either side of the head: ${left}, ${right}`)
  assert.deepEqual(errors, [])
})
