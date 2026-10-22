/**
 * The clip editor's Chat tab: the member asks for a change to the open clip in
 * plain words, the model answers and calls these tools. Main runs every tool
 * call through `applyChatTool` against a copy of the clip (an invalid call goes
 * back to the model as an error, so it can fix it); the renderer applies the
 * returned steps through the editor's own change() path with `mergeChatSteps`,
 * which checks them again. Tools take SOURCE milliseconds, like the clip's cuts;
 * the change card's words give CLIP time (the finished clip's clock, as the
 * editor's playhead shows it).
 */
import { CAPTION_PRESET_IDS, isCaptionPresetId } from './caption-presets'
import { DEFAULT_HEADLINE_LOOK, HEADLINE_FONTS, HEADLINE_HIDE_AFTER_S, HEADLINE_LOOKS, HEADLINE_TEXT_BGS, HOOK_LOOK_TOOL_PROPERTIES, applyHookLookArgs, headlineBarColor, headlineTextBg, hideAfterLabel } from './headline-look'
import { CHAPTER_MAX_MS, CHAPTER_STYLES, DIAGRAM_MAX_MS, GRAPHIC_DEPTHS, graphicMaxMs, isDiagram, matchItemTimes, GRAPHIC_DEPTH_TEMPLATES, GRAPHIC_ICONS, GRAPHIC_MAX_MS, GRAPHIC_MIN_MS, GRAPHIC_PLACEMENTS, GRAPHIC_SIZES, GRAPHIC_TEMPLATES, MAX_GRAPHIC_FIELD_CHARS, MAX_GRAPHICS_PER_CLIP, SCREEN_SHAPES, WORD_TIMED_TEMPLATES, fitGraphicInCut, graphicCanGoBehind, isGraphicDepth, isGraphicSize, isGraphicTemplate, isScreenVideo, matchCardWords, nearestOutputTime, outputTime, parseGraphics, placeInFreeBand, sourceTimeAt, type EditorGraphic, type GraphicPlacement, type TimedWord } from './motion-graphics'
import { MAX_HOOK_CHARS, SPLIT_RANGE, TRANSCRIPT_CLIP_MS, defaultCrop, editDuration, framingAt, normalizeSceneTransitions, panelRows, parseCandidateEdit, parseHook, type CandidateEdit, type Crop, type EditorRange, type EditorScene } from './clip-editor'
import { hookShare, outputSize } from './graphic-layout'
import { BACKDROP_LABELS, CARD_LABELS, MIN_SCENE_MS, SCENE_BACKDROPS, SCENE_CARDS, SCENE_KINDS, SCENE_LABELS, parseScenes, setScene, type SceneBackdrop, type SceneCard, type SceneKind } from './scenes'
import { PIN_PROP, aimGraphic, checkHighlightFields, pinArg, type ChatPoint } from './chat-point'

import { CHAT_MAX_TOOL_CALLS, chatClock, chatFail as fail, chatReason as reasonOf, chatSeconds, chatSentence as sentence, chatText as text, type ChatReplyOf } from './chat-core'

export { CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_TOOL_CALLS, CHAT_MAX_TURNS, ChatToolError, chatClock, chatCostNote, chatPlainText, chatSeconds, type ChatInfo } from './chat-core'
export const CHAT_SUGGESTIONS = ['Start earlier', 'Cut the pauses', 'Punchier hook', 'Add a stat graphic'] as const
/** Suggestions while the member has pins on the preview. */
export const CHAT_POINT_SUGGESTIONS = ['Put an arrow here', 'Circle this', 'Zoom in on this', 'Move the graphic here'] as const
const MAX_CUTS = 24
const MAX_SCENES = 60
const MIN_PIECE_MS = 100
const MAX_PLAY_SECONDS = 15

/** What the chat may change on a clip. */
export type ChatPatch = Partial<Pick<CandidateEdit, 'ranges' | 'scenes' | 'hook' | 'captions' | 'caption_preset' | 'title' | 'graphics' | 'stage_scenes'>>
const PATCH_KEYS = ['ranges', 'scenes', 'hook', 'captions', 'caption_preset', 'title', 'graphics', 'stage_scenes'] as const

export type ChatToolName = 'set_ranges' | 'extend_start' | 'extend_end' | 'remove_section' | 'add_section' | 'set_hook_text' | 'set_hook_look'
  | 'set_layout_at' | 'set_captions' | 'set_title' | 'play' | 'add_graphic' | 'update_graphic' | 'remove_graphic' | 'set_scene'

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
  /** The transcript's timed words near the clip (when saved): word-timed cards snap to them. */
  words?: TimedWord[]
}

/** "Clip is now 37.7s." after the steps are applied. */
export const clipLengthNote = (c: Pick<CandidateEdit, 'ranges' | 'video_speed'>): string => `Clip is now ${chatSeconds(editDuration(c as CandidateEdit))}.`

/** Source ms as the clip's own clock ("0:03.2"): where it plays in the finished clip (a cut-out moment: the nearest kept one). */
export function clipClock(c: Pick<CandidateEdit, 'ranges' | 'video_speed'>, source: number): string {
  return chatClock(nearestOutputTime(c, source))
}
/** Where a source moment is, for a sentence: "0:03.2" in the clip, or "1.2s before the clip starts". */
function clipMoment(c: CandidateEdit, source: number): string {
  if (outputTime(c, source) !== null) return chatClock(outputTime(c, source)!)
  if (source < clipStart(c)) return `${chatSeconds(clipStart(c) - source)} before the clip starts`
  if (source >= clipEnd(c)) return `${chatSeconds(source - clipEnd(c))} after the clip ends`
  return `a part cut out near ${clipClock(c, source)}`
}

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
/** Zoom limits for "zoom in on this" (the Framing tab's Zoom slider goes to 4×). */
const MAX_POINT_ZOOM = 4
const DEFAULT_POINT_ZOOM = 1.6

/** The source time a pin was made at (its output time through the cuts and speed), or null when it has none or is past the end. */
export function pinSourceMs(c: Pick<CandidateEdit, 'ranges' | 'video_speed'>, pin: Pick<ChatPoint, 'out_ms'>): number | null {
  return pin.out_ms === null ? null : sourceTimeAt(c, pin.out_ms)
}

/**
 * Where a point on the OUTPUT frame (fractions) shows the SOURCE video at
 * source time `t` (fractions of the source frame), following the layout there
 * like the editor's Output preview: the hook bar on top, the split panels, the
 * crop trimmed to its panel. Null on a Fit layout's blurred background.
 */
export function sourcePointAt(c: CandidateEdit, project: Pick<ChatProject, 'width' | 'height' | 'aspect_ratio'>, x: number, y: number, t: number): { x: number; y: number } | null {
  const scene = framingAt(c, t), out = outputSize(project.aspect_ratio)
  const clamp = (n: number): number => Math.max(0, Math.min(1, n))
  if (scene.layout === 'fit') {
    const scale = Math.min(out.width / project.width, out.height / project.height)
    const w = project.width * scale / out.width, h = project.height * scale / out.height
    const u = (x - (1 - w) / 2) / w, v = (y - (1 - h) / 2) / h
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : { x: clamp(u), y: clamp(v) }
  }
  const bar = c.hook && headlineBarColor(c.hook.look) ? hookShare(c, project.aspect_ratio) : 0
  const ya = clamp((y - bar) / (1 - bar))
  const rows = panelRows(scene)
  const index = Math.max(0, rows.findIndex(([top, share]) => ya <= top + share + 1e-9))
  const [top, share] = rows[index]
  let [cx, cy, cw, ch] = scene.crops[Math.min(index, scene.crops.length - 1)]
  // The crop is trimmed around its center to its panel's shape, as the preview and export draw it.
  const target = out.width / (share * (1 - bar) * out.height), pw = cw * project.width, ph = ch * project.height
  if (pw / ph < target) { const th = pw / target / project.height; cy += (ch - th) / 2; ch = th } else if (pw / ph > target) { const tw = ph * target / project.width; cx += (cw - tw) / 2; cw = tw }
  return { x: clamp(cx + clamp(x) * cw), y: clamp(cy + clamp((ya - top) / share) * ch) }
}

/** A Full frame crop centered on a pin, zoomed in (a box: zoomed so the box fills the frame; a point: `zoom` or 1.6× / half again the zoom in use). */
export function zoomCropAt(c: CandidateEdit, project: ChatProject, pin: ChatPoint, t: number, zoom?: number): { crop: Crop; zoom: number } {
  const aspect = project.aspect_ratio === '9:16' ? 9 / 16 : 16 / 9
  const base = defaultCrop(project.width, project.height, aspect)
  const centerX = pin.x + (pin.w ?? 0) / 2, centerY = pin.y + (pin.h ?? 0) / 2
  const center = sourcePointAt(c, project, centerX, centerY, t)
  if (!center) return fail('That pin is on the blurred background, not on the video. Ask the member to point at the video itself.')
  let z = zoom
  if (z === undefined && pin.w !== undefined && pin.h !== undefined) {
    const a = sourcePointAt(c, project, pin.x, pin.y, t), b = sourcePointAt(c, project, pin.x + pin.w, pin.y + pin.h, t)
    if (a && b && Math.abs(b.x - a.x) > 1e-3 && Math.abs(b.y - a.y) > 1e-3) z = Math.min(base[2] / Math.abs(b.x - a.x), base[3] / Math.abs(b.y - a.y))
  }
  if (z === undefined) {
    const scene = framingAt(c, t)
    const current = scene.layout === 'fill' ? base[2] / scene.crops[0][2] : 1
    z = Math.max(DEFAULT_POINT_ZOOM, current * 1.5)
  }
  z = Math.round(Math.max(1, Math.min(MAX_POINT_ZOOM, z)) * 100) / 100
  const crop = defaultCrop(project.width, project.height, aspect, center.x, center.y, z).map((n) => Math.round(n * 1e6) / 1e6) as Crop
  return { crop, zoom: z }
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
export function applyChatTool(c: CandidateEdit, name: string, args: Record<string, unknown>, project: ChatProject, newId: () => string, points: readonly ChatPoint[] = []): { step: ChatStep; candidate: CandidateEdit } {
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
      return done(`Clip set to ${ranges.length === 1 ? 'one section' : `${ranges.length} sections`} of the video${why}`, { ranges }, ranges[0][0], 3)
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
      const removed = c.ranges.reduce((n, [x, y]) => n + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0)
      return done(`Cut ${chatSeconds(removed)} at ${clipClock(c, Math.max(a, clipStart(c)))}${why}`, { ranges }, Math.max(ranges[0][0], a - 2000), 4)
    }
    case 'add_section': {
      const a = ms(args.start_ms, 'start_ms', project), b = ms(args.end_ms, 'end_ms', project)
      if (b - a < MIN_PIECE_MS) fail('end_ms must be at least 100 ms after start_ms.')
      if (c.ranges.some(([x, y]) => a >= x && b <= y)) fail('That part is already in the clip.')
      const ranges = checkRanges(normalizeRanges([...c.ranges, [a, b]]), c)
      return done(`Added ${chatSeconds(b - a)} of the video at ${clipClock({ ...c, ranges }, a)}${why}`, { ranges }, a, 4)
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
      let look
      try { look = applyHookLookArgs(current, args) } catch { return fail(`Use look ${HEADLINE_LOOKS.map((l) => l.id).join('/')}, font ${HEADLINE_FONTS.map((f) => f.id).join('/')}, text_bg ${HEADLINE_TEXT_BGS.map((b) => b.id).join('/')}, hide_after_s ${[0, ...HEADLINE_HIDE_AFTER_S].join('/')} and color as #RRGGBB.`) }
      const hookText = c.hook?.text ?? c.title.slice(0, MAX_HOOK_CHARS)
      let hook
      try { hook = parseHook({ text: hookText, look }) } catch { return fail('Set the hook text first.') }
      const label = HEADLINE_LOOKS.find((l) => l.id === look.look)?.label ?? look.look
      const font = HEADLINE_FONTS.find((f) => f.id === look.font)?.label ?? look.font
      const box = headlineTextBg(look) !== 'none' ? `, ${HEADLINE_TEXT_BGS.find((b) => b.id === headlineTextBg(look))?.label.toLowerCase()} behind the text` : ''
      const hides = hideAfterLabel(look)
      return done(`Hook look set to ${label}, ${font} font${look.look === 'brand' ? `, ${look.color}` : ''}${box}${hides ? `, ${hides}` : ''}${why}`, { hook }, clipStart(c), 0)
    }
    case 'set_layout_at': {
      const pin = pinArg(args, points)
      const layout = args.layout ?? (pin ? 'fill' : undefined)
      if (layout !== 'fill' && layout !== 'split' && layout !== 'fit') return fail('layout must be fill, split or fit.')
      if (pin && layout !== 'fill') fail('Zooming in on a pin uses the fill layout. Leave out layout or use fill.')
      if (args.zoom !== undefined && !pin) fail('zoom goes with a pin: give the pin to zoom in on.')
      if (args.zoom !== undefined && (typeof args.zoom !== 'number' || !Number.isFinite(args.zoom) || args.zoom < 1 || args.zoom > MAX_POINT_ZOOM)) fail(`zoom must be between 1 and ${MAX_POINT_ZOOM}.`)
      const pinAt = pin ? pinSourceMs(c, pin) : null
      const at = ms(args.at_ms ?? pinAt ?? undefined, 'at_ms', project), start = clipStart(c), end = clipEnd(c)
      if (at >= end) fail(`at_ms must be before the clip ends (${end}).`)
      const until = args.until_ms === undefined || args.until_ms === null ? null : ms(args.until_ms, 'until_ms', project)
      if (until !== null && until <= at) fail('until_ms must be after at_ms.')
      // A pin: a Full frame crop centered on it, framed as the preview showed it when the member pointed.
      const zoomed = pin ? zoomCropAt(c, project, pin, pinAt ?? Math.max(start, at), args.zoom as number | undefined) : null
      const fresh = (at_ms: number): EditorScene => ({ at_ms, layout, crops: zoomed ? [zoomed.crop] : cropsFor(layout, project) })
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
      const span = `from ${at <= start ? 'the start' : clipClock(c, at)} ${restore ? `to ${clipClock(c, until!)}` : 'to the end'}`
      return done(zoomed ? `Zoomed in ${zoomed.zoom.toFixed(1)}× on pin ${pin!.n} ${span}${why}` : `Layout set to ${layoutName(layout)} ${span}${why}`, { scenes }, Math.max(start, at), 3)
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
      return { step: { tool: 'play', summary: sentence(`Playing ${clipMoment(c, at)} for ${Math.round(seconds)}s${why}`), patch: {}, focus_ms: at, play_seconds: seconds }, candidate: c }
    }
    case 'add_graphic': {
      const graphics = c.graphics ?? []
      if (graphics.length >= MAX_GRAPHICS_PER_CLIP) fail(`A clip can have up to ${MAX_GRAPHICS_PER_CLIP} graphics.`)
      if (!isGraphicTemplate(args.template)) return fail(`template must be one of ${GRAPHIC_TEMPLATES.map((t) => t.id).join(', ')}.`)
      const template = GRAPHIC_TEMPLATES.find((t) => t.id === args.template)!
      const pin = pinArg(args, points)
      // At a pin with no time given: a little before the moment pointed at (in its section), so it is on screen there.
      const pinAt = pin && args.at_ms === undefined ? pinSourceMs(c, pin) : null
      const range = pinAt === null ? undefined : c.ranges.find(([a, b]) => pinAt >= a && pinAt < b)
      const at = pinAt !== null && range ? Math.max(range[0], pinAt - 400) : args.at_ms
      const { graphic: fit, note } = fitted(graphicFrom({ id: newId(), template: template.id, at_ms: at, duration_ms: args.duration_ms ?? 2500, placement: args.placement ?? 'middle', fields: {}, origin: 'chat',
        ...(template.id === 'big_words' && args.depth === undefined ? { depth: 'behind' as const } : {}) }, args, c, project, pin), c)
      // Another graphic in its band at the same time: the next free band (top, bottom, middle).
      const graphic = placeInFreeBand(graphics, fit)
      const band = graphic.placement !== fit.placement ? ` at the ${graphic.placement} (the ${fit.placement} has another graphic then)` : ''
      return done(`Added ${template.id === 'highlight' ? `${graphic.fields.shape === 'arrow' ? 'an arrow' : 'a circle'}` : `a ${template.label.toLowerCase()}`}${pin ? ` at pin ${pin.n}` : ''} at ${clipClock(c, graphic.at_ms)}${band}${note}${why}`, { graphics: [...graphics, graphic].sort((a, b) => a.at_ms - b.at_ms) }, graphic.at_ms, 3)
    }
    case 'update_graphic': {
      const graphics = c.graphics ?? [], current = graphics.find((g) => g.id === args.id)
      if (!current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The clip's graphics are listed in the context.`)
      const pin = pinArg(args, points)
      const { graphic, note } = fitted(graphicFrom({ ...current, at_ms: args.at_ms ?? current.at_ms, duration_ms: args.duration_ms ?? current.duration_ms, placement: args.placement ?? current.placement }, args, c, project, pin), c)
      const label = GRAPHIC_TEMPLATES.find((t) => t.id === graphic.template)!.label.toLowerCase()
      const moved = pin ? graphic.template === 'highlight' ? ` to point at pin ${pin.n}` : ` to the ${graphic.placement}` : ''
      return done(`${pin ? 'Moved' : 'Changed'} the ${label} at ${clipClock(c, graphic.at_ms)}${moved}${note}${why}`, { graphics: graphics.map((g) => g.id === graphic.id ? graphic : g).sort((a, b) => a.at_ms - b.at_ms) }, graphic.at_ms, 3)
    }
    case 'remove_graphic': {
      const graphics = c.graphics ?? [], current = graphics.find((g) => g.id === args.id)
      if (!current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The clip's graphics are listed in the context.`)
      const label = GRAPHIC_TEMPLATES.find((t) => t.id === current.template)?.label.toLowerCase() ?? 'graphic'
      return done(`Removed the ${label} at ${clipClock(c, current.at_ms)}${why}`, { graphics: graphics.filter((g) => g.id !== current.id) }, null)
    }
    case 'set_scene': {
      if (project.aspect_ratio !== '9:16') fail('Scenes are for vertical (9:16) clips.')
      if (!(SCENE_KINDS as readonly unknown[]).includes(args.scene)) fail(`scene must be ${SCENE_KINDS.join(', ')}.`)
      const scene = args.scene as SceneKind
      if (args.backdrop !== undefined && !(SCENE_BACKDROPS as readonly unknown[]).includes(args.backdrop)) fail(`backdrop must be ${SCENE_BACKDROPS.join(', ')}.`)
      if (scene === 'face' && args.backdrop !== undefined) fail('Face has no backdrop. Leave out backdrop.')
      if (args.card !== undefined && !(SCENE_CARDS as readonly unknown[]).includes(args.card)) fail(`card must be ${SCENE_CARDS.join(', ')}.`)
      if (scene !== 'stage' && args.card !== undefined) fail('Only a stage scene has a card. Leave out card.')
      const start = clipStart(c), end = clipEnd(c)
      const a = Math.max(start, ms(args.start_ms, 'start_ms', project)), b = Math.min(end, ms(args.end_ms, 'end_ms', project))
      if (b <= a) fail('start_ms and end_ms must cover part of the clip, with end_ms after start_ms.')
      if (b - a < MIN_SCENE_MS) fail(`A scene lasts at least ${MIN_SCENE_MS / 1000} seconds. Make end_ms later or start_ms earlier.`)
      let stage_scenes
      try { stage_scenes = parseScenes(setScene(c.stage_scenes ?? [], a, b, scene, args.backdrop as SceneBackdrop | undefined, project.duration_ms, args.card as SceneCard | undefined), project.duration_ms) } catch (error) { return fail((error as Error).message) }
      const look = scene === 'face' ? '' : ` on the ${BACKDROP_LABELS[(args.backdrop as SceneBackdrop | undefined) ?? 'light'].toLowerCase()} backdrop${args.card === 'arch' ? ` with the ${CARD_LABELS.arch.toLowerCase()} card` : ''}`
      return done(`${SCENE_LABELS[scene]} scene${look} from ${clipClock(c, a)} to ${clipClock(c, b)}${why}`, { stage_scenes }, a, 3)
    }
    default:
      return fail(`There is no tool called ${String(name).slice(0, 40)}.`)
  }
}

/** A graphic moved or shortened so all of it plays inside the cut, and words for the card when it was. */
function fitted(g: EditorGraphic, c: CandidateEdit): { graphic: EditorGraphic; note: string } {
  const fit = fitGraphicInCut(g, c)
  if (!fit) return fail(`Less than ${GRAPHIC_MIN_MS / 1000} s of the clip is left after at_ms, so the graphic can't fit. Start it earlier.`)
  const note = fit.duration_ms < g.duration_ms ? ` (shortened to ${chatSeconds(fit.duration_ms)} to fit in the clip)`
    : fit.at_ms < g.at_ms ? ' (starts a little earlier so all of it plays before the clip ends)'
      : fit.at_ms > g.at_ms ? ' (starts where the clip picks up again)' : ''
  return { graphic: fit, note }
}

type GraphicDraft = Omit<EditorGraphic, 'at_ms' | 'duration_ms' | 'placement'> & { at_ms: unknown; duration_ms: unknown; placement: unknown }
function graphicFrom(base: GraphicDraft, args: Record<string, unknown>, c: CandidateEdit, project: ChatProject, pin: ChatPoint | null = null): EditorGraphic {
  const at = ms(base.at_ms, 'at_ms', project)
  if (typeof base.duration_ms !== 'number' || !Number.isFinite(base.duration_ms) || base.duration_ms < GRAPHIC_MIN_MS || base.duration_ms > graphicMaxMs(base.template)) fail(`duration_ms must be between ${GRAPHIC_MIN_MS} and ${graphicMaxMs(base.template)} for a ${String(base.template)}.`)
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
      fields[key] = key === 'items' ? raw.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6).join('\n')
        : key === 'icons' ? raw.split('\n').map((line) => line.trim().toLowerCase()).slice(0, 6).join('\n') : raw.replace(/\s+/g, ' ').trim()
    }
  }
  if (template.id === 'logo') fail('The chat can’t add a logo graphic. The member can add one in the Graphics row.')
  if (template.id === 'screen_frame') checkScreenFields(fields, c)
  if (fields.icon !== undefined && !(GRAPHIC_ICONS as readonly string[]).includes(fields.icon.toLowerCase())) fail(`fields.icon: one of ${GRAPHIC_ICONS.join(', ')}.`)
  if (fields.wrong !== undefined && fields.wrong !== 'first' && fields.wrong !== 'second') fail('fields.wrong must be first or second.')
  if (template.id === 'chapter' && fields.style !== undefined && !(CHAPTER_STYLES as readonly string[]).includes(fields.style)) fail(`fields.style must be ${CHAPTER_STYLES.join(', ')}.`)
  if (template.id === 'growth' && fields.style !== undefined && fields.style !== 'plants' && fields.style !== 'bars') fail('fields.style must be plants or bars.')
  if (fields.icons !== undefined) {
    const bad = fields.icons.split('\n').map((n) => n.trim()).filter((n) => n && !(GRAPHIC_ICONS as readonly string[]).includes(n))
    if (bad.length) fail(`fields.icons: one per line from ${GRAPHIC_ICONS.join(', ')} (never a brand logo).`)
  }
  if (args.size !== undefined && !isGraphicSize(args.size)) fail(`size must be ${GRAPHIC_SIZES.join(', ')}.`)
  if (args.depth !== undefined) {
    if (!isGraphicDepth(args.depth)) fail(`depth must be ${GRAPHIC_DEPTHS.join(' or ')}.`)
    if (args.depth === 'behind' && !graphicCanGoBehind(template.id)) fail(`Only ${GRAPHIC_DEPTH_TEMPLATES.join(', ')} can go behind the speaker.`)
  }
  const size = args.size !== undefined ? args.size as EditorGraphic['size'] : base.size
  const depth = args.depth !== undefined ? args.depth as EditorGraphic['depth'] : base.depth
  let graphic: EditorGraphic = { id: base.id, template: template.id, at_ms: at, duration_ms: Math.round(base.duration_ms as number), placement: base.placement as GraphicPlacement, fields, origin: base.origin ?? 'chat',
    ...(size && size !== 'card' ? { size } : {}), ...(depth && graphicCanGoBehind(template.id) ? { depth } : {}) }
  if (template.id === 'highlight') checkHighlightFields(fields)
  if (pin) {
    const aimed = aimGraphic(graphic, pin, typeof (args.fields as Record<string, unknown> | undefined)?.shape === 'string')
    // A placement the model gave wins over the band nearest the pin.
    graphic = { ...aimed, placement: args.placement !== undefined ? graphic.placement : aimed.placement }
  }
  if (!template.fields.some((f) => graphic.fields[f])) fail(`Give the ${template.id} graphic its text: ${template.fields.join(', ')}.`)
  // Word-timed cards start on their first spoken word, show each word as it is said and hold after the last
  // (when the words are said near at_ms and the times weren't given).
  if (WORD_TIMED_TEMPLATES.includes(template.id) && project.words?.length && args.duration_ms === undefined) {
    const textChanged = ['text', 'phrase', 'subline'].some((k) => (args.fields as Record<string, unknown> | undefined)?.[k] !== undefined)
    if (!graphic.fields.word_ms || textChanged || args.at_ms !== undefined) {
      const { word_ms: _old, ...rest } = graphic.fields
      void _old
      const matched = matchCardWords({ ...graphic, fields: rest }, project.words, graphic.at_ms)
      graphic = matched ?? { ...graphic, fields: rest }
    }
  }
  // A diagram's items light up as they are said (when they are all said, in order, while it shows).
  if (isDiagram(template.id) && project.words?.length) {
    const { item_ms: _old, ...rest } = graphic.fields
    void _old
    graphic = matchItemTimes({ ...graphic, fields: rest }, project.words) ?? { ...graphic, fields: rest }
  }
  return graphic
}

/** A Screen recording's fields from the chat: the clip's own video ('source') or a video the member already added to this clip. */
function checkScreenFields(fields: Record<string, string>, c: CandidateEdit): void {
  const video = fields.video ?? 'source'
  const known = (c.graphics ?? []).some((g) => g.fields.video === video)
  if (!isScreenVideo(video) || (video !== 'source' && !known)) fail('fields.video must be "source" (part of this clip\'s own video) or a video the member already added to a Screen recording on this clip.')
  fields.video = video
  if (fields.from !== undefined && !(Number(fields.from) >= 0)) fail('fields.from must be the seconds into the video where it starts.')
  if (fields.shape !== undefined && !(SCREEN_SHAPES as readonly string[]).includes(fields.shape)) fail(`fields.shape must be ${SCREEN_SHAPES.join(', ')}.`)
  if (fields.zoom !== undefined && fields.zoom.split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite).length !== 4) fail('fields.zoom must be "x, y, w, h" (0 to 1 of what the window shows).')
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
  if (patch.stage_scenes) patch.stage_scenes = parseScenes(patch.stage_scenes, project.duration_ms)
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
const SIZE_PROP = { type: 'string', enum: [...GRAPHIC_SIZES], description: 'compact, card (default) or stage (the top half of a vertical clip, over a Stage or Visual scene).' }
const DEPTH_PROP = { type: 'string', enum: [...GRAPHIC_DEPTHS], description: `behind: the speaker stands in front of the words ("put the words behind me"); only ${GRAPHIC_DEPTH_TEMPLATES.join(', ')}. Big words start behind.` }
const fieldsProp = {
  type: 'object',
  description: `Template text. stat: value, label · title: text · list/checklist: title, items (newline-separated, up to 5) · lower_third: name, role · before_after: before, after · quote: text, author · highlight: shape (arrow or circle), x, y (0..1 as text) · big_words: text (1-3 words said) · orbit: text (center label), items (3-6 node labels, newline-separated), icons (one per node from ${GRAPHIC_ICONS.join('/')}), labels ("off" hides them) · feature_tile: items (1-3 short labels), icons (one per label), dot ("on": a red notification dot) · screen_frame: video ("source": part of this clip's own video), from (seconds into it), zoom ("x, y, w, h" 0..1 of the view to zoom into slowly), label (window title), shape (wide, square or tall) · chapter: label (like "Step #1.", only a number the speaker says), title (the section's first words as said, title case), style (serif_caps, sans or pill); it sits at the very top for the whole section (duration up to the clip's length) and the hook hides when the first one starts · staircase: title, items (3-6 steps bottom to top), icons (one per step) · funnel: title, items (3-5 stages) · journey: title, items (3-5 milestones from start to goal) · growth: title, items (3-6, smallest first), style (plants or bars) · idea_hub: text (under the icon), items (3-6 qualities), icon (center icon, default idea) · compare_marks: items (the 2 cards), notes (a short line under each), wrong (first or second gets the red ✗). Diagram items light up as they are said; diagrams default to stage size and read best in a visual scene with the solid backdrop. Up to ${MAX_GRAPHIC_FIELD_CHARS} characters each. Words and numbers must come from what is said in the clip or from the member; never a brand logo. Text cards (big_words, title, statement, headline_pill) are timed to their spoken words automatically when they match the transcript near at_ms.`,
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
  { name: 'set_hook_look', description: 'Change how the hook text looks. Give only what changes.', parameters: { type: 'object', properties: { look: { type: 'string', enum: HEADLINE_LOOKS.map((l) => l.id) }, font: { type: 'string', enum: HEADLINE_FONTS.map((f) => f.id) }, color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', description: 'Bar color for the brand look.' }, ...HOOK_LOOK_TOOL_PROPERTIES, reason }, additionalProperties: false } },
  { name: 'set_layout_at', description: 'Frame the clip as fill (full frame, cropped), split (two panels stacked) or fit (whole frame, blurred background) from at_ms to until_ms (or to the end). at_ms at or before the clip start changes it from the start. With pin ("zoom in on this"): a fill crop centered on the pin, zoomed in (zoom, or about 1.6×; a box pin fills the frame); at_ms defaults to the pin\'s time. Give until_ms to zoom back out.', parameters: { type: 'object', properties: { at_ms: msProp('Source ms (optional with a pin).'), layout: { type: 'string', enum: ['fill', 'split', 'fit'] }, until_ms: msProp('Optional end, source ms.'), pin: PIN_PROP, zoom: { type: 'number', minimum: 1, maximum: MAX_POINT_ZOOM, description: 'With pin: how far to zoom in (1 = no zoom).' }, reason }, additionalProperties: false } },
  { name: 'set_captions', description: 'Turn burned-in captions on or off, or choose their style.', parameters: { type: 'object', properties: { on: { type: 'boolean' }, preset: { type: 'string', enum: [...CAPTION_PRESET_IDS] }, reason }, additionalProperties: false } },
  { name: 'set_title', description: 'Rename the clip (its title in the editor and Library).', parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, reason }, required: ['title'], additionalProperties: false } },
  { name: 'play', description: 'Play a moment of the source for the member (no edit). Use it to ask "is this the moment you mean?" before editing when you are not sure.', parameters: { type: 'object', properties: { at_ms: msProp('Source ms.'), seconds: { type: 'number', minimum: 1, maximum: MAX_PLAY_SECONDS }, reason }, required: ['at_ms'], additionalProperties: false } },
  { name: 'add_graphic', description: `Add a motion graphic over the clip (${GRAPHIC_TEMPLATES.filter((t) => t.id !== 'logo').map((t) => `${t.id}: ${t.detail}`).join(' ')}) With pin ("put an arrow here"): a highlight points at the pin (give fields.shape arrow or circle), another template sits in the band nearest it, and at_ms defaults to the pin's time.`, parameters: { type: 'object', properties: { template: { type: 'string', enum: GRAPHIC_TEMPLATES.filter((t) => t.id !== 'logo').map((t) => t.id) }, at_ms: msProp('Source ms, inside the clip. Time it to the words it shows.'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: CHAPTER_MAX_MS, description: `Up to ${GRAPHIC_MAX_MS} ms; a diagram up to ${DIAGRAM_MAX_MS}; a chapter header up to the clip's length.` }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, size: SIZE_PROP, depth: DEPTH_PROP, fields: fieldsProp, pin: PIN_PROP, reason }, required: ['template'], additionalProperties: false } },
  { name: 'update_graphic', description: 'Change a graphic on the clip by id. Give only what changes. With pin ("move the graphic here"): an arrow or circle points at the pin; another graphic moves to the band (top, middle or bottom) nearest it.', parameters: { type: 'object', properties: { id: { type: 'string' }, at_ms: msProp('Source ms.'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: CHAPTER_MAX_MS, description: `Up to ${GRAPHIC_MAX_MS} ms; a diagram up to ${DIAGRAM_MAX_MS}; a chapter header up to the clip's length.` }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, size: SIZE_PROP, depth: DEPTH_PROP, fields: fieldsProp, pin: PIN_PROP, reason }, required: ['id'], additionalProperties: false } },
  { name: 'remove_graphic', description: 'Remove a graphic from the clip by id.', parameters: { type: 'object', properties: { id: { type: 'string' }, reason }, required: ['id'], additionalProperties: false } },
  { name: 'set_scene', description: `Set start_ms–end_ms of a vertical clip to a scene (over whatever scene was there). face: the normal full-frame video (the default). stage: a backdrop with the speaker in a card at the bottom and the top free for graphics (use it while a graphic explains something). visual: backdrop only, so a big graphic fills the frame. At least ${MIN_SCENE_MS / 1000} s. The card slides and the backdrop fades between scenes.`, parameters: { type: 'object', properties: { start_ms: msProp('Source ms.'), end_ms: msProp('Source ms.'), scene: { type: 'string', enum: [...SCENE_KINDS] }, backdrop: { type: 'string', enum: [...SCENE_BACKDROPS], description: 'stage/visual only: light (default), dark, brand (a light tint of the hook color), grid (lavender to the brand color with a faint grid; captions go white on a color box), gradient (a soft brand gradient) or solid (the brand color itself, royal blue without one: for diagrams).' }, card: { type: 'string', enum: [...SCENE_CARDS], description: 'stage only: rounded (default) or arch (full width, big rounded top corners, flush with the bottom).' }, reason }, required: ['start_ms', 'end_ms', 'scene'], additionalProperties: false } }
]
