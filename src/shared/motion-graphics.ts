/**
 * Motion graphics: short animated cards (stat counter, title slam, list…) placed
 * on a clip's timeline. This file is the contract shared by the template
 * renderer, the clip editor's Graphics row, the editor chat and the engine that
 * layers the rendered graphics over the video. Templates are our own designs;
 * the words in a graphic come from the member or from what was said in the clip.
 */

export const GRAPHIC_TEMPLATES = [
  { id: 'stat', label: 'Stat counter', detail: 'A number that counts up, with a short label.', fields: ['value', 'label'] },
  { id: 'title', label: 'Title slam', detail: 'A few big words that slam in.', fields: ['text'] },
  { id: 'list', label: 'Numbered list', detail: 'Up to 5 short points, one after another.', fields: ['title', 'items'] },
  { id: 'lower_third', label: 'Name tag', detail: 'A name and a role along the bottom.', fields: ['name', 'role'] },
  { id: 'logo', label: 'Logo pop', detail: 'An image you add pops in.', fields: ['image', 'caption'] },
  { id: 'before_after', label: 'Before / after', detail: 'Two short lines side by side.', fields: ['before', 'after'] },
  { id: 'checklist', label: 'Checklist', detail: 'Up to 5 items that tick off.', fields: ['title', 'items'] },
  { id: 'quote', label: 'Quote card', detail: 'A short quote and who said it.', fields: ['text', 'author'] },
  { id: 'highlight', label: 'Arrow or circle', detail: 'Points at something on screen.', fields: ['shape', 'x', 'y'] },
  { id: 'statement', label: 'Statement', detail: 'One or two lines in big serif type, with the key words in italics.', fields: ['text', 'accent', 'subline'] },
  { id: 'sticky_notes', label: 'Sticky notes', detail: 'Two or three short notes that drop in.', fields: ['items'] },
  { id: 'strike_list', label: 'Crossed-out list', detail: 'Up to 4 items crossed out one by one, then the better choice.', fields: ['items', 'final', 'accent'] },
  { id: 'browser_frame', label: 'Browser window', detail: 'A screenshot (or a short headline) in a browser window.', fields: ['domain', 'image', 'title', 'accent', 'subline', 'highlights'] },
  { id: 'icon_pop', label: 'Icon row', detail: 'Up to 4 icons that pop in one by one, with labels.', fields: ['items', 'icons', 'image'] },
  { id: 'headline_pill', label: 'Headline', detail: 'Two lines: a bold line, then the key words on a color box.', fields: ['text', 'phrase'] },
  { id: 'comment_cta', label: 'Comment prompt', detail: '“Comment” over the keyword people should comment.', fields: ['keyword', 'lead'] },
  { id: 'big_words', label: 'Big words (behind you)', detail: '1 to 3 huge words placed in the scene, behind your head.', fields: ['text', 'style', 'vertical', 'motion'] }
] as const

export type GraphicTemplateId = (typeof GRAPHIC_TEMPLATES)[number]['id']
export const GRAPHIC_TEMPLATE_IDS: readonly GraphicTemplateId[] = GRAPHIC_TEMPLATES.map((t) => t.id)
export type GraphicPlacement = 'top' | 'middle' | 'bottom'
export const GRAPHIC_PLACEMENTS: readonly GraphicPlacement[] = ['top', 'middle', 'bottom']
/**
 * How big a graphic is drawn. `compact`: a smaller card in its band; `card`
 * (the default, also when unset): a card in its band; `stage`: the card takes
 * the top ~53% of a 9:16 frame (the "stage" over the speaker), whatever the
 * placement.
 */
export type GraphicSize = 'compact' | 'card' | 'stage'
export const GRAPHIC_SIZES: readonly GraphicSize[] = ['compact', 'card', 'stage']
export function isGraphicSize(value: unknown): value is GraphicSize {
  return typeof value === 'string' && (GRAPHIC_SIZES as readonly string[]).includes(value)
}

/**
 * Where a graphic sits in depth. `front` (the default, also when unset): over
 * the video. `behind`: in the scene, behind the speaker (the engine lays the
 * speaker, cut out of the same frames, back on top while it plays). Only the
 * templates in GRAPHIC_DEPTH_TEMPLATES can go behind.
 */
export type GraphicDepth = 'front' | 'behind'
export const GRAPHIC_DEPTHS: readonly GraphicDepth[] = ['front', 'behind']
export function isGraphicDepth(value: unknown): value is GraphicDepth {
  return value === 'front' || value === 'behind'
}
/** Templates that can sit behind the speaker (big words and big type; Big words starts there). */
export const GRAPHIC_DEPTH_TEMPLATES: readonly string[] = ['big_words', 'title', 'statement', 'headline_pill']
export function graphicCanGoBehind(template: string): boolean { return GRAPHIC_DEPTH_TEMPLATES.includes(template) }
/** A graphic's depth: its own when its template can go behind, else front. */
export function graphicDepth(g: { template: string; depth?: GraphicDepth }): GraphicDepth {
  return g.depth === 'behind' && graphicCanGoBehind(g.template) ? 'behind' : 'front'
}

/** One graphic on a clip. Times are SOURCE time (like the clip's ranges), so it stays on its words when the cut changes. */
export interface EditorGraphic {
  id: string
  template: GraphicTemplateId
  at_ms: number
  duration_ms: number
  placement: GraphicPlacement
  /** Template fields: text values; `items` is newline-separated; `image` is a run-relative file name; x/y are 0..1 as text. */
  fields: Record<string, string>
  /** Who added it: the member, the automatic pass or the chat. */
  origin?: 'member' | 'auto' | 'chat'
  /** How big it is drawn (unset: 'card', as before sizes existed). */
  size?: GraphicSize
  /** In front of the speaker (unset) or behind them (see GraphicDepth). */
  depth?: GraphicDepth
}

export const MAX_GRAPHICS_PER_CLIP = 12
export const GRAPHIC_MIN_MS = 800
export const GRAPHIC_MAX_MS = 8000
export const MAX_GRAPHIC_FIELD_CHARS = 160

export function isGraphicTemplate(value: unknown): value is GraphicTemplateId {
  return typeof value === 'string' && (GRAPHIC_TEMPLATE_IDS as readonly string[]).includes(value)
}

/** Validates untrusted graphics (throws on anything malformed). */
export function parseGraphics(value: unknown): EditorGraphic[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_GRAPHICS_PER_CLIP) throw new Error(`Add up to ${MAX_GRAPHICS_PER_CLIP} graphics to a clip.`)
  const seen = new Set<string>()
  return value.map((raw): EditorGraphic => {
    if (!raw || typeof raw !== 'object') throw new Error('A graphic is malformed.')
    const g = raw as Record<string, unknown>
    if (typeof g.id !== 'string' || !/^[a-z0-9-]{4,40}$/.test(g.id) || seen.has(g.id)) throw new Error('A graphic is malformed.')
    seen.add(g.id)
    if (!isGraphicTemplate(g.template)) throw new Error('Choose one of the graphic templates.')
    if (typeof g.at_ms !== 'number' || !Number.isFinite(g.at_ms) || g.at_ms < 0) throw new Error('A graphic needs a start time.')
    if (typeof g.duration_ms !== 'number' || !Number.isFinite(g.duration_ms) || g.duration_ms < GRAPHIC_MIN_MS || g.duration_ms > GRAPHIC_MAX_MS) throw new Error('A graphic lasts between 0.8 and 8 seconds.')
    const placement = (GRAPHIC_PLACEMENTS as readonly unknown[]).includes(g.placement) ? g.placement as GraphicPlacement : 'middle'
    const fields: Record<string, string> = {}
    if (g.fields && typeof g.fields === 'object') {
      for (const [key, text] of Object.entries(g.fields as Record<string, unknown>)) {
        if (!/^[a-z_]{1,20}$/.test(key) || typeof text !== 'string') continue
        fields[key] = text.slice(0, key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS)
      }
    }
    if (fields.image !== undefined && !/^[A-Za-z0-9._-]{1,80}$/.test(fields.image)) throw new Error('A graphic’s image must be one of the clip’s images.')
    const origin: EditorGraphic['origin'] = g.origin === 'auto' || g.origin === 'chat' || g.origin === 'member' ? g.origin : undefined
    const size = isGraphicSize(g.size) ? g.size : undefined
    const depth = isGraphicDepth(g.depth) && graphicCanGoBehind(g.template) ? g.depth : undefined
    return { id: g.id, template: g.template, at_ms: Math.round(g.at_ms), duration_ms: Math.round(g.duration_ms), placement, fields, ...(origin ? { origin } : {}), ...(size ? { size } : {}), ...(depth ? { depth } : {}) }
  }).sort((a, b) => a.at_ms - b.at_ms)
}

// ---------------------------------------------------------------------------
// Helpers shared by the editor (Graphics row, inspector, chat) and main.
// ---------------------------------------------------------------------------

/** Bump when a template's look changes, so cached renders are made again. */
export const GRAPHICS_VERSION = 2
/** Rendered graphics are layered over the clip at this frame rate. */
export const GRAPHIC_FPS = 30
/** A graphic left with less than this much on screen after the cut is dropped. */
export const GRAPHIC_MIN_OUTPUT_MS = 400
export const MAX_GRAPHIC_ITEMS = 5
export type GraphicHighlightShape = 'circle' | 'arrow'

/** How long a new graphic of each kind lasts (ms). */
export const GRAPHIC_DEFAULT_MS: Record<GraphicTemplateId, number> = {
  stat: 3500, title: 2500, list: 5000, lower_third: 4000, logo: 3000, before_after: 4000, checklist: 5000, quote: 5000, highlight: 2500,
  statement: 3500, sticky_notes: 4000, strike_list: 5000, browser_frame: 5000, icon_pop: 3500, headline_pill: 3500, comment_cta: 3500,
  big_words: 2500
}

/** Templates that can show a picture the member chose (Logo pop needs one; the others draw without it). */
export const GRAPHIC_IMAGE_TEMPLATES: readonly GraphicTemplateId[] = ['logo', 'browser_frame', 'icon_pop']
export function graphicUsesImage(template: GraphicTemplateId): boolean { return GRAPHIC_IMAGE_TEMPLATES.includes(template) }

/** Most items a template shows (the rest of `items` is left out). */
export const GRAPHIC_ITEM_LIMITS: Partial<Record<GraphicTemplateId, number>> = { sticky_notes: 3, strike_list: 4, icon_pop: 4 }

/**
 * Generic icons the Icon row can draw (Lucide, ISC license, vendored in
 * src/renderer/graphics/icons.ts). `icons` holds one of these names per item,
 * one per line; brand logos are never drawn (the member adds their own image).
 */
export const GRAPHIC_ICONS = [
  'globe', 'mail', 'message', 'video', 'camera', 'mic', 'phone', 'laptop', 'code', 'terminal', 'database', 'file', 'search', 'link',
  'chart', 'trending', 'dollar', 'users', 'user', 'calendar', 'clock', 'check', 'zap', 'rocket', 'sparkles', 'star', 'heart',
  'cart', 'card', 'lock', 'settings', 'bot', 'brain', 'book', 'target', 'idea', 'play', 'image', 'dashboard', 'megaphone', 'gift', 'trophy'
] as const
export type GraphicIcon = (typeof GRAPHIC_ICONS)[number]
export function isGraphicIcon(value: unknown): value is GraphicIcon {
  return typeof value === 'string' && (GRAPHIC_ICONS as readonly string[]).includes(value)
}

/** What a template draws, as handed to the template page (live preview and offscreen render). */
export interface GraphicRenderSpec {
  template: GraphicTemplateId
  fields: Record<string, string>
  /** Output frame size in pixels. */
  width: number
  height: number
  /** On-screen length in OUTPUT time (after the cut and the export speed). */
  duration_ms: number
  /** The band the graphic sits in, as fractions of the output height (it never covers the hook or the captions). */
  box: { top: number; bottom: number }
  placement: GraphicPlacement
  /** Brand color #RRGGBB. */
  color: string
  /** The hook's font id (headline-look HEADLINE_FONTS). */
  font: string
  /** Logo image as a URL the page may load (a local-file URL in the editor, a data URL offscreen). */
  image?: string
  /** How big it is drawn (unset: 'card'). */
  size?: GraphicSize
}

export function templateInfo(id: GraphicTemplateId): (typeof GRAPHIC_TEMPLATES)[number] {
  return GRAPHIC_TEMPLATES.find((t) => t.id === id) ?? GRAPHIC_TEMPLATES[0]
}

/** A list field's lines: trimmed, non-empty, at most 5 (or `limit`). */
export function graphicItems(text: string | undefined, limit = MAX_GRAPHIC_ITEMS): string[] {
  return (text ?? '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, Math.min(limit, MAX_GRAPHIC_ITEMS))
}

/** A template's items, at most its own limit (Sticky notes 3, Crossed-out list and Icon row 4, others 5). */
export function templateItems(template: GraphicTemplateId, text: string | undefined): string[] {
  return graphicItems(text, GRAPHIC_ITEM_LIMITS[template] ?? MAX_GRAPHIC_ITEMS)
}

/**
 * The words of `text` and which of them are the accent (drawn in italics):
 * the words of `accent` where they appear in `text` (any case, punctuation
 * around them kept), else the last word. `breaks`: where a line break was
 * typed (the index of each word that starts a new line).
 */
export function accentWords(text: string | undefined, accent: string | undefined): { words: string[]; from: number; to: number; breaks: number[] } {
  const breaks: number[] = []
  const words: string[] = []
  for (const line of (text ?? '').split(/\r?\n/)) {
    const parts = line.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    if (!parts.length) continue
    if (words.length) breaks.push(words.length)
    words.push(...parts)
  }
  if (!words.length) return { words, from: -1, to: -1, breaks }
  const key = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const want = (accent ?? '').replace(/\s+/g, ' ').trim().split(' ').map(key).filter(Boolean)
  if (want.length) {
    for (let i = words.length - want.length; i >= 0; i--) {
      if (want.every((w, k) => key(words[i + k]) === w)) return { words, from: i, to: i + want.length - 1, breaks }
    }
  }
  return { words, from: words.length - 1, to: words.length - 1, breaks }
}

/** One box drawn over a Browser window's picture: x/y/w/h are shares (0–1) of the picture; it appears `at_ms` into the graphic. */
export interface GraphicHighlightBox { x: number; y: number; w: number; h: number; at_ms: number }
export const MAX_GRAPHIC_HIGHLIGHTS = 4
/** `highlights`: one box per line, "x, y, w, h" or "x, y, w, h, seconds" (shares of the picture; seconds into the graphic). Bad lines are skipped. */
export function browserHighlights(text: string | undefined): GraphicHighlightBox[] {
  const out: (Omit<GraphicHighlightBox, 'at_ms'> & { at_ms: number | null })[] = []
  for (const line of (text ?? '').split(/\r?\n/)) {
    const n = line.split(/[\s,;]+/).filter(Boolean).map(Number)
    if (n.length < 4 || n.length > 5 || n.some((v) => !Number.isFinite(v))) continue
    const [x, y, w, h] = n.map((v) => Math.max(0, Math.min(1, v)))
    if (w < .01 || h < .005 || x + w > 1.001 || y + h > 1.001) continue
    out.push({ x, y, w, h, at_ms: n.length === 5 ? Math.round(Math.max(0, Math.min(GRAPHIC_MAX_MS, n[4] * 1000))) : null })
    if (out.length >= MAX_GRAPHIC_HIGHLIGHTS) break
  }
  // Boxes without a time come in one after another once the window is open.
  return out.map((b, i) => ({ ...b, at_ms: b.at_ms ?? 900 + i * 700 }))
}

/**
 * When each item comes in (ms into the graphic), from the optional `item_ms` field: one time per line, in
 * order (a Crossed-out list may add one more for its final line). Automatic graphics set it so items reveal
 * as they're said; on a graphic it is SOURCE time from the graphic's start, and the render spec carries it in
 * output time (graphicSpec). Null when it is missing or doesn't fit `count` items, so the template's even
 * beats are used.
 */
export function graphicItemTimes(fields: Record<string, string>, count: number, durationMs: number): number[] | null {
  const text = fields.item_ms
  if (!text || count < 1) return null
  const times = text.split(/[\s,]+/).filter(Boolean).map(Number)
  if (times.length < count || times.length > count + 1 || times.some((t, i) => !Number.isFinite(t) || t < 0 || t > durationMs || (i > 0 && t < times[i - 1]))) return null
  return times.map((t) => Math.round(t))
}

/** The Icon row's icon for each item (null: none or unknown; the first tile shows the member's picture when there is one). */
export function graphicIcons(fields: Record<string, string>): (GraphicIcon | null)[] {
  const names = (fields.icons ?? '').split(/\r?\n/).map((line) => line.trim().toLowerCase())
  return templateItems('icon_pop', fields.items).map((_, i) => isGraphicIcon(names[i]) ? names[i] as GraphicIcon : null)
}

/** "$1,200/month" → prefix "$", 1200, suffix "/month"; "15 billion", "25%", "3.5x". Null when there is no number. */
export function parseStatValue(value: string | undefined): { prefix: string; number: number; decimals: number; commas: boolean; suffix: string } | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  const match = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/.exec(text)
  if (!match) return null
  const whole = match[1], fraction = match[2] ?? ''
  const number = Number(whole.replaceAll(',', '') + fraction)
  if (!Number.isFinite(number)) return null
  return { prefix: text.slice(0, match.index), number, decimals: Math.min(3, Math.max(0, fraction.length - 1)), commas: whole.includes(','), suffix: text.slice(match.index + match[0].length) }
}

/** The counter's text at `progress` (0..1) of its count. */
export function formatStatValue(stat: NonNullable<ReturnType<typeof parseStatValue>>, progress: number): string {
  const p = Math.max(0, Math.min(1, progress))
  const value = p >= 1 ? stat.number : stat.number * p
  let digits = value.toFixed(stat.decimals)
  if (stat.commas) {
    const [int, frac] = digits.split('.')
    digits = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '')
  }
  return `${stat.prefix}${digits}${stat.suffix}`
}

/** True when a graphic has the words (or image) it needs to draw something. */
export function graphicHasContent(g: Pick<EditorGraphic, 'template' | 'fields'>): boolean {
  const f = g.fields
  switch (g.template) {
    case 'stat': return !!(f.value?.trim() || f.label?.trim())
    case 'title': case 'quote': return !!f.text?.trim()
    case 'list': case 'checklist': return graphicItems(f.items).length > 0
    case 'lower_third': return !!(f.name?.trim() || f.role?.trim())
    case 'logo': return !!f.image
    case 'before_after': return !!(f.before?.trim() || f.after?.trim())
    case 'highlight': return true
    case 'statement': return !!f.text?.trim()
    case 'sticky_notes': return graphicItems(f.items).length > 0
    case 'strike_list': return graphicItems(f.items).length > 0 || !!f.final?.trim()
    case 'browser_frame': return !!(f.image || f.title?.trim())
    case 'icon_pop': return graphicItems(f.items).length > 0 || !!f.image
    case 'headline_pill': return !!(f.text?.trim() || f.phrase?.trim())
    case 'comment_cta': return !!f.keyword?.trim()
    case 'big_words': return bigWords(f.text).length > 0
  }
}

const unit = (text: string | undefined, fallback: number): number => {
  const n = Number(text)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback
}
/** The arrow or circle's target point as fractions of the frame. */
export function highlightPoint(fields: Record<string, string>): { x: number; y: number; shape: GraphicHighlightShape } {
  return { x: unit(fields.x, .5), y: unit(fields.y, .5), shape: fields.shape === 'arrow' ? 'arrow' : 'circle' }
}

function randomId(): string {
  const bytes = new Uint8Array(5)
  globalThis.crypto.getRandomValues(bytes)
  return `g-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/**
 * A new graphic. `fields` start empty (or as given): the words come from the
 * member, the chat or what was said in the clip, never made up here.
 */
export function newGraphic(template: GraphicTemplateId, at_ms: number, options: { fields?: Record<string, string>; duration_ms?: number; placement?: GraphicPlacement; size?: GraphicSize; depth?: GraphicDepth; origin?: EditorGraphic['origin']; taken?: Iterable<string> } = {}): EditorGraphic {
  const taken = new Set(options.taken ?? [])
  let id = randomId()
  while (taken.has(id)) id = randomId()
  const fields: Record<string, string> = template === 'highlight' ? { shape: 'circle', x: '0.5', y: '0.45' } : {}
  for (const [key, value] of Object.entries(options.fields ?? {})) if (/^[a-z_]{1,20}$/.test(key) && typeof value === 'string') fields[key] = value.slice(0, key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS)
  const placement = options.placement ?? (template === 'lower_third' ? 'bottom' : template === 'title' || template === 'comment_cta' ? 'middle' : 'top')
  // Big words start behind the speaker; the others in front unless asked.
  const depth = options.depth ?? (template === 'big_words' ? 'behind' : undefined)
  return { id, template, at_ms: Math.max(0, Math.round(at_ms)), duration_ms: clampGraphicMs(options.duration_ms ?? GRAPHIC_DEFAULT_MS[template]), placement, fields, origin: options.origin ?? 'member', ...(isGraphicSize(options.size) ? { size: options.size } : {}),
    ...(depth && graphicCanGoBehind(template) ? { depth } : {}) }
}

export function clampGraphicMs(ms: number): number {
  return Math.round(Math.max(GRAPHIC_MIN_MS, Math.min(GRAPHIC_MAX_MS, Number.isFinite(ms) ? ms : GRAPHIC_MIN_MS)))
}

type Timing = { ranges: [number, number][]; video_speed: number }

/** Keep a graphic inside its clip: it starts within the clip's span and is 0.8–8 s long. */
export function fitGraphicToClip(g: EditorGraphic, c: Timing): EditorGraphic {
  const start = c.ranges[0][0], end = c.ranges[c.ranges.length - 1][1]
  const duration_ms = clampGraphicMs(Math.min(g.duration_ms, Math.max(GRAPHIC_MIN_MS, end - start)))
  const at_ms = Math.round(Math.max(start, Math.min(end - Math.min(duration_ms, end - start), g.at_ms)))
  return at_ms === g.at_ms && duration_ms === g.duration_ms ? g : { ...g, at_ms, duration_ms }
}

/** The clip's graphics with `g` added (or replacing the one with its id), kept in its clip and in time order. Throws past the limit. */
export function withGraphic(c: Timing & { graphics?: EditorGraphic[] }, g: EditorGraphic): EditorGraphic[] {
  const list = c.graphics ?? []
  const exists = list.some((x) => x.id === g.id)
  if (!exists && list.length >= MAX_GRAPHICS_PER_CLIP) throw new Error(`Add up to ${MAX_GRAPHICS_PER_CLIP} graphics to a clip.`)
  const next = exists ? list.map((x) => x.id === g.id ? fitGraphicToClip(g, c) : x) : [...list, fitGraphicToClip(g, c)]
  return next.sort((a, b) => a.at_ms - b.at_ms)
}

/** Change one graphic (by id): its time, length, placement or fields. Fields given are merged; an empty string clears one. */
export function updateGraphic(c: Timing & { graphics?: EditorGraphic[] }, id: string, patch: Partial<Pick<EditorGraphic, 'at_ms' | 'duration_ms' | 'placement' | 'template' | 'size' | 'depth'>> & { fields?: Record<string, string> }): EditorGraphic[] {
  const g = (c.graphics ?? []).find((x) => x.id === id)
  if (!g) return c.graphics ?? []
  const fields = { ...g.fields }
  for (const [key, value] of Object.entries(patch.fields ?? {})) {
    if (!/^[a-z_]{1,20}$/.test(key) || typeof value !== 'string') continue
    if (value === '' && key !== 'image') fields[key] = ''
    else if (value === '') delete fields[key]
    else fields[key] = value.slice(0, key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS)
  }
  const { fields: _ignored, size, depth, ...rest } = patch
  void _ignored
  const next: EditorGraphic = { ...g, ...rest, ...(rest.duration_ms !== undefined ? { duration_ms: clampGraphicMs(rest.duration_ms) } : {}), fields }
  if (size !== undefined) { if (isGraphicSize(size) && size !== 'card') next.size = size; else delete next.size }
  // Depth is kept as set (Big words keeps an explicit 'front'); a template that can't go behind has none.
  if (depth !== undefined) { if (isGraphicDepth(depth) && graphicCanGoBehind(next.template)) next.depth = depth; else delete next.depth }
  if (next.depth && !graphicCanGoBehind(next.template)) delete next.depth
  return withGraphic(c, next)
}

export function removeGraphic(c: { graphics?: EditorGraphic[] }, id: string): EditorGraphic[] {
  return (c.graphics ?? []).filter((g) => g.id !== id)
}

/** Source time → output time (ms) through the clip's cuts and export speed; null when `t` is cut out. */
export function outputTime(c: Timing, t: number): number | null {
  let before = 0
  for (const [a, b] of c.ranges) {
    if (t >= a && t <= b) return (before + t - a) / c.video_speed
    before += b - a
  }
  return null
}

/**
 * Output time (ms into the finished clip) → source time, through the cuts and
 * export speed (the inverse of outputTime). Past the end: null. A time on a
 * join lands at the start of the next section.
 */
export function sourceTimeAt(c: Timing, out: number): number | null {
  if (!Number.isFinite(out) || out < 0) return null
  let left = out * c.video_speed
  for (const [a, b] of c.ranges) {
    if (left < b - a) return Math.round(a + left)
    left -= b - a
  }
  const last = c.ranges[c.ranges.length - 1]
  return left < 1 ? last[1] - 1 : null
}

/** Source time → output time, with a time in cut-out footage moved to the nearest kept moment (for a pin made while "Play cuts only" is off). */
export function nearestOutputTime(c: Timing, t: number): number {
  const exact = outputTime(c, t)
  if (exact !== null) return exact
  let best = 0, gap = Infinity, before = 0
  for (const [a, b] of c.ranges) {
    for (const [edge, out] of [[a, before], [b, before + b - a]] as const) if (Math.abs(t - edge) < gap) { gap = Math.abs(t - edge); best = out }
    before += b - a
  }
  return best / c.video_speed
}

/**
 * Where a graphic plays in the finished clip (output ms). Parts of it that fall
 * in cut-out footage are dropped (the kept parts play back to back), so a
 * graphic across a cut is shortened; one with under 0.4 s left is dropped (null).
 */
export function graphicWindow(c: Timing, g: Pick<EditorGraphic, 'at_ms' | 'duration_ms'>): { start_ms: number; duration_ms: number } | null {
  const s = g.at_ms, e = g.at_ms + g.duration_ms
  let before = 0, start: number | null = null, kept = 0
  for (const [a, b] of c.ranges) {
    const lo = Math.max(a, s), hi = Math.min(b, e)
    if (hi > lo) { if (start === null) start = before + lo - a; kept += hi - lo }
    before += b - a
  }
  if (start === null) return null
  const duration_ms = Math.round(kept / c.video_speed)
  return duration_ms < GRAPHIC_MIN_OUTPUT_MS ? null : { start_ms: Math.round(start / c.video_speed), duration_ms }
}

/** How far into its animation a graphic is at source time `t` (output ms), or null when it isn't on screen. */
export function graphicLocalMs(c: Timing, g: Pick<EditorGraphic, 'at_ms' | 'duration_ms'>, t: number): number | null {
  const w = graphicWindow(c, g), o = outputTime(c, t)
  if (!w || o === null || t < g.at_ms || t >= g.at_ms + g.duration_ms) return null
  const local = o - w.start_ms
  return local >= 0 && local < w.duration_ms ? local : null
}

// ---------------------------------------------------------------------------
// Fitting graphics into the cut, and keeping them out of each other's way.
// ---------------------------------------------------------------------------

/** How much of a graphic plays: all of it, part of it (it runs past the cut), or none. */
export type GraphicCutFit = 'inside' | 'partly' | 'outside'

/**
 * Whether a graphic plays in full: 'partly' when it runs before the clip's
 * start or past its end, or loses more than half of itself to removed parts (a
 * short pause cut inside it only shortens it a little, which is fine).
 */
export function graphicCutFit(c: Timing, g: Pick<EditorGraphic, 'at_ms' | 'duration_ms'>): GraphicCutFit {
  const w = graphicWindow(c, g)
  if (!w) return 'outside'
  const start = c.ranges[0][0], end = c.ranges[c.ranges.length - 1][1]
  const outside = g.at_ms < start - 20 || g.at_ms + g.duration_ms > end + 20
  return outside || w.duration_ms * c.video_speed < g.duration_ms / 2 ? 'partly' : 'inside'
}

/**
 * A graphic moved so all of it plays inside the clip's cut: one that runs past
 * the clip's end starts earlier, one that would start in cut-out footage starts
 * where the next kept part begins, and when the clip has less time left it is
 * shortened to what fits. Null when less than 0.8 s fits.
 */
export function fitGraphicInCut<G extends Pick<EditorGraphic, 'at_ms' | 'duration_ms'>>(g: G, c: Timing): G | null {
  const start = c.ranges[0][0], end = c.ranges[c.ranges.length - 1][1]
  let at = Math.max(start, Math.round(g.at_ms)), duration = clampGraphicMs(g.duration_ms)
  if (at + duration > end) at = Math.max(start, end - duration)
  if (!c.ranges.some(([a, b]) => at >= a && at < b)) at = c.ranges.find(([a]) => a > at)?.[0] ?? at
  duration = Math.min(duration, end - at)
  if (duration < GRAPHIC_MIN_MS) return null
  return at === g.at_ms && duration === g.duration_ms ? g : { ...g, at_ms: at, duration_ms: duration }
}

/** Graphics that sit in a band (an arrow or circle points at a spot instead). */
const usesBand = (g: Pick<EditorGraphic, 'template'>): boolean => g.template !== 'highlight'
/** A stage-size graphic takes the top of the frame over every band. */
const onStage = (g: { size?: GraphicSize }): boolean => g.size === 'stage'
/** The order a new graphic tries the bands in when its own is taken. */
export const GRAPHIC_BAND_ORDER: readonly GraphicPlacement[] = ['top', 'bottom', 'middle']

type Placed = Pick<EditorGraphic, 'id' | 'template' | 'at_ms' | 'duration_ms' | 'placement'> & { size?: GraphicSize }
/** True when two graphics share a band (a stage-size one shares every band) and are on screen at the same time. */
export function graphicsClash(a: Placed, b: Placed): boolean {
  return a.id !== b.id && usesBand(a) && usesBand(b) && (a.placement === b.placement || onStage(a) || onStage(b)) &&
    a.at_ms < b.at_ms + b.duration_ms && b.at_ms < a.at_ms + a.duration_ms
}

/** The ids of graphics that cover another one (same band, same time). */
export function graphicClashes(graphics: readonly Placed[]): Set<string> {
  const ids = new Set<string>()
  graphics.forEach((a, i) => graphics.slice(i + 1).forEach((b) => { if (graphicsClash(a, b)) { ids.add(a.id); ids.add(b.id) } }))
  return ids
}

/**
 * A graphic being added, moved to the next free band (top, then bottom, then
 * middle) when another graphic already sits in its band at the same time.
 * Unchanged when its band is free or no band is.
 */
export function placeInFreeBand<G extends Placed>(others: readonly Placed[], g: G): G {
  if (!usesBand(g) || onStage(g)) return g
  const free = (placement: GraphicPlacement): boolean => !others.some((o) => graphicsClash(o, { ...g, placement }))
  if (free(g.placement)) return g
  const band = GRAPHIC_BAND_ORDER.find(free)
  return band ? { ...g, placement: band } : g
}

// ---------------------------------------------------------------------------
// Big words: 1–3 huge words placed in the scene (usually behind the speaker).
// ---------------------------------------------------------------------------

export const MAX_BIG_WORDS = 3
export type BigWordsStyle = 'serif' | 'sans' | 'mixed'
export type BigWordsMotion = 'scale' | 'reveal'
/** Big words' look from its option fields: `style` (serif, sans, mixed), `vertical` (left, right or empty), `motion` (scale, reveal). */
export function bigWordsOptions(fields: Record<string, string>): { style: BigWordsStyle; vertical: 'left' | 'right' | null; motion: BigWordsMotion } {
  const style = fields.style === 'sans' || fields.style === 'mixed' ? fields.style : 'serif'
  const vertical = fields.vertical === 'left' || fields.vertical === 'right' ? fields.vertical : null
  return { style, vertical, motion: fields.motion === 'reveal' ? 'reveal' : 'scale' }
}

/**
 * Big words' lines: the words of `text` (at most 3), on the lines the member
 * typed, else stacked so each line can fill the frame's width: two words go on
 * two lines (unless one is a short word like “Go”), three on the split that
 * evens out the lines. `stack: false` keeps them on one line (vertical).
 */
export function bigWords(text: string | undefined, options: { stack?: boolean; mixed?: boolean } = {}): string[][] {
  const typed = (text ?? '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)).filter((line) => line.length)
  const lines: string[][] = []
  let count = 0
  for (const line of typed) {
    const room = line.slice(0, MAX_BIG_WORDS - count)
    if (room.length) lines.push(room)
    count += room.length
    if (count >= MAX_BIG_WORDS) break
  }
  const words = lines.flat()
  if (!words.length) return []
  if (options.stack === false) return [words]
  if (lines.length > 1) return lines
  const letters = (w: string): number => (w.match(/[\p{L}\p{N}]/gu) ?? []).length
  if (words.length === 2) return options.mixed || Math.min(letters(words[0]), letters(words[1])) > 3 ? [[words[0]], [words[1]]] : [words]
  if (words.length === 3) {
    const a = letters(words[0]), b = letters(words[1]) + letters(words[2]) + 1, c = letters(words[0]) + letters(words[1]) + 1, d = letters(words[2])
    return Math.abs(a - b) <= Math.abs(c - d) ? [[words[0]], words.slice(1)] : [words.slice(0, 2), [words[2]]]
  }
  return [words]
}
