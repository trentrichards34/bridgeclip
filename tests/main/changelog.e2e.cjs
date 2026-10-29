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
  // A first install never shows What's new; it only remembers this version.
  assert.equal(await page.getByRole('dialog', { name: /What.s new in/ }).count(), 0)
  const prefs = JSON.parse(fs.readFileSync(path.join(root, 'user-data', 'member-prefs.json'), 'utf8'))
  assert.equal(prefs.lastSeenVersion, version)
  assert.deepEqual(errors, [])
})

test("What's new: once after an update, from this version's changelog section", { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-whatsnew-e2e-'))
  const appDir = buildApp(path.join(root, 'app'))
  const userDataDir = path.join(root, 'user-data')
  const prefsFile = path.join(userDataDir, 'member-prefs.json')
  fs.mkdirSync(userDataDir, { recursive: true })
  // A member who set up an older version.
  fs.writeFileSync(prefsFile, JSON.stringify({ version: 1, profile: { goals: ['clips'], platforms: [], onboarding: 'done' }, lastSeenVersion: '0.0.1' }))
  let session = await launchApp({ appDir, userDataDir })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const errors = []
  session.page.on('pageerror', (error) => errors.push(error.message))

  const whatsNew = session.page.getByRole('dialog', { name: `What’s new in ${version}` })
  await whatsNew.waitFor()
  // This version's section only (in development, 0.1.19's credit line).
  const expected = version === '0.1.19' ? 'CreatorClips is built on BridgeClip by BridgeMind (MIT).' : null
  if (expected) await whatsNew.getByText(expected, { exact: true }).waitFor()
  assert.equal(await whatsNew.getByText('**').count(), 0, 'Markdown markers must not reach the screen')
  for (let i = 0; i < 40 && JSON.parse(fs.readFileSync(prefsFile, 'utf8')).lastSeenVersion !== version; i++) await session.page.waitForTimeout(50)
  assert.equal(JSON.parse(fs.readFileSync(prefsFile, 'utf8')).lastSeenVersion, version, 'remembered as soon as it is shown')
  // See all changes opens the full changelog in its place.
  await whatsNew.getByRole('button', { name: 'See all changes' }).click()
  await whatsNew.waitFor({ state: 'detached' })
  const changelog = session.page.getByRole('dialog', { name: 'Changelog' })
  await changelog.waitFor()
  await changelog.getByRole('button', { name: 'Done' }).click()
  await changelog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])

  // Next launch on the same version: not again.
  await session.close()
  session = await launchApp({ appDir, userDataDir })
  await session.page.getByRole('heading', { level: 1 }).first().waitFor()
  await session.page.waitForTimeout(1500)
  assert.equal(await session.page.getByRole('dialog', { name: /What.s new in/ }).count(), 0)
})
