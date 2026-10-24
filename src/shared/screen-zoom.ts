/**
 * Screen zooms: smooth zoom-ins on a screen recording where it is busy, or onto a number or phrase the speaker says as
 * it shows on screen (with a glowing box around it). The engine plans them (screen_zoom.py) and bakes them into the
 * footage; the clip editor shows them as a Zooms row (each one on or off, gentler or stronger) and previews them
 * live. The math here mirrors screen_zoom.py crop_at / glow_at, so the preview matches the bake.
 *
 * Shares: boxes are [x, y, w, h] shares of the zoom area (where the screen sits in the frame); keys are
 * [t_ms, cx, cy, scale] (the crop's center in shares of the area, and how far in).
 */

export type ZoomKey = [number, number, number, number]
export interface ZoomMove {
  at_ms: number; end_ms: number; keys: ZoomKey[]
  /** The most this move may scale (the screen's own resolution). */
  max?: number
  /** Off: the move is kept but not made. Absent: on. */
  on?: boolean
  /** Gentler (0.5) or stronger (1.5) than planned. Absent: 1. */
  intensity?: number
  /** The move's sharper picture (in the run's .zoom folder). */
  clip?: string
  /** A glowing box around what is said (box: shares of the area), from at_ms. */
  glow?: { box: [number, number, number, number]; at_ms: number }
}
/** A project's zoom area: where the screen sits (shares of the frame), the webcam card kept as it is, the corners' radius (share of the area's height). */
export interface ZoomArea { area: [number, number, number, number]; keep?: [number, number, number, number]; radius?: number }

export const EASE_IN_MS = 600
export const EASE_OUT_MS = 500
export const PAN_MS = 800
export const GLOW_MS = 2400
export const MAX_ZOOM_SCALE = 2.2
export const ZOOM_INTENSITY = { min: 0.5, max: 1.5 } as const
export const MAX_ZOOMS = 200
const ZOOM_CLIP = /^[a-f0-9]{16}\.mp4$/

function fail(): never { throw new Error('Invalid zooms') }
function num(value: unknown, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) fail()
  return value
}
function shares4(value: unknown): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) fail()
  const [x, y, w, h] = value.map((n) => num(n, 0, 1))
  if (w < .01 || h < .01 || x + w > 1.000001 || y + h > 1.000001) fail()
  return [x, y, w, h]
}

/** A project's zoom area from the project file (throws when malformed). */
export function parseZoomArea(value: unknown): ZoomArea {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const v = value as Record<string, unknown>
  if (Object.keys(v).some((k) => !['area', 'keep', 'radius'].includes(k))) fail()
  return { area: shares4(v.area), ...(v.keep != null ? { keep: shares4(v.keep) } : {}), ...(v.radius != null ? { radius: num(v.radius, 0, .5) } : {}) }
}

/** A clip's zoom moves from the project or the renderer: sorted, apart, inside the clip (throws when malformed). */
export function parseZooms(value: unknown, duration: number): ZoomMove[] {
  if (!Array.isArray(value) || value.length > MAX_ZOOMS) fail()
  let previous = -1
  return value.map((raw): ZoomMove => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail()
    const m = raw as Record<string, unknown>
    if (Object.keys(m).some((k) => !['at_ms', 'end_ms', 'keys', 'max', 'on', 'intensity', 'clip', 'glow'].includes(k))) fail()
    const at_ms = num(m.at_ms, previous, duration), end_ms = num(m.end_ms, at_ms + 300, duration)
    if (end_ms - at_ms > 60000) fail()
    previous = end_ms
    if (!Array.isArray(m.keys) || !m.keys.length || m.keys.length > 24) fail()
    let last = at_ms - 1
    const keys = m.keys.map((k): ZoomKey => {
      if (!Array.isArray(k) || k.length !== 4) fail()
      const key: ZoomKey = [num(k[0], last + 1, end_ms), num(k[1], 0, 1), num(k[2], 0, 1), num(k[3], 1, MAX_ZOOM_SCALE)]
      last = key[0]
      return key
    })
    const move: ZoomMove = { at_ms, end_ms, keys }
    if (m.max !== undefined) move.max = num(m.max, 1, MAX_ZOOM_SCALE)
    if (m.on !== undefined) { if (typeof m.on !== 'boolean') fail(); if (!m.on) move.on = false }
    if (m.intensity !== undefined) move.intensity = num(m.intensity, ZOOM_INTENSITY.min, ZOOM_INTENSITY.max)
    if (m.clip !== undefined) { if (typeof m.clip !== 'string' || !ZOOM_CLIP.test(m.clip)) fail(); move.clip = m.clip }
    if (m.glow !== undefined) {
      const g = m.glow as Record<string, unknown>
      if (!g || typeof g !== 'object' || Object.keys(g).some((k) => k !== 'box' && k !== 'at_ms')) fail()
      move.glow = { box: shares4(g.box), at_ms: num(g.at_ms, at_ms, end_ms) }
    }
    return move
  })
}

const easeOutCubic = (p: number): number => 1 - (1 - p) ** 3
const easeInOutCubic = (p: number): number => p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2
const smoothstep = (p: number): number => p * p * (3 - 2 * p)
type Box = [number, number, number, number]
const FULL: Box = [0, 0, 1, 1]

/** A key's scale with the move's intensity, never past its max. */
export function effectiveScale(scale: number, intensity = 1, max = MAX_ZOOM_SCALE): number {
  const k = Math.max(ZOOM_INTENSITY.min, Math.min(ZOOM_INTENSITY.max, intensity))
  return Math.max(1, Math.min(max, 1 + (scale - 1) * k))
}
function keyBox(cx: number, cy: number, s: number): Box {
  const w = 1 / s
  return [Math.min(1 - w, Math.max(0, cx - w / 2)), Math.min(1 - w, Math.max(0, cy - w / 2)), w, w]
}
const lerp = (a: Box, b: Box, p: number): Box => a.map((x, i) => x + (b[i] - x) * p) as Box

/** The crop (x, y, w, h shares of the area) a move shows at `t` (source ms): the whole area outside it or when it is off. */
export function zoomCropAt(move: ZoomMove, t: number): Box {
  const { at_ms: at, end_ms: end } = move
  if (t <= at || t >= end || move.on === false) return FULL
  const max = move.max ?? MAX_ZOOM_SCALE, intensity = move.intensity ?? 1
  const boxes = move.keys.map((k) => keyBox(k[1], k[2], effectiveScale(k[3], intensity, max)))
  let target = boxes[0]
  for (let i = 1; i < move.keys.length; i++) {
    if (t <= move.keys[i][0]) break
    target = lerp(target, boxes[i], smoothstep(Math.min(1, (t - move.keys[i][0]) / PAN_MS)))
  }
  const length = end - at
  const easeIn = Math.min(EASE_IN_MS, length * .45), easeOut = Math.min(EASE_OUT_MS, length * .45)
  if (t < at + easeIn) return lerp(FULL, target, easeOutCubic((t - at) / easeIn))
  if (t > end - easeOut) return lerp(target, FULL, easeInOutCubic((t - (end - easeOut)) / easeOut))
  return target
}

/** The crop the clip's zooms show at `t` (the first move playing there). */
export function zoomsCropAt(zooms: readonly ZoomMove[] | undefined, t: number): Box {
  const move = zooms?.find((m) => t > m.at_ms && t < m.end_ms && m.on !== false)
  return move ? zoomCropAt(move, t) : FULL
}

/** How visible a move's glowing box is at `t` (0..1). */
export function glowAt(move: ZoomMove, t: number): number {
  if (!move.glow || move.on === false) return 0
  const start = move.glow.at_ms, end = Math.min(move.end_ms - EASE_OUT_MS, start + GLOW_MS)
  if (t < start || t > end) return 0
  return Math.max(0, Math.min(1, (t - start) / 250, (end - t) / 300))
}

/** The clip's zooms with one changed (by its start), kept in order. */
export function patchZoom(zooms: readonly ZoomMove[], at: number, patch: Partial<Pick<ZoomMove, 'on' | 'intensity'>>): ZoomMove[] {
  return zooms.map((m) => {
    if (m.at_ms !== at) return m
    const next: ZoomMove = { ...m, ...patch }
    if (next.on !== false) delete next.on
    if (next.intensity !== undefined) next.intensity = Math.round(Math.max(ZOOM_INTENSITY.min, Math.min(ZOOM_INTENSITY.max, next.intensity)) * 100) / 100
    if (next.intensity === 1) delete next.intensity
    return next
  })
}

/** All the clip's zooms on or off. */
export function setAllZooms(zooms: readonly ZoomMove[], on: boolean): ZoomMove[] {
  return zooms.map((m) => { const next: ZoomMove = { ...m }; if (on) delete next.on; else next.on = false; return next })
}

/** How many of the clip's zooms are on. */
export function zoomsOn(zooms: readonly ZoomMove[] | undefined): number {
  return (zooms ?? []).filter((m) => m.on !== false).length
}
