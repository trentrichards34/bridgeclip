const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const MB = 1_000_000

function makeRun(library, name, title, { extra = {}, startedAt = '2026-09-20T12:00:00.000Z' } = {}) {
  const dir = path.join(library, name)
  fs.mkdirSync(dir, { recursive: true })
  const clip = path.join(dir, 'clip_00.mp4')
  fs.writeFileSync(clip, Buffer.alloc(MB))
  fs.writeFileSync(path.join(dir, 'run-history.json'), JSON.stringify({ jobId: name, sourceLabel: title, status: 'completed', errorMessage: null, startedAt, finishedAt: startedAt }))
  fs.writeFileSync(path.join(dir, 'job_output.json'), JSON.stringify({ job_id: name, source_video_title: title, source_video_url: 'local.mp4', source_video_duration_seconds: 1,
    total_clips: 1, clips: [{ clip_index: 0, summary: title, s3_url: `file://${clip}`, duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, virality_score: 90, ...extra }] }))
  return dir
}

test('Free up space lists removable files by group, removes only the chosen ones, and earlier output folders stay reachable and movable', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-free-space-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  const small = makeRun(library, '11111111-1111-4111-8111-111111111111', 'Small run', { startedAt: '2026-09-21T12:00:00.000Z', extra: { cta: { id: 'a'.repeat(32), name: 'Follow me' } } })
  fs.writeFileSync(path.join(small, 'clip_00.original.mp4'), Buffer.alloc(3 * MB))
  fs.writeFileSync(path.join(small, 'framing-source.mp4'), Buffer.alloc(2 * MB))
  // The source an Automatic run keeps for the editor (no editor project yet).
  fs.writeFileSync(path.join(small, 'editor-source.mp4'), Buffer.alloc(MB))
  const remix = makeRun(library, 'remix-22222222-2222-4222-8222-222222222222', 'Big remix', { extra: { editable: { split: true } } })
  fs.mkdirSync(path.join(remix, '.edit', 'clip_00'), { recursive: true })
  fs.writeFileSync(path.join(remix, '.edit', 'clip_00', 'edit.json'), '{}')
  fs.writeFileSync(path.join(remix, '.edit', 'clip_00', 'moment.mp4'), Buffer.alloc(12 * MB))
  // Left by a call-to-action change that was interrupted.
  fs.writeFileSync(path.join(small, '.cta-abcdef12.mp4'), Buffer.alloc(4 * MB))
  // Remix runs have no run record: their date is the result file's time. Make it older than the small run.
  fs.utimesSync(path.join(remix, 'job_output.json'), new Date('2026-09-10T12:00:00Z'), new Date('2026-09-10T12:00:00Z'))
  // An earlier output folder the Library still shows.
  const earlier = path.join(root, 'Old clips')
  const old = makeRun(earlier, '33333333-3333-4333-8333-333333333333', 'From the old folder')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'library-folders.json'), JSON.stringify({ version: 1, previous: [earlier], moved: [] }))

  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { page, app } = session
  page.setDefaultTimeout(15000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1020))

  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Open Small run', exact: true }).waitFor()
  // Each run shows its size, and "Largest first" puts the big remix first.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="run-size"]').length === 2)
  const order = () => page.locator('.library-run-slot article > button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  assert.deepEqual(await order(), ['Open Small run', 'Open Big remix'])
  await page.getByRole('radio', { name: 'Largest first' }).click()
  assert.deepEqual(await order(), ['Open Big remix', 'Open Small run'])
  const bigSize = await page.locator('article', { has: page.getByRole('button', { name: 'Open Big remix' }) }).getByTestId('run-size').textContent()
  assert.equal(bigSize, '13 MB')

  // Earlier output folder: listed, and its run opens.
  const earlierSection = page.getByTestId('previous-folders')
  await earlierSection.getByRole('button', { name: 'Open From the old folder' }).waitFor()

  // Free up space.
  await page.getByRole('button', { name: 'Free up space' }).first().click()
  const dialog = page.getByTestId('free-up-space')
  await dialog.getByText('Source copies and editor previews').waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="group-size-remixParts"]')?.textContent?.includes('MB'))
  assert.equal(await dialog.getByTestId('group-size-intermediates').textContent(), '2 MB')
  assert.equal(await dialog.getByTestId('group-size-leftovers').textContent(), '4 MB')
  assert.equal(await dialog.getByTestId('group-size-ctaOriginals').textContent(), '3 MB')
  assert.equal(await dialog.getByTestId('group-size-editorMedia').textContent(), '1 MB')
  // Remix parts and CTA originals are opt-in and carry their warning.
  assert.equal(await dialog.getByRole('checkbox', { name: 'Remix and b-roll video parts' }).getAttribute('aria-checked'), 'false')
  assert.equal(await dialog.getByRole('checkbox', { name: 'Clip copies without the call to action' }).getAttribute('aria-checked'), 'false')
  await dialog.getByText('You can no longer use “Edit hook text & captions” on these videos.').waitFor()
  assert.equal(await dialog.getByTestId('free-total').textContent(), '7 MB selected')
  await dialog.getByRole('checkbox', { name: 'Remix and b-roll video parts' }).click()
  assert.equal(await dialog.getByTestId('free-total').textContent(), '19 MB selected')
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    fs.mkdirSync(process.env.BRIDGECLIP_E2E_SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'free-up-space.png') })
  }
  await dialog.getByRole('button', { name: 'Free up 19 MB' }).click()
  await dialog.getByText('Remove 19 MB from your Library? This cannot be undone.').waitFor()
  await dialog.getByText(/Remix and b-roll video parts: You can no longer use/).waitFor()
  await dialog.getByRole('button', { name: 'Remove 19 MB' }).click()
  await dialog.getByText(/^Freed 19 MB/).waitFor()
  await dialog.getByRole('button', { name: 'Done' }).click()

  assert.ok(!fs.existsSync(path.join(small, 'framing-source.mp4')))
  assert.ok(!fs.existsSync(path.join(small, 'editor-source.mp4')))
  assert.ok(!fs.existsSync(path.join(small, '.cta-abcdef12.mp4')))
  assert.ok(!fs.existsSync(path.join(remix, '.edit', 'clip_00')))
  for (const kept of [path.join(small, 'clip_00.mp4'), path.join(small, 'clip_00.original.mp4'), path.join(small, 'job_output.json'), path.join(remix, 'clip_00.mp4')]) assert.ok(fs.existsSync(kept), kept)
  assert.equal('editable' in JSON.parse(fs.readFileSync(path.join(remix, 'job_output.json'), 'utf8')).clips[0], false)
  // Sizes refresh after freeing space.
  await page.waitForFunction(() => Array.from(document.querySelectorAll('article')).find((node) => node.querySelector('[aria-label="Open Big remix"]'))?.querySelector('[data-testid="run-size"]')?.textContent === '1 MB')

  // Move the earlier folder's run into the current folder.
  await earlierSection.getByRole('button', { name: 'Move to current folder' }).click()
  await page.getByRole('button', { name: 'Open From the old folder', exact: true }).and(page.locator('.library-run-slot button')).waitFor()
  assert.ok(!fs.existsSync(old))
  const moved = path.join(library, path.basename(old))
  assert.equal(JSON.parse(fs.readFileSync(path.join(moved, 'job_output.json'), 'utf8')).clips[0].s3_url, `file://${path.join(moved, 'clip_00.mp4')}`)
  assert.equal(await page.getByTestId('previous-folders').count(), 0)
  assert.deepEqual(errors, [])
})
