/**
 * How an effect's drawing is fitted into its box (pure geometry: shared by the clip editor's preview and the bake's
 * offscreen render through mount.ts, and testable without the effect units).
 */
export type Rect = { x: number; y: number; w: number; h: number }

/** The smallest type an effect shows, as drawn on a 1080-wide frame (font px; about 0.72 of it is the cap height). */
export const FX_MIN_TYPE: Record<'stage' | 'card' | 'compact', number> = { stage: 48, card: 40, compact: 32 }

/**
 * How much of its box an effect's drawing fills (width, height shares) at each size: on the stage it fills the band
 * (the pro references: a browser window or a diagram across most of the stage's width), a card nearly as much, a
 * compact badge stays a badge.
 */
export const FX_FIT: Record<'stage' | 'card' | 'compact', { w: number; h: number; max: number }> = {
  stage: { w: .94, h: .9, max: 3 }, card: { w: .92, h: .86, max: 3 }, compact: { w: .62, h: .8, max: 2.6 }
}
/**
 * The unit's scale and shift so its drawing (`ink`, measured settled) fills its box: centered, grown to the fit's
 * share (never past FX_FIT.max), and shrunk only when it would spill out of the box.
 */
export function fxFit(ink: Rect | null, box: { w: number; h: number }, size: 'stage' | 'card' | 'compact', fallback = 1, pad = { x: 0, y: 0 }): { scale: number; dx: number; dy: number } {
  if (!ink || ink.w < 4 || ink.h < 4) return { scale: fallback, dx: 0, dy: 0 }
  const fit = FX_FIT[size]
  // `pad`: room kept around it (the glass behind it), in box pixels.
  const s = Math.min((box.w * fit.w - 2 * pad.x) / ink.w, (box.h * fit.h - 2 * pad.y) / ink.h)
  const spills = ink.w > box.w * 1.01 || ink.h > box.h * 1.01
  const scale = Math.max(.4, Math.min(fit.max, spills ? s : Math.max(1, s)))
  return { scale: Math.round(scale * 1000) / 1000, dx: Math.round(box.w / 2 - (ink.x + ink.w / 2)), dy: Math.round(box.h / 2 - (ink.y + ink.h / 2)) }
}

/**
 * How far to move an effect's box (frame pixels, + is down) so its drawing, fitted centered (fxFit), sits at the top or
 * bottom edge of its band with `padY` to spare: a card at the top sits under the hook, one at the bottom over the
 * captions, not out on the speaker's face. 0 when centered or when the drawing fills the band.
 */
export function fxAnchorShift(inkH: number, scale: number, boxH: number, padY: number, anchor: 'top' | 'center' | 'bottom'): number {
  if (anchor === 'center' || !(inkH > 0)) return 0
  const spare = (boxH - inkH * scale) / 2 - padY
  if (!(spare > 0)) return 0
  return Math.round(anchor === 'top' ? -spare : spare)
}

/**
 * The smallest type an effect shows on a phone (font px on a 1080-wide frame, the cap height about 0.72 of it): a words
 * effect's short line (1-6 words) at a cap height of about 58 px, a longer one about 48 px (a real run's lines read
 * small at 43); a framework on the stage
 * about 46 px; other effects keep FX_MIN_TYPE for their size.
 */
export function fxMinType(size: 'stage' | 'card' | 'compact', group: string | undefined, words: number): number {
  // A framework on the stage (a flow, a hub, a checklist): labels at a cap height of about 46 px.
  if (group === 'ideas' && size === 'stage') return 64
  if (group !== 'words' || size === 'compact') return FX_MIN_TYPE[size]
  return Math.max(FX_MIN_TYPE[size], words > 0 && words <= 6 ? 80 : 66)
}

/** How much of a glass backing is left `left_ms` before its unit ends (1 until its last glass_out_ms, then down to 0). */
export function fxGlassLeft(leftMs: number, outMs = 460): number {
  return Math.max(0, Math.min(1, leftMs / outMs))
}

/**
 * Step labels (a flowchart's boxes, a stepper's steps) read as one line each: the largest size from `max` down to
 * `min` (in steps of `step`) at which no label wraps (`lines(size)`: each label's line count at that size). When even
 * `min` wraps one, the labels keep `max` and wrap balanced (two even lines, every step as tall as the tallest).
 */
export function fitStepLabels(max: number, min: number, lines: (size: number) => number[], step = .2): { size: number; balance: boolean } {
  const lo = Math.min(min, max)
  for (let s = max; s >= lo - 1e-9; s = Math.round((s - step) * 1000) / 1000) {
    if (lines(s).every((n) => n <= 1)) return { size: s, balance: false }
  }
  return { size: max, balance: true }
}

/** The least luminance (0-255) a brand color keeps as is for words on dark glass; below it the color is lifted toward white. */
export const BRAND_ON_DARK = 170

/**
 * The brand color effects draw words and accents in, for the video's look: on dark glass and over video a dark or mid
 * color is lifted toward white so its words read on a phone (a royal blue on dark glass did not); on white, a very
 * light one is deepened. `c` is [r, g, b]; returns a CSS rgb().
 */
export function fxBrand(c: [number, number, number], tone: 'dark' | 'light' = 'dark'): string {
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const mix = (to: number, k: number): string => `rgb(${c.map((v) => Math.round(v + (to - v) * k)).join(', ')})`
  if (tone === 'light') return lum <= 170 ? `rgb(${c.join(', ')})` : mix(0, Math.min(.5, (lum - 170) / 170 + .15))
  return lum >= BRAND_ON_DARK ? `rgb(${c.join(', ')})` : mix(255, Math.min(.6, (BRAND_ON_DARK - lum) / 170 + .15))
}

/**
 * The color a highlight marker is drawn in under white words on the dark glass: the brand color itself when white
 * reads on it, deepened when it is light (white on a pale marker read as a ghost), lifted a little when it is too dark
 * to show on the glass. `c` is [r, g, b]; returns a CSS rgb().
 */
export function fxMarkerFill(c: [number, number, number]): string {
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const mix = (to: number, k: number): string => `rgb(${c.map((v) => Math.round(v + (to - v) * k)).join(', ')})`
  if (lum > MARKER_MAX_LUM) return mix(0, Math.min(.6, (lum - MARKER_MAX_LUM) / 255 + .2))
  if (lum < MARKER_MIN_LUM) return mix(255, Math.min(.4, (MARKER_MIN_LUM - lum) / 255 + .1))
  return `rgb(${c.join(', ')})`
}
/** The brightest and darkest a highlight marker under white words may be (luminance 0-255). */
export const MARKER_MAX_LUM = 120
export const MARKER_MIN_LUM = 45

/** A marked word as measured (unscaled px, relative to the box holding its mark): its ink's left and right, its baseline, its cap height. */
export type MarkedWord = { left: number; right: number; baseline: number; cap: number }
/**
 * Where each hand-drawn mark sits around its word, in the word's own measure: `u` is the face's em as its cap height
 * gives it (cap / 0.727, the units' Inter), so a condensed, script or serif accent face gets the same mark as the
 * bundled sans: from/to are above (-) or below (+) the baseline in u; x is the overhang each side (share of the word, at
 * most `most` u: a long word's circle stays a snug ring). The highlight runs through the letters (the x-height and the
 * lower caps), the underline sits under the descenders, the circle rings the whole word.
 */
export const WORD_MARKS: Record<string, { from: number; to: number; x: number; most: number; ink: [number, number] }> = {
  // `ink`: where the stroke paints across its box (shares of its width): the units' strokes are stretched into the box,
  // so a highlight's round ends reach a tenth of the box past it each side.
  highlight: { from: -.77, to: .1, x: .03, most: .08, ink: [-.1, 1.1] }, scribble: { from: -.77, to: .1, x: .02, most: .06, ink: [.035, .965] },
  underline: { from: .16, to: .41, x: .025, most: .06, ink: [0, 1] }, circle: { from: -1.2, to: .53, x: .13, most: .22, ink: [.006, 1] }
}
const CAP_SHARE = .727
/** The ring's clearance from the next word's letters (u). */
const MARK_CLEAR = .06
/**
 * The mark's box (relative to the same origin as `word`) for a mark style, and the room the word needs each side past
 * its word space (`space`, px) so the mark clears the next word's letters: none unless a circle's ring needs it.
 */
export function wordMarkBox(style: string, word: MarkedWord, space: number): { box: Rect; margin: number } {
  const m = WORD_MARKS[style] ?? WORD_MARKS.highlight
  const u = Math.max(1, word.cap) / CAP_SHARE
  const w = Math.max(1, word.right - word.left)
  const over = Math.min(w * m.x, m.most * u)
  // The box whose painted stroke spans the word plus its overhang.
  const bw = (w + 2 * over) / (m.ink[1] - m.ink[0])
  return {
    box: { x: word.left - over - m.ink[0] * bw, y: word.baseline + m.from * u, w: bw, h: (m.to - m.from) * u },
    margin: Math.max(0, over + MARK_CLEAR * u - Math.max(0, space))
  }
}
