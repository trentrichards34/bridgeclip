import { app } from 'electron'
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { existsSync, lstatSync, realpathSync, statSync } from 'fs'
import { access, constants as fsConstants, copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile, type FileHandle } from 'fs/promises'
import { basename, delimiter, dirname, extname, join } from 'path'
import { promisify } from 'util'
import { isAvatarId } from '../shared/avatars'
import { isCaptionPresetId } from '../shared/caption-presets'
import { headlineLookForEngine, parseHeadlineLook } from '../shared/headline-look'
import { parseCtaChoice } from '../shared/ctas'
import { applyRunCta, applyRunCtaInLock, originalPath, readCta, withRunLock } from './ctas'
import {
  estimateRemixCost, isRemixAngle, isRemixHost, isRemixOrder, MAX_CTA_OFFER_CHARS, MAX_REMIXES, MAX_SOURCES, parseRemixDraft, parseRemixEdits, parseRemixOutput, remixEditProblem,
  headlineOnly, oneTake, MAX_IMAGE_TAKE_SECONDS, REMIX_IMAGE_EXTENSIONS, AVATAR_VOICE, DEFAULT_CAMERA, isRecordingPart, normalizeCtaKeyword, parseCameraSettings, partsFor, RECORDING_VIDEO_EXTENSIONS, remixSourceUrl, type RecordingPart, type RemixDraft, type RemixOutput, type RemixRecordings, type RemixRequest, type RemixStatus
} from '../shared/remix'
import { presetVoiceId, type Avatar } from '../shared/avatars'
import {
  DEFAULT_PAUSE_REACT, DEFAULT_PAUSE_SETTINGS, isPauseCaptions, isPauseLayout, parsePauseDetection, parsePauseEvents, parsePauseSettings, PAUSE_MAX_TRIM_SECONDS,
  PAUSE_REACT_MAX_SECONDS, timelineForEngine, timelineFromEvents, uploadTimeline, type PauseDetection, type PauseEvent, type PauseSettings, type PauseTimeline, type PauseView
} from '../shared/pause-react'

const DEFAULT_VOICE_NAME = 'Brian'
import { portraitPath, readAvatar, readReactions, voiceSamplePath } from './avatars'
import { logger } from './logger'
import { getBridgeRunnerPath, getEnginePath, resolvePythonPath, runtimeEnvironment, validatePython } from './pipeline-runner'
import { assertMediaPath, authorizeMedia } from './security'
import { getSettingsForBridge, loadSettings } from './settings-store'
import { brandMarkForRun, isBrandId, readBrandIdentity } from './brands'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

// Brand identities live in ./brands (Create and Avatar Studio read them too).
export { BRAND_IDENTITY_EXTENSIONS, importBrandLogo, listBrandIdentities, readBrandIdentity, readBrandIdentityFile, removeBrandIdentity, saveBrandIdentity } from './brands'

// ---------------------------------------------------------------------------
// Remix runs: plan (download, transcribe, write and grade takes) → review
// (the user edits or drops drafts; nothing paid for yet) → render.
// ---------------------------------------------------------------------------

interface RecordingFile {
  path: string; offsetS: number | null; uploaded: boolean; seconds: number
  /** Pause & react, recorded here: the recorder's log of pauses and plays. */
  events?: PauseEvent[]
  /** Pause & react, uploaded: what the engine heard (when it was played and paused). */
  detection?: PauseDetection
}

interface RunContext {
  /** Me, on camera: each take's recordings (draft id → part → file in the run's .recordings folder). */
  recordings?: Map<number, Map<RecordingPart, RecordingFile>>
  request: RemixRequest
  /** The engine config shared by both phases. */
  config: Record<string, unknown>
  draftIds: Set<number>
  planCostUsd: number
  /** An article-or-post remix is writing its headline from the recording (back to review afterwards). */
  writing?: boolean
  /** Recordings being saved or copied in right now: writing and making wait for them. */
  savingRecordings?: number
  /** Pause & react: the original's length and the member's adjustments to a phone recording's pauses. */
  pause?: { sourceSeconds: number; settings: PauseSettings }
}

interface ActiveRemix { status: RemixStatus; child?: ChildProcess; cancelled: boolean; avatarId: string | null; context: RunContext; ctaAbort?: AbortController }

let active: ActiveRemix | null = null
/** A planned run waiting for the user's review (not running, but holds the folder and drafts). */
let reviewing: ActiveRemix | null = null
let lastStatus: RemixStatus | null = null
let notify: (status: RemixStatus) => void = () => undefined

export function onRemixStatus(listener: (status: RemixStatus) => void): void { notify = listener }
export function remixStatus(): RemixStatus | null { return active?.status ?? reviewing?.status ?? lastStatus }

function running(run: ActiveRemix): boolean { return run.status.phase === 'planning' || run.status.phase === 'rendering' }

function publish(run: ActiveRemix, patch: Partial<RemixStatus>): void {
  if (!running(run)) return
  run.status = { ...run.status, ...patch, percent: Math.max(run.status.percent, Math.min(100, Math.round(patch.percent ?? run.status.percent))) }
  notify(run.status)
}

function finish(run: ActiveRemix, patch: Partial<RemixStatus>): void {
  run.status = { ...run.status, ...patch }
  lastStatus = run.status
  if (active === run) active = null
  reviewing = run.status.phase === 'review' ? run : reviewing === run ? null : reviewing
  notify(run.status)
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.flv'])

export interface ParsedRemix { request: RemixRequest; sourceIsUrl: boolean }

export function parseRemixRequest(value: unknown, outputDirectory: string): ParsedRemix {
  const raw = (value ?? {}) as Record<string, unknown>
  const given = Array.isArray(raw.sources) ? raw.sources : typeof raw.source === 'string' ? [raw.source] : []
  const trimmed = given.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  // De-duplicate after normalizing, so the same video pasted twice isn't planned twice.
  const sources = [...new Set(trimmed.map((item) => remixSourceUrl(item) ?? item))]
  if (sources.length === 0) throw new Error('Paste a video link or choose a file.')
  if (sources.length > MAX_SOURCES) throw new Error(`Add up to ${MAX_SOURCES} videos per run.`)
  if (raw.format !== undefined && raw.format !== 'silent' && raw.format !== 'commentary' && raw.format !== 'image' && raw.format !== 'pause_react') throw new Error('Choose the kind of remix.')
  const format = raw.format === 'silent' || raw.format === 'image' || raw.format === 'pause_react' ? raw.format : 'commentary'
  const image = format === 'image'
  const pause = format === 'pause_react'
  if (pause && sources.length > 1) throw new Error('React to one video at a time.')
  const urls = image ? sources.map(() => null) : sources.map(remixSourceUrl)
  const local = sources.filter((_, i) => !urls[i])
  if (image) {
    // An article or a post: one screenshot, chosen in the file dialog.
    if (sources.length > 1) throw new Error('Choose one screenshot at a time.')
    try { assertMediaPath(local[0], outputDirectory) } catch { throw new Error('Choose the screenshot again.') }
    if (!REMIX_IMAGE_EXTENSIONS.includes(extname(local[0]).slice(1).toLowerCase())) throw new Error('Choose a screenshot (JPG, PNG or WebP).')
  } else if (local.length > 0) {
    if (sources.length > 1) throw new Error('Use one file at a time, or paste links (one per line) for several videos.')
    try { assertMediaPath(local[0], outputDirectory) } catch { throw new Error('Paste full video links (https://…) or choose the file again.') }
    if (!VIDEO_EXTENSIONS.has(extname(local[0]).toLowerCase())) throw new Error('Choose a video file (MP4, MOV, MKV or WebM).')
  }
  if (!isRemixAngle(raw.angle)) throw new Error('Choose a remix style.')
  const order = raw.order === undefined ? 'moment_first' : raw.order
  if (!isRemixOrder(order)) throw new Error('Choose the order of the video.')
  if (!image && !pause && !isRemixHost(raw.host)) throw new Error('Choose how your presenter appears.')
  // Lip-sync to our own voice isn't possible on OpenRouter yet: the avatar's photo presents instead.
  // A screenshot, and a pause-and-react, are always you, on camera.
  const host = image || pause ? 'camera' : raw.host === 'lipsync' ? 'still' : raw.host as Exclude<RemixRequest['host'], 'lipsync'>
  if (image && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to share this screenshot.')
  if (pause && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to use this video: Pause & react plays much of it.')
  if (format === 'silent' && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to use these clips: Silent react plays much more of them.')
  const onCamera = host === 'camera'
  if (format === 'silent' && !onCamera && !isAvatarId(raw.avatarId)) throw new Error('Choose the avatar whose reactions to use.')
  // On camera it's your own voice; otherwise an avatar's or a preset.
  const voice = onCamera ? DEFAULT_VOICE_NAME : raw.voice === AVATAR_VOICE ? AVATAR_VOICE : presetVoiceId(raw.voice)
  if (!voice) throw new Error('Choose a voice.')
  // An avatar presents the video, or (voice only) lends its voice. On camera, nobody else does.
  const avatarId = onCamera ? null : host === 'voice' && voice !== AVATAR_VOICE && format !== 'silent' ? null : raw.avatarId
  if (!onCamera && host !== 'voice' && !isAvatarId(avatarId)) throw new Error('Choose an avatar, or switch to voice only.')
  if (voice === AVATAR_VOICE && !isAvatarId(avatarId)) throw new Error('Choose the avatar whose voice to use, or pick a preset voice.')
  const parsedCamera = onCamera ? parseCameraSettings(raw.camera ?? (image ? { ...DEFAULT_CAMERA, layout: 'greenscreen' } : DEFAULT_CAMERA)) : undefined
  // Pause & react fills the frame with you: as filmed or with the background removed.
  if (pause && parsedCamera?.layout === 'greenscreen') throw new Error('Choose “As filmed” or “Background removed” for Pause & react.')
  // Over a screenshot, and when you pause their video to talk, your voice is always kept.
  const camera = parsedCamera && (image || pause) ? { ...parsedCamera, talk: true } : parsedCamera
  const pauseChoice = pause ? parsePauseChoice(raw.pause) : undefined
  const brandIdentityId = raw.brandIdentityId === null || raw.brandIdentityId === undefined ? null : raw.brandIdentityId
  if (brandIdentityId !== null && !isBrandId(brandIdentityId)) throw new Error('Choose a brand identity.')
  if (!image && !pause && (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > MAX_REMIXES)) throw new Error(`Make between 1 and ${MAX_REMIXES} remixes per video.`)
  if (!isCaptionPresetId(raw.captionPreset)) throw new Error('Choose a caption style.')
  const creator = typeof raw.creator === 'string' ? raw.creator.replace(/\s+/g, ' ').trim() : ''
  if (creator.length > 80) throw new Error('Keep the creator name under 80 characters.')
  if (image && !creator) throw new Error('Add where the screenshot is from (the publication or the account) so the video credits it.')
  if (local.length > 0 && !creator) throw new Error('Add the original creator’s name so the video credits them.')
  // On camera it's really you: no AI presenter or AI voice to label.
  if (!onCamera && raw.aiLabelAck !== true) throw new Error('Confirm you’ll turn on the AI-content label when you post.')
  const ctaKeyword = normalizeCtaKeyword(raw.ctaKeyword)
  if (ctaKeyword === null) throw new Error('Use one word for the comment keyword (letters, numbers or a dash), like SALES.')
  const ctaOffer = typeof raw.ctaOffer === 'string' ? raw.ctaOffer.replace(/\s+/g, ' ').trim() : ''
  if (ctaOffer.length > MAX_CTA_OFFER_CHARS) throw new Error(`Keep “what they get” under ${MAX_CTA_OFFER_CHARS} characters.`)
  const headlineLook = raw.headlineLook === undefined || raw.headlineLook === null ? undefined : parseHeadlineLook(raw.headlineLook)
  const ctaId = parseCtaChoice(raw.ctaId)
  if (raw.showHandle !== undefined && typeof raw.showHandle !== 'boolean') throw new Error('Choose whether to show your handle.')
  return {
    sourceIsUrl: local.length === 0,
    request: {
      sources: sources.map((source, i) => urls[i] ?? source), creator: sources.length === 1 ? creator : '', angle: raw.angle, order,
      host, avatarId: avatarId as string | null, voice, brandIdentityId,
      count: image || pause ? 1 : raw.count as number, captionPreset: raw.captionPreset, includeCaptions: raw.includeCaptions !== false, aiLabelAck: !onCamera,
      ctaKeyword, ctaOffer: ctaKeyword ? ctaOffer : '', format, clipRightsAck: format !== 'commentary',
      ...(headlineLook ? { headlineLook } : {}),
      ...(ctaId ? { ctaId } : {}),
      ...(camera ? { camera } : {}),
      ...(raw.showHandle === true && brandIdentityId ? { showHandle: true } : {}),
      ...(pauseChoice ? { pause: pauseChoice } : {})
    }
  }
}

/** Pause & react: where their video goes and whose words are captioned (the defaults when not given). */
function parsePauseChoice(value: unknown): NonNullable<RemixRequest['pause']> {
  if (value === undefined || value === null) return { ...DEFAULT_PAUSE_REACT }
  const raw = value as Record<string, unknown>
  if (typeof value !== 'object' || Array.isArray(value) || !isPauseLayout(raw.layout ?? 'box') || !isPauseCaptions(raw.captions ?? 'member')) {
    throw new Error('Choose where their video goes and which words are captioned.')
  }
  return { layout: (raw.layout ?? 'box') as NonNullable<RemixRequest['pause']>['layout'], captions: (raw.captions ?? 'member') as NonNullable<RemixRequest['pause']>['captions'] }
}

async function preflight(folder: string): Promise<void> {
  const settings = loadSettings(), engine = getEnginePath()
  if (!settings.openrouterApiKey) throw new Error('Add your OpenRouter key in Settings → API keys to make remixes.')
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    try { await execFileAsync(resolveBinary(tool), ['-version'], { timeout: 15_000 }) }
    catch { throw new Error(`${tool === 'ffmpeg' ? 'FFmpeg' : 'FFprobe'} is missing. Run Settings → System check first.`) }
  }
  const python = await validatePython(resolvePythonPath(engine, settings.pythonPath), engine)
  if (!python.ok) throw new Error('The clipping engine is not ready. Run Settings → System check first.')
  try { await mkdir(folder, { recursive: true }); await access(folder, fsConstants.W_OK) }
  catch { throw new Error('The output folder is not writable. Choose another in Settings → Output.') }
}

function kill(child?: ChildProcess, force = false, sync = false): void {
  if (!child?.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
    else if (sync) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 })
    else execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined)
  } catch { /* already exited */ }
}

let starting = false
/** The avatar and cancel request for a run still in its pre-flight checks. */
let pending: { avatarId: string | null; cancelled: boolean } | null = null

/**
 * Avatars a remix needs right now. A run uses its own copy of the photo once
 * it starts, so only a run still in its pre-flight checks needs the original.
 */
/** The run folder a remix is writing to right now (its videos can't be changed meanwhile). */
export function remixFolderInUse(): string | null {
  return active?.status.folder ?? null
}

export function remixAvatarInUse(): string | null {
  return pending?.avatarId ?? null
}

// Variety guard: how often each creator was remixed recently (platforms flag repetitive reposting).
const LEDGER_DAYS = 7
const LEDGER_LIMIT = 5

function ledgerPath(): string { return join(app.getPath('userData'), 'remix-ledger.json') }

async function readLedger(): Promise<{ creator: string; at: string }[]> {
  try {
    const items = JSON.parse(await readFile(ledgerPath(), 'utf8')) as unknown
    const cutoff = Date.now() - LEDGER_DAYS * 86_400_000
    return Array.isArray(items) ? items.filter((item): item is { creator: string; at: string } =>
      Boolean(item) && typeof item.creator === 'string' && typeof item.at === 'string' && Date.parse(item.at) > cutoff).slice(-2000) : []
  } catch { return [] }
}

async function recordCreators(creators: string[]): Promise<void> {
  try {
    const items = [...await readLedger(), ...creators.filter(Boolean).map((creator) => ({ creator: creator.toLowerCase().slice(0, 120), at: new Date().toISOString() }))]
    await writeFile(ledgerPath(), JSON.stringify(items.slice(-2000)), 'utf8')
  } catch { /* advisory only */ }
}

export async function varietyWarnings(drafts: RemixDraft[]): Promise<string[]> {
  const ledger = await readLedger()
  const counts = new Map<string, number>()
  for (const item of ledger) counts.set(item.creator, (counts.get(item.creator) ?? 0) + 1)
  const warnings: string[] = []
  const planned = new Map<string, number>()
  for (const draft of drafts) if (draft.creator) planned.set(draft.creator, (planned.get(draft.creator) ?? 0) + 1)
  for (const [creator, count] of planned) {
    const total = (counts.get(creator.toLowerCase()) ?? 0) + count
    if (total > LEDGER_LIMIT) warnings.push(`You'd post ${total} remixes of ${creator} this week. Platforms can treat that as repetitive reposting; mix in other creators.`)
  }
  return warnings
}

/**
 * How the presenter speaks: the avatar's own voice (its clone, or its preset)
 * when 'avatar' is chosen, otherwise the preset picked in Remix. The engine
 * gets the ElevenLabs name in lower case, as OpenRouter lists it.
 */
export function remixVoice(voice: string, avatar: Pick<Avatar, 'voice' | 'clonedVoice'> | null): { preset: string; cloned: Avatar['clonedVoice'] } {
  const own = voice === AVATAR_VOICE ? avatar?.voice ?? null : null
  const cloned = own?.provider === 'clone' && avatar?.clonedVoice ? avatar.clonedVoice : null
  const preset = own?.provider === 'elevenlabs' ? own.voice : voice === AVATAR_VOICE ? DEFAULT_VOICE_NAME : voice
  return { preset: preset.toLowerCase(), cloned }
}

export async function startRemix(value: unknown): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  starting = true
  try {
    const settings = loadSettings()
    const { request } = parseRemixRequest(value, settings.outputDirectory)
    pending = { avatarId: request.avatarId, cancelled: false }
    const brand = request.brandIdentityId ? await readBrandIdentity(request.brandIdentityId) : null
    let photo: string | null = null
    const avatar = request.avatarId ? readAvatar(request.avatarId) : null
    if (request.ctaId) readCta(request.ctaId)
    const silent = request.format === 'silent'
    const onCamera = request.host === 'camera'
    // Silent react uses neither the photo nor the voice: only the reaction clips. On camera: none of these.
    if (request.avatarId && request.host !== 'voice' && !silent && !onCamera) {
      photo = portraitPath(request.avatarId)
      if (!existsSync(photo)) throw new Error('That avatar’s photo is missing. Choose another avatar.')
    }
    const { preset, cloned } = silent || onCamera ? { preset: DEFAULT_VOICE_NAME.toLowerCase(), cloned: null } : remixVoice(request.voice, avatar)
    if (cloned && !existsSync(voiceSamplePath(request.avatarId as string))) throw new Error('This avatar’s cloned voice recording is missing. Clone it again in Avatar Studio, or pick a preset voice.')
    const clips = silent && !onCamera ? readReactions(request.avatarId as string) : []
    if (silent && !onCamera && !clips.length) throw new Error('Make this avatar’s reactions in Avatar Studio first (Reactions for Silent react).')
    // `remix-…` (not a bare id): the Library lists it only once it has finished videos.
    const folder = join(settings.outputDirectory, `remix-${randomUUID()}`)
    await preflight(folder)
    // The run reads its own copies, so editing or deleting the avatar can't break it.
    const reactions: Record<string, string> = {}
    let reactionsAi = false
    let voiceReference: string | null = null
    try {
      if (photo) {
        const copy = join(folder, '.presenter.jpg')
        await copyFile(photo, copy)
        photo = copy
      }
      if (clips.length) {
        await mkdir(join(folder, '.reactions'), { recursive: true })
        for (const clip of clips) {
          reactions[clip.id] = join(folder, '.reactions', `${clip.id}.mp4`)
          await copyFile(clip.path, reactions[clip.id])
          reactionsAi ||= clip.source === 'ai'
        }
      }
      if (cloned) {
        voiceReference = join(folder, '.voice.mp3')
        await copyFile(voiceSamplePath(request.avatarId as string), voiceReference)
      }
    } catch {
      await rm(folder, { recursive: true, force: true })
      throw new Error('This avatar’s files could not be copied for the remix. Check that your output folder has free space, then try again.')
    }
    // A screenshot: the run reads its own copy.
    const image = request.format === 'image'
    let imageCopy: string | null = null
    if (image) {
      imageCopy = join(folder, '.work', `source${extname(request.sources[0]).toLowerCase()}`)
      try { await mkdir(dirname(imageCopy), { recursive: true }); await copyFile(request.sources[0], imageCopy) } catch {
        await rm(folder, { recursive: true, force: true })
        throw new Error('The screenshot could not be copied for the remix. Check that your output folder has free space, then try again.')
      }
    }
    // The handle or logo in a corner: the run keeps its own copy of the logo (re-making a video later still finds it).
    const brandMark = await brandMarkForRun(brand, request.showHandle, folder)
    // Only now that the new run can start: it replaces takes waiting for review.
    if (reviewing) await discardRemix()
    await cleanupAbandoned(settings.outputDirectory, folder)
    if (pending.cancelled) { await rm(folder, { recursive: true, force: true }); throw new Error('Cancelled before it started.') }
    const context: RunContext = {
      request, draftIds: new Set(), planCostUsd: 0,
      config: {
        sources: image ? [] : request.sources, output_dir: folder,
        ...(imageCopy ? { image_source: { path: imageCopy, credit: request.creator } } : {}), angle: request.angle, order: request.order, count: request.count, host: request.host,
        voice: preset, voice_model: cloned ? 'fish-audio/s2.1-pro' : 'elevenlabs/eleven-v3', voice_reference: voiceReference,
        voice_transcript: cloned?.transcript ?? '', avatar_photo: request.format === 'silent' ? null : photo,
        format: request.format, reactions, reactions_ai: reactionsAi, brand_identity: brand?.text ?? '', brand_name: brand?.name ?? '', creator: request.creator,
        caption_preset: request.captionPreset, include_captions: request.includeCaptions,
        cta_keyword: request.ctaKeyword, cta_offer: request.ctaOffer,
        ...(headlineLookForEngine(request.headlineLook) ? { headline_look: headlineLookForEngine(request.headlineLook) } : {}),
        // Their recorded call to action ends each video, so the presenter doesn't say one too.
        ...(request.ctaId ? { cta_clip: true } : {}),
        ...(brandMark ? { brand_mark: brandMark } : {}),
        ...(request.camera ? { camera_layout: request.camera.layout, camera_backdrop: request.camera.backdrop,
          camera_backdrop_color: request.camera.backdropColor, camera_talk: request.camera.talk } : {}),
        ...(request.pause ? { pause_layout: request.pause.layout, pause_captions: request.pause.captions } : {})
      }
    }
    const run: ActiveRemix = {
      cancelled: false, avatarId: request.avatarId, context,
      status: {
        id: randomBytes(6).toString('hex'), phase: 'planning', detail: 'Starting', percent: 1, folder,
        ...(request.host === 'camera' ? { onCamera: true, cameraTalk: request.camera?.talk === true } : {}),
        estimateUsd: estimateRemixCost(request.host, request.count * request.sources.length, 0.5, request.format).total,
        drafts: [], outputs: [], costUsd: null, warnings: [], error: null
      }
    }
    if (image) {
      // Nothing to plan: you record first, then the AI writes the headline from what you said.
      context.draftIds = new Set([0])
      finish(run, { phase: 'review', detail: 'Record your take', percent: 100, drafts: [imageDraft(request.creator)] })
      return run.status
    }
    active = run
    notify(run.status)
    launch(run, { ...context.config, mode: 'plan' })
    return run.status
  } finally { starting = false; pending = null }
}

/** The one take of an article-or-post remix, before its headline is written. */
function imageDraft(credit: string): RemixDraft {
  return {
    id: 0, sourceIndex: 0, sourceTitle: credit, creator: credit, startMs: 0, endMs: 0, quote: '', why: '', style: 'reaction', stance: 'add_nuance',
    headline: '', intro: '', beats: [], close: '', notes: [], grade: null, estimateUsd: estimateRemixCost('camera', 1, 0, 'image').perRemixHigh,
    postCaption: '', format: 'image', cues: []
  }
}

/** Article or post: write the headline and caption from the recorded take, then back to review. */
export async function writeRemix(): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  const run = reviewing
  if (!run || run.status.phase !== 'review' || !oneTake(run.context.request.format)) throw new Error('There is no take waiting for its headline.')
  if (recordingInProgress(run)) throw new Error('Wait for your recording to finish saving.')
  if (!run.context.recordings?.get(0)?.get('reaction')) throw new Error('Record your take first.')
  const recordings = engineRecordings(run, [{ id: 0, beats: [] }])
  reviewing = null
  active = run
  run.cancelled = false
  run.context.writing = true
  run.status = { ...run.status, phase: 'planning', detail: 'Writing your headline and caption from what you said', percent: 5, error: null }
  notify(run.status)
  launch(run, { ...run.context.config, mode: 'write', recordings })
  return run.status
}

/** Render the drafts the user approved (with their edits). */
export async function renderRemix(value: unknown): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  const run = reviewing
  if (!run || run.status.phase !== 'review') throw new Error('There is nothing waiting for review. Plan the remixes again.')
  const edits = parseRemixEdits(value, run.context.draftIds, new Set(run.status.drafts.filter((draft) => headlineOnly(draft.format)).map((draft) => draft.id)))
  if (recordingInProgress(run)) throw new Error('Wait for your recording to finish saving.')
  const recordings = run.context.request.host === 'camera' ? engineRecordings(run, edits) : null
  // Keep the edits on the run, so a failed render comes back to review with them.
  run.status = { ...run.status, drafts: run.status.drafts.map((draft) => {
    const edit = edits.find((item) => item.id === draft.id)
    return edit ? { ...draft, headline: edit.headline, intro: edit.intro, beats: edit.beats, close: edit.close, ...(edit.postCaption ? { postCaption: edit.postCaption } : {}) } : draft
  }) }
  reviewing = null
  active = run
  run.cancelled = false
  run.status = { ...run.status, phase: 'rendering', detail: 'Starting', percent: 1, error: null,
    estimateUsd: run.status.drafts.filter((draft) => edits.some((edit) => edit.id === draft.id)).reduce((sum, draft) => sum + draft.estimateUsd, 0) }
  notify(run.status)
  launch(run, { ...run.context.config, mode: 'render', approved: edits, ...(recordings ? { recordings } : {}) })
  return run.status
}

/**
 * Remove what abandoned remix runs left behind (downloaded sources, plans,
 * the presenter copy). Finished videos are never deleted: a folder is only
 * removed when nothing but those leftovers is in it.
 */
export async function cleanupAbandoned(outputDirectory: string, keep: string | null = null): Promise<void> {
  let names: string[] = []
  try { names = await readdir(outputDirectory) } catch { return }
  for (const name of names) {
    if (!/^remix-[0-9a-f-]{36}$/.test(name)) continue
    const folder = join(outputDirectory, name)
    if (folder === keep || folder === active?.status.folder || folder === reviewing?.status.folder) continue
    try {
      await rm(join(folder, '.work'), { recursive: true, force: true })
      await rm(join(folder, '.presenter.jpg'), { force: true })
      await rm(join(folder, '.voice.mp3'), { force: true })
      await rm(join(folder, '.reactions'), { recursive: true, force: true })
      await rm(join(folder, '.recordings'), { recursive: true, force: true })
      // A re-make interrupted by quitting.
      if (folder !== recomposing) for (const file of await readdir(folder)) if (/^\.recompose-[a-f0-9]{8}\.mp4$/.test(file)) await rm(join(folder, file), { force: true })
      if ((await readdir(folder)).length === 0) await rm(folder, { recursive: true, force: true })
    } catch { /* best effort */ }
  }
}

/** Drop a plan waiting for review and its downloaded sources. */
export async function discardRemix(): Promise<boolean> {
  const run = reviewing
  if (!run) return false
  reviewing = null
  await dropWriters(run)
  await rm(run.status.folder, { recursive: true, force: true }).catch(() => undefined)
  finish(run, { phase: 'cancelled', detail: 'Discarded', drafts: [] })
  return true
}

/** Video lengths after the call to action was added (read back from the run's job_output.json). */
async function withCtaDurations(folder: string, outputs: RemixOutput[]): Promise<RemixOutput[]> {
  try {
    const job = JSON.parse(await readFile(join(folder, 'job_output.json'), 'utf8')) as { clips?: { clip_index?: unknown; duration_ms?: unknown }[] }
    const lengths = new Map((job.clips ?? []).map((clip) => [`clip_${String(clip.clip_index).padStart(2, '0')}.mp4`, Number(clip.duration_ms) / 1000]))
    return outputs.map((output) => {
      const seconds = lengths.get(basename(output.path))
      return seconds && Number.isFinite(seconds) ? { ...output, durationSeconds: seconds } : output
    })
  } catch { return outputs }
}

function engineDidNotStart(run: ActiveRemix): void {
  const error = 'The clipping engine could not start. Run Settings → System check.'
  // Writing a headline keeps your recording: back to review.
  if (run.context.writing) { run.context.writing = false; finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, error }); return }
  // Making the approved takes: nothing was made, so back to review with the takes (and recordings) kept.
  if (run.status.phase === 'rendering' && (run.context.request.format === 'image' || existsSync(join(run.status.folder, '.work', 'plan.json')))) {
    finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, error })
    return
  }
  finish(run, { phase: 'failed', error })
}

function launch(run: ActiveRemix, config: Record<string, unknown>): void {
  execute(run, config).catch((error: unknown) => {
    logger.warn('remix.spawn.failed', { message: String(error).slice(0, 300) })
    engineDidNotStart(run)
  })
}

async function execute(run: ActiveRemix, config: Record<string, unknown>): Promise<void> {
  const settings = loadSettings(), engine = getEnginePath()
  const env: Record<string, string | undefined> = {
    ...runtimeEnvironment(), ...getSettingsForBridge(settings), LAYOUT_VISION_ENABLED: 'false',
    PYTHONPATH: engine, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1'
  }
  const ffmpegPath = resolveBinary('ffmpeg')
  if (ffmpegPath !== 'ffmpeg') env.PATH = `${dirname(ffmpegPath)}${delimiter}${env.PATH ?? ''}`
  const python = resolvePythonPath(engine, settings.pythonPath)
  const request = run.context.request
  logger.info('remix.start', { mode: config.mode, angle: request.angle, host: request.host, videos: request.sources.length, brand: Boolean(request.brandIdentityId) })
  const child = spawn(python, [join(dirname(getBridgeRunnerPath()), 'remix_runner.py')], {
    cwd: engine, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true
  })
  run.child = child
  let buffer = '', stderr = ''
  let result: Record<string, unknown> | null = null
  const timer = setTimeout(() => kill(child, true), 3 * 60 * 60_000)
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk)
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      try {
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.type === 'progress' && typeof message.percent === 'number') {
          if (!run.cancelled) publish(run, { detail: typeof message.detail === 'string' ? message.detail.slice(0, 160) : run.status.detail, percent: message.percent })
        } else if (typeof message.ok === 'boolean') result = message
      } catch { /* ignore non-protocol output */ }
    }
  })
  child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000) })
  child.on('error', () => {
    clearTimeout(timer)
    engineDidNotStart(run)
  })
  child.on('close', () => { void closed() })
  async function closed(): Promise<void> {
    clearTimeout(timer); run.child = undefined
    if (!running(run)) return
    if (run.context.writing) {
      run.context.writing = false
      // Cancelled before the headline arrived: back to review as it was (a headline that already arrived is kept: it's paid for).
      if (run.cancelled && result?.ok !== true) { finish(run, { phase: 'review', detail: 'Ready for review', percent: 100 }); return }
      const drafts = result?.ok === true && Array.isArray(result.drafts) ? result.drafts.map(parseRemixDraft).filter((item): item is RemixDraft => item !== null && item.id === 0) : []
      const written = typeof result?.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? result.cost_usd : 0
      run.context.planCostUsd += written
      if (drafts.length) {
        logger.info('remix.written', { cost: written })
        const kept = run.status.drafts[0]
        // Pause & react: the part of their video stays as the member chose it.
        const take = request.format === 'pause_react' && kept ? { ...drafts[0], format: 'pause_react' as const, startMs: kept.startMs, endMs: kept.endMs } : { ...drafts[0], format: 'image' as const }
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, drafts: [take], costUsd: run.context.planCostUsd, error: null })
      } else {
        logger.warn('remix.write.failed', { stderr: stderr.slice(-1500) })
        const message = typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : 'The headline could not be written. Try again, or type your own headline.'
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, error: message })
      }
      return
    }
    const planning = run.status.phase === 'planning'
    if (run.cancelled) {
      if (planning) await rm(run.status.folder, { recursive: true, force: true }).catch(() => undefined)
      else for (const copy of ['.presenter.jpg', '.voice.mp3', '.reactions', '.recordings']) await rm(join(run.status.folder, copy), { recursive: true, force: true }).catch(() => undefined)
      finish(run, { phase: 'cancelled', detail: planning ? 'Cancelled while planning' : 'Cancelled' })
      return
    }
    const warnings = Array.isArray(result?.warnings) ? result.warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 400)).slice(0, 12) : []
    const cost = typeof result?.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? result.cost_usd : null
    if (result?.ok === true && planning) {
      const drafts = (Array.isArray(result.drafts) ? result.drafts : []).map(parseRemixDraft).filter((item): item is RemixDraft => item !== null)
      run.context.draftIds = new Set(drafts.map((draft) => draft.id))
      run.context.planCostUsd = cost ?? 0
      if (request.format === 'pause_react') {
        const seconds = typeof result.source_seconds === 'number' && Number.isFinite(result.source_seconds) && result.source_seconds > 0 ? result.source_seconds : (drafts[0]?.endMs ?? 0) / 1000
        run.context.pause = { sourceSeconds: seconds, settings: DEFAULT_PAUSE_SETTINGS }
      }
      logger.info('remix.planned', { drafts: drafts.length, cost })
      finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, drafts, warnings: [...warnings, ...await varietyWarnings(drafts)], costUsd: cost })
    } else if (result?.ok === true) {
      let outputs = (Array.isArray(result.remixes) ? result.remixes : []).map(parseRemixOutput).filter((item): item is RemixOutput => item !== null)
      if (request.ctaId && outputs.length) {
        publish(run, { detail: 'Adding your call to action', percent: 99 })
        try {
          run.ctaAbort = new AbortController()
          const total = outputs.length
          const { failed, cancelled } = await applyRunCta(run.status.folder, request.ctaId, undefined, {
            signal: run.ctaAbort.signal,
            onProgress: (done) => { if (done < total && !run.cancelled) publish(run, { detail: `Adding your call to action (${done + 1} of ${total})`, percent: 99 }) }
          })
          if (cancelled) warnings.push('Cancelled while adding your call to action: the videos are made, and some end without it. Add it from the Library (⋯ → Add call to action).')
          if (failed.length) warnings.push(`The call to action could not be added to ${failed.length} video${failed.length === 1 ? '' : 's'}. Add it from the Library (⋯ → Add call to action).`)
          outputs = await withCtaDurations(run.status.folder, outputs)
        } catch {
          // The videos are made; the member adds a call to action from the Library (the run's own may have been deleted).
          warnings.push('Your call to action couldn’t be added to these videos (it may have been removed from your library). Add one from the Library (⋯ → Add call to action).')
        }
      }
      await recordCreators(outputs.map((output) => output.creator))
      for (const copy of ['.presenter.jpg', '.voice.mp3', '.reactions', '.recordings']) await rm(join(run.status.folder, copy), { recursive: true, force: true }).catch(() => undefined)
      logger.info('remix.done', { count: outputs.length, cost })
      finish(run, { phase: 'done', detail: 'Done', percent: 100, outputs, warnings, costUsd: (cost ?? 0) + run.context.planCostUsd })
    } else {
      const message = typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : 'The remix could not be made. Check Settings → System check, then try again.'
      logger.warn('remix.failed', { stderr: stderr.slice(-1500) })
      // Development runs keep the engine's own output next to the app log (the app log hides it).
      if (!app.isPackaged) {
        const dir = join(app.getPath('logs'), 'engine')
        await mkdir(dir, { recursive: true }).then(() => writeFile(join(dir, `remix-${new Date().toISOString().replace(/[:.]/g, '-')}.log`), stderr, { mode: 0o600 })).catch(() => undefined)
      }
      if (planning) await rm(run.status.folder, { recursive: true, force: true }).catch(() => undefined)
      // Nothing was made but the plan is still there: back to review to retry without planning (and paying) again.
      if (!planning && (request.format === 'image' || existsSync(join(run.status.folder, '.work', 'plan.json')))) {
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, error: message, warnings })
        return
      }
      finish(run, { phase: 'failed', error: message })
    }
  }
  child.stdin.on('error', () => undefined)
  child.stdin.end(JSON.stringify(config))
}

// ---------------------------------------------------------------------------
// Me, on camera: recordings made in the app (streamed in chunks) or uploaded,
// kept in the run folder's .recordings until the videos are made.
// ---------------------------------------------------------------------------

const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024
interface Writer { file: string; draftId: number; part: RecordingPart; bytes: number; handle: FileHandle; run: ActiveRemix }
const writers = new Map<string, Writer>()

function reviewRun(): ActiveRemix {
  if (!reviewing || reviewing.status.phase !== 'review') throw new Error('Record once your takes are ready for review.')
  if (reviewing.context.request.host !== 'camera') throw new Error('This remix isn’t set up for “Me, on camera”.')
  return reviewing
}

function checkedPart(run: ActiveRemix, draftId: unknown, part: unknown): { draft: RemixDraft; part: RecordingPart } {
  const draft = run.status.drafts.find((item) => item.id === draftId)
  if (!draft) throw new Error('That take is no longer in this review.')
  if (!isRecordingPart(part) || !partsFor(draft.format, 4).includes(part)) throw new Error('Choose what to record for this take.')
  return { draft, part }
}

function recordingsDir(run: ActiveRemix): string {
  return join(run.status.folder, '.recordings')
}

async function mediaSecondsOf(path: string): Promise<number> {
  try {
    const { stdout } = await promisify(execFile)(resolveBinary('ffprobe'), ['-v', 'error', '-protocol_whitelist', 'file,pipe,fd',
      '-format_whitelist', 'mov,matroska,webm,avi,flv,mpegts', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeout: 30_000 })
    const seconds = Number(String(stdout).trim())
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  } catch { return 0 }
}

async function keep(run: ActiveRemix, draftId: number, part: RecordingPart, file: RecordingFile): Promise<void> {
  // The review may have closed (discarded, replaced, or being made) while the file was saved.
  if (reviewing !== run) { await rm(file.path, { force: true }).catch(() => undefined); throw new Error('This review was closed, so the recording wasn’t kept.') }
  run.context.recordings ??= new Map()
  const takes = run.context.recordings.get(draftId) ?? new Map<RecordingPart, RecordingFile>()
  const previous = takes.get(part)
  takes.set(part, file)
  run.context.recordings.set(draftId, takes)
  if (previous && previous.path !== file.path) await rm(previous.path, { force: true }).catch(() => undefined)
}

/** Count a recording being saved, so writing and making wait until it's in place. */
async function saving<T>(run: ActiveRemix, work: () => Promise<T>): Promise<T> {
  run.context.savingRecordings = (run.context.savingRecordings ?? 0) + 1
  try { return await work() } finally { run.context.savingRecordings = (run.context.savingRecordings ?? 1) - 1 }
}

/** Recording, saving or copying in for this run right now. */
function recordingInProgress(run: ActiveRemix): boolean {
  return (run.context.savingRecordings ?? 0) > 0 || [...writers.values()].some((writer) => writer.run === run)
}

/** Close and delete recordings still being written for a run that's going away (or all of them). */
async function dropWriters(run: ActiveRemix | null): Promise<void> {
  for (const [token, writer] of [...writers]) if (!run || writer.run === run) await abortRecording(token)
}

/** Where the take's moment is, so the recorder can play it while you react. */
export async function remixMoment(draftId: unknown): Promise<{ path: string; startSeconds: number; endSeconds: number; kind: 'video' | 'image' }> {
  const run = reviewRun()
  const draft = run.status.drafts.find((item) => item.id === draftId)
  if (!draft) throw new Error('That take is no longer in this review.')
  if (draft.format === 'image') {
    const image = (run.context.config.image_source as { path?: unknown } | undefined)?.path
    if (typeof image !== 'string' || !existsSync(image)) throw new Error('This screenshot is no longer available. Start again.')
    return { path: authorizeMedia(image), startSeconds: 0, endSeconds: MAX_IMAGE_TAKE_SECONDS, kind: 'image' }
  }
  const plan = JSON.parse(await readFile(join(run.status.folder, '.work', 'plan.json'), 'utf8')) as { sources?: { video?: unknown }[] }
  const video = plan.sources?.[draft.sourceIndex]?.video
  if (typeof video !== 'string' || !existsSync(video)) throw new Error('This take’s video is no longer available. Plan the remixes again.')
  return { path: authorizeMedia(video), startSeconds: draft.startMs / 1000, endSeconds: draft.endMs / 1000, kind: 'video' }
}

/** Start saving a recording made in the app; chunks follow, then finish. */
export async function beginRecording(draftId: unknown, part: unknown, mime: unknown): Promise<string> {
  const run = reviewRun()
  const checked = checkedPart(run, draftId, part)
  const extension = typeof mime === 'string' && mime.startsWith('video/mp4') ? 'mp4' : 'webm'
  await mkdir(recordingsDir(run), { recursive: true })
  const token = randomUUID()
  const file = join(recordingsDir(run), `${checked.draft.id}-${checked.part}-${randomBytes(4).toString('hex')}.${extension}`)
  writers.set(token, { file, draftId: checked.draft.id, part: checked.part, bytes: 0, handle: await open(file, 'wx', 0o600), run })
  return token
}

export async function appendRecording(token: unknown, chunk: unknown): Promise<void> {
  const writer = typeof token === 'string' ? writers.get(token) : undefined
  if (!writer) throw new Error('That recording was stopped.')
  // A tag check rather than instanceof: IPC (and tests) can hand over bytes from another realm.
  if (Object.prototype.toString.call(chunk) !== '[object Uint8Array]') throw new Error('Invalid recording data.')
  writer.bytes += (chunk as Uint8Array).byteLength
  if (writer.bytes > MAX_RECORDING_BYTES) { await abortRecording(token); throw new Error('That recording is too large.') }
  await writer.handle.write(chunk as Uint8Array)
}

/**
 * Finish a recording; offsetSeconds is where the moment started in it (reactions). Pause & react also sends the
 * recorder's log ({ events, durationMs }): when the original played and paused, on the recording's clock.
 */
export async function finishRecording(token: unknown, offsetSeconds: unknown, pause?: unknown): Promise<RemixRecordings> {
  const writer = typeof token === 'string' ? writers.get(token) : undefined
  if (!writer) throw new Error('That recording was stopped.')
  const pauseTake = writer.run.status.drafts.find((draft) => draft.id === writer.draftId)?.format === 'pause_react'
  let events: PauseEvent[] | undefined
  let measured = 0
  if (pauseTake) {
    const raw = (pause ?? {}) as Record<string, unknown>
    try {
      events = parsePauseEvents(raw.events, (PAUSE_REACT_MAX_SECONDS + 10) * 1000)
      measured = typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) && raw.durationMs > 0 ? Math.min(raw.durationMs, (PAUSE_REACT_MAX_SECONDS + 10) * 1000) / 1000 : 0
    } catch (error) { await abortRecording(token); throw error }
  }
  return saving(writer.run, async () => {
    writers.delete(token as string)
    await writer.handle.close()
    if (reviewing !== writer.run) { await rm(writer.file, { force: true }); throw new Error('This review was closed, so the recording wasn’t kept.') }
    // Unknown (null) when the clip never started playing: the engine then lines the reaction up by sound.
    const offset = typeof offsetSeconds === 'number' && Number.isFinite(offsetSeconds) && offsetSeconds >= 0 && offsetSeconds < 600 ? offsetSeconds : null
    // A webcam recording often has no length in its header: read it from its frames, or the recorder's own clock.
    const seconds = (pauseTake ? await recordingSecondsOf(writer.file) : await mediaSecondsOf(writer.file)) || measured
    if (writer.bytes < 1000) { await rm(writer.file, { force: true }); throw new Error('Nothing was recorded. Check your camera and microphone, then try again.') }
    if (pauseTake && seconds < 1) { await rm(writer.file, { force: true }); throw new Error('That recording is too short. Record your reaction again.') }
    await keep(writer.run, writer.draftId, writer.part, { path: writer.file, offsetS: writer.part === 'reaction' ? offset : null, uploaded: false, seconds,
      ...(events ? { events } : {}) })
    return remixRecordings()
  })
}

export async function abortRecording(token: unknown): Promise<void> {
  const writer = typeof token === 'string' ? writers.get(token) : undefined
  if (!writer) return
  writers.delete(token as string)
  await writer.handle.close().catch(() => undefined)
  await rm(writer.file, { force: true })
}

/** Use a video filmed elsewhere (a phone): copied into the run. A reaction is lined up with the clip by its sound. */
export async function uploadRecording(draftId: unknown, part: unknown, source: string): Promise<RemixRecordings> {
  const run = reviewRun()
  const checked = checkedPart(run, draftId, part)
  const extension = extname(source).slice(1).toLowerCase()
  if (!RECORDING_VIDEO_EXTENSIONS.includes(extension)) throw new Error('Choose a video (MP4, MOV or WebM).')
  const info = await stat(source)
  if (!info.isFile() || info.size > MAX_RECORDING_BYTES) throw new Error('Choose a video under 2 GB.')
  return saving(run, async () => {
    await mkdir(recordingsDir(run), { recursive: true })
    const file = join(recordingsDir(run), `${checked.draft.id}-${checked.part}-${randomBytes(4).toString('hex')}.${extension}`)
    const closed = async (): Promise<never> => { await rm(file, { force: true }).catch(() => undefined); throw new Error('This review was closed, so the recording wasn’t kept.') }
    await copyFile(source, file).catch(async (error: unknown) => { if (reviewing !== run) await closed(); throw error })
    const seconds = await mediaSecondsOf(file)
    if (reviewing !== run) await closed()
    if (!seconds) { await rm(file, { force: true }); throw new Error('That video could not be read. Try an MP4 or MOV from your phone.') }
    if (checked.draft.format === 'image' && seconds > MAX_IMAGE_TAKE_SECONDS + 1) {
      await rm(file, { force: true })
      throw new Error(`Keep your take to ${MAX_IMAGE_TAKE_SECONDS / 60} minutes. Trim it on your phone, then upload it again.`)
    }
    let detection: PauseDetection | undefined
    if (checked.draft.format === 'pause_react') {
      // A little lead-in is fine (pressing play, settling in); the video itself is at most five minutes.
      if (seconds > PAUSE_REACT_MAX_SECONDS + 30) {
        await rm(file, { force: true })
        throw new Error(`Keep your reaction to ${PAUSE_REACT_MAX_SECONDS / 60} minutes. Trim it on your phone, then upload it again.`)
      }
      try {
        detection = await detectPauses(run, file, checked.draft)
      } catch (error) { await rm(file, { force: true }); throw error }
      if (reviewing !== run) await closed()
    }
    await keep(run, checked.draft.id, checked.part, { path: file, offsetS: null, uploaded: true, seconds, ...(detection ? { detection } : {}) })
    if (detection && run.context.pause) run.context.pause.settings = DEFAULT_PAUSE_SETTINGS
    return remixRecordings()
  })
}

export async function removeRecording(draftId: unknown, part: unknown): Promise<RemixRecordings> {
  const run = reviewRun()
  const checked = checkedPart(run, draftId, part)
  const takes = run.context.recordings?.get(checked.draft.id)
  const file = takes?.get(checked.part)
  if (file) { takes?.delete(checked.part); await rm(file.path, { force: true }).catch(() => undefined) }
  return remixRecordings()
}

/** The recordings so far, by take and part (previewable in the app). */
export function remixRecordings(): RemixRecordings {
  const run = reviewing
  const out: RemixRecordings = {}
  for (const [draftId, takes] of run?.context.recordings ?? []) {
    out[draftId] = {}
    for (const [part, file] of takes) out[draftId][part] = { path: authorizeMedia(file.path), uploaded: file.uploaded, seconds: file.seconds }
  }
  return out
}

/** The engine's view of the recordings for the approved takes; throws when one is missing. */
function engineRecordings(run: ActiveRemix, edits: { id: number; beats: unknown[] }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const edit of edits) {
    const draft = run.status.drafts.find((item) => item.id === edit.id)
    if (!draft) continue
    const takes = run.context.recordings?.get(edit.id)
    const parts = partsFor(draft.format, edit.beats.length)
    const missing = parts.filter((part) => !takes?.get(part))
    if (missing.length) throw new Error(`Record “${draft.headline.slice(0, 60)}” first (${missing.length === parts.length ? 'nothing recorded yet' : `${missing.length} part${missing.length === 1 ? '' : 's'} left`}).`)
    if (draft.format === 'pause_react') {
      out[String(edit.id)] = { reaction: { path: takes!.get('reaction')!.path, offset_s: 0 }, timeline: timelineForEngine(pauseTimeline(run, draft.id)) }
      continue
    }
    out[String(edit.id)] = headlineOnly(draft.format)
      // Over a screenshot there's nothing to line up with: the take starts the video.
      ? { reaction: { path: takes!.get('reaction')!.path, offset_s: draft.format === 'image' ? 0 : takes!.get('reaction')!.offsetS } }
      : { intro: takes!.get('intro')!.path, beats: parts.filter((part) => part.startsWith('beat')).map((part) => takes!.get(part)!.path), close: takes!.get('close')!.path }
  }
  return out
}

// ---------------------------------------------------------------------------
// Pause & react: the part of their video, and when it plays and pauses
// ---------------------------------------------------------------------------

/** A recording's length, from its header or (webcam recordings often have none) its last video frame. */
async function recordingSecondsOf(path: string): Promise<number> {
  const header = await mediaSecondsOf(path)
  if (header) return header
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'mov,matroska,webm',
      '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', path], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
    const times = String(stdout).split('\n').map((line) => Number(line.trim().split(',')[0])).filter((value) => Number.isFinite(value))
    return times.length ? Math.max(...times) + 1 / 30 : 0
  } catch { return 0 }
}

/** The run's video to react to (saved when it was fetched) and its length. */
async function pauseSource(run: ActiveRemix): Promise<{ video: string; seconds: number }> {
  const plan = JSON.parse(await readFile(join(run.status.folder, '.work', 'plan.json'), 'utf8')) as { sources?: { video?: unknown }[] }
  const video = plan.sources?.[0]?.video
  if (typeof video !== 'string' || !existsSync(video)) throw new Error('The video you react to is no longer available. Start again.')
  return { video, seconds: run.context.pause?.sourceSeconds ?? 0 }
}

/** Ask the engine when the original played and paused in a phone recording (local, nothing paid). */
async function detectPauses(run: ActiveRemix, recording: string, draft: RemixDraft): Promise<PauseDetection> {
  const { video } = await pauseSource(run)
  const result = await runEngineOnce({ mode: 'pauses', recording, source: video, trim_start: draft.startMs / 1000, trim_end: draft.endMs / 1000 }, 10 * 60_000, true)
  const detection = parsePauseDetection(result.detection)
  if (!detection) throw new Error('Your recording could not be read. Try an MP4 or MOV from your phone.')
  logger.info('remix.pauses.detected', { alignedBy: detection.alignedBy, segments: detection.raw.length })
  return detection
}

function pauseRecording(run: ActiveRemix, draftId: number): { draft: RemixDraft; file: RecordingFile } {
  const draft = run.status.drafts.find((item) => item.id === draftId && item.format === 'pause_react')
  if (!draft) throw new Error('There is no pause-and-react take waiting for review.')
  const file = run.context.recordings?.get(draftId)?.get('reaction')
  if (!file) throw new Error('Record or upload your reaction first.')
  return { draft, file }
}

/** The take's timeline now: from the recorder's log, or from what was heard plus the member's adjustments. */
function pauseTimeline(run: ActiveRemix, draftId: number): PauseTimeline {
  const { draft, file } = pauseRecording(run, draftId)
  const trimStart = draft.startMs / 1000, trimEnd = draft.endMs / 1000
  if (file.uploaded) {
    if (!file.detection) throw new Error('Upload your reaction again so its pauses can be found.')
    return uploadTimeline(file.detection, run.context.pause?.settings ?? DEFAULT_PAUSE_SETTINGS, trimStart, trimEnd)
  }
  if (!file.seconds) throw new Error('Your recording’s length couldn’t be read. Record it again.')
  return timelineFromEvents(file.events ?? [], file.seconds, trimStart, trimEnd)
}

function pauseRun(): ActiveRemix {
  const run = reviewRun()
  if (run.context.request.format !== 'pause_react') throw new Error('This remix isn’t a pause-and-react.')
  return run
}

/** The pause-and-react take's timeline and adjustments for the review; null before anything is recorded. */
export function pauseView(): PauseView | null {
  const run = reviewing
  if (!run || run.status.phase !== 'review' || run.context.request.format !== 'pause_react') return null
  const file = run.context.recordings?.get(0)?.get('reaction')
  if (!file) return null
  const detection = file.detection
  return {
    source: file.uploaded ? 'upload' : 'app', timeline: pauseTimeline(run, 0), settings: run.context.pause?.settings ?? DEFAULT_PAUSE_SETTINGS,
    detection: detection ? { offset: detection.offset, confidence: detection.confidence, alignedBy: detection.alignedBy } : null,
    recordingPath: authorizeMedia(file.path), seconds: file.seconds
  }
}

/** A phone recording's adjustments: nudge the start, ignore short pauses or plays, flip stretches. */
export function setPauseSettings(value: unknown): PauseView {
  const run = pauseRun()
  const settings = parsePauseSettings(value)
  const { file } = pauseRecording(run, 0)
  if (!file.uploaded) throw new Error('Pauses recorded here follow what you did while recording.')
  run.context.pause = { sourceSeconds: run.context.pause?.sourceSeconds ?? 0, settings }
  return pauseView() as PauseView
}

/** The part of their video to react to (from startMs to endMs). A phone recording's pauses are found again for it. */
export async function setRemixTrim(draftId: unknown, startMs: unknown, endMs: unknown): Promise<{ draft: RemixDraft; view: PauseView | null }> {
  const run = pauseRun()
  const draft = run.status.drafts.find((item) => item.id === draftId && item.format === 'pause_react')
  if (!draft) throw new Error('That take is no longer in this review.')
  if (recordingInProgress(run)) throw new Error('Wait for your recording to finish saving.')
  const limit = Math.round((run.context.pause?.sourceSeconds ?? draft.endMs / 1000) * 1000)
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isInteger(startMs) || !Number.isInteger(endMs) ||
      startMs < 0 || endMs > limit + 50 || endMs - startMs < 1000) throw new Error('Choose at least one second of the video.')
  if (endMs - startMs > PAUSE_MAX_TRIM_SECONDS * 1000) throw new Error(`Choose up to ${PAUSE_MAX_TRIM_SECONDS / 60} minutes of the video.`)
  const next = { ...draft, startMs, endMs: Math.min(endMs, limit) }
  const file = run.context.recordings?.get(draft.id)?.get('reaction')
  if (file?.uploaded) {
    // Where the original starts in the recording, and its pauses, depend on the part chosen.
    file.detection = await saving(run, () => detectPauses(run, file.path, next))
    if (reviewing !== run) throw new Error('This review was closed.')
  }
  run.status = { ...run.status, drafts: run.status.drafts.map((item) => item.id === draft.id ? next : item) }
  notify(run.status)
  return { draft: next, view: pauseView() }
}

// ---------------------------------------------------------------------------
// Re-editing a finished remix: new hook text, look, captions or box size,
// re-rendered from the parts saved when it was made (.edit/<clip>), no AI cost.
// ---------------------------------------------------------------------------

/** What a member can change on a finished remix. */
export interface RemixRecompose {
  headline: string
  headlineLook: ReturnType<typeof parseHeadlineLook>
  includeCaptions: boolean
  captionPreset: string
  /** The moment's box share of the height, for layouts with two parts; null elsewhere. */
  split: number | null
}

export function parseRemixRecompose(value: unknown): RemixRecompose {
  const raw = (value ?? {}) as Record<string, unknown>
  const headline = typeof raw.headline === 'string' ? raw.headline.replace(/\s+/g, ' ').trim() : ''
  // The same rule as reviewing a take (hashtags don't count as words).
  const problem = remixEditProblem({ headline, intro: '', beats: [], close: '' }, 'silent')
  if (problem || headline.length > 200) throw new Error(problem ?? 'Keep the hook text to 200 characters.')
  const headlineLook = parseHeadlineLook(raw.headlineLook)
  if (typeof raw.includeCaptions !== 'boolean') throw new Error('Choose whether to show captions.')
  if (!isCaptionPresetId(raw.captionPreset)) throw new Error('Choose a caption style.')
  const split = raw.split === null || raw.split === undefined ? null : raw.split
  if (split !== null && (typeof split !== 'number' || !Number.isFinite(split) || split < 0.3 || split > 0.7)) throw new Error('Choose a box size between 30% and 70%.')
  return { headline, headlineLook, includeCaptions: raw.includeCaptions, captionPreset: raw.captionPreset, split: split === null ? null : Math.round(split * 100) / 100 }
}

let recomposing: string | null = null
let recomposeChild: ChildProcess | undefined

/** The Remix video being re-made, if any: the Library leaves that run alone meanwhile. */
export function remixRunBusy(path: string): string | null {
  return recomposing && path === recomposing ? 'Wait for this video to finish being re-made.' : null
}

const REMIX_RUN = /^remix-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A finished remix's run folder, checked: a real folder directly in the output folder, not being made or reviewed. */
function remixRunFolder(outputDir: unknown): string {
  const settings = loadSettings()
  if (typeof outputDir !== 'string' || !REMIX_RUN.test(basename(outputDir)) || dirname(outputDir) !== settings.outputDirectory) throw new Error('Only Remix videos can be edited here.')
  try {
    if (lstatSync(outputDir).isSymbolicLink() || !statSync(outputDir).isDirectory() || realpathSync(outputDir) !== join(realpathSync(settings.outputDirectory), basename(outputDir))) throw new Error('moved')
  } catch { throw new Error('Only Remix videos can be edited here.') }
  if (outputDir === active?.status.folder || outputDir === reviewing?.status.folder) throw new Error('This remix is still being made. Wait for it to finish.')
  return outputDir
}

/** The clip's current record in job_output.json (read inside the run's lock). */
async function remixClipRecord(folder: string, clipIndex: number): Promise<Record<string, unknown>> {
  const job = JSON.parse(await readFile(join(folder, 'job_output.json'), 'utf8')) as Record<string, unknown>
  const clip = (Array.isArray(job.clips) ? job.clips : []).find((item: Record<string, unknown>) => item?.clip_index === clipIndex) as Record<string, unknown> | undefined
  if (!clip) throw new Error('That video is no longer in this run.')
  return clip
}

/** Engine runs outside a remix run that aren't re-makes (finding a phone recording's pauses): stopped on quit. */
const taskChildren = new Set<ChildProcess>()

/** Run the engine once outside a remix run (re-editing, finding pauses); resolves with its result line. */
async function runEngineOnce(config: Record<string, unknown>, limitMs: number, task = false): Promise<Record<string, unknown>> {
  const settings = loadSettings(), engine = getEnginePath()
  const env: Record<string, string | undefined> = {
    ...runtimeEnvironment(), ...getSettingsForBridge(settings), LAYOUT_VISION_ENABLED: 'false',
    PYTHONPATH: engine, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1'
  }
  const ffmpegPath = resolveBinary('ffmpeg')
  if (ffmpegPath !== 'ffmpeg') env.PATH = `${dirname(ffmpegPath)}${delimiter}${env.PATH ?? ''}`
  const child = spawn(resolvePythonPath(engine, settings.pythonPath), [join(dirname(getBridgeRunnerPath()), 'remix_runner.py')], {
    cwd: engine, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true
  })
  if (task) taskChildren.add(child)
  else recomposeChild = child
  return new Promise((resolve, reject) => {
    let buffer = '', stderr = '', result: Record<string, unknown> | null = null
    const timer = setTimeout(() => kill(child, true), limitMs)
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try { const message = JSON.parse(line) as Record<string, unknown>; if (typeof message.ok === 'boolean') result = message } catch { /* not protocol */ }
      }
    })
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000) })
    child.on('error', () => { clearTimeout(timer); taskChildren.delete(child); if (recomposeChild === child) recomposeChild = undefined; reject(new Error('The clipping engine could not start. Run Settings → System check.')) })
    child.on('close', () => {
      clearTimeout(timer)
      taskChildren.delete(child)
      if (recomposeChild === child) recomposeChild = undefined
      if (result?.ok === true) { resolve(result); return }
      logger.warn('remix.recompose.failed', { stderr: stderr.slice(-1500) })
      reject(new Error(typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : task ? 'Your recording could not be read. Try an MP4 or MOV from your phone.' : 'The video could not be made again. Try again.'))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(JSON.stringify(config))
  })
}

/**
 * Re-render a finished remix with new hook text, look, captions or box size; its call to action is added back.
 * Returns a note when something about it needs the member's attention (the call to action couldn't be added).
 */
export async function recomposeRemix(outputDir: unknown, clipIndex: unknown, value: unknown): Promise<string | null> {
  const edit = parseRemixRecompose(value)
  // Claimed before any wait, so two re-makes can't both start.
  if (recomposing) throw new Error('Another video is being re-made. Wait for it to finish.')
  const folder = remixRunFolder(outputDir)
  if (!Number.isInteger(clipIndex) || (clipIndex as number) < 0) throw new Error('Choose a video to edit.')
  const index = clipIndex as number
  const path = join(folder, `clip_${String(index).padStart(2, '0')}.mp4`)
  const stem = basename(path, '.mp4')
  recomposing = folder
  const output = join(folder, `.recompose-${randomBytes(4).toString('hex')}.mp4`)
  try {
    // Nothing else changes this run's clips meanwhile (CTA changes wait; the Library refuses deletes).
    return await withRunLock(folder, async () => {
      await remixClipRecord(folder, index)
      if (!existsSync(path)) throw new Error('That video file is missing.')
      if (!existsSync(join(folder, '.edit', stem, 'edit.json'))) throw new Error('This video was made before editing was possible. Make it again to edit it.')
      const result = await runEngineOnce({
        mode: 'recompose', output_dir: folder, clip: stem, output_path: output, headline: edit.headline, headline_look: edit.headlineLook,
        include_captions: edit.includeCaptions, caption_preset: edit.captionPreset, split: edit.split, final_name: basename(path)
      }, 30 * 60_000)
      if (!existsSync(output)) throw new Error('The video could not be made again. Try again.')
      const clip = await remixClipRecord(folder, index)
      const ctaId = typeof (clip.cta as { id?: unknown } | null)?.id === 'string' ? (clip.cta as { id: string }).id : null
      let note: string | null = null
      if (ctaId) {
        // The plain video is the .original copy; the call to action goes back on top of the new one.
        await rename(output, originalPath(path))
        let failed = true
        try { failed = (await applyRunCtaInLock(folder, ctaId, [index])).failed.length > 0 } catch { failed = true }
        if (failed) {
          // Keep the new video, without the call to action, rather than the old one with it.
          await applyRunCtaInLock(folder, null, [index]).catch(() => undefined)
          note = 'The video was re-made, but its call to action couldn’t be added back (it may have been removed from your library). Add one from the Library (⋯ → Add call to action).'
        }
      } else {
        await rename(output, path)
        await rm(originalPath(path), { force: true })
      }
      // The Library shows the new hook text, length and settings (the engine may have tidied the hook text).
      const settings = result.settings && typeof result.settings === 'object' ? result.settings as Record<string, unknown> : {}
      const job = JSON.parse(await readFile(join(folder, 'job_output.json'), 'utf8')) as { clips?: Record<string, unknown>[] }
      for (const item of job.clips ?? []) {
        if (item.clip_index !== index) continue
        item.headline = typeof settings.headline === 'string' && settings.headline.trim() ? settings.headline : edit.headline
        if (!ctaId && typeof result.duration_seconds === 'number') item.duration_ms = Math.round(result.duration_seconds * 1000)
        if (result.editable && typeof result.editable === 'object') item.editable = result.editable
        item.edited_at = new Date().toISOString()
      }
      const temp = join(folder, `.job_output-${randomBytes(4).toString('hex')}.json`)
      await writeFile(temp, JSON.stringify(job, null, 2), { mode: 0o600 })
      await rename(temp, join(folder, 'job_output.json'))
      logger.info('remix.recomposed', { split: edit.split !== null, captions: edit.includeCaptions, cta: Boolean(ctaId), ctaFailed: Boolean(note) })
      return note
    })
  } finally {
    recomposing = null
    await rm(output, { force: true }).catch(() => undefined)
  }
}

export function cancelRemix(): boolean {
  if (pending) { pending.cancelled = true; return true }
  if (!active) return false
  const run = active
  if (run.cancelled) return true
  run.cancelled = true
  run.ctaAbort?.abort()
  run.status = { ...run.status, detail: 'Cancelling…' }
  notify(run.status)
  kill(run.child)
  // A download or upload in progress can ignore the polite stop; force it shortly after.
  setTimeout(() => { if (run.child) kill(run.child, true) }, 5000).unref()
  return true
}

export function stopRemixForQuit(): void {
  if (active) { active.cancelled = true; kill(active.child, true, true) }
  void dropWriters(null)
  if (recomposeChild) kill(recomposeChild, true, true)
  for (const child of taskChildren) kill(child, true, true)
}

/**
 * Save an edit to a take waiting for review (headline, lines, caption), held to
 * the same rules as making it. The Remix page shows it through the status.
 */
export function editRemixDraft(value: unknown): RemixDraft {
  const run = reviewing
  if (!run || run.status.phase !== 'review') throw new Error('There are no takes waiting for review.')
  const raw = (value ?? {}) as Record<string, unknown>
  const draft = run.status.drafts.find((item) => item.id === raw.id)
  if (!draft) throw new Error('That take is no longer in this review.')
  // Silent and screenshot takes have no spoken lines to change.
  const spoken = !headlineOnly(draft.format)
  const merged = {
    id: draft.id,
    headline: raw.headline ?? draft.headline, postCaption: raw.postCaption ?? draft.postCaption,
    intro: spoken ? raw.intro ?? draft.intro : draft.intro, close: spoken ? raw.close ?? draft.close : draft.close, beats: spoken ? raw.beats ?? draft.beats : draft.beats
  }
  const [edit] = parseRemixEdits([merged], new Set([draft.id]), headlineOnly(draft.format) ? new Set([draft.id]) : new Set())
  const next: RemixDraft = { ...draft, headline: edit.headline, intro: edit.intro, beats: edit.beats, close: edit.close, postCaption: edit.postCaption ?? draft.postCaption }
  const changed = next.headline !== draft.headline || next.intro !== draft.intro || next.close !== draft.close || next.postCaption !== draft.postCaption ||
    JSON.stringify(next.beats) !== JSON.stringify(draft.beats)
  if (!changed) return draft
  if (next.grade) next.grade = { ...next.grade, edited: true }
  run.status = { ...run.status, drafts: run.status.drafts.map((item) => item.id === draft.id ? next : item) }
  notify(run.status)
  return next
}
