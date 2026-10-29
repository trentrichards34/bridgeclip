/**
 * Layouts from the "You on camera" reference reels, for Pause & react, Their clip then me and React then my thoughts.
 *
 * Chosen on Remix before planning (RemixRequest.layout): whether their clip already has captions (ours then stay off
 * it), where the hook text sits ("On the split line" in a split Pause & react, "Beside me" with the phone card), and
 * React, then my thoughts' part 1 as a "Phone card".
 *
 * Added in the review (LayoutExtrasView): React, then my thoughts' part 2 as a voiceover over a screen recording (with
 * the "Comment KEYWORD" banner and red circles), and up to six proof screenshots in part 2 of either clip template.
 * The engine (engine/clip_engine/services/remix_layouts.py) checks all of it again.
 */
import type { RemixFormat } from './remix'

export type TheirCaptions = 'auto' | 'yes' | 'no'
export type HookAt = 'top' | 'seam' | 'beside'
export type Part1Layout = 'box' | 'phone'
export type Part2Layout = 'camera' | 'screen'
/** React, then my thoughts, part 1 in a big box: where their clip's box goes ('auto': clear of the member's face). */
export type BoxAt = 'auto' | 'top' | 'bottom'
export const BOX_AT_CHOICES: readonly BoxAt[] = ['auto', 'top', 'bottom']

export interface RemixLayoutChoice { theirCaptions: TheirCaptions; hookAt: HookAt; part1: Part1Layout }

/** A highlight box on a screenshot, 0..1 of the picture (the look extras' "Proof highlights" underline it). */
export interface HighlightRect { x: number; y: number; w: number; h: number }

export interface ProofShot {
  id: string
  /** The file's name, as the member knows it. */
  name: string
  /** The run's own copy (previewable). */
  path: string
  /** Seconds into part 2, or null: spread evenly. */
  at: number | null
  label: string
  highlight: HighlightRect | null
}

export interface ScreenCircle { at: number; x: number; y: number }

export interface LayoutExtrasView {
  format: 'clip_then_me' | 'react_thoughts'
  part2: Part2Layout
  screen: { id: string; name: string; path: string } | null
  banner: boolean
  circles: ScreenCircle[]
  proofs: ProofShot[]
  /** The comment keyword (the banner shows it), '' for none. */
  keyword: string
  /** React, then my thoughts (big box): where their clip's box goes in part 1. Missing: 'auto'. */
  boxAt?: BoxAt
}

export const MAX_PROOFS = 6
export const MAX_CIRCLES = 8
export const MAX_PROOF_LABEL = 24
export const PROOF_LABELS = ['Thread', 'My post', 'Result', 'Comment', 'Review'] as const
export const PROOF_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
export const SCREEN_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv']
export const PROOF_MAX_BYTES = 50 * 1024 * 1024
export const SCREEN_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** Proof cards and circles: never over part 2's first 2 s or its last 1.5 s (the engine's rules). */
export const PROOF_HEAD_SECONDS = 2
export const PROOF_TAIL_SECONDS = 1.5
const MAX_AT_SECONDS = 185
const PROOF_ID = /^p[0-9a-f]{8}$/
const SCREEN_ID = /^s[0-9a-f]{8}$/

export const THEIR_CAPTION_CHOICES: readonly { id: TheirCaptions; label: string; detail: string }[] = [
  { id: 'auto', label: 'Check for me', detail: 'The app looks for words already on their video and leaves them alone.' },
  { id: 'yes', label: 'It has captions', detail: 'Their own captions stay as they are; ours start when you do.' },
  { id: 'no', label: 'No captions', detail: 'Their words are captioned along with yours.' }
]

export const PART1_CHOICES: readonly { id: Part1Layout; label: string; detail: string }[] = [
  { id: 'box', label: 'Big box', detail: 'Their clip in a large box, placed clear of your face.' },
  { id: 'phone', label: 'Phone card', detail: 'You fill the frame; their clip floats as a rounded card in the lower right.' }
]

export const DEFAULT_LAYOUT_CHOICE: RemixLayoutChoice = { theirCaptions: 'auto', hookAt: 'top', part1: 'box' }

export function layoutFormat(format: RemixFormat): format is 'pause_react' | 'clip_then_me' | 'react_thoughts' {
  return format === 'pause_react' || format === 'clip_then_me' || format === 'react_thoughts'
}

/** Instagram and TikTok clips nearly always carry their own captions: "It has captions" to start with. */
export function defaultTheirCaptions(source: string): TheirCaptions {
  try {
    const host = new URL(source.trim()).hostname.toLowerCase().replace(/^www\./, '')
    return /(^|\.)(instagram\.com|tiktok\.com)$/.test(host) ? 'yes' : 'auto'
  } catch { return 'auto' }
}

/** The hook placements a format and layout offer, the first being the default. */
export function hookChoices(format: RemixFormat, pauseLayout: string | null, part1: Part1Layout): HookAt[] {
  if (format === 'pause_react' && pauseLayout === 'split') return ['seam', 'top']
  if (format === 'react_thoughts' && part1 === 'phone') return ['beside', 'top']
  return ['top']
}

export const HOOK_AT_LABELS: Record<HookAt, { label: string; detail: string }> = {
  top: { label: 'At the top', detail: 'Your hook text in its bar or floating at the top.' },
  seam: { label: 'On the split line', detail: 'A white box with bold black text, right where the two halves meet.' },
  beside: { label: 'Beside me', detail: 'Big white capitals next to your head while their clip plays.' }
}

/** A layout choice from the renderer (untrusted), for this format and layout. Throws a plain message. */
export function parseLayoutChoice(value: unknown, format: RemixFormat, pauseLayout: string | null): RemixLayoutChoice {
  if (value === undefined || value === null) {
    return { ...DEFAULT_LAYOUT_CHOICE, hookAt: hookChoices(format, pauseLayout, 'box')[0] }
  }
  const raw = value as Record<string, unknown>
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(raw).some((key) => !['theirCaptions', 'hookAt', 'part1'].includes(key))) {
    throw new Error('Choose the layout again.')
  }
  const theirCaptions = raw.theirCaptions ?? 'auto'
  const part1 = raw.part1 ?? 'box'
  if (!THEIR_CAPTION_CHOICES.some((item) => item.id === theirCaptions)) throw new Error('Choose whether their clip already has captions.')
  if (part1 !== 'box' && !(part1 === 'phone' && format === 'react_thoughts')) throw new Error('Choose how their clip shows while you react.')
  const hooks = hookChoices(format, pauseLayout, part1 as Part1Layout)
  const hookAt = raw.hookAt ?? hooks[0]
  if (!hooks.includes(hookAt as HookAt)) throw new Error('Choose where your hook text goes.')
  return { theirCaptions: theirCaptions as TheirCaptions, hookAt: hookAt as HookAt, part1: part1 as Part1Layout }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const unit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1

export function isProofId(value: unknown): value is string { return typeof value === 'string' && PROOF_ID.test(value) }
export function isScreenId(value: unknown): value is string { return typeof value === 'string' && SCREEN_ID.test(value) }

export function proofLabel(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROOF_LABEL) : ''
}

export function parseHighlight(value: unknown): HighlightRect | null {
  if (value === null || value === undefined) return null
  const raw = value as Record<string, unknown>
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(raw).sort().join() !== 'h,w,x,y' || !['x', 'y', 'w', 'h'].every((key) => unit(raw[key]))) {
    throw new Error('That highlight box is damaged. Draw it again.')
  }
  const [x, y, w, h] = (['x', 'y', 'w', 'h'] as const).map((key) => Math.round((raw[key] as number) * 10000) / 10000)
  if (w < 0.01 || h < 0.01 || x + w > 1.0001 || y + h > 1.0001) throw new Error('Draw the highlight box inside the screenshot.')
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }
}

/** What the member changed in the review, checked against what's there (main). Throws a plain message. */
export interface LayoutExtrasPatch {
  part2?: Part2Layout
  banner?: boolean
  circles?: ScreenCircle[]
  proofs?: { id: string; at: number | null; label: string; highlight: HighlightRect | null }[]
  boxAt?: BoxAt
}

export function parseExtrasPatch(value: unknown, format: LayoutExtrasView['format'], proofIds: ReadonlySet<string>): LayoutExtrasPatch {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(raw).some((key) => !['part2', 'banner', 'circles', 'proofs', 'boxAt'].includes(key))) {
    throw new Error('That change could not be read. Try again.')
  }
  const react = format === 'react_thoughts'
  const patch: LayoutExtrasPatch = {}
  if (raw.part2 !== undefined) {
    if (!react || (raw.part2 !== 'camera' && raw.part2 !== 'screen')) throw new Error('Choose how part 2 looks.')
    patch.part2 = raw.part2
  }
  if (raw.banner !== undefined) {
    if (!react || typeof raw.banner !== 'boolean') throw new Error('Choose whether the comment banner shows.')
    patch.banner = raw.banner
  }
  if (raw.boxAt !== undefined) {
    if (!react || !(BOX_AT_CHOICES as readonly unknown[]).includes(raw.boxAt)) throw new Error('Choose where their clip goes.')
    patch.boxAt = raw.boxAt as BoxAt
  }
  if (raw.circles !== undefined) {
    if (!react || !Array.isArray(raw.circles) || raw.circles.length > MAX_CIRCLES) throw new Error(`Add up to ${MAX_CIRCLES} circles.`)
    patch.circles = raw.circles.map((item) => {
      const circle = (item ?? {}) as Record<string, unknown>
      if (!item || typeof item !== 'object' || !finite(circle.at) || circle.at < 0 || circle.at > MAX_AT_SECONDS || !unit(circle.x) || !unit(circle.y)) {
        throw new Error('A circle could not be placed. Add it again.')
      }
      return { at: Math.round(circle.at * 100) / 100, x: Math.round(circle.x * 10000) / 10000, y: Math.round(circle.y * 10000) / 10000 }
    }).sort((a, b) => a.at - b.at)
  }
  if (raw.proofs !== undefined) {
    if (!Array.isArray(raw.proofs) || raw.proofs.length > MAX_PROOFS) throw new Error(`Add up to ${MAX_PROOFS} screenshots.`)
    const seen = new Set<string>()
    patch.proofs = raw.proofs.map((item) => {
      const proof = (item ?? {}) as Record<string, unknown>
      if (!item || typeof item !== 'object' || !isProofId(proof.id) || !proofIds.has(proof.id) || seen.has(proof.id)) throw new Error('That screenshot is no longer here. Add it again.')
      seen.add(proof.id)
      if (proof.at !== null && proof.at !== undefined && (!finite(proof.at) || proof.at < 0 || proof.at > MAX_AT_SECONDS)) throw new Error('Choose a time within your take.')
      return { id: proof.id, at: finite(proof.at) ? Math.round(proof.at * 10) / 10 : null, label: proofLabel(proof.label), highlight: parseHighlight(proof.highlight) }
    })
  }
  return patch
}

/** When each proof card shows (part-2 seconds), for the review: the member's time, else spread evenly (like the engine). */
export function proofStarts(proofs: Pick<ProofShot, 'at'>[], takeSeconds: number | null): (number | null)[] {
  if (!takeSeconds) return proofs.map((proof) => proof.at)
  const lo = PROOF_HEAD_SECONDS, hi = Math.max(lo, takeSeconds - PROOF_TAIL_SECONDS)
  const slot = (hi - lo) / Math.max(1, proofs.length)
  return proofs.map((proof, i) => proof.at ?? Math.round((lo + slot * i + Math.min(0.3, slot * 0.1)) * 10) / 10)
}

/** The engine's `layout` for a run: the choice made before planning plus what was added in the review. */
export function engineLayout(choice: RemixLayoutChoice, extras?: Omit<LayoutExtrasView, 'keyword' | 'format'> | null): Record<string, unknown> {
  return {
    their_captions: choice.theirCaptions, hook_at: choice.hookAt, part1: choice.part1,
    ...(extras ? {
      part2: extras.part2 === 'screen' && extras.screen ? 'screen' : 'camera',
      ...(extras.part2 === 'screen' && extras.screen ? { screen: { path: extras.screen.path }, circles: extras.circles } : {}),
      banner: extras.banner,
      ...(extras.boxAt && extras.boxAt !== 'auto' && choice.part1 === 'box' ? { box_at: extras.boxAt } : {}),
      proofs: extras.proofs.map((proof) => ({ id: proof.id, path: proof.path, at: proof.at, label: proof.label, highlight: proof.highlight }))
    } : {})
  }
}
