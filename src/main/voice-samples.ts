import { app } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { FAL_MODELS, parseVoice } from '../shared/avatars'
import { REMIX_VOICE_IDS } from '../shared/remix'
import { downloadFalFile, falFileUrl, falRun } from './fal'
import { loadSettings } from './settings-store'

/**
 * Short voice previews, so a voice can be heard before it is chosen. Each
 * sample is generated once (a fraction of a cent) and cached in userData, so
 * replaying it is free and instant.
 */
export const SAMPLE_TEXT = "Hey there! This is how I'll sound in your videos. Clear, natural, and ready to post."
/** Must match the engine's remix_service.TTS_MODEL. */
export const REMIX_TTS_MODEL = 'openai/gpt-4o-mini-tts-2025-12-15'
const MAX_SAMPLE_BYTES = 3_000_000

export interface VoiceSampleDeps { fetch?: typeof fetch; falRun?: typeof falRun; download?: typeof downloadFalFile }

type Plan = { id: string; make: (destination: string) => Promise<void> }

const inflight = new Map<string, Promise<Uint8Array>>()

function cacheDir(): string { return join(app.getPath('userData'), 'voice-samples') }

function plan(value: unknown, deps: VoiceSampleDeps): Plan {
  const raw = (value ?? {}) as { kind?: unknown; voice?: unknown }
  if (raw.kind === 'avatar') {
    // Avatar Studio voices: ElevenLabs presets and cloned voices, both on fal.
    const voice = parseVoice(raw.voice)
    const run = deps.falRun ?? falRun
    const download = deps.download ?? downloadFalFile
    return {
      id: voice.provider === 'elevenlabs' ? `fal:${FAL_MODELS.tts}:${voice.voice}` : `fal:${FAL_MODELS.cloneTts}:${voice.voiceId}`,
      make: async (destination) => {
        const key = loadSettings().falApiKey
        if (!key) throw new Error('Add your fal.ai key in Settings → API keys to hear voices.')
        const output = voice.provider === 'elevenlabs'
          ? await run(FAL_MODELS.tts, { text: SAMPLE_TEXT, voice: voice.voice, stability: 0.5 }, { key, timeoutMs: 90_000 })
          : await run(FAL_MODELS.cloneTts, { prompt: SAMPLE_TEXT, voice_setting: { voice_id: voice.voiceId }, output_format: 'url' }, { key, timeoutMs: 90_000 })
        await download(falFileUrl(output, 'audio'), destination, { maxBytes: MAX_SAMPLE_BYTES })
      }
    }
  }
  if (raw.kind === 'remix') {
    // Remix voices: OpenAI voices through OpenRouter, the same model the engine uses.
    if (typeof raw.voice !== 'string' || !REMIX_VOICE_IDS.includes(raw.voice)) throw new Error('Choose a voice.')
    const voice = raw.voice
    return {
      id: `openrouter:${REMIX_TTS_MODEL}:${voice}`,
      make: async (destination) => {
        const key = loadSettings().openrouterApiKey
        if (!key) throw new Error('Add your OpenRouter key in Settings → API keys to hear voices.')
        const doFetch = deps.fetch ?? fetch
        const endpoint = app.isPackaged ? 'https://openrouter.ai/api/v1/audio/speech'
          : process.env.BRIDGECLIP_E2E_OPENROUTER_TTS_URL || 'https://openrouter.ai/api/v1/audio/speech'
        let response: Response
        try {
          response = await doFetch(endpoint, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'CreatorClips voice preview' },
            body: JSON.stringify({ model: REMIX_TTS_MODEL, input: SAMPLE_TEXT, voice, response_format: 'mp3',
              instructions: 'Speak like a confident, friendly creator talking to camera: natural pace, no announcer voice.' })
          })
        } catch { throw new Error('OpenRouter could not be reached. Check your connection and try again.') }
        if (!response.ok) {
          throw new Error(response.status === 401 ? 'OpenRouter rejected the API key. Check it in Settings → API keys.'
            : response.status === 402 ? 'OpenRouter reports insufficient credits. Add credits at openrouter.ai/credits.'
              : response.status === 429 ? 'OpenRouter is busy. Try the preview again in a moment.'
                : `OpenRouter could not make the preview (${response.status}).`)
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length === 0 || bytes.length > MAX_SAMPLE_BYTES) throw new Error('OpenRouter returned an unusable preview.')
        await writeFile(destination, bytes)
      }
    }
  }
  throw new Error('Choose a voice.')
}

/** The sample's MP3 bytes: from the cache, or generated once and cached. */
export async function voiceSample(value: unknown, deps: VoiceSampleDeps = {}): Promise<Uint8Array> {
  const { id, make } = plan(value, deps)
  const file = join(cacheDir(), `${createHash('sha256').update(`${id}\n${SAMPLE_TEXT}`).digest('hex').slice(0, 32)}.mp3`)
  try { return new Uint8Array(await readFile(file)) } catch { /* not cached yet */ }
  // Two clicks on the same voice share one paid request.
  const running = inflight.get(file)
  if (running) return running
  const work = (async () => {
    await mkdir(cacheDir(), { recursive: true })
    const partial = `${file}.${randomBytes(4).toString('hex')}.part`
    try {
      await make(partial)
      await rename(partial, file)
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined)
      throw error
    }
    return new Uint8Array(await readFile(file))
  })()
  inflight.set(file, work)
  try { return await work } finally { inflight.delete(file) }
}
