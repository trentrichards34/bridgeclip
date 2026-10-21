const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

/** What the stand-in vision model "sees", by the file name the app sends with each shot. */
const SEEN = {
  beach: { description: 'Waves rolling onto a sandy beach at sunset', tags: ['beach', 'waves', 'sunset'], shot_type: 'wide' },
  desk: { description: 'Hands typing on a laptop on a wooden desk', tags: ['laptop', 'typing', 'desk'], shot_type: 'hands' }
}

/** A stand-in for OpenRouter: chat completions answer as a vision model; the balance checks have nothing to say. */
async function fakeOpenRouter() {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push({ url: req.url, body })
      if (req.method === 'POST' && req.url === '/chat/completions') {
        const parsed = JSON.parse(body)
        const text = parsed.messages[1].content.filter((part) => part.type === 'text').map((part) => part.text).join(' ')
        const seen = SEEN[/File name: (\w+)/.exec(text)?.[1]] ?? { description: 'Something else', tags: [], shot_type: 'other' }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ...seen, subjects: [], setting: '', motion: 'slow', mood: 'calm', member_appears: false, on_screen_text: '', quality: '' }) } }],
          usage: { cost: 0.0015 }
        }))
        return
      }
      res.writeHead(404); res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('B-roll library: two clips are added, looked at by the vision model (mocked), listed with what is in them, and searchable', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t)
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-broll-library-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const footage = path.join(root, 'footage')
  fs.mkdirSync(footage)
  const beach = path.join(footage, 'beach.mp4'), desk = path.join(footage, 'desk.mp4')
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2266cc:s=320x180:d=3:r=15', ...tools.encoder, '-pix_fmt', 'yuv420p', beach])
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=3:r=15', ...tools.encoder, '-pix_fmt', 'yuv420p', desk])
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: 'python3', openrouterApiKey: '', zernioApiKey: '' }))

  const openrouter = await fakeOpenRouter()
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: openrouter.url } })
  t.after(async () => {
    const timer = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(timer); await openrouter.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Linux without a desktop keyring only offers plain-text storage, which the app refuses for keys. This key is fake.
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

  // The page is in the sidebar; it starts empty.
  await page.getByRole('button', { name: 'B-roll library', exact: true }).first().click()
  await page.getByText('Your B-roll library is empty').waitFor()

  // Add both clips (the file dialog in main is answered here).
  await session.app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }) }, [beach, desk])
  await page.getByRole('button', { name: 'Add clips or pictures' }).first().click()

  // Prepared, then looked at once each (the vision model is the mock), and listed with what was seen.
  await page.getByText(SEEN.beach.description).waitFor({ timeout: 120000 })
  await page.getByText(SEEN.desk.description).waitFor()
  const looks = openrouter.requests.filter((request) => request.url === '/chat/completions')
  assert.equal(looks.length, 2)
  const sent = JSON.parse(looks[0].body)
  assert.equal(sent.model, 'google/gemini-3.8-flash')
  assert.ok(sent.messages[1].content.some((part) => part.type === 'image_url'), 'frames are sent as pictures')
  await page.getByTestId('broll-index-result').getByText(/Looked at 2 shots for \$0\.003/).waitFor()
  assert.equal(await page.getByTestId('broll-item').count(), 2)

  // Search runs over what was seen, locally.
  await page.getByRole('textbox', { name: 'Search your b-roll' }).fill('waves')
  await page.getByText('1 of 2 match.').waitFor()
  assert.equal(await page.getByTestId('broll-item').count(), 1)
  await page.getByRole('listitem', { name: 'beach' }).waitFor()
  await page.getByRole('textbox', { name: 'Search your b-roll' }).fill('laptop typing')
  await page.getByRole('listitem', { name: 'desk' }).waitFor()
  assert.equal(await page.getByTestId('broll-item').count(), 1)

  // The index is saved in userData, versioned; the originals were used in place, and each has a small proxy.
  const index = JSON.parse(fs.readFileSync(path.join(userDataDir, 'broll-library', 'index.json'), 'utf8'))
  assert.equal(index.version, 1)
  assert.deepEqual(index.items.map((item) => item.original).sort(), [fs.realpathSync(beach), fs.realpathSync(desk)].sort())
  assert.equal(fs.readdirSync(path.join(userDataDir, 'broll-library', 'proxies')).length, 2)
  // Nothing new: reloading does not look again.
  await page.reload()
  await page.getByRole('button', { name: 'B-roll library', exact: true }).first().click()
  await page.getByText(SEEN.desk.description).waitFor()
  assert.equal(openrouter.requests.filter((request) => request.url === '/chat/completions').length, 2)
  // The spending ledger has the looks.
  const ledger = fs.readFileSync(path.join(userDataDir, 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(ledger.some((entry) => entry.kind === 'broll' && Math.abs(entry.usd - 0.003) < 1e-9), JSON.stringify(ledger))
  assert.deepEqual(errors, [])
})
