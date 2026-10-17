import { randomUUID } from 'crypto'
import { loadSettings } from './settings-store'
import { ensureOutputDir } from './file-manager'
import { getBridgeRunnerPath, getEnginePath, preflightCheck, resolvePythonPath, validatePython, type ClipJobConfig } from './pipeline-runner'
import { createRunRecord, finishRunRecord } from './run-history'
import { enqueueJob } from './job-manager'
import { logger } from './logger'
import { assertMediaPath, authorizeMedia, isWebUrl } from './security'
import { MAX_CREATE_SOURCES } from '../shared/create-sources'
import { moreClipsInfo as readMoreClipsInfo, moreClipsRequest, parseMoreClipsChoices, resolveReuse, withoutMissingBrand, writeCreateRequest, type MoreClipsInfo } from './more-clips'
import { join } from 'path'
import { assertPublicWebUrl } from './network-policy'
import { validateJobConfig } from './validation'
import { resolveAdvancedModels } from './openrouter-models'
import { supportsCaptionFilter } from './tools'
import { brandForJob } from './brands'
import type { JobSnapshot } from '../shared/jobs'

/** A passing engine check is reused briefly, so queuing several videos stays quick. */
const ENGINE_CHECK_TTL_MS = 5 * 60 * 1000
let lastEngineCheck: { key: string; at: number } | null = null

export type StartJobResult = { jobId: string; queued: boolean; job: JobSnapshot; note?: string } | { error: string }

/**
 * Validate a clipping request, check the engine and keys, create its run
 * folder and queue it. Used by the Create page and the assistant alike; it
 * needs no window, so jobs can start while every window is closed.
 */
export async function startClipJobRequest(request: unknown): Promise<StartJobResult> {
  let config: ClipJobConfig
  try {
    config = validateJobConfig(request)
    if (config.clippingMode === 'advanced') {
      config.plannerCapabilities = await resolveAdvancedModels(config.plannerModel!, config.transcriptionModel!)
    }
    // More clips: the earlier run's transcript and source are found here, never taken from the renderer.
    if (config.reuseFrom) config.reuse = await resolveReuse(config.reuseFrom, config.videoUrl)
    if (isWebUrl(config.videoUrl)) await assertPublicWebUrl(config.videoUrl)
    else if (config.reuse?.source === 'kept') { /* The copy kept in the earlier run is used. */ }
    else {
      // The earlier run's own source file may be used again without the file picker.
      if (config.reuse?.source === 'original') authorizeMedia(config.videoUrl)
      assertMediaPath(config.videoUrl, loadSettings().outputDirectory)
    }
    if (config.bannerChannelUrl) await assertPublicWebUrl(config.bannerChannelUrl)
    // A deleted brand is reported now, not when the run reaches a slot.
    if (config.brandIdentityId) brandForJob(config.brandIdentityId, false)
  } catch (error) { return { error: error instanceof Error ? error.message : 'Invalid job options' } }
  const settings = loadSettings()

  if (!settings.openrouterApiKey) {
    logger.warn('job.start.missingKey', { key: 'OPENROUTER_API_KEY' })
    return { error: 'OpenRouter API key is required for AI clip planning. Go to Settings to add it.' }
  }

  const enginePath = getEnginePath()
  const bridgePath = getBridgeRunnerPath()
  const pythonPath = resolvePythonPath(enginePath, settings.pythonPath)

  const preflight = preflightCheck({ pythonPath, bridgePath, enginePath })
  if (!preflight.ok) {
    const message = preflight.hint
      ? `${preflight.error}\n\n${preflight.hint}`
      : preflight.error!
    logger.error('job.start.preflight.failed', {
      error: preflight.error,
      hint: preflight.hint,
      pythonPath,
      bridgePath,
      enginePath
    })
    return { error: message }
  }
  const engineKey = `${pythonPath}\0${enginePath}`
  if (!lastEngineCheck || lastEngineCheck.key !== engineKey || Date.now() - lastEngineCheck.at > ENGINE_CHECK_TTL_MS) {
    const pythonValidation = await validatePython(pythonPath, enginePath)
    if (!pythonValidation.ok) {
      lastEngineCheck = null
      return { error: 'The clipping engine is incomplete or incompatible. Open Settings → System check, then repair the CreatorClips installation before starting.' }
    }
    lastEngineCheck = { key: engineKey, at: Date.now() }
  }
  if (config.includeCaptions && !(await supportsCaptionFilter())) {
    return { error: 'FFmpeg cannot render captions because its ass filter is missing. Install an FFmpeg build with libass, or turn captions off.' }
  }

  ensureOutputDir(settings.outputDirectory)

  const jobId = randomUUID()
  logger.info('job.start.request', { jobId, sourceType: isWebUrl(config.videoUrl) ? 'remote' : 'local', aspectRatio: config.aspectRatio })
  try {
    createRunRecord(settings.outputDirectory, jobId, config.videoUrl)
  } catch {
    try { finishRunRecord(settings.outputDirectory, jobId, 'failed', 'Could not start this run.') } catch { /* Output folder may be unavailable. */ }
    return { error: 'Could not create the clipping run. Check the output folder and retry.' }
  }
  // Its settings, so "More clips from this video" can start from them later.
  try { writeCreateRequest(join(settings.outputDirectory, jobId), config, config.reuse?.excludeRangesMs ?? []) }
  catch { logger.warn('job.start.requestNotSaved', { jobId }) }
  // Starts now when a slot is free; otherwise waits its turn in the queue.
  const job = enqueueJob(jobId, config, settings.outputDirectory)
  return { jobId, queued: job.status === 'queued', job }
}

function brandExists(id: string): boolean {
  try { brandForJob(id, false); return true } catch { return false }
}

/** What More clips would reuse, for the dialog; a brand deleted since the earlier run is dropped, with a note. */
export async function moreClipsInfo(outputDir: unknown): Promise<MoreClipsInfo> {
  const info = await readMoreClipsInfo(outputDir)
  const { request, note } = withoutMissingBrand(info.request, brandExists)
  return { ...info, request, ...(note ? { note } : {}) }
}

export type StartManyResult = { started: { jobId: string; queued: boolean; job: JobSnapshot; videoUrl: string }[]; failed: { videoUrl: string; error: string }[] } | { error: string }

/**
 * Several videos with the same settings: one job each, queued in order (up to
 * MAX_PARALLEL_JOBS run at once). A video that can't start doesn't stop the rest.
 */
export async function startClipJobRequests(requests: unknown): Promise<StartManyResult> {
  if (!Array.isArray(requests) || requests.length === 0) return { error: 'Add a video to clip.' }
  if (requests.length > MAX_CREATE_SOURCES) return { error: `Add up to ${MAX_CREATE_SOURCES} videos at a time.` }
  const sources = requests.map((request) => (request && typeof request === 'object' ? (request as { videoUrl?: unknown }).videoUrl : undefined))
  if (sources.some((source) => typeof source !== 'string') || new Set(sources).size !== sources.length) return { error: 'Each video can be added once.' }
  const started: { jobId: string; queued: boolean; job: JobSnapshot; videoUrl: string }[] = []
  const failed: { videoUrl: string; error: string }[] = []
  for (const request of requests) {
    const videoUrl = (request as { videoUrl: string }).videoUrl
    const result = await startClipJobRequest(request)
    if ('error' in result) failed.push({ videoUrl, error: result.error })
    else started.push({ ...result, videoUrl })
  }
  return { started, failed }
}

/** "More clips from this video" for a finished Library run, with the member's choices. */
export async function startMoreClips(outputDir: unknown, choices: unknown): Promise<StartJobResult> {
  let request
  let note: string | undefined
  try {
    const info = await moreClipsInfo(outputDir)
    note = info.note
    request = moreClipsRequest(info, parseMoreClipsChoices(choices))
  } catch (error) { return { error: String((error as Error | null)?.message || 'Could not start more clips.').slice(0, 300) } }
  const result = await startClipJobRequest(request)
  return note && !('error' in result) ? { ...result, note } : result
}
