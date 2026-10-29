// A finished Remix video opens in the clip editor from the Library: the run becomes an editor project over its finished
// video (its layout, captions and hook text stay in the picture), a template graphic is added from the gallery, a custom
// graphic is designed at the playhead at Lower cost (each quality's estimate shown before anything is spent), and the
// bake replaces the Library video in place: it plays, keeps its length and hook text, and away from the new graphics the
// picture is the remix as it was. The real engine makes everything; only the paid AI steps are stood in for.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { editorTools } = require('./editor-e2e-tools.cjs')
const { launchRemix, shot } = require('./remix-e2e-setup.cjs')

const WORLD = { idea: 'A warning light that flicks on as each worry is said', elements: ['warning light'], style: 'flat, bold', accent: null }

/** Our stand-in composition: only words said at the playhead, readable sizes, always moving. */
const composition = (seconds) => `<div id="cg-root" data-duration="${seconds}">
  <div class="panel"><div class="row r1">that number</div><div class="row r2">scared me</div></div>
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
  .from('#cg-root .r2', { y: 24, autoAlpha: 0, duration: 0.4, ease: 'expo.out' }, 0.9);
idle('#cg-root .r1', { x: 8 }, 0.75, 0.5);
idle('#cg-root .r2', { x: -8 }, 1.35, 0.55);
tl.to('#cg-root .panel', { autoAlpha: 0, y: -16, duration: 0.3, ease: 'power2.in' }, D - 0.36);
window.__timelines = [tl];
</script>`

/** The stand-in OpenRouter for the custom graphic (its world, the composition and a passing grade) and the balance. */
function fakeOpenRouter() {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
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
      else answer = 'Here it is.\n```html\n' + composition(/data-duration="([\d.]+)"/.exec(text)?.[1] ?? '3.00') + '\n```'
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 3000, completion_tokens: 1500, cost: isGrade ? 0.015 : 0.06 } }))
    })
  })
  return { server, requests }
}

/** Mean RGB of a box of a frame at `seconds`. */
function boxColor(ffmpeg, video, seconds, [x, y, w, h]) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
  const sum = [0, 0, 0]
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += raw[i + c]
  return sum.map((n) => n / (raw.length / 3))
}

function probe(ffmpeg, video) {
  const ffprobe = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/^ffmpeg/, 'ffprobe'))
  const info = JSON.parse(execFileSync(fs.existsSync(ffprobe) ? ffprobe : 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video], { encoding: 'utf8' }))
  const v = info.streams.find((s) => s.codec_type === 'video')
  return { width: v.width, height: v.height, seconds: Number(info.format.duration), audio: info.streams.some((s) => s.codec_type === 'audio') }
}

test('Remix in the editor: open a finished remix from the Library, add a template graphic and a custom one, bake, and it plays', { timeout: 900000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const fake = fakeOpenRouter()
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve))
  t.after(() => fake.server.close())
  const base = `http://127.0.0.1:${fake.server.address().port}/api/v1`
  const { root, library, app, page, errors, dialogs } = await launchRemix(t, tools, 'remix-editor',
    { BRIDGECLIP_E2E_OPENROUTER_URL: `${base}/chat/completions`, BRIDGECLIP_E2E_OPENROUTER_MEDIA_URL: base })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000))
  const reel = path.join(root, 'skincare-reel.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=10', '-f', 'lavfi', '-i', 'sine=frequency=1000:d=10',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', reel])
  const take = path.join(root, 'my-take.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x406080:s=360x640:r=30:d=9', '-f', 'lavfi', '-i', 'sine=frequency=300:d=9',
    '-vf', 'drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', take])
  await dialogs([reel, take])

  // 1. A remix: their clip, then me (the member's take uploaded).
  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('radio', { name: /^Their clip, then me/ }).click()
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByText('skincare-reel.mp4').waitFor()
  await page.getByPlaceholder('e.g. @theircreator').fill('@skincoach')
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  await page.getByRole('button', { name: 'Continue to recording' }).click()
  await page.getByRole('heading', { name: 'Your clip, then you' }).waitFor({ timeout: 90000 })
  await page.evaluate(() => window.bridgeclip.remix.trim(0, 1000, 7000))
  await page.getByRole('button', { name: 'Upload a phone video' }).click()
  await page.getByLabel('Hook text, your video').waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: 'Make the video' }).click()
  await page.getByText(/^1 remix ready/).waitFor({ timeout: 300000 })
  const runName = fs.readdirSync(library).find((name) => name.startsWith('remix-'))
  const run = path.join(library, runName)
  const clipFile = path.join(run, 'clip_00.mp4')
  // A call to action at its end (a picture card), then "Free up space" removes the copy without it: the video, CTA included,
  // is all there is. The editor must not add the call to action a second time.
  const card = path.join(root, 'follow-card.png')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff00aa:s=360x640:d=1', '-frames:v', '1', card])
  await dialogs([card])
  const cta = await page.evaluate(() => window.bridgeclip.ctas.add('Follow for more'))
  const ctaId = (Array.isArray(cta) ? cta.find((c) => c.name === 'Follow for more') : cta)?.id
  assert.ok(ctaId, JSON.stringify(cta))
  const withoutCta = probe(ffmpeg, clipFile)
  await page.evaluate(([dir, id]) => window.bridgeclip.clips.setCta(dir, 0, id), [run, ctaId])
  assert.ok(fs.existsSync(path.join(run, 'clip_00.original.mp4')))
  fs.rmSync(path.join(run, 'clip_00.original.mp4'))
  const original = path.join(root, 'remix-as-made.mp4')
  fs.copyFileSync(clipFile, original)
  const made = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).clips[0]
  assert.ok(made.headline && made.editable && made.cta?.id === ctaId, JSON.stringify(made))
  const before = probe(ffmpeg, original)
  assert.ok(before.seconds > withoutCta.seconds + 1, `the call to action was added: ${before.seconds} vs ${withoutCta.seconds}`)

  // 2. The Library: the remix's ⋯ menu offers "Open in editor" (and no "Edit headline": its hook text is in the picture).
  await page.getByRole('button', { name: /^Library/ }).first().click()
  await page.getByRole('button', { name: /^Open Remix · / }).first().click()
  await page.getByRole('button', { name: 'Edit clips', exact: true }).waitFor()
  assert.equal(fs.existsSync(path.join(run, 'editor-project.json')), false)
  await page.getByRole('button', { name: /^Actions for “/ }).first().click()
  assert.equal(await page.getByRole('menuitem', { name: 'Edit headline', exact: true }).count(), 0)
  await page.getByRole('menuitem', { name: 'Open in editor', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Clip editor' })
  await editor.waitFor({ timeout: 180000 })
  await page.getByTestId('remix-editor-note').waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json'), 'utf8'))
  const project = saved()
  assert.equal(project.automatic.remix, true)
  assert.equal(project.candidates.length, 1)
  const [candidate] = project.candidates
  assert.deepEqual([candidate.library_clip, candidate.status, candidate.captions, candidate.hook, candidate.scenes[0].crops[0]], [0, 'baked', false, null, [0, 0, 1, 1]])
  // Its call to action is already in the picture: remembered, never added again.
  assert.deepEqual([candidate.cta_in_picture, candidate.cta_id], [true, null])
  assert.ok(Math.abs(candidate.ranges[0][1] - before.seconds * 1000) < 100, `${candidate.ranges[0][1]} vs ${before.seconds}`)
  assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).editor_project, true)
  // The words said, from the remix's captions, in the video's time: "Honestly…" starts the member's take after their 6 s clip.
  const words = JSON.parse(fs.readFileSync(path.join(run, 'transcript.json'), 'utf8')).segments.flatMap((s) => s.words)
  // (The stand-in transcriber hears the same sentence in their clip too.)
  const honestly = words.findLast((w) => w.word === 'Honestly')
  assert.ok(honestly && honestly.start_time_ms > 5500, JSON.stringify(words))
  await shot(app, 'remix-editor-open.png')

  // Controls that would double the text already in the picture, crop it or grade it are not offered; a line says why.
  const inspector = editor.locator('.editor-inspector')
  await inspector.getByRole('button', { name: 'Captions', exact: true }).click()
  await inspector.getByTestId('remix-unavailable').waitFor()
  assert.equal(await inspector.getByRole('switch', { name: 'Burn in captions' }).count(), 0)
  assert.equal(await inspector.getByTestId('editor-color-grade').count(), 0)
  await inspector.getByRole('button', { name: 'Hook & CTA', exact: true }).click()
  await inspector.getByTestId('remix-unavailable').waitFor()
  assert.equal(await inspector.getByRole('switch', { name: 'Hook text at the top' }).count(), 0)
  assert.equal(await inspector.getByRole('button', { name: 'Suggest hooks' }).count(), 0)
  assert.equal(await inspector.getByTestId('make-trial-reels').count(), 0)
  await inspector.getByTestId('cta-in-picture').waitFor()
  await inspector.getByRole('button', { name: 'More tabs' }).click()
  await page.getByRole('menuitemradio', { name: 'Framing' }).click()
  await inspector.getByTestId('remix-unavailable').waitFor()
  assert.equal(await inspector.getByRole('button', { name: /^Split$/ }).count(), 0)
  assert.equal(await editor.getByRole('button', { name: 'Fix layout' }).count(), 0)
  await inspector.getByRole('button', { name: 'Graphics', exact: true }).click()

  const graphics = () => saved().candidates[0].graphics ?? []
  const savedWhen = async (check, what) => {
    for (let i = 0; i < 80; i++) { try { if (check(graphics())) return } catch { /* mid-write */ } await new Promise((r) => setTimeout(r, 250)) }
    assert.fail(`the project did not save ${what}: ${JSON.stringify(graphics())}`)
  }
  // 3. A template graphic from the gallery, early in their clip.
  const slider = page.getByRole('slider', { name: 'Fine timeline position' })
  await slider.fill('1500')
  await editor.getByRole('button', { name: 'Add graphic', exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Add a graphic' })
  await gallery.getByRole('button', { name: 'Add Stat counter', exact: true }).click()
  await gallery.waitFor({ state: 'detached' })
  await savedWhen((list) => list.some((g) => g.template === 'stat'), 'the stat counter')

  // 4. A custom graphic designed where the member speaks, at Lower cost: both estimates are shown before anything is spent.
  await slider.fill(String(honestly.start_time_ms))
  await editor.getByRole('button', { name: 'Add graphic', exact: true }).click()
  const design = gallery.getByRole('region', { name: 'Design a custom graphic here' })
  await design.waitFor()
  const estimate = design.getByTestId('design-estimate')
  await estimate.waitFor()
  const bestText = await estimate.textContent()
  assert.match(bestText, /about \$0\.\d\d, at most \$\d\.\d\d/)
  await design.getByRole('radio', { name: /^Best · about \$/ }).waitFor()
  await design.getByRole('radio', { name: /^Lower cost · about \$/ }).click()
  const lowerText = await estimate.textContent()
  const most = (s) => Number(/at most \$(\d+\.\d\d)/.exec(s)[1])
  assert.ok(most(lowerText) < most(bestText), `${lowerText} vs ${bestText}`)
  assert.equal(fake.requests.length, 0, 'nothing is spent before the member asks')
  await design.getByRole('button', { name: 'Design it here' }).click()
  await gallery.waitFor({ state: 'detached', timeout: 240000 })
  await savedWhen((list) => list.some((g) => g.template === 'custom'), 'the designed graphic')
  const custom = graphics().find((g) => g.template === 'custom')
  assert.equal(custom.at_ms, honestly.start_time_ms)
  // Lower cost: one write (no revisions), graded once; the writer saw the words said there.
  const writes = fake.requests.filter((r) => !r.isGrade && !/WORLD NOTE/.test(r.system))
  assert.equal(writes.length, 1)
  assert.match(writes[0].text, /Honestly/)
  await shot(app, 'remix-editor-graphics.png')

  // 5. Bake: the Library video is replaced in place.
  await page.getByText('All changes saved', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click()
  await page.getByRole('button', { name: 'Render clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-stagebar .editor-status')?.textContent === 'Baked', undefined, { timeout: 300000 })
  const output = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
  assert.deepEqual(output.clips.map((c) => c.clip_index), [0])
  const entry = output.clips[0]
  assert.ok(entry.edited_at, JSON.stringify(entry))
  // Its hook text is still on the card (it is in the picture); "Edit hook text & captions" would undo the editor's work, so it is gone.
  assert.equal(entry.headline, made.headline)
  assert.equal(entry.editable, undefined)
  // One call to action: the card keeps it, and the video is as long as before (not a second one added).
  assert.equal(entry.cta?.id, ctaId)
  assert.equal(fs.existsSync(path.join(run, 'clip_00.original.mp4')), false)
  // It plays: decodes cleanly, same size, same length, with sound.
  execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', clipFile, '-f', 'null', '-'])
  const after = probe(ffmpeg, clipFile)
  assert.deepEqual([after.width, after.height, after.audio], [before.width, before.height, true])
  assert.ok(Math.abs(after.seconds - before.seconds) < 0.15, `${after.seconds} vs ${before.seconds}`)
  // Away from the new graphics the picture is the remix as it was; under them it changed.
  const statEnd = (graphics().find((g) => g.template === 'stat').at_ms + graphics().find((g) => g.template === 'stat').duration_ms) / 1000
  const quiet = Math.min(statEnd + 0.4, honestly.start_time_ms / 1000 - 0.3)
  for (const box of [[40, 200, 200, 200], [700, 900, 300, 300]]) {
    const was = boxColor(ffmpeg, original, quiet, box), now = boxColor(ffmpeg, clipFile, quiet, box)
    assert.ok(was.every((c, i) => Math.abs(c - now[i]) < 10), `unchanged at ${quiet}s ${box}: ${was.map(Math.round)} vs ${now.map(Math.round)}`)
  }
  const middle = (custom.at_ms + custom.duration_ms / 2) / 1000
  const was = boxColor(ffmpeg, original, middle, [100, 400, 880, 1100]), now = boxColor(ffmpeg, clipFile, middle, [100, 400, 880, 1100])
  assert.ok(was.some((c, i) => Math.abs(c - now[i]) > 8), `the custom graphic shows: ${was.map(Math.round)} vs ${now.map(Math.round)}`)
  const ledger = fs.readFileSync(path.join(path.dirname(library), 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(ledger.some((e) => e.label === 'Custom graphic (designed here, lower cost)' && e.usd > 0), JSON.stringify(ledger))
  assert.deepEqual(errors, [])
})
