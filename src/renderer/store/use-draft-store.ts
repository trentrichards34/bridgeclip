import type { BrollSource } from '../../shared/broll-library'
import { create } from 'zustand'
import { DEFAULT_HEADLINE_LOOK, type HeadlineLook } from '../../shared/headline-look'
import type { GraphicsRegister, LookExtraId } from '../../shared/look-extras'
import type { HeadlineVoice, QualityBar, ScreenFocus, TitleStyle } from '../../shared/jobs'
import type { CaptionLanguageChoice } from '../../shared/caption-language'
import type { ReferenceImage } from '../../shared/purpose'
import { pickStyle, type CreateStyle } from '../../shared/member-prefs'

/** The Create steps (the workflow choice sits above them). */
export type WizardStep = 'video' | 'format' | 'clips' | 'captions' | 'review'

/** The run the wizard just queued, shown as a confirmation until the next video. */
export interface StartedJob {
  jobId: string
  source: string
  /** True when every slot was busy and the job is waiting its turn. */
  queued: boolean
  /** Several videos: how many jobs were queued, and the videos that couldn't start. */
  count?: number
  failed?: { videoUrl: string; error: string }[]
}

/**
 * The Create form, kept outside the component so the chosen video and options
 * survive navigating away (e.g. to Settings to add a key) and a failed run.
 */
export interface ClipDraft {
  workflow: 'automatic' | 'review' | null
  source: string
  /** Several videos (one job each, same settings): every chosen source, the first being `source`. Empty or one item: just `source`. */
  sources: string[]
  clippingMode: 'quality' | 'economy' | 'advanced'
  plannerModel: string
  transcriptionModel: string
  aspectRatio: '9:16' | '16:9'
  /** 9:16 framing: smart per-shot layouts, always full frame, or letterbox. */
  layoutStyle: 'auto' | 'fill' | 'fit'
  /** Paid vision verification for ambiguous shots in Smart framing. */
  layoutVision: boolean
  /** Screen share clips under Smart framing: a mix (presenter or split, clip by clip), or one style. */
  screenFocus: ScreenFocus
  /** tight: cut dead air and filler words; natural: original timing. */
  pacing: 'tight' | 'natural'
  videoSpeed: number
  /** Optional description of the moments to clip; blank finds the best ones. */
  clipRequest: string
  durations: string[]
  autoClipCount: boolean
  maxClips: number
  includeCaptions: boolean
  captionPreset: string
  /** Automatic clips: the title card at the top of each clip. */
  includeTitle: boolean
  titleStyle: TitleStyle
  /** How the headline bar looks: color or floating text, and font. */
  headlineLook: HeadlineLook
  /** Extras on top of the look (keyword pill, progress bar, ...). */
  lookExtras: LookExtraId[]
  /** A call to action from the library, added to the end of every clip (null: none). */
  ctaId: string | null
  /** Gameplay split (9:16, Automatic): background-library file under the speaker. */
  backgroundVideo: string | null
  /** B-roll mode (Automatic): Pexels footage after the hook, for the whole clip, or off. */
  broll: 'off' | 'after-hook' | 'full'
  /** Where B-roll comes from (null: the default, My library when it has clips). */
  brollSource: BrollSource | null
  /** Hook preview (Automatic): open with the clip's strongest line. */
  hookPreview: boolean
  /** Motion graphics: Auto (Automatic): up to 3 animated cards per clip from what's said. Off until turned on (then remembered). */
  motionGraphics: boolean
  /** Stage layouts with motion graphics (Automatic, 9:16): big cards on a stage over the speaker in a card. */
  stageLayouts: boolean
  /** How dense the motion graphics are (null: read from what is said). */
  register: GraphicsRegister | null
  /** Sound effects as the motion graphics, scenes and hook come in (with motion graphics). */
  soundEffects: boolean
  /** Framework grading bar: keep clips graded at or above it. */
  qualityBar: QualityBar
  /** Whose video it is: headlines in the creator's own voice, or a clipper's third person. */
  headlineVoice: HeadlineVoice
  /** Captions (and the captions file) in another language; the speech stays as recorded. */
  captionLanguage: CaptionLanguageChoice
  /** Brand (optional): its niche, voice and offer guide titles and hook text; choosing one fills its look. */
  brandIdentityId: string | null
  /** Comment-keyword call to action (Automatic): ends each post caption and shows at the end of the video. */
  ctaKeyword: string
  ctaOffer: string
  /** Draw the brand's handle or logo in a corner (Automatic). */
  showHandle: boolean
  /** Skills: background music (its track, '' for the default) and voice cleanup. Off until turned on (then remembered). */
  music: boolean
  musicTrack: string
  voiceCleanup: boolean
  /** "What's this video for?" (optional, this video only). */
  purpose: string
  /** "A look you like" (optional, this video only): the picture chosen with reference:choose. */
  reference: ReferenceImage | null
  trimOpen: boolean
  trimStart: string
  trimEnd: string
}

interface DraftState extends ClipDraft {
  step: WizardStep
  started: StartedJob | null
  /**
   * "Same as last run": the style of the last run started here, or (before one
   * starts) the style Create opened with, i.e. the one the member last used.
   */
  lastRun: Partial<CreateStyle> | null
  /** Text typed into the empty video link field, not yet used: Next uses it when it's a valid link. */
  pendingLink: string
  update: (patch: Partial<ClipDraft>) => void
  setStep: (step: WizardStep) => void
  clearSource: () => void
  /** The job was queued: show the confirmation. */
  markStarted: (started: StartedJob) => void
  /** Start a new video with no workflow selected, keeping output preferences (not the video-specific clip request). */
  startAnother: () => void
}

export const useDraftStore = create<DraftState>((set) => ({
  workflow: null,
  source: '',
  sources: [],
  clippingMode: 'quality',
  plannerModel: '',
  transcriptionModel: '',
  aspectRatio: '9:16',
  layoutStyle: 'auto',
  layoutVision: true,
  screenFocus: 'smart',
  pacing: 'tight',
  videoSpeed: 1,
  clipRequest: '',
  durations: ['short'],
  autoClipCount: true,
  maxClips: 5,
  includeCaptions: true,
  captionPreset: 'pop',
  includeTitle: true,
  titleStyle: 'headline',
  headlineLook: DEFAULT_HEADLINE_LOOK,
  lookExtras: [],
  ctaId: null,
  backgroundVideo: null,
  broll: 'off',
  brollSource: null,
  hookPreview: false,
  motionGraphics: false,
  stageLayouts: false,
  register: null,
  soundEffects: true,
  qualityBar: 'b',
  headlineVoice: 'clipper',
  captionLanguage: 'original',
  brandIdentityId: null,
  ctaKeyword: '',
  ctaOffer: '',
  showHandle: false,
  music: false,
  musicTrack: '',
  voiceCleanup: false,
  purpose: '',
  reference: null,
  trimOpen: false,
  trimStart: '',
  trimEnd: '',
  step: 'video',
  started: null,
  lastRun: null,
  pendingLink: '',
  update: (patch) => set(patch),
  setStep: (step) => set({ step }),
  clearSource: () => set({ source: '', sources: [], trimStart: '', trimEnd: '', pendingLink: '' }),
  markStarted: (started) => set((state) => ({ started, lastRun: pickStyle('create', state) })),
  startAnother: () => set({ workflow: null, source: '', sources: [], pendingLink: '', clipRequest: '', purpose: '', reference: null, trimOpen: false, trimStart: '', trimEnd: '', step: 'video', started: null })
}))
