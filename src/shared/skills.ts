/**
 * Skills: one simple on/off list at the top of the look area on Create
 * (Automatic), Edit my recording (the review) and Remix (on camera).
 *
 * The list is only a VIEW over settings that already exist: each switch reads
 * and writes the same field the detailed control does (Captions is
 * includeCaptions, Zoom is the punch_zoom extra, Rough cut is Create's
 * "Cut dead air", ...). Nothing here is stored on its own, so the switch and
 * the detailed control can never disagree.
 */

import { parseLookExtras, type LookExtraId } from './look-extras'

export const SKILL_IDS = ['rough_cut', 'captions', 'motion_graphics', 'zoom', 'broll', 'sound_effects', 'music', 'voice_cleanup'] as const
export type SkillId = (typeof SKILL_IDS)[number]
export type SkillSurface = 'create' | 'edit' | 'remix'

export interface SkillInfo {
  id: SkillId
  label: string
  /** One plain line under the name. */
  detail: string
  /** New and still being tuned: shown with a Beta chip. */
  beta?: boolean
}

export const SKILLS: Record<SkillId, SkillInfo> = {
  rough_cut: { id: 'rough_cut', label: 'Rough cut', detail: 'Cuts dead air, long pauses and filler words.' },
  captions: { id: 'captions', label: 'Captions', detail: 'Word-by-word captions burned into the video.' },
  motion_graphics: { id: 'motion_graphics', label: 'Motion graphics', detail: 'Up to 3 animated cards per clip for numbers, lists and names said in it.' },
  zoom: { id: 'zoom', label: 'Zoom', detail: 'Cuts between a wide and a tight shot of your face every few seconds.' },
  broll: { id: 'broll', label: 'B-roll', detail: 'Stock footage from Pexels over the speaker, after a 3-second hook.' },
  sound_effects: { id: 'sound_effects', label: 'Sound effects', detail: 'The soft whooshes and pops the edit planned, mixed under your voice.' },
  music: { id: 'music', label: 'Music', detail: 'A background track, kept quiet under your voice.', beta: true },
  voice_cleanup: { id: 'voice_cleanup', label: 'Voice cleanup', detail: 'Reduces room echo and background noise in your voice.', beta: true }
}

/** One row as the panel shows it: whether it's on, and why it can't be changed (null when it can). */
export interface SkillRow extends SkillInfo {
  on: boolean
  disabledReason: string | null
  /** A short note for this surface, replacing the general line when set. */
  note?: string
}

const ZOOM: LookExtraId = 'punch_zoom'

function withExtra(extras: readonly LookExtraId[] | undefined, id: LookExtraId, on: boolean): LookExtraId[] {
  const list = parseLookExtras(extras ?? [])
  return parseLookExtras(on ? [...list, id] : list.filter((item) => item !== id))
}

const hasExtra = (extras: readonly LookExtraId[] | undefined, id: LookExtraId): boolean => parseLookExtras(extras ?? []).includes(id)

const row = (id: SkillId, on: boolean, disabledReason: string | null = null, note?: string): SkillRow =>
  ({ ...SKILLS[id], on, disabledReason, ...(note ? { note } : {}) })

// ---------------------------------------------------------------------------
// Create (Automatic): the draft's own fields
// ---------------------------------------------------------------------------

/** The Create draft fields the skills read and write. */
export interface CreateSkillFields {
  pacing: 'tight' | 'natural'
  includeCaptions: boolean
  motionGraphics: boolean
  lookExtras: LookExtraId[]
  broll: 'off' | 'after-hook' | 'full'
  backgroundVideo: string | null
  music: boolean
  voiceCleanup: boolean
}

export interface CreateSkillContext {
  /** A Pexels key is saved (B-roll needs one). */
  pexels: boolean
}

export const CREATE_SKILLS: readonly SkillId[] = ['rough_cut', 'captions', 'motion_graphics', 'zoom', 'broll', 'music', 'voice_cleanup']

export function createSkillRows(fields: CreateSkillFields, context: CreateSkillContext): SkillRow[] {
  return CREATE_SKILLS.map((id) => {
    switch (id) {
      case 'rough_cut': return row(id, fields.pacing === 'tight')
      case 'captions': return row(id, fields.includeCaptions)
      case 'motion_graphics': return row(id, fields.motionGraphics === true)
      case 'zoom': return row(id, hasExtra(fields.lookExtras, ZOOM))
      case 'broll': return row(id, fields.broll !== 'off', fields.broll === 'off' && !context.pexels ? 'Add a free Pexels key in Settings → API keys first.' : null,
        fields.broll === 'full' ? 'Stock footage from Pexels over the speaker, for the whole clip.' : undefined)
      case 'music': return row(id, fields.music === true)
      default: return row(id, fields.voiceCleanup === true)
    }
  })
}

/** Turning one skill on or off, as the same draft fields the detailed controls set. */
export function createSkillPatch(fields: CreateSkillFields, id: SkillId, on: boolean): Partial<CreateSkillFields> {
  switch (id) {
    case 'rough_cut': return { pacing: on ? 'tight' : 'natural' }
    case 'captions': return { includeCaptions: on }
    case 'motion_graphics': return { motionGraphics: on }
    case 'zoom': return { lookExtras: withExtra(fields.lookExtras, ZOOM, on) }
    // On keeps a mode already picked; B-roll and a gameplay background can't both run.
    case 'broll': return on ? { broll: fields.broll === 'off' ? 'after-hook' : fields.broll, backgroundVideo: null } : { broll: 'off' }
    case 'music': return { music: on }
    case 'voice_cleanup': return { voiceCleanup: on }
    default: return {}
  }
}

// ---------------------------------------------------------------------------
// Edit my recording (the review): the plan, the review's choices and the look
// ---------------------------------------------------------------------------

export interface EditSkillPlan {
  /** Each word's planned cut (null: kept). */
  words: readonly { cut: string | null }[]
  sounds: readonly { id: number }[]
}

export interface EditSkillState {
  cut: number[]
  sounds: { id: number; on: boolean }[]
  lookExtras: LookExtraId[]
  look: { includeCaptions: boolean; music?: boolean; voiceCleanup?: boolean }
}

export type EditSkillPatch = { decisions?: Partial<Pick<EditSkillState, 'cut' | 'sounds' | 'lookExtras'>>; look?: { includeCaptions?: boolean; music?: boolean; voiceCleanup?: boolean } }

/** The words the plan cut on its own (filler words, false starts, retakes): the rough cut. */
export function plannedCuts(plan: EditSkillPlan): number[] {
  return plan.words.flatMap((word, i) => (word.cut && word.cut !== 'member' ? [i] : []))
}

/** Rows for this plan: Rough cut needs planned cuts and Sound effects planned sounds; Motion graphics and B-roll aren't planned here. */
export function editSkillRows(plan: EditSkillPlan, state: EditSkillState): SkillRow[] {
  const rows: SkillRow[] = []
  const planned = plannedCuts(plan)
  if (planned.length) {
    const cut = new Set(state.cut)
    rows.push(row('rough_cut', planned.some((i) => cut.has(i)), null, 'Cuts the filler words, false starts and retakes the plan found.'))
  }
  rows.push(row('captions', state.look.includeCaptions))
  rows.push(row('zoom', hasExtra(state.lookExtras, ZOOM)))
  if (plan.sounds.length) rows.push(row('sound_effects', state.sounds.some((sound) => sound.on)))
  rows.push(row('music', state.look.music === true))
  rows.push(row('voice_cleanup', state.look.voiceCleanup === true))
  return rows
}

export function editSkillPatch(plan: EditSkillPlan, state: EditSkillState, id: SkillId, on: boolean): EditSkillPatch {
  switch (id) {
    case 'rough_cut': {
      // Only the plan's own cuts change; words the member cut or kept by hand stay as they are.
      const planned = new Set(plannedCuts(plan))
      const cut = new Set(state.cut.filter((i) => !planned.has(i)))
      if (on) for (const i of planned) cut.add(i)
      return { decisions: { cut: [...cut].sort((a, b) => a - b) } }
    }
    case 'captions': return { look: { includeCaptions: on } }
    case 'zoom': return { decisions: { lookExtras: withExtra(state.lookExtras, ZOOM, on) } }
    case 'sound_effects': return { decisions: { sounds: state.sounds.map((sound) => ({ ...sound, on })) } }
    case 'music': return { look: { music: on } }
    case 'voice_cleanup': return { look: { voiceCleanup: on } }
    default: return {}
  }
}

// ---------------------------------------------------------------------------
// Remix (you on camera): the form's own fields
// ---------------------------------------------------------------------------

export interface RemixSkillFields {
  includeCaptions: boolean
  lookExtras: LookExtraId[]
  music: boolean
  voiceCleanup: boolean
}

export const REMIX_SKILLS: readonly SkillId[] = ['captions', 'zoom', 'music', 'voice_cleanup']

export function remixSkillRows(fields: RemixSkillFields): SkillRow[] {
  return [
    row('captions', fields.includeCaptions),
    row('zoom', hasExtra(fields.lookExtras, ZOOM), null, 'Cuts between a wide and a tight shot of you every few seconds.'),
    row('music', fields.music === true),
    row('voice_cleanup', fields.voiceCleanup === true)
  ]
}

export function remixSkillPatch(fields: RemixSkillFields, id: SkillId, on: boolean): Partial<RemixSkillFields> {
  switch (id) {
    case 'captions': return { includeCaptions: on }
    case 'zoom': return { lookExtras: withExtra(fields.lookExtras, ZOOM, on) }
    case 'music': return { music: on }
    case 'voice_cleanup': return { voiceCleanup: on }
    default: return {}
  }
}

// ---------------------------------------------------------------------------
// Music and voice cleanup: the request fields (the engine side reads these names)
// ---------------------------------------------------------------------------

const TRACK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function isMusicTrackId(value: unknown): value is string {
  return typeof value === 'string' && TRACK_ID.test(value)
}

/** The audio fields of a request, checked (missing or false: off; a track only with music on). Throws with a plain message. */
export function parseAudioSkills(value: Record<string, unknown>): { music?: true; musicTrack?: string; voiceCleanup?: true } {
  if (value.music !== undefined && typeof value.music !== 'boolean') throw new Error('Invalid music option')
  if (value.voiceCleanup !== undefined && typeof value.voiceCleanup !== 'boolean') throw new Error('Invalid voice cleanup option')
  if (value.musicTrack !== undefined && !isMusicTrackId(value.musicTrack)) throw new Error('Choose a music track from the list.')
  return {
    ...(value.music === true ? { music: true as const } : {}),
    ...(value.music === true && typeof value.musicTrack === 'string' ? { musicTrack: value.musicTrack } : {}),
    ...(value.voiceCleanup === true ? { voiceCleanup: true as const } : {})
  }
}
