/**
 * "Extras": optional motion effects a member can add on top of a look, on
 * Create, Remix and Edit my recording (pick as many as you like). The
 * renderer's style board picks them; the engine draws them. This file is the
 * contract between the two: ids, labels and the request field.
 */

export const LOOK_EXTRAS = [
  { id: 'punch_zoom', label: 'Zoom', detail: 'Cuts between a wide and a tight shot of your face every few seconds.' },
  { id: 'keyword_pill', label: 'Keyword pill', detail: 'The key word in each caption sits in a colored pill.' },
  { id: 'accent_words', label: 'Accent words', detail: 'A word or two per caption in an italic serif, for emphasis.' },
  { id: 'progress_bar', label: 'Progress bar', detail: 'A thin bar along the top fills as the video plays.' },
  { id: 'comment_box', label: 'Comment box', detail: 'At the end, a comment box types your keyword, so viewers know what to comment.' },
  { id: 'broll_tags', label: 'B-roll labels', detail: 'A small tag, like "Screen recording", on footage that cuts in. It doesn’t add B-roll: it only shows on clips that have some.' },
  { id: 'proof_underline', label: 'Proof highlights', detail: 'Screenshots you add pop in, with the key number underlined.' }
] as const

export type LookExtraId = (typeof LOOK_EXTRAS)[number]['id']

export const LOOK_EXTRA_IDS: readonly LookExtraId[] = LOOK_EXTRAS.map((extra) => extra.id)

export function isLookExtra(value: unknown): value is LookExtraId {
  return typeof value === 'string' && (LOOK_EXTRA_IDS as readonly string[]).includes(value)
}

/** Validates an untrusted list (unknown ids dropped, no duplicates, app order). */
export function parseLookExtras(value: unknown): LookExtraId[] {
  if (!Array.isArray(value)) return []
  const picked = new Set(value.filter(isLookExtra))
  return LOOK_EXTRA_IDS.filter((id) => picked.has(id))
}

/**
 * `register`: how dense the automatic motion graphics are (the engine's graphics director). Teaching: a graphic on
 * every number, list and key point; story: about half as many, the face carries personal moments; minimal: only the
 * hook, numbers and the call to action. Unset: the engine reads it from what is said.
 */
export const GRAPHICS_REGISTERS = [
  { id: 'teaching', label: 'Teaching', detail: 'A graphic on each number, list and key point.' },
  { id: 'story', label: 'Story', detail: 'About half as many. Personal moments stay on your face.' },
  { id: 'minimal', label: 'Minimal', detail: 'Only the hook, the numbers and the call to action.' }
] as const
export type GraphicsRegister = (typeof GRAPHICS_REGISTERS)[number]['id']
export function isGraphicsRegister(value: unknown): value is GraphicsRegister {
  return typeof value === 'string' && GRAPHICS_REGISTERS.some((r) => r.id === value)
}

/** Hook text fonts, including the pairings seen in current reels (a headline font plus an accent font). */
export const HOOK_FONT_PAIRS = [
  { id: 'marker', label: 'Marker', detail: 'Hand-drawn capitals, like a marker on the screen.' },
  { id: 'sans_serif_accent', label: 'Sans + italic serif', detail: 'Bold sans with one word in an italic serif.' }
] as const
