/**
 * "Point at the preview": the member clicks (or drags a box) on a chat place's
 * preview, then asks "put an arrow here" or "zoom in on this". Each pin is a
 * point or a box in OUTPUT-frame fractions (0..1, the finished video's frame)
 * and, where the place has a playhead, the output time it was made at. Pins go
 * with the next chat message (up to 3, "pin 1"…"pin 3"); main checks them and
 * the tools that take a `pin` read them here.
 */
import { chatClock, chatFail as fail } from './chat-core'
import type { GraphicPlacement } from './motion-graphics'

export const MAX_CHAT_POINTS = 3
/** A drag smaller than this (share of the frame) is a point, not a box. */
export const MIN_POINT_BOX = 0.03
/** The longest output time a pin may carry (a clip is minutes long at most; this is a sanity bound). */
const MAX_POINT_MS = 6 * 60 * 60 * 1000

export interface ChatPoint {
  /** Its number in the chat ("pin 1"). */
  n: number
  /** The point, or the box's top-left corner (output-frame fractions). */
  x: number
  y: number
  /** A box's size (absent: a point). */
  w?: number
  h?: number
  /** Output time it was made at (ms into the finished video), or null when the place has no playhead. */
  out_ms: number | null
}

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const round = (v: number): number => Math.round(v * 1000) / 1000

/** Validates untrusted pins (from the page): up to 3, numbered 1–3 once each, inside the frame. Throws a plain message. */
export function parseChatPoints(value: unknown): ChatPoint[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_CHAT_POINTS) throw new Error(`Point at up to ${MAX_CHAT_POINTS} places at once.`)
  const seen = new Set<number>()
  return value.map((raw): ChatPoint => {
    const p = (raw ?? {}) as Record<string, unknown>
    if (!raw || typeof raw !== 'object' || typeof p.n !== 'number' || !Number.isInteger(p.n) || p.n < 1 || p.n > MAX_CHAT_POINTS || seen.has(p.n)) throw new Error('A pin on the preview is malformed. Point again.')
    seen.add(p.n)
    if (!unit(p.x) || !unit(p.y)) throw new Error('A pin is outside the video. Point again.')
    const box = p.w !== undefined || p.h !== undefined
    if (box && (!unit(p.w) || !unit(p.h) || (p.w as number) < MIN_POINT_BOX / 2 || (p.h as number) < MIN_POINT_BOX / 2 || p.x + (p.w as number) > 1.001 || p.y + (p.h as number) > 1.001)) throw new Error('A box on the preview is malformed. Draw it again.')
    const out = p.out_ms
    if (out !== null && out !== undefined && (typeof out !== 'number' || !Number.isFinite(out) || out < 0 || out > MAX_POINT_MS)) throw new Error('A pin has an invalid time. Point again.')
    return { n: p.n, x: round(p.x), y: round(p.y), ...(box ? { w: round(Math.min(p.w as number, 1 - p.x)), h: round(Math.min(p.h as number, 1 - p.y)) } : {}), out_ms: typeof out === 'number' ? Math.round(out) : null }
  }).sort((a, b) => a.n - b.n)
}

/** The point a pin means: itself, or its box's center. */
export function pointCenter(p: Pick<ChatPoint, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } {
  return { x: round(p.x + (p.w ?? 0) / 2), y: round(p.y + (p.h ?? 0) / 2) }
}

/** "top-left", "center", "bottom", "right" (thirds of the frame). */
export function pointArea(p: Pick<ChatPoint, 'x' | 'y' | 'w' | 'h'>): string {
  const { x, y } = pointCenter(p)
  const v = y < 1 / 3 ? 'top' : y > 2 / 3 ? 'bottom' : 'middle'
  const h = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center'
  if (v === 'middle') return h
  return h === 'center' ? v : `${v}-${h}`
}

/** The chip's words: "at 0:12, top-left" (or "box, top-left" with no time). */
export function pointLabel(p: ChatPoint): string {
  const where = `${p.w !== undefined ? 'box, ' : ''}${pointArea(p)}`
  return p.out_ms === null ? where : `at ${chatClock(p.out_ms)}, ${where}`
}

/** The graphic placement (band) nearest a pin's height. */
export function placementNear(y: number): GraphicPlacement {
  return y < 0.4 ? 'top' : y > 0.62 ? 'bottom' : 'middle'
}

/** An arrow or circle's fields as the chat may set them: shape arrow or circle, x and y numbers 0..1 (as text). Throws ChatToolError. */
export function checkHighlightFields(fields: Record<string, string>): Record<string, string> {
  if (fields.shape !== undefined && fields.shape !== 'arrow' && fields.shape !== 'circle') fail('fields.shape must be arrow or circle.')
  for (const axis of ['x', 'y'] as const) {
    if (fields[axis] === undefined) continue
    const n = Number(fields[axis])
    if (!fields[axis].trim() || !Number.isFinite(n) || n < 0 || n > 1) fail(`fields.${axis} must be a number from 0 to 1 (a share of the frame), as text.`)
    fields[axis] = String(round(n))
  }
  return fields
}

/**
 * A graphic aimed at a pin: an arrow or circle points at it (a box gets a
 * circle and a point an arrow, unless the shape was given); any other graphic
 * moves to the band (top, middle, bottom) nearest it.
 */
export function aimGraphic<G extends { template: string; placement: GraphicPlacement; fields: Record<string, string> }>(g: G, pin: ChatPoint, shapeGiven: boolean): G {
  const c = pointCenter(pin)
  if (g.template !== 'highlight') return { ...g, placement: placementNear(c.y) }
  const shape = shapeGiven && (g.fields.shape === 'arrow' || g.fields.shape === 'circle') ? g.fields.shape : pin.w !== undefined ? 'circle' : 'arrow'
  return { ...g, fields: { ...g.fields, shape, x: String(c.x), y: String(c.y) } }
}

/** The JSON schema of a tool's `pin` argument. */
export const PIN_PROP = { type: 'integer', minimum: 1, maximum: MAX_CHAT_POINTS, description: 'A pin the member put on the video (1, 2 or 3) when they say "here", "this" or "there".' }

/** The pin a tool call names (`pin`: 1–3), or null when it names none. Throws ChatToolError for the model. */
export function pinArg(args: Record<string, unknown>, points: readonly ChatPoint[]): ChatPoint | null {
  if (args.pin === undefined || args.pin === null) return null
  const n = args.pin
  if (typeof n !== 'number' || !Number.isInteger(n)) return fail('pin must be the pin number (1, 2 or 3).')
  const found = points.find((p) => p.n === n)
  if (!found) return fail(points.length ? `There is no pin ${n}. This message has pin${points.length > 1 ? 's' : ''} ${points.map((p) => p.n).join(', ')}.` : 'This message has no pins. Ask the member to point at the video with the Point button first.')
  return found
}

/** Lines for the model about this message's pins. `source`: the source time a pin's output time falls on (clip editor). */
export function pointsContext(points: readonly ChatPoint[], source?: (p: ChatPoint) => number | null): string {
  if (!points.length) return ''
  const lines = points.map((p) => {
    const c = pointCenter(p)
    const shape = p.w !== undefined ? `a box from x=${p.x}, y=${p.y} to x=${round(p.x + p.w)}, y=${round(p.y + (p.h ?? 0))} (center x=${c.x}, y=${c.y})` : `a point at x=${p.x}, y=${p.y}`
    const time = p.out_ms === null ? '' : `, at ${chatClock(p.out_ms)} of the finished video${source ? (() => { const s = source(p); return s === null ? '' : ` (source ${s} ms)` })() : ''}`
    return `- pin ${p.n}: ${shape} (${pointArea(p)} of the frame)${time}`
  })
  return `[The member pointed at the video. x and y are shares of the finished video's frame (0,0 top-left, 1,1 bottom-right).\n${lines.join('\n')}\n"Here", "this" or "there" means ${points.length === 1 ? 'pin 1' : 'the pin they name'}: pass pin to the tool.]`
}

/** The message as the model sees it: the member's words, then their pins. */
export function messageWithPoints(message: string, points: readonly ChatPoint[], source?: (p: ChatPoint) => number | null): string {
  const note = pointsContext(points, source)
  return note ? `${message}\n\n${note}` : message
}
