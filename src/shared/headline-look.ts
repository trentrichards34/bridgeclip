/**
 * How the hook text (headline) at the top of a 9:16 video looks: a bar in
 * white (the original look), black or a brand color, or floating text over the
 * video with no bar; and its font. The engine draws it (rendering_service.HeadlineLook).
 */
export type HeadlineLookStyle = 'white' | 'black' | 'brand' | 'floating' | 'none'
export type HeadlineFont = 'clean' | 'serif' | 'condensed' | 'marker' | 'sans_serif_accent'

export interface HeadlineLook {
  look: HeadlineLookStyle
  /** The bar color for the brand look, as #RRGGBB. */
  color: string
  font: HeadlineFont
}

export const DEFAULT_HEADLINE_LOOK: HeadlineLook = { look: 'white', color: '#FFFFFF', font: 'clean' }
export const DEFAULT_BRAND_COLOR = '#2563EB'

export const HEADLINE_LOOKS: readonly { id: HeadlineLookStyle; label: string; hint: string }[] = [
  { id: 'white', label: 'White bar', hint: 'Black text on a white bar. The original look.' },
  { id: 'black', label: 'Black bar', hint: 'White text on a black bar.' },
  { id: 'brand', label: 'Brand color', hint: 'A bar in your color; the text turns black or white to stay readable.' },
  { id: 'floating', label: 'Floating text', hint: 'No bar: outlined white text over the top of the video.' },
  { id: 'none', label: 'No hook text', hint: 'Nothing at the top: the video fills the frame.' }
]

export const HEADLINE_FONTS: readonly {
  id: HeadlineFont; label: string; family: string; upper?: boolean
  /** The font's weight in the preview. */
  weight?: number
  /** Size against the clean font (the engine's HEADLINE_FONT_SCALE). */
  scale?: number
  /** One word (accentWordIndex) is drawn in this italic font. */
  accent?: string
}[] = [
  { id: 'clean', label: 'Clean', family: '"Montserrat", "Montserrat ExtraBold", system-ui, sans-serif', weight: 800 },
  { id: 'serif', label: 'Serif', family: '"Fraunces 72pt Black", Georgia, serif' },
  { id: 'condensed', label: 'Bold condensed', family: '"Anton", Impact, sans-serif', upper: true, scale: 1.18 },
  { id: 'marker', label: 'Marker', family: '"Caveat Brush", "Comic Sans MS", cursive', upper: true, scale: 1.12 },
  { id: 'sans_serif_accent', label: 'Sans + italic serif', family: '"Montserrat", system-ui, sans-serif', weight: 800, accent: '"Instrument Serif", Georgia, serif' }
]

/** The accent word's size against the sans words (the engine's HEADLINE_ACCENT_SCALE). */
export const HEADLINE_ACCENT_SCALE = 1.25

/** The word drawn in the italic serif for the "Sans + italic serif" font: the last one with 3+ letters (the engine's headline_accent_index). */
export function accentWordIndex(words: readonly string[]): number {
  for (let i = words.length - 1; i >= 0; i--) {
    if ((words[i].match(/[\p{L}\p{N}]/gu) ?? []).length >= 3) return i
  }
  return words.length - 1
}

const HEX = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** Black or white text, whichever reads on this bar color (matches the engine). */
export function headlineTextColor(look: HeadlineLook): string {
  if (look.look === 'floating' || look.look === 'black') return '#FFFFFF'
  if (look.look === 'white') return '#000000'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(look.color.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#000000' : '#FFFFFF'
}

export function headlineBarColor(look: HeadlineLook): string | null {
  if (look.look === 'floating' || look.look === 'none') return null
  if (look.look === 'black') return '#0E0E0E'
  if (look.look === 'brand') return look.color
  return '#FFFFFF'
}

/** A look from the renderer (untrusted): throws on anything unknown. */
export function parseHeadlineLook(value: unknown): HeadlineLook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid headline look')
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !['look', 'color', 'font'].includes(key))) throw new Error('Invalid headline look')
  const look = raw.look ?? 'white'
  const font = raw.font ?? 'clean'
  const color = raw.color ?? '#FFFFFF'
  if (!HEADLINE_LOOKS.some((item) => item.id === look) || !HEADLINE_FONTS.some((item) => item.id === font) || !isHexColor(color)) {
    throw new Error('Invalid headline look')
  }
  return { look: look as HeadlineLookStyle, color: color.toUpperCase(), font: font as HeadlineFont }
}

/** What the engine needs: nothing for the default look, so older runs are unchanged. */
export function headlineLookForEngine(look: HeadlineLook | undefined): HeadlineLook | undefined {
  if (!look) return undefined
  return look.look === 'white' && look.font === 'clean' ? undefined : look
}
