// Clip editor: "Make a clip from these lines" and "Use this style on every clip", driven in the app.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

async function openEditor(t, name) {
  const tools = editorTools(t)
  if (!tools) return null
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bridgeclip-editor-${name}-`))
  const userDataDir = path.join(root, 'user-data'), run = path.join(userDataDir, 'CreatorClips', `${name}-run`)
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', ...tools.encoder, '-pix_fmt', 'yuv420p', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 320; project.height = 180
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: `${name}-run`, source_video_title: `Editor ${name}`, clips: [], editor_project: true }))
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(12000)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: `Open Editor ${name}`, exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const settle = () => page.getByText('All changes saved', { exact: true }).waitFor()
  return { page, saved, settle }
}

test('"Make a clip from these lines" adds a whole-line clip that saves and undoes normally', { timeout: 90000 }, async (t) => {
  const editor = await openEditor(t, 'lines')
  if (!editor) return
  const { page, saved, settle } = editor
  await page.getByRole('button', { name: 'Transcript', exact: true }).click()
  // Click the 0:03 line, then Shift-click the 0:06 line.
  await page.getByRole('button', { name: /^Select line at 0:03\.000$/ }).click()
  await page.getByRole('button', { name: /^Select line at 0:06\.000$/ }).click({ modifiers: ['Shift'] })
  const bar = page.getByRole('group', { name: 'Selected lines' })
  await bar.getByText(/^2 lines selected · 0:03\.000 – 0:08\.000 \(5\.0s\)$/).waitFor()
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'editor-transcript-lines.png') }) }
  await bar.getByRole('button', { name: 'Make a clip from these lines', exact: true }).click()
  await page.getByText(/^Made a new clip from 2 transcript lines\./).waitFor()
  const title = page.getByLabel('Title', { exact: true })
  assert.equal(await title.inputValue(), 'The event happened. That explains the result.')
  let project = saved()
  assert.equal(project.candidates.length, 3)
  const added = project.candidates[2]
  assert.match(added.id, /^clip-[a-f0-9]{12}$/)
  assert.deepEqual(added.ranges, [[3000, 8000]])
  assert.equal(added.hook.text, 'The event happened. That explains the result.')
  assert.deepEqual([added.status, added.score, added.review], ['refining', 0, null])
  assert.equal(await page.getByRole('group', { name: 'Selected lines' }).count(), 0)
  // Edits to the new clip save, and undo works across the add.
  await title.fill('Why the event matters')
  await settle()
  assert.equal(saved().candidates[2].title, 'Why the event matters')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await settle()
  project = saved()
  assert.equal(project.candidates.length, 3)
  assert.equal(project.candidates[2].title, 'The event happened. That explains the result.')
  assert.equal(await page.getByRole('alert').count(), 0)
  // A variant of the new clip.
  await page.getByRole('button', { name: 'Duplicate as variant', exact: true }).click()
  await page.getByText(/^Made a copy of this clip\./).waitFor()
  if (shots) { await page.getByRole('button', { name: 'Hook & CTA', exact: true }).click(); await page.screenshot({ path: path.join(shots, 'editor-hook-tab.png') }) }
  assert.equal(await title.inputValue(), 'The event happened. That explains the result. (variant B)')
  assert.deepEqual(saved().candidates[3].ranges, [[3000, 8000]])
})

test('"Use this style on every clip" asks with the count, copies the style in one undo step', { timeout: 90000 }, async (t) => {
  const editor = await openEditor(t, 'style')
  if (!editor) return
  const { page, saved, settle } = editor
  await page.getByRole('button', { name: 'Captions', exact: true }).click()
  await page.getByRole('switch', { name: 'Burn in captions' }).click()
  await page.getByLabel('Export speed').selectOption('1.5')
  await settle()
  await page.getByRole('button', { name: 'Use this style on every clip', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByText(/to 1 other clip\?/).waitFor()
  await dialog.getByRole('button', { name: 'Update 1 clip', exact: true }).click()
  await settle()
  let other = saved().candidates[1]
  assert.deepEqual([other.captions, other.video_speed, other.title], [false, 1.5, 'Why the ending matters'])
  // Applying again has nothing to change.
  await page.getByRole('button', { name: 'Use this style on every clip', exact: true }).click()
  await page.getByText('Every other clip already uses this style.', { exact: true }).waitFor()
  // One undo restores every other clip.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await settle()
  other = saved().candidates[1]
  assert.deepEqual([other.captions, other.video_speed], [true, 1.25])
  assert.equal(saved().candidates[0].video_speed, 1.5)
})
