import { app } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { isAvatarId, parseVoice } from '../shared/avatars'
import { readAvatar, speechFor } from './avatars'
import { synthesizeSpeech, type SpeechRequest } from './openrouter-media'
import { loadSettings } from './settings-store'

/**
 * Short voice previews, so a voice can be heard before it is chosen. Every
 * sample is made through OpenRouter once (a fraction of a cent) and cached in
 * userData, so replaying it is free and instant.
 */
export const SAMPLE_TEXT = "Hey there! This is how I'll sound in your videos. Clear, natural, and ready to post."

export interface VoiceSampleDeps { speak?: typeof synthesizeSpeech }

const inflight = new Map<string, Promise<Uint8Array>>()

function cacheDir(): string { return join(app.getPath('userData'), 'voice-samples') }

/** What to say and with which voice, plus a cache id that changes whenever the voice does. */
async function plan(value: unknown): Promise<{ id: string; request: SpeechRequest }> {
  // Remix and Avatar Studio share the same voices: an ElevenLabs preset or an avatar's clone.
  const raw = (value ?? {}) as { kind?: unknown; voice?: unknown; avatarId?: unknown }
  if (raw.kind === 'avatar') {
    const voice = parseVoice(raw.voice)
    if (voice.provider === 'elevenlabs') {
      const request = await speechFor('', voice, SAMPLE_TEXT)
      return { id: `${request.model}:${request.voice}`, request }
    }
    // A cloned voice is this avatar's own recording.
    if (!isAvatarId(raw.avatarId)) throw new Error('Choose an avatar.')
    const clone = readAvatar(raw.avatarId).clonedVoice
    if (!clone) throw new Error('Clone a voice to hear it.')
    const request = await speechFor(raw.avatarId, voice, SAMPLE_TEXT)
    return { id: `${request.model}:${raw.avatarId}:${clone.clonedAt}`, request }
  }
  throw new Error('Choose a voice.')
}

/** The sample's MP3 bytes: from the cache, or made once and cached. */
export async function voiceSample(value: unknown, deps: VoiceSampleDeps = {}): Promise<Uint8Array> {
  const { id, request } = await plan(value)
  const file = join(cacheDir(), `${createHash('sha256').update(`${id}\n${SAMPLE_TEXT}`).digest('hex').slice(0, 32)}.mp3`)
  try { return new Uint8Array(await readFile(file)) } catch { /* not cached yet */ }
  // Two clicks on the same voice share one paid request.
  const running = inflight.get(file)
  if (running) return running
  const work = (async () => {
    const key = loadSettings().openrouterApiKey
    if (!key) throw new Error('Add your OpenRouter key in Settings → API keys to hear voices.')
    const bytes = await (deps.speak ?? synthesizeSpeech)(request, { key, signal: AbortSignal.timeout(90_000) })
    await mkdir(cacheDir(), { recursive: true })
    const partial = `${file}.${randomBytes(4).toString('hex')}.part`
    try {
      await writeFile(partial, bytes)
      await rename(partial, file)
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined)
      throw error
    }
    return bytes
  })()
  inflight.set(file, work)
  try { return await work } finally { inflight.delete(file) }
}
