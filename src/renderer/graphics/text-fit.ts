/**
 * On-phone rules for the text templates (templates.ts), the same ones the effects keep (fx/fit.ts fxMinType): pure
 * numbers, testable without a page.
 *
 * - Type: a short line (1-6 words) is drawn at a cap height of about 54 px on a 1080-wide frame, a longer one about
 *   43 px. The bold sans has a cap height of about 0.72 of its size; the italic serif (Instrument Serif) about 0.62, so
 *   it is set bigger for the same cap height.
 * - Fill: a card spans at least 70% of the frame's width, a stage graphic at least 88% (the type grows until it does,
 *   up to the template's largest size; a card that still comes out narrower is widened to it).
 */

/** The bold sans' and the italic serif's cap height against their font size. */
export const CAP_RATIO = { sans: .72, serif: .62 } as const
/** The cap height a short line (1-6 words) and a longer one keep, in pixels of a 1080-wide frame. */
export const TEXT_MIN_CAP = { short: 54, long: 43 } as const
/** The share of the frame's width a text graphic fills at least (card) and on the stage. */
export const TEXT_FILL = { card: .7, stage: .88, compact: .5 } as const
/** The share of the frame's width a text graphic may take at most (its type stops growing there). */
export const TEXT_MAX_FILL = { card: .9, stage: .92, compact: .74 } as const

/** The smallest font size (px on a 1080-wide frame) for a line of `words` words in the sans or the serif. */
export function textMinType(words: number, face: 'sans' | 'serif' = 'sans'): number {
  const cap = words > 0 && words <= 6 ? TEXT_MIN_CAP.short : TEXT_MIN_CAP.long
  return Math.ceil(cap / CAP_RATIO[face])
}

/** How many words a line has (what textMinType counts). */
export function wordCount(text: string | undefined): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length
}

/**
 * The largest size from `max` down to `min` (in steps of `step`) for which `fits(size)` holds, else `min`: the type is
 * as big as the room allows and never smaller than the on-phone minimum (it may then spill a little past its band).
 */
export function largestFitting(min: number, max: number, fits: (size: number) => boolean, step = 2): number {
  const lo = Math.min(min, max)
  for (let s = Math.max(min, max); s >= lo; s -= step) if (fits(s)) return s
  return lo
}

/** The theme a text graphic is drawn in: 'dark' (light ink on dark glass) or 'light' (dark ink, white cards), or '' (its own look). */
export function textTheme(fields: Record<string, string>): 'dark' | 'light' | '' {
  return fields.theme === 'dark' || fields.theme === 'light' ? fields.theme : ''
}
