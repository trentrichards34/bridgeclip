/**
 * Remix: turn someone else's viral moment into the user's own commentary video.
 * The engine (engine/clip_engine/services/remix_service.py) plans and renders;
 * every model call goes through OpenRouter, stock B-roll through Pexels.
 */

import type { RemixReviewLook } from './remix-review-look'
import type { ImageHighlight } from './look-extras-engine'
import type { RemixLayoutChoice } from './remix-layouts'
import type { BrandLook } from './brand-kit'
import type { HeadlineLook } from './headline-look'
import type { LookExtraId } from './look-extras'
import { PRESET_VOICE_IDS, PRESET_VOICES } from './voices'
import type { PauseCaptions, PauseLayout } from './pause-react'
import type { RemixGraphicContext } from './reel-graphics'
import { parseMomentInfo, type MomentInfo, type MomentRange } from './moment-take'
import { HEYGEN_PRICES, heygenStage, type HeygenAvatarLink } from './heygen'

export type RemixStyle = 'reaction' | 'myth_truth' | 'science' | 'lessons' | 'do_this_instead'
/** A style, or 'mix': the AI picks a fitting style per moment so the account doesn't repeat one template. */
export type RemixAngle = RemixStyle | 'mix'

/** `cameraDescription`: the same, said to the member when they're on camera themselves ("you", not "your presenter"). */
export const REMIX_ANGLES: { id: RemixAngle; label: string; description: string; cameraDescription?: string; example: string }[] = [
  { id: 'reaction', label: 'Reaction take', description: 'Agree and add to it, disagree and correct it, or add the missing nuance, in your brand’s voice.', example: '“He’s half right. Here’s what he left out…”' },
  { id: 'myth_truth', label: 'Myth vs. truth', description: 'The moment states a common belief; your presenter breaks it down and gives the truth.', cameraDescription: 'The moment states a common belief; you break it down and give the truth.', example: '“You don’t need to lose weight first. Here’s why.”' },
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
 * image: the member talks on camera over a screenshot (an article or a post); the AI writes the headline from their words.
 * pause_react: the member on camera reacts to a video that pauses whenever they talk (see ./pause-react).
 * moment_take: the strongest moment inside each time range of a long video, then the member's take on camera (see ./moment-take).
 * clip_then_me: a short clip (trimmed, captioned), then the member's take full screen (see ./react-templates).
 * react_thoughts: their clip in a big box while the member reacts behind it, then the member's thoughts with b-roll (see ./react-templates).
 */
export type RemixFormat = 'commentary' | 'silent' | 'image' | 'pause_react' | 'moment_take' | 'clip_then_me' | 'react_thoughts'
export const REMIX_FORMATS: { id: RemixFormat; label: string; detail: string }[] = [
  { id: 'pause_react', label: 'Pause & react', detail: 'You on camera. Their video plays in a box and pauses whenever you talk' },
  { id: 'moment_take', label: 'Moment + my take', detail: 'Pick times in a long video. Each becomes its best moment, then you on camera' },
  { id: 'clip_then_me', label: 'Their clip, then me', detail: 'Their short clip plays, then you give your take' },
  { id: 'react_thoughts', label: 'React, then my thoughts', detail: 'You react while their clip plays, then share your thoughts with your b-roll' },
  { id: 'commentary', label: 'Voiced take', detail: 'A few seconds of their moment, then your presenter’s take in your voice' },
  { id: 'silent', label: 'React to a clip', detail: 'Their moment plays with its sound; you (or your avatar) react on top' },
  { id: 'image', label: 'Article or post', detail: 'Talk on camera in front of a screenshot, like a green screen; the AI writes the headline from what you say' }
]

/** "You on camera" (real-person templates) or "AI presenter" (an avatar or an AI voice; in beta). */
export type RemixMode = 'camera' | 'ai'
/** A voiced take or a clip reaction with an AI presenter is "AI presenter"; everything else is you on camera. */
export function remixMode(format: RemixFormat, host: RemixHost): RemixMode {
  return (format === 'commentary' || format === 'silent') && host !== 'camera' ? 'ai' : 'camera'
}
/** The template cards: the formats, plus the green screen over their video (a clip reaction, on camera, green screen). */
export type FormatCardId = RemixFormat | 'greenscreen'
export interface FormatCard { id: FormatCardId; label: string; detail: string }
/** You on camera: one plain line each, simplest first. */
export const CAMERA_CARDS: readonly FormatCard[] = [
  { id: 'pause_react', label: 'Pause & react', detail: 'Their video plays in a box and pauses when you talk' },
  { id: 'clip_then_me', label: 'Their clip, then me', detail: 'Their short clip plays, then you give your take' },
  { id: 'react_thoughts', label: 'React, then my thoughts', detail: 'You react while their clip plays, then share your thoughts with b-roll' },
  { id: 'moment_take', label: 'Moment + my take', detail: 'Pick moments in a long video, then your take on each' },
  { id: 'image', label: 'Article or post', detail: 'Talk in front of a screenshot of an article or post' },
  { id: 'greenscreen', label: 'Green screen over their video', detail: 'Their moment fills the screen; you react in front of it' },
  { id: 'commentary', label: 'Scripted take', detail: 'The AI writes your lines; you read them on camera' }
]
/** AI presenter (Beta): an avatar or an AI voice presents. */
export const AI_CARDS: readonly FormatCard[] = [
  { id: 'commentary', label: 'Voiced take', detail: 'A few seconds of their moment, then your presenter’s take in your voice' },
  { id: 'silent', label: 'React to a clip', detail: 'Their moment plays with its sound; your avatar reacts on top' }
]
/** Their clip, then me / React, then my thoughts: the part of their video played before (or while) you react. */
export function clipFormat(format: RemixFormat): boolean { return format === 'clip_then_me' || format === 'react_thoughts' }

/** Screenshots for an article-or-post remix. */
export const REMIX_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
/** The longest take over a screenshot. */
export const MAX_IMAGE_TAKE_SECONDS = 180
/** Headline-only formats: nothing spoken to edit. */
export function headlineOnly(format: RemixFormat): boolean { return format === 'silent' || format === 'image' || format === 'pause_react' || format === 'moment_take' || clipFormat(format) }
/** Formats recorded unscripted (one take, or two parts for React, then my thoughts), with the hook text and caption written from the member's words afterward. */
export function oneTake(format: RemixFormat): boolean { return format === 'image' || format === 'pause_react' || format === 'moment_take' || clipFormat(format) }

/** A silent reaction timed into the moment (seconds from its start). */
export interface RemixCue { at: number; reaction: string }

/** moment_first: the borrowed moment is the hook, then the presenter reacts. take_first: the presenter opens. */
export type RemixOrder = 'moment_first' | 'take_first'
export const REMIX_ORDERS: { id: RemixOrder; label: string; detail: string; cameraDetail: string }[] = [
  { id: 'moment_first', label: 'Moment first', detail: 'Their viral moment hooks the viewer, then your presenter reacts', cameraDetail: 'Their viral moment hooks the viewer, then you react' },
  { id: 'take_first', label: 'Take first', detail: 'Your presenter opens, then the moment plays as the setup', cameraDetail: 'You open, then the moment plays as the setup' }
]

/** lipsync: the member's HeyGen avatar on camera, lip-synced (Voiced take); still: the avatar photo with a slow push-in; voice: voice-over only (cheapest); camera: the member on camera, recorded in the app or uploaded. */
export type RemixHost = 'lipsync' | 'still' | 'voice' | 'camera'
/** The AI presenters are an early version, kept and marked Beta: `beta` is the honest line shown with the badge. */
export const REMIX_HOSTS: { id: RemixHost; label: string; detail: string; unavailable?: string; beta?: string }[] = [
  { id: 'camera', label: 'Me, on camera', detail: 'You react or read your take on camera: record here or upload a phone video' },
  { id: 'lipsync', label: 'Avatar on camera (HeyGen, Beta)', detail: 'Your realistic avatar says the take, lip-synced' },
  { id: 'still', label: 'Avatar photo', detail: 'Your avatar’s photo with the voice, no lip-sync',
    beta: 'Early version: a still picture with voice-over.' },
  { id: 'voice', label: 'Voice only', detail: 'Voice-over on B-roll and stills, cheapest',
    beta: 'Early version: an AI voice over stock clips and stills.' }
]
/**
 * Why "Avatar on camera (HeyGen, Beta)" can't be used right now, in plain words, and where it's fixed (Settings for
 * the key, Avatar Studio for the avatar), or null when it can. Only a Voiced take has it.
 */
export function lipsyncProblem(heygenConfigured: boolean, avatar: { heygen?: HeygenAvatarLink | null } | null): { reason: string; fix: 'settings' | 'studio'; status: string } | null {
  if (!heygenConfigured) return { reason: 'Add your HeyGen key in Settings → API keys to use a realistic avatar.', fix: 'settings', status: 'Needs a HeyGen key' }
  const link = avatar?.heygen ?? null
  if (!link) return { reason: avatar ? 'This avatar isn’t on HeyGen. Choose a HeyGen avatar below, or make one in Avatar Studio.' : 'Make a HeyGen avatar in Avatar Studio first.', fix: 'studio', status: 'Needs a HeyGen avatar' }
  const stage = heygenStage(link)
  if (stage === 'training') return { reason: 'HeyGen is still training this avatar (usually a few minutes). Check it in Avatar Studio.', fix: 'studio', status: 'Training' }
  if (stage === 'consent') return { reason: 'HeyGen needs your consent recording for this avatar. Open it from the avatar in Avatar Studio.', fix: 'studio', status: 'Needs consent' }
  if (stage === 'consent-rejected') return { reason: 'HeyGen didn’t accept the consent recording for this avatar. Record it again in Avatar Studio.', fix: 'studio', status: 'Needs consent' }
  if (stage === 'failed') return { reason: 'HeyGen could not make this avatar. Make a new one in Avatar Studio.', fix: 'studio', status: 'Failed' }
  return null
}

/** The badge on a HeyGen avatar that can't say a take yet ("Training", "Needs consent", "Failed"), or null (ready, or not on HeyGen). */
export function heygenBadge(link: HeygenAvatarLink | null | undefined): string | null {
  if (!link) return null
  const stage = heygenStage(link)
  return stage === 'training' ? 'Training' : stage === 'consent' || stage === 'consent-rejected' ? 'Needs consent' : stage === 'failed' ? 'Failed' : null
}

/** Silent react with the avatar's reaction clips: also an early version. */
export const AVATAR_REACTIONS_BETA = 'Early version: short AI clips of your avatar, made from a photo.'

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
  // Without an offer nothing is promised (the engine writes the same words).
  return what ? `Comment ${keyword} and I'll send you ${what}.` : `Comment ${keyword}.`
}

/** When the OpenRouter prices behind REMIX_PRICES were read (HeyGen's has its own date: HEYGEN_PRICES.checkedOn). */
export const REMIX_PRICES_CHECKED = 'October 2026'
/** Estimates for the cost preview (OpenRouter prices, REMIX_PRICES_CHECKED). */
export const REMIX_PRICES = {
  /** HeyGen Avatar IV, per second of on-camera speech (HeyGen's published price; see ./heygen). */
  avatarPerSecond: HEYGEN_PRICES.avatarIvPerSecond,
  /** The avatar is on camera for the opening and closing lines: about 10-23 seconds per remix. */
  onCameraSecondsLow: 10,
  onCameraSecondsHigh: 23,
  /** Voice for ~30 seconds of narration (ElevenLabs v3, about 400 characters). */
  voicePerRemix: 0.03,
  /** Transcribing and planning, per hour of source video. */
  sourcePerHour: 0.35
}

/**
 * The one line under Remix's cost that says every price is an estimate and when each was checked
 * (HeyGen's only when its avatar is used).
 */
export function remixPriceNote(heygen: boolean): string {
  const [year, month, day] = HEYGEN_PRICES.checkedOn.split('-').map(Number)
  const heygenDate = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `All prices here are estimates: OpenRouter prices checked ${REMIX_PRICES_CHECKED}` +
    (heygen ? `, HeyGen’s $${REMIX_PRICES.avatarPerSecond.toFixed(2)} per second checked ${heygenDate}` : '') +
    '. What your accounts bill is what counts.'
}

/** Per-remix range (the avatar's speaking time varies) and the total at the high end. */
export function estimateRemixCost(host: RemixHost, count: number, sourceHours = 0.5, format: RemixFormat = 'commentary'): { perRemixLow: number; perRemixHigh: number; total: number } {
  // Silent reacts reuse the avatar's reaction clips: nothing is voiced or animated per video.
  if (format === 'silent') return { perRemixLow: 0, perRemixHigh: 0, total: REMIX_PRICES.sourcePerHour * Math.max(0.1, sourceHours) }
  // A screenshot: one transcription and one short writing call.
  if (format === 'image') return { perRemixLow: 0.01, perRemixHigh: 0.02, total: 0.02 }
  // Pause & react: transcribing up to five minutes of you and of their video, and one short writing call.
  if (format === 'pause_react') return { perRemixLow: 0.01, perRemixHigh: 0.07, total: 0.07 }
  // Their clip, then me: the same (transcribing up to three minutes of you and of their clip, one short writing call).
  if (format === 'clip_then_me') return { perRemixLow: 0.01, perRemixHigh: 0.07, total: 0.07 }
  // React, then my thoughts: that, and one small call that places the b-roll over your words.
  if (format === 'react_thoughts') return { perRemixLow: 0.02, perRemixHigh: 0.09, total: 0.09 }
  // Moment + my take (count = ranges, sourceHours = their length): transcribing each range and one planning call for it
  // (the per-hour price, at least a tenth of an hour per range at the high end), then one short writing call per video.
  if (format === 'moment_take') {
    const ranges = Math.max(1, count), hours = Math.max(0, sourceHours)
    const low = REMIX_PRICES.sourcePerHour * hours + 0.01 * ranges
    const high = REMIX_PRICES.sourcePerHour * Math.max(hours, 0.1 * ranges) + 0.02 * ranges
    return { perRemixLow: low / ranges, perRemixHigh: high / ranges, total: high }
  }
  const avatar = (seconds: number): number => host === 'lipsync' ? seconds * REMIX_PRICES.avatarPerSecond : 0
  // On camera: your own voice and face, so nothing is voiced (captions come from a cheap transcription).
  const voice = host === 'camera' ? 0.01 : REMIX_PRICES.voicePerRemix
  const perRemixLow = voice + avatar(REMIX_PRICES.onCameraSecondsLow)
  const perRemixHigh = voice + avatar(REMIX_PRICES.onCameraSecondsHigh)
  return { perRemixLow, perRemixHigh, total: perRemixHigh * count + REMIX_PRICES.sourcePerHour * Math.max(0.1, sourceHours) }
}

/**
 * Moment + my take: what making the chosen videos costs. Free when each take's hook text was written from its
 * current recording; a take typed by hand, or recorded again after writing, is transcribed for its captions
 * (priced like the render check, estimateRemixCost per take).
 */
export function momentMakeNote(chosen: number[], recordings: RemixRecordings): string {
  const transcribe = chosen.filter((id) => recordings[id]?.reaction?.written !== true).length
  if (!transcribe) return 'Making the videos is free: the moments are already found and your hook text was written from these takes.'
  const upTo = estimateRemixCost('camera', 1, 0, 'image').total * transcribe
  return `Making ${chosen.length === 1 ? 'the video' : 'the videos'} transcribes ${transcribe === 1 ? (chosen.length === 1 ? 'your take' : '1 of your takes') : `${transcribe} of your takes`} for the captions ` +
    `(the hook text wasn’t written from ${transcribe === 1 ? 'that recording' : 'those recordings'}), which costs a little: up to about $${upTo.toFixed(2)}.`
}

export interface BrandIdentity {
  id: string
  name: string
  /** The identity document as text: beliefs, myths, method, proof, voice. */
  text: string
  /** The brand kit: visual defaults and the on-video handle or logo (missing on brands saved before it). */
  look?: BrandLook
  /** The stored logo, for previews (set by main when the brand has one). */
  logoPath?: string
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
  /** Extras on top of the look (keyword pill, progress bar, ...): look-extras.ts. Missing: none. */
  lookExtras?: LookExtraId[]
  /** A call to action from the member's library, played at the end of every video (it replaces the spoken one). */
  ctaId?: string
  /** Me, on camera: how the member appears. */
  camera?: CameraSettings
  /** Draw the brand's handle or logo in a corner (when the brand has one). */
  showHandle?: boolean
  /** Pause & react: where their video goes and whose words are captioned. */
  pause?: { layout: PauseLayout; captions: PauseCaptions }
  /** Moment + my take: the time ranges, and whether the moment stays small on screen while the member talks. */
  moment?: { ranges: MomentRange[]; pip: boolean }
  /** React to an article or post: a box around the key number on the screenshot (shares of the picture), for the proof underline. */
  imageHighlight?: ImageHighlight
  /** Pause & react, Their clip then me, React then my thoughts: their captions, where the hook text sits, part 1's look. */
  layout?: RemixLayoutChoice
  /** Background music (Skills). Missing: off. */
  music?: boolean
  /** The music track (an id from the track list); only with music on. */
  musicTrack?: string
  /** Clean up the member's voice (Skills). Missing: off. */
  voiceCleanup?: boolean
  /** What the video is for, in the member's words: steers the hook text and caption. */
  purpose?: string
  /** A reference image ("A look you like"): the id of a picture chosen with reference:choose. */
  referenceImage?: string
}

/** filmed: your real background; cutout: you cut out over a blur or your color; greenscreen: the clip fills the screen behind you. */
export type CameraLayout = 'filmed' | 'cutout' | 'greenscreen'
export interface CameraSettings {
  layout: CameraLayout
  backdrop: 'blur' | 'brand'
  /** The backdrop color for a brand cutout, #RRGGBB. */
  backdropColor: string
  /** Reactions: keep your voice (talking over the clip) or just your face. */
  talk: boolean
}
export const DEFAULT_CAMERA: CameraSettings = { layout: 'filmed', backdrop: 'blur', backdropColor: '#111111', talk: false }
export const CAMERA_LAYOUTS: { id: CameraLayout; label: string; detail: string }[] = [
  { id: 'filmed', label: 'As filmed', detail: 'Your real room behind you' },
  { id: 'cutout', label: 'Background removed', detail: 'You cut out, over a blur or your color' },
  { id: 'greenscreen', label: 'Green screen', detail: 'The clip fills the screen behind you' }
]

export function parseCameraSettings(value: unknown): CameraSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose how you appear on camera.')
  const raw = value as Record<string, unknown>
  const layout = raw.layout ?? 'filmed'
  const backdrop = raw.backdrop ?? 'blur'
  const color = raw.backdropColor ?? '#111111'
  if (!CAMERA_LAYOUTS.some((item) => item.id === layout) || (backdrop !== 'blur' && backdrop !== 'brand') ||
      typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color) || (raw.talk !== undefined && typeof raw.talk !== 'boolean')) {
    throw new Error('Choose how you appear on camera.')
  }
  return { layout: layout as CameraLayout, backdrop, backdropColor: color.toUpperCase(), talk: raw.talk === true }
}

/** What a take needs recorded: a reaction for Silent react, or each line of a voiced take. */
/** React, then my thoughts: 'reaction' is part 1 (watching their clip), 'thoughts' part 2. */
export type RecordingPart = 'reaction' | 'thoughts' | 'intro' | 'close' | 'beat0' | 'beat1' | 'beat2' | 'beat3'
export function isRecordingPart(value: unknown): value is RecordingPart {
  return typeof value === 'string' && /^(reaction|thoughts|intro|close|beat[0-3])$/.test(value)
}
export function partsFor(format: RemixFormat, beats: number): RecordingPart[] {
  if (format === 'react_thoughts') return ['reaction', 'thoughts']
  if (format === 'silent' || format === 'image' || format === 'pause_react' || format === 'moment_take' || format === 'clip_then_me') return ['reaction']
  return ['intro', ...Array.from({ length: Math.min(4, beats) }, (_, i) => `beat${i}` as RecordingPart), 'close']
}
/** A take's recordings, as the app lists them. */
export interface TakeRecording {
  path: string; uploaded: boolean; seconds: number
  /** Moment + my take: the hook text and caption were written from this recording, so making the video reuses its words (no new transcription). */
  written?: boolean
  /** Their clip then me / Moment + my take: only this part of the take is used (ms into it). */
  trim?: { startMs: number; endMs: number }
}
export type RemixRecordings = Record<number, Partial<Record<RecordingPart, TakeRecording>>>
export const RECORDING_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm']

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
  /** Which pasted video this take is from (0-based). */
  sourceIndex: number
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
  /**
   * Avatar on camera: the HeyGen share of estimateUsd (billed on HeyGen, not OpenRouter), or null when HeyGen's price
   * for the avatar isn't known (estimateUsd then leaves it out). Absent for takes HeyGen isn't part of.
   */
  heygenEstimateUsd?: number | null
  /** The caption for the post: takeaways, the call to action and the credit. */
  postCaption: string
  format: RemixFormat
  /** Silent react: when each reaction plays. */
  cues: RemixCue[]
  /** Moment + my take: the range it came from, what the member said and their talking points. */
  moment?: MomentInfo
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
  /** Me, on camera: the takes are recorded by the member before they're made. */
  onCamera?: boolean
  /** Reactions keep the member's voice (so recording asks for headphones). */
  cameraTalk?: boolean
  /** On camera: as filmed, cut out or green screen (the recorder's frame guide shows what's kept). */
  cameraLayout?: CameraLayout
  /** Pause & react: where their video goes (the recorder shades what its box covers). */
  pauseLayout?: PauseLayout
  /** On-camera remixes: what decides where graphics go on the member's part (missing: no graphics). */
  graphics?: RemixGraphicContext
  /** On-camera remixes: the look and skills this video is made with (the review can change them). */
  look?: RemixReviewLook
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
    id: raw.id as number, sourceIndex: Math.max(0, Math.floor(number(raw.source_index))), sourceTitle: text(raw.source_title, 300), creator: text(raw.creator, 120),
    startMs: Math.max(0, number(raw.start_ms)), endMs: Math.max(0, number(raw.end_ms)), quote: text(raw.quote, 600), why: text(raw.why, 300),
    style: isRemixStyle(raw.style) ? raw.style : 'reaction',
    stance: raw.stance === 'agree_extend' || raw.stance === 'disagree_correct' ? raw.stance : 'add_nuance',
    headline: text(raw.headline, 200), intro: text(raw.intro, 400), beats, close: text(raw.close, 400),
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string').map((n) => text(n, 300)).slice(0, 6) : [],
    grade: parseGrade(raw.grade), estimateUsd: number(raw.estimate_usd), postCaption: captionText(raw.post_caption),
    ...('heygen_estimate_usd' in raw ? { heygenEstimateUsd: raw.heygen_estimate_usd === null ? null : Math.max(0, Math.min(number(raw.heygen_estimate_usd), number(raw.estimate_usd))) } : {}),
    format: raw.format === 'silent' || raw.format === 'image' || raw.format === 'pause_react' || raw.format === 'moment_take' || raw.format === 'clip_then_me' ||
      raw.format === 'react_thoughts' ? raw.format : 'commentary',
    cues: Array.isArray(raw.cues) ? raw.cues.flatMap((item): RemixCue[] => {
      const cue = (item ?? {}) as Record<string, unknown>
      return typeof cue.reaction === 'string' && typeof cue.at === 'number' && Number.isFinite(cue.at) ? [{ at: Math.max(0, cue.at), reaction: cue.reaction.slice(0, 20) }] : []
    }).slice(0, 8) : [],
    ...(raw.format === 'moment_take' && parseMomentInfo(raw.moment) ? { moment: parseMomentInfo(raw.moment) as MomentInfo } : {})
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
  if (headlineOnly(format)) return (edit.postCaption ?? '').length > MAX_POST_CAPTION_CHARS ? `Keep the caption to ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters.` : null
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
