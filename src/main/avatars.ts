import { app, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { promisify } from 'util'
import {
  AI_PORTRAIT_CANDIDATES, DEFAULT_VOICE, isAvatarId, isPortraitLook, isReactionId, REACTIONS, OPENROUTER_MODELS, parseVoice, PORTRAIT_LOOKS,
  type Avatar, type AvatarKind, type AvatarReaction, type AvatarSummary, type AvatarVoice
} from '../shared/avatars'
import { falInputUrl } from './fal'
import { generateImage, openRouterBase, OpenRouterMediaError, synthesizeSpeech, type MediaOptions, type SpeechRequest } from './openrouter-media'
import { authorizeMedia } from './security'
import { loadSettings } from './settings-store'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

/**
 * The avatar library lives in the app's own folder, one directory per avatar:
 * avatar.json (metadata) and portrait.jpg (the face every video starts from).
 * The renderer only ever names avatars and drafts by id.
 */
export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png']
export const VOICE_SAMPLE_EXTENSIONS = ['mp3', 'wav', 'm4a']
const DRAFT_ID = /^[a-f0-9]{16}$/
const MAX_PHOTO_BYTES = 25_000_000
const MAX_SAMPLE_BYTES = 20_000_000
const DRAFT_TTL_MS = 24 * 60 * 60_000
/** Phrases that ask for a real person's likeness. AI avatars must be fictional. */
const LIKENESS = /\b(celebrit\w*|famous|look[- ]?alike|looks like|resembl\w*|impersonat\w*|deepfake)\b/i

export function avatarsDir(): string {
  return join(app.getPath('userData'), 'avatars')
}

function draftsDir(): string {
  return join(avatarsDir(), '.drafts')
}

function avatarDir(id: string): string {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  return join(avatarsDir(), id)
}

const PORTRAIT_FILE = /^portrait(?:-[a-f0-9]{8})?\.jpg$/

/**
 * The avatar's picture. A restyled picture gets a new file name (recorded in
 * avatar.json) so every view shows the new one rather than a cached image.
 */
export function portraitPath(id: string): string {
  try {
    const file = (JSON.parse(readFileSync(join(avatarDir(id), 'avatar.json'), 'utf8')) as { portraitFile?: unknown }).portraitFile
    if (typeof file === 'string' && PORTRAIT_FILE.test(file)) return join(avatarDir(id), file)
  } catch { /* new avatar, or the original file name */ }
  return join(avatarDir(id), 'portrait.jpg')
}

/** Where the avatar's silent reaction clips live: <id>.mp4 plus reactions.json (source of each). */
export function reactionsDir(id: string): string {
  return join(avatarDir(id), 'reactions')
}

/** The avatar's reaction clips on disk, in library order, with where each came from. */
export function readReactions(id: string): AvatarReaction[] {
  let meta: Record<string, unknown> = {}
  try { meta = JSON.parse(readFileSync(join(reactionsDir(id), 'reactions.json'), 'utf8')) as Record<string, unknown> } catch { /* none yet */ }
  return REACTIONS.flatMap((reaction): AvatarReaction[] => {
    const path = join(reactionsDir(id), `${reaction.id}.mp4`)
    if (!isReactionId(reaction.id) || !existsSync(path)) return []
    return [{ id: reaction.id, source: meta[reaction.id] === 'own' ? 'own' : 'ai', path }]
  })
}

/** The avatar's cloned-voice recording (trimmed, mono MP3), sent as the reference on every cloned-voice request. */
export function voiceSamplePath(id: string): string {
  return join(avatarDir(id), 'voice-sample.mp3')
}

function newId(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

export function openRouterKey(): string {
  const key = loadSettings().openrouterApiKey
  if (!key) throw new Error('Add your OpenRouter key in Settings → API keys to use Avatar Studio.')
  return key
}

/** A clone made in this version (recording on disk). Clones from the fal version had no recording and are dropped. */
function parseClone(value: unknown, id: string): Avatar['clonedVoice'] {
  const raw = (value ?? {}) as { clonedAt?: unknown; transcript?: unknown; voiceId?: unknown }
  if (typeof raw.clonedAt !== 'string' || raw.voiceId !== undefined || !existsSync(voiceSamplePath(id))) return null
  return { clonedAt: raw.clonedAt.slice(0, 40), transcript: typeof raw.transcript === 'string' ? raw.transcript.slice(0, 4000) : '' }
}

/** The stored voice, moved onto what OpenRouter offers: a retired preset maps to its closest match, an old fal clone falls back to the default. */
function migrateVoice(value: unknown, clone: Avatar['clonedVoice']): AvatarVoice {
  try {
    const voice = parseVoice(value)
    if (voice.provider === 'clone') return clone ? { provider: 'clone', clonedAt: clone.clonedAt } : DEFAULT_VOICE
    return voice
  } catch { return DEFAULT_VOICE }
}

function parseAvatar(value: unknown, id: string): Avatar | null {
  try {
    const raw = value as Record<string, unknown>
    if (raw.id !== id || typeof raw.name !== 'string' || (raw.kind !== 'self' && raw.kind !== 'ai') || typeof raw.createdAt !== 'string') return null
    const clonedVoice = parseClone(raw.clonedVoice, id)
    return {
      id, name: raw.name.slice(0, 60), kind: raw.kind, description: typeof raw.description === 'string' ? raw.description.slice(0, 600) : '',
      voice: migrateVoice(raw.voice, clonedVoice), clonedVoice, consentAt: typeof raw.consentAt === 'string' ? raw.consentAt : null, createdAt: raw.createdAt
    }
  } catch { return null }
}

export function readAvatar(id: string): Avatar {
  let parsed: Avatar | null = null
  try { parsed = parseAvatar(JSON.parse(readFileSync(join(avatarDir(id), 'avatar.json'), 'utf8')), id) } catch { /* below */ }
  if (!parsed || !existsSync(portraitPath(id))) throw new Error('That avatar is no longer in your library.')
  return parsed
}

async function writeAvatar(avatar: Avatar, portraitFile?: string): Promise<void> {
  const file = join(avatarDir(avatar.id), 'avatar.json')
  const current = portraitFile ?? basename(portraitPath(avatar.id))
  await writeFile(`${file}.tmp`, JSON.stringify({ ...avatar, ...(current !== 'portrait.jpg' ? { portraitFile: current } : {}) }, null, 2), { mode: 0o600 })
  await rename(`${file}.tmp`, file)
}

async function cleanDrafts(): Promise<void> {
  let names: string[] = []
  try { names = await readdir(draftsDir()) } catch { return }
  const now = Date.now()
  await Promise.all(names.map(async (name) => {
    const path = join(draftsDir(), name)
    try { if (now - (await stat(path)).mtimeMs > DRAFT_TTL_MS) await rm(path, { force: true }) } catch { /* ignore */ }
  }))
}

export async function listAvatars(): Promise<AvatarSummary[]> {
  void cleanDrafts()
  let ids: string[] = []
  try { ids = (await readdir(avatarsDir())).filter(isAvatarId) } catch { return [] }
  const avatars: AvatarSummary[] = []
  for (const id of ids) {
    try {
      const avatar = readAvatar(id)
      const reactions = readReactions(id).map((reaction) => ({ ...reaction, path: authorizeMedia(reaction.path) }))
      avatars.push({ ...avatar, portraitPath: authorizeMedia(portraitPath(id)), reactions })
    } catch { /* skip damaged entries */ }
  }
  return avatars.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** EXIF orientation (1-8) of a JPEG, or 1 when absent. Phone photos are often stored sideways with this tag. */
export function jpegOrientation(bytes: Buffer): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    const length = bytes.readUInt16BE(offset + 2)
    if (marker === 0xda || length < 2) break
    if (marker === 0xe1 && bytes.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      const tiff = offset + 10
      if (tiff + 8 > bytes.length) return 1
      const little = bytes.toString('latin1', tiff, tiff + 2) === 'II'
      const u16 = (at: number): number => little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at)
      const u32 = (at: number): number => little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at)
      const ifd = tiff + u32(tiff + 4)
      if (ifd + 2 > bytes.length) return 1
      const entries = u16(ifd)
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12
        if (entry + 12 > bytes.length) return 1
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    offset += 2 + length
  }
  return 1
}

/** ffmpeg filters that turn an EXIF-oriented image upright. */
const ORIENTATION_FILTERS: Record<number, string> = { 2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2' }

async function upright(bytes: Buffer): Promise<Buffer> {
  const filter = ORIENTATION_FILTERS[jpegOrientation(bytes)]
  if (!filter) return bytes
  const dir = join(draftsDir(), `${newId(6)}.rotate`)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(join(dir, 'in.jpg'), bytes)
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-loglevel', 'error', '-y', '-noautorotate', '-i', join(dir, 'in.jpg'), '-vf', filter, '-q:v', '2', join(dir, 'out.jpg')], { timeout: 30_000 })
    return await readFile(join(dir, 'out.jpg'))
  } catch { return bytes } finally { await rm(dir, { recursive: true, force: true }) }
}

/** A normalized JPEG: upright, at most 1536px on the long side. */
function normalizePhoto(bytes: Buffer): Buffer {
  let image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('Could not read that image. Use a JPG or PNG photo.')
  const { width, height } = image.getSize()
  if (Math.min(width, height) < 384) throw new Error('That photo is too small. Use one at least 512 pixels on its shortest side.')
  const scale = Math.min(1, 1536 / Math.max(width, height))
  if (scale < 1) image = image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
  return image.toJPEG(92)
}

export interface AvatarDraft { draftId: string; path: string }

async function saveDraft(bytes: Buffer): Promise<AvatarDraft> {
  await mkdir(draftsDir(), { recursive: true })
  const draftId = newId(8)
  const path = join(draftsDir(), `${draftId}.jpg`)
  await writeFile(path, bytes, { mode: 0o600 })
  return { draftId, path: authorizeMedia(path) }
}

/** A photo the user chose, ready to preview before it becomes an avatar. */
export async function draftFromPhoto(path: string): Promise<AvatarDraft> {
  if (!PHOTO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) throw new Error('Use a JPG or PNG photo.')
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_PHOTO_BYTES) throw new Error('Use a photo under 25 MB.')
  return saveDraft(normalizePhoto(await upright(await readFile(path))))
}

export function portraitPrompt(description: string): string {
  return 'Photorealistic vertical 9:16 smartphone video still of a fictional person who does not resemble any real or famous person. ' +
    `${description}. Head and shoulders framing, looking straight into the camera, natural relaxed expression with the mouth closed, ` +
    'sharp focus on the face, soft even lighting, simple uncluttered background, no text, no watermark.'
}

export function assertFictional(description: string): void {
  if (LIKENESS.test(description)) throw new Error('AI avatars must be fictional. Describe the look you want without naming or referencing a real person.')
}

/** Generate candidate AI faces from a description. */
export async function draftsFromDescription(description: unknown, signal?: AbortSignal): Promise<AvatarDraft[]> {
  if (typeof description !== 'string' || description.trim().length < 10 || description.length > 600) throw new Error('Describe the person in a sentence or two (10-600 characters).')
  assertFictional(description)
  const options: MediaOptions = { key: openRouterKey(), signal }
  const prompt = portraitPrompt(description.trim())
  // One request per face: each comes back as its own image.
  const results = await Promise.allSettled(Array.from({ length: AI_PORTRAIT_CANDIDATES }, () =>
    generateImage({ model: OPENROUTER_MODELS.image, prompt, aspectRatio: '9:16' }, options)))
  const images = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  if (!images.length) {
    const reason = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
    throw reason instanceof Error ? reason : new OpenRouterMediaError('OpenRouter returned no images. Try a different description.')
  }
  const drafts: AvatarDraft[] = []
  for (const image of images) drafts.push(await saveDraft(normalizePhoto(Buffer.from(image))))
  return drafts
}

/** The identity-keeping prompt for an "AI version of me". */
export function restylePrompt(look: (typeof PORTRAIT_LOOKS)[number], detail: string): string {
  return 'The same person as in the reference photo. Keep their exact face, facial features, skin tone, hair, age and build so they are clearly recognizable as themselves. ' +
    `Photorealistic vertical 9:16 smartphone video still: ${look.prompt}. ${detail ? `${detail}. ` : ''}` +
    'Head and shoulders framing, looking straight into the camera, natural relaxed expression with the mouth closed, sharp focus on the face, no text, no watermark.'
}

/**
 * "AI version of me": new pictures of the person in a photo they chose (a draft
 * not yet saved, or an existing avatar's picture), kept as drafts to pick from.
 * Only for the user's own likeness, with their confirmation.
 */
export async function restyleDrafts(source: unknown, look: unknown, detail: unknown, consent: unknown, signal?: AbortSignal): Promise<AvatarDraft[]> {
  if (consent !== true) throw new Error('Confirm this is you, or that you have the person’s permission, first.')
  if (!isPortraitLook(look)) throw new Error('Choose a look.')
  const extra = typeof detail === 'string' ? detail.replace(/\s+/g, ' ').trim() : ''
  if (extra.length > 200) throw new Error('Keep the extra detail under 200 characters.')
  if (LIKENESS.test(extra)) throw new Error('Describe the look without referencing another real person.')
  const raw = (source ?? {}) as { draftId?: unknown; avatarId?: unknown }
  let photo: string
  if (typeof raw.draftId === 'string' && DRAFT_ID.test(raw.draftId)) photo = join(draftsDir(), `${raw.draftId}.jpg`)
  else if (isAvatarId(raw.avatarId)) {
    const avatar = readAvatar(raw.avatarId)
    if (avatar.kind !== 'self') throw new Error('AI avatars already are AI. Restyle works on avatars made from your photo.')
    photo = portraitPath(raw.avatarId)
  } else throw new Error('Choose a photo first.')
  if (!existsSync(photo)) throw new Error('That photo is no longer available. Choose it again.')
  const reference = { bytes: new Uint8Array(await readFile(photo)), mime: 'image/jpeg' }
  const options: MediaOptions = { key: openRouterKey(), signal }
  const prompt = restylePrompt(PORTRAIT_LOOKS.find((item) => item.id === look) ?? PORTRAIT_LOOKS[0], extra)
  const results = await Promise.allSettled(Array.from({ length: AI_PORTRAIT_CANDIDATES }, () =>
    generateImage({ model: OPENROUTER_MODELS.image, prompt, aspectRatio: '9:16', references: [reference] }, options)))
  const images = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  if (!images.length) {
    const reason = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
    throw reason instanceof Error ? reason : new OpenRouterMediaError('OpenRouter returned no images. Try another look.')
  }
  const drafts: AvatarDraft[] = []
  for (const image of images) drafts.push(await saveDraft(normalizePhoto(Buffer.from(image))))
  return drafts
}

/** Swap an existing avatar's picture for a chosen draft; its voice and clone stay. */
export async function setPortrait(id: unknown, draftId: unknown): Promise<AvatarSummary[]> {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  if (typeof draftId !== 'string' || !DRAFT_ID.test(draftId)) throw new Error('Choose a picture first.')
  const avatar = readAvatar(id)
  const draft = join(draftsDir(), `${draftId}.jpg`)
  if (!existsSync(draft)) throw new Error('That picture expired. Make it again.')
  const previous = portraitPath(id)
  const file = `portrait-${newId(4)}.jpg`
  await rename(draft, join(avatarDir(id), file))
  await writeAvatar(avatar, file)
  if (basename(previous) !== file) await rm(previous, { force: true })
  return listAvatars()
}

export interface CreateAvatarInput {
  draftId: unknown
  name: unknown
  kind: unknown
  description: unknown
  voice: unknown
  consent: unknown
}

export async function createAvatar(input: CreateAvatarInput): Promise<AvatarSummary[]> {
  if (typeof input.draftId !== 'string' || !DRAFT_ID.test(input.draftId)) throw new Error('Choose a photo or generated face first.')
  const draft = join(draftsDir(), `${input.draftId}.jpg`)
  if (!existsSync(draft)) throw new Error('That preview expired. Choose the photo or generate again.')
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : ''
  if (!name || name.length > 60) throw new Error('Give the avatar a name (up to 60 characters).')
  const kind: AvatarKind = input.kind === 'self' ? 'self' : 'ai'
  if (kind === 'self' && input.consent !== true) throw new Error('Confirm this is you, or that you have the person’s permission, before creating the avatar.')
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 600) : ''
  if (kind === 'ai') assertFictional(description)
  const voice: AvatarVoice = parseVoice(input.voice)
  if (voice.provider !== 'elevenlabs') throw new Error('Start with a preset voice. You can clone a voice after the avatar is created.')
  const id = newId(10)
  await mkdir(avatarDir(id), { recursive: true })
  await rename(draft, portraitPath(id))
  await writeAvatar({ id, name, kind, description, voice, clonedVoice: null, consentAt: kind === 'self' ? new Date().toISOString() : null, createdAt: new Date().toISOString() })
  return listAvatars()
}

export async function updateAvatar(id: unknown, patch: { name?: unknown; voice?: unknown }): Promise<AvatarSummary[]> {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  const avatar = readAvatar(id)
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.replace(/\s+/g, ' ').trim() : ''
    if (!name || name.length > 60) throw new Error('Give the avatar a name (up to 60 characters).')
    avatar.name = name
  }
  if (patch.voice !== undefined) {
    const voice = parseVoice(patch.voice)
    // A cloned voice can only be this avatar's own clone.
    if (voice.provider === 'clone') {
      if (!avatar.clonedVoice) throw new Error('Clone a voice to use it.')
      avatar.voice = { provider: 'clone', clonedAt: avatar.clonedVoice.clonedAt }
    } else avatar.voice = voice
  }
  await writeAvatar(avatar)
  return listAvatars()
}

export async function removeAvatar(id: unknown): Promise<AvatarSummary[]> {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  await rm(avatarDir(id), { recursive: true, force: true })
  return listAvatars()
}

/** The portrait as a fal input URL (Recreate only). */
export async function portraitInput(id: string, key: string, signal?: AbortSignal): Promise<string> {
  return falInputUrl(await readFile(portraitPath(id)), 'image/jpeg', 'portrait.jpg', { key, signal })
}

/** The portrait's JPEG bytes (sent inline to OpenRouter). */
export async function portraitBytes(id: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(portraitPath(id)))
}

/** The voice an avatar speaks with, as an OpenRouter speech request. */
export async function speechFor(id: string, voice: AvatarVoice, text: string): Promise<SpeechRequest> {
  if (voice.provider === 'elevenlabs') return { model: OPENROUTER_MODELS.tts, input: text, voice: voice.voice.toLowerCase() }
  const avatar = readAvatar(id)
  if (!avatar.clonedVoice) throw new Error('This avatar’s cloned voice is missing. Clone it again or pick a preset voice.')
  return {
    model: OPENROUTER_MODELS.cloneTts, input: text,
    references: [{ audio: new Uint8Array(await readFile(voiceSamplePath(id))), mime: 'audio/mpeg', transcript: avatar.clonedVoice.transcript || undefined }]
  }
}

async function audioSeconds(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeout: 15_000 })
    const seconds = Number(stdout.trim())
    return Number.isFinite(seconds) ? seconds : 0
  } catch { return 0 }
}

/** Longest stretch of the recording kept as the cloning reference: plenty for a likeness, small enough to send each time. */
export const CLONE_REFERENCE_SECONDS = 45

/** What the reference recording says; cloning is better with it, but works without. */
async function transcribeReference(path: string, key: string, signal?: AbortSignal): Promise<string> {
  const dir = join(draftsDir(), `${newId(6)}.transcribe`)
  await mkdir(dir, { recursive: true })
  try {
    const wav = join(dir, 'speech.wav')
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-loglevel', 'error', '-y', '-i', path, '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', wav], { timeout: 60_000 })
    const response = await fetch(`${openRouterBase()}/audio/transcriptions`, {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'microsoft/mai-transcribe-2', input_audio: { data: (await readFile(wav)).toString('base64'), format: 'wav' } })
    })
    if (!response.ok) return ''
    const body = await response.json() as { text?: unknown }
    return typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 4000) : ''
  } catch { return '' } finally { await rm(dir, { recursive: true, force: true }) }
}

/**
 * Clone a voice from a recording the user chose and attach it to the avatar.
 * Nothing is uploaded to keep: the trimmed recording stays with the avatar and
 * goes with each request (Fish Audio clones from it every time). One short
 * line is spoken right away to prove the recording works.
 */
export async function cloneVoice(id: unknown, samplePath: string, consent: unknown, signal?: AbortSignal): Promise<AvatarSummary[]> {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  if (consent !== true) throw new Error('Confirm this is your voice, or that you have the speaker’s permission, before cloning it.')
  const avatar = readAvatar(id)
  const extension = extname(samplePath).slice(1).toLowerCase()
  if (!VOICE_SAMPLE_EXTENSIONS.includes(extension)) throw new Error('Use an MP3, WAV or M4A recording.')
  const size = statSync(samplePath).size
  if (size > MAX_SAMPLE_BYTES) throw new Error('Use a recording under 20 MB (1-2 minutes is plenty).')
  const seconds = await audioSeconds(samplePath)
  if (seconds && seconds < 10) throw new Error('The recording needs at least 10 seconds of clear speech. 30-90 seconds works best.')
  const key = openRouterKey()
  // A clean, compact reference: mono, loudness-evened, at most CLONE_REFERENCE_SECONDS.
  const reference = join(avatarDir(id), 'voice-sample.new.mp3')
  try {
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-loglevel', 'error', '-y', '-i', samplePath, '-t', String(CLONE_REFERENCE_SECONDS), '-vn',
      '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', reference], { timeout: 120_000 })
  } catch {
    await rm(reference, { force: true })
    throw new Error('That recording could not be read. Try an MP3 or WAV file.')
  }
  try {
    const transcript = await transcribeReference(reference, key, signal)
    // Prove the clone speaks before replacing anything.
    await synthesizeSpeech({ model: OPENROUTER_MODELS.cloneTts, input: 'Voice ready.',
      references: [{ audio: new Uint8Array(await readFile(reference)), mime: 'audio/mpeg', transcript: transcript || undefined }] }, { key, signal })
    await rename(reference, voiceSamplePath(id))
    avatar.clonedVoice = { clonedAt: new Date().toISOString(), transcript }
    avatar.voice = { provider: 'clone', clonedAt: avatar.clonedVoice.clonedAt }
    avatar.consentAt ??= new Date().toISOString()
    await writeAvatar(avatar)
  } catch (error) {
    await rm(reference, { force: true })
    if (error instanceof OpenRouterMediaError && /request was rejected/.test(error.message)) throw new OpenRouterMediaError('OpenRouter could not clone that recording. Try a cleaner 30-90 second recording of one person speaking.')
    throw error
  }
  return listAvatars()
}
