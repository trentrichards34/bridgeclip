// Custom graphics, end to end in the real app: the owner's real run moments (run 4: the opening twist, the 3-step
// staircase, organic content vs ads, the $8,188 proof, and the "3 million" stat) go through the whole producer loop
// with a fake model (tests/main/fake-custom-graphics: our own compositions as its answers, a grader that fails some
// once) — first one call proposes the video's visual world, then each moment is written inside it with its stressed
// words, checked, rendered in the sandbox over a real frame (four stills and the motion check), graded, revised or
// dropped — and the bake draws one into a transparent video. Then the sandbox is attacked: compositions that reach for the network, eval code,
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
  { name: 'staircase', kind: 'process', frame: 'visual', atMs: 35320, durationMs: 12000, planned: 'Staircase: a product / an offer / attract eyeballs (lights up as said)', still: 40 },
  { name: 'three-million', kind: 'proof', frame: 'stage', atMs: 71900, durationMs: 4500, planned: 'Stat counter: 3 million, people every single week', still: 72.5 },
  { name: 'organic-vs-ads', kind: 'comparison', frame: 'visual', atMs: 149493, durationMs: 12000, planned: 'Wrong / right: organic content (wrong) vs ads', still: 152 },
  { name: 'proof', kind: 'proof', frame: 'stage', atMs: 196793, durationMs: 4500, planned: 'Stat counter: $8,188, generating', still: 198 }
]

/** The world the fake model proposes for this video (from its own words: eyeballs, reaches a few people, a virtual nobody, the three things). */
const WORLD = { idea: 'Eyeballs as light: a nobody points a beam of attention, and people dots gather where it lands: a few with organic content, a crowd with ads, climbing the blocks of a business.',
  elements: ['people dots', 'an eye', 'a reach beam', 'building blocks', 'the nobody figure'], style: 'flat line art, thick round 9 px strokes, lime light on what works, dots that gather and shuffle', accent: '#9BE35A' }

/** The fake model: the world, compositions by moment and try; grades that fail some once (and "3 million" always: it shows an unsaid number). */
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
      const system = json.messages?.[0]?.content?.[0]?.text ?? ''
      if (/WORLD NOTE/.test(system)) answer = '```json\n' + JSON.stringify(WORLD) + '\n```'
      // The scene plan: the planner wants a scene on every stretch (our rules keep the member's Scenes choice).
      else if (/become designed SCENES/.test(system)) {
        const n = (text.match(/^\d+\. \(/gm) || []).length
        answer = JSON.stringify({ hero: 'your business: building blocks that stack up as each part is said', motif: 'people dots gathering', stretches: Array.from({ length: n }, () => ({ scene: true, frame: 'stage', label: '', idea: 'blocks stack up', kind: 'teaching' })) })
      }
      else if (isGrade) {
        const m = graded(text)
        const n = (grades.get(m?.name) ?? 0) + 1
        grades.set(m?.name, n)
        const machine = /Our automatic checks found/.test(text)
        answer = m?.name === 'organic-vs-ads' && n === 1
          ? { pass: false, score: 5, failed: ['design'], fixes: ['Make the "vs" larger (90 px) and give the ads crowd one more row of space below the label.'] }
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
  // One visual world for the video, before any graphic.
  const proposed = await session.app.evaluate(async (_electron, { input, endpoint }) => globalThis.__bridgeclipCustomGraphics.world(input, endpoint),
    { input: { transcript: RUN.map((w) => w.word).join(' '), moments: MOMENTS.map((m) => ({ kind: m.kind, words: said(m.atMs, m.atMs + m.durationMs) })), model: 'anthropic/claude-opus-5.5' }, endpoint })
  assert.equal(proposed.world.idea, WORLD.idea)
  // Scenes, Light: the planner is told the count, and the reel gets that many scenes spread to its ending (Full: today's many).
  const sceneWords = RUN.map((w, i) => ({ ...w, index: i }))
  const reelEnd = RUN[RUN.length - 1].end_ms
  const plans = {}
  for (const amount of ['light', 'full']) {
    plans[amount] = await session.app.evaluate(async (_electron, { input, endpoint }) => globalThis.__bridgeclipCustomGraphics.scenes(input, endpoint),
      { input: { words: sceneWords, endMs: reelEnd, amount, model: 'anthropic/claude-opus-5.5' }, endpoint })
    assert.ok(plans[amount].fromModel, `${amount}: the model's plan was used`)
  }
  const lightCount = Math.round(reelEnd / 60000)
  const planCall = fake.requests.filter((r) => /become designed SCENES/.test(r.messages[0].content[0].text ?? r.messages[0].content))
  assert.match(String(planCall[0].messages[1].content), new RegExp(`chose ${lightCount} scenes`))
  assert.doesNotMatch(String(planCall[1].messages[1].content), /HOW MANY SCENES/)
  assert.equal(plans.light.picked.length, lightCount, JSON.stringify(plans.light))
  assert.ok(plans.light.scenes.length >= lightCount - 1 && plans.light.scenes.length <= lightCount)
  assert.ok(plans.full.picked.length > plans.light.picked.length + 2, JSON.stringify(plans.full))
  const lastLight = plans.light.scenes[plans.light.scenes.length - 1]
  assert.ok(lastLight.atMs >= reelEnd - reelEnd / lightCount - 20000, `Light reaches the ending (${lastLight.atMs} of ${reelEnd})`)
  const results = []
  for (const m of MOMENTS) {
    const frame = framePng(root, m.still)
    const input = { run, words: said(m.atMs, m.atMs + m.durationMs), said: RUN, frame, fallback: { template: 'stat', fields: {}, duration_ms: 3000, placement: 'top' }, model: 'anthropic/claude-opus-5.5', maxRevisions: 2, m,
      cues: cues(m), before: said(m.atMs - 9000, m.atMs - 1200), after: said(m.atMs + m.durationMs, m.atMs + m.durationMs + 5000), world: proposed.world }
    const result = await session.app.evaluate(async (_electron, { input, endpoint }) => {
      const h = globalThis.__bridgeclipCustomGraphics
      const m = input.m
      const geometry = h.shared.customGeometry(m.frame, { hook: m.frame === 'card' ? 0.17 : 0, cardBox: m.frame === 'card' ? { top: 0.4125, bottom: 0.6823 } : null })
      const look = h.shared.customLook({ kind: m.frame, brandColor: null, font: 'serif', worldAccent: input.world.accent })
      const brief = { kind: m.kind, frame: m.frame, cues: input.cues, before: input.before, after: input.after, planned: m.planned, durationMs: m.durationMs, geometry, look,
        world: input.world, stressed: h.shared.stressedWords(input.cues, m.durationMs), ...(m.name === 'proof' ? { saidNumbers: ['$4,365'] } : {}) }
      const rest = { ...input }
      for (const key of ['m', 'cues', 'before', 'after', 'world']) delete rest[key]
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
  // Every graphic was designed inside the one world, built on its stressed words, and kept moving (no flat stretch over 1.5 s).
  const writes = fake.requests.filter((r) => typeof r.messages[1].content === 'string' && !/WORLD NOTE|become designed SCENES/.test(r.messages[0].content[0].text))
  assert.ok(writes.length >= 5 && writes.every((r) => /THE VIDEO'S HERO OBJECT AND MOTIF .*Eyeballs as light/.test(r.messages[1].content) && /STRESSED WORDS /.test(r.messages[1].content)))
  for (const name of ['opening-claim', 'staircase', 'organic-vs-ads', 'proof']) assert.deepEqual(by[name].meta.flat, [], `${name} never holds still`)
  assert.ok(by.staircase.meta.builds >= 10, `the staircase builds on ${by.staircase.meta.builds} words`)
  // The motion check measures the real sandbox: a card that lands and then holds still is flat until it leaves.
  const held = await session.app.evaluate(async () => {
    const h = globalThis.__bridgeclipCustomGraphics
    const html = '<div id="cg-root" data-duration="4.00"><div class="t">a few people</div></div><style>#cg-root .t{position:absolute;left:80px;top:200px;font-size:80px;color:#fff}</style><script>const tl = gsap.timeline({ paused: true }); tl.from(\'#cg-root .t\', { y: 30, autoAlpha: 0, duration: 0.4 }, 0.2).to(\'#cg-root .t\', { autoAlpha: 0, duration: 0.3 }, 3.6); window.__timelines = [tl];</script>'
    const r = await h.stills({ html, geometry: h.shared.customGeometry('visual', { hook: 0 }), look: h.shared.customLook({ kind: 'visual', font: 'clean' }), durationMs: 4000, times: [300, 1000, 2000, 3500], frame: null, scale: 0.25, motionStepMs: 100 })
    return { steps: r.motion.change.length, flats: h.shared.flatStretches(r.motion.change, r.motion.visible) }
  })
  assert.equal(held.steps, 41)
  assert.equal(held.flats.length, 1); assert.ok(held.flats[0].fromMs <= 700 && held.flats[0].toMs >= 3500, JSON.stringify(held.flats))
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
  for (const name of [`${comp}.html`, `${comp}.json`, `${comp}-0.png`, `${comp}-1.png`, `${comp}-2.png`, `${comp}-3.png`, `${comp}-review.jpg`]) assert.ok(kept.includes(name), name)
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
    const times = (m) => { const c = cues(m).filter((x) => x.at >= 0).map((x) => x.at * 1000); const d = Math.max(600, m.durationMs), last = c.length ? Math.max(...c.filter((x) => x < d)) : 0
      const entry = Math.min(d * .3, Math.max(250, (c[0] ?? 0) + 280)), settled = Math.max(entry + 400, Math.min(d - 700, Math.max(d * .55, last + 900))), exit = Math.max(settled + 100, d - 520)
      const inside = c.filter((x) => x < d), middle = inside.length > 2 ? inside[Math.floor(inside.length / 2)] + 300 : (entry + settled) / 2
      return [entry, Math.max(entry + 100, Math.min(settled - 100, middle)), settled, Math.min(d - 80, exit)].map((t) => `${(t / 1000).toFixed(1)} s`) }
    const rows = results.filter(({ result }) => result.meta).map(({ m, result }) => ({ label: `${m.name}  ·  ${result.tries} ${result.tries === 1 ? 'try' : 'tries'}  ·  score ${result.meta.grade.score}  ·  ${m.frame}  ·  builds on ${result.meta.builds ?? 0} words  ·  flat: ${result.meta.flat?.length ? result.meta.flat.map((f) => `${(f.fromMs / 1000).toFixed(1)}-${(f.toMs / 1000).toFixed(1)} s`).join(', ') : 'none'}`,
      times: times(m), file: path.join(run, '.graphics', 'custom', `${result.meta.comp}-review.jpg`) }))
    const py = path.join(ROOT, 'engine/.venv/bin/python')
    execFileSync(py, ['-c', `
import json, sys
from PIL import Image, ImageDraw, ImageFont
import textwrap
rows = json.loads(sys.argv[1]); out = sys.argv[2]; world = sys.argv[4]
ims = [Image.open(r['file']).convert('RGB') for r in rows]
w = max(i.width for i in ims); pad = 56; foot = 34
try:
    font = ImageFont.truetype(sys.argv[3], 24); small = ImageFont.truetype(sys.argv[3], 20)
except Exception:
    font = small = ImageFont.load_default()
head = textwrap.wrap('Visual world: ' + world, 110)
top = 20 + 30 * len(head) + 10
sheet = Image.new('RGB', (w + 40, top + sum(i.height + pad + foot for i in ims) + 10), (18, 18, 22))
d = ImageDraw.Draw(sheet)
for k, line in enumerate(head): d.text((20, 14 + 30 * k), line, fill=(155, 227, 90), font=font)
y = top
for r, im in zip(rows, ims):
    d.text((20, y + 12), r['label'], fill=(235, 235, 240), font=font)
    sheet.paste(im, (20, y + pad - 6))
    cell = (im.width + 12) / len(r['times'])
    for k, t in enumerate(r['times']): d.text((20 + k * cell + 6, y + pad - 6 + im.height + 6), t, fill=(170, 170, 180), font=small)
    y += im.height + pad + foot
sheet.save(out)
`, JSON.stringify(rows), process.env.CUSTOM_GRAPHICS_SHEET, path.join(ROOT, 'engine/assets/fonts/PlusJakartaSans.ttf'), `${WORLD.idea} · ${WORLD.elements.join(', ')}`])
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
  // (A navigation that starts can stop the page before our runtime runs: then the graphic simply isn't drawn.)
  assert.ok(nav.ok || /didn’t start|didn't start|stopped|load|draw/.test(nav.error), nav.error)
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
