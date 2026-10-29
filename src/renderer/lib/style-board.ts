/**
 * The style board's choices and the engine's measurements it previews with.
 *
 * Every page keeps its own form fields (Create's draft, the Remix form, Edit
 * my recording's look); the board works on this one shape and each page maps
 * it to and from its fields, so request payloads stay as they were.
 */
import { CAPTION_PRESETS } from '../../shared/caption-presets'
import { DEFAULT_HANDLE_POSITION, HANDLE_POSITIONS, hasBrandMark, type BrandLook, type HandlePosition } from '../../shared/brand-kit'
import {
  DEFAULT_BRAND_COLOR, HEADLINE_FONTS, HEADLINE_LOOKS, HEADLINE_TEXT_BGS, isHexColor, setHideAfter, setTextBg,
  type HeadlineFont, type HeadlineHideAfter, type HeadlineLook, type HeadlineLookStyle, type HeadlineTextBg
} from '../../shared/headline-look'
import { LOOK_EXTRAS, LOOK_EXTRA_IDS, parseLookExtras, type LookExtraId } from '../../shared/look-extras'

/** The hook text choices: the engine's headline looks, plus Create's title card. */
export type HookChoice = HeadlineLookStyle | 'card'

export interface BoardStyle {
  captions: boolean
  captionPreset: string
  hook: HookChoice
  font: HeadlineFont
  /** The bar color for the brand-color look (#RRGGBB), and the brand-color text box. */
  color: string
  /** Floating text's background (a box behind each line); missing means none. */
  textBg?: HeadlineTextBg
  /** "Hide hook text": seconds in the hook text fades out; missing means never. A patch with the key set to undefined means never. */
  hideAfterS?: HeadlineHideAfter
  handle: boolean
  ctaId: string | null
  keyword: string
  offer: string
  /** Extras on top of the look (look-extras.ts), in app order. */
  extras: LookExtraId[]
}

export const HOOK_LABELS: Record<HookChoice, string> = {
  ...Object.fromEntries(HEADLINE_LOOKS.map((item) => [item.id, item.label])) as Record<HeadlineLookStyle, string>,
  card: 'Title card'
}
export const HOOK_HINTS: Record<HookChoice, string> = {
  ...Object.fromEntries(HEADLINE_LOOKS.map((item) => [item.id, item.hint])) as Record<HeadlineLookStyle, string>,
  card: 'A short title in a white card over the top of the video.'
}

/** Hook looks drawn as a bar above the video (the color only applies to the brand one). */
export const BAR_HOOKS: readonly HookChoice[] = ['white', 'black', 'brand']

/** A few bar colors that read well with white or black text. */
export const COLOR_PRESETS: readonly { id: string; name: string; color: string }[] = [
  { id: 'blue', name: 'Blue', color: DEFAULT_BRAND_COLOR },
  { id: 'violet', name: 'Violet', color: '#7C5CFF' },
  { id: 'red', name: 'Red', color: '#E5202E' },
  { id: 'orange', name: 'Orange', color: '#FF7A1A' },
  { id: 'yellow', name: 'Yellow', color: '#FFD60A' },
  { id: 'lime', name: 'Lime', color: '#C6FF3D' },
  { id: 'pink', name: 'Pink', color: '#FF2EC4' },
  { id: 'teal', name: 'Teal', color: '#0FB5AE' }
]

export interface CuratedCombo {
  id: string
  name: string
  captionPreset: string
  hook: 'white' | 'black' | 'brand' | 'floating'
  font: HeadlineFont
  color: string
  /** Floating text's box behind each line. */
  textBg?: HeadlineTextBg
}

/**
 * "Shuffle" only picks from these: each caption style is paired with a hook
 * look, font and color chosen to go with its own colors, so nothing clashes.
 */
export const CURATED_COMBOS: readonly CuratedCombo[] = [
  { id: 'classic', name: 'Classic', captionPreset: 'pop', hook: 'white', font: 'clean', color: '#FFE234' },
  { id: 'newsroom', name: 'Newsroom', captionPreset: 'headline', hook: 'black', font: 'condensed', color: '#E5202E' },
  { id: 'violet-pill', name: 'Violet pill', captionPreset: 'spotlight', hook: 'brand', font: 'clean', color: '#7C5CFF' },
  { id: 'big-impact', name: 'Big impact', captionPreset: 'impact', hook: 'black', font: 'condensed', color: '#FFD60A' },
  { id: 'storyteller', name: 'Storyteller', captionPreset: 'editorial', hook: 'white', font: 'serif', color: '#FFE6B8' },
  { id: 'tech-glow', name: 'Tech glow', captionPreset: 'glow', hook: 'floating', font: 'clean', color: '#00C8FF' },
  { id: 'night-neon', name: 'Night neon', captionPreset: 'neon', hook: 'brand', font: 'clean', color: '#FF2EC4' },
  { id: 'lime-punch', name: 'Lime punch', captionPreset: 'lime', hook: 'brand', font: 'condensed', color: '#C6FF3D' },
  { id: 'sunset-retro', name: 'Sunset retro', captionPreset: 'retro', hook: 'brand', font: 'serif', color: '#FF7A1A' },
  { id: 'clean-card', name: 'Clean card', captionPreset: 'paper', hook: 'white', font: 'serif', color: '#6D28D9' },
  { id: 'high-energy', name: 'High energy', captionPreset: 'hype', hook: 'black', font: 'condensed', color: '#39FF6A' },
  { id: 'old-print', name: 'Old print', captionPreset: 'vintage', hook: 'brand', font: 'serif', color: '#FFB547' },
  { id: 'hand-drawn', name: 'Hand-drawn', captionPreset: 'pop', hook: 'floating', font: 'marker', color: '#FFFFFF' },
  { id: 'magazine', name: 'Magazine', captionPreset: 'sweep', hook: 'black', font: 'sans_serif_accent', color: '#FFFFFF' },
  { id: 'reel-caption', name: 'Reel caption', captionPreset: 'subtle', hook: 'floating', font: 'clean', color: '#FFFFFF', textBg: 'dark' }
]

export function comboPatch(combo: CuratedCombo, hooks: readonly HookChoice[] = ['white', 'black', 'brand', 'floating']): Partial<BoardStyle> {
  return {
    captions: true, captionPreset: combo.captionPreset, font: combo.font, color: combo.color,
    // A page without that hook look (16:9 Create clips use a title card) keeps its own.
    ...(hooks.includes(combo.hook) ? { hook: combo.hook, textBg: combo.textBg ?? 'none' } : {})
  }
}

/** The curated combo the board currently shows, if any. */
export function matchingCombo(value: BoardStyle): CuratedCombo | null {
  return CURATED_COMBOS.find((combo) => value.captions && combo.captionPreset === value.captionPreset && combo.hook === value.hook
    && combo.font === value.font && (combo.hook !== 'brand' || combo.color.toUpperCase() === value.color.toUpperCase())
    && (combo.hook !== 'floating' || (combo.textBg ?? 'none') === (value.textBg ?? 'none'))) ?? null
}

/** A random curated combo, never the one already showing. */
export function shuffleCombo(value: BoardStyle, random: () => number = Math.random): CuratedCombo {
  const current = matchingCombo(value)
  const choices = CURATED_COMBOS.filter((combo) => combo !== current && !(value.captions && combo.captionPreset === value.captionPreset && combo.hook === value.hook))
  const pool = choices.length ? choices : CURATED_COMBOS
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

/** "Use my brand": what the brand kit sets, on top of the board's current choices. */
export function brandBoardPatch(look: BrandLook | undefined, value: BoardStyle, hooks: readonly HookChoice[]): Partial<BoardStyle> {
  if (!look) return {}
  const patch: Partial<BoardStyle> = {}
  if (look.headlineLook) {
    if (hooks.includes(look.headlineLook.look)) patch.hook = look.headlineLook.look
    patch.font = look.headlineLook.font
    if ((look.headlineLook.textBg ?? 'none') !== (value.textBg ?? 'none')) patch.textBg = look.headlineLook.textBg ?? 'none'
    patch.hideAfterS = look.headlineLook.hideAfterS

    patch.color = look.color ?? look.headlineLook.color
  } else if (look.color) patch.color = look.color
  if (look.captionPreset) { patch.captions = true; patch.captionPreset = look.captionPreset }
  if (look.ctaId) patch.ctaId = look.ctaId
  if (look.ctaKeyword) { patch.keyword = look.ctaKeyword; patch.offer = look.ctaOffer ?? '' }
  if (hasBrandMark(look)) patch.handle = true
  // Only what differs, so a brand already in use changes nothing.
  return Object.fromEntries(Object.entries(patch).filter(([key, next]) => value[key as keyof BoardStyle] !== next)) as Partial<BoardStyle>
}

/** Picking a hook look; the brand-color bar starts from the brand's color when the bar is still white. */
export function hookPatch(value: BoardStyle, hook: HookChoice, brandColor?: string): Partial<BoardStyle> {
  if (hook === 'brand' && (!isHexColor(value.color) || value.color.toUpperCase() === '#FFFFFF')) {
    return { hook, color: brandColor && isHexColor(brandColor) ? brandColor.toUpperCase() : DEFAULT_BRAND_COLOR }
  }
  return { hook }
}

/** Picking floating text's background; the brand-color box starts from the brand's color when the color is still white. */
export function textBgPatch(value: BoardStyle, textBg: HeadlineTextBg, brandColor?: string): Partial<BoardStyle> {
  if ((textBg === 'brand' || textBg === 'highlight') && (!isHexColor(value.color) || value.color.toUpperCase() === '#FFFFFF')) {
    return { textBg, color: brandColor && isHexColor(brandColor) ? brandColor.toUpperCase() : DEFAULT_BRAND_COLOR }
  }
  return { textBg }
}

export function textBgName(textBg: HeadlineTextBg | undefined): string {
  return HEADLINE_TEXT_BGS.find((item) => item.id === (textBg ?? 'none'))?.label ?? 'None'
}

/** Picking a color puts the hook text on a bar in that color (when the page offers one). */
export function colorPatch(color: string, hooks: readonly HookChoice[]): Partial<BoardStyle> {
  const clean = color.toUpperCase()
  return hooks.includes('brand') ? { color: clean, hook: 'brand' } : { color: clean }
}

export function captionName(id: string): string {
  return CAPTION_PRESETS.find((preset) => preset.id === id)?.name ?? 'Pop'
}

export function fontName(font: HeadlineFont): string {
  return HEADLINE_FONTS.find((item) => item.id === font)?.label ?? 'Clean'
}

export function colorName(color: string, brandColor?: string | null): string {
  const upper = color.toUpperCase()
  if (brandColor && brandColor.toUpperCase() === upper) return `Brand ${upper}`
  const preset = COLOR_PRESETS.find((item) => item.color.toUpperCase() === upper)
  return preset ? `${preset.name} ${upper}` : `Custom ${upper}`
}

/** Turns one extra on or off (the list stays in app order). */
export function toggleExtra(extras: readonly LookExtraId[], id: LookExtraId): LookExtraId[] {
  const next = new Set(extras)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return LOOK_EXTRA_IDS.filter((item) => next.has(item))
}

/** "Keyword pill, Progress bar" (or "None"). */
export function extrasName(extras: readonly LookExtraId[]): string {
  const names = LOOK_EXTRAS.filter((extra) => extras.includes(extra.id)).map((extra) => extra.label)
  return names.length ? names.join(', ') : 'None'
}

export function cornerName(position: HandlePosition | undefined): string {
  return HANDLE_POSITIONS.find((item) => item.id === (position ?? DEFAULT_HANDLE_POSITION))?.label ?? 'Bottom right'
}

/** Which rows a page shows. Captions are always there. */
export interface BoardRows {
  /** The hook text choices, in order; none for no hook row. */
  hooks?: readonly HookChoice[]
  handle?: boolean
  cta?: boolean
  keyword?: boolean
  /** The "Extras" row (pick as many as you like). */
  extras?: boolean
}

/** "Pop captions · White bar · Clean font · Handle top right · Ends with Free guide · Comment SALES" */
export function styleSummary(value: BoardStyle, rows: BoardRows, extra: { brandColor?: string | null; corner?: HandlePosition; hasMark?: boolean; ctaName?: string | null } = {}): string {
  const parts = [value.captions ? `${captionName(value.captionPreset)} captions` : 'No captions']
  if (rows.hooks?.length) {
    parts.push(HOOK_LABELS[value.hook])
    if (value.hook !== 'none' && value.hook !== 'card') parts.push(`${fontName(value.font)} font`)
    if (value.hook === 'brand') parts.push(colorName(value.color, extra.brandColor))
    if (value.hook === 'floating' && (value.textBg ?? 'none') !== 'none') {
      parts.push(value.textBg === 'brand' ? `${colorName(value.color, extra.brandColor)} box` : textBgName(value.textBg))
    }
    if (value.hook !== 'none' && value.hook !== 'card' && value.hideAfterS) parts.push(`Hides after ${value.hideAfterS} s`)
  }
  if (rows.handle && extra.hasMark) parts.push(value.handle ? `Handle ${cornerName(extra.corner).toLowerCase()}` : 'No handle')
  if (rows.cta) parts.push(value.ctaId ? `Ends with ${extra.ctaName ?? 'your CTA clip'}` : 'No CTA clip')
  if (rows.keyword && value.keyword.trim()) parts.push(`Comment ${value.keyword.trim()}`)
  if (rows.extras && value.extras.length) parts.push(`Extras: ${extrasName(value.extras)}`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// What the engine draws, as shares of a 1080×1920 frame (rendering_service,
// brand_mark and config.CaptionPreset). The preview scales these to its size.
// ---------------------------------------------------------------------------

/** Caption font sizes (ASS Fontsize at PlayResY 1920) and the planner's punch-word color per preset. */
export const ENGINE_CAPTIONS: Record<string, { size: number; emphasis: string | null; font: string }> = {
  pop: { size: 84, emphasis: '#3DFF8B', font: 'Montserrat-Black' },
  spotlight: { size: 80, emphasis: '#FFE234', font: 'Poppins-Black' },
  impact: { size: 124, emphasis: '#FF4D4D', font: 'Anton' },
  glow: { size: 80, emphasis: '#FF6BD6', font: 'Montserrat-ExtraBold' },
  boxed: { size: 70, emphasis: '#4ADE80', font: 'ArchivoBlack' },
  sweep: { size: 76, emphasis: '#FFE234', font: 'Poppins-ExtraBold' },
  editorial: { size: 112, emphasis: null, font: 'InstrumentSerif' },
  hype: { size: 88, emphasis: '#FFE234', font: 'Montserrat-Black' },
  punch: { size: 150, emphasis: '#FF3B30', font: 'Anton' },
  neon: { size: 78, emphasis: '#7DF9FF', font: 'Poppins-ExtraBold' },
  headline: { size: 72, emphasis: '#FFD23F', font: 'ArchivoBlack' },
  paper: { size: 68, emphasis: '#DB2777', font: 'Poppins-ExtraBold' },
  subtle: { size: 70, emphasis: null, font: 'Montserrat-ExtraBold' },
  beast: { size: 118, emphasis: '#FF3B3B', font: 'Bangers' },
  bubble: { size: 96, emphasis: '#FFE234', font: 'LilitaOne' },
  retro: { size: 80, emphasis: '#FFD23F', font: 'BowlbyOne' },
  lime: { size: 78, emphasis: '#C6FF3D', font: 'ArchivoBlack' },
  vintage: { size: 98, emphasis: '#FF6B4A', font: 'Fraunces72pt' },
  highlight_box: { size: 74, emphasis: null, font: 'Montserrat-ExtraBold' },
  serif_clean: { size: 104, emphasis: null, font: 'InstrumentSerif' }
}

/**
 * libass sizes a font so its Windows ascent + descent equals the ASS
 * Fontsize; a browser sizes the em. These are each bundled font's
 * (usWinAscent + usWinDescent) / unitsPerEm, so em = Fontsize / ratio.
 */
export const LIBASS_EM_RATIO: Record<string, number> = {
  'Montserrat-Black': 1.562, 'Montserrat-ExtraBold': 1.562, 'Poppins-Black': 1.762, 'Poppins-ExtraBold': 1.762,
  Anton: 1.733, ArchivoBlack: 1.347, InstrumentSerif: 1.3, Bangers: 1.757, LilitaOne: 1.143, BowlbyOne: 1.566, Fraunces72pt: 1.474
}

/** The caption's em size in 1080-wide pixels. */
export function captionEm(presetId: string): number {
  const engine = ENGINE_CAPTIONS[presetId] ?? ENGINE_CAPTIONS.pop
  return engine.size / (LIBASS_EM_RATIO[engine.font] ?? 1.5)
}

export const FRAME_W = 1080
export const FRAME_H = 1920
/** Headline bar (rendering_service HEADLINE_*). */
export const HEADLINE = { topSafe: 0.055, padY: 0.025, padX: 0.06, minH: 0.17, maxH: 0.30, fontSize: 60, condensedScale: 1.18, lineHeight: 1.22, maxLines: 3 }
/** Captions sit at 70% of the video panel (under a bar, HEADLINE_CAPTION_Y; full frame, 1340 / 1920). */
export const CAPTION_Y = 0.70
/** brand_mark: height, opacity, margin and safe lines. */
export const MARK = { height: 0.04, opacity: 0.70, margin: 0.037, topSafe: 0.06, bottomLine: 0.84, bottomLimit: 0.90, maxWidth: 0.42 }
/** "Comment KEYWORD": 44 px, under a bar by 6% or at 30% of the frame, for the last 4 seconds. */
export const KEYWORD_TAG = { size: 44, underBar: 0.06, top: 0.30 }

/** Where the handle goes (brand_mark.mark_position), in frame pixels. */
export function markPosition(position: HandlePosition, frameW: number, frameH: number, w: number, h: number,
  topFrom: number, captionsTo: number): { x: number; y: number } {
  const margin = Math.round(frameW * MARK.margin)
  const x = position.endsWith('left') ? margin : frameW - w - margin
  let y: number
  if (position.startsWith('top')) y = Math.max(Math.round(frameH * MARK.topSafe), topFrom + margin / 2)
  else {
    y = Math.max(Math.round(frameH * MARK.bottomLine) - h, captionsTo + margin / 2)
    y = Math.min(y, Math.round(frameH * MARK.bottomLimit) - h)
  }
  return { x: Math.max(0, x), y: Math.max(0, Math.min(frameH - h, y)) }
}

/** Where the captions end, for a bottom-corner handle (rendering_service._overlays). */
export function captionsBottom(frameH: number, barH: number, captions: boolean, unit: number): number {
  if (!captions) return 0
  return barH ? barH + Math.round((frameH - barH) * CAPTION_Y) + 110 * unit : Math.round(frameH * 0.78)
}

/** The board's hook choice from a headline look (a page without that look shows its fallback). */
export function hookFromLook(look: HeadlineLook, hooks: readonly HookChoice[]): HookChoice {
  return hooks.includes(look.look) ? look.look : hooks[0] ?? 'white'
}

/** The hook choices on Remix and Edit my recording (no title card there). */
export const LOOK_HOOKS: readonly HookChoice[] = ['white', 'black', 'brand', 'floating', 'none']

/** Forms that keep the look as a headline look (Remix, Edit my recording). */
export interface LookFields {
  includeCaptions: boolean
  captionPreset: string
  headlineLook: HeadlineLook
  showHandle: boolean
  ctaId?: string | null
  ctaKeyword?: string
  ctaOffer?: string
  lookExtras?: LookExtraId[]
}

export function boardFromLook(form: LookFields): BoardStyle {
  return {
    captions: form.includeCaptions, captionPreset: form.captionPreset, hook: hookFromLook(form.headlineLook, LOOK_HOOKS),
    font: form.headlineLook.font, color: form.headlineLook.color, ...(form.headlineLook.textBg ? { textBg: form.headlineLook.textBg } : {}),
    ...(form.headlineLook.hideAfterS ? { hideAfterS: form.headlineLook.hideAfterS } : {}), handle: form.showHandle,
    ctaId: form.ctaId ?? null, keyword: form.ctaKeyword ?? '', offer: form.ctaOffer ?? '', extras: parseLookExtras(form.lookExtras)
  }
}

/** A board change as the form's own fields. */
export function lookPatch(form: LookFields, patch: Partial<BoardStyle>): Partial<LookFields> {
  const out: Partial<LookFields> = {}
  if (patch.captions !== undefined) out.includeCaptions = patch.captions
  if (patch.captionPreset !== undefined) out.captionPreset = patch.captionPreset
  if ((patch.hook && patch.hook !== 'card') || patch.font || patch.color || patch.textBg || 'hideAfterS' in patch) {
    out.headlineLook = withHideAfterPatch(withTextBg({
      ...form.headlineLook,
      ...(patch.hook && patch.hook !== 'card' ? { look: patch.hook } : {}),
      ...(patch.font ? { font: patch.font } : {}),
      ...(patch.color ? { color: patch.color } : {})
    }, patch.textBg), patch)
  }
  if (patch.handle !== undefined) out.showHandle = patch.handle
  if (patch.ctaId !== undefined) out.ctaId = patch.ctaId
  if (patch.keyword !== undefined) out.ctaKeyword = patch.keyword
  if (patch.offer !== undefined) out.ctaOffer = patch.offer
  if (patch.extras !== undefined) out.lookExtras = [...patch.extras]
  return out
}

/** A headline look with the board's text background (none is left out, as parseHeadlineLook does). */
export function withTextBg(look: HeadlineLook, textBg: HeadlineTextBg | undefined): HeadlineLook {
  return textBg === undefined ? look : setTextBg(look, textBg)
}

/** A headline look with the board's "Hide hook text" when the patch has it (the key set to undefined: never). */
export function withHideAfterPatch(look: HeadlineLook, patch: Partial<BoardStyle>): HeadlineLook {
  return 'hideAfterS' in patch ? setHideAfter(look, patch.hideAfterS) : look
}
