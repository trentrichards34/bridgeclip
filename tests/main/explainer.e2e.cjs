// The Explainer style in Edit my recording, in the app on a ~40-second take: switched on in the review's Skills (an
// OpenRouter key is saved) with its estimate; making the reel cuts it into sections, one plan call picks the hero object
// and each section's label, and each section is written as ONE continuous composition (a stand-in model writes it from
// the brief and passes its grade). The reel's editor project is the paper page: the speaker cut out over the whole reel,
// no hook text, one custom graphic per section in the Explainer's band, all drawn in the bake.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'fake-custom-graphics', 'explainer.html'), 'utf8')

function say(text, start, step = 0.5) {
  return text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step - 0.05).toFixed(3), type: 'word' }))
}
const LINES = [
  'Most people trying to sell products never make sales.', 'They post every day and nothing happens.', 'I have sold my product for years.',
  'They think they need a huge audience to sell anything online.', 'But the order is backwards.', 'Build the product first.',
  'Then find the people who want the product.', 'So the product comes first and the audience comes second.',
  'Here is the secret.', 'Show the outcome, not the product.', 'People buy the outcome every single time.', 'Comment sprint below.'
]
const TAKE = []
let at = 0.5
for (const line of LINES) { const words = say(line, at); TAKE.push(...words); at = words.at(-1).end + 1.15 }
const END = at + 0.5

test('Edit my recording: the Explainer style draws each section as one composition on the paper page', { timeout: 1800000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-explainer-e2e-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const recording = path.join(root, 'my take.mp4')
  const expr = TAKE.map((w) => `between(t,${w.start},${w.end})`).join('+')
  // A person on camera (the engine's portrait fixture, gently moving): the face check sees a face, so the page is drawn.
  const portrait = path.join(__dirname, '..', '..', 'engine', 'tests', 'fixtures', 'portrait_person.jpg')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-r', '30', '-i', portrait, '-f', 'lavfi', '-i', `aevalsrc='0.25*sin(2*PI*300*t)*(${expr})':s=48000:d=${END.toFixed(2)}`,
    '-filter_complex', "[0:v]scale=764:1306:flags=lanczos,crop=720:1280:x='22+14*sin(2*PI*t/4)':y='13+9*sin(2*PI*t/3)',format=yuv420p[v]", '-map', '[v]', '-map', '1:a',
    '-t', END.toFixed(2), ...tools.encoder, '-c:a', 'aac', '-shortest', recording])
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai-edit')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))

  // The stand-in OpenRouter: the transcription; the Explainer's plan, writer and grader; the hero custom graphics' calls.
  const asked = []
  const reply = (res, content, cost) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { cost } })) }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.url === '/api/v1/chat/completions') {
        const json = JSON.parse(body)
        const system = json.messages[0].content[0].text
        const user = json.messages[1].content
        const grade = Array.isArray(user)
        const plan = !grade && /THE HERO OBJECT/.test(system) && /illustrated explainer/.test(system)
        asked.push({ grade, plan, section: !grade && /^SECTION: section/m.test(user), user: grade ? user.map((p) => p.text ?? '').join('\n') : user })
        if (plan) {
          const n = (/THE SECTIONS \((\d+)/.exec(user) ?? [])[1]
          const labels = ['products', 'backwards', 'secret', 'outcome', 'product']
          return reply(res, JSON.stringify({ hero: { label: 'product', look: 'a flat card labeled product, ink outline' },
            sections: Array.from({ length: Number(n) }, (_, i) => ({ label: labels[i % labels.length], idea: 'the product card changes', starts: 'the card', ends: 'the card' })) }), 0.01)
        }
        if (grade) return reply(res, '{"pass": true, "score": 8, "failed": [], "fixes": []}', 0.012)
        const seconds = /data-duration="([\d.]+)"/.exec(user)?.[1] ?? '3.00'
        if (!/^SECTION: section/m.test(user)) return reply(res, '```html\n' + fs.readFileSync(path.join(__dirname, 'fake-custom-graphics', 'coaches.html'), 'utf8').replace(/data-duration="[\d.]+"/, `data-duration="${seconds}"`) + '\n```', 0.05)
        const n = (/\/\/ (\d\d) — /.exec(user) ?? [])[1] ?? '01'
        const label = (/\/\/ \d\d — ([a-z ]+)"/.exec(user) ?? [])[1] ?? 'product'
        const cues = [...user.matchAll(/(\S+)@(\d+\.\d\d)/g)].map((m) => Number(m[2])).filter((c, i, all) => c > 0.3 && (i === 0 || c - all[i - 1] > 1.2)).slice(0, 12)
        const html = TEMPLATE.replaceAll('{{DUR}}', seconds).replaceAll('{{N}}', n).replaceAll('{{LABEL}}', label).replaceAll('{{HERO}}', 'product')
          .replaceAll('{{STAMP}}', 'first').replaceAll('{{CUES}}', cues.join(', '))
        return reply(res, '```html\n' + html + '\n```', 0.08)
      }
      if (req.url === '/api/v1/audio/transcriptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ text: TAKE.map((w) => w.word).join(' '), words: TAKE, usage: { cost: 0.0004, seconds: 40 } }))
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
    try { await session.close() } finally { clearTimeout(stop); if (!process.env.KEEP_EXPLAINER_RUN) fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1400, 1100); window.webContents.setBackgroundThrottling(false) })
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

  // Skills: the Explainer style is off until switched on; then it says how many sections and what they cost.
  const skill = page.locator('[data-skill="explainer"]')
  await skill.waitFor()
  const toggle = skill.locator('[role="switch"]')
  assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-checked'), 'true')
  await skill.getByText(/Your AI draws [2-9] sections, each one illustration that changes on every line.*About \$/).waitFor({ timeout: 30000 })

  await page.getByRole('button', { name: 'Make my reel' }).click()
  const offer = page.getByRole('dialog', { name: 'See your beats first?' })
  if (await offer.isVisible().catch(() => false) || await offer.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) await offer.getByRole('button', { name: 'Render now' }).click()
  for (let k = 0; ; k++) {
    const st = await page.evaluate(() => window.bridgeclip.edit.status())
    if (st?.phase === 'done') break
    assert.ok(!st?.error && k < 600, `the reel failed: ${st?.error ?? st?.phase}`)
    await new Promise((r) => setTimeout(r, 2500))
  }
  await page.getByText('Your reel is ready').waitFor({ timeout: 60000 })

  const run = fs.readdirSync(library).find((name) => /^edit-[0-9a-f-]{36}$/.test(name))
  const project = JSON.parse(fs.readFileSync(path.join(library, run, 'editor-project.json'), 'utf8'))
  const c = project.candidates[0]
  // One plan call; one section composition per section, each told its section line and its zones.
  const plans = asked.filter((a) => a.plan), sections = asked.filter((a) => a.section)
  assert.equal(plans.length, 1)
  const count = Number(/THE SECTIONS \((\d+)/.exec(plans[0].user)[1])
  assert.ok(count >= 2 && count <= 10, String(count))
  assert.equal(sections.length, count)
  // (Two sections are designed at a time: their requests may come in either order.)
  const first = sections.find((r) => /^SECTION: section 1 of/m.test(r.user))
  assert.match(first.user, /ZONES .*THE SECTION LINE.*\/\/ 01 — products/s)
  assert.match(first.user, /THE CAPTIONS' ZONE, y \d+-\d+: keep it completely EMPTY/)
  assert.ok(sections.every((r) => /THE HERO OBJECT of the whole video \("product"\)/.test(r.user)))
  assert.ok(!asked.some((a) => !a.grade && !a.plan && !a.section), 'the hero custom graphics step stands aside when the Explainer drew the reel')
  // The page: the speaker cut out on paper over the whole reel, no hook text, a canvas per section in the Explainer's band.
  assert.equal(c.hook, null)
  assert.ok(c.stage_scenes.length >= 1 && c.stage_scenes.every((s) => s.scene === 'stage' && s.backdrop === 'paper' && s.card === 'cutout'), JSON.stringify(c.stage_scenes))
  assert.equal(c.stage_scenes[0].start_ms, 0)
  const canvases = c.graphics.filter((g) => g.template === 'custom' && g.fields.scene === 'explainer')
  assert.equal(canvases.length, count)
  // They follow one another (each to the next section's first word) and no planned template card plays over them.
  for (let i = 1; i < canvases.length; i++) assert.ok(Math.abs(canvases[i - 1].at_ms + canvases[i - 1].duration_ms - canvases[i].at_ms) < 600, JSON.stringify(canvases.map((g) => [g.at_ms, g.duration_ms])))
  const others = c.graphics.filter((g) => g.template !== 'custom' && !['link_cta', 'comment_cta', 'logo', 'chapter'].includes(g.template))
  assert.ok(others.every((g) => !canvases.some((s) => g.at_ms >= s.at_ms && g.at_ms < s.at_ms + s.duration_ms)), JSON.stringify(others.map((g) => [g.template, g.at_ms])))
  assert.equal(c.status, 'baked')
  // Baked: one transparent render per canvas in the run's graphics cache; the reel's frame shows the paper.
  const movs = fs.readdirSync(path.join(library, run, '.graphics')).filter((name) => /^[a-f0-9]{64}\.mov$/.test(name))
  assert.ok(movs.length >= count, String(movs.length))
  const output = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8')).clips[0].s3_url.replace(/^file:\/\//, '')
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', '6', '-i', output, '-frames:v', '1', '-vf', 'scale=108:192', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const px = (x, y) => [...raw.subarray((y * 108 + x) * 3, (y * 108 + x) * 3 + 3)]
  const paperish = ([r, g, b]) => r > 215 && g > 210 && b > 200 && r - b < 30
  assert.ok(paperish(px(4, 120)) && paperish(px(103, 120)), JSON.stringify([px(4, 120), px(103, 120)]))
  assert.deepEqual(errors, [])
})
