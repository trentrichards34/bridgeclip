const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

// B-roll video: a library of four clips (each a different color, described as the vision model would), a voiceover
// file chosen in the file dialog, the whole library. Word timings come from a local stand-in for Scribe; the
// engine's one planning call from tests/main/fake-ai-broll (no shot picks, one title card on words said). The slots,
// the matching, the cutting, the voiceover, captions and the clip editor's bake are real. Then one shot is swapped
// and the result opens in the clip editor.

const COLORS = { coffee: [0xd0, 0x60, 0x20], laptop: [0x20, 0x60, 0xd0], notebook: [0x20, 0xb0, 0x40], street: [0xa0, 0x20, 0xa0] }
const SEEN = {
  coffee: { description: 'Steam rising from a coffee mug on a kitchen counter', tags: ['coffee', 'mug', 'kitchen', 'morning'], shotType: 'close' },
  laptop: { description: 'Hands typing on a laptop at a desk', tags: ['laptop', 'typing', 'desk', 'work'], shotType: 'hands' },
  notebook: { description: 'A paper notebook with a written plan and a pen', tags: ['notebook', 'plan', 'notes', 'planning'], shotType: 'top-down' },
  street: { description: 'A city street at sunrise with people walking', tags: ['street', 'city', 'sunrise', 'walking'], shotType: 'wide' }
}

function say(text, start, step = 0.36) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.05).toFixed(3), type: 'word' }))
}
// About 11 s: four phrases, one for each clip, with pauses between them.
const WORDS = [...say('My morning starts with coffee, always.', 0.3), ...say('Then I open my laptop and type.', 3.2),
  ...say('I write the plan in my notebook.', 6.0), ...say('Then out to the street for a walk.', 8.8)]
const TOTAL = 12

/** A library index (as the B-roll library page leaves it after looking at the clips), with posters. */
function writeLibrary(userDataDir, items) {
  const root = path.join(userDataDir, 'broll-library')
  fs.mkdirSync(path.join(root, 'posters'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ version: 1, items }))
  return root
}

function libraryItem(k, file, name, shots, extra = {}) {
  const info = fs.statSync(file)
  return {
    id: `l${String(k).padStart(12, '0')}`, kind: 'video', name, original: file, proxy: null, poster: null, durationS: extra.durationS ?? 4,
    width: 640, height: 360, size: info.size, mtimeMs: info.mtimeMs, addedAt: '2026-10-20T10:00:00.000Z', origin: 'member', tags: [], me: extra.me === true,
    shots: shots.map((shot, n) => ({ id: `s${n}`, inS: shot.inS, outS: shot.outS, analysis: { description: shot.description, tags: shot.tags, subjects: [], setting: '', shotType: shot.shotType ?? 'medium',
      motion: 'slow', mood: '', memberAppears: extra.me === true, onScreenText: '', quality: '', model: 'hand-written', analyzedAt: '2026-10-20T10:00:00.000Z' } })),
    status: 'ready'
  }
}

/** A stand-in for OpenRouter's speech-to-text (Scribe): answers with the voiceover's words. */
async function fakeScribe(words) {
  const calls = []
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      calls.push(req.url)
      if (req.url === '/api/v1/audio/transcriptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ text: words.map((w) => w.word).join(' '), words, usage: { cost: 0.0007, seconds: TOTAL } }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}/api/v1`, calls, close: () => new Promise((resolve) => server.close(resolve)) }
}

function rgbAt(ffmpeg, file, seconds) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-vf', 'crop=iw/2:ih/4:iw/4:ih*3/8,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [...raw]
}

test('B-roll video: a voiceover and the whole library become a video in the Library that opens in the clip editor', { timeout: 900000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-broll-video-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const footage = path.join(root, 'footage')
  fs.mkdirSync(footage)
  const items = Object.entries(COLORS).map(([name, [r, g, b]], k) => {
    const file = path.join(footage, `${name}.mp4`)
    const hex = `0x${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${hex}:s=640x360:r=30:d=6`, ...tools.encoder, '-pix_fmt', 'yuv420p', file])
    return libraryItem(k + 1, file, `${name}.mp4`, [{ inS: 0, outS: 6, ...SEEN[name] }], { durationS: 6 })
  })
  const libraryRoot = writeLibrary(userDataDir, items)
  // The voiceover: a tone on each word, as an M4A (audio only).
  const voice = path.join(root, 'my voiceover.m4a')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='0.3*sin(2*PI*220*t)*(${WORDS.map((w) => `between(t,${w.start},${w.end})`).join('+')})':s=48000:d=${TOTAL}`, '-c:a', 'aac', voice])

  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-broll')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '', customVocabulary: '' }))
  const scribe = await fakeScribe(WORDS)
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: scribe.base, BRIDGECLIP_E2E_OPENROUTER_URL: `${scribe.base}/chat/completions` } })
  t.after(async () => {
    await scribe.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 860))
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    Object.assign(safeStorage, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from('test:' + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(5) })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()

  // The B-roll library's button leads to the flow (it is in the sidebar too).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^B-roll library/ }).click()
  await page.getByRole('button', { name: 'Make a b-roll video' }).click()
  await page.getByRole('heading', { name: 'B-roll video', level: 1 }).waitFor()
  await page.getByText('4 shots ready in your B-roll library.').waitFor()
  assert.equal(await page.getByTestId('broll-video-start').isDisabled(), true)

  // The voiceover from the file dialog: its name and length show, then the cost.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, voice)
  await page.getByRole('button', { name: 'Choose a file' }).click()
  await page.getByTestId('broll-voiceover').getByText('my voiceover.m4a · 0:12').waitFor()
  await page.getByText(/This video needs about 5 \(one per phrase\)\./).waitFor()
  await page.getByTestId('broll-video-cost').getByText(/^On your OpenRouter key: listening for word timings under 1¢, planning the shots and graphics about \$0\.01\. Putting the video together is free\.$/).waitFor()
  // Fewer shots than moments: they say some play twice.
  await page.getByTestId('broll-video-reuse').waitFor()
  await page.getByRole('textbox', { name: 'Hook text' }).fill('My calm morning plan')

  await page.getByTestId('broll-video-start').click()
  await page.getByTestId('broll-video-progress').waitFor()
  await page.getByText('Your b-roll video is ready').waitFor({ timeout: 600000 })
  // One transcription (the balance checks ask too).
  assert.deepEqual(scribe.calls.filter((url) => url.includes('/audio/')), ['/api/v1/audio/transcriptions'])

  const run = fs.readdirSync(library).find((name) => /^broll-video-[0-9a-f-]{36}$/.test(name))
  assert.ok(run, fs.readdirSync(library).join(', '))
  const folder = path.join(library, run)
  const output = JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8'))
  assert.equal(output.editor_project, true)
  assert.equal(output.metrics.broll_video, true)
  assert.equal(output.clips.length, 1)
  const clip = path.join(folder, 'clip_00.mp4')
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', clip]).toString())
  assert.deepEqual(probe.streams.filter((s) => s.codec_type === 'video').map((s) => [s.width, s.height]), [[1080, 1920]])
  assert.ok(probe.streams.some((s) => s.codec_type === 'audio'))
  assert.ok(Math.abs(Number(probe.format.duration) - TOTAL) < 0.3, probe.format.duration)

  // Every moment has a shot, cut where the phrases change, matched to what is said.
  const plan = JSON.parse(fs.readFileSync(path.join(folder, 'broll-plan.json'), 'utf8'))
  assert.equal(plan.shots[0].start_ms, 0)
  assert.equal(plan.shots.at(-1).end_ms, plan.total_ms)
  assert.ok(Math.abs(plan.total_ms - TOTAL * 1000) < 60, String(plan.total_ms))
  plan.shots.forEach((shot, k) => { if (k) assert.equal(shot.start_ms, plan.shots[k - 1].end_ms) })
  const shotFor = (word) => plan.shots.find((shot) => shot.words.includes(word))?.shot_id
  assert.equal(shotFor('coffee'), 'l000000000001:s0')
  assert.equal(shotFor('laptop'), 'l000000000002:s0')
  assert.equal(shotFor('notebook.'), 'l000000000003:s0')
  assert.equal(shotFor('street'), 'l000000000004:s0')
  const ids = plan.shots.map((shot) => shot.shot_id)
  ids.forEach((id, k) => { if (k) assert.notEqual(id, ids[k - 1]) })
  // The picture under each phrase is its clip (the middle of the frame, clear of the captions and hook text).
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 45)
  assert.ok(near(rgbAt(ffmpeg, clip, 1.6), COLORS.coffee), String(rgbAt(ffmpeg, clip, 1.6)))
  assert.ok(near(rgbAt(ffmpeg, clip, 7.3), COLORS.notebook), String(rgbAt(ffmpeg, clip, 7.3)))
  // The editor project: one baked clip covering the video, with the hook text, captions and the title card the plan suggested.
  const project = JSON.parse(fs.readFileSync(path.join(folder, 'editor-project.json'), 'utf8'))
  const candidate = project.candidates[0]
  assert.equal(candidate.status, 'baked')
  assert.deepEqual(candidate.ranges, [[0, plan.total_ms]])
  assert.equal(candidate.hook.text, 'My calm morning plan')
  assert.equal(candidate.captions, true)
  assert.deepEqual(candidate.graphics.map((g) => [g.template, g.origin]), [['title', 'auto']])
  // What it cost is in the ledger (the word timings and the plan).
  const ledger = fs.readFileSync(path.join(userDataDir, 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  const spent = ledger.filter((entry) => entry.kind === 'broll' && entry.label === 'B-roll video').reduce((sum, entry) => sum + entry.usd, 0)
  assert.ok(Math.abs(spent - 0.0027) < 1e-6, String(spent))

  // The shots are listed; one is swapped for the next best match.
  const rows = page.getByTestId('broll-video-shot')
  assert.equal(await rows.count(), plan.shots.length)
  await page.getByRole('button', { name: 'Swap shot 1 for the next best match' }).click()
  await page.getByText('Shot swapped. Open it in the editor and press Bake to update the finished video.').waitFor({ timeout: 120000 })
  const swapped = JSON.parse(fs.readFileSync(path.join(folder, 'broll-plan.json'), 'utf8'))
  assert.notEqual(swapped.shots[0].shot_id, plan.shots[0].shot_id)
  assert.notEqual(swapped.shots[0].shot_id, swapped.shots[1].shot_id)
  const after = JSON.parse(fs.readFileSync(path.join(folder, 'editor-project.json'), 'utf8'))
  assert.equal(after.revision, project.revision + 1)
  assert.match(after.source_id, /^[0-9a-f]{32}$/)
  assert.equal(after.candidates[0].status, 'ready')
  assert.ok(fs.existsSync(path.join(folder, `editor-source-${after.source_id}.mp4`)))

  // It opens in the clip editor, ready to bake again.
  await page.getByRole('button', { name: 'Open in the editor' }).click()
  await page.locator('.editor-tabs').waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Back to B-roll video' }).waitFor()
  assert.deepEqual(errors, [])
  void libraryRoot
})
