import { nativeImage } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { promisify } from 'util'
import { estimateSpokenSeconds, isAvatarId, parseVoice, type Avatar, type AvatarSummary } from '../shared/avatars'
import {
  consentLinkFresh, estimateHeygenVideoUsd, HEYGEN_MAX_ASSET_BYTES, HEYGEN_MAX_AUDIO_SECONDS, HEYGEN_PRICES, heygenEngine, heygenStage, isHeygenId, parseConsent, parseHeygenAccount,
  parseHeygenStatus, TWIN_MAX_SECONDS, TWIN_MIN_SECONDS,
  type HeygenAccount, type HeygenAvatarLink, type HeygenSource, type HeygenStockAvatar, type HeygenVideoDraft
} from '../shared/heygen'
import type { SpendKind } from '../shared/spending'
import { avatarDir, draftsDir, isDraftId, listAvatars, newId, readAvatar, writeAvatar, writePicturesMeta } from './avatars'
import {
  createAvatar as createHeygenLook, createConsent, createVideo, downloadHeygenFile, getCurrentUser, getGroup, getLook, getVideo, HEYGEN_OUT_OF_CREDIT, HeygenError, heygenMessage,
  listPublicLooks, sleep, uploadAsset, type HeygenOptions, type LookInfo
} from './heygen'
import { logger } from './logger'
import { authorizeMedia } from './security'
import { loadSettings } from './settings-store'
import { recordSpend } from './spending'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

/**
 * Realistic talking avatars on HeyGen (Beta), with the member's own key.
 * Avatars stay in the app's avatar library; their avatar.json carries a
 * `heygen` link (look id, group id, status, consent, voice), never the key.
 *
 * Only the member's own likeness (they confirm "This is me") or one of
 * HeyGen's stock AI people can become a HeyGen avatar.
 */

export function heygenKey(): string {
  const key = loadSettings().heygenApiKey
  if (!key) throw new Error('Add your HeyGen key in Settings → API keys to use realistic talking avatars.')
  return key
}

function options(signal?: AbortSignal, overrides: Partial<HeygenOptions> = {}): HeygenOptions {
  return { key: heygenKey(), signal, ...overrides }
}

/** Settings → API keys "Test": who the key belongs to and what is left on the account. */
export async function heygenAccount(): Promise<HeygenAccount> {
  return parseHeygenAccount(await getCurrentUser(options()))
}

// ---------------------------------------------------------------------------
// Twin footage: a recorded or chosen video, prepared as a compact MP4 draft
// ---------------------------------------------------------------------------

const VIDEO_INPUT_GUARD = ['-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'mov,matroska,webm,avi,flv,mpegts']
export const TWIN_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv']
const MAX_SOURCE_BYTES = 2_000_000_000
const MAX_RECORDING_BYTES = 400_000_000

interface Probe { width: number; height: number; seconds: number; hasAudio: boolean }

async function probe(path: string): Promise<Probe> {
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', ...VIDEO_INPUT_GUARD, '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path], { timeout: 30_000, maxBuffer: 1024 * 1024 })
    const info = JSON.parse(stdout) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } }
    const video = info.streams?.find((stream) => stream.codec_type === 'video')
    const seconds = Number(info.format?.duration)
    if (video?.width && video.height && Number.isFinite(seconds) && seconds > 0) {
      return { width: video.width, height: video.height, seconds, hasAudio: Boolean(info.streams?.some((stream) => stream.codec_type === 'audio')) }
    }
  } catch { /* below */ }
  throw new Error('That file has no readable video. Use an MP4, MOV or WebM video.')
}

/** Long side at most 1280px (HeyGen wants at least 640), even dimensions. */
const TWIN_SCALE = "scale='if(gte(iw,ih),trunc(min(1280,iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(1280,ih)/2)*2)'"

/** Video bitrate (kbps) that keeps `seconds` of footage under HeyGen's 32 MB upload limit with room to spare. */
export function twinBitrateKbps(seconds: number): number {
  const budgetKbits = ((HEYGEN_MAX_ASSET_BYTES * 0.85) * 8) / 1000
  return Math.max(400, Math.min(2500, Math.floor(budgetKbits / Math.max(1, seconds)) - 128))
}

/** Check footage against HeyGen's twin rules and make a compact MP4 plus a still for the avatar's picture. */
export async function prepareTwinVideo(source: string): Promise<HeygenVideoDraft> {
  const info = await probe(source)
  if (!info.hasAudio) throw new Error('The video needs sound: HeyGen also clones your voice from it. Record or choose a video of you talking.')
  if (info.seconds < TWIN_MIN_SECONDS) throw new Error(`Use at least ${TWIN_MIN_SECONDS} seconds of you talking to the camera (about 2 minutes works best).`)
  if (Math.max(info.width, info.height) < 640) throw new Error('The video is too small. HeyGen needs at least 640 pixels on the long side.')
  const seconds = Math.min(info.seconds, TWIN_MAX_SECONDS)
  await mkdir(draftsDir(), { recursive: true })
  const draftId = newId(8)
  const video = join(draftsDir(), `${draftId}.mp4`)
  const still = join(draftsDir(), `${draftId}.jpg`)
  const rate = twinBitrateKbps(seconds)
  try {
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...VIDEO_INPUT_GUARD, '-i', source, '-t', seconds.toFixed(2),
      '-vf', `${TWIN_SCALE},fps=30,setsar=1`, '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${rate}k`, '-maxrate', `${rate}k`, '-bufsize', `${rate * 2}k`,
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ac', '1', '-movflags', '+faststart', video], { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 })
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.min(1, seconds / 2).toFixed(2), '-i', video, '-frames:v', '1', '-q:v', '2', still], { timeout: 60_000 })
  } catch {
    await rm(video, { force: true }); await rm(still, { force: true })
    throw new Error('That video could not be prepared. Try an MP4 or MOV file.')
  }
  if ((await stat(video)).size > HEYGEN_MAX_ASSET_BYTES) {
    await rm(video, { force: true }); await rm(still, { force: true })
    throw new Error('The video is too large to send to HeyGen. Use a shorter one (about 2 minutes).')
  }
  return { draftId, path: authorizeMedia(still), videoPath: authorizeMedia(video), seconds: Math.round(seconds * 10) / 10 }
}

/** A video the member chose in the file dialog. */
export async function draftTwinVideo(path: string): Promise<HeygenVideoDraft> {
  if (!TWIN_VIDEO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) throw new Error('Use an MP4, MOV or WebM video.')
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES) throw new Error('Use a video under 2 GB (about 2 minutes is plenty).')
  return prepareTwinVideo(path)
}

/** A recording made with the camera in the app (WebM or MP4 bytes from MediaRecorder). */
export async function saveTwinRecording(bytes: unknown, mime: unknown): Promise<HeygenVideoDraft> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1000 || bytes.byteLength > MAX_RECORDING_BYTES) throw new Error('The recording could not be saved. Record again.')
  const extension = typeof mime === 'string' && mime.startsWith('video/mp4') ? 'mp4' : 'webm'
  await mkdir(draftsDir(), { recursive: true })
  const temp = join(draftsDir(), `${newId(8)}.recording.${extension}`)
  await writeFile(temp, bytes, { mode: 0o600 })
  try { return await prepareTwinVideo(temp) } finally { await rm(temp, { force: true }) }
}

// ---------------------------------------------------------------------------
// Stock avatars: HeyGen's preset AI people, with previews saved locally
// ---------------------------------------------------------------------------

let stockCache: { at: number; keyHash: string; list: HeygenStockAvatar[] } | null = null

function stockDir(): string { return join(draftsDir(), 'heygen-stock') }

/** A JPEG from any image bytes, or null. */
function toJpeg(bytes: Buffer): Buffer | null {
  try {
    let image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    const scale = Math.min(1, 1024 / Math.max(width, height))
    if (scale < 1) image = image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
    return image.toJPEG(90)
  } catch { return null }
}

async function savePreview(look: LookInfo, signal?: AbortSignal): Promise<string | null> {
  if (!look.previewImageUrl) return null
  const file = join(stockDir(), `${createHash('sha256').update(look.id).digest('hex').slice(0, 24)}.jpg`)
  if (!existsSync(file)) {
    const raw = `${file}.download`
    try {
      await downloadHeygenFile(look.previewImageUrl, raw, { signal, maxBytes: 8_000_000, retries: 0 })
      const jpeg = toJpeg(await readFile(raw))
      if (!jpeg) return null
      await writeFile(file, jpeg, { mode: 0o600 })
    } catch { return null } finally { await rm(raw, { force: true }) }
  }
  try { return authorizeMedia(file) } catch { return null }
}

/** HeyGen's stock avatars (first page), each with a local preview when HeyGen gives one. */
export async function stockHeygenAvatars(signal?: AbortSignal): Promise<HeygenStockAvatar[]> {
  const opts = options(signal)
  const keyHash = createHash('sha256').update(opts.key).digest('hex')
  if (stockCache && stockCache.keyHash === keyHash && Date.now() - stockCache.at < 10 * 60_000) return stockCache.list
  const { looks } = await listPublicLooks({ ...opts, limit: 24 })
  await mkdir(stockDir(), { recursive: true })
  const list: HeygenStockAvatar[] = new Array(looks.length)
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < looks.length) {
      const index = next++
      const look = looks[index]
      list[index] = { lookId: look.id, name: look.name, gender: look.gender, previewPath: await savePreview(look, signal), voiceId: look.defaultVoiceId }
    }
  }))
  stockCache = { at: Date.now(), keyHash, list }
  return list
}

// ---------------------------------------------------------------------------
// Creating a HeyGen avatar
// ---------------------------------------------------------------------------

const SOURCES: readonly HeygenSource[] = ['twin', 'photo', 'stock']

/** The link for a look HeyGen just made or returned. */
export function linkFromLook(source: HeygenSource, look: LookInfo, group: { id: string; status: string | null; consentStatus: string | null; defaultVoiceId: string | null; error: string | null } | null, useHeygenVoice: boolean): HeygenAvatarLink {
  // A twin's own clone is the look's default voice; the group's voice can be a different, linked one.
  const voiceId = look.defaultVoiceId ?? group?.defaultVoiceId ?? null
  return {
    provider: 'heygen', source, lookId: look.id, groupId: look.groupId ?? group?.id ?? null,
    status: source === 'stock' ? 'completed' : parseHeygenStatus(look.status ?? group?.status, 'processing'),
    consentStatus: source === 'twin' ? parseConsent(group?.consentStatus) : null,
    consentUrl: null, consentUrlAt: null,
    voiceId, voice: useHeygenVoice && voiceId && source !== 'photo' ? 'heygen' : 'app',
    engines: look.engines, error: look.error ?? group?.error ?? null, checkedAt: new Date().toISOString()
  }
}

async function saveAvatarFolder(avatar: Avatar, portrait: { from?: string; bytes?: Buffer }, source: 'photo' | 'ai'): Promise<void> {
  await mkdir(avatarDir(avatar.id), { recursive: true })
  const target = join(avatarDir(avatar.id), 'portrait.jpg')
  if (portrait.from) await rename(portrait.from, target)
  else if (portrait.bytes) await writeFile(target, portrait.bytes, { mode: 0o600 })
  await writeAvatar(avatar)
  await writePicturesMeta(avatar.id, { 'portrait.jpg': { source, createdAt: new Date().toISOString() } })
}

/** A plain stand-in picture when a stock avatar has no preview HeyGen could give us. */
async function placeholderPortrait(): Promise<Buffer> {
  const file = join(draftsDir(), `${newId(6)}.placeholder.jpg`)
  try {
    await mkdir(draftsDir(), { recursive: true })
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3a3f4b:s=576x1024', '-frames:v', '1', file], { timeout: 30_000 })
    return await readFile(file)
  } finally { await rm(file, { force: true }) }
}

let creating = false

/**
 * Make a HeyGen avatar and add it to the library. Twin and photo avatars are
 * only for the member's own likeness (`consent` must be true). A twin's
 * consent link is requested right away; the member records it on HeyGen.
 */
export async function createHeygenAvatar(value: unknown, signal?: AbortSignal): Promise<AvatarSummary[]> {
  const input = (value ?? {}) as Record<string, unknown>
  const source = SOURCES.find((item) => item === input.source)
  if (!source) throw new Error('Choose how to make the HeyGen avatar.')
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : ''
  if (!name || name.length > 60) throw new Error('Give the avatar a name (up to 60 characters).')
  if (source !== 'stock' && input.consent !== true) throw new Error('A realistic avatar of a real person can only be of you. Confirm this is you, or use one of HeyGen’s stock AI people.')
  const voice = parseVoice(input.voice)
  if (voice.provider !== 'elevenlabs') throw new Error('Start with a preset voice. You can clone a voice after the avatar is created.')
  const useHeygenVoice = input.useHeygenVoice !== false
  const opts = options(signal)
  if (creating) throw new Error('A HeyGen avatar is already being made. Wait for it to finish.')
  creating = true
  try {
    const now = new Date().toISOString()
    const id = newId(10)
    if (source === 'stock') {
      if (!isHeygenId(input.lookId)) throw new Error('Choose one of HeyGen’s stock avatars.')
      const look = await getLook(input.lookId, opts)
      const preview = await savePreview(look, signal)
      const bytes = preview ? await readFile(preview) : await placeholderPortrait()
      const avatar: Avatar = {
        id, name, kind: 'ai', description: `HeyGen stock avatar: ${look.name}`.slice(0, 600), voice, clonedVoice: null, consentAt: null, createdAt: now,
        heygen: linkFromLook('stock', look, null, useHeygenVoice)
      }
      await saveAvatarFolder(avatar, { bytes }, 'ai')
      return listAvatars()
    }
    if (!isDraftId(input.draftId)) throw new Error(source === 'twin' ? 'Record or choose a video first.' : 'Choose a photo first.')
    const still = join(draftsDir(), `${input.draftId}.jpg`)
    const upload = source === 'twin' ? join(draftsDir(), `${input.draftId}.mp4`) : still
    if (!existsSync(still) || !existsSync(upload)) throw new Error('That preview expired. Choose it again.')
    const bytes = await readFile(upload)
    if (bytes.byteLength > HEYGEN_MAX_ASSET_BYTES) throw new Error('The file is too large to send to HeyGen (32 MB at most).')
    const asset = await uploadAsset(new Uint8Array(bytes), source === 'twin' ? 'footage.mp4' : 'photo.jpg', source === 'twin' ? 'video/mp4' : 'image/jpeg', opts)
    const made = await createHeygenLook(source === 'twin' ? 'digital_twin' : 'photo', name, asset.assetId, opts)
    // HeyGen bills each avatar it creates; it reports no amount, so the published price is recorded as an estimate.
    await recordSpend({ kind: 'avatar', provider: 'heygen', usd: HEYGEN_PRICES.avatarCreation, label: source === 'twin' ? 'HeyGen video avatar' : 'HeyGen photo avatar', estimated: true })
    const link = linkFromLook(source, made.look, made.group, useHeygenVoice)
    if (source === 'twin' && link.groupId) {
      try {
        const consent = await createConsent(link.groupId, opts)
        link.consentUrl = consent.url
        link.consentUrlAt = new Date().toISOString()
        if (consent.group) link.consentStatus = parseConsent(consent.group.consentStatus) ?? link.consentStatus
      } catch (error) {
        // The avatar exists; the member can ask for the link again from the avatar.
        logger.warn('heygen.consent.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
      }
    }
    const avatar: Avatar = { id, name, kind: 'self', description: '', voice, clonedVoice: null, consentAt: now, createdAt: now, heygen: link }
    await saveAvatarFolder(avatar, { from: still }, 'photo')
    if (source === 'twin') await rm(upload, { force: true })
    return listAvatars()
  } finally { creating = false }
}

// ---------------------------------------------------------------------------
// Status, consent and voice
// ---------------------------------------------------------------------------

function heygenAvatar(id: unknown): { avatar: Avatar; link: HeygenAvatarLink } {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  const avatar = readAvatar(id)
  if (!avatar.heygen) throw new Error('This avatar isn’t a HeyGen avatar.')
  return { avatar, link: avatar.heygen }
}

/** The link updated from HeyGen: the look's training status and the group's consent status. */
export async function checkHeygenLink(link: HeygenAvatarLink, opts: HeygenOptions): Promise<HeygenAvatarLink> {
  if (link.source === 'stock') return { ...link, checkedAt: new Date().toISOString() }
  const look = await getLook(link.lookId, opts)
  const group = link.groupId ? await getGroup(link.groupId, opts).catch((error: unknown) => { if (error instanceof HeygenError && error.status === 404) throw error; return null }) : null
  const consentStatus = link.source === 'twin' ? (group ? parseConsent(group.consentStatus) : link.consentStatus) : null
  let status = parseHeygenStatus(look.status ?? group?.status, link.status)
  if (group?.status === 'failed') status = 'failed'
  return {
    ...link, status, consentStatus, engines: look.engines.length ? look.engines : link.engines,
    voiceId: link.voiceId ?? look.defaultVoiceId ?? group?.defaultVoiceId ?? null,
    error: look.error ?? group?.error ?? (status === 'failed' || consentStatus === 'rejected' ? link.error : null),
    // A rejected recording needs a new link.
    ...(consentStatus === 'rejected' && link.consentStatus !== 'rejected' ? { consentUrl: null, consentUrlAt: null } : {}),
    checkedAt: new Date().toISOString()
  }
}

async function saveLink(avatar: Avatar, link: HeygenAvatarLink): Promise<void> {
  // Re-read so a name or voice change made meanwhile is kept.
  await writeAvatar({ ...readAvatar(avatar.id), heygen: link })
}

export async function refreshHeygenAvatar(id: unknown, signal?: AbortSignal): Promise<AvatarSummary[]> {
  const { avatar, link } = heygenAvatar(id)
  await saveLink(avatar, await checkHeygenLink(link, options(signal)))
  return listAvatars()
}

/**
 * HeyGen's consent page for a digital twin: the link already made if it still
 * works, otherwise a new one (links last 24 hours; a rejected recording needs
 * a new link). The caller opens it in the member's browser.
 */
export async function heygenConsentUrl(id: unknown, signal?: AbortSignal): Promise<string> {
  const { avatar, link } = heygenAvatar(id)
  if (link.source !== 'twin' || !link.groupId) throw new Error('Only video avatars need a consent recording.')
  if (link.consentStatus === 'accepted') throw new Error('HeyGen already has your consent for this avatar.')
  if (link.consentStatus !== 'rejected' && link.consentUrl && consentLinkFresh(link)) return link.consentUrl
  const consent = await createConsent(link.groupId, options(signal))
  await saveLink(avatar, { ...link, consentUrl: consent.url, consentUrlAt: new Date().toISOString(), consentStatus: consent.group ? parseConsent(consent.group.consentStatus) ?? 'pending' : 'pending', error: null })
  return consent.url
}

export async function setHeygenVoice(id: unknown, choice: unknown): Promise<AvatarSummary[]> {
  const { avatar, link } = heygenAvatar(id)
  if (choice !== 'heygen' && choice !== 'app') throw new Error('Choose a voice for this avatar.')
  if (choice === 'heygen' && !link.voiceId) throw new Error('HeyGen has no voice for this avatar yet. Check again once it finishes training.')
  await saveLink(avatar, { ...link, voice: choice })
  return listAvatars()
}

// ---------------------------------------------------------------------------
// Rendering one take: the reusable entry point (Avatar Studio, later Remix)
// ---------------------------------------------------------------------------

export interface HeygenTakeRequest {
  /** An avatar in the app's library whose `heygen` link is ready. */
  avatarId: string
  /** Lip-sync to this local audio file (MP3 or WAV; others are converted), up to 10 minutes... */
  audioPath?: string | null
  /** ...or have HeyGen speak this text in `voiceId`. */
  text?: string | null
  /** A HeyGen voice; defaults to the avatar's own HeyGen voice. Only used with `text`. */
  voiceId?: string | null
  /** Where the finished MP4 is written (its folder must exist). */
  outPath: string
  signal?: AbortSignal
  /** Progress for the page: a short detail and 0-1 of HeyGen's part. */
  onStatus?: (detail: string, fraction: number) => void
  /** HeyGen accepted the video (and bills it from here on, finished or not: it has no cancel). */
  onStarted?: (videoId: string) => void
  /** The spending ledger kind (Avatar Studio: avatar; Remix: remix). */
  spendKind?: SpendKind
  title?: string
  /** Tests: faster polling and stand-ins. */
  pollMs?: number
  timeoutMs?: number
  fetch?: typeof fetch
  sleep?: HeygenOptions['sleep']
}

export interface HeygenTake {
  videoId: string
  path: string
  /** Seconds of video HeyGen made (its report, else measured). */
  seconds: number
  /** What the ledger recorded (published Engine IV price), or null when it can't be priced. */
  estimatedUsd: number | null
}

/** A ready HeyGen avatar's link, checked once with HeyGen when it isn't ready yet; throws a plain message otherwise. */
export async function readyHeygenLink(avatarId: string, opts: HeygenOptions): Promise<HeygenAvatarLink> {
  const { avatar, link: stored } = heygenAvatar(avatarId)
  let link = stored
  if (heygenStage(link) !== 'ready') {
    link = await checkHeygenLink(link, opts)
    await saveLink(avatar, link)
  }
  const stage = heygenStage(link)
  if (stage === 'consent') throw new Error('HeyGen needs your consent recording before this avatar can make videos. Open the consent page from the avatar in Avatar Studio; HeyGen usually reviews it within a few minutes.')
  if (stage === 'consent-rejected') throw new Error(`HeyGen didn’t accept the consent recording${link.error ? `: ${link.error}` : '.'} Record it again from the avatar in Avatar Studio.`)
  if (stage === 'training') throw new Error('HeyGen is still training this avatar (usually a few minutes). Try again soon.')
  if (stage === 'failed') throw new Error(`HeyGen could not make this avatar${link.error ? `: ${link.error}` : '.'} Make a new one with a clearer video or photo.`)
  return link
}

async function mediaSeconds(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeout: 30_000 })
    const seconds = Number(stdout.trim())
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  } catch { return 0 }
}

/** The audio as an MP3 or WAV HeyGen accepts (others are converted next to the output). */
async function audioForUpload(path: string, outPath: string, signal?: AbortSignal): Promise<{ bytes: Buffer; name: string; mime: string }> {
  const extension = extname(path).slice(1).toLowerCase()
  if (extension === 'mp3' || extension === 'wav') {
    return { bytes: await readFile(path), name: `voice.${extension}`, mime: extension === 'mp3' ? 'audio/mpeg' : 'audio/wav' }
  }
  const converted = `${outPath}.voice.mp3`
  try {
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe,fd', '-i', path, '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', converted], { timeout: 120_000, signal })
    return { bytes: await readFile(converted), name: 'voice.mp3', mime: 'audio/mpeg' }
  } finally { await rm(converted, { force: true }) }
}

/** The ledger ref for one HeyGen video: its started estimate is replaced by the final figure. */
function heygenSpendRef(videoId: string): string {
  return `heygen:${videoId.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) || createHash('sha256').update(videoId).digest('hex').slice(0, 32)}`
}

/**
 * Render one lip-synced take of a HeyGen avatar: upload the audio (or send
 * the text and voice), create a 9:16 1080p video, poll until it's done, and
 * download it to `outPath`. The cost is recorded in the spending ledger at
 * HeyGen's published Engine IV price (marked estimated) as soon as HeyGen
 * accepts the video, from the audio's length or the script's, and replaced
 * by the finished video's own length when it's done.
 *
 * Canceling (the signal) stops waiting; HeyGen has no cancel call, so a
 * video it already started may still finish on HeyGen and be billed there:
 * its started estimate stays in the ledger (as it does when waiting stops for
 * any other reason). Only a video HeyGen itself reports as failed is removed.
 */
export async function renderHeygenTake(request: HeygenTakeRequest): Promise<HeygenTake> {
  const { signal, onStatus } = request
  const opts = options(signal, { fetch: request.fetch, sleep: request.sleep })
  const link = await readyHeygenLink(request.avatarId, opts)
  const engine = heygenEngine(link.engines)
  let audioAssetId: string | undefined
  let text: string | undefined
  let expectedSeconds = 0
  if (request.audioPath) {
    const info = await stat(request.audioPath).catch(() => null)
    if (!info?.isFile()) throw new Error('The voiceover is missing. Try again.')
    const seconds = await mediaSeconds(request.audioPath)
    expectedSeconds = seconds
    if (seconds > HEYGEN_MAX_AUDIO_SECONDS) throw new Error('HeyGen lip-syncs at most 10 minutes of audio.')
    const audio = await audioForUpload(request.audioPath, request.outPath, signal)
    if (audio.bytes.byteLength > HEYGEN_MAX_ASSET_BYTES) throw new Error('The voiceover is too large to send to HeyGen.')
    onStatus?.('Sending the voiceover to HeyGen', 0.02)
    audioAssetId = (await uploadAsset(new Uint8Array(audio.bytes), audio.name, audio.mime, opts)).assetId
  } else {
    text = (request.text ?? '').trim()
    if (!text) throw new Error('Write a script first.')
    expectedSeconds = estimateSpokenSeconds(text)
  }
  const voiceId = text ? (request.voiceId ?? link.voiceId) : null
  if (text && !voiceId) throw new Error('Choose a voice for this avatar.')
  onStatus?.('Starting your video on HeyGen', 0.05)
  const { videoId } = await createVideo({ avatarId: link.lookId, audioAssetId, script: text, voiceId, engine, title: request.title }, opts)
  logger.info('heygen.video.started', { engine: engine ?? 'default' })
  // Billed from here: recorded now (an estimate), so a cancel, a failed wait or download, or quitting still counts it.
  const spend = { kind: request.spendKind ?? 'avatar', provider: 'heygen' as const, ref: heygenSpendRef(videoId), estimated: true }
  const startedUsd = estimateHeygenVideoUsd(Math.max(1, expectedSeconds), engine)
  if (startedUsd !== null) await recordSpend({ ...spend, usd: startedUsd, label: 'HeyGen avatar video' }).catch(() => null)
  try { request.onStarted?.(videoId) } catch { /* progress only */ }

  const started = Date.now()
  const deadline = started + (request.timeoutMs ?? 40 * 60_000)
  const wait = request.sleep ?? sleep
  let failures = 0
  for (;;) {
    if (Date.now() > deadline) throw new Error('HeyGen is taking unusually long. The video may still appear in your HeyGen account; try again later.')
    let video
    try { video = await getVideo(videoId, opts); failures = 0 }
    catch (error) {
      if (signal?.aborted) throw error
      if (++failures >= 5) throw error
      await wait(request.pollMs ?? 5000, signal)
      continue
    }
    if (video.status === 'failed') {
      const code = video.failureCode
      const message = code && /credit|quota|balance|trial|subscription/.test(code) ? HEYGEN_OUT_OF_CREDIT : heygenMessage(0, code, video.failureMessage)
      // HeyGen returns the credit for a video that fails on its side: its started estimate is removed.
      if (startedUsd !== null) await recordSpend({ ...spend, usd: 0, label: 'HeyGen avatar video' }).catch(() => null)
      // Marked so a caller knows HeyGen won't bill it (unlike a video it stopped waiting for).
      throw Object.assign(new HeygenError(message.replace(/^HeyGen could not do that/, 'HeyGen could not make this video'), code), { videoFailed: true })
    }
    if (video.status === 'completed') {
      if (!video.videoUrl) throw new Error('HeyGen finished but returned no video. Try again.')
      onStatus?.('Downloading your video from HeyGen', 0.92)
      await downloadHeygenFile(video.videoUrl, request.outPath, { signal, fetch: request.fetch, sleep: request.sleep })
      const seconds = video.duration ?? await mediaSeconds(request.outPath)
      const estimatedUsd = estimateHeygenVideoUsd(seconds, engine)
      // The finished length replaces the started estimate (the same ledger item, never counted twice).
      if (estimatedUsd !== null) await recordSpend({ ...spend, usd: estimatedUsd, label: 'HeyGen avatar video' })
      else logger.info('heygen.video.unpriced', { engine })
      return { videoId, path: request.outPath, seconds, estimatedUsd }
    }
    const elapsed = (Date.now() - started) / 1000
    onStatus?.(video.status === 'processing' ? 'HeyGen is animating your avatar' : 'Waiting in HeyGen’s queue', 0.1 + 0.8 * (1 - Math.exp(-elapsed / 150)))
    await wait(request.pollMs ?? 5000, signal)
  }
}

/** The pre-run estimate for a HeyGen avatar video of about `seconds`, or null when it can't be priced. */
export function heygenRenderEstimate(avatar: Pick<Avatar, 'heygen'>, seconds: number): number | null {
  return avatar.heygen ? estimateHeygenVideoUsd(seconds, heygenEngine(avatar.heygen.engines)) : null
}
