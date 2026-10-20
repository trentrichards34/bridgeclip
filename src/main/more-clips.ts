import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { getJobOutput } from './file-manager'
import { loadSettings } from './settings-store'
import { isWebUrl } from './security'
import { validateJobConfig } from './validation'
import { CLIP_REQUEST_MAX_CHARS, DURATION_IDS } from '../shared/job-contract'
import { QUALITY_BARS, SCREEN_FOCUS_MODES, type ClipJobRequest, type QualityBar, type ScreenFocus } from '../shared/jobs'
import { isCaptionLanguage, type CaptionLanguage } from '../shared/caption-language'
import type { JobOutput } from '../shared/job-output'

/**
 * "More clips from this video": a new Create run that reuses a finished run's
 * saved transcript when it still matches the video (the engine checks the
 * length, the file and the part of the video it covers, and transcribes again
 * otherwise) and its source when it is still on this computer, and skips the
 * moments the run already clipped.
 */

/** Saved next to each Create run when it starts, so More clips can start from its settings. */
export const CREATE_REQUEST_FILE = 'create-request.json'
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_PROJECT_BYTES = 32 * 1024 * 1024
/** Most earlier moments sent to the planner (newest kept). */
export const MAX_EXCLUDED_MOMENTS = 200
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How the new run gets the video. */
export type ReuseSource = 'original' | 'kept' | 'download' | 'missing'

/** What a More clips run reuses; built in main, never accepted from the renderer. */
export interface ReusePlan {
  runId: string
  transcriptPath: string
  source: Exclude<ReuseSource, 'missing'>
  /** A copy of the source kept in the earlier run (Review & edit), used instead of downloading. */
  sourcePath: string | null
  sourceMeta: { title: string; channel: string | null; description: string | null } | null
  expectedDurationSeconds: number | null
  /** The earlier run looked at only part of the video: a transcript that doesn't record its range isn't reused. */
  transcriptPartial: boolean
  excludeRangesMs: [number, number][]
}

export interface MoreClipsInfo {
  runId: string
  title: string
  /** The earlier run's link or file. */
  videoUrl: string
  source: ReuseSource
  transcriptSaved: boolean
  /** Moments the new run skips (the earlier clips, and what that run skipped). */
  excludedCount: number
  /** The earlier run's settings, which the new run starts from. */
  request: ClipJobRequest
  /** False for runs made before settings were saved: some style choices use defaults. */
  savedSettings: boolean
  /** Something the new run does differently from the earlier one (e.g. its brand was deleted). */
  note?: string
}

/** What the member can change for the new run. */
export interface MoreClipsChoices {
  maxClips: number | null
  autoClipCount: boolean
  durationRanges: string[] | null
  qualityBar: QualityBar
  clipRequest?: string
  captionLanguage?: CaptionLanguage
}

function readSmallFile(path: string, limit: number): string | null {
  let fd: number | null = null
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > limit) return null
    const data = Buffer.alloc(stat.size)
    let used = 0
    while (used < data.length) {
      const count = readSync(fd, data, used, data.length - used, null)
      if (!count) break
      used += count
    }
    return data.subarray(0, used).toString('utf8')
  } catch { return null } finally { if (fd !== null) closeSync(fd) }
}

function ranges(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): [number, number][] => Array.isArray(item) && item.length === 2 && item.every((part) => Number.isSafeInteger(part) && part >= 0) && item[0] < item[1]
    ? [[item[0], item[1]]] : [])
}

/** The run's saved Create settings and the moments it skipped, or null (older runs, other kinds of runs). */
export function readCreateRequest(run: string): { request: ClipJobRequest; excludedRangesMs: [number, number][] } | null {
  const text = readSmallFile(join(run, CREATE_REQUEST_FILE), MAX_REQUEST_BYTES)
  if (!text) return null
  try {
    const data = JSON.parse(text) as { version?: unknown; request?: unknown; excludedRangesMs?: unknown }
    if (data.version !== 1) return null
    const request = validateJobConfig(data.request)
    delete request.plannerCapabilities
    return { request, excludedRangesMs: ranges(data.excludedRangesMs) }
  } catch { return null }
}

/** Save a starting run's settings (temp file + rename). Best effort: More clips falls back to the run's metrics. */
export function writeCreateRequest(run: string, request: ClipJobRequest, excludedRangesMs: [number, number][] = []): void {
  const known = validateJobConfig(request)
  delete known.plannerCapabilities
  const temporary = join(run, `.${CREATE_REQUEST_FILE}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, request: known, excludedRangesMs: excludedRangesMs.slice(-MAX_EXCLUDED_MOMENTS) }), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, join(run, CREATE_REQUEST_FILE))
  } finally {
    try { unlinkSync(temporary) } catch { /* Already renamed. */ }
  }
}

/** Settings for a run made before create-request.json existed: what its metrics recorded, defaults for the rest. */
export function requestFromOutput(output: JobOutput): ClipJobRequest {
  const metrics = (output.metrics ?? {}) as Record<string, unknown>
  const settings = (metrics.requested_settings ?? {}) as Record<string, unknown>
  const advanced = settings.clipping_mode === 'advanced' && typeof settings.planner_model === 'string' && typeof settings.transcription_model === 'string'
  return {
    workflow: 'automatic',
    videoUrl: output.source_video_url,
    clippingMode: advanced ? 'advanced' : settings.clipping_mode === 'economy' ? 'economy' : 'quality',
    ...(advanced ? { plannerModel: settings.planner_model as string, transcriptionModel: settings.transcription_model as string } : {}),
    maxClips: null,
    autoClipCount: true,
    durationRanges: null,
    aspectRatio: settings.aspect_ratio === '16:9' ? '16:9' : '9:16',
    layoutStyle: ['auto', 'fill', 'fit'].includes(settings.layout_style as string) ? settings.layout_style as string : 'auto',
    layoutVision: settings.layout_vision_enabled !== false,
    ...(SCREEN_FOCUS_MODES.includes(settings.screen_focus as ScreenFocus) ? { screenFocus: settings.screen_focus as ScreenFocus } : {}),
    pacing: settings.pacing === 'natural' ? 'natural' : 'tight',
    videoSpeed: typeof settings.video_speed === 'number' ? settings.video_speed : 1,
    includeCaptions: metrics.captions_status !== 'disabled_by_request',
    captionPreset: 'pop',
    includeTitle: true,
    titleStyle: 'headline',
    qualityBar: QUALITY_BARS.includes(settings.quality_bar as QualityBar) ? settings.quality_bar as QualityBar : 'b',
    ...(isCaptionLanguage(settings.caption_language) ? { captionLanguage: settings.caption_language } : {}),
    ...(settings.headline_voice === 'creator' || settings.headline_voice === 'clipper' ? { headlineVoice: settings.headline_voice } : {}),
    startTimeSeconds: null,
    endTimeSeconds: null,
    bannerPlatform: null,
    bannerChannelUrl: null
  }
}

/** The kept copy of a run's source (Review & edit's editor copy, or the download an Automatic run kept), or null (none, freed, or unreadable). */
export function keptSourcePath(run: string): string | null {
  const text = readSmallFile(join(run, 'editor-project.json'), MAX_PROJECT_BYTES)
  if (!text) {
    // An Automatic run keeps its download as editor-source.mp4 (until it is opened in the editor or freed).
    try {
      const path = join(run, 'editor-source.mp4'), stat = lstatSync(path)
      return stat.isFile() && !stat.isSymbolicLink() && !existsProject(run) ? path : null
    } catch { return null }
  }
  try {
    const project = JSON.parse(text) as { media_freed?: unknown; source_id?: unknown }
    if (project.media_freed === true) return null
    const id = typeof project.source_id === 'string' && /^[a-f0-9]{32}$/.test(project.source_id) ? project.source_id : null
    const path = join(run, `editor-source${id ? `-${id}` : ''}.mp4`)
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink() ? path : null
  } catch { return null }
}

function existsProject(run: string): boolean {
  try { lstatSync(join(run, 'editor-project.json')); return true } catch { return false }
}

/** The earlier clips' source ranges plus the moments that run skipped, newest last, at most MAX_EXCLUDED_MOMENTS. */
export function exclusionsFor(output: JobOutput, earlier: [number, number][] = []): [number, number][] {
  const spans = [...earlier, ...output.clips.map((clip): [number, number] => [Math.round(clip.start_time_ms), Math.round(clip.end_time_ms)])]
  const seen = new Set<string>()
  const unique = spans.filter(([start, end]) => {
    const key = `${start}:${end}`
    if (end <= start || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.slice(-MAX_EXCLUDED_MOMENTS)
}

/**
 * How the new run gets its video: a link is downloaded again; a local file is
 * used in place while it is still there, else a kept copy in the run, else
 * the run can't make more clips.
 */
export function sourceFor(videoUrl: string, exists: (path: string) => boolean, keptPath: string | null): ReuseSource {
  if (isWebUrl(videoUrl)) return keptPath ? 'kept' : 'download'
  if (isAbsolute(videoUrl) && exists(videoUrl)) return 'original'
  return keptPath ? 'kept' : 'missing'
}

/** A Library run directly inside the current output folder. */
function libraryRun(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error('Choose a finished run in your Library.')
  const library = realpathSync(loadSettings().outputDirectory)
  const run = join(library, runId)
  let stat
  try { stat = lstatSync(run) } catch { throw new Error('This run is no longer in your Library.') }
  if (!stat.isDirectory() || stat.isSymbolicLink() || dirname(realpathSync(run)) !== library) throw new Error('This run is no longer in your Library.')
  return run
}

function runIdOf(outputDir: unknown): string {
  if (typeof outputDir !== 'string' || !isAbsolute(outputDir) || outputDir.includes('\0')) throw new Error('Choose a finished run in your Library.')
  return basename(resolve(outputDir))
}

function fileExists(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

async function readRun(runId: string): Promise<{ run: string; output: JobOutput; transcriptPath: string; saved: ReturnType<typeof readCreateRequest> }> {
  const run = libraryRun(runId)
  const output = await getJobOutput(run, realpathSync(loadSettings().outputDirectory))
  if (!output || output.job_id !== runId) throw new Error('This run is no longer in your Library.')
  const transcriptPath = join(run, 'transcript.json')
  return { run, output, transcriptPath, saved: readCreateRequest(run) }
}

function transcriptSaved(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch { return false }
}

/** What More clips would reuse for this Library run (for the dialog). */
export async function moreClipsInfo(outputDir: unknown): Promise<MoreClipsInfo> {
  const runId = runIdOf(outputDir)
  const { run, output, transcriptPath, saved } = await readRun(runId)
  if (!output.source_video_url) throw new Error('This run has no source video to clip again.')
  const kept = keptSourcePath(run)
  const request = { ...(saved?.request ?? requestFromOutput(output)), videoUrl: output.source_video_url }
  delete request.reuseFrom
  return {
    runId,
    title: output.source_video_title,
    videoUrl: output.source_video_url,
    source: sourceFor(output.source_video_url, fileExists, kept),
    transcriptSaved: transcriptSaved(transcriptPath),
    excludedCount: exclusionsFor(output, saved?.excludedRangesMs).length,
    request,
    savedSettings: Boolean(saved)
  }
}

/** Main-side reuse plan for a validated request with `reuseFrom`. The request must be for the same video. */
export async function resolveReuse(runId: string, videoUrl: string): Promise<ReusePlan> {
  const { run, output, transcriptPath, saved } = await readRun(runId)
  if (output.source_video_url !== videoUrl) throw new Error('More clips must use the same video as the earlier run.')
  if (!transcriptSaved(transcriptPath)) throw new Error('This run has no saved transcript, so its video would be transcribed again. Start a new run on Create instead.')
  const kept = keptSourcePath(run)
  const source = sourceFor(videoUrl, fileExists, kept)
  if (source === 'missing') throw new Error('The original video file is no longer on this computer. Choose it again on Create to clip it.')
  return {
    runId,
    transcriptPath,
    source,
    sourcePath: source === 'kept' ? kept : null,
    // Kept for every source: a run queued on the original file may fall back to the kept copy when it starts.
    sourceMeta: { title: output.source_video_title, channel: output.source_video_channel ?? null, description: output.source_video_description ?? null },
    expectedDurationSeconds: output.source_video_duration_seconds > 0 ? output.source_video_duration_seconds : null,
    transcriptPartial: earlierRangeWasPartial(output, saved?.request ?? null),
    excludeRangesMs: exclusionsFor(output, saved?.excludedRangesMs)
  }
}

/**
 * Whether the earlier run looked at only part of the video: its saved trim
 * range, else (runs from before settings were saved) an analyzed length
 * shorter than the video.
 */
export function earlierRangeWasPartial(output: JobOutput, request: ClipJobRequest | null): boolean {
  if (request) return request.startTimeSeconds != null || request.endTimeSeconds != null
  const analyzed = (output.metrics as Record<string, unknown> | undefined)?.analysis_duration_seconds
  const duration = output.source_video_duration_seconds
  return typeof analyzed === 'number' && duration > 0 && analyzed < duration - 1.5
}

/**
 * The plan checked again when the queued run actually starts: files may have
 * gone since it was queued. A missing kept copy falls back to the original
 * link or file (and a missing original to a kept copy); with neither, a clear
 * error. A missing transcript needs no change: the engine transcribes again.
 */
export function refreshReusePlan(plan: ReusePlan, videoUrl: string, exists: (path: string) => boolean = fileExists): { plan: ReusePlan } | { error: string } {
  const run = dirname(plan.transcriptPath)
  const kept = plan.sourcePath && exists(plan.sourcePath) ? plan.sourcePath : keptSourcePath(run)
  if (isWebUrl(videoUrl)) {
    return { plan: kept ? { ...plan, source: 'kept', sourcePath: kept } : { ...plan, source: 'download', sourcePath: null } }
  }
  if (plan.source === 'original' && isAbsolute(videoUrl) && exists(videoUrl)) return { plan }
  if (kept) return { plan: { ...plan, source: 'kept', sourcePath: kept } }
  if (isAbsolute(videoUrl) && exists(videoUrl)) return { plan: { ...plan, source: 'original', sourcePath: null } }
  return { error: 'The video for this run is no longer on this computer, and no copy was kept with the earlier run. Choose the video again on Create to clip it.' }
}

/**
 * A More clips request whose brand was deleted since the earlier run: the
 * brand (and its handle) is dropped with a note, instead of failing the run.
 */
export function withoutMissingBrand(request: ClipJobRequest, brandExists: (id: string) => boolean): { request: ClipJobRequest; note: string | null } {
  if (!request.brandIdentityId || brandExists(request.brandIdentityId)) return { request, note: null }
  const next = { ...request }
  delete next.brandIdentityId
  delete next.showHandle
  return { request: next, note: 'The brand the earlier run used was deleted, so these clips use no brand.' }
}

/** Check the member's choices for a More clips run. */
export function parseMoreClipsChoices(value: unknown): MoreClipsChoices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid options')
  const raw = value as Record<string, unknown>
  if (typeof raw.autoClipCount !== 'boolean') throw new Error('Invalid options')
  if (raw.maxClips !== null && (!Number.isInteger(raw.maxClips) || (raw.maxClips as number) < 1 || (raw.maxClips as number) > 100)) throw new Error('Clip count must be between 1 and 100')
  const durations = raw.durationRanges
  if (durations !== null && (!Array.isArray(durations) || durations.length > DURATION_IDS.length || durations.some((id) => !DURATION_IDS.includes(id as string)) || new Set(durations).size !== durations.length)) throw new Error('Invalid clip duration')
  if (!QUALITY_BARS.includes(raw.qualityBar as QualityBar)) throw new Error('Invalid quality bar')
  if (raw.clipRequest !== undefined && (typeof raw.clipRequest !== 'string' || raw.clipRequest.length > CLIP_REQUEST_MAX_CHARS + 100)) throw new Error(`Describe what to clip in ${CLIP_REQUEST_MAX_CHARS} characters or fewer`)
  if (raw.captionLanguage !== undefined && !isCaptionLanguage(raw.captionLanguage)) throw new Error('Choose a caption language from the list')
  return {
    maxClips: raw.autoClipCount ? null : raw.maxClips as number,
    autoClipCount: raw.autoClipCount,
    durationRanges: durations === null || (durations as string[]).length === 0 ? null : [...durations as string[]],
    qualityBar: raw.qualityBar as QualityBar,
    ...(typeof raw.clipRequest === 'string' && raw.clipRequest.trim() ? { clipRequest: raw.clipRequest } : {}),
    ...(isCaptionLanguage(raw.captionLanguage) ? { captionLanguage: raw.captionLanguage } : {})
  }
}

/** The request for a More clips run: the earlier settings, the member's choices, and the run to reuse. */
export function moreClipsRequest(info: Pick<MoreClipsInfo, 'runId' | 'request'>, choices: MoreClipsChoices): ClipJobRequest {
  const base: ClipJobRequest = { ...info.request }
  delete base.clipRequest
  delete base.captionLanguage
  // The reference picture was for that run (its copy stays in that run's folder); the purpose line still applies.
  delete base.referenceImage
  // The new run uses Automatic clipping; Review-only options don't apply.
  return {
    ...base,
    workflow: 'automatic',
    ...choices,
    reuseFrom: info.runId
  }
}
