/**
 * Make my cover: covers for a finished reel or YouTube video, from the speaker's best frames (the engine's
 * cover_frames.py picks them: eyes open, face sharp and centered, expressive) and words from the video (its hook, or
 * what was said), laid out in the video's one look. Pure geometry and words here (the renderer draws with these, the
 * tests check them):
 *
 * - Reel (1080x1920): the frame filling the picture, the face clear of the text; the hook in the big "key words in color"
 *   look (highlightPlacement) inside the part of the picture Instagram and TikTok leave clear (COVER_SAFE).
 * - YouTube (1280x720): a thumbnail: big bold 3 to 5 words said in the video on one side, the face big on the other,
 *   the text side darkened for contrast, the key words on a box in the brand color.
 */
import { DEFAULT_BRAND_COLOR, HIGHLIGHT, highlightColors, highlightPlacement, isHexColor, type HeadlineLook } from './headline-look'

export type CoverFormat = 'reel' | 'youtube'
export type CoverExtension = 'jpg' | 'png'
export const COVER_EXTENSIONS: readonly CoverExtension[] = ['jpg', 'png']

export const COVER_SIZE: Record<CoverFormat, { width: number; height: number }> = {
  reel: { width: 1080, height: 1920 }, youtube: { width: 1280, height: 720 }
}
/**
 * The part of a 9:16 cover the platforms leave clear, as shares of the frame: the top bar (Following / For You, the
 * camera), the caption, sound and account line at the bottom, the action buttons down the right side (lower half).
 */
export const COVER_SAFE = { top: 0.11, bottom: 0.22, side: 0.06, right: 0.15, buttonsFrom: 0.42 } as const
/** The most a cover's text may hold (the member can edit it). */
export const MAX_COVER_TEXT = 120
/** How many frames are offered. */
export const COVER_FRAME_COUNT = 3
/** The hook's sizes on a Reel cover (against the video's own), biggest first: smaller only to stay off the eyes. */
export const COVER_HOOK_SCALES = [1.25, 1.12, 1.0] as const
/** The YouTube words: 3 to 5. */
export const THUMB_WORDS = { min: 3, max: 5 } as const

/** A frame the engine picked: its time, the JPEG, its score and the face (x, y, w, h as shares of the frame). */
export interface CoverFrame {
  atMs: number; path: string; score: number; face: [number, number, number, number]
  /** The JPEG's bytes (the renderer draws them on its own canvas: a cross-origin picture couldn't be saved from it). */
  data?: Uint8Array
}
export interface SavedCover { path: string; sizeBytes: number }
export interface CoverSuggestions {
  format: CoverFormat
  /** The frame size (the video's). */
  width: number
  height: number
  frames: CoverFrame[]
  /** The member's headline (the hook text), '' without one. */
  headline: string
  /** The words offered for the cover: the headline (Reel) or 3-5 words from it or from what was said (YouTube). */
  text: string
  look: HeadlineLook | null
  saved: SavedCover | null
}

/** The cover's file next to its video: `clip_00.mp4` -> `clip_00.cover.jpg`. */
export function coverFileName(videoName: string, ext: CoverExtension): string {
  const base = videoName.replace(/^.*[\\/]/, '')
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
  return `${stem}.cover.${ext}`
}

/** Reel or YouTube from the video's shape. */
export function coverFormatFor(width: number, height: number): CoverFormat {
  return width > height ? 'youtube' : 'reel'
}

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'be',
  'it', 'that', 'this', 'i', 'you', 'we', 'my', 'your', 'our', 'if', 'as', 'by', 'from', 'just', 'um', 'uh', 'like', 'do', 'have'])
const clean = (word: string): string => word.replace(/^[^\w$#%]+|[^\w%]+$/g, '')

/**
 * The words for a YouTube thumbnail: the strongest run of 3 to 5 words of `text` (as written: nothing is added): numbers
 * and money count most, then long words; a run doesn't start or end on a little word. The whole text when it is that
 * short; '' without words.
 */
export function thumbnailWords(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').map(clean).filter(Boolean)
  if (words.length <= THUMB_WORDS.max) return words.join(' ')
  let best = { score: -Infinity, at: 0, n: THUMB_WORDS.min }
  for (let n = THUMB_WORDS.min; n <= THUMB_WORDS.max; n++) {
    for (let at = 0; at + n <= words.length; at++) {
      const run = words.slice(at, at + n)
      let score = 0
      for (const w of run) {
        const lower = w.toLowerCase()
        if (/\d/.test(w) || w.startsWith('$')) score += 3
        else if (!STOP.has(lower) && w.length >= 6) score += 1.2
        else if (!STOP.has(lower)) score += 0.6
        else score -= 0.3
      }
      if (STOP.has(run[0].toLowerCase())) score -= 1.5
      if (STOP.has(run[n - 1].toLowerCase())) score -= 1.5
      // Shorter reads bigger: a small nudge toward fewer words, and toward the start (the claim comes first).
      score -= (n - THUMB_WORDS.min) * 0.25 + at * 0.01
      if (score > best.score) best = { score, at, n }
    }
  }
  return words.slice(best.at, best.at + best.n).join(' ')
}

/** The words a cover offers first: the headline for a Reel; for YouTube 3-5 of the headline's, else of what was said. */
export function coverText(format: CoverFormat, headline: string, said: string): string {
  const hook = headline.replace(/\s+/g, ' ').trim()
  if (format === 'reel') return (hook || thumbnailWords(said)).slice(0, MAX_COVER_TEXT)
  return thumbnailWords(hook || said)
}

/** Where the frame image goes on the cover (cover pixels), scaled uniformly. */
export interface ImagePlacement { x: number; y: number; width: number; height: number }

/** The frame scaled by `scale` and moved so the face's center lands at (cx, cy), clamped so it still covers the box. */
function placeFrame(frameW: number, frameH: number, face: CoverFrame['face'], scale: number, cx: number, cy: number,
  box: { x: number; y: number; width: number; height: number }): ImagePlacement {
  const width = frameW * scale, height = frameH * scale
  const fx = (face[0] + face[2] / 2) * width, fy = (face[1] + face[3] / 2) * height
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
  const x = width >= box.width ? clamp(cx - fx, box.x + box.width - width, box.x) : box.x + (box.width - width) / 2
  const y = height >= box.height ? clamp(cy - fy, box.y + box.height - height, box.y) : box.y + (box.height - height) / 2
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export interface ReelCoverLayout {
  width: number
  height: number
  image: ImagePlacement
  /** The hook in the big look, already moved to its place (lines' centers and the box paths are in cover pixels). */
  hook: ReturnType<typeof highlightPlacement> & { offsetY: number; at: 'top' | 'bottom' }
  colors: ReturnType<typeof highlightColors>
}

/** The Reel cover (1080x1920): the frame filling the picture, the hook in its big look where the platforms leave it clear. */
export function reelCoverLayout(frameW: number, frameH: number, face: CoverFrame['face'], text: string,
  measure: (line: string, size: number, phrase: boolean) => number, look: Pick<HeadlineLook, 'color'> | null): ReelCoverLayout {
  const { width: W, height: H } = COVER_SIZE.reel
  const top = Math.round(H * COVER_SAFE.top)
  // highlightPlacement starts its first line 5.5% down; the cover's starts under the platforms' top bar.
  const startY = Math.round(H * 0.055)
  const fill = Math.max(W / frameW, H / frameH)
  const image = placeFrame(frameW, frameH, face, fill, W / 2, H * 0.45, { x: 0, y: 0, width: W, height: H })
  const faceTop = image.y + face[1] * image.height, faceH = face[3] * image.height
  // The hook may sit over the hair, never over the eyes (a little above the eye line).
  const eyes = faceTop + faceH * 0.3
  let placed = highlightPlacement(text, measure, W, H, COVER_HOOK_SCALES[0])
  let at: 'top' | 'bottom' = 'top', offsetY = top - startY
  const fitsTop = (p: typeof placed): boolean => top + p.height - startY <= eyes - faceH * 0.05
  const found = COVER_HOOK_SCALES.map((scale) => highlightPlacement(text, measure, W, H, scale)).find(fitsTop)
  if (found) placed = found
  else {
    // The face sits high in the frame: the hook goes low, just above the caption and account line.
    at = 'bottom'
    offsetY = Math.round(H * (1 - COVER_SAFE.bottom)) - placed.height
  }
  const colors = highlightColors(look && isHexColor(look.color) ? look : { color: DEFAULT_BRAND_COLOR })
  return { width: W, height: H, image, hook: { ...placed, offsetY, at }, colors }
}

export interface ThumbLine { text: string; size: number; x: number; y: number; width: number; key: boolean }
export interface YouTubeCoverLayout {
  width: number
  height: number
  image: ImagePlacement
  /** The frame doesn't fill the thumbnail (a 9:16 frame): a blurred, darkened copy of it fills behind. */
  backdrop: boolean
  /** Which side the words are on, and the band (x from, x to) darkened under them. */
  side: 'left' | 'right'
  shade: { from: number; to: number }
  lines: ThumbLine[]
  /** The brand color (the key words' box) and the color of the words on it. */
  accent: string
  accentInk: string
}

/** The largest size from `max` down at which `words` wrap into at most `maxLines` lines of `maxWidth` (greedy). */
function thumbWrap(words: string[], measure: (line: string, size: number) => number, maxWidth: number, maxLines: number,
  sizes: readonly number[]): { size: number; lines: string[] } {
  let out = { size: sizes[sizes.length - 1], lines: words.length ? [words.join(' ')] : [] }
  for (const size of sizes) {
    const lines: string[] = []
    for (const word of words) {
      const trial = lines.length ? `${lines[lines.length - 1]} ${word}` : word
      if (lines.length && measure(trial, size) <= maxWidth) lines[lines.length - 1] = trial
      else lines.push(word)
    }
    out = { size, lines }
    if (lines.length <= maxLines && lines.every((l) => measure(l, size) <= maxWidth)) return out
  }
  return out
}

/** Sizes (px on 1280x720) the thumbnail words try, biggest first. */
export const THUMB_SIZES = [150, 138, 126, 116, 106, 96, 88, 80, 72, 64] as const

/**
 * The YouTube thumbnail (1280x720): the face big on its side of the frame (the side it is on, else the right), the
 * words big and bold on the other side (upper case, up to three lines, the key words, the last line, on a box in the
 * brand color), that side darkened for contrast.
 */
export function youtubeCoverLayout(frameW: number, frameH: number, face: CoverFrame['face'], text: string,
  measure: (line: string, size: number) => number, look: Pick<HeadlineLook, 'color'> | null): YouTubeCoverLayout {
  const { width: W, height: H } = COVER_SIZE.youtube
  const faceCx = face[0] + face[2] / 2
  const side: 'left' | 'right' = frameW > frameH && faceCx < 0.42 ? 'right' : 'left'
  // The face about half the thumbnail's height, on its side.
  const faceH = Math.max(1, face[3] * frameH)
  const fill = Math.max(W / frameW, H / frameH)
  // A landscape frame always fills the thumbnail (zoomed in up to 1.8x for a far face); a 9:16 frame is placed on its
  // side over a blurred copy of itself.
  const scale = frameW > frameH
    ? Math.max(fill, Math.min(fill * 1.8, (H * 0.5) / faceH))
    : Math.max(Math.min(fill, (H * 0.5) / faceH), (H * 0.36) / faceH)
  const cx = side === 'left' ? W * 0.74 : W * 0.26
  const image = placeFrame(frameW, frameH, face, scale, cx, H * 0.48, { x: 0, y: 0, width: W, height: H })
  const backdrop = image.width < W || image.height < H
  const pad = Math.round(W * 0.045), textW = Math.round(W * 0.52)
  const words = text.replace(/\s+/g, ' ').trim().toUpperCase().split(' ').filter(Boolean)
  const { size, lines } = thumbWrap(words, measure, textW, 3, THUMB_SIZES)
  const lineH = Math.round(size * 1.02), gap = Math.round(size * 0.08)
  const total = lines.length * lineH + Math.max(0, lines.length - 1) * gap
  let y = Math.round((H - total) / 2)
  const x0 = side === 'left' ? pad : W - pad - textW
  const out: ThumbLine[] = lines.map((line, i) => {
    const width = measure(line, size)
    const item = { text: line, size, x: side === 'left' ? x0 : x0 + textW - width, y, width, key: lines.length > 1 && i === lines.length - 1 }
    y += lineH + gap
    return item
  })
  const colors = highlightColors(look && isHexColor(look.color) ? look : { color: DEFAULT_BRAND_COLOR })
  return {
    width: W, height: H, image, backdrop, side, lines: out,
    shade: side === 'left' ? { from: 0, to: Math.round(W * 0.62) } : { from: Math.round(W * 0.38), to: W },
    accent: colors.phraseBg, accentInk: colors.phraseInk
  }
}

/** The fonts a cover draws with: the hook's own (the key words in the italic serif) and the thumbnail's bold condensed. */
export const COVER_FONTS = { thumb: '"Anton", Impact, sans-serif', phrase: '"Instrument Serif", Georgia, serif', phraseScale: HIGHLIGHT.phraseScale } as const
