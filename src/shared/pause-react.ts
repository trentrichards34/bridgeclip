/**
 * Pause & react: the member is the main picture and the video they react to
 * plays in a box. Whenever they talk it pauses (a held frame), then carries on.
 *
 * The timeline says, for each stretch of the member's recording, whether the
 * original plays (from which second) or holds. Recorded in the app, it comes
 * from the recorder's log of pauses and plays. From a phone recording, the
 * engine works it out from the sound (detection); the member can then nudge
 * the start, ignore short pauses and flip any stretch. The engine checks the
 * timeline again before it makes the video.
 */

/** The longest Pause & react video (the recorder stops there; a longer upload is refused). */
export const PAUSE_REACT_MAX_SECONDS = 300
export const PAUSE_MAX_SEGMENTS = 600
/** The longest part of the original a member can react to. */
export const PAUSE_MAX_TRIM_SECONDS = 3600
const MAX_EVENTS = 4000
const MAX_FLIPS = 200
export const MAX_NUDGE_SECONDS = 10

export type PauseKind = 'play' | 'pause'
export type PauseLayout = 'box' | 'split'
export type PauseCaptions = 'member' | 'both'

export const PAUSE_LAYOUTS: { id: PauseLayout; label: string; detail: string }[] = [
  { id: 'box', label: 'Box at the top', detail: 'Their video in a box at the top, you fill the screen' },
  { id: 'split', label: 'Split 50/50', detail: 'Their video on the top half, you on the bottom half' }
]
export const PAUSE_CAPTION_CHOICES: { id: PauseCaptions; label: string; detail: string }[] = [
  { id: 'member', label: 'Your words', detail: 'Captions of what you say' },
  { id: 'both', label: 'Yours and theirs', detail: 'Also captions their words while their video plays' }
]
export const DEFAULT_PAUSE_REACT: { layout: PauseLayout; captions: PauseCaptions } = { layout: 'box', captions: 'member' }

export function isPauseLayout(value: unknown): value is PauseLayout { return value === 'box' || value === 'split' }
export function isPauseCaptions(value: unknown): value is PauseCaptions { return value === 'member' || value === 'both' }

/** One entry in the recorder's log: at t ms into the recording, the original (at o ms) started playing or paused. */
export interface PauseEvent { t: number; o: number; kind: PauseKind }

/** A stretch of the recording (seconds) and what the original does: plays from `at`, or holds the frame at `at`. */
export interface PauseSegment { start: number; end: number; kind: PauseKind; at: number }

export interface PauseTimeline {
  /** Where the video starts and ends in the recording (seconds). */
  start: number
  end: number
  /** The part of the original used (seconds into it). */
  trimStart: number
  trimEnd: number
  source: 'app' | 'upload'
  segments: PauseSegment[]
}

/** What the engine heard in a phone recording (before the member's adjustments). */
export interface PauseDetection {
  duration: number
  /** Where the original's start is heard in the recording (seconds); 0 when it couldn't be heard. */
  offset: number
  confidence: number
  alignedBy: 'sound' | 'start' | 'given'
  /** [start, end, kind] in recording seconds. */
  raw: [number, number, PauseKind][]
  firstVoice: number | null
  lastVoice: number | null
}

/** The member's adjustments to a detected timeline. */
export interface PauseSettings {
  /** Pauses shorter than this (seconds) play on instead. */
  minPause: number
  /** Plays shorter than this between two pauses stay paused instead. */
  minPlay: number
  /** Seconds added to where the original starts (sync). */
  nudge: number
  /** Stretches the member set by hand: [start, end, kind]. */
  flips: [number, number, PauseKind][]
}

export const MIN_PAUSE_CHOICES = [0.3, 0.5, 1, 2] as const
export const MIN_PLAY_CHOICES = [0.2, 0.4, 1, 2] as const
export const DEFAULT_PAUSE_SETTINGS: PauseSettings = { minPause: 0.5, minPlay: 0.4, nudge: 0, flips: [] }

const round = (value: number): number => Math.round(value * 1000) / 1000
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Neighbors that are one stretch (same kind and continuing the original) joined; empty ones dropped. */
export function mergeSegments(segments: PauseSegment[]): PauseSegment[] {
  const out: PauseSegment[] = []
  for (const seg of segments) {
    if (seg.end - seg.start <= 0.0005) continue
    const last = out[out.length - 1]
    if (last && last.kind === seg.kind && (seg.kind === 'pause' ? Math.abs(seg.at - last.at) < 0.017 : Math.abs(seg.at - (last.at + last.end - last.start)) < 0.017)) {
      last.end = seg.end
      continue
    }
    out.push({ ...seg })
  }
  return out
}

/** The timeline from the recorder's log. Before the first play the original holds its first frame. */
export function timelineFromEvents(events: PauseEvent[], durationSeconds: number, trimStart: number, trimEnd: number): PauseTimeline {
  const end = round(Math.min(durationSeconds, PAUSE_REACT_MAX_SECONDS))
  const segments: PauseSegment[] = []
  let current: PauseSegment = { start: 0, end, kind: 'pause', at: trimStart }
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    const t = round(Math.min(end, Math.max(0, event.t / 1000)))
    const at = round(Math.min(trimEnd, Math.max(trimStart, event.o / 1000)))
    if (event.kind === current.kind && event.kind === 'pause') continue
    if (event.kind === current.kind && Math.abs(at - (current.at + t - current.start)) < 0.05) continue
    if (t > current.start) segments.push({ ...current, end: t })
    current = { start: t, end, kind: event.kind, at }
  }
  if (end > current.start) segments.push({ ...current, end })
  return { start: 0, end, trimStart, trimEnd, source: 'app', segments: mergeSegments(tidyTaps(segments, trimEnd)) }
}

/** A tap-tap on Space: pauses shorter than this between two plays play through. */
export const MIN_APP_PAUSE = 0.4
/** And plays shorter than this between two pauses stay paused. */
export const MIN_APP_PLAY = 0.2

/**
 * Very short pauses and plays from the recorder, smoothed out: a short pause plays on (their video then runs that
 * much ahead of the log from there on), a short play holds (that much behind). Everything else keeps the log's times.
 */
function tidyTaps(segments: PauseSegment[], trimEnd: number): PauseSegment[] {
  const out: PauseSegment[] = []
  let shift = 0
  segments.forEach((seg, i) => {
    const prev = out[out.length - 1]
    const next = segments[i + 1]
    const length = seg.end - seg.start
    if (prev && next && seg.kind === 'pause' && prev.kind === 'play' && next.kind === 'play' && length < MIN_APP_PAUSE) {
      shift += length
      out.push({ ...seg, kind: 'play', at: round(Math.min(trimEnd, prev.at + (seg.start - prev.start))) })
    } else if (prev && next && seg.kind === 'play' && prev.kind === 'pause' && next.kind === 'pause' && length < MIN_APP_PLAY) {
      shift -= length
      out.push({ ...seg, kind: 'pause', at: prev.at })
    } else {
      out.push({ ...seg, at: round(Math.min(trimEnd, Math.max(0, seg.at + shift))) })
    }
  })
  return out
}

/** Runs of `kind` shorter than `min` seconds (not at the ends, and not before `keepBefore`) take their neighbors' kind. */
function dropShort(segments: PauseSegment[], kind: PauseKind, min: number, keepBefore: number): PauseSegment[] {
  return segments.map((seg, i) => (seg.kind === kind && seg.end - seg.start < min && i > 0 && i < segments.length - 1 && seg.start >= keepBefore
    ? { ...seg, kind: kind === 'pause' ? 'play' : 'pause' } : seg))
}

function setKind(segments: PauseSegment[], a: number, b: number, kind: PauseKind): PauseSegment[] {
  const out: PauseSegment[] = []
  for (const seg of segments) {
    if (seg.end <= a || seg.start >= b) { out.push(seg); continue }
    if (seg.start < a) out.push({ ...seg, end: a })
    out.push({ ...seg, start: Math.max(seg.start, a), end: Math.min(seg.end, b), kind })
    if (seg.end > b) out.push({ ...seg, start: b })
  }
  return out
}

/** Where the original is in each stretch: it starts at the trim's start and moves on only while playing. */
export function placeOriginal(segments: PauseSegment[], trimStart: number, trimEnd: number): PauseSegment[] {
  let pointer = trimStart
  return segments.map((seg) => {
    const at = round(Math.min(pointer, trimEnd))
    if (seg.kind === 'play') pointer += seg.end - seg.start
    return { ...seg, start: round(seg.start), end: round(seg.end), at }
  })
}

/** The timeline of a phone recording: what was detected, with the member's nudge, minimum lengths and flips. */
export function uploadTimeline(detection: PauseDetection, settings: PauseSettings, trimStart: number, trimEnd: number): PauseTimeline {
  const duration = detection.duration
  const offset = Math.min(Math.max(0, detection.offset + settings.nudge), Math.max(0, duration - 0.5))
  // Before the original starts it holds its first frame; after, what was detected (a nudge earlier plays the gap).
  let segments: PauseSegment[] = []
  if (offset > 0) segments.push({ start: 0, end: offset, kind: 'pause', at: trimStart })
  for (const [a, b, kind] of detection.raw) {
    // The detected lead-in (before the detected start) plays once the start is nudged earlier.
    const pieces: [number, number, PauseKind][] = [[a, Math.min(b, detection.offset), 'play'], [Math.max(a, detection.offset), b, kind]]
    for (const [from, to, what] of pieces) {
      const start = Math.max(from, offset), end = Math.min(to, duration)
      if (end > start) segments.push({ start, end, kind: what, at: trimStart })
    }
  }
  if (!segments.length) segments.push({ start: offset, end: duration, kind: 'play', at: trimStart })
  segments = mergeKinds(segments)
  segments = mergeKinds(dropShort(segments, 'pause', settings.minPause, offset))
  segments = mergeKinds(dropShort(segments, 'play', settings.minPlay, offset))
  for (const [a, b, kind] of settings.flips) segments = mergeKinds(setKind(segments, a, b, kind))
  segments = placeOriginal(segments, trimStart, trimEnd)
  // The video starts just before they first speak or the original starts, whichever is first.
  const firstSound = Math.min(offset, detection.firstVoice ?? offset)
  const start = round(Math.max(0, firstSound - 0.3))
  // After the original has ended, it stops shortly after they do.
  let end = duration
  const finished = segments.find((seg) => seg.kind === 'play' && seg.at + (seg.end - seg.start) >= trimEnd - 0.01)
  if (finished && detection.lastVoice !== null) {
    const endsAt = finished.start + (trimEnd - finished.at)
    end = Math.min(duration, Math.max(endsAt + 0.5, detection.lastVoice + 0.6))
  }
  end = round(Math.min(end, start + PAUSE_REACT_MAX_SECONDS))
  const clipped = segments.filter((seg) => seg.end > start && seg.start < end).map((seg) => {
    const from = Math.max(seg.start, start)
    return { ...seg, start: round(from), end: round(Math.min(seg.end, end)), at: round(seg.kind === 'play' ? Math.min(trimEnd, seg.at + (from - seg.start)) : seg.at) }
  })
  return { start, end, trimStart, trimEnd, source: 'upload', segments: mergeSegments(clipped) }
}

/** Neighbors of the same kind joined (before the original's times are placed). */
function mergeKinds(segments: PauseSegment[]): PauseSegment[] {
  const out: PauseSegment[] = []
  for (const seg of segments) {
    const last = out[out.length - 1]
    if (last && last.kind === seg.kind && Math.abs(last.end - seg.start) < 0.002) last.end = seg.end
    else if (seg.end - seg.start > 0.0005) out.push({ ...seg })
  }
  return out
}

/** Flip one stretch of a phone timeline (play ↔ pause); remembered as a time range so other changes keep it. */
export function flipSegment(settings: PauseSettings, timeline: PauseTimeline, index: number): PauseSettings {
  const seg = timeline.segments[index]
  if (!seg) return settings
  const flips = [...settings.flips.filter(([a, b]) => b <= seg.start || a >= seg.end), [seg.start, seg.end, seg.kind === 'play' ? 'pause' : 'play'] as [number, number, PauseKind]]
  return { ...settings, flips: flips.slice(-MAX_FLIPS) }
}

/** Counts for the summary line: pauses, seconds talking while paused, seconds of the original played. */
export function pauseSummary(timeline: PauseTimeline): { pauses: number; pausedSeconds: number; playedSeconds: number; seconds: number } {
  const firstPlay = timeline.segments.findIndex((seg) => seg.kind === 'play')
  let pauses = 0, pausedSeconds = 0, playedSeconds = 0
  timeline.segments.forEach((seg, i) => {
    const length = seg.end - seg.start
    if (seg.kind === 'play') playedSeconds += length
    else { pausedSeconds += length; if (firstPlay >= 0 && i > firstPlay) pauses++ }
  })
  return { pauses, pausedSeconds: round(pausedSeconds), playedSeconds: round(playedSeconds), seconds: round(timeline.end - timeline.start) }
}

/** The engine's form of a timeline. */
export function timelineForEngine(timeline: PauseTimeline): Record<string, unknown> {
  return {
    start: timeline.start, end: timeline.end, trim_start: timeline.trimStart, trim_end: timeline.trimEnd, source: timeline.source,
    segments: timeline.segments.map((seg) => ({ start: seg.start, end: seg.end, kind: seg.kind, at: seg.at }))
  }
}

/** The recorder's log from the renderer, checked (main calls this before keeping it). */
export function parsePauseEvents(value: unknown, maxMs: number): PauseEvent[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_EVENTS) throw new Error('The pause log is damaged. Record again.')
  let last = -1
  return value.map((item) => {
    const raw = (item ?? {}) as Record<string, unknown>
    if (!finite(raw.t) || !finite(raw.o) || raw.t < 0 || raw.t > maxMs || raw.o < 0 || raw.o > PAUSE_MAX_TRIM_SECONDS * 4000 ||
        (raw.kind !== 'play' && raw.kind !== 'pause') || raw.t < last || Object.keys(raw).length !== 3) {
      throw new Error('The pause log is damaged. Record again.')
    }
    last = raw.t
    return { t: Math.round(raw.t), o: Math.round(raw.o), kind: raw.kind }
  })
}

/** The member's adjustments from the renderer, checked. */
export function parsePauseSettings(value: unknown): PauseSettings {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose how the pauses are tidied.')
  if (!(MIN_PAUSE_CHOICES as readonly number[]).includes(raw.minPause as number) || !(MIN_PLAY_CHOICES as readonly number[]).includes(raw.minPlay as number)) {
    throw new Error('Choose how the pauses are tidied.')
  }
  if (!finite(raw.nudge) || Math.abs(raw.nudge) > MAX_NUDGE_SECONDS) throw new Error(`Nudge by up to ${MAX_NUDGE_SECONDS} seconds.`)
  if (!Array.isArray(raw.flips) || raw.flips.length > MAX_FLIPS) throw new Error('Too many changed stretches. Reset and try again.')
  const flips = raw.flips.map((flip): [number, number, PauseKind] => {
    if (!Array.isArray(flip) || flip.length !== 3 || !finite(flip[0]) || !finite(flip[1]) || flip[0] < 0 || flip[1] <= flip[0] ||
        flip[1] > PAUSE_REACT_MAX_SECONDS * 4 || (flip[2] !== 'play' && flip[2] !== 'pause')) {
      throw new Error('Too many changed stretches. Reset and try again.')
    }
    return [round(flip[0]), round(flip[1]), flip[2]]
  })
  return { minPause: raw.minPause as number, minPlay: raw.minPlay as number, nudge: Math.round(raw.nudge * 100) / 100, flips }
}

/** The engine's detection result, parsed defensively (it crosses a process boundary). */
export function parsePauseDetection(value: unknown): PauseDetection | null {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!value || typeof value !== 'object' || !finite(raw.duration) || raw.duration <= 0 || !finite(raw.offset) || !Array.isArray(raw.raw)) return null
  const items = raw.raw.slice(0, 20000).flatMap((item): [number, number, PauseKind][] => (Array.isArray(item) && finite(item[0]) && finite(item[1]) &&
    item[1] > item[0] && (item[2] === 'play' || item[2] === 'pause') ? [[item[0], item[1], item[2]]] : []))
  if (!items.length) return null
  return {
    duration: raw.duration, offset: Math.max(0, raw.offset), confidence: finite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0,
    alignedBy: raw.aligned_by === 'sound' ? 'sound' : raw.aligned_by === 'given' ? 'given' : 'start', raw: items,
    firstVoice: finite(raw.first_voice) ? raw.first_voice : null, lastVoice: finite(raw.last_voice) ? raw.last_voice : null
  }
}

/** Seconds as the app shows them ("1:05.2", "12.4s"). */
export function formatSeconds(value: number): string {
  if (value < 60) return `${value.toFixed(1)}s`
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(1).padStart(4, '0')}`
}

/** A pause-and-react take as the review shows it: the timeline and what can be adjusted. */
export interface PauseView {
  source: 'app' | 'upload'
  timeline: PauseTimeline
  settings: PauseSettings
  /** Phone recordings: where the original's start was heard, and how. */
  detection: { offset: number; confidence: number; alignedBy: PauseDetection['alignedBy'] } | null
  recordingPath: string
  seconds: number
}
