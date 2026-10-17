'use strict'
// Automations scheduling their next slots with Zernio ahead of time, so they
// post while CreatorClips is closed: no slot posts twice, pausing or editing
// cancels, and everything survives a restart. Local mock Zernio only.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadMain, tempDir, fakeElectron, ROOT } = require('./support/load-main.cjs')
const { createMockZernio } = require('./support/mock-zernio.cjs')
const { createPostingMock } = require('./support/mock-posts.cjs')

const KEY = 'ahead-schedule-key'
const FFMPEG = fs.existsSync(path.join(ROOT, 'engine-bin/ffmpeg')) ? path.join(ROOT, 'engine-bin/ffmpeg') : 'ffmpeg'
const entry = "export * as automations from './src/main/automations'; export * as settings from './src/main/settings-store'; export * as posts from './src/main/zernio/posts'"
const MINUTE = 60_000

function hhmm(ms) {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

async function fixture(t, { clips = 4 } = {}) {
  const { dir, cleanup } = tempDir('bridgeclip-ahead-')
  const posting = createPostingMock()
  const mock = await createMockZernio({ apiKey: KEY, extraRoutes: posting.routes })
  const previous = { url: process.env.BRIDGECLIP_ZERNIO_API_URL, path: process.env.PATH }
  process.env.BRIDGECLIP_ZERNIO_API_URL = mock.apiUrl
  process.env.PATH = `${previous.path}${path.delimiter}${path.join(ROOT, 'engine-bin')}`
  const realNow = Date.now
  t.after(async () => {
    Date.now = realNow
    if (previous.url === undefined) delete process.env.BRIDGECLIP_ZERNIO_API_URL
    else process.env.BRIDGECLIP_ZERNIO_API_URL = previous.url
    process.env.PATH = previous.path
    await mock.close(); cleanup()
  })
  const { electron } = fakeElectron(dir)
  const main = loadMain(entry, { electron })
  main.settings.replaceApiKey('zernioApiKey', KEY)
  const library = path.join(dir, 'library'); const run = path.join(library, 'run'); fs.mkdirSync(run, { recursive: true })
  main.settings.savePublicSettings({ outputDirectory: library, pythonPath: 'python3' })
  const colors = ['blue', 'red', 'green', 'yellow', 'white'].slice(0, clips)
  const files = colors.map((color, index) => {
    const file = path.join(run, `clip_${index}.mp4`)
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:d=2:r=15`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', file])
    return file
  })
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ source_video_title: 'Source', source_video_url: '', clips: files.map((file, index) => ({ clip_index: index, s3_url: `file://${file}`, duration_ms: 2000, start_time_ms: 0, end_time_ms: 2000, summary: `Clip ${index}`, virality_score: 0.5 })) }))
  const [created] = main.automations.createAutomation('Ahead')
  const profile = mock.state.profiles[0]
  const account = mock.addAccount('youtube', profile._id)
  // Three daily times over the next few hours (UTC), so all are within the 48-hour horizon.
  const base = Math.ceil(Date.now() / MINUTE) * MINUTE
  const times = [65, 125, 185].map((minutes) => hhmm(base + minutes * MINUTE))
  const settings = { name: 'Ahead', enabled: true, profileId: profile._id, metadataMode: 'manual', timezone: 'UTC', times, youtubeVisibility: 'unlisted', youtubeMadeForKids: false, accounts: [{ platform: 'youtube', accountId: account._id }], scheduleAhead: true }
  await main.automations.updateAutomation(created.id, settings)
  await main.automations.addLibraryClipsToAutomation(created.id, run, colors.map((_, index) => index))
  let offset = 0
  return {
    main, electron, posting, mock, id: created.id, times, settings,
    bank: () => main.automations.listAutomations()[0],
    ahead: () => main.automations.listAutomations()[0].content.filter((item) => item.aheadSlot),
    sync: () => main.automations.syncAutomationSchedule(created.id),
    update: (changes) => main.automations.updateAutomation(created.id, { ...settings, ...changes }),
    deletes: () => mock.state.requests.filter((request) => request.method === 'DELETE').length,
    advance: (ms) => { offset += ms; Date.now = () => realNow() + offset }
  }
}

test('the next slots are scheduled with Zernio once, and the app never posts a covered slot again', async (t) => {
  const f = await fixture(t)
  await f.sync()
  assert.equal(f.posting.state.creates.length, 3)
  const slots = f.ahead().map((item) => item.aheadSlot)
  assert.deepEqual(slots.map((slot) => slot.time), f.times)
  for (const [index, create] of f.posting.state.creates.entries()) {
    assert.equal(create.body.publishNow, undefined)
    assert.equal(create.body.scheduledFor, slots[index].at)
    assert.equal(create.body.timezone, 'UTC')
  }
  const bank = f.bank()
  assert.deepEqual(bank.content.map((item) => item.status), ['posted', 'posted', 'posted', 'queued'], 'queue order is kept: the first three clips fill the slots')
  assert.ok(f.ahead().every((item) => item.postId && item.postedAt === null), 'submitted when the slot comes, not before')

  await f.sync()
  assert.equal(f.posting.state.creates.length, 3, 'a second pass adds nothing')
  // The in-app runner reaches a covered slot: nothing posts.
  await f.main.automations.runAutomation(f.id, { time: slots[0].time, date: slots[0].date })
  assert.equal(f.posting.state.creates.length, 3)
  assert.equal(f.bank().content[3].status, 'queued', 'the next clip stays queued')
  // Covered clips can't be edited or removed until unscheduled.
  assert.throws(() => f.main.automations.updateAutomationContent(f.id, bank.content[0].id, { title: 'New', caption: 'New' }), /Unschedule it first/)
  assert.throws(() => f.main.automations.removeAutomationContent(f.id, bank.content[0].id), /Unschedule it first/)
  assert.throws(() => f.main.automations.deleteAutomation(f.id), /Pause it first/)
})

test('pausing cancels the scheduled posts; resuming schedules them again with the same uploads', async (t) => {
  const f = await fixture(t)
  await f.sync()
  assert.equal(f.posting.state.uploads.length, 3)
  await f.update({ enabled: false })
  assert.equal(f.deletes(), 3)
  assert.equal(f.posting.state.posts.size, 0, 'Zernio has nothing scheduled')
  assert.deepEqual(f.bank().content.map((item) => item.status), ['queued', 'queued', 'queued', 'queued'])
  assert.equal(f.ahead().length, 0)
  assert.deepEqual(f.bank().lastSlots, {}, 'no slot was used')
  await f.sync()
  assert.equal(f.posting.state.creates.length, 3, 'a paused automation schedules nothing')

  await f.update({ enabled: true })
  await f.sync()
  assert.equal(f.posting.state.creates.length, 6)
  assert.equal(f.posting.state.uploads.length, 3, 'Zernio still had the uploads, so they were reused')
  assert.deepEqual(f.ahead().map((item) => item.aheadSlot.time), f.times)

  // Turning schedule-ahead off cancels too, and leaves the slots to the app.
  await f.update({ scheduleAhead: false })
  assert.equal(f.deletes(), 6)
  assert.equal(f.ahead().length, 0)
})

test('changing the times cancels only the slots that no longer exist', async (t) => {
  const f = await fixture(t)
  await f.sync()
  const [first, second] = f.ahead()
  await f.update({ times: f.times.slice(0, 2) })
  assert.equal(f.deletes(), 1)
  assert.deepEqual(f.ahead().map((item) => item.id), [first.id, second.id])
  assert.equal(f.bank().content[2].status, 'queued')
  await f.sync()
  // The two remaining times are covered; the third slot is now tomorrow's first time.
  assert.equal(f.posting.state.creates.length, 4)
  const third = f.ahead().find((item) => item.id !== first.id && item.id !== second.id).aheadSlot
  assert.equal(third.time, f.times[0])
  assert.equal(Date.parse(third.at), Date.parse(first.aheadSlot.at) + 86_400_000)
})

test('a failed cancellation is kept, reported, and retried until Zernio confirms it', async (t) => {
  const f = await fixture(t)
  await f.sync()
  f.posting.state.failNextDelete = 500
  await f.update({ enabled: false })
  const bank = f.bank()
  assert.equal(bank.content.filter((item) => item.aheadSlot?.cancel).length, 1, 'one is still marked for cancellation')
  assert.match(bank.lastError, /Couldn’t cancel a post scheduled with Zernio/)
  assert.equal(f.posting.state.posts.size, 1)
  await f.sync()
  assert.equal(f.posting.state.posts.size, 0, 'retried and cancelled')
  assert.equal(f.ahead().length, 0)
  assert.ok(f.bank().content.every((item) => item.status === 'queued'))
})

test('closing and reopening keeps every slot covered, including one cut off mid-request', async (t) => {
  const f = await fixture(t)
  await f.sync()
  const slots = f.ahead().map((item) => item.aheadSlot)
  // Reopen: a fresh main process on the same data.
  let reopened = loadMain(entry, { electron: f.electron })
  assert.equal(reopened.automations.listAutomations()[0].content.filter((item) => item.aheadSlot).length, 3)
  await reopened.automations.syncAutomationSchedule(f.id)
  assert.equal(f.posting.state.creates.length, 3, 'nothing is posted twice after a restart')

  // A crash while handing over a slot: the clip was mid-request.
  const userData = f.electron.app.getPath('userData')
  const store = path.join(userData, fs.readdirSync(userData).find((name) => /^automations-.*\.json$/.test(name)))
  const saved = JSON.parse(fs.readFileSync(store, 'utf8'))
  const cut = saved.automations[0].content[2]
  Object.assign(cut, { status: 'posting', postId: null })
  fs.writeFileSync(store, JSON.stringify(saved))
  reopened = loadMain(entry, { electron: f.electron })
  const recovered = reopened.automations.listAutomations()[0].content[2]
  assert.equal(recovered.status, 'needs_review', 'held for a person to check Zernio')
  assert.equal(recovered.aheadSlot.time, slots[2].time, 'its slot stays covered')
  await reopened.automations.runAutomation(f.id, { time: slots[2].time, date: slots[2].date })
  await reopened.automations.syncAutomationSchedule(f.id)
  assert.equal(f.posting.state.creates.length, 3, 'the uncertain slot is not given another clip')
})

test('when a slot comes it counts as submitted; a post cancelled in Posts frees its clip but skips the slot', async (t) => {
  const f = await fixture(t)
  await f.sync()
  const [first, second] = f.ahead()
  // Cancelled from the Posts page: the clip returns to the queue and that slot stays empty.
  await f.main.posts.cancelPost(second.postId)
  await f.sync()
  let bank = f.bank()
  const back = bank.content.find((item) => item.id === second.id)
  assert.equal(back.status, 'queued')
  assert.equal(back.aheadSlot, null)
  assert.deepEqual(bank.skippedSlots, [`${second.aheadSlot.date}/${second.aheadSlot.time}`])
  assert.equal(f.posting.state.creates.length, 3, 'the skipped slot is not rescheduled')
  await f.main.automations.runAutomation(f.id, { time: second.aheadSlot.time, date: second.aheadSlot.date })
  assert.equal(f.posting.state.creates.length, 3, 'the app skips it too')

  // Time passes the first slot: Zernio published it, and the app records it.
  f.advance(Date.parse(first.aheadSlot.at) - Date.now() + MINUTE)
  await f.main.automations.runAutomation(f.id, { time: first.aheadSlot.time, date: first.aheadSlot.date })
  bank = f.bank()
  const done = bank.content.find((item) => item.id === first.id)
  assert.equal(done.status, 'posted')
  assert.equal(done.postedAt, first.aheadSlot.at)
  assert.equal(done.aheadSlot, null)
  assert.equal(bank.lastSlots[first.aheadSlot.time], first.aheadSlot.date)
  assert.equal(f.posting.state.creates.length, 3)
})

test('unscheduling one clip gives its slot to the next clip and holds it for editing', async (t) => {
  const f = await fixture(t)
  await f.sync()
  const [first] = f.ahead()
  await f.main.automations.unscheduleAutomationContent(f.id, first.id)
  let bank = f.bank()
  assert.equal(bank.content[0].status, 'queued')
  assert.equal(f.posting.state.posts.size, 2)
  // Editable now.
  f.main.automations.updateAutomationContent(f.id, first.id, { title: 'Edited', caption: 'Edited caption' })
  await f.sync()
  bank = f.bank()
  assert.equal(f.posting.state.creates.length, 4)
  const refilled = bank.content.find((item) => item.aheadSlot?.time === first.aheadSlot.time)
  assert.equal(refilled.id, bank.content[3].id, 'the next queued clip takes the slot, not the held one')
  assert.equal(bank.content[0].status, 'queued')
  await assert.rejects(() => f.main.automations.unscheduleAutomationContent(f.id, first.id), /isn’t scheduled/)
})
