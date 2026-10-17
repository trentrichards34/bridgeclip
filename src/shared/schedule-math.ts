// Wall-clock times in an IANA time zone, turned into instants. Used by
// automations (scheduling upcoming daily slots with Zernio ahead of time)
// and the post dialog (spreading several clips out). Pure, so the DST rules
// can be tested directly.

interface WallTime { year: number; month: number; day: number; hour: number; minute: number }

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(timeZone, value)
  }
  return value
}

/** The wall time at `at` in `timeZone`. */
export function wallTime(at: number, timeZone: string): WallTime {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((part) => [part.type, part.value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) }
}

function asUtc(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
}

/** Minutes the zone is ahead of UTC at `at` (whole minutes; seconds are ignored). */
function offsetAt(at: number, timeZone: string): number {
  const rounded = Math.floor(at / 60_000) * 60_000
  return asUtc(wallTime(rounded, timeZone)) - rounded
}

/**
 * The instant a wall time happens in `timeZone`. When clocks fall back and it
 * happens twice, the first one. When clocks spring forward over it, `gap`
 * decides: 'skip' returns null (the time doesn't exist that day), 'later'
 * moves it forward by the gap (02:30 becomes 03:30), as calendars do.
 */
export function zonedInstant(wall: WallTime, timeZone: string, gap: 'skip' | 'later' = 'skip'): number | null {
  const guess = asUtc(wall)
  const candidates = new Set<number>()
  // Offsets either side of the guess cover any transition near it.
  for (const probe of [guess - 86_400_000, guess, guess + 86_400_000]) candidates.add(guess - offsetAt(probe, timeZone))
  const matches = [...candidates].filter((at) => asUtc(wallTime(at, timeZone)) === guess).sort((a, b) => a - b)
  if (matches.length) return matches[0]
  if (gap === 'skip') return null
  // In a gap: use the offset from before the change, which lands after it.
  return guess - offsetAt(guess - 86_400_000, timeZone)
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseWall(date: string, time: string): WallTime | null {
  const d = DATE.exec(date)
  const t = TIME.exec(time)
  if (!d || !t) return null
  const wall = { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(t[1]), minute: Number(t[2]) }
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day))
  return check.getUTCMonth() === wall.month - 1 && check.getUTCDate() === wall.day ? wall : null
}

function pad(value: number): string { return String(value).padStart(2, '0') }
function dateText(wall: WallTime): string { return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}` }

/** Moves a wall time by whole minutes, on the calendar (no time zone). */
function addWallMinutes(wall: WallTime, minutes: number): WallTime {
  const moved = new Date(asUtc(wall) + minutes * 60_000)
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate(), hour: moved.getUTCHours(), minute: moved.getUTCMinutes() }
}

export interface UpcomingSlot {
  /** HH:mm, as in Automation.times. */
  time: string
  /** Local YYYY-MM-DD in the automation's time zone, as in Automation.lastSlots. */
  date: string
  /** The instant, as an ISO string. */
  at: string
}

/**
 * The next daily slots after `now`, soonest first, at most `count` and none
 * past `horizonMs`. A time that doesn't exist on a day (clocks spring forward)
 * is skipped that day, and one that happens twice uses the first, matching
 * how dueSlots() runs them while the app is open.
 */
export function upcomingSlots(times: readonly string[], timeZone: string, now: number, count: number, horizonMs: number): UpcomingSlot[] {
  const slots: UpcomingSlot[] = []
  if (!times.length || count <= 0) return slots
  const sorted = [...new Set(times)].filter((time) => TIME.test(time)).sort()
  const today = wallTime(now, timeZone)
  for (let offset = 0; offset <= Math.ceil(horizonMs / 86_400_000) + 1 && slots.length < count; offset++) {
    const day = addWallMinutes({ ...today, hour: 0, minute: 0 }, offset * 1440)
    for (const time of sorted) {
      const wall = parseWall(dateText(day), time)
      const at = wall ? zonedInstant(wall, timeZone, 'skip') : null
      if (at === null || at <= now || at > now + horizonMs) continue
      slots.push({ time, date: dateText(day), at: new Date(at).toISOString() })
      if (slots.length >= count) break
    }
  }
  return slots
}

export const SPREAD_INTERVALS = [
  { id: '4h', label: '4 hours', minutes: 240 },
  { id: '6h', label: '6 hours', minutes: 360 },
  { id: '12h', label: '12 hours', minutes: 720 },
  { id: '1d', label: 'day', minutes: 1440 },
  { id: '2d', label: '2 days', minutes: 2880 }
] as const
export type SpreadInterval = (typeof SPREAD_INTERVALS)[number]['id']

/**
 * Publish times for `count` clips: the first at `start` (a datetime-local
 * value, `YYYY-MM-DDTHH:mm`, read in `timeZone`), then one every interval on
 * the wall clock, so "every day at 9:00" stays at 9:00 across a DST change.
 * A time that falls in a spring-forward gap moves forward by the gap.
 */
export function spreadSchedule(start: string, count: number, interval: SpreadInterval, timeZone: string): number[] {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(start)
  const wall = match ? parseWall(match[1], match[2]) : null
  const step = SPREAD_INTERVALS.find((item) => item.id === interval)?.minutes
  if (!wall || !step || count <= 0) return []
  const times: number[] = []
  for (let index = 0; index < count; index++) {
    const at = zonedInstant(addWallMinutes(wall, index * step), timeZone, 'later')
    if (at === null) return []
    times.push(at)
  }
  return times
}
