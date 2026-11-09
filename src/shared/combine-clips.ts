/**
 * Combine clips (in Edit my recording): many short clips filmed one after another (parts of one video, not retakes)
 * become one reel. The clips keep their place in the plan (`src`, numbered in filming order); the member's play
 * order is `EditDecisions.clipOrder` (a clip left out of it is removed from the reel). This file holds the limits,
 * the ordering helpers and the "What changed" lines for it.
 */

export type EditMode = 'takes' | 'combine'
export type ClipOrderMode = 'filmed' | 'ai'
export type ShotType = 'face' | 'screen'

export const COMBINE_MAX_CLIPS = 30
export const COMBINE_MIN_CLIP_SECONDS = 1
export const COMBINE_MAX_CLIP_SECONDS = 10 * 60
export const COMBINE_MAX_TOTAL_SECONDS = 45 * 60
/** A .zip of clips: at most this much unpacked, and this many entries listed in it. */
export const COMBINE_MAX_ZIP_BYTES = 12 * 1024 * 1024 * 1024
export const COMBINE_MAX_ZIP_ENTRIES = 2000
export const SHOT_LABELS: Record<ShotType, string> = { face: 'Talking', screen: 'Screen' }
/** A clip starting this long before its first word counts as dead air the reel trims. */
export const DEAD_AIR_MS = 300
/** The reel keeps this much air before a clip's first word and after its last (as the engine pads). */
const PAD_BEFORE_MS = 80
const PAD_AFTER_MS = 140

/** One file being added: copied out of a .zip, then checked. */
export interface ImportProgress { name: string; phase: 'waiting' | 'copying' | 'checking' | 'done' | 'failed'; percent: number; error?: string }

/** File names compared the way people number them ("IMG_2" before "IMG_10"). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * Filming order: by the time the camera wrote into each file (creation_time), when every clip has one; otherwise by
 * file name, naturally sorted. Returns the clips' indices in that order.
 */
export function filmingOrder(clips: readonly { name: string; createdAt?: string | null }[]): number[] {
  const times = clips.map((clip) => (clip.createdAt ? Date.parse(clip.createdAt) : NaN))
  const timed = times.every((t) => Number.isFinite(t))
  return clips.map((_, i) => i).sort((a, b) => (timed && times[a] !== times[b] ? times[a] - times[b] : 0) || naturalCompare(clips[a].name, clips[b].name) || a - b)
}

/** How the clips were put in order, for the step-1 list and the log. */
export function orderedBy(clips: readonly { createdAt?: string | null }[]): 'time' | 'name' {
  return clips.length > 0 && clips.every((clip) => clip.createdAt && Number.isFinite(Date.parse(clip.createdAt))) ? 'time' : 'name'
}

/** A play order, checked: distinct clip indices (at least one); null when it isn't one. */
export function parseClipOrder(value: unknown, count: number): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > count) return null
  if (!value.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < count)) return null
  return new Set(value).size === value.length ? [...value] as number[] : null
}

/** Move a clip `by` places (−1 earlier, +1 later), or to a position with `to`. Unchanged when it can't move. */
export function moveClip(order: readonly number[], clip: number, by: number, to?: number): number[] {
  const at = order.indexOf(clip)
  if (at < 0) return [...order]
  const target = Math.max(0, Math.min(order.length - 1, to ?? at + by))
  if (target === at) return [...order]
  const next = order.filter((c) => c !== clip)
  next.splice(target, 0, clip)
  return next
}

/** Remove a clip from the reel (the last one can't go). */
export function removeClip(order: readonly number[], clip: number): number[] {
  return order.length > 1 ? order.filter((c) => c !== clip) : [...order]
}

/** Put a removed clip back where it was filmed (before the first clip filmed after it that still plays). */
export function restoreClip(order: readonly number[], clip: number): number[] {
  if (order.includes(clip)) return [...order]
  const next = [...order]
  const after = next.findIndex((c) => c > clip)
  next.splice(after < 0 ? next.length : after, 0, clip)
  return next
}

export const sameOrder = (a: readonly number[] | null | undefined, b: readonly number[] | null | undefined): boolean =>
  Boolean(a && b && a.length === b.length && a.every((v, i) => v === b[i]))

interface Timed { text: string; startMs: number; endMs: number; src: number }

/** The first few words a clip says (for the Order strip). */
export function clipFirstWords(words: readonly Timed[], src: number, count = 6): string {
  const said = words.filter((w) => w.src === src).slice(0, count).map((w) => w.text)
  return said.join(' ')
}

/**
 * The silence the reel trims at the start and end of each playing clip: from the clip's start to its first word
 * (less the air the reel keeps), and from its last word to its end. Only clips with more than DEAD_AIR_MS count.
 */
export function deadAir(words: readonly Timed[], clips: readonly { seconds: number }[], order: readonly number[]): { starts: number; startMs: number; ends: number; endMs: number } {
  let starts = 0, startMs = 0, ends = 0, endMs = 0
  for (const src of order) {
    const said = words.filter((w) => w.src === src)
    if (!said.length) continue
    const lead = said[0].startMs - PAD_BEFORE_MS
    const tail = Math.round((clips[src]?.seconds ?? 0) * 1000) - said[said.length - 1].endMs - PAD_AFTER_MS
    if (lead > DEAD_AIR_MS) { starts++; startMs += lead }
    if (tail > DEAD_AIR_MS) { ends++; endMs += tail }
  }
  return { starts, startMs, ends, endMs }
}
