const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { launchApp, buildApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine, openEditorTab } = require('./editor-e2e-tools.cjs')

// Camera + screen: a camera recording and a screen recording made at the same time, lined up by their sound, made into
// one split-screen reel, then opened in the clip editor where one part is switched to "just my screen" and baked again.

/** Words of a line from `start` seconds, each `step` long (as Scribe returns them, in seconds). */
function say(text, start, step) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.05).toFixed(3), type: 'word' }))
}
// Uneven timings, so the sound lines up one way only.
const WORDS = [...say('Here is the trick.', 0.3, 0.29), ...say('Watch this dashboard.', 2.1, 0.41), ...say('Click here to see the numbers.', 3.9, 0.33),
  ...say('Follow me for more.', 6.4, 0.37)]
const OFFSET_S = 1.25

function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return Promise.resolve()
  fs.mkdirSync(dir, { recursive: true })
  return app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    .then((png) => fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))).catch(() => undefined)
}

test('Camera + screen: a screen recording lined up by sound, layouts picked per part, the opening switched to the split in the editor', { timeout: 900000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-screen-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  // A tone of its own pitch wherever each word is said; the screen recording hears it later, duller and quieter.
  const tones = (shift) => WORDS.map((w, i) => `${0.3}*sin(2*PI*${220 + 37 * i}*t)*between(t+${shift},${w.start},${w.end})`).join('+')
  const camera = path.join(root, 'camera take.mp4'), screen = path.join(root, 'Screen Recording.mov')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=9', '-f', 'lavfi', '-i', `aevalsrc='${tones(0)}':s=48000:d=9`,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', camera])
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30', '-f', 'lavfi', '-i', `aevalsrc='${tones(OFFSET_S)}':s=48000:d=7.4`,
    '-f', 'lavfi', '-i', 'anoisesrc=c=pink:a=0.01:r=48000:d=7.4', '-filter_complex', '[1:a]lowpass=f=2500,volume=0.4[v];[v][2:a]amix=inputs=2:normalize=0[a]',
    '-map', '0:v', '-map', '[a]', '-t', '7.4', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', screen])
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))

  // A local stand-in for OpenRouter: Scribe v2 hears the camera recording only.
  const scribe = []
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(req.url === '/api/v1/audio/transcriptions' ? 200 : 404, { 'Content-Type': 'application/json' })
      if (req.url !== '/api/v1/audio/transcriptions') { res.end('{"error":{"code":404,"message":"not here"}}'); return }
      scribe.push(req.url)
      res.end(JSON.stringify({ text: WORDS.map((w) => w.word).join(' '), words: WORDS, usage: { cost: 0.0004, seconds: 9 } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/v1`
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: base, BRIDGECLIP_E2E_OPENROUTER_URL: `${base}/chat/completions` } })
  t.after(async () => {
    server.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1100))
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()
  const pick = (file) => app.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }) }, file)

  // The page refuses a screen recording that wasn't chosen in the file dialog.
  await assert.rejects(page.evaluate((paths) => window.bridgeclip.edit.syncScreen(paths[0], paths[1]), [camera, screen]), /Choose your camera recording again/)

  await page.keyboard.press('Control+e')
  await page.getByRole('heading', { name: 'Edit my recording', level: 1 }).waitFor()
  // Before a camera recording, the screen recording waits.
  assert.equal(await page.getByRole('button', { name: '+ Add a screen recording' }).isDisabled(), true)
  await pick(camera)
  await page.getByRole('button', { name: 'Choose recordings' }).click()
  await page.getByRole('list', { name: 'Your recordings' }).getByText('camera take.mp4').waitFor()
  await pick(screen)
  await page.getByRole('button', { name: '+ Add a screen recording' }).click()
  const box = page.getByTestId('screen-recording')
  await box.getByText('Screen recording · Screen Recording.mov').waitFor()
  // Lined up by sound: the true offset is 1.25 s.
  await box.getByTestId('screen-sync').getByText(/^Lined up by sound: your screen recording starts 1\.2\d s after your camera\.$/).waitFor({ timeout: 60000 })
  const found = await page.getByLabel('Screen recording offset').inputValue()
  assert.ok(Math.abs(Number(found) - OFFSET_S * 1000) <= 30, `found ${found} ms`)
  // A nudge, and back to the sound match; the preview plays both side by side.
  await box.getByRole('button', { name: '0.1 s later' }).click()
  assert.equal(Number(await page.getByLabel('Screen recording offset').inputValue()), Number(found) + 100)
  await box.getByRole('button', { name: 'Back to the sound match' }).click()
  assert.equal(await page.getByLabel('Screen recording offset').inputValue(), found)
  await box.getByRole('button', { name: 'Preview the sync' }).click()
  const preview = box.getByLabel('Sync preview')
  await preview.waitFor({ timeout: 60000 })
  const size = await preview.evaluate((video) => new Promise((resolve) => {
    const done = () => resolve([video.videoWidth, video.videoHeight])
    if (video.readyState >= 1) done(); else video.addEventListener('loadedmetadata', done, { once: true })
  }))
  assert.deepEqual(size, [750, 480])
  await shot(app, 'screen-sync.png')

  await page.getByRole('button', { name: 'Edit my recording', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 180000 })
  assert.equal(scribe.length, 1)
  const status = await page.evaluate(() => window.bridgeclip.edit.status())
  assert.equal(status.screen.name, 'Screen Recording.mov')
  // "Here is the" was said before the screen recording started: it starts out cut.
  assert.deepEqual(status.plan.words.filter((w) => w.cut === 'no_screen').map((w) => w.text), ['Here', 'is', 'the'])
  // The review: the screen's choices; no pop-ups, images, graphics or openings for these reels.
  const choices = page.getByTestId('edit-screen')
  assert.equal(await choices.getByRole('radio', { name: /^Screen \+ me/ }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByTestId('edit-extras').count(), 0)
  assert.equal(await page.getByRole('switch', { name: 'Raw-to-edited opening' }).count(), 0)
  await choices.getByLabel('Screen size').fill('40')
  await shot(app, 'screen-review.png')
  await page.getByRole('button', { name: 'Make my reel' }).click()
  await page.getByText('Your reel is ready').waitFor({ timeout: 600000 })
  await page.getByTestId('screen-done').waitFor()

  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  const folder = path.join(library, run)
  const job = JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8'))
  assert.equal(job.editor_project, true)
  assert.equal(job.metrics.screen_pair, true)
  assert.equal(job.clips.length, 1)
  assert.equal(job.clips[0].editable, undefined)
  const project = JSON.parse(fs.readFileSync(path.join(folder, 'editor-project.json'), 'utf8'))
  assert.equal(project.pair.style, 'screen_top')
  assert.equal(project.pair.split, 0.4)
  const scenes = project.candidates[0].scenes
  // Picked per part: just the camera for the hook, just the screen while it's busy and "click here" is said, the camera
  // again for the call to action.
  assert.deepEqual(scenes.map((s) => s.layout), ['fill', 'inset', 'fill'], JSON.stringify(scenes.map((s) => [s.at_ms, s.layout])))
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', path.join(folder, 'clip_00.mp4')]).toString())
  assert.deepEqual(probe.streams.filter((s) => s.codec_type === 'video').map((s) => [s.width, s.height]), [[1080, 1920]])

  // In the Library: the clip editor, the Screen layout row, and the opening switched to the split (screen on top, 40%).
  await page.getByRole('button', { name: 'Open in Library' }).click()
  await page.getByRole('button', { name: 'Open editor' }).click()
  await openEditorTab(page, 'Framing')
  const layouts = page.getByRole('radiogroup', { name: 'Screen layout' })
  await layouts.waitFor()
  assert.equal(await layouts.getByRole('radio', { name: /Just me/ }).getAttribute('aria-checked'), 'true')
  await layouts.getByRole('radio', { name: /Screen \+ me/ }).click()
  assert.equal(await layouts.getByRole('radio', { name: /Screen \+ me/ }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByLabel('Screen size').inputValue(), '40')
  await shot(app, 'screen-editor.png')
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Bake captions', exact: true }).click()
  // Baking replaces the reel in the Library (same clip).
  const baked = async () => {
    for (let i = 0; i < 300; i++) {
      if (JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8')).clips[0].edited_at) return
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('The clip was not baked again')
  }
  await baked()
  const after = JSON.parse(fs.readFileSync(path.join(folder, 'editor-project.json'), 'utf8'))
  assert.deepEqual([after.candidates[0].scenes[0].layout, after.candidates[0].scenes[0].split], ['split', 0.4])
  assert.equal(after.candidates[0].status, 'baked')
  const remade = JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8'))
  assert.equal(remade.clips.length, 1)
  assert.equal(remade.clips[0].clip_index, 0)
  assert.deepEqual(errors, [])
})
