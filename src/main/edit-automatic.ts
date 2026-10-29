import { createWriteStream, lstatSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { basename, dirname, extname, isAbsolute, join } from 'path'
import { randomUUID } from 'crypto'
import { getJobOutput } from './file-manager'
import { loadSettings } from './settings-store'
import { authorizeMedia, isWebUrl, openAuthorizedMedia } from './security'
import { assertPublicWebUrl } from './network-policy'
import { readCreateRequest, requestFromOutput } from './more-clips'
import { brandForJob } from './brands'
import { liveJobIds } from './job-manager'
import { remixFolderInUse, remixRecomposingFolder } from './remix'
import { editorFailureMessage, parseEditorProject, type AutomaticEditInfo, type EditorProject } from '../shared/clip-editor'
import { headlineLookForEngine, type HeadlineLook } from '../shared/headline-look'
import { withEditorPreparation, type EditorPreparation } from './clip-editor'
import { logger } from './logger'
import type { ClipJobRequest } from '../shared/jobs'
import type { JobOutput } from '../shared/job-output'

/**
 * Edit an Automatic Create run's clips in the clip editor.
 *
 * The first time, the run becomes an editor project built from the clips it
 * already made (the engine's "prepare" action: no AI, the same moments). The
 * video comes from the copy the run kept, else the original local file (copied
 * into the run), else the run's link downloaded again. A project whose video
 * was freed gets it back the same way. Exporting a clip then replaces it in
 * the Library (same clip index).
 */

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mkv', '.webm', '.avi', '.mov', '.flv'])
const KEPT_SOURCE = 'editor-source.mp4'
const MAX_JSON_BYTES = 64 * 1024 * 1024

function runFolder(path: unknown): { run: string; library: string } {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('Choose a run in your Library.')
  const library = realpathSync(loadSettings().outputDirectory)
  let run: string
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error('link')
    run = realpathSync(path)
  } catch { throw new Error('This run is no longer in your Library.') }
  if (dirname(run) !== library || !statSync(run).isDirectory()) throw new Error('Only runs in your current output folder can be edited. Move this run there first (Library → Earlier output folders).')
  return { run, library }
}

function regularFile(path: string): boolean {
  try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink() } catch { return false }
}

function readProjectFile(run: string): EditorProject | null {
  const file = join(run, 'editor-project.json')
  if (!regularFile(file)) return null
  const stat = lstatSync(file)
  if (stat.size > 32 * 1024 * 1024) throw new Error('This run’s editor project could not be read.')
  try { return parseEditorProject(JSON.parse(readFileSync(file, 'utf8'))) } catch { throw new Error('This run’s editor project could not be read.') }
}

/** A run made on Create (not Remix, Avatar Studio or Edit my recording). */
export function isCreateRun(output: JobOutput): boolean {
  const metrics = (output.metrics ?? {}) as Record<string, unknown>
  return metrics.remix !== true && typeof metrics.avatar_studio !== 'string' && metrics.edit_recording !== true && metrics.listicle !== true && metrics.broll_video !== true
}

/** A finished Remix run: it opens in the editor over its finished videos (engine remix_editor.py). */
export function isRemixRun(output: JobOutput): boolean {
  const metrics = (output.metrics ?? {}) as Record<string, unknown>
  return metrics.remix === true && typeof metrics.avatar_studio !== 'string' && metrics.listicle !== true
}

/** The project's own video files are in place (a project made from a kept copy uses editor-source.mp4). */
function projectMediaPresent(run: string, project: EditorProject): boolean {
  if (project.media_freed) return false
  const suffix = project.source_id ? `-${project.source_id}` : ''
  const preview = `editor-preview${project.preview_id ? `-${project.preview_id}` : suffix}.mp4`
  return regularFile(join(run, `editor-source${suffix}.mp4`)) && regularFile(join(run, preview))
}

function originalFile(output: JobOutput): string | null {
  const url = output.source_video_url
  if (!url || isWebUrl(url) || !isAbsolute(url) || !VIDEO_EXTENSIONS.has(extname(url).toLowerCase())) return null
  try { return statSync(url).isFile() ? url : null } catch { return null }
}

async function readRun(path: unknown): Promise<{ run: string; library: string; output: JobOutput; project: EditorProject | null }> {
  const { run, library } = runFolder(path)
  const output = await getJobOutput(run, library)
  if (!output) throw new Error('This run is no longer in your Library.')
  if (!isCreateRun(output) && !isRemixRun(output)) throw new Error('Avatar Studio videos and edited recordings are changed from their own menus.')
  if (liveJobIds().has(basename(run))) throw new Error('Wait for this run to finish before editing it.')
  if (isRemixRun(output) && [remixFolderInUse(), remixRecomposingFolder()].some((folder) => folder && samePath(folder, run))) {
    throw new Error('Wait for this remix to finish before editing it.')
  }
  const project = readProjectFile(run)
  if (output.editor_project && !project) throw new Error('This run’s editor project could not be read.')
  return { run, library, output, project }
}

function samePath(a: string, b: string): boolean {
  try { return realpathSync(a) === b } catch { return false }
}

/** A Remix run: its finished videos become the editor's source (no download, copy or AI). */
function remixEditInfo(run: string, output: JobOutput, project: EditorProject | null): AutomaticEditInfo {
  const base = { videoLabel: output.source_video_title || 'your remix', clipCount: output.clips.length, source: 'kept' as const, remix: true as const }
  if (project && output.editor_project) {
    if (!project.automatic?.remix) throw new Error('This run’s editor project could not be read.')
    return { ...base, state: projectMediaPresent(run, project) ? 'ready' : 'restore' }
  }
  if (!output.clips.length) throw new Error('This run has no videos to edit.')
  // An unfinished conversion (the project was written, the run not yet marked) is finished without new video.
  if (project && !project.automatic?.remix) throw new Error('This run’s editor project could not be read.')
  return { ...base, state: 'convert' }
}

/** What opening this run in the editor involves. */
export async function automaticEditInfo(path: unknown): Promise<AutomaticEditInfo> {
  const { run, output, project } = await readRun(path)
  if (isRemixRun(output)) return remixEditInfo(run, output, project)
  const videoLabel = isWebUrl(output.source_video_url) ? output.source_video_url : basename(output.source_video_url || '') || 'the video'
  const base = { videoLabel, clipCount: output.clips.length }
  const original = originalFile(output)
  const fetch = (): Pick<AutomaticEditInfo, 'source' | 'copyBytes'> => original ? { source: 'original', copyBytes: statSync(original).size }
    : isWebUrl(output.source_video_url) ? { source: 'download' } : { source: 'missing' }
  if (project && output.editor_project) {
    // A Review & edit run, or a project made from an Automatic run.
    if (!project.automatic || projectMediaPresent(run, project)) return { ...base, state: 'ready', source: 'kept' }
    return { ...base, state: 'restore', ...fetch() }
  }
  if (!output.clips.length) throw new Error('This run has no clips to edit.')
  if (!regularFile(join(run, 'transcript.json'))) throw new Error('This run has no saved transcript, so its clips can’t be opened in the editor.')
  // Asked of the run itself, as the engine counts them (an unfinished conversion's project may come from an older count).
  const cuts = lacksRecordedCuts(run, output) ? { estimatedCuts: true } : {}
  // An unfinished conversion (the project was written, the run not yet marked): finish it with no new video.
  if (project?.automatic) return { ...base, state: 'convert', source: 'kept', ...cuts }
  if (project) throw new Error('This run’s editor project could not be read.')
  if (regularFile(join(run, KEPT_SOURCE))) return { ...base, state: 'convert', source: 'kept', ...cuts }
  return { ...base, state: 'convert', ...fetch(), ...cuts }
}

/** A JSON file in the run, read raw (null when missing, too big or unreadable). */
function rawJson(run: string, name: string, limit = MAX_JSON_BYTES): Record<string, unknown> | null {
  try {
    const file = join(run, name)
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) return null
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

const hasRanges = (value: unknown): boolean => Array.isArray(value) && value.some((range) => Array.isArray(range) && range.length === 2 &&
  range.every((n) => typeof n === 'number' && Number.isFinite(n)) && (range[1] as number) > (range[0] as number))

/**
 * Whether some clip's cut wasn't saved with the run, so converting works it out again from the words' timing
 * (mirrors clip_ranges in the engine's automatic_editor.py: a tight-paced clip with no recorded cut).
 */
function lacksRecordedCuts(run: string, output: JobOutput): boolean {
  if (editSettings(run, output).pacing !== 'tight') return false
  const metrics = (rawJson(run, 'job_output.json')?.metrics ?? {}) as Record<string, unknown>
  const layouts = new Map((Array.isArray(metrics.clip_layouts) ? metrics.clip_layouts : [])
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object').map((entry) => [entry.clip_index, entry]))
  const audit = rawJson(run, 'edit_audit.json', 32 * 1024 * 1024)
  const retained = new Map((Array.isArray(audit?.candidates) ? audit.candidates : [])
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).status === 'rendered')
    .map((entry) => [entry.clip_index, ((entry.report ?? {}) as Record<string, unknown>).retained_source]))
  return output.clips.some((clip) => {
    const entry = layouts.get(clip.clip_index)
    if (hasRanges(entry?.kept_source_ms)) return false
    const trace = rawJson(run, `clip_${String(clip.clip_index).padStart(2, '0')}.framing.json`, 8 * 1024 * 1024)
    const window = trace?.window as Record<string, unknown> | undefined
    if (window && typeof window.start_ms === 'number' && hasRanges(trace?.keeps)) return false
    if (hasRanges(retained.get(clip.clip_index))) return false
    // Shown at its natural length (no cut to work out).
    return entry?.render_fallback !== 'letterbox_natural'
  })
}

/** What an older run's metrics recorded about its settings (read raw: the Library's parsed copy keeps only a few). */
function rawRequestedSettings(run: string): Record<string, unknown> {
  try {
    const file = join(run, 'job_output.json')
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) return {}
    const settings = (JSON.parse(readFileSync(file, 'utf8')) as { metrics?: { requested_settings?: unknown } }).metrics?.requested_settings
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {}
  } catch { return {} }
}

/** The run's Create settings that shape its clips, as the engine's "prepare" action reads them. */
export function editSettings(run: string, output: JobOutput): Record<string, unknown> {
  const saved = readCreateRequest(run)?.request
  const recorded = saved ? {} : rawRequestedSettings(run)
  const request: ClipJobRequest = saved ?? requestFromOutput(output)
  // Runs from before settings were saved: what their metrics recorded.
  const old = !saved
  const titleStyle = old ? (recorded.title_style === 'card' ? 'card' : 'headline') : request.titleStyle ?? 'card'
  const includeTitle = old ? recorded.include_title !== false : request.includeTitle !== false
  const look = old ? (recorded.headline_look && typeof recorded.headline_look === 'object' ? recorded.headline_look as HeadlineLook : undefined) : request.headlineLook
  const broll = old ? (recorded.broll as { enabled?: unknown } | undefined)?.enabled === true : !!request.broll
  let brandMark: { handle: string; logo: boolean; position: string } | null = null
  if (request.brandIdentityId && request.showHandle) {
    const logo = regularFile(join(run, '.brand-logo.png'))
    try {
      const brand = brandForJob(request.brandIdentityId, true)
      brandMark = brand.mark ? { handle: (brand.mark.handle ?? '').slice(0, 80), logo, position: brand.mark.position } : logo ? { handle: '', logo, position: 'bottom-right' } : null
    } catch { brandMark = logo ? { handle: '', logo, position: 'bottom-right' } : null }
  }
  const lookForEngine = headlineLookForEngine(look)
  return {
    aspect_ratio: request.aspectRatio === '16:9' ? '16:9' : '9:16',
    layout_style: request.layoutStyle || 'auto',
    include_captions: request.includeCaptions !== false,
    caption_preset: request.captionPreset || 'pop',
    include_title: includeTitle,
    title_style: titleStyle,
    ...(lookForEngine ? { headline_look: lookForEngine } : {}),
    video_speed: typeof request.videoSpeed === 'number' ? request.videoSpeed : 1,
    pacing: request.pacing === 'natural' ? 'natural' : 'tight',
    background: old ? typeof recorded.background_video === 'string' : !!request.backgroundVideo,
    broll,
    hook_preview: old ? recorded.hook_preview === true : request.hookPreview === true,
    headline_voice: request.headlineVoice === 'creator' ? 'creator' : 'clipper',
    ...(request.ctaKeyword ? { cta_keyword: request.ctaKeyword, cta_offer: request.ctaOffer ?? '' } : {}),
    brand_mark: brandMark
  }
}

/** Mark the run as having an editor project (temp file + rename; the caller holds the run's lock). */
function markEditorProject(run: string): void {
  const file = join(run, 'job_output.json')
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) throw new Error('This run’s details could not be read.')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.clips)) throw new Error('This run’s details could not be read.')
  if (raw.editor_project === true) return
  raw.editor_project = true
  const temporary = join(run, `.editor-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(raw), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } finally { try { unlinkSync(temporary) } catch { /* Already committed. */ } }
}

/** Copy a video into the run as editor-source-<id>.mp4, reporting progress. Reads the authorized file once. */
async function copySource(file: string, target: string, signal: AbortSignal, report: (percent: number) => void): Promise<void> {
  const media = await openAuthorizedMedia(file, loadSettings().outputDirectory)
  try {
    let copied = 0
    const meter = new Transform({ transform(chunk: Buffer, _encoding, done) { copied += chunk.length; report(Math.min(100, (copied / Math.max(1, media.size)) * 100)); done(null, chunk) } })
    await pipeline(media.handle.createReadStream({ autoClose: false }), meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal })
  } finally { await media.handle.close() }
}

/**
 * Open an Automatic run in the editor: make its editor project (first time),
 * or get a converted project's video back. `localFile` is a video the member
 * just chose (when the link can't be downloaded or the file is gone).
 */
export async function prepareAutomaticEditor(path: unknown, localFile?: unknown): Promise<AutomaticEditInfo> {
  if (localFile !== undefined && localFile !== null && (typeof localFile !== 'string' || !isAbsolute(localFile) || !VIDEO_EXTENSIONS.has(extname(localFile).toLowerCase()))) {
    throw new Error('Choose a video file.')
  }
  const chosen = typeof localFile === 'string' ? localFile : null
  const info = await automaticEditInfo(path)
  if (info.state === 'ready') return info
  const { run: folder } = runFolder(path)
  if (info.remix) {
    await withEditorPreparation(folder, (prep) => prepareRemixEditor(prep))
    return automaticEditInfo(path)
  }
  await withEditorPreparation(folder, async (prep) => {
    // Checked again inside the run's lock: the run may have changed while waiting.
    const { run, output, project } = await readRun(prep.run)
    const now = await automaticEditInfo(run)
    if (now.state === 'ready') return
    if (now.state === 'convert' && project?.automatic) { markEditorProject(run); return }
    const mediaId = randomUUID().replaceAll('-', '')
    const owned = [`editor-source-${mediaId}.mp4`, `editor-preview-${mediaId}.mp4`, `editor-preview-${mediaId}.mp4.partial.mp4`].map((name) => join(run, name))
    let committed = false
    try {
      let source: 'kept' | 'file' | 'download'
      let url: string | undefined
      const original = originalFile(output)
      if (chosen) {
        // The member's pick: only a file the open dialog authorized (openAuthorizedMedia checks), copied in.
        await copySource(chosen, owned[0], prep.signal, (percent) => prep.setProgress({ phase: 'copy', percent: Math.floor(percent) }))
        source = 'file'
      } else if (now.source === 'kept' && now.state === 'convert') {
        source = 'kept'
      } else if (now.source === 'original' && original) {
        // The file the run was made from, as More clips reuses it.
        await copySource(authorizeMedia(original), owned[0], prep.signal, (percent) => prep.setProgress({ phase: 'copy', percent: Math.floor(percent) }))
        source = 'file'
      } else if (now.source === 'download') {
        await assertPublicWebUrl(output.source_video_url)
        url = output.source_video_url
        source = 'download'
        prep.setProgress({ phase: 'download', percent: 0 })
      } else {
        throw new Error(editorFailureMessage('prepare', 'source_missing'))
      }
      if (prep.cancelled()) throw new Error(editorFailureMessage('prepare', 'cancelled'))
      const durationMs = Math.max(0, (output.source_video_duration_seconds || 0) * 1000)
      await prep.worker({
        media_id: mediaId, source, ...(url ? { url } : {}),
        ...(now.state === 'convert' ? { mode: 'convert', settings: editSettings(run, output) } : { mode: 'restore', revision: project!.revision })
      }, durationMs)
      committed = true
      if (now.state === 'convert') markEditorProject(run)
      logger.info('editor.automatic.prepared', { mode: now.state, source })
    } catch (error) {
      if (prep.cancelled()) throw new Error(editorFailureMessage('prepare', 'cancelled'))
      throw error
    } finally {
      // Files this attempt made that no committed project uses.
      let keep = new Set<string>()
      try {
        const current = readProjectFile(run)
        if (current && !current.media_freed) {
          const suffix = current.source_id ? `-${current.source_id}` : ''
          keep = new Set([`editor-source${suffix}.mp4`, `editor-preview${current.preview_id ? `-${current.preview_id}` : suffix}.mp4`].map((name) => join(run, name)))
        }
      } catch { if (committed) keep = new Set(owned) }
      for (const file of owned) if (!keep.has(file)) { try { unlinkSync(file) } catch { /* Not made. */ } }
    }
  })
  return automaticEditInfo(path)
}


/**
 * A Remix run's editor project, made from its finished videos (the engine's "prepare" action, mode "remix"), or made
 * again when its editor video was freed (from the videos now in the Library, with everything baked into them).
 */
async function prepareRemixEditor(prep: EditorPreparation): Promise<void> {
  const { run, output, project } = await readRun(prep.run)
  const now = remixEditInfo(run, output, project)
  if (now.state === 'ready') return
  if (now.state === 'convert' && project?.automatic?.remix) { markEditorProject(run); return }
  const mediaId = randomUUID().replaceAll('-', '')
  const owned = [`editor-source-${mediaId}.mp4`, `editor-source-${mediaId}.mp4.partial.mp4`, `editor-preview-${mediaId}.mp4`, `editor-preview-${mediaId}.mp4.partial.mp4`].map((name) => join(run, name))
  let committed = false
  try {
    const durationMs = output.clips.reduce((sum, clip) => sum + Math.max(0, clip.duration_ms || 0), 0)
    prep.setProgress({ phase: 'copy', percent: 0 })
    await prep.worker({ media_id: mediaId, mode: 'remix', ...(now.state === 'restore' && project ? { revision: project.revision } : {}) }, Math.max(60_000, durationMs))
    committed = true
    markEditorProject(run)
    logger.info('editor.remix.prepared', { mode: now.state, videos: output.clips.length })
  } catch (error) {
    if (prep.cancelled()) throw new Error(editorFailureMessage('prepare', 'cancelled'))
    throw error
  } finally {
    let keep = new Set<string>()
    try {
      const current = readProjectFile(run)
      if (current && !current.media_freed && current.source_id) keep = new Set([`editor-source-${current.source_id}.mp4`, `editor-preview-${current.preview_id ?? current.source_id}.mp4`].map((name) => join(run, name)))
    } catch { if (committed) keep = new Set(owned) }
    for (const file of owned) if (!keep.has(file)) { try { unlinkSync(file) } catch { /* Not made. */ } }
  }
}
