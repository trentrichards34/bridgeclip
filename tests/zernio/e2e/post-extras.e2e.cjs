'use strict'
// End to end against the local mock Zernio: the post dialog's optional first
// comment (prefilled from a Remix caption's comment keyword, shown only for
// platforms that support it) and spreading several clips out in time.
//
//   npm run build && xvfb-run -a node --test tests/zernio/e2e/post-extras.e2e.cjs

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createMockZernio } = require('../support/mock-zernio.cjs')
const { createPostingMock } = require('../support/mock-posts.cjs')
const { buildApp, launchApp, ROOT } = require('../support/electron-app.cjs')
const { loadMain } = require('../support/load-main.cjs')

const KEY = 'e2e-post-extras-key-not-a-secret'
const FFMPEG = fs.existsSync(path.join(ROOT, 'engine-bin', 'ffmpeg')) ? path.join(ROOT, 'engine-bin', 'ffmpeg') : 'ffmpeg'
// A zone with DST, so the dialog's wall-clock math is exercised for real.
const TZ = 'America/New_York'
const CTA = 'Comment SALES and I’ll send you the pricing checklist.'
const TITLES = ['Three ways to raise prices', 'A second clip']
const { spreadSchedule } = loadMain("export { spreadSchedule } from './src/shared/schedule-math'", { electron: {} })

function seedLibrary(library) {
  const jobDir = path.join(library, '22222222-3333-4444-5555-666666666666')
  fs.mkdirSync(jobDir, { recursive: true })
  const clips = TITLES.map((title, i) => {
    const file = path.join(jobDir, `clip_${i + 1}.mp4`)
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=4:r=15', '-f', 'lavfi', '-i', `sine=frequency=${330 + i * 110}:duration=4`,
      '-shortest', '-c:v', 'mpeg4', '-q:v', '6', '-c:a', 'aac', '-movflags', '+faststart', file])
    return {
      clip_index: i, s3_url: `file://${file}`, duration_ms: 4000, start_time_ms: 0, end_time_ms: 4000, virality_score: 0.7, layout_type: 'talking_head', summary: title, tags: [],
      ...(i === 0 ? { post_caption: `Most people price too low.\n\n${CTA}`, ai_generated: true } : {})
    }
  })
  fs.writeFileSync(path.join(jobDir, 'job_output.json'), JSON.stringify({ job_id: 'extras', source_video_url: '', source_video_title: 'Extras run', source_video_duration_seconds: 60,
    total_clips: clips.length, clips, transcript_url: null, plan_url: null, processing_time_seconds: 1, metrics: null, created_at: new Date().toISOString() }))
}

let appDir = null
async function start(t) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-post-extras-'))
  const posting = createPostingMock()
  const mock = await createMockZernio({ apiKey: KEY, extraRoutes: posting.routes })
  let app = null
  t.after(async () => { await app?.close(); await mock.close(); fs.rmSync(work, { recursive: true, force: true }) })
  const [profile] = mock.state.profiles
  const accounts = {
    tiktok: mock.addAccount('tiktok', profile._id, { username: 'clipper' }),
    youtube: mock.addAccount('youtube', profile._id, { username: 'channel' }),
    instagram: mock.addAccount('instagram', profile._id, { username: 'insta' })
  }
  const userDataDir = path.join(work, 'userData')
  seedLibrary(path.join(userDataDir, 'CreatorClips'))
  appDir ??= buildApp(process.env.BRIDGECLIP_E2E_APP_DIR || path.join(os.tmpdir(), 'bridgeclip-post-extras-e2e-app'))
  app = await launchApp({ appDir, userDataDir, mock, env: { TZ } })
  await app.app.evaluate(({ shell }) => { shell.openExternal = async () => {} })
  await app.page.evaluate((value) => window.bridgeclip.settings.replaceApiKey('zernioApiKey', value), KEY)
  await app.page.reload()
  await app.page.waitForLoadState('domcontentloaded')
  await app.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Library/ }).click()
  await app.page.getByRole('button', { name: 'Open Extras run', exact: true }).click()
  return { ...app, posting, accounts }
}

/** `YYYY-MM-DDTHH:mm` for `ms` on the wall clock in TZ, as a datetime-local input takes it. */
function wallInput(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(ms).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

test('first comment: prefilled from the keyword CTA, shown only for platforms that support it, and posted there', { timeout: 300_000 }, async (t) => {
  const { page, posting, accounts } = await start(t)
  await page.getByRole('button', { name: `Actions for “${TITLES[0]}”` }).click()
  await page.getByRole('menuitem', { name: 'Post or schedule', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: /^TikTok/ }).waitFor()
  assert.equal(await dialog.getByLabel('First comment').count(), 0, 'hidden until an account is chosen')

  await dialog.getByRole('checkbox', { name: /^TikTok/ }).click()
  await dialog.getByLabel('Who can view this video').waitFor()
  assert.equal(await dialog.getByLabel('First comment').count(), 0, 'TikTok has no first-comment option')

  await dialog.getByRole('checkbox', { name: /^Instagram/ }).click()
  const comment = dialog.getByLabel('First comment')
  await comment.waitFor()
  assert.equal(await comment.inputValue(), CTA, 'prefilled with the caption’s keyword line')
  await dialog.getByText(/Zernio adds it as the first comment on Instagram right after the post goes up\. TikTok doesn’t support it\. Filled in from your caption’s comment keyword\./).waitFor()

  // Post to Instagram and YouTube only.
  await dialog.getByRole('checkbox', { name: /^TikTok/ }).click()
  await dialog.getByRole('checkbox', { name: /^YouTube/ }).click()
  await dialog.getByText(/first comment on (Instagram, YouTube|YouTube, Instagram) right after/).waitFor()
  await comment.fill(`${CTA} Link in bio too.`)
  await dialog.getByRole('button', { name: 'Post now' }).click()
  await dialog.getByRole('status').getByText('Posted', { exact: true }).waitFor({ timeout: 30_000 })

  const [create] = posting.state.creates
  const byPlatform = Object.fromEntries(create.body.platforms.map((target) => [target.platform, target]))
  assert.equal(byPlatform.instagram.accountId, accounts.instagram._id)
  assert.equal(byPlatform.instagram.platformSpecificData.firstComment, `${CTA} Link in bio too.`)
  assert.equal(byPlatform.youtube.platformSpecificData.firstComment, `${CTA} Link in bio too.`)
  assert.equal(create.body.content.includes(CTA), true, 'the caption keeps its CTA')
})

test('spread out: several clips get one time each, a day apart on the wall clock', { timeout: 300_000 }, async (t) => {
  const { page, posting } = await start(t)
  await page.getByRole('checkbox', { name: 'Select all clips' }).click()
  await page.getByRole('button', { name: 'Post 2' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Post clip 1 of 2').waitFor()
  await dialog.getByRole('checkbox', { name: /^YouTube/ }).click()
  await dialog.getByRole('radio', { name: 'Schedule' }).click()
  const firstAt = wallInput(Math.ceil((Date.now() + 3 * 3_600_000) / 60_000) * 60_000)
  await dialog.getByLabel('Publish date and time').fill(firstAt)
  await dialog.getByRole('switch', { name: 'Spread out' }).click()
  await dialog.getByLabel('First clip date and time').waitFor()
  const expected = spreadSchedule(firstAt, 2, '1d', TZ)
  const list = dialog.getByRole('list', { name: 'Clip publish times' })
  assert.match(await list.textContent(), /Clip 1 \(this one\).*Clip 2/)

  // Every 12 hours instead.
  await dialog.getByRole('combobox', { name: 'Time between clips' }).click()
  await page.getByRole('listbox').getByRole('option', { name: '12 hours', exact: true }).click()
  const twelve = spreadSchedule(firstAt, 2, '12h', TZ)
  assert.equal(twelve[1] - twelve[0], 12 * 3_600_000)
  // And back to a day.
  await dialog.getByRole('combobox', { name: 'Time between clips' }).click()
  await page.getByRole('listbox').getByRole('option', { name: 'day', exact: true }).click()

  await dialog.getByRole('button', { name: 'Schedule' }).click()
  await dialog.getByRole('status').getByText('Scheduled', { exact: true }).waitFor({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Next clip (2 of 2)' }).click()
  await dialog.getByText('Post clip 2 of 2').waitFor()
  assert.equal(await dialog.getByLabel('First clip date and time').isDisabled(), true, 'the first time is fixed once a clip went out')
  assert.match(await list.textContent(), /Clip 2 \(this one\)/)
  await dialog.getByRole('button', { name: 'Schedule' }).click()
  await dialog.getByRole('status').getByText('Scheduled', { exact: true }).waitFor({ timeout: 30_000 })

  assert.deepEqual(posting.state.creates.map((create) => create.body.scheduledFor), expected.map((ms) => new Date(ms).toISOString()))
  assert.ok(posting.state.creates.every((create) => create.body.timezone === TZ))
})
