const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { launchApp, buildApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

// A YouTube video from Edit my recording: a landscape camera take and a screen recording made with it, the format
// switched from the suggested Reel to YouTube, planned (stand-in AI) with a branded cold open, made as screen + webcam
// picture-in-picture at 1920x1080 30 fps, baked by the clip editor with landscape graphics (full-screen brand cards, a
// stat overlay in the lower third) and captions on key lines in the lower third; chapters to copy on the done screen
// and a YouTube tag in the Library. With BRIDGECLIP_E2E_SHOTS set, frames of the video are saved there.

function say(text, start, step) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.05).toFixed(3), type: 'word' }))
}
const SCRIPT = [
  ['I launched a brand new tool that I built using AI.', 0.3, 0.33],
  ['It made 1,227 dollars in monthly recurring revenue.', 5.8, 0.36],
  ['And I am going to break down exactly what we do: input, process, output.', 9.6, 0.3],
  ['If I had to make 500 dollars a week, here is how.', 18.2, 0.3],
  ['Watch this dashboard right now.', 22.6, 0.34],
  ['The idea is simple. You find a problem people already pay to fix.', 25.0, 0.31],
  ['Then you research and build the tool in a weekend.', 30.2, 0.31],
  ['The biggest mistake is waiting too long to launch.', 34.6, 0.32],
  ['My churn is only 3 percent this month.', 39.0, 0.32],
  ['Now let me show you the research step on my screen.', 43.4, 0.31],
  ['First you open the search tool and type the problem.', 47.6, 0.31],
  ['Then you read what people complain about every day.', 51.8, 0.31],
  ['You write down the words they use, exactly as they say them.', 56.0, 0.3],
  ['Those words become your offer and your headline.', 60.6, 0.31],
  ['That is the whole system, and it works every week.', 64.8, 0.31],
  ['Follow me for more.', 69.4, 0.37]
]
const WORDS = SCRIPT.flatMap(([text, start, step]) => say(text, start, step))
const SECONDS = 72
const OFFSET_S = 0.8

function shotsDir() { return process.env.BRIDGECLIP_E2E_SHOTS || null }

test('A YouTube video: switched from Reel, screen + webcam picture-in-picture at 16:9, a branded cold open, key-line captions, chapters', { timeout: 1200000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-youtube-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  // A tone of its own pitch wherever each word is said; the screen recording hears it later, duller and quieter.
  const tones = (shift) => WORDS.map((w, i) => `0.3*sin(2*PI*${200 + 23 * (i % 40)}*t)*between(t+${shift},${w.start},${w.end})`).join('+')
  const camera = path.join(root, 'webcam take.mp4'), screen = path.join(root, 'Screen Recording.mov')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=30:d=${SECONDS}`, '-f', 'lavfi', '-i', `aevalsrc='${tones(0)}':s=48000:d=${SECONDS}`,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', camera])
  // A "dashboard": a light page with dark bars and a number, moving a little.
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0xF5F6F8:s=1280x720:r=30:d=${SECONDS}`, '-f', 'lavfi', '-i', `aevalsrc='${tones(OFFSET_S)}':s=48000:d=${SECONDS}`,
    '-filter_complex', "[0:v]drawbox=x=60:y=60:w=1160:h=90:c=0x1B1F2A:t=fill,drawbox=x=60:y=200:w=360:h=200:c=0x2F5BFF@0.85:t=fill,drawbox=x=460:y=200:w=360:h=200:c=0x1FA463@0.85:t=fill,drawbox=x=860:y=200:w=360:h=200:c=0xFF8A3D@0.85:t=fill,drawbox=x=60+mod(t*40\\,900):y=460:w=300:h=180:c=0x9AA3B5:t=fill[v];[1:a]lowpass=f=2500,volume=0.4[a]",
    '-map', '[v]', '-map', '[a]', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', screen])
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))

  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(req.url === '/api/v1/audio/transcriptions' ? 200 : 404, { 'Content-Type': 'application/json' })
      if (req.url !== '/api/v1/audio/transcriptions') { res.end('{"error":{"code":404,"message":"not here"}}'); return }
      res.end(JSON.stringify({ text: WORDS.map((w) => w.word).join(' '), words: WORDS, usage: { cost: 0.0004, seconds: SECONDS } }))
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1100))
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
  const pick = (file) => app.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }) }, file)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Edit my recording/ }).click()
  await page.getByRole('heading', { name: 'Raw takes in, one finished reel out', level: 1 }).waitFor()
    .catch(async (error) => { throw new Error(`${error.message}\n${(await page.locator('body').innerText()).slice(0, 1500)}\n${errors.join('\n')}`) })
  const formats = page.getByRole('radiogroup', { name: 'What are you making?' })
  // Nothing chosen yet: a reel.
  assert.equal(await formats.getByRole('radio', { name: /^Reel \(vertical, short\)/ }).getAttribute('aria-checked'), 'true')
  await pick(camera)
  await page.getByRole('button', { name: 'Choose recordings' }).click()
  await page.getByRole('list', { name: 'Your recordings' }).getByText('webcam take.mp4').waitFor()
  // A 72-second landscape take: suggested as a YouTube video (landscape, over a minute); Reel picked, then YouTube again.
  await page.getByTestId('edit-format').getByText(/^Filmed landscape, so it starts as a YouTube video\. You can switch\.$/).waitFor()
  assert.equal(await formats.getByRole('radio', { name: /^YouTube video/ }).getAttribute('aria-checked'), 'true')
  await formats.getByRole('radio', { name: /^Reel \(vertical, short\)/ }).click()
  assert.equal(await formats.getByRole('radio', { name: /^Reel/ }).getAttribute('aria-checked'), 'true')
  await formats.getByRole('radio', { name: /^YouTube video \(landscape, long\)/ }).click()
  assert.equal(await formats.getByRole('radio', { name: /^YouTube video/ }).getAttribute('aria-checked'), 'true')
  await page.getByTestId('edit-landscape-frame').waitFor()
  await pick(screen)
  await page.getByRole('button', { name: '+ Add a screen recording' }).click()
  const box = page.getByTestId('screen-recording')
  await box.getByTestId('screen-sync').getByText(/^Lined up by sound/).waitFor({ timeout: 90000 })
  await page.getByRole('button', { name: 'Edit my recording', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 240000 })
  const status = await page.evaluate(() => window.bridgeclip.edit.status())
  assert.equal(status.format, 'youtube')
  assert.ok((status.plan.graphics ?? []).some((g) => g.fields.effect === 'titlecard-lockup'), JSON.stringify(status.plan.graphics))
  assert.deepEqual(status.plan.chapters, [{ word: 0, title: 'brand new tool' }])
  // The review: the YouTube layout (no reel-only screen layouts), webcam size and position, key-line captions.
  const panel = page.getByTestId('edit-youtube')
  assert.equal(await page.getByTestId('edit-screen').count(), 0)
  assert.equal(await panel.getByRole('radiogroup', { name: 'Webcam size' }).getByRole('radio', { name: 'Large' }).getAttribute('aria-checked'), 'true')
  assert.equal(await panel.getByRole('radiogroup', { name: 'Webcam position' }).getByRole('radio', { name: 'Right side' }).getAttribute('aria-checked'), 'true')
  assert.equal(await panel.getByRole('radiogroup', { name: 'Captions on' }).getByRole('radio', { name: 'Key lines' }).getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: 'Make my YouTube video' }).click()
  await page.getByText('Your YouTube video is ready').waitFor({ timeout: 900000 })

  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  const folder = path.join(library, run)
  const job = JSON.parse(fs.readFileSync(path.join(folder, 'job_output.json'), 'utf8'))
  assert.equal(job.metrics.format, 'youtube')
  assert.match(job.source_video_title, /^YouTube · /)
  const project = JSON.parse(fs.readFileSync(path.join(folder, 'editor-project.json'), 'utf8'))
  const c = project.candidates[0]
  assert.deepEqual([project.aspect_ratio, project.width, project.height], ['16:9', 1920, 1080])
  assert.equal(c.status, 'baked')
  assert.ok(project.youtube.pip[0] > 0.6 && project.youtube.pip[2] >= 0.28, JSON.stringify(project.youtube))
  // The cold open: full-screen brand cards and a stat overlay in the lower third; no stage scenes.
  const cards = (c.graphics ?? []).filter((g) => g.size === 'stage')
  const stat = (c.graphics ?? []).find((g) => g.template === 'stat' && g.size === 'compact')
  assert.ok(cards.length >= 2 && stat, JSON.stringify(c.graphics))
  assert.equal(c.stage_scenes, undefined)
  // Captions on key lines only: the rest is quiet.
  assert.ok(c.caption_suppression_ranges.length >= 1)
  const reel = path.join(folder, 'clip_00.mp4')
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate', '-show_entries', 'format=duration', '-of', 'json', reel]).toString())
  const video = probe.streams.find((s) => s.codec_type === 'video')
  const shots = shotsDir()
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    fs.copyFileSync(reel, path.join(shots, 'youtube-video.mp4'))
    fs.writeFileSync(path.join(shots, 'youtube-project.json'), JSON.stringify(project, null, 1))
  }
  const [num, den] = video.avg_frame_rate.split('/').map(Number)
  assert.deepEqual([video.width, video.height], [1920, 1080])
  assert.ok(Math.abs(num / den - 30) < 0.05, video.avg_frame_rate)
  const frame = (at, file) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 * 1024 * 1024 })
  const busy = (c.graphics ?? []).map((g) => [g.at_ms, g.at_ms + g.duration_ms])
  const free = (ms) => !busy.some(([a, b]) => ms > a - 300 && ms < b + 300)
  const quiet = (ms) => c.caption_suppression_ranges.some(([a, b]) => ms >= a && ms < b)
  const words = JSON.parse(fs.readFileSync(path.join(folder, 'transcript.json'), 'utf8')).segments.flatMap((s) => s.words)
  const mid = (w) => Math.round((w.start_time_ms + w.end_time_ms) / 2)
  const spoken = words.map(mid).filter(free)
  const captioned = spoken.find((ms) => !quiet(ms)), silent = spoken.find((ms) => quiet(ms))
  assert.ok(captioned !== undefined && silent !== undefined, `${spoken} / ${JSON.stringify(c.caption_suppression_ranges)}`)
  // The picture-in-picture: the camera's moving test picture in the card on the right, the screen at left; the
  // caption sits in the lower third (bright text pixels there on a captioned line, none on a quiet one).
  const at = captioned / 1000
  const gray = frame(at, reel)
  const px = (x, y) => gray[y * 1920 + x]
  const [cx, cy, cw, ch] = project.youtube.pip.map((v, i) => Math.round(v * (i % 2 ? 1080 : 1920)))
  const cardValues = []
  for (let y = cy + 40; y < cy + ch - 40; y += 23) for (let x = cx + 40; x < cx + cw - 40; x += 19) cardValues.push(px(x, y))
  const mean = cardValues.reduce((a, b) => a + b, 0) / cardValues.length
  const spread = Math.sqrt(cardValues.reduce((a, b) => a + (b - mean) ** 2, 0) / cardValues.length)
  assert.ok(spread > 25, `the webcam card shows the camera (spread ${spread})`)
  const bright = (buffer) => { let n = 0; for (let y = 900; y < 1000; y += 2) for (let x = 120; x < 1200; x += 3) if (buffer[y * 1920 + x] > 225) n++; return n }
  const on = bright(gray), off = bright(frame(silent / 1000, reel))
  assert.ok(on > off + 40, `caption pixels in the lower third: ${on} on a key line vs ${off} on a quiet one`)
  // Chapters on the done screen, ready to copy; the Library tags the run as a YouTube video.
  const chapters = page.getByTestId('edit-chapters')
  await chapters.getByRole('button', { name: 'Copy chapters' }).waitFor()
  assert.match(await chapters.getByRole('list', { name: 'Chapters' }).innerText(), /^0:00 brand new tool\n/)
  await page.getByRole('button', { name: 'Open in Library' }).click()
  await page.getByTestId('run-format').filter({ hasText: 'YouTube' }).first().waitFor()
  assert.deepEqual(errors, [])
})
