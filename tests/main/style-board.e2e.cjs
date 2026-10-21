// The style board: one place to pick captions, hook text, font, color, handle, call to action and keyword,
// with a live preview. Create's request carries the same fields the separate pickers set; Remix shows the board
// in its folded look section (on camera) and in "Your take" (AI presenter).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const KIT = 'a1b2c3d4e5f60718'
const TEXT = 'Core promise: pull-ups for busy parents. Voice: plain and warm.'
// The curated combos' caption names (src/renderer/lib/style-board.ts CURATED_COMBOS).
const COMBO_CAPTIONS = ['Pop', 'Headline', 'Spotlight', 'Impact', 'Editorial', 'Glow', 'Neon', 'Lime', 'Retro', 'Paper', 'Hype', 'Vintage', 'Sweep']

function ffmpegPath() {
  for (const candidate of [process.env.FFMPEG_PATH, 'ffmpeg']) {
    if (!candidate) continue
    try { execFileSync(candidate, ['-version'], { stdio: 'ignore' }); return candidate } catch { /* next */ }
  }
  return null
}

/** With BRIDGECLIP_E2E_SHOTS set, a picture of the shown window (taken in main). */
async function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.fonts.ready.then(() => true)')).catch(() => null)
  fs.mkdirSync(dir, { recursive: true })
  await new Promise((resolve) => setTimeout(resolve, 900))
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
  if (png) fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))
}

const checked = async (locator) => (await locator.getAttribute('aria-checked')) === 'true'

/** Board rows that scroll sideways or spill past the board (none should). */
const noSidewaysRows = (page) => page.evaluate(() => {
  const board = document.querySelector('[data-testid="style-board"]')?.getBoundingClientRect()
  return [...document.querySelectorAll('[data-testid="style-board"] [role="radiogroup"]')]
    .concat([...document.querySelectorAll('[data-testid="style-board"] [role="group"][aria-label^="Extras"]')])
    .filter((group) => group.scrollWidth > group.clientWidth + 1 || [...group.children].some((tile) => tile.getBoundingClientRect().right > board.right + 1))
    .map((group) => group.getAttribute('aria-label'))
})

test('the style board picks the look in one place, previews it and sends the same request fields', { timeout: 300000 }, async (t) => {
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) { t.skip('ffmpeg is needed for the source video'); return }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-style-board-e2e-'))
  const userData = path.join(root, 'user-data')
  const dir = path.join(userData, 'brand-identities')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${KIT}.json`), JSON.stringify({
    id: KIT, name: 'Pull-Up Lab', text: TEXT, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    look: { color: '#FF8800', headlineLook: { look: 'brand', color: '#FF8800', font: 'serif' }, captionPreset: 'boxed', handle: '@pulluplab', handlePosition: 'top-right' }
  }))
  // The member's video: a person on a plain backdrop, filmed vertically.
  const video = path.join(root, 'my talk.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-i', path.join(__dirname, '../../engine/tests/fixtures/portrait_person.jpg'), '-t', '5', '-r', '24',
    '-vf', 'scale=720:1280,format=yuv420p', '-c:v', 'libx264', video])
  const ctaImage = path.join(root, 'Free plan.png')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x7C5CFF:s=360x640', '-frames:v', '1', ctaImage])

  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ ipcMain, BrowserWindow }, root) => {
    globalThis.styleTest = { submitted: null }
    ipcMain.removeHandler('settings:load')
    ipcMain.handle('settings:load', () => ({ openrouterConfigured: true, zernioConfigured: false, outputDirectory: root, pythonPath: '', customVocabulary: '' }))
    ipcMain.removeHandler('system:checkTools')
    ipcMain.handle('system:checkTools', () => ({ python: true, pythonDeps: true, ffmpeg: true, ffmpegCaptions: true, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true }))
    ipcMain.removeHandler('job:start')
    ipcMain.handle('job:start', (_event, config) => {
      globalThis.styleTest.submitted = config
      const now = new Date().toISOString()
      return { jobId: 'style-job', queued: false, job: { id: 'style-job', revision: 1, request: config, status: 'downloading', percent: 5, step: 'Downloading video',
        clipsDone: 0, clipsTotal: 0, error: null, errorHint: null, output: null, outputDir: root, queuedAt: now, startedAt: now, finishedAt: null } }
    })
    // Shown, so the preview animates and the screenshots paint.
    const window = BrowserWindow.getAllWindows()[0]
    window.setSize(1280, 1000)
    window.webContents.setBackgroundThrottling(false)
    window.show()
  }, root)
  await page.reload()
  const dialogs = (files) => app.evaluate(({ dialog }, list) => {
    const queue = [...list]
    dialog.showOpenDialog = async () => { const next = queue.shift(); return { canceled: !next, filePaths: next ? [next] : [] } }
  }, files)

  // Create: the member's own video, Automatic, then the Captions step.
  await dialogs([video])
  await page.getByRole('radio', { name: 'Automatic', exact: true }).click()
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await page.getByText('my talk.mp4').first().waitFor()
  const steps = page.getByRole('navigation', { name: 'Create steps' })
  await steps.getByRole('button', { name: /Look/ }).click()
  const board = page.getByTestId('style-board')
  await board.waitFor()
  const summary = board.getByTestId('style-board-summary')
  const preview = board.getByTestId('style-preview')
  assert.match(await summary.innerText(), /^Pop captions · White bar · Clean font/)
  assert.equal(await preview.getAttribute('data-hook'), 'white')
  assert.match(await preview.getAttribute('aria-label'), /^Preview: Pop captions/)
  // The preview plays the caption line word by word.
  await preview.locator('[data-caption-state="active"]').first().waitFor()

  // Keyboard: arrows move through the caption styles (a roving radio group); Home is "No captions".
  const captions = page.getByRole('radiogroup', { name: 'Caption style' })
  await captions.getByRole('radio', { name: 'Pop', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await checked(captions.getByRole('radio', { name: 'Spotlight' })), true)
  assert.equal(await captions.getByRole('radio', { name: 'Spotlight' }).evaluate((el) => el === document.activeElement), true)
  await page.keyboard.press('Home')
  assert.equal(await checked(captions.getByRole('radio', { name: 'No captions' })), true)
  assert.match(await summary.innerText(), /^No captions/)
  assert.equal(await preview.locator('[data-caption-preset]').count(), 0)
  // The row's arrow buttons step through too.
  await board.getByRole('button', { name: 'Next captions' }).click()
  assert.equal(await checked(captions.getByRole('radio', { name: 'Pop', exact: true })), true)

  // Captions show a first set; "Show all" opens the rest.
  assert.equal(await captions.getByRole('radio', { name: 'Neon' }).count(), 0)
  await board.getByRole('button', { name: /^Show all \d+/ }).click()
  await captions.getByRole('radio', { name: 'Neon' }).waitFor()
  await board.getByRole('button', { name: 'Show fewer' }).click()

  // Hook text, font and color: the color row is only there for a Brand color bar, the one look it changes.
  const hooks = page.getByRole('radiogroup', { name: 'Hook text look' })
  await hooks.getByRole('radio', { name: 'Black bar' }).click()
  assert.equal(await preview.getAttribute('data-hook'), 'black')
  assert.equal(await board.getByTestId('style-preview-bar').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(14, 14, 14)')
  assert.equal(await page.getByRole('radiogroup', { name: 'Bar color' }).count(), 0)
  await hooks.getByRole('radio', { name: 'Brand color' }).click()
  await page.getByRole('radiogroup', { name: 'Bar color' }).getByRole('radio', { name: 'Violet #7C5CFF' }).click()
  assert.equal(await checked(hooks.getByRole('radio', { name: 'Brand color' })), true)
  assert.equal(await board.getByTestId('style-preview-bar').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(124, 92, 255)')
  await page.getByRole('radiogroup', { name: 'Hook text font' }).getByRole('radio', { name: 'Bold condensed' }).click()
  assert.match(await summary.innerText(), /Brand color · Bold condensed font · Violet #7C5CFF/)
  // A title card or no hook text leaves the font for later.
  // The new fonts: hand-drawn marker capitals, and a bold sans with one word in an italic serif.
  const fonts = page.getByRole('radiogroup', { name: 'Hook text font' })
  await fonts.getByRole('radio', { name: 'Marker' }).click()
  assert.match(await summary.innerText(), /Marker font/)
  assert.match(await board.getByTestId('style-preview-bar').locator('span').first().evaluate((el) => getComputedStyle(el).fontFamily), /Caveat Brush/)
  assert.equal(await page.evaluate(() => document.fonts.load('40px "Caveat Brush"').then((list) => list.length > 0)), true, 'the bundled font loads')
  await fonts.getByRole('radio', { name: 'Sans + italic serif' }).click()
  assert.equal(await board.getByTestId('style-preview-bar').locator('[data-hook-accent]').innerText(), 'video')
  // Every option tile is the member's own frame: the video's still, drawn once and copied into each tile.
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Hook text font"] [data-look-tile] canvas')].some((canvas) => canvas.width > 0 && canvas.width !== 300))
  assert.equal(await page.locator('[aria-label="Caption style"] [data-look-tile]').count(), 10)
  await hooks.getByRole('radio', { name: 'Title card' }).click()
  assert.equal(await page.getByRole('radiogroup', { name: 'Hook text font' }).getByRole('radio', { name: 'Clean' }).isDisabled(), true)

  // Start from a ready-made look: the curated looks as tiles; pick one, then "Change anything" goes back to the rows.
  const start = page.getByRole('radiogroup', { name: 'How to start' })
  assert.equal(await checked(start.getByRole('radio', { name: /Build my own/ })), true)
  await start.getByRole('radio', { name: /Start from a ready-made look/ }).click()
  const looks = page.getByRole('radiogroup', { name: 'Ready-made look' })
  await looks.getByRole('radio', { name: 'Magazine' }).click()
  assert.match(await summary.innerText(), /^Sweep captions · Black bar · Sans \+ italic serif font/)
  assert.equal(await page.getByRole('radiogroup', { name: 'Caption style' }).count(), 0)
  await page.evaluate(() => { document.querySelector('[data-testid="style-board"]')?.scrollIntoView({ block: 'start' }); document.getElementById('page-scroll')?.scrollBy(0, -56) })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  await shot(app, 'look-1280x800-ready-made.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700))
  await shot(app, 'look-1024x700-ready-made.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1000))
  await board.getByRole('button', { name: 'Change anything' }).click()
  assert.equal(await checked(start.getByRole('radio', { name: /Build my own/ })), true)
  await captions.waitFor()

  // Extras: pick as many as you like (checkboxes); the summary, the preview and the request carry them.
  const extras = page.getByRole('group', { name: 'Extras: pick as many as you like' })
  await extras.getByRole('checkbox', { name: 'Progress bar' }).click()
  await extras.getByRole('checkbox', { name: 'Keyword pill' }).click()
  // Keyboard: Space toggles a focused tile.
  await extras.getByRole('checkbox', { name: 'Comment box' }).focus()
  await page.keyboard.press('Space')
  assert.equal(await checked(extras.getByRole('checkbox', { name: 'Comment box' })), true)
  await page.keyboard.press('Space')
  assert.equal(await checked(extras.getByRole('checkbox', { name: 'Comment box' })), false)
  assert.match(await summary.innerText(), /Extras: Keyword pill, Progress bar$/)
  assert.equal(await preview.getAttribute('data-extras'), 'keyword_pill progress_bar')
  await preview.getByTestId('look-extra-progress_bar').waitFor()
  await preview.locator('[data-extra="pill"]').first().waitFor()

  // Shuffle only lands on curated combos.
  for (let i = 0; i < 4; i++) {
    await board.getByRole('button', { name: 'Shuffle' }).click()
    const text = await summary.innerText()
    assert.ok(COMBO_CAPTIONS.some((name) => text.startsWith(`${name} captions · `)), text)
  }

  // No brand yet: "Set up my brand" adds one right from the board, and it's picked for this run.
  assert.equal(await board.getByRole('button', { name: 'Use my brand' }).count(), 0)
  await board.getByRole('button', { name: 'Set up my brand' }).first().click()
  const addBrand = page.getByRole('dialog', { name: 'Add brand identity' })
  await addBrand.getByPlaceholder('e.g. Pull-Up Lab').fill('Side Project')
  await addBrand.locator('textarea').fill('Core promise: calm mornings for new parents. Voice: short and kind.')
  await addBrand.getByRole('button', { name: 'Save', exact: true }).click()
  await addBrand.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.querySelector('[aria-label="Brand identity"]')?.textContent?.includes('Side Project'))
  await board.getByRole('button', { name: 'Use my brand' }).waitFor()
  // No handle on it: "Add a handle" opens the brand at its handle field, and saving one turns it on.
  await board.getByRole('button', { name: 'Add a handle' }).click()
  const editBrand = page.getByRole('dialog', { name: 'Edit brand identity' })
  await editBrand.waitFor()
  assert.equal(await editBrand.getByLabel('Handle', { exact: true }).evaluate((el) => el === document.activeElement), true)
  await editBrand.getByLabel('Handle', { exact: true }).fill('@sideproject')
  await editBrand.getByRole('button', { name: 'Save', exact: true }).click()
  await editBrand.waitFor({ state: 'detached' })
  assert.equal(await checked(page.getByRole('switch', { name: 'Show my handle' })), true)

  // A brand: its look fills the board; the handle shows in its corner; "Use my brand" puts it back after changes.
  await page.getByRole('combobox', { name: 'Brand identity' }).click()
  await page.getByRole('option', { name: /^Pull-Up Lab/ }).click()
  assert.equal(await checked(captions.getByRole('radio', { name: 'Boxed' })), true)
  assert.equal(await checked(hooks.getByRole('radio', { name: 'Brand color' })), true)
  assert.equal(await checked(page.getByRole('switch', { name: 'Show my handle' })), true)
  assert.equal(await board.getByTestId('style-preview-handle').getAttribute('data-corner'), 'top-right')
  await captions.getByRole('radio', { name: 'Spotlight' }).click()
  await hooks.getByRole('radio', { name: 'Floating text' }).click()
  assert.equal(await page.getByRole('radiogroup', { name: 'Bar color' }).count(), 0)
  await board.getByRole('button', { name: 'Use my brand' }).click()
  assert.equal(await checked(captions.getByRole('radio', { name: 'Boxed' })), true)
  assert.equal(await checked(hooks.getByRole('radio', { name: 'Brand color' })), true)
  assert.match(await summary.innerText(), /^Boxed captions · Brand color · Serif font · Brand #FF8800 · Handle top right/)
  // The corner is the brand's: choosing one saves it there.
  await page.getByRole('radiogroup', { name: 'Handle corner' }).getByRole('radio', { name: 'Bottom left' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="style-preview-handle"]')?.getAttribute('data-corner') === 'bottom-left')
  const saved = JSON.parse(fs.readFileSync(path.join(dir, `${KIT}.json`), 'utf8'))
  assert.equal(saved.look.handlePosition, 'bottom-left')
  assert.equal(saved.text, TEXT)

  // Call to action: add an image, it's chosen and the preview says how the video ends.
  await dialogs([ctaImage])
  await board.getByRole('button', { name: /Add CTA/ }).click()
  const ctas = page.getByRole('radiogroup', { name: 'Call to action' })
  await ctas.getByRole('radio', { name: /Free plan \(image/ }).waitFor()
  assert.equal(await checked(ctas.getByRole('radio', { name: /Free plan \(image/ })), true)
  assert.match(await board.getByTestId('style-preview-ends').innerText(), /Ends with: Free plan/)
  await page.getByLabel('Comment keyword').fill('plan')
  await page.getByLabel('What they get').fill('my free plan')
  await page.getByText('The caption ends with:').waitFor()
  await board.getByTestId('style-preview-keyword').waitFor({ timeout: 15000 })
  await board.scrollIntoViewIfNeeded()
  await page.evaluate(() => { document.querySelector('[data-testid="style-board"]')?.scrollIntoView({ block: 'start' }); document.getElementById('page-scroll')?.scrollBy(0, -56) })
  await shot(app, 'style-board-create.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  await shot(app, 'look-1280x800-build.png')
  await page.getByRole('group', { name: 'Extras: pick as many as you like' }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await shot(app, 'look-1280x800-extras.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700))
  await page.evaluate(() => { document.querySelector('[data-testid="style-board"]')?.scrollIntoView({ block: 'start' }); document.getElementById('page-scroll')?.scrollBy(0, -56) })
  await shot(app, 'look-1024x700-build.png')
  await page.getByRole('group', { name: 'Extras: pick as many as you like' }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await shot(app, 'look-1024x700-extras.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1000))
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    // The preview held still on the punch word (reduced motion), to set beside an engine render of the same look.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await preview.locator('[data-caption-state="active"]', { hasText: 'captions' }).waitFor()
    const box = await preview.boundingBox()
    await new Promise((resolve) => setTimeout(resolve, 600))
    const png = await app.evaluate(async ({ BrowserWindow }, rect) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect)).toPNG().toString('base64'),
      { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) })
    fs.writeFileSync(path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'style-board-preview-still.png'), Buffer.from(png, 'base64'))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }

  // Saved styles: "Save as a style" names the current look for the Style bar.
  await board.getByRole('button', { name: 'Save as a style' }).click()
  const name = page.getByRole('dialog', { name: 'Save your Create style' })
  await name.getByLabel('Style name').fill('Pull-up look')
  await name.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Saved “Pull-up look”').first().waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Saved style' }).innerText(), 'Pull-up look')

  // At 1024 wide every row still wraps inside the board (the extras too).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700))
  await hooks.getByRole('radio', { name: 'Brand color' }).click()
  await board.getByRole('button', { name: /^Show all \d+/ }).click()
  await page.waitForTimeout(300)
  assert.deepEqual(await noSidewaysRows(page), [])
  await board.getByRole('button', { name: 'Show fewer' }).click()

  // Narrow window: the board stacks (the preview above the rows).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 1000))
  await page.waitForFunction(() => {
    const preview = document.querySelector('[data-testid="style-preview"]')?.getBoundingClientRect()
    const rows = document.querySelector('[aria-label="Caption style"]')?.getBoundingClientRect()
    return preview && rows && rows.top > preview.bottom
  })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no sideways scroll')
  assert.deepEqual(await noSidewaysRows(page), [])
  await page.evaluate(() => { document.querySelector('[data-testid="style-board"]')?.scrollIntoView({ block: 'start' }); document.getElementById('page-scroll')?.scrollBy(0, -56) })
  await shot(app, 'style-board-create-narrow.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1000))

  // The request: the same fields the separate pickers used to set.
  await steps.getByRole('button', { name: /Review/ }).click()
  await page.getByText('Keyword pill, Progress bar').first().waitFor()
  await page.getByRole('button', { name: 'Generate clips', exact: true }).click()
  await page.getByRole('button', { name: 'View job' }).waitFor()
  const request = await app.evaluate(() => globalThis.styleTest.submitted)
  assert.equal(request.includeCaptions, true)
  assert.equal(request.captionPreset, 'boxed')
  assert.equal(request.includeTitle, true)
  assert.equal(request.titleStyle, 'headline')
  assert.deepEqual(request.headlineLook, { look: 'brand', color: '#FF8800', font: 'serif' })
  assert.equal(request.showHandle, true)
  assert.match(request.ctaId, /^[a-f0-9]+$/)
  assert.equal(request.ctaKeyword, 'PLAN')
  assert.equal(request.ctaOffer, 'my free plan')
  assert.equal(request.brandIdentityId, KIT)
  assert.deepEqual(request.lookExtras, ['keyword_pill', 'progress_bar'])

  // Remix, you on camera: the board fills the folded "Look & call to action", with the template's layout under it.
  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Remix', exact: true }).waitFor()
  await page.getByRole('radio', { name: /You on camera/ }).click()
  await page.getByRole('radio', { name: /Pause & react/ }).click()
  const fold = page.getByRole('button', { name: /3 · Look & call to action/ })
  const foldSummary = await page.getByTestId('look-summary').innerText()
  assert.match(foldSummary, /Pop captions · White bar/)
  await fold.click()
  const remixBoard = page.getByTestId('style-board')
  await remixBoard.getByRole('heading', { name: 'Layout' }).waitFor()
  await page.getByRole('radiogroup', { name: 'Where their video goes' }).waitFor()
  await page.getByRole('radiogroup', { name: 'Your background' }).waitFor()
  await page.getByRole('radiogroup', { name: 'Hook text look' }).getByRole('radio', { name: 'Black bar' }).click()
  await page.getByTestId('look-summary').getByText(/· Black bar ·/).waitFor()
  await fold.scrollIntoViewIfNeeded()
  await fold.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await shot(app, 'style-board-remix-camera.png')
  await remixBoard.getByRole('heading', { name: 'Layout' }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await shot(app, 'style-board-remix-camera-layout.png')

  // AI presenter: the same board in the same fold (still open: the choice holds for the session), after the presenter.
  await page.getByRole('radio', { name: /AI presenter/ }).click()
  const aiFold = page.getByRole('button', { name: /4 · Look & call to action/ })
  assert.equal(await aiFold.getAttribute('aria-expanded'), 'true')
  await page.getByTestId('style-board').waitFor()
  assert.equal(await checked(page.getByRole('radiogroup', { name: 'Hook text look' }).getByRole('radio', { name: 'Black bar' })), true)
  await aiFold.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await shot(app, 'style-board-remix-ai.png')

  assert.deepEqual(errors, [])
})
