/**
 * Remix's Chat panel, on the review of an on-camera remix (Their clip then
 * me, React then my thoughts, Pause & react, Moment + my take): the member
 * asks in plain words ("make my part shorter", "cut my first sentence",
 * "change the hook", "move their clip box up", "add a stat when I say
 * $1,200") and the model calls these tools. Main checks each call against a
 * copy of the review (an invalid call goes back to the model); the page
 * applies the steps through the review's own setters: the hook text, caption
 * and graphics in the page, and the part of their video, the part of the take
 * and the layout through the same IPC calls its controls use. Undo sets the
 * values from before.
 *
 * Times: their video in source ms; the member's take in ms into the take as
 * recorded (Pause & react: ms into the finished video).
 */
import { chatClock, chatFail as fail, chatPlainText, chatReason, chatSentence, chatText, parseStepsLoose, type ChatReplyOf } from './chat-core'
import { DIAGRAM_MAX_MS, GRAPHIC_MAX_MS, GRAPHIC_MIN_MS, graphicMaxMs, GRAPHIC_PLACEMENTS, MAX_GRAPHIC_FIELD_CHARS, newGraphic, parseGraphics, templateInfo, type EditorGraphic, type GraphicPlacement, type GraphicTemplateId } from './motion-graphics'
import { MAX_REEL_GRAPHICS, REEL_GRAPHIC_TEMPLATES, TAKE_GRAPHIC_FROM_MS, graphicFields, type RemixGraphicFormat } from './reel-graphics'
import { MAX_POST_CAPTION_CHARS, REMIX_WORD_LIMITS, wordCount } from './remix'
import type { BoxAt } from './remix-layouts'
import { PIN_PROP, aimGraphic, pinArg, pointCenter, type ChatPoint } from './chat-point'

export const REMIX_CHAT_SUGGESTIONS = ['Punchier hook', 'Make my part shorter', 'Add a stat graphic', 'Shorten their clip'] as const

/**
 * The chat's suggestion chips for a format: only what its tools can do there ("Make my part shorter" trims the
 * take, which Pause & react and React, then my thoughts can't). `box`: their clip's box can move (React, then my
 * thoughts, big box: where it is now); `banner`: the comment banner is off and a keyword is set, so it can be turned on.
 */
export function remixChatSuggestions(format: RemixGraphicFormat, options: { box?: BoxAt | null; banner?: boolean } = {}): string[] {
  switch (format) {
    case 'clip_then_me': return ['Punchier hook', 'Make my part shorter', 'Add a stat graphic', 'Shorten their clip']
    case 'moment_take': return ['Punchier hook', 'Make my part shorter', 'Cut my first sentence', 'Add a stat graphic']
    case 'pause_react': return ['Punchier hook', 'Add a stat graphic', 'Shorten their video', 'Shorter caption']
    case 'react_thoughts': return ['Punchier hook', 'Add a stat graphic', ...(options.box ? [options.box === 'top' ? 'Put their clip box at the bottom' : 'Put their clip box at the top'] : []),
      ...(options.banner ? ['Show the comment banner'] : []), 'Shorter caption']
  }
}

/** The line under the chat's title, with examples that work in this format. */
export function remixChatIntro(format: RemixGraphicFormat): string {
  const examples = format === 'clip_then_me' || format === 'moment_take' ? '“make my part shorter”, “change the hook” or “add a stat when I say $1,200”'
    : format === 'pause_react' ? '“change the hook”, “start their video later” or “add a stat when I say $1,200”'
      : '“change the hook”, “move their clip box down” or “add a stat when I say $1,200”'
  return `Ask for a change in your own words, like ${examples}. Each answer shows what changed, with Keep or Undo.`
}

/** Where graphics go, in the format's own words ("your take", "your video", "Part 2 · Your thoughts"). */
export function remixPartName(format: RemixGraphicFormat): string {
  return format === 'pause_react' ? 'your video' : format === 'react_thoughts' ? 'Part 2 · Your thoughts' : 'your take'
}
/** Suggestions while the member has pins on the frame. */
export const REMIX_CHAT_POINT_SUGGESTIONS = ['Put an arrow here', 'Put their clip box here', 'Move the graphic here'] as const
export const MAX_HEADLINE_CHARS = 160
/** The shortest part of a take that can be kept (ms). */
export const MIN_TAKE_PART_MS = 2000

/** What the page holds for the take being reviewed (the rest is in main). */
export interface RemixChatState {
  draftId: number
  headline: string
  postCaption: string
  /** On the member's part (see the file note). */
  graphics: EditorGraphic[]
}

/** What main knows about the take, for the tools and the context. */
export interface RemixChatFacts {
  format: RemixGraphicFormat
  /** The part of their video used (source ms), and the limits for changing it; null: it can't be changed from the chat. */
  theirClip: { startMs: number; endMs: number; minMs: number; maxMs: number; limitStartMs: number; limitEndMs: number } | null
  /** Why their clip can't be changed here (shown to the model), when theirClip is null. */
  theirClipNote?: string
  /** The take as recorded (ms; null: not recorded yet) and the part of it used. */
  takeMs: number | null
  takeTrim: { startMs: number; endMs: number } | null
  trimmable: boolean
  /** React, then my thoughts with their clip in a big box: where it goes (null: no box to move). */
  boxAt: BoxAt | null
  /** React, then my thoughts: the comment banner (null: not available). */
  banner: boolean | null
  keyword: string
}

export type RemixChatAction =
  | { kind: 'their_clip'; startMs: number; endMs: number }
  | { kind: 'take_trim'; startMs: number | null; endMs: number | null }
  | { kind: 'layout'; patch: { boxAt?: BoxAt; banner?: boolean } }

export type RemixChatPatch = Partial<Pick<RemixChatState, 'headline' | 'postCaption' | 'graphics'>>
const PATCH_KEYS = ['headline', 'postCaption', 'graphics'] as const

export type RemixChatToolName = 'set_hook_text' | 'set_post_caption' | 'set_their_clip' | 'trim_my_take' | 'set_box_position' | 'set_comment_banner'
  | 'add_graphic' | 'update_graphic' | 'remove_graphic'

export interface RemixChatStep {
  tool: RemixChatToolName
  summary: string
  /** Values the page sets itself. */
  patch: RemixChatPatch
  /** A setter call in main (applied by the page through IPC), with the values to undo it. */
  action?: RemixChatAction
  undo?: RemixChatAction
}
export type RemixChatReply = ChatReplyOf<RemixChatStep>

const graphicFrom = (format: RemixGraphicFormat): number => format === 'pause_react' ? 0 : TAKE_GRAPHIC_FROM_MS

function ms(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a number of milliseconds.`)
  const n = Math.round(value as number)
  if (n < 0 || n > max) fail(`${name} must be between 0 and ${max}.`)
  return n
}

/** Runs one tool call. Returns the step and the changed state and facts, or throws ChatToolError. */
export function applyRemixChatTool(state: RemixChatState, facts: RemixChatFacts, name: string, args: Record<string, unknown>, newId?: () => string, points: readonly ChatPoint[] = []): { step: RemixChatStep; state: RemixChatState; facts: RemixChatFacts } {
  const why = chatReason(args)
  const step = (summary: string, patch: RemixChatPatch, extra: { action?: RemixChatAction; undo?: RemixChatAction; facts?: RemixChatFacts } = {}): { step: RemixChatStep; state: RemixChatState; facts: RemixChatFacts } => ({
    step: { tool: name as RemixChatToolName, summary: chatSentence(summary), patch, ...(extra.action ? { action: extra.action, undo: extra.undo } : {}) },
    state: { ...state, ...patch }, facts: extra.facts ?? facts
  })
  switch (name) {
    case 'set_hook_text': {
      const text = chatText(args.text, 'text', MAX_HEADLINE_CHARS)
      const words = wordCount(text)
      if (words < 3 || words > REMIX_WORD_LIMITS.headline) fail(`Hook text needs 3 to ${REMIX_WORD_LIMITS.headline} words.`)
      return step(`Hook text set to “${text}”${why}`, { headline: text })
    }
    case 'set_post_caption': {
      if (typeof args.text !== 'string' || !args.text.trim()) return fail('text must be the caption.')
      // eslint-disable-next-line no-control-regex
      const text = args.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
      if (text.length > MAX_POST_CAPTION_CHARS) fail(`The caption must be at most ${MAX_POST_CAPTION_CHARS} characters.`)
      return step(`Post caption changed${why}`, { postCaption: text })
    }
    case 'set_their_clip': {
      const clip = facts.theirClip
      if (!clip) return fail(facts.theirClipNote ?? 'Their part can’t be changed from the chat.')
      const a = ms(args.start_ms, 'start_ms', clip.limitEndMs), b = ms(args.end_ms, 'end_ms', clip.limitEndMs)
      if (a < clip.limitStartMs || b > clip.limitEndMs) fail(`Keep it between ${clip.limitStartMs} and ${clip.limitEndMs} ms of their video.`)
      if (b - a < clip.minMs) fail(`Keep at least ${(clip.minMs / 1000).toFixed(1)} seconds of their video.`)
      if (b - a > clip.maxMs) fail(`Use at most ${(clip.maxMs / 1000).toFixed(0)} seconds of their video.`)
      if (a === clip.startMs && b === clip.endMs) fail('Their part already starts and ends there.')
      return step(`Their part set to ${chatClock(a)}–${chatClock(b)} of their video (${((b - a) / 1000).toFixed(1)}s)${why}`, {},
        { action: { kind: 'their_clip', startMs: a, endMs: b }, undo: { kind: 'their_clip', startMs: clip.startMs, endMs: clip.endMs }, facts: { ...facts, theirClip: { ...clip, startMs: a, endMs: b } } })
    }
    case 'trim_my_take': {
      if (!facts.trimmable) return fail(facts.format === 'pause_react' ? 'In Pause & react your recording sets when their video pauses, so it can’t be trimmed here. Record it again to change it.'
        : 'In React, then my thoughts, record part 2 again to change it.')
      if (facts.takeMs === null) return fail('Record your take first.')
      const before = facts.takeTrim ? { kind: 'take_trim' as const, startMs: facts.takeTrim.startMs, endMs: facts.takeTrim.endMs } : { kind: 'take_trim' as const, startMs: null, endMs: null }
      if (args.start_ms === null && args.end_ms === null) {
        if (!facts.takeTrim) fail('Your whole take is already used.')
        return step(`Your whole take is used again${why}`, {}, { action: { kind: 'take_trim', startMs: null, endMs: null }, undo: before, facts: { ...facts, takeTrim: null } })
      }
      const a = ms(args.start_ms ?? 0, 'start_ms', facts.takeMs), b = ms(args.end_ms ?? facts.takeMs, 'end_ms', facts.takeMs)
      if (b - a < MIN_TAKE_PART_MS) fail(`Keep at least ${MIN_TAKE_PART_MS / 1000} seconds of your take.`)
      const whole = a === 0 && b >= facts.takeMs - 50
      return step(whole ? `Your whole take is used${why}` : `Your take now runs ${chatClock(a)}–${chatClock(b)} (${((b - a) / 1000).toFixed(1)}s of ${(facts.takeMs / 1000).toFixed(1)}s)${why}`, {},
        { action: { kind: 'take_trim', startMs: whole ? null : a, endMs: whole ? null : b }, undo: before, facts: { ...facts, takeTrim: whole ? null : { startMs: a, endMs: b } } })
    }
    case 'set_box_position': {
      if (facts.boxAt === null) return fail(facts.format === 'pause_react' ? 'In Pause & react their video already sits at the top (or fills the top half), so it can’t move.'
        : facts.format === 'react_thoughts' ? 'Their clip is a phone card in this layout, so it can’t move.' : 'Their clip plays full screen first in this format, so there is no box to move.')
      const pin = pinArg(args, points)
      // "Put their clip box here": the half of the frame the pin is in.
      const position = args.position ?? (pin ? pointCenter(pin).y < 0.5 ? 'top' : 'bottom' : undefined)
      if (position !== 'top' && position !== 'bottom' && position !== 'auto') return fail('position must be top, bottom or auto (or give a pin).')
      if (position === facts.boxAt) fail('Their clip is already there.')
      const label = position === 'auto' ? 'wherever it doesn’t cover your face' : `at the ${position}`
      return step(`Their clip’s box goes ${label} while you react${why}`, {}, { action: { kind: 'layout', patch: { boxAt: position } }, undo: { kind: 'layout', patch: { boxAt: facts.boxAt } }, facts: { ...facts, boxAt: position } })
    }
    case 'set_comment_banner': {
      if (facts.banner === null) return fail('The comment banner is only in React, then my thoughts.')
      if (typeof args.on !== 'boolean') return fail('on must be true or false.')
      if (args.on && !facts.keyword) fail('Add a comment keyword for the call to action first (it’s set before planning).')
      if (args.on === facts.banner) fail(`The banner is already ${args.on ? 'on' : 'off'}.`)
      return step(`Comment banner ${args.on ? 'on' : 'off'}${why}`, {}, { action: { kind: 'layout', patch: { banner: args.on } }, undo: { kind: 'layout', patch: { banner: facts.banner } }, facts: { ...facts, banner: args.on } })
    }
    case 'add_graphic': case 'update_graphic': {
      const graphics = state.graphics
      const current = name === 'update_graphic' ? graphics.find((g) => g.id === args.id) : undefined
      if (name === 'update_graphic' && !current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The graphics are listed in the context.`)
      if (name === 'add_graphic' && graphics.length >= MAX_REEL_GRAPHICS) fail(`A video can have up to ${MAX_REEL_GRAPHICS} graphics.`)
      if (name === 'add_graphic' && !REEL_GRAPHIC_TEMPLATES.some((t) => t.id === args.template)) return fail(`template must be one of ${REEL_GRAPHIC_TEMPLATES.map((t) => t.id).join(', ')}.`)
      if (facts.takeMs === null) return fail('Record your take first: graphics go on your part.')
      const template = (current?.template ?? args.template) as GraphicTemplateId
      const from = facts.takeTrim ? Math.max(graphicFrom(facts.format), facts.takeTrim.startMs + graphicFrom(facts.format)) : graphicFrom(facts.format)
      const to = facts.takeTrim?.endMs ?? facts.takeMs
      const at = args.at_ms === undefined && current ? current.at_ms : ms(args.at_ms, 'at_ms', facts.takeMs)
      if (at < from) fail(facts.format === 'pause_react' ? 'at_ms must be in the video.' : `at_ms must be at least ${from} (after the “My take” label${facts.takeTrim ? ' in the part of the take used' : ''}).`)
      if (at > to - GRAPHIC_MIN_MS) fail(`at_ms must be before ${to - GRAPHIC_MIN_MS} (the end of your part).`)
      const duration = args.duration_ms === undefined ? current?.duration_ms ?? 3000 : args.duration_ms
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < GRAPHIC_MIN_MS || duration > graphicMaxMs(template)) return fail(`duration_ms must be between ${GRAPHIC_MIN_MS} and ${graphicMaxMs(template)}.`)
      const placement = args.placement === undefined ? current?.placement ?? (template === 'lower_third' ? 'bottom' : 'middle') : args.placement
      if (!(GRAPHIC_PLACEMENTS as readonly unknown[]).includes(placement)) return fail(`placement must be ${GRAPHIC_PLACEMENTS.join(', ')}.`)
      const fields = graphicFields(template, current?.fields ?? {}, args.fields)
      const base = current ?? newGraphic(template, at, { origin: 'chat', taken: graphics.map((g) => g.id) })
      const pin = pinArg(args, points)
      let graphic: EditorGraphic = { ...base, ...(newId && !current ? { id: newId() } : {}), at_ms: at, duration_ms: Math.round(Math.min(duration, to - at)), placement: placement as GraphicPlacement, fields }
      if (pin) { const aimed = aimGraphic(graphic, pin, typeof (args.fields as Record<string, unknown> | undefined)?.shape === 'string'); graphic = { ...aimed, placement: args.placement !== undefined ? graphic.placement : aimed.placement } }
      const next = (current ? graphics.map((g) => g.id === graphic.id ? graphic : g) : [...graphics, graphic]).sort((x, y) => x.at_ms - y.at_ms)
      try { parseGraphics(next) } catch (error) { fail((error as Error).message) }
      return step(`${current ? 'Changed the' : 'Added a'} ${templateInfo(template).label.toLowerCase()} at ${chatClock(at)} of ${facts.format === 'react_thoughts' ? 'part 2 (your thoughts)' : remixPartName(facts.format)}${why}`, { graphics: next })
    }
    case 'remove_graphic': {
      const current = state.graphics.find((g) => g.id === args.id)
      if (!current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The graphics are listed in the context.`)
      return step(`Removed the ${templateInfo(current.template).label.toLowerCase()} at ${chatClock(current.at_ms)}${why}`, { graphics: state.graphics.filter((g) => g.id !== current.id) })
    }
    default:
      return fail(`There is no tool called ${String(name).slice(0, 40)}.`)
  }
}

/** The page's check before applying: the steps' values merged (graphics checked again). */
export function mergeRemixChatSteps(steps: unknown): { patch: RemixChatPatch; actions: RemixChatAction[]; undo: RemixChatAction[] } {
  if (!Array.isArray(steps) || steps.length > 12) throw new Error('The chat sent an invalid edit.')
  const patch: Record<string, unknown> = {}
  const actions: RemixChatAction[] = [], undo: RemixChatAction[] = []
  for (const step of steps as RemixChatStep[]) {
    const p = step?.patch
    if (!p || typeof p !== 'object' || Object.keys(p).some((key) => !(PATCH_KEYS as readonly string[]).includes(key))) throw new Error('The chat sent an invalid edit.')
    Object.assign(patch, structuredClone(p))
    if (step.action) { actions.push(parseAction(step.action)); if (step.undo) undo.unshift(parseAction(step.undo)) }
  }
  if (patch.headline !== undefined && (typeof patch.headline !== 'string' || patch.headline.length > MAX_HEADLINE_CHARS)) throw new Error('The chat sent an invalid edit.')
  if (patch.postCaption !== undefined && (typeof patch.postCaption !== 'string' || patch.postCaption.length > MAX_POST_CAPTION_CHARS)) throw new Error('The chat sent an invalid edit.')
  if (patch.graphics !== undefined) {
    try { patch.graphics = parseGraphics(patch.graphics) } catch { throw new Error('The chat’s graphics don’t fit anymore. Ask again.') }
    if ((patch.graphics as EditorGraphic[]).length > MAX_REEL_GRAPHICS) throw new Error('The chat sent an invalid edit.')
  }
  return { patch: patch as RemixChatPatch, actions, undo }
}

function parseAction(raw: unknown): RemixChatAction {
  const a = (raw ?? {}) as Record<string, unknown>
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4 * 3600_000
  if (a.kind === 'their_clip' && int(a.startMs) && int(a.endMs)) return { kind: 'their_clip', startMs: a.startMs, endMs: a.endMs }
  if (a.kind === 'take_trim' && ((a.startMs === null && a.endMs === null) || (int(a.startMs) && int(a.endMs)))) return { kind: 'take_trim', startMs: a.startMs as number | null, endMs: a.endMs as number | null }
  if (a.kind === 'layout' && a.patch && typeof a.patch === 'object') {
    const p = a.patch as Record<string, unknown>
    const out: { boxAt?: BoxAt; banner?: boolean } = {}
    if (p.boxAt === 'auto' || p.boxAt === 'top' || p.boxAt === 'bottom') out.boxAt = p.boxAt
    if (typeof p.banner === 'boolean') out.banner = p.banner
    if (Object.keys(out).length) return { kind: 'layout', patch: out }
  }
  throw new Error('The chat sent an invalid edit.')
}

export function parseRemixChatSteps(value: unknown): RemixChatStep[] {
  return parseStepsLoose<RemixChatStep>(value, (s) => s.patch && typeof s.patch === 'object'
    ? { patch: s.patch as RemixChatPatch, ...(s.action ? { action: s.action as RemixChatAction } : {}), ...(s.undo ? { undo: s.undo as RemixChatAction } : {}) } : null)
}

const FORMAT_LINES: Record<RemixGraphicFormat, string> = {
  clip_then_me: 'Their clip, then me: their clip plays first (full screen, with its captions), then the member’s take on camera.',
  react_thoughts: 'React, then my thoughts: part 1 is their clip (in a big box or a phone card) while the member reacts silently, then part 2 is the member’s thoughts on camera.',
  pause_react: 'Pause & react: the member fills the frame and their video plays in a box at the top (or the top half), pausing whenever the member talks.',
  moment_take: 'Moment + my take: a moment from their long video plays first, then the member’s take on camera.'
}

/** The take as the model sees it: the format, both parts (with words and times), the hook, caption, layout and graphics. */
export function remixChatContext(state: RemixChatState, facts: RemixChatFacts, words: { take: [string, number, number][] | null; theirs: [string, number, number][] | null; quote: string }): string {
  const lines: string[] = [FORMAT_LINES[facts.format], '']
  if (facts.theirClip) lines.push(`Their part: ${facts.theirClip.startMs}–${facts.theirClip.endMs} ms of their video (${((facts.theirClip.endMs - facts.theirClip.startMs) / 1000).toFixed(1)}s). It can be ${(facts.theirClip.minMs / 1000).toFixed(0)}–${(facts.theirClip.maxMs / 1000).toFixed(0)} s, within ${facts.theirClip.limitStartMs}–${facts.theirClip.limitEndMs} ms.`)
  else if (facts.theirClipNote) lines.push(`Their part can't be changed from the chat: ${facts.theirClipNote}`)
  if (words.theirs?.length) lines.push(`Their words (word@source_ms): ${words.theirs.slice(0, 600).map(([w, a]) => `${chatPlainText(w, 40)}@${a}`).join(' ')}`)
  else if (words.quote) lines.push(`What they say: “${chatPlainText(words.quote, 600)}”`)
  lines.push('')
  const part = facts.format === 'pause_react' ? 'The video (ms into the finished video)' : 'The member’s take (ms into the take as recorded)'
  lines.push(facts.takeMs === null ? 'The member hasn’t recorded their part yet.' : `${part}: ${(facts.takeMs / 1000).toFixed(1)}s.${facts.takeTrim ? ` Only ${facts.takeTrim.startMs}–${facts.takeTrim.endMs} ms of it is used.` : facts.trimmable ? ' All of it is used.' : ''}`)
  if (facts.format !== 'pause_react') lines.push(`A “My take” label shows for the first 1.2 s of the take: graphics start at ${TAKE_GRAPHIC_FROM_MS} ms or later.`)
  lines.push(words.take?.length ? `What the member says (word@ms): ${words.take.slice(0, 1500).map(([w, a]) => `${chatPlainText(w, 40)}@${a}`).join(' ')}` : 'What the member says: no transcript yet (it is made when the hook text is written).')
  lines.push('')
  lines.push(`Hook text: “${state.headline}” (3–${REMIX_WORD_LIMITS.headline} words; shown at the top and used as the title).`)
  lines.push(`Post caption: ${state.postCaption ? JSON.stringify(state.postCaption.slice(0, 1200)) : 'none'}.`)
  if (facts.boxAt !== null) lines.push(`Their clip's box in part 1: ${facts.boxAt === 'auto' ? 'placed where it doesn’t cover the member’s face' : `at the ${facts.boxAt}`}.`)
  if (facts.banner !== null) lines.push(`Comment banner in part 2: ${facts.banner ? 'on' : 'off'}${facts.keyword ? ` (keyword ${facts.keyword})` : ' (no keyword set)'}.`)
  lines.push(state.graphics.length ? `Graphics: ${state.graphics.map((g) => `${g.id} ${g.template} at ${g.at_ms} ms for ${g.duration_ms} ms (${g.placement}): ${Object.entries(g.fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`).join('; ')}.` : 'Graphics: none.')
  return lines.join('\n')
}

const reason = { type: 'string', maxLength: 120, description: 'Optional: why, in a few words for the member.' }
const msProp = (description: string): Record<string, unknown> => ({ type: 'number', minimum: 0, description })
const fieldsProp = {
  type: 'object', additionalProperties: { type: 'string' },
  description: `Template text. stat: value, label · title: text · list/checklist: title, items (newline-separated, up to 5) · lower_third: name, role · before_after: before, after · quote: text, author · highlight: shape (arrow or circle), x, y (0..1 as text). Up to ${MAX_GRAPHIC_FIELD_CHARS} characters each. Words and numbers must come from what is said or from the member.`
}

export const REMIX_CHAT_TOOLS: { name: RemixChatToolName; description: string; parameters: Record<string, unknown> }[] = [
  { name: 'set_hook_text', description: `Set the hook text (3 to ${REMIX_WORD_LIMITS.headline} words), true to what is said.`, parameters: { type: 'object', properties: { text: { type: 'string', maxLength: MAX_HEADLINE_CHARS }, reason }, required: ['text'], additionalProperties: false } },
  { name: 'set_post_caption', description: `Replace the post caption (up to ${MAX_POST_CAPTION_CHARS} characters). Keep its credit and call to action lines.`, parameters: { type: 'object', properties: { text: { type: 'string', maxLength: MAX_POST_CAPTION_CHARS }, reason }, required: ['text'], additionalProperties: false } },
  { name: 'set_their_clip', description: 'Choose the part of their video used (source ms): to shorten it, start later or end earlier. Use their word times.', parameters: { type: 'object', properties: { start_ms: msProp('Start, source ms.'), end_ms: msProp('End, source ms.'), reason }, required: ['start_ms', 'end_ms'], additionalProperties: false } },
  { name: 'trim_my_take', description: 'Use only part of the member’s take (ms into the take): to make their part shorter or cut a first sentence. Both null: use all of it again.', parameters: { type: 'object', properties: { start_ms: { type: ['number', 'null'], minimum: 0 }, end_ms: { type: ['number', 'null'], minimum: 0 }, reason }, required: ['start_ms', 'end_ms'], additionalProperties: false } },
  { name: 'set_box_position', description: 'React, then my thoughts (big box): put their clip’s box at the top or bottom of part 1, or auto (wherever it doesn’t cover the member’s face). With pin ("put their clip box here"): the half the pin is in.', parameters: { type: 'object', properties: { position: { type: 'string', enum: ['top', 'bottom', 'auto'] }, pin: PIN_PROP, reason }, additionalProperties: false } },
  { name: 'set_comment_banner', description: 'React, then my thoughts: show the “Comment KEYWORD” banner through part 2, or not.', parameters: { type: 'object', properties: { on: { type: 'boolean' }, reason }, required: ['on'], additionalProperties: false } },
  { name: 'add_graphic', description: `Add a motion graphic on the member’s part (${REEL_GRAPHIC_TEMPLATES.map((t) => `${t.id}: ${t.detail}`).join(' ')}). It stays clear of their clip’s box, the hook text and the captions. With pin ("put an arrow here"): a highlight points at the pin; another template sits in the band nearest it.`, parameters: { type: 'object', properties: { template: { type: 'string', enum: REEL_GRAPHIC_TEMPLATES.map((t) => t.id) }, at_ms: msProp('Start, ms into the member’s part. Time it to the words it shows.'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: DIAGRAM_MAX_MS, description: `Up to ${GRAPHIC_MAX_MS} ms (a diagram: up to ${DIAGRAM_MAX_MS}).` }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, fields: fieldsProp, pin: PIN_PROP, reason }, required: ['template', 'at_ms', 'fields'], additionalProperties: false } },
  { name: 'update_graphic', description: 'Change a graphic by id. Give only what changes. With pin ("move it here"): an arrow or circle points at the pin; another graphic moves to the band nearest it.', parameters: { type: 'object', properties: { id: { type: 'string' }, at_ms: msProp('Start, ms into the member’s part.'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: DIAGRAM_MAX_MS, description: `Up to ${GRAPHIC_MAX_MS} ms (a diagram: up to ${DIAGRAM_MAX_MS}).` }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, fields: fieldsProp, pin: PIN_PROP, reason }, required: ['id'], additionalProperties: false } },
  { name: 'remove_graphic', description: 'Remove a graphic by id.', parameters: { type: 'object', properties: { id: { type: 'string' }, reason }, required: ['id'], additionalProperties: false } }
]
