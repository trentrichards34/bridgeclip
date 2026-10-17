const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

const AVATAR = 'abcdef1234567890'

/** A stand-in for OpenRouter's speech endpoint: every request gets the same short voiceover. */
async function fakeOpenRouter(voice) {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push({ url: req.url, body })
      if (req.method === 'POST' && req.url === '/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(voice); return }
      res.writeHead(404); res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('a finished avatar video is in the Library with its hook text, ready to post; older ones are imported too', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-avatar-library-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const media = path.join(root, 'media')
  fs.mkdirSync(media)
  const voicePath = path.join(media, 'voice.mp3')
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:a', 'libmp3lame', voicePath])
  // An avatar already in the library.
  const avatarDir = path.join(userDataDir, 'avatars', AVATAR)
  fs.mkdirSync(avatarDir, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xcc8844:s=360x640', '-frames:v', '1', path.join(avatarDir, 'portrait.jpg')])
  fs.writeFileSync(path.join(avatarDir, 'avatar.json'), JSON.stringify({ id: AVATAR, name: 'Maya', kind: 'ai', description: 'A fictional presenter', voice: { provider: 'elevenlabs', voice: 'Brian' }, clonedVoice: null, consentAt: null, createdAt: '2026-10-01T00:00:00.000Z' }))
  // A video made before Avatar Studio saved to the Library.
  const legacy = path.join(library, 'Avatar Studio', '2026-10-01 120000 Old coffee video')
  fs.mkdirSync(legacy, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=360x640:d=2:r=30', ...tools.encoder, '-pix_fmt', 'yuv420p', path.join(legacy, 'final.mp4')])
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))

  const openrouter = await fakeOpenRouter(fs.readFileSync(voicePath))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: openrouter.url } })
  t.after(async () => {
    const timer = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(timer); await openrouter.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Linux without a desktop keyring only offers plain-text storage, which the app refuses for keys.
  // This test's key is fake, so let it through there.
  await session.app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()

  await page.getByRole('button', { name: 'Avatar Studio', exact: true }).first().click()
  await page.getByRole('radio', { name: /Maya/ }).waitFor()
  await page.getByRole('textbox', { name: 'Script', exact: true }).fill('Stop buying coffee every morning. Brew it at home.')
  // Empty hook text shows the first line it will use.
  const hook = page.getByRole('textbox', { name: 'Hook text', exact: true })
  assert.equal(await hook.getAttribute('placeholder'), 'Stop buying coffee every morning.')
  await hook.fill('Stop buying coffee')
  await page.getByRole('switch', { name: 'Captions' }).click()
  await page.getByRole('radiogroup', { name: 'Hook text look' }).getByRole('radio', { name: /Black bar/ }).click()
  await page.getByRole('radiogroup', { name: 'Call to action' }).waitFor()
  await page.getByRole('button', { name: 'Generate video' }).click()
  await page.getByRole('button', { name: 'Post or schedule' }).waitFor({ timeout: 180000 })
  assert.equal(openrouter.requests.filter((request) => request.url === '/audio/speech').length, 1)

  // It is a Library run: clip_00.mp4 and job_output.json in its own folder.
  const runs = fs.readdirSync(library).filter((name) => /^avatar-/.test(name))
  assert.equal(runs.length, 1, 'older videos join when the Library loads')
  const jobs = runs.map((name) => JSON.parse(fs.readFileSync(path.join(library, name, 'job_output.json'), 'utf8')))
  const made = jobs.find((job) => job.source_video_title === 'Avatar Studio · Stop buying coffee')
  assert.ok(made, jobs.map((job) => job.source_video_title).join(', '))
  assert.deepEqual([made.clips[0].headline, made.clips[0].ai_generated, made.clips[0].post_caption], ['Stop buying coffee', true, 'Stop buying coffee every morning. Brew it at home.'])
  assert.ok(fs.statSync(path.join(library, made.job_id, 'clip_00.mp4')).size > 0)

  // Post or schedule opens the posting dialog for this video.
  await page.getByRole('button', { name: 'Post or schedule' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Close' }).click()

  // Open in Library goes straight to it; the Library lists both avatar videos.
  await page.getByRole('button', { name: 'Open in Library' }).click()
  await page.getByText('Stop buying coffee', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Avatar Studio · Stop buying coffee', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Open Avatar Studio · Old coffee video', exact: true }).waitFor()
  assert.ok(fs.existsSync(path.join(legacy, '.library-run.json')), 'the older video is marked as imported')
  assert.ok(fs.existsSync(path.join(legacy, 'final.mp4')), 'and stays where it was')
  // A reload does not import the older video twice.
  await page.reload()
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Avatar Studio · Old coffee video', exact: true }).waitFor()
  assert.equal(fs.readdirSync(library).filter((name) => /^avatar-/.test(name)).length, 2)
  assert.deepEqual(errors, [])
})
