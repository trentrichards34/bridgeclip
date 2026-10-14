/**
 * How the hook text (headline) at the top of a 9:16 video looks: a bar in
 * white (the original look), black or a brand color, or floating text over the
 * video with no bar; and its font. The engine draws it (rendering_service.HeadlineLook).
 */
export type HeadlineLookStyle = 'white' | 'black' | 'brand' | 'floating'
export type HeadlineFont = 'clean' | 'serif' | 'condensed'

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
  { id: 'floating', label: 'Floating text', hint: 'No bar: outlined white text over the top of the video.' }
]

export const HEADLINE_FONTS: readonly { id: HeadlineFont; label: string; family: string; upper?: boolean }[] = [
  { id: 'clean', label: 'Clean', family: '"Montserrat", "Montserrat ExtraBold", system-ui, sans-serif' },
  { id: 'serif', label: 'Serif', family: '"Fraunces 72pt Black", Georgia, serif' },
  { id: 'condensed', label: 'Bold condensed', family: '"Anton", Impact, sans-serif', upper: true }
]

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
  if (look.look === 'floating') return null
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
