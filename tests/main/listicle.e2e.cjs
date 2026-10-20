const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

/** A stand-in for OpenRouter: the script call answers with a list script; every voice request gets the same short voiceover. */
async function fakeOpenRouter(voice) {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push({ url: req.url, body })
      if (req.method === 'POST' && req.url === '/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(voice); return }
      if (req.method === 'POST' && req.url === '/chat/completions') {
        const script = {
          intro: 'Three tools that change how your videos look.', titleAccent: 'look',
          items: [
            { script: 'HyperFrames turns plain HTML into video.', accent: 'HyperFrames' },
            { script: 'Onetake films one continuous shot.', accent: 'Onetake' },
            { script: 'Collage B-roll makes paper cutout b-roll.', accent: 'B-roll' }
          ]
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ usage: { cost: 0.002 }, choices: [{ message: { content: JSON.stringify(script) } }] }))
        return
      }
      res.writeHead(404); res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('a Top list is made from items, an AI-drafted script and a preset voice, and lands in the Library', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-listicle-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const media = path.join(root, 'media')
  fs.mkdirSync(media)
  const voicePath = path.join(media, 'voice.mp3')
  execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1.5', '-c:a', 'libmp3lame', voicePath])
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))

  const openrouter = await fakeOpenRouter(fs.readFileSync(voicePath))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: openrouter.url, BRIDGECLIP_E2E_OPENROUTER_URL: `${openrouter.url}/chat/completions` } })
  t.after(async () => {
    const timer = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(timer); await openrouter.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Linux without a desktop keyring only offers plain-text storage, which the app refuses for keys. This test's key is fake.
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

  // No avatar needed: Avatar Studio's Top list side.
  await page.getByRole('button', { name: 'Avatar Studio', exact: true }).first().click()
  await page.getByRole('radiogroup', { name: 'What to make' }).getByRole('radio', { name: /Top list/ }).click()
  await page.getByRole('textbox', { name: 'List title' }).fill('3 tools that change how your videos look')
  const names = ['HyperFrames', 'Onetake', 'Collage B-roll']
  for (const [i, name] of names.entries()) await page.getByRole('textbox', { name: `Name of item ${i + 1}` }).fill(name)
  await page.getByRole('textbox', { name: 'About item 1' }).fill('Open source, turns HTML into video')

  // The AI drafts the lines; they stay editable.
  await page.getByRole('button', { name: 'Write the script' }).click()
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Script for item 3"]')?.value.includes('paper cutout'))
  await page.getByRole('textbox', { name: 'Script for item 2' }).fill('Onetake films everything in one continuous shot.')
  const chat = openrouter.requests.find((request) => request.url === '/chat/completions')
  const sent = JSON.parse(JSON.parse(chat.body).messages[1].content)
  assert.deepEqual(sent.items.map((item) => item.name), names)
  // The title's italic word came back from the script.
  assert.equal(await page.getByRole('radiogroup', { name: 'Italic word in the title' }).getByRole('radio', { checked: true }).textContent(), 'look')

  await page.getByRole('textbox', { name: 'Header' }).fill('Web Lab · AI tools')
  await page.getByRole('textbox', { name: 'Your handle' }).fill('@weblab')
  if (process.env.LISTICLE_SAVE_DIR) {
    await session.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setBackgroundThrottling(false); w.show(); w.setSize(1280, 1000) })
    await page.waitForTimeout(600)
    await page.getByRole('textbox', { name: 'List title' }).evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
    const png = await session.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    fs.mkdirSync(process.env.LISTICLE_SAVE_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.LISTICLE_SAVE_DIR, 'listicle-studio.png'), Buffer.from(png, 'base64'))
  }
  // The cost estimate shows before anything is paid.
  assert.match(await page.getByTestId('listicle-cost').textContent(), /The voice costs about \$0\.\d\d through your OpenRouter account/)
  await page.getByRole('button', { name: 'Make the video' }).click()
  await page.getByTestId('listicle-result').waitFor({ timeout: 240000 })
  assert.equal(openrouter.requests.filter((request) => request.url === '/audio/speech').length, 4, 'the opening and each item are voiced')
  const voiced = openrouter.requests.filter((request) => request.url === '/audio/speech').map((request) => JSON.parse(request.body).input)
  assert.ok(voiced.includes('Onetake films everything in one continuous shot.'), 'the edited line is what is said')

  // Its own Library run: clip_00.mp4 and job_output.json, made by the list maker.
  const runs = fs.readdirSync(library).filter((name) => /^listicle-/.test(name))
  assert.equal(runs.length, 1)
  const job = JSON.parse(fs.readFileSync(path.join(library, runs[0], 'job_output.json'), 'utf8'))
  assert.equal(job.source_video_title, 'Top list · 3 tools that change how your videos look')
  assert.equal(job.metrics.listicle, true)
  assert.equal(job.clips[0].ai_generated, true)
  const clip = path.join(library, runs[0], 'clip_00.mp4')
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', clip]).toString())
  assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ['audio', 'video'])
  assert.deepEqual([probe.streams.find((stream) => stream.codec_type === 'video').width, probe.streams.find((stream) => stream.codec_type === 'video').height], [1080, 1920])
  if (process.env.LISTICLE_SAVE_DIR) {
    fs.mkdirSync(process.env.LISTICLE_SAVE_DIR, { recursive: true })
    fs.copyFileSync(clip, path.join(process.env.LISTICLE_SAVE_DIR, 'e2e-listicle.mp4'))
  }

  // Open in Library goes straight to it.
  await page.getByRole('button', { name: 'Open in Library' }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Top list · 3 tools that change how your videos look', exact: true }).waitFor()
  assert.deepEqual(errors, [])
})
