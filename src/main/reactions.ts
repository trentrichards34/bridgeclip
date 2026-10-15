import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { promisify } from 'util'
import {
  isAvatarId, isReactionId, OPENROUTER_MODELS, REACTION_SECONDS, REACTIONS,
  type AvatarSummary, type ReactionId
} from '../shared/avatars'
import { listAvatars, openRouterKey, portraitBytes, reactionsDir, readAvatar, readReactions, withReactionsLock } from './avatars'
import { logger } from './logger'
import { generateVideo, type MediaOptions } from './openrouter-media'
import { resolveBinary } from './tools'

const execFileAsync = promisify(execFile)

/**
 * The avatar's silent reaction clips: generated once from its picture (Kling on
 * OpenRouter, image-to-video, no speech) or uploaded from the member's phone.
 * Every clip is stored the same way: 1080x1920, 30 fps, no audio.
 */
export const REACTION_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm']
const MAX_UPLOAD_BYTES = 300_000_000
const MAX_OWN_SECONDS = 10
const CONCURRENCY = 3
const making = new Set<string>()
const uploading = new Set<string>()

export function reactionPrompt(reaction: (typeof REACTIONS)[number]): string {
  return `The same person from the photo ${reaction.prompt}. They do not speak: no talking or lip movement. ` +
    'Locked-off camera, the same framing, background and lighting as the photo, realistic natural motion, vertical 9:16.'
}

/** Normalize any clip into the library format: cover-cropped 1080x1920, 30 fps, silent, at most `seconds`. */
async function normalize(input: string, output: string, seconds: number): Promise<void> {
  try {
    await execFileAsync(resolveBinary('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe,fd', '-format_whitelist', 'mov,matroska,webm,avi,flv,mpegts',
      '-i', input, '-t', String(seconds), '-an',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', output], { timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 })
  } catch {
    throw new Error('That video could not be read. Try an MP4 or MOV from your phone.')
  }
}

async function writeMeta(id: string, kind: ReactionId, source: 'ai' | 'own'): Promise<void> {
  const file = join(reactionsDir(id), 'reactions.json')
  let meta: Record<string, string> = {}
  try { meta = JSON.parse(await readFile(file, 'utf8')) as Record<string, string> } catch { /* first one */ }
  meta[kind] = source
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(meta, null, 2))
  await rename(temp, file)
}

async function save(id: string, kind: ReactionId, clip: string, source: 'ai' | 'own', seconds: number): Promise<void> {
  const dir = reactionsDir(id)
  const normalized = join(dir, `.${kind}-${randomBytes(4).toString('hex')}.mp4`)
  try {
    await normalize(clip, normalized, seconds)
    // Installing the clip and recording where it came from happen together, one change at a time per avatar
    // (other reactions finishing, a picture switch), so none is lost or overwritten.
    await withReactionsLock(id, async () => {
      await rename(normalized, join(dir, `${kind}.mp4`))
      await writeMeta(id, kind, source)
    })
  } finally { await rm(normalized, { force: true }) }
}

export interface MakeReactionsResult { avatars: AvatarSummary[]; made: number; failed: string[]; error?: string }

/**
 * Generate the reactions this avatar doesn't have yet (or the ones named), a few
 * at a time. A reaction that fails is reported; the others are kept.
 */
export async function makeReactions(id: unknown, kinds?: unknown, deps: { generate?: typeof generateVideo } = {}): Promise<MakeReactionsResult> {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  readAvatar(id)
  const have = new Set(readReactions(id).map((reaction) => reaction.id))
  const wanted = Array.isArray(kinds) ? kinds.filter(isReactionId) : REACTIONS.map((reaction) => reaction.id).filter((kind) => !have.has(kind))
  if (!wanted.length) return { avatars: await listAvatars(), made: 0, failed: [] }
  if (making.has(id)) throw new Error('This avatar’s reactions are already being made. They’ll appear when they’re ready.')
  const options: MediaOptions = { key: openRouterKey(), timeoutMs: 20 * 60_000 }
  making.add(id)
  const dir = reactionsDir(id)
  await mkdir(dir, { recursive: true })
  const frame = { bytes: await portraitBytes(id), mime: 'image/jpeg' }
  const failed: string[] = []
  let made = 0
  let stopped: string | undefined
  try {
    const queue = [...wanted]
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let kind = queue.shift(); kind; kind = queue.shift()) {
        const reaction = REACTIONS.find((item) => item.id === kind)
        if (!reaction) continue
        const raw = join(dir, `.${kind}-raw-${randomBytes(4).toString('hex')}.mp4`)
        try {
          await (deps.generate ?? generateVideo)({
            model: OPENROUTER_MODELS.sceneStandard, prompt: reactionPrompt(reaction), aspectRatio: '9:16',
            duration: REACTION_SECONDS, generateAudio: false, firstFrame: frame
          }, raw, options)
          await save(id, reaction.id, raw, 'ai', REACTION_SECONDS)
          made++
        } catch (error) {
          logger.warn('avatar.reaction.failed', { kind, message: String((error as Error)?.message ?? error).slice(0, 200) })
          failed.push(reaction.label)
          const message = String((error as Error)?.message ?? '')
          if (/API key|credits/.test(message)) {
            // Stop starting new ones; the ones already running finish and are kept.
            queue.length = 0
            stopped = message
          }
        } finally { await rm(raw, { force: true }) }
      }
    }))
  } finally { making.delete(id) }
  return { avatars: await listAvatars(), made, failed, ...(stopped ? { error: stopped } : {}) }
}

/** Use the member's own recording (first 10 seconds, silent) for one reaction. */
export async function uploadReaction(id: unknown, kind: unknown, path: string): Promise<AvatarSummary[]> {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  if (!isReactionId(kind)) throw new Error('Choose a reaction.')
  readAvatar(id)
  if (!REACTION_VIDEO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) throw new Error('Choose a video (MP4, MOV or WebM).')
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_UPLOAD_BYTES) throw new Error('Choose a video under 300 MB (a few seconds is plenty).')
  await mkdir(reactionsDir(id), { recursive: true })
  uploading.add(id)
  try { await save(id, kind, path, 'own', MAX_OWN_SECONDS) } finally { uploading.delete(id) }
  return listAvatars()
}

export async function removeReaction(id: unknown, kind: unknown): Promise<AvatarSummary[]> {
  if (!isAvatarId(id)) throw new Error('Invalid avatar')
  if (!isReactionId(kind)) throw new Error('Choose a reaction.')
  await withReactionsLock(id, () => rm(join(reactionsDir(id), `${kind}.mp4`), { force: true }))
  return listAvatars()
}

/** Reactions being made or uploaded for this avatar (its picture can't change meanwhile). */
export function reactionsInProgress(id: string): boolean {
  return making.has(id) || uploading.has(id)
}
