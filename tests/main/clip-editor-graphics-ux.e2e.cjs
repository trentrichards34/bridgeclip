// Adding and editing graphics the easy way, driven in the app: "Add graphic" on the editor toolbar opens the
// gallery, a pick goes in at the playhead already filled with the words said there, its words are changed right on
// the Output preview, it is dragged to another place on the preview, the G key and the preview's toolbar work, a
// quick style restyles every graphic, and the bake draws them into the clip.
//
// GRAPHICS_UX_FIXTURE=<dir with source.mp4 (9:16) and words.json ([word, start s, end s])> runs it on a real clip;
// GRAPHICS_UX_OUT=<dir> keeps screenshots and baked frames.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')
const { loadMain } = require('../zernio/support/load-main.cjs')
const { GRAPHIC_TEMPLATES } = loadMain("export { GRAPHIC_TEMPLATES } from './src/shared/motion-graphics'")

const SCRIPT = 'so we only need three things a product an offer and a way to attract eyeballs that is the whole plan'
const key = (w) => w.toLowerCase().replace(/[^a-z0-9']+/g, '')

test('graphics: gallery at the playhead with the words said there, edited and moved on the preview, then baked', { timeout: 420000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const real = process.env.GRAPHICS_UX_FIXTURE
  const out = process.env.GRAPHICS_UX_OUT
  if (out) fs.mkdirSync(out, { recursive: true })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-graphics-ux-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'graphics-ux-run')
  fs.mkdirSync(run, { recursive: true })
  let words, duration
  if (real) {
    fs.copyFileSync(path.join(real, 'source.mp4'), path.join(run, 'editor-source.mp4'))
    words = JSON.parse(fs.readFileSync(path.join(real, 'words.json'), 'utf8')).map(([word, a, b]) => ({ word, start_ms: Math.round(a * 1000), end_ms: Math.round(b * 1000) }))
    duration = Math.floor(Number(execFileSync(tools.ffmpeg.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(run, 'editor-source.mp4')]).toString()) * 1000)
    words = words.filter((w) => w.start_ms < duration - 200).map((w) => ({ ...w, end_ms: Math.min(w.end_ms, duration - 1) }))
  } else {
    duration = 12000
    execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2a3340:size=540x960:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12',
      ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
    words = SCRIPT.split(' ').map((word, i) => ({ word, start_ms: 800 + i * 320, end_ms: 800 + i * 320 + 260 }))
  }
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  // Transcript lines of up to 12 words.
  const lines = []
  for (let i = 0; i < words.length; i += 12) { const part = words.slice(i, i + 12); lines.push({ start_ms: part[0].start_ms, end_ms: part.at(-1).end_ms, text: part.map((w) => w.word).join(' '), words: part }) }
  const project = structuredClone(fixture)
  Object.assign(project, { title: 'Graphics made easy', width: 540, height: 960, duration_ms: duration, aspect_ratio: '9:16', transcript: lines.map(({ start_ms, end_ms, text }) => ({ start_ms, end_ms, text })) })
  const ranges = real ? [[0, 4300], [13000, 18000], [22200, 31000], [35100, 47500]] : [[0, 11000]]
  const hook = real ? 'Do not have to be an influencer' : 'Only three things to build it'
  project.candidates = [{ ...project.candidates[0], title: 'The three things', ranges, scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: false, video_speed: 1,
    hook: { text: hook, look: { look: 'brand', color: '#2F5BFF', font: 'clean' } } }]
  delete project.candidates[0].review
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: lines.map((l) => ({ start_time_ms: l.start_ms, end_time_ms: l.end_ms, text: l.text,
    words: l.words.map((w) => ({ word: w.word, start_time_ms: w.start_ms, end_time_ms: w.end_ms })) })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'graphics-ux-run', source_video_title: 'Graphics made easy', source_video_duration_seconds: duration / 1000, clips: [], total_clips: 0, editor_project: true }))
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Graphics made easy', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const graphics = () => saved().candidates[0].graphics ?? []
  const savedWhen = async (check, what) => {
    for (let i = 0; i < 80; i++) { try { if (check(graphics())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save ${what}: ${JSON.stringify(graphics())}`)
  }
  const shot = async (name) => { if (out) { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(out, `${name}.png`) }) } }
  const seek = (ms) => page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(ms))
  const at = (word, from = 0) => words.find((w) => key(w.word) === word && w.start_ms >= from).start_ms
  const said = new Set(words.map((w) => key(w.word)))
  /** Every word of a graphic's text is a word said in the clip. */
  const onlySaid = (text) => text.split(/\s+/).filter(Boolean).every((w) => said.has(key(w)) || /^\d[\d,.%]*$/.test(w))
  const editor = page.getByRole('region', { name: 'Clip editor' })
  const output = page.locator('.editor-output-monitor canvas')

  // 1. "Add graphic" on the toolbar → the gallery (grouped, live tiles, search) → a staircase at the playhead,
  //    already filled with the words said there.
  const stepsAt = real ? at('product', 35000) - 600 : at('only')
  await seek(stepsAt)
  await editor.getByRole('button', { name: 'Add graphic', exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Add a graphic' })
  await gallery.waitFor()
  await gallery.getByRole('region', { name: 'Choose a graphic' }).waitFor()
  // Every template but the Effect one (the effects follow in their own groups), counted from the shared list.
  const templateCount = GRAPHIC_TEMPLATES.filter((t) => t.id !== 'fx').length
  assert.equal(await gallery.locator('.editor-graphic-tile:not([aria-label^="Add effect"])').count(), templateCount)
  await page.waitForFunction((n) => document.querySelectorAll('.graphic-gallery .mg-root').length === n, templateCount)
  assert.ok(await gallery.getByText('Your words').count() > 3, 'tiles show the words said at the playhead')
  await shot('01-gallery')
  await gallery.getByRole('searchbox', { name: 'Search graphics' }).fill('stair')
  assert.equal(await gallery.locator('.editor-graphic-tile').count(), 1)
  await gallery.getByRole('button', { name: 'Add Staircase', exact: true }).click()
  await gallery.waitFor({ state: 'detached' })
  await savedWhen((list) => list.length === 1, 'the staircase')
  let stairs = graphics()[0]
  assert.equal(stairs.template, 'staircase')
  assert.ok(stairs.at_ms <= stepsAt + 300 && stairs.at_ms >= stepsAt - 4200, `the staircase starts at the playhead (or on its first item just before): ${stairs.at_ms} vs ${stepsAt}`)
  assert.ok(stairs.fields.items && onlySaid(stairs.fields.items), `its items are words said there: ${stairs.fields.items}`)
  // Selected and shown on the preview right away, with its toolbar.
  const frame = page.locator('.editor-graphic-frame')
  await frame.waitFor()
  await page.getByRole('toolbar', { name: 'Graphic tools' }).waitFor()
  await page.locator('.editor-graphics-overlay .mg-root').first().waitFor()
  await shot('02-staircase-inserted')

  // 2. Its words, changed right on the preview: click the graphic, type, Done.
  await frame.click()
  const items = page.getByRole('textbox', { name: 'Steps, bottom to top (one per line, 3 to 6) on the video', exact: true })
  await items.waitFor()
  await items.fill('A product\nAn offer\nAttract eyeballs')
  await savedWhen((list) => list[0]?.fields.items === 'A product\nAn offer\nAttract eyeballs', 'the new steps')
  await page.waitForFunction(() => document.querySelector('.editor-graphics-overlay')?.textContent?.includes('Attract eyeballs'))
  await shot('03-words-on-preview')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  // "Match to my voice" on the toolbar: each step lights up as it is said.
  await page.getByRole('button', { name: 'Match to my voice', exact: true }).click()
  await savedWhen((list) => !!list[0]?.fields.item_ms, 'the step times')

  // 3. G opens the gallery at the playhead: a stat on the number said there.
  const statAt = real ? at('last', 22000) : at('three')
  await seek(statAt)
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur())
  await page.keyboard.press('g')
  await gallery.waitFor()
  await gallery.getByRole('button', { name: 'Add Stat counter', exact: true }).click()
  await savedWhen((list) => list.some((g) => g.template === 'stat'), 'the stat')
  let stat = graphics().find((g) => g.template === 'stat')
  assert.equal(stat.fields.value, '3')
  assert.ok(onlySaid(stat.fields.label ?? ''), `the stat's label is said: ${stat.fields.label}`)
  assert.equal(stat.placement, 'top')
  // Its label, edited on the preview.
  await frame.click()
  const label = page.getByRole('textbox', { name: 'Label on the video', exact: true })
  await label.fill(real ? 'years' : 'things')
  await savedWhen((list) => list.find((g) => g.template === 'stat')?.fields.label === (real ? 'years' : 'things'), 'the stat label')
  await label.press('Escape')

  // 4. Drag it on the preview from the top to the bottom.
  const box = await frame.boundingBox(), canvasBox = await output.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 3 })
  await page.locator('.editor-graphic-slot').first().waitFor()
  await shot('04-drag-slots')
  await page.mouse.move(box.x + box.width / 2, canvasBox.y + canvasBox.height * .8, { steps: 8 })
  await page.mouse.up()
  await savedWhen((list) => list.find((g) => g.template === 'stat')?.placement === 'bottom', 'the stat at the bottom')
  await shot('05-stat-moved')

  // 5. The preview toolbar: duplicate, then delete the copy (Undo-able like any edit).
  const tools2 = page.getByRole('toolbar', { name: 'Graphic tools' })
  await tools2.getByRole('button', { name: 'Duplicate graphic', exact: true }).click()
  await savedWhen((list) => list.filter((g) => g.template === 'stat').length === 2, 'the copy')
  await tools2.getByRole('button', { name: 'Delete graphic', exact: true }).click()
  await savedWhen((list) => list.filter((g) => g.template === 'stat').length === 1, 'the copy removed')

  // 6. "+ Graphic" over the preview: a chapter header (or a title) at this moment.
  const chapterAt = real ? at('break', 26000) - 300 : at('that')
  await seek(chapterAt)
  await editor.getByRole('button', { name: 'Add a graphic at this moment', exact: true }).click()
  // (A title is added in one of its looks, from the small look buttons under its tile.)
  await gallery.getByRole('button', { name: real ? 'Add Chapter header' : 'Add Title slam: Color pills', exact: true }).click()
  await savedWhen((list) => list.length === 3, 'the third graphic')
  const third = graphics().find((g) => g.template === (real ? 'chapter' : 'title'))
  if (!real) {
    assert.equal(third.fields.variant, 'pill')
    // Its look can be changed in the inspector.
    await page.getByRole('radiogroup', { name: 'Graphic look' }).getByRole('radio', { name: 'Big type' }).click()
    await savedWhen((list) => list.find((g) => g.template === 'title')?.fields.variant === 'shadow', 'the title look')
  }
  assert.ok(onlySaid(`${third.fields.title ?? ''} ${third.fields.text ?? ''}`), `its words are said: ${JSON.stringify(third.fields)}`)
  if (real) {
    // Big words at the start (behind me) from the G key, and a chapter at each step said ("number three").
    await seek(300)
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur())
    await page.keyboard.press('g')
    await gallery.getByRole('button', { name: 'Add Big words (behind you)', exact: true }).click()
    await savedWhen((list) => list.some((g) => g.template === 'big_words'), 'big words')
    await page.getByRole('button', { name: 'Add a chapter at each step', exact: true }).click()
    await savedWhen((list) => list.filter((g) => g.template === 'chapter').length === 2, 'a chapter at each step')
  }

  // 7. A quick style restyles every graphic at once.
  await page.getByRole('group', { name: 'Quick styles' }).getByRole('button', { name: 'Bold', exact: true }).click()
  await savedWhen((list) => list.every((g) => g.fields.font === 'condensed'), 'the Bold style')
  if (out) { await seek(stairs.at_ms + 2600); await shot('07-style-bold') }
  await page.getByRole('group', { name: 'Quick styles' }).getByRole('button', { name: 'Minimal', exact: true }).click()
  await savedWhen((list) => list.every((g) => g.fields.font === 'clean'), 'the Minimal style')
  if (out) await shot('08-style-minimal')
  await page.getByRole('group', { name: 'Quick styles' }).getByRole('button', { name: 'Signature', exact: true }).click()
  await savedWhen((list) => list.every((g) => !g.fields.font), 'the Signature style')
  await seek(stairs.at_ms + 2600)
  await shot('06-staircase-later')
  await page.getByText('All changes saved', { exact: true }).waitFor()

  // 8. Bake: the graphics are drawn into the clip.
  stairs = graphics().find((g) => g.template === 'staircase'); stat = graphics().find((g) => g.template === 'stat')
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 330000 })
  const job = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json')))
  const video = job.clips[0].s3_url
  const renders = fs.readdirSync(path.join(run, '.graphics')).filter((n) => n.endsWith('.mov'))
  assert.ok(renders.length >= 3, `graphics were drawn: ${renders.length}`)
  // Output time of a source moment through the cut.
  const outAt = (src) => { let before = 0; for (const [a, b] of ranges) { if (src >= a && src < b) return (before + src - a) / 1000; before += b - a } return null }
  const frameAt = (seconds, name) => {
    const file = path.join(out ?? root, `${name}.png`)
    execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-y', file])
    return file
  }
  const stairsOut = outAt(stairs.at_ms + 3000), statOut = outAt(stat.at_ms + 1500)
  assert.ok(stairsOut !== null && statOut !== null)
  frameAt(stairsOut, 'baked-staircase'); frameAt(statOut, 'baked-stat')
  // The stat card sits low in the frame (it was dragged to the bottom): light pixels in the lower half while it plays.
  const raw = execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', String(statOut), '-i', video, '-frames:v', '1', '-vf', 'crop=1080:700:0:1000,scale=108:70', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  const light = [...raw].filter((v) => v > 225).length / raw.length
  assert.ok(light > .04, `the baked stat card shows in the lower half: ${light}`)
  assert.deepEqual(errors, [])
})
