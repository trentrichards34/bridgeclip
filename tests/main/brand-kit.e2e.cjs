const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const KIT = 'a1b2c3d4e5f60718'
const PLAIN = 'b1b2c3d4e5f60718'
const TEXT = 'Core promise: pull-ups for busy parents. Voice: plain and warm. Proof: Dana did 5 pull-ups in 8 weeks.'

/** Two brands: one with a look (color, hook look, captions, keyword, handle), one saved before the kit existed. */
function seedBrands(userData) {
  const dir = path.join(userData, 'brand-identities')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${KIT}.json`), JSON.stringify({
    id: KIT, name: 'Pull-Up Lab', text: TEXT, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    look: { color: '#FF8800', headlineLook: { look: 'brand', color: '#FF8800', font: 'serif' }, captionPreset: 'boxed', ctaKeyword: 'PULL', ctaOffer: 'my 4-week plan',
      handle: '@pulluplab', handlePosition: 'top-right' }
  }))
  fs.writeFileSync(path.join(dir, `${PLAIN}.json`), JSON.stringify({ id: PLAIN, name: 'Old brand', text: TEXT, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }))
}

async function pickBrand(page, name) {
  await page.getByRole('combobox', { name: 'Brand identity' }).click()
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click()
}

// Remix keeps "Look & call to action" folded until opened.
async function openRemixLook(page) {
  const toggle = page.locator('button[aria-controls="remix-look"]')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

const checked = async (locator) => (await locator.getAttribute('aria-checked')) === 'true'

test('picking a brand fills the Remix and Create style fields once; re-picking it keeps the member’s edits', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-brand-e2e-'))
  const userData = path.join(root, 'user-data')
  seedBrands(userData)
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ ipcMain }, root) => {
    globalThis.brandTest = { submitted: null }
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('system:checkTools')
    ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
    ipcMain.removeHandler('job:start')
    ipcMain.handle('job:start', (_event, config) => {
      globalThis.brandTest.submitted = config
      const now = new Date().toISOString()
      return { jobId: 'brand-job', queued: false, job: { id: 'brand-job', revision: 1, request: config, status: 'downloading', percent: 5, step: 'Downloading video',
        clipsDone: 0, clipsTotal: 0, error: null, errorHint: null, output: null, outputDir: root, queuedAt: now, startedAt: now, finishedAt: null } }
    })
  }, root)
  await page.reload()

  // Remix: the brand's look fills hook look, captions, keyword and the handle toggle.
  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Remix', exact: true }).waitFor()
  await openRemixLook(page)
  const hookLooks = page.getByRole('radiogroup', { name: 'Hook text look' })
  assert.equal(await checked(hookLooks.getByRole('radio', { name: /^White bar/ })), true)
  await pickBrand(page, 'Pull-Up Lab')
  assert.equal(await checked(hookLooks.getByRole('radio', { name: /^Brand color/ })), true)
  await page.getByText('#FF8800').first().waitFor()
  assert.equal(await checked(page.getByRole('radiogroup', { name: 'Caption style' }).getByRole('radio', { name: 'Boxed' })), true)
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), 'PULL')
  assert.equal(await page.getByLabel('What they get').inputValue(), 'my 4-week plan')
  assert.equal(await checked(page.getByRole('switch', { name: 'Show my handle' })), true)
  // The member changes a field, then picks the same brand again: nothing is overwritten.
  await page.getByLabel('Comment keyword').fill('SALES')
  await pickBrand(page, 'Pull-Up Lab')
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), 'SALES')
  // A brand saved before the kit leaves the form as it is (and has no handle to show).
  await pickBrand(page, 'Old brand')
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), 'SALES')
  assert.equal(await page.getByRole('switch', { name: 'Show my handle' }).count(), 0)
  // Back to the kit brand: a change of brand, so its look applies again.
  await pickBrand(page, 'Pull-Up Lab')
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), 'PULL')

  // Create: the brand picker in the Captions step fills that step's look.
  await page.getByRole('button', { name: 'Create', exact: true }).first().click()
  await page.getByPlaceholder('YouTube, Twitch VOD or direct video link').fill('https://example.com/video.mp4')
  await page.getByRole('button', { name: 'Use link', exact: true }).click()
  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  const steps = page.getByRole('navigation', { name: 'Create steps' })
  await steps.getByRole('button', { name: /Look/ }).click()
  // The style board's hook row: a headline look (the white bar) rather than the title card.
  await page.getByRole('radiogroup', { name: 'Hook text look' }).getByRole('radio', { name: 'White bar' }).click()
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), '')
  await pickBrand(page, 'Pull-Up Lab')
  assert.equal(await checked(page.getByRole('radiogroup', { name: 'Hook text look' }).getByRole('radio', { name: /^Brand color/ })), true)
  assert.equal(await checked(page.getByRole('radiogroup', { name: 'Caption style' }).getByRole('radio', { name: 'Boxed' })), true)
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), 'PULL')
  await page.getByText('“Comment PULL and I\'ll send you my 4-week plan.”').waitFor()
  assert.equal(await checked(page.getByRole('switch', { name: 'Show my handle' })), true)
  await page.getByLabel('What they get').fill('my free plan')
  // Extras aren't part of a brand: picking it again keeps them.
  await page.getByRole('group', { name: 'Extras: pick as many as you like' }).getByRole('checkbox', { name: 'Accent words' }).click()
  await pickBrand(page, 'Pull-Up Lab')
  assert.equal(await checked(page.getByRole('group', { name: 'Extras: pick as many as you like' }).getByRole('checkbox', { name: 'Accent words' })), true)
  assert.equal(await page.getByLabel('What they get').inputValue(), 'my free plan')

  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: path.join(shots, 'create-brand.png'), fullPage: true, timeout: 10000 }).catch(() => undefined)
  }

  await steps.getByRole('button', { name: /Review/ }).click()
  // Review lists the brand, the keyword line and the handle.
  await page.getByText('Pull-Up Lab · titles in its voice', { exact: true }).waitFor()
  await page.getByText('Caption ends with “Comment PULL and I\'ll send you my free plan.”', { exact: true }).waitFor()
  await page.getByText('@pulluplab · top right', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Generate clips', exact: true }).click()
  await page.getByRole('button', { name: 'View job' }).waitFor()
  const submitted = await app.evaluate(() => globalThis.brandTest.submitted)
  assert.deepEqual([submitted.brandIdentityId, submitted.ctaKeyword, submitted.ctaOffer, submitted.showHandle], [KIT, 'PULL', 'my free plan', true])
  assert.deepEqual(submitted.headlineLook, { look: 'brand', color: '#FF8800', font: 'serif' })
  assert.equal(submitted.captionPreset, 'boxed')
  assert.deepEqual(submitted.lookExtras, ['accent_words'])

  // The choice is remembered with the Create style.
  await page.waitForTimeout(1200)
  const prefs = JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8'))
  assert.equal(prefs.create.brandIdentityId, KIT)
  assert.equal(prefs.create.showHandle, true)
  assert.deepEqual(errors, [])
})

test('the brand dialog saves a look with a handle and keeps old brands working', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-brand-dialog-e2e-'))
  const userData = path.join(root, 'user-data')
  seedBrands(userData)
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Remix', exact: true }).waitFor()
  await openRemixLook(page)
  await pickBrand(page, 'Old brand')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit brand identity' })
  await dialog.getByText('Look', { exact: true }).waitFor()
  await dialog.getByLabel('Handle').fill('@oldbrand')
  await dialog.getByRole('radio', { name: 'Bottom left' }).click()
  await dialog.getByLabel('Brand comment keyword').fill('A')
  assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true)
  await dialog.getByLabel('Brand comment keyword').fill('guide')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  // Its new look applied to the form, and the handle can be shown.
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), 'GUIDE')
  assert.equal(await checked(page.getByRole('switch', { name: 'Show my handle' })), true)
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'brand-identities', `${PLAIN}.json`), 'utf8'))
  assert.deepEqual(saved.look, { ctaKeyword: 'GUIDE', handle: '@oldbrand', handlePosition: 'bottom-left' })
  assert.equal(saved.text, TEXT)
  assert.deepEqual(errors, [])
})
