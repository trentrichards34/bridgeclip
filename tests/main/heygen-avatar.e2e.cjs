// HeyGen (Beta) end to end: a stand-in HeyGen API (like tests/zernio/support's mock Zernio) and OpenRouter speech.
// A photo avatar is made from the member's photo, trained, and one script video is rendered on HeyGen,
// finished with captions and hook text, and saved to the Library; both HeyGen charges reach the spending ledger.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

const KEY = 'hg-e2e-key-0123456789'

/** A stand-in for HeyGen's v3 API with just what the photo-avatar flow calls. */
async function fakeHeygen(videoFile) {
  const requests = []
  let lookPolls = 0, videoPolls = 0
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const url = new URL(req.url, 'http://127.0.0.1')
      requests.push({ method: req.method, path: url.pathname, key: req.headers['x-api-key'] ?? null, type: req.headers['content-type'] ?? '', body })
      const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
      if (url.pathname === '/files/v_e2e.mp4') {
        // The presigned file link: no key is expected (or sent).
        res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(fs.readFileSync(videoFile)); return
      }
      if (req.headers['x-api-key'] !== KEY) return send(401, { error: { code: 'unauthorized', message: 'Invalid API key' } })
      const route = `${req.method} ${url.pathname}`
      if (route === 'GET /v3/users/me') return send(200, { data: { username: 'maya', first_name: 'Maya', last_name: 'Test', email: null, billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance: 42, auto_reload: null }, subscription: null, usage_based: null } })
      if (route === 'POST /v3/assets') return send(200, { data: { asset_id: `ast_${requests.filter((item) => item.path === '/v3/assets').length}`, url: 'https://files.example/asset', mime_type: 'application/octet-stream', size_bytes: body.length } })
      if (route === 'POST /v3/avatars') {
        return send(200, { data: {
          avatar_item: { id: 'look_e2e', name: 'Me', avatar_type: 'photo_avatar', group_id: 'ag_e2e', status: 'processing', supported_api_engines: ['avatar_iv'] },
          avatar_group: { id: 'ag_e2e', name: 'Me', created_at: 1, looks_count: 1, consent_status: null, status: 'processing' }
        } })
      }
      if (route === 'GET /v3/avatars/looks/look_e2e') {
        lookPolls++
        return send(200, { data: { id: 'look_e2e', name: 'Me', avatar_type: 'photo_avatar', group_id: 'ag_e2e', status: 'completed', supported_api_engines: ['avatar_iv'] } })
      }
      if (route === 'GET /v3/avatars/ag_e2e') return send(200, { data: { id: 'ag_e2e', name: 'Me', created_at: 1, looks_count: 1, consent_status: null, status: 'completed' } })
      if (route === 'POST /v3/videos') return send(200, { data: { video_id: 'v_e2e', status: 'waiting' } })
      if (route === 'GET /v3/videos/v_e2e') {
        videoPolls++
        if (videoPolls < 2) return send(200, { data: { id: 'v_e2e', status: 'processing' } })
        return send(200, { data: { id: 'v_e2e', status: 'completed', duration: 3, video_url: `http://127.0.0.1:${server.address().port}/files/v_e2e.mp4` } })
      }
      send(404, { error: { code: 'resource_not_found', message: route } })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, requests, lookPolls: () => lookPolls, close: () => new Promise((resolve) => server.close(resolve)) }
}

async function fakeOpenRouter(voice) {
  const requests = []
  const server = http.createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      requests.push({ url: req.url })
      if (req.method === 'POST' && req.url === '/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(voice); return }
      res.writeHead(404); res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('a HeyGen photo avatar is made from my photo and a script video lands in the Library', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-heygen-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const media = path.join(root, 'media')
  fs.mkdirSync(media)
  const voicePath = path.join(media, 'voice.mp3'), photoPath = path.join(media, 'me.jpg'), takePath = path.join(media, 'take.mp4')
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:a', 'libmp3lame', voicePath])
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xcc8844:s=600x900', '-frames:v', '1', photoPath])
  // What HeyGen sends back: a vertical 1080x1920 talking head with sound.
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x4466aa:s=1080x1920:d=3:r=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', takePath])
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))

  const heygen = await fakeHeygen(takePath)
  const openrouter = await fakeOpenRouter(fs.readFileSync(voicePath))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: openrouter.url, BRIDGECLIP_E2E_HEYGEN_URL: heygen.url } })
  t.after(async () => {
    const timer = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(timer); await heygen.close(); await openrouter.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const shots = process.env.HEYGEN_SCREENSHOT_DIR
  // Screenshots only when asked for (the window is shown so it paints); they never fail the test.
  const shoot = async (name, locator) => {
    if (!shots) return
    fs.mkdirSync(shots, { recursive: true })
    await (locator ?? page).screenshot({ path: path.join(shots, name), timeout: 10000, animations: 'disabled' }).catch(() => undefined)
  }
  if (shots) await session.app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1400, 1000); window.show() })
  await session.app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate((key) => window.bridgeclip.settings.replaceApiKey('heygenApiKey', key), KEY)
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()

  // Settings → API keys: the HeyGen row, and its test shows the account's balance as HeyGen reports it.
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  const check = page.getByRole('group', { name: 'HeyGen key check' })
  await check.getByRole('button', { name: 'Test HeyGen key' }).click()
  await check.getByText('Works · Maya Test · $42.00 left in your HeyGen wallet').waitFor()
  await check.scrollIntoViewIfNeeded()
  await shoot('settings-heygen-key.png', page.locator('div.glass-tile', { has: check }))

  // Avatar Studio → New → Realistic talking avatar (HeyGen, Beta).
  await page.getByRole('button', { name: 'Avatar Studio', exact: true }).first().click()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New avatar' })
  await dialog.getByRole('radio', { name: 'Realistic talking avatar (HeyGen, Beta)' }).click()
  await dialog.getByText('HeyGen asks for your consent').waitFor()
  await shoot('avatar-studio-heygen-option.png', dialog)
  await dialog.getByRole('radio', { name: /A photo of me/ }).click()
  await session.app.evaluate(({ dialog: electronDialog }, file) => { electronDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, photoPath)
  await dialog.getByRole('button', { name: 'Choose photo' }).click()
  await dialog.getByRole('img', { name: 'Your photo for HeyGen' }).waitFor()
  await dialog.getByPlaceholder('e.g. Me on HeyGen').fill('Me on HeyGen')
  const create = dialog.getByRole('button', { name: 'Create HeyGen avatar' })
  assert.equal(await create.isDisabled(), true, 'not without "This is me"')
  await dialog.getByRole('checkbox', { name: /This is me/ }).click()
  await create.click()
  await dialog.waitFor({ state: 'detached' })

  // Training: "Check status" asks HeyGen; the avatar becomes ready.
  const status = page.getByRole('group', { name: 'HeyGen avatar' })
  await status.getByText('HeyGen is training this avatar').waitFor()
  await status.getByRole('button', { name: 'Check status' }).click()
  await status.getByText('Ready. Talking-head videos of Me on HeyGen are lip-synced by HeyGen.').waitFor()
  await shoot('avatar-studio-heygen-ready.png')

  // A script video, lip-synced on HeyGen to the avatar's app voice, then finished here.
  await page.getByRole('textbox', { name: 'Script', exact: true }).fill('Stop buying coffee every morning. Brew it at home.')
  await page.getByRole('textbox', { name: 'Hook text', exact: true }).fill('Stop buying coffee')
  await page.getByText(/Estimated cost about \$\d+\.\d\d: HeyGen at about \$0\.10 a second \(HeyGen’s API price, checked Oct 19, 2026\) plus the voice on OpenRouter/).waitFor()
  await page.getByRole('button', { name: 'Generate video' }).click()
  await page.getByRole('button', { name: 'Post or schedule' }).waitFor({ timeout: 180000 })

  // What HeyGen was asked for: the photo, then a 9:16 1080p video lip-synced to the uploaded voiceover.
  const calls = heygen.requests.filter((item) => item.path !== '/files/v_e2e.mp4')
  assert.ok(calls.every((item) => item.key === KEY), 'every API call carries the key')
  assert.equal(heygen.requests.find((item) => item.path === '/files/v_e2e.mp4').key, null, 'the file download does not')
  const avatarBody = JSON.parse(calls.find((item) => item.method === 'POST' && item.path === '/v3/avatars').body)
  assert.deepEqual([avatarBody.type, avatarBody.file.type], ['photo', 'asset_id'])
  const video = JSON.parse(calls.find((item) => item.method === 'POST' && item.path === '/v3/videos').body)
  assert.deepEqual([video.avatar_id, video.aspect_ratio, video.resolution, typeof video.audio_asset_id, video.script], ['look_e2e', '9:16', '1080p', 'string', undefined])
  assert.equal(calls.filter((item) => item.path === '/v3/assets').length, 2, 'the photo and the voiceover')
  assert.equal(openrouter.requests.filter((item) => item.url === '/audio/speech').length, 1)

  // A Library run like any Avatar Studio video.
  const runs = fs.readdirSync(library).filter((name) => /^avatar-/.test(name))
  assert.equal(runs.length, 1)
  const job = JSON.parse(fs.readFileSync(path.join(library, runs[0], 'job_output.json'), 'utf8'))
  assert.equal(job.source_video_title, 'Avatar Studio · Stop buying coffee')
  assert.deepEqual([job.clips[0].headline, job.clips[0].ai_generated], ['Stop buying coffee', true])
  const probe = JSON.parse(execFileSync(tools.ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', path.join(library, runs[0], 'clip_00.mp4')]).toString())
  assert.deepEqual([probe.streams[0].width, probe.streams[0].height], [1080, 1920])

  // Spending: HeyGen's avatar creation and the video, at its published prices, marked as estimates.
  const ledger = fs.readFileSync(path.join(userDataDir, 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => entry.provider === 'heygen')
  assert.deepEqual(ledger.map((entry) => [entry.label, entry.usd, entry.estimated]), [['HeyGen photo avatar', 1, true], ['HeyGen avatar video', 0.3, true]])
  assert.ok(!fs.readFileSync(path.join(userDataDir, 'spending', 'ledger.jsonl'), 'utf8').includes(KEY))

  await page.getByRole('button', { name: 'Open in Library' }).click()
  await page.getByText('Stop buying coffee', { exact: true }).first().waitFor()
  assert.deepEqual(errors, [])
})
