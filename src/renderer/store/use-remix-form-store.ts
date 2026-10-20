import { create } from 'zustand'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import { DEFAULT_HEADLINE_LOOK, type HeadlineLook } from '../../shared/headline-look'
import type { LookExtraId } from '../../shared/look-extras'
import { AVATAR_VOICE, DEFAULT_CAMERA, type CameraSettings, type RemixAngle, type RemixFormat, type RemixHost, type RemixOrder } from '../../shared/remix'
import type { RemixFormStyle } from '../../shared/member-prefs'
import { DEFAULT_PAUSE_REACT, type PauseCaptions, type PauseLayout } from '../../shared/pause-react'
import type { RangeInput } from '../../shared/moment-take'
import type { GoalId } from '../../shared/onboarding'
import type { Part1Layout, TheirCaptions } from '../../shared/remix-layouts'

export interface RemixForm {
  links: string
  filePath: string | null
  /** Article or post: the screenshot to talk over. */
  imagePath: string | null
  creator: string
  angle: RemixAngle
  order: RemixOrder
  brandIdentityId: string | null
  host: RemixHost
  avatarId: string | null
  voice: string
  count: number
  captionPreset: string
  includeCaptions: boolean
  aiLabelAck: boolean
  format: RemixFormat
  clipRightsAck: boolean
  ctaKeyword: string
  ctaOffer: string
  headlineLook: HeadlineLook
  /** Extras on top of the look (keyword pill, progress bar, ...). */
  lookExtras: LookExtraId[]
  /** A recorded call to action from the library, played at the end of every video. */
  ctaId: string | null
  /** How the member appears when they record themselves ("Me, on camera"). */
  camera: CameraSettings
  /** The look over a screenshot, kept apart so it doesn't change the video kinds. */
  imageCamera: CameraSettings
  /** Draw the brand's handle or logo in a corner. */
  showHandle: boolean
  /** Pause & react: where their video goes, whose words are captioned, and how the member appears (as filmed or cut out). */
  pauseLayout: PauseLayout
  pauseCaptions: PauseCaptions
  pauseCamera: CameraSettings
  /** Moment + my take: the time ranges as typed (or read from a screenshot), the box option and how the member appears. */
  momentRanges: RangeInput[]
  momentPip: boolean
  momentCamera: CameraSettings
  /** Their clip already has captions (null: as the link suggests: yes for Instagram and TikTok, else checked). */
  theirCaptions: TheirCaptions | null
  /** Pause & react, split: the hook text on the line between the halves, or at the top. */
  splitHook: 'seam' | 'top'
  /** React, then my thoughts: part 1 as a big box or a phone card, and (phone card) the hook text beside you or at the top. */
  reactPart1: Part1Layout
  phoneHook: 'beside' | 'top'
}

interface RemixFormState extends RemixForm {
  update: (patch: Partial<RemixForm>) => void
  /** A saved or remembered style: a different kind of remix needs its permission box ticked again. */
  applyStyle: (style: Partial<RemixFormStyle>) => void
  /** Library → "Remix this clip": the clip becomes the source file (its length, when known, picks a format that suits it). */
  setSourceFile: (path: string, creator: string, seconds?: number) => void
}

/** The form survives navigating away (e.g. to Settings to add a key); its style is remembered across restarts. */
export const useRemixForm = create<RemixFormState>((set, get) => ({
  // A first visit opens on "You on camera" (Pause & react): it needs no avatar. remixStartStyle can open the AI presenter instead.
  links: '', filePath: null, imagePath: null, creator: '', angle: 'reaction', order: 'moment_first', brandIdentityId: null, host: 'camera', avatarId: null, voice: AVATAR_VOICE,
  count: 3, captionPreset: DEFAULT_CAPTION_PRESET, includeCaptions: true, aiLabelAck: false, ctaKeyword: '', ctaOffer: '', format: 'pause_react', clipRightsAck: false,
  headlineLook: DEFAULT_HEADLINE_LOOK,
  lookExtras: [],
  ctaId: null,
  camera: DEFAULT_CAMERA,
  imageCamera: { ...DEFAULT_CAMERA, layout: 'greenscreen', talk: true },
  showHandle: false,
  pauseLayout: DEFAULT_PAUSE_REACT.layout,
  pauseCaptions: DEFAULT_PAUSE_REACT.captions,
  pauseCamera: { ...DEFAULT_CAMERA, talk: true },
  momentRanges: [{ start: '', end: '' }],
  // On by default: the moment stays in view while the member talks (a remembered choice wins).
  momentPip: true,
  momentCamera: { ...DEFAULT_CAMERA, talk: true },
  theirCaptions: null,
  splitHook: 'seam',
  reactPart1: 'box',
  phoneHook: 'beside',
  update: (patch) => set(patch),
  applyStyle: (style) => set({ ...style, ...(style.format && style.format !== get().format ? { clipRightsAck: false } : {}) }),
  setSourceFile: (path, creator, seconds) => {
    const state = get()
    const format = libraryClipFormat(state.format, state.host, seconds)
    set({ filePath: path, links: '', creator, format, ...(format !== state.format ? { clipRightsAck: false } : {}) })
  }
}))

/** Longer than this, a Library clip opens in Moment + my take (pick the moments) rather than Their clip, then me. */
export const LONG_CLIP_SECONDS = 10 * 60

/**
 * The format a Library clip opens in. A screenshot format can't use a video; a voiced or
 * silent take with an AI presenter can dead-end with no avatar yet, so it becomes a
 * reaction on camera: Their clip, then me (their clip plays, then the member adds context),
 * or Moment + my take for a long video. A format already on camera is kept.
 */
export function libraryClipFormat(format: RemixFormat, host: RemixHost, seconds?: number): RemixFormat {
  const onCameraFormat = format === 'pause_react' || format === 'moment_take' || format === 'clip_then_me' || format === 'react_thoughts'
  if (onCameraFormat) return format
  if (format === 'image' || host !== 'camera') return seconds !== undefined && seconds > LONG_CLIP_SECONDS ? 'moment_take' : 'clip_then_me'
  return format
}

/**
 * Where Remix opens when the member hasn't chosen yet (no remembered format or presenter): "You on camera", unless
 * the setup profile's only Remix goal is reactions as their AI self, which opens the AI presenter's Voiced take.
 */
export function remixStartStyle(goals: readonly GoalId[]): Partial<Pick<RemixForm, 'format' | 'host'>> {
  const aiOnly = goals.includes('ai-reactions') && !goals.includes('camera-reactions') && !goals.includes('article')
  return aiOnly ? { format: 'commentary', host: 'still' } : {}
}
