/**
 * The look and skills of a remix in review (you on camera): the settings that
 * still change THIS video when it's made, so the review can show and change
 * them where they apply (captions and their style, the hook text look, zoom,
 * music and voice cleanup). Main keeps them on the run; the review's changes go
 * through `remix:setLook` and the video is made with them.
 */
import { isCaptionPresetId } from './caption-presets'
import { DEFAULT_HEADLINE_LOOK, parseHeadlineLook, type HeadlineLook } from './headline-look'
import { parseLookExtras, type LookExtraId } from './look-extras'
import { parseAudioSkills } from './skills'

export interface RemixReviewLook {
  includeCaptions: boolean
  captionPreset: string
  headlineLook: HeadlineLook
  lookExtras: LookExtraId[]
  music: boolean
  musicTrack: string | null
  voiceCleanup: boolean
  /** The brand picked before planning (read-only here: it decided how the take was written). */
  brandIdentityId: string | null
}

/** What the review may change. */
export type RemixLookPatch = Partial<Pick<RemixReviewLook, 'includeCaptions' | 'captionPreset' | 'headlineLook' | 'lookExtras' | 'music' | 'musicTrack' | 'voiceCleanup'>>

const PATCH_KEYS = ['includeCaptions', 'captionPreset', 'headlineLook', 'lookExtras', 'music', 'musicTrack', 'voiceCleanup'] as const

/** The run's request fields this view reads (RemixRequest has them all). */
export interface RemixLookFields {
  includeCaptions: boolean
  captionPreset: string
  headlineLook?: HeadlineLook
  lookExtras?: LookExtraId[]
  music?: boolean
  musicTrack?: string
  voiceCleanup?: boolean
  brandIdentityId: string | null
}

export function reviewLookOf(request: RemixLookFields): RemixReviewLook {
  return {
    includeCaptions: request.includeCaptions, captionPreset: request.captionPreset, headlineLook: request.headlineLook ?? DEFAULT_HEADLINE_LOOK,
    lookExtras: parseLookExtras(request.lookExtras ?? []), music: request.music === true, musicTrack: request.music ? request.musicTrack ?? null : null,
    voiceCleanup: request.voiceCleanup === true, brandIdentityId: request.brandIdentityId
  }
}

/** A change from the review, checked (throws a plain message). */
export function parseRemixLookPatch(value: unknown): RemixLookPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose the look again.')
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !(PATCH_KEYS as readonly string[]).includes(key))) throw new Error('Choose the look again.')
  const out: RemixLookPatch = {}
  if (raw.includeCaptions !== undefined) {
    if (typeof raw.includeCaptions !== 'boolean') throw new Error('Choose whether to show captions.')
    out.includeCaptions = raw.includeCaptions
  }
  if (raw.captionPreset !== undefined) {
    if (!isCaptionPresetId(raw.captionPreset)) throw new Error('Choose a caption style.')
    out.captionPreset = raw.captionPreset
  }
  if (raw.headlineLook !== undefined) {
    try { out.headlineLook = parseHeadlineLook(raw.headlineLook) } catch { throw new Error('Choose the hook text look again.') }
  }
  if (raw.lookExtras !== undefined) {
    if (!Array.isArray(raw.lookExtras)) throw new Error('Choose your extras again.')
    out.lookExtras = parseLookExtras(raw.lookExtras)
  }
  for (const key of ['music', 'voiceCleanup'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Error(key === 'music' ? 'Choose whether to add music.' : 'Choose whether to clean up the voice.')
    if (raw[key] !== undefined) out[key] = raw[key] as boolean
  }
  if (raw.musicTrack !== undefined) {
    if (raw.musicTrack !== null && typeof raw.musicTrack !== 'string') throw new Error('Choose the music again.')
    out.musicTrack = raw.musicTrack as string | null
  }
  return out
}

/** The request's sound fields after a change (music switched on with no track picks the first built-in one). */
export function audioAfter(current: Pick<RemixLookFields, 'music' | 'musicTrack' | 'voiceCleanup'>, patch: RemixLookPatch): { music?: true; musicTrack?: string; voiceCleanup?: true } {
  const music = patch.music ?? current.music === true
  const track = patch.musicTrack !== undefined ? patch.musicTrack : current.musicTrack ?? null
  return parseAudioSkills({ music, musicTrack: music ? track : null, voiceCleanup: patch.voiceCleanup ?? current.voiceCleanup === true })
}
