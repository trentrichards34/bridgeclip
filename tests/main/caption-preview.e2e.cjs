// The caption styles in the style board's live preview on Create: the line plays word by word, pauses and
// plays, holds still on the punch word with reduced motion, and each style draws its words the way it should.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

test('caption styles preview word progression in the style board, pause and play, and respect reduced motion', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-caption-preview-'))
  const appDir = buildApp(path.join(root, 'app'))
  const session = await launchApp({ appDir, userDataDir: path.join(root, 'user-data') })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  // Shown (under xvfb), so the preview's animation frames run.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setBackgroundThrottling(false)
    window.show()
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByPlaceholder('YouTube, Twitch VOD or direct video link').fill('https://example.com/video.mp4')
  await page.getByRole('button', { name: 'Use link', exact: true }).click()
  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  const steps = page.getByRole('navigation', { name: 'Create steps' })
  await steps.getByRole('button', { name: /Look/ }).click()
  const board = page.getByTestId('style-board')
  const preview = board.getByTestId('style-preview')
  const presets = page.getByRole('radiogroup', { name: 'Caption style' })
  const active = () => preview.locator('[data-caption-state="active"]').evaluate((el) => el.firstChild.textContent, null, { timeout: 2000 })
  // Between loops the line is briefly gone.
  const activeNow = () => active().catch(() => 'none')

  // It plays on its own, and Pause holds the line.
  await board.getByRole('button', { name: 'Pause the preview' }).waitFor()
  const seen = new Set()
  for (let i = 0; i < 20 && seen.size < 2; i++) { seen.add(await activeNow()); await page.waitForTimeout(150) }
  assert.ok(seen.size >= 2, 'the active word moves on by itself')
  await board.getByRole('button', { name: 'Pause the preview' }).click()
  const paused = await activeNow()
  await page.waitForTimeout(700)
  assert.equal(await activeNow(), paused)
  await board.getByRole('button', { name: 'Play the preview' }).click()

  // Reduced motion: it holds still on the punch word, so each style can be checked as drawn.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await board.getByRole('button', { name: 'Play the preview' }).waitFor()
  await board.getByRole('button', { name: /^Show all \d+/ }).click()
  for (const [name, id] of [['Pop', 'pop'], ['Spotlight', 'spotlight'], ['Impact', 'impact'], ['Glow', 'glow'], ['Boxed', 'boxed'], ['Sweep', 'sweep'],
    ['Editorial', 'editorial'], ['Hype', 'hype'], ['Punch', 'punch'], ['Neon', 'neon'], ['Headline', 'headline'], ['Paper', 'paper'], ['Subtle', 'subtle']]) {
    await presets.getByRole('radio', { name, exact: true }).click()
    await preview.locator(`[data-caption-preset="${id}"]`).waitFor()
    assert.match(await active(), /^captions$/i, `${name} holds on the punch word`)
    const words = preview.locator('[data-caption-state]')
    if (name === 'Punch') assert.equal(await words.count(), 1, 'one word at a time')
    if (name === 'Impact') {
      assert.equal(await words.count(), 2, 'two words at a time')
      assert.equal(await preview.locator('[data-caption-state="future"]').evaluate((el) => getComputedStyle(el).visibility), 'hidden')
    }
    if (name === 'Editorial' || name === 'Subtle') {
      // (Polled: the line settles a frame after the style changes.)
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="style-preview"] [data-caption-state="future"]')).opacity) < 1, null, { timeout: 5000 })
    }
    if (name === 'Spotlight' || name === 'Headline') {
      assert.notEqual(await preview.locator('[data-caption-state="active"]').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
      assert.equal(await preview.locator('[data-caption-state="past"]').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
    }
    if (name === 'Sweep') {
      // The color sweeps across the spoken word: half way at the held moment.
      assert.equal(await preview.locator('[data-caption-state="active"] > span').evaluate((el) => el.style.clipPath), 'inset(0px 50% 0px 0px)')
    }
  }
  const held = await active()
  await page.waitForTimeout(600)
  assert.equal(await active(), held, 'reduced motion: no playback on its own')
  // Play still works when asked for.
  await board.getByRole('button', { name: 'Play the preview' }).click()
  const moved = new Set([held])
  for (let i = 0; i < 20 && moved.size < 2; i++) { await page.waitForTimeout(150); moved.add(await activeNow()) }
  assert.ok(moved.size >= 2, 'reduced motion allows explicit playback')

  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await presets.getByRole('radio', { name: 'Spotlight', exact: true }).click()
    await page.screenshot({ path: path.join(shots, 'caption-preview.png') })
  }

  // Extras on the caption line: the punch word in the keyword pill, the next word in an italic serif.
  await presets.getByRole('radio', { name: 'Pop', exact: true }).click()
  await board.getByRole('button', { name: 'Pause the preview' }).click()
  const extras = page.getByRole('group', { name: 'Extras: pick as many as you like' })
  await extras.getByRole('checkbox', { name: 'Keyword pill' }).click()
  await extras.getByRole('checkbox', { name: 'Accent words' }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await preview.locator('[data-extra="pill"]', { hasText: /captions/i }).waitFor()
  assert.equal(await preview.locator('[data-extra="pill"]').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(47, 107, 255)')
  assert.match(await preview.locator('[data-extra="accent"]').evaluate((el) => getComputedStyle(el).fontFamily), /Instrument Serif/)
  assert.equal(await preview.locator('[data-extra="accent"]').textContent(), 'come')
  await extras.getByRole('checkbox', { name: 'Keyword pill' }).click()
  await extras.getByRole('checkbox', { name: 'Accent words' }).click()

  // No captions: the preview has no caption line.
  await presets.getByRole('radio', { name: 'No captions' }).click()
  assert.equal(await preview.locator('[data-caption-preset]').count(), 0)
  await steps.getByRole('button', { name: /Review/ }).click()
  assert.equal(await page.getByTestId('style-preview').count(), 0)
  assert.deepEqual(errors, [])
})
