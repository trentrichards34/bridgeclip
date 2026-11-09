// The Call to action graphic in the clip editor, driven in the app: an automatic one (added because the speaker
// says "hit the link below") shows on the preview with the speaker's own words; the gallery's "Ending" group has
// it, and picking it at the playhead fills it with the call to action said there; it can be changed and removed.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

const SCRIPT = 'that is the whole system and it works. hit the link below to get the free guide. see you in the next one'

test('call to action: automatic one on the preview, the gallery’s Ending group, filled with the words said, removable', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-cta-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'cta-run')
  fs.mkdirSync(run, { recursive: true })
  const duration = 10000
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2a3340:size=540x960:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=10',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const words = SCRIPT.split(' ').map((word, i) => ({ word, start_ms: 400 + i * 360, end_ms: 400 + i * 360 + 300 }))
  const at = (word) => words.find((w) => w.word.replace(/[^a-z]/g, '') === word).start_ms
  const lines = []
  for (let i = 0; i < words.length; i += 10) { const part = words.slice(i, i + 10); lines.push({ start_ms: part[0].start_ms, end_ms: part.at(-1).end_ms, text: part.map((w) => w.word).join(' '), words: part }) }
  const project = structuredClone(fixture)
  Object.assign(project, { title: 'Call to action', width: 540, height: 960, duration_ms: duration, aspect_ratio: '9:16', transcript: lines.map(({ start_ms, end_ms, text }) => ({ start_ms, end_ms, text })) })
  // As the engine adds it (spoken_cta.edit_cta): on "hit", the speaker's words, over the head, origin auto.
  const auto = { id: 'g-cta0000001', template: 'link_cta', at_ms: at('hit') - 150, duration_ms: 3600, placement: 'top', size: 'card', origin: 'auto',
    fields: { text: 'Hit the link', kind: 'link', where: 'below', lead: 'Get the free guide' } }
  project.candidates = [{ ...project.candidates[0], title: 'The system', ranges: [[0, duration]], scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: false, video_speed: 1,
    hook: null, graphics: [auto] }]
  delete project.candidates[0].review
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: lines.map((l) => ({ start_time_ms: l.start_ms, end_time_ms: l.end_ms, text: l.text,
    words: l.words.map((w) => ({ word: w.word, start_time_ms: w.start_ms, end_time_ms: w.end_ms })) })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'cta-run', source_video_title: 'Call to action', source_video_duration_seconds: duration / 1000, clips: [], total_clips: 0, editor_project: true }))
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
  await page.getByRole('button', { name: 'Open Call to action', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Clip editor' })
  await editor.waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const graphics = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json'))).candidates[0].graphics ?? []
  const savedWhen = async (check, what) => {
    for (let i = 0; i < 80; i++) { try { if (check(graphics())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save ${what}: ${JSON.stringify(graphics())}`)
  }
  const seek = (ms) => page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(ms))

  // 1. The automatic call to action shows on the preview with the speaker's words, the button and the pointer.
  await seek(at('hit') + 1500)
  await page.waitForFunction(() => document.querySelector('.editor-graphics-overlay')?.textContent?.includes('Hit the link'))
  const overlay = page.locator('.editor-graphics-overlay')
  assert.equal(await overlay.locator('.mg-cta2-button').count(), 1)
  assert.equal(await overlay.locator('.mg-cta2-hand').count(), 1)
  assert.match(await overlay.textContent(), /Get the free guide/)
  assert.match(await overlay.textContent(), /below/)

  // 2. On the Graphics row with the speaker's words, and removed in the editor (it is a graphic like any other).
  const block = editor.locator('.editor-graphic-body', { hasText: 'Hit the link' })
  assert.match(await block.getAttribute('aria-label'), /^Call to action at /)
  await block.click()
  await editor.getByRole('button', { name: 'Remove', exact: true }).first().click()
  await savedWhen((list) => list.length === 0, 'the removal')

  // 3. The gallery's Ending group has it; picked at the playhead, it starts with the call to action said there.
  await seek(at('whole'))
  await editor.getByRole('button', { name: 'Add graphic', exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Add a graphic' })
  await gallery.waitFor()
  const ending = gallery.getByRole('group', { name: 'Ending' })
  assert.deepEqual((await ending.locator('.graphic-gallery-name').allTextContents()).sort(), ['Call to action', 'Comment prompt'])
  await gallery.getByRole('searchbox', { name: 'Search graphics' }).fill('call to action')
  await gallery.getByRole('button', { name: 'Add Call to action', exact: true }).click()
  await gallery.waitFor({ state: 'detached' })
  await savedWhen((list) => list.length === 1, 'the new call to action')
  const added = graphics()[0]
  assert.equal(added.template, 'link_cta')
  assert.equal(added.placement, 'top')
  assert.deepEqual(added.fields, { text: 'Hit the link', where: 'below', lead: 'Get the free guide' })
  // Its icon can be changed in the inspector (the words stay the speaker's).
  const icon = page.getByRole('combobox', { name: 'Icon on the button' })
  if (await icon.count()) {
    await icon.click()
    await page.getByRole('option', { name: 'Follow', exact: true }).click()
    await savedWhen((list) => list[0]?.fields.kind === 'follow', 'the icon')
  }
  assert.deepEqual(errors, [])
})
