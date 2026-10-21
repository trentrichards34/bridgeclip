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
  { id: 'highlight', label: 'Arrow or circle', detail: 'Points at something on screen.', fields: ['shape', 'x', 'y'] }
] as const

export type GraphicTemplateId = (typeof GRAPHIC_TEMPLATES)[number]['id']
export const GRAPHIC_TEMPLATE_IDS: readonly GraphicTemplateId[] = GRAPHIC_TEMPLATES.map((t) => t.id)
export type GraphicPlacement = 'top' | 'middle' | 'bottom'
export const GRAPHIC_PLACEMENTS: readonly GraphicPlacement[] = ['top', 'middle', 'bottom']

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
    return { id: g.id, template: g.template, at_ms: Math.round(g.at_ms), duration_ms: Math.round(g.duration_ms), placement, fields, ...(origin ? { origin } : {}) }
  }).sort((a, b) => a.at_ms - b.at_ms)
}

// ---------------------------------------------------------------------------
// Helpers shared by the editor (Graphics row, inspector, chat) and main.
// ---------------------------------------------------------------------------

/** Bump when a template's look changes, so cached renders are made again. */
export const GRAPHICS_VERSION = 1
/** Rendered graphics are layered over the clip at this frame rate. */
export const GRAPHIC_FPS = 30
/** A graphic left with less than this much on screen after the cut is dropped. */
export const GRAPHIC_MIN_OUTPUT_MS = 400
export const MAX_GRAPHIC_ITEMS = 5
export type GraphicHighlightShape = 'circle' | 'arrow'

/** How long a new graphic of each kind lasts (ms). */
export const GRAPHIC_DEFAULT_MS: Record<GraphicTemplateId, number> = {
  stat: 3500, title: 2500, list: 5000, lower_third: 4000, logo: 3000, before_after: 4000, checklist: 5000, quote: 5000, highlight: 2500
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
}

export function templateInfo(id: GraphicTemplateId): (typeof GRAPHIC_TEMPLATES)[number] {
  return GRAPHIC_TEMPLATES.find((t) => t.id === id) ?? GRAPHIC_TEMPLATES[0]
}

/** A list field's lines: trimmed, non-empty, at most 5. */
export function graphicItems(text: string | undefined): string[] {
  return (text ?? '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_GRAPHIC_ITEMS)
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
export function newGraphic(template: GraphicTemplateId, at_ms: number, options: { fields?: Record<string, string>; duration_ms?: number; placement?: GraphicPlacement; origin?: EditorGraphic['origin']; taken?: Iterable<string> } = {}): EditorGraphic {
  const taken = new Set(options.taken ?? [])
  let id = randomId()
  while (taken.has(id)) id = randomId()
  const fields: Record<string, string> = template === 'highlight' ? { shape: 'circle', x: '0.5', y: '0.45' } : {}
  for (const [key, value] of Object.entries(options.fields ?? {})) if (/^[a-z_]{1,20}$/.test(key) && typeof value === 'string') fields[key] = value.slice(0, key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS)
  const placement = options.placement ?? (template === 'lower_third' ? 'bottom' : template === 'title' ? 'middle' : 'top')
  return { id, template, at_ms: Math.max(0, Math.round(at_ms)), duration_ms: clampGraphicMs(options.duration_ms ?? GRAPHIC_DEFAULT_MS[template]), placement, fields, origin: options.origin ?? 'member' }
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
export function updateGraphic(c: Timing & { graphics?: EditorGraphic[] }, id: string, patch: Partial<Pick<EditorGraphic, 'at_ms' | 'duration_ms' | 'placement' | 'template'>> & { fields?: Record<string, string> }): EditorGraphic[] {
  const g = (c.graphics ?? []).find((x) => x.id === id)
  if (!g) return c.graphics ?? []
  const fields = { ...g.fields }
  for (const [key, value] of Object.entries(patch.fields ?? {})) {
    if (!/^[a-z_]{1,20}$/.test(key) || typeof value !== 'string') continue
    if (value === '' && key !== 'image') fields[key] = ''
    else if (value === '') delete fields[key]
    else fields[key] = value.slice(0, key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS)
  }
  const { fields: _ignored, ...rest } = patch
  void _ignored
  return withGraphic(c, { ...g, ...rest, ...(rest.duration_ms !== undefined ? { duration_ms: clampGraphicMs(rest.duration_ms) } : {}), fields })
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
/** The order a new graphic tries the bands in when its own is taken. */
export const GRAPHIC_BAND_ORDER: readonly GraphicPlacement[] = ['top', 'bottom', 'middle']

type Placed = Pick<EditorGraphic, 'id' | 'template' | 'at_ms' | 'duration_ms' | 'placement'>
/** True when two graphics share a band and are on screen at the same time. */
export function graphicsClash(a: Placed, b: Placed): boolean {
  return a.id !== b.id && usesBand(a) && usesBand(b) && a.placement === b.placement &&
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
  if (!usesBand(g)) return g
  const free = (placement: GraphicPlacement): boolean => !others.some((o) => graphicsClash(o, { ...g, placement }))
  if (free(g.placement)) return g
  const band = GRAPHIC_BAND_ORDER.find(free)
  return band ? { ...g, placement: band } : g
}
