// Skills and "Say what it's for" on Create (Automatic).
// The Skills list sits at the top of the Look step: each switch is the same setting as its detailed control
// (Rough cut is Format's "Cut dead air", Zoom is the Zoom extra, which then has one home: Skills). "More options"
// opens something real (B-roll's timing in place) or isn't there. Music and Voice cleanup carry a Beta chip.
// "What's this video for?" and a reference picture ("A look you like", chosen in the file dialog, checked and copied
// into the app's data by main) sit on the Video step and ride along with the request; the picture's colors can be
// used with one click. Review names each skill as Skills does. Nothing spills sideways at 1280x800 or 1024x700.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const PERSON = path.join(__dirname, '../../engine/tests/fixtures/portrait_person.jpg')
const checked = async (locator) => (await locator.getAttribute('aria-checked')) === 'true'

/** With BRIDGECLIP_E2E_SHOTS set, a picture of the window. */
async function shot(page, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  // Playwright's picture; if it waits on fonts too long, the window's own (taken in main).
  const ok = await page.screenshot({ path: file, timeout: 10000 }).then(() => true, () => false)
  if (ok) return
  const app = page.__app
  if (!app) return
  const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
  if (data) fs.writeFileSync(file, Buffer.from(data, 'base64'))
}

function ffmpegPath() {
  for (const candidate of [process.env.FFMPEG_PATH, 'ffmpeg']) {
    if (!candidate) continue
    try { execFileSync(candidate, ['-version'], { stdio: 'ignore' }); return candidate } catch { /* next */ }
  }
  return null
}

/** Sets the window's content size and waits for the page to follow (asking again if a resize is dropped). */
async function resize(app, page, width, height) {
  for (let i = 0; i < 20; i++) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
    if (await page.waitForFunction((w) => window.innerWidth === w, width, { timeout: 1500 }).then(() => true, () => false)) return
  }
  throw new Error(`The window did not resize to ${width}x${height}.`)
}

/** Scrolls an element to the top of the window and lets it paint (for the pictures). */
async function showTop(page, locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(250)
}

/** How far the page (and the Skills panel) reach past the window's width. */
const overflow = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-testid="skills-panel"]')
  const purpose = document.querySelector('[data-testid="purpose-fields"]')
  return {
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
    purpose: purpose ? purpose.scrollWidth - purpose.clientWidth : 0
  }
})

test('Create: Skills over existing settings, plus what the video is for and a reference picture', { timeout: 240000 }, async (t) => {
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) { t.skip('ffmpeg is needed for the source video'); return }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-skills-'))
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(userData, { recursive: true })
  const video = path.join(root, 'my talk.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-i', PERSON, '-t', '3', '-r', '24', '-vf', 'scale=720:1280,format=yuv420p', '-c:v', 'libx264', video])
  // The reference: a mostly light picture with a strong red band.
  const reference = path.join(root, 'a look I like.png')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xF4F1EA:s=600x900', '-vf', 'drawbox=x=0:y=600:w=600:h=300:color=0xD7263D:t=fill', '-frames:v', '1', reference])
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  page.__app = app
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ ipcMain, BrowserWindow }, root) => {
    globalThis.skillsTest = { submitted: null, support: [] }
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, pexelsConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('system:checkTools')
    ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
    // The model list is OpenRouter's (online): this run's planner accepts images, at a listed price.
    ipcMain.removeHandler('reference:support')
    ipcMain.handle('reference:support', (_event, id, model) => {
      globalThis.skillsTest.support.push({ id, model })
      return { model: 'anthropic/claude-opus-5.5', modelName: 'Claude Opus 5.5', supportsImages: true, tokens: 932, costUsd: 0.0047 }
    })
    ipcMain.removeHandler('job:start')
    ipcMain.handle('job:start', (_event, config) => {
      globalThis.skillsTest.submitted = config
      const now = new Date().toISOString()
      return { jobId: 'skills-job', queued: false, job: { id: 'skills-job', revision: 1, request: config, status: 'downloading', percent: 5, step: 'Downloading video',
        clipsDone: 0, clipsTotal: 0, error: null, errorHint: null, output: null, outputDir: root, queuedAt: now, startedAt: now, finishedAt: null } }
    })
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 800)
  }, root)
  await page.reload()
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, video)

  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await page.getByText('my talk.mp4').first().waitFor()
  const steps = page.getByRole('navigation', { name: 'Create steps' })
  await steps.getByRole('button', { name: /^Step \d: Look$/ }).click()

  // The Skills list comes first on the look step, above the style board.
  const panel = page.getByTestId('skills-panel')
  await panel.waitFor()
  assert.ok((await panel.boundingBox()).y < (await page.getByTestId('style-board').boundingBox()).y, 'Skills sit above the look')
  const names = await panel.locator('[data-skill]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-skill')))
  assert.deepEqual(names, ['rough_cut', 'captions', 'motion_graphics', 'stage_layouts', 'zoom', 'broll', 'sound_effects', 'music', 'voice_cleanup'])
  // Stage layouts, B-roll, Music and Voice cleanup are in beta.
  assert.equal(await panel.getByText('Beta', { exact: true }).count(), 4)
  const skill = (name) => panel.getByRole('switch', { name, exact: true })
  // They show the draft's own settings: dead air is cut and captions are on by default.
  assert.equal(await checked(skill('Rough cut')), true)
  assert.equal(await checked(skill('Captions')), true)
  assert.equal(await checked(skill('Zoom')), false)

  // Zoom is the style board's Zoom extra; on Create it has one home, Skills, so the Extras row leaves it out.
  await skill('Zoom').click()
  assert.equal(await checked(skill('Zoom')), true)
  const extras = page.getByRole('group', { name: 'Extras: pick as many as you like' })
  await extras.getByRole('checkbox', { name: 'Keyword pill' }).waitFor()
  assert.equal(await extras.getByRole('checkbox', { name: 'Zoom' }).count(), 0)
  await page.getByText(/Zoom is in Skills above\./).waitFor()
  await skill('Music').click()
  await skill('Voice cleanup').click()
  // "More options" only where there's more to set: Rough cut, Motion graphics and Zoom have none.
  const more = (id) => panel.locator(`[data-skill="${id}"]`).getByRole('button', { name: 'More options' })
  for (const id of ['rough_cut', 'motion_graphics', 'zoom']) assert.equal(await more(id).count(), 0, id)
  // B-roll's opens in place: when the footage plays (the same choice as Format's B-roll); picking one turns B-roll on.
  await more('broll').click()
  const when = panel.getByRole('radiogroup', { name: 'When B-roll plays' })
  await when.getByRole('radio', { name: 'Whole clip' }).click()
  assert.equal(await checked(skill('B-roll')), true)
  await showTop(page, panel)
  await shot(page, 'create-broll-more-options-1280x800.png')
  await panel.getByRole('button', { name: 'Fewer options' }).click()
  assert.equal(await when.count(), 0)
  await skill('B-roll').click()
  // Rough cut off here shows as "Cut dead air" off in Format, and back.
  await skill('Rough cut').click()
  assert.equal(await checked(skill('Rough cut')), false)
  await steps.getByRole('button', { name: /^Step \d: More options$/ }).click()
  const deadAir = page.getByRole('switch', { name: 'Cut dead air and filler words' })
  await deadAir.waitFor()
  assert.equal(await checked(deadAir), false)
  await deadAir.click()
  await steps.getByRole('button', { name: /^Step \d: Look$/ }).click()
  assert.equal(await checked(skill('Rough cut')), true, 'the Skills switch follows the detailed control')
  assert.equal(await page.getByTestId('purpose-fields').count(), 0, 'what it’s for is on the Video step now')

  // What it's for, and a reference picture chosen in the file dialog: on the Video step, after the source.
  await steps.getByRole('button', { name: /^Step \d: Video$/ }).click()
  const fields = page.getByTestId('purpose-fields')
  await fields.waitFor()
  assert.ok((await fields.boundingBox()).y > (await page.getByRole('heading', { name: 'Choose a video' }).boundingBox()).y)
  await page.getByLabel('What’s this video for?').fill('Instagram reel selling my coaching call')
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, reference)
  await page.getByRole('button', { name: 'Choose a picture' }).click()
  const card = page.getByTestId('reference-card')
  await card.waitFor()
  await card.getByText('a look I like.png').waitFor()
  // Plain words for the cost; the token estimate waits under Details.
  await page.getByTestId('reference-support').getByText('Adds a little to the AI cost (under 1¢).', { exact: true }).waitFor()
  assert.equal(await card.getByText(/input tokens/).isVisible(), false)
  await card.getByTestId('reference-cost-details').getByText('Details', { exact: true }).click()
  await card.getByText(/^About 932 extra input tokens on each planning call, about \$0\.0047 at Claude Opus 5\.5’s listed price\. An estimate\.$/).waitFor()
  // The suggested look is worked out here from the picture: its red as a swatch (no color code), and Paper captions for a light picture.
  await card.getByText('This color on the hook bar, with Paper captions (your picture is mostly light).', { exact: true }).waitFor()
  assert.equal(await card.getByText(/#[0-9A-F]{6}/i).count(), 0)
  const color = (await card.getByTestId('reference-color').getAttribute('data-color')).slice(1)
  const near = (hex, want) => [0, 2, 4].every((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(want.slice(i, i + 2), 16)) <= 6)
  assert.ok(near(color, 'D7263D'), `the picture's red, not ${color}`)
  await card.getByRole('button', { name: 'Use colors from my reference' }).click()
  await card.getByRole('button', { name: 'Colors used' }).waitFor()
  const kept = fs.readdirSync(path.join(userData, 'references'))
  assert.equal(kept.length, 1)
  assert.match(kept[0], /^[a-f0-9]{24}\.png$/)
  const support = await app.evaluate(() => globalThis.skillsTest.support)
  assert.equal(support.at(-1).id, kept[0].slice(0, 24))
  assert.deepEqual(support.at(-1).model, { clippingMode: 'quality' })

  // Nothing spills sideways, at either window size.
  for (const [width, height] of [[1280, 800], [1024, 700]]) {
    await resize(app, page, width, height)
    await showTop(page, page.getByTestId('purpose-fields'))
    assert.deepEqual(await overflow(page), { page: 0, panel: 0, purpose: 0 })
    await shot(page, `create-purpose-${width}x${height}.png`)
    await steps.getByRole('button', { name: /^Step \d: Look$/ }).click()
    await showTop(page, panel)
    assert.deepEqual(await overflow(page), { page: 0, panel: 0, purpose: 0 })
    await shot(page, `create-skills-${width}x${height}.png`)
    await extras.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(250)
    await shot(page, `create-extras-${width}x${height}.png`)
    await steps.getByRole('button', { name: /^Step \d: Video$/ }).click()
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))

  // Review lists them; the request carries the same fields the detailed controls set.
  await steps.getByRole('button', { name: /^Step \d: Review$/ }).click()
  const value = (label) => page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText()
  assert.equal(await value('For'), 'Instagram reel selling my coaching call')
  assert.equal(await value('Reference'), 'a look I like.png')
  assert.equal(await value('Skills'), 'Rough cut · Captions · Zoom · Music (Calm pad) · Voice cleanup')
  assert.equal(await value('Hook text'), 'Brand color')
  for (const gone of ['Audio', 'Pacing', 'Graphics', 'Title']) assert.equal(await page.locator('dl dt').getByText(gone, { exact: true }).count(), 0, gone)
  for (const [width, height] of [[1280, 800], [1024, 700]]) {
    await resize(app, page, width, height)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
    await showTop(page, page.locator('dl'))
    await shot(page, `create-review-${width}x${height}.png`)
    await page.locator('dl > div').last().evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await page.waitForTimeout(250)
    await shot(page, `create-review-end-${width}x${height}.png`)
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
  await page.getByRole('button', { name: 'Generate clips', exact: true }).click()
  await page.getByRole('button', { name: 'Clip another video' }).waitFor()
  const submitted = await app.evaluate(() => globalThis.skillsTest.submitted)
  assert.equal(submitted.pacing, 'tight')
  assert.ok(submitted.lookExtras.includes('punch_zoom'))
  assert.deepEqual([submitted.music, submitted.voiceCleanup, submitted.includeCaptions], [true, true, true])
  assert.equal(submitted.purpose, 'Instagram reel selling my coaching call')
  assert.equal(submitted.referenceImage, kept[0].slice(0, 24))
  assert.deepEqual([submitted.captionPreset, submitted.headlineLook.look, submitted.headlineLook.color], ['paper', 'brand', `#${color}`])

  // Main finds the picture by its id only: a made-up one is refused with a plain message.
  const refused = await page.evaluate(() => window.bridgeclip.reference.bytes('f'.repeat(24)).then(() => 'ok', (error) => String(error.message)))
  assert.match(refused, /no longer there/)
  // Music and voice cleanup are remembered with the member's style; the purpose and picture are not.
  const prefsFile = path.join(userData, 'member-prefs.json')
  for (let i = 0; i < 40 && !(fs.existsSync(prefsFile) && JSON.parse(fs.readFileSync(prefsFile, 'utf8')).create?.music === true); i++) await new Promise((r) => setTimeout(r, 100))
  const remembered = JSON.parse(fs.readFileSync(prefsFile, 'utf8')).create
  assert.deepEqual([remembered.music, remembered.voiceCleanup, 'purpose' in remembered, 'reference' in remembered], [true, true, false, false])
  assert.deepEqual(errors, [])
})

test('Remix and Edit my recording: Skills on camera and the purpose fields fit the window', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-skills-remix-'))
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(userData, { recursive: true })
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  page.__app = app
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ ipcMain, BrowserWindow }, root) => {
    globalThis.remixSkills = { submitted: null }
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, pexelsConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('remix:start')
    ipcMain.handle('remix:start', (_event, request) => { globalThis.remixSkills.submitted = request; throw new Error('Stopped here by the test.') })
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 800)
  }, root)
  await page.reload()
  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  // (Remix opens on You on camera, the only side while Avatar Studio is switched off.)
  // The look folds open; Skills come first in it, on camera only.
  const look = page.locator('[data-remix-field="look"]')
  if ((await look.getByRole('button').first().getAttribute('aria-expanded')) !== 'true') await look.getByRole('button').first().click()
  const panel = look.getByTestId('skills-panel')
  await panel.waitFor()
  const names = await panel.locator('[data-skill]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-skill')))
  assert.deepEqual(names, ['captions', 'zoom', 'music', 'voice_cleanup'])
  await panel.getByRole('switch', { name: 'Music', exact: true }).click()
  await panel.getByRole('switch', { name: 'Zoom', exact: true }).click()
  await page.getByLabel('What’s this video for?').fill('TikTok take on coaching prices')
  for (const [width, height] of [[1280, 800], [1024, 700]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
    await page.waitForFunction((w) => window.innerWidth === w, width)
    await showTop(page, panel)
    assert.deepEqual(await overflow(page), { page: 0, panel: 0, purpose: 0 })
    await shot(page, `remix-skills-${width}x${height}.png`)
    await showTop(page, page.getByTestId('purpose-fields'))
    await shot(page, `remix-purpose-${width}x${height}.png`)
  }
  await page.getByLabel('Video links').fill('https://www.instagram.com/reel/DdurluTvRVB/')
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  await page.getByRole('button', { name: 'Continue to recording', exact: true }).click()
  for (let i = 0; i < 40 && !(await app.evaluate(() => globalThis.remixSkills.submitted)); i++) await new Promise((r) => setTimeout(r, 100))
  const submitted = await app.evaluate(() => globalThis.remixSkills.submitted)
  assert.equal(submitted.music, true)
  assert.ok(submitted.lookExtras.includes('punch_zoom'))
  assert.equal(submitted.includeCaptions, true)
  assert.equal(submitted.purpose, 'TikTok take on coaching prices')
  assert.equal('referenceImage' in submitted, false)

  // Edit my recording: the purpose fields sit in "3 · Edit it".
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 700))
  await page.getByRole('button', { name: /^Edit my recording/ }).first().click()
  await page.getByRole('heading', { name: '03 · What’s it for?' }).waitFor()
  const fields = page.getByTestId('purpose-fields')
  assert.equal(await fields.count(), 1)
  await showTop(page, page.getByRole('heading', { name: '03 · What’s it for?' }))
  assert.deepEqual(await overflow(page), { page: 0, panel: 0, purpose: 0 })
  await shot(page, 'edit-purpose-1024x700.png')
  assert.deepEqual(errors, [])
})
