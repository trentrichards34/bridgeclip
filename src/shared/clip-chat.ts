/**
 * The clip editor's Chat tab: the member asks for a change to the open clip in
 * plain words, the model answers and calls these tools. Main runs every tool
 * call through `applyChatTool` against a copy of the clip (an invalid call goes
 * back to the model as an error, so it can fix it); the renderer applies the
 * returned steps through the editor's own change() path with `mergeChatSteps`,
 * which checks them again. Times are SOURCE milliseconds, like the clip's cuts.
 */
import { CAPTION_PRESET_IDS, isCaptionPresetId } from './caption-presets'
import { DEFAULT_HEADLINE_LOOK, HEADLINE_FONTS, HEADLINE_LOOKS, parseHeadlineLook } from './headline-look'
import { GRAPHIC_MAX_MS, GRAPHIC_MIN_MS, GRAPHIC_PLACEMENTS, GRAPHIC_TEMPLATES, MAX_GRAPHIC_FIELD_CHARS, MAX_GRAPHICS_PER_CLIP, isGraphicTemplate, parseGraphics, type EditorGraphic, type GraphicPlacement } from './motion-graphics'
import { MAX_HOOK_CHARS, SPLIT_RANGE, TRANSCRIPT_CLIP_MS, defaultCrop, editDuration, framingAt, normalizeSceneTransitions, parseCandidateEdit, parseHook, type CandidateEdit, type EditorRange, type EditorScene } from './clip-editor'

import { CHAT_MAX_TOOL_CALLS, chatClock, chatFail as fail, chatReason as reasonOf, chatSeconds, chatSentence as sentence, chatText as text, type ChatReplyOf } from './chat-core'

export { CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_TOOL_CALLS, CHAT_MAX_TURNS, ChatToolError, chatClock, chatCostNote, chatPlainText, chatSeconds, type ChatInfo } from './chat-core'
export const CHAT_SUGGESTIONS = ['Start earlier', 'Cut the pauses', 'Punchier hook', 'Add a stat graphic'] as const
const MAX_CUTS = 24
const MAX_SCENES = 60
const MIN_PIECE_MS = 100
const MAX_PLAY_SECONDS = 15

/** What the chat may change on a clip. */
export type ChatPatch = Partial<Pick<CandidateEdit, 'ranges' | 'scenes' | 'hook' | 'captions' | 'caption_preset' | 'title' | 'graphics'>>
const PATCH_KEYS = ['ranges', 'scenes', 'hook', 'captions', 'caption_preset', 'title', 'graphics'] as const

export type ChatToolName = 'set_ranges' | 'extend_start' | 'extend_end' | 'remove_section' | 'add_section' | 'set_hook_text' | 'set_hook_look'
  | 'set_layout_at' | 'set_captions' | 'set_title' | 'play' | 'add_graphic' | 'update_graphic' | 'remove_graphic'

/** One tool call's result: a plain sentence for the change card, the values it set, and where to look. */
export interface ChatStep {
  tool: ChatToolName
  summary: string
  patch: ChatPatch
  /** Source time the preview seeks to after applying (null: leave it). */
  focus_ms: number | null
  /** Play this long from focus_ms (a play request, or a short look at an edit). */
  play_seconds: number
}

export type ChatReply = ChatReplyOf<ChatStep>

/** The project facts the tools need. */
export interface ChatProject {
  duration_ms: number; width: number; height: number; aspect_ratio: '9:16' | '16:9'; transcriptCount: number
}

/** "Clip is now 37.7s." after the steps are applied. */
export const clipLengthNote = (c: Pick<CandidateEdit, 'ranges' | 'video_speed'>): string => `Clip is now ${chatSeconds(editDuration(c as CandidateEdit))}.`

function ms(value: unknown, name: string, project: ChatProject): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a number of milliseconds.`)
  const n = Math.round(value as number)
  if (n < 0 || n > project.duration_ms) fail(`${name} must be between 0 and ${project.duration_ms} (the source video's length in ms).`)
  return n
}

/** Sorted, merged, every piece at least 0.1 s. */
function normalizeRanges(ranges: EditorRange[]): EditorRange[] {
  const sorted = ranges.map(([a, b]) => [Math.round(a), Math.round(b)] as EditorRange).sort((x, y) => x[0] - y[0])
  const merged: EditorRange[] = []
  for (const r of sorted) {
    const last = merged.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r] as EditorRange)
  }
  return merged
}
function checkRanges(ranges: EditorRange[], before: CandidateEdit): EditorRange[] {
  if (!ranges.length) fail('That would leave nothing in the clip. Keep at least one section.')
  if (ranges.length > MAX_CUTS) fail(`A clip can have up to ${MAX_CUTS} sections.`)
  if (ranges.some(([a, b]) => b - a < MIN_PIECE_MS)) fail('Every section must be at least 100 ms long.')
  const total = ranges.reduce((n, [a, b]) => n + b - a, 0), current = before.ranges.reduce((n, [a, b]) => n + b - a, 0)
  if (total > Math.max(TRANSCRIPT_CLIP_MS.max, current)) fail(`A clip can be up to ${TRANSCRIPT_CLIP_MS.max / 60000} minutes of source video.`)
  if (total < Math.min(1000, current)) fail('That would make the clip shorter than a second.')
  return ranges
}
function readRanges(value: unknown, project: ChatProject): EditorRange[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CUTS) fail(`ranges must be a list of 1 to ${MAX_CUTS} [start_ms, end_ms] pairs.`)
  return (value as unknown[]).map((r, i) => {
    if (!Array.isArray(r) || r.length !== 2) fail('Each range must be [start_ms, end_ms].')
    const a = ms((r as unknown[])[0], `ranges[${i}][0]`, project), b = ms((r as unknown[])[1], `ranges[${i}][1]`, project)
    if (b <= a) fail(`ranges[${i}] must end after it starts.`)
    return [a, b] as EditorRange
  })
}
function subtract(ranges: EditorRange[], a: number, b: number): EditorRange[] {
  return ranges.flatMap(([x, y]): EditorRange[] => {
    if (b <= x || a >= y) return [[x, y]]
    return ([[x, Math.min(a, y)], [Math.max(b, x), y]] as EditorRange[]).filter(([p, q]) => q - p >= MIN_PIECE_MS)
  })
}
function cropsFor(layout: EditorScene['layout'], project: ChatProject): EditorScene['crops'] {
  const aspect = project.aspect_ratio === '9:16' ? 9 / 16 : 16 / 9
  return layout === 'split'
    ? [defaultCrop(project.width, project.height, aspect / SPLIT_RANGE.default, .25), defaultCrop(project.width, project.height, aspect / SPLIT_RANGE.default, .75)]
    : [defaultCrop(project.width, project.height, aspect)]
}
const layoutName = (layout: string): string => layout === 'fill' ? 'Full frame' : layout === 'split' ? 'Split' : 'Fit'
const clipStart = (c: CandidateEdit): number => c.ranges[0][0]
const clipEnd = (c: CandidateEdit): number => c.ranges[c.ranges.length - 1][1]

/** Checks the whole clip the way a save does; graphics with the shared contract. */
export function checkChatCandidate(c: CandidateEdit, project: ChatProject): void {
  try { parseCandidateEdit(c, project.duration_ms, project.transcriptCount) } catch { fail('That would make an edit the editor can’t save. Check the times and try again.') }
  try { parseGraphics(c.graphics) } catch (error) { fail((error as Error).message) }
}

/** The values a patch sets, read from a candidate (for undoing it). */
export function patchValues(c: CandidateEdit, keys: readonly (keyof ChatPatch)[]): ChatPatch {
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = structuredClone(c[key])
  return out as ChatPatch
}

/**
 * Runs one tool call against `c`. Returns the step and the changed clip, or
 * throws ChatToolError with words the model can act on.
 */
export function applyChatTool(c: CandidateEdit, name: string, args: Record<string, unknown>, project: ChatProject, newId: () => string): { step: ChatStep; candidate: CandidateEdit } {
  const done = (summary: string, patch: ChatPatch, focus_ms: number | null, play_seconds = 0): { step: ChatStep; candidate: CandidateEdit } => {
    const candidate = { ...c, ...patch }
    if (patch.scenes) candidate.scenes = normalizeSceneTransitions(patch.scenes)
    checkChatCandidate(candidate, project)
    const clean: ChatPatch = { ...patch, ...(patch.scenes ? { scenes: candidate.scenes } : {}) }
    return { step: { tool: name as ChatToolName, summary: sentence(summary), patch: clean, focus_ms, play_seconds }, candidate }
  }
  const why = reasonOf(args)
  switch (name) {
    case 'set_ranges': {
      const ranges = checkRanges(normalizeRanges(readRanges(args.ranges, project)), c)
      return done(`Sections set to ${ranges.map(([a, b]) => `${chatClock(a)}–${chatClock(b)}`).join(', ')}${why}`, { ranges }, ranges[0][0], 3)
    }
    case 'extend_start': {
      const to = ms(args.to_ms, 'to_ms', project), first = c.ranges[0]
      if (to > first[1] - MIN_PIECE_MS) fail(`to_ms must be before ${first[1] - MIN_PIECE_MS} (the end of the first section).`)
      const ranges = checkRanges(normalizeRanges([[to, first[1]], ...c.ranges.slice(1)]), c)
      const moved = first[0] - to
      if (!moved) fail('The clip already starts there.')
      return done(`Start moved ${moved > 0 ? 'back' : 'later by'} ${chatSeconds(Math.abs(moved))}${why}`, { ranges }, ranges[0][0], 4)
    }
    case 'extend_end': {
      const to = ms(args.to_ms, 'to_ms', project), last = c.ranges[c.ranges.length - 1]
      if (to < last[0] + MIN_PIECE_MS) fail(`to_ms must be after ${last[0] + MIN_PIECE_MS} (the start of the last section).`)
      const ranges = checkRanges(normalizeRanges([...c.ranges.slice(0, -1), [last[0], to]]), c)
      const moved = to - last[1]
      if (!moved) fail('The clip already ends there.')
      return done(`End moved ${moved > 0 ? 'later by' : 'earlier by'} ${chatSeconds(Math.abs(moved))}${why}`, { ranges }, Math.max(ranges[0][0], to - 3000), 4)
    }
    case 'remove_section': {
      const a = ms(args.start_ms, 'start_ms', project), b = ms(args.end_ms, 'end_ms', project)
      if (b - a < MIN_PIECE_MS) fail('end_ms must be at least 100 ms after start_ms.')
      if (!c.ranges.some(([x, y]) => a < y && b > x)) fail('That part isn’t in the clip, so there is nothing to remove.')
      const ranges = checkRanges(subtract(c.ranges, a, b), c)
      return done(`Cut ${chatClock(a)}–${chatClock(b)} (${chatSeconds(b - a)})${why}`, { ranges }, Math.max(ranges[0][0], a - 2000), 4)
    }
    case 'add_section': {
      const a = ms(args.start_ms, 'start_ms', project), b = ms(args.end_ms, 'end_ms', project)
      if (b - a < MIN_PIECE_MS) fail('end_ms must be at least 100 ms after start_ms.')
      if (c.ranges.some(([x, y]) => a >= x && b <= y)) fail('That part is already in the clip.')
      const ranges = checkRanges(normalizeRanges([...c.ranges, [a, b]]), c)
      return done(`Added ${chatClock(a)}–${chatClock(b)} (${chatSeconds(b - a)})${why}`, { ranges }, a, 4)
    }
    case 'set_hook_text': {
      const words = text(args.text, 'text', MAX_HOOK_CHARS)
      if (words.split(' ').length < 2) fail('Hook text needs at least two words (a single word isn’t drawn).')
      let hook
      try { hook = parseHook({ text: words, look: c.hook?.look ?? DEFAULT_HEADLINE_LOOK })! } catch { return fail('That hook text can’t be used. Use plain words.') }
      return done(`Hook text set to “${hook.text}”${why}`, { hook }, clipStart(c), 0)
    }
    case 'set_hook_look': {
      const current = c.hook?.look ?? DEFAULT_HEADLINE_LOOK
      const next: Record<string, unknown> = { ...current }
      for (const key of ['look', 'color', 'font'] as const) if (args[key] !== undefined) next[key] = args[key]
      let look
      try { look = parseHeadlineLook(next) } catch { return fail(`Use look ${HEADLINE_LOOKS.map((l) => l.id).join('/')}, font ${HEADLINE_FONTS.map((f) => f.id).join('/')} and color as #RRGGBB.`) }
      const hookText = c.hook?.text ?? c.title.slice(0, MAX_HOOK_CHARS)
      let hook
      try { hook = parseHook({ text: hookText, look }) } catch { return fail('Set the hook text first.') }
      const label = HEADLINE_LOOKS.find((l) => l.id === look.look)?.label ?? look.look
      const font = HEADLINE_FONTS.find((f) => f.id === look.font)?.label ?? look.font
      return done(`Hook look set to ${label}, ${font} font${look.look === 'brand' ? `, ${look.color}` : ''}${why}`, { hook }, clipStart(c), 0)
    }
    case 'set_layout_at': {
      const layout = args.layout
      if (layout !== 'fill' && layout !== 'split' && layout !== 'fit') return fail('layout must be fill, split or fit.')
      const at = ms(args.at_ms, 'at_ms', project), start = clipStart(c), end = clipEnd(c)
      if (at >= end) fail(`at_ms must be before the clip ends (${end}).`)
      const until = args.until_ms === undefined || args.until_ms === null ? null : ms(args.until_ms, 'until_ms', project)
      if (until !== null && until <= at) fail('until_ms must be after at_ms.')
      const fresh = (at_ms: number): EditorScene => ({ at_ms, layout, crops: cropsFor(layout, project) })
      let scenes: EditorScene[]
      const from = at <= start ? start : at
      if (at <= start) {
        // From the clip's start: the layout in use there changes (and later ones in range are removed).
        const active = [...c.scenes].reverse().find((s) => s.at_ms <= start) ?? c.scenes[0]
        scenes = c.scenes.map((s) => s === active ? { ...fresh(s.at_ms) } : s)
      } else {
        scenes = [...c.scenes.filter((s) => Math.abs(s.at_ms - at) >= 1), fresh(at)].sort((a, b) => a.at_ms - b.at_ms)
      }
      const stop = until ?? end
      const restore = until !== null && until < end ? { ...structuredClone(framingAt(c, until)), at_ms: until, transition_ms: undefined } : null
      scenes = scenes.filter((s) => s.at_ms <= from || s.at_ms >= stop)
      if (restore) scenes = [...scenes.filter((s) => Math.abs(s.at_ms - until!) >= 1), restore].sort((a, b) => a.at_ms - b.at_ms)
      if (scenes.length > MAX_SCENES) fail(`A clip can have up to ${MAX_SCENES} layout changes.`)
      return done(`Layout set to ${layoutName(layout)} from ${at <= start ? 'the start' : chatClock(at)} ${restore ? `to ${chatClock(until!)}` : 'to the end'}${why}`, { scenes }, Math.max(start, at), 3)
    }
    case 'set_captions': {
      const patch: ChatPatch = {}
      if (args.on !== undefined) { if (typeof args.on !== 'boolean') fail('on must be true or false.'); patch.captions = args.on as boolean }
      if (args.preset !== undefined) { if (!isCaptionPresetId(args.preset)) fail(`preset must be one of ${CAPTION_PRESET_IDS.join(', ')}.`); patch.caption_preset = args.preset as string; patch.captions ??= true }
      if (!Object.keys(patch).length) fail('Give on, preset or both.')
      const summary = patch.captions === false ? 'Captions turned off' : patch.caption_preset ? `Captions set to the ${patch.caption_preset} style` : 'Captions turned on'
      return done(`${summary}${why}`, patch, null)
    }
    case 'set_title': {
      const title = text(args.title, 'title', 200)
      return done(`Title set to “${title}”${why}`, { title }, null)
    }
    case 'play': {
      const at = ms(args.at_ms, 'at_ms', project)
      const seconds = typeof args.seconds === 'number' && Number.isFinite(args.seconds) ? Math.max(1, Math.min(MAX_PLAY_SECONDS, args.seconds)) : 3
      return { step: { tool: 'play', summary: sentence(`Playing ${chatClock(at)} for ${Math.round(seconds)}s${why}`), patch: {}, focus_ms: at, play_seconds: seconds }, candidate: c }
    }
    case 'add_graphic': {
      const graphics = c.graphics ?? []
      if (graphics.length >= MAX_GRAPHICS_PER_CLIP) fail(`A clip can have up to ${MAX_GRAPHICS_PER_CLIP} graphics.`)
      if (!isGraphicTemplate(args.template)) return fail(`template must be one of ${GRAPHIC_TEMPLATES.map((t) => t.id).join(', ')}.`)
      const template = GRAPHIC_TEMPLATES.find((t) => t.id === args.template)!
      const graphic = graphicFrom({ id: newId(), template: template.id, at_ms: args.at_ms, duration_ms: args.duration_ms ?? 2500, placement: args.placement ?? 'middle', fields: {}, origin: 'chat' }, args, c, project)
      return done(`Added a ${template.label.toLowerCase()} at ${chatClock(graphic.at_ms)}${why}`, { graphics: [...graphics, graphic].sort((a, b) => a.at_ms - b.at_ms) }, graphic.at_ms, 3)
    }
    case 'update_graphic': {
      const graphics = c.graphics ?? [], current = graphics.find((g) => g.id === args.id)
      if (!current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The clip's graphics are listed in the context.`)
      const graphic = graphicFrom({ ...current, at_ms: args.at_ms ?? current.at_ms, duration_ms: args.duration_ms ?? current.duration_ms, placement: args.placement ?? current.placement }, args, c, project)
      const label = GRAPHIC_TEMPLATES.find((t) => t.id === graphic.template)!.label.toLowerCase()
      return done(`Changed the ${label} at ${chatClock(graphic.at_ms)}${why}`, { graphics: graphics.map((g) => g.id === graphic.id ? graphic : g).sort((a, b) => a.at_ms - b.at_ms) }, graphic.at_ms, 3)
    }
    case 'remove_graphic': {
      const graphics = c.graphics ?? [], current = graphics.find((g) => g.id === args.id)
      if (!current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The clip's graphics are listed in the context.`)
      const label = GRAPHIC_TEMPLATES.find((t) => t.id === current.template)?.label.toLowerCase() ?? 'graphic'
      return done(`Removed the ${label} at ${chatClock(current.at_ms)}${why}`, { graphics: graphics.filter((g) => g.id !== current.id) }, null)
    }
    default:
      return fail(`There is no tool called ${String(name).slice(0, 40)}.`)
  }
}

type GraphicDraft = Omit<EditorGraphic, 'at_ms' | 'duration_ms' | 'placement'> & { at_ms: unknown; duration_ms: unknown; placement: unknown }
function graphicFrom(base: GraphicDraft, args: Record<string, unknown>, c: CandidateEdit, project: ChatProject): EditorGraphic {
  const at = ms(base.at_ms, 'at_ms', project)
  if (typeof base.duration_ms !== 'number' || !Number.isFinite(base.duration_ms) || base.duration_ms < GRAPHIC_MIN_MS || base.duration_ms > GRAPHIC_MAX_MS) fail(`duration_ms must be between ${GRAPHIC_MIN_MS} and ${GRAPHIC_MAX_MS}.`)
  if (!c.ranges.some(([a, b]) => at >= a && at < b)) fail('at_ms must be inside the clip (one of its sections).')
  if (!(GRAPHIC_PLACEMENTS as readonly unknown[]).includes(base.placement)) fail(`placement must be ${GRAPHIC_PLACEMENTS.join(', ')}.`)
  const template = GRAPHIC_TEMPLATES.find((t) => t.id === base.template)!
  const fields: Record<string, string> = { ...base.fields }
  if (args.fields !== undefined) {
    if (!args.fields || typeof args.fields !== 'object' || Array.isArray(args.fields)) fail('fields must be an object of text values.')
    for (const [key, value] of Object.entries(args.fields as Record<string, unknown>)) {
      if (key === 'image') fail('The chat can’t add images. The member can add a logo in the Graphics row.')
      if (!(template.fields as readonly string[]).includes(key)) fail(`A ${template.id} graphic has the fields ${template.fields.join(', ')}.`)
      if (value === null || value === '') { delete fields[key]; continue }
      if (typeof value !== 'string' && typeof value !== 'number') fail(`fields.${key} must be text.`)
      const limit = key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS
      const raw = String(value)
      if (raw.length > limit) fail(`fields.${key} must be at most ${limit} characters.`)
      fields[key] = key === 'items' ? raw.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5).join('\n') : raw.replace(/\s+/g, ' ').trim()
    }
  }
  if (template.id === 'logo') fail('The chat can’t add a logo graphic. The member can add one in the Graphics row.')
  if (!template.fields.some((f) => fields[f])) fail(`Give the ${template.id} graphic its text: ${template.fields.join(', ')}.`)
  return { id: base.id, template: template.id, at_ms: at, duration_ms: Math.round(base.duration_ms as number), placement: base.placement as GraphicPlacement, fields, origin: base.origin ?? 'chat' }
}

/**
 * The renderer's check before applying: every step's values in order, merged
 * into one patch, and the result valid like a save. Throws on anything else.
 */
export function mergeChatSteps(c: CandidateEdit, steps: unknown, project: ChatProject): ChatPatch {
  if (!Array.isArray(steps) || steps.length > CHAT_MAX_TOOL_CALLS) throw new Error('The chat sent an invalid edit.')
  const patch: Record<string, unknown> = {}
  for (const step of steps as ChatStep[]) {
    const p = step?.patch
    if (!p || typeof p !== 'object' || Object.keys(p).some((key) => !(PATCH_KEYS as readonly string[]).includes(key))) throw new Error('The chat sent an invalid edit.')
    Object.assign(patch, structuredClone(p))
  }
  const next = { ...c, ...patch } as CandidateEdit
  if (patch.scenes) next.scenes = normalizeSceneTransitions(next.scenes)
  try { checkChatCandidate(next, project) } catch { throw new Error('The chat’s edit doesn’t fit this clip anymore. Ask again.') }
  if (patch.graphics) patch.graphics = parseGraphics(patch.graphics)
  if (patch.scenes) patch.scenes = next.scenes
  return patch as ChatPatch
}

/** Parses the steps main sent (an IPC reply is still checked before use). */
export function parseChatSteps(value: unknown): ChatStep[] {
  if (!Array.isArray(value) || value.length > CHAT_MAX_TOOL_CALLS) return []
  return value.flatMap((raw): ChatStep[] => {
    if (!raw || typeof raw !== 'object') return []
    const s = raw as Record<string, unknown>
    if (typeof s.tool !== 'string' || typeof s.summary !== 'string' || !s.patch || typeof s.patch !== 'object') return []
    const focus = typeof s.focus_ms === 'number' && Number.isFinite(s.focus_ms) ? s.focus_ms : null
    const play = typeof s.play_seconds === 'number' && Number.isFinite(s.play_seconds) ? Math.max(0, Math.min(MAX_PLAY_SECONDS, s.play_seconds)) : 0
    return [{ tool: s.tool as ChatToolName, summary: s.summary.slice(0, 400), patch: s.patch as ChatPatch, focus_ms: focus, play_seconds: play }]
  })
}

const reason = { type: 'string', maxLength: 120, description: 'Optional: why, in a few words for the member (e.g. "to include Joe\'s \'Wowww.\'").' }
const msProp = (description: string): Record<string, unknown> => ({ type: 'number', minimum: 0, description })
const fieldsProp = {
  type: 'object',
  description: `Template text. stat: value, label · title: text · list/checklist: title, items (newline-separated, up to 5) · lower_third: name, role · before_after: before, after · quote: text, author · highlight: shape (arrow or circle), x, y (0..1 as text). Up to ${MAX_GRAPHIC_FIELD_CHARS} characters each. Words and numbers must come from what is said in the clip or from the member.`,
  additionalProperties: { type: 'string' }
}

/** The tools as OpenRouter functions. */
export const CHAT_TOOLS: { name: ChatToolName; description: string; parameters: Record<string, unknown> }[] = [
  { name: 'set_ranges', description: 'Replace all of the clip\'s sections (source ms). Overlapping sections are merged.', parameters: { type: 'object', properties: { ranges: { type: 'array', minItems: 1, maxItems: MAX_CUTS, items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, description: '[[start_ms, end_ms], …] in source time.' }, reason }, required: ['ranges'], additionalProperties: false } },
  { name: 'extend_start', description: 'Move the start of the first section to to_ms (earlier to include more, later to trim).', parameters: { type: 'object', properties: { to_ms: msProp('New start, source ms.'), reason }, required: ['to_ms'], additionalProperties: false } },
  { name: 'extend_end', description: 'Move the end of the last section to to_ms (later to include more, earlier to trim).', parameters: { type: 'object', properties: { to_ms: msProp('New end, source ms.'), reason }, required: ['to_ms'], additionalProperties: false } },
  { name: 'remove_section', description: 'Cut start_ms–end_ms out of the clip (for pauses, filler, a tangent). Use word times so no word is cut in half.', parameters: { type: 'object', properties: { start_ms: msProp('Source ms.'), end_ms: msProp('Source ms.'), reason }, required: ['start_ms', 'end_ms'], additionalProperties: false } },
  { name: 'add_section', description: 'Add start_ms–end_ms of the source to the clip (merged with the sections around it).', parameters: { type: 'object', properties: { start_ms: msProp('Source ms.'), end_ms: msProp('Source ms.'), reason }, required: ['start_ms', 'end_ms'], additionalProperties: false } },
  { name: 'set_hook_text', description: `Set the hook text drawn at the top of a vertical clip: 2+ words, up to ${MAX_HOOK_CHARS} characters, true to what is said.`, parameters: { type: 'object', properties: { text: { type: 'string', minLength: 3, maxLength: MAX_HOOK_CHARS }, reason }, required: ['text'], additionalProperties: false } },
  { name: 'set_hook_look', description: 'Change how the hook text looks. Give only what changes.', parameters: { type: 'object', properties: { look: { type: 'string', enum: HEADLINE_LOOKS.map((l) => l.id) }, font: { type: 'string', enum: HEADLINE_FONTS.map((f) => f.id) }, color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', description: 'Bar color for the brand look.' }, reason }, additionalProperties: false } },
  { name: 'set_layout_at', description: 'Frame the clip as fill (full frame, cropped), split (two panels stacked) or fit (whole frame, blurred background) from at_ms to until_ms (or to the end). at_ms at or before the clip start changes it from the start.', parameters: { type: 'object', properties: { at_ms: msProp('Source ms.'), layout: { type: 'string', enum: ['fill', 'split', 'fit'] }, until_ms: msProp('Optional end, source ms.'), reason }, required: ['at_ms', 'layout'], additionalProperties: false } },
  { name: 'set_captions', description: 'Turn burned-in captions on or off, or choose their style.', parameters: { type: 'object', properties: { on: { type: 'boolean' }, preset: { type: 'string', enum: [...CAPTION_PRESET_IDS] }, reason }, additionalProperties: false } },
  { name: 'set_title', description: 'Rename the clip (its title in the editor and Library).', parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, reason }, required: ['title'], additionalProperties: false } },
  { name: 'play', description: 'Play a moment of the source for the member (no edit). Use it to ask "is this the moment you mean?" before editing when you are not sure.', parameters: { type: 'object', properties: { at_ms: msProp('Source ms.'), seconds: { type: 'number', minimum: 1, maximum: MAX_PLAY_SECONDS }, reason }, required: ['at_ms'], additionalProperties: false } },
  { name: 'add_graphic', description: `Add a motion graphic over the clip (${GRAPHIC_TEMPLATES.filter((t) => t.id !== 'logo').map((t) => `${t.id}: ${t.detail}`).join(' ')})`, parameters: { type: 'object', properties: { template: { type: 'string', enum: GRAPHIC_TEMPLATES.filter((t) => t.id !== 'logo').map((t) => t.id) }, at_ms: msProp('Source ms, inside the clip. Time it to the words it shows.'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: GRAPHIC_MAX_MS }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, fields: fieldsProp, reason }, required: ['template', 'at_ms', 'fields'], additionalProperties: false } },
  { name: 'update_graphic', description: 'Change a graphic on the clip by id. Give only what changes.', parameters: { type: 'object', properties: { id: { type: 'string' }, at_ms: msProp('Source ms.'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: GRAPHIC_MAX_MS }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, fields: fieldsProp, reason }, required: ['id'], additionalProperties: false } },
  { name: 'remove_graphic', description: 'Remove a graphic from the clip by id.', parameters: { type: 'object', properties: { id: { type: 'string' }, reason }, required: ['id'], additionalProperties: false } }
]
