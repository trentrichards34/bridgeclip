/**
 * Motion graphics outside the clip editor: on a reel from Edit my recording
 * and on the member's part of a Remix (Their clip then me, React then my
 * thoughts, Pause & react, Moment + my take). The templates, fields and render
 * are the clip editor's (motion-graphics.ts, graphic-layout.ts); what differs
 * is where a graphic is anchored and what it must keep clear of.
 *
 * - Edit my recording: a graphic starts on a WORD (an index into the plan's
 *   words), so it stays on what was said when the cut or the hook changes. A
 *   graphic can't sit during a half-screen card (it is left out with a warning)
 *   and pop-ups or pinned images during a graphic give way to it.
 * - Remix: a graphic starts at a time in the member's part (ms into their take
 *   as recorded; Pause & react: ms into the finished video). Bands keep it clear
 *   of their clip's box, the split line, the comment banner and the hook; the
 *   engine leaves out one that plays during a proof screenshot.
 *
 * Logo pop needs a picture copied into the run: it is only in the clip editor.
 */
import { chatFail as fail, chatPlainText } from './chat-core'
import { checkHighlightFields } from './chat-point'
import { graphicBandSize, graphicBox, graphicOwnFont, GRAPHIC_DEFAULT_COLOR, outputSize, type GraphicFrame } from './graphic-layout'
import { HEADLINE_FONTS, isHexColor, type HeadlineLook } from './headline-look'
import { DIAGRAM_ACCENT, GRAPHIC_TEMPLATES, MAX_GRAPHIC_FIELD_CHARS, isDiagram, graphicDepth, MAX_GRAPHICS_PER_CLIP, clampGraphicMs, templateInfo, graphicHasContent, parseGraphics, type EditorGraphic, type GraphicPlacement, type GraphicRenderSpec, type GraphicTemplateId } from './motion-graphics'

/** The templates offered on review screens (every one but Logo pop and Screen recording, which need the clip editor's files, and the chapter header, which belongs to a clip's sections). */
export const REEL_GRAPHIC_TEMPLATES = GRAPHIC_TEMPLATES.filter((t) => t.id !== 'logo' && t.id !== 'screen_frame' && t.id !== 'chapter')
export const MAX_REEL_GRAPHICS = 8
/** An edited reel (Edit my recording): the automatic direction plans about one graphic per 6 s of a long reel. */
export const MAX_EDIT_GRAPHICS = MAX_GRAPHICS_PER_CLIP

/** The hook text's share of the frame's height at the top (0: none, too short to draw, or not at the top). */
export function hookShareFor(text: string, look: Pick<HeadlineLook, 'look'> | null | undefined): number {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean || look?.look === 'none' || clean.split(' ').length < 2) return 0
  const lines = Math.min(3, Math.ceil(clean.length / 24))
  return Math.min(.3, Math.max(.17, .105 + lines * .038))
}

/** A graphic's color and font on a reel: its own color, else the brand look's color, else a calm blue; the hook's font. */
export function reelGraphicStyle(look: HeadlineLook | null | undefined, graphic?: Pick<EditorGraphic, 'fields'> & { template?: string }): { color: string; font: string } {
  const own = graphic?.fields.color
  // Diagrams light up in green unless they have their own color.
  const color = isHexColor(own) ? own.toUpperCase() : graphic?.template && isDiagram(graphic.template) ? DIAGRAM_ACCENT : look?.look === 'brand' && isHexColor(look.color) ? look.color.toUpperCase() : GRAPHIC_DEFAULT_COLOR
  const font = graphicOwnFont(graphic) ?? (look && HEADLINE_FONTS.some((f) => f.id === look.font) ? look.font : 'clean')
  return { color, font }
}

/** What a reel graphic draws (1080×1920), lasting `durationMs` on screen. */
export function reelGraphicSpec(graphic: Pick<EditorGraphic, 'template' | 'fields' | 'placement' | 'size'>, frame: GraphicFrame, durationMs: number, look: HeadlineLook | null | undefined): GraphicRenderSpec {
  const { width, height } = outputSize('9:16')
  const fields = { ...graphic.fields }
  delete fields.image
  delete fields.color
  delete fields.font
  // On a reel a diagram sits over the video: on its blue panel.
  if (isDiagram(graphic.template)) fields.panel = 'on'
  return { template: graphic.template, fields, width, height, duration_ms: Math.round(durationMs), box: graphicBox(graphic.placement, frame, graphicBandSize(graphic)), placement: graphic.placement,
    ...reelGraphicStyle(look, graphic), ...(graphic.size && graphic.size !== 'card' ? { size: graphic.size } : {}) }
}

/** Checks graphics from the page (or the chat) the clip editor's way, then keeps reel rules: no Logo pop, up to 8. */
function parseReelGraphicList(value: unknown, at: (raw: Record<string, unknown>) => number, limit = MAX_REEL_GRAPHICS): EditorGraphic[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Add up to ${limit} graphics.`)
  const graphics = parseGraphics(value.map((raw) => raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>), at_ms: at(raw as Record<string, unknown>) } : raw))
  if (graphics.some((g) => g.template === 'logo')) throw new Error('Logo pop graphics are only in the clip editor.')
  return graphics
}

// ---------------------------------------------------------------------------
// Edit my recording
// ---------------------------------------------------------------------------

/** A graphic on an edited reel: it starts as `word` is said. */
export type EditGraphic = Omit<EditorGraphic, 'at_ms'> & { word: number }

/** The reel's graphics from the page, checked against the plan's words (throws a plain message). */
export function parseEditGraphics(value: unknown, words: number): EditGraphic[] {
  const parsed = parseReelGraphicList(value, (raw) => typeof raw.word === 'number' && Number.isInteger(raw.word) && raw.word >= 0 && raw.word < words ? raw.word : -1, MAX_EDIT_GRAPHICS)
  return parsed.map(({ at_ms, ...rest }) => ({ ...rest, word: at_ms })).sort((a, b) => a.word - b.word)
}

/** Where a reel's graphic sits: under the hook text, clear of the captions (pop-ups and pinned images give way to it). */
export function editGraphicFrame(hookText: string, look: { headlineLook: HeadlineLook; includeCaptions: boolean }): GraphicFrame {
  const hook = hookShareFor(hookText, look.headlineLook)
  return { aspect: '9:16', hook, captions: look.includeCaptions ? { y: hook + (1 - hook) * .72, bottom: false } : null }
}

/** A new Edit graphic on a word, with words the member (or what was said) gives it. */
export function newEditGraphic(base: EditorGraphic, word: number): EditGraphic {
  const { at_ms: _at, ...rest } = base
  void _at
  return { ...rest, word }
}

/** Change one Edit graphic (merged fields; an empty string clears one). */
export function patchEditGraphic(graphics: EditGraphic[], id: string, patch: Partial<Pick<EditGraphic, 'word' | 'duration_ms' | 'placement' | 'depth'>> & { fields?: Record<string, string> }): EditGraphic[] {
  return graphics.map((g) => {
    if (g.id !== id) return g
    const fields = { ...g.fields }
    for (const [key, value] of Object.entries(patch.fields ?? {})) {
      if (!/^[a-z_]{1,20}$/.test(key) || typeof value !== 'string') continue
      fields[key] = value.slice(0, key === 'items' ? 800 : 160)
    }
    // A planned graphic whose words the member changed is theirs from here on (the reel keeps it as typed).
    const typed = patch.fields !== undefined && Object.keys(patch.fields).length > 0 && g.origin === 'auto'
    return { ...g, ...(patch.word !== undefined ? { word: patch.word } : {}), ...(patch.placement ? { placement: patch.placement } : {}), ...(patch.depth ? { depth: patch.depth } : {}),
      ...(patch.duration_ms !== undefined ? { duration_ms: clampGraphicMs(patch.duration_ms, g.template) } : {}), fields, ...(typed ? { origin: 'member' as const } : {}) }
  }).sort((a, b) => a.word - b.word)
}

// ---------------------------------------------------------------------------
// Remix: the member's part
// ---------------------------------------------------------------------------

export type RemixGraphicFormat = 'clip_then_me' | 'react_thoughts' | 'pause_react' | 'moment_take'
export function isRemixGraphicFormat(value: unknown): value is RemixGraphicFormat {
  return value === 'clip_then_me' || value === 'react_thoughts' || value === 'pause_react' || value === 'moment_take'
}

/** The "My take" label shows for the first 1.2 s of the take: graphics start after it. */
export const TAKE_GRAPHIC_FROM_MS = 1300

/** What decides the bands of a Remix (from the run's request, fixed for the review). */
export interface RemixGraphicContext {
  format: RemixGraphicFormat
  /** Pause & react: their video in a box at the top, or the top half. */
  pauseLayout: 'box' | 'split'
  /** Where the hook text sits ('seam' on the split line, 'beside' the head in part 1, else the top). */
  hookAt: 'top' | 'seam' | 'beside'
  headlineLook: HeadlineLook | null
  includeCaptions: boolean
  /** Moment + my take: the moment loops small at the top right while the member talks. */
  momentPip: boolean
}

/** The bands a Remix graphic must keep clear of, as shares of the frame's height. `banner`: React, then my thoughts' comment banner is on. */
export function remixGraphicFrame(ctx: RemixGraphicContext, headline: string, banner = false): GraphicFrame {
  const top = ctx.hookAt === 'top' || ctx.format !== 'pause_react' ? hookShareFor(headline, ctx.headlineLook) : 0
  const blocked: [number, number][] = []
  if (ctx.format === 'pause_react') {
    if (ctx.pauseLayout === 'split') {
      // Their video fills the top half (the split line under it); the hook text may sit on that line.
      const half = top + (1 - top) / 2
      blocked.push([0, half + .03])
      if (ctx.hookAt === 'seam') blocked.push([half - .06, half + .06])
    } else {
      // Their video in its white box at the top (about 56% of the space under the hook), its credit under it.
      const boxTop = top + 40 / 1920
      blocked.push([top, boxTop + (1 - top) * .56 + .045])
    }
  } else if (ctx.format === 'moment_take' && ctx.momentPip) {
    blocked.push([top, top + .23])
  } else if (ctx.format === 'react_thoughts' && banner) {
    blocked.push([top, top + .13])
  }
  return { aspect: '9:16', hook: top, captions: ctx.includeCaptions ? { y: top + (1 - top) * .72, bottom: false } : null, blocked }
}

/** The member's part's graphics from the page, checked: in the part (from 1.3 s into a take), up to 8 (throws a plain message). */
export function parseRemixGraphics(value: unknown, format: RemixGraphicFormat, partMs: number | null): EditorGraphic[] {
  const graphics = parseReelGraphicList(value, (raw) => typeof raw.at_ms === 'number' ? raw.at_ms : -1)
  const from = format === 'pause_react' ? 0 : TAKE_GRAPHIC_FROM_MS
  for (const g of graphics) {
    if (g.at_ms < from) throw new Error(format === 'pause_react' ? 'A graphic needs a start time.' : 'Start graphics after the “My take” label (1.3 seconds into your take).')
    if (partMs !== null && g.at_ms >= partMs - 400) throw new Error('A graphic starts after your part ends. Move it earlier.')
  }
  return graphics
}

/** Keep a Remix graphic inside the member's part, 0.8–8 s long. */
export function fitRemixGraphic(g: EditorGraphic, format: RemixGraphicFormat, partMs: number): EditorGraphic {
  const from = format === 'pause_react' ? 0 : TAKE_GRAPHIC_FROM_MS
  const duration_ms = clampGraphicMs(Math.min(g.duration_ms, Math.max(800, partMs - from)), g.template)
  const at_ms = Math.round(Math.max(from, Math.min(partMs - Math.min(duration_ms, partMs - from), g.at_ms)))
  return { ...g, at_ms, duration_ms }
}

/** A list of graphics that draw something (words or an arrow), for the render. */
export function drawableGraphics<T extends Pick<EditorGraphic, 'template' | 'fields'>>(graphics: readonly T[]): T[] {
  // A Screen recording needs the clip editor's video files: never drawn on a reel.
  return graphics.filter((g) => g.template !== 'screen_frame' && graphicHasContent(g)).slice(0, MAX_GRAPHICS_PER_CLIP)
}

/** A graphic's words from the model: only the template's fields, plain and short; it must say something. */
export function graphicFields(template: GraphicTemplateId, current: Record<string, string>, value: unknown): Record<string, string> {
  const info = templateInfo(template)
  const fields: Record<string, string> = { ...current }
  if (value !== undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('fields must be an object of text values.')
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'image') fail('The chat can’t add images.')
      if (!(info.fields as readonly string[]).includes(key)) fail(`A ${template} graphic has the fields ${info.fields.join(', ')}.`)
      if (raw === null || raw === '') { delete fields[key]; continue }
      if (typeof raw !== 'string' && typeof raw !== 'number') fail(`fields.${key} must be text.`)
      const limit = key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS
      const text = String(raw)
      if (text.length > limit) fail(`fields.${key} must be at most ${limit} characters.`)
      fields[key] = key === 'items' ? text.split('\n').map((line) => chatPlainText(line, MAX_GRAPHIC_FIELD_CHARS)).filter(Boolean).slice(0, 5).join('\n') : chatPlainText(text, limit)
    }
  }
  if (template === 'highlight') { fields.shape ??= 'circle'; fields.x ??= '0.5'; fields.y ??= '0.45'; checkHighlightFields(fields) }
  if (!info.fields.some((f) => fields[f])) fail(`Give the ${template} graphic its text: ${info.fields.join(', ')}.`)
  return fields
}

export type { GraphicPlacement, GraphicTemplateId }
export { graphicDepth }
