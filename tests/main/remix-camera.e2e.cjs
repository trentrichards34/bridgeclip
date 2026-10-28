const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

// Chromium's stand-in camera and microphone (a moving test pattern and a beep), allowed without a prompt.
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

function streams(file) {
  return execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split('\n').sort()
}

test('Me, on camera: pick the background, film a reaction in sync with the clip, read a take line by line, then make them', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-camera-e2e-'))
  const userData = path.join(root, 'user-data')
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData, args: FAKE_MEDIA })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  const output = path.join(userData, 'CreatorClips')
  const work = path.join(output, 'Remix', 'run', '.work')
  fs.mkdirSync(work, { recursive: true })
  const moment = path.join(work, 'source.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=4:r=30', '-f', 'lavfi', '-i', 'sine=d=4',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', moment])

  await app.evaluate(({ ipcMain }, { output, moment }) => {
    const fs = process.getBuiltinModule('fs')
    const path = process.getBuiltinModule('path')
    Object.assign(globalThis, { remixRequests: [], renderRequests: [], recs: {}, offsets: {}, writers: {} })
    const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
    replace('settings:load', () => ({ openrouterConfigured: true, pexelsConfigured: false, zernioConfigured: false, outputDirectory: output, pythonPath: '', customVocabulary: '' }))
    replace('avatars:list', () => [])
    replace('remix:start', (_event, request) => {
      globalThis.remixRequests.push(request)
      return { id: 'run1', phase: 'planning', detail: 'Finding moments', percent: 10, folder: output, estimateUsd: 0.1, drafts: [], outputs: [], costUsd: null, warnings: [], error: null }
    })
    replace('remix:render', (_event, edits) => {
      globalThis.renderRequests.push(edits)
      return { id: 'run9', phase: 'rendering', detail: 'Starting', percent: 1, folder: output, estimateUsd: 0, drafts: [], outputs: [], costUsd: 0.1, warnings: [], error: null }
    })
    replace('remix:moment', () => ({ path: moment, startSeconds: 0, endSeconds: 3 }))
    replace('remix:recordings', () => globalThis.recs)
    replace('remix:recordingBegin', (_event, draftId, part, mime) => {
      const dir = path.join(output, 'Remix', 'run', '.recordings')
      fs.mkdirSync(dir, { recursive: true })
      const token = `${draftId}-${part}-${Date.now()}`
      globalThis.writers[token] = { draftId, part, mime, file: path.join(dir, `${token}.webm`) }
      fs.writeFileSync(globalThis.writers[token].file, '')
      return token
    })
    replace('remix:recordingAppend', (_event, token, chunk) => { fs.appendFileSync(globalThis.writers[token].file, Buffer.from(chunk)) })
    replace('remix:recordingFinish', (_event, token, offset) => {
      const writer = globalThis.writers[token]
      globalThis.offsets[`${writer.draftId}-${writer.part}`] = offset
      globalThis.recs[writer.draftId] = { ...globalThis.recs[writer.draftId], [writer.part]: { path: writer.file, uploaded: false, seconds: 3 } }
      return globalThis.recs
    })
    replace('remix:removeRecording', (_event, draftId, part) => { delete globalThis.recs[draftId]?.[part]; return globalThis.recs })
  }, { output, moment })
  await page.reload()

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByLabel('Video links').fill('https://www.instagram.com/reel/DdurluTvRVB/')
  // A voiced take on camera: one take to record to start with, and the button says what happens next.
  // You on camera, then the scripted take (the AI writes the lines, you read them).
  // (Remix opens on You on camera, the only side while Avatar Studio is switched off.)
  await page.getByRole('radio', { name: /^Scripted take/ }).click()
  assert.equal(await page.getByRole('radiogroup', { name: 'Takes per video' }).getByRole('radio', { name: '1', exact: true }).getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: 'Write and record', exact: true }).waitFor()
  // Green screen over their video: its own card (React to a clip, you on camera, cut out in front of their moment).
  await page.getByRole('radio', { name: /^Green screen over their video/ }).click()
  assert.equal(await page.getByRole('radio', { name: /^Scripted take/ }).getAttribute('aria-checked'), 'false')
  // (React to a clip is an AI presenter card now: not offered on this side.)
  assert.equal(await page.getByRole('radio', { name: /^React to a clip/ }).count(), 0)
  // No avatar, no AI label, no presenter to choose: it's really you.
  assert.equal(await page.getByText('No avatars yet').count(), 0)
  assert.equal(await page.getByRole('radiogroup', { name: 'Presenter' }).count(), 0)
  assert.equal(await page.getByRole('checkbox', { name: "I'll turn on the AI-content label when I post" }).count(), 0)
  assert.match(await page.getByTestId('look-summary').innerText(), /^Green screen · You talk over it · /)
  await page.getByRole('checkbox', { name: "I'm allowed to use these clips" }).click()
  await page.getByRole('button', { name: 'Write the takes', exact: true }).click()
  const request = await app.evaluate(() => globalThis.remixRequests[0])
  assert.equal(request.host, 'camera')
  assert.equal(request.avatarId, null)
  assert.deepEqual(request.camera, { layout: 'greenscreen', backdrop: 'blur', backdropColor: '#111111', talk: true })

  const draft = (format) => ({
    id: 0, sourceIndex: 0, sourceTitle: 'Reel', creator: '@coach', startMs: 0, endMs: 3000, quote: 'Lose weight before your first pull-up.', why: 'Bold claim',
    style: 'reaction', stance: 'disagree', headline: 'This coach says lose weight first', notes: [], grade: null, estimateUsd: 0.01, format,
    intro: format === 'silent' ? '' : 'He says lose weight first. He is wrong.', close: format === 'silent' ? '' : 'Train the pull first.',
    beats: format === 'silent' ? [] : [{ text: 'Strength comes before the scale.', broll: 'gym' }],
    cues: [], postCaption: 'Pull first.'
  })
  const review = (id, format) => app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].webContents.send('remix:status', value)
  }, { id, phase: 'review', detail: 'Ready', percent: 100, folder: output, estimateUsd: 0.01, costUsd: 0.05, error: null, outputs: [], warnings: [],
    onCamera: true, cameraTalk: format === 'silent', drafts: [draft(format)] })

  // Silent react on camera: the moment plays while the camera records.
  await review('run1', 'silent')
  await page.getByRole('heading', { name: /Review your takes/ }).waitFor()
  const make = page.getByRole('button', { name: /^Make 1 remix/ })
  assert.equal(await make.isDisabled(), true, 'needs the recording first')
  await page.getByText('Film your reaction to this moment.').waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  const recorder = page.getByRole('dialog', { name: 'Record yourself' })
  await recorder.getByText(/Wear headphones/).waitFor()
  // A frame guide shows what is kept of the camera picture.
  await recorder.getByTestId('frame-guide').waitFor()
  await recorder.getByRole('button', { name: /Start: the clip plays/ }).click()
  await recorder.getByText(/^REC/).waitFor({ timeout: 10000 })
  // Stops on its own when the moment ends.
  await recorder.getByText(/^Recorded/).waitFor({ timeout: 15000 })
  const reaction = await app.evaluate(() => ({ recs: globalThis.recs, offsets: globalThis.offsets }))
  const file = reaction.recs[0].reaction.path
  assert.deepEqual(streams(file), ['audio', 'video'])
  const offset = reaction.offsets['0-reaction']
  assert.equal(typeof offset, 'number')
  assert.ok(offset >= 0 && offset < 2, `the moment starts right after recording does (${offset}s)`)
  await recorder.getByRole('button', { name: 'Done' }).click()
  await page.getByText('Recorded', { exact: true }).waitFor()
  await make.click()
  assert.equal((await app.evaluate(() => globalThis.renderRequests[0]))[0].id, 0)

  // A voiced take: each line from the teleprompter, then on to the next.
  await review('run2', 'commentary')
  await page.getByRole('heading', { name: /Review your takes/ }).waitFor()
  await page.getByText('Record your lines: 0 of 3 done.').waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await recorder.getByLabel('Your line').getByText('He says lose weight first. He is wrong.').waitFor()
  for (const [label, line] of [['Opening', 'He says lose weight first. He is wrong.'], ['Point 1', 'Strength comes before the scale.'], ['Close', 'Train the pull first.']]) {
    assert.equal(await recorder.getByRole('tab', { name: label }).getAttribute('aria-selected'), 'true')
    await recorder.getByLabel('Your line').getByText(line).waitFor()
    await recorder.getByRole('button', { name: `Record ${label.toLowerCase()}` }).click()
    await recorder.getByText(/^REC/).waitFor({ timeout: 10000 })
    await page.waitForTimeout(1500)
    await recorder.getByRole('button', { name: 'Stop' }).click()
    await recorder.getByRole('button', { name: /^Record|Record again/ }).first().waitFor()
  }
  await recorder.getByText(/^Recorded/).waitFor({ timeout: 10000 })
  const lines = await app.evaluate(() => globalThis.recs[0])
  for (const part of ['intro', 'beat0', 'close']) assert.deepEqual(streams(lines[part].path), ['audio', 'video'], part)
  await recorder.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /^Make 1 remix/ }).click()
  assert.equal(await app.evaluate(() => globalThis.renderRequests.length), 2)

  // Article or post: talk over a screenshot; the headline is written from what you said.
  const shot = path.join(output, 'article.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=600x1600', '-frames:v', '1', shot])
  await app.evaluate(({ ipcMain, BrowserWindow }, { shot, output }) => {
    const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
    globalThis.recs = {}
    globalThis.writes = 0
    replace('remix:selectImage', () => shot)
    replace('remix:moment', () => ({ path: shot, startSeconds: 0, endSeconds: 180, kind: 'image' }))
    const draft = (headline, postCaption, quote) => ({ id: 0, sourceIndex: 0, sourceTitle: 'The Daily Example', creator: 'The Daily Example', startMs: 0, endMs: 0, quote, why: '',
      style: 'reaction', stance: 'add_nuance', headline, intro: '', beats: [], close: '', notes: [], grade: null, estimateUsd: 0.02, postCaption, format: 'image', cues: [] })
    const status = (patch) => ({ id: 'run3', phase: 'review', detail: 'Ready', percent: 100, folder: output, estimateUsd: 0.02, costUsd: null, error: null, outputs: [], warnings: [],
      onCamera: true, cameraTalk: true, drafts: [draft('', '', '')], ...patch })
    replace('remix:start', (_event, request) => { globalThis.remixRequests.push(request); return status({}) })
    replace('remix:write', () => {
      globalThis.writes++
      const send = (value) => BrowserWindow.getAllWindows()[0].webContents.send('remix:status', value)
      const planning = status({ phase: 'planning', detail: 'Writing your headline and caption from what you said', percent: 5 })
      setTimeout(() => send(status({ costUsd: 0.015, drafts: [draft('This paper says remote work is over', 'My take.\n\nSource: The Daily Example', 'So this article claims remote work is over.')] })), 300)
      send(planning)
      return planning
    })
    // The previous run finishes.
    BrowserWindow.getAllWindows()[0].webContents.send('remix:status', { id: 'run9', phase: 'done', detail: 'Done', percent: 100, folder: output, estimateUsd: 0, drafts: [], outputs: [], costUsd: 0.1, warnings: [], error: null })
  }, { shot, output })
  await page.getByRole('radio', { name: /Article or post/ }).click()
  await page.getByRole('heading', { name: '01 · The article or post' }).waitFor()
  const next = page.getByRole('button', { name: 'Continue to recording' })
  assert.equal(await next.isDisabled(), true)
  await page.getByRole('button', { name: 'Choose a screenshot' }).click()
  await page.getByText('article.png').waitFor()
  await page.getByPlaceholder('e.g. The Wall Street Journal or @handle').fill('The Daily Example')
  // Green screen is the default look for a screenshot (in the folded look section).
  await page.getByRole('button', { name: 'Customize for this video' }).click()
  assert.equal(await page.getByRole('radiogroup', { name: 'Your background' }).getByRole('radio', { name: /Green screen/ }).getAttribute('aria-checked'), 'true')
  // One promise for the run (it stays ticked from the silent react above).
  await page.getByRole('checkbox', { name: "I'm allowed to share this screenshot" }).check()
  await next.click()
  const imageRequest = await app.evaluate(() => globalThis.remixRequests[globalThis.remixRequests.length - 1])
  assert.deepEqual([imageRequest.format, imageRequest.host, imageRequest.sources[0], imageRequest.creator, imageRequest.camera.talk], ['image', 'camera', shot, 'The Daily Example', true])
  await page.getByRole('heading', { name: 'Your take on the screenshot' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^Make 1 remix/ }).isDisabled(), true)
  assert.equal(await page.getByLabel('Headline, take 1').count(), 0, 'the headline comes from the recording')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await recorder.getByRole('img', { name: 'The screenshot you’re talking about' }).waitFor()
  await recorder.getByRole('button', { name: 'Start recording' }).click()
  await recorder.getByText(/^REC/).waitFor({ timeout: 10000 })
  await page.waitForTimeout(1500)
  await recorder.getByRole('button', { name: 'Stop' }).click()
  await recorder.getByText(/^Recorded/).waitFor({ timeout: 10000 })
  const take = await app.evaluate(() => ({ recs: globalThis.recs, offsets: globalThis.offsets }))
  assert.deepEqual(streams(take.recs[0].reaction.path), ['audio', 'video'])
  assert.equal(take.offsets['0-reaction'], 0)
  // Closing the recorder writes the headline and caption from the take.
  await recorder.getByRole('button', { name: 'Done' }).click()
  await page.getByLabel('Headline, take 1').waitFor()
  assert.equal(await page.getByLabel('Headline, take 1').inputValue(), 'This paper says remote work is over')
  assert.equal(await app.evaluate(() => globalThis.writes), 1)
  await page.getByText('You said: “So this article claims remote work is over.”').waitFor()
  await page.getByLabel('Headline, take 1').fill('Remote work is over, says this paper')
  await page.getByRole('button', { name: /^Make 1 remix/ }).click()
  const imageRender = await app.evaluate(() => globalThis.renderRequests[globalThis.renderRequests.length - 1])
  assert.equal(imageRender[0].headline, 'Remote work is over, says this paper')

  // Made: an on-camera video's card has no "Reaction take / Adds nuance" badges (there's no written take).
  const send = (value) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows()[0].webContents.send('remix:status', v), value)
  const finished = { id: 'run3', percent: 100, folder: output, estimateUsd: 0.02, costUsd: 0.02, warnings: [], onCamera: true,
    drafts: [{ id: 0, sourceIndex: 0, sourceTitle: 'The Daily Example', creator: 'The Daily Example', startMs: 0, endMs: 0, quote: '', why: '', style: 'reaction', stance: 'add_nuance',
      headline: 'Remote work is over, says this paper', intro: '', beats: [], close: '', notes: [], grade: null, estimateUsd: 0.02, postCaption: '', format: 'image', cues: [] }] }
  await send({ ...finished, phase: 'done', detail: 'Done', error: null,
    outputs: [{ path: path.join(output, 'clip_00.mp4'), manifestPath: path.join(output, 'clip_00.source.json'), headline: 'Remote work is over, says this paper', stance: 'add_nuance',
      excerptSeconds: 0, durationSeconds: 3, costUsd: 0.02, checks: [], warnings: [], style: 'reaction', grade: null, creator: 'The Daily Example', postCaption: '' }] })
  await page.getByText(/^1 remix ready/).waitFor()
  assert.equal(await page.getByText('Adds nuance', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Reaction take', { exact: true }).count(), 0)

  // A raw engine error reads plainly, with the technical text under Details (for Report an issue).
  const raw = "transcribe_audio() missing 1 required positional argument: 'language'"
  await send({ ...finished, phase: 'failed', detail: 'Failed', error: raw, outputs: [] })
  await page.getByText('Something went wrong while making this. Try again; if it keeps happening, use Report an issue.').waitFor()
  assert.equal(await page.getByText(raw).isVisible(), false)
  await page.getByText('Details', { exact: true }).click()
  await page.getByText(raw).waitFor()
  // The engine's own plain messages are shown as they are.
  await send({ ...finished, phase: 'failed', detail: 'Failed', error: 'Your disk is full. Free up some space, then try again.', outputs: [] })
  await page.getByText('Your disk is full. Free up some space, then try again.').waitFor()
  assert.equal(await page.getByText('Details', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
})
