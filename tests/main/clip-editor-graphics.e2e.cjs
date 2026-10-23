// Clip editor motion graphics, driven in the app: add a stat counter at the playhead from the Graphics row,
// edit its words in the Graphics tab, see it live over the Output monitor, undo/redo it, then bake the clip and
// check a frame of the baked clip shows the graphic where it should be.
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

test('a stat graphic added in the editor saves, undoes, previews live and is baked into the clip', { timeout: 240000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-editor-graphics-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'graphics-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 640; project.height = 360
  // No captions, so the clip bakes without libass; the graphic's band is then the top of the frame.
  for (const c of project.candidates) c.captions = false
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'graphics-run', source_video_title: 'Editor graphics', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
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
  await page.getByRole('button', { name: 'Open Editor graphics', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const settle = () => page.getByText('All changes saved', { exact: true }).waitFor()
  /** Autosave runs shortly after an edit: wait until the saved project matches. */
  const savedWhen = async (check) => {
    for (let i = 0; i < 60; i++) { try { if (check(saved())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save as expected: ${JSON.stringify(saved().candidates[0].graphics)}`)
  }

  // The Graphics row → template picker (live previews) → a stat counter at the playhead (the clip's start).
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('region', { name: 'Choose a graphic' }).waitFor()
  // 28 templates, then the Effects (one tile each, fx-effects.e2e.cjs covers those).
  assert.equal(await page.locator('.editor-graphic-tile:not([aria-label^="Add effect"])').count(), 28)
  await page.waitForFunction(() => document.querySelectorAll('.editor-graphic-tile .mg-root').length === 28)
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'editor-graphic-picker.png') }) }
  await page.getByRole('button', { name: 'Add Stat counter', exact: true }).click()
  await page.getByLabel('Stat counter number', { exact: true }).fill('$1,200/month')
  await page.getByLabel('Stat counter label', { exact: true }).fill('from one clip a day')
  await savedWhen((p) => p.candidates[0].graphics?.[0]?.fields.label === 'from one clip a day')
  let graphics = saved().candidates[0].graphics
  assert.equal(graphics.length, 1)
  assert.deepEqual([graphics[0].template, graphics[0].at_ms, graphics[0].duration_ms, graphics[0].placement], ['stat', 1000, 3500, 'top'])
  assert.deepEqual(graphics[0].fields, { value: '$1,200/month', label: 'from one clip a day' })
  // The block on the timeline and the live animation over the Output monitor (playhead inside the graphic).
  await page.getByRole('button', { name: /^Stat counter at 0:00\.000, 3\.5 seconds$/ }).waitFor()
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('3800')
  await page.locator('.editor-graphics-overlay .mg-stat-value').waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-graphics-overlay .mg-stat-value')?.textContent?.includes('1,200'))
  // The Graphics tab fits its 300px column.
  const overflow = await page.locator('.editor-inspector-body').evaluate((el) => el.scrollWidth - el.clientWidth)
  assert.ok(overflow <= 1, `the Graphics tab spills ${overflow}px sideways`)
  const tabs = await page.locator('.editor-tabs').evaluate((el) => el.scrollWidth - el.clientWidth)
  assert.ok(tabs <= 1, `the inspector tabs spill ${tabs}px`)
  if (shots) await page.screenshot({ path: path.join(shots, 'editor-graphics-row.png') })
  // Undo steps back through the edits until the graphic is gone; redo brings it all back, like any edit.
  const undo = page.getByRole('button', { name: 'Undo', exact: true }), redo = page.getByRole('button', { name: 'Redo', exact: true })
  let steps = 0
  while (await page.getByRole('button', { name: /^Stat counter at / }).count() && steps < 8) { await undo.click(); steps++ }
  assert.ok(steps >= 3, `undo steps: ${steps}`)
  await savedWhen((p) => (p.candidates[0].graphics ?? []).length === 0)
  for (let i = 0; i < steps; i++) await redo.click()
  await savedWhen((p) => p.candidates[0].graphics?.[0]?.fields.label === 'from one clip a day')
  await settle()

  // Bake: the graphic is rendered offscreen and laid over the clip by the engine.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 150000 })
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json')))
  const video = output.clips[0].s3_url
  const renders = fs.readdirSync(path.join(run, '.graphics')).filter((n) => n.endsWith('.mov'))
  assert.equal(renders.length, 1)
  // The stat card (light paper) sits in the top band while the graphic plays (output 0–2.8 s), and is gone after.
  const card = [110, 400, 100, 90]
  const during = boxColor(tools.ffmpeg, video, 1.5, card), after = boxColor(tools.ffmpeg, video, 3.6, card)
  if (shots) execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', '1.5', '-i', video, '-frames:v', '1', '-y', path.join(shots, 'baked-graphic.png')])
  assert.ok(during.every((c) => c > 200), `the baked frame shows the stat card: ${during.map(Math.round)}`)
  assert.ok(Math.min(...after) < 200 || Math.abs(after[0] - after[2]) > 20, `the card is gone after the graphic: ${after.map(Math.round)}`)

  // Near the clip's end (10 s), a new graphic starts earlier so all of it plays inside the cut.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill('9800')
  const addTitle = async () => {
    await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
    await page.getByRole('button', { name: 'Add Title slam', exact: true }).click()
  }
  await addTitle()
  await savedWhen((p) => p.candidates[0].graphics?.length === 2)
  assert.deepEqual(saved().candidates[0].graphics.map((g) => [g.template, g.at_ms, g.duration_ms, g.placement]), [['stat', 1000, 3500, 'top'], ['title', 7500, 2500, 'middle']])
  // Another one at the same time moves to the next free band: top, then bottom; with none free it stays and both are flagged.
  await addTitle(); await addTitle(); await addTitle()
  await savedWhen((p) => p.candidates[0].graphics?.length === 5)
  assert.deepEqual(saved().candidates[0].graphics.slice(1).map((g) => g.placement).sort(), ['bottom', 'middle', 'middle', 'top'])
  assert.equal(await page.locator('.editor-graphic-block.clash').count(), 2)
  await page.getByRole('note').filter({ hasText: 'Another graphic is at the middle at the same time' }).waitFor()
  // Trim the clip's end: a graphic that now runs past it is flagged on the row and in the tab.
  // The cut list is under the full timeline: Big preview (on with the Graphics tab) is turned off to reach it.
  const big = page.getByRole('button', { name: 'Big preview', exact: true })
  assert.equal(await big.getAttribute('aria-pressed'), 'true')
  const tall = (await page.locator('.editor-output-monitor > canvas').first().boundingBox()).height
  await big.click()
  const small = (await page.locator('.editor-output-monitor > canvas').first().boundingBox()).height
  assert.ok(tall > small * 1.3, `the big preview is bigger: ${tall} vs ${small}`)
  await page.getByLabel('Cut 2 end', { exact: true }).fill('0:09.000')
  await page.getByLabel('Cut 2 end', { exact: true }).press('Enter')
  await page.locator('.editor-graphic-block.partly').first().waitFor()
  await page.getByRole('note').filter({ hasText: 'Part of it is outside the cut' }).waitFor()
  if (shots) await page.screenshot({ path: path.join(shots, 'editor-graphics-warnings.png') })
  // Let the trim save, so closing the app doesn't stop on the unsaved-changes prompt.
  await savedWhen((p) => p.candidates[0].ranges[p.candidates[0].ranges.length - 1][1] === 9000)
  assert.deepEqual(errors, [])
})
