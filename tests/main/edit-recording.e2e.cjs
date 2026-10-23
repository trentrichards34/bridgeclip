const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

// Chromium's stand-in camera and microphone, allowed without a prompt.
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

/** With BRIDGECLIP_E2E_SHOTS set, a picture of the window (taken in main: the hidden window may not paint for Playwright). */
async function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
  if (png) fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))
}

/** Words of a line, evenly spaced from `start` seconds (as Scribe returns them, in seconds). */
function say(text, start, step = 0.32) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.04).toFixed(3), type: 'word' }))
}

// The raw recording: the member rejects their first take out loud, says it again, an "um", then a strong line.
const TAKE_1 = [...say('Most coaches lose clients.', 0.5), ...say('No, again.', 2.1), ...say('Most coaches lose so many clients.', 3.0),
  ...say('Um.', 5.3), ...say('Fifteen billion messages wait.', 5.8)]
// Their second take, filmed here: the call to action.
const TAKE_2 = say('Follow me for more.', 0.4)

function multipartFields(body) {
  const text = body.toString('latin1')
  const fields = {}
  for (const match of text.matchAll(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?\r\n(?:Content-Type: ([^\r\n]+)\r\n)?\r\n/g)) {
    const start = match.index + match[0].length
    const end = text.indexOf('\r\n--', start)
    const value = match[2] ? { filename: match[2], type: match[3], bytes: end - start } : text.slice(start, end)
    ;(fields[match[1]] ??= []).push(value)
  }
  return fields
}

test('Edit my recording: two takes (one chosen, one filmed from an idea), Scribe words, the plan reviewed and changed, one reel in the Library', { timeout: 600000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-edit-recording-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  // A landscape recording: a moving test picture, and a tone wherever a word is said.
  const recording = path.join(root, 'my raw take.mp4')
  const expr = TAKE_1.map((w) => `between(t,${w.start},${w.end})`).join('+')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=8', '-f', 'lavfi', '-i', `aevalsrc='0.25*sin(2*PI*300*t)*(${expr})':s=48000:d=8`,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', recording])
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '', customVocabulary: 'Paid Creators' }))

  // A local stand-in for OpenRouter: Scribe v2 transcriptions and the film-ideas call.
  const scribe = [], chats = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
      if (req.url === '/api/v1/audio/transcriptions') {
        const fields = multipartFields(body)
        scribe.push({ contentType: req.headers['content-type'], auth: req.headers.authorization, fields })
        const words = scribe.length === 1 ? TAKE_1 : TAKE_2
        reply(200, { text: words.map((w) => w.word).join(' '), language: 'en', words: [...words, { word: ' ', start: 0, end: 0.1, type: 'spacing' }], usage: { cost: 0.0004, seconds: 8 } })
      } else if (req.url === '/api/v1/chat/completions') {
        chats.push(JSON.parse(body.toString()))
        reply(200, { choices: [{ message: { content: JSON.stringify({ ideas: Array.from({ length: 5 }, (_, i) => ({
          title: ['Silent mistake', 'React to bad advice', 'The follow-up', 'Price with care', 'Keep them longer'][i],
          hook: i === 0 ? 'Most coaches lose clients to one silent mistake' : `Another hook, ${['two', 'three', 'four', 'five'][i - 1]}`, points: ['Name the mistake', 'Show what it costs', 'Give one fix'],
          format: i === 1 ? 'pause_react' : 'camera', why: 'Fits coaches who sell programs.' })) }) } }], usage: { cost: 0.0012 } })
      } else reply(404, { error: { code: 404, message: 'not here' } })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/v1`

  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, args: FAKE_MEDIA, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: base, BRIDGECLIP_E2E_OPENROUTER_URL: `${base}/chat/completions` } })
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
    // Screenshots: shown, so the style board's preview paints.
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

  // The tab sits between Create and Remix.
  const nav = await page.getByRole('navigation', { name: 'Main' }).getByRole('button').allInnerTexts()
  const at = nav.findIndex((label) => label.startsWith('Edit my recording'))
  assert.ok(at > 0 && nav[at - 1].startsWith('Create') && nav[at + 1].startsWith('Remix'), nav.join(' | '))
  await page.keyboard.press('Control+e')
  await page.getByRole('heading', { name: 'Raw takes in, one finished reel out', level: 1 }).waitFor()
  const start = page.getByRole('button', { name: 'Edit my recording', exact: true }).last()
  assert.equal(await start.isDisabled(), true)
  await page.getByRole('button', { name: 'Choose recordings' }).click()
  const list = page.getByRole('list', { name: 'Your recordings' })
  await list.getByText('my raw take.mp4').waitFor()
  await list.getByText('0:08').waitFor()
  assert.match(await page.getByTestId('edit-cost').innerText(), /^Listening to 0:08 with ElevenLabs Scribe v2 costs under 1¢, and planning the edit about \$0\.02, through your OpenRouter account\./)

  // What should I film? Five ideas from a topic; the first one is filmed here with its hook and points as a teleprompter.
  await page.getByRole('button', { name: /Not sure what to film\?/ }).click()
  await page.getByLabel('Topic').fill('client retention')
  await page.getByRole('button', { name: 'Give me 5 ideas' }).click()
  const ideas = page.getByRole('list', { name: 'Video ideas' })
  await ideas.getByText('“Most coaches lose clients to one silent mistake”').waitFor()
  assert.equal(await ideas.locator(':scope > li').count(), 5)
  assert.equal(chats.length, 1)
  assert.equal(JSON.parse(chats[0].messages[1].content).topic, 'client retention')
  assert.match(chats[0].messages[0].content, /Never invent facts, numbers, results, clients or testimonials/)
  await ideas.locator(':scope > li').nth(1).getByRole('button', { name: 'Pause & react is in Remix' }).waitFor()
  await ideas.locator(':scope > li').first().getByRole('button', { name: 'Film this' }).click()
  const recorder = page.getByRole('dialog', { name: 'Film yourself' })
  await recorder.getByLabel('Your teleprompter').getByText('Most coaches lose clients to one silent mistake').waitFor()
  await recorder.getByText('• Give one fix').waitFor()
  await recorder.getByRole('button', { name: 'Start recording' }).click()
  await recorder.getByText(/^REC/).waitFor({ timeout: 10000 })
  await page.waitForTimeout(3500)
  await recorder.getByRole('button', { name: 'Stop' }).click()
  await recorder.getByText(/^Take 1 saved/).waitFor({ timeout: 20000 })
  await recorder.getByRole('button', { name: 'Done' }).click()
  await list.getByText(/^Take 2 · recording-.*\.webm$/).waitFor()
  assert.equal(fs.readdirSync(path.join(library, 'My recordings')).length, 1)
  await page.getByText('Planned hook: “Most coaches lose clients to one silent mistake”. The edit looks for it first.').waitFor()

  await start.click()
  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 180000 })
  // Scribe v2 through OpenRouter, once per take: multipart with word timestamps and the member's words as key terms.
  assert.equal(scribe.length, 2)
  for (const call of scribe) {
    assert.match(call.contentType, /^multipart\/form-data; boundary=/)
    assert.equal(call.auth, 'Bearer sk-or-test')
    assert.deepEqual(call.fields.model, ['elevenlabs/scribe-v2'])
    assert.deepEqual(call.fields.response_format, ['verbose_json'])
    assert.deepEqual(call.fields['timestamp_granularities[]'], ['word'])
    assert.deepEqual(call.fields['keyterms[]'], ['Paid Creators'])
    assert.ok(call.fields.file[0].bytes > 100 && /^audio\//.test(call.fields.file[0].type), JSON.stringify(call.fields.file))
  }
  const status = await page.evaluate(() => window.bridgeclip.edit.status())
  assert.equal(status.transcriber, 'scribe')
  const words = status.plan.words
  const index = (text, nth = 0) => words.map((w, i) => [w.text, i]).filter(([w]) => w === text)[nth][1]
  // The rejected take and the cue are cut, the "um" too; the hook is the number line; the call to action is take 2.
  const cutText = words.filter((w) => w.cut).map((w) => w.text).join(' ')
  assert.equal(cutText, 'Most coaches lose clients. No, again. Um.')
  await page.getByTestId('edit-hook').getByText('“Fifteen billion messages wait.”').waitFor()
  assert.equal(await page.getByLabel('Hook text on screen').inputValue(), '15 billion messages wait')
  // "What changed": what the plan did, each line with a Restore; "Undo restore" takes it back.
  // It is folded to one line until opened.
  const log = page.getByTestId('edit-log')
  const logToggle = log.getByRole('button', { name: /^What changed\s*· \d+ things the app did/ })
  assert.equal(await logToggle.getAttribute('aria-expanded'), 'false')
  await logToggle.click()
  await log.getByText(/^Cut \d+ retakes? \(/).waitFor()
  await log.getByText(/^Opened with “Fifteen billion messages wait\.” \(moved from take \d, \d:\d\d\)$/).waitFor()
  await log.getByRole('button', { name: /^Restore: Cut 1 filler word/ }).click()
  assert.equal(await page.locator(`[data-word="${index('Um.')}"]`).getAttribute('aria-pressed'), 'true')
  await shot(app, 'edit-log-review.png')
  await log.getByRole('button', { name: 'Undo restore' }).click()
  assert.equal(await page.locator(`[data-word="${index('Um.')}"]`).getAttribute('aria-pressed'), 'false')
  assert.equal(await page.locator(`[data-word="${index('Um.')}"]`).getAttribute('aria-pressed'), 'false')
  assert.equal(await page.locator(`[data-word="${index('Fifteen')}"]`).getAttribute('aria-pressed'), 'true')
  await page.getByText('Take 2 · ').first().waitFor()
  // Keep the "um" after all, then cut it again; cut "so" from the kept take.
  await page.locator(`[data-word="${index('Um.')}"]`).click()
  assert.equal(await page.locator(`[data-word="${index('Um.')}"]`).getAttribute('aria-pressed'), 'true')
  await page.locator(`[data-word="${index('Um.')}"]`).click()
  await page.locator(`[data-word="${index('so')}"]`).click()
  // The other hook the AI found; then back to the number, with the member's own hook text.
  await page.getByRole('button', { name: 'Use a different hook' }).click()
  await page.getByRole('radio', { name: /^Most coaches lose so many clients/ }).click()
  assert.equal(await page.getByLabel('Hook text on screen').inputValue(), 'Most coaches lose so many clients')
  await page.getByRole('radio', { name: /^15 billion messages wait/ }).click()
  await page.getByLabel('Hook text on screen').fill('15 billion messages are waiting')
  // Pop-ups and sounds: the pop-up stays, the pop sound goes.
  assert.equal(await page.getByRole('switch', { name: 'Pop-up 1' }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByLabel('Pop-up 1 text').inputValue(), '15 billion')
  await page.getByRole('switch', { name: 'Pop on “billion”' }).click()
  assert.equal(await page.getByRole('switch', { name: 'Soft whoosh as the hook text appears' }).getAttribute('aria-checked'), 'true')
  await page.getByRole('switch', { name: 'End on your call to action' }).waitFor()
  // The automatic direction: the plan's graphic is on the strip, and Motion graphics and Stage layouts start on.
  assert.equal(await page.locator('[data-skill="motion_graphics"] [role="switch"]').getAttribute('aria-checked'), 'true')
  assert.equal(await page.locator('[data-skill="stage_layouts"] [role="switch"]').getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: /^Statement on “Most”/ }).waitFor()
  // The edit style: Fast explainer switches its card on and its extras; the card's words can be changed.
  assert.equal(await page.getByRole('switch', { name: 'Half-screen graphic 1' }).getAttribute('aria-checked'), 'false')
  await page.getByRole('radiogroup', { name: 'Edit style' }).getByRole('radio', { name: /^Fast explainer/ }).click()
  assert.equal(await page.getByRole('switch', { name: 'Half-screen graphic 1' }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByRole('group', { name: 'Extras' }).getByRole('button', { name: 'Progress bar' }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByLabel('Half-screen graphic 1 the number').inputValue(), '15 billion')
  await page.getByLabel('Half-screen graphic 1 what it is').fill('messages are waiting')
  // The pop-up says "15 billion" while the half-screen graphic shows it: a warning turns the pop-up off in one click.
  const duplicate = page.getByTestId('edit-duplicate')
  await duplicate.getByText(/^“15 billion” shows twice: as a pop-up and in half-screen graphic 1 on “messages”/).waitFor()
  await duplicate.getByRole('button', { name: 'Turn off the pop-up' }).click()
  assert.equal(await page.getByRole('switch', { name: 'Pop-up 1' }).getAttribute('aria-checked'), 'false')
  assert.equal(await duplicate.count(), 0)
  // The extras show the reel's first kept frame (a still of the take, not a black box).
  await page.getByTestId('edit-extras').locator('video').evaluate((video) => new Promise((resolve, reject) => {
    const ready = () => video.readyState >= 2 && !video.seeking && video.currentTime > 0
    if (ready()) return resolve()
    const timer = setTimeout(() => reject(new Error(`still not ready: ${video.readyState} ${video.currentTime} ${video.error?.message}`)), 15000)
    video.addEventListener('seeked', () => { clearTimeout(timer); resolve() }, { once: true })
  }))
  // My images: a logo dropped on the page (its bytes are checked in main), pinned to "Most".
  const logo = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xF028C8:s=240x240:d=0.1', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'])
  await page.getByTestId('edit-images-drop').evaluate((zone, bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'my logo.png', { type: 'image/png' }))
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  }, [...logo])
  await page.getByRole('list', { name: 'My images' }).getByText('my logo.png').waitFor()
  await page.getByRole('button', { name: 'Pin to a word' }).click()
  await page.locator(`[data-word="${index('Fifteen')}"]`).click()
  await page.getByTestId('edit-images-drop').getByText('on “Fifteen”').waitFor()
  assert.equal(await page.locator(`[data-word="${index('Fifteen')}"]`).getAttribute('aria-pressed'), 'true', 'pinning doesn’t cut the word')
  await page.getByRole('switch', { name: 'Raw-to-edited opening' }).click()
  await page.getByRole('button', { name: /^Look/ }).click()
  // The style board: its preview shows the reel's own hook text, and a caption style changes the look summary.
  const board = page.getByTestId('style-board')
  await board.getByRole('radiogroup', { name: 'Caption style' }).getByRole('radio', { name: 'Hype' }).click()
  await page.getByTestId('edit-look-summary').getByText(/Captions: hype/).waitFor()
  await board.getByTestId('style-preview').getByText('15 billion messages are waiting').waitFor()
  await board.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(800)
  await board.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await shot(app, 'style-board-edit.png')
  await page.getByRole('heading', { name: 'Review your edit' }).scrollIntoViewIfNeeded()
  await shot(app, 'edit-review.png')

  await page.getByRole('button', { name: 'Make my reel' }).click()
  await page.getByText('Your reel is ready').waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  assert.ok(run)
  // The reel is a clip editor project, already baked by the editor (clip 0 replaced in place).
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.equal(job.editor_project, true)
  assert.equal(job.clips.length, 1)
  assert.equal(job.clips[0].headline, '15 billion messages are waiting')
  assert.equal(job.clips[0].editor_candidate, 'edit-reel')
  assert.equal(job.source_video_title, 'Edited · 15 billion messages are waiting')
  assert.equal(job.clips[0].editable, undefined)
  const project = JSON.parse(fs.readFileSync(path.join(library, run, 'editor-project.json'), 'utf8'))
  const candidate = project.candidates[0]
  assert.equal(candidate.status, 'baked')
  assert.equal(candidate.hook.text, '15 billion messages are waiting')
  // The plan's statement and the pinned logo (a Logo pop on "Fifteen"); the Fast explainer's card came while the logo showed,
  // so it gave way (as pop-ups and cards always have). The test's camera shows no face (like a filmed screen), so no stage
  // goes over it and the statement is a card.
  const kinds = candidate.graphics.map((g) => g.template).sort()
  assert.deepEqual(kinds, ['logo', 'statement'], JSON.stringify(candidate.graphics))
  await page.getByText(/1 pop-up or pinned image left out/).waitFor()
  const statement = candidate.graphics.find((g) => g.template === 'statement')
  assert.deepEqual([statement.origin, statement.size, statement.fields.text], ['auto', 'card', 'Most coaches lose clients.'])
  assert.ok(statement.fields.word_ms, 'its words come in as they are said')
  assert.equal(candidate.stage_scenes, undefined)
  // The hook floats and hides after a few seconds (a directed reel); the Fast explainer's extras are the clip's, for the bake.
  assert.equal(candidate.hook.look.hideAfterS, 5)
  assert.notEqual(candidate.hook.look.look, 'white')
  assert.deepEqual(candidate.look_extras.ids, ['keyword_pill', 'progress_bar'])
  assert.ok(fs.existsSync(path.join(library, run, 'editor-source.mp4')))
  const reel = path.join(library, run, 'clip_00.mp4')
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-show_entries', 'format=duration', '-of', 'json', reel]).toString())
  const video = probe.streams.find((s) => s.codec_type === 'video')
  assert.deepEqual([video.width, video.height], [1080, 1920])
  assert.ok(probe.streams.some((s) => s.codec_type === 'audio'))
  const seconds = Number(probe.format.duration)
  // The raw opening (3.5 s), then the hook (1.3 s), "Most coaches lose many clients." and the call to action (1.3 s), with short pads.
  assert.ok(seconds > 7 && seconds < 10.5, `${seconds}s`)
  assert.ok(Math.abs(seconds * 1000 - project.duration_ms) < 200, `${seconds}s vs ${project.duration_ms}ms`)
  // The progress bar (an extra the bake draws) fills along the very top: brighter there near the end than at the start.
  const stageAt = (statement.at_ms + 600) / 1000
  const topRow = (at) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', reel, '-frames:v', '1', '-vf', 'crop=1080:8:0:0,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])[0]
  assert.notEqual(topRow(seconds - 0.4), topRow(0.3), 'the progress bar fills the top row')
  assert.ok(fs.existsSync(path.join(library, run, 'images')))
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    for (const [k, at] of [0.4, 3.0, 4.0, stageAt, seconds - 0.6].entries()) execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', reel, '-frames:v', '1', path.join(process.env.BRIDGECLIP_E2E_SHOTS, `edit-reel-${k}.png`)])
  }
  // The AI steps went to the spending ledger as "Edit my recording".
  const ledger = fs.readFileSync(path.join(userDataDir, 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(ledger.some((entry) => entry.kind === 'edit' && entry.label === 'Edit my recording: transcript and plan' && Math.abs(entry.usd - (0.0008 + 0.004)) < 1e-6), JSON.stringify(ledger))
  assert.ok(ledger.some((entry) => entry.kind === 'edit' && entry.label === 'Edit my recording: film ideas' && Math.abs(entry.usd - 0.0012) < 1e-6))

  // The done screen opens the reel in the clip editor: its graphics are there to change (and Bake makes it again).
  await page.getByTestId('edit-open-editor').click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.getByRole('button', { name: /^Statement at / }).first().waitFor()
  await page.getByRole('button', { name: /^Statement at / }).first().click()
  const statementWords = page.locator('textarea[aria-label^="Statement "]').first()
  assert.equal(await statementWords.inputValue(), 'Most coaches lose clients.')
  await statementWords.fill('Most coaches lose their clients.')
  await page.getByText('All changes saved', { exact: true }).waitFor()
  const saved = JSON.parse(fs.readFileSync(path.join(library, run, 'editor-project.json'), 'utf8'))
  assert.equal(saved.candidates[0].graphics.find((g) => g.template === 'statement').fields.text, 'Most coaches lose their clients.')
  await shot(app, 'edit-reel-editor.png')
  await page.getByRole('button', { name: 'Back to Edit my recording' }).click()
  await page.getByText('Your reel is ready').waitFor()
  assert.deepEqual(errors, [])
})
