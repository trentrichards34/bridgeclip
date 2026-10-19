/** Clip grading bar: A only, B or better, C or better, grade but keep everything, or no grading. */
export type QualityBar = 'a' | 'b' | 'c' | 'all' | 'off'
export const QUALITY_BARS: readonly QualityBar[] = ['a', 'b', 'c', 'all', 'off']
/** Headline: a story headline above the video (see headline-look.ts for its look). Card: the short title over the video. */
export type TitleStyle = 'headline' | 'card'
export const TITLE_STYLES: readonly TitleStyle[] = ['headline', 'card']

import type { RunDiagnostics } from './run-diagnostics'
import type { HeadlineLook } from './headline-look'
import type { PipelineStage } from './job-progress'
import type { JobOutput } from './job-output'
import type { CaptionLanguage } from './caption-language'

/** Options for one clipping run, as the Create wizard submits them. */
export interface ClipJobRequest {
  workflow?: 'automatic' | 'review'
  videoUrl: string
  /** Missing on older queued requests; those retain the original quality mode. */
  clippingMode?: 'quality' | 'economy' | 'advanced'
  /** Required in Advanced mode; presets choose their own models. */
  plannerModel?: string
  transcriptionModel?: string
  /** What the user wants clipped, in their words. Omitted: the best moments. */
  clipRequest?: string
  maxClips: number | null
  autoClipCount: boolean
  durationRanges: string[] | null
  aspectRatio: string
  layoutStyle: string
  layoutVision: boolean
  pacing: string
  /** Export speed for every clip. Older requests default to normal speed. */
  videoSpeed?: number
  includeCaptions: boolean
  captionPreset: string
  /** Title card at the top of Automatic clips. Older requests default to shown. */
  includeTitle?: boolean
  /** How the title is drawn (9:16). Older requests default to the card. */
  titleStyle?: TitleStyle
  /** How the headline looks (bar color or floating text, and font). Older requests: the white bar. */
  headlineLook?: HeadlineLook
  /** A call to action from the member's library, added to the end of every clip. */
  ctaId?: string
  /** Gameplay split (9:16): a background-library file looped under the speaker. */
  backgroundVideo?: string
  /** B-roll mode: Pexels stock footage over the speaker, after the hook or for the whole clip. */
  broll?: 'after-hook' | 'full'
  /** Hook preview: open each clip with its strongest line, then play it from the start. */
  hookPreview?: boolean
  /** Paid Creators framework grading: keep clips graded at or above this bar, grade but keep all, or skip grading. Defaults to 'b'. */
  qualityBar?: QualityBar
  /** Whose video it is: 'creator' writes headlines in the speaker's own voice (their own channel), 'clipper' in the third person. Defaults to 'clipper'. */
  headlineVoice?: HeadlineVoice
  /** Translate the captions (and the captions file) into this language. Omitted: the spoken language. */
  captionLanguage?: CaptionLanguage
  /**
   * "More clips from this video": the finished Create run (its ID) whose saved
   * transcript and source this run reuses, skipping the moments it already clipped.
   */
  reuseFrom?: string
  /** A brand identity whose niche, voice and offer guide titles, hook text and descriptions (advisory). */
  brandIdentityId?: string
  /** Comment-keyword call to action (Automatic): the post caption ends with it and "Comment KEYWORD" shows at the end. */
  ctaKeyword?: string
  ctaOffer?: string
  /** Draw the brand's handle or logo in a corner (Automatic, needs a brand). */
  showHandle?: boolean
  startTimeSeconds: number | null
  endTimeSeconds: number | null
  bannerPlatform: string | null
  bannerChannelUrl: string | null
}

/** How many clipping runs the main process lets run at once; the rest wait in a queue. */
export const MAX_PARALLEL_JOBS = 2
/** Finished runs retained in the live session; older runs remain on disk. */
export const MAX_FINISHED_JOBS = 50

export type ActiveJobStatus = 'queued' | 'pending' | 'downloading' | 'contextualizing' | 'transcribing' | 'planning' | 'rendering' | 'uploading'
export type TerminalJobStatus = 'completed' | 'failed' | 'cancelled'
export type JobStatus = ActiveJobStatus | TerminalJobStatus

export const ACTIVE_JOB_STATUSES: readonly ActiveJobStatus[] = ['queued', 'pending', 'downloading', 'contextualizing', 'transcribing', 'planning', 'rendering', 'uploading']

export function isActiveJobStatus(status: string): status is ActiveJobStatus {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(status)
}

/**
 * A job as the main process tracks it. The main process owns the list and
 * pushes a fresh snapshot on every change (`jobs:update`); `revision` only goes
 * up, so the renderer can drop a snapshot that arrives after a newer one.
 */
export interface JobSnapshot {
  id: string
  revision: number
  request: ClipJobRequest
  status: JobStatus
  percent: number
  stages?: PipelineStage[]
  diagnostics?: RunDiagnostics
  progressAt?: number
  step: string
  clipsDone: number
  clipsTotal: number
  error: string | null
  /** Suggested fix, when the main process can tell what went wrong. */
  errorHint: string | null
  failureCode?: string | null
  failureStage?: string | null
  httpStatus?: number | null
  output: JobOutput | null
  /** The run folder inside the output directory. */
  outputDir: string
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export const HEADLINE_VOICES = ['creator', 'clipper'] as const
export type HeadlineVoice = (typeof HEADLINE_VOICES)[number]
