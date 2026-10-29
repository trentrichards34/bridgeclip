// "What changed" in the clip editor: an Automatic run's clip lists what the run did,
// Restore puts one piece back (saved like any edit), and Undo takes the Restore back.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

const look = { look: 'black', color: '#000000', font: 'serif' }

test('an Automatic clip shows what the run did; Restore puts back the pauses and Undo cuts them again', { timeout: 90000 }, async (t) => {
  const tools = editorTools(t)
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-edit-log-'))
  const userDataDir = path.join(root, 'user-data'), run = path.join(userDataDir, 'CreatorClips', 'log-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', ...tools.encoder, '-pix_fmt', 'yuv420p', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture)
  Object.assign(project, { width: 320, height: 180, automatic: { omitted: [], estimated_cuts: 0 } })
  const clip = project.candidates[0]
  // As the run made it: two pauses cut, the start moved past "Here is", a stat card, a split and the hook.
  Object.assign(clip, { ranges: [[1000, 2000], [3000, 5000], [7000, 10000]], hook: { text: 'The event explains the result', look },
    graphics: [{ id: 'g-auto1', template: 'stat', at_ms: 3200, duration_ms: 2500, placement: 'top', fields: { value: '$1,200/month', label: 'in revenue' }, origin: 'auto' }],
    auto: { moment: [0, 10000], ranges: [[1000, 2000], [3000, 5000], [7000, 10000]], before_words: 'Here is', hook: 'The event explains the result',
      captions: true, caption_preset: 'pop', split_at: [8000] } })
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'log-run', source_video_title: 'Editor log', clips: [], editor_project: true }))
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Editor log', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const settle = () => page.getByText('All changes saved', { exact: true }).waitFor()

  const log = page.getByTestId('edit-log')
  await log.waitFor()
  const texts = async () => (await log.locator('li').allInnerTexts()).map((s) => s.replace(/\s*Restore$/, '').trim())
  // Folded to one line until opened, so the inspector keeps its room.
  assert.equal(await log.locator('li').count(), 0)
  const toggle = log.getByRole('button', { name: /changes the app made/ })
  assert.match(await toggle.innerText(), /^6 changes the app made\s*Show$/)
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  await toggle.click()
  const lines = await texts()
  assert.deepEqual(lines, [
    'Started at 0:01 (left out 1 s before: “Here is”)',
    'Cut 2 pauses (3 s)',
    'Added 1 graphic: $1,200/month stat',
    'Split screen 0:03–0:04',
    'Captions: Pop',
    'Hook text: “The event explains the result”'])
  // It fits the inspector: nothing spills sideways.
  const overflow = await page.locator('.editor-inspector').evaluate((el) => el.scrollWidth - el.clientWidth)
  assert.ok(overflow <= 1, `the inspector spills ${overflow}px sideways`)
  const box = await log.boundingBox(), panel = await page.locator('.editor-inspector').boundingBox()
  assert.ok(box.width <= panel.width && box.x >= panel.x - 1 && box.x + box.width <= panel.x + panel.width + 1, `the log is ${box.width}px wide in a ${panel.width}px inspector`)
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'edit-log-editor.png') }) }

  // Restore the pauses: the cut becomes one stretch, saved like any edit, and the line goes away.
  await log.getByRole('button', { name: 'Restore: Cut 2 pauses (3 s)', exact: true }).click()
  await settle()
  assert.deepEqual(saved().candidates[0].ranges, [[1000, 10000]])
  assert.equal((await texts()).some((s) => s.startsWith('Cut 2 pauses')), false)
  assert.equal((await texts()).length, 5)
  // The run's record stays with the clip (main keeps it; edits never carry it).
  assert.deepEqual(saved().candidates[0].auto.ranges, [[1000, 2000], [3000, 5000], [7000, 10000]])
  if (shots) await page.screenshot({ path: path.join(shots, 'edit-log-restored.png') })

  // Undo cuts the pauses again and the line comes back.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await settle()
  assert.deepEqual(saved().candidates[0].ranges, [[1000, 2000], [3000, 5000], [7000, 10000]])
  await log.getByRole('button', { name: 'Restore: Cut 2 pauses (3 s)', exact: true }).waitFor()

  // Restoring the graphic removes only the one the app added; the log can be folded away.
  await log.getByRole('button', { name: /^Restore: Added 1 graphic/ }).click()
  await settle()
  assert.deepEqual(saved().candidates[0].graphics, [])
  await toggle.click()
  assert.equal(await log.locator('li').count(), 0)
  assert.deepEqual(errors, [])
})
