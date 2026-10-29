// Chapter headers and diagrams in the clip editor, driven in the app: a chapter header added from the Graphics
// picker (label, title, "last until the next chapter"), a Visual scene on the Solid backdrop with a Staircase in it
// (stage size, previewed), then the bake: the hook text is gone once the chapter starts, the header's white words
// sit at the very top, and the diagram's scene is royal blue with white line art on it.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

function pixels(ffmpeg, video, seconds, [x, y, w, h]) {
  return execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
}
function mean(raw) {
  const sum = [0, 0, 0]
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += raw[i + c]
  return sum.map((n) => n / (raw.length / 3))
}
/** Share of near-white pixels in a box. */
function white(raw) {
  let n = 0
  for (let i = 0; i < raw.length; i += 3) if (raw[i] > 225 && raw[i + 1] > 225 && raw[i + 2] > 225) n++
  return n / (raw.length / 3)
}

test('a chapter header and a staircase on the solid backdrop: added, saved, previewed and baked', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-editor-steps-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'steps-run')
  fs.mkdirSync(run, { recursive: true })
  // A dark gray source, so white words and the blue backdrop stand out.
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x303030:size=640x360:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 640; project.height = 360
  for (const c of project.candidates) { c.captions = false; c.scenes = [c.scenes[0]] }
  project.candidates[0].hook = { text: 'How to sell digital products', look: { look: 'floating', color: '#FFFFFF', font: 'serif' } }
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'steps-run', source_video_title: 'Editor steps', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
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
  await page.getByRole('button', { name: 'Open Editor steps', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const savedWhen = async (check, what) => {
    for (let i = 0; i < 60; i++) { try { if (check(saved().candidates[0])) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save ${what}: ${JSON.stringify(saved().candidates[0][what])}`)
  }
  const seek = (ms) => page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(ms))

  // A chapter header at 2.5 s, kept up until the clip ends.
  await seek(2500)
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('region', { name: 'Choose a graphic' }).waitFor()
  await page.getByRole('button', { name: 'Add Chapter header', exact: true }).click()
  await page.getByLabel('Chapter header label (optional)', { exact: true }).fill('Step #1.')
  await page.getByLabel('Chapter header section title', { exact: true }).fill('Come Up With Your Idea')
  await page.getByRole('button', { name: 'Last until the next chapter', exact: true }).click()
  await savedWhen((c) => c.graphics?.[0]?.fields.title === 'Come Up With Your Idea' && c.graphics[0].duration_ms === 10000 - 2500, 'graphics')
  assert.equal(saved().candidates[0].graphics[0].template, 'chapter')
  await page.locator('.editor-graphics-overlay .dg-chapter.style-serif_caps').waitFor()

  // A Visual scene on the Solid backdrop at 7.2 s, and a Staircase in it.
  await seek(7200)
  await page.getByRole('button', { name: 'Add scene at playhead', exact: true }).click()
  await savedWhen((c) => c.stage_scenes?.length === 1, 'stage_scenes')
  const scene = page.getByRole('group', { name: 'Selected scene' })
  await scene.getByRole('radio', { name: 'Visual', exact: true }).click()
  await scene.getByRole('combobox', { name: 'Backdrop', exact: true }).click()
  await page.getByRole('option', { name: 'Solid', exact: true }).click()
  await savedWhen((c) => c.stage_scenes?.[0]?.backdrop === 'solid' && c.stage_scenes[0].scene === 'visual', 'stage_scenes')
  await seek(7300)
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('button', { name: 'Add Staircase', exact: true }).click()
  await page.getByLabel('Staircase steps, bottom to top (one per line, 3 to 6)', { exact: true }).fill('Idea\nAvatar\nPitch')
  await savedWhen((c) => c.graphics?.some((g) => g.template === 'staircase' && g.fields.items === 'Idea\nAvatar\nPitch'), 'graphics')
  const stairs = saved().candidates[0].graphics.find((g) => g.template === 'staircase')
  // Stage size, where it was added (cut to the time left in the clip rather than moved earlier).
  assert.equal(stairs.size, 'stage')
  assert.equal(stairs.at_ms, 7300)
  assert.equal(stairs.at_ms + stairs.duration_ms, 10000)
  await seek(8500)
  await page.locator('.editor-graphics-overlay .dg-staircase').waitFor()
  await page.getByText('All changes saved', { exact: true }).waitFor()

  // Bake.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 200000 })
  const video = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'))).clips[0].s3_url
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  // Output time = (source − 1000) / 1.25 on the first cut; the chapter starts at 1.2 s; the staircase at (4000 + 300) / 1.25.
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    for (const s of [0.5, 2.5, 4.0]) execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', String(s), '-i', video, '-frames:v', '1', '-y', path.join(shots, `steps-${s}.png`)])
  }
  // The hook's white words before the chapter, gone (and the chapter's words in its own band) after.
  const hookBand = [80, 120, 920, 260]
  assert.ok(white(pixels(tools.ffmpeg, video, 0.5, hookBand)) > 0.003, 'the hook shows first')
  const chapterBand = [80, 90, 920, 210]
  assert.ok(white(pixels(tools.ffmpeg, video, 2.5, chapterBand)) > 0.003, 'the chapter header shows at the top')
  const lowerHook = [80, 330, 920, 120]
  assert.ok(white(pixels(tools.ffmpeg, video, 2.5, lowerHook)) < 0.001, 'the hook text is gone once the chapter starts')
  // In the diagram's Visual scene: royal blue backdrop, white lines on it.
  const blue = mean(pixels(tools.ffmpeg, video, 4.0, [10, 1500, 30, 30]))
  assert.ok(blue[2] > 120 && blue[0] < 70, `the solid backdrop is royal blue: ${blue.map(Math.round)}`)
  assert.ok(white(pixels(tools.ffmpeg, video, 4.0, [40, 400, 1000, 1000])) > 0.003, 'the staircase draws white line art')
  // On the solid backdrop it has no panel of its own: the backdrop around it stays one blue; before its scene, nothing of it shows.
  const panelEdge = mean(pixels(tools.ffmpeg, video, 4.0, [10, 700, 20, 20]))
  assert.ok(Math.abs(panelEdge[2] - blue[2]) < 25, `no panel edge on the solid backdrop: ${panelEdge.map(Math.round)} vs ${blue.map(Math.round)}`)
  assert.ok(white(pixels(tools.ffmpeg, video, 2.5, [40, 500, 1000, 800])) < 0.001, 'the staircase waits for its scene')
  assert.deepEqual(errors, [])
})
