import { app } from 'electron'
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { existsSync, lstatSync, realpathSync, statSync } from 'fs'
import { access, constants as fsConstants, copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile, type FileHandle } from 'fs/promises'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, sep } from 'path'
import { promisify } from 'util'
import { isAvatarId } from '../shared/avatars'
import { isCaptionPresetId } from '../shared/caption-presets'
import { headlineLookForEngine, parseHeadlineLook } from '../shared/headline-look'
import { audioAfter, parseRemixLookPatch, reviewLookOf } from '../shared/remix-review-look'
import { lookExtrasForEngine, parseImageHighlight } from '../shared/look-extras-engine'
import { parseLookExtras } from '../shared/look-extras'
import { parseCtaChoice } from '../shared/ctas'
import { parseAudioSkills } from '../shared/skills'
import { DEFAULT_PLANNER_MODEL, isReferenceId, parsePurpose } from '../shared/purpose'
import { referenceForRun } from './reference-image'
import { applyRunCta, applyRunCtaInLock, originalPath, readCta, withRunLock } from './ctas'
import {
  estimateRemixCost, isRemixAngle, isRemixHost, isRemixOrder, MAX_CTA_OFFER_CHARS, MAX_REMIXES, MAX_SOURCES, parseRemixDraft, parseRemixEdits, parseRemixOutput, remixEditProblem,
  headlineOnly, oneTake, clipFormat, MAX_IMAGE_TAKE_SECONDS, REMIX_IMAGE_EXTENSIONS, AVATAR_VOICE, DEFAULT_CAMERA, isRecordingPart, normalizeCtaKeyword, parseCameraSettings, partsFor, RECORDING_VIDEO_EXTENSIONS, remixSourceUrl, type RecordingPart, type RemixDraft, type RemixEdit, type RemixOutput, type RemixRecordings, type RemixRequest, type RemixStatus
} from '../shared/remix'
import { presetVoiceId, type Avatar } from '../shared/avatars'
import {
  DEFAULT_PAUSE_REACT, DEFAULT_PAUSE_SETTINGS, isPauseCaptions, isPauseLayout, parsePauseDetection, parsePauseEvents, parsePauseSettings, PAUSE_MAX_TRIM_SECONDS,
  PAUSE_REACT_MAX_SECONDS, timelineForEngine, timelineFromEvents, uploadTimeline, type PauseDetection, type PauseEvent, type PauseSettings, type PauseTimeline, type PauseView
} from '../shared/pause-react'
import { MOMENT_TAKE_MAX_SECONDS, NUDGED_MAX_MS, NUDGED_MIN_MS, momentBoundsProblem, parseMomentRanges } from '../shared/moment-take'
import {
  BROLL_MAX_BYTES, BROLL_MAX_ITEMS, brollKind, CLIP_MAX_SECONDS, CLIP_TAKE_MAX_SECONDS, parseBrollPlan, REACTION_LEAD_SECONDS, readBrollPlan,
  type BrollItem, type BrollShot, type BrollView
} from '../shared/react-templates'
import {
  engineLayout, isProofId, layoutFormat, MAX_PROOFS, parseExtrasPatch, parseLayoutChoice, PROOF_EXTENSIONS, PROOF_MAX_BYTES, SCREEN_EXTENSIONS, SCREEN_MAX_BYTES,
  type LayoutExtrasView, type ProofShot
} from '../shared/remix-layouts'
import { suggestTalkingPoints } from './moment-take'
import { estimateHeygenVideoUsd, HEYGEN_PRICES, heygenEngine, type HeygenAvatarLink } from '../shared/heygen'
import type { SpendProvider } from '../shared/spending'
import { isRemixGraphicFormat, parseRemixGraphics, reelGraphicSpec, remixGraphicFrame, drawableGraphics, type RemixGraphicContext } from '../shared/reel-graphics'
import type { GraphicJob } from './graphics-render'
import type { RemixChatFacts } from '../shared/remix-chat'

const DEFAULT_VOICE_NAME = 'Brian'
import { portraitPath, readAvatar, readReactions, voiceSamplePath } from './avatars'
import { logger } from './logger'
import { getBridgeRunnerPath, getEnginePath, resolvePythonPath, runtimeEnvironment, validatePython } from './pipeline-runner'
import { assertMediaPath, authorizeMedia } from './security'
import { getSettingsForBridge, loadSettings } from './settings-store'
import { brandMarkForRun, isBrandId, readBrandIdentity } from './brands'
import { resolveBinary } from './tools'
import { audioForEngine } from './music'

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
  /** Their clip then me / Moment + my take: the part of the take used (ms into it); a new recording starts whole. */
  trim?: { startMs: number; endMs: number }
}

interface RunContext {
  /** Me, on camera: each take's recordings (draft id → part → file in the run's .recordings folder). */
  recordings?: Map<number, Map<RecordingPart, RecordingFile>>
  request: RemixRequest
  /** The engine config shared by both phases. */
  config: Record<string, unknown>
  draftIds: Set<number>
  planCostUsd: number
  /** Why the reference image wasn't shown to the AI (said with the takes), when it wasn't. */
  referenceNote?: string
  /** An article-or-post remix is writing its headline from the recording (back to review afterwards). */
  writing?: boolean
  /** Recordings being saved or copied in right now: writing and making wait for them. */
  savingRecordings?: number
  /** Pause & react: the original's length and the member's adjustments to a phone recording's pauses. */
  pause?: { sourceSeconds: number; settings: PauseSettings }
  /** Moment + my take: finding another moment or talking points right now (one at a time). */
  momentWork?: boolean
  /** Moment + my take: the recordings a headline is being written from now, and those each take's hook text was written from. */
  writingTakes?: Map<number, RecordingFile>
  writtenTakes?: Map<number, RecordingFile>
  /** The engine finding another moment (it rewrites .work/plan.json): Discard stops it before removing the folder. */
  momentChild?: ChildProcess
  /** React, then my thoughts: the member's own b-roll (copied into the run's .broll), stock on or off, and the plan. */
  /** `adding`: room held for clips still being copied in (two adds at once can't pass the limit together). */
  broll?: { items: BrollItem[]; stock: boolean; plan: BrollShot[] | null; takeSeconds: number | null; adding?: number }
  /** Their clip, then me / React, then my thoughts: part 2's look (a screen recording, banner, circles) and proof
   * screenshots, copied into the run's .layout. `adding`: room held for screenshots still being copied in. */
  extras?: Omit<LayoutExtrasView, 'keyword' | 'format'> & { adding?: number }
  /** The brand's color when the run started (the zoom and other extras use it when the look changes in review). */
  brandColor?: string
}

/**
 * Avatar on camera on HeyGen: the lines being made now (canceling stops waiting for them), how many of those HeyGen
 * already accepted (and bills: it has no cancel), and what the finished ones were estimated at. `abandoned` is set
 * once the app stopped waiting for a video HeyGen had accepted, for whatever reason (cancel, the engine stopping,
 * a failed wait or download): HeyGen may still finish and bill it.
 */
interface HeygenRun { abort: AbortController; inFlight: number; waiting: number; made: number; usd: number; unpriced: boolean; abandoned?: boolean }

interface ActiveRemix { status: RemixStatus; child?: ChildProcess; cancelled: boolean; avatarId: string | null; context: RunContext; ctaAbort?: AbortController; heygen?: HeygenRun }

/**
 * Avatar on camera (HeyGen, Beta) for a Voiced take: HeyGen is reached from main (it holds the key), so the IPC layer
 * hands Remix these (./heygen-avatar's readyHeygenLink and renderHeygenTake). The engine asks for each spoken line
 * as it renders; see execute().
 */
export interface RemixHeygen {
  /** The avatar's HeyGen link once it can make videos; throws a plain message (no key, training, consent) otherwise. */
  ready: (avatarId: string, signal?: AbortSignal) => Promise<HeygenAvatarLink>
  render: (request: {
    avatarId: string; audioPath?: string | null; text?: string | null; voiceId?: string | null; outPath: string; signal?: AbortSignal
    onStatus?: (detail: string, fraction: number) => void; onStarted?: (videoId: string) => void; spendKind?: 'remix'; title?: string
  }) => Promise<{ videoId: string; path: string; seconds: number; estimatedUsd: number | null }>
}
let heygenApi: RemixHeygen | null = null
export function setRemixHeygen(api: RemixHeygen | null): void { heygenApi = api }
const NO_HEYGEN = 'Avatar on camera needs HeyGen, which isn’t available right now. Restart the app, or pick Avatar photo.'

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
  const FORMATS = ['silent', 'commentary', 'image', 'pause_react', 'moment_take', 'clip_then_me', 'react_thoughts']
  if (raw.format !== undefined && !FORMATS.includes(raw.format as string)) throw new Error('Choose the kind of remix.')
  const format = (raw.format ?? 'commentary') as RemixRequest['format']
  const image = format === 'image'
  // Their clip, then me / React, then my thoughts: one short video, you on camera (Pause & react's checks).
  const clip = clipFormat(format)
  const pause = format === 'pause_react' || clip
  // Moment + my take: one long video, up to three time ranges, you on camera.
  const momentTake = format === 'moment_take'
  if (pause && sources.length > 1) throw new Error('React to one video at a time.')
  if (momentTake && sources.length > 1) throw new Error('Use one long video at a time.')
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
  if (!image && !pause && !momentTake && !isRemixHost(raw.host)) throw new Error('Choose how your presenter appears.')
  // Lip-sync to our own voice isn't possible on OpenRouter yet: the avatar's photo presents instead.
  // A screenshot, a pause-and-react and a moment with your take are always you, on camera.
  // Avatar on camera is made on HeyGen for a Voiced take; a clip reaction with it uses the avatar's photo as before.
  const host = image || pause || momentTake ? 'camera' : raw.host === 'lipsync' && format !== 'commentary' ? 'still' : raw.host as RemixRequest['host']
  if (image && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to share this screenshot.')
  if (clip && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to use this video: your video plays it with its sound.')
  if (pause && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to use this video: Pause & react plays much of it.')
  if (momentTake && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to use this video: each video opens with a moment of it.')
  if (format === 'silent' && raw.clipRightsAck !== true) throw new Error('Confirm you’re allowed to use these clips: React to a clip plays much more of them.')
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
  if (pause && parsedCamera?.layout === 'greenscreen') throw new Error(`Choose “As filmed” or “Background removed” for ${format === 'clip_then_me' ? 'Their clip, then me' : format === 'react_thoughts' ? 'React, then my thoughts' : 'Pause & react'}.`)
  if (momentTake && parsedCamera?.layout === 'greenscreen') throw new Error('Choose “As filmed” or “Background removed” for Moment + my take.')
  // Over a screenshot, when you pause their video to talk, and in your take on a moment, your voice is always kept.
  const camera = parsedCamera && (image || pause || momentTake) ? { ...parsedCamera, talk: true } : parsedCamera
  const pauseChoice = format === 'pause_react' ? parsePauseChoice(raw.pause) : undefined
  if (!layoutFormat(format) && raw.layout !== undefined && raw.layout !== null) throw new Error('Choose the layout again.')
  const layoutChoice = layoutFormat(format) ? parseLayoutChoice(raw.layout, format, pauseChoice?.layout ?? null) : undefined
  const momentChoice = momentTake ? parseMomentChoice(raw.moment) : undefined
  const brandIdentityId = raw.brandIdentityId === null || raw.brandIdentityId === undefined ? null : raw.brandIdentityId
  if (brandIdentityId !== null && !isBrandId(brandIdentityId)) throw new Error('Choose a brand identity.')
  if (!image && !pause && !momentTake && (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > MAX_REMIXES)) throw new Error(`Make between 1 and ${MAX_REMIXES} remixes per video.`)
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
  if (raw.lookExtras !== undefined && raw.lookExtras !== null && !Array.isArray(raw.lookExtras)) throw new Error('Choose your extras again.')
  const lookExtras = parseLookExtras(raw.lookExtras)
  const ctaId = parseCtaChoice(raw.ctaId)
  if (raw.showHandle !== undefined && typeof raw.showHandle !== 'boolean') throw new Error('Choose whether to show your handle.')
  const imageHighlight = image ? parseImageHighlight(raw.imageHighlight) : undefined
  // Skills (music, voice cleanup) and "Say what it's for": checked here; the picture is found by its id in main.
  const audio = parseAudioSkills(raw)
  const purpose = parsePurpose(raw.purpose)
  if (raw.referenceImage !== undefined && raw.referenceImage !== null && !isReferenceId(raw.referenceImage)) throw new Error('Choose your reference image again.')
  return {
    sourceIsUrl: local.length === 0,
    request: {
      sources: sources.map((source, i) => urls[i] ?? source), creator: sources.length === 1 ? creator : '', angle: raw.angle, order,
      host, avatarId: avatarId as string | null, voice, brandIdentityId,
      count: image || pause ? 1 : momentChoice ? momentChoice.ranges.length : raw.count as number, captionPreset: raw.captionPreset, includeCaptions: raw.includeCaptions !== false, aiLabelAck: !onCamera,
      ctaKeyword, ctaOffer: ctaKeyword ? ctaOffer : '', format, clipRightsAck: format !== 'commentary',
      ...(headlineLook ? { headlineLook } : {}),
      ...(lookExtras.length ? { lookExtras } : {}),
      ...(ctaId ? { ctaId } : {}),
      ...(camera ? { camera } : {}),
      ...(raw.showHandle === true && brandIdentityId ? { showHandle: true } : {}),
      ...(pauseChoice ? { pause: pauseChoice } : {}),
      ...(layoutChoice ? { layout: layoutChoice } : {}),
      ...(momentChoice ? { moment: momentChoice } : {}),
      ...(imageHighlight ? { imageHighlight } : {}),
      ...audio,
      ...(purpose ? { purpose } : {}),
      ...(isReferenceId(raw.referenceImage) ? { referenceImage: raw.referenceImage } : {})
    }
  }
}

/** Moment + my take: the time ranges (checked again against the video's length once it's known) and the box option. */
function parseMomentChoice(value: unknown): NonNullable<RemixRequest['moment']> {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Add a time range, like 37:00 to 42:00.')
  if (raw.pip !== undefined && typeof raw.pip !== 'boolean') throw new Error('Choose whether the moment stays on screen while you talk.')
  return { ranges: parseMomentRanges(raw.ranges), pip: raw.pip === true }
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
    // Voice cleanup and music (a member's own track must still be in their music folder).
    const audio = audioForEngine(request, true)
    const silent = request.format === 'silent'
    const onCamera = request.host === 'camera'
    // Avatar on camera: a ready HeyGen avatar on the member's key (checked with HeyGen once if it wasn't ready).
    let heygenLink: HeygenAvatarLink | null = null
    if (request.host === 'lipsync') {
      if (!avatar?.heygen) throw new Error('Choose an avatar made with HeyGen for Avatar on camera (make one in Avatar Studio), or pick Avatar photo.')
      if (!heygenApi) throw new Error(NO_HEYGEN)
      heygenLink = await heygenApi.ready(request.avatarId as string)
    }
    // It speaks in its HeyGen voice when the avatar is set to (and its own voice is chosen here); otherwise it lip-syncs to the app's voice.
    const heygenVoice = Boolean(heygenLink && request.voice === AVATAR_VOICE && heygenLink.voice === 'heygen' && heygenLink.voiceId)
    if (request.moment && remixSourceUrl(request.sources[0]) === null) {
      // A file's length is known now: say which range is past its end before anything is fetched or paid for.
      const seconds = await mediaSecondsOf(request.sources[0])
      if (seconds > 0) parseMomentRanges(request.moment.ranges, seconds)
    }
    // Silent react uses neither the photo nor the voice: only the reaction clips. On camera: none of these.
    if (request.avatarId && request.host !== 'voice' && !silent && !onCamera) {
      photo = portraitPath(request.avatarId)
      if (!existsSync(photo)) throw new Error('That avatar’s photo is missing. Choose another avatar.')
    }
    const { preset, cloned } = silent || onCamera ? { preset: DEFAULT_VOICE_NAME.toLowerCase(), cloned: null } : remixVoice(request.voice, avatar)
    if (cloned && !existsSync(voiceSamplePath(request.avatarId as string))) throw new Error('This avatar’s cloned voice recording is missing. Clone it again in Avatar Studio, or pick a preset voice.')
    const clips = silent && !onCamera ? readReactions(request.avatarId as string) : []
    if (silent && !onCamera && !clips.length) throw new Error('Make this avatar’s reactions in Avatar Studio first (Reactions for React to a clip).')
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
    // "A look you like": kept in the run folder; shown to the writing model only when it can look at images.
    let reference: { send: string | null; note: string | null } = { send: null, note: null }
    if (request.referenceImage) {
      try { reference = await referenceForRun(request.referenceImage, folder, DEFAULT_PLANNER_MODEL) }
      catch (error) { reference = { send: null, note: `${(error as Error)?.message || 'Your reference image could not be used.'} The remix goes ahead without it.` } }
    }
    // Only now that the new run can start: it replaces takes waiting for review.
    if (reviewing) await discardRemix()
    await cleanupAbandoned(settings.outputDirectory, folder)
    if (pending.cancelled) { await rm(folder, { recursive: true, force: true }); throw new Error('Canceled before it started.') }
    const context: RunContext = {
      request, draftIds: new Set(), planCostUsd: 0, ...(reference.note ? { referenceNote: reference.note } : {}),
      ...(brand?.look?.color ? { brandColor: brand.look.color } : {}),
      config: {
        sources: image ? [] : request.sources, output_dir: folder,
        ...(imageCopy ? { image_source: { path: imageCopy, credit: request.creator, ...(request.imageHighlight ? { highlight: request.imageHighlight } : {}) } } : {}), angle: request.angle, order: request.order, count: request.count, host: request.host,
        voice: preset, voice_model: cloned ? 'fish-audio/s2.1-pro' : 'elevenlabs/eleven-v3', voice_reference: voiceReference,
        voice_transcript: cloned?.transcript ?? '', avatar_photo: request.format === 'silent' ? null : photo,
        format: request.format, reactions, reactions_ai: reactionsAi, brand_identity: brand?.text ?? '', brand_name: brand?.name ?? '', creator: request.creator,
        caption_preset: request.captionPreset, include_captions: request.includeCaptions,
        cta_keyword: request.ctaKeyword, cta_offer: request.ctaOffer,
        ...(request.purpose ? { purpose: request.purpose } : {}),
        ...(reference.send ? { reference_image: reference.send } : {}),
        ...(headlineLookForEngine(request.headlineLook) ? { headline_look: headlineLookForEngine(request.headlineLook) } : {}),
        // Their recorded call to action ends each video, so the presenter doesn't say one too.
        ...(request.ctaId ? { cta_clip: true } : {}),
        ...(brandMark ? { brand_mark: brandMark } : {}),
        ...lookExtrasForEngine(request.lookExtras, brand?.look?.color, request.headlineLook),
        ...(request.camera ? { camera_layout: request.camera.layout, camera_backdrop: request.camera.backdrop,
          camera_backdrop_color: request.camera.backdropColor, camera_talk: request.camera.talk } : {}),
        ...(request.pause ? { pause_layout: request.pause.layout, pause_captions: request.pause.captions } : {}),
        ...(request.layout ? { layout: engineLayout(request.layout) } : {}),
        ...(request.moment ? { moment_ranges: request.moment.ranges.map((range) => [range.startS, range.endS]), moment_pip: request.moment.pip } : {}),
        ...(heygenLink ? { presenter: 'heygen', heygen_voice: heygenVoice, heygen_usd_per_second: heygenUsdPerSecond(heygenLink) } : {}),
        ...(audio ? { audio } : {})
      }
    }
    const run: ActiveRemix = {
      cancelled: false, avatarId: request.avatarId, context,
      status: {
        id: randomBytes(6).toString('hex'), phase: 'planning', detail: 'Starting', percent: 1, folder,
        ...(request.host === 'camera' ? { onCamera: true, cameraTalk: request.camera?.talk === true, ...(request.camera ? { cameraLayout: request.camera.layout } : {}) } : {}),
        ...(request.pause ? { pauseLayout: request.pause.layout } : {}),
        ...(remixGraphicContext(request) ? { graphics: remixGraphicContext(request)! } : {}),
        ...(request.host === 'camera' ? { look: reviewLookOf(request) } : {}),
        estimateUsd: request.moment ? momentEstimate(request.moment.ranges).total
          : estimateRemixCost(request.host, request.count * request.sources.length, 0.5, request.format).total,
        drafts: [], outputs: [], costUsd: null, warnings: reference.note ? [reference.note] : [], error: null
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

/** HeyGen's published price per second for this avatar's engine, or null when HeyGen bills it at a price the app doesn't keep. */
function heygenUsdPerSecond(link: HeygenAvatarLink): number | null {
  return estimateHeygenVideoUsd(1, heygenEngine(link.engines)) === null ? null : HEYGEN_PRICES.avatarIvPerSecond
}

/**
 * The spending check before making the approved takes: their estimates (with the avatar's HeyGen lines at HeyGen's
 * published price when Avatar on camera is chosen; null when HeyGen's price for it isn't known), for the monthly
 * limit. HeyGen speaking in its own voice bills mostly HeyGen; otherwise mostly OpenRouter (the voice), and only
 * OpenRouter's share (`openrouterUsd`) is compared with the OpenRouter balance.
 */
export function remixRenderCheck(edits: unknown): { provider: SpendProvider; estimateUsd: number | null; openrouterUsd?: number | null } {
  const run = reviewing
  const ids = new Set(Array.isArray(edits) ? edits.map((edit) => (edit as { id?: unknown } | null)?.id) : [])
  const chosen = (run?.status.drafts ?? []).filter((draft) => ids.has(draft.id))
  const total = chosen.reduce((sum, draft) => sum + draft.estimateUsd, 0)
  const config = run?.context.config
  if (config?.presenter !== 'heygen') return { provider: 'openrouter', estimateUsd: total > 0 ? total : null }
  const priced = config.heygen_usd_per_second !== null && chosen.every((draft) => draft.heygenEstimateUsd !== null)
  // The HeyGen share: the engine's figure for each take, or (older drafts) none known.
  const heygenShare = chosen.reduce((sum, draft) => sum + (draft.heygenEstimateUsd ?? 0), 0)
  const openrouter = Math.max(0, total - heygenShare)
  return {
    provider: config.heygen_voice === true ? 'heygen' : 'openrouter',
    estimateUsd: priced && total > 0 ? total : null,
    openrouterUsd: openrouter > 0 ? Math.round(openrouter * 10_000) / 10_000 : null
  }
}

/** The spending check's estimate for starting a remix (the Remix page and the chat use the same one), or null. */
export function remixStartEstimate(request: unknown): number | null {
  const raw = (request ?? {}) as Record<string, unknown>
  if (raw.format === 'image' || raw.format === 'pause_react' || raw.format === 'clip_then_me' || raw.format === 'react_thoughts') return estimateRemixCost('camera', 1, 0, raw.format).total
  if (raw.format === 'moment_take') return momentEstimate(parseMomentRanges((raw.moment as { ranges?: unknown } | undefined)?.ranges)).total
  const sources = Array.isArray(raw.sources) ? Math.max(1, raw.sources.length) : 1
  const count = typeof raw.count === 'number' && Number.isInteger(raw.count) && raw.count >= 1 && raw.count <= MAX_REMIXES ? raw.count : null
  if (!isRemixHost(raw.host) || count === null) return null
  return estimateRemixCost(raw.host, count * sources, 0.5, raw.format === 'silent' ? 'silent' : 'commentary').total
}

/** Moment + my take: transcribing the ranges and picking a moment in each, then one writing call per video. */
export function momentEstimate(ranges: { startS: number; endS: number }[]): ReturnType<typeof estimateRemixCost> {
  const hours = ranges.reduce((sum, range) => sum + Math.max(0, range.endS - range.startS), 0) / 3600
  return estimateRemixCost('camera', ranges.length, hours, 'moment_take')
}

/** The one take of an article-or-post remix, before its headline is written. */
function imageDraft(credit: string): RemixDraft {
  return {
    id: 0, sourceIndex: 0, sourceTitle: credit, creator: credit, startMs: 0, endMs: 0, quote: '', why: '', style: 'reaction', stance: 'add_nuance',
    headline: '', intro: '', beats: [], close: '', notes: [], grade: null, estimateUsd: estimateRemixCost('camera', 1, 0, 'image').perRemixHigh,
    postCaption: '', format: 'image', cues: []
  }
}

/**
 * Write the headline and caption from the recorded take, then back to review (article or post, Pause & react).
 * Moment + my take: for the recorded takes in `draftIds` (all recorded ones when not given), one writing call each.
 */
export async function writeRemix(draftIds?: unknown): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  const run = reviewing
  if (!run || run.status.phase !== 'review' || !oneTake(run.context.request.format)) throw new Error('There is no take waiting for its headline.')
  if (recordingInProgress(run)) throw new Error('Wait for your recording to finish saving.')
  if (run.context.momentWork) throw new Error('Wait for the moment or talking points you asked for, then make your videos.')
  const momentTake = run.context.request.format === 'moment_take'
  const recorded = run.status.drafts.filter((draft) => run.context.recordings?.get(draft.id)?.get('reaction')).map((draft) => draft.id)
  const ids = momentTake ? [...new Set(Array.isArray(draftIds) ? draftIds.filter((id): id is number => typeof id === 'number' && recorded.includes(id)) : recorded)] : [0]
  if (run.context.request.format === 'react_thoughts' && !run.context.recordings?.get(0)?.get('thoughts')) throw new Error('Record both parts first.')
  if (!momentTake && !recorded.includes(0)) throw new Error('Record your take first.')
  if (!ids.length) throw new Error('Record your take first.')
  const recordings = engineRecordings(run, ids.map((id) => ({ id, beats: [] })))
  run.context.writingTakes = new Map(ids.flatMap((id) => { const file = run.context.recordings?.get(id)?.get('reaction'); return file ? [[id, file] as const] : [] }))
  reviewing = null
  active = run
  run.cancelled = false
  run.context.writing = true
  run.status = { ...run.status, phase: 'planning', detail: 'Writing your headline and caption from what you said', percent: 5, error: null }
  notify(run.status)
  launch(run, { ...run.context.config, mode: 'write', recordings, ...(momentTake ? { write_ids: ids } : {}), ...clipConfig(run) })
  return run.status
}

/** Render the drafts the user approved (with their edits). */
/** What decides where graphics go on this run's videos (null: the format has no member's part for graphics). */
export function remixGraphicContext(request: RemixRequest): RemixGraphicContext | null {
  if (request.host !== 'camera' || !isRemixGraphicFormat(request.format)) return null
  return {
    format: request.format, pauseLayout: request.pause?.layout ?? 'box', hookAt: request.layout?.hookAt ?? 'top',
    headlineLook: request.headlineLook ?? null, includeCaptions: request.includeCaptions, momentPip: request.moment?.pip === true
  }
}

/** How long the member's part is for a take (ms): their take as recorded, or (Pause & react) the video. Null when not recorded. */
function memberPartMs(run: ActiveRemix, draft: RemixDraft): number | null {
  const takes = run.context.recordings?.get(draft.id)
  if (draft.format === 'pause_react') {
    if (!takes?.get('reaction')) return null
    const timeline = pauseTimeline(run, draft.id)
    return Math.round((timeline.end - timeline.start) * 1000)
  }
  const file = takes?.get(draft.format === 'react_thoughts' ? 'thoughts' : 'reaction')
  return file?.seconds ? Math.round(file.seconds * 1000) : null
}

/**
 * The member's graphics for the takes being made, checked and drawn (offscreen, cached in the run's
 * .graphics/reel/): what the engine lays over each finished video, by draft id.
 */
async function drawRemixGraphics(run: ActiveRemix, edits: RemixEdit[], value: unknown): Promise<Record<string, { file: string; at_ms: number; duration_ms: number }[]>> {
  const context = remixGraphicContext(run.context.request)
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Your graphics could not be read. Try again.')
  const entries = Object.entries(value as Record<string, unknown>).filter(([, list]) => Array.isArray(list) && list.length)
  if (!entries.length) return {}
  if (!context) throw new Error('Graphics can be added to on-camera remixes only.')
  const { graphicJob, renderGraphicJobs, REEL_GRAPHICS_DIR } = await import('./graphics-render')
  const out: Record<string, { file: string; at_ms: number; duration_ms: number }[]> = {}
  const banner = Boolean(run.context.extras?.banner && run.context.request.ctaKeyword)
  for (const [key, list] of entries) {
    const edit = edits.find((item) => String(item.id) === key)
    if (!edit) continue
    const draft = run.status.drafts.find((item) => item.id === edit.id)
    if (!draft || !isRemixGraphicFormat(draft.format)) continue
    let graphics
    try { graphics = drawableGraphics(parseRemixGraphics(list, draft.format, memberPartMs(run, draft))) } catch (error) { throw new Error(`Check your graphics: ${(error as Error).message}`) }
    if (!graphics.length) continue
    const frame = remixGraphicFrame(context, edit.headline, banner)
    const jobs = graphics.flatMap((g): GraphicJob[] => {
      const job = graphicJob(run.status.folder, g.id, reelGraphicSpec(g, frame, g.duration_ms, context.headlineLook), { start_ms: g.at_ms, duration_ms: g.duration_ms })
      return job ? [job] : []
    })
    let drawn
    try { drawn = await renderGraphicJobs(run.status.folder, jobs, () => run.cancelled, REEL_GRAPHICS_DIR) } catch (error) {
      logger.warn('remix.graphics.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
      throw new Error('Your graphics could not be drawn. Try again, or remove a graphic and make the video again.')
    }
    out[key] = drawn.map((item) => ({ file: item.file, at_ms: item.start_ms, duration_ms: item.duration_ms }))
  }
  return out
}

export async function renderRemix(value: unknown, graphicsValue?: unknown): Promise<RemixStatus> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  const run = reviewing
  if (!run || run.status.phase !== 'review') throw new Error('There is nothing waiting for review. Plan the remixes again.')
  // Another moment or talking points still coming: the take it changes (and the saved plan) must not move under the render.
  if (run.context.momentWork) throw new Error('Wait for the moment or talking points you asked for, then make your videos.')
  const edits = parseRemixEdits(value, run.context.draftIds, new Set(run.status.drafts.filter((draft) => headlineOnly(draft.format)).map((draft) => draft.id)))
  if (recordingInProgress(run)) throw new Error('Wait for your recording to finish saving.')
  const recordings = run.context.request.host === 'camera' ? engineRecordings(run, edits) : null
  // The member's graphics are drawn first (nothing else can start meanwhile); the engine lays them over each video.
  let graphics: Awaited<ReturnType<typeof drawRemixGraphics>> = {}
  if (graphicsValue !== undefined && graphicsValue !== null) {
    starting = true
    try { graphics = await drawRemixGraphics(run, edits, graphicsValue) } finally { starting = false }
    if (reviewing !== run || run.status.phase !== 'review') throw new Error('This review was closed, so the videos weren’t made.')
  }
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
  // Moment + my take: the moment as the member left it (nudged or not).
  const approved = edits.map((edit) => {
    const draft = run.status.drafts.find((item) => item.id === edit.id)
    return draft?.format === 'moment_take' ? { ...edit, start_ms: Math.round(draft.startMs), end_ms: Math.round(draft.endMs) } : edit
  })
  launch(run, { ...run.context.config, mode: 'render', approved, ...(recordings ? { recordings } : {}), ...clipConfig(run, true),
    ...(Object.keys(graphics).length ? { graphics } : {}) })
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
      await rm(join(folder, '.broll'), { recursive: true, force: true })
      await rm(join(folder, '.layout'), { recursive: true, force: true })
      // Drawn graphics are only kept for videos that were made (re-makes from the Library use them).
      if (!existsSync(join(folder, 'job_output.json'))) await rm(join(folder, '.graphics'), { recursive: true, force: true })
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
  await stopMomentChild(run)
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

/** What an engine line says was paid (a success or a failure line), or 0. */
function paidUsd(line: Record<string, unknown> | null | undefined): number {
  const cost = line?.cost_usd
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 && cost < 1e6 ? cost : 0
}

/** An error that says what was paid before it (an engine failure line, or a model answer that couldn't be used). */
function paidError(message: string, costUsd: number): Error & { costUsd: number } {
  return Object.assign(new Error(message), { costUsd })
}

/** What a failed call paid, from the error it threw (0 when it says nothing). */
function errorCost(error: unknown): number {
  const cost = error && typeof error === 'object' ? (error as { costUsd?: unknown }).costUsd : undefined
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 && cost < 1e6 ? cost : 0
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
  // Avatar on camera: the engine asks for each spoken line on stdout, and the answer goes back on stdin.
  const heygen = config.presenter === 'heygen' && config.mode === 'render'
  if (heygen) run.heygen = { abort: new AbortController(), inFlight: 0, waiting: 0, made: 0, usd: 0, unpriced: false }
  const answer = (message: Record<string, unknown>): void => {
    if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n')
  }
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
        } else if (message.type === 'heygen' && heygen) {
          void heygenLine(run, message).then(answer)
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
    // The engine stopped (finished, failed or canceled): lines still in flight on HeyGen are no longer waited for.
    if (heygen) { child.stdin.end(); if (run.heygen) stopWaitingForHeygen(run.heygen) }
    if (!running(run)) return
    if (run.context.writing) {
      run.context.writing = false
      // What the writing calls cost, written or not (a failure line carries it too): it goes to the run and so to the ledger.
      const written = paidUsd(result)
      run.context.planCostUsd += written
      // Cancelled before the headline arrived: back to review as it was (a headline that already arrived is kept: it's paid for).
      if (run.cancelled && result?.ok !== true) { finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, costUsd: run.context.planCostUsd }); return }
      const momentTake = request.format === 'moment_take'
      const drafts = result?.ok === true && Array.isArray(result.drafts) ? result.drafts.map(parseRemixDraft)
        .filter((item): item is RemixDraft => item !== null && (momentTake ? run.context.draftIds.has(item.id) : item.id === 0)) : []
      if (drafts.length && momentTake) {
        logger.info('remix.written', { cost: written, takes: drafts.length })
        // Making these takes reuses the words heard now (until one is recorded again).
        const writtenTakes = run.context.writtenTakes ??= new Map()
        for (const take of drafts) { const file = run.context.writingTakes?.get(take.id); if (file) writtenTakes.set(take.id, file) }
        // The moment stays as the member left it; the hook text, caption and what they said are new.
        const merged = run.status.drafts.map((current) => {
          const take = drafts.find((item) => item.id === current.id)
          return take ? { ...current, headline: take.headline, postCaption: take.postCaption, notes: take.notes,
            ...(current.moment ? { moment: { ...current.moment, said: take.moment?.said ?? '' } } : {}) } : current
        })
        // A take that couldn't be written (no speech heard, say) is named here; the others are written.
        const missed = (Array.isArray(result?.warnings) ? result.warnings : []).filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 300)).slice(0, 3)
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, drafts: merged, costUsd: run.context.planCostUsd, error: missed.length ? missed.join(' ') : null })
      } else if (drafts.length) {
        logger.info('remix.written', { cost: written })
        const kept = run.status.drafts[0]
        // Pause & react and the clip formats: the part of their video stays as the member chose it.
        const take = (request.format === 'pause_react' || clipFormat(request.format)) && kept
          ? { ...drafts[0], format: request.format, startMs: kept.startMs, endMs: kept.endMs } : { ...drafts[0], format: 'image' as const }
        if (run.context.broll && result) takeBrollPlan(run, result)
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, drafts: [take], costUsd: run.context.planCostUsd, error: null })
      } else {
        logger.warn('remix.write.failed', { stderr: stderr.slice(-1500) })
        const message = typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : 'The headline could not be written. Try again, or type your own headline.'
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, error: message, costUsd: run.context.planCostUsd })
      }
      return
    }
    const planning = run.status.phase === 'planning'
    // A failed or canceled run still paid for the calls it made before stopping (the failure line says what).
    const spent = result?.ok === true ? 0 : paidUsd(result)
    if (run.cancelled) {
      if (planning) await rm(run.status.folder, { recursive: true, force: true }).catch(() => undefined)
      else for (const copy of ['.presenter.jpg', '.voice.mp3', '.reactions', '.recordings', '.broll', '.layout']) await rm(join(run.status.folder, copy), { recursive: true, force: true }).catch(() => undefined)
      // HeyGen has no cancel: a video it had started may still finish there and be billed.
      const notes = heygenWarnings(run)
      finish(run, { phase: 'cancelled', detail: planning ? 'Canceled while planning' : 'Canceled', ...(spent > 0 ? { costUsd: (planning ? 0 : run.context.planCostUsd) + spent } : {}),
        ...(notes.length ? { warnings: notes } : {}) })
      return
    }
    const warnings = Array.isArray(result?.warnings) ? result.warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 400)).slice(0, 12) : []
    warnings.push(...heygenWarnings(run))
    const cost = typeof result?.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? result.cost_usd : null
    if (result?.ok === true && planning) {
      const drafts = (Array.isArray(result.drafts) ? result.drafts : []).map(parseRemixDraft).filter((item): item is RemixDraft => item !== null)
      run.context.draftIds = new Set(drafts.map((draft) => draft.id))
      run.context.planCostUsd = cost ?? 0
      if (request.format === 'pause_react' || clipFormat(request.format)) {
        const seconds = typeof result.source_seconds === 'number' && Number.isFinite(result.source_seconds) && result.source_seconds > 0 ? result.source_seconds : (drafts[0]?.endMs ?? 0) / 1000
        run.context.pause = { sourceSeconds: seconds, settings: DEFAULT_PAUSE_SETTINGS }
        if (request.format === 'react_thoughts') run.context.broll = { items: [], stock: false, plan: null, takeSeconds: null }
        if (clipFormat(request.format)) run.context.extras = { part2: 'camera', screen: null, banner: false, circles: [], proofs: [] }
      }
      logger.info('remix.planned', { drafts: drafts.length, cost })
      finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, drafts, warnings: [...warnings, ...(run.context.referenceNote ? [run.context.referenceNote] : []), ...await varietyWarnings(drafts)], costUsd: cost })
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
          if (cancelled) warnings.push('Canceled while adding your call to action: the videos are made, and some end without it. Add it from the Library (⋯ → Add call to action).')
          if (failed.length) warnings.push(`The call to action could not be added to ${failed.length} video${failed.length === 1 ? '' : 's'}. Add it from the Library (⋯ → Add call to action).`)
          outputs = await withCtaDurations(run.status.folder, outputs)
        } catch {
          // The videos are made; the member adds a call to action from the Library (the run's own may have been deleted).
          warnings.push('Your call to action couldn’t be added to these videos (it may have been removed from your library). Add one from the Library (⋯ → Add call to action).')
        }
      }
      await recordCreators(outputs.map((output) => output.creator))
      for (const copy of ['.presenter.jpg', '.voice.mp3', '.reactions', '.recordings', '.broll', '.layout']) await rm(join(run.status.folder, copy), { recursive: true, force: true }).catch(() => undefined)
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
      // What was paid before the failure is kept on the run (and so reaches the ledger).
      if (!planning) run.context.planCostUsd += spent
      const costUsd = planning ? (spent > 0 ? spent : null) : run.context.planCostUsd
      // Nothing was made but the plan is still there: back to review to retry without planning (and paying) again.
      if (!planning && (request.format === 'image' || existsSync(join(run.status.folder, '.work', 'plan.json')))) {
        finish(run, { phase: 'review', detail: 'Ready for review', percent: 100, error: message, warnings, costUsd })
        return
      }
      finish(run, { phase: 'failed', error: message, costUsd, ...(warnings.length ? { warnings } : {}) })
    }
  }
  child.stdin.on('error', () => undefined)
  // One line; with HeyGen lines to make, stdin stays open for their answers (closed when the engine ends).
  if (heygen) child.stdin.write(JSON.stringify(config) + '\n')
  else child.stdin.end(JSON.stringify(config))
}

/** A path the engine named inside the run folder (an existing file, or a new file's folder), or null. */
function inRunFolder(folder: string, path: unknown, existing: boolean): string | null {
  if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0')) return null
  try {
    const real = existing ? realpathSync(path) : join(realpathSync(dirname(path)), basename(path))
    const rel = relative(realpathSync(folder), real)
    return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('../') ? real : null
  } catch { return null }
}

/** Errors that would repeat for every line and take: the remaining ones aren't tried. */
const HEYGEN_STOP_ALL = /key|balance|credit|consent|training|could not make this avatar|isn’t available/i

/**
 * One spoken line of a Voiced take made on HeyGen for the engine: lip-synced to the engine's voice file, or the line's
 * text in the avatar's HeyGen voice. Progress shows HeyGen's status; the cost goes to the spending ledger (estimated at
 * HeyGen's published price) as it's made. Answers {type: 'heygen_result', id, ok, path} or ok false with a plain error.
 */
async function heygenLine(run: ActiveRemix, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = message.id
  const fail = (error: string): Record<string, unknown> => ({ type: 'heygen_result', id, ok: false, error, stop_all: HEYGEN_STOP_ALL.test(error) })
  const state = run.heygen
  if (typeof id !== 'number' || !Number.isInteger(id) || !state) return fail('That line could not be sent to HeyGen.')
  const config = run.context.config
  const folder = run.status.folder
  const outPath = inRunFolder(join(folder, '.work'), message.out, false)
  const text = typeof message.text === 'string' ? message.text.replace(/\s+/g, ' ').trim() : ''
  const audioPath = message.audio === null || message.audio === undefined ? null : inRunFolder(folder, message.audio, true)
  const label = typeof message.label === 'string' ? message.label.replace(/[^\p{L}\p{N} ,.'’-]/gu, '').slice(0, 80) : 'Your avatar'
  if (!outPath || !outPath.endsWith('.mp4') || (message.audio != null && !audioPath)) return fail('That line could not be sent to HeyGen.')
  const heygenVoice = config.heygen_voice === true
  if (heygenVoice ? !text || text.length > 5000 : !audioPath) return fail('That line could not be sent to HeyGen.')
  if (!heygenApi || !run.avatarId) return fail(NO_HEYGEN)
  if (run.cancelled) return fail('Canceled.')
  state.inFlight += 1
  let started = false
  try {
    const made = await heygenApi.render({
      avatarId: run.avatarId, outPath, signal: state.abort.signal, spendKind: 'remix', title: `CreatorClips remix: ${label}`.slice(0, 100),
      ...(heygenVoice ? { text } : { audioPath }),
      onStatus: (detail) => { if (!run.cancelled) publish(run, { detail: `${label}: ${detail}`.slice(0, 160) }) },
      onStarted: () => { if (!started) { started = true; state.waiting += 1 } }
    })
    state.made += 1
    if (made.estimatedUsd === null) state.unpriced = true
    else state.usd += made.estimatedUsd
    logger.info('remix.heygen.line', { seconds: Math.round(made.seconds) })
    return { type: 'heygen_result', id, ok: true, path: outPath }
  } catch (error) {
    // HeyGen had accepted this video and the app stopped waiting for it (unless HeyGen itself said it failed): it may still bill it.
    if (started && (error as { videoFailed?: unknown } | null)?.videoFailed !== true) state.abandoned = true
    if (run.cancelled) return fail('Canceled.')
    const message = (error as { message?: unknown } | null)?.message
    const reason = typeof message === 'string' && message ? message.slice(0, 300) : 'HeyGen could not make this video. Try again.'
    logger.warn('remix.heygen.failed', { message: reason.slice(0, 120) })
    return fail(reason)
  } finally {
    state.inFlight -= 1
    if (started) state.waiting -= 1
  }
}

/** Stop waiting for HeyGen's lines; any it had already accepted may still finish and be billed there. */
function stopWaitingForHeygen(state: HeygenRun): void {
  if (state.waiting > 0) state.abandoned = true
  state.abort.abort()
}

/** The HeyGen notes for a finished, failed or canceled run: what was made, and a warning when waiting was stopped. */
function heygenWarnings(run: ActiveRemix): string[] {
  return [heygenNote(run), run.heygen?.abandoned ? HEYGEN_STILL_BILLING : null].filter((note): note is string => Boolean(note))
}
const HEYGEN_STILL_BILLING = 'HeyGen may still finish an avatar video it had already started and bill it on your HeyGen account.'

/** What the HeyGen part of a run cost, for the finished (or failed) run's notes; null when nothing was made. */
function heygenNote(run: ActiveRemix): string | null {
  const state = run.heygen
  if (!state || !state.made) return null
  const lines = `${state.made} avatar video${state.made === 1 ? '' : 's'}`
  return state.unpriced
    ? `HeyGen made ${lines} for these remixes, billed on your HeyGen account.`
    : `HeyGen made ${lines} for these remixes: about $${state.usd.toFixed(2)} on your HeyGen account (estimated at HeyGen’s published price, and recorded in Spending).`
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
  const takeFormat = writer.run.status.drafts.find((draft) => draft.id === writer.draftId)?.format
  const pauseTake = takeFormat === 'pause_react'
  // Pause & react and a take on a moment: webcam recordings often have no length in their header.
  const timedTake = pauseTake || takeFormat === 'moment_take' || (takeFormat !== undefined && clipFormat(takeFormat))
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
    const seconds = (timedTake ? await recordingSecondsOf(writer.file) : await mediaSecondsOf(writer.file)) || measured
    if (writer.bytes < 1000) { await rm(writer.file, { force: true }); throw new Error('Nothing was recorded. Check your camera and microphone, then try again.') }
    if (timedTake && seconds < 1) { await rm(writer.file, { force: true }); throw new Error('That recording is too short. Record your reaction again.') }
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
    // Their clip, then me / React, then my thoughts: your take (or thoughts) up to three minutes; a phone video of you
    // watching their clip as long as it, plus a minute to settle in.
    const clipLimit = checked.draft.format === 'react_thoughts' && checked.part === 'reaction'
      ? (checked.draft.endMs - checked.draft.startMs) / 1000 + REACTION_LEAD_SECONDS : CLIP_TAKE_MAX_SECONDS
    if (clipFormat(checked.draft.format) && seconds > clipLimit + 1) {
      await rm(file, { force: true })
      throw new Error(checked.part === 'reaction' && checked.draft.format === 'react_thoughts'
        ? 'That video is much longer than their clip. Trim it on your phone to you watching their clip, then upload it again.'
        : `Keep your take to ${CLIP_TAKE_MAX_SECONDS / 60} minutes. Trim it on your phone, then upload it again.`)
    }
    if (checked.draft.format === 'moment_take' && seconds > MOMENT_TAKE_MAX_SECONDS + 1) {
      await rm(file, { force: true })
      throw new Error(`Keep your take to ${MOMENT_TAKE_MAX_SECONDS / 60} minutes. Trim it on your phone, then upload it again.`)
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

type TimedWords = [string, number, number][]
/** Words saved in plan.json as [word, start_ms, end_ms] (or as transcript word objects), checked. */
function timedWords(value: unknown, limit = 4000): TimedWords | null {
  if (!Array.isArray(value)) return null
  const out: TimedWords = []
  for (const item of value.slice(0, limit)) {
    const w = Array.isArray(item) ? { word: item[0], a: item[1], b: item[2] } : item && typeof item === 'object' ? { word: (item as Record<string, unknown>).word, a: (item as Record<string, unknown>).start_time_ms, b: (item as Record<string, unknown>).end_time_ms } : null
    if (w && typeof w.word === 'string' && typeof w.a === 'number' && typeof w.b === 'number' && Number.isFinite(w.a) && Number.isFinite(w.b)) out.push([w.word.slice(0, 60), Math.round(w.a), Math.round(w.b)])
  }
  return out
}

/**
 * What the review's Chat panel needs about a take: the facts its tools check against (the part of their video, the
 * take and its trim, the box and banner) and the words saved when the hook text was written (the member's, and
 * theirs around the part used).
 */
export async function remixChatFacts(draftId: unknown): Promise<{ facts: RemixChatFacts; words: { take: TimedWords | null; theirs: TimedWords | null; quote: string }; runId: string; folder: string }> {
  const run = reviewRun()
  const draft = run.status.drafts.find((item) => item.id === draftId)
  if (!draft) throw new Error('That take is no longer in this review.')
  if (!isRemixGraphicFormat(draft.format)) throw new Error('The chat works with on-camera remixes (Their clip then me, React then my thoughts, Pause & react and Moment + my take).')
  const format = draft.format
  const request = run.context.request
  const sourceMs = Math.round((run.context.pause?.sourceSeconds ?? 0) * 1000)
  let theirClip: RemixChatFacts['theirClip'] = null
  let theirClipNote: string | undefined
  if (format === 'moment_take' && draft.moment) {
    theirClip = { startMs: Math.round(draft.startMs), endMs: Math.round(draft.endMs), minMs: NUDGED_MIN_MS, maxMs: NUDGED_MAX_MS, limitStartMs: draft.moment.rangeStartMs, limitEndMs: draft.moment.rangeEndMs }
  } else if (format === 'pause_react' || format === 'clip_then_me') {
    theirClip = { startMs: Math.round(draft.startMs), endMs: Math.round(draft.endMs), minMs: 1000, maxMs: (format === 'clip_then_me' ? CLIP_MAX_SECONDS : PAUSE_MAX_TRIM_SECONDS) * 1000,
      limitStartMs: 0, limitEndMs: Math.max(Math.round(draft.endMs), sourceMs) }
  } else theirClipNote = 'part 1 was filmed while their clip played, so changing it means recording part 1 again. Change it in step 1 of the review.'
  const file = run.context.recordings?.get(draft.id)?.get(format === 'react_thoughts' ? 'thoughts' : 'reaction')
  const extras = run.context.extras
  const facts: RemixChatFacts = {
    format, theirClip, ...(theirClipNote ? { theirClipNote } : {}),
    takeMs: memberPartMs(run, draft), takeTrim: file?.trim ? { ...file.trim } : null, trimmable: format === 'clip_then_me' || format === 'moment_take',
    boxAt: format === 'react_thoughts' && request.layout?.part1 !== 'phone' ? extras?.boxAt ?? 'auto' : null,
    banner: format === 'react_thoughts' ? Boolean(extras?.banner) : null, keyword: request.ctaKeyword
  }
  let take: TimedWords | null = null, theirs: TimedWords | null = null
  try {
    const path = join(run.status.folder, '.work', 'plan.json')
    const info = await stat(path)
    if (info.isFile() && info.size < 32 * 1024 * 1024) {
      const plan = JSON.parse(await readFile(path, 'utf8')) as { scripts?: Record<string, unknown>[]; sources?: { meta?: { member?: { words?: unknown } }; segments?: { start_time_ms?: unknown; end_time_ms?: unknown; words?: unknown }[] }[] }
      const script = plan.scripts?.[draft.id] as { member?: { words?: unknown }; clip?: { words?: unknown }; source_index?: unknown } | undefined
      take = timedWords(format === 'pause_react' ? plan.sources?.[0]?.meta?.member?.words : script?.member?.words)
      theirs = timedWords(script?.clip?.words)
      if (!theirs?.length) {
        const source = plan.sources?.[typeof script?.source_index === 'number' ? script.source_index : 0]
        const from = draft.startMs - 30_000, to = draft.endMs + 30_000
        theirs = timedWords((source?.segments ?? []).filter((seg) => typeof seg.start_time_ms === 'number' && typeof seg.end_time_ms === 'number' && seg.end_time_ms >= from && seg.start_time_ms <= to)
          .flatMap((seg) => Array.isArray(seg.words) ? seg.words : []), 3000)
      }
    }
  } catch { /* no words saved yet */ }
  return { facts, words: { take, theirs, quote: draft.quote }, runId: run.status.id, folder: run.status.folder }
}

/**
 * The review's look and skills for this video (you on camera): captions and their style, the hook text look, zoom,
 * music and voice cleanup. Free; the video is made with them (and a hook text written next uses them too).
 */
export function setRemixLook(value: unknown): RemixStatus {
  const run = reviewRun()
  const patch = parseRemixLookPatch(value)
  const before = run.context.request
  const audio = audioAfter(before, patch)
  const request: RemixRequest = {
    ...before,
    ...(patch.includeCaptions !== undefined ? { includeCaptions: patch.includeCaptions } : {}),
    ...(patch.captionPreset !== undefined ? { captionPreset: patch.captionPreset } : {}),
    ...(patch.headlineLook ? { headlineLook: patch.headlineLook } : {}),
    ...(patch.lookExtras ? { lookExtras: patch.lookExtras } : {})
  }
  delete request.music; delete request.musicTrack; delete request.voiceCleanup
  Object.assign(request, audio)
  if (request.lookExtras && !request.lookExtras.length) delete request.lookExtras
  // Checked before anything changes (a track of the member's own must still be in their music folder).
  const engineAudio = audioForEngine(request, true)
  const config: Record<string, unknown> = { ...run.context.config, caption_preset: request.captionPreset, include_captions: request.includeCaptions }
  delete config.headline_look; delete config.look_extras; delete config.look_extras_color; delete config.audio
  const headline = headlineLookForEngine(request.headlineLook)
  Object.assign(config, headline ? { headline_look: headline } : {}, lookExtrasForEngine(request.lookExtras, run.context.brandColor, request.headlineLook), engineAudio ? { audio: engineAudio } : {})
  run.context.request = request
  run.context.config = config
  const graphics = remixGraphicContext(request)
  run.status = { ...run.status, look: reviewLookOf(request), ...(graphics ? { graphics } : {}) }
  logger.info('remix.look', { captions: request.includeCaptions, hook: request.headlineLook?.look ?? null, zoom: Boolean(request.lookExtras?.includes('punch_zoom')), music: request.music === true, cleanup: request.voiceCleanup === true })
  notify(run.status)
  return run.status
}

/** The shortest part of a take that can be kept (ms). */
export const MIN_TAKE_TRIM_MS = 2000

/**
 * Their clip then me / Moment + my take: use only part of the take (ms into it), or all of it again (null).
 * Free; the hook text and caption stay as written. A new recording of the take starts whole.
 */
export function setTakeTrim(draftId: unknown, startMs: unknown, endMs: unknown): RemixRecordings {
  const run = reviewRun()
  const draft = run.status.drafts.find((item) => item.id === draftId)
  if (!draft) throw new Error('That take is no longer in this review.')
  if (draft.format !== 'clip_then_me' && draft.format !== 'moment_take') throw new Error('Only a single take (Their clip, then me or Moment + my take) can be trimmed here. Record it again to change it.')
  const file = run.context.recordings?.get(draft.id)?.get('reaction')
  if (!file) throw new Error('Record your take first.')
  if (startMs === null && endMs === null) { delete file.trim; return remixRecordings() }
  const total = Math.round(file.seconds * 1000)
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error('Choose where your take starts and ends.')
  const a = Math.max(0, Math.round(startMs)), b = Math.min(total || Math.round(endMs), Math.round(endMs))
  if (b - a < MIN_TAKE_TRIM_MS) throw new Error(`Keep at least ${MIN_TAKE_TRIM_MS / 1000} seconds of your take.`)
  if (a === 0 && b >= total - 50) delete file.trim
  else file.trim = { startMs: a, endMs: b }
  return remixRecordings()
}

/** The recordings so far, by take and part (previewable in the app). */
export function remixRecordings(): RemixRecordings {
  const run = reviewing
  const out: RemixRecordings = {}
  for (const [draftId, takes] of run?.context.recordings ?? []) {
    out[draftId] = {}
    for (const [part, file] of takes) {
      out[draftId][part] = { path: authorizeMedia(file.path), uploaded: file.uploaded, seconds: file.seconds,
        ...(part === 'reaction' && run?.context.writtenTakes?.get(draftId) === file ? { written: true } : {}),
        ...(file.trim ? { trim: { ...file.trim } } : {}) }
    }
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
    if (draft.format === 'react_thoughts') {
      // Part 1 lined up by the recorder (or, from a phone, by sound in the engine); part 2 from its start.
      out[String(edit.id)] = { reaction: { path: takes!.get('reaction')!.path, offset_s: takes!.get('reaction')!.offsetS }, thoughts: { path: takes!.get('thoughts')!.path, offset_s: 0 } }
      continue
    }
    out[String(edit.id)] = headlineOnly(draft.format)
      // Over a screenshot there's nothing to line up with: the take starts the video.
      ? { reaction: { path: takes!.get('reaction')!.path, offset_s: draft.format === 'image' || draft.format === 'moment_take' || draft.format === 'clip_then_me' ? 0 : takes!.get('reaction')!.offsetS,
        ...(takes!.get('reaction')!.trim && (draft.format === 'moment_take' || draft.format === 'clip_then_me') ? { trim: [takes!.get('reaction')!.trim!.startMs / 1000, takes!.get('reaction')!.trim!.endMs / 1000] } : {}) } }
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
  const run = reviewRun()
  const format = run.context.request.format
  if (format !== 'pause_react' && !clipFormat(format)) throw new Error('This remix has no part of a video to choose.')
  const draft = run.status.drafts.find((item) => item.id === draftId && item.format === format)
  if (!draft) throw new Error('That take is no longer in this review.')
  if (recordingInProgress(run)) throw new Error('Wait for your recording to finish saving.')
  const limit = Math.round((run.context.pause?.sourceSeconds ?? draft.endMs / 1000) * 1000)
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isInteger(startMs) || !Number.isInteger(endMs) ||
      startMs < 0 || endMs > limit + 50 || endMs - startMs < 1000 || startMs >= limit - 200) throw new Error('Choose at least one second of the video.')
  const most = clipFormat(format) ? CLIP_MAX_SECONDS : PAUSE_MAX_TRIM_SECONDS
  if (endMs - startMs > most * 1000) throw new Error(`Choose up to ${most / 60} minutes of the video.`)
  const next = { ...draft, startMs, endMs: Math.min(endMs, limit) }
  if (format === 'react_thoughts' && (next.startMs !== draft.startMs || next.endMs !== draft.endMs)) {
    // Part 1 was filmed while the old part played: it's recorded again with the new one.
    const part1 = run.context.recordings?.get(draft.id)?.get('reaction')
    if (part1) { run.context.recordings?.get(draft.id)?.delete('reaction'); await rm(part1.path, { force: true }).catch(() => undefined) }
  }
  const file = run.context.recordings?.get(draft.id)?.get('reaction')
  if (format === 'pause_react' && file?.uploaded) {
    // Where the original starts in the recording, and its pauses, depend on the part chosen.
    file.detection = await saving(run, () => detectPauses(run, file.path, next))
    if (reviewing !== run) throw new Error('This review was closed.')
  }
  run.status = { ...run.status, drafts: run.status.drafts.map((item) => item.id === draft.id ? next : item) }
  notify(run.status)
  return { draft: next, view: pauseView() }
}

// ---------------------------------------------------------------------------
// Their clip, then me / React, then my thoughts: the part of their video, and the b-roll
// ---------------------------------------------------------------------------

/** The engine's view of the part of their video used, and (React, then my thoughts) the b-roll. */
function clipConfig(run: ActiveRemix, render = false): Record<string, unknown> {
  if (!clipFormat(run.context.request.format)) return {}
  const draft = run.status.drafts[0]
  const broll = run.context.broll
  const choice = run.context.request.layout
  return {
    ...(draft ? { clip_trim: [Math.round(draft.startMs), Math.round(draft.endMs)] } : {}),
    // The layout as chosen, with part 2's look and the proof screenshots added in the review.
    ...(choice ? { layout: engineLayout(choice, run.context.extras) } : {}),
    ...(broll ? {
      broll_items: broll.items.map((item) => ({ id: item.id, path: item.path, kind: item.kind, name: item.name })), broll_stock: broll.stock,
      // Making it: the plan as the member left it (none yet: the engine plans it then).
      ...(render && broll.plan ? { broll_plan: broll.plan } : {})
    } : {})
  }
}

/** A b-roll plan the engine sent back (with the hook text, or "Plan my b-roll"), kept for the review. */
function takeBrollPlan(run: ActiveRemix, result: Record<string, unknown>): void {
  const broll = run.context.broll
  if (!broll) return
  if (Array.isArray(result.broll_plan)) broll.plan = readBrollPlan(result.broll_plan, new Set(broll.items.map((item) => item.id)))
  if (typeof result.take_seconds === 'number' && Number.isFinite(result.take_seconds) && result.take_seconds > 0) broll.takeSeconds = result.take_seconds
}

function brollRun(): ActiveRemix & { context: { broll: NonNullable<RunContext['broll']> } } {
  const run = reviewRun()
  if (run.context.request.format !== 'react_thoughts' || !run.context.broll) throw new Error('This remix has no b-roll.')
  return run as ActiveRemix & { context: { broll: NonNullable<RunContext['broll']> } }
}

/** React, then my thoughts: your b-roll, stock on or off, and the plan (null when it isn't one). */
export function brollView(): BrollView | null {
  const run = reviewing
  const broll = run?.status.phase === 'review' ? run.context.broll : undefined
  if (!broll) return null
  return {
    items: broll.items.map((item) => ({ ...item, path: authorizeMedia(item.path) })), stock: broll.stock, pexels: Boolean(loadSettings().pexelsApiKey),
    plan: broll.plan, takeSeconds: broll.takeSeconds
  }
}

/** Your own clips or pictures for the b-roll (from the file dialog), copied into the run. */
export async function addBroll(sources: string[]): Promise<BrollView> {
  const run = brollRun()
  const broll = run.context.broll
  // Room is held before the first wait, so another add running at the same time counts these too.
  const room = BROLL_MAX_ITEMS - broll.items.length - (broll.adding ?? 0)
  if (sources.length > room) throw new Error(room > 0 ? `Add up to ${BROLL_MAX_ITEMS} clips or pictures (${room} more).` : `You have ${BROLL_MAX_ITEMS} already. Remove one to add another.`)
  broll.adding = (broll.adding ?? 0) + sources.length
  const added: BrollItem[] = []
  try {
    for (const source of sources) {
      const kind = brollKind(basename(source))
      if (!kind) throw new Error('Choose videos (MP4, MOV, WebM) or pictures (JPG, PNG, WebP).')
      const info = await stat(source)
      if (!info.isFile() || info.size > BROLL_MAX_BYTES) throw new Error('Choose clips under 1 GB.')
    }
    await saving(run, async () => {
      await mkdir(join(run.status.folder, '.broll'), { recursive: true })
      for (const source of sources) {
        const id = `b${randomBytes(4).toString('hex')}`
        const path = join(run.status.folder, '.broll', `${id}${extname(source).toLowerCase()}`)
        // Listed before copying, so a copy that fails partway is removed below.
        added.push({ id, name: basename(source).slice(0, 80), kind: brollKind(basename(source)) as BrollItem['kind'], path })
        await copyFile(source, path)
      }
    })
    if (reviewing !== run) throw new Error('This review was closed.')
  } catch (error) {
    // Nothing is half-added: copies already made are removed.
    await Promise.all(added.map((item) => rm(item.path, { force: true }).catch(() => undefined)))
    throw error
  } finally {
    broll.adding = Math.max(0, (broll.adding ?? 0) - sources.length)
  }
  broll.items = [...broll.items, ...added]
  return brollView() as BrollView
}

/** Remove one of your clips (and any shot that used it). */
export async function removeBroll(id: unknown): Promise<BrollView> {
  const run = brollRun()
  const broll = run.context.broll
  const item = broll.items.find((entry) => entry.id === id)
  if (!item) throw new Error('That clip is no longer in your b-roll.')
  broll.items = broll.items.filter((entry) => entry !== item)
  if (broll.plan) broll.plan = broll.plan.filter((shot) => shot.item !== item.id)
  await rm(item.path, { force: true }).catch(() => undefined)
  return brollView() as BrollView
}

/** "Fill gaps with stock footage" (turned off, stock shots leave the plan). */
export function setBrollStock(on: unknown): BrollView {
  const run = brollRun()
  if (typeof on !== 'boolean') throw new Error('Choose whether stock footage fills the gaps.')
  run.context.broll.stock = on
  if (!on && run.context.broll.plan) run.context.broll.plan = run.context.broll.plan.filter((shot) => shot.item !== null)
  return brollView() as BrollView
}

/** The plan as the member left it (a shot swapped to another clip, or removed). */
export function setBrollPlan(value: unknown): BrollView {
  const run = brollRun()
  const broll = run.context.broll
  broll.plan = parseBrollPlan(value, new Set(broll.items.map((item) => item.id)), broll.stock, broll.takeSeconds)
  return brollView() as BrollView
}

// ---------------------------------------------------------------------------
// Their clip, then me / React, then my thoughts: part 2's look and proof screenshots
// ---------------------------------------------------------------------------

function extrasRun(): ActiveRemix & { context: { extras: NonNullable<RunContext['extras']> } } {
  const run = reviewRun()
  if (!clipFormat(run.context.request.format) || !run.context.extras) throw new Error('This remix has no part 2 to change.')
  return run as ActiveRemix & { context: { extras: NonNullable<RunContext['extras']> } }
}

/** Part 2's look and the proof screenshots (null when this review has none). */
export function layoutExtrasView(): LayoutExtrasView | null {
  const run = reviewing
  const extras = run?.status.phase === 'review' ? run.context.extras : undefined
  if (!run || !extras) return null
  return {
    format: run.context.request.format as LayoutExtrasView['format'], part2: extras.part2,
    screen: extras.screen ? { ...extras.screen, path: authorizeMedia(extras.screen.path) } : null,
    banner: extras.banner, circles: extras.circles, keyword: run.context.request.ctaKeyword,
    // Their clip's box in part 1 can move only when it is a box (not a phone card).
    ...(run.context.request.format === 'react_thoughts' && run.context.request.layout?.part1 !== 'phone' ? { boxAt: extras.boxAt ?? 'auto' } : {}),
    proofs: extras.proofs.map((proof) => ({ ...proof, path: authorizeMedia(proof.path) }))
  }
}

async function copyIn(run: ActiveRemix, source: string, id: string, extensions: string[], maxBytes: number, what: string): Promise<string> {
  const extension = extname(source).slice(1).toLowerCase()
  if (!extensions.includes(extension)) throw new Error(what)
  const info = await stat(source)
  if (!info.isFile() || info.size > maxBytes) throw new Error(what)
  await mkdir(join(run.status.folder, '.layout'), { recursive: true })
  const path = join(run.status.folder, '.layout', `${id}.${extension}`)
  await copyFile(source, path)
  return path
}

/** Proof screenshots (from the file dialog), copied into the run: up to six, spread evenly over part 2 to start with. */
export async function addProofs(sources: string[]): Promise<LayoutExtrasView> {
  const run = extrasRun()
  const extras = run.context.extras
  const room = MAX_PROOFS - extras.proofs.length - (extras.adding ?? 0)
  if (sources.length > room) throw new Error(room > 0 ? `Add up to ${MAX_PROOFS} screenshots (${room} more).` : `You have ${MAX_PROOFS} already. Remove one to add another.`)
  extras.adding = (extras.adding ?? 0) + sources.length
  const added: ProofShot[] = []
  try {
    await saving(run, async () => {
      for (const source of sources) {
        const id = `p${randomBytes(4).toString('hex')}`
        const path = await copyIn(run, source, id, PROOF_EXTENSIONS, PROOF_MAX_BYTES, 'Choose screenshots (JPG, PNG or WebP) under 50 MB.')
        added.push({ id, name: basename(source).slice(0, 80), path, at: null, label: '', highlight: null })
      }
    })
    if (reviewing !== run) throw new Error('This review was closed.')
  } catch (error) {
    // Nothing is half-added: copies already made are removed.
    await Promise.all(added.map((proof) => rm(proof.path, { force: true }).catch(() => undefined)))
    throw error
  } finally {
    extras.adding = Math.max(0, (extras.adding ?? 0) - sources.length)
  }
  Object.assign(extras, { proofs: [...extras.proofs, ...added] })
  return layoutExtrasView() as LayoutExtrasView
}

/** React, then my thoughts: the screen recording part 2 plays over (from the file dialog), copied into the run. */
export async function addScreenRecording(source: string): Promise<LayoutExtrasView> {
  const run = extrasRun()
  if (run.context.request.format !== 'react_thoughts') throw new Error('Only React, then my thoughts uses a screen recording.')
  const id = `s${randomBytes(4).toString('hex')}`
  const path = await saving(run, () => copyIn(run, source, id, SCREEN_EXTENSIONS, SCREEN_MAX_BYTES, 'Choose a screen recording (MP4, MOV, WebM or MKV) under 2 GB.'))
  if (reviewing !== run) { await rm(path, { force: true }).catch(() => undefined); throw new Error('This review was closed.') }
  const previous = run.context.extras.screen
  // A new recording: circles marked on the old one don't apply any more.
  Object.assign(run.context.extras, { part2: 'screen', screen: { id, name: basename(source).slice(0, 80), path }, circles: [] })
  if (previous) await rm(previous.path, { force: true }).catch(() => undefined)
  return layoutExtrasView() as LayoutExtrasView
}

/** Remove a proof screenshot, or the screen recording (part 2 goes back to you on camera). */
export async function removeLayoutItem(id: unknown): Promise<LayoutExtrasView> {
  const run = extrasRun()
  const extras = run.context.extras
  if (isProofId(id)) {
    const proof = extras.proofs.find((item) => item.id === id)
    if (!proof) throw new Error('That screenshot is no longer here.')
    Object.assign(extras, { proofs: extras.proofs.filter((item) => item !== proof) })
    await rm(proof.path, { force: true }).catch(() => undefined)
  } else if (extras.screen && id === extras.screen.id) {
    const path = extras.screen.path
    Object.assign(extras, { part2: 'camera', screen: null, circles: [] })
    await rm(path, { force: true }).catch(() => undefined)
  } else throw new Error('That file is no longer here.')
  return layoutExtrasView() as LayoutExtrasView
}

/** Part 2's look, the banner, the circles, and each screenshot's time, label and highlight box (all free). */
export function setLayoutExtras(value: unknown): LayoutExtrasView {
  const run = extrasRun()
  const extras = run.context.extras
  const patch = parseExtrasPatch(value, run.context.request.format as LayoutExtrasView['format'], new Set(extras.proofs.map((proof) => proof.id)))
  if ((patch.part2 === 'screen' || patch.circles) && !extras.screen) throw new Error('Add your screen recording first.')
  if (patch.boxAt && patch.boxAt !== 'auto' && run.context.request.layout?.part1 === 'phone') throw new Error('Their clip is a phone card in this layout, so its box can’t be moved.')
  // Screenshots are listed in the order sent (the member may reorder them); every one is still there.
  const proofs = patch.proofs
    ? patch.proofs.map((change) => ({ ...(extras.proofs.find((proof) => proof.id === change.id) as ProofShot), ...change }))
    : extras.proofs
  if (patch.proofs && proofs.length !== extras.proofs.length) throw new Error('That screenshot list is out of date. Try again.')
  Object.assign(extras, {
    ...(patch.part2 ? { part2: patch.part2 } : {}), ...(patch.banner !== undefined ? { banner: patch.banner } : {}),
    ...(patch.circles ? { circles: patch.circles } : {}), ...(patch.boxAt ? { boxAt: patch.boxAt } : {}), proofs
  })
  return layoutExtrasView() as LayoutExtrasView
}

/** "Plan my b-roll": one small planning call over what you said (after adding clips, or without writing first). */
export async function planBroll(): Promise<BrollView> {
  const run = brollRun()
  if (recordingInProgress(run)) throw new Error('Wait for your recording to finish saving.')
  if (!run.context.broll.items.length && !run.context.broll.stock) throw new Error('Add your own clips, or turn on stock footage, first.')
  const recordings = engineRecordings(run, [{ id: 0, beats: [] }])
  return momentWork(run, async () => {
    let result: Record<string, unknown>
    try {
      result = await runEngineOnce({ ...run.context.config, mode: 'broll', recordings, ...clipConfig(run) }, 10 * 60_000, true,
        'Your b-roll couldn’t be planned this time. Try again.', (child) => { run.context.momentChild = child })
    } catch (error) {
      // Paid for, though nothing usable came back: the cost still reaches the run (and the ledger).
      chargeFailedMoment(run, run.status.drafts[0], errorCost(error), 'Remix b-roll plan')
      throw error
    } finally { run.context.momentChild = undefined }
    const cost = paidUsd(result)
    momentCost(run, cost, 'Remix b-roll plan')
    if (reviewing !== run) throw new Error('This review was closed.')
    takeBrollPlan(run, result)
    if (cost > 0) replaceDraft(run, run.status.drafts.find((item) => item.id === 0) ?? run.status.drafts[0], cost)
    logger.info('remix.broll.planned', { shots: run.context.broll.plan?.length ?? 0, cost })
    return brollView() as BrollView
  })
}

// ---------------------------------------------------------------------------
// Moment + my take: nudge a moment, find another one in its range, talking points
// ---------------------------------------------------------------------------

function momentDraft(draftId: unknown): { run: ActiveRemix; draft: RemixDraft & { moment: NonNullable<RemixDraft['moment']> } } {
  const run = reviewRun()
  if (run.context.request.format !== 'moment_take') throw new Error('This remix isn’t a Moment + my take.')
  const draft = run.status.drafts.find((item) => item.id === draftId && item.format === 'moment_take')
  if (!draft?.moment) throw new Error('That moment is no longer in this review.')
  return { run, draft: draft as RemixDraft & { moment: NonNullable<RemixDraft['moment']> } }
}

function replaceDraft(run: ActiveRemix, next: RemixDraft, addedCostUsd = 0): void {
  run.context.planCostUsd += addedCostUsd
  run.status = { ...run.status, drafts: run.status.drafts.map((item) => item.id === next.id ? next : item),
    ...(addedCostUsd > 0 ? { costUsd: (run.status.costUsd ?? 0) + addedCostUsd } : {}) }
  notify(run.status)
}

/** The member's own start and end for a moment (inside its range, 2-40 seconds). Free: nothing is made yet. */
export function setMomentBounds(draftId: unknown, startMs: unknown, endMs: unknown): RemixDraft {
  const { run, draft } = momentDraft(draftId)
  const problem = momentBoundsProblem(startMs, endMs, draft.moment)
  if (problem) throw new Error(problem)
  const next = { ...draft, startMs: startMs as number, endMs: endMs as number }
  replaceDraft(run, next)
  return next
}

/** Stop the engine finding another moment (it writes into the run's folder) and wait for it to exit. */
async function stopMomentChild(run: ActiveRemix): Promise<void> {
  const child = run.context.momentChild
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000)
    child.once('close', () => { clearTimeout(timer); resolve() })
  })
  kill(child, true)
  await closed
}

/** Records what a moment call cost (set by the IPC layer, which owns the spending ledger). */
type MomentSpendRecorder = (usd: number, label: string, runId: string) => unknown
let recordMomentSpend: MomentSpendRecorder | null = null
export function onRemixMomentSpend(recorder: MomentSpendRecorder): void { recordMomentSpend = recorder }

/**
 * After a paid moment call: the cost is added to the run (and so to the ledger) while it is under review.
 * A review closed meanwhile no longer reports its costs, so the call's cost goes to the ledger directly.
 */
function momentCost(run: ActiveRemix, usd: number, label: string): void {
  if (reviewing === run || !(usd > 0)) return
  try { void recordMomentSpend?.(usd, label, basename(run.status.folder)) } catch { /* never breaks the caller */ }
  throw new Error('This review was closed.')
}

/** A paid moment call that failed: its cost goes to the run under review, or to the ledger directly when the review is closed. */
function chargeFailedMoment(run: ActiveRemix, draft: RemixDraft, usd: number, label: string): void {
  if (!(usd > 0)) return
  if (reviewing !== run) {
    try { void recordMomentSpend?.(usd, label, basename(run.status.folder)) } catch { /* never breaks the caller */ }
    return
  }
  replaceDraft(run, run.status.drafts.find((item) => item.id === draft.id) ?? draft, usd)
}

/** One at a time per review: finding another moment or talking points. */
async function momentWork<T>(run: ActiveRemix, work: () => Promise<T>): Promise<T> {
  if (active || starting) throw new Error('A remix is already being made. Wait for it to finish or cancel it.')
  if (run.context.momentWork) throw new Error('Wait for the moment you asked for.')
  run.context.momentWork = true
  try { return await work() } finally { run.context.momentWork = false }
}

/** "Find another moment in this range": one planning call that avoids the moments already shown. */
export async function anotherMoment(draftId: unknown): Promise<RemixDraft> {
  const { run, draft } = momentDraft(draftId)
  return momentWork(run, async () => {
    let result: Record<string, unknown>
    try {
      result = await runEngineOnce({ mode: 'moment', output_dir: run.status.folder, draft_id: draft.id }, 10 * 60_000, true,
        'Another moment couldn’t be found this time. Try again.', (child) => { run.context.momentChild = child })
    } catch (error) {
      // Nothing usable ("no other moment stood out"), yet the calls were paid for.
      chargeFailedMoment(run, draft, errorCost(error), 'Remix planning')
      throw error
    } finally { run.context.momentChild = undefined }
    const cost = typeof result.cost_usd === 'number' && Number.isFinite(result.cost_usd) && result.cost_usd > 0 ? result.cost_usd : 0
    momentCost(run, cost, 'Remix planning')
    if (reviewing !== run) throw new Error('This review was closed.')
    const found = parseRemixDraft((result as { draft?: unknown }).draft)
    if (!found || found.id !== draft.id || found.format !== 'moment_take') {
      // Paid for, though nothing usable came back.
      if (cost > 0) replaceDraft(run, run.status.drafts.find((item) => item.id === draft.id) ?? draft, cost)
      throw new Error('Another moment couldn’t be found this time. Try again.')
    }
    // The current draft may have changed meanwhile (talking points, a nudge): only the moment itself is replaced.
    const current = run.status.drafts.find((item) => item.id === draft.id) ?? draft
    const next: RemixDraft = { ...current, startMs: found.startMs, endMs: found.endMs, quote: found.quote, why: found.why,
      moment: { ...(current.moment ?? draft.moment), picks: found.moment?.picks ?? draft.moment.picks + 1, points: [] } }
    logger.info('remix.moment.another', { cost })
    replaceDraft(run, next, cost)
    return next
  })
}

/** "Give me talking points": three short prompts for the member's take on a moment (one small call). */
export async function momentTalkingPoints(draftId: unknown): Promise<RemixDraft> {
  const { run, draft } = momentDraft(draftId)
  return momentWork(run, async () => {
    const config = run.context.config
    let answer: Awaited<ReturnType<typeof suggestTalkingPoints>>
    try {
      answer = await suggestTalkingPoints({
        quote: draft.quote, title: draft.sourceTitle, creator: draft.creator,
        brandName: typeof config.brand_name === 'string' ? config.brand_name : '', brand: typeof config.brand_identity === 'string' ? config.brand_identity : ''
      }, loadSettings().openrouterApiKey)
    } catch (error) {
      // No usable points came back, though the call was paid for.
      chargeFailedMoment(run, draft, errorCost(error), 'Remix planning')
      throw error
    }
    const { points, costUsd } = answer
    momentCost(run, costUsd, 'Remix planning')
    if (reviewing !== run) throw new Error('This review was closed.')
    const current = run.status.drafts.find((item) => item.id === draft.id) ?? draft
    const next: RemixDraft = { ...current, moment: { ...(current.moment ?? draft.moment), points } }
    replaceDraft(run, next, costUsd)
    return next
  })
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
async function runEngineOnce(config: Record<string, unknown>, limitMs: number, task = false, failure?: string, onChild?: (child: ChildProcess) => void): Promise<Record<string, unknown>> {
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
  onChild?.(child)
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
      reject(paidError(typeof result?.error === 'string' && result.error !== 'failed' ? result.error.slice(0, 400) : failure ?? (task ? 'Your recording could not be read. Try an MP4 or MOV from your phone.' : 'The video could not be made again. Try again.'), paidUsd(result)))
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
  // Stops waiting for HeyGen (it has no cancel: a video it already started may still finish and be billed there).
  if (run.heygen) stopWaitingForHeygen(run.heygen)
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
