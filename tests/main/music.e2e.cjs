// Settings → My music in the running app: add a track of my own (copied in), play it, set how loud music sits and
// whether it plays under their clip in Remix, then remove it.
const test = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

test('Settings → My music: add, play, volume, Remix choice and remove', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-music-e2e-'))
  const userData = path.join(root, 'user-data')
  const song = path.join(root, 'My intro.wav')
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', song])
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.getByRole('button', { name: 'Settings', exact: true }).first().waitFor()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const section = page.locator('#settings-music')
  await section.waitFor()
  await section.scrollIntoViewIfNeeded()
  await section.getByText('No music of your own yet', { exact: false }).waitFor()

  // The file dialog opens in main; the member picks a WAV and it's copied into the app's music folder.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, song)
  await section.getByRole('button', { name: 'Add music', exact: true }).click()
  const list = section.getByRole('list', { name: 'My music' })
  await list.getByText('My intro', { exact: true }).waitFor()
  assert.ok(fs.existsSync(path.join(userData, 'music', 'My intro.wav')))
  // Its play button gets the audio from main (bytes, never a path).
  const preview = await page.evaluate(async () => { const p = await window.bridgeclip.music.preview('my:My intro.wav'); return { mime: p.mime, size: p.data.byteLength } })
  assert.deepEqual(preview, { mime: 'audio/wav', size: fs.statSync(song).size })
  await list.getByRole('button', { name: 'Play My intro' }).waitFor()

  // How loud music sits under the voice: saved when let go.
  const slider = section.getByLabel('Music volume')
  await slider.fill('-16')
  await slider.blur()
  await section.getByText('-16 dB', { exact: true }).waitFor()
  const settingsFile = path.join(userData, 'music', 'settings.json')
  for (let i = 0; i < 50 && !(fs.existsSync(settingsFile) && JSON.parse(fs.readFileSync(settingsFile, 'utf8')).levelDb === -16); i++) await page.waitForTimeout(50)
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).levelDb, -16)
  await section.getByRole('switch', { name: 'Music under their clip in Remix' }).click()
  await section.locator('[role="switch"][aria-checked="true"]').waitFor()
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { levelDb: -16, duringTheirClip: true })

  await list.getByRole('button', { name: 'Remove My intro from my music' }).click()
  await section.getByText('No music of your own yet', { exact: false }).waitFor()
  assert.equal(fs.existsSync(path.join(userData, 'music', 'My intro.wav')), false)
  assert.deepEqual(errors, [])
})
