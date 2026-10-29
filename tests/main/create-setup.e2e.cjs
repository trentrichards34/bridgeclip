const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

test('Create: the key is asked for once, setup folds to a progress line, a typed link counts, and options sit under Customize', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-create-setup-e2e-'))
  const appDir = buildApp(path.join(root, 'app'))
  const session = await launchApp({ appDir, userDataDir: path.join(root, 'user-data') })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))

  // No key yet: one place to paste it, inside the checklist's first row.
  const checklist = page.getByTestId('setup-checklist')
  const keyRow = checklist.locator('[data-setup-item="openrouter"]')
  await keyRow.getByLabel('OpenRouter key', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('OpenRouter key', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Connect OpenRouter', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Someone else’s video?', { exact: true }).count(), 0)
  await page.getByText('Clips from your videos or ones you have permission to use.', { exact: false }).waitFor()
  // The sidebar status fits.
  const status = page.getByRole('button', { name: 'Add your OpenRouter key', exact: true })
  assert.equal(await status.innerText(), 'Add your key')
  assert.equal(await status.locator('span.truncate').evaluate((el) => el.scrollWidth <= el.clientWidth), true)

  // Key saved (and tools ready): the checklist is one line that opens again.
  await app.evaluate(({ ipcMain }, root) => {
    globalThis.createSetup = { submitted: null }
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('system:checkTools')
    ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
    ipcMain.removeHandler('job:start')
    ipcMain.handle('job:start', (_event, config) => { globalThis.createSetup.submitted = config; return { jobId: 'create-setup', queued: false } })
  }, root)
  await page.reload()
  await checklist.getByRole('button', { name: 'Continue setup' }).waitFor()
  assert.equal(await checklist.getAttribute('data-compact'), 'true')
  assert.match(await checklist.getByRole('status').innerText(), /^\d+ of \d+ set up/)
  assert.equal(await checklist.locator('[data-setup-item]').count(), 0)
  await checklist.getByRole('button', { name: 'Continue setup' }).click()
  await checklist.locator('[data-setup-item="brand"]').waitFor()
  await checklist.getByRole('button', { name: 'Show less' }).click()
  await checklist.getByRole('button', { name: 'Continue setup' }).waitFor()
  // The form starts near the top now.
  const stepsBar = page.getByRole('navigation', { name: 'Create steps' })
  assert.ok((await stepsBar.boundingBox()).y < 400, 'the step bar is in the first screen')

  // A link typed into the field counts without Use link; Next uses it.
  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByRole('textbox', { name: 'Video link' }).fill('https://example.com/talk.mp4')
  await page.getByRole('button', { name: 'Next: Clips', exact: true }).click()
  await page.getByTestId('clips-summary').getByText('Recommended', { exact: true }).waitFor()
  assert.equal(await page.getByRole('radiogroup', { name: 'Clipping mode' }).count(), 0)
  // Back on Video: leaving the field also uses a link.
  await stepsBar.getByRole('button', { name: /^Step \d: Video$/ }).click()
  await page.getByRole('button', { name: 'Remove video' }).click()
  await page.getByRole('textbox', { name: 'Video link' }).fill('https://example.com/other.mp4')
  await page.keyboard.press('Tab')
  await page.getByText('example.com/other.mp4', { exact: true }).waitFor()
  await page.getByTestId('remix-note').getByRole('button', { name: 'Use Remix' }).waitFor()

  // Format: Customize reveals the options; Clips: plain mode names and help for the selected mode.
  // More options (format, framing, speed): Customize reveals the options.
  const inView = async (id) => { const box = await page.locator(`#create-step-${id}`).boundingBox(); return box.y >= 0 && box.y < 800 }
  await stepsBar.getByRole('button', { name: /^Step \d: More options$/ }).click()
  await page.getByTestId('format-summary').getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('radiogroup', { name: 'Video speed' }).waitFor()
  assert.ok(await inView('format'), 'the opened step is in view')
  await stepsBar.getByRole('button', { name: /^Step \d: Clips$/ }).click()
  await page.waitForTimeout(300)
  assert.ok(await inView('clips'))
  await page.getByTestId('clips-summary').getByRole('button', { name: 'Customize' }).click()
  const help = page.getByTestId('clipping-mode-help')
  assert.match(await help.innerText(), /^Uses the most accurate AI/)
  await page.getByRole('radio', { name: /^Lower cost/ }).click()
  assert.match(await help.innerText(), /^Uses lower-cost AI/)
  assert.equal(await page.getByText(/GLM|Whisper/).first().isVisible(), false, 'model names wait under Details')
  await page.getByTestId('clipping-mode-details').getByText('Details', { exact: true }).click()
  await page.getByText(/Planning: GLM 5.3 Flash/).waitFor()
  await page.getByTestId('clips-changed').getByText(/Lower cost/).waitFor()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await page.getByRole('button', { name: 'Clip another video' }).waitFor()
  const submitted = await app.evaluate(() => globalThis.createSetup.submitted)
  assert.equal(submitted.videoUrl, 'https://example.com/other.mp4')
  assert.equal(submitted.clippingMode, 'economy')
  assert.equal(submitted.headlineVoice, 'clipper', 'third-person headlines stay the default')
  assert.deepEqual(errors, [])
})
