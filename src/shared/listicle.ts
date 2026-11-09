/**
 * Top list videos ("5 tools you need"): a faceless format in Avatar Studio.
 * The member names 3-7 items (each with a line or two, an optional
 * screenshot and an optional highlight box on it), the AI drafts a short
 * script for each, and the app renders a branded vertical video: a fixed
 * header, a title with one italic accent word, numbered progress chips, the
 * screenshot with a glowing box, word-sweep captions and a "Follow @handle"
 * end card. The voice is a preset voice, an avatar's voice, or the member's
 * own recordings made in the app (free).
 */

import { parseCtaChoice } from './ctas'
import { PRICES, presetVoiceId, wordCount, WORDS_PER_SECOND } from './avatars'

export const LISTICLE_MIN_ITEMS = 3
export const LISTICLE_MAX_ITEMS = 7
export const LISTICLE_LIMITS = { title: 90, name: 60, line: 160, script: 360, intro: 240, header: 40, handle: 30, accent: 40 } as const
/** All the spoken words together: about a minute and a half. */
export const LISTICLE_MAX_SPOKEN_CHARS = 1800
/** One script-writing call (a small model): the spending check's estimate. */
export const LISTICLE_SCRIPT_ESTIMATE_USD = 0.01
/** The end card's length (silent) when there is a handle to follow. */
export const LISTICLE_END_CARD_MS = 2500
/** A short pause after each spoken part. */
export const LISTICLE_GAP_MS = 250
export const LISTICLE_DEFAULT_COLOR = '#7CE7AC'
/** The longest in-app recording of one part, in seconds. */
export const LISTICLE_MAX_RECORDING_SECONDS = 45

/** A part of the area to highlight, as shares (0-1) of the picture's width and height. */
export interface ListicleBox { x: number; y: number; w: number; h: number }

export interface ListicleItem {
  name: string
  /** One or two lines from the member about the item (shown when there is no picture, and given to the script writer). */
  line: string
  /** A screenshot or picture (chosen in the app), or null. */
  imagePath: string | null
  /** A highlight box on the screenshot, or null to show the picture filling the card. */
  box: ListicleBox | null
  /** What the voice says about this item. */
  script: string
  /** The word of the item's title drawn in italic serif ('' for its last word). */
  accent: string
}

/**
 * preset: an ElevenLabs voice by name; avatar: an avatar's own voice (its clone or preset);
 * recorded: the member's own recordings, one per part ('intro', '1'..'N').
 */
export type ListicleVoice =
  | { kind: 'preset'; voice: string }
  | { kind: 'avatar'; avatarId: string }
  | { kind: 'recorded'; recordings: Record<string, string> }

export interface ListicleRequest {
  title: string
  /** The title word drawn in italic serif. */
  accent: string
  /** The spoken opening ('' to start straight on item 1). */
  intro: string
  items: ListicleItem[]
  /** The fixed label at the top, e.g. "WEB LAB · AI TOOLS". */
  header: string
  /** "@handle" for the end card ('' for no end card). */
  handle: string
  accentColor: string
  voice: ListicleVoice
  captions: boolean
  ctaId: string | null
  brandIdentityId: string | null
}

export interface ListicleScriptRequest {
  title: string
  items: { name: string; line: string }[]
  /** Write in this brand's voice, using only its proof. */
  brandIdentityId: string | null
}

export interface ListicleScript {
  intro: string
  /** A word from the title to set in italic serif. */
  titleAccent: string
  items: { script: string; accent: string }[]
}

export type ListiclePhase = 'voice' | 'frames' | 'finish' | 'done' | 'failed' | 'cancelled'

export interface ListicleStatus {
  id: string
  phase: ListiclePhase
  detail: string
  percent: number
  outputPath: string | null
  outputDir: string | null
  error: string | null
  warning: string | null
  estimatedCostUsd: number
  startedAt: string
}

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

/** The keys of the spoken parts, in order: the intro (when it has words) and each item. */
export function partKeys(count: number, withIntro = true): string[] {
  return [...(withIntro ? ['intro'] : []), ...Array.from({ length: count }, (_, i) => String(i + 1))]
}

export function partLabel(key: string): string {
  return key === 'intro' ? 'Opening' : `Item ${key}`
}

/** Every word the voice says, in order. */
export function spokenParts(request: Pick<ListicleRequest, 'intro' | 'items'>): { key: string; text: string }[] {
  const parts = request.intro.trim() ? [{ key: 'intro', text: request.intro.trim() }] : []
  request.items.forEach((item, i) => parts.push({ key: String(i + 1), text: item.script.trim() }))
  return parts
}

export function spokenText(request: Pick<ListicleRequest, 'intro' | 'items'>): string {
  return spokenParts(request).map((part) => part.text).join(' ')
}

/** About how long the video runs (seconds), before any audio exists. */
export function estimateListicleSeconds(request: Pick<ListicleRequest, 'intro' | 'items' | 'handle'>): number {
  const parts = spokenParts(request)
  const speech = parts.reduce((sum, part) => sum + Math.max(1, wordCount(part.text) / WORDS_PER_SECOND) + LISTICLE_GAP_MS / 1000, 0)
  return Math.round(speech + (request.handle.trim() ? LISTICLE_END_CARD_MS / 1000 : 0))
}

/**
 * Voice cost at list prices: ElevenLabs for preset voices, Fish Audio for a
 * cloned avatar voice; the member's own recordings are free.
 */
export function estimateListicleCost(request: Pick<ListicleRequest, 'intro' | 'items'>, voice: 'preset' | 'clone' | 'recorded'): number {
  if (voice === 'recorded') return 0
  const chars = spokenParts(request).reduce((sum, part) => sum + part.text.length, 0)
  const rate = voice === 'clone' ? PRICES.cloneTtsPer1000Chars : PRICES.ttsPer1000Chars
  return Math.round(Math.max(0.01, (chars / 1000) * rate) * 100) / 100
}

function clean(value: unknown, max: number, label: string, required = false): string {
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.includes('\0'))) throw new Error(`Check the ${label}.`)
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (required && !text) throw new Error(`Add the ${label}.`)
  if (text.length > max) throw new Error(`Keep the ${label} under ${max} characters.`)
  return text
}

export function parseBox(value: unknown): ListicleBox | null {
  if (value === null || value === undefined) return null
  const raw = value as Record<string, unknown>
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((key) => raw?.[key])
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('Draw the highlight box again.')
  const box = { x: x as number, y: y as number, w: w as number, h: h as number }
  if (box.x < 0 || box.y < 0 || box.w < 0.02 || box.h < 0.02 || box.x + box.w > 1.0001 || box.y + box.h > 1.0001) throw new Error('Draw the highlight box again.')
  const round = (n: number): number => Math.round(n * 10000) / 10000
  return { x: round(box.x), y: round(box.y), w: round(Math.min(box.w, 1 - box.x)), h: round(Math.min(box.h, 1 - box.y)) }
}

const HEX = /^#[0-9A-Fa-f]{6}$/
const AVATAR_ID = /^[a-z0-9]{8,40}$/
const BRAND_ID = /^[a-f0-9]{16}$/

/**
 * Validate a render request from the renderer (paths are checked again in
 * main before anything is read). Throws a message for the member.
 */
export function parseListicleRequest(value: unknown): ListicleRequest {
  const raw = (value ?? {}) as Record<string, unknown>
  const title = clean(raw.title, LISTICLE_LIMITS.title, 'list title', true)
  const accent = clean(raw.accent, LISTICLE_LIMITS.accent, 'accent word')
  const intro = clean(raw.intro, LISTICLE_LIMITS.intro, 'opening line')
  if (!Array.isArray(raw.items) || raw.items.length < LISTICLE_MIN_ITEMS || raw.items.length > LISTICLE_MAX_ITEMS) {
    throw new Error(`Add ${LISTICLE_MIN_ITEMS} to ${LISTICLE_MAX_ITEMS} items.`)
  }
  const items = raw.items.map((entry, i): ListicleItem => {
    const item = (entry ?? {}) as Record<string, unknown>
    const n = i + 1
    const imagePath = item.imagePath === null || item.imagePath === undefined ? null : item.imagePath
    if (imagePath !== null && (typeof imagePath !== 'string' || imagePath.includes('\0') || imagePath.length > 4096)) throw new Error(`Choose item ${n}’s picture again.`)
    const box = parseBox(item.box)
    return {
      name: clean(item.name, LISTICLE_LIMITS.name, `name of item ${n}`, true),
      line: clean(item.line, LISTICLE_LIMITS.line, `line for item ${n}`),
      imagePath, box: imagePath ? box : null,
      script: clean(item.script, LISTICLE_LIMITS.script, `script for item ${n}`, true),
      accent: clean(item.accent, LISTICLE_LIMITS.accent, `accent word for item ${n}`)
    }
  })
  const header = clean(raw.header, LISTICLE_LIMITS.header, 'header')
  const handle = clean(raw.handle, LISTICLE_LIMITS.handle, 'handle')
  const accentColor = typeof raw.accentColor === 'string' && HEX.test(raw.accentColor) ? raw.accentColor.toUpperCase() : LISTICLE_DEFAULT_COLOR
  const voice = parseListicleVoice(raw.voice, items.length, Boolean(intro))
  if (raw.captions !== undefined && typeof raw.captions !== 'boolean') throw new Error('Choose whether to show captions.')
  const ctaId = parseCtaChoice(raw.ctaId)
  const brandIdentityId = typeof raw.brandIdentityId === 'string' && BRAND_ID.test(raw.brandIdentityId) ? raw.brandIdentityId : null
  const request: ListicleRequest = { title, accent, intro, items, header, handle, accentColor, voice, captions: raw.captions !== false, ctaId, brandIdentityId }
  if (spokenText(request).length > LISTICLE_MAX_SPOKEN_CHARS) throw new Error('The script is too long for one video. Shorten a few items.')
  return request
}

export function parseListicleVoice(value: unknown, count: number, withIntro: boolean): ListicleVoice {
  const raw = (value ?? {}) as Record<string, unknown>
  if (raw.kind === 'preset') {
    const voice = presetVoiceId(raw.voice)
    if (!voice) throw new Error('Choose a voice.')
    return { kind: 'preset', voice }
  }
  if (raw.kind === 'avatar') {
    if (typeof raw.avatarId !== 'string' || !AVATAR_ID.test(raw.avatarId)) throw new Error('Choose the avatar whose voice to use.')
    return { kind: 'avatar', avatarId: raw.avatarId }
  }
  if (raw.kind === 'recorded') {
    const given = (raw.recordings ?? {}) as Record<string, unknown>
    const recordings: Record<string, string> = {}
    for (const key of partKeys(count, withIntro)) {
      const path = given[key]
      if (typeof path !== 'string' || !path || path.includes('\0') || path.length > 4096) throw new Error(`Record your voice for ${partLabel(key).toLowerCase()} first.`)
      recordings[key] = path
    }
    return { kind: 'recorded', recordings }
  }
  throw new Error('Choose a voice.')
}

export function parseListicleScriptRequest(value: unknown): ListicleScriptRequest {
  const raw = (value ?? {}) as Record<string, unknown>
  const title = clean(raw.title, LISTICLE_LIMITS.title, 'list title', true)
  if (!Array.isArray(raw.items) || raw.items.length < LISTICLE_MIN_ITEMS || raw.items.length > LISTICLE_MAX_ITEMS) {
    throw new Error(`Add ${LISTICLE_MIN_ITEMS} to ${LISTICLE_MAX_ITEMS} items.`)
  }
  const items = raw.items.map((entry, i) => {
    const item = (entry ?? {}) as Record<string, unknown>
    return { name: clean(item.name, LISTICLE_LIMITS.name, `name of item ${i + 1}`, true), line: clean(item.line, LISTICLE_LIMITS.line, `line for item ${i + 1}`) }
  })
  const brandIdentityId = typeof raw.brandIdentityId === 'string' && BRAND_ID.test(raw.brandIdentityId) ? raw.brandIdentityId : null
  return { title, items, brandIdentityId }
}

function bare(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '')
}

/** The accent word if it is one of the title's words, else the title's last word. */
export function pickAccent(title: string, accent: string): string {
  const words = title.split(/\s+/).filter(Boolean)
  const target = bare(accent)
  const found = target ? [...words].reverse().find((word) => bare(word) === target) : undefined
  return (found ?? words.at(-1) ?? '').replace(/[.,!?:;]+$/, '')
}

/** The title split around its accent word, for previews. */
export function splitAccent(title: string, accent: string): { before: string; accent: string; after: string } {
  const words = title.split(/\s+/).filter(Boolean)
  const target = bare(pickAccent(title, accent))
  let at = -1
  for (let i = words.length - 1; i >= 0; i--) if (bare(words[i]) === target) { at = i; break }
  if (at < 0) return { before: title, accent: '', after: '' }
  return { before: words.slice(0, at).join(' '), accent: words[at], after: words.slice(at + 1).join(' ') }
}

/** The script from the model, checked and trimmed to the limits (one entry per item). */
export function parseListicleScript(raw: unknown, request: ListicleScriptRequest): ListicleScript {
  const value = (raw ?? {}) as { intro?: unknown; titleAccent?: unknown; items?: unknown }
  const text = (input: unknown, max: number): string => typeof input === 'string' ? input.replace(/\s+/g, ' ').trim().slice(0, max) : ''
  const items = Array.isArray(value.items) ? value.items : []
  if (items.length < request.items.length) throw new Error('The script came back incomplete. Try again.')
  const out = request.items.map((item, i) => {
    const entry = (items[i] ?? {}) as { script?: unknown; accent?: unknown }
    const script = text(entry.script, LISTICLE_LIMITS.script)
    if (!script) throw new Error('The script came back incomplete. Try again.')
    return { script, accent: pickAccent(item.name, text(entry.accent, LISTICLE_LIMITS.accent)) }
  })
  return { intro: text(value.intro, LISTICLE_LIMITS.intro), titleAccent: pickAccent(request.title, text(value.titleAccent, LISTICLE_LIMITS.accent)), items: out }
}

/** A post caption from the list: its title, then the numbered item names. Only the member's own words. */
export function listiclePostCaption(request: Pick<ListicleRequest, 'title' | 'items'>): string {
  return [request.title, '', ...request.items.map((item, i) => `${i + 1}. ${item.name}`)].join('\n').slice(0, 2000)
}


