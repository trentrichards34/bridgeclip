// Make my cover, end to end in the app: Library -> a reel's Actions -> Make my cover -> three covers from the speaker's
// best frames (the engine finds them) with the reel's hook -> pick one, edit the words, save PNG then JPG next to the
// video -> posting finds it as the cover. COVER_VIDEO (a 9:16 or 16:9 video) and COVER_OUT (a folder for the saved
// covers) let a reviewer run it on real footage.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp, ROOT } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

function pngSize(file) {
  const b = fs.readFileSync(file)
  assert.ok(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'a PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

test('Make my cover: three covers from the best frames, the hook in the look, saved next to the video and used when posting', { timeout: 600000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-covers-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'edit-44444444-4444-4444-8444-444444444444')
  fs.mkdirSync(run, { recursive: true })
  const video = path.join(run, 'clip_00.mp4')
  const own = process.env.COVER_VIDEO
  if (own) fs.copyFileSync(own, video)
  else {
    // A real person (the portrait fixture), soft for a second at each end.
    execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-r', '30', '-i', path.join(ROOT, 'engine/tests/fixtures/portrait_person.jpg'), '-t', '6',
      '-vf', "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,gblur=sigma=5:enable='lt(t,1)+gte(t,5)',format=yuv420p", ...tools.encoder, video])
  }
  const hook = process.env.COVER_HOOK || 'You do not have to be an influencer'
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: path.basename(run), source_video_title: 'Edited · Cover test', source_video_url: '',
    total_clips: 1, clips: [{ clip_index: 0, summary: 'Cover test', headline: hook, s3_url: `file://${video}`, start_time_ms: 0, end_time_ms: 6000, duration_ms: 6000,
      virality_score: 0, editor_candidate: 'edit-reel' }] }))
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify({ candidates: [{ id: 'edit-reel', hook: { text: hook, look: { look: 'floating', color: process.env.COVER_COLOR || '#7C3AED', font: 'clean' } } }],
    transcript: [{ start_ms: 0, end_ms: 3000, text: process.env.COVER_SAID || 'You do not have to be an influencer to make money online.' }] }))
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python }))
  const appDir = buildApp(path.join(root, 'app'))
  if (!fs.existsSync(path.join(appDir, 'engine'))) linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(30000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1000))

  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Open Edited · Cover test', exact: true }).click()
  await page.getByRole('button', { name: 'Actions for “Cover test”', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Make my cover' }).click()
  const dialog = page.getByRole('dialog', { name: 'Make my cover' })
  await dialog.getByRole('radiogroup', { name: 'Covers' }).waitFor({ timeout: 240000 })
  const covers = dialog.getByRole('radiogroup', { name: 'Covers' }).getByRole('radio')
  assert.equal(await covers.count(), 3)
  const youtube = await dialog.getByText('Words on the thumbnail').count() > 0
  // The words come from the video: the hook on a Reel, 3 to 5 of its words for YouTube.
  const words = dialog.getByRole('textbox', { name: 'Cover words' })
  const offered = await words.inputValue()
  if (youtube) assert.ok(hook.includes(offered) && offered.split(' ').length <= 5, offered)
  else assert.equal(offered, hook)
  // Every cover is drawn (not blank).
  await page.waitForTimeout(600)
  const drawn = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="cover-canvas-"]')].map((c) => {
    const ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data
    let lit = 0
    for (let i = 0; i < d.length; i += 4 * 997) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++
    return { w: c.width, h: c.height, lit }
  }))
  for (const c of drawn) {
    assert.deepEqual([c.w, c.h], youtube ? [1280, 720] : [1080, 1920])
    assert.ok(c.lit > 50, 'drawn')
  }
  if (process.env.COVER_OUT) {
    fs.mkdirSync(process.env.COVER_OUT, { recursive: true })
    await page.screenshot({ path: path.join(process.env.COVER_OUT, `dialog-${youtube ? 'youtube' : 'reel'}.png`) })
    // Each of the three as the member would save it.
    for (let i = 0; i < 3; i++) {
      const data = await page.evaluate((k) => document.querySelector(`[data-testid="cover-canvas-${k}"]`).toDataURL('image/png').split(',')[1], i)
      fs.writeFileSync(path.join(process.env.COVER_OUT, `${youtube ? 'youtube' : 'reel'}-${i + 1}.png`), Buffer.from(data, 'base64'))
    }
  }

  // Pick the second, change the words, save as PNG.
  await covers.nth(1).click()
  assert.equal(await covers.nth(1).getAttribute('aria-checked'), 'true')
  if (!own) await words.fill('Not an influencer')
  await dialog.getByRole('radio', { name: 'PNG' }).click()
  await dialog.getByTestId('cover-save').click()
  await dialog.getByText('Cover saved').waitFor()
  const pngPath = path.join(run, 'clip_00.cover.png')
  assert.deepEqual(pngSize(pngPath), youtube ? [1280, 720] : [1080, 1920])
  // Saved again as JPG: one cover per video.
  await dialog.getByRole('radio', { name: 'JPG' }).click()
  await dialog.getByTestId('cover-save').click()
  await dialog.getByText('clip_00.cover.jpg', { exact: false }).waitFor()
  assert.ok(!fs.existsSync(pngPath))
  const jpg = fs.readFileSync(path.join(run, 'clip_00.cover.jpg'))
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8)
  await dialog.getByRole('button', { name: 'Done' }).click()
  await dialog.waitFor({ state: 'detached' })

  // Posting finds it: the post flow's cover starts as this image.
  const saved = await page.evaluate((v) => window.bridgeclip.covers.saved(v), video)
  assert.equal(saved.path, fs.realpathSync(path.join(run, 'clip_00.cover.jpg')))
  // A path outside the Library is refused in main.
  await assert.rejects(page.evaluate(() => window.bridgeclip.covers.suggest('/etc/passwd.mp4')), /Library/)
  // The engine's frames stay with the run (hidden folder), never on the page as paths.
  assert.ok(fs.readdirSync(path.join(run, '.covers')).every((n) => /^frame-\d+\.jpg$/.test(n)))
  assert.deepEqual(errors, [])
})
