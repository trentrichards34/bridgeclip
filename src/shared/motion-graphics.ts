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
