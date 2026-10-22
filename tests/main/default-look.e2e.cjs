const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const VOICE = 'Core promise: pull-ups for busy parents. Voice: plain and warm. Proof: real results only.'
const checked = async (locator) => (await locator.getAttribute('aria-checked')) === 'true'

/**
 * The default look flows into every tool: Edit my recording, Avatar Studio and
 * B-roll video start from it; a look or brand picked for one video (there, or
 * on Create) never changes the default; a new default reaches the tools whose
 * look wasn't changed, and leaves the ones that were.
 */
test('Default look: every tool starts from it, per-video changes never move it, and a new default follows through', { timeout: 300000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-default-look-e2e-'))
  const userData = path.join(root, 'user-data')
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ ipcMain }, root) => {
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('system:checkTools')
    ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
    // One avatar, so Avatar Studio shows its script and look.
    ipcMain.removeHandler('avatars:list')
    ipcMain.handle('avatars:list', () => [{ id: 'maya12345', name: 'Maya', kind: 'ai', description: 'A friendly coach', voice: { provider: 'elevenlabs', voice: 'Brian' },
      clonedVoice: null, consentAt: null, createdAt: '2026-10-01T00:00:00.000Z', heygen: null, portraitPath: '', pictures: [], reactions: [] }])
  }, root)
  // Two looks with different caption styles and hook colors.
  await page.evaluate(async (voice) => {
    await window.bridgeclip.brandIdentities.save({ name: 'Alpha', text: voice, look: { color: '#FFD60A', captionPreset: 'hype', headlineLook: { look: 'brand', color: '#FFD60A', font: 'condensed' } } })
    await window.bridgeclip.brandIdentities.save({ name: 'Beta', text: voice, look: { color: '#38CCFF', captionPreset: 'neon' } })
  }, VOICE)
  await page.reload()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  const prefs = () => JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8'))
  const nav = page.getByRole('navigation', { name: 'Main' })
  const looks = page.getByRole('radiogroup', { name: 'Your looks' })
  const makeDefault = async (name) => {
    await nav.getByRole('button', { name: 'Brand look', exact: true }).click()
    await looks.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
    await page.getByTestId('look-editor').getByRole('button', { name: 'Make default' }).click()
    await looks.getByRole('radio', { name: `${name}, default look` }).waitFor()
  }

  await makeDefault('Alpha')
  await page.waitForTimeout(600)
  const alphaId = prefs().defaultBrandId
  assert.match(alphaId, /^[a-f0-9]{16}$/)

  // Edit my recording starts from it.
  await nav.getByRole('button', { name: 'Edit my recording', exact: true }).click()
  await page.getByTestId('edit-setup-look').waitFor()
  await page.getByText('Alpha', { exact: true }).first().waitFor()
  assert.match(await page.getByTestId('edit-setup-look').textContent(), /Hype captions/)

  // Avatar Studio: its look (and its brand for the script).
  await nav.getByRole('button', { name: 'Avatar Studio', exact: true }).click()
  await page.getByText('Alpha', { exact: true }).first().waitFor()
  await page.getByText(/Hype captions/).first().waitFor()

  // B-roll video: its caption style.
  await nav.getByRole('button', { name: 'B-roll video', exact: true }).click()
  const captions = page.getByRole('radiogroup', { name: 'Caption style' })
  await captions.waitFor()
  assert.equal(await checked(captions.getByRole('radio', { name: /^Hype/ })), true, 'B-roll video starts from the default caption style')
  // A different caption style for this video only.
  await captions.getByRole('radio', { name: /^Paper/ }).click()
  assert.equal(await checked(captions.getByRole('radio', { name: /^Paper/ })), true)

  // Create: another brand for one run doesn't change the default.
  await nav.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('radiogroup', { name: 'Workflow', exact: true }).getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByPlaceholder('YouTube, Twitch VOD or direct video link').fill('https://example.com/video.mp4')
  await page.getByRole('button', { name: 'Use link', exact: true }).click()
  await page.getByRole('navigation', { name: 'Create steps' }).getByRole('button', { name: /^Step \d: Look$/ }).click()
  await page.getByRole('combobox', { name: 'Brand identity' }).getByText('Alpha').waitFor()
  await page.getByRole('combobox', { name: 'Brand identity' }).click()
  await page.getByRole('option', { name: /^Beta/ }).click()
  await page.getByRole('combobox', { name: 'Brand identity' }).getByText('Beta').waitFor()
  await page.waitForTimeout(1200)
  assert.equal(prefs().create.brandIdentityId !== alphaId, true, 'Create remembers its own pick')
  assert.equal(prefs().defaultBrandId, alphaId, 'a brand picked on Create is for that run only')
  await nav.getByRole('button', { name: 'Brand look', exact: true }).click()
  await looks.getByRole('radio', { name: 'Alpha, default look' }).waitFor()

  // A new default: Edit my recording (unchanged there) follows it; B-roll video keeps the style picked for that video.
  await makeDefault('Beta')
  await page.waitForTimeout(600)
  assert.notEqual(prefs().defaultBrandId, alphaId)
  await nav.getByRole('button', { name: 'Edit my recording', exact: true }).click()
  await page.getByTestId('edit-setup-look').waitFor()
  await page.getByText('Beta', { exact: true }).first().waitFor()
  assert.match(await page.getByTestId('edit-setup-look').textContent(), /Neon captions/)
  await nav.getByRole('button', { name: 'B-roll video', exact: true }).click()
  await captions.waitFor()
  assert.equal(await checked(captions.getByRole('radio', { name: /^Paper/ })), true, 'a look changed for one video stays as picked')

  // A fresh start keeps the default.
  await page.reload()
  await nav.getByRole('button', { name: 'Brand look', exact: true }).click()
  await looks.getByRole('radio', { name: 'Beta, default look' }).waitFor()
  assert.deepEqual(errors, [])
})
