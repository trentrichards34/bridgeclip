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
  await page.getByRole('radio', { name: /Silent react/ }).click()
  await page.getByRole('radio', { name: /Me, on camera/ }).click()
  // No avatar, no AI label: it's really you.
  assert.equal(await page.getByText('No avatars yet').count(), 0)
  assert.equal(await page.getByRole('checkbox', { name: "I'll turn on the AI-content label when I post" }).count(), 0)
  await page.getByRole('radio', { name: /Green screen/ }).click()
  await page.getByRole('switch', { name: 'Talk while reacting' }).click()
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
  assert.deepEqual(errors, [])
})
