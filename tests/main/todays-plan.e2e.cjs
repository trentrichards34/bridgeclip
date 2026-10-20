const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

/** A finished Library run, dated `daysAgo` (the Library dates runs without a run record by job_output.json). */
function writeRun(library, folder, { daysAgo, metrics = {}, source = '', title = 'A video' }) {
  const dir = path.join(library, folder)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'clip_00.mp4'), 'not a real video')
  const file = path.join(dir, 'job_output.json')
  fs.writeFileSync(file, JSON.stringify({
    job_id: folder, source_video_url: source, source_video_title: title, source_video_channel: null, source_video_duration_seconds: 600, total_clips: 1,
    clips: [{ clip_index: 0, s3_url: `file://${path.join(dir, 'clip_00.mp4')}`, duration_ms: 20000, start_time_ms: 0, end_time_ms: 20000, virality_score: 0, layout_type: '', summary: title, headline: null, tags: [], render_fallback: null }],
    transcript_url: null, plan_url: null, processing_time_seconds: 0, metrics, created_at: new Date().toISOString()
  }))
  const when = new Date()
  when.setDate(when.getDate() - daysAgo)
  when.setHours(Math.min(when.getHours(), 12), 0, 0, 0)
  fs.utimesSync(file, when, when)
}

test("Today's 3 on Create proposes three videos, ticks off today's runs, counts the streak and opens Remix with the pasted link", { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-todays-plan-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  // Today: clips from a long video, and an edited recording. Yesterday: a remix. Two days ago: more clips.
  writeRun(library, randomUUID(), { daysAgo: 0, source: 'https://www.youtube.com/watch?v=longvideo1', title: 'My long podcast episode' })
  writeRun(library, `edit-${randomUUID()}`, { daysAgo: 0, metrics: { edit_recording: true } })
  writeRun(library, `remix-${randomUUID()}`, { daysAgo: 1, metrics: { remix: true, remix_kinds: ['camera'] } })
  writeRun(library, randomUUID(), { daysAgo: 2, source: 'https://www.youtube.com/watch?v=older' })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, openrouterApiKey: '', zernioApiKey: '' }))

  const appDir = buildApp(path.join(root, 'app'))
  const session = await launchApp({ appDir, userDataDir })
  t.after(async () => {
    const timer = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(timer); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // The guided setup may open on a first launch: skip it.
  const skip = page.getByRole('button', { name: /Skip/ }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()

  const card = page.getByTestId('todays-plan')
  await card.waitFor()
  const items = card.getByRole('list', { name: 'Today’s videos' }).getByRole('listitem')
  assert.deepEqual(await items.evaluateAll((nodes) => nodes.map((node) => [node.dataset.kind, node.dataset.done])), [['clip', 'true'], ['reaction', 'false'], ['talking', 'true']])
  assert.equal(await card.getByTestId('todays-plan-count').textContent(), '2 of 3 done')
  assert.equal(await card.getByTestId('todays-plan-streak').textContent(), '3 days in a row')
  await card.getByText('From “My long podcast episode”', { exact: false }).waitFor()
  if (process.env.TODAYS_PLAN_SHOT) {
    // Shown and unthrottled so the window paints under xvfb, then Electron's own capture.
    await session.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setBackgroundThrottling(false); w.show(); w.setSize(1280, 900) })
    await page.waitForTimeout(600)
    await card.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
    const box = await card.boundingBox()
    const rect = { x: Math.max(0, Math.floor(box.x - 12)), y: Math.max(0, Math.floor(box.y - 12)), width: Math.ceil(box.width + 24), height: Math.ceil(box.height + 24) }
    const png = await session.app.evaluate(async ({ BrowserWindow }, area) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(area)).toPNG().toString('base64'), rect)
    fs.writeFileSync(process.env.TODAYS_PLAN_SHOT, Buffer.from(png, 'base64'))
  }

  // The reaction: paste a link, Start opens Remix on Pause & react with it.
  await card.getByRole('textbox', { name: 'Link to react to' }).fill('https://www.youtube.com/watch?v=viral123')
  await card.getByRole('listitem').filter({ hasText: 'A reaction to something trending' }).getByRole('button', { name: 'Start' }).click()
  const links = page.getByRole('textbox', { name: 'Video links' })
  await links.waitFor()
  assert.equal(await links.inputValue(), 'https://www.youtube.com/watch?v=viral123')
  assert.equal(await page.getByRole('radio', { name: /Pause & react/ }).first().getAttribute('aria-checked'), 'true')

  // Back on Create, the link is kept for today; folding the card is remembered.
  await page.getByRole('button', { name: 'Create', exact: true }).first().click()
  await card.waitFor()
  assert.equal(await card.getByRole('textbox', { name: 'Link to react to' }).inputValue(), 'https://www.youtube.com/watch?v=viral123')
  await card.getByRole('button', { name: /Today’s 3/ }).click()
  await card.getByRole('list', { name: 'Today’s videos' }).waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
})
