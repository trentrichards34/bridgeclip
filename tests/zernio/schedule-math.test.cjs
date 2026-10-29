'use strict'
// Wall-clock times in a time zone: upcoming automation slots and spreading
// several clips out in the post dialog, across DST changes.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('./support/load-main.cjs')

const m = loadMain("export * from './src/shared/schedule-math'; export { dueSlots } from './src/shared/automations'", { electron: {} })
const iso = (ms) => new Date(ms).toISOString()
const HOUR = 3_600_000

test('wall times become instants, with DST gaps skipped or moved later and repeats using the first', () => {
  const ny = 'America/New_York'
  assert.equal(iso(m.zonedInstant({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, ny)), '2026-07-01T13:00:00.000Z')
  assert.equal(iso(m.zonedInstant({ year: 2026, month: 12, day: 1, hour: 9, minute: 0 }, ny)), '2026-12-01T14:00:00.000Z')
  // 2026-03-08 02:30 does not exist in New York.
  assert.equal(m.zonedInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, ny, 'skip'), null)
  assert.equal(iso(m.zonedInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, ny, 'later')), '2026-03-08T07:30:00.000Z', 'shown as 3:30 EDT')
  // 2026-11-01 01:30 happens twice; the first is EDT.
  assert.equal(iso(m.zonedInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, ny)), '2026-11-01T05:30:00.000Z')
  // A half-hour zone and one without DST.
  assert.equal(iso(m.zonedInstant({ year: 2026, month: 10, day: 17, hour: 9, minute: 0 }, 'Asia/Kolkata')), '2026-10-17T03:30:00.000Z')
  assert.equal(iso(m.zonedInstant({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, 'Europe/London')), '2026-10-25T00:30:00.000Z', 'first 1:30 is BST')
  assert.equal(m.parseWall('2026-02-30', '09:00'), null)
  assert.equal(m.parseWall('2026-02-28', '24:00'), null)
})

test('upcoming slots: soonest first, limited by count and horizon, in the automation’s zone', () => {
  const now = Date.parse('2026-10-17T12:00:00Z') // 8:00 in New York
  const slots = m.upcomingSlots(['09:00', '18:00', '07:00'], 'America/New_York', now, 3, 48 * HOUR)
  assert.deepEqual(JSON.parse(JSON.stringify(slots)), [
    { time: '09:00', date: '2026-10-17', at: '2026-10-17T13:00:00.000Z' },
    { time: '18:00', date: '2026-10-17', at: '2026-10-17T22:00:00.000Z' },
    { time: '07:00', date: '2026-10-18', at: '2026-10-18T11:00:00.000Z' }
  ])
  assert.equal(m.upcomingSlots(['09:00'], 'America/New_York', now, 5, 30 * HOUR).length, 2, 'the horizon caps it')
  assert.equal(m.upcomingSlots([], 'UTC', now, 3, 48 * HOUR).length, 0)

  // Across the fall-back change the wall time stays 9:00 and the slot shifts an hour in UTC.
  const fall = m.upcomingSlots(['09:00'], 'America/New_York', Date.parse('2026-10-31T14:00:00Z'), 2, 48 * HOUR)
  assert.deepEqual(fall.map((slot) => slot.at), ['2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z'])
  // A slot in the spring-forward gap is skipped that day, as the in-app runner does.
  const spring = m.upcomingSlots(['02:30'], 'America/New_York', Date.parse('2026-03-07T12:00:00Z'), 3, 72 * HOUR)
  assert.deepEqual(spring.map((slot) => [slot.date, slot.at]), [['2026-03-09', '2026-03-09T06:30:00.000Z'], ['2026-03-10', '2026-03-10T06:30:00.000Z']], 'no 2:30 on the day clocks skip it')
  // Every slot the app would run (dueSlots) is the one scheduled ahead.
  for (const slot of fall) assert.deepEqual(JSON.parse(JSON.stringify(m.dueSlots(['09:00'], 'America/New_York', Date.parse(slot.at), 1))), [{ time: '09:00', date: slot.date }])
})

test('spreading clips: one every interval on the wall clock, so 9:00 stays 9:00 across DST', () => {
  const ny = 'America/New_York'
  const daily = m.spreadSchedule('2026-10-31T09:00', 3, '1d', ny)
  assert.deepEqual(daily.map(iso), ['2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z'])
  const twelve = m.spreadSchedule('2026-10-17T21:00', 3, '12h', 'UTC')
  assert.deepEqual(twelve.map(iso), ['2026-10-17T21:00:00.000Z', '2026-10-18T09:00:00.000Z', '2026-10-18T21:00:00.000Z'])
  // A time inside the spring-forward gap moves an hour later instead of disappearing.
  const spring = m.spreadSchedule('2026-03-07T02:30', 2, '1d', ny)
  assert.deepEqual(spring.map(iso), ['2026-03-07T07:30:00.000Z', '2026-03-08T07:30:00.000Z'])
  // Every 6 hours over midnight, in a zone east of UTC.
  assert.deepEqual(m.spreadSchedule('2026-10-17T22:00', 2, '6h', 'Asia/Tokyo').map(iso), ['2026-10-17T13:00:00.000Z', '2026-10-17T19:00:00.000Z'])
  assert.deepEqual(m.spreadSchedule('not a time', 2, '1d', ny), [])
  assert.deepEqual(m.spreadSchedule('2026-10-17T09:00', 2, 'weekly', ny), [])
})
