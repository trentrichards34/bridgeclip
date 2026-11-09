/**
 * Moment + my take: one long video (a podcast, an interview), up to three time
 * ranges the member noted while listening, and for each range the engine picks
 * the strongest moment inside it. The member records their take on each, and
 * every moment becomes its own video: the moment first, then them.
 *
 * Times are typed as 37:00 or 1:02:03, or read from a screenshot of the
 * player (one cheap vision call per screenshot; the member checks the result).
 */

export const MOMENT_MAX_RANGES = 3
/** A range: long enough to hold a moment, short enough to keep transcribing it cheap (the engine holds the same). */
export const RANGE_MIN_SECONDS = 10
export const RANGE_MAX_SECONDS = 20 * 60
/** A screenshot's timecode becomes a range this far either side of it. */
export const RANGE_PAD_SECONDS = 150
export const MAX_SOURCE_SECONDS = 4 * 3600
/** The member's take on each moment (the recorder stops there; a longer upload is refused). */
export const MOMENT_TAKE_MAX_SECONDS = 180
/** A moment the member nudged: 2-40 seconds (the AI picks 5-25). */
export const NUDGED_MIN_MS = 2000
export const NUDGED_MAX_MS = 40000
/** Screenshots sent to read their timecode. */
export const TIMECODE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const MAX_TIMECODE_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TALKING_POINTS = 3

export interface MomentRange { startS: number; endS: number }

/** What each moment's draft carries besides the usual fields. */
export interface MomentInfo {
  rangeStartMs: number
  rangeEndMs: number
  /** What the member said in their take (once the hook text was written from it). */
  said: string
  /** How many moments the AI has offered in this range. */
  picks: number
  /** "Give me talking points": up to three short bullets (not a script). */
  points: string[]
}

/** A range as the member types it, with what a screenshot read for it. */
export interface RangeInput { start: string; end: string; read?: TimecodeRead | null }

export interface TimecodeRead {
  /** Where the player was, in seconds. */
  seconds: number
  /** The video's length if the player showed it. */
  lengthSeconds: number | null
  /** The app it looks like (YouTube, Spotify…), '' when unclear. */
  app: string
  /** What the model read, for the member to check. */
  text: string
  /** What OpenRouter charged for the read. */
  costUsd: number
}

/**
 * Seconds from 37:00, 1:02:03, 37:12.5, 125:30 (minutes over an hour), 45 (seconds), or 1h2m3s / 37m / 90s; null when it isn't a time.
 */
export function parseTimecode(value: string): number | null {
  const text = value.trim().replace(/[∶：︰]/g, ':').replace(/\s+/g, ' ')
  if (!text || text.length > 20) return null
  let match = /^(\d{1,2}):(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(text)
  if (match) {
    const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (m > 59 || s > 59) return null
    return h * 3600 + m * 60 + s + fraction(match[4])
  }
  match = /^(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(text)
  if (match) {
    const [m, s] = [Number(match[1]), Number(match[2])]
    if (s > 59) return null
    return m * 60 + s + fraction(match[3])
  }
  match = /^(\d{1,5})(?:[.,](\d{1,3}))?$/.exec(text)
  if (match) return Number(match[1]) + fraction(match[2])
  match = /^(?:(\d{1,2}) ?h)? ?(?:(\d{1,3}) ?m(?:in)?)? ?(?:(\d{1,5}) ?s(?:ec)?)?$/i.exec(text)
  if (match && (match[1] || match[2] || match[3])) return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  return null
}

function fraction(digits: string | undefined): number {
  return digits ? Number(`0.${digits}`) : 0
}

/** 37:05 or 1:02:03 (whole seconds). */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/** A range two and a half minutes either side of a time (kept inside the video when its length is known). */
export function rangeAround(seconds: number, lengthSeconds: number | null = null): MomentRange {
  const limit = lengthSeconds && lengthSeconds > 0 ? lengthSeconds : MAX_SOURCE_SECONDS
  const startS = Math.max(0, Math.min(seconds - RANGE_PAD_SECONDS, limit - RANGE_MIN_SECONDS))
  return { startS: Math.round(startS), endS: Math.round(Math.min(limit, Math.max(seconds + RANGE_PAD_SECONDS, startS + RANGE_MIN_SECONDS))) }
}

/** What's wrong with one range, or null. `lengthSeconds` is the video's length when known. */
export function rangeProblem(range: MomentRange, lengthSeconds: number | null = null): string | null {
  const { startS, endS } = range
  if (!Number.isFinite(startS) || !Number.isFinite(endS) || startS < 0) return 'Use times like 37:00 or 1:02:30.'
  if (endS <= startS) return 'The end must come after the start.'
  if (endS - startS < RANGE_MIN_SECONDS) return `Make it at least ${RANGE_MIN_SECONDS} seconds long.`
  if (endS - startS > RANGE_MAX_SECONDS) return `Keep it to ${RANGE_MAX_SECONDS / 60} minutes or less.`
  if (endS > MAX_SOURCE_SECONDS) return 'Use a time within the first 4 hours.'
  if (lengthSeconds && lengthSeconds > 0) {
    if (startS >= lengthSeconds - 1) return `It starts after the video ends (${formatTimecode(lengthSeconds)}).`
    if (endS > lengthSeconds + 0.5) return `It ends after the video ends (${formatTimecode(lengthSeconds)}).`
  }
  return null
}

/** The form's typed ranges as numbers, with the first problem (named by range) or null. Empty rows are skipped. */
export function readRanges(inputs: RangeInput[], lengthSeconds: number | null = null): { ranges: MomentRange[]; problem: string | null } {
  const ranges: MomentRange[] = []
  const filled = inputs.map((input, i) => ({ input, n: i + 1 })).filter(({ input }) => input.start.trim() || input.end.trim())
  for (const { input, n } of filled) {
    const startS = parseTimecode(input.start), endS = parseTimecode(input.end)
    if (startS === null || endS === null) return { ranges, problem: `Range ${n}: use times like 37:00 or 1:02:30.` }
    const problem = rangeProblem({ startS, endS }, lengthSeconds)
    if (problem) return { ranges, problem: `Range ${n}: ${problem}` }
    if (ranges.some((other) => other.startS === startS && other.endS === endS)) return { ranges, problem: `Range ${n} is the same as another range.` }
    ranges.push({ startS, endS })
  }
  if (filled.length > MOMENT_MAX_RANGES) return { ranges, problem: `Add up to ${MOMENT_MAX_RANGES} ranges.` }
  if (!ranges.length) return { ranges, problem: 'Add a time range, like 37:00 to 42:00.' }
  return { ranges, problem: null }
}

/** Ranges from another process (the request), checked; throws with a plain message. */
export function parseMomentRanges(value: unknown, lengthSeconds: number | null = null): MomentRange[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Add a time range, like 37:00 to 42:00.')
  if (value.length > MOMENT_MAX_RANGES) throw new Error(`Add up to ${MOMENT_MAX_RANGES} ranges.`)
  const ranges: MomentRange[] = []
  value.forEach((item, i) => {
    const raw = (item ?? {}) as Record<string, unknown>
    if (typeof item !== 'object' || Array.isArray(item) || typeof raw.startS !== 'number' || typeof raw.endS !== 'number') throw new Error(`Range ${i + 1}: use times like 37:00 or 1:02:30.`)
    const range = { startS: Math.round(raw.startS * 100) / 100, endS: Math.round(raw.endS * 100) / 100 }
    const problem = rangeProblem(range, lengthSeconds)
    if (problem) throw new Error(`Range ${i + 1}: ${problem}`)
    if (ranges.some((other) => other.startS === range.startS && other.endS === range.endS)) throw new Error(`Range ${i + 1} is the same as another range.`)
    ranges.push(range)
  })
  return ranges
}

/** The vision model's answer about a screenshot, checked; null when no time was read. */
export function parseTimecodeRead(value: unknown, costUsd = 0): TimecodeRead | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.found !== true || typeof raw.position !== 'string') return null
  const seconds = parseTimecode(raw.position)
  if (seconds === null || seconds > MAX_SOURCE_SECONDS) return null
  const length = typeof raw.length === 'string' && raw.length.trim() ? parseTimecode(raw.length) : null
  const lengthSeconds = length !== null && length > 0 && length >= seconds && length <= MAX_SOURCE_SECONDS ? length : null
  const app = typeof raw.app === 'string' ? raw.app.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  return { seconds, lengthSeconds, app, text: formatTimecode(seconds), costUsd: Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0 }
}

/** The talking points from the model: up to three short lines (never a script). */
export function parseTalkingPoints(value: unknown): string[] {
  const raw = (value ?? {}) as Record<string, unknown>
  const list = Array.isArray(raw.points) ? raw.points : []
  return list.filter((item): item is string => typeof item === 'string').map((item) => item.replace(/\s+/g, ' ').replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean).map((item) => item.split(' ').slice(0, 18).join(' ')).slice(0, MAX_TALKING_POINTS)
}

/** A moment's details from the engine, checked. */
export function parseMomentInfo(value: unknown): MomentInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const ms = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null
  const start = ms(raw.range_start_ms ?? raw.rangeStartMs), end = ms(raw.range_end_ms ?? raw.rangeEndMs)
  if (start === null || end === null || end <= start) return null
  return {
    rangeStartMs: start, rangeEndMs: end, said: typeof raw.said === 'string' ? raw.said.replace(/\s+/g, ' ').trim().slice(0, 600) : '',
    picks: typeof raw.picks === 'number' && Number.isInteger(raw.picks) && raw.picks >= 0 ? Math.min(raw.picks, 99) : 1,
    points: parseTalkingPoints({ points: raw.points })
  }
}

/** A moment's new start and end (whole milliseconds, inside its range, 2-40 seconds), or a plain problem. */
export function momentBoundsProblem(startMs: unknown, endMs: unknown, info: Pick<MomentInfo, 'rangeStartMs' | 'rangeEndMs'>): string | null {
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isInteger(startMs) || !Number.isInteger(endMs)) return 'Choose where the moment starts and ends.'
  if (startMs < info.rangeStartMs || endMs > info.rangeEndMs) return `Keep the moment inside your range (${formatTimecode(info.rangeStartMs / 1000)}–${formatTimecode(info.rangeEndMs / 1000)}).`
  if (endMs - startMs < NUDGED_MIN_MS) return `Keep the moment at least ${NUDGED_MIN_MS / 1000} seconds long.`
  if (endMs - startMs > NUDGED_MAX_MS) return `Keep the moment to ${NUDGED_MAX_MS / 1000} seconds or less.`
  return null
}
