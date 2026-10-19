import { create } from 'zustand'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import { DEFAULT_HEADLINE_LOOK, type HeadlineLook } from '../../shared/headline-look'
import { AVATAR_VOICE, DEFAULT_CAMERA, type CameraSettings, type RemixAngle, type RemixFormat, type RemixHost, type RemixOrder } from '../../shared/remix'
import type { RemixFormStyle } from '../../shared/member-prefs'
import { DEFAULT_PAUSE_REACT, type PauseCaptions, type PauseLayout } from '../../shared/pause-react'
import type { RangeInput } from '../../shared/moment-take'

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
}

interface RemixFormState extends RemixForm {
  update: (patch: Partial<RemixForm>) => void
  /** A saved or remembered style: a different kind of remix needs its permission box ticked again. */
  applyStyle: (style: Partial<RemixFormStyle>) => void
  /** Library → "Remix this clip": the clip becomes the source file. */
  setSourceFile: (path: string, creator: string) => void
}

/** The form survives navigating away (e.g. to Settings to add a key); its style is remembered across restarts. */
export const useRemixForm = create<RemixFormState>((set, get) => ({
  links: '', filePath: null, imagePath: null, creator: '', angle: 'reaction', order: 'moment_first', brandIdentityId: null, host: 'still', avatarId: null, voice: AVATAR_VOICE,
  count: 3, captionPreset: DEFAULT_CAPTION_PRESET, includeCaptions: true, aiLabelAck: false, ctaKeyword: '', ctaOffer: '', format: 'commentary', clipRightsAck: false,
  headlineLook: DEFAULT_HEADLINE_LOOK,
  ctaId: null,
  camera: DEFAULT_CAMERA,
  imageCamera: { ...DEFAULT_CAMERA, layout: 'greenscreen', talk: true },
  showHandle: false,
  pauseLayout: DEFAULT_PAUSE_REACT.layout,
  pauseCaptions: DEFAULT_PAUSE_REACT.captions,
  pauseCamera: { ...DEFAULT_CAMERA, talk: true },
  momentRanges: [{ start: '', end: '' }],
  momentPip: false,
  momentCamera: { ...DEFAULT_CAMERA, talk: true },
  update: (patch) => set(patch),
  applyStyle: (style) => set({ ...style, ...(style.format && style.format !== get().format ? { clipRightsAck: false } : {}) }),
  setSourceFile: (path, creator) => {
    const format = get().format === 'image' ? 'commentary' : get().format
    set({ filePath: path, links: '', creator, format, ...(format !== get().format ? { clipRightsAck: false } : {}) })
  }
}))
