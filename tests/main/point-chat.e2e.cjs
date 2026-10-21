// Point at the preview, driven in the app against a fake OpenRouter: Point on the
// Output preview, click the video, ask "put an arrow here", and the arrow lands at
// the pin's spot (saved, and drawn on the live preview). Esc cancels pointing.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

function sse(chunks) {
  return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`
}

test('Point: a pin on the Output preview and "put an arrow here" add an arrow at that spot', { timeout: 150000 }, async (t) => {
  const tools = editorTools(t)
  if (!tools) return
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404).end('{}'); return }
      const request = JSON.parse(body)
      requests.push(request)
      const last = request.messages.at(-1)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (last.role === 'user') {
        res.end(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'add_graphic', arguments: JSON.stringify({ template: 'highlight', pin: 1, fields: { shape: 'arrow' } }) } }] } }] }, { choices: [], usage: { cost: 0.003 } }]))
      } else {
        res.end(sse([{ choices: [{ delta: { content: 'Done. An arrow points at the spot you picked.' } }] }, { choices: [], usage: { cost: 0.001 } }]))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-point-chat-'))
  const userDataDir = path.join(root, 'user-data'), run = path.join(userDataDir, 'CreatorClips', 'point-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 320; project.height = 180
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'point-run', source_video_title: 'Point chat', clips: [], editor_project: true }))
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir, env: { ...tools.appEnv, BRIDGECLIP_E2E_OPENROUTER_URL: `${base}/chat/completions` } })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); server.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { page } = session
  page.setDefaultTimeout(15000)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  // Linux without a desktop keyring only offers plain-text storage, which the app refuses for keys. This test's key is fake.
  await session.app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Point chat', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Clip editor' })
  await editor.waitFor()
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const settle = () => page.getByText('All changes saved', { exact: true }).waitFor()
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  const shot = async (name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name) }) } }

  // Point: pressed, the Chat tab opens, and the preview asks for a click. Esc cancels.
  const point = editor.locator('.editor-output-monitor').getByRole('button', { name: 'Point', exact: true })
  assert.equal(await point.getAttribute('aria-pressed'), 'false')
  await point.click()
  assert.equal(await point.getAttribute('aria-pressed'), 'true')
  const chat = page.getByRole('region', { name: 'Chat about this clip' })
  await chat.waitFor()
  await editor.getByRole('status').filter({ hasText: 'Click the video to point' }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await point.getAttribute('aria-pressed'), 'false')

  // Point again and click 30% across, 25% down the Output preview.
  await point.click()
  const layer = editor.getByTestId('point-layer')
  await shot('point-pointing.png')
  const box = await layer.boundingBox()
  assert.ok(box && box.width > 50 && box.height > 50, 'the point layer covers the preview')
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.25)
  assert.equal(await point.getAttribute('aria-pressed'), 'false', 'one pin per press')
  const chips = chat.getByRole('list', { name: 'Pins for your next message' })
  await chips.getByText('Pin 1 · at 0:00.0, top-left', { exact: true }).waitFor()
  await layer.locator('.chat-point-pin').first().waitFor()
  for (const chip of ['Put an arrow here', 'Circle this', 'Zoom in on this', 'Move the graphic here']) await chat.getByRole('button', { name: chip, exact: true }).waitFor()
  assert.equal(await chat.getByRole('textbox', { name: 'Message' }).evaluate((el) => el === document.activeElement), true, 'the message box is next')
  await chat.getByText(/OpenRouter credit\. Model: /).waitFor()
  await shot('point-pinned.png')

  await chat.getByRole('textbox', { name: 'Message' }).fill('put an arrow here')
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter')
  const card = chat.getByRole('group', { name: 'Chat changes' })
  await card.getByText('Added an arrow at pin 1 at 0:00.0.', { exact: true }).waitFor() // the clip's clock, like the pin
  await chat.getByText('Done. An arrow points at the spot you picked.').waitFor()
  // Pins go with the message they were sent with, then clear.
  assert.equal(await chips.count(), 0)
  assert.equal(await layer.locator('.chat-point-pin').count(), 0)
  await chat.getByRole('list', { name: 'Pins sent' }).getByText('Pin 1 · at 0:00.0, top-left').waitFor()
  // The model got the pin with the message.
  assert.match(requests[0].messages.at(-1).content, /^put an arrow here\n\n\[The member pointed at the video[\s\S]*pin 1: a point at x=0\.3\d*, y=0\.2\d*.*\(source 1000 ms\)/)

  await settle()
  const graphic = saved().candidates[0].graphics[0]
  assert.equal(graphic.template, 'highlight')
  assert.equal(graphic.fields.shape, 'arrow')
  assert.ok(Math.abs(Number(graphic.fields.x) - 0.3) < 0.01, `x ${graphic.fields.x}`)
  assert.ok(Math.abs(Number(graphic.fields.y) - 0.25) < 0.01, `y ${graphic.fields.y}`)
  assert.equal(graphic.at_ms, 1000)

  // The live preview draws it at the clip's start.
  // (The answer plays a short look at the change first; let it finish.)
  await page.waitForTimeout(3000)
  await editor.getByRole('button', { name: 'Back to start' }).click()
  const arrow = editor.locator('.editor-graphics-overlay .mg-highlight')
  await arrow.waitFor()
  const overlay = await editor.locator('.editor-graphics-overlay').boundingBox()
  const pinBox = await layer.boundingBox()
  assert.ok(Math.abs(overlay.width - pinBox.width) < 2 && Math.abs(overlay.x - pinBox.x) < 2, 'the pins and the graphics share the preview frame')
  // A second in (the arrow has drawn in): its head sits by the pin's spot.
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(400)
  const head = await editor.locator('.editor-graphics-overlay .mg-highlight path:not(.mg-shadow)[d*=" L"]').first().boundingBox()
  assert.ok(head, 'the arrow head is drawn')
  const hx = (head.x + head.width / 2 - overlay.x) / overlay.width, hy = (head.y + head.height / 2 - overlay.y) / overlay.height
  assert.ok(Math.abs(hx - 0.3) < 0.1 && Math.abs(hy - 0.25) < 0.1, `the arrow head is at ${hx.toFixed(2)}, ${hy.toFixed(2)}`)
  await shot('point-arrow.png')
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(requests.length, 2)
})
