/**
 * Remix: turn someone else's viral moment into the user's own commentary video.
 * The engine (engine/clip_engine/services/remix_service.py) plans and renders;
 * every model call goes through OpenRouter, stock B-roll through Pexels.
 */

export type RemixAngle = 'reaction' | 'myth_truth' | 'science' | 'lessons' | 'do_this_instead'

export const REMIX_ANGLES: { id: RemixAngle; label: string; description: string; example: string }[] = [
  { id: 'reaction', label: 'Reaction take', description: 'Agree and add to it, disagree and correct it, or add the missing nuance, in your brand’s voice.', example: '“He’s half right. Here’s what he left out…”' },
  { id: 'myth_truth', label: 'Myth vs. truth', description: 'The moment states a common belief; your presenter breaks it down and gives the truth.', example: '“You don’t need to lose weight first. Here’s why.”' },
  { id: 'science', label: 'The science behind it', description: 'Explain why what happens in the moment works, or why it fails, in plain language.', example: '“Here’s why that actually works…”' },
  { id: 'lessons', label: 'Lessons from this', description: 'Two or three practical lessons your audience can take from the moment.', example: '“3 things this teaches you about…”' },
  { id: 'do_this_instead', label: 'Do this instead', description: 'What they did, why it falls short, and the better way you teach.', example: '“Don’t do that. Do this instead.”' }
]

/** lipsync: lip-synced avatar on camera; still: the avatar photo with a slow push-in; voice: voice-over only (cheapest). */
export type RemixHost = 'lipsync' | 'still' | 'voice'
export const REMIX_HOSTS: { id: RemixHost; label: string; detail: string }[] = [
  { id: 'lipsync', label: 'Avatar on camera', detail: 'Lip-synced talking head for the opening and closing lines' },
  { id: 'still', label: 'Avatar photo', detail: 'Your avatar’s photo with the voice, no lip-sync' },
  { id: 'voice', label: 'Voice only', detail: 'Voice-over on B-roll and stills, cheapest' }
]

/** OpenAI voices on OpenRouter (gpt-4o-mini-tts). */
export const REMIX_VOICES: { id: string; label: string; detail: string }[] = [
  { id: 'onyx', label: 'Onyx', detail: 'Deep, steady (male)' },
  { id: 'ash', label: 'Ash', detail: 'Clear, confident (male)' },
  { id: 'echo', label: 'Echo', detail: 'Warm, even (male)' },
  { id: 'verse', label: 'Verse', detail: 'Expressive (male)' },
  { id: 'ballad', label: 'Ballad', detail: 'Soft, storytelling (male)' },
  { id: 'nova', label: 'Nova', detail: 'Bright, upbeat (female)' },
  { id: 'coral', label: 'Coral', detail: 'Friendly, energetic (female)' },
  { id: 'shimmer', label: 'Shimmer', detail: 'Light, warm (female)' },
  { id: 'sage', label: 'Sage', detail: 'Calm, thoughtful (female)' },
  { id: 'alloy', label: 'Alloy', detail: 'Neutral' },
  { id: 'fable', label: 'Fable', detail: 'Animated, British' }
]
export const REMIX_VOICE_IDS: readonly string[] = REMIX_VOICES.map((voice) => voice.id)

export const MAX_REMIXES = 10
export const MAX_BRAND_IDENTITY_CHARS = 40000

/** Estimates for the cost preview (OpenRouter prices, October 2026). */
export const REMIX_PRICES = {
  /** HeyGen Avatar IV, per second of on-camera speech. */
  avatarPerSecond: 0.05,
  /** The avatar is on camera for the opening and closing lines: about 10-23 seconds per remix. */
  onCameraSecondsLow: 10,
  onCameraSecondsHigh: 23,
  /** Voice for ~30 seconds of narration. */
  voicePerRemix: 0.01,
  /** Transcribing and planning, per hour of source video. */
  sourcePerHour: 0.35
}

/** Per-remix range (the avatar's speaking time varies) and the total at the high end. */
export function estimateRemixCost(host: RemixHost, count: number, sourceHours = 0.5): { perRemixLow: number; perRemixHigh: number; total: number } {
  const avatar = (seconds: number): number => host === 'lipsync' ? seconds * REMIX_PRICES.avatarPerSecond : 0
  const perRemixLow = REMIX_PRICES.voicePerRemix + avatar(REMIX_PRICES.onCameraSecondsLow)
  const perRemixHigh = REMIX_PRICES.voicePerRemix + avatar(REMIX_PRICES.onCameraSecondsHigh)
  return { perRemixLow, perRemixHigh, total: perRemixHigh * count + REMIX_PRICES.sourcePerHour * Math.max(0.1, sourceHours) }
}

export interface BrandIdentity {
  id: string
  name: string
  /** The identity document as text: beliefs, myths, method, proof, voice. */
  text: string
  createdAt: string
  updatedAt: string
}

export interface RemixRequest {
  /** A video link, or a local file chosen with dialog.selectVideo. */
  source: string
  /** The original creator, for the on-screen credit (filled from the link when blank). */
  creator: string
  angle: RemixAngle
  host: RemixHost
  avatarId: string | null
  voice: string
  brandIdentityId: string | null
  count: number
  captionPreset: string
  includeCaptions: boolean
  /** The user confirmed they'll turn on the platform's AI-content label when posting. */
  aiLabelAck: boolean
}

export interface RemixCheck { id: string; ok: boolean; label: string }

export interface RemixOutput {
  path: string
  manifestPath: string
  headline: string
  stance: 'agree_extend' | 'disagree_correct' | 'add_nuance'
  excerptSeconds: number
  durationSeconds: number
  costUsd: number
  checks: RemixCheck[]
  warnings: string[]
}

export type RemixPhase = 'running' | 'done' | 'failed' | 'cancelled'

export interface RemixStatus {
  id: string
  phase: RemixPhase
  detail: string
  percent: number
  folder: string
  estimateUsd: number
  outputs: RemixOutput[]
  costUsd: number | null
  warnings: string[]
  error: string | null
}

export const STANCE_LABELS: Record<RemixOutput['stance'], string> = {
  agree_extend: 'Agrees and adds to it',
  disagree_correct: 'Disagrees and corrects it',
  add_nuance: 'Adds nuance'
}

export function isRemixAngle(value: unknown): value is RemixAngle {
  return REMIX_ANGLES.some((angle) => angle.id === value)
}

export function isRemixHost(value: unknown): value is RemixHost {
  return REMIX_HOSTS.some((host) => host.id === value)
}

/** A public http(s) video link without credentials, or null. */
export function remixSourceUrl(value: string): string | null {
  if (value.length > 8192) return null
  try {
    const url = new URL(value.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return null
    return url.toString()
  } catch { return null }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The engine's result for one remix, parsed defensively (it crosses a process boundary). */
export function parseRemixOutput(value: unknown): RemixOutput | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.path !== 'string' || typeof raw.manifest_path !== 'string') return null
  const stance = raw.stance === 'agree_extend' || raw.stance === 'disagree_correct' ? raw.stance : 'add_nuance'
  const checks = Array.isArray(raw.checks) ? raw.checks.flatMap((item): RemixCheck[] => {
    if (!item || typeof item !== 'object') return []
    const check = item as Record<string, unknown>
    return typeof check.id === 'string' && typeof check.label === 'string' ? [{ id: check.id.slice(0, 40), ok: check.ok === true, label: text(check.label, 200) }] : []
  }).slice(0, 12) : []
  return {
    path: raw.path, manifestPath: raw.manifest_path, headline: text(raw.headline, 200), stance,
    excerptSeconds: number(raw.excerpt_seconds), durationSeconds: number(raw.duration_seconds), costUsd: number(raw.cost_usd),
    checks, warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === 'string').map((w) => text(w, 400)).slice(0, 8) : []
  }
}
