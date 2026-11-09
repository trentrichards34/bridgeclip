'use strict'
// End to end against the local mock Zernio: pick a cover frame and schedule a
// post with YouTube captions from the clip's subtitle file, then find the post
// in the Posts calendar and open it.
//
//   npm run build && xvfb-run -a node --test tests/zernio/e2e/cover-calendar.e2e.cjs

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createMockZernio } = require('../support/mock-zernio.cjs')
const { createPostingMock } = require('../support/mock-posts.cjs')
const { buildApp, launchApp, ROOT } = require('../support/electron-app.cjs')

const KEY = 'e2e-cover-calendar-key-not-a-secret'
const FFMPEG = fs.existsSync(path.join(ROOT, 'engine-bin', 'ffmpeg')) ? path.join(ROOT, 'engine-bin', 'ffmpeg') : 'ffmpeg'
const TZ = 'America/New_York'
const TITLE = 'Three ways to raise prices'
const SRT = '1\n00:00:00,000 --> 00:00:02,000\nMost people price too low.\n\n2\n00:00:02,000 --> 00:00:04,000\nHere is why.\n'

function seedLibrary(library) {
  const jobDir = path.join(library, '33333333-4444-4555-8666-777777777777')
  fs.mkdirSync(jobDir, { recursive: true })
  const file = path.join(jobDir, 'clip_00.mp4')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=4:r=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-shortest', '-c:v', 'mpeg4', '-q:v', '6', '-c:a', 'aac', '-movflags', '+faststart', file])
  // Create writes clip_NN.srt beside clip_NN.mp4.
  fs.writeFileSync(path.join(jobDir, 'clip_00.srt'), SRT)
  const clips = [{ clip_index: 0, s3_url: `file://${file}`, duration_ms: 4000, start_time_ms: 0, end_time_ms: 4000, virality_score: 0.7, layout_type: 'talking_head', summary: TITLE, tags: [] }]
  fs.writeFileSync(path.join(jobDir, 'job_output.json'), JSON.stringify({ job_id: 'cover', source_video_url: '', source_video_title: 'Cover run', source_video_duration_seconds: 60,
    total_clips: 1, clips, transcript_url: null, plan_url: null, processing_time_seconds: 1, metrics: null, created_at: new Date().toISOString() }))
}

/** `YYYY-MM-DDTHH:mm` for `ms` on the wall clock in TZ, as a datetime-local input takes it. */
function wallInput(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(ms).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

test('cover frame and YouTube captions: pick a frame, schedule, then find and open the post in the calendar', { timeout: 300_000 }, async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-cover-calendar-'))
  const posting = createPostingMock()
  const mock = await createMockZernio({ apiKey: KEY, extraRoutes: posting.routes })
  let app = null
  t.after(async () => { await app?.close(); await mock.close(); fs.rmSync(work, { recursive: true, force: true }) })
  const [profile] = mock.state.profiles
  const accounts = {
    youtube: mock.addAccount('youtube', profile._id, { username: 'channel' }),
    instagram: mock.addAccount('instagram', profile._id, { username: 'insta' }),
    twitter: mock.addAccount('twitter', profile._id, { username: 'xhandle' })
  }
  const userDataDir = path.join(work, 'userData')
  seedLibrary(path.join(userDataDir, 'CreatorClips'))
  const appDir = buildApp(process.env.BRIDGECLIP_E2E_APP_DIR || path.join(os.tmpdir(), 'bridgeclip-cover-calendar-e2e-app'))
  app = await launchApp({ appDir, userDataDir, mock, env: { TZ } })
  const { page } = app
  await app.app.evaluate(({ shell }) => { shell.openExternal = async () => {} })
  await page.evaluate((value) => window.bridgeclip.settings.replaceApiKey('zernioApiKey', value), KEY)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Library/ }).click()
  await page.getByRole('button', { name: 'Open Cover run', exact: true }).click()

  await page.getByRole('button', { name: `Actions for “${TITLE}”` }).click()
  await page.getByRole('menuitem', { name: 'Post or schedule', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: /^Instagram/ }).click()
  await dialog.getByRole('checkbox', { name: /^YouTube/ }).click()
  await dialog.getByRole('checkbox', { name: /^X @/ }).click()

  // Cover: only for platforms that take one, and the rest are named.
  const cover = dialog.getByRole('radiogroup', { name: 'Cover' })
  await cover.waitFor()
  await dialog.getByText(/You can set the cover on Instagram\. YouTube doesn’t allow custom covers on Shorts\. X doesn’t take a custom cover\./).waitFor()
  await cover.getByRole('radio', { name: 'Pick a frame' }).click()
  const scrubber = dialog.getByRole('slider', { name: 'Cover frame time' })
  await scrubber.fill('2500')
  await dialog.getByText('0:02.5', { exact: true }).waitFor()
  // The preview follows the scrubber.
  await page.waitForFunction(() => Math.abs(document.querySelector('video[aria-label="Cover preview"]').currentTime - 2.5) < 0.05)
  await dialog.getByRole('button', { name: /Use the middle frame \(0:02\.0\)/ }).click()
  assert.equal(await dialog.getByRole('button', { name: /Use the middle frame/ }).getAttribute('aria-pressed'), 'true')
  await dialog.getByText(/Used on Instagram\./).waitFor()

  // The clip has a subtitle file but its run didn't record the language: captions stay off
  // until the member picks one, then can be turned on.
  const captions = dialog.getByRole('checkbox', { name: 'Add captions to YouTube (from the clip’s subtitles)' })
  await captions.waitFor()
  assert.equal(await captions.getAttribute('aria-checked'), 'false')
  assert.equal(await captions.isDisabled(), true)
  await dialog.getByText('The clip’s language isn’t known. Choose the language of its subtitles first.').waitFor()
  await dialog.getByRole('combobox', { name: 'Caption language' }).click()
  await page.getByRole('listbox').getByRole('option', { name: 'English', exact: true }).click()
  assert.equal(await captions.getAttribute('aria-checked'), 'false', 'choosing a language does not turn captions on by itself')
  await captions.click()
  assert.equal(await captions.getAttribute('aria-checked'), 'true')
  await dialog.getByText('Uploads clip_00.srt as closed captions viewers can turn on.').waitFor()

  await dialog.getByRole('radio', { name: 'Schedule' }).click()
  const when = Math.ceil((Date.now() + 3 * 3_600_000) / 60_000) * 60_000
  await dialog.getByLabel('Publish date and time').fill(wallInput(when))
  await dialog.getByRole('button', { name: 'Schedule' }).click()
  await dialog.getByRole('status').getByText('Scheduled', { exact: true }).waitFor({ timeout: 30_000 })

  const [create] = posting.state.creates
  const entry = (platform) => create.body.platforms.find((p) => p.platform === platform)
  assert.equal(entry('instagram').accountId, accounts.instagram._id)
  assert.equal(entry('instagram').platformSpecificData.thumbOffset, 2000)
  assert.equal(entry('twitter').platformSpecificData?.thumbOffset, undefined)
  assert.equal(create.body.mediaItems[0].thumbnail, undefined, 'no platform here takes an image cover, so no frame image is uploaded')
  const [youtubeMedia] = entry('youtube').customMedia
  assert.equal(youtubeMedia.url, create.body.mediaItems[0].url)
  assert.deepEqual(youtubeMedia.subtitles.map((s) => s.language), ['en'])
  const srtUpload = posting.state.uploads.find((u) => u.contentType === 'application/x-subrip')
  assert.equal(srtUpload.sha256, crypto.createHash('sha256').update(SRT).digest('hex'))
  assert.equal(entry('twitter').customMedia, undefined, 'captions go to YouTube only')

  // The calendar shows the scheduled post on its day, in the member's time zone.
  await dialog.getByRole('button', { name: 'View posts' }).click()
  await page.getByRole('radiogroup', { name: 'Posts view' }).getByRole('radio', { name: 'Calendar' }).click()
  const calendar = page.locator('[aria-label="Post calendar"]')
  await calendar.waitFor()
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(when)
  const label = new RegExp(`^Open ${time}, ${TITLE}, YouTube, Instagram, X, Scheduled$`)
  // Week view first; a post three hours out may fall in next week on a Saturday night.
  let chip = calendar.getByRole('button', { name: label }).first()
  if (!(await chip.count())) {
    await calendar.getByRole('button', { name: 'Next week' }).click()
    chip = calendar.getByRole('button', { name: label }).first()
  }
  await chip.waitFor()
  await calendar.getByText(/Times are in your time zone \(Eastern (Daylight|Standard) Time\)/).waitFor()

  // Month view shows it too.
  await calendar.getByRole('radio', { name: 'Month' }).click()
  await calendar.getByRole('button', { name: label }).first().waitFor()
  await calendar.getByRole('radio', { name: 'Week' }).click()

  // Clicking opens the post with its usual actions.
  await chip.click()
  const detail = page.getByRole('dialog')
  await detail.getByText(TITLE).waitFor()
  await detail.getByRole('button', { name: 'Reschedule' }).waitFor()
  await detail.getByRole('button', { name: 'Close' }).click()
  await detail.waitFor({ state: 'detached' })
})
