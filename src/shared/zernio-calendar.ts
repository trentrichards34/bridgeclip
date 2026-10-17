// The Posts calendar: one-off posts (scheduled and published) and upcoming
// automation slots, laid out by day in the member's time zone. Pure, so the
// time zone and DST handling can be tested directly.

import { upcomingPlan, type Automation, type UpcomingState } from './automations'
import { upcomingSlots, wallTime, zonedInstant } from './schedule-math'
import type { PostRecord, PostStatus } from './zernio-posts'

export type CalendarView = 'week' | 'month'

export interface CalendarDay {
  /** YYYY-MM-DD on the member's wall clock. */
  date: string
  /** First and last instant of the day (ms). A DST day is 23 or 25 hours long. */
  start: number
  end: number
  /** False for the leading and trailing days of a month grid. */
  inMonth: boolean
  today: boolean
}

export interface CalendarRange {
  days: CalendarDay[]
  start: number
  end: number
  /** "October 2026" or "Oct 11 – 17, 2026". */
  title: string
}

export type CalendarItem =
  | { kind: 'post'; key: string; at: number; post: PostRecord; status: PostStatus; platforms: string[]; title: string; automationName: string | null }
  | { kind: 'slot'; key: string; at: number; automationId: string; automationName: string; state: UpcomingState; platforms: string[]; title: string | null }

const pad = (value: number): string => String(value).padStart(2, '0')

/** YYYY-MM-DD of `at` in `timeZone`. */
export function dayKey(at: number, timeZone: string): string {
  const wall = wallTime(at, timeZone)
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`
}

/** Calendar arithmetic on dates only (no time zone). */
function addDays(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}

function weekday(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
}

/** Midnight of a wall date in `timeZone`; a zone whose clocks skip midnight starts the day at the first real minute. */
function dayStart(date: { year: number; month: number; day: number }, timeZone: string): number {
  return zonedInstant({ ...date, hour: 0, minute: 0 }, timeZone, 'later') ?? Date.UTC(date.year, date.month - 1, date.day)
}

/** Moves the anchor by whole weeks or months on the wall clock. */
export function shiftAnchor(anchor: number, view: CalendarView, steps: number, timeZone: string): number {
  const wall = wallTime(anchor, timeZone)
  if (view === 'week') return dayStart(addDays(wall, steps * 7), timeZone) + 12 * 3_600_000
  const month = new Date(Date.UTC(wall.year, wall.month - 1 + steps, 1))
  return dayStart({ year: month.getUTCFullYear(), month: month.getUTCMonth() + 1, day: 1 }, timeZone) + 12 * 3_600_000
}

/**
 * The days on screen: the week (Sunday first, as US calendars show it) or
 * the month grid (whole weeks covering the month) around `anchor`.
 */
export function calendarRange(view: CalendarView, anchor: number, now: number, timeZone: string): CalendarRange {
  const wall = wallTime(anchor, timeZone)
  const today = dayKey(now, timeZone)
  let first: { year: number; month: number; day: number }
  let count: number
  if (view === 'week') {
    first = addDays(wall, -weekday(wall))
    count = 7
  } else {
    const firstOfMonth = { year: wall.year, month: wall.month, day: 1 }
    first = addDays(firstOfMonth, -weekday(firstOfMonth))
    const nextMonth = addDays({ year: wall.year, month: wall.month, day: 28 }, 4)
    const lastOfMonth = addDays({ ...nextMonth, day: 1 }, -1)
    const lastDay = addDays(lastOfMonth, 6 - weekday(lastOfMonth))
    count = Math.round((Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day) - Date.UTC(first.year, first.month - 1, first.day)) / 86_400_000) + 1
  }
  const days: CalendarDay[] = []
  for (let i = 0; i < count; i++) {
    const date = addDays(first, i)
    const start = dayStart(date, timeZone)
    const end = dayStart(addDays(date, 1), timeZone) - 1
    const key = `${date.year}-${pad(date.month)}-${pad(date.day)}`
    days.push({ date: key, start, end, inMonth: view === 'week' || date.month === wall.month, today: key === today })
  }
  const format = (at: number, options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(at)
  const title = view === 'month'
    ? format(anchor, { month: 'long', year: 'numeric' })
    : formatWeekTitle(days[0].start, days[6].start, timeZone)
  return { days, start: days[0].start, end: days[days.length - 1].end, title }
}

function formatWeekTitle(start: number, end: number, timeZone: string): string {
  const a = wallTime(start, timeZone)
  const b = wallTime(end, timeZone)
  const month = (at: number): string => new Intl.DateTimeFormat('en-US', { timeZone, month: 'short' }).format(at)
  if (a.year !== b.year) return `${month(start)} ${a.day}, ${a.year} – ${month(end)} ${b.day}, ${b.year}`
  if (a.month !== b.month) return `${month(start)} ${a.day} – ${month(end)} ${b.day}, ${b.year}`
  return `${month(start)} ${a.day} – ${b.day}, ${b.year}`
}

/** When a post shows on the calendar: its publish time, else when it was made. Null for posts that won't happen. */
export function postInstant(post: PostRecord): number | null {
  if (post.status === 'cancelled' || post.status === 'missing' || post.status === 'draft') return null
  const at = Date.parse(post.scheduledFor ?? post.createdAt)
  return Number.isFinite(at) ? at : null
}

/** Enough slots for a 6-week month grid at several times a day. */
const MAX_SLOTS = 500

/**
 * Everything on the calendar between `start` and `end`, grouped by the
 * member's day and sorted by time. Automation slots come from the same
 * plan the Automations page shows; a slot already handed to Zernio shows
 * once, as its post.
 */
export function calendarItems(input: { posts: PostRecord[]; automations: Automation[]; start: number; end: number; now: number; timeZone: string }): Map<string, CalendarItem[]> {
  const { posts, automations, start, end, now, timeZone } = input
  const items: CalendarItem[] = []
  const postIds = new Set(posts.map((post) => post.id))
  const automationOfPost = new Map<string, string>()
  for (const automation of automations) {
    for (const content of automation.content) if (content.postId && !automationOfPost.has(content.postId)) automationOfPost.set(content.postId, automation.name)
  }

  for (const post of posts) {
    const at = postInstant(post)
    if (at === null || at < start || at > end) continue
    items.push({
      kind: 'post', key: `post:${post.id}`, at, post, status: post.status,
      platforms: [...new Set(post.targets.map((t) => t.platform))],
      title: post.clipTitle || 'Untitled clip',
      automationName: automationOfPost.get(post.id) ?? null
    })
  }

  if (end > now) {
    for (const automation of automations) {
      if (!automation.enabled || automation.times.length === 0) continue
      const slots = upcomingSlots(automation.times, automation.timezone, now, MAX_SLOTS, end - now)
      const plan = upcomingPlan(automation, slots)
      for (const slot of plan) {
        const at = Date.parse(slot.at)
        if (!Number.isFinite(at) || at < start || at > end) continue
        if (slot.state === 'zernio' || slot.state === 'cancelling') {
          const content = automation.content.find((item) => item.id === slot.contentId)
          // Its Zernio post is already on the calendar.
          if (content?.postId && postIds.has(content.postId)) continue
        }
        items.push({
          kind: 'slot', key: `slot:${automation.id}:${slot.date}/${slot.time}`, at,
          automationId: automation.id, automationName: automation.name, state: slot.state,
          platforms: [...new Set(automation.accounts.map((a) => a.platform))],
          title: slot.title
        })
      }
    }
  }

  items.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
  const byDay = new Map<string, CalendarItem[]>()
  for (const item of items) {
    const key = dayKey(item.at, timeZone)
    const list = byDay.get(key)
    if (list) list.push(item)
    else byDay.set(key, [item])
  }
  return byDay
}

/** "9:00 AM" in the member's time zone. */
export function formatCalendarTime(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at)
}
