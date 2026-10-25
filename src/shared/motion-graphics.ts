/**
 * Motion graphics: short animated cards (stat counter, title slam, list…) placed
 * on a clip's timeline. This file is the contract shared by the template
 * renderer, the clip editor's Graphics row, the editor chat and the engine that
 * layers the rendered graphics over the video. Templates are our own designs;
 * the words in a graphic come from the member or from what was said in the clip. Effects (`fx`) are HyperFrames units
 * (Apache-2.0) drawn the same way; src/shared/fx-catalog.ts lists them and their fields.
 */
import { fxCueUnits, fxEffect, fxHasContent, fxLine, fxPictureFields } from './fx-catalog'

export const GRAPHIC_TEMPLATES = [
  { id: 'stat', label: 'Stat counter', detail: 'A number that counts up, with a short label.', fields: ['value', 'label'] },
  { id: 'title', label: 'Title slam', detail: 'A few big words that slam in.', fields: ['text'] },
  { id: 'list', label: 'Numbered list', detail: 'Up to 5 short points, one after another.', fields: ['title', 'items', 'icons'] },
  { id: 'lower_third', label: 'Name tag', detail: 'A name and a role along the bottom.', fields: ['name', 'role'] },
  { id: 'logo', label: 'Logo pop', detail: 'An image you add pops in.', fields: ['image', 'caption'] },
  { id: 'before_after', label: 'Before / after', detail: 'Two short lines side by side.', fields: ['before', 'after'] },
  { id: 'checklist', label: 'Checklist', detail: 'Up to 5 items that tick off.', fields: ['title', 'items', 'icons'] },
  { id: 'quote', label: 'Quote card', detail: 'A short quote and who said it.', fields: ['text', 'author'] },
  { id: 'highlight', label: 'Arrow or circle', detail: 'Points at something on screen.', fields: ['shape', 'x', 'y'] },
  { id: 'statement', label: 'Statement', detail: 'One or two lines in big serif type, with the key words in italics.', fields: ['text', 'accent', 'subline'] },
  { id: 'sticky_notes', label: 'Sticky notes', detail: 'Two or three short notes that drop in.', fields: ['items'] },
  { id: 'strike_list', label: 'Crossed-out list', detail: 'Up to 4 items crossed out one by one, then the better choice.', fields: ['items', 'final', 'accent'] },
  { id: 'browser_frame', label: 'Browser window', detail: 'A screenshot (or a short headline) in a browser window.', fields: ['domain', 'image', 'title', 'accent', 'subline', 'highlights'] },
  { id: 'icon_pop', label: 'Icon row', detail: 'Up to 4 icons that pop in one by one, with labels.', fields: ['items', 'icons', 'image'] },
  { id: 'headline_pill', label: 'Headline', detail: 'Two lines: a bold line, then the key words on a color box.', fields: ['text', 'phrase'] },
  { id: 'comment_cta', label: 'Comment prompt', detail: '“Comment” over the keyword people should comment.', fields: ['keyword', 'lead'] },
  { id: 'link_cta', label: 'Call to action', detail: 'Your call to action on a button (“Click the link”) that a pointer taps, with an arrow to where the link is.', fields: ['text', 'where', 'kind', 'lead'] },
  { id: 'big_words', label: 'Big words (behind you)', detail: '1 to 3 huge words placed in the scene, behind your head.', fields: ['text', 'style', 'vertical', 'motion'] },
  { id: 'orbit', label: 'Orbit', detail: 'A center tile with 3 to 6 icons that draw in around it on a ring.', fields: ['text', 'items', 'icons', 'image', 'labels'] },
  { id: 'feature_tile', label: 'Feature tile', detail: 'Up to 3 frosted tiles, each an icon and a short label, with an optional red dot.', fields: ['items', 'icons', 'dot'] },
  { id: 'screen_frame', label: 'Screen recording', detail: 'A video playing in a dark window with a soft glow: your screen recording, or part of this clip.', fields: ['video', 'from', 'zoom', 'label', 'shape'] },
  { id: 'chapter', label: 'Chapter header', detail: 'A title at the top that stays for a whole section, like “Step #1. Come up with your idea”.', fields: ['label', 'title', 'style'] },
  { id: 'staircase', label: 'Staircase', detail: '3 to 6 steps climbing up. Each step lights up as you say it.', fields: ['title', 'items', 'icons'] },
  { id: 'funnel', label: 'Funnel', detail: 'A funnel with 3 to 5 stages. Each stage lights up as you say it.', fields: ['title', 'items'] },
  { id: 'journey', label: 'Journey', detail: '3 to 5 milestone cards. A small figure walks from one to the next as you say them.', fields: ['title', 'items'] },
  { id: 'growth', label: 'Growth', detail: '3 to 6 plants (or bars) that get bigger, with a label under each.', fields: ['title', 'items', 'style'] },
  { id: 'idea_hub', label: 'Idea hub', detail: 'An icon in the middle with 3 to 6 labels around it. Each label appears as you say it.', fields: ['text', 'items', 'icon'] },
  { id: 'compare_marks', label: 'Wrong / right', detail: 'Two cards side by side, then a red ✗ on one and a green ✓ on the other.', fields: ['items', 'notes', 'wrong'] },
  { id: 'takeover', label: 'Type takeover', detail: 'Your key line in huge type over the whole frame, your head between its lines. Use it once or twice a video.', fields: ['text', 'accent'] },
  // One template for every effect: `effect` names the unit, its other fields are the unit's (fx-catalog.ts).
  { id: 'fx', label: 'Effect', detail: 'A designed motion effect: a count up, a word rise, a chart, a marker and more.', fields: ['effect'] }
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
 * templates in GRAPHIC_DEPTH_TEMPLATES can go behind. `between`: a Type takeover's
 * own depth (its lines above the speaker's chin behind them, the rest in front of
 * their chest, over the room darkened and blurred); a takeover set to `front` lies over everything.
 */
export type GraphicDepth = 'front' | 'behind' | 'between'
export const GRAPHIC_DEPTHS: readonly GraphicDepth[] = ['front', 'behind']
export function isGraphicDepth(value: unknown): value is GraphicDepth {
  return value === 'front' || value === 'behind' || value === 'between'
}
/** Templates whose words sit between the speaker's head and chest (Type takeover). */
export const GRAPHIC_BETWEEN_TEMPLATES: readonly string[] = ['takeover']
/** Templates that can sit behind the speaker (big words and big type; Big words starts there). */
export const GRAPHIC_DEPTH_TEMPLATES: readonly string[] = ['big_words', 'title', 'statement', 'headline_pill']
export function graphicCanGoBehind(template: string): boolean { return GRAPHIC_DEPTH_TEMPLATES.includes(template) }
/** A graphic's depth: its own when its template can go behind, else front; a takeover sits between unless set to front. */
export function graphicDepth(g: { template: string; depth?: GraphicDepth }): GraphicDepth {
  if (GRAPHIC_BETWEEN_TEMPLATES.includes(g.template)) return g.depth === 'front' ? 'front' : 'between'
  return g.depth === 'behind' && graphicCanGoBehind(g.template) ? 'behind' : 'front'
}
/** Whether a depth can be stored on a graphic of this template. */
function depthFits(template: string, depth: unknown): depth is GraphicDepth {
  if (GRAPHIC_BETWEEN_TEMPLATES.includes(template)) return depth === 'front' || depth === 'between'
  return (depth === 'front' || depth === 'behind') && graphicCanGoBehind(template)
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

export const MAX_GRAPHICS_PER_CLIP = 60
/**
 * A YouTube video (16:9, often 10-30 minutes) may carry more: about GRAPHICS_PER_10_MIN per ten minutes, never fewer
 * than a reel, at most MAX_GRAPHICS_LONG (so a 26-minute video gets about one visual per 10-20 s). Mirrors
 * auto_graphics.graphics_cap.
 */
export const GRAPHICS_PER_10_MIN = 60
export const MAX_GRAPHICS_LONG = 180
export function graphicsCap(project: { aspect_ratio?: string; duration_ms?: number } | null | undefined): number {
  if (!project || project.aspect_ratio !== '16:9') return MAX_GRAPHICS_PER_CLIP
  const minutes = Math.max(0, Number(project.duration_ms) || 0) / 60000
  return Math.max(MAX_GRAPHICS_PER_CLIP, Math.min(MAX_GRAPHICS_LONG, Math.ceil(minutes / 10 * GRAPHICS_PER_10_MIN)))
}
export const GRAPHIC_MIN_MS = 800
/** The longest most graphics last (a diagram or a chapter header may last longer: graphicMaxMs). */
export const GRAPHIC_MAX_MS = 8000
/** A diagram stays while the speaker talks it through. */
export const DIAGRAM_MAX_MS = 16000
/** A chapter header can stay for a whole section (up to the clip's length, at most 3 minutes). */
export const CHAPTER_MAX_MS = 180000
export const MAX_GRAPHIC_FIELD_CHARS = 160

/**
 * Diagrams: white line art on the scene's backdrop (or on a blue panel over the video) whose labels light up in
 * the accent color one by one, as each is said (item_ms).
 */
export const DIAGRAM_TEMPLATES: readonly string[] = ['staircase', 'funnel', 'journey', 'growth', 'idea_hub', 'compare_marks']
export function isDiagram(template: string): boolean { return DIAGRAM_TEMPLATES.includes(template) }
/** The longest a graphic of this kind may last. */
export function graphicMaxMs(template: string | undefined): number {
  return template === 'chapter' ? CHAPTER_MAX_MS : template && isDiagram(template) ? DIAGRAM_MAX_MS : GRAPHIC_MAX_MS
}
/** The light-up color diagrams use unless the graphic has its own color. */
export const DIAGRAM_ACCENT = '#7CB82F'
/** The panel behind a diagram drawn over the video (and the Solid backdrop's color without a brand color): royal blue. */
export const DIAGRAM_PANEL = '#1F4E9C'
/** Fewest items a diagram needs to draw (a Wrong / right takes exactly two). */
export const DIAGRAM_MIN_ITEMS: Record<string, number> = { staircase: 3, funnel: 3, journey: 3, growth: 3, idea_hub: 3, compare_marks: 2 }

export function isGraphicTemplate(value: unknown): value is GraphicTemplateId {
  return typeof value === 'string' && (GRAPHIC_TEMPLATE_IDS as readonly string[]).includes(value)
}

/** Validates untrusted graphics (throws on anything malformed). */
export function parseGraphics(value: unknown, limit: number = MAX_GRAPHICS_PER_CLIP): EditorGraphic[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Add up to ${limit} graphics to a clip.`)
  const seen = new Set<string>()
  return value.map((raw): EditorGraphic => {
    if (!raw || typeof raw !== 'object') throw new Error('A graphic is malformed.')
    const g = raw as Record<string, unknown>
    if (typeof g.id !== 'string' || !/^[a-z0-9-]{4,40}$/.test(g.id) || seen.has(g.id)) throw new Error('A graphic is malformed.')
    seen.add(g.id)
    if (!isGraphicTemplate(g.template)) throw new Error('Choose one of the graphic templates.')
    if (typeof g.at_ms !== 'number' || !Number.isFinite(g.at_ms) || g.at_ms < 0) throw new Error('A graphic needs a start time.')
    if (typeof g.duration_ms !== 'number' || !Number.isFinite(g.duration_ms) || g.duration_ms < GRAPHIC_MIN_MS || g.duration_ms > graphicMaxMs(g.template)) throw new Error(`A graphic lasts between 0.8 and ${graphicMaxMs(g.template) / 1000} seconds.`)
    const placement = (GRAPHIC_PLACEMENTS as readonly unknown[]).includes(g.placement) ? g.placement as GraphicPlacement : 'middle'
    const fields: Record<string, string> = {}
    if (g.fields && typeof g.fields === 'object') {
      for (const [key, text] of Object.entries(g.fields as Record<string, unknown>)) {
        if (!/^[a-z_]{1,20}$/.test(key) || typeof text !== 'string') continue
        fields[key] = text.slice(0, key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS)
      }
    }
    for (const key of GRAPHIC_PICTURE_FIELDS) if (fields[key] !== undefined && fields[key] !== '' && !/^[A-Za-z0-9._-]{1,80}$/.test(fields[key])) throw new Error('A graphic’s image must be one of the clip’s images.')
    if (fields.video !== undefined && fields.video !== '' && !isScreenVideo(fields.video)) throw new Error('A graphic’s video must be one of the clip’s videos.')
    if (g.template === 'fx' && !fxEffect(fields.effect)) throw new Error('Choose one of the effects.')
    const origin: EditorGraphic['origin'] = g.origin === 'auto' || g.origin === 'chat' || g.origin === 'member' ? g.origin : undefined
    const size = isGraphicSize(g.size) ? g.size : undefined
    const depth = depthFits(g.template, g.depth) ? g.depth : undefined
    return { id: g.id, template: g.template, at_ms: Math.round(g.at_ms), duration_ms: Math.round(g.duration_ms), placement, fields, ...(origin ? { origin } : {}), ...(size ? { size } : {}), ...(depth ? { depth } : {}) }
  }).sort((a, b) => a.at_ms - b.at_ms)
}

// ---------------------------------------------------------------------------
// Helpers shared by the editor (Graphics row, inspector, chat) and main.
// ---------------------------------------------------------------------------

/** Bump when a template's look changes, so cached renders are made again. */
export const GRAPHICS_VERSION = 7

/**
 * Looks: the most used templates come in two or three designs (`fields.variant`), so a video that shows a template
 * more than once never shows the same card twice. Optional: a graphic without one (or with an unknown one) draws the
 * first, the classic look. The engine gives automatic graphics a look in turn (auto_graphics.VARIANTS / ROTATION).
 */
export const GRAPHIC_VARIANTS: Partial<Record<GraphicTemplateId, readonly { id: string; label: string; detail: string }[]>> = {
  statement: [
    { id: 'card', label: 'White card', detail: 'Serif type on a white card.' },
    { id: 'glass', label: 'Dark glass', detail: 'White type on dark glass, the key words underlined in your color.' },
    { id: 'bold', label: 'Bold color', detail: 'Big bold type on your color.' }
  ],
  title: [
    { id: 'card', label: 'White card', detail: 'Bold words on a white card.' },
    { id: 'pill', label: 'Color pills', detail: 'Each line on a pill in your color.' },
    { id: 'shadow', label: 'Big type', detail: 'Huge white words with a soft shadow, no card.' }
  ],
  quote: [
    { id: 'card', label: 'White card', detail: 'Serif quote on a white card.' },
    { id: 'dark', label: 'Dark', detail: 'White serif on a dark card with a big quote mark in your color.' },
    { id: 'accent', label: 'Color', detail: 'White serif on your color.' }
  ],
  sticky_notes: [
    { id: 'notes', label: 'Sticky notes', detail: 'Pastel notes with tape.' },
    { id: 'polaroid', label: 'Photo cards', detail: 'Tilted photo cards in your color.' },
    { id: 'index', label: 'Index cards', detail: 'Lined cards pinned in place.' }
  ],
  list: [
    { id: 'card', label: 'Card', detail: 'Numbered rows on a white card.' },
    { id: 'chips', label: 'Icon rows', detail: 'Each point on its own glass row with an icon or number chip.' },
    { id: 'pills', label: 'Dark pills', detail: 'Each point on a dark pill with a number in your color.' }
  ],
  checklist: [
    { id: 'card', label: 'Card', detail: 'Ticks on a white card.' },
    { id: 'dark', label: 'Dark', detail: 'Ticks in your color on a dark card.' },
    { id: 'rows', label: 'Rows', detail: 'Each item on its own white row.' }
  ],
  stat: [
    { id: 'card', label: 'White card', detail: 'The number on a white card.' },
    { id: 'gradient', label: 'Color', detail: 'A big white number on your color, with a ring.' },
    { id: 'badge', label: 'Badge', detail: 'The number beside an icon badge.' }
  ]
}
/** The looks a template has (empty: one look only). */
export function graphicVariants(template: string): readonly { id: string; label: string; detail: string }[] {
  return GRAPHIC_VARIANTS[template as GraphicTemplateId] ?? []
}
/** A graphic's look: its `variant` when the template has it, else the template's first (classic) look; '' for one-look templates. */
export function graphicVariant(template: string, fields: Record<string, string>): string {
  const looks = graphicVariants(template)
  if (!looks.length) return ''
  return looks.some((v) => v.id === fields.variant) ? fields.variant : looks[0].id
}
/** Rendered graphics are layered over the clip at this frame rate. */
export const GRAPHIC_FPS = 30
/** A graphic left with less than this much on screen after the cut is dropped. */
export const GRAPHIC_MIN_OUTPUT_MS = 400
export const MAX_GRAPHIC_ITEMS = 5
export type GraphicHighlightShape = 'circle' | 'arrow'

/** How long a new graphic of each kind lasts (ms). */
export const GRAPHIC_DEFAULT_MS: Record<GraphicTemplateId, number> = {
  stat: 3500, title: 2500, list: 5000, lower_third: 4000, logo: 3000, before_after: 4000, checklist: 5000, quote: 5000, highlight: 2500,
  statement: 3500, sticky_notes: 4000, strike_list: 5000, browser_frame: 5000, icon_pop: 3500, headline_pill: 3500, comment_cta: 3500, link_cta: 3500,
  big_words: 2500, orbit: 4500, feature_tile: 3500, screen_frame: 5000,
  chapter: 15000, staircase: 9000, funnel: 8000, journey: 9000, growth: 9000, idea_hub: 8000, compare_marks: 7000, fx: 3500, takeover: 2500
}

/** Templates that can show a picture the member chose (Logo pop needs one; the others draw without it). */
export const GRAPHIC_IMAGE_TEMPLATES: readonly GraphicTemplateId[] = ['logo', 'browser_frame', 'icon_pop', 'orbit']
export function graphicUsesImage(template: GraphicTemplateId): boolean { return GRAPHIC_IMAGE_TEMPLATES.includes(template) }
/** The fields that can hold a picture (a run image name): `image`, and an effect's second picture. */
export const GRAPHIC_PICTURE_FIELDS = ['image', 'image_b'] as const
export type GraphicPictureField = (typeof GRAPHIC_PICTURE_FIELDS)[number]
/** The picture fields a graphic draws: the image templates' `image`, an effect's own pictures (fx-catalog). */
export function graphicPictureFields(g: Pick<EditorGraphic, 'template' | 'fields'>): GraphicPictureField[] {
  if (g.template === 'fx') return fxPictureFields(fxEffect(g.fields.effect)).map((f) => f.key).filter((k): k is GraphicPictureField => (GRAPHIC_PICTURE_FIELDS as readonly string[]).includes(k))
  return graphicUsesImage(g.template) ? ['image'] : []
}

/** Most items a template shows (the rest of `items` is left out). */
export const GRAPHIC_ITEM_LIMITS: Partial<Record<GraphicTemplateId, number>> = { sticky_notes: 3, strike_list: 4, icon_pop: 4, orbit: 6, feature_tile: 3,
  staircase: 6, funnel: 5, journey: 5, growth: 6, idea_hub: 6, compare_marks: 2 }
/** Orbit: 3 to 6 nodes on its ring. */
export const MIN_ORBIT_NODES = 3
export const MAX_ORBIT_NODES = 6

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
  /**
   * The band the graphic sits in, as fractions of the output height (it never covers the hook or the captions); on a
   * YouTube video also across (left and right, fractions of the width: a side panel or a lower third).
   */
  box: { top: number; bottom: number; left?: number; right?: number }
  /** A full-screen brand card (YouTube): the graphic drawn on the brand's gradient with a faint logo (a URL, filled by the caller) or handle. */
  backdrop?: { color: string; logo?: string; mark?: string }
  placement: GraphicPlacement
  /** Brand color #RRGGBB. */
  color: string
  /** The words' font id (headline-look HEADLINE_FONTS): a bold sans unless the member picked one for the graphic. */
  font: string
  /** The brand font for accent words only (a marked word, a word in color): the hook's font when it isn't the plain sans. */
  accent_font?: string
  /** Logo image as a URL the page may load (a local-file URL in the editor, a data URL offscreen). */
  image?: string
  /** An effect's second picture (Before & after's after), the same way. */
  image_b?: string
  /** Editor preview only (never in a render): the Screen recording's video as a URL the page may load, and where it starts (s). */
  preview_video?: { url: string; from: number }
  /** How big it is drawn (unset: 'card'). */
  size?: GraphicSize
}

export function templateInfo(id: GraphicTemplateId): (typeof GRAPHIC_TEMPLATES)[number] {
  return GRAPHIC_TEMPLATES.find((t) => t.id === id) ?? GRAPHIC_TEMPLATES[0]
}

/** A list field's lines: trimmed, non-empty, at most 5 (or `limit`, at most 6: an Orbit's nodes). */
export function graphicItems(text: string | undefined, limit = MAX_GRAPHIC_ITEMS): string[] {
  return (text ?? '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, Math.min(limit, MAX_ORBIT_NODES))
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

/**
 * The icon for each item (null: none or unknown). Icon row: the first tile shows the member's picture when there is
 * one. Orbit and Feature tile: one per item, or (with no labels) one node per icon given.
 */
export function graphicIcons(fields: Record<string, string>, template: 'icon_pop' | 'orbit' | 'feature_tile' | 'staircase' | 'list' | 'checklist' = 'icon_pop'): (GraphicIcon | null)[] {
  const names = (fields.icons ?? '').split(/\r?\n/).map((line) => line.trim().toLowerCase())
  const items = templateItems(template, fields.items)
  const count = template === 'icon_pop' || template === 'staircase' || template === 'list' || template === 'checklist' ? items.length : Math.max(items.length, Math.min(GRAPHIC_ITEM_LIMITS[template] ?? MAX_GRAPHIC_ITEMS, names.filter(isGraphicIcon).length))
  return Array.from({ length: count }, (_, i) => isGraphicIcon(names[i]) ? names[i] as GraphicIcon : null)
}

/** An Orbit's nodes: an icon and an optional label each (labels hidden with `labels: off`); at most 6. */
export function orbitNodes(fields: Record<string, string>): { icon: GraphicIcon | null; label: string }[] {
  const items = templateItems('orbit', fields.items)
  const showLabels = fields.labels !== 'off'
  return graphicIcons(fields, 'orbit').map((icon, i) => ({ icon, label: showLabels ? items[i] ?? '' : '' }))
}

// ---------------------------------------------------------------------------
// Chapter headers and diagrams.
// ---------------------------------------------------------------------------

export type ChapterStyle = 'serif_caps' | 'sans' | 'pill'
export const CHAPTER_STYLES: readonly ChapterStyle[] = ['serif_caps', 'sans', 'pill']
/** A chapter header's look (`style`): white small-caps serif (the default), bold sans, or a dark pill. */
export function chapterStyle(fields: Record<string, string>): ChapterStyle {
  return (CHAPTER_STYLES as readonly string[]).includes(fields.style) ? fields.style as ChapterStyle : 'serif_caps'
}
/** What a chapter header shows: its label ("Step #1.") and title, cleaned. */
export function chapterText(fields: Record<string, string>): { label: string; title: string } {
  const clean = (t: string | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim()
  return { label: clean(fields.label), title: clean(fields.title) }
}
export type GrowthStyle = 'plants' | 'bars'
export function growthStyle(fields: Record<string, string>): GrowthStyle { return fields.style === 'bars' ? 'bars' : 'plants' }
/** Which card of a Wrong / right gets the red ✗ (`wrong`: first, the default, or second). */
export function compareWrong(fields: Record<string, string>): 0 | 1 { return fields.wrong === 'second' ? 1 : 0 }
/** A Wrong / right's short line under each card title (`notes`, one per line). */
export function compareNotes(fields: Record<string, string>): string[] {
  return (fields.notes ?? '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).slice(0, 2)
}
/** An Idea hub's center icon (`icon`): one of GRAPHIC_ICONS, else the light bulb. */
export function hubIcon(fields: Record<string, string>): GraphicIcon {
  const name = (fields.icon ?? '').trim().toLowerCase()
  return isGraphicIcon(name) ? name : 'idea'
}
/**
 * A Wrong / right's beats (ms into the graphic) from `item_ms`: each card as it is said, then the ✗ and the ✓.
 * Two times: the cards; the marks follow the second card. Four: the cards, then the ✗, then the ✓. Null: even beats.
 */
export function compareTimes(fields: Record<string, string>, durationMs: number): { cards: number[]; cross: number; check: number } | null {
  const text = fields.item_ms
  if (!text) return null
  const t = text.split(/[\s,]+/).filter(Boolean).map(Number)
  if ((t.length !== 2 && t.length !== 4) || t.some((v, i) => !Number.isFinite(v) || v < 0 || v > durationMs || (i > 0 && v < t[i - 1]))) return null
  const cards = t.slice(0, 2).map(Math.round)
  if (t.length === 4) return { cards, cross: Math.round(t[2]), check: Math.round(t[3]) }
  const cross = Math.min(durationMs - 1200, cards[1] + 900)
  return { cards, cross: Math.max(cards[1] + 200, cross), check: Math.max(cards[1] + 500, cross + 650) }
}

/** The finished clip's time (output ms) at which the hook text hands over to the first chapter header, or null with none. */
export function hookEndMs(c: Timing & { graphics?: EditorGraphic[] }): number | null {
  let first: number | null = null
  for (const g of c.graphics ?? []) {
    if (g.template !== 'chapter' || !graphicHasContent(g)) continue
    const w = graphicWindow(c, g)
    if (w && (first === null || w.start_ms < first)) first = w.start_ms
  }
  return first
}

/** Where (SOURCE ms) the first chapter header that plays starts: the bake fades the hook out there. Null with none. */
export function firstChapterSourceMs(c: Timing & { graphics?: EditorGraphic[] }): number | null {
  let first: number | null = null
  for (const g of c.graphics ?? []) {
    if (g.template !== 'chapter' || !graphicHasContent(g) || !graphicWindow(c, g)) continue
    if (first === null || g.at_ms < first) first = g.at_ms
  }
  return first
}

/** Templates whose items can be timed to the words said (item_ms) by matchItemTimes. */
export const ITEM_TIMED_TEMPLATES: readonly string[] = ['list', 'checklist', 'sticky_notes', 'icon_pop', 'orbit', 'feature_tile', ...DIAGRAM_TEMPLATES]

/**
 * A graphic with each item's spoken time (`item_ms`, ms from its start): each item's words found in what is said
 * from just before the graphic to just after it, in order. Null when they aren't all said there in that order.
 */
export function matchItemTimes<G extends Pick<EditorGraphic, 'template' | 'fields' | 'at_ms' | 'duration_ms'>>(g: G, words: readonly TimedWord[], slackMs = 2000): G | null {
  if (!ITEM_TIMED_TEMPLATES.includes(g.template)) return null
  const items = templateItems(g.template, g.fields.items)
  if (!items.length) return null
  const said = words.filter((w) => w.start_ms >= g.at_ms - slackMs && w.start_ms <= g.at_ms + g.duration_ms + slackMs).map((w) => ({ ...w, key: wordKey(w.word) })).filter((w) => w.key)
  const times: number[] = []
  let cursor = 0
  for (const item of items) {
    const want = item.split(' ').map(wordKey).filter(Boolean)
    if (!want.length) return null
    let found = -1
    for (let i = cursor; i < said.length && found < 0; i++) {
      if (said[i].key !== want[0]) continue
      let k = i + 1, ok = true
      for (const w of want.slice(1)) {
        const hit = said.slice(k, k + 3).findIndex((x) => x.key === w)
        if (hit < 0) { ok = false; break }
        k += hit + 1
      }
      if (ok) { found = i; cursor = k }
    }
    if (found < 0) return null
    times.push(Math.max(0, Math.min(g.duration_ms - 300, said[found].start_ms - g.at_ms)))
  }
  return { ...g, fields: { ...g.fields, item_ms: times.join('\n') } }
}

/**
 * An effect with its spoken cue times (`cue_ms`, ms from its start): its cue words (or list items) found, in order, in
 * what is said from just before it to just after it. Null when it has no cue or they aren't all said there in order.
 */
export function matchFxCues<G extends Pick<EditorGraphic, 'template' | 'fields' | 'at_ms' | 'duration_ms'>>(g: G, words: readonly TimedWord[], slackMs = 2000): G | null {
  const effect = g.template === 'fx' ? fxEffect(g.fields.effect) : null
  if (!effect?.cue) return null
  const units = fxCueUnits(effect, g.fields)
  if (!units.length) return null
  const said = words.filter((w) => w.start_ms >= g.at_ms - slackMs && w.start_ms <= g.at_ms + g.duration_ms + slackMs).map((w) => ({ ...w, key: wordKey(w.word) })).filter((w) => w.key)
  const times: number[] = []
  let cursor = 0
  for (const unit of units) {
    const want = unit.split(' ').map(wordKey).filter(Boolean)
    if (!want.length) return null
    let found = -1
    for (let i = cursor; i < said.length && found < 0; i++) {
      if (said[i].key !== want[0]) continue
      let k = i + 1, ok = true
      for (const w of want.slice(1)) {
        const hit = said.slice(k, k + 3).findIndex((x) => x.key === w)
        if (hit < 0) { ok = false; break }
        k += hit + 1
      }
      if (ok) { found = i; cursor = k }
    }
    if (found < 0) return null
    times.push(Math.max(0, Math.min(g.duration_ms - 300, said[found].start_ms - g.at_ms)))
  }
  return { ...g, fields: { ...g.fields, cue_ms: times.join('\n') } }
}

// ---------------------------------------------------------------------------
// Screen recording: a video in a dark window. The page draws the window with a
// transparent hole; the engine plays the video under it (graphics_overlay).
// ---------------------------------------------------------------------------

/** The window's video: a file the member added (copied into the run's .graphics/videos/) or 'source' (this clip's own video). */
export const SCREEN_VIDEO_FILE = /^[a-f0-9]{16}\.(mp4|mov|m4v|webm)$/
export type ScreenShape = 'wide' | 'square' | 'tall'
export const SCREEN_SHAPES: readonly ScreenShape[] = ['wide', 'square', 'tall']
/** The hole's width / height per shape. */
export const SCREEN_ASPECT: Record<ScreenShape, number> = { wide: 16 / 9, square: 1, tall: 4 / 5 }
/** The window fades in and out over this long; the engine fades the video the same. */
export const SCREEN_FADE_MS = 300
export function isScreenVideo(value: unknown): boolean { return value === 'source' || (typeof value === 'string' && SCREEN_VIDEO_FILE.test(value)) }
export function screenShape(fields: Record<string, string>): ScreenShape {
  return (SCREEN_SHAPES as readonly string[]).includes(fields.shape) ? fields.shape as ScreenShape : 'wide'
}
/** Where the video starts playing (seconds into it, from `from`), 0 when unset. */
export function screenFrom(fields: Record<string, string>): number {
  const n = Number(fields.from)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 24 * 3600) : 0
}
/**
 * The slow zoom's target from `zoom` ("x, y, w, h", shares 0–1 of what the window shows at the start), made the
 * window's shape (a square of shares, at most 4× in), or null for none (a gentle push-in instead).
 */
export function screenZoom(fields: Record<string, string>): [number, number, number, number] | null {
  const n = (fields.zoom ?? '').split(/[\s,;]+/).filter(Boolean).map(Number)
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null
  const [x, y, w, h] = n.map((v) => Math.max(0, Math.min(1, v)))
  if (w < .02 || h < .02) return null
  const side = Math.min(1, Math.max(.25, w, h))
  const cx = Math.min(1, x + w / 2), cy = Math.min(1, y + h / 2)
  const round = (v: number): number => Math.round(v * 10000) / 10000
  return [round(Math.max(0, Math.min(1 - side, cx - side / 2))), round(Math.max(0, Math.min(1 - side, cy - side / 2))), round(side), round(side)]
}
/**
 * The Screen recording window in a frame (pixels): its outer box, its title bar, and the hole the video shows
 * through, centered in the graphic's band, as big as the band allows at the window's shape.
 */
export function screenFrameLayout(spec: Pick<GraphicRenderSpec, 'width' | 'height' | 'box' | 'fields'>): { window: { x: number; y: number; w: number; h: number }; hole: { x: number; y: number; w: number; h: number }; bar: number; border: number; radius: number } {
  const { width: W, height: H } = spec
  const u = Math.min(W, H) / 1080
  const bar = Math.round(54 * u), border = Math.round(12 * u), radius = Math.round(34 * u)
  const top = spec.box.top * H, bandH = (spec.box.bottom - spec.box.top) * H
  const maxW = Math.min(W - 2 * 56 * u, 1000 * u), maxH = bandH - 2 * 18 * u
  const aspect = SCREEN_ASPECT[screenShape(spec.fields)]
  let holeW = maxW - 2 * border, holeH = holeW / aspect
  if (holeH + bar + border > maxH) { holeH = Math.max(40 * u, maxH - bar - border); holeW = holeH * aspect }
  const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2)
  holeW = even(holeW); holeH = even(holeH)
  const outerW = holeW + 2 * border, outerH = holeH + bar + border
  const x = Math.round((W - outerW) / 2), y = Math.round(top + (bandH - outerH) / 2)
  return { window: { x, y, w: outerW, h: outerH }, hole: { x: x + border, y: y + bar, w: holeW, h: holeH }, bar, border, radius }
}

// ---------------------------------------------------------------------------
// Word timing: text cards that build word by word reveal each word as it is said.
// ---------------------------------------------------------------------------

/** Templates whose words build one by one and may carry `word_ms` (each word's spoken time). */
export const WORD_TIMED_TEMPLATES: readonly string[] = ['big_words', 'title', 'statement', 'headline_pill', 'takeover']
/** A word-timed card holds at least this long after its last word starts being said. */
export const WORD_HOLD_MS = 700
/** A word-timed card starts at most this much before its first word. */
export const WORD_LEAD_MS = 100

/** The words a word-timed card shows, in reading order (the ones `word_ms` times). */
export function cardWords(template: string, fields: Record<string, string>): string[] {
  const split = (t: string | undefined): string[] => (t ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (template === 'big_words') return bigWords(fields.text).flat()
  if (template === 'headline_pill') return [...split(fields.text), ...split(fields.phrase)]
  if (template === 'statement') return [...split(fields.text), ...split(fields.subline)]
  if (template === 'takeover') return takeoverLines(fields.text).flat()
  return split(fields.text)
}

/**
 * When each word comes in (ms into the graphic) from the optional `word_ms` field: one time per word, in order.
 * Null when it is missing or doesn't fit (the template's own beats are used).
 */
export function graphicWordTimes(fields: Record<string, string>, count: number, durationMs: number): number[] | null {
  const text = fields.word_ms
  if (!text || count < 1) return null
  const times = text.split(/[\s,]+/).filter(Boolean).map(Number)
  if (times.length !== count || times.some((t, i) => !Number.isFinite(t) || t < 0 || t > durationMs || (i > 0 && t < times[i - 1]))) return null
  return times.map((t) => Math.round(t))
}

/** A transcript word with its time (source ms). */
export interface TimedWord { word: string; start_ms: number; end_ms: number }
const wordKey = (w: string): string => w.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}']+/gu, '').replace(/'s$/, '')

/**
 * A word-timed card fitted to where its words are said near `around` (source ms, within `windowMs`): it starts
 * just before the first word (WORD_LEAD_MS), lasts until WORD_HOLD_MS after the last word ends (at least
 * GRAPHIC_MIN_MS) and carries each word's offset (`word_ms`). Null when its words aren't said there in order.
 */
export function matchCardWords<G extends Pick<EditorGraphic, 'template' | 'fields' | 'at_ms' | 'duration_ms'>>(g: G, words: readonly TimedWord[], around = g.at_ms, windowMs = 6000): G | null {
  if (!WORD_TIMED_TEMPLATES.includes(g.template)) return null
  const want = cardWords(g.template, g.fields).map(wordKey).filter(Boolean)
  if (!want.length) return null
  const near = words.filter((w) => w.start_ms >= around - windowMs && w.start_ms <= around + windowMs).map((w) => ({ ...w, key: wordKey(w.word) }))
  let best: TimedWord[] | null = null
  for (let i = 0; i < near.length; i++) {
    if (near[i].key !== want[0]) continue
    const found: TimedWord[] = [near[i]]
    let k = i + 1
    for (const w of want.slice(1)) {
      // The next word follows within two words (a filler word may sit between).
      const hit = near.slice(k, k + 3).findIndex((x) => x.key === w)
      if (hit < 0) break
      found.push(near[k + hit]); k += hit + 1
    }
    if (found.length !== want.length) continue
    if (!best || Math.abs(found[0].start_ms - around) < Math.abs(best[0].start_ms - around)) best = found
  }
  if (!best) return null
  const at = Math.max(0, best[0].start_ms - WORD_LEAD_MS)
  const last = best[best.length - 1]
  // On screen until WORD_HOLD_MS after the last word ends (and at least 1.2 s), at most 8 s.
  const duration = clampGraphicMs(Math.max(1200, last.end_ms + WORD_HOLD_MS - at))
  // Each word's offset; one too late for the card's length is pulled in.
  const offsets = best.map((w) => Math.max(0, Math.min(duration - 300, w.start_ms - at)))
  return { ...g, at_ms: at, duration_ms: duration, fields: { ...g.fields, word_ms: offsets.join('\n') } }
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

/**
 * Call to action (`link_cta`): what it asks for. The icon on its button follows it; the words on the button are always
 * the speaker's (`text`), and `where` is where the link is, as said ("below", "in my bio").
 */
export const CTA_KINDS = ['link', 'comment', 'dm', 'follow', 'save', 'share'] as const
export type CtaKind = (typeof CTA_KINDS)[number]
export function ctaKind(fields: Record<string, string>): CtaKind {
  return (CTA_KINDS as readonly string[]).includes(fields.kind) ? fields.kind as CtaKind : 'link'
}
/** The chevrons point down to the link: where it is (or the button's own words) says below, bio, description… */
export function ctaPointsDown(fields: Record<string, string>): boolean {
  return /\b(below|bio|profile|description|caption|comments?|down)\b/i.test(`${fields.where ?? ''} ${fields.text ?? ''}`)
}

/** A Type takeover's most words (one short line said). */
export const MAX_TAKEOVER_WORDS = 9
/**
 * A Type takeover's lines: its words (at most MAX_TAKEOVER_WORDS) in reading order, broken into short lines of one to
 * three words (about 11 letters a line, at most five lines), so each line can be set huge across the frame.
 */
export function takeoverLines(text: string | undefined): string[][] {
  const words = (text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, MAX_TAKEOVER_WORDS)
  if (!words.length) return []
  const lines: string[][] = []
  for (const word of words) {
    const last = lines.at(-1)
    if (last && last.length < 3 && last.join(' ').length + 1 + word.length <= 11) last.push(word)
    else lines.push([word])
  }
  // Too many short lines: join the shortest neighbors until five are left.
  const size = (i: number): number => lines[i].join(' ').length + lines[i + 1].join(' ').length
  while (lines.length > 5) {
    let best = 0
    for (let i = 1; i < lines.length - 1; i++) if (size(i) < size(best)) best = i
    lines.splice(best, 2, [...lines[best], ...lines[best + 1]])
  }
  return lines
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
    case 'link_cta': return !!f.text?.trim()
    case 'big_words': return bigWords(f.text).length > 0
    case 'orbit': return orbitNodes(f).length >= 1 || !!f.text?.trim() || !!f.image
    case 'feature_tile': return graphicItems(f.items).length > 0
    case 'screen_frame': return isScreenVideo(f.video)
    case 'chapter': return !!(f.title?.trim() || f.label?.trim())
    case 'staircase': case 'funnel': case 'journey': case 'growth': case 'idea_hub': case 'compare_marks':
      return templateItems(g.template, f.items).length >= DIAGRAM_MIN_ITEMS[g.template]
    case 'fx': return fxHasContent(f)
    case 'takeover': return takeoverLines(f.text).length > 0
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
  const placement = options.placement ?? (template === 'lower_third' ? 'bottom' : template === 'title' || template === 'comment_cta' || isDiagram(template) ? 'middle' : 'top')
  // Big words start behind the speaker; the others in front unless asked.
  const depth = options.depth ?? (template === 'big_words' ? 'behind' : undefined)
  // Diagrams start stage size: they fill the middle of the frame (under a chapter header).
  const size = isGraphicSize(options.size) ? options.size : isDiagram(template) ? 'stage' : undefined
  return { id, template, at_ms: Math.max(0, Math.round(at_ms)), duration_ms: clampGraphicMs(options.duration_ms ?? GRAPHIC_DEFAULT_MS[template], template), placement, fields, origin: options.origin ?? 'member', ...(size ? { size } : {}),
    ...(depth && depthFits(template, depth) ? { depth } : {}) }
}

/** A length kept to 0.8 s to the template's longest (graphicMaxMs: 8 s for most). */
export function clampGraphicMs(ms: number, template?: string): number {
  return Math.round(Math.max(GRAPHIC_MIN_MS, Math.min(graphicMaxMs(template), Number.isFinite(ms) ? ms : GRAPHIC_MIN_MS)))
}

type Timing = { ranges: [number, number][]; video_speed: number }

/** Keep a graphic inside its clip: it starts within the clip's span and is 0.8–8 s long. */
export function fitGraphicToClip(g: EditorGraphic, c: Timing): EditorGraphic {
  const start = c.ranges[0][0], end = c.ranges[c.ranges.length - 1][1]
  const duration_ms = clampGraphicMs(Math.min(g.duration_ms, Math.max(GRAPHIC_MIN_MS, end - start)), g.template)
  const at_ms = Math.round(Math.max(start, Math.min(end - Math.min(duration_ms, end - start), g.at_ms)))
  return at_ms === g.at_ms && duration_ms === g.duration_ms ? g : { ...g, at_ms, duration_ms }
}

/** The clip's graphics with `g` added (or replacing the one with its id), kept in its clip and in time order. Throws past the limit. */
export function withGraphic(c: Timing & { graphics?: EditorGraphic[] }, g: EditorGraphic, limit: number = MAX_GRAPHICS_PER_CLIP): EditorGraphic[] {
  const list = c.graphics ?? []
  const exists = list.some((x) => x.id === g.id)
  if (!exists && list.length >= limit) throw new Error(`Add up to ${limit} graphics to a clip.`)
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
  // Word times belong to the words where they were said: a card moved or reworded loses them (its own beats are used).
  if (fields.word_ms && ((patch.at_ms !== undefined && Math.round(patch.at_ms) !== g.at_ms) || ['text', 'phrase', 'subline'].some((k) => patch.fields?.[k] !== undefined && patch.fields[k] !== g.fields[k]))) delete fields.word_ms
  // An effect's cue times belong to its words where they were said: moved, reworded or another effect, they go.
  if (fields.cue_ms && g.template === 'fx') {
    const cue = fxEffect(g.fields.effect)?.cue?.field
    if ((patch.at_ms !== undefined && Math.round(patch.at_ms) !== g.at_ms) || (patch.fields?.effect !== undefined && patch.fields.effect !== g.fields.effect) || (cue && patch.fields?.[cue] !== undefined && patch.fields[cue] !== g.fields[cue])) delete fields.cue_ms
  }
  // A diagram's item times belong to its items as said: changed items lose them (even beats are used until matched again).
  if (fields.item_ms && isDiagram(g.template) && patch.fields?.items !== undefined && patch.fields.items !== g.fields.items) delete fields.item_ms
  const { fields: _ignored, size, depth, ...rest } = patch
  void _ignored
  const template = rest.template ?? g.template
  const next: EditorGraphic = { ...g, ...rest, ...(rest.duration_ms !== undefined ? { duration_ms: clampGraphicMs(rest.duration_ms, template) } : {}), fields }
  if (size !== undefined) { if (isGraphicSize(size) && size !== 'card') next.size = size; else delete next.size }
  // Depth is kept as set (Big words keeps an explicit 'front'); a template that can't go behind has none.
  if (depth !== undefined) { if (depthFits(next.template, depth)) next.depth = depth; else delete next.depth }
  if (next.depth && !depthFits(next.template, next.depth)) delete next.depth
  return withGraphic(c, next)
}

/** Fields every template keeps when it is switched to another: its own color and font. */
const STYLE_FIELDS = ['color', 'font'] as const
const cleanLine = (t: string | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim()

/** The words a graphic shows: its main line and its items (for switching it to another template). */
export function graphicWords(g: Pick<EditorGraphic, 'template' | 'fields'>): { line: string; items: string[]; title: string } {
  const f = g.fields
  const items = (f.items ?? '').split(/\r?\n/).map(cleanLine).filter(Boolean)
  const title = cleanLine(f.title)
  switch (g.template) {
    case 'stat': return { line: [f.value, f.label].map(cleanLine).filter(Boolean).join(' '), items, title }
    case 'headline_pill': return { line: [f.text, f.phrase].map(cleanLine).filter(Boolean).join(' '), items: [f.text, f.phrase].map(cleanLine).filter(Boolean), title }
    case 'before_after': return { line: cleanLine(f.before || f.after), items: [f.before, f.after].map(cleanLine).filter(Boolean), title }
    case 'strike_list': return { line: cleanLine(f.final) || items[0] || '', items: [...items, cleanLine(f.final)].filter(Boolean), title }
    case 'lower_third': return { line: cleanLine(f.name), items: [f.name, f.role].map(cleanLine).filter(Boolean), title }
    case 'chapter': return { line: title, items: title ? [title] : [], title: '' }
    case 'comment_cta': return { line: cleanLine(f.keyword), items, title }
    case 'browser_frame': return { line: title, items, title: '' }
    case 'logo': return { line: cleanLine(f.caption), items, title }
    case 'fx': { const line = fxLine(f); return { line, items: line ? [line] : [], title: '' } }
    default: {
      const line = cleanLine(f.text) || title || items[0] || ''
      // A title over items (a list, a diagram) stays a title; a lone title is the line.
      return { line, items: items.length ? items : line ? [line] : [], title: items.length ? title : '' }
    }
  }
}

/**
 * The graphic as another template, keeping its words: the main line goes to the new template's words, its items
 * (or its line) to the new one's items, and its time, place, color and font stay. Word and item times are dropped
 * (match them again). A diagram starts stage size; a graphic leaving a diagram goes back to card size.
 */
export function switchGraphicTemplate(g: EditorGraphic, to: GraphicTemplateId): EditorGraphic {
  if (g.template === to) return g
  const { line, items, title } = graphicWords(g)
  const fields: Record<string, string> = {}
  for (const key of STYLE_FIELDS) if (g.fields[key]) fields[key] = g.fields[key]
  const target = templateInfo(to).fields as readonly string[]
  const list = items.length ? items : line ? [line] : []
  const limit = GRAPHIC_ITEM_LIMITS[to] ?? MAX_GRAPHIC_ITEMS
  if (to === 'stat') {
    const n = /[$€£]?\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMxX]\b|thousand\b|million\b|billion\b)?/.exec(line)
    if (n) { fields.value = n[0].trim(); const rest = cleanLine(line.replace(n[0], '')); if (rest) fields.label = rest } else if (line) fields.label = line
  } else if (to === 'headline_pill') {
    if (list.length > 1) { fields.text = list[0]; fields.phrase = list[1] } else if (line) {
      const words = line.split(' '), half = Math.max(1, Math.ceil(words.length / 2))
      fields.text = words.slice(0, half).join(' '); if (words.length > half) fields.phrase = words.slice(half).join(' ')
    }
  } else if (to === 'before_after') { if (list[0]) fields.before = list[0]; if (list[1]) fields.after = list[1] }
  else if (to === 'strike_list') {
    if (list.length > 1) { fields.items = list.slice(0, -1).slice(0, limit).join('\n'); fields.final = list[list.length - 1] } else if (line) fields.final = line
  } else if (to === 'lower_third') { if (list[0]) fields.name = list[0]; if (list[1]) fields.role = list[1] }
  else if (to === 'chapter') { if (line) fields.title = line; if (g.template === 'chapter' && g.fields.label) fields.label = g.fields.label }
  else if (to === 'comment_cta') { const word = line.split(' ')[0]; if (word) fields.keyword = word.replace(/[^\p{L}\p{N}]+/gu, '').toUpperCase() }
  else if (to === 'browser_frame') { if (line) fields.title = line }
  else if (to === 'logo') { if (line) fields.caption = line; if (g.fields.image) fields.image = g.fields.image }
  else if (to === 'fx') { fields.effect = 'per-word-rise'; if (line) fields.text = line }
  else if (to === 'big_words') { const words = line.split(' ').filter(Boolean).slice(0, MAX_BIG_WORDS); if (words.length) fields.text = words.join(' ') }
  else if (target.includes('items')) {
    if (list.length) fields.items = list.slice(0, limit).join('\n')
    if (target.includes('title') && title) fields.title = title
    if (target.includes('text') && (to === 'orbit' || to === 'idea_hub') && (g.template === 'orbit' || g.template === 'idea_hub') && g.fields.text) fields.text = g.fields.text
  } else if (target.includes('text')) { const text = line || list.join(' '); if (text) fields.text = text }
  if (graphicUsesImage(to) && g.fields.image && !fields.image) fields.image = g.fields.image
  if (to === 'highlight') Object.assign(fields, { shape: g.fields.shape === 'arrow' ? 'arrow' : 'circle', x: g.fields.x ?? '0.5', y: g.fields.y ?? '0.45' })
  if (to === 'screen_frame') { fields.video = 'source'; if (g.fields.from) fields.from = g.fields.from }
  for (const key of Object.keys(fields)) if (key !== 'items') fields[key] = fields[key].slice(0, MAX_GRAPHIC_FIELD_CHARS)
  const size: GraphicSize | undefined = isDiagram(to) ? 'stage' : isDiagram(g.template) ? undefined : g.size
  const depth: GraphicDepth | undefined = depthFits(to, g.depth) ? g.depth : graphicCanGoBehind(to) && to === 'big_words' ? 'behind' : undefined
  const { size: _size, depth: _depth, ...rest } = g
  void _size; void _depth
  return { ...rest, template: to, duration_ms: clampGraphicMs(g.duration_ms, to), fields, ...(size && size !== 'card' ? { size } : {}), ...(depth ? { depth } : {}) }
}

/** A copy of a graphic with a new id (and the member as its author), starting at `at_ms` (default: right after it). */
export function duplicateGraphic(g: EditorGraphic, taken: Iterable<string>, at_ms = g.at_ms + g.duration_ms): EditorGraphic {
  const ids = new Set(taken)
  let id = randomId()
  while (ids.has(id)) id = randomId()
  return { ...g, id, at_ms: Math.max(0, Math.round(at_ms)), origin: 'member', fields: { ...g.fields } }
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
  let at = Math.max(start, Math.round(g.at_ms)), duration = clampGraphicMs(g.duration_ms, (g as { template?: string }).template)
  if (at + duration > end) at = Math.max(start, end - duration)
  if (!c.ranges.some(([a, b]) => at >= a && at < b)) at = c.ranges.find(([a]) => a > at)?.[0] ?? at
  duration = Math.min(duration, end - at)
  if (duration < GRAPHIC_MIN_MS) return null
  if (at === g.at_ms && duration === g.duration_ms) return g
  const moved = { ...g, at_ms: at, duration_ms: duration }
  // Item and word times are ms from the graphic's start: moved with it, they stay on the words where they're said.
  const fields = (g as { fields?: Record<string, string> }).fields
  if (fields && at !== g.at_ms && (fields.item_ms || fields.word_ms || fields.cue_ms)) {
    const next = { ...fields }
    for (const key of ['item_ms', 'word_ms', 'cue_ms'] as const) {
      if (!next[key]) continue
      const times = next[key].split(/[\s,]+/).filter(Boolean).map(Number)
      if (times.every(Number.isFinite)) next[key] = times.map((t) => String(Math.max(0, Math.min(duration, Math.round(t + g.at_ms - at))))).join('\n')
      else delete next[key]
    }
    return { ...moved, fields: next }
  }
  return moved
}

/** Graphics that sit in a band (an arrow or circle points at a spot instead). */
const usesBand = (g: Pick<EditorGraphic, 'template'>): boolean => g.template !== 'highlight'
/** A chapter header has a band of its own at the very top (where the hook was): other graphics keep below it. */
const isChapter = (g: Pick<EditorGraphic, 'template'>): boolean => g.template === 'chapter'
/** A stage-size graphic takes the top of the frame over every band. */
const onStage = (g: { size?: GraphicSize }): boolean => g.size === 'stage'
/** The order a new graphic tries the bands in when its own is taken. */
export const GRAPHIC_BAND_ORDER: readonly GraphicPlacement[] = ['top', 'bottom', 'middle']

type Placed = Pick<EditorGraphic, 'id' | 'template' | 'at_ms' | 'duration_ms' | 'placement'> & { size?: GraphicSize }
/** True when two graphics share a band (a stage-size one shares every band) and are on screen at the same time. */
export function graphicsClash(a: Placed, b: Placed): boolean {
  const overlap = a.at_ms < b.at_ms + b.duration_ms && b.at_ms < a.at_ms + a.duration_ms
  // Chapter headers only clash with each other (two headers at once); the rest stay under them.
  if (isChapter(a) || isChapter(b)) return a.id !== b.id && isChapter(a) && isChapter(b) && overlap
  return a.id !== b.id && usesBand(a) && usesBand(b) && (a.placement === b.placement || onStage(a) || onStage(b)) && overlap
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
  if (!usesBand(g) || onStage(g) || isChapter(g)) return g
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
