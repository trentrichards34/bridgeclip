const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const ONBOARDING = { BRIDGECLIP_E2E_ONBOARDING: '1' }

test('first launch: the guided setup builds a profile, then Create shows the path made for it and Guides starts a first run', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-onboarding-e2e-'))
  const userData = path.join(root, 'user-data')
  const appDir = buildApp(path.join(root, 'app'))
  let session = await launchApp({ appDir, userDataDir: userData, env: ONBOARDING })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  let { page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  const flow = page.getByTestId('onboarding')
  await flow.getByRole('heading', { name: 'What do you want to make?' }).waitFor()
  // Continue needs a choice.
  await flow.getByRole('button', { name: 'Continue' }).click()
  await flow.getByRole('alert').filter({ hasText: 'Pick at least one' }).waitFor()
  await flow.getByRole('checkbox', { name: /Clips from my long videos/ }).click()
  await flow.getByRole('checkbox', { name: /Reactions on camera/ }).click()
  assert.equal(await flow.getByRole('checkbox', { name: /Reactions on camera/ }).getAttribute('aria-checked'), 'true')
  await flow.getByRole('button', { name: 'Continue' }).click()

  await flow.getByRole('heading', { name: 'Where do you post?' }).waitFor()
  await flow.getByRole('checkbox', { name: 'TikTok', exact: true }).click()
  await flow.getByRole('checkbox', { name: 'YouTube', exact: true }).click()
  await flow.getByRole('checkbox', { name: /Post and schedule to them from CreatorClips/ }).click()
  await flow.getByRole('button', { name: 'Continue' }).click()

  await flow.getByRole('heading', { name: 'Your brand and call to action' }).waitFor()
  await flow.getByRole('button', { name: 'Continue' }).click()

  await flow.getByRole('heading', { name: 'Your setup path' }).waitFor()
  const path1 = flow.getByRole('list', { name: 'Your setup path' })
  for (const title of ['Allow the camera and microphone', 'Connect TikTok and YouTube', 'Make your first clips', 'Make your first on-camera reaction']) {
    await path1.getByText(title, { exact: true }).waitFor()
  }
  assert.equal(await path1.getByText('Make an avatar').count(), 0, 'no avatar step without an AI goal')
  await flow.getByRole('button', { name: 'Show my setup path' }).click()
  await flow.waitFor({ state: 'detached' })

  // Create: the path for this profile.
  const checklist = page.getByTestId('setup-checklist').first()
  await checklist.getByText('Your setup path').waitFor()
  assert.equal(await checklist.getByTestId('setup-goals').innerText(), 'Set up for: Clips from my long videos · Reactions on camera · Post and schedule from here')
  const ids = await checklist.locator('[data-setup-item]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-setup-item')))
  assert.deepEqual(ids, ['openrouter', 'tools', 'camera', 'posting', 'brand', 'cta', 'first-clip', 'first-camera-reaction'])
  // Each step has a short how-to.
  await checklist.getByRole('button', { name: 'How: Add your OpenRouter key' }).click()
  await checklist.getByText('Create an API key there.').waitFor()

  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8'))
  assert.deepEqual(saved.profile, { goals: ['clips', 'camera-reactions', 'posting'], platforms: ['tiktok', 'youtube'], onboarding: 'done' })

  // Start a first on-camera reaction: Remix opens with Me, on camera and the guide on top.
  await checklist.getByRole('button', { name: 'Start: Make your first on-camera reaction' }).click()
  const guide = page.getByTestId('first-run-guide')
  await guide.getByRole('heading', { name: 'Reactions on camera' }).waitFor()
  assert.equal(await page.getByRole('radio', { name: /Me, on camera/ }).getAttribute('aria-checked'), 'true')
  await guide.getByRole('button', { name: 'Close the guide' }).click()
  await guide.waitFor({ state: 'detached' })

  // Guides: the member's goals first; Start opens Create with its guide.
  await page.getByRole('button', { name: 'Guides', exact: true }).first().click()
  const titles = await page.getByTestId('guide').locator('h2').allInnerTexts()
  assert.deepEqual(titles.slice(0, 3), ['Clips from your long videos', 'Reactions on camera', 'Post and schedule from CreatorClips'])
  await page.getByRole('button', { name: 'Start: Clips from your long videos' }).click()
  await page.getByTestId('first-run-guide').getByRole('heading', { name: 'Clips from your long videos' }).waitFor()

  // A finished setup doesn't open again; Edit profile does, with the choices kept.
  await session.close()
  session = await launchApp({ appDir, userDataDir: userData, env: ONBOARDING })
  page = session.page
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByTestId('setup-checklist').first().waitFor()
  assert.equal(await page.getByTestId('onboarding').count(), 0)
  await page.getByTestId('setup-checklist').first().getByRole('button', { name: 'Edit profile' }).click()
  assert.equal(await page.getByTestId('onboarding').getByRole('checkbox', { name: /Reactions on camera/ }).getAttribute('aria-checked'), 'true')
  await page.keyboard.press('Escape')
  await page.getByTestId('onboarding').waitFor({ state: 'detached' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8')).profile.onboarding, 'done', 'closing an edit keeps the profile finished')
  assert.deepEqual(errors, [])
})

test('first launch: Skip for now closes the setup, keeps the general checklist, and it can be opened again', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-onboarding-skip-e2e-'))
  const userData = path.join(root, 'user-data')
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData, env: ONBOARDING })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { page } = session
  await page.getByTestId('onboarding').getByRole('heading', { name: 'What do you want to make?' }).waitFor()
  await page.getByTestId('onboarding').getByRole('button', { name: 'Skip for now' }).click()
  await page.getByTestId('onboarding').waitFor({ state: 'detached' })
  const checklist = page.getByTestId('setup-checklist').first()
  await checklist.getByText('Get set up', { exact: true }).waitFor()
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'member-prefs.json'), 'utf8')).profile.onboarding, 'skipped')
  await checklist.getByRole('button', { name: 'Set up your profile' }).click()
  await page.getByTestId('onboarding').getByRole('heading', { name: 'What do you want to make?' }).waitFor()
})
