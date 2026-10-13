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
    globalThis.renderRequests = []
    ipcMain.removeHandler('remix:start')
    ipcMain.handle('remix:start', (_event, request) => {
      globalThis.remixRequests.push(request)
      return { id: 'run1', phase: 'planning', detail: 'Video 1 of 2: finding moments and writing your takes', percent: 22, folder: root, estimateUsd: 2, drafts: [], outputs: [], costUsd: null, warnings: [], error: null }
    })
    ipcMain.removeHandler('remix:render')
    ipcMain.handle('remix:render', (_event, edits) => {
      globalThis.renderRequests.push(edits)
      return { id: 'run1', phase: 'rendering', detail: 'Starting', percent: 1, folder: root, estimateUsd: 0.6, drafts: [], outputs: [], costUsd: 0.2, warnings: [], error: null }
    })
  }, { root: path.join(userData, 'CreatorClips'), portrait })
  await page.reload()

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Remix', exact: true }).waitFor()
  const make = page.getByRole('button', { name: 'Write the takes', exact: true })
  assert.equal(await make.isDisabled(), true, 'needs a video first')

  await page.getByLabel('Video links').fill('https://www.youtube.com/watch?v=abcdefghijk\nhttps://www.youtube.com/watch?v=bcdefghijkl')
  await page.getByText('2 videos', { exact: true }).waitFor()

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
  assert.deepEqual(request.sources, ['https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=bcdefghijkl'])
  assert.equal(request.angle, 'myth_truth')
  assert.equal(request.order, 'moment_first')
  assert.equal(request.host, 'lipsync')
  assert.equal(request.avatarId, 'a'.repeat(16))
  assert.equal(request.count, 3)
  assert.equal(request.aiLabelAck, true)
  assert.match(request.brandIdentityId, /^[a-f0-9]{16}$/)
  await page.getByText('Video 1 of 2: finding moments and writing your takes').waitFor()

  // Review: two graded takes, best first; edit one line, drop the weaker one, make the rest.
  await app.evaluate(({ BrowserWindow }, folder) => {
    // Main sends drafts already parsed (shared/remix.ts parseRemixDraft).
    const draft = (id, letter, score, headline) => ({ id, sourceTitle: 'Pull-ups 101', creator: 'Coach Example', startMs: 4000, endMs: 8800,
      quote: 'you have to lose twenty pounds first', why: 'The claim', style: 'myth_truth', stance: 'disagree_correct', headline,
      intro: 'He is wrong about this.', beats: [{ text: 'Strength comes first.', broll: 'pull up bar' }], close: 'Train the pull, not the scale.',
      notes: [], grade: { letter, score, verdict: 'Strong open.', fix: 'Name the drill.', edited: false }, estimateUsd: 0.6 })
    BrowserWindow.getAllWindows()[0].webContents.send('remix:status', {
      id: 'run1', phase: 'review', detail: 'Ready for review', percent: 100, folder, estimateUsd: 2, costUsd: 0.21, error: null, outputs: [],
      warnings: ["You'd post 6 remixes of Coach Example this week."],
      drafts: [draft(0, 'D', 3.9, 'A weaker moment nobody needs'), draft(1, 'A', 8.6, 'This coach says you must lose weight first')]
    })
  }, output)
  await page.getByRole('heading', { name: /Review your takes/ }).waitFor()
  await page.getByText(/6 remixes of Coach Example/).waitFor()
  const openings = page.getByLabel(/^Opening \(presenter\), take/)
  assert.equal(await openings.count(), 2)
  await page.getByLabel('Opening (presenter), take 1').fill('Hold on. That is the biggest pull-up myth there is.')
  // An over-long line is caught before anything is paid for.
  await page.getByLabel('Close (presenter), take 1').fill(Array.from({ length: 40 }, () => 'word').join(' '))
  await page.getByText('Keep the close to 35 words.').waitFor()
  await page.getByLabel('Close (presenter), take 1').fill('Train the pull, not the scale.')
  const makeButton = page.getByRole('button', { name: /^Make 1 remix/ })
  await makeButton.waitFor()
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    fs.mkdirSync(process.env.BRIDGECLIP_E2E_SHOTS, { recursive: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('heading', { name: /Review your takes/ }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'remix-review.png') })
  }
  await makeButton.click()
  const rendered = await app.evaluate(() => globalThis.renderRequests[0])
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].id, 1)
  assert.equal(rendered[0].intro, 'Hold on. That is the biggest pull-up myth there is.')

  await app.evaluate(({ BrowserWindow }, { video, folder }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('remix:status', {
      id: 'run1', phase: 'done', detail: 'Done', percent: 100, folder, estimateUsd: 2, costUsd: 1.42, warnings: [], error: null, drafts: [],
      outputs: [{ style: 'myth_truth', grade: 'A', creator: 'Coach Example', path: video, manifestPath: video.replace(/\.mp4$/, '.json'), headline: 'This coach says you must lose weight first', stance: 'disagree_correct',
        excerptSeconds: 4.8, durationSeconds: 27, costUsd: 0.62, warnings: [],
        checks: [{ id: 'short_excerpt', ok: true, label: 'Borrowed part is 4.8s' }, { id: 'take_dominates', ok: true, label: 'Your take is 82% of the video' },
          { id: 'credited', ok: true, label: 'Original creator credited on screen' }, { id: 'music', ok: false, label: 'Music in the borrowed part may trigger Content ID' }] }]
    })
  }, { video, folder: output })
  await page.getByText(/1 remix ready/).waitFor()
  await page.getByText('Disagrees and corrects it').waitFor()
  await page.getByText('1 to review').waitFor()

  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('heading', { name: 'Remix', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(shots, 'remix-top.png') })
    await page.getByText(/1 remix ready/).scrollIntoViewIfNeeded()
    // Best effort: a playing <video> can stall screenshots on some headless setups.
    await page.screenshot({ path: path.join(shots, 'remix-results.png'), timeout: 10000 }).catch(() => undefined)
  }
  assert.deepEqual(errors, [])
})
