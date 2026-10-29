const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const { version } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))

test('Launch shell: Report an issue shows the report and never pastes it into a page, How it works opens the guide, Your data, and a crashed window reloads', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-launch-shell-e2e-'))
  const appDir = buildApp(path.join(root, 'app'))
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, 'member-prefs.json'), JSON.stringify({ version: 1, profile: { goals: ['clips'], platforms: [], onboarding: 'done' }, lastSeenVersion: version }))
  const session = await launchApp({ appDir, userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { level: 1, name: 'Turn a long video into clips' }).waitFor()

  // How it works (Clip) → Guides, at the Clip guide.
  await page.getByRole('button', { name: 'How it works: the Clip guide' }).click()
  await page.getByRole('heading', { level: 1, name: 'Guides' }).waitFor()
  for (let i = 0; i < 40 && await page.evaluate(() => document.activeElement?.id) !== 'guide-clips'; i++) await page.waitForTimeout(50)
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'guide-clips')

  // Help → Report an Issue…: the report first, the public-page warning, Save report to a file. Nothing is copied or pasted.
  const saved = path.join(root, 'saved report.txt')
  await app.evaluate(({ BrowserWindow, Menu, clipboard, dialog, shell }, file) => {
    BrowserWindow.getAllWindows()[0].show = () => {}
    clipboard.writeText('sentinel')
    globalThis.launchShellTest = { opened: [] }
    shell.openExternal = async (url) => { globalThis.launchShellTest.opened.push(url) }
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    const help = Menu.getApplicationMenu().items.find((item) => item.label === 'Help')
    help.submenu.items.find((item) => item.label === 'Report an Issue…').click()
  }, saved)
  const report = page.getByRole('dialog', { name: 'Report an issue' })
  await report.waitFor()
  await report.getByText('This page is public — remove anything private', { exact: true }).waitFor()
  const box = report.getByRole('textbox', { name: 'Support report' })
  for (let i = 0; i < 80 && !(await box.inputValue()).includes('App version'); i++) await page.waitForTimeout(50)
  assert.match(await box.inputValue(), new RegExp(`App version: ${version.replace(/\./g, '\\.')}`))
  await box.fill(`${await box.inputValue()}\nEdited by the member.`)
  await report.getByRole('button', { name: 'Save report to a file' }).click()
  await report.getByText(/Report saved\./).waitFor()
  assert.match(fs.readFileSync(saved, 'utf8'), /App version[\s\S]*Edited by the member\.\n$/)
  await report.getByRole('button', { name: 'Open the public issues page' }).click()
  const opened = () => app.evaluate(() => globalThis.launchShellTest.opened)
  for (let i = 0; i < 40 && (await opened()).length === 0; i++) await page.waitForTimeout(50)
  assert.deepEqual(await opened(), ['https://github.com/trentrichards34/creatorclips-releases/issues'])
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'sentinel', 'the report is never put on the clipboard or into the page by itself')
  await page.keyboard.press('Escape')
  await report.waitFor({ state: 'detached' })

  // Settings → About → Your data.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const yourData = page.locator('#settings-about').getByRole('region', { name: 'Your data' })
  await yourData.getByText('What leaves this computer', { exact: true }).waitFor()
  await yourData.getByText(userData, { exact: true }).waitFor()
  await yourData.getByRole('button', { name: 'Show the app data folder in Finder' }).waitFor()
  assert.deepEqual(errors, [])

  // The page process crashes: logged, and (in tests, without the native dialog) the window reloads.
  // Crash only once the page is idle: a DevTools call still in flight when the renderer goes makes
  // Playwright's session throw an uncaught 'Target crashed' (its reply id was already dropped).
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 300))))
  await new Promise((resolve) => setTimeout(resolve, 500))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
  const log = () => { try { return fs.readFileSync(path.join(userData, 'logs', 'bridgeclip.log'), 'utf8') } catch { return '' } }
  for (let i = 0; i < 100 && !log().includes('renderer.gone.reload'); i++) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.match(log(), /"event":"renderer\.gone"[^\n]*"kind":"(crashed|killed|abnormal-exit)"/)
  for (let i = 0; i < 100 && await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isCrashed()); i++) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isCrashed()), false)
})
