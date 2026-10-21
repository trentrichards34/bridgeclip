// Motion graphics: Auto on Create (Automatic).
// 1. The option sits right under the look: Off the first time with a one-line explanation, one click turns it on,
//    the Review step shows it, the request carries it, and it is remembered with the member's style.
// 2. A real run (fake transcription and planner, everything else real): the planner's stat and list moments are
//    checked against what was said (a made-up number is dropped), drawn offscreen, laid over the finished clip
//    (a sampled frame shows the card), recorded for the editor, and opening the clip in the editor shows them
//    in the Graphics row. With Stage layouts on, the list is stage size: the clip switches to the stage layout
//    around it (backdrop at the top, the speaker in a card), and the editor's Scenes row shows that scene.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

const PERSON = path.join(__dirname, '../../engine/tests/fixtures/portrait_person.jpg')
const checked = async (locator) => (await locator.getAttribute('aria-checked')) === 'true'

/** With BRIDGECLIP_E2E_SHOTS set, a picture of the window. */
async function shot(page, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, name) })
}

function ffmpegPath() {
  for (const candidate of [process.env.FFMPEG_PATH, 'ffmpeg']) {
    if (!candidate) continue
    try { execFileSync(candidate, ['-version'], { stdio: 'ignore' }); return candidate } catch { /* next */ }
  }
  return null
}

test('Create: the Motion graphics skill starts Off, one click turns it on, Review lists it, the request carries it and it is remembered', { timeout: 180000 }, async (t) => {
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) { t.skip('ffmpeg is needed for the source video'); return }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-auto-graphics-ui-'))
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(userData, { recursive: true })
  const video = path.join(root, 'my talk.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-i', PERSON, '-t', '3', '-r', '24', '-vf', 'scale=720:1280,format=yuv420p', '-c:v', 'libx264', video])
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const stub = (root) => app.evaluate(({ ipcMain, BrowserWindow }, root) => {
    globalThis.graphicsTest = { submitted: null }
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('system:checkTools')
    ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
    ipcMain.removeHandler('job:start')
    ipcMain.handle('job:start', (_event, config) => {
      globalThis.graphicsTest.submitted = config
      const now = new Date().toISOString()
      return { jobId: 'graphics-job', queued: false, job: { id: 'graphics-job', revision: 1, request: config, status: 'downloading', percent: 5, step: 'Downloading video',
        clipsDone: 0, clipsTotal: 0, error: null, errorHint: null, output: null, outputDir: root, queuedAt: now, startedAt: now, finishedAt: null } }
    })
    BrowserWindow.getAllWindows()[0].setSize(1280, 900)
  }, root)
  await stub(root)
  await page.reload()
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, video)

  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await page.getByText('my talk.mp4').first().waitFor()
  const steps = page.getByRole('navigation', { name: 'Create steps' })
  await steps.getByRole('button', { name: /Look/ }).click()
  await page.getByTestId('style-board').waitFor()
  // One home: Motion graphics is a skill (Off the first time), with no second Auto/Off row under the look.
  const panel = page.getByTestId('skills-panel')
  const graphics = panel.getByRole('switch', { name: 'Motion graphics', exact: true })
  assert.equal(await checked(graphics), false)
  assert.equal(await page.getByRole('radiogroup', { name: 'Motion graphics' }).count(), 0)
  // Nothing more to set, so no "More options" link that goes nowhere.
  assert.equal(await panel.locator('[data-skill="motion_graphics"]').getByRole('button', { name: 'More options' }).count(), 0)
  // One click.
  await graphics.click()
  assert.equal(await checked(graphics), true)
  await panel.scrollIntoViewIfNeeded()
  await shot(page, 'create-motion-graphics.png')

  // Review lists it under Skills, by the same name, with a way back to change it.
  await steps.getByRole('button', { name: /Review/ }).click()
  const row = page.locator('dl > div').filter({ has: page.getByText('Skills', { exact: true }) })
  assert.match(await row.locator('dd').innerText(), /(^| · )Motion graphics( · |$)/)
  await row.getByRole('button', { name: 'Edit skills' }).waitFor()
  await shot(page, 'create-review-graphics.png')
  await page.getByRole('button', { name: 'Generate clips', exact: true }).click()
  await page.getByRole('button', { name: 'Clip another video' }).waitFor()
  const submitted = await app.evaluate(() => globalThis.graphicsTest.submitted)
  assert.equal(submitted.motionGraphics, true)
  assert.equal(submitted.workflow, 'automatic')

  // Remembered with the member's style: on again after a restart of the page.
  const prefsFile = path.join(userData, 'member-prefs.json')
  for (let i = 0; i < 40 && !(fs.existsSync(prefsFile) && JSON.parse(fs.readFileSync(prefsFile, 'utf8')).create?.motionGraphics === true); i++) await new Promise((r) => setTimeout(r, 100))
  assert.equal(JSON.parse(fs.readFileSync(prefsFile, 'utf8')).create.motionGraphics, true)
  await page.reload()
  await stub(root)
  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await page.getByText('my talk.mp4').first().waitFor()
  await steps.getByRole('button', { name: /Look/ }).click()
  assert.equal(await checked(page.getByTestId('skills-panel').getByRole('switch', { name: 'Motion graphics', exact: true })), true)
  assert.deepEqual(errors, [])
})

/** Mean absolute difference (0-255) between the same box of two frames of a video. */
function boxDifference(ffmpeg, video, a, b, [x, y, w, h]) {
  const grab = (seconds) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const one = grab(a), two = grab(b)
  let sum = 0
  for (let i = 0; i < one.length; i++) sum += Math.abs(one[i] - two[i])
  return sum / one.length
}

/** Source time → output time through the kept ranges (and speed). */
function outputMs(ranges, speed, t) {
  let before = 0
  for (const [a, b] of ranges) {
    if (t >= a && t <= b) return (before + t - a) / speed
    before += b - a
  }
  return null
}

test('a Create run with Motion graphics: Auto and Stage layouts draws said-only cards and a stage scene, and the editor shows them', { timeout: 420000 }, async (t) => {
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-auto-graphics-run-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  // The member's talk: a person on a plain backdrop, 24 s, filmed upright.
  const video = path.join(root, 'money talk.mp4')
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-i', PERSON, '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '24', '-r', '30',
    '-vf', 'scale=720:1280,format=yuv420p', ...tools.encoder, '-c:a', 'aac', '-shortest', video])
  // The engine's Python, with the stand-ins for its paid calls first on its path.
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-create')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '', jevEnabled: 'off' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_URL: 'http://127.0.0.1:9/none' } })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); if (!process.env.BRIDGECLIP_E2E_KEEP) fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  // A fake OpenRouter key so the run starts (Linux without a keyring only offers plain text, which the app refuses for keys).
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
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, video)
  // The member picks the video (that's what lets the app read it), then the run starts with Motion graphics: Auto.
  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await page.getByText('money talk.mp4').first().waitFor()
  const started = await page.evaluate((videoUrl) => window.bridgeclip.job.start({
    videoUrl, workflow: 'automatic', clippingMode: 'quality', maxClips: 1, autoClipCount: false, durationRanges: ['xshort'], aspectRatio: '9:16',
    layoutStyle: 'auto', layoutVision: false, pacing: 'tight', videoSpeed: 1, includeCaptions: true, captionPreset: 'pop', includeTitle: true,
    titleStyle: 'headline', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, qualityBar: 'off', headlineVoice: 'creator',
    motionGraphics: true, stageLayouts: true, startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null
  }), video)
  const run = path.join(library, started.jobId)
  // Done: the run finishes (graphics drawn and laid before it shows as done).
  let job = null
  for (let i = 0; i < 600; i++) {
    job = (await page.evaluate(() => window.bridgeclip.job.list())).find((item) => item.id === started.jobId)
    if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  assert.equal(job.status, 'completed', `${job.status}: ${job.error ?? ''} ${job.step ?? ''}`)
  assert.ok(!/motion graphics/i.test(job.step ?? ''), `no failure note: ${job.step}`)

  // The planner was asked in the same call; the made-up $90,000 card was dropped; the two said cards were drawn.
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
  const layout = output.metrics.clip_layouts[0]
  assert.deepEqual(layout.graphics.map((g) => [g.template, g.origin, g.fields.value ?? g.fields.title]), [['stat', 'auto', '$15,000'], ['list', 'auto', 'Three steps']])
  assert.equal(output.metrics.requested_settings.motion_graphics, true)
  assert.equal(fs.existsSync(path.join(run, 'auto-graphics.json')), false, 'the plan is used once')
  const renders = fs.readdirSync(path.join(run, '.graphics')).filter((name) => name.endsWith('.mov'))
  assert.equal(renders.length, 2)
  // Stage layouts: the list is a stage card with a stage scene around it (source time); the stat stays a card.
  assert.deepEqual(layout.graphics.map((g) => g.size), ['card', 'stage'])
  assert.equal(output.metrics.requested_settings.stage_layouts, true)
  assert.equal(layout.stage_scenes?.length, 1)
  const [stage] = layout.stage_scenes
  assert.equal(stage.scene, 'stage')
  assert.ok(stage.start_ms <= layout.graphics[1].at_ms && stage.end_ms >= layout.graphics[1].at_ms + layout.graphics[1].duration_ms, JSON.stringify(stage))
  // Its items come in as they're said.
  assert.equal(layout.graphics[1].fields.item_ms.split('\n').length, 3)

  // A frame of the finished clip shows the stat card while it plays, in the band under the hook (a still backdrop,
  // so the same box after the card is gone is the clip alone).
  const clip = path.join(run, 'clip_00.mp4')
  const stat = layout.graphics[0], list = layout.graphics[1]
  const start = outputMs(layout.kept_source_ms, 1, stat.at_ms) / 1000
  const statEnd = outputMs(layout.kept_source_ms, 1, stat.at_ms + stat.duration_ms) / 1000
  const listStart = outputMs(layout.kept_source_ms, 1, list.at_ms) / 1000
  assert.ok(start >= 1, `never in the first second (${start})`)
  assert.ok(statEnd <= listStart, 'never two at once')
  // The stage layout is drawn: the speaker's card sits at the bottom with backdrop above it (the left edge of the
  // caption band, which is the picture itself before the scene).
  const edge = [8, 1060, 24, 80]
  const staged = boxDifference(tools.ffmpeg, clip, Math.max(0, start - 0.6), listStart + 1.5, edge)
  assert.ok(staged > 20, `the stage backdrop shows during the stage scene (difference ${staged.toFixed(1)})`)
  const band = [140, 420, 800, 260]
  const during = boxDifference(tools.ffmpeg, clip, start + 1.4, statEnd + 0.3, band)
  assert.ok(during > 25, `the stat card shows in its band while it plays (difference ${during.toFixed(1)})`)
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    for (const [name, at] of [['auto-clip-stat.png', start + 1.6], ['auto-clip-list.png', listStart + 3.2], ['auto-clip-between.png', statEnd + 0.3], ['auto-clip-stage.png', listStart + 1.5]]) {
      execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', clip, '-frames:v', '1', path.join(shots, name)])
    }
  }

  // Editable afterwards: open the clip in the editor; its Graphics row shows the two cards.
  await page.getByRole('button', { name: /^Library/ }).first().click()
  await page.getByRole('button', { name: /^Open money talk/ }).first().click()
  await page.getByRole('button', { name: 'Actions for “Fifteen thousand a month”', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit headline', exact: true }).click()
  // The run used the member's own file: the editor copies it in first.
  await page.getByRole('dialog').getByRole('button', { name: 'Open editor', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Clip editor' })
  await editor.waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: /^Stat counter at / }).waitFor()
  await page.getByRole('button', { name: /^Numbered list at / }).waitFor()
  const project = JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json'), 'utf8'))
  assert.deepEqual(project.candidates[0].graphics.map((g) => [g.id, g.origin]), layout.graphics.map((g) => [g.id, 'auto']))
  // ...and its Scenes row shows the stage scene the run drew.
  assert.deepEqual(project.candidates[0].stage_scenes, layout.stage_scenes)
  await page.locator('.editor-scene-block.scene-stage').first().waitFor()
  assert.equal(await page.locator('.editor-scene-block.scene-stage').count(), 1)
  if (shots) await page.screenshot({ path: path.join(shots, 'auto-editor-graphics.png') })
  assert.deepEqual(errors, [])
})
