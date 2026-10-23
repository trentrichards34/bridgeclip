// Their clip, then me with a graphic on the member's take and a chat request: the stat counter is added in the review's
// Graphics section, the hook text is changed from the Chat panel (Keep), and the made video shows the stat while the
// take plays (after their 6-second clip). The real engine makes it; only the paid AI steps are stood in for.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { editorTools } = require('./editor-e2e-tools.cjs')
const { launchRemix, shot } = require('./remix-e2e-setup.cjs')

const sse = (chunks) => `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`

/** Mean RGB of a box of a frame at `seconds`. */
function boxColor(ffmpeg, video, seconds, [x, y, w, h]) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const sum = [0, 0, 0]
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += raw[i + c]
  return sum.map((n) => n / (raw.length / 3))
}

test('Remix graphics: a stat on the member’s take, a chat change to the hook text, and the made video shows the graphic', { timeout: 480000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  // The stand-in OpenRouter for the Chat panel: a punchier hook text.
  const chats = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end('{}'); return }
      const request = JSON.parse(body)
      chats.push(request)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (request.messages.at(-1).role === 'user') {
        res.end(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'set_hook_text', arguments: JSON.stringify({ text: '15 billion scam ads run every single day' }) } }] } }] }, { choices: [], usage: { cost: 0.002 } }]))
      } else res.end(sse([{ choices: [{ delta: { content: 'Your hook now leads with the number.' } }] }, { choices: [], usage: { cost: 0.001 } }]))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { root, library, app, page, errors, dialogs } = await launchRemix(t, tools, 'remix-graphics',
    { BRIDGECLIP_E2E_OPENROUTER_URL: `http://127.0.0.1:${server.address().port}/api/v1/chat/completions` })
  // Screenshots: shown, so the window paints what the test just did.
  if (process.env.BRIDGECLIP_E2E_SHOTS) await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.show() })
  const reel = path.join(root, 'skincare-reel.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=10', '-f', 'lavfi', '-i', 'sine=frequency=1000:d=10',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', reel])
  const take = path.join(root, 'my-take.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x406080:s=360x640:r=30:d=9', '-f', 'lavfi', '-i', 'sine=frequency=300:d=9',
    '-vf', 'drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', take])
  await dialogs([reel, take])

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('radiogroup', { name: 'Who is in the video' }).getByRole('radio', { name: /^You on camera/ }).click()
  await page.getByRole('radio', { name: /^Their clip, then me/ }).click()
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByText('skincare-reel.mp4').waitFor()
  await page.getByPlaceholder('e.g. @theircreator').fill('@skincoach')
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  await page.getByRole('button', { name: 'Continue to recording' }).click()

  await page.getByRole('heading', { name: 'Your clip, then you' }).waitFor({ timeout: 90000 })
  await page.evaluate(() => window.bridgeclip.remix.trim(0, 1000, 7000))
  await page.getByText(/^6\.0s of their video \(up to 3 minutes\)\./).waitFor()
  // Before the take is recorded, graphics wait for it.
  const graphics = page.getByRole('region', { name: 'Graphics on your part' })
  await graphics.getByText('Record your take first: graphics go on your part.').waitFor()
  await page.getByRole('button', { name: 'Upload a phone video' }).click()
  const hook = page.getByLabel('Hook text, your video')
  await hook.waitFor({ timeout: 120000 })
  assert.equal(await hook.inputValue(), 'He says 15 billion scam ads run every day')

  // A stat counter on the take: it starts after the "My take" label (1.3 s in).
  await graphics.getByRole('button', { name: 'Add a graphic' }).click()
  // The gallery opens over the page (a dialog), from the Graphics section's "Add a graphic".
  await page.getByRole('dialog', { name: 'Add a graphic' }).getByRole('region', { name: 'Choose a graphic' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Add a graphic' }).locator('.editor-graphic-tile').count(), 24, 'every template but Logo pop, Screen recording and Chapter header')
  await page.getByRole('dialog', { name: 'Add a graphic' }).getByRole('button', { name: 'Add Stat counter', exact: true }).click()
  await graphics.getByLabel('Stat counter number', { exact: true }).fill('$1,200')
  await graphics.getByLabel('Stat counter label', { exact: true }).fill('a month')
  await graphics.getByRole('button', { name: /^Stat counter at 0:01\.3, 3\.5 seconds$/ }).waitFor()
  await graphics.getByLabel('Where it sits').locator('.mg-stat-value').waitFor()

  // The Chat panel: one request changes the hook text (Keep).
  const chat = page.getByRole('region', { name: 'Chat about your video' })
  await chat.getByText(/OpenRouter credit\. Model: /).waitFor()
  await chat.getByRole('textbox', { name: 'Message' }).fill('Make the hook punchier')
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter')
  const card = chat.getByRole('group', { name: 'Chat changes' })
  await card.getByText('Hook text set to “15 billion scam ads run every single day”.').waitFor()
  await chat.getByText('Your hook now leads with the number.').waitFor()
  assert.equal(await hook.inputValue(), '15 billion scam ads run every single day')
  await card.getByRole('button', { name: 'Keep', exact: true }).click()
  // The model saw both parts and the graphic.
  assert.match(chats[0].messages[0].content, /Their part: 1000–7000 ms of their video/)
  assert.match(chats[0].messages[0].content, /What the member says \(word@ms\): Honestly@/)
  assert.match(chats[0].messages[0].content, /Graphics: g-[0-9a-f]+ stat at 1300 ms for 3500 ms \(top\): value="\$1,200", label="a month"/)
  await graphics.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await shot(app, 'remix-review-graphics.png')
  await chat.scrollIntoViewIfNeeded()
  await shot(app, 'remix-review-chat.png')

  await page.getByRole('button', { name: 'Make the video' }).click()
  await page.getByText(/^1 remix ready/).waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => name.startsWith('remix-'))
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.equal(job.clips[0].headline, '15 billion scam ads run every single day')
  const bundle = JSON.parse(fs.readFileSync(path.join(library, run, '.edit', 'clip_00', 'edit.json'), 'utf8'))
  // Their 6 s clip, then the take: the graphic is 1.3 s into the take.
  assert.equal(bundle.graphics.length, 1)
  assert.ok(Math.abs(bundle.graphics[0].start_ms - 7300) < 150, `${bundle.graphics[0].start_ms}`)
  assert.equal(bundle.graphics[0].duration_ms, 3500)
  const file = path.join(library, run, 'clip_00.mp4')
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    for (const [name, at] of [['remix-video-graphic.png', 8.6], ['remix-video-before-graphic.png', 4], ['remix-video-after-graphic.png', 12.5]]) {
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', path.join(process.env.BRIDGECLIP_E2E_SHOTS, name)])
    }
  }
  const band = [100, 780, 200, 36]
  const during = boxColor(ffmpeg, file, 8.6, band), after = boxColor(ffmpeg, file, 12.5, band)
  assert.ok(during.every((c) => c > 190), `the stat card shows over the take: ${during.map(Math.round)}`)
  assert.ok(Math.abs(after[0] - during[0]) > 30 || Math.abs(after[2] - during[2]) > 30, `the card is gone after: ${after.map(Math.round)}`)
  const ledger = fs.readFileSync(path.join(path.dirname(library), 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(ledger.some((entry) => entry.kind === 'remix' && entry.label === 'Remix: chat' && Math.abs(entry.usd - 0.003) < 1e-6), JSON.stringify(ledger))
  assert.deepEqual(errors, [])
})
