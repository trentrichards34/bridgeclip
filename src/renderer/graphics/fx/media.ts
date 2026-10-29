/**
 * Effects over the member's own pictures (mount.ts): where a part of a picture lands in its slot, and the hand-drawn
 * mark (a circle, an underline, an arrow or a box) that points at it. The strokes wobble a little, the way a marker
 * does, from a fixed seed (the same pixels every frame), and draw on in one decelerating stroke.
 */
import type { FxMarkShape } from '../../../shared/fx-catalog'

export interface Picture { url: string; width: number; height: number }
type Box = readonly [number, number, number, number]

/** Where the picture is drawn in a slot of `slot` size (covering it, top-aligned or centered), in slot pixels. */
export function coverRect(picture: Pick<Picture, 'width' | 'height'>, slot: { w: number; h: number }, align: 'top' | 'center'): { x: number; y: number; w: number; h: number } {
  const k = Math.max(slot.w / picture.width, slot.h / picture.height)
  const w = picture.width * k, h = picture.height * k
  return { x: (slot.w - w) / 2, y: align === 'top' ? 0 : (slot.h - h) / 2, w, h }
}

/** A small seeded wobble (a marker's hand), deterministic. */
function wobble(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296 - 0.5 }
}
const f = (n: number): string => n.toFixed(1)
/** A smooth path through points (Catmull-Rom as cubic Béziers). */
function smooth(points: [number, number][]): string {
  let d = `M${f(points[0][0])} ${f(points[0][1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)]
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d
}

/**
 * The mark's strokes (path data, in slot pixels) for a part of the picture (`box`: x, y, w, h as shares of it), drawn
 * in a slot of `slot` size; null when that part is off the visible picture. `width` is the stroke width.
 */
export function markPath(shape: FxMarkShape, box: Box, picture: Pick<Picture, 'width' | 'height'>, slot: { w: number; h: number }, align: 'top' | 'center'): { strokes: string[]; width: number } | null {
  if (slot.w < 4 || slot.h < 4) return null
  const r = coverRect(picture, slot, align)
  // The part as drawn, kept inside the slot.
  const x0 = Math.max(0, r.x + box[0] * r.w), y0 = Math.max(0, r.y + box[1] * r.h)
  const x1 = Math.min(slot.w, r.x + (box[0] + box[2]) * r.w), y1 = Math.min(slot.h, r.y + (box[1] + box[3]) * r.h)
  if (x1 - x0 < 4 || y1 - y0 < 4) return null
  const unit = Math.min(slot.w, slot.h)
  const width = Math.max(4, unit * 0.018)
  const jitter = wobble(Math.round(x0 * 7 + y0 * 13 + x1 * 3 + y1 * 5))
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, pad = unit * 0.025
  if (shape === 'circle') {
    // A loose ellipse around it, a little more than once round (the pen overshoots its start).
    const rx = (x1 - x0) / 2 + pad * 1.4, ry = (y1 - y0) / 2 + pad * 1.4
    const points: [number, number][] = []
    for (let i = 0; i <= 26; i++) {
      const a = -Math.PI * 0.62 + (i / 24) * Math.PI * 2
      const k = 1 + jitter() * 0.07 + (i / 26) * 0.05
      points.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k])
    }
    return { strokes: [smooth(points)], width }
  }
  if (shape === 'underline') {
    // A slightly wavy stroke just under it, a touch longer than it.
    const y = Math.min(slot.h - width, y1 + pad * 0.7), from = x0 - pad, to = x1 + pad
    const points: [number, number][] = []
    for (let i = 0; i <= 8; i++) points.push([from + (to - from) * (i / 8), y + jitter() * pad * 0.5 + (i / 8) * pad * 0.3])
    return { strokes: [smooth(points)], width: width * 1.15 }
  }
  if (shape === 'box') {
    // Four sides, each its own slightly crooked stroke, joined.
    const p = pad * 0.9
    const corners: [number, number][] = [[x0 - p, y0 - p], [x1 + p, y0 - p], [x1 + p, y1 + p], [x0 - p, y1 + p], [x0 - p, y0 - p * 1.6]]
    const pts = corners.map(([x, y]) => [x + jitter() * pad * 0.6, y + jitter() * pad * 0.6] as [number, number])
    return { strokes: [`M${pts.map((q) => `${f(q[0])} ${f(q[1])}`).join(' L')}`], width }
  }
  // Arrow: from the roomier side, curving in to just short of it, then its head.
  const fromRight = cx < slot.w / 2, fromBelow = cy < slot.h / 2
  const len = Math.max(unit * 0.18, Math.min(unit * 0.32, Math.hypot(x1 - x0, y1 - y0)))
  const tip: [number, number] = [fromRight ? x1 + pad * 0.6 : x0 - pad * 0.6, fromBelow ? y1 + pad * 0.6 : y0 - pad * 0.6]
  const tail: [number, number] = [tip[0] + (fromRight ? 1 : -1) * len * 0.8, tip[1] + (fromBelow ? 1 : -1) * len * 0.75]
  const bend: [number, number] = [(tip[0] + tail[0]) / 2 + (fromRight ? 1 : -1) * len * 0.12, (tip[1] + tail[1]) / 2 - (fromBelow ? 1 : -1) * len * 0.12]
  const ang = Math.atan2(tip[1] - bend[1], tip[0] - bend[0]), head = Math.max(width * 3, len * 0.18)
  const wing = (s: number): string => `${f(tip[0] - head * Math.cos(ang + s * 0.5))} ${f(tip[1] - head * Math.sin(ang + s * 0.5))}`
  return { strokes: [`M${f(tail[0])} ${f(tail[1])} Q${f(bend[0])} ${f(bend[1])} ${f(tip[0])} ${f(tip[1])}`, `M${wing(1)} L${f(tip[0])} ${f(tip[1])} L${wing(-1)}`], width: width * 1.1 }
}

/** The mark at `t` seconds into the unit: each stroke draws on in turn (about half a second), decelerating. */
export function drawMark(mark: { paths: SVGPathElement[]; lengths: number[]; at: number }, t: number): void {
  const spans = mark.paths.length > 1 ? [0.42, 0.18] : [0.5]
  let start = mark.at
  mark.paths.forEach((path, i) => {
    const span = spans[i] ?? 0.2
    const p = Math.max(0, Math.min(1, (t - start) / span))
    const eased = 1 - (1 - p) ** 3
    path.style.strokeDasharray = String(mark.lengths[i])
    path.style.strokeDashoffset = String(mark.lengths[i] * (1 - eased))
    path.style.opacity = p > 0 ? '1' : '0'
    start += span
  })
}

/**
 * A screenshot's slow push-in (the browser window): toward the member's boxed part, or, without one, toward where a
 * page's headline sits (upper left), so its words read on a phone. `PUSH_ZOOM` more at the end, easing in and out
 * from `PUSH_START_S` to most of the way through.
 */
export const PUSH_ZOOM = 0.55
export const PUSH_START_S = 0.7
/** Where a page's headline usually is (shares of the picture) when the member didn't box a part. */
export const PUSH_DEFAULT_FOCUS: Box = [0.03, 0.15, 0.5, 0.3]

/**
 * The push-in's origin in slot pixels: the fixed point of the zoom chosen so the focus part (the member's box, else
 * where a headline usually is) stays whole in the slot at the end of the push, as near its middle as that allows.
 */
export function pushOrigin(picture: Pick<Picture, 'width' | 'height'>, slot: { w: number; h: number }, align: 'top' | 'center', box: Box | null): { x: number; y: number } {
  const r = coverRect(picture, slot, align)
  const [bx, by, bw, bh] = box ?? PUSH_DEFAULT_FOCUS
  const k = 1 + PUSH_ZOOM
  const axis = (lo: number, hi: number, size: number): number => {
    const a = Math.max(0, Math.min(size, lo)), b = Math.max(0, Math.min(size, hi))
    // A point p stays put; q goes to p + k(q - p): [a, b] stays inside [0, size] for p in [(kb - size)/(k-1), ka/(k-1)].
    const from = Math.max(0, (k * b - size) / (k - 1)), to = Math.min(size, k * a / (k - 1))
    return from <= to ? (from + to) / 2 : (a + b) / 2
  }
  return { x: axis(r.x + bx * r.w, r.x + (bx + bw) * r.w, slot.w), y: axis(r.y + by * r.h, r.y + (by + bh) * r.h, slot.h) }
}

/** The push-in's scale at `t` seconds into a unit `unitS` long: 1 until PUSH_START_S, then easing up to 1 + PUSH_ZOOM. */
export function pushScale(t: number, unitS: number): number {
  const span = Math.max(0.8, unitS * 0.8 - PUSH_START_S)
  const p = Math.max(0, Math.min(1, (t - PUSH_START_S) / span))
  return 1 + PUSH_ZOOM * (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
}
