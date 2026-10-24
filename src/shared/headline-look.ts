/**
 * How the hook text (headline) at the top of a 9:16 video looks: a bar in
 * white (the original look), black or a brand color, or floating text over the
 * video with no bar; and its font. The engine draws it (rendering_service.HeadlineLook).
 */
export type HeadlineLookStyle = 'white' | 'black' | 'brand' | 'floating' | 'none'
export type HeadlineFont = 'clean' | 'serif' | 'condensed' | 'marker' | 'sans_serif_accent'

/**
 * Floating text's background: none (outlined text) or a snug rounded box behind each line, Instagram style; or
 * 'highlight': big bold words on a white box with the key words (the last ones) in an italic serif on a box in the color
 * (the look of the references' hooks; highlightLayout).
 */
export type HeadlineTextBg = 'none' | 'dark' | 'light' | 'brand' | 'highlight'

export interface HeadlineLook {
  look: HeadlineLookStyle
  /** The bar color for the brand look (and the brand-color text box), as #RRGGBB. */
  color: string
  font: HeadlineFont
  /** Floating text only (ignored for the other looks): a box behind each line. Missing means 'none'. */
  textBg?: HeadlineTextBg
  /** "Hide hook text": seconds into the video the text fades out (a bar stays as a plain band). Missing: the whole video. */
  hideAfterS?: HeadlineHideAfter
}

/** The "Hide hook text" choices, in seconds (the engine's HEADLINE_HIDE_AFTER_S). */
export const HEADLINE_HIDE_AFTER_S = [3, 5, 8, 10, 15] as const
export type HeadlineHideAfter = typeof HEADLINE_HIDE_AFTER_S[number]
/** How long the text takes to fade out (the engine's HEADLINE_HIDE_FADE_S). */
export const HEADLINE_HIDE_FADE_S = 0.3

export function isHeadlineHideAfter(value: unknown): value is HeadlineHideAfter {
  return typeof value === 'number' && (HEADLINE_HIDE_AFTER_S as readonly number[]).includes(value)
}

export const DEFAULT_HEADLINE_LOOK: HeadlineLook = { look: 'white', color: '#FFFFFF', font: 'clean' }
export const DEFAULT_BRAND_COLOR = '#2563EB'

export const HEADLINE_LOOKS: readonly { id: HeadlineLookStyle; label: string; hint: string }[] = [
  { id: 'white', label: 'White bar', hint: 'Black text on a white bar. The original look.' },
  { id: 'black', label: 'Black bar', hint: 'White text on a black bar.' },
  { id: 'brand', label: 'Brand color', hint: 'A bar in your color; the text turns black or white to stay readable.' },
  { id: 'floating', label: 'Floating text', hint: 'No bar: the text sits over the top of the video, outlined or on a box.' },
  { id: 'none', label: 'No hook text', hint: 'Nothing at the top: the video fills the frame.' }
]

export const HEADLINE_TEXT_BGS: readonly { id: HeadlineTextBg; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Outlined white text right on the video.' },
  { id: 'dark', label: 'Dark box', hint: 'White text on a black box behind each line, so it stands out on busy video.' },
  { id: 'light', label: 'Light box', hint: 'Black text on a white box behind each line.' },
  { id: 'brand', label: 'Brand color', hint: 'A box in your color behind each line; the text turns black or white to stay readable.' },
  { id: 'highlight', label: 'Key words in color', hint: 'Big bold words on a white box, the last few words in italic on a box in your color.' }
]

/** The text box against the font size (the engine's TEXT_BOX_*): padding left and right, corner radius, the dark box's opacity. */
export const TEXT_BOX = { padX: 0.32, radius: 0.25, darkOpacity: 0.9 }

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

/** The text background in use: floating text's box, else 'none'. */
export function headlineTextBg(look: Pick<HeadlineLook, 'look' | 'textBg'>): HeadlineTextBg {
  return look.look === 'floating' && look.textBg && HEADLINE_TEXT_BGS.some((item) => item.id === look.textBg) ? look.textBg : 'none'
}

/** The box behind each line of floating text, or null for outlined text (matches the engine's HeadlineLook.box). */
export function headlineTextBox(look: HeadlineLook): { color: string; opacity: number } | null {
  const bg = headlineTextBg(look)
  if (bg === 'none') return null
  if (bg === 'dark') return { color: '#000000', opacity: TEXT_BOX.darkOpacity }
  if (bg === 'light' || bg === 'highlight') return { color: '#FFFFFF', opacity: 1 }
  return { color: isHexColor(look.color) ? look.color.toUpperCase() : DEFAULT_BRAND_COLOR, opacity: 1 }
}

function contrastText(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#000000' : '#FFFFFF'
}

/** Black or white text, whichever reads on this bar or text box color (matches the engine). */
export function headlineTextColor(look: HeadlineLook): string {
  if (look.look === 'floating') {
    const box = headlineTextBox(look)
    return box ? contrastText(box.color) : '#FFFFFF'
  }
  if (look.look === 'black') return '#FFFFFF'
  if (look.look === 'white') return '#000000'
  return contrastText(look.color)
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
  if (Object.keys(raw).some((key) => !['look', 'color', 'font', 'textBg', 'hideAfterS'].includes(key))) throw new Error('Invalid headline look')
  if (raw.hideAfterS !== undefined && !isHeadlineHideAfter(raw.hideAfterS)) throw new Error('Invalid headline look')
  const look = raw.look ?? 'white'
  const font = raw.font ?? 'clean'
  const color = raw.color ?? '#FFFFFF'
  const textBg = raw.textBg ?? 'none'
  if (!HEADLINE_LOOKS.some((item) => item.id === look) || !HEADLINE_FONTS.some((item) => item.id === font) || !isHexColor(color)
    || !HEADLINE_TEXT_BGS.some((item) => item.id === textBg)) {
    throw new Error('Invalid headline look')
  }
  // 'none' and "never hide" are left out, so looks made before them read and compare the same.
  return withHideAfter({ look: look as HeadlineLookStyle, color: color.toUpperCase(), font: font as HeadlineFont, ...(textBg !== 'none' ? { textBg: textBg as HeadlineTextBg } : {}) },
    raw.hideAfterS as HeadlineHideAfter | undefined)
}

/** The look with this text background ('none' is left out, as parseHeadlineLook leaves it out). Keeps its "hide after". */
export function setTextBg(look: HeadlineLook, textBg: HeadlineTextBg): HeadlineLook {
  const out: HeadlineLook = { look: look.look, color: look.color, font: look.font, ...(textBg !== 'none' ? { textBg } : {}) }
  return withHideAfter(out, look.hideAfterS)
}

/** The look with this "hide after" (undefined, or an unknown value: shown the whole video, and left out). */
export function setHideAfter(look: HeadlineLook, hideAfterS: number | undefined): HeadlineLook {
  const rest: HeadlineLook = { look: look.look, color: look.color, font: look.font, ...(look.textBg !== undefined ? { textBg: look.textBg } : {}) }
  return withHideAfter(rest, hideAfterS)
}

function withHideAfter(look: HeadlineLook, hideAfterS: number | undefined): HeadlineLook {
  return isHeadlineHideAfter(hideAfterS) ? { ...look, hideAfterS } : look
}

/** The chat tools' set_hook_look parameters beyond look, font and color (snake case, as the tools take them). */
export const HOOK_LOOK_TOOL_PROPERTIES = {
  text_bg: { type: 'string', enum: HEADLINE_TEXT_BGS.map((item) => item.id), description: 'Floating text only: a box behind each line (none, dark, light, or brand: the color).' },
  hide_after_s: { type: 'integer', enum: [0, ...HEADLINE_HIDE_AFTER_S], description: 'Fade the hook text out this many seconds in (a bar stays as a plain band). 0: show it the whole video.' }
} as const

/**
 * A chat tool's set_hook_look arguments over the current look: look, font, color, text_bg and
 * hide_after_s (0 or null: the whole video). Throws on anything unknown (parseHeadlineLook).
 */
export function applyHookLookArgs(current: HeadlineLook, args: Record<string, unknown>): HeadlineLook {
  const next: Record<string, unknown> = { ...current }
  for (const key of ['look', 'color', 'font'] as const) if (args[key] !== undefined) next[key] = args[key]
  if (args.text_bg !== undefined) next.textBg = args.text_bg
  if (args.hide_after_s !== undefined) {
    if (args.hide_after_s === 0 || args.hide_after_s === null) delete next.hideAfterS
    else next.hideAfterS = args.hide_after_s
  }
  return parseHeadlineLook(next)
}

/** "hides after 10 s" / "" for the chat tools' replies. */
export function hideAfterLabel(look: Pick<HeadlineLook, 'hideAfterS'>): string {
  return look.hideAfterS ? `hides after ${look.hideAfterS} s` : ''
}

/** Whether the hook text shows at this time (seconds on the output clock): previews with a playhead hide it after the time. */
export function headlineShownAt(look: Pick<HeadlineLook, 'hideAfterS'> | undefined, t: number): boolean {
  return !look?.hideAfterS || t < look.hideAfterS
}

/** What the engine needs: nothing for the default look, so older runs are unchanged; the text box only with floating text. */
export function headlineLookForEngine(look: HeadlineLook | undefined): HeadlineLook | undefined {
  if (!look) return undefined
  if (look.look === 'white' && look.font === 'clean' && look.hideAfterS === undefined) return undefined
  if (look.textBg === undefined) return look
  return setTextBg(look, look.look === 'floating' ? look.textBg : 'none')
}

// ---------------------------------------------------------------------------
// Floating text on a box: where the lines go and the outline around their boxes
// (rendering_service._headline_bar_image and text_box_outline). The previews draw with these.
// ---------------------------------------------------------------------------

/** The engine's sizes for the hook text (HEADLINE_FONT_SIZES at a 1080x1920 frame), largest first. */
export const HEADLINE_FONT_SIZES = [60, 54, 48, 42]
export const HEADLINE_MAX_LINES = 3

/** Greedy word wrap to maxWidth (rendering_service._headline_lines). */
export function headlineLines(text: string, measure: (line: string) => number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = lines.length ? `${lines[lines.length - 1]} ${word}` : word
    if (lines.length && measure(trial) <= maxWidth) lines[lines.length - 1] = trial
    else lines.push(word)
  }
  return lines
}

/**
 * The engine's wrap: the biggest size that fits in three lines, then the
 * narrowest wrap with the same number of lines (no lone last word).
 * `measure(line, size)` is the line's width at that font size.
 */
export function wrapHeadline(text: string, measure: (line: string, size: number) => number, maxWidth: number,
  sizes: readonly number[] = HEADLINE_FONT_SIZES): { size: number; lines: string[] } {
  let size = sizes[sizes.length - 1]
  let lines: string[] = []
  for (const candidate of sizes) {
    size = candidate
    const at = (line: string): number => measure(line, candidate)
    lines = headlineLines(text, at, maxWidth)
    if (lines.length <= HEADLINE_MAX_LINES) {
      let width = maxWidth
      while (lines.length > 1 && width > Math.floor(maxWidth / 2)) {
        const narrower = headlineLines(text, at, width - 20)
        if (narrower.length !== lines.length) break
        lines = narrower
        width -= 20
      }
      break
    }
  }
  return { size, lines: lines.slice(0, HEADLINE_MAX_LINES) }
}

/** One line's box: left, top, right, bottom. */
export type TextBoxRect = [number, number, number, number]

/**
 * The outline around per-line boxes stacked edge to edge (Instagram's text
 * background), as corners with their radius, clockwise from the top left.
 * Lines within `snap` of their neighbor's width take the wider one. Mirrors
 * the engine's text_box_outline.
 */
export function textBoxOutline(boxes: readonly TextBoxRect[], radius: number, snap = 0): [number, number, number][] {
  if (!boxes.length) return []
  const rows = boxes.map((box) => [...box] as TextBoxRect)
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i]
    if (Math.abs((a[2] - a[0]) - (b[2] - b[0])) < snap) {
      const left = Math.min(a[0], b[0]), right = Math.max(a[2], b[2])
      a[0] = b[0] = left
      a[2] = b[2] = right
    }
  }
  const last = rows[rows.length - 1]
  const points: [number, number][] = [[rows[0][0], rows[0][1]], [rows[0][2], rows[0][1]]]
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i + 1][2] !== rows[i][2]) points.push([rows[i][2], rows[i][3]], [rows[i + 1][2], rows[i][3]])
  }
  points.push([last[2], last[3]], [last[0], last[3]])
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i - 1][0] !== rows[i][0]) points.push([rows[i][0], rows[i][1]], [rows[i - 1][0], rows[i][1]])
  }
  return points.map(([x, y], i) => {
    const [px, py] = points[(i - 1 + points.length) % points.length]
    const [nx, ny] = points[(i + 1) % points.length]
    return [x, y, Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2)]
  })
}

/** The outline as an SVG path (or a canvas Path2D): each corner a quadratic curve, as the engine samples it. */
export function textBoxPath(outline: readonly [number, number, number][]): string {
  if (!outline.length) return ''
  const n = (v: number): string => (Math.round(v * 100) / 100).toString()
  const ends = outline.map(([x, y, r], i) => {
    const [px, py] = outline[(i - 1 + outline.length) % outline.length]
    const [nx, ny] = outline[(i + 1) % outline.length]
    const din = Math.hypot(x - px, y - py) || 1, dout = Math.hypot(nx - x, ny - y) || 1
    return { start: [x + (px - x) / din * r, y + (py - y) / din * r], end: [x + (nx - x) / dout * r, y + (ny - y) / dout * r], x, y }
  })
  return `M${n(ends[0].start[0])} ${n(ends[0].start[1])}` + ends.map((c, i) => `${i ? `L${n(c.start[0])} ${n(c.start[1])}` : ''}Q${n(c.x)} ${n(c.y)} ${n(c.end[0])} ${n(c.end[1])}`).join('') + 'Z'
}

/**
 * The boxes behind each line, the way the engine places them: the line's
 * width plus padding, one line tall, centered on the line. `centers` are each
 * line's middle; `widths` its text width.
 */
export function textBoxRects(widths: readonly number[], centers: readonly number[], lineHeight: number, frameWidth: number, fontSize: number): TextBoxRect[] {
  const pad = fontSize * TEXT_BOX.padX
  return widths.map((width, i) => [(frameWidth - width) / 2 - pad, centers[i] - lineHeight / 2, (frameWidth + width) / 2 + pad, centers[i] + lineHeight / 2])
}


// ---------------------------------------------------------------------------
// 'Key words in color' (textBg 'highlight'): the lead words big and bold on a white box, the key words (the last third)
// in the italic serif on a box in the color. The engine draws the same (rendering_service._highlight_headline).
// ---------------------------------------------------------------------------

/** Sizes (px on a 1920-tall frame) tried largest first; the key words are drawn `phraseScale` times bigger in the serif. */
export const HIGHLIGHT = { sizes: [104, 96, 90, 84, 78, 72, 66, 60], phraseScale: 1.2, leadLine: 1.2, phraseLine: 1.06, gap: .1, padX: .06 } as const
/* (leadLine: the lead lines' height against the size; phraseLine: the key words' against their own, bigger, size.) */
/** The key words' italic serif. */
export const HIGHLIGHT_PHRASE_FAMILY = '"Instrument Serif", Georgia, serif'

/** The hook text split into its lead words and its key words (the last third, one to four words). */
export function highlightSplit(text: string): { lead: string; phrase: string } {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2) return { lead: '', phrase: words.join(' ') }
  const k = Math.min(4, Math.max(1, Math.round(words.length / 3)))
  return { lead: words.slice(0, words.length - k).join(' '), phrase: words.slice(words.length - k).join(' ') }
}

/** The narrowest wrap with the same number of lines (no lone last word), as wrapHeadline balances. */
function balanced(text: string, measure: (line: string) => number, maxWidth: number): string[] {
  let lines = headlineLines(text, measure, maxWidth)
  let width = maxWidth
  while (lines.length > 1 && width > Math.floor(maxWidth / 2)) {
    const narrower = headlineLines(text, measure, width - 20)
    if (narrower.length !== lines.length) break
    lines = narrower
    width -= 20
  }
  return lines
}

/**
 * Where the 'Key words in color' hook goes: the biggest size (HIGHLIGHT.sizes, times `scale`) at which the lead words take
 * at most two lines, the key words at most two, three in all; each wrapped narrowest. `measure(line, size, phrase)` is
 * the line's width at that size in its face (the key words at size × phraseScale in the serif).
 */
export function highlightLayout(text: string, measure: (line: string, size: number, phrase: boolean) => number, maxWidth: number, scale = 1):
  { size: number; lead: string[]; phrase: string[] } {
  const { lead, phrase } = highlightSplit(text)
  let out = { size: HIGHLIGHT.sizes[HIGHLIGHT.sizes.length - 1] * scale, lead: [] as string[], phrase: [] as string[] }
  for (const base of HIGHLIGHT.sizes) {
    const size = base * scale
    const a = lead ? balanced(lead, (line) => measure(line, size, false), maxWidth) : []
    const b = phrase ? balanced(phrase, (line) => measure(line, size, true), maxWidth) : []
    out = { size, lead: a, phrase: b }
    if (a.length <= 2 && b.length <= 2 && a.length + b.length <= 3) break
  }
  return out
}

/** The 'Key words in color' boxes: white with near-black words; the key words' box in the color (white when the color is white or near it: the default blue), its words black or white to stay readable. */
export function highlightColors(look: Pick<HeadlineLook, 'color'>): { leadBg: string; leadInk: string; phraseBg: string; phraseInk: string } {
  const raw = isHexColor(look.color) ? look.color.toUpperCase() : DEFAULT_BRAND_COLOR
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(raw.slice(i, i + 2), 16))
  const phraseBg = 0.2126 * r + 0.7152 * g + 0.0722 * b > 225 ? DEFAULT_BRAND_COLOR : raw
  return { leadBg: '#FFFFFF', leadInk: '#0F172A', phraseBg, phraseInk: contrastText(phraseBg) }
}

/**
 * The 'Key words in color' hook placed on a frame (px): the size, each line's text, middle and width, which lines are
 * key words, and the two groups' box outlines (as SVG/Path2D paths). Line widths come from `measure`.
 */
export function highlightPlacement(text: string, measure: (line: string, size: number, phrase: boolean) => number, frameW: number, frameH: number, scale = 1): {
  size: number; lines: { text: string; phrase: boolean; center: number; width: number; height: number }[]; leadPath: string; phrasePath: string; height: number
} {
  const maxW = frameW - 2 * Math.round(frameW * HIGHLIGHT.padX)
  const { size, lead, phrase } = highlightLayout(text, measure, maxW, scale)
  const leadH = Math.round(size * HIGHLIGHT.leadLine), phraseSize = size * HIGHLIGHT.phraseScale, phraseH = Math.round(phraseSize * HIGHLIGHT.phraseLine)
  let y = Math.round(frameH * 0.055)
  const lines: { text: string; phrase: boolean; center: number; width: number; height: number }[] = []
  for (const line of lead) { lines.push({ text: line, phrase: false, center: y + leadH / 2, width: measure(line, size, false), height: leadH }); y += leadH }
  if (lead.length && phrase.length) y += Math.round(size * HIGHLIGHT.gap)
  for (const line of phrase) { lines.push({ text: line, phrase: true, center: y + phraseH / 2, width: measure(line, size, true), height: phraseH }); y += phraseH }
  const path = (group: typeof lines, fontSize: number): string => group.length
    ? textBoxPath(textBoxOutline(textBoxRects(group.map((l) => l.width), group.map((l) => l.center), group[0].height, frameW, fontSize), fontSize * TEXT_BOX.radius, fontSize * TEXT_BOX.radius))
    : ''
  return { size, lines, leadPath: path(lines.filter((l) => !l.phrase), size), phrasePath: path(lines.filter((l) => l.phrase), phraseSize), height: y + Math.round(size * .3) }
}
