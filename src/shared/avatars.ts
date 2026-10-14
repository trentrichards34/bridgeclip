/**
 * Avatar Studio: reusable AI avatars that read scripts as talking-head videos
 * or appear in cinematic scenes, finished with the clip engine's captions.
 * Generation runs on OpenRouter with the user's own key (Recreate alone still
 * uses fal.ai); prices below are list prices (October 2026) and only drive the
 * estimates shown to the user.
 */

import { PRESET_VOICE_IDS } from './voices'

export { PRESET_VOICES, PRESET_VOICE_IDS } from './voices'

export type AvatarKind = 'self' | 'ai'

/**
 * A preset ElevenLabs voice (by name), or the avatar's own cloned voice: its
 * recording is kept with the avatar and sent with each request (Fish Audio
 * clones from a reference every time, so there is no stored voice id).
 */
export type AvatarVoice =
  | { provider: 'elevenlabs'; voice: string }
  | { provider: 'clone'; clonedAt: string }

export interface Avatar {
  id: string
  name: string
  kind: AvatarKind
  /** AI avatars: the description they were generated from. */
  description: string
  voice: AvatarVoice
  /** A voice cloned for this avatar, kept when a preset voice is chosen so it can be switched back. */
  clonedVoice: { clonedAt: string; transcript: string } | null
  /** Own-likeness avatars and cloned voices record when consent was confirmed. */
  consentAt: string | null
  createdAt: string
}

/** What the renderer sees: the avatar plus a viewable portrait path. */
export interface AvatarSummary extends Avatar {
  portraitPath: string
}

export type AvatarVideoStyle = 'talking' | 'cinematic'
/** Talking heads: HeyGen Avatar IV on OpenRouter (the earlier fal models are gone). */
export type LipSyncModel = 'avatar-iv'
/** Image-to-video tier for cinematic scenes. */
export type SceneQuality = 'standard' | 'pro'

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
  /** Write in this brand's voice and beliefs, using only its proof (see Remix → Brand Identity). */
  brandIdentityId?: string | null
}

export const SCRIPT_LENGTHS = [15, 30, 45, 60] as const
export type ScriptLength = (typeof SCRIPT_LENGTHS)[number]

export interface AvatarRenderRequest {
  avatarId: string
  style: AvatarVideoStyle
  script: AvatarScript
  lipSync: LipSyncModel
  sceneQuality: SceneQuality
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

export const DEFAULT_VOICE: AvatarVoice = { provider: 'elevenlabs', voice: 'Brian' }
/** Voices the fal version offered that OpenRouter doesn't: the closest match. */
export const RETIRED_VOICES: Record<string, string> = { aria: 'Bella', charlotte: 'Alice' }

/** OpenRouter models. Kept together so a model swap is a one-line change. */
export const OPENROUTER_MODELS = {
  /** Nano Banana 2: faces and scene stills (keeps the avatar's face from its photo). */
  image: 'google/gemini-3.1-flash-image',
  tts: 'elevenlabs/eleven-v3',
  /** Clones from the avatar's recording on every request. */
  cloneTts: 'fish-audio/s2.1-pro',
  talking: 'heygen/avatar-iv',
  sceneStandard: 'kwaivgi/kling-v3.0-std',
  scenePro: 'kwaivgi/kling-v3.0-pro'
} as const

/** Recreate is the one feature still on fal.ai (OpenRouter has no documented video-reference input yet). */
export const FAL_MODELS = {
  /** Kling motion control: the avatar's photo performs the source video's motion. */
  recreateMotion: 'fal-ai/kling-video/v3/standard/motion-control',
  /** Puts the avatar into the source video, keeping its scene, lighting and camera. */
  recreateReplace: 'fal-ai/wan/v2.2-14b/animate/replace',
  /** Drives the avatar's own photo with the source video's motion. */
  recreateMove: 'fal-ai/wan-motion'
} as const

/** USD list prices used for estimates. */
export const PRICES = {
  /** Nano Banana 2, one 1K image (about 1,300 output tokens at $0.00006). */
  image: 0.08,
  /** ElevenLabs v3 list price ($80 per million characters). */
  ttsPer1000Chars: 0.08,
  /** Fish Audio S2.1 Pro ($15 per million characters). */
  cloneTtsPer1000Chars: 0.015,
  /** HeyGen Avatar IV. */
  talkingPerSecond: 0.05,
  imageToVideoPerSecond: 0.112,
  imageToVideoStandardPerSecond: 0.084,
  motionControlPerSecond: 0.126,
  /** Wan Animate bills per 16 frames: $0.08 per 16 frames at 720p. */
  replacePer16Frames: 0.08,
  /** Wan Motion bills $0.06 per second at 24 fps. */
  movePerSecond: 0.06
} as const

/** Lip-sync models accept just under a minute of audio (OmniHuman: under 60s at 720p). */
export const MAX_SPOKEN_SECONDS = 58
export const MAX_SCENES = 8
export const MIN_SCENE_SECONDS = 3
export const MAX_SCENE_SECONDS = 15
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

/** 1-based numbers of cinematic scenes whose narration runs longer than one generated shot. */
export function overlongScenes(script: AvatarScript): number[] {
  const seconds = estimateSpokenSeconds(scriptText(script))
  const words = script.scenes.map((scene) => Math.max(1, wordCount(scene.narration)))
  const total = words.reduce((sum, value) => sum + value, 0)
  return words.flatMap((count, index) => (count / total) * seconds > MAX_SCENE_SECONDS ? [index + 1] : [])
}

export function estimateRenderCost(request: Pick<AvatarRenderRequest, 'style' | 'script'> & { lipSync?: LipSyncModel; sceneQuality?: SceneQuality }): number {
  const text = scriptText(request.script)
  const seconds = estimateSpokenSeconds(text)
  const voice = (text.length / 1000) * PRICES.ttsPer1000Chars
  if (request.style === 'talking') return round(voice + seconds * PRICES.talkingPerSecond)
  const footage = sceneDurations(request.script.scenes, seconds).reduce((sum, value) => sum + value, 0)
  const perSecond = request.sceneQuality === 'pro' ? PRICES.imageToVideoPerSecond : PRICES.imageToVideoStandardPerSecond
  return round(voice + request.script.scenes.length * PRICES.image + footage * perSecond)
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

/** A preset voice by name in any case, with retired voices mapped to their closest match; null if unknown. */
export function presetVoiceId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase()
  return PRESET_VOICE_IDS.find((id) => id.toLowerCase() === lower) ?? RETIRED_VOICES[lower] ?? null
}

export function parseVoice(value: unknown): AvatarVoice {
  const raw = (value ?? {}) as { provider?: unknown; voice?: unknown; clonedAt?: unknown }
  const preset = raw.provider === 'elevenlabs' ? presetVoiceId(raw.voice) : null
  if (preset) return { provider: 'elevenlabs', voice: preset }
  if (raw.provider === 'clone' && typeof raw.clonedAt === 'string' && raw.clonedAt.length <= 40) return { provider: 'clone', clonedAt: raw.clonedAt }
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

/** replace: swap into the scene (Wan Animate); move: Wan Motion; motion: Kling motion control. */
export type RecreateMode = 'replace' | 'move' | 'motion'
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
    : request.mode === 'motion' ? seconds * PRICES.motionControlPerSecond : seconds * PRICES.movePerSecond
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
