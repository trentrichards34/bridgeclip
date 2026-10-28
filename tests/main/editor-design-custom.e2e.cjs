// "Design a custom graphic here" in the clip editor, driven in the app on a Clip run: the gallery at the playhead
// shows what designing one costs before anything is spent, the member's note ("make it a rocket") goes to their AI
// with the words said there, the video's world is proposed once and kept, the composition is drawn and checked in the
// real sandbox, the new custom graphic lands on the Graphics track (spending ledger updated), and the clip bakes with
// it. A fake OpenRouter stands in for the model.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

const SCRIPT = 'so we only need three things a product an offer and a way to attract eyeballs that is the whole plan'
const WORLD = { idea: 'Your business: three blocks that stack up as each part is said', elements: ['blocks', 'eyeballs'], style: 'glossy panels on a dark stage', accent: null }

/** Our stand-in composition: only words said at the playhead, readable sizes, always moving. */
const composition = (seconds) => `<div id="cg-root" data-duration="${seconds}">
  <div class="panel"><div class="row r1">three things</div><div class="row r2">a product</div><div class="row r3">an offer</div></div>
</div>
<style>
#cg-root .panel{position:absolute;left:6%;right:6%;top:10%;bottom:10%;border-radius:32px;background:var(--cg-panel);display:flex;flex-direction:column;justify-content:center;gap:8px;padding:0 7%}
#cg-root .row{font-family:var(--cg-font-display);font-size:56px;line-height:1.08;color:var(--cg-ink)}
#cg-root .r1{color:var(--cg-accent)}
</style>
<script>
const D = parseFloat(document.getElementById('cg-root').dataset.duration);
const tl = gsap.timeline({ paused: true });
const idle = (sel, vars, at, beat) => { const b = beat || 0.6; let n = Math.max(1, Math.floor((D - 0.5 - at) / b) - 1); if (n % 2 === 0) n -= 1; tl.to(sel, Object.assign({ duration: b, ease: 'sine.inOut', yoyo: true, repeat: Math.max(1, n) }, vars), at); };
tl.from('#cg-root .panel', { scale: 0.94, autoAlpha: 0, duration: 0.4, ease: 'expo.out' }, 0.1)
  .from('#cg-root .r1', { y: 24, autoAlpha: 0, duration: 0.4, ease: 'expo.out' }, 0.3)
  .from('#cg-root .r2', { y: 24, autoAlpha: 0, duration: 0.4, ease: 'expo.out' }, 0.9)
  .from('#cg-root .r3', { y: 24, autoAlpha: 0, duration: 0.4, ease: 'expo.out' }, 1.5);
idle('#cg-root .r1', { x: 8 }, 0.75, 0.5);
idle('#cg-root .r2', { x: -8 }, 1.35, 0.55);
idle('#cg-root .r3', { scale: 1.04, transformOrigin: '0 50%' }, 1.95, 0.5);
tl.to('#cg-root .panel', { autoAlpha: 0, y: -16, duration: 0.3, ease: 'power2.in' }, D - 0.36);
window.__timelines = [tl];
</script>`

function fakeOpenRouter() {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      // The spending check's balance.
      if (req.url.endsWith('/credits')) { res.end(JSON.stringify({ data: { total_credits: 50, total_usage: 1 } })); return }
      if (req.url.endsWith('/key')) { res.end(JSON.stringify({ data: { limit_remaining: null } })); return }
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end('{}'); return }
      const json = JSON.parse(body || '{}')
      const system = json.messages?.[0]?.content?.[0]?.text ?? ''
      const user = json.messages?.[1]?.content
      const isGrade = Array.isArray(user)
      const text = isGrade ? user.map((p) => p.text ?? '').join('\n') : String(user)
      requests.push({ system, text, isGrade })
      let answer
      if (/WORLD NOTE/.test(system)) answer = '```json\n' + JSON.stringify(WORLD) + '\n```'
      else if (isGrade) answer = '```json\n{"pass": true, "score": 8, "failed": [], "fixes": []}\n```'
      else answer = 'Here it is.\n```html\n' + composition(/data-duration="([\d.]+)"/.exec(text)?.[1] ?? '4.00') + '\n```'
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 3000, completion_tokens: 1500, cost: isGrade ? 0.015 : 0.06 } }))
    })
  })
  return { server, requests }
}

test('clip editor: design a custom graphic at the playhead of a Clip run, with a note, see it on the track, and bake it', { timeout: 600000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const fake = fakeOpenRouter()
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${fake.server.address().port}/api/v1`
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-design-custom-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'design-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2a3340:size=540x960:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const words = SCRIPT.split(' ').map((word, i) => ({ word, start_ms: 800 + i * 320, end_ms: 800 + i * 320 + 260 }))
  const lines = []
  for (let i = 0; i < words.length; i += 12) { const part = words.slice(i, i + 12); lines.push({ start_ms: part[0].start_ms, end_ms: part.at(-1).end_ms, text: part.map((w) => w.word).join(' '), words: part }) }
  // A Clip run (Review & edit): one clip of the video, no captions (it bakes without libass).
  const project = structuredClone(fixture)
  Object.assign(project, { title: 'Design one here', width: 540, height: 960, duration_ms: 12000, aspect_ratio: '9:16', transcript: lines.map(({ start_ms, end_ms, text }) => ({ start_ms, end_ms, text })) })
  project.candidates = [{ ...project.candidates[0], title: 'The three things', ranges: [[0, 11000]], scenes: [{ at_ms: 0, layout: 'fill', crops: [[0, 0, 1, 1]] }], captions: false, video_speed: 1,
    hook: { text: 'Only three things to build it', look: { look: 'brand', color: '#2F5BFF', font: 'clean' } } }]
  delete project.candidates[0].review
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: lines.map((l) => ({ start_time_ms: l.start_ms, end_time_ms: l.end_ms, text: l.text,
    words: l.words.map((w) => ({ word: w.word, start_time_ms: w.start_ms, end_time_ms: w.end_ms })) })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'design-run', source_video_title: 'Design one here', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_URL: `${base}/chat/completions`, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: base } })
  t.after(async () => {
    fake.server.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(15000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Design one here', exact: true }).click({ timeout: 60000 })
  const editor = page.getByRole('region', { name: 'Clip editor' })
  await editor.waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const graphics = () => saved().candidates[0].graphics ?? []
  const savedWhen = async (check, what) => {
    for (let i = 0; i < 80; i++) { try { if (check(graphics())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save ${what}: ${JSON.stringify(graphics())}`)
  }

  // The member's OpenRouter key (a stand-in keychain where Linux has none, as in custom-graphics-review.e2e.cjs).
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  // The playhead on "three", then "Add graphic": the gallery offers designing one here, with what it costs, before anything is spent.
  const threeAt = words.find((w) => w.word === 'three').start_ms
  await page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(threeAt))
  await editor.getByRole('button', { name: 'Add graphic', exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Add a graphic' })
  const design = gallery.getByRole('region', { name: 'Design a custom graphic here' })
  await design.waitFor()
  const estimate = design.getByTestId('design-estimate')
  await estimate.waitFor()
  assert.match(await estimate.textContent(), /about \$0\.\d\d, at most \$\d\.\d\d/)
  await design.getByText('Dark product UI').waitFor()
  assert.equal(fake.requests.length, 0, 'nothing is spent before the member asks')
  // The template tiles are all still there (the design card is not one of them).
  assert.ok(await gallery.locator('.editor-graphic-tile').count() > 20)

  // A note, then Design it here: progress while it designs (the gallery stays), then the graphic on the track.
  await design.getByLabel('What the custom graphic should show').fill('make it a rocket')
  await design.getByRole('button', { name: 'Design it here' }).click()
  await design.getByRole('status').filter({ hasText: 'Designing…' }).waitFor()
  await gallery.waitFor({ state: 'detached', timeout: 240000 })
  await savedWhen((list) => list.some((g) => g.template === 'custom'), 'the designed graphic')
  const custom = graphics().find((g) => g.template === 'custom')
  assert.equal(custom.at_ms, threeAt)
  assert.match(custom.fields.comp, /^[0-9a-f]{16}$/)
  assert.ok(custom.duration_ms >= 3000 && custom.duration_ms <= 8000, String(custom.duration_ms))
  await page.getByRole('button', { name: /^Custom graphic at / }).waitFor()
  await page.getByTestId('custom-graphic-fields').waitFor()
  // The request: the world first (none was kept), then the writer with the words said there and the note, then the grade.
  const writes = fake.requests.filter((r) => !r.isGrade && !/WORLD NOTE/.test(r.system))
  assert.ok(fake.requests.some((r) => /WORLD NOTE/.test(r.system)))
  assert.ok(writes.length >= 1 && /three/.test(writes[0].text) && /make it a rocket/.test(writes[0].text) && /three blocks that stack up/.test(writes[0].text), writes[0]?.text)
  assert.ok(fake.requests.some((r) => r.isGrade))
  // Kept with the project: the composition, the world and the theme.
  const kept = path.join(run, '.graphics', 'custom')
  assert.ok(fs.existsSync(path.join(kept, `${custom.fields.comp}.html`)))
  assert.equal(JSON.parse(fs.readFileSync(path.join(kept, 'world.json'), 'utf8')).idea, WORLD.idea)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(kept, 'theme.json'), 'utf8')), { theme: 'dark' })
  // The spending ledger has it.
  const overview = await page.evaluate(() => window.bridgeclip.spending.overview())
  assert.ok(overview.summary.recent.some((e) => e.label === 'Custom graphic (designed here)' && e.usd > 0), JSON.stringify(overview.summary.recent))

  // Bake: the custom graphic is drawn into the clip.
  await page.getByText('All changes saved', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 240000 })
  const renders = fs.readdirSync(path.join(run, '.graphics')).filter((n) => n.endsWith('.mov'))
  assert.equal(renders.length, 1, `one graphic baked: ${renders}`)
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json')))
  assert.ok(fs.existsSync(output.clips[0].s3_url.replace(/^file:\/\//, '')))
  assert.deepEqual(errors, [])
})
