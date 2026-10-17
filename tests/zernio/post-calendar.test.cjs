'use strict'
// The Posts calendar: days in the member's time zone (DST days are 23 or 25
// hours), and one-off posts merged with upcoming automation slots.

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('./support/load-main.cjs')

const cal = loadMain("export * from './src/shared/zernio-calendar'", { electron: {} })
const NY = 'America/New_York'
const HOUR = 3_600_000
const at = (iso) => Date.parse(iso)

function post(id, status, scheduledFor, extra = {}) {
  return {
    id: id.padEnd(24, '0'), clipPath: `/lib/${id}.mp4`, clipTitle: `Clip ${id}`, status, scheduledFor, timezone: scheduledFor ? NY : null, error: null,
    createdAt: '2026-10-20T12:00:00.000Z', uploadedAt: '2026-10-20T12:00:00.000Z', refreshedAt: null,
    targets: [{ platform: 'tiktok', accountId: 't'.repeat(24), handle: '@me', status: 'pending', error: null, url: null, inbox: false }],
    ...extra
  }
}

test('week view: Sunday to Saturday in the member’s zone, with a readable title', () => {
  const now = at('2026-10-28T12:00:00Z')
  const range = cal.calendarRange('week', now, now, NY)
  assert.deepEqual(range.days.map((d) => d.date), ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
  assert.equal(range.title, 'Oct 25 – 31, 2026')
  assert.equal(range.days[0].start, at('2026-10-25T04:00:00Z'), 'midnight EDT')
  assert.equal(range.days.find((d) => d.today).date, '2026-10-28')
  assert.ok(range.days.every((d) => d.inMonth))
  // A week across months and years.
  assert.equal(cal.calendarRange('week', at('2026-12-31T12:00:00Z'), now, NY).title, 'Dec 27, 2026 – Jan 2, 2027')
  assert.equal(cal.calendarRange('week', at('2026-10-01T12:00:00Z'), now, NY).title, 'Sep 27 – Oct 3, 2026')
})

test('month view: whole weeks around the month; the DST days are 25 and 23 hours long', () => {
  const now = at('2026-10-28T12:00:00Z')
  const november = cal.calendarRange('month', at('2026-11-15T12:00:00Z'), now, NY)
  assert.equal(november.title, 'November 2026')
  assert.equal(november.days.length, 35)
  assert.equal(november.days[0].date, '2026-11-01')
  assert.equal(november.days.at(-1).date, '2026-12-05')
  assert.equal(november.days.filter((d) => d.inMonth).length, 30)
  const fallBack = november.days[0]
  assert.equal(fallBack.end + 1 - fallBack.start, 25 * HOUR, 'clocks go back on Nov 1, 2026')

  const march = cal.calendarRange('month', at('2027-03-10T12:00:00Z'), now, NY)
  const springForward = march.days.find((d) => d.date === '2027-03-14')
  assert.equal(springForward.end + 1 - springForward.start, 23 * HOUR)
  assert.equal(march.days[0].date, '2027-02-28')
  // Days tile the range with no gaps or overlaps.
  for (let i = 1; i < march.days.length; i++) assert.equal(march.days[i].start, march.days[i - 1].end + 1)
})

test('moving by week or month keeps to the wall clock across DST', () => {
  const anchor = at('2026-10-28T16:00:00Z')
  assert.equal(cal.dayKey(cal.shiftAnchor(anchor, 'week', 1, NY), NY), '2026-11-04')
  assert.equal(cal.dayKey(cal.shiftAnchor(anchor, 'week', -1, NY), NY), '2026-10-21')
  assert.equal(cal.dayKey(cal.shiftAnchor(anchor, 'month', 1, NY), NY), '2026-11-01')
  assert.equal(cal.dayKey(cal.shiftAnchor(at('2027-01-31T16:00:00Z'), 'month', 1, NY), NY), '2027-02-01')
  assert.equal(cal.dayKey(cal.shiftAnchor(anchor, 'month', -10, NY), NY), '2025-12-01')
})

test('posts land on the member’s day, not UTC’s; cancelled, missing and draft posts are left out', () => {
  const now = at('2026-10-28T12:00:00Z')
  const range = cal.calendarRange('week', now, now, NY)
  const posts = [
    post('late', 'scheduled', '2026-10-29T03:30:00.000Z'), // 11:30 PM on the 28th in New York
    post('done', 'published', null, { createdAt: '2026-10-26T15:00:00.000Z' }),
    post('gone', 'cancelled', '2026-10-29T15:00:00.000Z'),
    post('lost', 'missing', '2026-10-29T15:00:00.000Z'),
    post('out', 'scheduled', '2026-11-03T15:00:00.000Z')
  ]
  const byDay = cal.calendarItems({ posts, automations: [], start: range.start, end: range.end, now, timeZone: NY })
  assert.deepEqual([...byDay.keys()], ['2026-10-26', '2026-10-28'])
  assert.equal(byDay.get('2026-10-28')[0].title, 'Clip late')
  assert.equal(cal.formatCalendarTime(byDay.get('2026-10-28')[0].at, NY), '11:30 PM')
  // The same post in a zone ahead of UTC is on the 29th.
  const tokyo = cal.calendarItems({ posts, automations: [], start: range.start, end: range.end, now, timeZone: 'Asia/Tokyo' })
  assert.ok(tokyo.get('2026-10-29').some((item) => item.title === 'Clip late'))
})

test('automation slots join the posts: in the automation’s zone, shown in the member’s, and a slot already scheduled with Zernio shows once, as its post', () => {
  const now = at('2026-10-28T12:00:00Z')
  const range = cal.calendarRange('week', now, now, NY)
  const ahead = post('ahead', 'scheduled', '2026-10-29T09:00:00.000Z', { targets: [{ platform: 'youtube', accountId: 'y'.repeat(24), handle: null, status: 'pending', error: null, url: null, inbox: false }] })
  const content = (id, title, extra = {}) => ({ id, fileName: `${id}.mp4`, title, caption: '', transcript: null, generatedMetadata: null, status: 'queued', addedAt: '2026-10-20T00:00:00.000Z', postedAt: null, postId: null, error: null, ...extra })
  const automation = {
    id: 'auto-1', name: 'Daily Shorts', enabled: true, profileId: 'p', metadataMode: 'manual',
    accounts: [{ accountId: 'y'.repeat(24), platform: 'youtube' }],
    times: ['09:00'], timezone: 'Europe/London', youtubeVisibility: 'public', youtubeMadeForKids: false, lastSlots: {},
    content: [
      content('c1', 'Ahead clip', { status: 'posted', postId: ahead.id, aheadSlot: { date: '2026-10-29', time: '09:00', at: '2026-10-29T09:00:00.000Z' } }),
      content('c2', 'Queued clip')
    ],
    createdAt: '2026-10-01T00:00:00.000Z', lastRunAt: null, lastError: null, scheduleAhead: true
  }
  const paused = { ...automation, id: 'auto-2', name: 'Paused', enabled: false }
  const byDay = cal.calendarItems({ posts: [ahead], automations: [automation, paused], start: range.start, end: range.end, now, timeZone: NY })
  const flat = [...byDay.values()].flat()
  // 09:00 in London (GMT after Oct 25) is 5:00 AM in New York.
  assert.deepEqual(flat.map((item) => [item.kind, cal.dayKey(item.at, NY), cal.formatCalendarTime(item.at, NY), item.kind === 'post' ? item.title : item.state]), [
    ['post', '2026-10-29', '5:00 AM', 'Clip ahead'],
    ['slot', '2026-10-30', '5:00 AM', 'app'],
    ['slot', '2026-10-31', '5:00 AM', 'empty']
  ])
  assert.equal(flat[0].automationName, 'Daily Shorts', 'the post is labelled with its automation')
  assert.equal(flat[1].title, 'Queued clip')
  assert.deepEqual(flat[1].platforms, ['youtube'])
  assert.equal(flat[1].automationId, 'auto-1')

  // Without its post in the history, the Zernio slot itself shows.
  const withoutPost = [...cal.calendarItems({ posts: [], automations: [automation], start: range.start, end: range.end, now, timeZone: NY }).values()].flat()
  assert.equal(withoutPost[0].kind, 'slot')
  assert.equal(withoutPost[0].state, 'zernio')

  // Past weeks have no slots, only what was posted.
  const last = cal.calendarRange('week', at('2026-10-14T12:00:00Z'), now, NY)
  assert.equal(cal.calendarItems({ posts: [], automations: [automation], start: last.start, end: last.end, now, timeZone: NY }).size, 0)
})

test('automation slots follow the automation’s DST, not the member’s', () => {
  // London goes back on Oct 25, New York on Nov 1: in between, 09:00 London is 5 AM in New York, otherwise 4 AM.
  const now = at('2026-10-20T12:00:00Z')
  const range = cal.calendarRange('month', at('2026-10-20T12:00:00Z'), now, NY)
  const automation = {
    id: 'a', name: 'A', enabled: true, profileId: 'p', metadataMode: 'manual', accounts: [{ accountId: 'y'.repeat(24), platform: 'youtube' }],
    times: ['09:00'], timezone: 'Europe/London', youtubeVisibility: 'public', youtubeMadeForKids: false, lastSlots: {}, content: [],
    createdAt: '2026-10-01T00:00:00.000Z', lastRunAt: null, lastError: null
  }
  const byDay = cal.calendarItems({ posts: [], automations: [automation], start: range.start, end: range.end, now, timeZone: NY })
  const time = (day) => cal.formatCalendarTime(byDay.get(day)[0].at, NY)
  assert.equal(time('2026-10-24'), '4:00 AM')
  assert.equal(time('2026-10-26'), '5:00 AM')
  const november = cal.calendarRange('month', at('2026-11-10T12:00:00Z'), now, NY)
  const later = cal.calendarItems({ posts: [], automations: [automation], start: november.start, end: november.end, now, timeZone: NY })
  assert.equal(cal.formatCalendarTime(later.get('2026-11-02')[0].at, NY), '4:00 AM')
  assert.equal(later.get('2026-11-02')[0].state, 'empty')
})
