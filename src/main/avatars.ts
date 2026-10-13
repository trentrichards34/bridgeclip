import { app, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { promisify } from 'util'
import {
  AI_PORTRAIT_CANDIDATES, FAL_MODELS, isAvatarId, parseVoice,
  type Avatar, type AvatarKind, type AvatarSummary, type AvatarVoice
} from '../shared/avatars'
import { downloadFalFile, falFileUrl, falInputUrl, falRun, FalError } from './fal'
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

export function portraitPath(id: string): string {
  return join(avatarDir(id), 'portrait.jpg')
}

function newId(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

function falKey(): string {
  const key = loadSettings().falApiKey
  if (!key) throw new Error('Add your fal.ai API key in Settings → API keys to use Avatar Studio.')
  return key
}

function parseClone(value: unknown): Avatar['clonedVoice'] {
  const raw = (value ?? {}) as { voiceId?: unknown; clonedAt?: unknown }
  return typeof raw.voiceId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(raw.voiceId) && typeof raw.clonedAt === 'string' ? { voiceId: raw.voiceId, clonedAt: raw.clonedAt } : null
}

function parseAvatar(value: unknown, id: string): Avatar | null {
  try {
    const raw = value as Record<string, unknown>
    if (raw.id !== id || typeof raw.name !== 'string' || (raw.kind !== 'self' && raw.kind !== 'ai') || typeof raw.createdAt !== 'string') return null
    return {
      id, name: raw.name.slice(0, 60), kind: raw.kind, description: typeof raw.description === 'string' ? raw.description.slice(0, 600) : '',
      voice: parseVoice(raw.voice), clonedVoice: parseClone(raw.clonedVoice) ?? (raw.voice && (raw.voice as { provider?: unknown }).provider === 'minimax-clone' ? parseClone(raw.voice) : null), consentAt: typeof raw.consentAt === 'string' ? raw.consentAt : null, createdAt: raw.createdAt
    }
  } catch { return null }
}

export function readAvatar(id: string): Avatar {
  let parsed: Avatar | null = null
  try { parsed = parseAvatar(JSON.parse(readFileSync(join(avatarDir(id), 'avatar.json'), 'utf8')), id) } catch { /* below */ }
  if (!parsed || !existsSync(portraitPath(id))) throw new Error('That avatar is no longer in your library.')
  return parsed
}

async function writeAvatar(avatar: Avatar): Promise<void> {
  const file = join(avatarDir(avatar.id), 'avatar.json')
  await writeFile(`${file}.tmp`, JSON.stringify(avatar, null, 2), { mode: 0o600 })
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
      avatars.push({ ...avatar, portraitPath: authorizeMedia(portraitPath(id)) })
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
  const key = falKey()
  const output = await falRun(FAL_MODELS.portrait, {
    prompt: portraitPrompt(description.trim()), aspect_ratio: '9:16', resolution: '1K', num_images: AI_PORTRAIT_CANDIDATES, output_format: 'jpeg'
  }, { key, signal, timeoutMs: 5 * 60_000 })
  const images = Array.isArray(output.images) ? output.images : []
  if (!images.length) throw new FalError('fal.ai returned no images. Try a different description.')
  const drafts: AvatarDraft[] = []
  await mkdir(draftsDir(), { recursive: true })
  for (const image of images.slice(0, AI_PORTRAIT_CANDIDATES)) {
    const url = falFileUrl({ images: [image] }, 'images')
    const temp = join(draftsDir(), `${newId(8)}.download`)
    await downloadFalFile(url, temp, { signal, maxBytes: 30_000_000 })
    try { drafts.push(await saveDraft(normalizePhoto(await readFile(temp)))) } finally { await rm(temp, { force: true }) }
  }
  return drafts
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
    // A cloned voice can only be this avatar's own clone, never one named by the renderer.
    if (voice.provider === 'minimax-clone') {
      if (!avatar.clonedVoice || avatar.clonedVoice.voiceId !== voice.voiceId) throw new Error('Clone a voice to use it.')
      avatar.voice = { provider: 'minimax-clone', ...avatar.clonedVoice }
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

/** The portrait as a model input URL. */
export async function portraitInput(id: string, key: string, signal?: AbortSignal): Promise<string> {
  return falInputUrl(await readFile(portraitPath(id)), 'image/jpeg', 'portrait.jpg', { key, signal })
}

async function audioSeconds(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(resolveBinary('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeout: 15_000 })
    const seconds = Number(stdout.trim())
    return Number.isFinite(seconds) ? seconds : 0
  } catch { return 0 }
}

const SAMPLE_TYPES: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' }

/**
 * Clone a voice from a recording the user chose and attach it to the avatar.
 * MiniMax deletes clones never used within 7 days, so one short line is
 * spoken right away to keep it.
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
  const key = falKey()
  const audioUrl = await falInputUrl(await readFile(samplePath), SAMPLE_TYPES[extension], `voice.${extension}`, { key, signal })
  const output = await falRun(FAL_MODELS.voiceClone, { audio_url: audioUrl, noise_reduction: true, need_volume_normalization: true }, { key, signal, timeoutMs: 5 * 60_000 })
  const voiceId = output.custom_voice_id
  if (typeof voiceId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(voiceId)) throw new FalError('fal.ai did not return a cloned voice. Try a cleaner recording.')
  // Save the paid clone before anything else can fail.
  const previous = { voice: avatar.voice, clonedVoice: avatar.clonedVoice }
  avatar.clonedVoice = { voiceId, clonedAt: new Date().toISOString() }
  avatar.voice = { provider: 'minimax-clone', ...avatar.clonedVoice }
  avatar.consentAt ??= new Date().toISOString()
  await writeAvatar(avatar)
  // One short line keeps the clone (MiniMax deletes clones unused for 7 days) and proves it speaks.
  try {
    await falRun(FAL_MODELS.cloneTts, { prompt: 'Voice ready.', voice_setting: { voice_id: voiceId }, output_format: 'url' }, { key, signal, timeoutMs: 3 * 60_000 })
  } catch (error) {
    if (error instanceof FalError && /could not process|could not finish/.test(error.message)) {
      Object.assign(avatar, previous)
      await writeAvatar(avatar)
      throw new FalError('The voice was cloned but fal.ai could not speak with it. Try a cleaner 30-90 second recording.')
    }
    // Network trouble: the clone is saved and the first video will use it.
  }
  return listAvatars()
}
