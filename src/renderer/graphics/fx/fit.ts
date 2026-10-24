/**
 * How an effect's drawing is fitted into its box (pure geometry: shared by the clip editor's preview and the bake's
 * offscreen render through mount.ts, and testable without the effect units).
 */
export type Rect = { x: number; y: number; w: number; h: number }

/** The smallest type an effect shows, as drawn on a 1080-wide frame (font px; about 0.72 of it is the cap height). */
export const FX_MIN_TYPE: Record<'stage' | 'card' | 'compact', number> = { stage: 46, card: 36, compact: 30 }

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
 * effect's short line (1-6 words) at a cap height of about 54 px, a longer one about 43 px; a framework on the stage
 * about 46 px; other effects keep FX_MIN_TYPE for their size.
 */
export function fxMinType(size: 'stage' | 'card' | 'compact', group: string | undefined, words: number): number {
  // A framework on the stage (a flow, a hub, a checklist): labels at a cap height of about 46 px.
  if (group === 'ideas' && size === 'stage') return 64
  if (group !== 'words' || size === 'compact') return FX_MIN_TYPE[size]
  return Math.max(FX_MIN_TYPE[size], words > 0 && words <= 6 ? 75 : 60)
}

/** How much of a glass backing is left `left_ms` before its unit ends (1 until its last glass_out_ms, then down to 0). */
export function fxGlassLeft(leftMs: number, outMs = 460): number {
  return Math.max(0, Math.min(1, leftMs / outMs))
}
