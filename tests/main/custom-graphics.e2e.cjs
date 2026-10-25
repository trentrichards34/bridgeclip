// Custom graphics, end to end in the real app: the owner's real run moments (run 4: the opening twist, the 3-step
// staircase, organic content vs ads, the $8,188 proof, and the "3 million" stat) go through the whole producer loop
// with a fake model (tests/main/fake-custom-graphics: our own compositions as its answers, a grader that fails some
// once) — written, checked, rendered in the sandbox over a real frame, graded, revised or dropped — and the bake draws
// one into a transparent video. Then the sandbox is attacked: compositions that reach for the network, eval code,
// open frames, loop forever, draw a huge DOM or navigate are refused or timeboxed, and nothing leaves.
//
// CUSTOM_GRAPHICS_SHEET=<png> also saves the stills as a contact sheet (one row per moment, over the video).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const ROOT = path.resolve(__dirname, '../..')
const FAKE = path.join(__dirname, 'fake-custom-graphics')
const RUN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/custom-graphics-run.json'), 'utf8')).words
const SOURCE = '/mnt/user-data/uploads/trentrichards--CreatorClips/edit-5a344dcc-3246-4c90-bf4f-8420091ea720/editor-source.mp4'

/** The owner's run 4 hero moments (reel ms), as the director picks them (pickHeroMoments on its graphics). */
const MOMENTS = [
  { name: 'opening-claim', kind: 'claim', frame: 'card', placement: 'bottom', atMs: 53, durationMs: 6550, planned: '(none: the opening line)', still: 2.6 },
  { name: 'staircase', kind: 'process', frame: 'visual', atMs: 35320, durationMs: 13030, planned: 'Staircase: a product / an offer / attract eyeballs (lights up as said)', still: 40 },
  { name: 'three-million', kind: 'proof', frame: 'stage', atMs: 71900, durationMs: 4500, planned: 'Stat counter: 3 million, people every single week', still: 72.5 },
  { name: 'organic-vs-ads', kind: 'comparison', frame: 'visual', atMs: 149493, durationMs: 13140, planned: 'Wrong / right: organic content (wrong) vs ads', still: 152 },
  { name: 'proof', kind: 'proof', frame: 'stage', atMs: 196793, durationMs: 4500, planned: 'Stat counter: $8,188, generating', still: 198 }
]

/** The fake model: compositions by moment and try; grades that fail some once (and "3 million" always: it shows an unsaid number). */
function fakeModel() {
  const tries = new Map(), grades = new Map(), requests = []
  // The writer's brief names the planned graphic; the grade quotes the moment's words.
  const which = (text) => MOMENTS.find((m) => text.includes(m.planned))
  const graded = (text) => MOMENTS.find((m) => text.includes(`The moment says: "${said(m.atMs, m.atMs + m.durationMs).split(' ').slice(0, 6).join(' ')}`))
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const json = JSON.parse(body || '{}')
      requests.push(json)
      const user = json.messages?.[1]?.content
      const isGrade = Array.isArray(user)
      const text = isGrade ? user.map((p) => p.text ?? '').join('\n') : String(user)
      let answer
      if (isGrade) {
        const m = graded(text)
        const n = (grades.get(m?.name) ?? 0) + 1
        grades.set(m?.name, n)
        const machine = /Our automatic checks found/.test(text)
        answer = m?.name === 'organic-vs-ads' && n === 1
          ? { pass: false, score: 6, failed: ['design'], fixes: ['Make the "vs" larger (90 px) and give the ads crowd one more row of space below the label.'] }
          : machine ? { pass: false, score: 5, failed: ['readable'], fixes: ['Fix what the automatic checks found.'] } : { pass: true, score: 8, failed: [], fixes: [] }
        answer = '```json\n' + JSON.stringify(answer) + '\n```'
      } else {
        const m = which(text)
        const n = (tries.get(m?.name) ?? 0) + 1
        tries.set(m?.name, n)
        const seconds = /data-duration="([\d.]+)"/.exec(text)?.[1] ?? '4.00'
        let html = m && fs.existsSync(path.join(FAKE, `${m.name}.html`)) ? fs.readFileSync(path.join(FAKE, `${m.name}.html`), 'utf8') : fs.readFileSync(path.join(FAKE, 'proof.html'), 'utf8').replace(/\$8,188/g, '10 million').replace(/money = \{ v: 8188 \}/, 'money = { v: 10 }')
        // The staircase's first try sets its labels too small (our own check catches it); organic's second try answers the grader's fix.
        if (m?.name === 'staircase' && n === 1) html = html.replace('font-size:54px;line-height:1.05', 'font-size:28px;line-height:1.05')
        if (m?.name === 'organic-vs-ads' && n >= 2) html = html.replace('font-size:64px;line-height:1;color:var(--cg-muted)', 'font-size:90px;line-height:1;color:var(--cg-muted)')
        html = html.replace(/data-duration="[\d.]+"/, `data-duration="${seconds}"`)
        answer = 'Here is the composition.\n```html\n' + html + '\n```'
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: isGrade ? 2800 : 4100, completion_tokens: isGrade ? 120 : 2500, cost: isGrade ? 0.016 : 0.081 } }))
    })
  })
  return { server, tries, grades, requests }
}

function framePng(dir, seconds) {
  const out = path.join(dir, `frame-${seconds}.jpg`)
  if (fs.existsSync(SOURCE)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(seconds), '-i', SOURCE, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '4', out])
  else execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x6b5a4e:s=540x960,drawbox=x=170:y=180:w=200:h=260:color=0xd9b59a:t=fill', '-frames:v', '1', out])
  return `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`
}

function cues(m) {
  const from = m.atMs - 1200, to = m.atMs + m.durationMs
  return RUN.filter((w) => w.start_ms >= from && w.start_ms < to).map((w) => ({ word: w.word, at: Math.round((w.start_ms - m.atMs) / 10) / 100 }))
}
const said = (from, to) => RUN.filter((w) => w.start_ms >= from && w.start_ms < to).map((w) => w.word).join(' ')

test('custom graphics: the owner\'s run moments go through write → render → grade → revise, and one bakes', { timeout: 900000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-custom-graphics-'))
  const fake = fakeModel()
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${fake.server.address().port}/api/v1/chat/completions`
  const appDir = buildApp(process.env.BRIDGECLIP_E2E_APP_DIR || path.join(root, 'app'))
  if (!fs.existsSync(path.join(appDir, 'engine'))) fs.symlinkSync(path.join(ROOT, 'engine'), path.join(appDir, 'engine'))
  const session = await launchApp({ appDir, userDataDir: path.join(root, 'user-data') })
  t.after(async () => {
    fake.server.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const run = path.join(root, 'run')
  fs.mkdirSync(run, { recursive: true })
  const results = []
  for (const m of MOMENTS) {
    const frame = framePng(root, m.still)
    const input = { run, words: said(m.atMs, m.atMs + m.durationMs), said: RUN, frame, fallback: { template: 'stat', fields: {}, duration_ms: 3000, placement: 'top' }, model: 'anthropic/claude-opus-5.5', maxRevisions: 2, m,
      cues: cues(m), before: said(m.atMs - 9000, m.atMs - 1200), after: said(m.atMs + m.durationMs, m.atMs + m.durationMs + 5000) }
    const result = await session.app.evaluate(async (_electron, { input, endpoint }) => {
      const h = globalThis.__bridgeclipCustomGraphics
      const m = input.m
      const geometry = h.shared.customGeometry(m.frame, { hook: m.frame === 'card' ? 0.17 : 0, cardBox: m.frame === 'card' ? { top: 0.4125, bottom: 0.6823 } : null })
      const look = h.shared.customLook({ kind: m.frame, brandColor: null, font: 'serif' })
      const brief = { kind: m.kind, frame: m.frame, cues: input.cues, before: input.before, after: input.after, planned: m.planned, durationMs: m.durationMs, geometry, look,
        ...(m.name === 'proof' ? { saidNumbers: ['$4,365'] } : {}) }
      const rest = { ...input }
      for (const key of ['m', 'cues', 'before', 'after']) delete rest[key]
      return h.produce({ ...rest, brief }, endpoint)
    }, { input, endpoint })
    results.push({ m, result })
  }
  const by = Object.fromEntries(results.map(({ m, result }) => [m.name, result]))
  // Kept: the opening, the staircase (after our own type-size check sent it back once), organic vs ads (after the grader's fix), the proof.
  for (const name of ['opening-claim', 'staircase', 'organic-vs-ads', 'proof']) assert.ok(by[name].meta, `${name} was kept (${by[name].reason ?? ''})`)
  assert.equal(by['opening-claim'].tries, 1)
  assert.equal(by.staircase.tries, 2, 'the staircase was revised once (labels too small)')
  assert.equal(by['organic-vs-ads'].tries, 2, 'organic vs ads was revised once (the grader asked)')
  // "10 million" was never said: dropped after every revision, the template stays.
  assert.equal(by['three-million'].meta, null)
  assert.equal(by['three-million'].tries, 3)
  assert.match(by['three-million'].reason, /not said/)
  // The revision prompts carry the fixes.
  const revisions = fake.requests.filter((r) => typeof r.messages[1].content === 'string' && r.messages[1].content.includes('YOUR PREVIOUS COMPOSITION'))
  assert.ok(revisions.some((r) => /at least 44 px/.test(r.messages[1].content)), 'the type-size fix went back to the writer')
  assert.ok(revisions.some((r) => /"vs" larger/.test(r.messages[1].content)), 'the grader\'s fix went back to the writer')
  // The system prompt is cacheable and the grade sends the stills as an image.
  assert.equal(fake.requests[0].messages[0].content[0].cache_control.type, 'ephemeral')
  assert.ok(fake.requests.some((r) => Array.isArray(r.messages[1].content) && r.messages[1].content[0].image_url.url.startsWith('data:image/jpeg;base64,')))
  // Files kept: the composition (named by its hash), its meta, three transparent stills and the review strip.
  const comp = by.staircase.meta.comp
  const kept = fs.readdirSync(path.join(run, '.graphics', 'custom'))
  for (const name of [`${comp}.html`, `${comp}.json`, `${comp}-0.png`, `${comp}-1.png`, `${comp}-2.png`, `${comp}-review.jpg`]) assert.ok(kept.includes(name), name)
  assert.ok(by.staircase.costUsd > 0.15 && by.staircase.costUsd < 0.3, `cost counted (${by.staircase.costUsd})`)

  // The bake: the proof, every frame in the sandbox, into a transparent QuickTime (as graphics-render does).
  const out = path.join(root, 'proof.mov')
  await session.app.evaluate(async (_electron, { run, comp, out }) => {
    const h = globalThis.__bridgeclipCustomGraphics
    const found = h.read(run, comp)
    const scene = { html: found.html, geometry: { kind: found.meta.frame, aspect: '9:16', width: 1080, height: 1920, root: { x: 0, y: 154, width: found.meta.width, height: found.meta.height }, face: null, card: null },
      look: found.meta.look, durationMs: found.meta.durationMs, place: { x: 0, y: 154, scale: 1 } }
    await h.bake(scene, out)
  }, { run, comp: by.proof.meta.comp, out })
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_frames', '-of', 'json', out], { encoding: 'utf8' })
  const stream = JSON.parse(probe).streams[0]
  assert.equal(stream.codec_name, 'qtrle'); assert.equal(stream.pix_fmt, 'argb'); assert.equal(stream.width, 1080); assert.equal(Number(stream.nb_frames), 135)

  if (process.env.CUSTOM_GRAPHICS_SHEET) {
    const rows = results.filter(({ result }) => result.meta).map(({ m, result }) => ({ label: `${m.name}  ·  ${result.tries} ${result.tries === 1 ? 'try' : 'tries'}  ·  score ${result.meta.grade.score}  ·  ${m.frame}`, file: path.join(run, '.graphics', 'custom', `${result.meta.comp}-review.jpg`) }))
    const py = path.join(ROOT, 'engine/.venv/bin/python')
    execFileSync(py, ['-c', `
import json, sys
from PIL import Image, ImageDraw, ImageFont
rows = json.loads(sys.argv[1]); out = sys.argv[2]
ims = [Image.open(r['file']).convert('RGB') for r in rows]
w = max(i.width for i in ims); pad = 56
sheet = Image.new('RGB', (w + 40, sum(i.height + pad for i in ims) + 20), (18, 18, 22))
d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype(sys.argv[3], 30)
except Exception: font = ImageFont.load_default()
y = 10
for r, im in zip(rows, ims):
    d.text((20, y + 10), r['label'], fill=(235, 235, 240), font=font)
    sheet.paste(im, (20, y + pad - 6)); y += im.height + pad
sheet.save(out)
`, JSON.stringify(rows), process.env.CUSTOM_GRAPHICS_SHEET, path.join(ROOT, 'engine/assets/fonts/PlusJakartaSans.ttf')])
  }
})

// ---------------------------------------------------------------------------
// The sandbox under attack: compositions that skip the static check (as if it missed them) run in the real sandbox.
// ---------------------------------------------------------------------------

const ROOT_OPEN = '<div id="cg-root" data-duration="2.00"><div class="t">safe words</div></div><style>#cg-root .t{position:absolute;left:60px;top:60px;font-size:60px;color:#fff}</style>'
const attack = (code) => `${ROOT_OPEN}<script>const tl = gsap.timeline({ paused: true }); tl.from('#cg-root .t', { autoAlpha: 0, duration: 0.3 }, 0); window.__timelines = [tl];\n${code}\n</script>`

test('custom graphics: the sandbox blocks the network, eval, frames and navigation, and timeboxes hangs and huge pages', { timeout: 600000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-custom-sandbox-'))
  const hits = []
  const server = http.createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok') })
  server.on('upgrade', (req, socket) => { hits.push(`upgrade ${req.url}`); socket.destroy() })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const appDir = buildApp(process.env.BRIDGECLIP_E2E_APP_DIR || path.join(root, 'app'), { skipBuild: !!process.env.BRIDGECLIP_E2E_APP_DIR })
  const session = await launchApp({ appDir, userDataDir: path.join(root, 'user-data') })
  t.after(async () => {
    server.close()
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const run = (html) => session.app.evaluate(async (_electron, html) => {
    const h = globalThis.__bridgeclipCustomGraphics
    const geometry = h.shared.customGeometry('visual', { hook: 0 })
    const look = h.shared.customLook({ kind: 'visual', font: 'clean' })
    const started = Date.now()
    try {
      const r = await h.stills({ html, geometry, look, durationMs: 2000, times: [300, 1000, 1700], frame: null, scale: 0.25 })
      return { ok: true, texts: r.texts, problems: r.problems, ms: Date.now() - started }
    } catch (error) { return { ok: false, error: String(error.message), ms: Date.now() - started } }
  }, html)

  // Every way out to the network: none reaches our server.
  const network = await run(attack(`
    try { fetch('${base}/fetch') } catch (e) {}
    try { const x = new XMLHttpRequest(); x.open('GET', '${base}/xhr'); x.send() } catch (e) {}
    try { new WebSocket('${base.replace('http', 'ws')}/ws') } catch (e) {}
    try { navigator.sendBeacon('${base}/beacon', 'x') } catch (e) {}
    try { const i = new Image(); i.src = '${base}/image' } catch (e) {}
    try { import('${base}/module.js').catch(() => {}) } catch (e) {}
    try { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '${base}/style.css'; document.head.appendChild(l) } catch (e) {}
    try { const f = document.createElement('iframe'); f.src = '${base}/frame'; document.body.appendChild(f) } catch (e) {}
    try { document.getElementById('cg-root').style.backgroundImage = 'url(${base}/css)' } catch (e) {}
    try { new EventSource('${base}/events') } catch (e) {}
    try { new Worker('${base}/worker.js') } catch (e) {}
  `) + `<img src="${base}/img-tag"><iframe src="${base}/iframe-tag"></iframe><link rel="stylesheet" href="${base}/link-tag">`)
  assert.equal(network.ok, true, network.error)
  // eval and string code don't run (CSP without unsafe-eval; only our hashed scripts).
  const evil = await run(attack(`
    try { eval("document.getElementById('cg-root').textContent = 'EVAL RAN'") } catch (e) {}
    try { new Function("document.getElementById('cg-root').textContent = 'FUNCTION RAN'")() } catch (e) {}
    try { const s = document.createElement('script'); s.textContent = "document.getElementById('cg-root').textContent = 'SCRIPT RAN'"; document.body.appendChild(s) } catch (e) {}
  `) + `<div onclick="1" id="x"></div>`)
  assert.equal(evil.ok, true, evil.error)
  assert.deepEqual(evil.texts, ['safe words'])
  // Navigation and new windows are refused (and reach nothing).
  const nav = await run(attack(`try { window.open('${base}/popup') } catch (e) {} try { location.href = '${base}/navigate' } catch (e) {}`) + `<meta http-equiv="refresh" content="0;url=${base}/refresh">`)
  assert.ok(nav.ok || /stopped|load|draw/.test(nav.error), nav.error)
  // A hang while loading, a hang while drawing a frame: stopped within the time limits.
  const hang = await run(attack('for (;;) {}'))
  assert.equal(hang.ok, false); assert.match(hang.error, /too long|stopped responding/); assert.ok(hang.ms < 20000, `load hang stopped in ${hang.ms} ms`)
  const frameHang = await run(attack("tl.eventCallback('onUpdate', () => { for (;;) {} })"))
  assert.equal(frameHang.ok, false); assert.match(frameHang.error, /stopped responding|too long/); assert.ok(frameHang.ms < 20000)
  // A huge DOM is refused.
  const huge = await run(attack("const r = document.getElementById('cg-root'); for (let i = 0; i < 6000; i++) r.appendChild(document.createElement('span'))"))
  assert.equal(huge.ok, false); assert.match(huge.error, /too many elements/)
  // After all that, the sandbox still draws a good composition, and nothing ever reached the network.
  const good = await run(fs.readFileSync(path.join(FAKE, 'proof.html'), 'utf8').replace(/data-duration="[\d.]+"/, 'data-duration="2.00"'))
  assert.equal(good.ok, true, good.error)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.deepEqual(hits, [])
  // The app's own window never moved.
  const url = await session.page.evaluate(() => location.protocol)
  assert.notEqual(url, 'http:')
})
