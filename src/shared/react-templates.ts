/**
 * Their clip, then me / React, then my thoughts: the two short-clip templates on camera.
 *
 * Their clip, then me: a short clip (a reel, a Short, a TikTok, or up to three minutes of any video) plays framed for
 * 9:16 with its captions, then the member gives their take full screen.
 *
 * React, then my thoughts: part 1, their clip plays in a big box with its sound while the member, filmed watching it,
 * is behind it; part 2, the member talks full screen and their own b-roll (or stock footage) cuts in over their
 * words. The engine (engine/clip_engine/services/react_thoughts.py) holds the b-roll to the same rules as here.
 */

/** A source up to this long is a short clip; longer, Moment + my take is suggested. */
export const SHORT_SOURCE_SECONDS = 180
/** The part of their video used. */
export const CLIP_MAX_SECONDS = 180
/** Each take (and your thoughts) is up to three minutes. */
export const CLIP_TAKE_MAX_SECONDS = 180
/** A phone video of you watching their clip may start a little before it does. */
export const REACTION_LEAD_SECONDS = 60

/** B-roll: up to 12 of your own clips or pictures per video. */
export const BROLL_MAX_ITEMS = 12
export const BROLL_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm']
export const BROLL_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
export const BROLL_MAX_BYTES = 1024 * 1024 * 1024
/** Each shot is 1.5-4 s, never over the first 2 s of your thoughts or the last 1.5 s. */
export const SHOT_MIN_SECONDS = 1.5
export const SHOT_MAX_SECONDS = 4
export const BROLL_HEAD_SECONDS = 2
export const BROLL_TAIL_SECONDS = 1.5
export const MAX_BROLL_SHOTS = 12
/** "Plan my b-roll": one small planning call (and your thoughts transcribed, if the hook text wasn't written from them). */
export const BROLL_PLAN_ESTIMATE_USD = 0.02
const ITEM_ID = /^b[0-9a-f]{8}$/

export interface BrollItem {
  id: string
  /** The file's name, as the member knows it. */
  name: string
  kind: 'video' | 'image'
  /** The run's own copy (previewable in the app). */
  path: string
}

/** One shot over the member's thoughts (seconds from the start of part 2). item: one of theirs, or null for stock. */
export interface BrollShot { start: number; end: number; item: string | null; query: string; words: string }

export interface BrollView {
  items: BrollItem[]
  /** "Fill gaps with stock footage". */
  stock: boolean
  /** A Pexels key is set (stock footage needs one). */
  pexels: boolean
  /** null until it's planned (with the hook text, or "Plan my b-roll"). */
  plan: BrollShot[] | null
  /** Your thoughts' length, once known. */
  takeSeconds: number | null
}

export function isBrollItemId(value: unknown): value is string {
  return typeof value === 'string' && ITEM_ID.test(value)
}

export function brollKind(name: string): BrollItem['kind'] | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return BROLL_VIDEO_EXTENSIONS.includes(extension) ? 'video' : BROLL_IMAGE_EXTENSIONS.includes(extension) ? 'image' : null
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** What's wrong with one shot (as the member left it), or null. */
export function brollShotProblem(shot: Pick<BrollShot, 'start' | 'end'>, takeSeconds: number | null): string | null {
  const length = shot.end - shot.start
  if (!finite(shot.start) || !finite(shot.end) || shot.start < BROLL_HEAD_SECONDS - 0.01) return `B-roll starts ${BROLL_HEAD_SECONDS} seconds into your thoughts at the earliest.`
  if (length < SHOT_MIN_SECONDS - 0.01 || length > SHOT_MAX_SECONDS + 0.01) return `Each shot is ${SHOT_MIN_SECONDS}–${SHOT_MAX_SECONDS} seconds.`
  if (takeSeconds !== null && shot.end > takeSeconds - BROLL_TAIL_SECONDS + 0.01) return `B-roll ends ${BROLL_TAIL_SECONDS} seconds before your thoughts do.`
  return null
}

/**
 * The b-roll plan from the renderer (the member swapped or removed shots), checked in main: known clips only, stock only
 * when it's on (and with a search), the timing rules kept and no overlaps. Throws a plain message.
 */
export function parseBrollPlan(value: unknown, itemIds: ReadonlySet<string>, stock: boolean, takeSeconds: number | null): BrollShot[] {
  if (!Array.isArray(value) || value.length > MAX_BROLL_SHOTS) throw new Error('The b-roll plan is damaged. Plan it again.')
  const shots = value.map((raw): BrollShot => {
    const item = (raw ?? {}) as Record<string, unknown>
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !finite(item.start) || !finite(item.end) ||
        (item.item !== null && !isBrollItemId(item.item)) || typeof item.query !== 'string' || typeof item.words !== 'string') {
      throw new Error('The b-roll plan is damaged. Plan it again.')
    }
    if (item.item !== null && !itemIds.has(item.item as string)) throw new Error('That clip is no longer in your b-roll. Plan it again.')
    const query = item.query.replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (item.item === null && !stock) throw new Error('Turn on stock footage to use it, or choose one of your clips.')
    if (item.item === null && !query) throw new Error('That stock shot has no search. Plan it again.')
    const shot = { start: Math.round(item.start * 100) / 100, end: Math.round(item.end * 100) / 100, item: item.item as string | null, query, words: item.words.replace(/\s+/g, ' ').trim().slice(0, 200) }
    const problem = brollShotProblem(shot, takeSeconds)
    if (problem) throw new Error(problem)
    return shot
  }).sort((a, b) => a.start - b.start)
  shots.forEach((shot, i) => { if (i && shot.start < shots[i - 1].end) throw new Error('Two b-roll shots overlap. Plan it again.') })
  return shots
}

/** The engine's plan, read leniently (a shot that can't be shown is dropped). */
export function readBrollPlan(value: unknown, itemIds: ReadonlySet<string>): BrollShot[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_BROLL_SHOTS).flatMap((raw): BrollShot[] => {
    const item = (raw ?? {}) as Record<string, unknown>
    if (!finite(item.start) || !finite(item.end) || item.end <= item.start) return []
    const id = item.item === null || item.item === undefined ? null : isBrollItemId(item.item) && itemIds.has(item.item) ? item.item : undefined
    if (id === undefined) return []
    return [{ start: item.start, end: item.end, item: id, query: typeof item.query === 'string' ? item.query.slice(0, 60) : '', words: typeof item.words === 'string' ? item.words.slice(0, 200) : '' }]
  })
}

/** "A 12:05 video": the note shown when Their clip, then me gets a long video (Moment + my take suits it better). */
export function longClipNote(seconds: number | null): string | null {
  if (seconds === null || seconds <= SHORT_SOURCE_SECONDS + 0.5) return null
  const total = Math.round(seconds), minutes = Math.floor(total / 60), rest = total % 60
  return `This video is ${minutes}:${String(rest).padStart(2, '0')} long. Their clip, then me is for short clips: you can trim it to up to 3 minutes, or use Moment + my take to have the AI find the best moments.`
}
