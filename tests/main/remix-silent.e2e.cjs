const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

test('React to a clip (silent): pick the format, check reactions and permission, review timed reactions, make it', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-silent-e2e-'))
  const userData = path.join(root, 'user-data')
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const portrait = path.join(root, 'portrait.jpg')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xcc8844:s=270x480', '-frames:v', '1', portrait])

  await app.evaluate(({ ipcMain }, { root, portrait }) => {
    globalThis.remixRequests = []
    globalThis.renderRequests = []
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, pexelsConfigured: false, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    const avatar = (reactions) => ({ id: 'a'.repeat(16), name: 'Maya', kind: 'self', description: '', voice: { provider: 'elevenlabs', voice: 'Brian' },
      clonedVoice: null, consentAt: '2026-10-01', createdAt: '2026-10-01', portraitPath: portrait, reactions })
    globalThis.withReactions = false
    ipcMain.removeHandler('avatars:list')
    ipcMain.handle('avatars:list', () => [avatar(globalThis.withReactions ? [{ id: 'listen', source: 'ai', path: portrait }, { id: 'point', source: 'own', path: portrait }] : [])])
    ipcMain.removeHandler('remix:start')
    ipcMain.handle('remix:start', (_event, request) => {
      globalThis.remixRequests.push(request)
      return { id: 'run1', phase: 'planning', detail: 'Finding moments', percent: 10, folder: root, estimateUsd: 0.18, drafts: [], outputs: [], costUsd: null, warnings: [], error: null }
    })
    ipcMain.removeHandler('remix:render')
    ipcMain.handle('remix:render', (_event, edits) => {
      globalThis.renderRequests.push(edits)
      return { id: 'run1', phase: 'rendering', detail: 'Starting', percent: 1, folder: root, estimateUsd: 0, drafts: [], outputs: [], costUsd: 0.1, warnings: [], error: null }
    })
  }, { root: path.join(userData, 'CreatorClips'), portrait })
  await page.reload()

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByLabel('Video links').fill('https://www.instagram.com/reel/DdurluTvRVB/')
  // The AI presenter side (Beta): React to a clip with the avatar's reactions.
  await page.getByRole('radio', { name: /^AI presenter/ }).click()
  await page.getByRole('radio', { name: /^React to a clip/ }).click()
  // No voiced-take controls for a silent react, and no presenter choice: the avatar's reactions play.
  assert.equal(await page.getByRole('radiogroup', { name: 'Style of your take' }).count(), 0)
  assert.equal(await page.getByRole('radiogroup', { name: 'Presenter' }).count(), 0)
  await page.getByText(/Your avatar’s reactions play with the clip/).waitFor()
  await page.getByText('Maya has no reactions yet').waitFor()
  const make = page.getByRole('button', { name: 'Write the takes', exact: true })
  assert.equal(await make.isDisabled(), true)

  // Reactions made in Avatar Studio show up when the page reloads its avatars.
  await app.evaluate(() => { globalThis.withReactions = true })
  await page.getByRole('button', { name: 'Avatar Studio', exact: true }).first().click()
  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByText('2 of 6 reactions ready for Maya. More reactions make the video feel more natural.').waitFor()
  await page.getByRole('checkbox', { name: "I'll turn on the AI-content label when I post" }).click()
  assert.equal(await make.isDisabled(), true, 'needs the clip-permission promise')
  await page.getByRole('checkbox', { name: "I'm allowed to use these clips" }).click()
  await make.click()
  const request = await app.evaluate(() => globalThis.remixRequests[0])
  assert.equal(request.format, 'silent')
  assert.equal(request.clipRightsAck, true)
  assert.equal(request.avatarId, 'a'.repeat(16))

  await app.evaluate(({ BrowserWindow }, folder) => {
    BrowserWindow.getAllWindows()[0].webContents.send('remix:status', {
      id: 'run1', phase: 'review', detail: 'Ready for review', percent: 100, folder, estimateUsd: 0.18, costUsd: 0.12, error: null, outputs: [], warnings: [],
      drafts: [{ id: 0, sourceTitle: 'Reel', creator: '@hormozi', startMs: 2000, endMs: 18000, quote: 'My most watched videos made zero sales.', why: 'Bold claim',
        style: 'reaction', stance: 'agree_extend', headline: 'Hormozi says his most-watched videos made zero sales', intro: '', beats: [], close: '', notes: [],
        grade: { letter: 'A', score: 8.4, verdict: 'Strong.', fix: 'Name the number.', edited: false }, estimateUsd: 0, format: 'silent',
        cues: [{ at: 0, reaction: 'listen' }, { at: 6, reaction: 'point' }], postCaption: 'Your most viewed reel made $0.\n\nClip: @hormozi' }]
    })
  }, root)
  await page.getByRole('heading', { name: /Review your takes/ }).waitFor()
  await page.getByText('6s · Pointing up').waitFor()
  assert.equal(await page.getByLabel(/^Opening \(presenter\)/).count(), 0, 'no spoken lines to edit')
  await page.getByLabel('Headline, take 1').fill('Hormozi says his biggest videos made zero sales')
  await page.getByRole('button', { name: /^Make 1 remix/ }).click()
  const rendered = await app.evaluate(() => globalThis.renderRequests[0])
  assert.equal(rendered[0].headline, 'Hormozi says his biggest videos made zero sales')
  assert.match(rendered[0].postCaption, /Clip: @hormozi$/)
  assert.deepEqual(errors, [])
})
