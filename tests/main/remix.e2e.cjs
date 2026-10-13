const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

test('Remix: add a brand identity, pick a style and presenter, start, and review the results', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-remix-e2e-'))
  const userData = path.join(root, 'user-data')
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  const output = path.join(userData, 'CreatorClips', 'Remix', 'run')
  fs.mkdirSync(output, { recursive: true })
  const video = path.join(output, '01 This coach says you must lose weight first.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3355ff:s=270x480:d=2', '-f', 'lavfi', '-i', 'sine=d=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
  const portrait = path.join(root, 'portrait.jpg')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xcc8844:s=270x480', '-frames:v', '1', portrait])

  await app.evaluate(({ ipcMain }, { root, portrait }) => {
    globalThis.remixRequests = []
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, pexelsConfigured: false, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('avatars:list')
    ipcMain.handle('avatars:list', () => [{ id: 'a'.repeat(16), name: 'Maya', kind: 'self', description: '', voice: { provider: 'elevenlabs', voice: 'Brian' },
      clonedVoice: null, consentAt: '2026-10-01', createdAt: '2026-10-01', portraitPath: portrait }])
    ipcMain.removeHandler('remix:start')
    ipcMain.handle('remix:start', (_event, request) => {
      globalThis.remixRequests.push(request)
      return { id: 'run1', phase: 'running', detail: 'Finding moments and writing your takes', percent: 22, folder: root, estimateUsd: 2, outputs: [], costUsd: null, warnings: [], error: null }
    })
  }, { root: path.join(userData, 'CreatorClips'), portrait })
  await page.reload()

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Remix', exact: true }).waitFor()
  const make = page.getByRole('button', { name: 'Make 3 remixes', exact: true })
  assert.equal(await make.isDisabled(), true, 'needs a video first')

  await page.getByLabel('Video link').fill('https://www.youtube.com/watch?v=abcdefghijk')

  // Brand identity: added once, then chosen automatically.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add brand identity' })
  await dialog.getByPlaceholder('e.g. Pull-Up Lab').fill('Pull-Up Lab')
  await dialog.locator('textarea').fill('Core promise: your first pull-up without losing weight.\nWe believe strength comes before the scale.')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByText('Pull-Up Lab', { exact: true }).first().waitFor()

  await page.getByRole('radio', { name: /Myth vs\. truth/ }).click()
  assert.equal(await make.isDisabled(), true, 'needs the AI-label promise')
  await page.getByRole('checkbox', { name: "I'll turn on the AI-content label when I post" }).click()
  await make.click()

  const request = await app.evaluate(() => globalThis.remixRequests[0])
  assert.equal(request.source, 'https://www.youtube.com/watch?v=abcdefghijk')
  assert.equal(request.angle, 'myth_truth')
  assert.equal(request.host, 'lipsync')
  assert.equal(request.avatarId, 'a'.repeat(16))
  assert.equal(request.count, 3)
  assert.equal(request.aiLabelAck, true)
  assert.match(request.brandIdentityId, /^[a-f0-9]{16}$/)
  await page.getByText('Finding moments and writing your takes').waitFor()

  await app.evaluate(({ BrowserWindow }, { video, folder }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('remix:status', {
      id: 'run1', phase: 'done', detail: 'Done', percent: 100, folder, estimateUsd: 2, costUsd: 1.42, warnings: [], error: null,
      outputs: [{ path: video, manifestPath: video.replace(/\.mp4$/, '.json'), headline: 'This coach says you must lose weight first', stance: 'disagree_correct',
        excerptSeconds: 4.8, durationSeconds: 27, costUsd: 0.62, warnings: [],
        checks: [{ id: 'short_excerpt', ok: true, label: 'Borrowed part is 4.8s' }, { id: 'take_dominates', ok: true, label: 'Your take is 82% of the video' },
          { id: 'credited', ok: true, label: 'Original creator credited on screen' }, { id: 'music', ok: false, label: 'Music in the borrowed part may trigger Content ID' }] }]
    })
  }, { video, folder: output })
  await page.getByText('1 remix ready').waitFor()
  await page.getByText('Disagrees and corrects it').waitFor()
  await page.getByText('1 to review').waitFor()

  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('heading', { name: 'Remix', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(shots, 'remix-top.png') })
    await page.getByText('1 remix ready').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(shots, 'remix-results.png') })
  }
  assert.deepEqual(errors, [])
})
