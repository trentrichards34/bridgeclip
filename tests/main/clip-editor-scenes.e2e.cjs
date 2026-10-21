// Clip editor Scenes row, driven in the app: add a Stage scene at the playhead, switch its backdrop,
// see the stage preview over the Output monitor, undo/redo it, check the saved edit, then bake the
// clip and check its frames switch from the full-frame video to the stage (dark backdrop, speaker card).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

/** Mean RGB of a box of a frame at `seconds` (box in output pixels of a 1080×1920 clip). */
function boxColor(ffmpeg, video, seconds, [x, y, w, h]) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const sum = [0, 0, 0]
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += raw[i + c]
  return sum.map((n) => n / (raw.length / 3))
}

test('a stage scene added in the Scenes row saves, undoes, previews and is baked into the clip', { timeout: 240000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-editor-scenes-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'scenes-run')
  fs.mkdirSync(run, { recursive: true })
  // A red picture, so the backdrop and the card are easy to tell apart in the baked frames.
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd02020:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 640; project.height = 360
  for (const c of project.candidates) { c.captions = false; c.scenes = [c.scenes[0]] }
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'scenes-run', source_video_title: 'Editor scenes', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
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
  await page.getByRole('button', { name: 'Open Editor scenes', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const savedWhen = async (check) => {
    for (let i = 0; i < 60; i++) { try { if (check(saved())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save as expected: ${JSON.stringify(saved().candidates[0].stage_scenes)}`)
  }

  // Face throughout to start with; a Stage scene at the playhead (2.0 s of source) runs 3 s.
  await page.getByText('Face throughout. Add a Stage scene to give a graphic room.').waitFor()
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('2000')
  await page.getByRole('button', { name: 'Add scene at playhead', exact: true }).click()
  await savedWhen((p) => p.candidates[0].stage_scenes?.length === 1)
  assert.deepEqual(saved().candidates[0].stage_scenes, [{ scene: 'stage', start_ms: 2000, end_ms: 5000 }])
  assert.equal(await page.locator('.editor-scene-block.scene-stage').count(), 1)
  // The selected scene's backdrop → Dark.
  await page.getByRole('group', { name: 'Selected scene' }).getByRole('radio', { name: 'Dark', exact: true }).click()
  await savedWhen((p) => p.candidates[0].stage_scenes?.[0]?.backdrop === 'dark')
  assert.deepEqual(saved().candidates[0].stage_scenes, [{ scene: 'stage', start_ms: 2000, end_ms: 5000, backdrop: 'dark' }])
  // The Output monitor previews the stage: backdrop and speaker card.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('3500')
  await page.locator('.editor-scenes-overlay[data-scene="stage"] .editor-scenes-card').waitFor()
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'editor-scenes-row.png') }) }
  // Undo takes back the backdrop, then the scene; redo brings both back.
  const undo = page.getByRole('button', { name: 'Undo', exact: true }), redo = page.getByRole('button', { name: 'Redo', exact: true })
  await undo.click(); await undo.click()
  await savedWhen((p) => (p.candidates[0].stage_scenes ?? []).length === 0)
  await redo.click(); await redo.click()
  await savedWhen((p) => p.candidates[0].stage_scenes?.[0]?.backdrop === 'dark')
  await page.getByText('All changes saved', { exact: true }).waitFor()

  // Bake: the engine draws the scene. Output time = (source − 1000) / 1.25, so the scene is 0.8–3.2 s.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 150000 })
  const video = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'))).clips[0].s3_url
  if (shots) execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', '2', '-i', video, '-frames:v', '1', '-y', path.join(shots, 'baked-stage.png')])
  const top = [200, 300, 680, 400], card = [440, 1450, 200, 200]
  const red = (rgb) => rgb[0] > 150 && rgb[1] < 90
  assert.ok(red(boxColor(tools.ffmpeg, video, 0.3, top)), 'full-frame video before the scene')
  const stageTop = boxColor(tools.ffmpeg, video, 2.0, top)
  assert.ok(Math.max(...stageTop) < 90, `dark backdrop above the card in the scene: ${stageTop.map(Math.round)}`)
  assert.ok(red(boxColor(tools.ffmpeg, video, 2.0, card)), 'the speaker card at the bottom in the scene')
  assert.ok(red(boxColor(tools.ffmpeg, video, 4.2, top)), 'full-frame video again after the scene')
  assert.deepEqual(errors, [])
})
