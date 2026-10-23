/**
 * Sound design: sound effects that follow what happens on screen (engine sound_design.py does the planning and the
 * mix). Here: the actions a sound goes with, the registers that set how much plays, what an editor clip keeps about
 * its sounds, the events a bake sends the engine (on the finished clip's clock), and the member's own sounds
 * ("My sounds": files tagged with an action, used before the built-in ones).
 */
import { graphicHasContent, graphicWindow, outputTime, type EditorGraphic } from './motion-graphics'
import { outputScenes, type StageScene } from './scenes'
import { DEFAULT_REGISTER, REGISTERS, type Register } from './register'

export const SOUND_ACTIONS = ['whoosh', 'swipe', 'pop', 'tick', 'click', 'impact', 'riser', 'paper'] as const
export type SoundAction = (typeof SOUND_ACTIONS)[number]

/** What each action is for, in the words the member sees. */
export const SOUND_ACTION_INFO: Record<SoundAction, { label: string; detail: string }> = {
  whoosh: { label: 'Whoosh', detail: 'A big card or a new scene moving in fast.' },
  swipe: { label: 'Swipe', detail: 'A small card or a name tag sliding in.' },
  pop: { label: 'Pop', detail: 'A number, badge or icon landing.' },
  tick: { label: 'Key tick', detail: 'Text arriving line by line.' },
  click: { label: 'Click', detail: 'A pointer pressing a button.' },
  impact: { label: 'Impact', detail: 'A big word slamming in.' },
  riser: { label: 'Riser', detail: 'Builds into your call to action, once per video.' },
  paper: { label: 'Paper', detail: 'A sticky note or a page landing.' }
}

export function isSoundAction(value: unknown): value is SoundAction {
  return typeof value === 'string' && (SOUND_ACTIONS as readonly string[]).includes(value)
}

// One style register for graphics and sound (register.ts): the sound's registers are the same three.
export const SOUND_REGISTERS = REGISTERS
export type SoundRegister = Register
export const DEFAULT_SOUND_REGISTER: SoundRegister = DEFAULT_REGISTER
export const SOUND_REGISTER_INFO: Record<SoundRegister, { label: string; detail: string }> = {
  teaching: { label: 'Teaching', detail: 'A sound on each graphic and scene change. Best for tips and how-tos.' },
  story: { label: 'Story', detail: 'A few soft sounds, only on graphics. Plain talking stays quiet. Best for personal stories.' },
  minimal: { label: 'Minimal', detail: 'Only the opening, scene changes and the biggest moments.' }
}

export function isSoundRegister(value: unknown): value is SoundRegister {
  return typeof value === 'string' && (SOUND_REGISTERS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// An editor clip's sounds
// ---------------------------------------------------------------------------

/** Cues the clip can't work out from itself (source time): the punch-in rhythm, b-roll cutting in, the AI's extras. */
export interface SoundCue { at_ms: number; kind: 'punch' | 'broll' | 'extra'; end_ms?: number; sound?: string }
const CUE_KINDS: readonly SoundCue['kind'][] = ['punch', 'broll', 'extra']
/** The AI's planned sound names an extra can carry (edit-recording EDIT_SOUNDS). */
const EXTRA_SOUNDS: readonly string[] = ['whoosh', 'pop', 'click', 'ding', 'thud']
export const MAX_SOUND_CUES = 200

/** A clip's sound effects (an edited reel starts with them; absent: none). Bake mixes them. */
export interface CandidateSound {
  on: boolean
  register: SoundRegister
  /** The music's level under the voice when the reel was made with music (dB); absent: no music. */
  music_db?: number
  cues: SoundCue[]
}

/** A clip's sounds from the project or the renderer; throws on anything malformed. */
export function parseCandidateSound(value: unknown, duration: number): CandidateSound {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sound')
  const v = value as Record<string, unknown>
  if (typeof v.on !== 'boolean' || !isSoundRegister(v.register)) throw new Error('Invalid sound')
  if (v.music_db !== undefined && (typeof v.music_db !== 'number' || !Number.isFinite(v.music_db) || v.music_db < -40 || v.music_db > 0)) throw new Error('Invalid sound')
  const raw = v.cues === undefined ? [] : v.cues
  if (!Array.isArray(raw) || raw.length > MAX_SOUND_CUES) throw new Error('Invalid sound')
  const time = (n: unknown): number => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > duration) throw new Error('Invalid sound')
    return Math.round(n)
  }
  const cues = raw.map((item): SoundCue => {
    if (!item || typeof item !== 'object') throw new Error('Invalid sound')
    const c = item as Record<string, unknown>
    if (!CUE_KINDS.includes(c.kind as SoundCue['kind'])) throw new Error('Invalid sound')
    const at_ms = time(c.at_ms)
    const end_ms = c.end_ms === undefined ? undefined : time(c.end_ms)
    if (end_ms !== undefined && end_ms < at_ms) throw new Error('Invalid sound')
    if (c.sound !== undefined && !EXTRA_SOUNDS.includes(c.sound as string)) throw new Error('Invalid sound')
    return { at_ms, kind: c.kind as SoundCue['kind'], ...(end_ms !== undefined ? { end_ms } : {}), ...(c.sound !== undefined ? { sound: c.sound as string } : {}) }
  })
  return { on: v.on, register: v.register, ...(v.music_db !== undefined ? { music_db: Math.round(v.music_db as number) } : {}), cues }
}

/** One thing that happens on the finished clip (engine sound_design.cues_from_events). */
export interface SoundEvent {
  kind: 'hook' | 'graphic' | 'scene' | 'broll' | 'punch' | 'extra'
  at_ms: number
  end_ms?: number
  template?: string
  /** An 'fx' graphic's unit (its catalog names the sound). */
  effect?: string
  size?: string
  sound?: string
}

type BakeClip = { ranges: [number, number][]; video_speed: number; graphics?: EditorGraphic[]; stage_scenes?: StageScene[]; sound?: CandidateSound }

/**
 * The events a bake sends the engine, on the finished clip's clock: the hook text (when the clip draws one), each
 * graphic with content and its window, each stage scene, and the clip's own cues mapped through its cuts (a cue in a
 * cut part is dropped). Sorted by time.
 */
export function bakeSoundEvents(c: BakeClip, hook: boolean): SoundEvent[] {
  const events: SoundEvent[] = hook ? [{ kind: 'hook', at_ms: 0 }] : []
  for (const g of c.graphics ?? []) {
    if (!graphicHasContent(g)) continue
    const w = graphicWindow(c, g)
    if (!w) continue
    const effect = g.fields.effect
    events.push({ kind: 'graphic', template: g.template, at_ms: w.start_ms, end_ms: w.start_ms + w.duration_ms, size: g.size ?? 'card',
      ...(typeof effect === 'string' && /^[a-z0-9-]{1,60}$/.test(effect) ? { effect } : {}),
      ...(typeof g.fields.sound === 'string' && /^[a-z]{1,12}$/.test(g.fields.sound) ? { sound: g.fields.sound } : {}) })
  }
  for (const s of outputScenes(c)) events.push({ kind: 'scene', at_ms: s.start_ms, end_ms: s.end_ms })
  for (const cue of c.sound?.cues ?? []) {
    const at = outputTime(c, cue.at_ms)
    if (at === null) continue
    const end = cue.end_ms !== undefined ? outputTime(c, cue.end_ms) : null
    events.push({ kind: cue.kind, at_ms: Math.round(at), ...(end !== null && end >= at ? { end_ms: Math.round(end) } : {}), ...(cue.sound ? { sound: cue.sound } : {}) })
  }
  return events.sort((a, b) => a.at_ms - b.at_ms).slice(0, 400)
}

// ---------------------------------------------------------------------------
// My sounds: the member's own sound files, each tagged with an action
// ---------------------------------------------------------------------------

export const OWN_SOUND_EXTENSIONS: readonly string[] = ['.mp3', '.wav', '.m4a', '.ogg']
export const MAX_SOUND_BYTES = 5 * 1024 * 1024
export const MAX_OWN_SOUNDS = 60
/** Longest a sound may be (seconds; a riser may be longer). The engine leaves out longer ones. */
export const MAX_SOUND_SECONDS = 4
export const MAX_RISER_SECONDS = 6

/** A plain file name in an action's folder: no folders, no dot-files, a known audio extension. */
export function isOwnSoundName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(value) || value.includes('..')) return false
  const dot = value.lastIndexOf('.')
  return dot > 0 && OWN_SOUND_EXTENSIONS.includes(value.slice(dot).toLowerCase())
}

/** A sound's id is `<action>/<file name>`. */
export function parseOwnSoundId(value: unknown): { action: SoundAction; name: string } | null {
  if (typeof value !== 'string') return null
  const slash = value.indexOf('/')
  const action = value.slice(0, slash), name = value.slice(slash + 1)
  return slash > 0 && isSoundAction(action) && isOwnSoundName(name) ? { action, name } : null
}

export interface OwnSound {
  id: string
  action: SoundAction
  /** The file name without its extension. */
  name: string
  sizeBytes: number
}

export interface SoundLibrary {
  own: OwnSound[]
}
