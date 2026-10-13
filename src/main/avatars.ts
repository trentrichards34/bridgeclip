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

function parseAvatar(value: unknown, id: string): Avatar | null {
  try {
    const raw = value as Record<string, unknown>
    if (raw.id !== id || typeof raw.name !== 'string' || (raw.kind !== 'self' && raw.kind !== 'ai') || typeof raw.createdAt !== 'string') return null
    return {
      id, name: raw.name.slice(0, 60), kind: raw.kind, description: typeof raw.description === 'string' ? raw.description.slice(0, 600) : '',
      voice: parseVoice(raw.voice), consentAt: typeof raw.consentAt === 'string' ? raw.consentAt : null, createdAt: raw.createdAt
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

/** A normalized JPEG: upright, at most 1536px on the long side. */
function normalizePhoto(bytes: Buffer): Buffer {
  let image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('Could not read that image. Use a JPG or PNG photo.')
  const { width, height } = image.getSize()
  if (Math.min(width, height) < 384) throw new Error('That photo is too small. Use one at least 512 pixels wide.')
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
  return saveDraft(normalizePhoto(await readFile(path)))
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
  await writeAvatar({ id, name, kind, description, voice, consentAt: kind === 'self' ? new Date().toISOString() : null, createdAt: new Date().toISOString() })
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
    // A cloned voice can only be set by cloning, never named by the renderer.
    if (voice.provider === 'minimax-clone' && (avatar.voice.provider !== 'minimax-clone' || avatar.voice.voiceId !== voice.voiceId)) throw new Error('Clone a voice to use it.')
    avatar.voice = voice
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
  await falRun(FAL_MODELS.cloneTts, { prompt: 'Voice ready.', voice_setting: { voice_id: voiceId }, output_format: 'url' }, { key, signal, timeoutMs: 3 * 60_000 })
  avatar.voice = { provider: 'minimax-clone', voiceId, clonedAt: new Date().toISOString() }
  avatar.consentAt ??= new Date().toISOString()
  await writeAvatar(avatar)
  return listAvatars()
}
