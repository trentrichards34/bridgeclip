const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const grade = (letter, score) => ({ grade: letter, score, scores: {}, hook_elements: {}, story_beats: {}, hard_fails: [], verdict: '', fix: '', suggested_title: '' })

function writeRun(library, name, { title, date, clips }) {
  const dir = path.join(library, name)
  fs.mkdirSync(dir, { recursive: true })
  const list = clips.map((clip, index) => {
    const file = path.join(dir, `clip_${index}.mp4`)
    fs.writeFileSync(file, `${name}-${index}`)
    return { clip_index: index, s3_url: `file://${file}`, duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, virality_score: 0.5, ...clip }
  })
  fs.writeFileSync(path.join(dir, 'job_output.json'), JSON.stringify({ job_id: name, source_video_title: title, source_video_url: 'local.mp4', source_video_duration_seconds: 1,
    total_clips: list.length, clips: list, created_at: date }))
  if (/^[0-9a-f]{8}-/.test(name)) fs.writeFileSync(path.join(dir, 'run-history.json'), JSON.stringify({ jobId: name, sourceLabel: title, status: 'completed', errorMessage: null, startedAt: date, finishedAt: date }))
  return dir
}

async function launch(t, prefix, setup = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const fixture = setup(library) ?? {}
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  page.setDefaultTimeout(10000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1000))
  return { app, page, errors, library, userDataDir, ...fixture }
}

test('Ready to post lists unposted clips from every run, filters them, marks them posted and posts several', { timeout: 120000 }, async (t) => {
  const { page, errors, podcast } = await launch(t, 'bridgeclip-ready-e2e-', (library) => {
    const podcast = writeRun(library, '11111111-1111-4111-8111-111111111111', { title: 'Podcast episode 12', date: '2026-10-01T12:00:00.000Z', clips: [
      { summary: 'Why most budgets fail', framework: grade('A', 8.6) },
      { summary: 'The coffee rule', framework: grade('C', 5.2), post_caption: 'Save this for payday #money' },
      { summary: 'Already shared clip', framework: grade('B', 7) }
    ] })
    fs.writeFileSync(path.join(podcast, '.bridgeclip-posted-2'), '')
    writeRun(library, 'remix-22222222-2222-4222-8222-222222222222', { title: 'Remix of a money myth', date: '2026-10-03T12:00:00.000Z', clips: [
      { summary: 'Myth vs truth take', framework: grade('B', 7.4), headline: 'Stop doing this with your savings', ai_generated: true }
    ] })
    writeRun(library, 'avatar-33333333-3333-4333-8333-333333333333', { title: 'Avatar Studio · Weekly tip', date: '2026-10-02T12:00:00.000Z', clips: [
      { summary: 'Weekly tip video', ai_generated: true }
    ] })
    return { podcast }
  })
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('radiogroup', { name: 'Library view' }).getByRole('radio', { name: 'Ready to post' }).click()
  const rows = page.getByTestId('ready-clip')
  const titles = () => rows.locator('p.truncate.text-sm').allInnerTexts()
  await page.getByTestId('ready-count').filter({ hasText: '4 clips not posted yet' }).waitFor()
  assert.deepEqual(await titles(), ['Myth vs truth take', 'Weekly tip video', 'Why most budgets fail', 'The coffee rule'], 'newest run first; the manually marked clip is left out')
  await page.getByText('Without a Zernio key, only clips you marked as posted are left out.').waitFor()
  assert.match(await rows.first().innerText(), /Remix\s*·\s*Remix of a money myth/)

  await page.getByRole('radiogroup', { name: 'Sort clips ready to post' }).getByRole('radio', { name: 'Best first' }).click()
  assert.deepEqual(await titles(), ['Why most budgets fail', 'Myth vs truth take', 'The coffee rule', 'Weekly tip video'])
  await page.getByRole('combobox', { name: 'Lowest grade' }).click()
  await page.getByRole('option', { name: 'Grade B or better' }).click()
  await page.getByTestId('ready-count').filter({ hasText: '2 of 4 clips' }).waitFor()
  assert.deepEqual(await titles(), ['Why most budgets fail', 'Myth vs truth take'])
  // Avatar Studio is switched off for launch, but this member has an avatar video, so its filter stays.
  await page.getByRole('radiogroup', { name: 'Kind of clip' }).getByRole('radio', { name: 'Avatar' }).waitFor()
  await page.getByRole('radiogroup', { name: 'Kind of clip' }).getByRole('radio', { name: 'Remix' }).click()
  assert.deepEqual(await titles(), ['Myth vs truth take'])
  await page.getByRole('radiogroup', { name: 'Kind of clip' }).getByRole('radio', { name: 'All' }).click()
  await page.getByRole('combobox', { name: 'Lowest grade' }).click()
  await page.getByRole('option', { name: 'Any grade' }).click()
  const search = page.getByRole('textbox', { name: 'Search clips ready to post' })
  await search.fill('payday')
  assert.deepEqual(await titles(), ['The coffee rule'], 'post captions are searched')
  await search.fill('savings')
  assert.deepEqual(await titles(), ['Myth vs truth take'], 'hooks are searched')
  await search.fill('')

  // Mark as posted leaves the list (and writes the same marker as a run's own button); Undo brings it back.
  await page.getByRole('button', { name: 'Mark Why most budgets fail as posted' }).click()
  await page.getByText('Marked “Why most budgets fail” as posted.').waitFor()
  await page.getByTestId('ready-count').filter({ hasText: '3 clips' }).waitFor()
  assert.ok(fs.existsSync(path.join(podcast, '.bridgeclip-posted-0')))
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByTestId('ready-count').filter({ hasText: '4 clips' }).waitFor()
  assert.equal(fs.existsSync(path.join(podcast, '.bridgeclip-posted-0')), false)

  // Batch: select two, post or schedule them in one dialog.
  await page.getByRole('checkbox', { name: 'Select The coffee rule' }).click()
  await page.getByRole('checkbox', { name: 'Select Weekly tip video' }).click()
  await page.getByRole('button', { name: 'Post or schedule 2' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByText(/Post clip 1 of 2/).waitFor()
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
  await dialog.waitFor({ state: 'detached' })

  // One clip at a time, then Open run shows the whole run.
  await page.getByRole('button', { name: 'Post or schedule Weekly tip video' }).click()
  await page.getByRole('dialog').getByRole('heading', { name: 'Weekly tip video' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open the run for The coffee rule' }).click()
  await page.getByRole('heading', { name: 'Podcast episode 12' }).waitFor()
  await page.getByRole('button', { name: 'Library', exact: true }).last().click()
  await page.getByTestId('ready-count').waitFor()
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    fs.mkdirSync(process.env.BRIDGECLIP_E2E_SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'ready-to-post.png') }).catch(() => undefined)
  }
  assert.deepEqual(errors, [])
})

test('Get set up checklist ticks items off from real state, can be closed and reopened from Settings', { timeout: 120000 }, async (t) => {
  const { app, page, errors, library, userDataDir } = await launch(t, 'bridgeclip-setup-e2e-')
  const checklist = page.getByTestId('setup-checklist').first()
  await checklist.waitFor()
  const done = (id) => checklist.locator(`[data-setup-item="${id}"]`).getAttribute('data-done')
  for (const id of ['openrouter', 'posting', 'brand', 'cta', 'first-clip']) assert.equal(await done(id), 'false', id)
  // Avatar Studio is switched off for launch: no "Make an avatar" step.
  assert.equal(await checklist.locator('[data-setup-item="avatar"]').count(), 0)
  assert.equal(await checklist.getByRole('button', { name: 'Try it with a sample video' }).count(), 0, 'no sample video unless one is set in Settings')

  // Real state changes: an OpenRouter key, a Library run; brand, call to action and avatar lists mocked in main.
  // Linux without a desktop keyring only offers plain-text storage, which the app refuses for keys; this key is fake.
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from('test:' + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(5)
    })
  })
  await page.getByPlaceholder('sk-or-…').fill('sk-or-test-key')
  await page.getByPlaceholder('sk-or-…').blur()
  // With the key saved, Clip shows one line of progress; open the steps again.
  await page.locator('[data-testid="setup-checklist"][data-compact="true"]').waitFor()
  await checklist.getByRole('button', { name: /Continue setup|Show steps/ }).click()
  await page.waitForFunction(() => document.querySelector('[data-setup-item="openrouter"]')?.getAttribute('data-done') === 'true')
  await app.evaluate(({ ipcMain }) => {
    for (const [channel, value] of [['brandIdentities:list', [{ id: 'a'.repeat(16), name: 'My brand', text: 'We help.' }]], ['ctas:list', [{ id: 'b'.repeat(16), name: 'Follow me' }]], ['avatars:list', [{ id: 'c' }]]]) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async () => value)
    }
  })
  writeRun(library, '44444444-4444-4444-8444-444444444444', { title: 'First run', date: '2026-10-05T12:00:00.000Z', clips: [{ summary: 'First clip' }] })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  for (const id of ['brand', 'cta', 'first-clip']) {
    await page.waitForFunction((id) => document.querySelector(`[data-setup-item="${id}"]`)?.getAttribute('data-done') === 'true', id)
  }
  assert.equal(await done('posting'), 'false', 'no Zernio key yet')
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    fs.mkdirSync(process.env.BRIDGECLIP_E2E_SHOTS, { recursive: true })
    await checklist.scrollIntoViewIfNeeded()
    // Playwright's page screenshot can stall on Create's live previews; capture the window instead.
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'setup-checklist.png'), Buffer.from(png, 'base64'))
  }
  await checklist.getByRole('button', { name: 'Add Zernio key: Connect a posting account' }).waitFor()

  // Close it: remembered in member prefs; Settings still has it and can show it again.
  await checklist.getByRole('button', { name: 'Close the setup checklist' }).click()
  await page.getByTestId('setup-checklist').waitFor({ state: 'detached' })
  await page.waitForFunction(() => true)
  const prefs = () => JSON.parse(fs.readFileSync(path.join(userDataDir, 'member-prefs.json'), 'utf8'))
  assert.equal(prefs().setupChecklistDismissed, true)
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  const inSettings = page.getByTestId('setup-checklist')
  await inSettings.waitFor()
  // Settings' copy reads the Library again when it opens.
  await page.waitForFunction(() => document.querySelector('[data-testid="setup-checklist"] [data-setup-item="first-clip"]')?.getAttribute('data-done') === 'true')
  await page.getByLabel('Sample video link').fill('ftp://example.com/v')
  await page.getByLabel('Sample video link').blur()
  await page.getByText('Use a video link that starts with https://.').waitFor()
  await page.getByLabel('Sample video link').fill('https://example.com/sample-video')
  await page.getByLabel('Sample video link').blur()
  await page.getByText('Saved.').first().waitFor()
  assert.equal(prefs().sampleVideoLink, 'https://example.com/sample-video')
  await page.getByRole('switch', { name: 'Show the checklist on Clip' }).click()
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Show the checklist on Clip"]')?.getAttribute('aria-checked') === 'true')
  assert.equal(prefs().setupChecklistDismissed, false)

  // Back on Clip: the sample action shows only while "first clip" is not done. Remove the run to see it fill Create.
  fs.rmSync(path.join(library, '44444444-4444-4444-8444-444444444444'), { recursive: true })
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Clip', exact: true }).click()
  // The key is saved, so Clip shows the compact bar again: open the steps.
  await page.locator('[data-testid="setup-checklist"][data-compact="true"]').waitFor()
  await page.getByTestId('setup-checklist').getByRole('button', { name: /Continue setup|Show steps/ }).click()
  const sample = page.getByTestId('setup-checklist').getByRole('button', { name: 'Try it with a sample video' })
  await sample.waitFor()
  await sample.click()
  // The link becomes Clip's source (shown as its preview).
  await page.getByText('example.com/sample-video', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
})
