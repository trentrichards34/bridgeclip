const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync, spawnSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

// Combine clips: three phone-like clips (one filmed sideways with a rotation tag, one at 29.97 fps, one filming a
// bright screen) chosen as one .zip, combined into one reel in the AI's order, checked for order, length, upright
// picture and sound in step with the picture. The plan's AI call is the fake-ai-edit stand-in; the rest is real.

async function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
  if (png) fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))
}

function say(text, start, step = 0.32) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.04).toFixed(3), type: 'word' }))
}

const A = say('First I filmed this one sideways.', 0.7)
const B = say('Then this one is slower beep here.', 0.5)
const C = [...say('My dashboard says $8,188 today.', 0.6), ...say('And here is my screen.', 2.6)]

/** A stored .zip (method 0) of files, with the junk a Mac adds. */
function storedZip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, data] of files) {
    const n = Buffer.from(name), crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8)
    central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, n, data); centrals.push(central, n)
    offset += 30 + n.length + data.length
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** YAVG of each frame, from FFmpeg's signalstats, for a band of rows (crop) of the reel. */
function lumas(ffmpeg, file, crop) {
  const text = spawnSync(ffmpeg, ['-nostdin', '-hide_banner', '-i', file, '-vf', `${crop ? `crop=${crop},` : ''}signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-an', '-f', 'null', '-'],
    { maxBuffer: 64 * 1024 * 1024 }).stderr.toString()
  return [...text.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
}

test('Combine clips: a .zip of three clips, put in the AI’s order, joined upright with sound in step', { timeout: 900000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-combine-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const tone = (words, extra = '') => `aevalsrc='0.25*sin(2*PI*300*t)*(${words.map((w) => `between(t,${w.start},${w.end})`).join('+')})${extra}':s=48000:d=5`
  const clip = (file, video, audio, created, extra = []) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', audio, ...extra,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-metadata', `creation_time=${created}`, file])
  // A: filmed upright (white on the left, gray on the right) but stored sideways with a rotation tag, like a phone.
  const aFlat = path.join(root, 'a-flat.mp4')
  clip(aFlat, 'color=c=0x707070:s=360x640:r=30:d=5,drawbox=x=0:y=0:w=180:h=640:color=0xE0E0E0:t=fill,transpose=1', tone(A), '2026-10-21T13:27:00Z')
  const a = path.join(root, 'IMG_3001.MOV')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-display_rotation', '90', '-i', aFlat, '-c', 'copy', '-metadata', 'creation_time=2026-10-21T13:27:00Z', a])
  // B: 29.97 fps, darker, a white flash and a 1 kHz beep together on "beep".
  const beep = B.find((w) => w.word === 'beep')
  const b = path.join(root, 'IMG_3002.MOV')
  clip(b, `color=c=0x404040:s=360x640:r=30000/1001:d=5,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,${beep.start},${beep.end})'`,
    tone(B, `+0.5*sin(2*PI*1000*t)*between(t,${beep.start},${beep.end})`), '2026-10-21T13:28:00Z')
  // C: filming a bright screen with lines of "text".
  const c = path.join(root, 'IMG_3003.MOV')
  clip(c, `color=c=0xF0F0F0:s=360x640:r=30:d=5${[0, 1, 2, 3, 4].map((k) => `,drawbox=x=60:y=${140 + k * 60}:w=240:h=16:color=0x303030:t=fill`).join('')}`, tone(C), '2026-10-21T13:29:00Z')
  // One .zip, in the wrong order, with a Mac's resource-fork junk.
  const zipFile = path.join(root, 'my clips.zip')
  fs.writeFileSync(zipFile, storedZip([['clips/IMG_3003.MOV', fs.readFileSync(c)], ['__MACOSX/clips/._IMG_3003.MOV', Buffer.from('junk')], ['clips/IMG_3001.MOV', fs.readFileSync(a)], ['clips/IMG_3002.MOV', fs.readFileSync(b)]]))

  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '', customVocabulary: '' }))

  // OpenRouter stand-in: Scribe, once per clip in filming order.
  const scribe = []
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(req.url === '/api/v1/audio/transcriptions' ? 200 : 404, { 'Content-Type': 'application/json' })
      if (req.url !== '/api/v1/audio/transcriptions') { res.end('{}'); return }
      const words = [A, B, C][scribe.length] ?? []
      scribe.push(words)
      res.end(JSON.stringify({ text: words.map((w) => w.word).join(' '), words, usage: { cost: 0.0003, seconds: 4 } }))
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
    window.setSize(1280, 800)
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

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Edit my recording/ }).click()
  await page.getByRole('heading', { name: 'Raw takes in, one finished reel out', level: 1 }).waitFor()
  // Step 1: the mode choice.
  const modes = page.getByRole('radiogroup', { name: 'What did you film?' })
  assert.equal(await modes.getByRole('radio', { name: /^Retakes of one thing/ }).getAttribute('aria-checked'), 'true')
  await modes.getByRole('radio', { name: /^Parts to combine/ }).click()
  assert.equal(await modes.getByRole('radio', { name: /^Parts to combine/ }).getAttribute('aria-checked'), 'true')
  await page.getByRole('heading', { name: '02 · Your clips' }).waitFor()
  const top = async () => { await page.evaluate(() => { document.querySelector('main')?.scrollTo?.(0, 0); window.scrollTo(0, 0) }); await page.getByRole('heading', { name: 'Raw takes in, one finished reel out', level: 1 }).scrollIntoViewIfNeeded(); await page.waitForTimeout(400) }
  await top()
  await shot(app, 'combine-1-mode-choice.png')

  // Choose the .zip: the file dialog answers after a moment; each file's progress shows while it is unpacked and checked.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = () => new Promise((resolve) => setTimeout(() => resolve({ canceled: false, filePaths: [file] }), 1500)) }, zipFile)
  await page.getByRole('button', { name: 'Choose clips or a .zip' }).click()
  // While the dialog is open (as on a slow disk), show what the page shows for a .zip being unpacked, for the screenshot.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('edit:importProgress', [
    { name: 'IMG_3003.MOV', phase: 'checking', percent: 100 }, { name: 'IMG_3001.MOV', phase: 'copying', percent: 46 }, { name: 'IMG_3002.MOV', phase: 'waiting', percent: 0 }]))
  await page.getByTestId('clip-import').getByText('Copying out of the .zip · 46%').waitFor()
  await top()
  await shot(app, 'combine-2-upload-progress.png')
  const list = page.getByRole('list', { name: 'Your clips' })
  await list.getByText('Clip 3 · IMG_3003.MOV').waitFor({ timeout: 60000 })
  // Listed in filming order (from the files' creation time), the Mac junk left out.
  assert.deepEqual(await list.locator(':scope > li').evaluateAll((items) => items.map((li) => li.textContent.split('·')[1].trim().slice(0, 12))), ['IMG_3001.MOV', 'IMG_3002.MOV', 'IMG_3003.MOV'])
  assert.equal(await list.locator(':scope > li').count(), 3)
  assert.equal(await page.getByTestId('clip-import').count(), 0)
  const imports = path.join(library, '.edit-imports')
  assert.equal(fs.readdirSync(imports).length, 1)
  assert.match(await page.getByTestId('edit-cost').innerText(), /^Listening to 0:15 \(3 clips\) with ElevenLabs Scribe v2 costs under 1¢, and planning the edit about \$0\.02/)
  await page.getByRole('radiogroup', { name: 'Clip order' }).getByRole('radio', { name: 'Filming order' }).waitFor()
  await top()
  await shot(app, 'combine-3-step-1-ready.png')

  await page.getByRole('button', { name: 'Combine my clips' }).click()
  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 300000 })
  assert.equal(scribe.length, 3)
  const status = await page.evaluate(() => window.bridgeclip.edit.status())
  assert.equal(status.mode, 'combine')
  assert.deepEqual(status.sources.map((s) => [s.name, s.shot]), [['IMG_3001.MOV', status.sources[0].shot], ['IMG_3002.MOV', status.sources[1].shot], ['IMG_3003.MOV', 'screen']])
  assert.ok(status.sources.every((s) => s.proxy && s.thumb))
  assert.deepEqual(status.plan.combine.aiOrder, [1, 0, 2])

  // The Order strip: filming order to start with; thumbnails, lengths, shot types and first words.
  const strip = page.getByTestId('clip-order')
  const tiles = strip.getByRole('list', { name: 'Clip order' }).locator(':scope > li')
  const order = async () => tiles.evaluateAll((items) => items.map((li) => li.getAttribute('aria-label').match(/^Clip (\d)/)[1]).join(''))
  assert.equal(await order(), '123')
  await tiles.nth(2).getByText('Screen').waitFor()
  await tiles.nth(0).getByText('“First I filmed this one sideways.…”').waitFor()
  assert.ok(await tiles.nth(0).locator('img').evaluate((img) => img.complete && img.naturalWidth > 0))
  // Keyboard-friendly moves, Use filming order, then the AI's order (it came with the plan).
  await strip.getByRole('button', { name: 'Move clip 3 earlier' }).click()
  assert.equal(await order(), '132')
  await strip.getByRole('button', { name: 'Use filming order' }).click()
  assert.equal(await order(), '123')
  await strip.getByRole('button', { name: 'Let AI order it' }).click()
  assert.equal(await order(), '213')
  await strip.getByText('The AI’s order: The story first, then the screen as proof.').waitFor()
  // Remove a clip and put it back.
  await strip.getByRole('button', { name: 'Remove clip 1' }).click()
  assert.equal(await order(), '23')
  await strip.getByRole('button', { name: 'Put clip 1 back' }).click()
  assert.equal(await order(), '123')
  await strip.getByRole('button', { name: 'Let AI order it' }).click()
  assert.equal(await order(), '213')
  // The hook from the screen clip opens the reel; the proof graphic on "$8,188" is a stat graphic the app added.
  await page.getByTestId('edit-hook').getByText('“And here is my screen.”').waitFor()
  const log = page.getByTestId('edit-log')
  await log.getByRole('button', { name: /^What changed/ }).click()
  await log.getByText('Put 3 clips in the AI’s order: The story first, then the screen as proof.').waitFor()
  await log.getByText(/^Trimmed \d(\.\d)? s of dead air from 3 clip starts$/).waitFor()
  await log.getByText('Evened out brightness and loudness across 3 clips').waitFor()
  await log.getByText('Added a $8,188 stat on what you said').waitFor()
  await log.getByText(/^Opened with “And here is my screen\.” \(moved from clip 3, 0:02\)$/).waitFor()
  await strip.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(600)
  await shot(app, 'combine-4-order-strip.png')
  await log.getByRole('button', { name: /^What changed/ }).click()
  await page.getByRole('heading', { name: 'Review your edit' }).evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(600)
  await shot(app, 'combine-5-review.png')
  await log.getByRole('button', { name: /^What changed/ }).click()
  // The proof graphic is left off for the picture checks below (it's drawn over the middle of the screen).
  await log.getByRole('button', { name: /^Restore: Added a \$8,188 stat/ }).click()

  await page.getByRole('button', { name: 'Make my reel' }).click()
  await page.getByText('Your reel is ready').waitFor({ timeout: 600000 })
  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  const reel = path.join(library, run, 'clip_00.mp4')
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,duration', '-show_entries', 'format=duration', '-of', 'json', reel]).toString())
  const video = probe.streams.find((s) => s.codec_type === 'video'), audio = probe.streams.find((s) => s.codec_type === 'audio')
  // 30 fps (the editor's bake can report the rate as a near fraction, e.g. 240000/7999).
  const [num, den] = video.r_frame_rate.split('/').map(Number)
  assert.deepEqual([video.width, video.height], [1080, 1920])
  assert.ok(Math.abs(num / den - 30) < 0.05, video.r_frame_rate)
  assert.ok(Math.abs(Number(video.duration) - Number(audio.duration)) < 0.1, `${video.duration} vs ${audio.duration}`)
  // The reel is a clip editor project (the joined, upright clips are its source), baked by the editor.
  const project = JSON.parse(fs.readFileSync(path.join(library, run, 'editor-project.json'), 'utf8'))
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.equal(job.editor_project, true)
  assert.equal(job.clips[0].editor_candidate, 'edit-reel')
  const candidate = project.candidates[0]
  assert.equal(candidate.status, 'baked')
  // The plan's graphic on the screen clip's dashboard line: a card (no stage over a filmed screen); the proof stat was taken off.
  assert.deepEqual(candidate.graphics.map((g) => [g.template, g.origin, g.size, g.fields.text]), [['statement', 'auto', 'card', 'My dashboard says $8,188 today.']])
  assert.equal(candidate.stage_scenes, undefined)
  const words = JSON.parse(fs.readFileSync(path.join(library, run, 'transcript.json'), 'utf8')).segments.flatMap((sg) => sg.words.map((w) => [w.word, w.start_time_ms, w.end_time_ms]))
  const bundle = { duration: project.duration_ms / 1000, words }
  const seconds = Number(probe.format.duration)
  assert.ok(Math.abs(seconds - bundle.duration) < 0.15, `${seconds} vs ${bundle.duration}`)
  // The order: the hook (C's last line), then B, A, then the rest of C.
  const text = bundle.words.map((w) => w[0]).join(' ')
  assert.equal(text, 'And here is my screen. Then this one is slower beep here. First I filmed this one sideways. My dashboard says $8,188 today.')
  // About the words said, not the clips' whole 15 seconds: the dead air at each clip's start and end is gone.
  assert.ok(seconds > 7 && seconds < 10.5, `${seconds}s`)
  const at = (word) => bundle.words.find((w) => w[0] === word)
  // Upright: in clip A the white half is on the left (mid band of rows, clear of the hook text and captions).
  const frameAt = (time, name) => { const file = path.join(root, name); execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(time), '-i', reel, '-frames:v', '1', file]); return file }
  const sideways = frameAt((at('filmed')[1] + 120) / 1000, 'a.png')
  const left = lumas(ffmpeg, sideways, '400:300:60:800')[0], right = lumas(ffmpeg, sideways, '400:300:620:800')[0]
  assert.ok(left > right + 60, `left ${left} right ${right}`)
  // Sound and picture in step: the flash and the beep start on the same frame.
  const bStart = at('Then')[1] / 1000, bEnd = at('here.')[2] / 1000
  const frames = lumas(ffmpeg, reel, '1080:300:0:800')
  const flash = frames.findIndex((v, i) => i / 30 >= bStart && i / 30 <= bEnd && v > 200)
  assert.ok(flash > 0, 'flash found')
  const raw = execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', reel, '-vn', '-ac', '1', '-ar', '48000', '-af', 'highpass=f=700,highpass=f=700,highpass=f=700', '-f', 'f32le', '-'], { maxBuffer: 256 * 1024 * 1024 })
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4))
  let beepAt = -1
  for (let k = Math.round(bStart * 1000); k < bEnd * 1000; k++) {
    let sum = 0
    for (let j = k * 48; j < k * 48 + 48; j++) sum += samples[j] ** 2
    if (Math.sqrt(sum / 48) > 0.05) { beepAt = k / 1000; break }
  }
  assert.ok(beepAt > 0, 'beep found')
  assert.ok(Math.abs(flash / 30 - beepAt) <= 1.5 / 30, `flash ${flash / 30}s, beep ${beepAt}s`)
  // The done screen opens it in the clip editor, with the graphic in the Graphics row.
  await page.getByTestId('edit-open-editor').click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.getByRole('button', { name: /^Statement at / }).first().waitFor()
  await shot(app, 'combine-6-editor.png')
  // The unpacked clips and the proxies are gone once the reel is made.
  assert.equal(fs.existsSync(imports) ? fs.readdirSync(imports).length : 0, 0)
  assert.ok(!fs.existsSync(path.join(library, run, '.work')))
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    for (const [k, word] of ['here', 'slower', 'sideways.', 'dashboard'].entries()) {
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(at(word)[1] / 1000 + 0.1), '-i', reel, '-frames:v', '1', '-vf', 'scale=360:-2', path.join(process.env.BRIDGECLIP_E2E_SHOTS, `combine-e2e-reel-${k}.png`)])
    }
  }
  assert.deepEqual(errors, [])
})
