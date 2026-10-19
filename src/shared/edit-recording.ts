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
export const SOUND_LABELS: Record<EditSoundName, string> = { whoosh: 'Soft whoosh', pop: 'Pop', click: 'Click', ding: 'Ding', thud: 'Soft thud' }

export const CUT_REASONS = ['filler', 'cue', 'rejected', 'retake', 'false_start', 'off_topic', 'member'] as const
export type CutReason = (typeof CUT_REASONS)[number]
export const CUT_LABELS: Record<CutReason, string> = {
  filler: 'Filler word', cue: 'You asked for a retake', rejected: 'A take you rejected', retake: 'An earlier take',
  false_start: 'A false start', off_topic: 'Not part of the video', member: 'You cut this'
}

export interface EditWord { text: string; startMs: number; endMs: number; src: number; cut: CutReason | null }
export interface EditSpan { start: number; end: number }
export interface EditHook extends EditSpan { id: number; text: string; why: string }
export interface EditPopup { id: number; word: number; text: string; kind: 'number' | 'keyword' }
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
}

export interface EditSource { path: string; name: string; seconds: number }

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
}

export interface EditLook {
  includeCaptions: boolean
  captionPreset: string
  headlineLook: HeadlineLook
  /** The brand's handle or logo in a corner. */
  showHandle: boolean
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
  popups: { id: number; on: boolean; text: string }[]
  sounds: { id: number; on: boolean }[]
  look: EditLook
}

export interface EditStartRequest {
  sources: string[]
  brandIdentityId: string | null
  /** From "What should I film?": the hook they meant to open with (a hint for the plan, never shown as is). */
  hookHint?: string
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
  if (value > 0 && value < 0.01) return 'under $0.01'
  return `$${value.toFixed(2)}`
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// The review: start from the plan, toggle words, read the result
// ---------------------------------------------------------------------------

export function initialDecisions(plan: EditPlan, look: EditLook = DEFAULT_EDIT_LOOK): EditDecisions {
  const hook = plan.hooks.find((item) => item.id === plan.hook) ?? null
  return {
    cut: plan.words.flatMap((word, i) => (word.cut ? [i] : [])),
    hookId: hook?.id ?? null,
    hookText: hook?.text ?? '',
    endOnCta: plan.cta !== null,
    popups: plan.popups.map((popup) => ({ id: popup.id, on: true, text: popup.text })),
    sounds: plan.sounds.map((sound) => ({ id: sound.id, on: true })),
    look
  }
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

/** The words in the order the reel plays them: the hook, the rest as recorded, the call to action. */
export function reelOrder(plan: EditPlan, decisions: EditDecisions): number[] {
  const cut = new Set(decisions.cut)
  const hook = plan.hooks.find((item) => item.id === decisions.hookId) ?? null
  const range = (span: EditSpan | null): number[] => span ? Array.from({ length: span.end - span.start + 1 }, (_, k) => span.start + k).filter((i) => !cut.has(i)) : []
  const first = range(hook)
  const last = decisions.endOnCta ? range(plan.cta).filter((i) => !first.includes(i)) : []
  const taken = new Set([...first, ...last])
  const body = plan.words.map((_, i) => i).filter((i) => !cut.has(i) && !taken.has(i))
  return [...first, ...body, ...last]
}

/** About how long the reel will be: the kept words, with long pauses tightened like the render does. */
export function reelSeconds(plan: EditPlan, decisions: EditDecisions): number {
  const order = reelOrder(plan, decisions)
  let total = 0
  order.forEach((i, k) => {
    const word = plan.words[i]
    total += (word.endMs - word.startMs) / 1000
    const next = order[k + 1]
    if (next === i + 1 && plan.words[next].src === word.src) {
      const gap = Math.max(0, (plan.words[next].startMs - word.endMs) / 1000)
      total += gap > 0.6 ? 0.25 : gap
    } else total += 0.22
  })
  return total
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
  for (const raw of Array.isArray(value.popups) ? value.popups.slice(0, 10) : []) {
    if (!record(raw) || !int(raw.id, 0, 50) || !int(raw.word, 0, n - 1)) continue
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
  return { words, hooks, hook, cta: span(value.cta), popups, sounds, planned: value.planned === 'basic' ? 'basic' : 'ai', notes: lines(value.notes, 6), warnings: lines(value.warnings, 4) }
}

/** The review screen's choices from the page, checked against the plan; throws with a plain message. */
export function parseEditDecisions(value: unknown, plan: EditPlan): EditDecisions {
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
    if (!record(raw) || typeof raw.on !== 'boolean' || !plan.popups.some((popup) => popup.id === raw.id)) throw new Error('Choose which pop-ups to keep.')
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
  const decisions: EditDecisions = { cut, hookId: value.hookId as number | null, hookText, endOnCta: value.endOnCta, popups, sounds,
    look: { includeCaptions: look.includeCaptions, captionPreset: look.captionPreset, headlineLook: parseHeadlineLook(look.headlineLook), showHandle: look.showHandle } }
  if (reelOrder(plan, decisions).length < 3) throw new Error('Keep a few more words: the reel would be almost empty.')
  return decisions
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
