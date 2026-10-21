// Edit my recording, the review's Chat panel and Graphics, driven in the app against a stand-in OpenRouter: one chat
// request cuts a word and adds a stat graphic on "Fifteen" (a change card with Keep or Undo), Undo on a second answer
// puts the opening back, and the made reel shows the graphic while the hook plays.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

async function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
  if (png) fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))
}

function say(text, start, step = 0.32) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.04).toFixed(3), type: 'word' }))
}
const TAKE = [...say('Most coaches lose clients.', 0.5), ...say('No, again.', 2.1), ...say('Most coaches lose so many clients.', 3.0),
  ...say('Fifteen billion messages wait.', 5.6), ...say('Follow me for more.', 7.4)]
const sse = (chunks) => `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`
const call = (name, args, index = 0) => ({ choices: [{ delta: { tool_calls: [{ index, id: `call_${name}_${index}`, function: { name, arguments: JSON.stringify(args) } }] } }] })

/** Mean RGB of a box of a frame at `seconds`. */
function boxColor(ffmpeg, video, seconds, [x, y, w, h]) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const sum = [0, 0, 0]
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += raw[i + c]
  return sum.map((n) => n / (raw.length / 3))
}

test('Edit my recording: a chat request cuts a word and adds a stat graphic, Undo works, and the reel shows the graphic', { timeout: 600000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-edit-chat-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const recording = path.join(root, 'my take.mp4')
  const expr = TAKE.map((w) => `between(t,${w.start},${w.end})`).join('+')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=9.5', '-f', 'lavfi', '-i', `aevalsrc='0.25*sin(2*PI*300*t)*(${expr})':s=48000:d=9.5`,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', recording])
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))

  // The stand-in OpenRouter: Scribe words, and the chat (streamed, with tool calls picked from the words it was shown).
  const chats = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.url === '/api/v1/audio/transcriptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ text: TAKE.map((w) => w.word).join(' '), words: TAKE, usage: { cost: 0.0004, seconds: 9 } }))
        return
      }
      if (req.url !== '/api/v1/chat/completions') { res.writeHead(404).end('{}'); return }
      const request = JSON.parse(Buffer.concat(chunks).toString())
      chats.push(request)
      const context = request.messages[0].content
      const ask = [...request.messages].reverse().find((m) => m.role === 'user').content
      const index = (word) => Number(new RegExp(`(\\d+):${word.replace(/[.$]/g, '\\$&')}(?=\\s|$)`).exec(context)?.[1])
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (request.messages.at(-1).role === 'user' && /fifteen/i.test(ask)) {
        res.end(sse([call('cut_words', { start: index('so'), end: index('so'), reason: 'the extra “so”' }),
          call('add_graphic', { template: 'stat', word: index('Fifteen'), duration_ms: 2000, fields: { value: '15 billion', label: 'messages wait' } }, 1), { choices: [], usage: { cost: 0.003 } }]))
      } else if (request.messages.at(-1).role === 'user') {
        res.end(sse([call('set_openings', { raw_intro: true }), { choices: [], usage: { cost: 0.002 } }]))
      } else {
        res.end(sse([{ choices: [{ delta: { content: /fifteen/i.test(ask) ? 'Done: “so” is cut and a stat shows when you say “Fifteen”.' : 'The raw-to-edited opening is on.' } }] }, { choices: [], usage: { cost: 0.001 } }]))
      }
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
    window.setSize(1400, 1100)
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
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, recording)

  // After the reload, open the page from the sidebar once it's there (the shortcut can land before the app is ready).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Edit my recording/ }).click()
  await page.getByRole('heading', { name: 'Edit my recording', level: 1 }).waitFor()
  await page.getByRole('button', { name: 'Choose recordings' }).click()
  await page.getByRole('list', { name: 'Your recordings' }).getByText('my take.mp4').waitFor()
  await page.getByRole('button', { name: 'Edit my recording', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 180000 })
  const words = (await page.evaluate(() => window.bridgeclip.edit.status())).plan.words
  const at = (text) => words.findIndex((w) => w.text === text)
  assert.equal(await page.locator(`[data-word="${at('so')}"]`).getAttribute('aria-pressed'), 'true')

  // One chat request: cut "so" and add a stat graphic on "Fifteen".
  const chat = page.getByRole('region', { name: 'Chat about your edit' })
  await chat.getByText(/OpenRouter credit\. Model: /).waitFor()
  for (const chip of ['Cut the retakes', 'Punchier hook', 'Add a stat graphic', 'Turn off the pop-ups']) await chat.getByRole('button', { name: chip, exact: true }).waitFor()
  await chat.getByRole('textbox', { name: 'Message' }).fill('Cut the “so” and add a stat graphic when I say fifteen billion')
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter')
  const card = chat.getByRole('group', { name: 'Chat changes' }).first()
  await card.getByText('Cut “so” (1 word) (the extra “so”).').waitFor()
  await card.getByText('Added a stat counter on “Fifteen”.').waitFor()
  await card.getByText(/^Your reel is now about 0:0\d long\.$/).waitFor()
  await chat.getByText('Done: “so” is cut and a stat shows when you say “Fifteen”.').waitFor()
  assert.equal(await page.locator(`[data-word="${at('so')}"]`).getAttribute('aria-pressed'), 'false')
  const graphics = page.getByRole('region', { name: 'Graphics', exact: true })
  await graphics.getByRole('list', { name: 'Your graphics' }).getByText('Stat counter on “Fifteen”').waitFor()
  // The model saw the words with their indexes, and the request went through the paid channel's check.
  assert.match(chats[0].messages[0].content, new RegExp(`${at('Fifteen')}:Fifteen`))
  assert.deepEqual(chats[0].tools.map((tool) => tool.function.name).includes('add_graphic'), true)
  await card.getByRole('button', { name: 'Keep', exact: true }).click()
  await card.getByText('Kept', { exact: true }).waitFor()
  // The graphic's words can be changed in the Graphics section; its frame shows where it sits.
  await graphics.getByRole('list', { name: 'Your graphics' }).getByText('Stat counter on “Fifteen”').click()
  assert.equal(await graphics.getByLabel('Stat counter number', { exact: true }).inputValue(), '15 billion')
  await graphics.getByLabel('Where it sits').locator('.mg-stat-value').waitFor()
  await graphics.scrollIntoViewIfNeeded()
  await shot(app, 'edit-review-graphics.png')
  await chat.scrollIntoViewIfNeeded()
  await shot(app, 'edit-review-chat.png')

  // A second answer, undone: the opening goes back off.
  await chat.getByRole('textbox', { name: 'Message' }).fill('Show the raw take first')
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter')
  const second = chat.getByRole('group', { name: 'Chat changes' }).nth(1)
  await second.getByText('Raw-to-edited opening on.').waitFor()
  assert.equal(await page.getByRole('switch', { name: 'Raw-to-edited opening' }).getAttribute('aria-checked'), 'true')
  await second.getByRole('button', { name: 'Undo', exact: true }).click()
  await second.getByText('Undone', { exact: true }).waitFor()
  assert.equal(await page.getByRole('switch', { name: 'Raw-to-edited opening' }).getAttribute('aria-checked'), 'false')
  assert.equal(chats.length, 4)
  // Point: the review has no live preview, so a small frame of the take opens to point on; the pin waits as a chip.
  const pointButton = chat.getByRole('button', { name: 'Point', exact: true })
  await pointButton.click()
  assert.equal(await pointButton.getAttribute('aria-pressed'), 'true')
  const pad = chat.getByTestId('point-layer')
  const padBox = await pad.boundingBox()
  await page.mouse.click(padBox.x + padBox.width * 0.2, padBox.y + padBox.height * 0.15)
  const pins = chat.getByRole('list', { name: 'Pins for your next message' })
  await pins.getByText('Pin 1 · top-left', { exact: true }).waitFor()
  // The frame is a still of the take (it was black when the video's URL carried a #t= fragment, which the local-file protocol refuses).
  const still = await chat.locator('.chat-point-pad video').evaluate((video) => new Promise((resolve) => {
    const done = () => resolve({ ready: video.readyState, at: video.currentTime, error: video.error?.code ?? null, src: video.src })
    if (video.readyState >= 2 && !video.seeking && video.currentTime > 0) return done()
    video.addEventListener('seeked', done, { once: true })
    setTimeout(done, 15000)
  }))
  assert.ok(still.ready >= 2 && still.at > 0 && still.error === null && !still.src.includes('#'), JSON.stringify(still))
  for (const chip of ['Put an arrow here', 'Circle this', 'Move the graphic here']) await chat.getByRole('button', { name: chip, exact: true }).waitFor()
  await chat.scrollIntoViewIfNeeded()
  await shot(app, 'edit-review-point.png')
  await pins.getByRole('button', { name: 'Remove pin 1' }).click()
  assert.equal(await pins.count(), 0)

  // The reel: the hook ("Fifteen billion messages wait.") plays first, with the stat graphic over it.
  await page.getByRole('button', { name: 'Make my reel' }).click()
  await page.getByText('Your reel is ready').waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  const reel = path.join(library, run, 'clip_00.mp4')
  const bundle = JSON.parse(fs.readFileSync(path.join(library, run, '.edit', 'clip_00', 'edit.json'), 'utf8'))
  assert.equal(bundle.graphics.length, 1)
  assert.ok(bundle.graphics[0].start_ms < 300, `the graphic starts with the hook's first word (${bundle.graphics[0].start_ms} ms)`)
  assert.equal(fs.readdirSync(path.join(library, run, '.graphics', 'reel')).filter((n) => n.endsWith('.mov')).length, 1)
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    for (const [name, seconds] of [['edit-reel-graphic.png', 1.0], ['edit-reel-after-graphic.png', 3.0]]) execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(seconds), '-i', reel, '-frames:v', '1', path.join(process.env.BRIDGECLIP_E2E_SHOTS, name)])
  }
  // The stat card is light paper in the band under the hook text while it plays, and gone after.
  const band = [100, 780, 200, 36]
  const during = boxColor(ffmpeg, reel, 1.0, band), after = boxColor(ffmpeg, reel, 3.0, band)
  assert.ok(during.every((c) => c > 190), `the stat card shows: ${during.map(Math.round)}`)
  assert.ok(Math.abs(after[0] - during[0]) > 30 || Math.abs(after[2] - during[2]) > 30, `the card is gone after: ${after.map(Math.round)}`)
  const ledger = fs.readFileSync(path.join(userDataDir, 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(ledger.some((entry) => entry.kind === 'edit' && entry.label === 'Edit my recording: chat' && Math.abs(entry.usd - 0.004) < 1e-6), JSON.stringify(ledger))
  assert.deepEqual(errors, [])
})
