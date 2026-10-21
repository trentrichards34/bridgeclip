// The second reel's looks in the clip editor, driven in the app: a Stage scene on the Grid backdrop with the Arch
// card (saved, previewed), an Orbit and a Screen recording of part of the clip added from the Graphics picker, then
// the bake: the arch card reaches the frame's bottom corners on the grid, and the window plays the clip's own video
// from its "Starts at" second (a different color from the video under it).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { loadMain } = require('../zernio/support/load-main.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

function boxColor(ffmpeg, video, seconds, [x, y, w, h]) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const sum = [0, 0, 0]
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += raw[i + c]
  return sum.map((n) => n / (raw.length / 3))
}

test('grid backdrop, arch card, an orbit and a screen recording: saved, previewed and baked', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-editor-reel2-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'reel2-run')
  fs.mkdirSync(run, { recursive: true })
  // Red for the first 6 s of the source, then green: the window (from 1 s in) shows red over the green part.
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd02020:size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'color=c=0x20c040:size=640x360:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 640; project.height = 360
  for (const c of project.candidates) { c.captions = false; c.scenes = [c.scenes[0]] }
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'reel2-run', source_video_title: 'Editor reel two', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
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
  await page.getByRole('button', { name: 'Open Editor reel two', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const savedWhen = async (check, what) => {
    for (let i = 0; i < 60; i++) { try { if (check(saved().candidates[0])) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save ${what}: ${JSON.stringify(saved().candidates[0][what])}`)
  }
  const seek = (ms) => page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(ms))

  // A Stage scene at 2.0 s on the Grid backdrop with the Arch card.
  await seek(2000)
  await page.getByRole('button', { name: 'Add scene at playhead', exact: true }).click()
  await savedWhen((c) => c.stage_scenes?.length === 1, 'stage_scenes')
  const tools2 = page.getByRole('group', { name: 'Selected scene' })
  await tools2.getByRole('combobox', { name: 'Backdrop', exact: true }).click()
  await page.getByRole('option', { name: 'Grid', exact: true }).click()
  await tools2.getByRole('radio', { name: 'Arch', exact: true }).click()
  await savedWhen((c) => c.stage_scenes?.[0]?.card === 'arch', 'stage_scenes')
  assert.deepEqual(saved().candidates[0].stage_scenes, [{ scene: 'stage', start_ms: 2000, end_ms: 5000, backdrop: 'grid', card: 'arch' }])
  await seek(3500)
  await page.locator('.editor-scenes-overlay[data-scene="stage"] .editor-scenes-card[data-card="arch"]').waitFor()

  // An Orbit on the stage: labels, then a generic icon for each.
  await seek(2200)
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('region', { name: 'Choose a graphic' }).waitFor()
  await page.getByRole('button', { name: 'Add Orbit', exact: true }).click()
  await page.getByLabel('Orbit labels (one per line, 3 to 6)', { exact: true }).fill('Ads\nPages\nEmails')
  await page.getByRole('radiogroup', { name: 'Graphic size', exact: true }).getByRole('radio', { name: 'Stage', exact: true }).click()
  await savedWhen((c) => c.graphics?.[0]?.fields.items === 'Ads\nPages\nEmails' && c.graphics[0].size === 'stage', 'graphics')
  assert.equal(saved().candidates[0].graphics[0].template, 'orbit')
  await page.locator('.editor-graphics-overlay .mg-orbit').waitFor()

  // A Screen recording of this clip's own video from 1 s in, on the green part (7 s of source).
  await seek(7000)
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('button', { name: 'Add Screen recording', exact: true }).click()
  await page.getByLabel('Screen recording starts at (seconds into the video)', { exact: true }).fill('1')
  await page.getByRole('radio', { name: 'Square', exact: true }).click()
  await savedWhen((c) => c.graphics?.some((g) => g.template === 'screen_frame' && g.fields.from === '1' && g.fields.shape === 'square'), 'graphics')
  const screen = saved().candidates[0].graphics.find((g) => g.template === 'screen_frame')
  assert.equal(screen.fields.video, 'source')
  // The preview plays the clip's video in the window.
  await page.locator('.editor-graphics-overlay video.mg-screen-video').waitFor()
  await page.getByText('All changes saved', { exact: true }).waitFor()

  // Bake.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 200000 })
  const video = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'))).clips[0].s3_url
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  // Output time = (source − 1000) / 1.25 on the first cut: the stage scene is 0.8–3.2 s.
  if (shots) { fs.mkdirSync(shots, { recursive: true }); execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', '2.2', '-i', video, '-frames:v', '1', '-y', path.join(shots, 'baked-grid-arch.png')]) }
  const red = (rgb) => rgb[0] > 150 && rgb[1] < 90
  assert.ok(red(boxColor(tools.ffmpeg, video, 2.2, [0, 1900, 16, 16])), 'the arch card reaches the bottom-left corner')
  const top = boxColor(tools.ffmpeg, video, 2.2, [40, 40, 200, 40])
  assert.ok(Math.min(...top) > 190 && top[2] > top[1], `the grid's lavender top: ${top.map(Math.round)}`)
  // The window's hole (main's own layout) shows red (source from 1 s) while green plays under it.
  const L = loadMain("export * from './src/shared/graphic-layout'; export * from './src/shared/motion-graphics'")
  const c = saved().candidates[0]
  const spec = L.graphicSpec(saved(), c, screen), w = L.graphicWindow(c, screen)
  const { hole } = L.screenFrameLayout(spec)
  const mid = (w.start_ms + w.duration_ms / 2) / 1000
  const inside = boxColor(tools.ffmpeg, video, mid, [Math.round(hole.x + hole.w / 2 - 20), Math.round(hole.y + hole.h / 2 - 20), 40, 40])
  assert.ok(red(inside), `the window plays the clip from 1 s (red): ${inside.map(Math.round)}`)
  const outside = boxColor(tools.ffmpeg, video, mid, [10, 1880, 30, 30])
  assert.ok(outside[1] > 150 && outside[0] < 90, `the video under it is the green part: ${outside.map(Math.round)}`)
  assert.deepEqual(errors, [])
})
