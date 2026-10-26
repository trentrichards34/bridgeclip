/**
 * "Save as my look" on the Edit my recording review, and "Use my look" on its setup screen: the reel's look kept in
 * the member's prefs (member-prefs.ts `myLook`) as the start for the next Edit my recording or Combine. Also the
 * Style and sound choice remembered between videos (`editStyle`).
 *
 * A look is: the style register (graphics and sound), captions and their style, the hook text's look (which also
 * sets the graphics' light or dark look), the extras, the color grade, sound effects on or off, and (Combine)
 * transitions between clips. Read back field by field: anything unknown or invalid is dropped.
 */
import { isCaptionPresetId } from './caption-presets'
import { isColorGrade, type ColorGrade } from './color-grade'
import { parseHeadlineLook, type HeadlineLook } from './headline-look'
import { parseLookExtras, type LookExtraId } from './look-extras'
import { isRegister, REGISTER_INFO, type Register } from './register'
import { COLOR_GRADE_INFO } from './color-grade'
import type { EditDecisions, EditLook } from './edit-recording'

/** The Style and sound choice from the last edited reel. */
export interface EditStylePrefs { register?: Register; soundEffects?: boolean
  /** How many scenes custom graphics design (Light, Standard or Full). */
  sceneAmount?: 'light' | 'standard' | 'full' }

export interface MyLook {
  register?: Register
  includeCaptions?: boolean
  captionPreset?: string
  headlineLook?: HeadlineLook
  lookExtras?: LookExtraId[]
  grade?: ColorGrade
  soundEffects?: boolean
  /** Combine: a quick dip through black between clips. */
  transitions?: boolean
  savedAt: string
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export function parseEditStyle(value: unknown): EditStylePrefs {
  if (!record(value)) return {}
  return { ...(isRegister(value.register) ? { register: value.register } : {}), ...(typeof value.soundEffects === 'boolean' ? { soundEffects: value.soundEffects } : {}),
    ...(value.sceneAmount === 'light' || value.sceneAmount === 'standard' || value.sceneAmount === 'full' ? { sceneAmount: value.sceneAmount } : {}) }
}

/** A saved look (null when there is none or it isn't one). */
export function parseMyLook(value: unknown): MyLook | null {
  if (!record(value)) return null
  const look: MyLook = { savedAt: typeof value.savedAt === 'string' && !Number.isNaN(Date.parse(value.savedAt)) ? value.savedAt : new Date(0).toISOString() }
  if (isRegister(value.register)) look.register = value.register
  if (typeof value.includeCaptions === 'boolean') look.includeCaptions = value.includeCaptions
  if (isCaptionPresetId(value.captionPreset)) look.captionPreset = value.captionPreset
  if (value.headlineLook !== undefined) { try { look.headlineLook = parseHeadlineLook(value.headlineLook) } catch { /* dropped */ } }
  if (Array.isArray(value.lookExtras)) look.lookExtras = parseLookExtras(value.lookExtras)
  if (isColorGrade(value.grade)) look.grade = value.grade
  if (typeof value.soundEffects === 'boolean') look.soundEffects = value.soundEffects
  if (typeof value.transitions === 'boolean') look.transitions = value.transitions
  return look
}

/** The look of the reel on the review (what "Save as my look" keeps). */
export function myLookFrom(look: EditLook, d: Pick<EditDecisions, 'soundStyle' | 'soundEffects' | 'sounds' | 'lookExtras' | 'transitions'>, savedAt = new Date().toISOString()): MyLook {
  return {
    register: d.soundStyle ?? 'teaching', includeCaptions: look.includeCaptions, captionPreset: look.captionPreset, headlineLook: look.headlineLook,
    lookExtras: [...d.lookExtras], grade: look.grade ?? 'none',
    soundEffects: d.soundEffects ?? (d.sounds.length === 0 || d.sounds.some((s) => s.on)),
    ...(d.transitions !== undefined ? { transitions: d.transitions } : {}), savedAt
  }
}

/** The setup's look with the saved look's captions, hook text and grade. */
export function lookWithMyLook(look: EditLook, my: MyLook): EditLook {
  const grade = my.grade && my.grade !== 'none' ? my.grade : undefined
  const { grade: _old, ...rest } = look
  void _old
  return {
    ...rest,
    ...(my.includeCaptions !== undefined ? { includeCaptions: my.includeCaptions } : {}),
    ...(my.captionPreset ? { captionPreset: my.captionPreset } : {}),
    ...(my.headlineLook ? { headlineLook: my.headlineLook } : {}),
    ...(grade ? { grade } : {})
  }
}

/** The review's first choices with the saved look's style, sound, extras and (Combine) transitions. */
export function decisionsWithMyLook(d: EditDecisions, my: MyLook): EditDecisions {
  const sound = my.soundEffects === undefined ? {} : { soundEffects: my.soundEffects, sounds: d.sounds.map((s) => ({ ...s, on: my.soundEffects as boolean })) }
  return {
    ...d, ...sound,
    ...(my.register ? { soundStyle: my.register } : {}),
    ...(my.lookExtras ? { lookExtras: [...my.lookExtras] } : {}),
    ...(my.transitions !== undefined && d.clipOrder ? { transitions: my.transitions } : {})
  }
}

/** The review's first choices with the remembered Style and sound choice. */
export function decisionsWithEditStyle(d: EditDecisions, style: EditStylePrefs): EditDecisions {
  return {
    ...d,
    ...(style.register ? { soundStyle: style.register } : {}),
    ...(style.sceneAmount ? { sceneAmount: style.sceneAmount } : {}),
    ...(style.soundEffects !== undefined ? { soundEffects: style.soundEffects, sounds: d.sounds.map((s) => ({ ...s, on: style.soundEffects as boolean })) } : {})
  }
}

/** One line about a saved look. */
export function myLookSummary(my: MyLook): string {
  return [my.register ? REGISTER_INFO[my.register].label : '', my.includeCaptions === false ? 'No captions' : my.captionPreset ? `Captions: ${my.captionPreset}` : '',
    my.headlineLook ? `Hook text: ${my.headlineLook.look}` : '', my.grade && my.grade !== 'none' ? `Grade: ${COLOR_GRADE_INFO[my.grade].label}` : '',
    my.soundEffects === false ? 'No sound effects' : my.soundEffects ? 'Sound effects' : ''].filter(Boolean).join(' · ')
}
