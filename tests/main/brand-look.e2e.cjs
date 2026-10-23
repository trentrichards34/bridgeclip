const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const VOICE = 'Core promise: pull-ups for busy parents. Voice: plain and warm. Proof: real results only.'
const checked = async (locator) => (await locator.getAttribute('aria-checked')) === 'true'

test('Brand look: make looks, set color, type, captions and a CTA, make one the default, and Create starts from it', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-brand-look-e2e-'))
  const userData = path.join(root, 'user-data')
  const cta = path.join(root, 'thanks-for-watching.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x22aa88:s=270x480:d=2', '-f', 'lavfi', '-i', 'sine=d=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', cta])
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
  }, root)
  await page.reload()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))

  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('button', { name: 'Brand look', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Set your style once' }).waitFor()
  await page.getByText('Every tool starts from your default look. Change it for one video, or one clip, whenever you like.').waitFor()
  await page.getByText('No look yet', { exact: true }).waitFor()

  // A first look: saved as the default, since there was none.
  await page.getByRole('button', { name: 'New look', exact: true }).first().click()
  const editor = page.getByTestId('look-editor')
  await editor.getByLabel('Look name').fill('Plain')
  assert.equal(await editor.getByRole('button', { name: 'Save new look' }).isDisabled(), true, 'a look needs its brand voice')
  await editor.getByRole('textbox', { name: 'Brand voice' }).fill(VOICE)
  await editor.getByRole('button', { name: 'Save new look' }).click()
  await page.getByText('Saved “Plain” as your default look').waitFor()
  const looks = page.getByRole('radiogroup', { name: 'Your looks' })
  await looks.getByRole('radio', { name: 'Plain, default look' }).waitFor()

  // A second look with a color, a hook type and look, a caption style and a handle.
  await page.getByRole('button', { name: 'New look', exact: true }).first().click()
  await editor.getByLabel('Look name').fill('Signature')
  await editor.getByRole('radiogroup', { name: 'Accent color' }).getByRole('radio', { name: /^Yellow/ }).click()
  await editor.getByRole('radiogroup', { name: 'Headline type' }).getByRole('radio', { name: 'Bold condensed' }).click()
  await editor.getByRole('radiogroup', { name: 'Hook text look' }).getByRole('radio', { name: 'Brand color' }).click()
  await editor.getByRole('radiogroup', { name: 'Caption style' }).getByRole('radio', { name: 'Hype', exact: true }).click()
  await editor.getByLabel('Handle', { exact: true }).fill('@signature')
  await editor.getByRole('textbox', { name: 'Brand voice' }).fill(VOICE)
  // The live preview follows the edits.
  const preview = page.getByRole('complementary', { name: 'Live preview' }).getByTestId('style-preview')
  assert.equal(await preview.getAttribute('data-hook'), 'brand')
  await editor.getByRole('button', { name: 'Save new look' }).click()
  await page.getByText('Saved “Signature”', { exact: true }).waitFor()
  await looks.getByRole('radio', { name: 'Plain, default look' }).waitFor()
  assert.equal(await checked(looks.getByRole('radio', { name: 'Signature' })), true)

  // The CTA library: add a clip (it's marked for this look), rename it, and save.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, cta)
  await editor.getByRole('button', { name: 'Add CTA' }).click()
  const ctas = editor.getByRole('list', { name: 'Your calls to action' })
  const row = ctas.getByRole('listitem').first()
  await row.waitFor()
  const use = row.getByRole('switch', { name: /^Use .* with this look$/ })
  assert.equal(await checked(use), true, 'a CTA just added is this look’s')
  const name = row.getByRole('textbox', { name: /^Name of / })
  await name.fill('Follow for more')
  await name.press('Enter')
  await ctas.getByRole('textbox', { name: 'Name of Follow for more' }).waitFor()
  await editor.getByRole('button', { name: 'Save look' }).click()
  await page.getByText('Saved “Signature”', { exact: true }).waitFor()
  await editor.getByText('All changes saved.').waitFor()

  // My logos: add one (checked by its bytes, kept for every look), name it and the other words for it.
  const logoFile = path.join(root, 'meta_logo.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1877F2:s=64x64', '-frames:v', '1', logoFile])
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, logoFile)
  const logos = editor.getByRole('list', { name: 'Your logos' })
  await logos.getByText(/No logos yet/).waitFor()
  await editor.getByRole('button', { name: 'Add logo' }).click()
  const logoName = logos.getByRole('textbox', { name: 'Name of meta logo' })
  await logoName.fill('Meta')
  await logoName.press('Enter')
  const others = logos.getByRole('textbox', { name: 'Other words for Meta' })
  await others.fill('Facebook, Instagram ads')
  await others.press('Enter')
  await page.waitForFunction(async () => JSON.stringify((await window.bridgeclip.logos.list()).map((l) => [l.name, l.aliases])) === '[["Meta",["Facebook","Instagram ads"]]]')
  await logos.getByRole('img').or(logos.locator('img')).first().waitFor()

  const stored = () => fs.readdirSync(path.join(userData, 'brand-identities')).filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(userData, 'brand-identities', file), 'utf8')))
  const signature = stored().find((brand) => brand.name === 'Signature')
  assert.equal(signature.look.color, '#FFD60A')
  assert.equal(signature.look.captionPreset, 'hype')
  assert.deepEqual(signature.look.headlineLook, { look: 'brand', color: '#FFD60A', font: 'condensed' })
  assert.equal(signature.look.handle, '@signature')
  assert.match(signature.look.ctaId, /^[a-f0-9]{16}$/)
  assert.equal(signature.text, VOICE)

  // Make it the default: the badge moves.
  await editor.getByRole('button', { name: 'Make default' }).click()
  await page.getByText('“Signature” is your default look').waitFor()
  await looks.getByRole('radio', { name: 'Signature, default look' }).waitFor()
  await editor.getByTestId('default-look').waitFor()
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: path.join(shots, 'brand-look.png'), timeout: 10000 }).catch(() => undefined)
  }

  // Create starts from it: the brand, its caption style, hook look and call to action.
  await nav.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Turn a long video into clips' }).waitFor()
  await page.getByRole('radiogroup', { name: 'Workflow', exact: true }).getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByPlaceholder('YouTube, Twitch VOD or direct video link').fill('https://example.com/video.mp4')
  await page.getByRole('button', { name: 'Use link', exact: true }).click()
  await page.getByTestId('create-sentence').getByText('Hype captions').waitFor()
  await page.getByRole('navigation', { name: 'Create steps' }).getByRole('button', { name: /^Step \d: Look$/ }).click()
  await page.getByRole('combobox', { name: 'Brand identity' }).getByText('Signature').waitFor()
  assert.equal(await checked(page.getByRole('radiogroup', { name: 'Caption style' }).getByRole('radio', { name: 'Hype' })), true)
  assert.equal(await checked(page.getByRole('radiogroup', { name: 'Hook text look' }).getByRole('radio', { name: /^Brand color/ })), true)
  assert.equal(await checked(page.getByRole('radiogroup', { name: 'Call to action' }).getByRole('radio', { name: /^Follow for more/ })), true)
  assert.equal(await checked(page.getByRole('switch', { name: 'Show my handle' })), true)
  await page.waitForTimeout(1200)
  const prefs = JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8'))
  assert.equal(prefs.create.brandIdentityId, signature.id)
  assert.equal(prefs.remix.brandIdentityId, signature.id, 'Remix starts from the default look too')
  assert.deepEqual(errors, [])
})
