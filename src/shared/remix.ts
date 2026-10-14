/**
 * Remix: turn someone else's viral moment into the user's own commentary video.
 * The engine (engine/clip_engine/services/remix_service.py) plans and renders;
 * every model call goes through OpenRouter, stock B-roll through Pexels.
 */

import type { HeadlineLook } from './headline-look'
import { PRESET_VOICE_IDS, PRESET_VOICES } from './voices'

export type RemixStyle = 'reaction' | 'myth_truth' | 'science' | 'lessons' | 'do_this_instead'
/** A style, or 'mix': the AI picks a fitting style per moment so the account doesn't repeat one template. */
export type RemixAngle = RemixStyle | 'mix'

export const REMIX_ANGLES: { id: RemixAngle; label: string; description: string; example: string }[] = [
  { id: 'reaction', label: 'Reaction take', description: 'Agree and add to it, disagree and correct it, or add the missing nuance, in your brand’s voice.', example: '“He’s half right. Here’s what he left out…”' },
  { id: 'myth_truth', label: 'Myth vs. truth', description: 'The moment states a common belief; your presenter breaks it down and gives the truth.', example: '“You don’t need to lose weight first. Here’s why.”' },
  { id: 'science', label: 'The science behind it', description: 'Explain why what happens in the moment works, or why it fails, in plain language.', example: '“Here’s why that actually works…”' },
  { id: 'lessons', label: 'Lessons from this', description: 'Two or three practical lessons your audience can take from the moment.', example: '“3 things this teaches you about…”' },
  { id: 'do_this_instead', label: 'Do this instead', description: 'What they did, why it falls short, and the better way you teach.', example: '“Don’t do that. Do this instead.”' },
  { id: 'mix', label: 'Mix of styles', description: 'The AI picks the best style for each moment, so a batch doesn’t repeat one template. Best for posting daily.', example: 'Varies per video' }
]

export const STYLE_LABELS: Record<RemixStyle, string> = {
  reaction: 'Reaction take', myth_truth: 'Myth vs. truth', science: 'The science behind it', lessons: 'Lessons from this', do_this_instead: 'Do this instead'
}

/**
 * commentary: the presenter gives a voiced take around a short borrowed moment.
 * silent: the moment plays with its own sound while the avatar reacts silently behind it (green screen).
 */
export type RemixFormat = 'commentary' | 'silent'
export const REMIX_FORMATS: { id: RemixFormat; label: string; detail: string }[] = [
  { id: 'commentary', label: 'Voiced take', detail: 'A few seconds of their moment, then your presenter’s take in your voice' },
  { id: 'silent', label: 'Silent react', detail: 'Their moment plays with its sound; your avatar reacts behind it without speaking' }
]

/** A silent reaction timed into the moment (seconds from its start). */
export interface RemixCue { at: number; reaction: string }

/** moment_first: the borrowed moment is the hook, then the presenter reacts. take_first: the presenter opens. */
export type RemixOrder = 'moment_first' | 'take_first'
export const REMIX_ORDERS: { id: RemixOrder; label: string; detail: string }[] = [
  { id: 'moment_first', label: 'Moment first', detail: 'Their viral moment hooks the viewer, then your presenter reacts' },
  { id: 'take_first', label: 'Take first', detail: 'Your presenter opens, then the moment plays as the setup' }
]

/** lipsync: lip-synced avatar on camera; still: the avatar photo with a slow push-in; voice: voice-over only (cheapest). */
export type RemixHost = 'lipsync' | 'still' | 'voice'
export const REMIX_HOSTS: { id: RemixHost; label: string; detail: string; unavailable?: string }[] = [
  { id: 'lipsync', label: 'Avatar on camera', detail: 'Lip-synced talking head for the opening and closing lines',
    unavailable: 'Coming soon: OpenRouter can’t lip-sync an avatar to your own voice yet' },
  { id: 'still', label: 'Avatar photo', detail: 'Your avatar’s photo with the voice, no lip-sync' },
  { id: 'voice', label: 'Voice only', detail: 'Voice-over on B-roll and stills, cheapest' }
]

/**
 * Remix speaks with the same voices as Avatar Studio: 'avatar' is the chosen
 * avatar's own voice (its clone or its preset); otherwise an ElevenLabs preset.
 */
export const AVATAR_VOICE = 'avatar'
export const REMIX_VOICES: { id: string; label: string; detail: string }[] = PRESET_VOICES.map((voice) => ({ id: voice.id, label: voice.label, detail: voice.hint }))
export const REMIX_VOICE_IDS: readonly string[] = [AVATAR_VOICE, ...PRESET_VOICE_IDS]

export const MAX_REMIXES = 10
export const MAX_SOURCES = 10
export const MAX_BRAND_IDENTITY_CHARS = 40000
/** Post caption limit, call to action and credit included (the engine uses the same; platforms allow 2,200). */
export const MAX_POST_CAPTION_CHARS = 2000
export const MAX_CTA_OFFER_CHARS = 80

/** A comment keyword in capitals (one word: letters, numbers, dashes), '' for none, or null when it can't be one. */
export function normalizeCtaKeyword(value: unknown): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  const keyword = value.trim().toUpperCase()
  if (!keyword) return ''
  return /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(keyword) ? keyword : null
}

/** The keyword a Brand Identity's call to action already uses ("Comment PULL-UP for…"), if any. */
export function brandCtaKeyword(text: string): string {
  // The keyword is written in capitals (or quoted): "Comment below" is not one.
  const match = /\b(?:comment|Comment|COMMENT)\s+(?:["“'‘]([A-Za-z0-9][A-Za-z0-9-]{1,19})["”'’]|([A-Z0-9][A-Z0-9-]{1,19}))(?=[\s.,!?:;)]|$)/.exec(text)
  return match ? normalizeCtaKeyword(match[1] ?? match[2]) ?? '' : ''
}

/** The line every video ends with (the engine writes the same words). */
export function ctaLine(keyword: string, offer: string): string {
  const what = offer.replace(/\s+/g, ' ').trim().replace(/[.!? ]+$/, '')
  return `Comment ${keyword} and I'll send you ${what || 'the full breakdown'}.`
}

/** Estimates for the cost preview (OpenRouter prices, October 2026). */
export const REMIX_PRICES = {
  /** HeyGen Avatar IV, per second of on-camera speech. */
  avatarPerSecond: 0.05,
  /** The avatar is on camera for the opening and closing lines: about 10-23 seconds per remix. */
  onCameraSecondsLow: 10,
  onCameraSecondsHigh: 23,
  /** Voice for ~30 seconds of narration (ElevenLabs v3, about 400 characters). */
  voicePerRemix: 0.03,
  /** Transcribing and planning, per hour of source video. */
  sourcePerHour: 0.35
}

/** Per-remix range (the avatar's speaking time varies) and the total at the high end. */
export function estimateRemixCost(host: RemixHost, count: number, sourceHours = 0.5, format: RemixFormat = 'commentary'): { perRemixLow: number; perRemixHigh: number; total: number } {
  // Silent reacts reuse the avatar's reaction clips: nothing is voiced or animated per video.
  if (format === 'silent') return { perRemixLow: 0, perRemixHigh: 0, total: REMIX_PRICES.sourcePerHour * Math.max(0.1, sourceHours) }
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
  /** Video links (one per video, up to MAX_SOURCES), or one local file chosen with dialog.selectVideo. */
  sources: string[]
  /** The original creator, for the on-screen credit (filled from the link when blank; single video only). */
  creator: string
  angle: RemixAngle
  order: RemixOrder
  host: RemixHost
  avatarId: string | null
  voice: string
  brandIdentityId: string | null
  count: number
  captionPreset: string
  includeCaptions: boolean
  /** The user confirmed they'll turn on the platform's AI-content label when posting. */
  aiLabelAck: boolean
  /** Comment keyword for the call to action ("SALES"), '' for none. */
  ctaKeyword: string
  /** What commenters get ("my free playbook"), used in "Comment SALES and I'll send you …". */
  ctaOffer: string
  format: RemixFormat
  /** Silent react plays much more of the clip: the user confirmed they're allowed to use it. */
  clipRightsAck: boolean
  /** How the hook text at the top looks; missing means the white bar. */
  headlineLook?: HeadlineLook
}

export interface RemixGrade {
  letter: 'A' | 'B' | 'C' | 'D' | 'F'
  score: number
  verdict: string
  fix: string
  /** The take was edited after grading. */
  edited: boolean
}

export interface RemixBeat { text: string; broll: string }

/** A planned remix the user reviews, edits or drops before anything is paid for. */
export interface RemixDraft {
  id: number
  sourceTitle: string
  creator: string
  startMs: number
  endMs: number
  quote: string
  why: string
  style: RemixStyle
  stance: RemixOutput['stance']
  headline: string
  intro: string
  beats: RemixBeat[]
  close: string
  notes: string[]
  grade: RemixGrade | null
  estimateUsd: number
  /** The caption for the post: takeaways, the call to action and the credit. */
  postCaption: string
  format: RemixFormat
  /** Silent react: when each reaction plays. */
  cues: RemixCue[]
}

/** What the user approves: the draft id and any edited text. */
export interface RemixEdit { id: number; headline: string; intro: string; beats: RemixBeat[]; close: string; postCaption?: string }

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
  style: RemixStyle
  grade: RemixGrade['letter'] | null
  creator: string
  postCaption: string
}

/** planning → review (drafts to approve) → rendering → done; or failed / cancelled. */
export type RemixPhase = 'planning' | 'review' | 'rendering' | 'done' | 'failed' | 'cancelled'

export interface RemixStatus {
  id: string
  phase: RemixPhase
  detail: string
  percent: number
  folder: string
  estimateUsd: number
  drafts: RemixDraft[]
  outputs: RemixOutput[]
  /** Spent so far: planning (transcription, writing, grading), plus rendering when done. */
  costUsd: number | null
  warnings: string[]
  error: string | null
}

export function isRunning(status: RemixStatus | null): boolean {
  return status?.phase === 'planning' || status?.phase === 'rendering'
}

export const STANCE_LABELS: Record<RemixOutput['stance'], string> = {
  agree_extend: 'Agrees and adds to it',
  disagree_correct: 'Disagrees and corrects it',
  add_nuance: 'Adds nuance'
}

const STYLES: readonly string[] = ['reaction', 'myth_truth', 'science', 'lessons', 'do_this_instead']

export function isRemixStyle(value: unknown): value is RemixStyle {
  return typeof value === 'string' && STYLES.includes(value)
}

export function isRemixOrder(value: unknown): value is RemixOrder {
  return value === 'moment_first' || value === 'take_first'
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

/** Caption text: line breaks kept (they carry the numbered takeaways), spaces and blank runs squeezed. */
export function captionText(value: unknown, max = MAX_POST_CAPTION_CHARS): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r/g, '').split('\n').map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
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
    checks, warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === 'string').map((w) => text(w, 400)).slice(0, 8) : [],
    style: isRemixStyle(raw.style) ? raw.style : 'reaction',
    grade: typeof raw.grade === 'string' && ['A', 'B', 'C', 'D', 'F'].includes(raw.grade) ? raw.grade as RemixGrade['letter'] : null,
    creator: text(raw.creator, 120),
    postCaption: captionText(raw.post_caption)
  }
}

function parseGrade(value: unknown): RemixGrade | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.letter !== 'string' || !['A', 'B', 'C', 'D', 'F'].includes(raw.letter)) return null
  return { letter: raw.letter as RemixGrade['letter'], score: Math.min(10, Math.max(0, number(raw.score))), verdict: text(raw.verdict, 300), fix: text(raw.fix, 400), edited: raw.edited === true }
}

/** A planned remix from the engine, parsed defensively. */
export function parseRemixDraft(value: unknown): RemixDraft | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!Number.isInteger(raw.id) || (raw.id as number) < 0 || typeof raw.headline !== 'string' || typeof raw.intro !== 'string' || typeof raw.close !== 'string' || !Array.isArray(raw.beats)) return null
  const beats = raw.beats.flatMap((item): RemixBeat[] => {
    if (!item || typeof item !== 'object') return []
    const beat = item as Record<string, unknown>
    return typeof beat.text === 'string' ? [{ text: text(beat.text, 400), broll: text(beat.broll, 60) }] : []
  }).slice(0, 4)
  return {
    id: raw.id as number, sourceTitle: text(raw.source_title, 300), creator: text(raw.creator, 120),
    startMs: Math.max(0, number(raw.start_ms)), endMs: Math.max(0, number(raw.end_ms)), quote: text(raw.quote, 600), why: text(raw.why, 300),
    style: isRemixStyle(raw.style) ? raw.style : 'reaction',
    stance: raw.stance === 'agree_extend' || raw.stance === 'disagree_correct' ? raw.stance : 'add_nuance',
    headline: text(raw.headline, 200), intro: text(raw.intro, 400), beats, close: text(raw.close, 400),
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string').map((n) => text(n, 300)).slice(0, 6) : [],
    grade: parseGrade(raw.grade), estimateUsd: number(raw.estimate_usd), postCaption: captionText(raw.post_caption),
    format: raw.format === 'silent' ? 'silent' : 'commentary',
    cues: Array.isArray(raw.cues) ? raw.cues.flatMap((item): RemixCue[] => {
      const cue = (item ?? {}) as Record<string, unknown>
      return typeof cue.reaction === 'string' && typeof cue.at === 'number' && Number.isFinite(cue.at) ? [{ at: Math.max(0, cue.at), reaction: cue.reaction.slice(0, 20) }] : []
    }).slice(0, 8) : []
  }
}

/** Word limits per line (the engine holds edits to the same limits). */
export const REMIX_WORD_LIMITS = { headline: 16, intro: 35, beat: 35, close: 25 } as const

/** Words as the engine counts them (it drops #hashtags from spoken lines). */
export function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter((word) => word && !word.startsWith('#')).length
}

/** The close without a trailing "Comment KEYWORD …" call to action, which doesn't count toward its word limit. */
export function closeWithoutCta(close: string): string {
  // From "Comment KEYWORD" to the end, so an offer like "my $9.99 course" is stripped whole.
  return close.replace(/(^|[.!?]\s+)\s*(?:comment|Comment|COMMENT)\s+["“'‘]?[A-Za-z0-9][A-Za-z0-9-]{1,19}\b[\s\S]*$/, '$1').trim()
}

/** Hard cap on the close with its call to action (the engine holds it to the same). */
export const MAX_CLOSE_WORDS_WITH_CTA = 60

/** What's wrong with an edited take, or null when it's ready to make. */
export function remixEditProblem(edit: Pick<RemixEdit, 'headline' | 'intro' | 'beats' | 'close'> & { postCaption?: string }, format: RemixFormat = 'commentary'): string | null {
  if (wordCount(edit.headline) < 3) return 'The headline needs at least 3 words.'
  if (wordCount(edit.headline) > REMIX_WORD_LIMITS.headline) return `Keep the headline to ${REMIX_WORD_LIMITS.headline} words.`
  // Silent reacts have no spoken lines: just the headline and the caption.
  if (format === 'silent') return (edit.postCaption ?? '').length > MAX_POST_CAPTION_CHARS ? `Keep the caption to ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters.` : null
  if (!edit.intro.trim()) return 'Add an opening line.'
  if (wordCount(edit.intro) > REMIX_WORD_LIMITS.intro) return `Keep the opening to ${REMIX_WORD_LIMITS.intro} words.`
  if (!edit.beats.some((beat) => beat.text.trim())) return 'Keep at least one voice-over beat.'
  const long = edit.beats.findIndex((beat) => wordCount(beat.text) > REMIX_WORD_LIMITS.beat)
  if (long >= 0) return `Keep beat ${long + 1} to ${REMIX_WORD_LIMITS.beat} words.`
  if (!edit.close.trim()) return 'Add a closing line.'
  if (wordCount(closeWithoutCta(edit.close)) > REMIX_WORD_LIMITS.close || wordCount(edit.close) > MAX_CLOSE_WORDS_WITH_CTA) {
    return `Keep the close to ${REMIX_WORD_LIMITS.close} words (plus the comment call to action).`
  }
  if ((edit.postCaption ?? '').length > MAX_POST_CAPTION_CHARS) return `Keep the caption to ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters.`
  return null
}

/** Approved edits from the renderer, checked in main before they reach the engine. */
export function parseRemixEdits(value: unknown, draftIds: ReadonlySet<number>, silentIds: ReadonlySet<number> = new Set()): RemixEdit[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Choose at least one remix to make.')
  const edits: RemixEdit[] = []
  const seen = new Set<number>()
  for (const item of value.slice(0, MAX_REMIXES * MAX_SOURCES)) {
    const raw = (item ?? {}) as Record<string, unknown>
    const id = raw.id
    if (typeof id !== 'number' || !draftIds.has(id) || seen.has(id)) continue
    seen.add(id)
    const beats = Array.isArray(raw.beats) ? raw.beats.flatMap((beat): RemixBeat[] => {
      const b = (beat ?? {}) as Record<string, unknown>
      return typeof b.text === 'string' && b.text.trim() ? [{ text: text(b.text, 400), broll: text(b.broll, 60) }] : []
    }).slice(0, 4) : []
    const headline = text(raw.headline, 200), intro = text(raw.intro, 400), close = text(raw.close, 400)
    if (typeof raw.postCaption === 'string' && captionText(raw.postCaption, MAX_POST_CAPTION_CHARS + 1).length > MAX_POST_CAPTION_CHARS) {
      throw new Error(`“${headline.slice(0, 60) || 'A take'}”: Keep the caption to ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters.`)
    }
    const postCaption = captionText(raw.postCaption)
    const problem = remixEditProblem({ headline, intro, beats, close, postCaption }, silentIds.has(id) ? 'silent' : 'commentary')
    if (problem) throw new Error(`“${headline.slice(0, 60) || 'A take'}”: ${problem}`)
    // An empty caption keeps the one the AI wrote.
    edits.push({ id, headline, intro, beats, close, ...(postCaption ? { postCaption } : {}) })
  }
  if (edits.length === 0) throw new Error('Choose at least one remix to make.')
  return edits
}

/**
 * The Brand Identity format Remix reads best (docs/brand-identity-spec.md has
 * the full spec and the generator prompt for the membership-area button).
 */
export const BRAND_IDENTITY_TEMPLATE = `BRAND: [name]
WHO WE HELP: [the specific person, their situation and what they want]
CORE PROMISE: [the result we deliver, in one sentence]

WHAT WE BELIEVE (3-7 beliefs, each with why and the proof)
1. Belief: [...]
   Why: [...]
   Proof: [real result, client story or reason — never invented]

MYTHS WE PUSH BACK ON (what people in this space say, and our counter-take)
- Myth: [...]
  Our take: [...]

OUR METHOD (named framework and its steps)
- Name: [...]
- Steps: 1. [...] 2. [...] 3. [...]

PROOF WE CAN USE (only real, approved numbers, results and testimonials)
- [...]

VOICE
- Tone: [e.g. direct, warm, playful, no hype]
- Words we use: [...]
- Words we never use: [...]
- How we disagree: [e.g. firm but respectful, never mocking the person]

OFF-LIMITS
- Claims we never make: [e.g. medical promises, guaranteed income]
- Topics we avoid: [...]

CALL TO ACTION (optional): [what to say at the end, e.g. "Comment PULL-UP for the free plan"]`
