/**
 * Avatar Studio: reusable AI avatars that read scripts as talking-head videos
 * or appear in cinematic scenes, finished with the clip engine's captions.
 * Generation runs on fal.ai with the user's own key; prices below are fal's
 * listed prices (October 2026) and only drive estimates shown to the user.
 */

export type AvatarKind = 'self' | 'ai'

/** A preset ElevenLabs voice (by name), or a MiniMax voice cloned from a sample. */
export type AvatarVoice =
  | { provider: 'elevenlabs'; voice: string }
  | { provider: 'minimax-clone'; voiceId: string; clonedAt: string }

export interface Avatar {
  id: string
  name: string
  kind: AvatarKind
  /** AI avatars: the description they were generated from. */
  description: string
  voice: AvatarVoice
  /** A voice cloned for this avatar, kept when a preset voice is chosen so it can be switched back. */
  clonedVoice: { voiceId: string; clonedAt: string } | null
  /** Own-likeness avatars and cloned voices record when consent was confirmed. */
  consentAt: string | null
  createdAt: string
}

/** What the renderer sees: the avatar plus a viewable portrait path. */
export interface AvatarSummary extends Avatar {
  portraitPath: string
}

export type AvatarVideoStyle = 'talking' | 'cinematic'
export type LipSyncModel = 'fabric' | 'omnihuman'

export interface AvatarScene {
  /** The words spoken over this scene. Scenes joined in order form the script. */
  narration: string
  /** What the camera sees, written as an image prompt. */
  visual: string
  /** True when the avatar appears in the shot; false for faceless b-roll style shots. */
  featuresAvatar: boolean
}

export interface AvatarScript {
  /** The hook text shown at the top of the video (2-7 words). */
  title: string
  scenes: AvatarScene[]
}

export interface AvatarScriptRequest {
  topic: string
  /** Optional niche or channel angle, e.g. "personal finance for 20-somethings". */
  niche: string
  seconds: ScriptLength
  style: AvatarVideoStyle
}

export const SCRIPT_LENGTHS = [15, 30, 45, 60] as const
export type ScriptLength = (typeof SCRIPT_LENGTHS)[number]

export interface AvatarRenderRequest {
  avatarId: string
  style: AvatarVideoStyle
  script: AvatarScript
  lipSync: LipSyncModel
  captionPreset: string
  includeCaptions: boolean
  includeTitle: boolean
  /** Background-library file looped under a talking head (gameplay split), or null. */
  backgroundVideo: string | null
}

export type AvatarRenderPhase = 'voice' | 'scenes' | 'animate' | 'assemble' | 'finish' | 'done' | 'failed' | 'cancelled'

export interface AvatarRenderStatus {
  id: string
  avatarId: string
  phase: AvatarRenderPhase
  /** Human-readable step, e.g. "Animating scene 2 of 4". */
  detail: string
  /** 0-100 across the whole render. */
  percent: number
  /** Finished video, inside the output folder. */
  outputPath: string | null
  error: string | null
  /** Set when the video finished with a compromise, e.g. captions could not be added. */
  warning: string | null
  estimatedCostUsd: number
  startedAt: string
}

/** ElevenLabs v3 voice names fal lists for fal-ai/elevenlabs/tts/eleven-v3. */
export const PRESET_VOICES = [
  { id: 'Brian', label: 'Brian', hint: 'Deep, narrator' },
  { id: 'Charlie', label: 'Charlie', hint: 'Natural, Australian' },
  { id: 'George', label: 'George', hint: 'Warm, British' },
  { id: 'Daniel', label: 'Daniel', hint: 'Authoritative, British' },
  { id: 'Eric', label: 'Eric', hint: 'Friendly, smooth' },
  { id: 'Chris', label: 'Chris', hint: 'Casual, natural' },
  { id: 'Liam', label: 'Liam', hint: 'Young, energetic' },
  { id: 'Will', label: 'Will', hint: 'Relaxed, friendly' },
  { id: 'Callum', label: 'Callum', hint: 'Intense, gravelly' },
  { id: 'Roger', label: 'Roger', hint: 'Laid-back' },
  { id: 'Bill', label: 'Bill', hint: 'Older, trustworthy' },
  { id: 'Sarah', label: 'Sarah', hint: 'Soft, reassuring' },
  { id: 'Jessica', label: 'Jessica', hint: 'Expressive, upbeat' },
  { id: 'Laura', label: 'Laura', hint: 'Bright, quirky' },
  { id: 'Aria', label: 'Aria', hint: 'Husky, expressive' },
  { id: 'Charlotte', label: 'Charlotte', hint: 'Smooth, Swedish accent' },
  { id: 'Alice', label: 'Alice', hint: 'Clear, British' },
  { id: 'Matilda', label: 'Matilda', hint: 'Warm, friendly' },
  { id: 'Lily', label: 'Lily', hint: 'Warm, British' },
  { id: 'River', label: 'River', hint: 'Calm, neutral' }
] as const
export const PRESET_VOICE_IDS: readonly string[] = PRESET_VOICES.map((voice) => voice.id)
export const DEFAULT_VOICE: AvatarVoice = { provider: 'elevenlabs', voice: 'Brian' }

/** fal endpoints. Kept together so a model swap is a one-line change. */
export const FAL_MODELS = {
  portrait: 'fal-ai/nano-banana-2',
  sceneEdit: 'fal-ai/nano-banana-2/edit',
  tts: 'fal-ai/elevenlabs/tts/eleven-v3',
  cloneTts: 'fal-ai/minimax/speech-2.8-hd',
  voiceClone: 'fal-ai/minimax/voice-clone',
  fabric: 'veed/fabric-1.0',
  omnihuman: 'fal-ai/bytedance/omnihuman/v1.5',
  imageToVideo: 'fal-ai/kling-video/v3/pro/image-to-video',
  /** Puts the avatar into the source video, keeping its scene, lighting and camera. */
  recreateReplace: 'fal-ai/wan/v2.2-14b/animate/replace',
  /** Drives the avatar's own photo with the source video's motion. */
  recreateMove: 'fal-ai/wan-motion'
} as const

/** USD list prices used for estimates. */
export const PRICES = {
  image: 0.08,
  ttsPer1000Chars: 0.1,
  voiceClone: 1.5,
  fabricPerSecond: 0.15,
  omnihumanPerSecond: 0.16,
  imageToVideoPerSecond: 0.112,
  /** Wan Animate bills per 16 frames: $0.08 per 16 frames at 720p. */
  replacePer16Frames: 0.08,
  /** Wan Motion bills $0.06 per second at 24 fps. */
  movePerSecond: 0.06
} as const

/** Lip-sync models accept up to a minute of audio. */
export const MAX_SPOKEN_SECONDS = 60
export const MAX_SCENES = 8
export const MIN_SCENE_SECONDS = 3
export const MAX_SCENE_SECONDS = 10
/** Typical narration pace used to estimate length before any audio exists. */
export const WORDS_PER_SECOND = 2.6
export const MAX_SCRIPT_CHARS = 1200
export const AI_PORTRAIT_CANDIDATES = 2

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

export function scriptText(script: AvatarScript): string {
  return script.scenes.map((scene) => scene.narration.trim()).filter(Boolean).join(' ')
}

export function estimateSpokenSeconds(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / WORDS_PER_SECOND))
}

/**
 * Seconds of footage per scene, in proportion to its narration and clamped to
 * what the image-to-video model renders. Durations are whole seconds.
 */
export function sceneDurations(scenes: readonly AvatarScene[], spokenSeconds: number): number[] {
  const words = scenes.map((scene) => Math.max(1, wordCount(scene.narration)))
  const total = words.reduce((sum, count) => sum + count, 0)
  return words.map((count) => Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Math.ceil((count / total) * spokenSeconds))))
}

export function estimateRenderCost(request: Pick<AvatarRenderRequest, 'style' | 'lipSync' | 'script'>): number {
  const text = scriptText(request.script)
  const seconds = estimateSpokenSeconds(text)
  const voice = (text.length / 1000) * PRICES.ttsPer1000Chars
  if (request.style === 'talking') {
    const perSecond = request.lipSync === 'omnihuman' ? PRICES.omnihumanPerSecond : PRICES.fabricPerSecond
    return round(voice + seconds * perSecond)
  }
  const footage = sceneDurations(request.script.scenes, seconds).reduce((sum, value) => sum + value, 0)
  return round(voice + request.script.scenes.length * PRICES.image + footage * PRICES.imageToVideoPerSecond)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

const ID = /^[a-z0-9]{8,40}$/

export function isAvatarId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.includes('\0')) return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : null
}

/**
 * Validate a script from the renderer or the model. Throws a user-facing
 * message. `allowLong` keeps over-length drafts (from the writer) editable
 * instead of discarding them; rendering always enforces the limit.
 */
export function parseAvatarScript(value: unknown, style: AvatarVideoStyle, allowLong = false): AvatarScript {
  if (!value || typeof value !== 'object') throw new Error('The script is missing.')
  const raw = value as { title?: unknown; scenes?: unknown }
  const title = cleanText(raw.title ?? '', 80)
  if (title === null) throw new Error('Keep the hook text under 80 characters.')
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) throw new Error('Write a script first.')
  if (raw.scenes.length > MAX_SCENES) throw new Error(`Use at most ${MAX_SCENES} scenes.`)
  const scenes = raw.scenes.map((scene, index): AvatarScene => {
    const item = (scene ?? {}) as { narration?: unknown; visual?: unknown; featuresAvatar?: unknown }
    const narration = cleanText(item.narration, MAX_SCRIPT_CHARS * (allowLong ? 3 : 1))
    const visual = cleanText(item.visual ?? '', 600)
    if (!narration) throw new Error(`Scene ${index + 1} has no narration.`)
    if (visual === null) throw new Error(`Scene ${index + 1}'s visual description is too long.`)
    if (style === 'cinematic' && !visual) throw new Error(`Describe what scene ${index + 1} shows.`)
    return { narration, visual, featuresAvatar: item.featuresAvatar !== false }
  })
  const script = { title, scenes }
  const text = scriptText(script)
  if (allowLong) {
    if (text.length > MAX_SCRIPT_CHARS * 3) throw new Error('The script came back far too long. Try again.')
    return script
  }
  if (text.length > MAX_SCRIPT_CHARS) throw new Error(`Keep the script under ${MAX_SCRIPT_CHARS} characters (about a minute).`)
  if (estimateSpokenSeconds(text) > MAX_SPOKEN_SECONDS) throw new Error('Keep the script to about a minute of speech.')
  return script
}

export function parseVoice(value: unknown): AvatarVoice {
  const raw = (value ?? {}) as { provider?: unknown; voice?: unknown; voiceId?: unknown; clonedAt?: unknown }
  if (raw.provider === 'elevenlabs' && typeof raw.voice === 'string' && PRESET_VOICE_IDS.includes(raw.voice)) return { provider: 'elevenlabs', voice: raw.voice }
  if (raw.provider === 'minimax-clone' && typeof raw.voiceId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(raw.voiceId) && typeof raw.clonedAt === 'string') {
    return { provider: 'minimax-clone', voiceId: raw.voiceId, clonedAt: raw.clonedAt }
  }
  throw new Error('Choose a voice for this avatar.')
}

/**
 * Word timings for captions. TTS speaks at an even pace, so each word gets a
 * share of the audio proportional to its length, with a short pause after
 * sentence and clause punctuation.
 */
export function estimateWordTimings(text: string, durationMs: number): { word: string; startMs: number; endMs: number }[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length || durationMs <= 0) return []
  const weight = (word: string): number => word.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[.!?]$/.test(word) ? 4 : /[,;:]$/.test(word) ? 2 : 0)
  const weights = words.map(weight)
  const total = weights.reduce((sum, value) => sum + value, 0)
  const timings: { word: string; startMs: number; endMs: number }[] = []
  let cursor = 0
  words.forEach((word, index) => {
    const span = (weights[index] / total) * durationMs
    const pause = /[.!?]$/.test(word) ? span * 0.35 : /[,;:]$/.test(word) ? span * 0.2 : 0
    const startMs = Math.round(cursor)
    const endMs = Math.max(startMs + 1, Math.round(cursor + span - pause))
    timings.push({ word, startMs, endMs })
    cursor += span
  })
  return timings
}

/** A safe folder name for one render, e.g. "2026-10-13 0931 Stop buying coffee". */
export function renderFolderName(title: string, date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const safe = title.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50)
  return safe ? `${stamp} ${safe}` : stamp
}

// ---------------------------------------------------------------------------
// Recreate: restage an existing video with the avatar (motion transfer)
// ---------------------------------------------------------------------------

export type RecreateMode = 'replace' | 'move'
export const RECREATE_MIN_SECONDS = 3
export const RECREATE_MAX_SECONDS = 30
/** Source footage is resampled to this rate: smooth motion without paying for 60 fps. */
export const RECREATE_FPS = 24

export interface AvatarRecreateRequest {
  avatarId: string
  /** A video the user picked (authorized in main) or a file in the output folder. */
  sourcePath: string
  startSeconds: number
  endSeconds: number
  mode: RecreateMode
  /** Keep the source's audio track (needed for captions). */
  keepAudio: boolean
  title: string
  captionPreset: string
  includeCaptions: boolean
  includeTitle: boolean
  /** The user confirmed they own the source video or have permission to use it. */
  rightsConfirmed: boolean
}

export function recreateSeconds(request: Pick<AvatarRecreateRequest, 'startSeconds' | 'endSeconds'>): number {
  return Math.max(0, request.endSeconds - request.startSeconds)
}

export function estimateRecreateCost(request: Pick<AvatarRecreateRequest, 'startSeconds' | 'endSeconds' | 'mode'>): number {
  const seconds = recreateSeconds(request)
  const cost = request.mode === 'replace'
    ? Math.ceil((seconds * RECREATE_FPS) / 16) * PRICES.replacePer16Frames
    : seconds * PRICES.movePerSecond
  return round(cost)
}

export function validateRecreateWindow(startSeconds: unknown, endSeconds: unknown, sourceSeconds: number): { startSeconds: number; endSeconds: number } {
  const start = typeof startSeconds === 'number' && Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : NaN
  const end = typeof endSeconds === 'number' && Number.isFinite(endSeconds) ? Math.min(endSeconds, sourceSeconds) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Choose a start and end time inside the video.')
  const length = end - start
  if (length < RECREATE_MIN_SECONDS) throw new Error(`Choose at least ${RECREATE_MIN_SECONDS} seconds of video.`)
  if (length > RECREATE_MAX_SECONDS + 0.05) throw new Error(`Choose at most ${RECREATE_MAX_SECONDS} seconds of video.`)
  return { startSeconds: Math.round(start * 100) / 100, endSeconds: Math.round(end * 100) / 100 }
}
