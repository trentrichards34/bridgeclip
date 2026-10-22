const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

test('Signal frame: grouped sidebar, tool chip, the top bar starts clips from a link or searches the Library, Ask opens Chat, Brand look lists brands', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-signal-shell-e2e-'))
  const appDir = buildApp(path.join(root, 'app'))
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, 'member-prefs.json'), JSON.stringify({ version: 1, profile: { goals: [], platforms: [], onboarding: 'done' } }))
  const session = await launchApp({ appDir, userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))

  // Every destination, in Make, Manage, Publish, then Guides and Settings.
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.waitFor()
  const labels = await nav.getByRole('button').allInnerTexts()
  assert.deepEqual(labels.map((label) => label.split('\n')[0].trim()), [
    'Create', 'Edit my recording', 'Remix', 'Avatar Studio', 'B-roll video',
    'Library', 'Jobs', 'Chat', 'B-roll library', 'Brand look',
    'Posts', 'Accounts', 'Automations', 'Guides', 'Settings'
  ])
  for (const group of ['Make', 'Manage', 'Publish']) await page.getByText(group, { exact: true }).first().waitFor()

  // The page header carries the tool chip; the glow and chip take the tool colour.
  await page.getByRole('heading', { level: 1, name: 'Create clips' }).waitFor()
  assert.equal(await page.locator('main').getAttribute('data-tool'), 'create')
  await page.locator('header .tool-chip', { hasText: 'Create' }).waitFor()

  // Fonts are bundled: no network font, and the families load.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready
    return ['Space Grotesk', 'JetBrains Mono', 'Geist'].map((family) => document.fonts.check(`16px "${family}"`))
  })
  assert.deepEqual(fonts, [true, true, true])

  // A pasted link starts clips on Create with the link filled in.
  await page.keyboard.press('Control+k')
  const bar = page.getByRole('textbox', { name: 'Start from a link, or search' })
  assert.equal(await bar.evaluate((el) => el === document.activeElement), true)
  await nav.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Your clips' }).waitFor()
  await bar.fill('https://example.com/talk.mp4')
  await page.getByRole('button', { name: 'Start clips from this link' }).click()
  await page.getByRole('heading', { level: 1, name: 'Create clips' }).waitFor()
  await page.getByText('example.com/talk.mp4', { exact: true }).waitFor()
  assert.equal(await bar.inputValue(), '')

  // Anything else searches the Library.
  await bar.fill('pricing talk')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { level: 1, name: 'Your clips' }).waitFor()
  assert.equal(await nav.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page')

  // Ask (and ⌘J / Ctrl+J) opens Chat.
  await page.getByRole('button', { name: 'Ask the assistant' }).click()
  assert.equal(await nav.getByRole('button', { name: 'Chat', exact: true }).getAttribute('aria-current'), 'page')
  await nav.getByRole('button', { name: 'Jobs', exact: true }).click()
  await page.keyboard.press('Control+j')
  assert.equal(await nav.getByRole('button', { name: 'Chat', exact: true }).getAttribute('aria-current'), 'page')

  // Brand look hosts the brand identities: add one with the existing dialog.
  await nav.getByRole('button', { name: 'Brand look', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Your brand look' }).waitFor()
  assert.equal(await page.locator('main').getAttribute('data-tool'), 'brand')
  await page.getByText('No brand yet', { exact: true }).waitFor()
  await app.evaluate(({ ipcMain }) => {
    const brand = { id: 'b1', name: 'Coach Jess', text: 'Pricing coach for creators.', look: { color: '#22AA88', captionPreset: 'pop', handle: '@coachjess' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
    ipcMain.removeHandler('brandIdentities:list')
    ipcMain.handle('brandIdentities:list', () => [brand])
  })
  await nav.getByRole('button', { name: 'Library', exact: true }).click()
  await nav.getByRole('button', { name: 'Brand look', exact: true }).click()
  const list = page.getByRole('list', { name: 'Your brands' })
  await list.getByText('Coach Jess', { exact: true }).waitFor()
  await list.getByText('Pop captions', { exact: true }).waitFor()
  await list.getByRole('button', { name: 'Edit Coach Jess' }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')

  // The sidebar collapses to icons and back (⌘\ / Ctrl+\).
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.getByRole('button', { name: 'Expand sidebar' }).waitFor()
  assert.equal(await page.getByText('Manage', { exact: true }).count(), 0)
  await page.keyboard.press('Control+\\')
  await page.getByRole('button', { name: 'Collapse sidebar' }).waitFor()

  assert.deepEqual(errors, [])
})
