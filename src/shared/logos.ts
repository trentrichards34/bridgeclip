/**
 * My logos: logo images the member adds once (Brand look page), each with a name and other names it goes by
 * ("Meta", "Facebook"). CreatorClips never draws a real brand's logo itself: only these, the member's own files. When
 * the speaker says a logo's name (whole words), the graphics director pops it in on a white tile (the "logo" graphic):
 * at most one every 6 seconds, each logo at most twice a video, never during a personal story
 * (engine graphics_director.place_logos). In the clip editor the member can pick one for a Logo pop graphic.
 */
export interface LogoSummary {
  id: string
  name: string
  /** Other names it goes by, said the same way ("Facebook" for Meta). */
  aliases: string[]
  /** The stored picture (PNG, JPEG or WebP; an SVG is stored as a PNG), for its thumbnail. */
  path: string
  createdAt: string
}

export const MAX_LOGOS = 30
export const MAX_LOGO_ALIASES = 6
export const MAX_LOGO_NAME_CHARS = 40
/** A logo file: up to 5 MB (a logo is small). */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024
export const LOGO_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg']

export function isLogoId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)
}

/** A name or alias as stored: one line, letters, numbers and simple marks, up to 40 characters ('' when nothing is left). */
export function cleanLogoName(value: unknown): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f<>{}[\]\\|^`"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LOGO_NAME_CHARS).trim()
}

/** Aliases from a list or a comma-separated line: cleaned, without the name itself or repeats, at most six. */
export function cleanLogoAliases(value: unknown, name = ''): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const seen = new Set([name.toLowerCase()])
  const out: string[] = []
  for (const item of raw) {
    const alias = cleanLogoName(item)
    if (!alias || seen.has(alias.toLowerCase())) continue
    seen.add(alias.toLowerCase())
    out.push(alias)
    if (out.length >= MAX_LOGO_ALIASES) break
  }
  return out
}
