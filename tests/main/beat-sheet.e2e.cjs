// Edit my recording's beat sheet, in the app on a short take: "Make my reel" offers the beat sheet first, the sheet
// shows every planned on-screen moment as a numbered still (frames from the recording, graphics drawn live), one
// beat is removed and another swapped for another visual (only those two change), a beat's motion plays, and the
// reel made from it (a clip editor project) has exactly those changes.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

const SHOT = process.env.BRIDGECLIP_BEAT_SHEET_SHOT || null
const shotPath = SHOT ?? (process.env.BRIDGECLIP_E2E_SHOTS ? path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'beat-sheet.png') : null)

function say(text, start, step = 0.32) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.04).toFixed(3), type: 'word' }))
}
const TAKE = [...say('Most coaches lose clients.', 0.5), ...say('No, again.', 2.1), ...say('Most coaches lose so many clients.', 3.0),
  ...say('Fifteen billion messages wait.', 5.6), ...say('Follow me for more.', 7.4)]

test('Edit my recording: the beat sheet before the reel, one beat removed and one swapped, and the reel matches', { timeout: 600000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-beat-sheet-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const recording = path.join(root, 'my take.mp4')
  const expr = TAKE.map((w) => `between(t,${w.start},${w.end})`).join('+')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=9.5', '-f', 'lavfi', '-i', `aevalsrc='0.25*sin(2*PI*300*t)*(${expr})':s=48000:d=9.5`,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', recording])
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))

  // The stand-in OpenRouter: only the transcription (the plan is the engine's stand-in; nothing here uses the chat).
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      if (req.url === '/api/v1/audio/transcriptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ text: TAKE.map((w) => w.word).join(' '), words: TAKE, usage: { cost: 0.0004, seconds: 9 } }))
        return
      }
      res.writeHead(404).end('{}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/v1`
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: base, BRIDGECLIP_E2E_OPENROUTER_URL: `${base}/chat/completions` } })
  t.after(async () => {
    server.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  // Shown for the screenshot (a hidden window can capture a stale frame).
  await app.evaluate(({ BrowserWindow }, show) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1400, 1100); window.webContents.setBackgroundThrottling(false); if (show) window.show() }, Boolean(shotPath))
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, recording)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Edit my recording/ }).click()
  await page.getByRole('heading', { name: 'Raw takes in, one finished reel out', level: 1 }).waitFor()
  await page.getByRole('button', { name: 'Choose recordings' }).click()
  await page.getByRole('list', { name: 'Your recordings' }).getByText('my take.mp4').waitFor()
  await page.getByRole('button', { name: 'Edit my recording', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 180000 })

  // "Make my reel" offers the beat sheet first (the default); "Always show it" is remembered.
  await page.getByRole('button', { name: 'Make my reel' }).click()
  const offer = page.getByRole('dialog', { name: 'See your beats first?' })
  await offer.getByRole('radio', { name: 'Always show it' }).click()
  await offer.getByRole('button', { name: 'Show me the beat sheet' }).click()
  await offer.waitFor({ state: 'detached' })
  assert.equal((await page.evaluate(() => window.bridgeclip.prefs.load())).beatSheet, 'always')

  const sheet = page.getByTestId('beat-sheet')
  await sheet.waitFor()
  const cards = sheet.getByTestId('beat-card')
  const keys = async () => cards.evaluateAll((list) => list.map((li) => li.getAttribute('data-beat')))
  const before = await keys()
  // The plan (the half-screen stat starts off in the default edit style): the hook, the "15 billion" pop-up, the
  // statement on the kept take, the call to action at the end.
  assert.equal(before[0], 'hook')
  assert.equal(before.at(-1), 'cta')
  assert.ok(before.includes('p:0') && !before.includes('p:1'), before.join())
  const statementKey = before.find((key) => key.startsWith('g:'))
  assert.ok(statementKey, before.join())
  for (let i = 0; i < before.length; i++) await sheet.getByRole('listitem', { name: `Beat ${i + 1}`, exact: true }).waitFor()
  // Every still arrives (one frame per beat from the recording), progressively, well within the time.
  const started = Date.now()
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('[data-testid="beat-sheet"] [data-testid="beat-frame"]')]
    return imgs.length === document.querySelectorAll('[data-testid="beat-sheet"] [data-testid="beat-card"]').length && imgs.every((img) => img.complete && img.naturalWidth > 0)
  }, null, { timeout: 30000 })
  assert.ok(Date.now() - started < 30000)
  await sheet.getByTestId('beat-sheet-progress').getByText(/stills ready$/).waitFor()
  await sheet.scrollIntoViewIfNeeded()
  if (shotPath) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(shotPath, Buffer.from(png, 'base64'))
  }

  const statement = cards.and(page.locator(`[data-beat="${statementKey}"]`))
  const statementShown = await statement.getByTestId('beat-shown').innerText()
  // The plan's statement on the kept take (the director may draw it as an effect, like a marker).
  assert.match(statementShown, /^[A-Za-z ]+: Most coaches lose clients\./, statementShown)
  // Its graphic is drawn over the frame by the live renderer, settled.
  await statement.locator('.editor-graphic-view').first().waitFor()
  const frames = fs.readdirSync(path.join(library, fs.readdirSync(library).find((name) => /^edit-/.test(name)), '.work', 'beats')).filter((name) => /^[a-f0-9]{32}\.jpg$/.test(name))
  assert.ok(frames.length >= 3, `frames cached in the run (${frames.length})`)
  const hashes = async () => Object.fromEntries(await cards.evaluateAll((list) => list.map((li) => [li.getAttribute('data-beat'), li.getAttribute('data-hash')])))
  const first = await hashes()

  // Remove the "15 billion" pop-up: it stays in place, dimmed, and nothing else changes.
  const popupNumber = before.indexOf('p:0') + 1
  await sheet.getByRole('button', { name: `Remove beat ${popupNumber}`, exact: true }).click()
  await cards.and(page.locator('[data-beat="p:0"]')).getByText('Removed', { exact: true }).waitFor()
  await sheet.getByRole('listitem', { name: `Beat ${popupNumber}`, exact: true }).getByRole('button', { name: 'Bring back' }).waitFor()
  const afterRemove = await hashes()
  for (const key of before) if (key !== 'p:0') assert.equal(afterRemove[key], first[key], `beat ${key} is unchanged`)

  // Swap the statement for a title slam: the same beat (same graphic, same word), new words from what is said there.
  const statementNumber = before.indexOf(statementKey) + 1
  await sheet.getByRole('button', { name: `Swap the visual of beat ${statementNumber}`, exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Swap the visual' })
  await gallery.getByRole('button', { name: 'Add Title slam', exact: true }).click()
  await gallery.waitFor({ state: 'detached' })
  await statement.getByTestId('beat-shown').getByText(/^Title slam: /).waitFor()
  const afterSwap = await hashes()
  assert.notEqual(afterSwap[statementKey], first[statementKey])
  for (const key of before) if (key !== 'p:0' && key !== statementKey) assert.equal(afterSwap[key], first[key], `beat ${key} is unchanged`)
  const swappedWords = (await statement.getByTestId('beat-shown').innerText()).replace(/^Title slam: /, '')

  // Preview motion: the beat's few seconds play from the recording, the graphic drawn live.
  await sheet.getByRole('button', { name: `Preview motion of beat ${statementNumber}`, exact: true }).click()
  const preview = page.getByRole('dialog', { name: `Beat ${statementNumber}: preview motion` })
  const played = await preview.locator('video').evaluate((video) => new Promise((resolve) => {
    const check = () => video.currentTime > 0.2 ? resolve(video.currentTime) : null
    video.addEventListener('timeupdate', check)
    setTimeout(() => resolve(video.currentTime), 15000)
  }))
  assert.ok(played > 0.2, `the beat plays (${played})`)
  await preview.getByRole('button', { name: 'Done' }).click()
  await preview.waitFor({ state: 'detached' })

  // "Looks good, render": the reel is the clip editor project with exactly those changes.
  const ctaNote = await page.locator('[data-beat="cta"] [role="note"]').count()
  await page.getByRole('button', { name: 'Looks good, render' }).click()
  await page.getByText('Your reel is ready').waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  const project = JSON.parse(fs.readFileSync(path.join(library, run, 'editor-project.json'), 'utf8'))
  const graphics = project.candidates[0].graphics
  const swapped = graphics.find((g) => g.id === statementKey.slice(2))
  assert.ok(swapped, `the swapped graphic keeps its id: ${JSON.stringify(graphics.map((g) => [g.id, g.template]))}`)
  assert.equal(swapped.template, 'title')
  assert.equal(swapped.fields.text, swappedWords)
  assert.ok(!graphics.some((g) => g.id !== swapped.id && Object.values(g.fields).some((v) => /Most coaches lose clients/.test(v))), 'the planned visual was swapped, not added to')
  assert.ok(!graphics.some((g) => g.template === 'stat'), 'the removed pop-up (a stat on a directed reel) is not in the reel')
  // The call to action's button shows when the sheet said it would (here the reel ends too soon after it).
  assert.equal(graphics.some((g) => g.template === 'link_cta'), ctaNote === 0, JSON.stringify(graphics.map((g) => g.template)))
  assert.equal(project.candidates[0].status, 'baked')
  assert.deepEqual(errors, [])
})
