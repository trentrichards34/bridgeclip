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
import { isMusicTrackId, MUSIC_TRACKS, parseAudioChoice } from './music'
import type { BrollSource } from './broll-library'

export const SKILL_IDS = ['rough_cut', 'captions', 'motion_graphics', 'stage_layouts', 'zoom', 'broll', 'sound_effects', 'music', 'voice_cleanup'] as const
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
  motion_graphics: { id: 'motion_graphics', label: 'Motion graphics', detail: 'Animated cards for the numbers, lists, names and key lines said in each clip.' },
  stage_layouts: { id: 'stage_layouts', label: 'Stage layouts', detail: 'Big cards go on a stage at the top, with you in a card below. Then back to full frame.', beta: true },
  zoom: { id: 'zoom', label: 'Zoom', detail: 'Cuts between a wide and a tight shot of your face every few seconds.' },
  broll: { id: 'broll', label: 'B-roll', detail: 'Footage that matches what’s said over the speaker, after a 3-second hook: from your B-roll library, stock or AI.' },
  sound_effects: { id: 'sound_effects', label: 'Sound effects', detail: 'Soft whooshes, pops and clicks as your graphics and scenes come in, under your voice.' },
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
  /** Stage layouts with motion graphics (absent: off). */
  stageLayouts?: boolean
  /** The clips' shape (stage layouts are for 9:16; absent: 9:16). */
  aspectRatio?: string
  lookExtras: LookExtraId[]
  broll: 'off' | 'after-hook' | 'full'
  backgroundVideo: string | null
  music: boolean
  voiceCleanup: boolean
  /** Sound effects as the motion graphics come in (absent: on). */
  soundEffects?: boolean
}

export interface CreateSkillContext {
  /** A Pexels key is saved (stock b-roll needs one). */
  pexels: boolean
  /** Shots ready in My B-roll library. */
  library?: number
  /** An OpenRouter key is saved (AI b-roll needs one). */
  openrouter?: boolean
}

export const CREATE_SKILLS: readonly SkillId[] = ['rough_cut', 'captions', 'motion_graphics', 'stage_layouts', 'zoom', 'broll', 'sound_effects', 'music', 'voice_cleanup']

/** Why Stage layouts can't be on for these settings (null: they can). */
export function stageLayoutsBlocked(fields: Pick<CreateSkillFields, 'motionGraphics' | 'aspectRatio' | 'backgroundVideo'>): string | null {
  if ((fields.aspectRatio ?? '9:16') !== '9:16') return 'Stage layouts are for vertical (9:16) clips.'
  if (fields.backgroundVideo) return 'Stage layouts can’t be used with a gameplay background.'
  if (!fields.motionGraphics) return 'Turn on Motion graphics first. The stage holds its cards.'
  return null
}

/** Stage layouts apply to the run: switched on and nothing blocks them. */
export function stageLayoutsOn(fields: Pick<CreateSkillFields, 'motionGraphics' | 'aspectRatio' | 'backgroundVideo' | 'stageLayouts'>): boolean {
  return fields.stageLayouts === true && stageLayoutsBlocked(fields) === null
}

export function createSkillRows(fields: CreateSkillFields, context: CreateSkillContext): SkillRow[] {
  return CREATE_SKILLS.map((id) => {
    switch (id) {
      case 'rough_cut': return row(id, fields.pacing === 'tight')
      case 'captions': return row(id, fields.includeCaptions)
      case 'motion_graphics': return row(id, fields.motionGraphics === true)
      case 'stage_layouts': return row(id, stageLayoutsOn(fields), stageLayoutsBlocked(fields))
      case 'zoom': return row(id, hasExtra(fields.lookExtras, ZOOM))
      // B-roll comes from the library, Pexels or AI: it can be turned on when any of them can run.
      case 'broll': return row(id, fields.broll !== 'off',
        fields.broll === 'off' && !context.pexels && !context.openrouter && !(context.library ?? 0) ? 'Add clips to your B-roll library, or a free Pexels key in Settings → API keys, first.' : null,
        fields.broll === 'full' ? 'Footage that matches what’s said over the speaker, for the whole clip: from your B-roll library, stock or AI.' : undefined)
      // Sounds land as the motion graphics, scenes and hook come in: they need Motion graphics.
      case 'sound_effects': return row(id, fields.motionGraphics === true && fields.soundEffects !== false,
        fields.motionGraphics ? null : 'Turn on Motion graphics first. Each sound plays as a graphic comes in.')
      case 'music': return row(id, fields.music === true)
      default: return row(id, fields.voiceCleanup === true)
    }
  })
}

/** Turning one skill on or off, as the same draft fields the detailed controls set. */
export function createSkillPatch(fields: CreateSkillFields, id: SkillId, on: boolean): Partial<Omit<CreateSkillFields, 'aspectRatio'>> {
  switch (id) {
    case 'rough_cut': return { pacing: on ? 'tight' : 'natural' }
    case 'captions': return { includeCaptions: on }
    case 'motion_graphics': return { motionGraphics: on }
    case 'stage_layouts': return { stageLayouts: on }
    case 'zoom': return { lookExtras: withExtra(fields.lookExtras, ZOOM, on) }
    // On keeps a mode already picked; B-roll and a gameplay background can't both run.
    case 'broll': return on ? { broll: fields.broll === 'off' ? 'after-hook' : fields.broll, backgroundVideo: null } : { broll: 'off' }
    case 'sound_effects': return { soundEffects: on }
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
  /** The automatic direction's planned graphics (absent: the plan made none, e.g. camera + screen). */
  graphics?: readonly unknown[]
}

export interface EditSkillState {
  cut: number[]
  sounds: { id: number; on: boolean }[]
  /** The Sound effects switch (missing: on unless every planned sound is off). */
  soundEffects?: boolean
  lookExtras: LookExtraId[]
  /** The plan's motion graphics and Stage layouts (missing: on). */
  motionGraphics?: boolean
  stageLayouts?: boolean
  look: { includeCaptions: boolean; music?: boolean; voiceCleanup?: boolean; broll?: BrollSource | null }
}

export type EditSkillPatch = { decisions?: Partial<Pick<EditSkillState, 'cut' | 'sounds' | 'soundEffects' | 'lookExtras' | 'motionGraphics' | 'stageLayouts'>>; look?: { includeCaptions?: boolean; music?: boolean; voiceCleanup?: boolean; broll?: BrollSource | null } }

/** Edit my recording's B-roll: where it would come from when switched on (null: none can run), set by the page. */
export interface EditSkillContext { brollSource?: BrollSource | null }

/** The words the plan cut on its own (filler words, false starts, retakes): the rough cut. */
export function plannedCuts(plan: EditSkillPlan): number[] {
  return plan.words.flatMap((word, i) => (word.cut && word.cut !== 'member' ? [i] : []))
}

/** Rows for this plan: Rough cut needs planned cuts; Motion graphics and Stage layouts need the plan's direction. */
export function editSkillRows(plan: EditSkillPlan, state: EditSkillState, context: EditSkillContext = {}): SkillRow[] {
  const rows: SkillRow[] = []
  const planned = plannedCuts(plan)
  if (planned.length) {
    const cut = new Set(state.cut)
    rows.push(row('rough_cut', planned.some((i) => cut.has(i)), null, 'Cuts the filler words, false starts and retakes the plan found.'))
  }
  rows.push(row('captions', state.look.includeCaptions))
  if (plan.graphics !== undefined) {
    // Edited reels are vertical: Stage layouts only need Motion graphics on.
    const motion = state.motionGraphics !== false
    rows.push(row('motion_graphics', motion, null, 'Animated graphics, chapter headers and diagrams for what you say, planned with your edit. Change any of them in the editor.'))
    rows.push(row('stage_layouts', motion && state.stageLayouts !== false, motion ? null : 'Turn on Motion graphics first. The stage holds its cards.'))
  }
  rows.push(row('zoom', hasExtra(state.lookExtras, ZOOM)))
  rows.push(row('broll', Boolean(state.look.broll), !state.look.broll && !context.brollSource ? 'Add clips to your B-roll library, or a free Pexels key in Settings → API keys, first.' : null,
    'Footage that matches what you say over you, after a 3-second hook: from your B-roll library, stock or AI.'))
  rows.push(row('sound_effects', state.soundEffects ?? (state.sounds.length === 0 || state.sounds.some((sound) => sound.on))))
  rows.push(row('music', state.look.music === true))
  rows.push(row('voice_cleanup', state.look.voiceCleanup === true))
  return rows
}

export function editSkillPatch(plan: EditSkillPlan, state: EditSkillState, id: SkillId, on: boolean, context: EditSkillContext = {}): EditSkillPatch {
  switch (id) {
    case 'rough_cut': {
      // Only the plan's own cuts change; words the member cut or kept by hand stay as they are.
      const planned = new Set(plannedCuts(plan))
      const cut = new Set(state.cut.filter((i) => !planned.has(i)))
      if (on) for (const i of planned) cut.add(i)
      return { decisions: { cut: [...cut].sort((a, b) => a - b) } }
    }
    case 'captions': return { look: { includeCaptions: on } }
    case 'motion_graphics': return { decisions: { motionGraphics: on } }
    case 'stage_layouts': return { decisions: { stageLayouts: on } }
    case 'zoom': return { decisions: { lookExtras: withExtra(state.lookExtras, ZOOM, on) } }
    case 'sound_effects': return { decisions: { soundEffects: on, sounds: state.sounds.map((sound) => ({ ...sound, on })) } }
    case 'music': return { look: { music: on } }
    case 'voice_cleanup': return { look: { voiceCleanup: on } }
    case 'broll': return { look: { broll: on ? state.look.broll ?? context.brollSource ?? null : null } }
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


export { isMusicTrackId }

/** The audio fields of a request, checked (missing or false: off; a track only with music on). Throws with a plain message. */
export function parseAudioSkills(value: Record<string, unknown>): { music?: true; musicTrack?: string; voiceCleanup?: true } {
  // Music switched on from the Skills panel without a pick yet: the first built-in track.
  const noTrack = value.musicTrack === undefined || value.musicTrack === null || value.musicTrack === ''
  const withTrack = value.music === true && noTrack ? { ...value, musicTrack: MUSIC_TRACKS[0].id } : noTrack ? { ...value, musicTrack: undefined } : value
  const choice = parseAudioChoice(withTrack)
  return {
    ...(choice.music ? { music: true as const, musicTrack: choice.musicTrack } : {}),
    ...(choice.voiceCleanup ? { voiceCleanup: true as const } : {})
  }
}
