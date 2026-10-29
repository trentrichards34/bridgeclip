// Clip editor Chat tab, driven in the app against a fake OpenRouter: asking to
// start earlier moves the clip's first cut, saves, and Undo on the card restores it.
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

test('Chat: "start earlier" moves the first cut through the editor, and Undo restores it', { timeout: 120000 }, async (t) => {
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
        // The words before the clip carry the reaction; move the start to it.
        const wow = /Wowww\.@(\d+)/.exec(request.messages[0].content)
        res.end(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'extend_start', arguments: JSON.stringify({ to_ms: Number(wow?.[1] ?? 0) - 50, reason: 'to include Joe’s “Wowww.”' }) } }] } }] }, { choices: [], usage: { cost: 0.004 } }]))
      } else {
        res.end(sse([{ choices: [{ delta: { content: 'Done. The clip now opens on Joe’s “Wowww.” before she answers.' } }] }, { choices: [], usage: { cost: 0.002 } }]))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-editor-chat-'))
  const userDataDir = path.join(root, 'user-data'), run = path.join(userDataDir, 'CreatorClips', 'chat-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 320; project.height = 180
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: [
    { start_time_ms: 200, end_time_ms: 900, text: 'Wowww.', speaker_label: 'Joe', words: [{ word: 'Wowww.', start_time_ms: 300, end_time_ms: 850 }] },
    { start_time_ms: 1000, end_time_ms: 2000, text: 'Here is the setup.', speaker_label: 'Guest', words: [{ word: 'Here', start_time_ms: 1000, end_time_ms: 1250 }, { word: 'is', start_time_ms: 1250, end_time_ms: 1400 }, { word: 'the', start_time_ms: 1400, end_time_ms: 1550 }, { word: 'setup.', start_time_ms: 1550, end_time_ms: 2000 }] }
  ] }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'chat-run', source_video_title: 'Editor chat', clips: [], editor_project: true }))
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
  await page.getByRole('button', { name: 'Open Editor chat', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  const saved = () => JSON.parse(fs.readFileSync(path.join(run, 'editor-project.json')))
  const settle = () => page.getByText('All changes saved', { exact: true }).waitFor()

  await page.getByRole('region', { name: 'Clip editor' }).getByRole('button', { name: 'Chat', exact: true }).click()
  const chat = page.getByRole('region', { name: 'Chat about this clip' })
  await chat.getByText(/OpenRouter credit\. Model: /).waitFor()
  for (const chip of ['Start earlier', 'Cut the pauses', 'Punchier hook', 'Add a stat graphic']) await chat.getByRole('button', { name: chip, exact: true }).waitFor()
  // A suggestion fills the message box to edit; nothing is sent until the member sends it.
  await chat.getByRole('button', { name: 'Start earlier', exact: true }).click()
  assert.equal(await chat.getByRole('textbox', { name: 'Message' }).inputValue(), 'Start earlier')
  assert.equal(await chat.getByRole('textbox', { name: 'Message' }).evaluate((el) => el === document.activeElement), true)
  assert.equal(requests.length, 0)
  await chat.getByRole('textbox', { name: 'Message' }).fill('Start with Joe’s “wowww” before she answers')
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter')
  const card = chat.getByRole('group', { name: 'Chat changes' })
  await card.getByText(/^Start moved back 0\.8s to include Joe’s “Wowww\.”$/).waitFor()
  await card.getByText(/^Clip is now 6\.2s\.$/).waitFor()
  await chat.getByText('Done. The clip now opens on Joe’s “Wowww.” before she answers.').waitFor()
  // The answer is scrolled into view, above the message box.
  const answer = chat.getByText('Done. The clip now opens on Joe’s “Wowww.” before she answers.')
  const [answerBox, composeBox] = [await answer.boundingBox(), await page.locator('.editor-chat-compose').boundingBox()]
  assert.ok(answerBox.y + answerBox.height <= composeBox.y + 1, 'the newest answer is not hidden under the message box')
  await settle()
  assert.deepEqual(saved().candidates[0].ranges, [[250, 5000], [7000, 10000]])
  // The model saw the clip's words with their times, and the edit is a normal undoable change.
  assert.match(requests[0].messages[0].content, /\[before clip\] 200–900, Joe: Wowww\.@300/)
  assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).first().isEnabled(), true)
  // Fits the inspector column.
  const overflow = await page.locator('.editor-inspector-body').evaluate((el) => el.scrollWidth - el.clientWidth)
  assert.ok(overflow <= 1, `the Chat panel spills ${overflow}px sideways`)
  const tabs = await page.locator('.editor-tabs').evaluate((el) => el.scrollWidth - el.clientWidth)
  assert.ok(tabs <= 1, `the inspector tabs spill ${tabs}px sideways`)
  const shots = process.env.BRIDGECLIP_E2E_SHOTS
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'editor-chat-tab.png') }) }
  // A small laptop (1280×800): the tabs stay on one row and the conversation keeps real room above the message box.
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
  await page.waitForFunction(() => window.innerWidth === 1280)
  const room = await page.evaluate(() => {
    const body = document.querySelector('.editor-inspector-body').getBoundingClientRect(), compose = document.querySelector('.editor-chat-compose').getBoundingClientRect()
    const tabs = [...document.querySelectorAll('.editor-tabs > button')].map((b) => Math.round(b.getBoundingClientRect().top))
    return { space: Math.min(compose.top, body.bottom) - body.top, rows: new Set(tabs).size }
  })
  assert.equal(room.rows, 1, 'the inspector tabs fit one row')
  assert.ok(room.space >= 200, `the chat history has only ${room.space}px`)
  if (shots) await page.screenshot({ path: path.join(shots, 'editor-chat-tab-1280.png') })
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))

  await card.getByRole('button', { name: 'Undo', exact: true }).click()
  await card.getByText('Undone', { exact: true }).waitFor()
  await settle()
  assert.deepEqual(saved().candidates[0].ranges, [[1000, 5000], [7000, 10000]])
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(requests.length, 2)
})
