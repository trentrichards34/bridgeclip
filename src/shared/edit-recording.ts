import { isColorGrade, type ColorGrade } from './color-grade'
import type { EditProgress } from './edit-progress'
import { isBrollSource, type BrollSource } from './broll-library'
/**
 * Edit my recording: a member drops in one raw talking-to-camera recording
 * (or a few takes of the same video) and gets back one finished vertical reel.
 *
 * The app transcribes it with word timings, one AI call plans the edit (the
 * hook to open on, which takes to keep, what to cut, pop-ups and sound
 * effects), the member reviews it, and the reel is made locally. This file
 * holds what the main process and the page share: the plan, the member's
 * choices on the review screen and how both are checked.
 */

import { DEFAULT_CAPTION_PRESET, isCaptionPresetId } from './caption-presets'
import { DEFAULT_HEADLINE_LOOK, parseHeadlineLook, type HeadlineLook } from './headline-look'
import { DEFAULT_EDIT_RECIPE, editRecipe, isEditRecipeId, recipeExtras, type EditRecipeId } from './edit-recipes'
import { parseLookExtras, type LookExtraId } from './look-extras'
import { MAX_EDIT_GRAPHICS, parseEditGraphics, type EditGraphic } from './reel-graphics'
import { parseAudioSkills } from './skills'
import { parseClipOrder, type ClipOrderMode, type EditMode, type ShotType } from './combine-clips'
import { newGraphic } from './motion-graphics'
import { isRegister, type Register } from './register'
import { newEditGraphic } from './reel-graphics'
import type { ScreenChoice } from './screen-pair'
import { isSoundRegister, type SoundRegister } from './sound-design'

export const EDIT_MAX_SOURCES = 5
/** Per recording, and all takes together. */
export const EDIT_MAX_SOURCE_SECONDS = 20 * 60
export const EDIT_MAX_TOTAL_SECONDS = 30 * 60
export const EDIT_MIN_SOURCE_SECONDS = 2
export const EDIT_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv']
/** What the recorder in this tab stops at. */
export const EDIT_RECORDER_MAX_SECONDS = 15 * 60
export const MAX_HOOK_TEXT_CHARS = 90
export const MAX_POPUP_TEXT_CHARS = 28
export const MAX_HOOK_HINT_CHARS = 600

/** ElevenLabs Scribe v2 through OpenRouter: word timings, and the member's own words as key terms. */
export const SCRIBE_MODEL = 'elevenlabs/scribe-v2'
/**
 * Its price per second of audio as listed on openrouter.ai/elevenlabs/scribe-v2 (October 2026, before a
 * limited-time discount). Only for the estimate: what OpenRouter reports for each call is what's recorded.
 */
export const SCRIBE_PRICE_PER_SECOND = 0.000061
/** Planning and writing calls, priced like the app's other estimates (transcribing and planning, per hour of video). */
export const PLAN_PRICE_PER_HOUR = 0.35
/** One short writing call ("What should I film?"), priced like a screenshot take's writing call. */
export const IDEAS_ESTIMATE_USD = 0.02

export const EDIT_SOUNDS = ['whoosh', 'pop', 'click', 'ding', 'thud'] as const
export type EditSoundName = (typeof EDIT_SOUNDS)[number]
export const SOUND_LABELS: Record<EditSoundName, string> = { whoosh: 'Soft whoosh', pop: 'Pop', click: 'Click', ding: 'Pop', thud: 'Soft impact' }

export const CUT_REASONS = ['filler', 'cue', 'rejected', 'retake', 'false_start', 'off_topic', 'member', 'no_screen'] as const
export type CutReason = (typeof CUT_REASONS)[number]
export const CUT_LABELS: Record<CutReason, string> = {
  filler: 'Filler word', cue: 'You asked for a retake', rejected: 'A take you rejected', retake: 'An earlier take',
  false_start: 'A false start', off_topic: 'Not part of the video', member: 'You cut this', no_screen: 'Before or after your screen recording'
}

export interface EditWord { text: string; startMs: number; endMs: number; src: number; cut: CutReason | null }
export interface EditSpan { start: number; end: number }
export interface EditHook extends EditSpan { id: number; text: string; why: string }
/**
 * A half-screen explainer card: the top half of the frame for a few seconds (the speaker moves to the bottom half),
 * drawn from text only. list: title + 2-4 items; stat: title is the big number, items[0] what it is; compare: items are
 * [before, after] (title optional); chat: items are [the question, the reply].
 */
export const CARD_TYPES = ['list', 'stat', 'compare', 'chat'] as const
export type EditCardType = (typeof CARD_TYPES)[number]
export const CARD_TYPE_LABELS: Record<EditCardType, string> = { list: 'List', stat: 'Big number', compare: 'Before and after', chat: 'Chat' }
export interface EditCard { type: EditCardType; title: string; items: string[] }
export const MAX_CARD_TITLE_CHARS = 48
export const MAX_CARD_ITEM_CHARS = 60
export const MAX_CARD_ITEMS = 4
export const CARD_MIN_SECONDS = 2
export const CARD_MAX_SECONDS = 5

export interface EditPopup { id: number; word: number; text: string; kind: 'number' | 'keyword' | 'card'; card?: EditCard; seconds?: number }

/** The member's own pictures (logos, product shots), copied into the run folder, popped up on words they pin them to. */
/**
 * A picture in the run folder. `screenshot`: one the member added for the video when starting (a page, an app, a
 * proof post); the automatic graphics may show it in a browser or phone frame, a before and after or a light sweep.
 * `box`: the part of it that matters (x, y, w, h as shares of it), which those graphics circle or underline.
 */
export interface EditImage { id: string; name: string; path: string; screenshot?: boolean; box?: [number, number, number, number]
  /** A phone-shaped screenshot (it goes in a phone, not a browser window). */
  tall?: boolean }
export const EDIT_MAX_IMAGES = 8
/** Screenshots added for the video when starting (they count toward the run's images). */
export const EDIT_MAX_SCREENSHOTS = 6
/** A screenshot's box ("the part that matters"), checked: four shares inside the picture, or null. */
export function parseScreenshotBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [x, y, w, h] = value as number[]
  if (x < 0 || y < 0 || w < 0.01 || h < 0.01 || x + w > 1.001 || y + h > 1.001) return null
  return [x, y, w, h].map((n) => Math.round(n * 1000) / 1000) as [number, number, number, number]
}
export const EDIT_MAX_PINS = 12
export const EDIT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
export const EDIT_MAX_IMAGE_BYTES = 12 * 1024 * 1024
/** The cut-out opening and the raw-to-edited opening, in seconds. */
export const CUTOUT_INTRO_SECONDS = 3
export const RAW_INTRO_SECONDS = 3.5
export interface EditSound { id: number; at: number | 'title'; sound: EditSoundName }

export interface EditPlan {
  words: EditWord[]
  hooks: EditHook[]
  /** The hook the plan opens on (an id in hooks), or null. */
  hook: number | null
  /** The call to action said in the recording, moved to the end. */
  cta: EditSpan | null
  popups: EditPopup[]
  sounds: EditSound[]
  /** 'basic' when the AI plan didn't come back and only the local checks ran. */
  planned: 'ai' | 'basic'
  notes: string[]
  warnings: string[]
  /** Combine clips only: the clips' order and proof graphics (words' `src` is the clip, numbered in filming order). */
  combine?: EditCombine
  /** The automatic direction: the motion graphics the plan suggests, each on the word where it starts (origin 'auto'). */
  graphics?: EditGraphic[]
  /** The style the graphics were planned in (register.ts: the member's, else read from the words); the review's Style starts there. */
  register?: Register
  /** Planned graphics the plan didn't use (teaching density, only words said): what "Dress it up" adds without another AI call. */
  spareGraphics?: EditGraphic[]
  /**
   * The same recording made before: whether its last headline was kept on the first hook (it must use only words
   * said in this recording), and the AI's new headline for that hook (offered as "New headline").
   */
  keptHook?: EditKeptHook
}

export interface EditKeptHook { kept: boolean; text: string; fresh: string }

/** A stat graphic the plan suggests on a number said while filming a screen (value as said, label in their words). */
export interface EditProof { word: number; value: string; label: string }

export interface EditCombine {
  /** The AI's order (every clip once), or null when it didn't give one. */
  aiOrder: number[] | null
  /** One line: why the AI's order. */
  orderWhy: string
  proof: EditProof[]
  /** The order the review starts with: filming order (0, 1, 2, …), or the AI's when the member asked for it. */
  startOrder: number[]
}

export interface EditSource {
  path: string; name: string; seconds: number
  /** Combine clips: when the camera wrote the file (container creation_time, ISO), for filming order. */
  createdAt?: string
  /** Combine clips, after they are made ready: the 1080p proxy (also for previews), a thumbnail and the shot type. */
  proxy?: string
  thumb?: string
  shot?: ShotType
  /** A screen shot that was steadied. */
  steadied?: boolean
}

export type EditPhase = 'transcribing' | 'planning' | 'review' | 'rendering' | 'done' | 'failed' | 'cancelled'

export interface EditStatus {
  id: string
  phase: EditPhase
  detail: string
  percent: number
  sources: EditSource[]
  /** The run folder in the output folder (edit-<uuid>). */
  folder: string
  plan: EditPlan | null
  /** How the words were heard. */
  transcriber: 'scribe' | 'standard' | null
  output: { path: string; durationSeconds: number } | null
  /** What this run's AI calls cost so far (as reported, or estimated where a provider reports none). */
  costUsd: number
  estimateUsd: number | null
  error: string | null
  warnings: string[]
  /** "My images" added on the review screen. */
  images?: EditImage[]
  /** Retakes of one video (missing: this), or clips combined into one. */
  mode?: EditMode
  /** Camera + screen: the screen recording made with the camera recording, and how they line up. */
  screen?: EditScreen
  /** The finished reel is a clip editor project (open it in the editor to change its graphics, scenes, hook text and captions). */
  editor?: boolean
  /** The run in stages, for the progress view (edit-progress.ts). Missing on runs from before it. */
  progress?: EditProgress
}

/** A run's screen recording (camera + screen). */
export interface EditScreen {
  path: string; name: string; seconds: number
  /** How long after the camera the screen recording started (negative: before). */
  offsetMs: number
  /** Where the screen recording runs, in camera time (ms). */
  overlapMs: [number, number]
}

export interface EditLook {
  includeCaptions: boolean
  captionPreset: string
  headlineLook: HeadlineLook
  /** The brand's handle or logo in a corner. */
  showHandle: boolean
  /** Extras on top of the look (keyword pill, progress bar, ...): look-extras.ts. Missing: none. */
  lookExtras?: LookExtraId[]
  /** Background music (Skills). Missing: off. */
  music?: boolean
  /** The music track (an id from the track list); only with music on. */
  musicTrack?: string
  /** Clean up the voice (Skills). Missing: off. */
  voiceCleanup?: boolean
  /** B-roll over the speaker (Skills), and where it comes from (broll-library.ts). Missing or null: off. */
  broll?: BrollSource | null
  /** Color grade on the footage only (color-grade.ts). Missing: none. */
  grade?: ColorGrade
}

export const DEFAULT_EDIT_LOOK: EditLook = { includeCaptions: true, captionPreset: DEFAULT_CAPTION_PRESET, headlineLook: DEFAULT_HEADLINE_LOOK, showHandle: false }

/** The member's choices on the review screen. */
export interface EditDecisions {
  /** Every word index that is cut. */
  cut: number[]
  hookId: number | null
  hookText: string
  /** End on the call to action they said (moved to the end). */
  endOnCta: boolean
  popups: { id: number; on: boolean; text: string; card?: EditCard }[]
  sounds: { id: number; on: boolean }[]
  look: EditLook
  /** The edit style: pacing, and what starts switched on. */
  recipe: EditRecipeId
  /** Motion extras on top of the look (see look-extras.ts; the engine draws them). */
  lookExtras: LookExtraId[]
  /** My images pinned to words: each pops up, centered, as the word is said. */
  pins: { image: string; word: number }[]
  /** For the first seconds, the speaker cut out over a blurred collage of their images. */
  cutoutIntro: boolean
  /** A short opening card: the raw take with what was cut marked, then the reel. */
  rawIntro: boolean
  /** Motion graphics, each starting as its word is said (missing: none). */
  graphics?: EditGraphic[]
  /** The plan's automatic motion graphics and chapter headers (Skills; missing: on). The member's own graphics stay either way. */
  motionGraphics?: boolean
  /** Stage layouts (Skills; missing: on): big cards on a stage at the top with the speaker in a card below, diagrams full frame. */
  stageLayouts?: boolean
  /** Reduce background noise and room echo on the voice and even its level (missing: off). */
  voiceCleanup?: boolean
  /** Background music under the reel, ducking while they talk; `musicTrack` is the track (see music.ts). */
  music?: boolean
  musicTrack?: string
  /** Combine clips: the clips in the order they play (a clip left out is removed from the reel). */
  clipOrder?: number[]
  /** Combine clips: a quick dip through black at each change of clip (missing: clean cuts). */
  transitions?: boolean
  /** Camera + screen: how the two are shown (missing: the defaults). */
  screen?: ScreenChoice
  /** Sound effects on the reel's graphics, scenes and cuts (Skills; missing: on unless every planned sound is off). */
  soundEffects?: boolean
  /** The style (register.ts): how much sound plays, and with Minimal only numbers, the hook and the call to action keep their automatic graphics (missing: teaching). */
  soundStyle?: SoundRegister
}

/** Whether the reel gets sound effects: the switch when set, else on while any planned sound is (or none were planned). */
export function soundEffectsOn(decisions: Pick<EditDecisions, 'sounds' | 'soundEffects'>): boolean {
  return decisions.soundEffects ?? (decisions.sounds.length === 0 || decisions.sounds.some((sound) => sound.on))
}

export interface EditStartRequest {
  sources: string[]
  /** Retakes of the same thing (missing: this), or parts of one video to combine. */
  mode?: EditMode
  /** Combine clips: start in filming order, or in the order the AI finds best. */
  order?: ClipOrderMode
  brandIdentityId: string | null
  /** From "What should I film?": the hook they meant to open with (a hint for the plan, never shown as is). */
  hookHint?: string
  /** What the video is for, in the member's words: steers the hook, title and pop-ups the plan picks. */
  purpose?: string
  /** A reference image ("A look you like"): the id of a picture chosen with reference:choose. */
  referenceImage?: string
  /** Camera + screen: a screen recording made at the same time as the (one) camera recording, and how they line up. */
  screen?: { path: string; offsetMs: number }
  /** Write a new headline even when these recordings were made before (missing: keep the last one). */
  newHeadline?: boolean
  /** Screenshots for the video (pages, apps, proof posts), each with the part that matters boxed (optional). */
  screenshots?: { path: string; box?: [number, number, number, number] }[]
}

export function isRunningEdit(status: EditStatus | null | undefined): boolean {
  return status?.phase === 'transcribing' || status?.phase === 'planning' || status?.phase === 'rendering'
}

/** What transcribing and planning cost, from the listed prices, for this many seconds of recording. */
export function editEstimate(seconds: number, scribe = true): { transcribeUsd: number; planUsd: number; total: number } {
  const s = Math.max(0, seconds)
  // Without Scribe the app's usual transcription runs: the per-hour price covers both.
  const transcribeUsd = scribe ? s * SCRIBE_PRICE_PER_SECOND : 0
  const planUsd = PLAN_PRICE_PER_HOUR * Math.max(0.05, s / 3600)
  return { transcribeUsd, planUsd, total: transcribeUsd + planUsd }
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return 'under 1¢'
  return `$${value.toFixed(2)}`
}

/** An estimate in words: "under 1¢" or "about $0.12". */
export function aboutUsd(value: number): string {
  return value > 0 && value < 0.01 ? 'under 1¢' : `about ${formatUsd(value)}`
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// The review: start from the plan, toggle words, read the result
// ---------------------------------------------------------------------------

export function initialDecisions(plan: EditPlan, look: EditLook = DEFAULT_EDIT_LOOK, recipe: EditRecipeId = DEFAULT_EDIT_RECIPE): EditDecisions {
  const hook = plan.hooks.find((item) => item.id === plan.hook) ?? null
  // The plan's graphics, then (combine clips) its proof stats on numbers said where no planned graphic starts already.
  const planned = plan.graphics ?? []
  const proof = plan.combine ? proofGraphics(plan).filter((g) => !planned.some((p) => p.word === g.word)) : []
  const graphics = [...planned.map((g) => ({ ...g, fields: { ...g.fields } })), ...proof].sort((a, b) => a.word - b.word).slice(0, MAX_EDIT_GRAPHICS)
  const combine = plan.combine ? { clipOrder: [...plan.combine.startOrder], transitions: false } : {}
  // The plan's style (one choice for graphics and sound) is where the review's Style starts.
  const direction = plan.graphics !== undefined ? { motionGraphics: true, stageLayouts: true, ...(plan.register ? { soundStyle: plan.register } : {}) } : {}
  return applyRecipe(plan, {
    cut: plan.words.flatMap((word, i) => (word.cut ? [i] : [])),
    hookId: hook?.id ?? null,
    hookText: hook?.text ?? '',
    endOnCta: plan.cta !== null,
    popups: plan.popups.map((popup) => ({ id: popup.id, on: true, text: popup.text, ...(popup.card ? { card: copyCard(popup.card) } : {}) })),
    sounds: plan.sounds.map((sound) => ({ id: sound.id, on: true })),
    look, recipe, lookExtras: [], pins: [], cutoutIntro: false, rawIntro: false, graphics, ...combine, ...direction
  }, recipe)
}

/** Combine clips: the plan's proof stat graphics (marked as added by the app, so "What changed" lists them). */
export function proofGraphics(plan: EditPlan): EditGraphic[] {
  const taken: string[] = []
  return (plan.combine?.proof ?? []).map((proof) => {
    const graphic = newEditGraphic(newGraphic('stat', 0, { fields: { value: proof.value, ...(proof.label ? { label: proof.label } : {}) }, origin: 'auto', taken }), proof.word)
    taken.push(graphic.id)
    return graphic
  })
}

function copyCard(card: EditCard): EditCard {
  return { type: card.type, title: card.title, items: [...card.items] }
}

/**
 * Pick an edit style: its extras, and which pop-ups and cards start on (the first ones it allows, in the order they
 * play). Text the member typed into pop-ups and cards is kept.
 */
export function applyRecipe(plan: EditPlan, decisions: EditDecisions, id: EditRecipeId): EditDecisions {
  const recipe = editRecipe(id)
  let texts = 0, cards = 0
  const on = new Map<number, boolean>()
  for (const popup of [...plan.popups].sort((a, b) => a.word - b.word)) {
    if (popup.kind === 'card') on.set(popup.id, cards++ < recipe.cards)
    else on.set(popup.id, texts++ < recipe.popups)
  }
  return {
    ...decisions, recipe: recipe.id, lookExtras: recipeExtras(recipe.id),
    popups: decisions.popups.map((item) => ({ ...item, on: on.get(item.id) ?? item.on }))
  }
}

/** The member's images that are pinned to a word still in the reel. */
export function livePins(decisions: EditDecisions): { image: string; word: number }[] {
  const cut = new Set(decisions.cut)
  return decisions.pins.filter((pin) => !cut.has(pin.word))
}

/** Cut or keep one word. */
export function toggleWord(decisions: EditDecisions, index: number): EditDecisions {
  const cut = new Set(decisions.cut)
  if (cut.has(index)) cut.delete(index)
  else cut.add(index)
  return { ...decisions, cut: [...cut].sort((a, b) => a - b) }
}

/** Cut a span, or keep it again when all of it was cut. */
export function toggleSpan(decisions: EditDecisions, start: number, end: number): EditDecisions {
  const [from, to] = start <= end ? [start, end] : [end, start]
  const cut = new Set(decisions.cut)
  const all = Array.from({ length: to - from + 1 }, (_, k) => from + k)
  const allCut = all.every((i) => cut.has(i))
  for (const i of all) {
    if (allCut) cut.delete(i)
    else cut.add(i)
  }
  return { ...decisions, cut: [...cut].sort((a, b) => a - b) }
}

/** Choose another hook: its words play first (kept), and its title text comes with it unless the member typed their own. */
export function chooseHook(plan: EditPlan, decisions: EditDecisions, hookId: number | null): EditDecisions {
  const hook = plan.hooks.find((item) => item.id === hookId) ?? null
  const previous = plan.hooks.find((item) => item.id === decisions.hookId) ?? null
  const typed = previous ? decisions.hookText.trim() !== previous.text : decisions.hookText.trim() !== ''
  const cut = new Set(decisions.cut)
  if (hook) for (let i = hook.start; i <= hook.end; i++) if (!['filler', 'cue'].includes(plan.words[i]?.cut ?? '')) cut.delete(i)
  return { ...decisions, hookId: hook?.id ?? null, hookText: typed ? decisions.hookText : hook?.text ?? '', cut: [...cut].sort((a, b) => a - b) }
}

/**
 * The words in the order the reel plays them: the hook, the rest as recorded, the call to action. Combine clips: the
 * rest plays clip by clip in the member's order, and the words of a clip left out don't play at all.
 */
export function reelOrder(plan: EditPlan, decisions: EditDecisions): number[] {
  const cut = new Set(decisions.cut)
  const place = decisions.clipOrder ? new Map(decisions.clipOrder.map((src, k) => [src, k])) : null
  const plays = (i: number): boolean => !cut.has(i) && (!place || place.has(plan.words[i].src))
  const hook = plan.hooks.find((item) => item.id === decisions.hookId) ?? null
  const range = (span: EditSpan | null): number[] => span ? Array.from({ length: span.end - span.start + 1 }, (_, k) => span.start + k).filter(plays) : []
  const first = range(hook)
  const last = decisions.endOnCta ? range(plan.cta).filter((i) => !first.includes(i)) : []
  const taken = new Set([...first, ...last])
  const body = plan.words.map((_, i) => i).filter((i) => plays(i) && !taken.has(i))
  if (place) body.sort((a, b) => place.get(plan.words[a].src)! - place.get(plan.words[b].src)! || a - b)
  return [...first, ...body, ...last]
}

/** About how long the reel will be: the kept words, with long pauses tightened like the render does. */
export function reelSeconds(plan: EditPlan, decisions: EditDecisions): number {
  const order = reelOrder(plan, decisions)
  const { maxPause, keepPause } = editRecipe(decisions.recipe).pacing
  let total = decisions.rawIntro ? RAW_INTRO_SECONDS : 0
  order.forEach((i, k) => {
    const word = plan.words[i]
    total += (word.endMs - word.startMs) / 1000
    const next = order[k + 1]
    if (next === i + 1 && plan.words[next].src === word.src) {
      const gap = Math.max(0, (plan.words[next].startMs - word.endMs) / 1000)
      total += gap > maxPause ? keepPause : gap
    } else total += 0.22
  })
  return total
}

/**
 * About when each kept word starts in the reel (seconds, without the raw-to-edited opening), like reelSeconds: for
 * the graphics strip, and to warn about a graphic over a card before the reel is made.
 */
export function reelWordStarts(plan: EditPlan, decisions: EditDecisions): Map<number, number> {
  const order = reelOrder(plan, decisions)
  const { maxPause, keepPause } = editRecipe(decisions.recipe).pacing
  const starts = new Map<number, number>()
  let total = 0
  order.forEach((i, k) => {
    const word = plan.words[i]
    starts.set(i, total)
    total += (word.endMs - word.startMs) / 1000
    const next = order[k + 1]
    if (next === i + 1 && plan.words[next].src === word.src) {
      const gap = Math.max(0, (plan.words[next].startMs - word.endMs) / 1000)
      total += gap > maxPause ? keepPause : gap
    } else total += 0.22
  })
  return starts
}

/** The half-screen cards that will show (start and end seconds on the reel), like the engine places them. */
export function reelCardWindows(plan: EditPlan, decisions: EditDecisions, starts = reelWordStarts(plan, decisions)): { start: number; end: number; id: number }[] {
  const total = reelSeconds(plan, decisions) - (decisions.rawIntro ? RAW_INTRO_SECONDS : 0)
  const out: { start: number; end: number; id: number }[] = []
  const cards = plan.popups.filter((p) => p.kind === 'card' && decisions.popups.find((d) => d.id === p.id)?.on && starts.has(p.word))
    .map((p) => ({ id: p.id, at: starts.get(p.word)!, seconds: Math.min(CARD_MAX_SECONDS, Math.max(CARD_MIN_SECONDS, p.seconds ?? 3)) }))
    .sort((a, b) => a.at - b.at)
  for (const card of cards) {
    const start = Math.max(1.2, card.at), end = Math.min(start + card.seconds, total - 0.15)
    if (out.length && start < out[out.length - 1].end + 0.3) continue
    if (end - start >= 1.5) out.push({ start, end, id: card.id })
  }
  return out
}

export function hookTextProblem(text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  if (clean.length > MAX_HOOK_TEXT_CHARS) return `Keep the hook text to ${MAX_HOOK_TEXT_CHARS} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>{}\\]/.test(clean)) return 'Use plain text for the hook (no < > { } or \\).'
  return null
}

// ---------------------------------------------------------------------------
// Checking what comes from another process
// ---------------------------------------------------------------------------

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const int = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : null

/** The engine's plan, checked (null when it isn't one). */
export function parseEditPlan(value: unknown, sources: number): EditPlan | null {
  if (!record(value) || !Array.isArray(value.words) || value.words.length === 0 || value.words.length > 8000) return null
  const words: EditWord[] = []
  for (const item of value.words) {
    if (!Array.isArray(item) || item.length !== 5) return null
    const [t, s, e, src, cut] = item
    const word = text(t, 60)
    if (!word || !int(s, 0, 4 * 3600_000) || !int(e, s as number, 4 * 3600_000) || !int(src, 0, sources - 1)) return null
    if (cut !== null && !(CUT_REASONS as readonly unknown[]).includes(cut)) return null
    words.push({ text: word, startMs: s as number, endMs: e as number, src: src as number, cut: cut as CutReason | null })
  }
  const n = words.length
  const span = (raw: unknown): EditSpan | null => record(raw) && int(raw.start, 0, n - 1) && int(raw.end, raw.start as number, n - 1) ? { start: raw.start as number, end: raw.end as number } : null
  const hooks: EditHook[] = []
  for (const raw of Array.isArray(value.hooks) ? value.hooks.slice(0, 3) : []) {
    const s = span(raw)
    if (!s || !record(raw) || !int(raw.id, 0, 10)) continue
    hooks.push({ ...s, id: raw.id as number, text: (text(raw.text, MAX_HOOK_TEXT_CHARS) ?? '').trim(), why: (text(raw.why, 240) ?? '').trim() })
  }
  const popups: EditPopup[] = []
  for (const raw of Array.isArray(value.popups) ? value.popups.slice(0, 12) : []) {
    if (!record(raw) || !int(raw.id, 0, 50) || !int(raw.word, 0, n - 1)) continue
    if (raw.kind === 'card') {
      const card = parseCard(raw.card)
      if (!card) continue
      const seconds = typeof raw.seconds === 'number' && Number.isFinite(raw.seconds) ? Math.min(CARD_MAX_SECONDS, Math.max(CARD_MIN_SECONDS, raw.seconds)) : 3
      popups.push({ id: raw.id as number, word: raw.word as number, text: cardSummary(card), kind: 'card', card, seconds })
      continue
    }
    const label = text(raw.text, MAX_POPUP_TEXT_CHARS)
    if (!label?.trim()) continue
    popups.push({ id: raw.id as number, word: raw.word as number, text: label.trim(), kind: raw.kind === 'number' ? 'number' : 'keyword' })
  }
  const sounds: EditSound[] = []
  for (const raw of Array.isArray(value.sounds) ? value.sounds.slice(0, 12) : []) {
    if (!record(raw) || !int(raw.id, 0, 50) || !(EDIT_SOUNDS as readonly unknown[]).includes(raw.sound)) continue
    if (raw.at !== 'title' && !int(raw.at, 0, n - 1)) continue
    sounds.push({ id: raw.id as number, at: raw.at as number | 'title', sound: raw.sound as EditSoundName })
  }
  const lines = (raw: unknown, max: number): string[] => Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 300)).slice(0, max) : []
  const hook = int(value.hook, 0, 10) && hooks.some((item) => item.id === value.hook) ? value.hook as number : hooks[0]?.id ?? null
  const combine = value.combine === undefined ? undefined : parseCombine(value.combine, words, sources)
  if (combine === null) return null
  // The planned graphics (each checked like the review's; one that isn't well-formed is left out).
  let graphics: EditGraphic[] | undefined
  if (Array.isArray(value.graphics)) {
    graphics = []
    for (const raw of value.graphics.slice(0, MAX_EDIT_GRAPHICS)) {
      try { graphics.push(...parseEditGraphics([raw], n).filter((g) => !graphics!.some((x) => x.id === g.id))) } catch { /* left out */ }
    }
  }
  const spare: EditGraphic[] = []
  const spareRaw = value.spareGraphics ?? value.spare_graphics
  for (const raw of Array.isArray(spareRaw) ? spareRaw.slice(0, 8) : []) {
    try { spare.push(...parseEditGraphics([raw], n).filter((g) => g.origin === 'auto' && !spare.some((x) => x.id === g.id) && !(graphics ?? []).some((x) => x.id === g.id))) } catch { /* left out */ }
  }
  const keptRaw = value.keptHook ?? value.kept_hook
  const keptHook = record(keptRaw) && typeof keptRaw.kept === 'boolean' && hooks.length
    ? { kept: keptRaw.kept, text: (text(keptRaw.text, MAX_HOOK_TEXT_CHARS) ?? '').trim(), fresh: (text(keptRaw.fresh, MAX_HOOK_TEXT_CHARS) ?? '').trim() } : null
  return { words, hooks, hook, cta: span(value.cta), popups, sounds, planned: value.planned === 'basic' ? 'basic' : 'ai', notes: lines(value.notes, 6), warnings: lines(value.warnings, 4),
    ...(combine ? { combine } : {}), ...(graphics ? { graphics } : {}), ...(keptHook && (!keptHook.kept || keptHook.text) ? { keptHook } : {}),
    ...(isRegister(value.register) ? { register: value.register } : {}), ...(spare.length ? { spareGraphics: spare } : {}) }
}

/** The plan's combine part (engine: ai_order, order_why, proof; or already parsed), checked; null when it isn't one. */
function parseCombine(raw: unknown, words: EditWord[], count: number): EditCombine | null {
  if (!record(raw)) return null
  const aiRaw = raw.aiOrder ?? raw.ai_order
  const aiOrder = aiRaw === null || aiRaw === undefined ? null : parseClipOrder(aiRaw, count)
  if (aiRaw !== null && aiRaw !== undefined && (!aiOrder || aiOrder.length !== count)) return null
  const why = cleanLine(raw.orderWhy ?? raw.order_why ?? '', 200)
  const proof: EditProof[] = []
  for (const item of Array.isArray(raw.proof) ? raw.proof.slice(0, 3) : []) {
    const value = record(item) ? cleanLine(item.value, 24) : null
    const label = record(item) ? cleanLine(item.label ?? '', 40) : null
    if (!record(item) || !int(item.word, 0, words.length - 1) || !value || label === null) continue
    proof.push({ word: item.word as number, value, label })
  }
  const start = raw.startOrder === undefined ? Array.from({ length: count }, (_, i) => i) : parseClipOrder(raw.startOrder, count)
  if (!start) return null
  return { aiOrder, orderWhy: aiOrder ? why ?? '' : '', proof, startOrder: start }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const cleanLine = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length <= max && !CONTROL.test(line) && !/[<>{}\\]/.test(line) ? line : null
}

/** A card from another process (or the page), checked: null when it isn't one. */
export function parseCard(raw: unknown): EditCard | null {
  if (!record(raw) || !(CARD_TYPES as readonly unknown[]).includes(raw.type) || !Array.isArray(raw.items) || raw.items.length > MAX_CARD_ITEMS) return null
  const title = cleanLine(raw.title ?? '', MAX_CARD_TITLE_CHARS)
  const items = raw.items.map((item) => cleanLine(item, MAX_CARD_ITEM_CHARS))
  if (title === null || items.some((item) => item === null)) return null
  const card: EditCard = { type: raw.type as EditCardType, title, items: items as string[] }
  return cardProblem(card) ? null : card
}

/** What a card is missing to be drawn, in plain words (null when it's fine). */
export function cardProblem(card: EditCard): string | null {
  const filled = card.items.filter((item) => item.trim()).length
  if (card.type === 'list') return !card.title.trim() || filled < 2 ? 'A list card needs a title and at least two items.' : null
  if (card.type === 'stat') return !card.title.trim() || !card.items[0]?.trim() ? 'A big-number card needs the number and what it is.' : null
  return card.items.length < 2 || !card.items[0]?.trim() || !card.items[1]?.trim()
    ? card.type === 'compare' ? 'A before-and-after card needs both sides.' : 'A chat card needs the question and the reply.' : null
}

/** One line for a card (its title, or its first line). */
export function cardSummary(card: EditCard): string {
  return (card.title || card.items[0] || '').slice(0, MAX_CARD_TITLE_CHARS)
}

/** The review screen's choices from the page, checked against the plan (and the run's images); throws with a plain message. */
export function parseEditDecisions(value: unknown, plan: EditPlan, images: readonly EditImage[] = []): EditDecisions {
  if (!record(value)) throw new Error('Review your edit, then make the reel.')
  const n = plan.words.length
  if (!Array.isArray(value.cut) || value.cut.length > n || !value.cut.every((i) => int(i, 0, n - 1))) throw new Error('Choose the words to keep from the transcript.')
  const cut = [...new Set(value.cut as number[])].sort((a, b) => a - b)
  if (value.hookId !== null && !plan.hooks.some((hook) => hook.id === value.hookId)) throw new Error('Choose one of the hooks.')
  const hookText = typeof value.hookText === 'string' ? value.hookText.replace(/\s+/g, ' ').trim() : null
  if (hookText === null) throw new Error('Type your hook text.')
  const problem = hookTextProblem(hookText)
  if (problem) throw new Error(problem)
  if (typeof value.endOnCta !== 'boolean') throw new Error('Choose whether to end on your call to action.')
  if (!Array.isArray(value.popups) || !Array.isArray(value.sounds)) throw new Error('Choose which pop-ups and sounds to keep.')
  const popups = value.popups.map((raw) => {
    const planned = record(raw) ? plan.popups.find((popup) => popup.id === raw.id) : undefined
    if (!record(raw) || typeof raw.on !== 'boolean' || !planned) throw new Error('Choose which pop-ups to keep.')
    if (planned.kind === 'card') {
      const card = record(raw.card) ? { type: raw.card.type, title: raw.card.title, items: raw.card.items } : null
      const checked = card && card.type === planned.card?.type ? parseCardLoose(card) : null
      if (!checked) throw new Error(`Keep card text plain and short (a title up to ${MAX_CARD_TITLE_CHARS} characters, items up to ${MAX_CARD_ITEM_CHARS}).`)
      const missing = raw.on ? cardProblem(checked) : null
      if (missing) throw new Error(missing)
      return { id: raw.id as number, on: raw.on, text: cardSummary(checked), card: checked }
    }
    const label = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim() : ''
    // eslint-disable-next-line no-control-regex
    if ((raw.on && !label) || label.length > MAX_POPUP_TEXT_CHARS || /[\u0000-\u001f\u007f]/.test(label)) throw new Error(`Keep each pop-up to ${MAX_POPUP_TEXT_CHARS} characters.`)
    return { id: raw.id as number, on: raw.on, text: label }
  })
  const sounds = value.sounds.map((raw) => {
    if (!record(raw) || typeof raw.on !== 'boolean' || !plan.sounds.some((sound) => sound.id === raw.id)) throw new Error('Choose which sounds to keep.')
    return { id: raw.id as number, on: raw.on }
  })
  const look = record(value.look) ? value.look : null
  if (!look || typeof look.includeCaptions !== 'boolean' || !isCaptionPresetId(look.captionPreset) || typeof look.showHandle !== 'boolean') throw new Error('Choose your captions and look.')
  if (value.recipe !== undefined && !isEditRecipeId(value.recipe)) throw new Error('Choose one of the edit styles.')
  if (value.pins !== undefined && (!Array.isArray(value.pins) || value.pins.length > EDIT_MAX_PINS)) throw new Error(`Pin up to ${EDIT_MAX_PINS} images.`)
  const pins = (Array.isArray(value.pins) ? value.pins : []).map((raw) => {
    if (!record(raw) || typeof raw.image !== 'string' || !images.some((image) => image.id === raw.image) || !int(raw.word, 0, n - 1)) throw new Error('Pin each image to a word in your video.')
    return { image: raw.image, word: raw.word as number }
  })
  for (const key of ['cutoutIntro', 'rawIntro'] as const) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('Choose how your video opens.')
  for (const key of ['motionGraphics', 'stageLayouts', 'soundEffects'] as const) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('Choose your skills again.')
  if (value.soundStyle !== undefined && !isSoundRegister(value.soundStyle)) throw new Error('Choose how much sound plays.')
  if (look.grade !== undefined && !isColorGrade(look.grade)) throw new Error('Choose a color grade from the list.')
  let graphics: EditGraphic[]
  try { graphics = parseEditGraphics(value.graphics, n) } catch (error) { throw new Error(`Check your graphics: ${(error as Error).message}`) }
  if (look.lookExtras !== undefined && !Array.isArray(look.lookExtras)) throw new Error('Choose your extras again.')
  // Extras can come from the edit style chips (decisions) or the look board (look): one list either way.
  const lookExtras = parseLookExtras([...(Array.isArray(value.lookExtras) ? value.lookExtras : []), ...(Array.isArray(look.lookExtras) ? look.lookExtras : [])])
  // Voice cleanup and music: on the decisions, or (from the look board) on the look.
  // (Music switched on from the Skills panel without a pick gets the first built-in track.)
  const audio = parseAudioSkills({
    voiceCleanup: value.voiceCleanup ?? look.voiceCleanup, music: value.music ?? look.music, musicTrack: value.musicTrack ?? look.musicTrack
  })
  const decisions: EditDecisions = { cut, hookId: value.hookId as number | null, hookText, endOnCta: value.endOnCta, popups, sounds,
    look: { includeCaptions: look.includeCaptions, captionPreset: look.captionPreset, headlineLook: parseHeadlineLook(look.headlineLook), showHandle: look.showHandle,
      ...(lookExtras.length ? { lookExtras } : {}), ...audio, ...(isBrollSource(look.broll) ? { broll: look.broll } : {}),
      ...(isColorGrade(look.grade) && look.grade !== 'none' ? { grade: look.grade } : {}) },
    recipe: isEditRecipeId(value.recipe) ? value.recipe : DEFAULT_EDIT_RECIPE, lookExtras, pins,
    cutoutIntro: value.cutoutIntro === true, rawIntro: value.rawIntro === true, graphics, ...audio,
    ...(typeof value.motionGraphics === 'boolean' ? { motionGraphics: value.motionGraphics } : {}),
    ...(typeof value.stageLayouts === 'boolean' ? { stageLayouts: value.stageLayouts } : {}),
    ...(typeof value.soundEffects === 'boolean' ? { soundEffects: value.soundEffects } : {}),
    ...(isSoundRegister(value.soundStyle) ? { soundStyle: value.soundStyle } : {}) }
  if (plan.combine) {
    const order = value.clipOrder === undefined ? [...plan.combine.startOrder] : parseClipOrder(value.clipOrder, plan.combine.startOrder.length)
    if (!order) throw new Error('Put your clips in order again.')
    if (value.transitions !== undefined && typeof value.transitions !== 'boolean') throw new Error('Choose whether to add transitions between clips.')
    decisions.clipOrder = order
    decisions.transitions = value.transitions === true
  }
  if (reelOrder(plan, decisions).length < 3) throw new Error('Keep a few more words: the reel would be almost empty.')
  return decisions
}

/** A card the member is editing: same checks as parseCard, but an unfinished card (missing a line) is allowed while it's off. */
function parseCardLoose(raw: { type: unknown; title: unknown; items: unknown }): EditCard | null {
  if (!(CARD_TYPES as readonly unknown[]).includes(raw.type) || !Array.isArray(raw.items) || raw.items.length > MAX_CARD_ITEMS) return null
  const title = cleanLine(raw.title ?? '', MAX_CARD_TITLE_CHARS)
  const items = raw.items.map((item) => cleanLine(item, MAX_CARD_ITEM_CHARS))
  if (title === null || items.some((item) => item === null)) return null
  return { type: raw.type as EditCardType, title, items: items as string[] }
}

// ---------------------------------------------------------------------------
// "What should I film?"
// ---------------------------------------------------------------------------

export const FILM_FORMATS = [
  { id: 'camera', label: 'Straight to camera', detail: 'Film it here, then Edit my recording makes the reel.' },
  { id: 'pause_react', label: 'Pause & react', detail: 'React to a video, pausing it to talk (in Remix).' },
  { id: 'moment_take', label: 'Moment + my take', detail: 'A moment from a long video, then your take (in Remix).' }
] as const
export type FilmFormat = (typeof FILM_FORMATS)[number]['id']

export interface FilmIdea { title: string; hook: string; points: string[]; format: FilmFormat; why: string }
export interface FilmIdeasRequest { brandIdentityId: string | null; material: string; topic: string }
export const MAX_IDEA_MATERIAL_CHARS = 20000
export const MAX_IDEA_TOPIC_CHARS = 300
export const FILM_IDEA_COUNT = 5

/** Numbers written with digits in a text ("15", "1,200", "3.5" → "15", "1200", "3.5"). */
export function digitNumbers(value: string): string[] {
  return (value.match(/\d[\d,.]*/g) ?? []).map((item) => item.replace(/[.,]+$/, '').replace(/,(?=\d{3}\b)/g, '')).filter(Boolean)
}

/** Ideas from the model, checked: only ideas whose numbers appear in the member's own text are kept. */
export function parseFilmIdeas(raw: unknown, sourceText: string): FilmIdea[] {
  const ideas = record(raw) && Array.isArray(raw.ideas) ? raw.ideas : []
  const known = new Set(digitNumbers(sourceText))
  const clean = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
  const out: FilmIdea[] = []
  for (const item of ideas.slice(0, 10)) {
    if (!record(item)) continue
    const idea: FilmIdea = {
      title: clean(item.title, 80), hook: clean(item.hook, 160),
      points: (Array.isArray(item.points) ? item.points : []).map((point) => clean(point, 120)).filter(Boolean).slice(0, 3),
      format: FILM_FORMATS.some((format) => format.id === item.format) ? item.format as FilmFormat : 'camera',
      why: clean(item.why, 200)
    }
    if (!idea.hook || idea.points.length < 3) continue
    const said = [idea.title, idea.hook, ...idea.points, idea.why].join(' ')
    if (digitNumbers(said).some((number) => !known.has(number))) continue
    out.push({ ...idea, title: idea.title || idea.hook.split(' ').slice(0, 6).join(' ') })
    if (out.length === FILM_IDEA_COUNT) break
  }
  return out
}
