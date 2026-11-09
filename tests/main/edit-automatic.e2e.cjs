const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

// A member made clips with Create's Automatic workflow and wants to rewrite one
// headline and remove another. From the Library, "Edit headline" opens the
// run in the editor (built from its clips, using the source the run kept, no
// AI); baking replaces those clips in place and leaves the third untouched.

const RUN = '9b2f2c3e-6a1d-4e8f-9c71-2d4e5f6a7b8c'
const TITLE = 'Carousel lessons'
const HEADLINES = ["He admits he doesn't know what makes great carousels", 'He tested twenty carousels in one week', 'The one slide everyone skips']

test('Automatic clips open in the editor from the Library; edited headlines replace their clips in place', { timeout: 240000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-edit-automatic-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, RUN)
  fs.mkdirSync(run, { recursive: true })
  const media = (file, seconds, size) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart', file])
  // The source the Automatic run kept, and the three clips it made.
  media(path.join(run, 'editor-source.mp4'), 30, '640x360')
  for (let i = 0; i < 3; i++) media(path.join(run, `clip_0${i}.mp4`), 2, '360x640')
  const words = (start, text) => text.split(' ').map((word, i) => ({ word, start_time_ms: start + i * 400, end_time_ms: start + i * 400 + 350 }))
  const lines = [[1000, 'I really do not know what makes great carousels'], [8000, 'So I tested twenty of them in one week'], [16000, 'Everyone skips the very first slide']]
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: lines.map(([start, text]) => ({ start_time_ms: start, end_time_ms: start + text.split(' ').length * 400, text, words: words(start, text) })) }))
  const ranges = [[[1000, 4200]], [[8000, 11200]], [[16000, 18400]]]
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({
    job_id: RUN, source_video_url: 'https://www.youtube.com/watch?v=abcdefghijk', source_video_title: TITLE, source_video_duration_seconds: 30,
    total_clips: 3, transcript_url: null, plan_url: null, processing_time_seconds: 12,
    clips: HEADLINES.map((headline, i) => ({ clip_index: i, s3_url: `file://${path.join(run, `clip_0${i}.mp4`)}`, duration_ms: 2000,
      start_time_ms: ranges[i][0][0], end_time_ms: ranges[i][0][1], virality_score: 0.9 - i / 10, layout_type: 'talking_head',
      summary: ['Not knowing carousels', 'Twenty carousels', 'The skipped slide'][i], headline, tags: ['carousels'], render_fallback: null })),
    metrics: { captions_status: 'disabled_by_request', requested_settings: { aspect_ratio: '9:16', layout_style: 'auto', pacing: 'tight', video_speed: 1, title_style: 'headline', include_title: true },
      clip_layouts: ranges.map((kept, i) => ({ clip_index: i, layout_type: 'talking_head', window_start_ms: kept[0][0],
        kept_source_ms: kept, shots: [{ start_ms: 0, end_ms: 4000, layout: 'talking_head', focus: [0.5, 0.4], people: [] }] })) }
  }))
  fs.writeFileSync(path.join(run, 'run-history.json'), JSON.stringify({ jobId: RUN, sourceLabel: TITLE, status: 'completed', errorMessage: null, startedAt: '2026-10-01T12:00:00.000Z', finishedAt: '2026-10-01T12:05:00.000Z' }))
  const untouched = fs.readFileSync(path.join(run, 'clip_02.mp4'))
  const before = [0, 1].map((i) => fs.readFileSync(path.join(run, `clip_0${i}.mp4`)))
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))

  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(15000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))

  await page.getByRole('button', { name: /^Library/ }).first().click()
  await page.getByRole('button', { name: `Open ${TITLE}`, exact: true }).click()
  // Every Create run can be edited; this one has no editor project yet.
  await page.getByRole('button', { name: 'Edit clips', exact: true }).waitFor()
  assert.equal(fs.existsSync(path.join(run, 'editor-project.json')), false)

  // Two clicks: the clip's ⋯ menu, then "Edit headline". The kept source means nothing to download.
  await page.getByRole('button', { name: 'Actions for “Not knowing carousels”', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit headline', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Clip editor' })
  await editor.waitFor({ timeout: 90000 })
  await page.getByText('These clips were made automatically.', { exact: false }).waitFor()
  const hook = page.getByRole('textbox', { name: 'Hook text', exact: true })
  assert.equal(await hook.inputValue(), HEADLINES[0])
  assert.equal(await page.locator('.editor-stagebar .editor-status').innerText(), 'Baked')
  const project = JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json'), 'utf8'))
  assert.deepEqual(project.candidates.map((c) => [c.library_clip, c.status, c.ranges]), [[0, 'baked', ranges[0]], [1, 'baked', ranges[1]], [2, 'baked', ranges[2]]])
  assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).editor_project, true)

  // Rewrite the first headline and bake: the clip is replaced in place.
  await hook.fill('The carousel test nobody runs')
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', null, { timeout: 120000 })
  // Remove the second clip's headline.
  await page.locator('.editor-candidate').filter({ hasText: 'Twenty carousels' }).click()
  assert.equal(await hook.inputValue(), HEADLINES[1])
  await page.getByRole('switch', { name: 'Hook text at the top' }).click()
  assert.equal(await hook.count(), 0)
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', null, { timeout: 120000 })

  await page.getByRole('button', { name: 'Exports', exact: true }).click()
  await page.getByRole('button', { name: 'Open editor', exact: true }).waitFor()
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
  assert.deepEqual(output.clips.map((c) => c.clip_index), [0, 1, 2])
  assert.equal(output.total_clips, 3)
  assert.deepEqual(output.clips.map((c) => c.headline), ['The carousel test nobody runs', null, HEADLINES[2]])
  assert.deepEqual(output.clips.map((c) => c.tags), [['carousels'], ['carousels'], ['carousels']])
  for (const i of [0, 1]) {
    const now = fs.readFileSync(path.join(run, `clip_0${i}.mp4`))
    assert.ok(now.length > 1000 && !now.equals(before[i]), `clip ${i} was replaced`)
  }
  assert.ok(fs.readFileSync(path.join(run, 'clip_02.mp4')).equals(untouched), 'the clip nobody edited is byte-identical')
  assert.deepEqual(fs.readdirSync(run).filter((name) => /^clip_\d+\.mp4$/.test(name)).sort(), ['clip_00.mp4', 'clip_01.mp4', 'clip_02.mp4'])
  // The Library still shows three clips, one card each.
  assert.equal(await page.getByRole('button', { name: /^Actions for “/ }).count(), 3)
  assert.deepEqual(errors, [])
})
