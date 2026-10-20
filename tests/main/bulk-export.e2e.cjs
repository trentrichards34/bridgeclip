const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp, ROOT } = require('../zernio/support/electron-app.cjs')

test('Library: select all, then Export copies every clip to a folder and .zip saves them all in one file', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-bulk-export-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, '22222222-2222-4222-8222-222222222222')
  const dest = path.join(root, 'exported')
  fs.mkdirSync(run, { recursive: true }); fs.mkdirSync(dest)
  const ffmpeg = fs.existsSync(path.join(ROOT, 'engine-bin/ffmpeg')) ? path.join(ROOT, 'engine-bin/ffmpeg') : 'ffmpeg'
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=10', '-t', '1', '-c:v', 'mpeg4', path.join(run, 'clip_00.mp4')])
  // Thirteen clips like a real run: file:// links, a summary and a headline each (two share a summary).
  const clips = Array.from({ length: 13 }, (_, clip_index) => {
    const file = path.join(run, `clip_${String(clip_index).padStart(2, '0')}.mp4`)
    if (clip_index) fs.copyFileSync(path.join(run, 'clip_00.mp4'), file)
    return { clip_index, summary: clip_index === 12 ? 'Clip title 0' : `Clip title ${clip_index}`, headline: `Headline ${clip_index}`, s3_url: `file://${file}`,
      start_time_ms: clip_index * 1000, end_time_ms: clip_index * 1000 + 1000, duration_ms: 1000, virality_score: 0.9 - clip_index / 100 }
  })
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: path.basename(run), source_video_title: 'Export all test', source_video_url: 'https://example.com/v',
    source_video_duration_seconds: 20, clips, total_clips: clips.length }))
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  await app.evaluate(({ BrowserWindow, dialog }, { dest, root }) => {
    BrowserWindow.getAllWindows()[0].setSize(1400, 900)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dest] })
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: `${root}/${options.defaultPath}` })
  }, { dest, root })
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Open Export all test', exact: true }).click()
  await page.getByRole('checkbox', { name: /Select all/ }).click()
  await page.getByRole('button', { name: 'Export 13' }).click()
  await page.getByText('Exported 13 clips to exported').waitFor()
  const files = fs.readdirSync(dest).sort()
  assert.equal(files.length, 13, files.join(', '))
  assert.ok(files.includes('Clip title 0.mp4') && files.includes('Clip title 0 (1).mp4'), 'clips with the same title both arrive')
  const original = fs.readFileSync(path.join(run, 'clip_05.mp4'))
  assert.ok(fs.readFileSync(path.join(dest, 'Clip title 5.mp4')).equals(original), 'copied byte for byte')

  // One .zip with every clip, readable by a standard unzip.
  await page.getByRole('button', { name: '.zip' }).click()
  await page.getByText('Exported 13 clips to Export all test.zip').waitFor()
  const zip = path.join(root, 'Export all test.zip')
  const listing = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(sorted(z.namelist())))', zip], { encoding: 'utf8' }))
  assert.equal(listing.length, 13)
  assert.ok(listing.includes('Clip title 0 (1).mp4'))
  assert.equal(fs.readdirSync(root).filter((name) => name.endsWith('.part')).length, 0, 'no partial file left behind')

  // A clip deleted since the Library was read is skipped and counted, never a raw file error naming paths.
  fs.rmSync(path.join(run, 'clip_03.mp4'))
  const again = path.join(root, 'again')
  fs.mkdirSync(again)
  await app.evaluate(({ dialog }, { again, root }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [again] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${root}/Missing one.zip` })
  }, { again, root })
  await page.getByRole('button', { name: 'Export 13' }).click()
  await page.getByText('Exported 12 clips to again; 1 could not be copied').waitFor()
  assert.equal(fs.readdirSync(again).length, 12)
  await page.getByRole('button', { name: '.zip' }).click()
  await page.getByText('Exported 12 clips to Missing one.zip; 1 could not be copied').waitFor()
  const partial = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', path.join(root, 'Missing one.zip')], { encoding: 'utf8' }))
  assert.equal(partial.length, 12)
  const body = await page.locator('body').innerText()
  assert.ok(!/ENOENT|realpath|\/tmp\//.test(body), 'no raw file-system error or path on the page')
  assert.deepEqual(errors, [])
})

test('Library: when every selected clip is missing, export says so in plain words', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-bulk-missing-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, '33333333-3333-4333-8333-333333333333')
  fs.mkdirSync(run, { recursive: true })
  const clips = [0, 1].map((clip_index) => ({ clip_index, summary: `Gone ${clip_index}`, headline: `Gone ${clip_index}`, s3_url: `file://${path.join(run, `clip_0${clip_index}.mp4`)}`,
    start_time_ms: 0, end_time_ms: 1000, duration_ms: 1000, virality_score: 0.5 }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: path.basename(run), source_video_title: 'Missing test', source_video_url: 'https://example.com/v',
    source_video_duration_seconds: 20, clips, total_clips: clips.length }))
  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  page.setDefaultTimeout(15000)
  await app.evaluate(({ BrowserWindow, dialog }, { root }) => {
    BrowserWindow.getAllWindows()[0].setSize(1400, 900)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${root}/x.zip` })
  }, { root })
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Open Missing test', exact: true }).click()
  await page.getByRole('checkbox', { name: /Select all/ }).click()
  await page.getByRole('button', { name: '.zip' }).click()
  await page.getByText('2 clips are missing from the Library (deleted or moved), so they can’t be exported.').waitFor()
  const body = await page.locator('body').innerText()
  assert.ok(!/ENOENT|realpath/.test(body), 'no raw file-system error on the page')
  assert.ok(!fs.existsSync(path.join(root, 'x.zip')))
})
