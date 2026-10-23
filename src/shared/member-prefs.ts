/**
 * The member's remembered setup: the last style they used on Create and on
 * Remix, their saved styles ("presets"), and two small app preferences. Kept
 * by the main process in userData/member-prefs.json. Everything read back is
 * checked field by field: an unknown or invalid value is dropped, so the form
 * falls back to its own default for it instead of failing.
 */

import { isAvatarId } from './avatars'
import { isBrollSource, type BrollSource } from './broll-library'
import { DEFAULT_PROFILE, readProfile, type CreatorProfile } from './onboarding'
import { isBackgroundVideoName } from './backgrounds'
import { isCaptionLanguage, type CaptionLanguageChoice } from './caption-language'
import { isCaptionPresetId } from './caption-presets'
import { isCtaId } from './ctas'
import { parseHeadlineLook, type HeadlineLook } from './headline-look'
import { isGraphicsRegister, parseLookExtras, type GraphicsRegister, type LookExtraId } from './look-extras'
import { DURATION_IDS, isVideoSpeed } from './job-contract'
import { HEADLINE_VOICES, QUALITY_BARS, SCREEN_FOCUS_MODES, TITLE_STYLES, type HeadlineVoice, type QualityBar, type ScreenFocus, type TitleStyle } from './jobs'
import { isModelId } from './openrouter-models'
import {
  AVATAR_VOICE, MAX_CTA_OFFER_CHARS, MAX_REMIXES, REMIX_FORMATS, REMIX_VOICES, isRemixAngle, isRemixHost, isRemixOrder, normalizeCtaKeyword, parseCameraSettings,
  type CameraSettings, type RemixAngle, type RemixFormat, type RemixHost, type RemixOrder
} from './remix'
import { isMusicTrackId } from './skills'
import { isPauseCaptions, isPauseLayout, type PauseCaptions, type PauseLayout } from './pause-react'
import { parseEditStyle, parseMyLook, type EditStylePrefs, type MyLook } from './my-look'

export type StyleKind = 'create' | 'remix'

/** Create's style choices (not the video, the clip request or the trim). */
export interface CreateStyle {
  clippingMode: 'quality' | 'economy' | 'advanced'
  plannerModel: string
  transcriptionModel: string
  aspectRatio: '9:16' | '16:9'
  layoutStyle: 'auto' | 'fill' | 'fit'
  layoutVision: boolean
  /** Screen share clips under Smart framing: a mix, or one style. */
  screenFocus: ScreenFocus
  pacing: 'tight' | 'natural'
  videoSpeed: number
  durations: string[]
  autoClipCount: boolean
  maxClips: number
  includeCaptions: boolean
  captionPreset: string
  includeTitle: boolean
  titleStyle: TitleStyle
  headlineLook: HeadlineLook
  /** Extras on top of the look (look-extras.ts). */
  lookExtras: LookExtraId[]
  ctaId: string | null
  backgroundVideo: string | null
  broll: 'off' | 'after-hook' | 'full'
  /** Where B-roll comes from (null: the default, My library when it has clips). */
  brollSource: BrollSource | null
  hookPreview: boolean
  /** Motion graphics: Auto (Automatic runs). Off until the member turns it on once. */
  motionGraphics: boolean
  /** Stage layouts with motion graphics (Automatic, 9:16). */
  stageLayouts: boolean
  /** How dense the motion graphics are (null: read from what is said; look-extras.ts GRAPHICS_REGISTERS). */
  register: GraphicsRegister | null
  /** Sound effects as the motion graphics come in (Skills). */
  soundEffects: boolean
  qualityBar: QualityBar
  headlineVoice: HeadlineVoice
  /** The brand whose niche, voice and offer guide the titles, and whose handle can be drawn. */
  brandIdentityId: string | null
  ctaKeyword: string
  ctaOffer: string
  /** Draw the brand's handle or logo in a corner. */
  showHandle: boolean
  /** Captions in another language ('original': as spoken). */
  captionLanguage: CaptionLanguageChoice
  /** Skills: background music (and its track, '' for the default) and voice cleanup. */
  music: boolean
  musicTrack: string
  voiceCleanup: boolean
}

/** Remix's style choices (not the links, the file, the creator name or the permission boxes). */
export interface RemixFormStyle {
  format: RemixFormat
  angle: RemixAngle
  order: RemixOrder
  host: RemixHost
  avatarId: string | null
  voice: string
  brandIdentityId: string | null
  count: number
  includeCaptions: boolean
  captionPreset: string
  headlineLook: HeadlineLook
  /** Extras on top of the look (look-extras.ts). */
  lookExtras: LookExtraId[]
  ctaId: string | null
  ctaKeyword: string
  ctaOffer: string
  camera: CameraSettings
  imageCamera: CameraSettings
  showHandle: boolean
  pauseLayout: PauseLayout
  pauseCaptions: PauseCaptions
  pauseCamera: CameraSettings
  momentPip: boolean
  momentCamera: CameraSettings
  /** Skills: background music (and its track, '' for the default) and voice cleanup. */
  music: boolean
  musicTrack: string
  voiceCleanup: boolean
  /** Voiced remixes: where the beats' b-roll comes from (null: the default). */
  brollSource: BrollSource | null
}

export type StyleOf<K extends StyleKind> = K extends 'create' ? CreateStyle : RemixFormStyle

export interface StylePreset<K extends StyleKind = StyleKind> {
  id: string
  name: string
  style: Partial<StyleOf<K>>
  updatedAt: string
}

export interface MemberPrefs {
  create: Partial<CreateStyle>
  remix: Partial<RemixFormStyle>
  presets: { create: StylePreset<'create'>[]; remix: StylePreset<'remix'>[] }
  /** Where "Report an issue" sends the member: an https link or an email address ('' for none). */
  supportLink: string
  /** Show a desktop notification when a long job finishes while the app is in the background. */
  notifyOnFinish: boolean
  /** The "Get set up" checklist was closed; it stays reachable from Settings. */
  setupChecklistDismissed: boolean
  /** A video link the checklist's "Try it with a sample video" puts in Create ('' for none). */
  sampleVideoLink: string
  /** What the member wants to make and where they post (onboarding). */
  profile: CreatorProfile
  /**
   * The brand look every tool starts from (Brand look → Make default). Picking
   * another brand for one video never changes it. Older prefs without it use
   * the brand of the last Create style.
   */
  defaultBrandId: string | null
  /** Before each edited reel is made: ask whether to see the beat sheet first, always show it, or skip it. */
  beatSheet: BeatSheetChoice
  /** Edit my recording: the Style and sound choice from the last reel (the next one starts there). */
  editStyle: EditStylePrefs
  /** Edit my recording: the look saved with "Save as my look" (null: none). */
  myLook: MyLook | null
  /** Edit my recording: start from the saved look ("Use my look" on the setup screen). */
  useMyLook: boolean
}

/** Edit my recording's beat sheet before the reel is made (beat-sheet.ts). */
export const BEAT_SHEET_CHOICES = ['ask', 'always', 'skip'] as const
export type BeatSheetChoice = (typeof BEAT_SHEET_CHOICES)[number]
export const DEFAULT_BEAT_SHEET_CHOICE: BeatSheetChoice = 'ask'
export function isBeatSheetChoice(value: unknown): value is BeatSheetChoice {
  return typeof value === 'string' && (BEAT_SHEET_CHOICES as readonly string[]).includes(value)
}

/** The app preferences Settings and the setup checklist can change. */
export type AppPrefsUpdate = Partial<Pick<MemberPrefs, 'supportLink' | 'notifyOnFinish' | 'setupChecklistDismissed' | 'sampleVideoLink' | 'defaultBrandId' | 'beatSheet' | 'editStyle' | 'myLook' | 'useMyLook'>>

export const MAX_PRESETS = 30
export const MAX_PRESET_NAME = 40
export const MAX_SUPPORT_LINK = 300
export const MAX_SAMPLE_VIDEO_LINK = 2048

export const CREATE_STYLE_KEYS = [
  'clippingMode', 'plannerModel', 'transcriptionModel', 'aspectRatio', 'layoutStyle', 'layoutVision', 'screenFocus', 'pacing', 'videoSpeed', 'durations', 'autoClipCount',
  'maxClips', 'includeCaptions', 'captionPreset', 'includeTitle', 'titleStyle', 'headlineLook', 'lookExtras', 'ctaId', 'backgroundVideo', 'broll', 'brollSource', 'hookPreview', 'motionGraphics', 'stageLayouts', 'register', 'soundEffects', 'qualityBar', 'headlineVoice',
  'brandIdentityId', 'ctaKeyword', 'ctaOffer', 'showHandle', 'captionLanguage', 'music', 'musicTrack', 'voiceCleanup'
] as const satisfies readonly (keyof CreateStyle)[]

export const REMIX_STYLE_KEYS = [
  'format', 'angle', 'order', 'host', 'avatarId', 'voice', 'brandIdentityId', 'count', 'includeCaptions', 'captionPreset', 'headlineLook', 'lookExtras',
  'ctaId', 'ctaKeyword', 'ctaOffer', 'camera', 'imageCamera', 'showHandle', 'pauseLayout', 'pauseCaptions', 'pauseCamera',
  'momentPip', 'momentCamera', 'music', 'musicTrack', 'voiceCleanup', 'brollSource'
] as const satisfies readonly (keyof RemixFormStyle)[]

export const DEFAULT_MEMBER_PREFS: MemberPrefs = { create: {}, remix: {}, presets: { create: [], remix: [] }, supportLink: '', notifyOnFinish: true, setupChecklistDismissed: false, sampleVideoLink: '', profile: { ...DEFAULT_PROFILE }, defaultBrandId: null, beatSheet: DEFAULT_BEAT_SHEET_CHOICE, editStyle: {}, myLook: null, useMyLook: true }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const oneOf = <T extends string>(values: readonly T[]) => (value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value)
const bool = (value: unknown): value is boolean => typeof value === 'boolean'
const isBrandId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)
const nullOr = (check: (value: unknown) => boolean) => (value: unknown): boolean => value === null || check(value)
function headlineLook(value: unknown): HeadlineLook | undefined {
  try { return parseHeadlineLook(value) } catch { return undefined }
}
function camera(value: unknown): CameraSettings | undefined {
  try { return parseCameraSettings(value) } catch { return undefined }
}

/** A list of extras (unknown ids are dropped by parseLookExtras when read). */
const isExtras = (value: unknown): boolean => Array.isArray(value)
const isKeyword = (value: unknown): boolean => typeof value === 'string' && value.length <= 20 && normalizeCtaKeyword(value) !== null
const isOffer = (value: unknown): boolean => typeof value === 'string' && value.length <= MAX_CTA_OFFER_CHARS && !/[\0\r\n]/.test(value)

const CREATE_CHECKS: { [K in keyof CreateStyle]: (value: unknown) => boolean } = {
  clippingMode: oneOf(['quality', 'economy', 'advanced']),
  plannerModel: (value) => value === '' || isModelId(value),
  transcriptionModel: (value) => value === '' || isModelId(value),
  aspectRatio: oneOf(['9:16', '16:9']),
  layoutStyle: oneOf(['auto', 'fill', 'fit']),
  layoutVision: bool,
  screenFocus: oneOf(SCREEN_FOCUS_MODES),
  pacing: oneOf(['tight', 'natural']),
  videoSpeed: isVideoSpeed,
  durations: (value) => Array.isArray(value) && value.length <= DURATION_IDS.length && value.every((item) => DURATION_IDS.includes(item as string)) && new Set(value).size === value.length,
  autoClipCount: bool,
  maxClips: (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100,
  includeCaptions: bool,
  captionPreset: isCaptionPresetId,
  includeTitle: bool,
  titleStyle: oneOf(TITLE_STYLES),
  headlineLook: () => true,
  lookExtras: isExtras,
  ctaId: nullOr(isCtaId),
  backgroundVideo: nullOr(isBackgroundVideoName),
  broll: oneOf(['off', 'after-hook', 'full']),
  brollSource: nullOr(isBrollSource),
  hookPreview: bool,
  motionGraphics: bool,
  stageLayouts: bool,
  register: nullOr(isGraphicsRegister),
  soundEffects: bool,
  qualityBar: oneOf(QUALITY_BARS),
  headlineVoice: oneOf(HEADLINE_VOICES),
  brandIdentityId: nullOr(isBrandId),
  ctaKeyword: (value) => isKeyword(value),
  ctaOffer: (value) => isOffer(value),
  showHandle: bool,
  captionLanguage: (value) => value === 'original' || isCaptionLanguage(value),
  music: bool,
  musicTrack: (value) => value === '' || isMusicTrackId(value),
  voiceCleanup: bool
}

const VOICE_IDS = [AVATAR_VOICE, ...REMIX_VOICES.map((voice) => voice.id)]
const REMIX_CHECKS: { [K in keyof RemixFormStyle]: (value: unknown) => boolean } = {
  format: oneOf(REMIX_FORMATS.map((item) => item.id)),
  angle: isRemixAngle,
  order: isRemixOrder,
  host: isRemixHost,
  avatarId: nullOr(isAvatarId),
  voice: oneOf(VOICE_IDS),
  brandIdentityId: nullOr(isBrandId),
  count: (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_REMIXES,
  includeCaptions: bool,
  captionPreset: isCaptionPresetId,
  headlineLook: () => true,
  lookExtras: isExtras,
  ctaId: nullOr(isCtaId),
  ctaKeyword: (value) => isKeyword(value),
  ctaOffer: (value) => isOffer(value),
  camera: () => true,
  imageCamera: () => true,
  showHandle: bool,
  pauseLayout: isPauseLayout,
  pauseCaptions: isPauseCaptions,
  pauseCamera: () => true,
  momentPip: bool,
  momentCamera: () => true,
  music: bool,
  musicTrack: (value) => value === '' || isMusicTrackId(value),
  voiceCleanup: bool,
  brollSource: nullOr(isBrollSource)
}

/** The valid fields of a saved style; anything else is dropped. */
function parseStyle<K extends StyleKind>(kind: K, value: unknown): Partial<StyleOf<K>> {
  if (!record(value)) return {}
  const checks = (kind === 'create' ? CREATE_CHECKS : REMIX_CHECKS) as Record<string, (value: unknown) => boolean>
  const keys: readonly string[] = kind === 'create' ? CREATE_STYLE_KEYS : REMIX_STYLE_KEYS
  const style: Record<string, unknown> = {}
  for (const key of keys) {
    if (!(key in value)) continue
    const raw = value[key]
    if (key === 'headlineLook') {
      const look = headlineLook(raw)
      if (look) style[key] = look
    } else if (key === 'lookExtras') {
      if (isExtras(raw)) style[key] = parseLookExtras(raw)
    } else if (key === 'camera' || key === 'imageCamera' || key === 'pauseCamera' || key === 'momentCamera') {
      const parsed = camera(raw)
      if (parsed) style[key] = parsed
    } else if (checks[key](raw)) {
      style[key] = Array.isArray(raw) ? [...raw] : raw
    }
  }
  return style as Partial<StyleOf<K>>
}

export function parseCreateStyle(value: unknown): Partial<CreateStyle> { return parseStyle('create', value) }
export function parseRemixStyle(value: unknown): Partial<RemixFormStyle> { return parseStyle('remix', value) }
export function parseStyleOf<K extends StyleKind>(kind: K, value: unknown): Partial<StyleOf<K>> { return parseStyle(kind, value) }

/** Only the style fields of a form's state (for saving). */
export function pickStyle<K extends StyleKind>(kind: K, state: object): Partial<StyleOf<K>> {
  return parseStyle(kind, state)
}

/** A trimmed preset name of 1-40 characters, or null. */
export function presetName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return name.length >= 1 && name.length <= MAX_PRESET_NAME ? name : null
}

const PRESET_ID = /^[a-f0-9]{16}$/
export function isPresetId(value: unknown): value is string { return typeof value === 'string' && PRESET_ID.test(value) }

function parsePresets<K extends StyleKind>(kind: K, value: unknown): StylePreset<K>[] {
  if (!Array.isArray(value)) return []
  const presets: StylePreset<K>[] = []
  const names = new Set<string>()
  for (const item of value) {
    if (!record(item) || !isPresetId(item.id) || presets.some((preset) => preset.id === item.id)) continue
    const name = presetName(item.name)
    if (!name || names.has(name.toLowerCase())) continue
    const updatedAt = typeof item.updatedAt === 'string' && !Number.isNaN(Date.parse(item.updatedAt)) ? item.updatedAt : new Date(0).toISOString()
    names.add(name.toLowerCase())
    presets.push({ id: item.id, name, style: parseStyle(kind, item.style), updatedAt })
    if (presets.length >= MAX_PRESETS) break
  }
  return presets
}

/** An https link or an email address the member typed; null when it's neither. */
export function supportTarget(value: unknown): { kind: 'email' | 'link'; url: string } | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > MAX_SUPPORT_LINK || /[\s\0]/.test(text)) return null
  const email = text.replace(/^mailto:/i, '')
  if (/^[^@/?#:]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)) {
    return { kind: 'email', url: `mailto:${email}?subject=${encodeURIComponent('CreatorClips support')}` }
  }
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null
    return { kind: 'link', url: url.href }
  } catch { return null }
}

/** A support link to save: '' clears it; anything else must be an https link or an email. */
export function parseSupportLink(value: unknown): string {
  if (value === '' || (typeof value === 'string' && !value.trim())) return ''
  if (!supportTarget(value)) throw new Error('Use an https:// link or an email address.')
  return (value as string).trim()
}

/** An http(s) video link with no sign-in details, or null. */
export function sampleVideoTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > MAX_SAMPLE_VIDEO_LINK || /[\s\0]/.test(text)) return null
  try {
    const url = new URL(text)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return null
    return text
  } catch { return null }
}

/** A sample video link to save: '' clears it; anything else must be an http(s) link. */
export function parseSampleVideoLink(value: unknown): string {
  if (value === '' || (typeof value === 'string' && !value.trim())) return ''
  const link = sampleVideoTarget(value)
  if (!link) throw new Error('Use a video link that starts with https://.')
  return link
}

export function parseMemberPrefs(value: unknown): MemberPrefs {
  if (!record(value)) return { create: {}, remix: {}, presets: { create: [], remix: [] }, supportLink: '', notifyOnFinish: true, setupChecklistDismissed: false, sampleVideoLink: '', profile: readProfile(null), defaultBrandId: null, beatSheet: DEFAULT_BEAT_SHEET_CHOICE, editStyle: {}, myLook: null, useMyLook: true }
  const presets = record(value.presets) ? value.presets : {}
  const create = parseCreateStyle(value.create)
  return {
    create,
    remix: parseRemixStyle(value.remix),
    presets: { create: parsePresets('create', presets.create), remix: parsePresets('remix', presets.remix) },
    supportLink: typeof value.supportLink === 'string' && supportTarget(value.supportLink) ? value.supportLink.trim() : '',
    notifyOnFinish: value.notifyOnFinish !== false,
    setupChecklistDismissed: value.setupChecklistDismissed === true,
    sampleVideoLink: sampleVideoTarget(value.sampleVideoLink) ?? '',
    profile: readProfile(value.profile),
    defaultBrandId: 'defaultBrandId' in value ? (isBrandId(value.defaultBrandId) ? value.defaultBrandId : null) : create.brandIdentityId ?? null,
    beatSheet: isBeatSheetChoice(value.beatSheet) ? value.beatSheet : DEFAULT_BEAT_SHEET_CHOICE,
    editStyle: parseEditStyle(value.editStyle),
    myLook: parseMyLook(value.myLook),
    useMyLook: value.useMyLook !== false
  }
}

/** A default brand look id from Settings-like input: a brand id, or null for none. */
export function parseDefaultBrandId(value: unknown): string | null {
  if (value === null) return null
  if (!isBrandId(value)) throw new Error('That look no longer exists.')
  return value
}

/**
 * Library items that still exist; ids pointing anywhere else are dropped from styles. A category that
 * couldn't be read is null, and its ids are kept (a failed read must not clear saved choices).
 */
export interface KnownItems { ctaIds: ReadonlySet<string> | null; avatarIds: ReadonlySet<string> | null; brandIds: ReadonlySet<string> | null; backgrounds: ReadonlySet<string> | null }

function dropMissingFrom<K extends StyleKind>(kind: K, style: Partial<StyleOf<K>>, known: KnownItems): Partial<StyleOf<K>> {
  const next = { ...style } as Record<string, unknown>
  if (typeof next.ctaId === 'string' && known.ctaIds && !known.ctaIds.has(next.ctaId)) next.ctaId = null
  if (typeof next.brandIdentityId === 'string' && known.brandIds && !known.brandIds.has(next.brandIdentityId)) next.brandIdentityId = null
  if (kind === 'create') {
    if (typeof next.backgroundVideo === 'string' && known.backgrounds && !known.backgrounds.has(next.backgroundVideo)) next.backgroundVideo = null
  } else {
    if (typeof next.avatarId === 'string' && known.avatarIds && !known.avatarIds.has(next.avatarId)) next.avatarId = null
  }
  return next as Partial<StyleOf<K>>
}

export function dropMissing(prefs: MemberPrefs, known: KnownItems): MemberPrefs {
  return {
    ...prefs,
    defaultBrandId: prefs.defaultBrandId && known.brandIds && !known.brandIds.has(prefs.defaultBrandId) ? null : prefs.defaultBrandId,
    create: dropMissingFrom('create', prefs.create, known),
    remix: dropMissingFrom('remix', prefs.remix, known),
    presets: {
      create: prefs.presets.create.map((preset) => ({ ...preset, style: dropMissingFrom('create', preset.style, known) })),
      remix: prefs.presets.remix.map((preset) => ({ ...preset, style: dropMissingFrom('remix', preset.style, known) }))
    }
  }
}
