import { parseGraphics, type EditorGraphic } from './motion-graphics'
import { parseScenes, type StageScene } from './scenes'
/** Persisted source-time edits. Media paths and review results are main-process owned. */
import { DEFAULT_HEADLINE_LOOK, parseHeadlineLook, type HeadlineLook } from './headline-look'
import { isCaptionLanguage, type CaptionLanguage } from './caption-language'
import { parseScreenPair, type ScreenPair } from './screen-pair'
export type Crop = [number, number, number, number]
export type CropCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type EditorRange = [number, number]
export interface CameraScan {
  start_ms: number; end_ms: number
  /** Presentation times from every decoded source frame, never a guessed FPS. */
  frames: number[]
  markers: { at_ms: number; score: number }[]
}
export interface EditorScene {
  /** inset: the crop fitted over a blurred copy of itself; bubble: that, plus crops[1] in a round bubble (camera + screen projects). */
  at_ms: number; layout: 'fill' | 'split' | 'fit' | 'inset' | 'bubble'; crops: Crop[]
  /** Incoming eased movement, in source milliseconds. Absent/zero is a cut. */
  transition_ms?: number
  /** Split layout: the top panel's share of the output height (SPLIT_RANGE). Absent is an even split. */
  split?: number
}
export const SPLIT_RANGE = { min: 0.3, max: 0.7, default: 0.5 } as const
export const EDITOR_LAYOUTS: readonly EditorScene['layout'][] = ['fill', 'split', 'fit', 'inset', 'bubble']
/** Layouts with two crops. */
const TWO_CROPS: readonly string[] = ['split', 'bubble']
/** The hook text over a 9:16 clip: its words and look. */
export interface EditorHook { text: string; look: HeadlineLook }
export const MAX_HOOK_CHARS = 200
export interface EditorQuestion {
  id: string; prompt: string; yes: string; no: string; probability: number | null; threshold: number; status: string
}
export interface EditorReview {
  signature: string; reviewed_at: string; decision: string; questions: EditorQuestion[]
  cuts: { interval: EditorRange; questions: EditorQuestion[] }[]
}
export interface CandidateEdit {
  id: string; title: string; ranges: EditorRange[]; scenes: EditorScene[]
  captions: boolean; caption_preset: string; video_speed: number
  status: 'refining' | 'ready' | 'baked' | 'discarded'
  caption_edits: { segment: number; text: string }[]
  /** Source-time intervals where our burned-in captions are hidden. */
  caption_suppression_ranges: EditorRange[]
  /** Caption block center, as a fraction of output height. Null uses layout placement. */
  caption_y?: number | null
  dismissed_camera_markers?: number[]
  /** Hook text: absent keeps the run's original, null removes it. */
  hook?: EditorHook | null
  /** Call to action added after export: absent uses the run's, null none. */
  cta_id?: string | null
  /** Motion graphics on the clip (motion-graphics.ts). Absent = none. */
  graphics?: EditorGraphic[]
  /** Scenes (scenes.ts): face / stage / visual stretches in SOURCE time. Absent = face throughout.
   * (Named apart from `scenes`, the clip's framing layouts.) */
  stage_scenes?: StageScene[]
}
/**
 * What an Automatic run's pass did to a clip, saved when the run is opened in the editor
 * (engine automatic_editor.py), so "What changed" can list it and put pieces back.
 * Main-owned: never sent back in edits. Older projects have none.
 */
export interface AutoEditBaseline {
  /** The moment the planner picked (source ms), before the cut and any boundary change. Absent when unknown. */
  moment?: EditorRange
  /** The cut as the run made it. Absent when the run didn't save its cut (it was worked out again). */
  ranges?: EditorRange[]
  /** Up to 4 words said in the part left out before the start / after the end (from the transcript's word timing). */
  before_words?: string
  after_words?: string
  /** The hook text the run drew, or null for none. */
  hook: string | null
  captions: boolean
  caption_preset: string
  /** Source times of the split-screen layouts the run used. */
  split_at: number[]
}
export interface EditorCandidate extends CandidateEdit {
  camera_scan?: CameraScan
  auto?: AutoEditBaseline
  requires_visual_context?: boolean; score: number; reason: string; review: EditorReview | null; exports: number[]
  /** Main-owned: SHA-256 of the last baked render identity, so undoing "Refine again" can restore Baked. */
  baked_hash?: string
  /** An Automatic run's clip: exporting replaces this Library clip (same index) instead of adding one. */
  library_clip?: number
  /** Captions were translated into this language: a new render translates them again. */
  caption_language?: CaptionLanguage
  /** Main-owned: the call to action was changed in the editor (an Automatic clip's export then keeps it instead of the Library clip's current one). */
  cta_edited?: true
}
/** What an Automatic run drew that the editor can't make again; shown before a clip is baked again. */
export type AutomaticOmission = 'broll' | 'hook_preview' | 'background' | 'title_card'
export const AUTOMATIC_OMISSIONS: readonly AutomaticOmission[] = ['broll', 'hook_preview', 'background', 'title_card']
/** A project made from an Automatic run's finished clips (not a Review & edit run). */
export interface AutomaticOrigin {
  omitted: AutomaticOmission[]
  /** Clips whose cut was worked out again (older runs didn't save it), not read from the run. */
  estimated_cuts: number
  brand_mark?: { handle: string; logo: boolean; position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
  cta_keyword?: string
  cta_offer?: string
}
export interface EditorProject {
  version: 1; revision: number; title: string; duration_ms: number; width: number; height: number
  /** Main-owned media generation; absent on projects using the original source. */
  source_id?: string
  preview_id?: string
  frame_preview?: boolean
  /** Source and preview were deleted to save space; the project is read-only. */
  media_freed?: boolean
  aspect_ratio: '9:16' | '16:9'; candidates: EditorCandidate[]
  transcript: { start_ms: number; end_ms: number; text: string }[]
  /** Whose voice hook ideas are written in (the run's headline voice). Absent: 'clipper'. */
  headline_voice?: 'clipper' | 'creator'
  automatic?: AutomaticOrigin
  /** Camera + screen (screen-pair.ts): where the camera and the screen are in the source. */
  pair?: ScreenPair
  /** An edited reel (Edit my recording): the brand's handle or logo the bake draws in a corner. */
  brand_mark?: BrandMarkOrigin
}
export type BrandMarkOrigin = NonNullable<AutomaticOrigin['brand_mark']>
export interface EditorProgress { phase: 'scan' | 'preview' | 'download' | 'copy'; percent: number }
export type EditorOperation = 'save' | 'review' | 'export' | 'export-all' | 'replace-source' | 'scan-cameras' | 'suggest-hooks' | 'prepare'
export interface EditorBatch { completed: number; total: number; failed?: number }
export interface EditorSession {
  progress?: EditorProgress; project: EditorProject; sourcePath: string; previewPath: string
  operation?: EditorOperation | null; batch?: EditorBatch
  /** Bytes used by the editor's source and preview, freed by "Free editor media". */
  mediaBytes?: number
  /** A project made from an Automatic run whose video is gone: open it again to get the video back. */
  mediaMissing?: boolean
}
/** How an Automatic run (or a project made from one) gets its video for the editor. */
export interface AutomaticEditInfo {
  /** ready: open the editor; convert: make the editor project first; restore: get the project's video again. */
  state: 'ready' | 'convert' | 'restore'
  /** kept: the copy saved with the run; original: the file the run was made from; download: the run's link. */
  source: 'kept' | 'original' | 'download' | 'missing'
  /** The run's link or file name, for the explanation. */
  videoLabel: string
  /** Size of the original file, which is copied into the run. */
  copyBytes?: number
  clipCount: number
  /** Some clips' cuts weren't saved with the run (older runs): converting works them out again, so they may differ slightly. */
  estimatedCuts?: boolean
}
/** Status counts for Library and Jobs, without sending the project to the renderer. */
export interface EditorProgressSummary {
  total: number; remaining: number; initialCandidate: number
  counts: Record<CandidateEdit['status'], number>
  /** Preview frame for a run without exports; null once media is freed. */
  previewPath: string | null; thumbnailMs: number; mediaFreed: boolean
  operation: EditorOperation | null; batch?: EditorBatch; progress?: EditorProgress
}

/** Main's stale-revision save error. The editor offers "Reload project" for it. */
export const EDITOR_REVISION_CONFLICT = 'This project changed. Reopen it before saving.'
/** Fixed worker failure codes (see bridge/editor_runner.py); no tool output crosses the bridge. */
export const editorErrorCodes = ['duration', 'geometry', 'audio', 'invalid', 'project_changed', 'invalid_edit', 'not_ready',
  'source_missing', 'source_incompatible', 'render_failed', 'scan_too_long', 'review_unavailable', 'hooks_unavailable', 'engine_unavailable',
  'transcript_missing', 'source_changed', 'download_failed', 'translation_failed', 'cancelled', 'timeout'] as const
export type EditorErrorCode = typeof editorErrorCodes[number]
export function isEditorErrorCode(value: unknown): value is EditorErrorCode {
  return typeof value === 'string' && (editorErrorCodes as readonly string[]).includes(value)
}

export const sourceReplacementErrors: Record<string, string> = {
  duration: 'The replacement has a different duration. Choose the exact same video with the same timing.',
  geometry: 'The replacement has different framing or orientation. Choose the same video and aspect ratio.',
  audio: 'The replacement has different audio availability. Choose the same video with the same audio.',
  invalid: 'Could not read the replacement video. Choose a playable video file.'
}

const logs = 'Details are in Help → Show Logs.'
const common: Partial<Record<EditorErrorCode, string>> = {
  project_changed: 'This project changed. Reopen the editor and try again.',
  source_missing: "The editor's source video is missing. Use Replace source with the original video, then try again.",
  source_incompatible: "FFmpeg could not read the editor's source video. Use Replace source with a playable copy of the same video.",
  engine_unavailable: 'The video engine could not start. Open Settings and run System check.'
}
/** A user-facing message for a failed editor worker. Only render setup problems point to System check. */
export function editorFailureMessage(action: Exclude<EditorOperation, 'save'>, code?: EditorErrorCode): string {
  if (action === 'replace-source') {
    if (code && Object.hasOwn(sourceReplacementErrors, code)) return sourceReplacementErrors[code]
    return code === 'cancelled' ? 'Source replacement canceled. The previous source is still in use.'
      : code === 'timeout' ? 'Source replacement took too long and was stopped. The previous source is still in use.'
      : code === 'render_failed' ? `Could not prepare a preview from the replacement video. The previous source is still in use. ${logs}`
      : code && common[code] ? common[code]!
      : 'Source replacement stopped or failed. Reopen the editor to check its current source, then try again.'
  }
  if (action === 'prepare') {
    return code === 'download_failed' ? 'Could not download this video again. It may now be private, removed or need a sign-in. If you have the video file, choose it instead.'
      : code === 'source_changed' ? "That video doesn't match this run: its length is different. Choose the same video the clips were made from."
      : code === 'transcript_missing' ? "This run has no saved transcript, so its clips can't be opened in the editor."
      : code === 'source_missing' ? 'The source video for this run is missing. Choose the video file to continue.'
      : code === 'source_incompatible' ? 'FFmpeg could not read this video. Choose a playable copy of the same video.'
      : code === 'render_failed' ? `Could not prepare the editor preview. Your clips are unchanged. ${logs}`
      : code === 'invalid_edit' ? "This run's clips could not be opened in the editor. Your clips are unchanged."
      : code === 'cancelled' ? 'Opening the editor was canceled. Your clips are unchanged.'
      : code === 'timeout' ? 'Preparing the editor took too long and was stopped. Your clips are unchanged.'
      : code && common[code] ? common[code]!
      : `Could not open this run in the editor. Your clips are unchanged. ${logs}`
  }
  if (action === 'scan-cameras') {
    return code === 'scan_too_long' ? 'This clip is too long to scan for camera changes. Try scanning a shorter clip. Your edits and previous markers are saved.'
      : code === 'cancelled' ? 'Camera scan canceled. Your edits and previous markers are saved.'
      : code && common[code] ? `${common[code]} Your edits and previous markers are saved.`
      : 'Camera scan stopped or failed. Your edits and previous markers are saved. Try scanning a shorter clip.'
  }
  if (action === 'suggest-hooks') {
    return code === 'hooks_unavailable' ? 'Could not get hook ideas. Check your OpenRouter key and connection, then try again.'
      : code === 'cancelled' ? 'Hook ideas canceled.'
      : code === 'timeout' ? 'Hook ideas took too long and were stopped. Try again.'
      : code && common[code] ? common[code]!
      : 'Could not get hook ideas. Try again.'
  }
  if (action === 'review') {
    return code === 'review_unavailable' ? 'Jev could not review this edit. Check your OpenRouter key and connection, then try again. Your previous review is preserved.'
      : code === 'cancelled' ? 'Review canceled. Your previous review is preserved.'
      : code && common[code] ? `${common[code]} Your previous review is preserved.`
      : 'Review stopped or failed. Your previous review is preserved. Try again.'
  }
  return code === 'render_failed' ? `Rendering failed. Your edits are saved. Try again, or simplify this clip's layouts. ${logs}`
    : code === 'translation_failed' ? 'Could not translate the captions. Check your OpenRouter key and connection, then try again. Your edits are saved.'
    : code === 'invalid_edit' ? "This clip has an edit that can't be rendered. Check its cuts, layouts and captions, then try again."
    : code === 'not_ready' ? 'Mark this clip ready before baking it.'
    : code === 'timeout' ? 'Rendering took too long and was stopped. Your edits are saved.'
    : code === 'cancelled' ? 'Export canceled.'
    : code && common[code] ? common[code]!
    : `Export stopped or failed. Your edits are saved. Try again. ${logs}`
}

export function editorProgress(candidates: Pick<CandidateEdit, 'status'>[]): { remaining: number; initialCandidate: number } {
  const unfinished = (c: Pick<CandidateEdit, 'status'>): boolean => c.status !== 'baked' && c.status !== 'discarded'
  const first = candidates.findIndex(unfinished)
  return { remaining: candidates.filter(unfinished).length,
    initialCandidate: Math.max(0, first >= 0 ? first : candidates.findIndex((c) => c.status === 'baked')) }
}

const fail = (): never => { throw new Error('Invalid editor project') }
const record = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : fail()
const num = (x: unknown, lo: number, hi: number): number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : fail()
const str = (x: unknown, max: number): string => typeof x === 'string' && x.length <= max ? x : fail()
/** Display text: clamp to `max` UTF-16 units without splitting a surrogate pair, never reject for length. */
export function clampText(x: unknown, max: number): string {
  if (typeof x !== 'string') return fail()
  if (x.length <= max) return x
  const end = /[\uD800-\uDBFF]/.test(x[max - 1] ?? '') ? max - 1 : max
  return x.slice(0, end)
}
const arr = (x: unknown, max: number): unknown[] => Array.isArray(x) && x.length <= max ? x : fail()
export function parseCandidateEdit(value: unknown, duration: number, transcriptCount = 100000): CandidateEdit {
  const v = record(value)
  const ranges = arr(v.ranges, 24).map((r) => {
    const a = arr(r, 2); if (a.length !== 2) fail()
    return [Math.round(num(a[0], 0, duration)), Math.round(num(a[1], 0, duration))] as EditorRange
  })
  if (!ranges.length || ranges.some(([a, b], i) => b - a < 100 || (i > 0 && a < ranges[i - 1][1]))) fail()
  const scenes = arr(v.scenes, 60).map((s): EditorScene => {
    const x = record(s)
    if (!EDITOR_LAYOUTS.includes(x.layout as EditorScene['layout'])) fail()
    const crops = arr(x.crops, 2).map((r): Crop => {
      const c = arr(r, 4).map((n) => num(n, 0, 1))
      if (c.length !== 4 || c[2] < .01 || c[3] < .01 || c[0] + c[2] > 1.000001 || c[1] + c[3] > 1.000001) fail()
      return c as Crop
    })
    if (crops.length !== (TWO_CROPS.includes(x.layout as string) ? 2 : 1)) fail()
    const transition = x.transition_ms === undefined ? 0 : num(x.transition_ms, 0, 5000)
    if (transition > 0 && (transition < 100 || !Number.isInteger(transition))) fail()
    const split = x.layout === 'split' && x.split !== undefined && x.split !== null ? num(x.split, SPLIT_RANGE.min, SPLIT_RANGE.max) : undefined
    return { at_ms: num(x.at_ms, 0, duration), layout: x.layout as EditorScene['layout'], crops,
      ...(transition ? { transition_ms: transition } : {}), ...(split !== undefined && split !== SPLIT_RANGE.default ? { split } : {}) }
  })
  if (!scenes.length || scenes[0].at_ms !== 0 || scenes.some((s, i) => i > 0 && s.at_ms <= scenes[i - 1].at_ms)) fail()
  if (scenes.some((s, i) => s.transition_ms && !canAnimateScene(scenes, i))) fail()
  const id = str(v.id, 64); if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail()
  const title = clampText(v.title, 200); if (!title.trim()) fail()
  const caption_preset = str(v.caption_preset, 64); if (!/^[a-z0-9_-]+$/i.test(caption_preset)) fail()
  if (typeof v.captions !== 'boolean') fail()
  const status = v.status === undefined ? 'refining' : v.status
  if (!['refining', 'ready', 'baked', 'discarded'].includes(status as string)) fail()
  const seen = new Set<number>()
  const caption_edits = arr(v.caption_edits === undefined ? [] : v.caption_edits, 2000).map((item) => {
    const edit = record(item), segment = num(edit.segment, 0, transcriptCount - 1), text = str(edit.text, 2000)
    if (!Number.isInteger(segment) || seen.has(segment) || [...text].some((char) => char.charCodeAt(0) < 32 && !'\t\n\r'.includes(char))) fail()
    seen.add(segment)
    return { segment, text }
  }).sort((a, b) => a.segment - b.segment)
  const caption_suppression_ranges = arr(v.caption_suppression_ranges === undefined ? [] : v.caption_suppression_ranges, 200).map((r) => {
    const a = arr(r, 2); if (a.length !== 2) fail()
    return [Math.round(num(a[0], 0, duration)), Math.round(num(a[1], 0, duration))] as EditorRange
  })
  if (caption_suppression_ranges.some(([a, b], i) => b - a < 100 || (i > 0 && a < caption_suppression_ranges[i - 1][1]))) fail()
  return { id, title, ranges, scenes, captions: v.captions as boolean, caption_preset, video_speed: num(v.video_speed, 1, 2),
    status: status as CandidateEdit['status'], caption_edits, caption_suppression_ranges,
    caption_y: v.caption_y == null ? null : num(v.caption_y, .1, .9),
    ...(v.hook === undefined ? {} : { hook: parseHook(v.hook) }),
    ...(v.cta_id === undefined ? {} : { cta_id: v.cta_id === null ? null : /^[a-f0-9]{16}$/.test(str(v.cta_id, 16)) ? v.cta_id as string : fail() }),
    ...(v.graphics === undefined ? {} : { graphics: parseGraphics(v.graphics) }),
    ...(v.stage_scenes === undefined ? {} : { stage_scenes: parseScenes(v.stage_scenes, duration) }),
    ...(v.dismissed_camera_markers === undefined ? {} : { dismissed_camera_markers: [...new Set(arr(v.dismissed_camera_markers, 5000).map((t) => num(t, 0, duration)))].sort((a, b) => a - b) }) }
}
/** A hook from the project or the renderer: null (none) or text and a look. */
export function parseHook(value: unknown): EditorHook | null {
  if (value === null) return null
  const v = record(value)
  const text = str(v.text, MAX_HOOK_CHARS * 2).replace(/\s+/g, ' ').trim()
  // No control characters (the engine refuses them too).
  if (!text || text.length > MAX_HOOK_CHARS || [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fail()
  let look: HeadlineLook
  try { look = parseHeadlineLook(v.look) } catch { return fail() }
  return { text, look }
}
function question(value: unknown): EditorQuestion {
  const v = record(value)
  return { id: str(v.id, 64), prompt: clampText(v.prompt, 4000), yes: clampText(v.yes, 4000), no: clampText(v.no, 4000),
    probability: v.probability === null ? null : num(v.probability, 0, 1), threshold: num(v.threshold, 0, 1), status: str(v.status, 64) }
}
export function parseEditorProject(value: unknown): EditorProject {
  const v = record(value)
  if (v.source_id !== undefined && (typeof v.source_id !== 'string' || !/^[a-f0-9]{32}$/.test(v.source_id))) fail()
  if (v.preview_id !== undefined && (typeof v.preview_id !== 'string' || !/^[a-f0-9]{32}$/.test(v.preview_id))) fail()
  if (v.version !== 1 || !['9:16', '16:9'].includes(v.aspect_ratio as string)) fail()
  const duration = num(v.duration_ms, 100, 24 * 3600000)
  const transcript = arr(v.transcript, 100000).map((row) => { const t = record(row); return { start_ms: num(t.start_ms, 0, duration), end_ms: num(t.end_ms, 0, duration), text: clampText(t.text, 20000) } })
  const ids = new Set<string>()
  const candidates = arr(v.candidates, 100).map((item): EditorCandidate => {
    const c = record(item), edit = parseCandidateEdit(c, duration, transcript.length)
    if (ids.has(edit.id)) fail(); ids.add(edit.id)
    let review: EditorReview | null = null
    if (c.review) {
      const r = record(c.review)
      review = { signature: str(r.signature, 200000), reviewed_at: str(r.reviewed_at, 64), decision: str(r.decision, 64),
        questions: arr(r.questions, 32).map(question), cuts: arr(r.cuts, 24).map((cut) => {
          const x = record(cut), t = arr(x.interval, 2)
          if (t.length !== 2) fail()
          return { interval: [num(t[0], 0, duration), num(t[1], 0, duration)], questions: arr(x.questions, 16).map(question) }
        }) }
    }
    let camera_scan: CameraScan | undefined
    if (c.camera_scan !== undefined) {
      const scan = record(c.camera_scan), start_ms = num(scan.start_ms, 0, duration), end_ms = num(scan.end_ms, start_ms, duration)
      const frames = arr(scan.frames, 120000).map((t) => num(t, start_ms, end_ms))
      if (!frames.length || frames.some((t, i) => i > 0 && t <= frames[i - 1])) fail()
      const times = new Set(frames)
      const markers = arr(scan.markers, 5000).map((m) => { const x = record(m); return { at_ms: num(x.at_ms, start_ms, end_ms), score: num(x.score, 0, 1) } })
      if (markers.some((m, i) => !times.has(m.at_ms) || (i > 0 && m.at_ms <= markers[i - 1].at_ms))) fail()
      camera_scan = { start_ms, end_ms, frames, markers }
    }
    const auto = c.auto === undefined ? undefined : parseAutoBaseline(c.auto, duration)
    const baked_hash = typeof c.baked_hash === 'string' && /^[a-f0-9]{64}$/.test(c.baked_hash) ? c.baked_hash : undefined
    const library_clip = c.library_clip === undefined ? undefined : Number.isInteger(c.library_clip) ? num(c.library_clip, 0, 999) : fail()
    if (c.caption_language !== undefined && !isCaptionLanguage(c.caption_language)) fail()
    return { ...edit, ...(camera_scan ? { camera_scan } : {}), ...(auto ? { auto } : {}), ...(baked_hash ? { baked_hash } : {}),
      ...(library_clip !== undefined ? { library_clip } : {}), ...(c.cta_edited === true ? { cta_edited: true as const } : {}), ...(c.caption_language !== undefined ? { caption_language: c.caption_language as CaptionLanguage } : {}),
      requires_visual_context: c.requires_visual_context === true, score: num(c.score, 0, 100), reason: clampText(c.reason, 4000), review,
      exports: arr(c.exports, 1000).map((n) => num(n, 0, 999)) }
  })
  if (!candidates.length) fail()
  return { version: 1, revision: num(v.revision, 0, Number.MAX_SAFE_INTEGER), title: clampText(v.title, 1024), duration_ms: duration,
    width: num(v.width, 2, 16384), height: num(v.height, 2, 16384), aspect_ratio: v.aspect_ratio as EditorProject['aspect_ratio'], candidates,
    transcript, ...(v.headline_voice === 'creator' || v.headline_voice === 'clipper' ? { headline_voice: v.headline_voice } : {}),
    ...(v.automatic !== undefined ? { automatic: parseAutomaticOrigin(v.automatic) } : {}),
    ...(v.pair !== undefined ? { pair: parseScreenPair(v.pair) ?? fail() } : {}),
    ...(v.brand_mark !== undefined ? { brand_mark: parseBrandMark(v.brand_mark) } : {}),
    ...(v.preview_id ? { preview_id: v.preview_id as string } : {}), ...(v.frame_preview === true ? { frame_preview: true } : {}), ...(v.media_freed === true ? { media_freed: true } : {}), ...(v.source_id ? { source_id: v.source_id as string } : {}) }
}
/** A saved baseline, or undefined when it is malformed (the clip then just shows fewer "What changed" lines). */
function parseAutoBaseline(value: unknown, duration: number): AutoEditBaseline | undefined {
  try {
    const v = record(value)
    const range = (x: unknown): EditorRange => {
      const a = arr(x, 2); if (a.length !== 2) fail()
      const r: EditorRange = [Math.round(num(a[0], 0, duration)), Math.round(num(a[1], 0, duration))]
      return r[1] > r[0] ? r : fail()
    }
    const words = (x: unknown): string | undefined => x === undefined ? undefined : clampText(x, 120).replace(/\s+/g, ' ').trim() || undefined
    const ranges = v.ranges === undefined ? undefined : arr(v.ranges, 24).map(range)
    if (ranges && (!ranges.length || ranges.some(([a], i) => i > 0 && a < ranges[i - 1][1]))) fail()
    const before_words = words(v.before_words), after_words = words(v.after_words)
    return {
      ...(v.moment === undefined ? {} : { moment: range(v.moment) }), ...(ranges ? { ranges } : {}),
      ...(before_words ? { before_words } : {}), ...(after_words ? { after_words } : {}),
      hook: v.hook === null || v.hook === undefined ? null : clampText(v.hook, MAX_HOOK_CHARS),
      captions: v.captions === true, caption_preset: /^[a-z0-9_-]{1,64}$/i.test(str(v.caption_preset, 64)) ? v.caption_preset as string : fail(),
      split_at: arr(v.split_at ?? [], 60).map((t) => Math.round(num(t, 0, duration)))
    }
  } catch { return undefined }
}
function parseBrandMark(value: unknown): BrandMarkOrigin {
  const m = record(value)
  if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(m.position as string) || typeof m.logo !== 'boolean') fail()
  return { handle: str(m.handle, 80), logo: m.logo as boolean, position: m.position as BrandMarkOrigin['position'] }
}
function parseAutomaticOrigin(value: unknown): AutomaticOrigin {
  const v = record(value)
  const omitted = arr(v.omitted, AUTOMATIC_OMISSIONS.length).map((x) => AUTOMATIC_OMISSIONS.includes(x as AutomaticOmission) ? x as AutomaticOmission : fail())
  const origin: AutomaticOrigin = { omitted: [...new Set(omitted)], estimated_cuts: v.estimated_cuts === undefined ? 0 : Math.round(num(v.estimated_cuts, 0, 1000)) }
  if (v.brand_mark !== undefined) origin.brand_mark = parseBrandMark(v.brand_mark)
  if (v.cta_keyword !== undefined) origin.cta_keyword = /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(str(v.cta_keyword, 20)) ? v.cta_keyword as string : fail()
  if (v.cta_offer !== undefined) origin.cta_offer = str(v.cta_offer, 200)
  return origin
}
export function candidateEdit(c: CandidateEdit): CandidateEdit {
  const { id, title, ranges, scenes, captions, caption_preset, video_speed, status, caption_edits, caption_suppression_ranges = [], dismissed_camera_markers } = c
  return { id, title, ranges, scenes, captions, caption_preset, video_speed, status, caption_edits, caption_suppression_ranges, caption_y: c.caption_y ?? null,
    ...(dismissed_camera_markers ? { dismissed_camera_markers } : {}), ...(c.hook !== undefined ? { hook: c.hook } : {}), ...(c.cta_id !== undefined ? { cta_id: c.cta_id } : {}),
    // Kept even when empty, so removing a clip's last graphic saves (main merges edits over the stored clip).
    ...(c.graphics !== undefined ? { graphics: c.graphics } : {}),
    ...(c.stage_scenes !== undefined ? { stage_scenes: c.stage_scenes } : {}) }
}
export function renderEditKey(c: CandidateEdit): string {
  // The call to action is added after rendering, so changing it doesn't need a new render.
  return JSON.stringify({ ...candidateEdit(c), status: undefined, dismissed_camera_markers: undefined, cta_id: undefined, graphics: c.graphics?.length ? c.graphics : undefined,
    stage_scenes: c.stage_scenes?.length ? c.stage_scenes : undefined })
}
export function refineEdit<T extends CandidateEdit>(c: T, patch: Partial<CandidateEdit>): T {
  const next = { ...c, ...patch }
  if (patch.status === undefined && renderEditKey(c) !== renderEditKey(next)) next.status = 'refining'
  return next
}
export function editSignature(c: CandidateEdit): string {
  // Preserve existing review signatures for projects without motion.
  return JSON.stringify([c.title, c.ranges, c.scenes.map((s) => [s.at_ms, s.layout, s.crops, ...(s.transition_ms ? [s.transition_ms] : [])])])
}
export function sceneAt(c: CandidateEdit, t: number): EditorScene {
  return [...c.scenes].reverse().find((s) => s.at_ms <= t) ?? c.scenes[0]
}
/** Move a layout boundary without reordering scenes or changing their framing. */
export function retimeScene(scenes: EditorScene[], index: number, time: number, duration: number, frames?: number[]): EditorScene[] {
  if (index <= 0 || index >= scenes.length || !Number.isFinite(time)) return scenes
  const lo = scenes[index - 1].at_ms + 1
  const hi = Math.min(scenes[index + 1]?.at_ms ?? duration, duration) - 1
  if (hi < lo) return scenes
  const bounded = Math.max(lo, Math.min(hi, time))
  const at_ms = frames?.length ? snapFrame(frames, bounded) : Math.round(bounded)
  if (at_ms < lo || at_ms > hi) return scenes
  return at_ms === scenes[index].at_ms ? scenes : scenes.map((s, i) => i === index ? { ...s, at_ms } : s)
}
export function canAnimateScene(scenes: EditorScene[], index: number): boolean {
  // A split animates its crops, never its size: both sides need the same split.
  return index > 0 && (scenes[index].layout === 'fill' || scenes[index].layout === 'split') && scenes[index - 1].layout === scenes[index].layout && splitOf(scenes[index - 1]) === splitOf(scenes[index])
}
/** The top panel's share of the height (1 for a single-panel layout). */
export function splitOf(scene: Pick<EditorScene, 'layout' | 'split'>): number {
  return scene.layout === 'split' ? scene.split ?? SPLIT_RANGE.default : 1
}
/** Each panel's output rectangle as [y, height] fractions of the output. */
export function panelRows(scene: Pick<EditorScene, 'layout' | 'split'>): [number, number][] {
  const top = splitOf(scene)
  return scene.layout === 'split' ? [[0, top], [top, 1 - top]] : [[0, 1]]
}
/** Fit a crop to a panel's aspect (output width / panel height in pixels), keeping its center and height where possible. */
export function fitCropToAspect(crop: Crop, aspect: number, width: number, height: number): Crop {
  let h = crop[3], w = h * height * aspect / width
  if (w > 1) { w = 1; h = w * width / (aspect * height) }
  if (h > 1) { h = 1; w = h * height * aspect / width }
  const cx = crop[0] + crop[2] / 2, cy = crop[1] + crop[3] / 2
  return [Math.max(0, Math.min(1 - w, cx - w / 2)), Math.max(0, Math.min(1 - h, cy - h / 2)), w, h]
}
/** Change a split scene's size, re-fitting both crops to their new panel shapes. */
export function resizeSplit(scene: EditorScene, split: number, outAspect: number, width: number, height: number): EditorScene {
  const s = Math.round(Math.max(SPLIT_RANGE.min, Math.min(SPLIT_RANGE.max, split)) * 100) / 100
  if (scene.layout !== 'split') return scene
  const crops = scene.crops.map((crop, i) => fitCropToAspect(crop, outAspect / (i === 0 ? s : 1 - s), width, height))
  const next: EditorScene = { ...scene, crops }
  delete next.split
  if (s !== SPLIT_RANGE.default) next.split = s
  return next
}
export function normalizeSceneTransitions(scenes: EditorScene[]): EditorScene[] {
  return scenes.map((s, i) => canAnimateScene(scenes, i) ? s : { ...s, transition_ms: undefined })
}
/** The same source-time smoothstep and interrupted-motion behavior as export. */
export function framingAt(c: CandidateEdit, t: number): EditorScene {
  let scene = c.scenes[0], from = scene.crops
  const cropsAt = (at: number): Crop[] => {
    const p = scene.transition_ms ? Math.max(0, Math.min(1, (at - scene.at_ms) / scene.transition_ms)) : 1
    const ease = p * p * (3 - 2 * p)
    return scene.crops.map((crop, j) => crop.map((n, k) => from[j][k] + (n - from[j][k]) * ease) as Crop)
  }
  for (let i = 1; i < c.scenes.length && c.scenes[i].at_ms <= t; i++) {
    const next = c.scenes[i]
    from = next.transition_ms && canAnimateScene(c.scenes, i) ? cropsAt(next.at_ms) : next.crops
    scene = next
  }
  return { ...scene, crops: cropsAt(t) }
}
export function trimRange(ranges: EditorRange[], index: number, edge: 0 | 1, time: number, duration: number): EditorRange[] {
  const next = ranges.map((r) => [...r] as EditorRange)
  const lo = edge === 0 ? (index ? ranges[index - 1][1] : 0) : ranges[index][0] + 100
  const hi = edge === 0 ? ranges[index][1] - 100 : (index + 1 < ranges.length ? ranges[index + 1][0] : duration)
  next[index][edge] = Math.max(lo, Math.min(hi, Math.round(time)))
  return next
}
export function defaultCrop(width: number, height: number, aspect: number, cx = .5, cy = .5, zoom = 1): Crop {
  const w = Math.min(1, height * aspect / width) / zoom, h = Math.min(1, width / aspect / height) / zoom
  return [Math.max(0, Math.min(1 - w, cx - w / 2)), Math.max(0, Math.min(1 - h, cy - h / 2)), w, h]
}
/** Resize in screen pixels, preserving proportions and the opposite corner. */
export function resizeCrop(crop: Crop, corner: CropCorner, dx: number, dy: number, frameWidth: number, frameHeight: number): Crop {
  const [x, y, w, h] = crop
  if (![dx, dy, frameWidth, frameHeight].every(Number.isFinite) || frameWidth <= 0 || frameHeight <= 0) return crop
  const sx = corner.endsWith('right') ? 1 : -1, sy = corner.startsWith('bottom') ? 1 : -1
  const ax = x + (sx < 0 ? w : 0), ay = y + (sy < 0 ? h : 0)
  const pixelW = w * frameWidth, pixelH = h * frameHeight
  // Project the pointer onto the corner's diagonal, so either axis can resize.
  const proposed = 1 + (sx * dx * pixelW + sy * dy * pixelH) / (pixelW * pixelW + pixelH * pixelH)
  const maximum = Math.min((sx > 0 ? 1 - ax : ax) / w, (sy > 0 ? 1 - ay : ay) / h)
  // Match the zoom slider's 4× limit, while retaining smaller legacy crops.
  const minimum = Math.max(.01 / w, .01 / h, Math.min(1, Math.min(1 / w, 1 / h) / 4))
  const scale = Math.max(minimum, Math.min(maximum, proposed))
  const nw = Math.max(.01, Math.min(1, w * scale)), nh = Math.max(.01, Math.min(1, h * scale))
  return [Math.max(0, Math.min(1 - nw, sx > 0 ? ax : ax - nw)), Math.max(0, Math.min(1 - nh, sy > 0 ? ay : ay - nh)), nw, nh]
}
export function editDuration(c: CandidateEdit): number { return c.ranges.reduce((n, [a, b]) => n + b - a, 0) / c.video_speed }

/** Where source time `t` (ms) lands in the exported clip (ms): the kept time before it, at the export speed. */
export function outputTimeAt(c: Pick<CandidateEdit, 'ranges' | 'video_speed'>, t: number): number {
  return c.ranges.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0) / (c.video_speed || 1)
}

/** Lower bound with a small tolerance for browser media timestamps. */
function frameIndex(frames: number[], time: number): number {
  let lo = 0, hi = frames.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (frames[mid] < time - .01) lo = mid + 1; else hi = mid }
  return lo
}
export function snapFrame(frames: number[], time: number): number {
  if (!frames.length || time < frames[0] || time > frames[frames.length - 1]) return time
  const i = frameIndex(frames, time)
  return i && time - frames[i - 1] < frames[i] - time ? frames[i - 1] : frames[i]
}
export function stepFrame(frames: number[], time: number, direction: -1 | 1): number {
  // Scans cover only part of the source. Continue with the pre-scan 30 fps
  // estimate outside that window, stopping at a known frame when re-entering.
  const fallback = time + direction * 1000 / 30
  if (!frames.length) return fallback
  if (time < frames[0] - .01) return direction > 0 ? Math.min(frames[0], fallback) : fallback
  if (time > frames[frames.length - 1] + .01) return direction < 0 ? Math.max(frames[frames.length - 1], fallback) : fallback
  const i = frameIndex(frames, time)
  if (direction < 0) return frames[i - 1] ?? fallback
  return frames[i + (Math.abs((frames[i] ?? Infinity) - time) < .01 ? 1 : 0)] ?? fallback
}
export function cameraMarkers(c: EditorCandidate, threshold: number): CameraScan['markers'] {
  const dismissed = new Set(c.dismissed_camera_markers ?? [])
  return (c.camera_scan?.markers ?? []).filter((m) => m.score >= threshold && !dismissed.has(m.at_ms) && c.ranges.some(([a, b]) => m.at_ms > a && m.at_ms < b))
}

/** A project holds at most this many clips (parseEditorProject's limit). */
export const MAX_EDITOR_CANDIDATES = 100
/** A clip made from transcript lines: whole lines, at least 3 seconds and at most 3 minutes. */
export const TRANSCRIPT_CLIP_MS = { min: 3000, max: 180000 } as const
type TranscriptRow = EditorProject['transcript'][number]

/** Snap a run of transcript lines to a source range: whole lines, padded to the minimum, cut to the maximum. */
export function transcriptRange(transcript: TranscriptRow[], first: number, last: number, duration: number): EditorRange | null {
  const lo = Math.min(first, last), hi = Math.max(first, last)
  if (!Number.isInteger(lo) || lo < 0 || hi >= transcript.length) return null
  const start = Math.max(0, Math.round(transcript[lo].start_ms))
  let end = Math.round(transcript[lo].end_ms)
  // Longest run of whole lines that fits; a single over-long line is cut at the maximum.
  for (let i = lo; i <= hi; i++) { if (transcript[i].end_ms - start > TRANSCRIPT_CLIP_MS.max) break; end = Math.round(transcript[i].end_ms) }
  end = Math.min(duration, end, start + TRANSCRIPT_CLIP_MS.max)
  // Too short: take in the following lines (or, at the end of the source, earlier footage).
  for (let i = hi + 1; end - start < TRANSCRIPT_CLIP_MS.min && i < transcript.length; i++) {
    if (transcript[i].end_ms - start > TRANSCRIPT_CLIP_MS.max) break
    end = Math.min(duration, Math.round(transcript[i].end_ms))
  }
  if (end - start < TRANSCRIPT_CLIP_MS.min) end = Math.min(duration, start + TRANSCRIPT_CLIP_MS.min)
  const from = end - start < TRANSCRIPT_CLIP_MS.min ? Math.max(0, end - TRANSCRIPT_CLIP_MS.min) : start
  return end - from >= 100 ? [from, end] : null
}

/** The look most of the run's hooks use (the default when none has one). */
export function runHookLook(candidates: CandidateEdit[]): HeadlineLook {
  const counts = new Map<string, { look: HeadlineLook; n: number }>()
  for (const c of candidates) {
    if (!c.hook) continue
    const key = JSON.stringify(c.hook.look), item = counts.get(key)
    counts.set(key, { look: c.hook.look, n: (item?.n ?? 0) + 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.look ?? { ...DEFAULT_HEADLINE_LOOK }
}

/** A title from a line's first words. */
export function titleFromText(text: string, words = 8): string {
  const parts = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const title = parts.slice(0, words).join(' ').replace(/[\s,;:–—-]+$/, '')
  return clampText(parts.length > words ? `${title}…` : title, MAX_HOOK_CHARS)
}

/**
 * A new clip from transcript lines `first`…`last` (main assigns its id).
 * Framing and caption settings come from the nearest clip; the hook is the
 * title in the run's hook look. No AI is used.
 */
export function transcriptClip(project: Pick<EditorProject, 'transcript' | 'duration_ms' | 'width' | 'height' | 'aspect_ratio'>, candidates: CandidateEdit[], first: number, last: number): CandidateEdit | null {
  const range = transcriptRange(project.transcript, first, last, project.duration_ms)
  if (!range) return null
  const [a, b] = range, mid = (a + b) / 2
  const distance = (c: CandidateEdit): number => { const s = c.ranges[0][0], e = c.ranges.at(-1)![1]; return mid < s ? s - mid : mid > e ? mid - e : 0 }
  const nearest = [...candidates].filter((c) => c.status !== 'discarded').sort((x, y) => distance(x) - distance(y))[0] ?? candidates[0]
  let scene: EditorScene = { at_ms: 0, layout: 'fill', crops: [defaultCrop(project.width, project.height, project.aspect_ratio === '9:16' ? 9 / 16 : 16 / 9)] }
  if (nearest) {
    const framing = framingAt(nearest, Math.max(nearest.ranges[0][0], Math.min(nearest.ranges.at(-1)![1], a)))
    scene = { at_ms: 0, layout: framing.layout, crops: framing.crops.map((c) => [...c] as Crop), ...(framing.split !== undefined ? { split: framing.split } : {}) }
  }
  const lines = project.transcript.slice(Math.min(first, last), Math.max(first, last) + 1)
  const title = titleFromText(lines.map((r) => r.text).join(' ')) || `Clip at ${Math.floor(a / 60000)}:${String(Math.floor(a / 1000) % 60).padStart(2, '0')}`
  return { id: 'new', title, ranges: [range], scenes: [scene], captions: nearest?.captions ?? true, caption_preset: nearest?.caption_preset ?? 'pop',
    video_speed: 1, status: 'refining', caption_edits: [], caption_suppression_ranges: [], caption_y: nearest?.caption_y ?? null,
    hook: { text: title, look: runHookLook(candidates) } }
}

/** "Title (variant B)", then C, D… so each copy can be told apart. */
export function variantTitle(title: string, titles: string[]): string {
  const base = title.replace(/ \(variant [B-Z]\)$/, '')
  const taken = new Set(titles)
  for (const letter of 'BCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const suffix = ` (variant ${letter})`, next = `${clampText(base, 200 - suffix.length)}${suffix}`
    if (!taken.has(next)) return next
  }
  return clampText(`${base} (variant)`, 200)
}

/** A copy of a clip for A/B testing (main assigns its id and keeps its score and scan). */
export function variantOf(c: CandidateEdit, candidates: CandidateEdit[]): CandidateEdit {
  return { ...structuredClone(candidateEdit(c)), id: 'new', title: variantTitle(c.title, candidates.map((x) => x.title)), status: 'refining' }
}

/**
 * "Use this style on every clip": captions on/off, caption preset and position,
 * the hook look (not its words), call to action and export speed go from
 * clip `source` to every other clip that isn't discarded.
 */
export function applyStyleToAll<T extends CandidateEdit>(candidates: T[], source: number): { candidates: T[]; changed: number } {
  const from = candidates[source]
  if (!from) return { candidates, changed: 0 }
  let changed = 0
  const next = candidates.map((c, i) => {
    if (i === source || c.status === 'discarded') return c
    const patch: Partial<CandidateEdit> = { captions: from.captions, caption_preset: from.caption_preset, caption_y: from.caption_y ?? null, video_speed: from.video_speed }
    if (from.cta_id === undefined) { if (c.cta_id !== undefined) patch.cta_id = undefined } else patch.cta_id = from.cta_id
    if (from.hook && c.hook) patch.hook = { ...c.hook, look: { ...from.hook.look } }
    const updated = refineEdit(c, patch)
    if (patch.cta_id === undefined && 'cta_id' in patch) delete updated.cta_id
    if (JSON.stringify(candidateEdit(updated)) === JSON.stringify(candidateEdit(c))) return c
    changed++
    return updated
  })
  return { candidates: next, changed }
}

/** One hook idea, graded with the framework hook rubric. Only ideas backed by the clip's words reach the editor. */
export interface HookIdea {
  text: string
  /** Letter grade and 0–10 hook score, computed by the engine from the rubric. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F'; score: number
  hook_type: string
  /** Triple Hook elements quoted from the idea's words. */
  elements: { qualifier: string | null; main_statement: string | null; twist: string | null }
  /** The clip's own words the idea rests on. */
  evidence: string
  why: string
}
const HOOK_TYPE_IDS = ['direct_response', 'story', 'challenge', 'educational', 'contrarian', 'vulnerability', 'none']
/** Worker output for "Suggest hooks": at most 5 well-formed ideas, everything else dropped. */
export function parseHookIdeas(value: unknown): HookIdea[] {
  if (!Array.isArray(value)) return []
  const text = (x: unknown, max: number): string | null => typeof x === 'string' && x.trim() ? clampText(x.replace(/\s+/g, ' ').trim(), max) : null
  const ideas: HookIdea[] = []
  for (const item of value.slice(0, 10)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const v = item as Record<string, unknown>, words = text(v.text, MAX_HOOK_CHARS)
    if (!words || [...words].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) continue
    if (!['A', 'B', 'C', 'D', 'F'].includes(v.grade as string) || typeof v.score !== 'number' || !Number.isFinite(v.score)) continue
    const e = v.elements && typeof v.elements === 'object' ? v.elements as Record<string, unknown> : {}
    ideas.push({ text: words, grade: v.grade as HookIdea['grade'], score: Math.max(0, Math.min(10, Math.round(v.score * 10) / 10)),
      hook_type: HOOK_TYPE_IDS.includes(v.hook_type as string) ? v.hook_type as string : 'none',
      elements: { qualifier: text(e.qualifier, 300), main_statement: text(e.main_statement, 300), twist: text(e.twist, 300) },
      evidence: text(v.evidence, 600) ?? '', why: text(v.why, 300) ?? '' })
    if (ideas.length === 5) break
  }
  return ideas
}
