const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

/** With BRIDGECLIP_E2E_SHOTS set, a picture of the window (taken in main: the hidden window may not paint for Playwright). */
async function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
  if (png) fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))
}

// A member makes "Moment + my take" videos from a long video file: one range typed, one read from a screenshot of
// the player, the real engine finds the moment in each (only the paid AI steps are stood in for: transcription and
// the model, through a test-only Python wrapper, and the screenshot read through a local stand-in for OpenRouter),
// they nudge a moment, upload a phone video for each take, the hook text is written from what they said, and both
// videos are made, land in the Library and can have their hook text edited there.

test('Moment + my take: two ranges (typed and from a screenshot), two uploaded takes, two videos in the Library with their hook text editable', { timeout: 480000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-moment-take-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  // The long video: a minute of moving test pattern with a noise "voice".
  const podcast = path.join(root, 'podcast-episode.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=60', '-f', 'lavfi', '-i', 'anoisesrc=c=pink:seed=3:a=0.3:r=48000:d=60',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', podcast])
  // Two phone videos of the member talking (upright).
  const takes = ['0x406080', '0x605040'].map((color, i) => {
    const file = path.join(root, `my-take-${i + 1}.mp4`)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:r=30:d=4`, '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 100}:d=4`,
      '-vf', 'drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
    return file
  })
  const screenshot = path.join(root, 'player.png')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1', '-frames:v', '1', screenshot])
  // The engine's Python, with the stand-ins for its paid calls first on its path.
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))
  // A local stand-in for OpenRouter: reading the screenshot's time (the app's own small call).
  const reads = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const request = JSON.parse(body)
      reads.push(request)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ found: true, position: '0:40', length: '', app: 'YouTube' }) } }], usage: { cost: 0.0004 } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const openrouter = `http://127.0.0.1:${server.address().port}/api/v1/chat/completions`

  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_URL: openrouter } })
  t.after(async () => {
    server.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1000))
  // A (fake) OpenRouter key so Remix starts. (Linux without a desktop keyring only offers plain-text storage, which the app
  // refuses for keys: this key is fake, so let it through there.)
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
  // The file dialogs, in order: the long video, the screenshot, then each phone video.
  await app.evaluate(({ dialog }, files) => {
    const queue = [...files]
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [queue.shift()] })
  }, [podcast, screenshot, ...takes])

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  // You on camera: Pause & react first, then the short-clip templates, then Moment + my take, each with a plain one-line description.
  await page.getByRole('radio', { name: /^You on camera/ }).click()
  const formats = page.getByRole('radiogroup', { name: 'Remix format' }).getByRole('radio')
  const labels = await formats.allInnerTexts()
  const at = labels.findIndex((text) => text.startsWith('Moment + my take'))
  assert.ok(at === 3 && labels[0].startsWith('Pause & react') && labels[1].startsWith('Their clip, then me') && labels[2].startsWith('React, then my thoughts'), labels.join(' | '))
  await page.getByRole('radio', { name: /Moment \+ my take/ }).click()
  await page.getByRole('heading', { name: '01 · The long video and your times' }).waitFor()
  assert.equal(await page.getByRole('radiogroup', { name: 'Presenter' }).count(), 0)
  const find = page.getByRole('button', { name: 'Find the moments' })
  assert.equal(await find.isDisabled(), true)
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByText('podcast-episode.mp4').waitFor()
  await page.getByText('This video is 1:00 long.').waitFor()
  await page.getByPlaceholder('e.g. @theircreator').fill('@podcaster')

  // Range 1 typed: first past the end (said plainly), then fixed.
  await page.getByLabel('Range 1 start').fill('1:10')
  await page.getByLabel('Range 1 end').fill('1:20')
  await page.getByText('It starts after the video ends (1:00).').first().waitFor()
  // (Said by the range, and again next to the button, with the way back to it.)
  assert.match(await page.getByTestId('remix-blocker').innerText(), /It starts after the video ends \(1:00\)\.\s*Show me/)
  await page.getByLabel('Range 1 start').fill('0:05')
  await page.getByLabel('Range 1 end').fill('0:25')
  // Range 2 from a screenshot of the player: the time read, a range around it (inside the video), the charge shown.
  // From the keyboard on the paste area, with no empty row: a new row is added and the file dialog opens.
  await page.getByRole('button', { name: 'Paste or drop a screenshot of the player' }).focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('range-2-read').waitFor()
  assert.match(await page.getByTestId('range-2-read').innerText(), /^Read 0:40 from your screenshot \(YouTube\), so this range is 0:00–1:00\. Check it matches, and fix it if not\. Reading it cost \$0\.0004\.$/)
  assert.equal(reads.length, 1)
  assert.match(reads[0].messages[1].content[1].image_url.url, /^data:image\/png;base64,/)
  await page.getByLabel('Range 2 start').fill('0:30')
  await page.getByLabel('Range 2 end').fill('0:55')
  // The moment stays small on screen while you talk, by default (in the folded look section).
  assert.match(await page.getByTestId('look-summary').innerText(), /^Moment small on screen while you talk · As filmed · /)
  await page.getByRole('button', { name: 'Customize for this video' }).click()
  // No green screen behind you here: you fill the frame.
  await page.getByRole('radiogroup', { name: 'Your background' }).getByRole('radio', { name: /As filmed/ }).waitFor()
  assert.equal(await page.getByRole('radiogroup', { name: 'Your background' }).getByRole('radio', { name: /Green screen/ }).count(), 0)
  assert.equal(await page.getByRole('switch', { name: 'Keep the moment small on screen while I talk' }).getAttribute('aria-checked'), 'true')
  // The cost line: the ranges, a planning call each, a writing call per video, from the existing prices.
  await page.getByText(/^Next the AI listens to your ranges \(0\.8 min in all\).*About \$0\.\d\d–\$0\.\d\d in all\./).waitFor()
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await page.getByRole('heading', { name: '01 · The long video and your times' }).scrollIntoViewIfNeeded(); await shot(app, 'moment-take-form.png') }
  await find.click()

  // The moments: one per range, found inside it.
  await page.getByText('Your moments · 2').waitFor({ timeout: 120000 })
  const first = page.getByRole('region', { name: 'Moment 1' })
  const second = page.getByRole('region', { name: 'Moment 2' })
  await first.getByText('From your range 0:05–0:25').waitFor()
  await second.getByText('From your range 0:30–0:55').waitFor()
  let status = await page.evaluate(() => window.bridgeclip.remix.status())
  assert.deepEqual(status.drafts.map((draft) => draft.format), ['moment_take', 'moment_take'])
  assert.ok(status.drafts[0].startMs >= 5000 && status.drafts[0].endMs <= 25000 && status.drafts[1].startMs >= 30000, JSON.stringify(status.drafts.map((d) => [d.startMs, d.endMs])))
  // Nudge the first moment's start a second later.
  const before = status.drafts[0].startMs
  await first.getByRole('button', { name: 'Start later by 1s' }).click()
  await page.waitForFunction((ms) => window.bridgeclip.remix.status().then((s) => s.drafts[0].startMs === ms), before + 1000)
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await first.scrollIntoViewIfNeeded(); await shot(app, 'moment-take-review.png') }
  const make = page.getByRole('button', { name: 'Make 2 videos' })
  assert.equal(await make.isDisabled(), true)

  // A phone video for each take: the hook text is written from what they said, straight away.
  await first.getByRole('button', { name: 'Upload a phone video' }).click()
  const hook1 = page.getByLabel('Hook text, moment 1')
  await hook1.waitFor({ timeout: 90000 })
  assert.equal(await hook1.inputValue(), 'He says 15 billion scam ads run every day')
  await first.getByText('You said: “Honestly that number scared me. Here is what I do about it.”').waitFor()
  await second.getByRole('button', { name: 'Upload a phone video' }).click()
  const hook2 = page.getByLabel('Hook text, moment 2')
  await hook2.waitFor({ timeout: 90000 })
  // The first take kept its hook text while the second was written; the member edits the second.
  assert.equal(await hook1.inputValue(), 'He says 15 billion scam ads run every day')
  await hook2.fill('Attention is the new oil, he says')

  await make.click()
  await page.getByText(/^2 remixes ready/).waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => name.startsWith('remix-'))
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.deepEqual(job.clips.map((clip) => clip.headline), ['He says 15 billion scam ads run every day', 'Attention is the new oil, he says'])
  assert.ok(job.clips.every((clip) => clip.editable && clip.ai_generated === false && clip.description === 'Original: @podcaster'))
  const manifest = JSON.parse(fs.readFileSync(path.join(library, run, 'clip_00.source.json'), 'utf8'))
  assert.equal(manifest.format, 'moment_take')
  assert.equal(manifest.presenter.moment_take.moment_in_box, true)
  // The nudged start, moved onto a whole word (at most a word's length either way).
  assert.ok(Math.abs(manifest.source.excerpt.start_seconds * 1000 - (before + 1000)) < 400, `${manifest.source.excerpt.start_seconds} vs ${before + 1000}`)
  for (const [i, clip] of job.clips.entries()) {
    const file = path.join(library, run, `clip_0${i}.mp4`)
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
    const moment = manifest.presenter.moment_take.moment_seconds
    assert.ok(seconds > 4 + 2 && seconds < 4 + 12, `the moment, then the 4 s take (${seconds}s, clip ${clip.clip_index})`)
    assert.ok(moment > 2)
    if (process.env.BRIDGECLIP_E2E_SHOTS) {
      for (const at of [1, seconds - 1.5]) execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', path.join(process.env.BRIDGECLIP_E2E_SHOTS, `moment-take-video${i + 1}-${at.toFixed(1)}s.png`)])
    }
  }

  // In the Library: "Edit hook text & captions" is there for both.
  await page.getByRole('button', { name: /^Library/ }).first().click()
  await page.getByRole('button', { name: /^Open Remix · podcast-episode/ }).first().click()
  for (const headline of ['He says 15 billion scam ads', 'Attention is the new oil']) {
    await page.getByRole('button', { name: new RegExp(`^Actions for “${headline}`) }).first().click()
    await page.getByRole('menuitem', { name: 'Edit hook text & captions', exact: true }).waitFor()
    await page.keyboard.press('Escape')
  }
  assert.deepEqual(errors, [])
})
