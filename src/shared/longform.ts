/**
 * YouTube videos (landscape, long) from Edit my recording and Combine clips. A run is a Reel (vertical, short: the
 * app's usual edit, unchanged) or a YouTube video (16:9 1920x1080, often 10-30 minutes): the engine's longform.py
 * makes it. This file holds what main, the page and the editor share: the format and its suggestion, the member's
 * YouTube layout choices, the landscape graphic bands and chapters as YouTube reads them.
 */

export const EDIT_FORMATS = ['reel', 'youtube'] as const
export type EditFormat = (typeof EDIT_FORMATS)[number]
export function isEditFormat(value: unknown): value is EditFormat { return value === 'reel' || value === 'youtube' }

export const FORMAT_LABELS: Record<EditFormat, string> = { reel: 'Reel', youtube: 'YouTube' }

/** A recording at least this long, or a landscape one at least SUGGEST_LANDSCAPE_SECONDS long, starts as a YouTube video. */
export const SUGGEST_LONG_SECONDS = 180
export const SUGGEST_LANDSCAPE_SECONDS = 60
/** A YouTube video's recordings may run this long (a reel's: EDIT_MAX_SOURCE_SECONDS). */
export const YOUTUBE_MAX_SOURCE_SECONDS = 45 * 60
export const YOUTUBE_MAX_TOTAL_SECONDS = 45 * 60

/**
 * The format a run starts with (the member can switch): YouTube for a long recording (3+ minutes) or a landscape one
 * over a minute; a short or vertical one is a reel. Mirrors longform.py suggest_format.
 */
export function suggestFormat(sources: readonly { seconds: number; width?: number; height?: number }[]): EditFormat {
  const total = sources.reduce((sum, source) => sum + (Number.isFinite(source.seconds) ? source.seconds : 0), 0)
  if (total >= SUGGEST_LONG_SECONDS) return 'youtube'
  const landscape = sources.filter((s) => s.width && s.height && s.width > s.height * 1.1).length
  return landscape > 0 && landscape * 2 >= sources.length && total >= SUGGEST_LANDSCAPE_SECONDS ? 'youtube' : 'reel'
}

/** Why the format was suggested, in a few plain words ('' when nothing stands out). */
export function suggestionReason(sources: readonly { seconds: number; width?: number; height?: number }[]): string {
  const total = sources.reduce((sum, source) => sum + source.seconds, 0)
  const wide = sources.some((s) => s.width && s.height && s.width > s.height * 1.1)
  if (suggestFormat(sources) === 'youtube') return total >= SUGGEST_LONG_SECONDS ? (wide ? 'Long and landscape' : 'Over 3 minutes') : 'Filmed landscape'
  return sources.length ? 'Short' + (wide ? '' : ' and vertical') : ''
}

export const PIP_SIZES = ['small', 'medium', 'large'] as const
export type PipSize = (typeof PIP_SIZES)[number]
export const PIP_CORNERS = ['right', 'bottom_right'] as const
export type PipCorner = (typeof PIP_CORNERS)[number]
export const CAPTION_MODES = ['key', 'all'] as const
export type CaptionMode = (typeof CAPTION_MODES)[number]

/** The member's YouTube choices (review screen). `layout`: the recording as filmed, or screen + webcam picture-in-picture. */
export interface YoutubeChoice { layout: 'full' | 'pip'; pipSize: PipSize; pipCorner: PipCorner; captions: CaptionMode }
export const DEFAULT_YOUTUBE_CHOICE: YoutubeChoice = { layout: 'pip', pipSize: 'large', pipCorner: 'right', captions: 'key' }

export function parseYoutubeChoice(value: unknown): YoutubeChoice {
  if (value === undefined || value === null) return { ...DEFAULT_YOUTUBE_CHOICE }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid YouTube layout')
  const v = value as Record<string, unknown>
  const out = { ...DEFAULT_YOUTUBE_CHOICE }
  if (v.layout !== undefined) { if (v.layout !== 'full' && v.layout !== 'pip') throw new Error('Invalid YouTube layout'); out.layout = v.layout }
  if (v.pipSize !== undefined) { if (!PIP_SIZES.includes(v.pipSize as PipSize)) throw new Error('Invalid YouTube layout'); out.pipSize = v.pipSize as PipSize }
  if (v.pipCorner !== undefined) { if (!PIP_CORNERS.includes(v.pipCorner as PipCorner)) throw new Error('Invalid YouTube layout'); out.pipCorner = v.pipCorner as PipCorner }
  if (v.captions !== undefined) { if (!CAPTION_MODES.includes(v.captions as CaptionMode)) throw new Error('Invalid YouTube layout'); out.captions = v.captions as CaptionMode }
  return out
}

/** The engine's render fields for a YouTube video's choices (bridge/edit_runner.py _youtube). */
export function youtubeForEngine(choice: YoutubeChoice): { layout: 'full' | 'pip'; pip_size: PipSize; pip_corner: PipCorner; captions: CaptionMode } {
  return { layout: choice.layout, pip_size: choice.pipSize, pip_corner: choice.pipCorner, captions: choice.captions }
}

/** A YouTube editor project's landscape facts (kept with the project): the webcam card (x, y, w, h shares) and captions. */
export interface YoutubeLayout { pip: [number, number, number, number] | null; captions: CaptionMode }

export function parseYoutubeLayout(value: unknown): YoutubeLayout | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const pip = Array.isArray(v.pip) && v.pip.length === 4 && v.pip.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
    ? v.pip.map(Number) as [number, number, number, number] : null
  if (v.pip !== null && v.pip !== undefined && !pip) return null
  return { pip, captions: v.captions === 'all' ? 'all' : 'key' }
}

/**
 * Where a graphic sits on a YouTube video (shares of the frame): a full-screen brand card ('stage'), a lower third
 * (numbers, names, compact overlays), or a side panel on the right 42% of the frame. With the webcam card on the
 * right, cards go to the lower third left of it (they never cover the card or the middle of the screen).
 */
export function landscapeBand(kind: 'full' | 'lower' | 'side', pip: YoutubeLayout['pip']): { top: number; bottom: number; left: number; right: number } {
  // A full-screen card: the brand backdrop covers the frame; its words sit inside a calm margin.
  if (kind === 'full') return { top: .16, bottom: .84, left: .08, right: .92 }
  const cardLeft = pip ? pip[0] : 1
  const cardOnRight = pip !== null && pip[0] > .5
  const cardTop = pip ? pip[1] : 1
  if (kind === 'side' && !cardOnRight) return { top: .1, bottom: .78, left: .56, right: .96 }
  // Lower third: the lower left, over the captions' line (they sit at the very bottom), clear of a webcam card.
  const right = cardOnRight && cardTop < .86 ? Math.max(.4, Math.min(.52, cardLeft - .02)) : .52
  return { top: .6, bottom: .84, left: .04, right }
}

/** The band kind a graphic takes on a YouTube video (its size and template). */
export function landscapeKind(graphic: { template: string; size?: string; placement?: string }): 'full' | 'lower' | 'side' {
  if (graphic.size === 'stage') return 'full'
  if (graphic.size === 'compact' || graphic.placement === 'bottom' || ['stat', 'lower_third', 'link_cta', 'comment_cta', 'logo'].includes(graphic.template)) return 'lower'
  return 'side'
}

export interface Chapter { at_ms: number; title: string }

export function parseChapters(value: unknown): Chapter[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).flatMap((item): Chapter[] => {
    if (!item || typeof item !== 'object') return []
    const c = item as Record<string, unknown>
    if (typeof c.at_ms !== 'number' || !Number.isInteger(c.at_ms) || c.at_ms < 0 || typeof c.title !== 'string') return []
    // eslint-disable-next-line no-control-regex
    const title = c.title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    return title ? [{ at_ms: c.at_ms, title }] : []
  })
}

function clock(ms: number, hours: boolean): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0')
  return hours ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, '0')}:${ss}` : `${Math.floor(s / 60)}:${ss}`
}

/** The chapters as YouTube reads them in a description: one "M:SS Title" line each (the first at 0:00). */
export function chaptersText(chapters: readonly Chapter[]): string {
  const hours = chapters.some((c) => c.at_ms >= 3_600_000)
  return chapters.map((c) => `${clock(c.at_ms, hours)} ${c.title}`).join('\n')
}

/** A file name's format suffix: "-youtube" for a YouTube video, nothing for a reel. */
export function formatSuffix(format: EditFormat | undefined | null): string {
  return format === 'youtube' ? '-youtube' : ''
}
