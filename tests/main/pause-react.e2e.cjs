const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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

// A member makes a Pause & react from a video file and a phone recording of
// themselves (they paused the video on another screen to talk). The real
// engine fetches the video, finds the pauses from the phone's sound and makes
// the video; only the paid AI writing step is stood in for (they could also
// type the headline themselves). The finished video is in the Library and its
// hook text can be edited there.

test('Pause & react: an uploaded video and phone recording, the detected pauses, made and in the Library with its hook text editable', { timeout: 420000 }, async (t) => {
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-pause-react-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  // Their video: a moving test pattern with a rhythmic noise "voice". The phone: the member talks (1.5 s), the video plays
  // out loud (4 s), they pause it to talk (2.5 s), it plays on (4 s).
  const original = path.join(root, 'coach-clip.mp4')
  const speech = (seed, rate) => `anoisesrc=c=pink:seed=${seed}:a=0.35:r=48000,volume='0.3+0.7*abs(sin(PI*${rate}*t))':eval=frame`
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=12', '-f', 'lavfi', '-i', `${speech(3, 3)},atrim=duration=12`,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', original])
  const phone = path.join(root, 'my-reaction.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x406080:s=360x640:r=30:d=12', '-i', original,
    '-f', 'lavfi', '-i', `${speech(11, 4)},atrim=duration=1.5`, '-f', 'lavfi', '-i', `${speech(12, 4)},atrim=duration=2.5`,
    '-filter_complex', '[1:a]atrim=0:4,asetpts=PTS-STARTPTS,volume=0.5[o1];[1:a]atrim=4:8,asetpts=PTS-STARTPTS,volume=0.5[o2];' +
      '[2:a][o1][3:a][o2]concat=n=4:v=0:a=1[a];[0:v]drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill[v]',
    '-map', '[v]', '-map', '[a]', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '12', phone])
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))

  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1000))
  // An OpenRouter key so Remix starts; nothing in this test reaches OpenRouter. (Linux without a desktop keyring only
  // offers plain-text storage, which the app refuses for keys: this key is fake, so let it through there.)
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
  // The file dialogs: their video first, then the phone recording.
  await app.evaluate(({ dialog }, files) => {
    const queue = [...files]
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [queue.shift()] })
  }, [original, phone])

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  // Avatar Studio is switched off for launch: Remix offers only You on camera (no "Who's in it" choice, no AI presenter).
  await page.getByRole('radiogroup', { name: 'Remix format' }).waitFor()
  assert.equal(await page.getByRole('radio', { name: /^AI presenter/ }).count(), 0)
  assert.equal(await page.getByRole('radiogroup', { name: 'Who is in the video' }).count(), 0)
  assert.equal(await page.getByTestId('ai-needs-avatar').count(), 0)
  assert.equal(await page.getByText('Avatar Studio').count(), 0)
  await page.getByRole('radio', { name: /Pause & react/ }).click()
  await page.getByRole('heading', { name: '01 · The video you react to' }).waitFor()
  // The video comes first, then the format, then the look (folded, with a summary); Continue is in the summary card.
  const headings = (await page.getByRole('heading').allTextContents()).map((text) => text.trim())
  const at = (start) => headings.findIndex((text) => text.startsWith(start))
  assert.ok(at('01 · The video you react to') >= 0 && at('01 · The video you react to') < at('02 · Format') && at('02 · Format') < at('03 · Look & call to action'), headings.join(' | '))
  const look = page.getByRole('button', { name: 'Customize for this video' })
  assert.equal(await look.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.getByTestId('look-summary').innerText(), 'Box at the top · As filmed · Pop captions · White bar · No brand · No call to action')
  assert.equal(await page.getByRole('button', { name: 'Continue to recording' }).count(), 1)
  // No presenter to choose and no AI label: it's really you.
  assert.equal(await page.getByRole('radiogroup', { name: 'Presenter' }).count(), 0)
  assert.equal(await page.getByRole('checkbox', { name: "I'll turn on the AI-content label when I post" }).count(), 0)
  const next = page.getByRole('button', { name: 'Continue to recording' })
  assert.equal(await next.isDisabled(), true)
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByText('coach-clip.mp4').waitFor()
  await page.getByPlaceholder('e.g. @theircreator').fill('@coach')
  await look.click()
  // No green screen behind you here: you fill the frame.
  await page.getByRole('radiogroup', { name: 'Your background' }).getByRole('radio', { name: /As filmed/ }).waitFor()
  assert.equal(await page.getByRole('radiogroup', { name: 'Your background' }).getByRole('radio', { name: /Green screen/ }).count(), 0)
  await page.getByRole('radio', { name: /Split 50\/50/ }).click()
  await page.getByTestId('look-summary').getByText(/^Split 50\/50 · /).waitFor()
  // Split: the hook text sits on the line between the halves (a white box), unless the member puts it at the top.
  const hookPlace = page.getByRole('radiogroup', { name: 'Where the hook text goes' })
  assert.equal(await hookPlace.getByRole('radio', { name: 'On the split line' }).getAttribute('aria-checked'), 'true')
  await page.getByText('A white box with bold black text, right where the two halves meet.').waitFor()
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await page.getByRole('radiogroup', { name: 'Remix format' }).scrollIntoViewIfNeeded(); await shot(app, 'pause-react-form.png') }
  await next.click()

  // The video is ready (no AI): trim it, then upload the phone recording; the pauses are found from its sound.
  const reviewHeading = page.getByRole('heading', { name: 'Your pause-and-react' })
  await reviewHeading.waitFor({ timeout: 90000 })
  // Continue brings the review into view, with the focus on its heading.
  await page.waitForFunction(() => document.activeElement?.textContent === 'Your pause-and-react')
  await page.getByLabel('Start of the part').waitFor()
  const make = page.getByRole('button', { name: 'Make the video' })
  assert.equal(await make.isDisabled(), true)
  // A take is waiting only once it's recorded: no "Starting again replaces…" yet.
  assert.equal(await page.getByText(/Starting again replaces/).count(), 0)

  // The AI writes the hook text from what they said, straight after the upload (stood in for here: it's the paid step).
  const status = await page.evaluate(() => window.bridgeclip.remix.status())
  assert.equal(status.drafts[0].format, 'pause_react')
  await app.evaluate(({ ipcMain, BrowserWindow }, current) => {
    ipcMain.removeHandler('remix:write')
    ipcMain.handle('remix:write', () => {
      const written = { ...current, costUsd: 0.02, drafts: [{ ...current.drafts[0], headline: 'This coach says lose weight first. Not so fast', postCaption: 'You can train the pull first.\n\nClip: @coach', quote: 'Lose weight first? No.' }] }
      setTimeout(() => BrowserWindow.getAllWindows()[0].webContents.send('remix:status', written), 200)
      return { ...current, phase: 'planning', detail: 'Writing your headline and caption from what you said', percent: 5 }
    })
  }, status)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await page.getByLabel('Hook text, your pause-and-react').waitFor({ timeout: 90000 })
  const summary = page.getByTestId('pause-summary')
  await summary.waitFor({ timeout: 90000 })
  assert.match(await summary.innerText(), /^1 pause ·/)
  await page.getByText(/Their video starts 1\.\ds into your recording \(found by its sound\)/).waitFor()
  const bar = page.getByRole('list', { name: 'Pauses timeline' })
  assert.ok(await bar.getByRole('listitem').count() >= 3)
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await summary.scrollIntoViewIfNeeded(); await shot(app, 'pause-react-review.png') }
  // Sync can be nudged under Fine-tune (folded when the sound lined it up), and put back.
  assert.equal(await page.getByRole('button', { name: '+0.1s' }).count(), 0)
  await page.getByRole('button', { name: 'Fine-tune (only if it looks off)' }).click()
  await page.getByRole('button', { name: '+0.1s' }).click()
  await page.getByText('later by 0.1s').waitFor()
  await page.getByRole('button', { name: 'Back to what was found' }).click()
  await page.getByText('later by 0.1s').waitFor({ state: 'detached' })

  // Written on its own after the upload.
  const headline = page.getByLabel('Hook text, your pause-and-react')
  await headline.waitFor()
  assert.equal(await headline.inputValue(), 'This coach says lose weight first. Not so fast')
  await page.getByText('You said: “Lose weight first? No.”').waitFor()

  // Make it with the real engine.
  await make.click()
  await page.getByText(/^1 remix ready/).waitFor({ timeout: 240000 })
  const run = fs.readdirSync(library).find((name) => name.startsWith('remix-'))
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.equal(job.clips.length, 1)
  assert.equal(job.clips[0].headline, 'This coach says lose weight first. Not so fast')
  assert.equal(job.clips[0].ai_generated, false)
  assert.ok(job.clips[0].editable, 'its hook text can be edited')
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(library, run, 'clip_00.mp4')]).toString())
  assert.ok(seconds > 10 && seconds <= 12.1, `as long as the reaction (${seconds}s)`)
  const manifest = JSON.parse(fs.readFileSync(path.join(library, run, 'clip_00.source.json'), 'utf8'))
  assert.equal(manifest.presenter.pause_react.arrangement, 'split')
  assert.equal(manifest.presenter.pause_react.timeline_from, 'upload')
  assert.equal(manifest.presenter.pause_react.pauses, 1)
  assert.equal(manifest.presenter.pause_react.hook, 'seam')
  if (process.env.BRIDGECLIP_E2E_SHOTS) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', path.join(library, run, 'clip_00.mp4'), '-frames:v', '1', path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'pause-react-seam.png')])

  // In the Library: "Edit hook text & captions" is there.
  await page.getByRole('button', { name: /^Library/ }).first().click()
  await page.getByRole('button', { name: /^Open Remix · coach-clip/ }).first().click()
  await page.getByRole('button', { name: /^Actions for “This coach says lose weight first/ }).first().click()
  await page.getByRole('menuitem', { name: 'Edit hook text & captions', exact: true }).waitFor()
  assert.deepEqual(errors, [])
})

test('Pause & react recorded here: their video plays over the camera, Space pauses and plays it, and the log becomes the timeline', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-pause-record-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const original = path.join(root, 'coach-clip.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=20', '-f', 'lavfi', '-i', 'sine=d=20',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', original])
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv, args: FAKE_MEDIA })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1000))
  await app.evaluate(({ safeStorage, dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  }, original)
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  // (Remix opens on You on camera, the only side while Avatar Studio is switched off.)
  await page.getByRole('radio', { name: /Pause & react/ }).click()
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByPlaceholder('e.g. @theircreator').fill('@coach')
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  await page.getByRole('button', { name: 'Continue to recording' }).click()
  await page.getByRole('heading', { name: 'Your pause-and-react' }).waitFor({ timeout: 90000 })
  // Only part of their video: from 5 s on.
  await page.getByLabel('Start of the part').fill('5')
  await page.getByLabel('End of the part').fill('19.5')
  await page.getByRole('button', { name: 'Use this part' }).click()
  await page.getByRole('button', { name: 'Use this part' }).waitFor({ state: 'detached' })

  await page.getByRole('button', { name: 'Record', exact: true }).click()
  const recorder = page.getByRole('dialog', { name: 'Record yourself' })
  await recorder.getByText(/Wear headphones so their video’s sound stays out of your microphone/).waitFor()
  await recorder.getByRole('button', { name: 'Start: their video plays and you react' }).click()
  const toggle = recorder.getByRole('button', { name: /Pause their video to talk \(Space\)/ })
  await toggle.waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  await shot(app, 'pause-react-recorder.png')
  // Space pauses their video while you talk, then plays it again; the big button does the same.
  await page.keyboard.press('Space')
  await recorder.getByRole('button', { name: /Play their video \(Space\)/ }).waitFor()
  await page.waitForTimeout(1000)
  await page.keyboard.press('Space')
  await toggle.waitFor()
  await page.waitForTimeout(600)
  await toggle.click()
  await recorder.getByRole('button', { name: /Play their video \(Space\)/ }).waitFor()
  // (The fixed waits add up to the recording's length, checked below to be over 4 s; keep a margin on a fast machine.)
  await page.waitForTimeout(1600)
  await recorder.getByRole('button', { name: 'Stop' }).click()
  await recorder.getByText(/^Recorded/).waitFor({ timeout: 20000 })
  await recorder.getByRole('button', { name: 'Done' }).click()

  // The timeline follows what you did: their video from 5 s, two pauses, nothing to adjust.
  const summary = page.getByTestId('pause-summary')
  await summary.waitFor()
  assert.match(await summary.innerText(), /^2 pauses ·/)
  await page.getByText('Recorded here, so it follows exactly when you paused and played. Record again to change it.').waitFor()
  const view = await page.evaluate(() => window.bridgeclip.remix.pauseView())
  assert.equal(view.source, 'app')
  const plays = view.timeline.segments.filter((seg) => seg.kind === 'play')
  assert.ok(plays.length === 2, JSON.stringify(view.timeline.segments))
  assert.ok(Math.abs(plays[0].at - 5) < 0.3, `their video starts at the part chosen (${plays[0].at})`)
  // It holds the frame it paused on, then plays on from where the player resumed. (The log's own times are used: on this
  // test machine, without a sound card, the player skips about a second ahead when it resumes, so only the order is checked.)
  const held = view.timeline.segments.find((seg) => seg.kind === 'pause' && seg.start >= plays[0].end - 0.01)
  assert.ok(held && held.at > plays[0].at + 0.3 && plays[1].at >= held.at - 0.05 && plays[1].at < 19.5, JSON.stringify(view.timeline.segments))
  assert.ok(view.timeline.end > 4 && view.timeline.end < 30, `the recording's length (${view.timeline.end})`)
  assert.equal(await page.getByRole('button', { name: 'Make the video' }).isDisabled(), true, 'needs the hook text')
  assert.deepEqual(errors, [])
})
