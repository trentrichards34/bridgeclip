const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

async function openRemix(page) {
  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Their moment hooks. Your take is the video.', exact: true }).waitFor()
}

const radio = (page, group, name) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: new RegExp(`^${name}`) })

test('saved styles: save the Remix style, restart, the last style comes back and the saved one applies', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-styles-e2e-'))
  const userData = path.join(root, 'user-data')
  const appDir = buildApp(path.join(root, 'app'))
  let session = await launchApp({ appDir, userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const errors = []
  session.page.on('pageerror', (error) => errors.push(error.message))

  let page = session.page
  await openRemix(page)
  await page.getByText('Style', { exact: true }).first().waitFor()
  // (A first visit opens on You on camera: the voiced take is on the AI presenter side.)
  await radio(page, 'Who is in the video', 'AI presenter').click()
  await radio(page, 'Style of your take', 'Myth vs. truth').click()
  await page.getByRole('radiogroup', { name: 'Takes per video' }).getByRole('radio', { name: '5', exact: true }).click()
  // The look and call to action are folded (with a summary line) until opened.
  await page.getByRole('button', { name: 'Customize for this video' }).click()
  await page.getByLabel('Comment keyword').fill('sales')
  await page.getByLabel('What they get').fill('my free playbook')
  // Extras are part of the style.
  const extras = (page) => page.getByRole('group', { name: 'Extras: pick as many as you like' })
  await extras(page).getByRole('checkbox', { name: 'Keyword pill' }).click()
  await page.getByLabel('Video links').fill('https://www.youtube.com/watch?v=abcdefghijk')

  await page.getByRole('button', { name: 'Save current as…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save your Remix style' })
  await dialog.getByLabel('Style name').fill('  Daily myths ')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByText('Saved “Daily myths”').waitFor()
  await page.getByRole('combobox', { name: 'Saved style' }).getByText('Daily myths').waitFor()
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({ path: path.join(shots, 'remix-style.png'), timeout: 10000 }).catch(() => undefined)
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
    await page.getByText('Support link or email (optional)').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(shots, 'settings-support.png'), timeout: 10000 }).catch(() => undefined)
    await openRemix(page)
  }

  // Then a different last-used style, which is what the next start opens with.
  await radio(page, 'Style of your take', 'Lessons from this').click()
  await page.getByRole('radiogroup', { name: 'Takes per video' }).getByRole('radio', { name: '1', exact: true }).click()
  await page.waitForTimeout(1200)
  const file = JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8'))
  assert.equal(file.remix.angle, 'lessons')
  assert.equal(file.presets.remix[0].name, 'Daily myths')
  assert.deepEqual(file.presets.remix[0].style.lookExtras, ['keyword_pill'])
  assert.equal(JSON.stringify(file).includes('youtube.com'), false, 'pasted links are never saved')

  await session.close()
  session = await launchApp({ appDir, userDataDir: userData })
  page = session.page
  page.on('pageerror', (error) => errors.push(error.message))
  await openRemix(page)
  await page.getByText('Style', { exact: true }).first().waitFor()
  assert.equal(await radio(page, 'Style of your take', 'Lessons from this').getAttribute('aria-checked'), 'true', 'the last style is remembered')
  assert.equal(await page.getByRole('radiogroup', { name: 'Takes per video' }).getByRole('radio', { name: '1', exact: true }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByLabel('Video links').inputValue(), '', 'links start empty')
  await page.getByRole('button', { name: 'Customize for this video' }).click()
  assert.equal(await page.getByLabel('Comment keyword').inputValue(), 'SALES')
  assert.equal(await extras(page).getByRole('checkbox', { name: 'Keyword pill' }).getAttribute('aria-checked'), 'true', 'extras are remembered')
  await extras(page).getByRole('checkbox', { name: 'Keyword pill' }).click()

  await page.getByRole('combobox', { name: 'Saved style' }).click()
  await page.getByRole('option', { name: 'Daily myths' }).click()
  await page.getByText('Applied “Daily myths”').waitFor()
  assert.equal(await radio(page, 'Style of your take', 'Myth vs. truth').getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByRole('radiogroup', { name: 'Takes per video' }).getByRole('radio', { name: '5', exact: true }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByLabel('What they get').inputValue(), 'my free playbook')
  assert.equal(await extras(page).getByRole('checkbox', { name: 'Keyword pill' }).getAttribute('aria-checked'), 'true', 'the saved style brings its extras back')

  // Rename and delete from the style's menu.
  await page.getByRole('button', { name: 'Actions for style “Daily myths”' }).click()
  await page.getByRole('menuitem', { name: 'Rename…' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename style' })
  await rename.getByLabel('Style name').fill('Myth Mondays')
  await rename.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByText('Renamed to “Myth Mondays”').waitFor()
  await page.getByRole('button', { name: 'Actions for style “Myth Mondays”' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete style' }).click()
  await page.getByRole('combobox', { name: 'Saved style' }).getByText('No saved styles yet').waitFor()

  // Create has its own (empty) list.
  await page.getByRole('button', { name: 'Create', exact: true }).first().click()
  await page.getByRole('combobox', { name: 'Saved style' }).getByText('No saved styles yet').waitFor()
  assert.deepEqual(errors, [])
})

test('Remix result: Post or schedule opens the post dialog with the Library clip, Open in Library shows the run, and a Library clip can be remixed', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-remix-post-e2e-'))
  const userData = path.join(root, 'user-data')
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  const library = path.join(userData, 'CreatorClips')
  const folder = path.join(library, 'remix-0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9')
  fs.mkdirSync(folder, { recursive: true })
  const video = path.join(folder, '01 This coach says you must lose weight first.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3355ff:s=270x480:d=2', '-f', 'lavfi', '-i', 'sine=d=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
  const headline = 'This coach says you must lose weight first'
  const caption = 'Your first pull-up has nothing to do with the scale.\n\nClip: Coach Example'
  fs.writeFileSync(path.join(folder, 'job_output.json'), JSON.stringify({
    job_id: 'remix-run', source_video_url: 'https://www.youtube.com/watch?v=abcdefghijk', source_video_title: 'Pull-up myths', source_video_channel: 'Coach Example',
    source_video_duration_seconds: 600, total_clips: 1, transcript_url: null, plan_url: null, processing_time_seconds: 10, metrics: null, created_at: new Date().toISOString(),
    clips: [{ clip_index: 0, s3_url: `file://${video}`, duration_ms: 2000, start_time_ms: 0, end_time_ms: 2000, virality_score: 0.9, layout_type: 'fit',
      summary: headline, headline, tags: [], ai_generated: true, post_caption: caption }]
  }))

  await openRemix(page)
  await app.evaluate(({ BrowserWindow }, { video, folder, headline, caption }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('remix:status', {
      id: 'run1', phase: 'done', detail: 'Done', percent: 100, folder, estimateUsd: 0.6, costUsd: 0.6, warnings: [], error: null, drafts: [],
      outputs: [{ style: 'myth_truth', grade: 'A', creator: 'Coach Example', path: video, manifestPath: video.replace(/\.mp4$/, '.json'), headline, stance: 'disagree_correct',
        excerptSeconds: 1, durationSeconds: 2, costUsd: 0.6, warnings: [], checks: [{ id: 'credited', ok: true, label: 'Original creator credited on screen' }], postCaption: caption }]
    })
  }, { video, folder, headline, caption })
  await page.getByText(/1 remix ready/).waitFor()

  await page.getByRole('button', { name: 'Post or schedule' }).click()
  const dialog = page.getByRole('dialog', { name: headline })
  await dialog.waitFor()
  await dialog.getByText('Post clip', { exact: true }).waitFor()
  // No Zernio key in this test: the dialog asks to connect accounts.
  await dialog.getByText('Connect your social accounts').waitFor()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await dialog.waitFor({ state: 'detached' })

  await page.getByRole('button', { name: 'Open in Library' }).click()
  await page.getByRole('heading', { name: 'Pull-up myths' }).waitFor()

  // Library → Remix: the clip becomes the source file, with its creator.
  await page.getByRole('button', { name: `Actions for “${headline}”` }).click()
  await page.getByRole('menuitem', { name: 'Remix this clip' }).click()
  await page.getByRole('heading', { name: 'Their moment hooks. Your take is the video.', exact: true }).waitFor()
  await page.getByText(path.basename(video), { exact: true }).waitFor()
  assert.equal(await page.getByPlaceholder('e.g. @theircreator').inputValue(), 'Coach Example')
  assert.deepEqual(errors, [])
})

test('Create: the screen share choice shows under Smart framing, is remembered, and goes with the run', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-screen-share-e2e-'))
  const userData = path.join(root, 'user-data')
  const appDir = buildApp(path.join(root, 'app'))
  let session = await launchApp({ appDir, userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const errors = []
  const mock = async (current) => {
    await current.app.evaluate(({ ipcMain }, folder) => {
      globalThis.screenShareTest = []
      ipcMain.removeHandler('settings:load')
      ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, zernioConfigured: false, outputDirectory: folder, pythonPath: '', customVocabulary: '' }))
      ipcMain.removeHandler('system:checkTools')
      ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
      ipcMain.removeHandler('job:start')
      ipcMain.handle('job:start', (_event, request) => { globalThis.screenShareTest.push(request); return { jobId: 'screen-share-1', queued: false } })
    }, root)
    await current.page.reload()
    current.page.on('pageerror', (error) => errors.push(error.message))
  }
  const toFormat = async (page) => {
    await page.getByRole('radiogroup', { name: 'Workflow', exact: true }).getByRole('radio', { name: 'Automatic', exact: true }).click()
    await page.getByPlaceholder('YouTube, Twitch VOD or direct video link').fill('https://example.com/video.mp4')
    await page.getByRole('button', { name: 'Use link', exact: true }).click()
    await page.getByRole('button', { name: 'Next: Format', exact: true }).click()
    // Screen share is under Customize, open already when it was changed.
    const customize = page.getByTestId('format-summary').getByRole('button', { name: /^(Customize|Hide options)/ })
    if (await customize.getAttribute('aria-expanded') === 'false') await customize.click()
  }
  const choice = (page, name) => page.getByRole('radiogroup', { name: 'Screen share clips' }).getByRole('radio', { name, exact: true })

  await mock(session)
  let page = session.page
  await toFormat(page)
  assert.equal(await choice(page, 'Smart mix').getAttribute('aria-checked'), 'true', 'the smart mix is the default')
  await choice(page, 'Presenter only').click()
  await page.getByText('Just you, filling the frame, in every clip.').waitFor()
  // Only under Smart framing.
  await page.getByRole('radiogroup', { name: 'Framing' }).getByRole('radio', { name: /^Classic/ }).click()
  assert.equal(await page.getByRole('radiogroup', { name: 'Screen share clips' }).count(), 0)
  await page.getByRole('radiogroup', { name: 'Framing' }).getByRole('radio', { name: /^Smart/ }).click()
  assert.equal(await choice(page, 'Presenter only').getAttribute('aria-checked'), 'true')
  await page.waitForTimeout(1200)
  const file = JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8'))
  assert.equal(file.create.screenFocus, 'presenter')

  await session.close()
  session = await launchApp({ appDir, userDataDir: userData })
  await mock(session)
  page = session.page
  await toFormat(page)
  assert.equal(await choice(page, 'Presenter only').getAttribute('aria-checked'), 'true', 'the choice is remembered')
  await page.getByRole('navigation', { name: 'Create steps' }).getByRole('button', { name: /Review/ }).click()
  await page.getByText('Just you in every clip').waitFor()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await page.getByRole('button', { name: 'Clip another video' }).waitFor()
  assert.equal(await session.app.evaluate(() => globalThis.screenShareTest[0].screenFocus), 'presenter')
  assert.deepEqual(errors, [])
})
