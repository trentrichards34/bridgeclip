// Custom graphics in Edit my recording's review, in the app on a short take: the Custom graphics skill is on (an
// OpenRouter key is saved) with its estimate; the beat sheet designs the key moment (a stand-in model writes the
// composition and passes its grade), the beat shows its stills; a note designs it again; "Use the template" swaps it
// back; designed again, the reel is made and its clip editor project carries the custom graphic, drawn in the bake.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

const shotPath = process.env.BRIDGECLIP_E2E_SHOTS ? path.join(process.env.BRIDGECLIP_E2E_SHOTS, 'custom-graphics-review.png') : null
const COMPOSITION = fs.readFileSync(path.join(__dirname, 'fake-custom-graphics', 'coaches.html'), 'utf8')

function say(text, start, step = 0.32) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.04).toFixed(3), type: 'word' }))
}
const TAKE = [...say('Most coaches lose clients.', 0.5), ...say('No, again.', 2.1), ...say('Most coaches lose so many clients.', 3.0),
  ...say('Fifteen billion messages wait.', 5.6), ...say('Follow me for more.', 7.4)]

test('Edit my recording: custom graphics designed on the beat sheet, changed with a note, swapped back, and baked into the reel', { timeout: 600000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-custom-review-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const recording = path.join(root, 'my take.mp4')
  const expr = TAKE.map((w) => `between(t,${w.start},${w.end})`).join('+')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=9.5', '-f', 'lavfi', '-i', `aevalsrc='0.25*sin(2*PI*300*t)*(${expr})':s=48000:d=9.5`,
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', recording])
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))

  // The stand-in OpenRouter: the transcription, and the custom graphics' writer and grader (the plan is the engine's stand-in).
  const asked = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.url === '/api/v1/chat/completions') {
        const json = JSON.parse(body)
        const user = json.messages[1].content
        const grade = Array.isArray(user)
        const fill = !grade && /fill the text slots/.test(json.messages[0].content[0].text)
        const world = !grade && /WORLD NOTE/.test(json.messages[0].content[0].text)
        asked.push({ grade, fill: fill || world, world, user: grade ? user.map((p) => p.text ?? '').join('\n') : user, model: json.model })
        if (world) {
          // The video's visual world, from its own words (coaches losing clients, messages waiting).
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ idea: 'Clients leak out of a coach\'s bucket while messages wait in a pile.', elements: ['a leaking bucket', 'message cards', 'client dots'], style: 'flat ink line art', accent: '#9BE35A' }) } }], usage: { cost: 0.004 } }))
          return
        }
        if (fill) {
          // My motion library: the slots filled with the same words (they are said here too).
          const values = Object.fromEntries([...user.matchAll(/- (s\d+): "([^"]*)"/g)].map((m) => [m[1], m[2]]))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fits: true, values }) } }], usage: { cost: 0.002 } }))
          return
        }
        const seconds = grade ? '' : /data-duration="([\d.]+)"/.exec(user)?.[1] ?? '2.50'
        const content = grade ? '{"pass": true, "score": 8, "failed": [], "fixes": []}'
          : '```html\n' + COMPOSITION.replace(/data-duration="[\d.]+"/, `data-duration="${seconds}"`).replace('Most coaches', asked.filter((a) => !a.grade).length > 1 ? 'Most coaches  ' : 'Most coaches') + '\n```'
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { cost: grade ? 0.012 : 0.06 } }))
        return
      }
      if (req.url === '/api/v1/audio/transcriptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ text: TAKE.map((w) => w.word).join(' '), words: TAKE, usage: { cost: 0.0004, seconds: 9 } }))
        return
      }
      res.writeHead(404).end('{}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/v1`
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: base, BRIDGECLIP_E2E_OPENROUTER_URL: `${base}/chat/completions` } })
  t.after(async () => {
    server.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  // Shown for the screenshot (a hidden window can capture a stale frame).
  await app.evaluate(({ BrowserWindow }, show) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1400, 1100); window.webContents.setBackgroundThrottling(false); if (show) window.show() }, Boolean(shotPath))
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, recording)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Edit my recording/ }).click()
  await page.getByRole('heading', { name: 'Raw takes in, one finished reel out', level: 1 }).waitFor()
  await page.getByRole('button', { name: 'Choose recordings' }).click()
  await page.getByRole('list', { name: 'Your recordings' }).getByText('my take.mp4').waitFor()
  await page.getByRole('button', { name: 'Edit my recording', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Review your edit' }).waitFor({ timeout: 180000 })

  // Skills: Custom graphics is on (a key is saved), with what it would cost.
  const skill = page.locator('[data-skill="custom_graphics"]')
  await skill.waitFor()
  assert.equal(await skill.locator('[role="switch"]').getAttribute('aria-checked'), 'true')
  await skill.getByText(/For 1 key moment, your AI designs a graphic/).waitFor({ timeout: 30000 })

  await page.getByRole('button', { name: 'Make my reel' }).click()
  const offer = page.getByRole('dialog', { name: 'See your beats first?' })
  await offer.getByRole('button', { name: 'Show me the beat sheet' }).click()
  await offer.waitFor({ state: 'detached' })
  const sheet = page.getByTestId('beat-sheet')
  await sheet.waitFor()
  const panel = sheet.getByTestId('custom-graphics-panel')
  await panel.getByText(/a graphic for 1 key moment, each checked and fixed up to 2 times\. About \$/).waitFor()
  const cards = sheet.getByTestId('beat-card')
  const keys = async () => cards.evaluateAll((list) => list.map((li) => li.getAttribute('data-beat')))
  const before = await keys()
  const statementKey = before.find((key) => key.startsWith('g:'))
  assert.ok(statementKey, before.join())

  // Design them now: the statement beat becomes a custom graphic, its still drawn from the composition's stills.
  await panel.getByTestId('custom-graphics-design').click()
  const badge = sheet.getByTestId('beat-custom-badge')
  await badge.waitFor({ timeout: 120000 })
  const customCard = cards.filter({ has: page.getByTestId('beat-custom-badge') })
  await customCard.locator('.editor-graphic-view img').first().waitFor({ state: 'attached' })
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="beat-card"] .editor-graphic-view img')].some((img) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== 'none'), null, { timeout: 30000 })
  assert.match(await customCard.getByTestId('beat-shown').innerText(), /^Custom graphic: Drawn for the key line/)
  const writes = asked.filter((a) => !a.grade && !a.fill)
  assert.equal(writes.length, 1); assert.equal(asked.filter((a) => a.grade).length, 1)
  assert.match(writes[0].user, /Most@/); assert.equal(writes[0].model, 'anthropic/claude-opus-5.5')
  assert.match(writes[0].user, /STRESSED WORDS .*coaches@/)
  // The beat sheet shows the video's visual world in one line; the member can write their own.
  const worldRow = panel.getByTestId('custom-world')
  await worldRow.getByTestId('custom-world-line').getByText(/leaking bucket/).waitFor()
  await worldRow.getByRole('button', { name: 'Edit' }).click()
  await worldRow.getByRole('textbox', { name: 'Visual world' }).fill('A bucket with a hole · bucket, client dots')
  await worldRow.getByRole('button', { name: 'Save' }).click()
  await worldRow.getByTestId('custom-world-line').getByText('A bucket with a hole · bucket, client dots').waitFor()
  if (shotPath) {
    await customCard.scrollIntoViewIfNeeded()
    await new Promise((resolve) => setTimeout(resolve, 800))
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(shotPath, Buffer.from(png, 'base64'))
  }
  // A note designs just this one again (the note goes to the writer).
  const customKey = await customCard.getAttribute('data-beat')
  const number = (await keys()).indexOf(customKey) + 1
  await sheet.getByRole('button', { name: `Add a note to beat ${number}`, exact: true }).click()
  await sheet.getByRole('textbox', { name: `Note for beat ${number}` }).fill('make the words bigger')
  await sheet.getByRole('button', { name: 'Design again' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="beat-custom-badge"]').length === 1 && !document.querySelector('[data-testid="beat-sheet"] button[aria-busy="true"]'))
  await new Promise((resolve) => setTimeout(resolve, 500))
  const second = asked.filter((a) => !a.grade && !a.fill).at(-1)
  assert.match(second.user, /THE CREATOR'S NOTE FOR THIS GRAPHIC.*make the words bigger/)
  // Use the template: back to the planned statement.
  await sheet.getByRole('button', { name: /^Use the template on beat / }).click()
  await badge.waitFor({ state: 'detached' })
  await sheet.getByTestId('beat-shown').getByText(/Most coaches lose clients\./).waitFor()
  // My motion library: the swap gallery's My graphics tab shows the kept graphics as moving tiles; Add fills one with
  // the words said on this beat (a small call, no new design).
  const back = (await keys()).findIndex((key) => key.startsWith('g:')) + 1
  await sheet.getByRole('button', { name: `Swap the visual of beat ${back}`, exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Swap the visual' })
  await gallery.getByRole('radio', { name: 'My graphics' }).click()
  const tiles = gallery.getByTestId('library-tile')
  await tiles.first().waitFor()
  await gallery.getByText(/Used in 1 video/).first().waitFor()
  await tiles.first().getByRole('button', { name: /^Add library graphic/ }).click()
  await gallery.waitFor({ state: 'detached', timeout: 120000 })
  await badge.waitFor({ timeout: 60000 })
  // Then the reel: its editor project carries the custom graphic, drawn in the bake.
  await page.getByRole('button', { name: 'Looks good, render' }).click()
  await page.getByText('Your reel is ready').waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  const project = JSON.parse(fs.readFileSync(path.join(library, run, 'editor-project.json'), 'utf8'))
  const custom = project.candidates[0].graphics.find((g) => g.template === 'custom')
  assert.ok(custom, JSON.stringify(project.candidates[0].graphics.map((g) => g.template)))
  assert.match(custom.fields.comp, /^[a-f0-9]{16}$/)
  assert.ok(!project.candidates[0].graphics.some((g) => Object.values(g.fields).some((v) => /Most coaches lose clients/.test(v))), 'the statement was replaced, not doubled')
  const customDir = path.join(library, run, '.graphics', 'custom')
  assert.ok(fs.existsSync(path.join(customDir, `${custom.fields.comp}.html`)))
  assert.equal(project.candidates[0].status, 'baked')
  // The bake drew it in the sandbox: one more transparent render in the run's graphics cache.
  assert.ok(fs.readdirSync(path.join(library, run, '.graphics')).some((name) => /^[a-f0-9]{64}\.mov$/.test(name)))
  // The editor shows what it is and its stills, and the template it can go back to.
  const info = await page.evaluate(({ dir, comp }) => window.bridgeclip.editor.customInfo(dir, comp), { dir: path.join(library, run), comp: custom.fields.comp })
  assert.equal(info.stills.length, 4); assert.ok(['statement', 'fx'].includes(info.fallback.template), info.fallback.template); assert.match(Object.values(info.fallback.fields).join(' '), /Most coaches lose clients/)
  // Designed twice (the first time, and with the note); the third time it came from My motion library (a fill, no new design).
  assert.equal(asked.filter((a) => !a.grade && !a.fill).length, 2)
  assert.equal(asked.filter((a) => a.fill && !a.world).length, 1)
  assert.equal(asked.filter((a) => a.world).length, 1, 'one visual world for the video')
  assert.match(writes[0].user, /THE VIDEO'S HERO OBJECT AND MOTIF .*leaking bucket/)
  // Designed again after the member wrote the world: the writer got theirs.
  assert.match(asked.filter((a) => !a.grade && !a.fill).at(-1).user, /THE VIDEO'S HERO OBJECT AND MOTIF .*A bucket with a hole/)
  const kept = await page.evaluate(() => window.bridgeclip.library.list())
  assert.ok(kept.length >= 1 && kept.every((item) => item.status === 'active'), JSON.stringify(kept))
  assert.ok(kept.every((item) => item.stills.length === 4), JSON.stringify(kept))
  assert.deepEqual(errors, [])
})
