/**
 * B-roll video: the member's words (a voiceover they upload or record, or a script voiced with an AI voice, or both:
 * a script and their own recording of it) covered start to end with shots from their B-roll library, then captions,
 * hook text, motion graphics, music and voice cleanup. The result is a Library run whose one clip opens in the clip
 * editor (main: src/main/broll-video.ts; engine: engine/clip_engine/services/broll_video.py).
 *
 * Adding more b-roll and making the video again uses the new shots: the library is read each time.
 */

import { PRICES, presetVoiceId, wordCount, WORDS_PER_SECOND } from './avatars'
import { aiShotEstimateUsd, isLibraryItemId, isLibraryShotRef, type BrollAiSettings } from './broll-library'
import { isCaptionPresetId } from './caption-presets'
import { parseCtaChoice } from './ctas'
import { SCRIBE_PRICE_PER_SECOND } from './edit-recording'
import { DEFAULT_HEADLINE_LOOK, parseHeadlineLook, type HeadlineLook } from './headline-look'
import { parseAudioChoice, type AudioChoice } from './music'

export const BROLL_VIDEO_MIN_SECONDS = 3
export const BROLL_VIDEO_MAX_SECONDS = 3 * 60
export const BROLL_VIDEO_MAX_SCRIPT_CHARS = 2500
export const BROLL_VIDEO_MAX_TITLE_CHARS = 120
export const BROLL_VIDEO_MAX_HOOK_CHARS = 120
/** A recording made in the app: at most this many bytes (about 3 minutes of speech). */
export const BROLL_VIDEO_MAX_RECORDING_BYTES = 40 * 1024 * 1024
/** Audio or video files the voiceover can come from. */
export const BROLL_VIDEO_VOICE_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'opus', 'flac', 'webm', 'mp4', 'mov', 'm4v', 'mkv'] as const
/** The one planning call (a shot per phrase and the motion graphics), priced like the app's other short calls. */
export const BROLL_VIDEO_PLAN_ESTIMATE_USD = 0.01
/** Each phrase gets one shot, about this long (the engine's TARGET_SLOT_MS): how many shots a video needs. */
export const BROLL_VIDEO_SHOT_SECONDS = 2.6

export type BrollVoiceKind = 'recording' | 'script' | 'both'
export type BrollVideoVoice =
  /** Their own voiceover: a file they chose or a recording made in the app. */
  | { kind: 'recording'; path: string }
  /** A script voiced with a preset voice (OpenRouter speech). */
  | { kind: 'script'; script: string; voice: string }
  /** A script and their own recording of it: the recording is used, the script helps the transcription. */
  | { kind: 'both'; path: string; script: string }

export interface BrollVideoPick {
  /** The whole library (the default), or only the items and tags picked. */
  all: boolean
  itemIds: string[]
  tags: string[]
}

export interface BrollVideoLook {
  aspect: '9:16' | '16:9'
  captions: boolean
  captionPreset: string
  /** Hook text over the start ('' for none); its look carries "hide after". 9:16 only. */
  hookText: string
  hookLook: HeadlineLook
  /** Motion graphics, placed automatically on what is said (only words said). */
  graphics: boolean
  /** 0.2 s crossfades between shots instead of cuts. */
  crossfade: boolean
}

export interface BrollVideoRequest {
  title: string
  voice: BrollVideoVoice
  broll: BrollVideoPick
  /** Moments nothing in the library fits get a new AI shot (the library's AI settings; off by default). */
  fillWithAi: boolean
  look: BrollVideoLook
  audio: AudioChoice
  ctaId: string | null
}

export type BrollVideoPhase = 'voice' | 'listening' | 'planning' | 'making' | 'finishing' | 'done' | 'failed' | 'cancelled'

export interface BrollVideoShot {
  slot: number
  startMs: number
  endMs: number
  /** The library shot (`item:shot`), or null for an AI shot. */
  shotId: string | null
  ai: boolean
  reused: boolean
  /** What is said over it. */
  words: string
}

export interface BrollVideoStatus {
  id: string
  phase: BrollVideoPhase
  detail: string
  percent: number
  /** The run folder (once made) and the finished clip. */
  outputDir: string | null
  outputPath: string | null
  shots: BrollVideoShot[]
  error: string | null
  warnings: string[]
  /** What was paid so far, and the estimate shown before starting. */
  costUsd: number
  estimateUsd: number
  startedAt: string
}

export const DEFAULT_BROLL_HOOK_LOOK: HeadlineLook = { look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'dark', hideAfterS: 5 }

export function defaultBrollVideoLook(): BrollVideoLook {
  return { aspect: '9:16', captions: true, captionPreset: 'pop', hookText: '', hookLook: DEFAULT_BROLL_HOOK_LOOK, graphics: true, crossfade: false }
}

function text(value: unknown, max: number, label: string): string {
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.includes('\0'))) throw new Error(`Check the ${label}.`)
  // eslint-disable-next-line no-control-regex
  const clean = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
  if (clean.length > max) throw new Error(`Keep the ${label} under ${max} characters.`)
  return clean
}

/** The script as written (paragraphs kept), checked. */
export function cleanScript(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Write your script first.')
  // eslint-disable-next-line no-control-regex
  const script = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (wordCount(script) < 3) throw new Error('Write a few more words of your script.')
  if (script.length > BROLL_VIDEO_MAX_SCRIPT_CHARS) throw new Error(`Keep your script under ${BROLL_VIDEO_MAX_SCRIPT_CHARS.toLocaleString('en-US')} characters (about 3 minutes).`)
  return script
}

function voicePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.length > 4096) throw new Error('Choose your voiceover first, or record it.')
  const extension = value.split('.').pop()?.toLowerCase() ?? ''
  if (!(BROLL_VIDEO_VOICE_EXTENSIONS as readonly string[]).includes(extension)) throw new Error('Choose an audio or video file for your voiceover: MP3, M4A, WAV, MP4 or MOV.')
  return value
}

export function parseBrollVideoVoice(value: unknown): BrollVideoVoice {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  if (raw.kind === 'recording') return { kind: 'recording', path: voicePath(raw.path) }
  if (raw.kind === 'script') {
    const voice = presetVoiceId(raw.voice)
    if (!voice) throw new Error('Choose a voice for your script.')
    return { kind: 'script', script: cleanScript(raw.script), voice }
  }
  if (raw.kind === 'both') return { kind: 'both', path: voicePath(raw.path), script: cleanScript(raw.script) }
  throw new Error('Choose your voiceover, or write a script.')
}

export function parseBrollPick(value: unknown): BrollVideoPick {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  if (raw.all !== false) return { all: true, itemIds: [], tags: [] }
  const itemIds = Array.isArray(raw.itemIds) ? [...new Set(raw.itemIds.filter((id): id is string => isLibraryItemId(id) || isLibraryShotRef(id)))].slice(0, 2000) : []
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= 30).map((tag) => tag.toLowerCase()))].slice(0, 50) : []
  if (!itemIds.length && !tags.length) throw new Error('Pick some b-roll, or use your whole library.')
  return { all: false, itemIds, tags }
}

export function parseBrollVideoLook(value: unknown): BrollVideoLook {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const defaults = defaultBrollVideoLook()
  if (raw.aspect !== undefined && raw.aspect !== '9:16' && raw.aspect !== '16:9') throw new Error('Choose 9:16 or 16:9.')
  for (const key of ['captions', 'graphics', 'crossfade'] as const) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Error('Check the look settings.')
  if (raw.captionPreset !== undefined && !isCaptionPresetId(raw.captionPreset)) throw new Error('Choose a caption style.')
  let hookLook = defaults.hookLook
  if (raw.hookLook !== undefined) { try { hookLook = parseHeadlineLook(raw.hookLook) } catch { throw new Error('Choose the hook text’s look again.') } }
  return {
    aspect: raw.aspect === '16:9' ? '16:9' : '9:16',
    captions: raw.captions !== false,
    captionPreset: typeof raw.captionPreset === 'string' ? raw.captionPreset : defaults.captionPreset,
    hookText: text(raw.hookText, BROLL_VIDEO_MAX_HOOK_CHARS, 'hook text'),
    hookLook: hookLook ?? DEFAULT_HEADLINE_LOOK,
    graphics: raw.graphics !== false,
    crossfade: raw.crossfade === true
  }
}

/** The request from the page, checked (paths are checked again in main, against what the member chose there). */
export function parseBrollVideoRequest(value: unknown): BrollVideoRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose your voiceover, or write a script.')
  const raw = value as Record<string, unknown>
  if (raw.fillWithAi !== undefined && typeof raw.fillWithAi !== 'boolean') throw new Error('Choose whether to fill gaps with AI shots.')
  const audio: AudioChoice = parseAudioChoice((raw.audio && typeof raw.audio === 'object' ? raw.audio : {}) as Record<string, unknown>)
  return {
    title: text(raw.title, BROLL_VIDEO_MAX_TITLE_CHARS, 'title'),
    voice: parseBrollVideoVoice(raw.voice),
    broll: parseBrollPick(raw.broll),
    fillWithAi: raw.fillWithAi === true,
    look: parseBrollVideoLook(raw.look),
    audio,
    ctaId: parseCtaChoice(raw.ctaId)
  }
}

/** About how long a script takes to say (seconds). */
export function scriptSeconds(script: string): number {
  return Math.max(1, Math.round(wordCount(script) / WORDS_PER_SECOND))
}

export interface BrollVideoEstimate {
  voiceUsd: number
  transcribeUsd: number
  planUsd: number
  /** The most AI shots could cost (null when the model's price isn't listed; 0 when off). */
  aiUsd: number | null
  aiShots: number
  /** Everything but an unknown AI price. */
  totalUsd: number
}

/**
 * Before starting: voicing the script (preset voice list price), listening to the voiceover for word timings (Scribe),
 * the planning call, and at most the AI shots allowed. `seconds`: the voiceover's length (or the script's estimate).
 */
export function estimateBrollVideo(request: Pick<BrollVideoRequest, 'voice' | 'fillWithAi'>, seconds: number, ai: BrollAiSettings | null): BrollVideoEstimate {
  const voiceUsd = request.voice.kind === 'script' ? Math.max(0.01, (request.voice.script.length / 1000) * PRICES.ttsPer1000Chars) : 0
  const transcribeUsd = Math.max(0, seconds) * SCRIBE_PRICE_PER_SECOND
  const planUsd = BROLL_VIDEO_PLAN_ESTIMATE_USD
  const aiShots = request.fillWithAi && ai ? ai.maxShots : 0
  const one = ai ? aiShotEstimateUsd(ai) : null
  const aiUsd = aiShots === 0 ? 0 : one === null ? null : one * aiShots
  const totalUsd = Math.round((voiceUsd + transcribeUsd + planUsd + (aiUsd ?? 0)) * 10_000) / 10_000
  return { voiceUsd, transcribeUsd, planUsd, aiUsd, aiShots, totalUsd }
}

/** "about $0.03" style line for the start button's note. */
export function estimateLine(estimate: BrollVideoEstimate): string {
  const parts: string[] = []
  if (estimate.voiceUsd > 0) parts.push(`voicing your script about ${usd(estimate.voiceUsd)}`)
  parts.push(`listening for word timings ${usd(estimate.transcribeUsd)}`, `planning the shots and graphics about ${usd(estimate.planUsd)}`)
  if (estimate.aiShots > 0) parts.push(estimate.aiUsd === null ? `up to ${estimate.aiShots} AI shot${estimate.aiShots === 1 ? '' : 's'} (price on OpenRouter)` : `up to ${estimate.aiShots} AI shot${estimate.aiShots === 1 ? '' : 's'} at most ${usd(estimate.aiUsd)}`)
  return `On your OpenRouter key: ${parts.join(', ')}. Putting the video together is free.`
}

export function usd(value: number): string {
  if (value > 0 && value < 0.01) return 'under 1¢'
  return `$${value.toFixed(2)}`
}

/** How many shots the video needs, about (one per phrase). */
export function shotsNeeded(seconds: number): number {
  return Math.max(1, Math.round(seconds / BROLL_VIDEO_SHOT_SECONDS))
}

/** The shots a pick uses, from the library's catalog lines (`item:shot` ids and their tags). */
export function pickedShots(catalog: readonly { id: string; tags: readonly string[] }[], pick: BrollVideoPick): string[] {
  if (pick.all) return catalog.map((shot) => shot.id)
  const items = new Set(pick.itemIds)
  const tags = new Set(pick.tags)
  return catalog.filter((shot) => items.has(shot.id) || items.has(shot.id.split(':')[0]) || shot.tags.some((tag) => tags.has(tag.toLowerCase()))).map((shot) => shot.id)
}

/** A title for the Library: the member's, else the hook text, else the first words said. */
export function brollVideoTitle(request: Pick<BrollVideoRequest, 'title' | 'look' | 'voice'>, firstWords = ''): string {
  const pick = request.title || request.look.hookText || (request.voice.kind !== 'recording' ? request.voice.script : firstWords)
  const words = pick.replace(/\s+/g, ' ').trim().split(' ').slice(0, 10).join(' ')
  return words.slice(0, BROLL_VIDEO_MAX_TITLE_CHARS) || 'B-roll video'
}
