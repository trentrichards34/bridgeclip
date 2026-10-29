const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

// The progress view for Combine clips: the steps of the whole job, the clip strip with the current clip lit, the first
// words heard in each clip, what the plan found, and the reel being made, plus the sidebar's running card. Listening
// (the Scribe stand-in) and planning (the fake-ai-edit stand-in) are slowed down so each step can be seen; the rest
// is real. Set BRIDGECLIP_E2E_SHOTS to a folder to keep a screenshot of each step.

async function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  // The app's window (graphics are drawn in hidden windows of their own while the reel is made).
  const main = async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.isVisible()) ?? BrowserWindow.getAllWindows()[0]
  await app.evaluate(async (electron, source) => (await eval(source)(electron)).webContents.invalidate(), main.toString()).catch(() => null)
  await new Promise((resolve) => setTimeout(resolve, 350))
  const png = await app.evaluate(async (electron, source) => (await (await eval(source)(electron)).webContents.capturePage()).toPNG().toString('base64'), main.toString()).catch(() => null)
  if (png) fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))
}

function say(text, start, step = 0.32) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.04).toFixed(3), type: 'word' }))
}

// The same three clips the fake plan knows (combine-clips.e2e.cjs).
const A = say('First I filmed this one sideways.', 0.7)
const B = say('Then this one is slower beep here.', 0.5)
const C = [...say('My dashboard says $8,188 today.', 0.6), ...say('And here is my screen.', 2.6)]

test('Combine clips progress: steps, clip strip, words heard, plan finds, the reel being made, and the sidebar card', { timeout: 900000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-edit-progress-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const tone = (words) => `aevalsrc='0.25*sin(2*PI*300*t)*(${words.map((w) => `between(t,${w.start},${w.end})`).join('+')})':s=48000:d=5`
  const clips = [[A, '0x3a6ea5', '2026-10-21T13:27:00Z'], [B, '0xa5513a', '2026-10-21T13:28:00Z'], [C, '0xF0F0F0', '2026-10-21T13:29:00Z']].map(([words, color, created], i) => {
    const file = path.join(root, `IMG_400${i + 1}.MOV`)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:r=30:d=5,drawbox=x=40:y=200:w=280:h=240:color=0xffffff@0.35:t=fill`, '-f', 'lavfi', '-i', tone(words),
      ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-metadata', `creation_time=${created}`, file])
    return file
  })

  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 CREATORCLIPS_FAKE_AI_DELAY=6 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '', customVocabulary: '' }))

  // Scribe stand-in: a few seconds per clip, as a real one takes.
  let heard = 0
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      if (req.url !== '/api/v1/audio/transcriptions') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return }
      const words = [A, B, C][heard++] ?? []
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ text: words.map((w) => w.word).join(' '), words, usage: { cost: 0.0003, seconds: 4 } }))
      }, 4000)
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
  await app.evaluate(({ BrowserWindow }, show) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(1440, 900)
    if (show) { window.webContents.setBackgroundThrottling(false); window.show() }
  }, Boolean(process.env.BRIDGECLIP_E2E_SHOTS))
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

  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('button', { name: /^Edit my recording/ }).click()
  await page.getByRole('heading', { name: 'Raw takes in, one finished reel out', level: 1 }).waitFor()
  await page.getByRole('radiogroup', { name: 'What did you film?' }).getByRole('radio', { name: /^Parts to combine/ }).click()
  await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }) }, clips)
  await page.getByRole('button', { name: 'Choose clips or a .zip' }).click()
  await page.getByRole('list', { name: 'Your clips' }).getByText('Clip 3 · IMG_4003.MOV').waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Combine my clips' }).click()

  // The whole job's steps, in order, with the current one marked.
  const view = page.getByTestId('edit-progress')
  await view.waitFor()
  const steps = view.getByRole('list', { name: 'Steps' })
  const names = async () => steps.locator(':scope > li').evaluateAll((items) => items.map((li) => li.textContent.replace(/[\d:]+$|Done$|You$/, '').split(' · ')[0].trim()))
  assert.deepEqual((await names()).slice(0, 4), ['Getting your clips ready', 'Listening', 'Planning the edit', 'Your review'])
  assert.ok((await names()).includes('Cutting your edit') && (await names()).includes('Saving your reel'))
  assert.equal(await steps.locator('li[aria-current="step"]').count(), 1)
  // The estimate line says what it's timing, never a made-up time on a first run.
  await view.getByTestId('edit-progress-estimate').getByText(/^Timing it as it goes: 3 clips, 0:15 of video\./).waitFor()
  if (await view.getByTestId('edit-progress-heading').getByText(/^Getting clip \d of 3 ready$/).waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    await view.getByRole('list', { name: 'Your clips' }).waitFor()
    await shot(app, 'progress-1-getting-ready.png')
  }

  // Listening: the clip strip with clip 2 lit and clip 1 checked, and the first words heard in clip 1.
  await view.getByTestId('edit-progress-heading').getByText('Listening to clip 2 of 3').waitFor({ timeout: 120000 })
  const strip = view.getByRole('list', { name: 'Your clips' })
  assert.equal(await strip.locator(':scope > li').count(), 3)
  assert.equal(await strip.locator('li[aria-current="step"]').getAttribute('aria-label'), 'Clip 2, working on it')
  assert.equal(await strip.locator(':scope > li').first().getAttribute('aria-label'), 'Clip 1, done')
  await view.getByTestId('edit-progress-heard').waitFor()
  assert.equal(await view.getByTestId('edit-progress-heard').innerText(), '“First I filmed this one sideways.”')
  assert.equal(await steps.locator('li[aria-current="step"]').innerText().then((text) => text.split('\n')[0].split(' · ')[0]), 'Listening')
  assert.equal(await steps.locator('li').first().getAttribute('data-state'), 'done')
  await page.waitForTimeout(1200)
  await shot(app, 'progress-2-listening.png')

  // The sidebar's running card, from another page; it opens the page again.
  await nav.getByRole('button', { name: /^Library/ }).click()
  const card = page.getByTestId('edit-run-card')
  await card.waitFor()
  assert.match(await card.innerText(), /Combining 3 clips/)
  await shot(app, 'progress-3-sidebar-card.png')
  await card.click()
  await view.waitFor()

  // Planning: what the local checks found, then the hook once the plan is back.
  await view.getByTestId('edit-progress-heading').getByText('Planning the edit').waitFor({ timeout: 120000 })
  await view.getByTestId('edit-progress-found').getByText(/^Heard \d+ words in 3 clips$/).waitFor()
  await view.getByTestId('edit-progress-found').getByText('Looking for your strongest hook').waitFor()
  // Listening took a measured time: the time left for the edit is known now.
  await page.waitForTimeout(1500)
  await shot(app, 'progress-4-planning.png')

  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 300000 })
  await page.getByRole('button', { name: 'Make my reel' }).click()
  // The beat sheet is offered first (beat-sheet.e2e covers it): make the reel now.
  await page.getByRole('dialog', { name: 'See your beats first?' }).getByRole('button', { name: 'Render now' }).click()
  // Making the reel: the steps after the review, the opening frame and what goes in it.
  await view.waitFor({ timeout: 60000 })
  await view.getByText('Your opening').waitFor({ timeout: 60000 })
  await view.getByTestId('edit-progress-found').getByText('Opening on “My dashboard says $8,188 today”').waitFor()
  assert.equal(await steps.locator('li', { hasText: 'Your review' }).getAttribute('data-state'), 'done')
  await view.getByRole('list', { name: 'Your clips, in the reel’s order' }).waitFor()
  const seen = new Set()
  for (let i = 0; i < 400 && !(await page.getByText('Your reel is ready').count()); i++) {
    const heading = await view.getByTestId('edit-progress-heading').innerText({ timeout: 1000 }).catch(() => null)
    const key = heading?.replace(/\d+/g, 'n')
    if (heading && !seen.has(key)) { seen.add(key); await shot(app, `progress-5-making-${seen.size}.png`) }
    await page.waitForTimeout(250)
  }
  await page.getByText('Your reel is ready').waitFor({ timeout: 600000 })
  assert.ok(seen.size >= 1, 'the making view was seen')

  // How it looks for 13 clips (the owner's case), at 1280 × 800: a status sent to the page only (no run), for the screenshot.
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    const real = await page.evaluate(() => window.bridgeclip.edit.status())
    const now = Date.now()
    const sources = Array.from({ length: 13 }, (_, i) => ({ ...real.sources[i % 3], name: `IMG_41${String(i).padStart(2, '0')}.MOV`, thumb: undefined }))
    const lines = ['First I filmed this one sideways.', 'Then this one is slower beep here.', 'My dashboard says $8,188 today.']
    const fake = { ...real, phase: 'transcribing', detail: 'Listening to your clips (7 of 13)', percent: 59, plan: null, output: null, sources,
      progress: { startedAt: now - 151000, renderStartedAt: null, step: { n: 7, of: 13 }, clip: 6, wordsHeard: 141, found: {}, order: null,
        stages: [{ id: 'ready', startedAt: now - 151000, endedAt: now - 88000 }, { id: 'listen', startedAt: now - 88000, endedAt: null }],
        heard: Array.from({ length: 6 }, (_, i) => ({ src: i, text: lines[i % 3] })) } }
    await app.evaluate(({ BrowserWindow }, [status, size]) => { const w = BrowserWindow.getAllWindows().find((x) => x.isVisible()); w.setContentSize(...size); w.webContents.send('edit:status', status) }, [fake, [1280, 800]])
    await page.waitForTimeout(2000)
    await shot(app, 'progress-6-thirteen-clips-1280.png')
    await app.evaluate(({ BrowserWindow }, status) => BrowserWindow.getAllWindows().find((x) => x.isVisible()).webContents.send('edit:status', status), real)
    await page.getByText('Your reel is ready').waitFor()
  }
  assert.deepEqual(errors, [])
})
