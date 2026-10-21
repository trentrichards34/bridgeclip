const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

// Create: pasting three links queues three jobs with the same settings. The
// runner is mocked at the IPC boundary (as in the jobs e2e tests): the handler
// records each request and the main process announces the queued jobs.
test('pasting three links queues one job per video, two running and one waiting', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-multi-source-e2e-'))
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: path.join(root, 'user-data') })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36"/>' }))
  await app.evaluate(({ ipcMain, BrowserWindow }, root) => {
    globalThis.multiSourceTest = { many: [], single: [] }
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('system:checkTools')
    ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
    ipcMain.removeHandler('source:youtubePreview')
    ipcMain.handle('source:youtubePreview', () => ({ title: 'A talk', channel: 'Studio', durationSeconds: 600 }))
    ipcMain.removeHandler('job:start')
    ipcMain.handle('job:start', (_event, request) => { globalThis.multiSourceTest.single.push(request); return { error: 'single start not expected' } })
    ipcMain.removeHandler('job:startMany')
    ipcMain.handle('job:startMany', (_event, requests) => {
      globalThis.multiSourceTest.many.push(requests)
      const now = new Date().toISOString()
      const started = requests.map((request, index) => {
        const job = { id: `multi-${index + 1}`, revision: 1, request, status: index < 2 ? 'pending' : 'queued', percent: 0,
          step: index < 2 ? 'Starting…' : 'Waiting for a free slot', clipsDone: 0, clipsTotal: 0, error: null, errorHint: null,
          output: null, outputDir: `${root}/multi-${index + 1}`, queuedAt: now, startedAt: index < 2 ? now : null, finishedAt: null }
        BrowserWindow.getAllWindows()[0].webContents.send('jobs:update', job)
        return { jobId: job.id, queued: index >= 2, job, videoUrl: request.videoUrl }
      })
      return { started, failed: [] }
    })
  }, root)
  await page.reload()

  await page.getByRole('radiogroup', { name: 'Workflow', exact: true }).getByRole('radio', { name: 'Automatic', exact: true }).click()
  const links = ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://example.com/second.mp4', 'https://www.twitch.tv/videos/12345?t=1h']
  const field = page.getByRole('textbox', { name: 'Video link', exact: true })
  await field.evaluate((input, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, links.join('\n'))
  await page.getByText('3 videos will be clipped', { exact: true }).waitFor()
  const list = page.getByRole('group', { name: 'Videos to clip' })
  assert.equal(await list.getByRole('listitem').count(), 3)
  assert.equal(await page.getByRole('switch', { name: 'Prefer a source range' }).count(), 0)

  // Remove one and add it back through the extra link field.
  await list.getByRole('button', { name: /^Remove example\.com\/second\.mp4/ }).click()
  await page.getByText('2 videos will be clipped', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Another video link', exact: true }).fill(links[1])
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText('3 videos will be clipped', { exact: true }).waitFor()

  // Caption language on the Captions step says the speech is not translated.
  const steps = page.getByRole('navigation', { name: 'Create steps' })
  await steps.getByRole('button', { name: /Look/ }).click()
  await page.getByRole('combobox', { name: 'Caption language' }).click()
  await page.getByRole('option', { name: 'Spanish' }).click()
  await page.getByText(/The speech stays in its original language: only the captions are translated/).waitFor()

  await steps.getByRole('button', { name: /Review/ }).click()
  await page.getByText(/3 jobs are queued, one per video/).waitFor()
  await page.getByRole('button', { name: 'Generate clips for 3 videos', exact: true }).click()
  await page.getByRole('heading', { name: '3 videos queued' }).waitFor()

  const calls = await app.evaluate(() => globalThis.multiSourceTest)
  assert.equal(calls.single.length, 0)
  assert.equal(calls.many.length, 1)
  const requests = calls.many[0]
  assert.deepEqual(requests.map((request) => request.videoUrl), [links[0], links[2].replace('?t=1h', ''), links[1]])
  assert.ok(requests.every((request) => request.captionLanguage === 'es' && request.workflow === 'automatic' && request.startTimeSeconds === null))
  assert.equal(new Set(requests.map((request) => JSON.stringify({ ...request, videoUrl: null }))).size, 1, 'every job has the same settings')

  await page.getByRole('button', { name: 'View jobs', exact: true }).click()
  const active = page.getByRole('region', { name: 'Active jobs' })
  await active.waitFor()
  assert.equal(await active.getByRole('listitem').count(), 3)
  await active.getByText('2 running · 1 queued', { exact: false }).waitFor()
  assert.deepEqual(errors, [])
})
