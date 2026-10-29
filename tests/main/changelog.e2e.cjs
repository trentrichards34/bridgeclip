const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const { version } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))

test('Settings → About and Help → Changelog show the bundled changelog', { timeout: 90000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-changelog-e2e-'))
  const appDir = buildApp(path.join(root, 'app'))
  const session = await launchApp({ appDir, userDataDir: path.join(root, 'user-data') })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = process.env.BRIDGECLIP_E2E_SHOTS

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const about = page.locator('#settings-about')
  await about.getByRole('button', { name: 'Changelog', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Changelog' })
  await dialog.waitFor()
  await dialog.getByRole('region', { name: `Version ${version}` }).getByText('This version', { exact: true }).waitFor()
  // BridgeClip's history is not shown: only the credit (as this version in development, "Earlier versions" once released).
  await dialog.getByText('CreatorClips is built on BridgeClip by BridgeMind (MIT).', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('region', { name: 'Version 0.1.17' }).count(), 0)
  for (const text of ["BridgeMind's Developer ID", 'Linux installers', 'Windows x64']) assert.equal(await dialog.getByText(text).count(), 0, text)
  assert.equal(await dialog.getByText('**').count(), 0, 'Markdown markers must not reach the screen')
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: path.join(shots, 'changelog-dialog.png') })
  }

  // The GitHub link passes the main process's external-link allowlist.
  await app.evaluate(({ shell }) => {
    globalThis.changelogTest = { opened: [] }
    shell.openExternal = async (url) => { globalThis.changelogTest.opened.push(url) }
  })
  await dialog.getByRole('button', { name: 'All releases on GitHub' }).click()
  const opened = () => app.evaluate(() => globalThis.changelogTest.opened)
  for (let i = 0; i < 40 && (await opened()).length === 0; i++) await page.waitForTimeout(50)
  assert.deepEqual(await opened(), ['https://github.com/trentrichards34/creatorclips-releases/releases'])

  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })

  // Help → Changelog opens it over the current page. Keep the test window hidden.
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('heading', { name: 'Your clips', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow, Menu }) => {
    BrowserWindow.getAllWindows()[0].show = () => {}
    const help = Menu.getApplicationMenu().items.find((item) => item.label === 'Help')
    help.submenu.items.find((item) => item.label === 'Changelog').click()
  })
  await dialog.waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Your clips', exact: true }).count(), 1)
  await dialog.getByRole('button', { name: 'Done' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
})
