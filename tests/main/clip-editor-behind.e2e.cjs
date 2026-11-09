// "Text behind me" in the clip editor, driven in the app: add Big words from the template picker (they start
// behind the speaker), check the "Behind me" switch and the preview's note, switch it off and on, then bake the clip
// and check the engine made the speaker's matte for the graphic's window (a synthetic picture has no person, so
// the words simply show; the matte's file proves the depth reached the engine).
// BEHIND_SOURCE=<a 1080x1920 talking-head mp4> bakes that video instead and keeps the result in BEHIND_OUT.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

test('Big words go behind the speaker: the switch saves the depth and the bake cuts the speaker out for it', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const real = process.env.BEHIND_SOURCE
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-editor-behind-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'behind-run')
  fs.mkdirSync(run, { recursive: true })
  const source = path.join(run, 'editor-source.mp4')
  if (real) fs.copyFileSync(real, source)
  else {
    execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '8', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source])
  }
  fs.copyFileSync(source, path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture)
  Object.assign(project, { width: real ? 1080 : 540, height: real ? 1920 : 960, duration_ms: 8000, title: 'Behind me' })
  project.transcript = [{ start_ms: 0, end_ms: 4000, text: real ? 'I can’t stress this enough, I’m a virtual nobody' : 'Here is the setup.' }]
  project.candidates = [{ ...project.candidates[0], ranges: [[0, 8000]], scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: false, video_speed: 1 }]
  delete project.candidates[0].review
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'behind-run', source_video_title: 'Editor behind', source_video_duration_seconds: 8, clips: [], total_clips: 0, editor_project: true }))
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
  await page.getByRole('button', { name: 'Open Editor behind', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const savedWhen = async (check) => {
    for (let i = 0; i < 60; i++) { try { if (check(saved())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save as expected: ${JSON.stringify(saved().candidates[0].graphics)}`)
  }

  // Big words from the picker, at the playhead (the clip's start): the words said there, behind the speaker.
  await page.getByRole('button', { name: 'Add graphic at playhead', exact: true }).click()
  await page.getByRole('button', { name: 'Add Big words (behind you)', exact: true }).click()
  const words = page.getByLabel('Big words (behind you) words (up to 3)', { exact: true })
  await words.fill(real ? 'Virtual nobody' : 'Paid Creators')
  await savedWhen((p) => p.candidates[0].graphics?.[0]?.fields.text === (real ? 'Virtual nobody' : 'Paid Creators'))
  let g = saved().candidates[0].graphics[0]
  assert.deepEqual([g.template, g.depth, g.placement], ['big_words', 'behind', 'top'])
  const behind = page.getByRole('switch', { name: 'Behind me', exact: true })
  assert.equal(await behind.getAttribute('aria-checked'), 'true')
  // The look: serif, across, scale in (the defaults), then Mixed.
  await page.getByRole('radio', { name: 'Mixed', exact: true }).click()
  await savedWhen((p) => p.candidates[0].graphics[0].fields.style === 'mixed')
  // Off, then on again: the saved graphic follows.
  await behind.click()
  await savedWhen((p) => p.candidates[0].graphics[0].depth === 'front')
  await behind.click()
  await savedWhen((p) => p.candidates[0].graphics[0].depth === 'behind')
  if (real) { await page.getByRole('radio', { name: 'Serif', exact: true }).click(); await savedWhen((p) => p.candidates[0].graphics[0].fields.style === 'serif') }
  // Real timing for the Travis take: "virtual nobody" is said from about 1.9 s.
  if (real) {
    await page.getByRole('slider', { name: 'Fine timeline position' }).fill('1800')
    await page.getByRole('button', { name: 'Start at playhead', exact: true }).click()
    await savedWhen((p) => p.candidates[0].graphics[0].at_ms === 1800)
  }
  // The preview shows the words in front, with a note that the export puts them behind.
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill(real ? '3000' : '1200')
  await page.locator('.editor-graphics-overlay .mg-big-line').first().waitFor()
  await page.getByText('Behind you in the export', { exact: true }).waitFor()
  const shots = process.env.BRIDGECLIP_E2E_SHOTS || process.env.BEHIND_OUT
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'editor-behind.png') }) }
  g = saved().candidates[0].graphics[0]
  assert.equal(g.depth, 'behind')
  await page.getByText('All changes saved', { exact: true }).waitFor()

  // Bake: the engine cuts the speaker out for the graphic's window only, and keeps that matte with the clip's graphics.
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 240000 })
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json')))
  const video = output.clips[0].s3_url
  const mattes = fs.readdirSync(path.join(run, '.graphics', 'mattes')).filter((n) => n.endsWith('.mkv'))
  assert.equal(mattes.length, 1)
  const [, start, length] = /^[a-f0-9]{32}-(\d+)-(\d+)-v\d+\.mkv$/.exec(mattes[0]).map(Number)
  assert.deepEqual([start, length], [real ? 1800 : 0, 2500])
  if (process.env.BEHIND_OUT) {
    fs.copyFileSync(video, path.join(process.env.BEHIND_OUT, 'baked.mp4'))
    for (const s of [1.95, 2.3, 3.0, 3.8, 4.2]) execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', String(s), '-i', video, '-frames:v', '1', '-y', path.join(process.env.BEHIND_OUT, `baked-${s.toFixed(2)}s.png`)])
  }
  assert.deepEqual(errors, [])
})
