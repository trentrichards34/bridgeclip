/**
 * The last check on every drawn graphic: what it paints must sit inside the frame's safe area (clear of the edges,
 * where a phone's buttons sit and nothing may be cut off) and inside its own band (never over the hook or the
 * captions). Pure geometry, shared by the render page (src/renderer/graphics/safe-area.ts measures the paint) and
 * the tests.
 *
 * When the paint spills, the graphic is moved back in and, only if it must, drawn smaller, never below
 * SAFE_MIN_SCALE; past that (or with words cut off inside it) it is swapped for a simpler graphic with the same
 * words (safeFallback).
 */
import type { GraphicRenderSpec } from './motion-graphics'

export type SafeRect = { x: number; y: number; w: number; h: number }

/** The frame's safe area (shares of the frame): the sides, the top (status bar) and the bottom (the app's buttons). */
export const SAFE_AREA = { side: .035, top: .025, bottom: .03 } as const
/** How far past its band a graphic may paint (share of the height: a glass margin, a soft shadow). */
export const BAND_SLACK = .02
/** The least a spilling graphic is drawn at; below it the words would be too small, so a simpler graphic is used. */
export const SAFE_MIN_SCALE = .72
/** Templates that are not checked: drawn behind the speaker or over the whole frame by design, or placed by main (a screen's video). */
export const SAFE_EXEMPT: readonly string[] = ['takeover', 'big_words', 'screen_frame', 'highlight']

/** Where a graphic may paint (frame pixels): the safe area, cut to its band (with BAND_SLACK). */
export function safeBounds(spec: Pick<GraphicRenderSpec, 'width' | 'height' | 'box'>): SafeRect {
  const { width: W, height: H } = spec
  const left = Math.max(SAFE_AREA.side, spec.box.left ?? 0) * W
  const right = Math.min(1 - SAFE_AREA.side, spec.box.right ?? 1) * W
  const top = Math.max(SAFE_AREA.top, spec.box.top - BAND_SLACK) * H
  const bottom = Math.min(1 - SAFE_AREA.bottom, spec.box.bottom + BAND_SLACK) * H
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }
}

/** True when `ink` lies inside `bounds` (half a pixel to spare). */
export function insideBounds(ink: SafeRect, bounds: SafeRect): boolean {
  return ink.x >= bounds.x - .5 && ink.y >= bounds.y - .5 && ink.x + ink.w <= bounds.x + bounds.w + .5 && ink.y + ink.h <= bounds.y + bounds.h + .5
}

export interface SafeFix {
  /** Scale around the paint's center (1: as drawn). */
  scale: number
  /** Then moved by (frame pixels). */
  dx: number
  dy: number
  /** Still spills (or would need to be drawn below SAFE_MIN_SCALE): use a simpler graphic. */
  overflow: boolean
}

/**
 * How to bring a graphic's paint (`ink`, frame pixels, the union over its settled frames) inside `bounds`: moved
 * first; drawn smaller only when it is bigger than the bounds (never below SAFE_MIN_SCALE). Identity when it fits.
 */
export function safeFix(ink: SafeRect | null, bounds: SafeRect): SafeFix {
  if (!ink || ink.w < 1 || ink.h < 1 || insideBounds(ink, bounds)) return { scale: 1, dx: 0, dy: 0, overflow: false }
  const need = Math.min(1, bounds.w / ink.w, bounds.h / ink.h)
  const scale = Math.max(SAFE_MIN_SCALE, need)
  const w = ink.w * scale, h = ink.h * scale
  const cx = ink.x + ink.w / 2, cy = ink.y + ink.h / 2
  // Scaled around its center, then moved the least it takes to sit inside (centered when still bigger).
  const left = cx - w / 2, top = cy - h / 2
  const x = w > bounds.w ? bounds.x + (bounds.w - w) / 2 : Math.min(Math.max(left, bounds.x), bounds.x + bounds.w - w)
  const y = h > bounds.h ? bounds.y + (bounds.h - h) / 2 : Math.min(Math.max(top, bounds.y), bounds.y + bounds.h - h)
  return { scale: Math.round(scale * 1000) / 1000, dx: Math.round(x - left), dy: Math.round(y - top), overflow: need < SAFE_MIN_SCALE - 1e-6 }
}

const NUMBER_EFFECTS = ['count-up', 'number-pop-in']

/**
 * A simpler graphic with the same words, for one that can't sit inside its band: a line effect becomes a Statement
 * card (its key word as the accent), a number a Stat card, a Before & after a crossed-out list. Null when there is
 * none (it stays as it is, moved and drawn as small as allowed).
 */
export function safeFallback(spec: GraphicRenderSpec): GraphicRenderSpec | null {
  const f = spec.fields
  const theme = f.theme === 'light' ? 'light' : 'dark'
  // A Before & after whose two cards stack taller than the band: the same two lines as a crossed-out list (the before
  // line struck through, the after line under it), which takes about half the height.
  if (spec.template === 'before_after' && f.before && f.after) {
    return { ...spec, template: 'strike_list', fields: { items: f.before.slice(0, 80), final: f.after.slice(0, 80), theme } }
  }
  if (spec.template !== 'fx') return null
  if (NUMBER_EFFECTS.includes(f.effect ?? '') && f.value) {
    const value = `${f.prefix ?? ''}${f.value}${f.effect === 'number-pop-in' && f.unit ? ` ${f.unit}` : f.suffix ? (f.suffix.length <= 2 ? f.suffix : ` ${f.suffix}`) : ''}`.trim()
    return { ...spec, template: 'stat', fields: { value: value.slice(0, 24), variant: theme === 'dark' ? 'gradient' : 'card' }, size: spec.size === 'stage' ? 'stage' : undefined }
  }
  const text = (f.text ?? f.second ?? f.line ?? '').trim()
  if (!text) return null
  const accent = (f.word ?? f.underline ?? '').trim()
  return { ...spec, template: 'statement', fields: { text: text.slice(0, 120), ...(accent ? { accent } : {}), variant: theme === 'dark' ? 'glass' : 'card' }, size: spec.size === 'stage' ? 'stage' : undefined }
}
