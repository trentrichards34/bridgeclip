// Clip editor, Hook & CTA: how long the hook stays on screen, and trial reels (Instagram): hook ideas from a stand-in
// model, two ticked (one edited), one click makes a clip per hook and bakes them, each named after its hook.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine, openEditorTab } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

test('hook duration and trial reels: ideas, two ticked, a clip per hook baked and named after it', { timeout: 420000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-editor-trials-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'trials-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 360; project.height = 640; project.aspect_ratio = '9:16'
  for (const c of project.candidates) { c.captions = false; c.scenes = [c.scenes[0]] }
  project.candidates[0].hook = { text: 'The original hook', look: { look: 'white', color: '#FFFFFF', font: 'clean' } }
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'trials-run', source_video_title: 'Editor trials', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
  // The engine with the stand-in model (tests/main/fake-ai-edit): the hook ideas are fixed, everything else is real.
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))
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
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length) })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Editor trials', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  await openEditorTab(page, 'Hook & CTA')

  // How long the hook stays: every length, and the whole video; saved on the clip (the bake reads hideAfterS).
  const stays = page.getByLabel('Hook stays on screen', { exact: true })
  await stays.click()
  await page.getByRole('option', { name: '8 seconds', exact: true }).click()
  for (let i = 0; i < 60 && saved().candidates[0].hook.look.hideAfterS !== 8; i++) await page.waitForTimeout(100)
  assert.equal(saved().candidates[0].hook.look.hideAfterS, 8)

  // Hook ideas (the stand-in model), two ticked for trial reels, the second one's words edited.
  await page.getByRole('button', { name: 'Suggest hooks', exact: true }).click()
  await page.getByText('The event changed everything', { exact: true }).waitFor({ timeout: 90000 })
  await page.getByLabel('Trial reel: The event changed everything', { exact: true }).check()
  await page.getByLabel('Trial reel: That explains the result', { exact: true }).check()
  await page.getByLabel('Trial reel hook 2', { exact: true }).fill('That explains the whole result')
  await page.getByTestId('make-trial-reels').click()
  await page.getByText(/^Baked 2 ready clips\./).waitFor({ timeout: 300000 })

  // Two new clips, named after their hooks, with the clip's look; both baked into the Library under this run.
  const p = saved()
  const trials = p.candidates.filter((c) => c.title === 'The event changed everything' || c.title === 'That explains the whole result')
  assert.equal(trials.length, 2)
  for (const c of trials) {
    assert.equal(c.hook.text, c.title); assert.equal(c.hook.look.hideAfterS, 8); assert.equal(c.status, 'baked')
    assert.deepEqual(c.ranges, p.candidates[0].ranges)
  }
  const clips = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'))).clips
  for (const title of ['The event changed everything', 'That explains the whole result']) {
    const clip = clips.find((x) => x.headline === title || x.summary === title || x.title === title)
    assert.ok(clip, `${title} in the Library: ${JSON.stringify(clips.map((x) => [x.headline, x.summary]))}`)
    assert.ok(fs.existsSync(path.join(run, `clip_${String(clip.clip_index).padStart(2, '0')}.mp4`)))
  }
  // The hook ideas' cost was recorded (one small call).
  assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'))).metrics.api_costs.editor_hooks.estimated_cost_usd, 0.004)
  assert.deepEqual(errors, [])
})
