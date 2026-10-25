/**
 * The beat sheet: Edit my recording's (and Combine clips') review as a numbered list of on-screen moments, each
 * shown as a still before the reel is made. A beat is the hook, a motion graphic (effects too), a half-screen
 * graphic, a pop-up, a pinned image or the call to action, at the time it plays on the reel; moments that start
 * together (or a pop-up that plays while a graphic is up) are one beat. Every edit here changes one beat's own
 * items in the review's choices (EditDecisions) and nothing else, so the reel, and the clip editor project made
 * from it, carry exactly those changes.
 *
 * B-roll shots are picked while the reel is made, so they are not beats (the sheet says so).
 */
import {
  CARD_MAX_SECONDS, CARD_MIN_SECONDS, CARD_TYPE_LABELS, RAW_INTRO_SECONDS, livePins, reelCardWindows, reelOrder, reelSeconds, reelWordStarts, soundEffectsOn,
  type EditCard, type EditDecisions, type EditPlan
} from './edit-recording'
import { GRAPHIC_DEFAULT_MS, ITEM_TIMED_TEMPLATES, clampGraphicMs, graphicHasContent, graphicItems, isDiagram, newGraphic, templateInfo, type GraphicSize, type GraphicTemplateId, type TimedWord } from './motion-graphics'
import { MAX_EDIT_GRAPHICS, newEditGraphic, patchEditGraphic, type EditGraphic } from './reel-graphics'
import { fxEffect, fxItems } from './fx-catalog'
import { registerKeeps } from './register'
import { DEFAULT_SOUND_REGISTER, SOUND_ACTION_INFO, type SoundAction } from './sound-design'
import { prefillEffect, prefillGraphic, spokenNumber } from './graphic-prefill'
import { DEFAULT_BEAT_SHEET_CHOICE, type BeatSheetChoice } from './member-prefs'
import { tripleHookLabel } from './triple-hook'
import { SETTLED_STILL, stillTimes } from './custom-graphics'

export type BeatKind = 'hook' | 'graphic' | 'card' | 'popup' | 'pin' | 'cta'
/** How the frame is laid out: the full video, the stage (a backdrop with the speaker in a card), or the backdrop only. */
export type BeatScene = 'face' | 'stage' | 'visual'

/** Moments starting this close together are one beat (seconds). */
export const BEAT_MERGE_SECONDS = 0.5
/** A beat's spoken words: what is said from its start for about this long (seconds). */
export const BEAT_WORDS_SECONDS = 2.5
/** A directed reel's hook text shows for its first seconds (engine edit_direction.DIRECTED_HOOK_HIDE_S). */
export const BEAT_HOOK_SECONDS = 5
const POPUP_SECONDS = 1.8
const PIN_SECONDS = 1.5

/** One thing on screen in a beat. `ref`: 'hook', 'cta', 'g:<graphic id>', 'p:<pop-up id>' or 'pin:<image>:<word>'. */
export interface BeatPart { kind: BeatKind; ref: string; start: number; end: number; word: number | null; shown: string }

/** What a beat's still draws over the frame. */
export type BeatVisual =
  | { type: 'graphic'; graphic: Pick<EditGraphic, 'template' | 'fields' | 'placement' | 'size' | 'duration_ms'>; atMs: number }
  | { type: 'image'; image: string }
  | null

export interface Beat {
  /** Stable while the beat exists: its main part's ref. */
  key: string
  number: number
  kind: BeatKind
  parts: BeatPart[]
  /** Seconds on the reel (without the raw-to-edited opening). */
  start: number
  end: number
  /** The word it starts on (null: the hook with no hook words). */
  word: number | null
  /** What is said as it plays. */
  words: string
  /** What shows, in plain words ("Count up: $4,215"). */
  shown: string
  /** The sound it lands with (the sound design's pick for it), or null for none. */
  sound: string | null
  scene: BeatScene
  /** The source frame for its still: the clip (source index) and ms into it, at the beat's key moment. */
  frame: { src: number; ms: number } | null
  /** Seconds into the reel of that key moment. */
  at: number
  visual: BeatVisual
  /** The hook text shows over this beat. */
  hookText: string
  /** The hook beat: which Triple Hook elements its spoken line and headline stack (triple-hook.ts); '' for other beats. */
  hookRole: string
  /** The captions' words at the key moment ('' with captions off). */
  caption: string
  /** Why it won't show as planned, or null. */
  problem: string | null
  /** Everything its still depends on: a beat whose hash is unchanged keeps its still. */
  hash: string
}

const RANK: Record<BeatKind, number> = { hook: 0, cta: 0, card: 1, graphic: 2, pin: 3, popup: 4 }
const strip = (text: string): string => text.replace(/^[“"‘(]+|[”"’),.;:!?]+$/g, '')
const clip = (text: string, max = 80): string => { const clean = text.replace(/\s+/g, ' ').trim(); return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean }

/** A graphic's own words, short ("$4,215", "Three steps · Write hooks"). */
export function graphicWords(g: Pick<EditGraphic, 'template' | 'fields'>): string {
  const f = g.fields
  if (g.template === 'custom') return clip(f.idea ?? '')
  if (g.template === 'fx') {
    const effect = fxEffect(f.effect)
    const said = (effect?.fields ?? []).filter((field) => field.kind !== 'choice' && (f[field.key] ?? '').trim())
      .map((field) => field.kind === 'list' ? fxItems(f[field.key]).slice(0, 3).join(', ') : f[field.key].trim())
    return clip(said.slice(0, 2).join(' · '))
  }
  const keys = ['value', 'text', 'title', 'name', 'before', 'keyword', 'items', 'label', 'after', 'caption', 'final']
  const own = (templateInfo(g.template).fields as readonly string[])
  const values = keys.filter((k) => own.includes(k) && (f[k] ?? '').trim()).map((k) => k === 'items' ? graphicItems(f[k]).slice(0, 3).join(', ') : f[k].trim())
  return clip(values.slice(0, 2).join(' · '))
}

/** A graphic's name: its effect's for an Effect, else its template's. */
export function graphicName(g: Pick<EditGraphic, 'template' | 'fields'>): string {
  return g.template === 'fx' ? fxEffect(g.fields.effect)?.label ?? 'Effect' : templateInfo(g.template).label
}

/** What a half-screen card is drawn as on a directed reel (engine edit_direction.card_graphic), or null when it draws nothing. */
export function cardGraphic(card: EditCard): { template: GraphicTemplateId; fields: Record<string, string> } | null {
  const items = card.items.filter((item) => item.trim())
  if (card.type === 'list' && items.length >= 2) return { template: 'list', fields: { title: card.title, items: items.slice(0, 5).join('\n') } }
  if (card.type === 'stat' && card.title.trim()) return { template: 'stat', fields: { value: card.title, ...(items[0] ? { label: items[0] } : {}) } }
  if (card.type === 'compare' && items.length >= 2) return { template: 'before_after', fields: { before: items[0], after: items[1] } }
  if (card.type === 'chat' && items.length >= 2) return { template: 'quote', fields: { text: items[1] } }
  return null
}

/** What a pop-up is drawn as on a directed reel: a stat for a number, else a title. */
export function popupGraphic(kind: string, text: string): { template: GraphicTemplateId; fields: Record<string, string> } {
  return kind === 'number' && /\d/.test(text) ? { template: 'stat', fields: { value: text } } : { template: 'title', fields: { text } }
}

// The sound each graphic makes as it arrives (engine sound_design.TEMPLATE_SOUND), the big moments and the ask.
const TEMPLATE_SOUND: Partial<Record<string, SoundAction>> = {
  stat: 'pop', title: 'impact', list: 'whoosh', lower_third: 'swipe', logo: 'pop', before_after: 'whoosh', checklist: 'whoosh', quote: 'tick', highlight: 'swipe',
  statement: 'tick', sticky_notes: 'paper', strike_list: 'whoosh', browser_frame: 'whoosh', icon_pop: 'pop', headline_pill: 'tick', comment_cta: 'tick', link_cta: 'click',
  big_words: 'impact', orbit: 'pop', feature_tile: 'pop', screen_frame: 'whoosh', chapter: 'whoosh', staircase: 'whoosh', funnel: 'whoosh', journey: 'whoosh',
  growth: 'whoosh', idea_hub: 'pop', compare_marks: 'whoosh', takeover: 'impact'
}
const BIG = ['title', 'big_words', 'stat', 'statement', 'chapter', 'staircase', 'funnel', 'journey', 'growth', 'idea_hub', 'compare_marks', 'takeover']
const ASKS = ['link_cta', 'comment_cta']
const REGISTER_RULES = {
  teaching: { groups: ['hook', 'graphic', 'scene', 'big', 'cta'], skip: [] as string[] },
  story: { groups: ['hook', 'graphic', 'scene', 'big', 'cta'], skip: ['tick', 'click'] },
  minimal: { groups: ['hook', 'scene', 'big', 'cta'], skip: ['tick'] }
}

/** The sound a beat lands with in this style (null: none), like the engine's sound design picks it. */
export function beatSound(kind: BeatKind, graphic: Pick<EditGraphic, 'template' | 'fields' | 'size'> | null, scene: BeatScene, d: EditDecisions): string | null {
  if (!soundEffectsOn(d)) return null
  const register = d.soundStyle ?? DEFAULT_SOUND_REGISTER
  const rule = REGISTER_RULES[register]
  let action: SoundAction | null = null, group = 'graphic'
  if (kind === 'hook') { action = 'swipe'; group = 'hook' } else if (scene !== 'face') { action = 'whoosh'; group = 'scene' } else if (graphic) {
    action = TEMPLATE_SOUND[graphic.template] ?? null
    if (graphic.template === 'fx') {
      const hint = fxEffect(graphic.fields.effect)?.sound ?? 'none'
      action = hint === 'none' ? null : hint === 'riser' ? 'pop' : hint
    }
    const own = graphic.fields.sound
    if (own === 'none') action = null
    else if (own && own in SOUND_ACTION_INFO && own !== 'riser') action = own as SoundAction
    if (action === 'whoosh' && graphic.size === 'compact') action = 'swipe'
    group = kind === 'cta' || ASKS.includes(graphic.template) ? 'cta' : BIG.includes(graphic.template) || graphic.size === 'stage' ? 'big' : 'graphic'
  }
  if (!action || !rule.groups.includes(group) || rule.skip.includes(action)) return null
  // Teaching builds one riser into the call to action.
  if (group === 'cta' && register === 'teaching') return `Riser, then ${SOUND_ACTION_INFO[action].label.toLowerCase()}`
  return SOUND_ACTION_INFO[action].label
}

/** How long into a graphic it has settled (ms): an effect just after its main beat, a list once its items are in. */
export function settledMs(g: Pick<EditGraphic, 'template' | 'fields' | 'duration_ms'>): number {
  // A custom graphic's built still (custom-graphics stillTimes' SETTLED_STILL).
  if (g.template === 'custom') return Math.round(stillTimes(g.duration_ms)[SETTLED_STILL])
  const sync = g.template === 'fx' ? fxEffect(g.fields.effect)?.sync_s : undefined
  const ms = sync !== undefined ? sync * 1000 + 500 : ITEM_TIMED_TEMPLATES.includes(g.template) || isDiagram(g.template) ? g.duration_ms * 0.85 : Math.min(g.duration_ms * 0.6, 1500)
  return Math.round(Math.max(0, Math.min(g.duration_ms - 150, ms)))
}

interface Moment extends BeatPart {
  rank: number
  visual: BeatVisual
  graphic: Pick<EditGraphic, 'template' | 'fields' | 'size'> | null
  scene: BeatScene
  /** Seconds after its start where its still is taken. */
  settle: number
  problem: string | null
  /** Its words (the hook's and the call to action's own). */
  said?: string
}

/** The reel's beats, in the order they play, numbered from 1. */
export function deriveBeats(plan: EditPlan, d: EditDecisions, options: { includeCaptions?: boolean } = {}): Beat[] {
  const starts = reelWordStarts(plan, d)
  const order = reelOrder(plan, d)
  const total = Math.max(0.5, reelSeconds(plan, d) - (d.rawIntro ? RAW_INTRO_SECONDS : 0))
  const cut = new Set(d.cut)
  const cards = reelCardWindows(plan, d, starts)
  const motion = d.motionGraphics !== false
  const stage = motion && d.stageLayouts !== false
  const wordEnd = (i: number): number => (starts.get(i) ?? 0) + (plan.words[i].endMs - plan.words[i].startMs) / 1000
  const sceneOf = (g: { template: string; size?: GraphicSize; fields?: Record<string, string> }): BeatScene => !stage ? 'face' : isDiagram(g.template) || (g.template === 'custom' && g.fields?.scene === 'visual') ? 'visual' : g.size === 'stage' ? 'stage' : 'face'
  const moments: Moment[] = []

  // The hook: its words play first, under the hook text.
  const hook = plan.hooks.find((h) => h.id === d.hookId) ?? null
  const hookText = d.hookText.replace(/\s+/g, ' ').trim()
  const hookWords = hook ? order.filter((i) => i >= hook.start && i <= hook.end) : []
  if (hookText || hookWords.length) {
    const end = hookWords.length ? wordEnd(hookWords[hookWords.length - 1]) : Math.min(3, total)
    moments.push({ kind: 'hook', ref: 'hook', start: 0, end: Math.min(total, Math.max(end, 1)), word: hookWords[0] ?? null, rank: RANK.hook, visual: null, graphic: null, scene: 'face', settle: 0.8,
      shown: hookText ? `Hook text: “${clip(hookText)}”` : 'Your hook, with no hook text', problem: null, said: hookWords.map((i) => plan.words[i].text).join(' ') })
  }

  // Motion graphics (effects too) as the member, the plan or the chat placed them.
  for (const g of d.graphics ?? []) {
    const at = starts.get(g.word)
    if (at === undefined || cut.has(g.word)) continue
    if (g.origin === 'auto' && !motion) continue
    if (!registerKeeps(g, d.soundStyle)) continue
    const end = at + g.duration_ms / 1000
    const underCard = cards.some((w) => at < w.end && end > w.start)
    moments.push({ kind: 'graphic', ref: `g:${g.id}`, start: at, end, word: g.word, rank: RANK.graphic, shown: `${graphicName(g)}${graphicWords(g) ? `: ${graphicWords(g)}` : ''}`,
      visual: { type: 'graphic', graphic: g, atMs: settledMs(g) }, graphic: g, scene: sceneOf(g), settle: settledMs(g) / 1000,
      problem: !graphicHasContent(g) ? 'Add its words to show it.' : underCard ? 'It plays during a half-screen graphic, so it will be left out.' : null })
  }

  // Pop-ups and half-screen graphics that are on.
  for (const choice of d.popups) {
    if (!choice.on) continue
    const popup = plan.popups.find((p) => p.id === choice.id)
    if (!popup || cut.has(popup.word)) continue
    const at = starts.get(popup.word)
    if (at === undefined) continue
    if (popup.kind === 'card') {
      const card = choice.card ?? popup.card
      if (!card) continue
      const drawn = cardGraphic(card)
      const window = cards.find((w) => w.id === popup.id)
      const seconds = Math.min(CARD_MAX_SECONDS, Math.max(CARD_MIN_SECONDS, popup.seconds ?? 3))
      const graphic = drawn ? { ...drawn, placement: 'top' as const, duration_ms: Math.round(seconds * 1000), ...(stage ? { size: 'stage' as const } : {}) } : null
      moments.push({ kind: 'card', ref: `p:${popup.id}`, start: window?.start ?? at, end: window?.end ?? at + seconds, word: popup.word, rank: RANK.card,
        shown: `Half-screen ${CARD_TYPE_LABELS[card.type].toLowerCase()}: ${clip(card.title || card.items[0] || '')}`,
        visual: graphic ? { type: 'graphic', graphic, atMs: settledMs(graphic) } : null, graphic, scene: graphic ? sceneOf(graphic) : 'face', settle: 1,
        problem: !drawn ? 'It needs a title or two lines to show.' : !window ? 'Another half-screen graphic plays here, so this one is left out.' : null })
    } else {
      const text = (choice.text || popup.text).trim()
      const graphic = { ...popupGraphic(popup.kind, text), placement: 'top' as const, duration_ms: POPUP_SECONDS * 1000 }
      moments.push({ kind: 'popup', ref: `p:${popup.id}`, start: at, end: at + POPUP_SECONDS, word: popup.word, rank: RANK.popup, shown: `Pop-up: ${clip(text, 40)}`,
        visual: { type: 'graphic', graphic, atMs: 700 }, graphic, scene: 'face', settle: 0.7, problem: text ? null : 'It has no words, so it won’t show.' })
    }
  }

  // The member's images, each popping up as its word is said.
  for (const pin of livePins(d)) {
    const at = starts.get(pin.word)
    if (at === undefined) continue
    moments.push({ kind: 'pin', ref: `pin:${pin.image}:${pin.word}`, start: at, end: at + PIN_SECONDS, word: pin.word, rank: RANK.pin, shown: 'Your image',
      visual: { type: 'image', image: pin.image }, graphic: { template: 'logo', fields: {} }, scene: 'face', settle: 0.5, problem: null })
  }

  // The call to action they said, at the end, with its button (engine spoken_cta.cta_graphic: it starts just before
  // the words and holds about 2 s after them, 2.5 to 4 s, and is left out when the reel ends under 1.5 s after it starts).
  if (d.endOnCta && plan.cta && motion) {
    const words = order.filter((i) => i >= plan.cta!.start && i <= plan.cta!.end)
    if (words.length) {
      const at = starts.get(words[0]) ?? 0
      const said = words.map((i) => plan.words[i].text).join(' ')
      const text = clip(words.slice(0, 6).map((i) => strip(plan.words[i].text)).join(' '), 40)
      const from = Math.max(0, at - 0.15)
      // The reel ends a little sooner than this estimate (its last pause isn't kept): measured against that.
      const length = Math.min(total - 0.3 - from, Math.max(2.5, Math.min(4, wordEnd(words[words.length - 1]) + 2.2 - from)))
      const shows = length >= 1.5
      const graphic = { template: 'link_cta' as const, fields: { text }, placement: 'bottom' as const, duration_ms: Math.round(Math.max(length, 0.8) * 1000) }
      moments.push({ kind: 'cta', ref: 'cta', start: at, end: total, word: words[0], rank: RANK.cta, shown: `Call to action: “${clip(said, 60)}”`,
        visual: shows ? { type: 'graphic', graphic, atMs: Math.min(graphic.duration_ms - 150, 1200) } : null, graphic: shows ? graphic : null, scene: 'face', settle: shows ? 1.2 : 0.5, said,
        problem: shows ? null : 'Your video ends too soon after it for its button to show.' })
    }
  }

  // One beat per moment, except moments that start together, and a pop-up while a graphic or card is up.
  moments.sort((a, b) => a.start - b.start || a.rank - b.rank)
  const groups: Moment[][] = []
  for (const m of moments) {
    const group = groups[groups.length - 1]
    const lead = group?.[0]
    const solo = (x: Moment): boolean => x.kind === 'hook' || x.kind === 'cta'
    const joins = lead && !solo(lead) && !solo(m) && (m.start - lead.start < BEAT_MERGE_SECONDS
      || (m.kind === 'popup' && group.some((x) => (x.kind === 'graphic' || x.kind === 'card') && m.start < x.end)))
    if (joins) group.push(m)
    else groups.push([m])
  }

  /** The kept word playing at `t` seconds (the last starting at or before it). */
  const wordAt = (t: number): number | null => {
    let best: number | null = null, bestAt = -1
    for (const i of order) { const s = starts.get(i)!; if (s <= t + 1e-6 && s > bestAt) { best = i; bestAt = s } }
    return best ?? order[0] ?? null
  }
  return groups.map((group, n): Beat => {
    const main = [...group].sort((a, b) => a.rank - b.rank || a.start - b.start)[0]
    const start = Math.min(...group.map((m) => m.start)), end = Math.max(...group.map((m) => m.end))
    const at = Math.min(Math.max(start, main.start + main.settle), Math.max(start, total - 0.05))
    const playing = wordAt(at)
    const frame = playing === null ? null : (() => {
      const w = plan.words[playing]
      const into = Math.max(0, Math.min(w.endMs - w.startMs, (at - (starts.get(playing) ?? 0)) * 1000))
      return { src: w.src, ms: Math.round((w.startMs + into) / 40) * 40 }
    })()
    const words = main.said ?? order.filter((i) => { const s = starts.get(i)!; return s >= start - 0.05 && s < start + BEAT_WORDS_SECONDS }).slice(0, 14).map((i) => plan.words[i].text).join(' ')
    const k = playing === null ? -1 : order.indexOf(playing)
    const caption = options.includeCaptions === false || k < 0 ? '' : order.slice(k, k + 3).map((i) => plan.words[i].text).join(' ')
    const parts = group.map(({ kind, ref, start: s, end: e, word, shown }) => ({ kind, ref, start: s, end: e, word, shown }))
    const extra = group.filter((m) => m !== main)
    const shown = extra.length ? `${main.shown} + ${extra.map((m) => m.shown.split(':')[0].toLowerCase()).join(', ')}` : main.shown
    const scene = main.scene
    const beat = {
      key: main.ref, number: n + 1, kind: main.kind, parts, start: round(start), end: round(end), word: main.word, words: clip(words, 140), shown, sound: beatSound(main.kind, main.graphic, scene, d),
      scene, frame, at: round(at), visual: main.visual, hookText: hookText && at < BEAT_HOOK_SECONDS ? hookText : '',
      hookRole: main.kind === 'hook' ? tripleHookLabel(main.said ?? '', hookText) : '', caption: clip(caption, 40), problem: group.map((m) => m.problem).find(Boolean) ?? null, hash: ''
    }
    return { ...beat, hash: beatHash(beat) }
  })
}

const round = (n: number): number => Math.round(n * 100) / 100

/** A short hash of what a beat's still and card show (its number aside: a renumbered beat keeps its still). */
export function beatHash(beat: Omit<Beat, 'hash'>): string {
  const { number: _number, hash: _hash, ...rest } = beat as Beat
  void _number; void _hash
  const text = stable(rest)
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}

/** The beat's items by kind. */
function partIds(beat: Pick<Beat, 'parts'>): { graphics: string[]; popups: number[]; pins: { image: string; word: number }[]; hook: boolean; cta: boolean } {
  const out = { graphics: [] as string[], popups: [] as number[], pins: [] as { image: string; word: number }[], hook: false, cta: false }
  for (const part of beat.parts) {
    if (part.ref === 'hook') out.hook = true
    else if (part.ref === 'cta') out.cta = true
    else if (part.ref.startsWith('g:')) out.graphics.push(part.ref.slice(2))
    else if (part.ref.startsWith('p:')) out.popups.push(Number(part.ref.slice(2)))
    else if (part.ref.startsWith('pin:')) { const [, image, word] = part.ref.split(':'); out.pins.push({ image, word: Number(word) }) }
  }
  return out
}

// ---------------------------------------------------------------------------
// Edits by beat: each changes only that beat's own items
// ---------------------------------------------------------------------------

/** What a removed beat had, to bring it back. */
export interface BeatUndo { graphics: EditGraphic[]; popups: number[]; pins: { image: string; word: number }[]; hookText?: string; endOnCta?: boolean }

/** Take a beat out of the reel: its graphics go, its pop-ups and cards are switched off, its images unpinned; the hook loses its text; the call to action stays where it was said. */
export function removeBeat(d: EditDecisions, beat: Pick<Beat, 'parts'>): { decisions: EditDecisions; undo: BeatUndo } {
  const ids = partIds(beat)
  const graphics = d.graphics ?? []
  const undo: BeatUndo = { graphics: graphics.filter((g) => ids.graphics.includes(g.id)), popups: d.popups.filter((p) => ids.popups.includes(p.id) && p.on).map((p) => p.id), pins: d.pins.filter((p) => ids.pins.some((x) => x.image === p.image && x.word === p.word)) }
  let next: EditDecisions = {
    ...d, graphics: graphics.filter((g) => !ids.graphics.includes(g.id)),
    popups: d.popups.map((p) => ids.popups.includes(p.id) ? { ...p, on: false } : p),
    pins: d.pins.filter((p) => !undo.pins.includes(p))
  }
  if (ids.hook) { undo.hookText = d.hookText; next = { ...next, hookText: '' } }
  if (ids.cta && d.endOnCta) { undo.endOnCta = true; next = { ...next, endOnCta: false } }
  if (d.graphics === undefined && !undo.graphics.length) delete next.graphics
  return { decisions: next, undo }
}

/** Bring a removed beat back as it was. */
export function restoreBeat(d: EditDecisions, undo: BeatUndo): EditDecisions {
  const graphics = [...(d.graphics ?? []).filter((g) => !undo.graphics.some((u) => u.id === g.id)), ...undo.graphics].sort((a, b) => a.word - b.word).slice(0, MAX_EDIT_GRAPHICS)
  return {
    ...d, ...(undo.graphics.length || d.graphics ? { graphics } : {}),
    popups: d.popups.map((p) => undo.popups.includes(p.id) ? { ...p, on: true } : p),
    pins: [...d.pins, ...undo.pins.filter((u) => !d.pins.some((p) => p.image === u.image && p.word === u.word))],
    ...(undo.hookText !== undefined ? { hookText: undo.hookText } : {}),
    ...(undo.endOnCta ? { endOnCta: true } : {})
  }
}

/** Whether the beat can be swapped for another visual, moved or have its words edited. */
export function beatActions(beat: Pick<Beat, 'kind'> & { custom?: boolean }): { swap: boolean; move: boolean; text: boolean } {
  // A custom graphic's words are its design: it changes with a note, or goes back to its template.
  if (beat.custom) return { swap: false, move: true, text: false }
  return { swap: beat.kind === 'graphic' || beat.kind === 'popup' || beat.kind === 'card' || beat.kind === 'pin', move: beat.kind === 'graphic' || beat.kind === 'pin', text: beat.kind !== 'pin' && beat.kind !== 'cta' }
}

/**
 * Show another visual on this beat: a graphic keeps its place and word and takes the new template (or effect) and
 * fields; a pop-up, half-screen graphic or image becomes that graphic on the same word (it is switched off). The
 * other items of the beat stay. Returns null when no more graphics fit.
 */
export function swapBeatVisual(d: EditDecisions, beat: Pick<Beat, 'parts' | 'key' | 'word'>, template: GraphicTemplateId, fields: Record<string, string>, effect?: string): { decisions: EditDecisions; key: string } | null {
  const graphics = d.graphics ?? []
  const fx = template === 'fx' ? fxEffect(effect) : null
  if (template === 'fx' && !fx) return null
  const allFields = fx ? { ...fields, effect: fx.id } : fields
  const duration = clampGraphicMs(fx ? fx.default_ms : GRAPHIC_DEFAULT_MS[template], template)
  const size: GraphicSize | undefined = fx?.size ?? (isDiagram(template) ? 'stage' : undefined)
  if (beat.key.startsWith('g:')) {
    const id = beat.key.slice(2)
    const current = graphics.find((g) => g.id === id)
    if (!current) return null
    const base = newGraphic(template, 0, { fields: allFields, duration_ms: duration, ...(size ? { size } : {}), taken: graphics.map((g) => g.id) })
    const swapped: EditGraphic = { ...newEditGraphic(base, current.word), id: current.id, placement: base.placement, origin: 'member' }
    return { decisions: { ...d, graphics: graphics.map((g) => g.id === id ? swapped : g) }, key: beat.key }
  }
  if (beat.word === null || graphics.length >= MAX_EDIT_GRAPHICS) return null
  const graphic = newEditGraphic(newGraphic(template, 0, { fields: allFields, duration_ms: duration, ...(size ? { size } : {}), taken: graphics.map((g) => g.id) }), beat.word)
  const ids = partIds({ parts: beat.parts.filter((p) => p.ref === beat.key) })
  return {
    decisions: { ...d, graphics: [...graphics, graphic].sort((a, b) => a.word - b.word), popups: d.popups.map((p) => ids.popups.includes(p.id) ? { ...p, on: false } : p),
      pins: d.pins.filter((p) => !ids.pins.some((x) => x.image === p.image && x.word === p.word)) },
    key: `g:${graphic.id}`
  }
}

/** Nudge a graphic or image to start one kept word earlier (-1) or later (+1). Null when there is no such word. */
export function moveBeat(plan: EditPlan, d: EditDecisions, beat: Pick<Beat, 'key'>, step: -1 | 1): { decisions: EditDecisions; key: string } | null {
  const order = reelOrder(plan, d)
  const nudge = (word: number): number | null => { const k = order.indexOf(word); const to = order[k + step]; return k < 0 || to === undefined ? null : to }
  if (beat.key.startsWith('g:')) {
    const id = beat.key.slice(2)
    const g = (d.graphics ?? []).find((x) => x.id === id)
    const word = g ? nudge(g.word) : null
    return g && word !== null ? { decisions: { ...d, graphics: patchEditGraphic(d.graphics ?? [], id, { word }) }, key: beat.key } : null
  }
  if (beat.key.startsWith('pin:')) {
    const [, image, w] = beat.key.split(':')
    const word = nudge(Number(w))
    if (word === null || d.pins.some((p) => p.image === image && p.word === word)) return null
    return { decisions: { ...d, pins: d.pins.map((p) => p.image === image && p.word === Number(w) ? { ...p, word } : p) }, key: `pin:${image}:${word}` }
  }
  return null
}

/** The words a beat's text edit changes: a graphic's word fields, a pop-up's text, a card's title and lines, the hook text. */
export interface BeatText { fields?: Record<string, string>; text?: string; card?: EditCard; hookText?: string }

/** Change a beat's words (only its main item). */
export function editBeatText(d: EditDecisions, beat: Pick<Beat, 'key'>, change: BeatText): EditDecisions {
  if (beat.key === 'hook' && change.hookText !== undefined) return { ...d, hookText: change.hookText }
  if (beat.key.startsWith('g:') && change.fields) return { ...d, graphics: patchEditGraphic(d.graphics ?? [], beat.key.slice(2), { fields: change.fields }) }
  if (beat.key.startsWith('p:')) {
    const id = Number(beat.key.slice(2))
    return { ...d, popups: d.popups.map((p) => p.id !== id ? p : { ...p, ...(change.text !== undefined ? { text: change.text } : {}), ...(change.card ? { card: change.card } : {}) }) }
  }
  return d
}

/**
 * The words-said rule for typed words: a number on screen must be one the speaker says in the reel (as digits or in
 * words). Returns a plain message for the first number that isn't, else null.
 */
export function unsaidNumber(plan: EditPlan, d: EditDecisions, texts: readonly string[]): string | null {
  const said = saidNumbers(plan, d)
  for (const text of texts) {
    for (const match of text.match(/\d[\d,.]*/g) ?? []) {
      const n = digits(match)
      if (n && !said.has(n)) return `“${match.replace(/[.,]+$/, '')}” isn’t a number you say in this reel. Graphics show only numbers you say.`
    }
  }
  return null
}

/** Typed words the speaker doesn't say in the reel (a note, not a rule: the member may write their own words). */
export function unsaidWords(plan: EditPlan, d: EditDecisions, texts: readonly string[]): string[] {
  const kept = new Set(reelOrder(plan, d).map((i) => key(plan.words[i].text)))
  const out: string[] = []
  for (const text of texts) for (const word of text.split(/\s+/)) {
    const k = key(word)
    if (k.length > 3 && !/\d/.test(k) && !kept.has(k) && !out.includes(strip(word))) out.push(strip(word))
  }
  return out.slice(0, 4)
}

const key = (w: string): string => w.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}']+/gu, '').replace(/'s$/, '')
const digits = (text: string): string => text.replace(/[^\d.]/g, '').replace(/\.+$/, '').replace(/^0+(?=\d)/, '')

function saidNumbers(plan: EditPlan, d: EditDecisions): Set<string> {
  const words: TimedWord[] = reelOrder(plan, d).map((i) => ({ word: plan.words[i].text, start_ms: plan.words[i].startMs, end_ms: plan.words[i].endMs }))
  const out = new Set<string>()
  words.forEach((_, i) => {
    const n = spokenNumber(words, i, true)
    if (!n) return
    for (const part of n.text.match(/\d[\d,.]*/g) ?? []) out.add(digits(part))
    // "15 billion" and "fifteen billion" (15,000,000,000) are the same number, typed either way.
    const scale = /\b(thousand|million|billion)\b/i.exec(n.text)
    const base = Number(digits(n.text))
    const value = scale ? base * ({ thousand: 1e3, million: 1e6, billion: 1e9 } as Record<string, number>)[scale[1].toLowerCase()] : base
    if (!Number.isFinite(value)) return
    out.add(String(value))
    for (const unit of [1e3, 1e6, 1e9]) if (value >= unit && value % unit === 0) out.add(String(value / unit))
  })
  return out
}

// ---------------------------------------------------------------------------
// Notes by number: a typed note goes to the review's chat, scoped to the beat
// ---------------------------------------------------------------------------

/** The chat message for a note on one beat. */
export function beatNoteMessage(beat: Pick<Beat, 'number' | 'shown' | 'words' | 'start' | 'parts'>, note: string): string {
  const ids = partIds(beat)
  const refs = [...ids.graphics.map((id) => `graphic ${id}`), ...ids.popups.map((id) => `pop-up/card ${id}`), ...(ids.hook ? ['the hook text'] : []), ...(ids.cta ? ['the call to action'] : [])]
  const clock = `${Math.floor(beat.start / 60)}:${(beat.start % 60).toFixed(1).padStart(4, '0')}`
  return `Beat ${beat.number} only (${beat.shown}, at ${clock}, while I say “${beat.words}”${refs.length ? `; it is ${refs.join(' and ')}` : ''}): ${note.replace(/\s+/g, ' ').trim()}. Change only this beat: update it, or replace it with another graphic on the same words. Don’t change anything else.`
}

/**
 * A chat change kept to one beat: graphics outside the beat stay as they were (a new one is kept only when it starts
 * within the beat), pop-ups and cards outside it too, the hook text only for the hook beat and the call to action
 * only for its beat. Everything else the chat changed is left out (`dropped` names it).
 */
export function scopeBeatPatch(plan: EditPlan, d: EditDecisions, beat: Pick<Beat, 'parts' | 'start' | 'end'>, patch: Partial<EditDecisions>): { patch: Partial<EditDecisions>; dropped: string[] } {
  const ids = partIds(beat)
  const out: Partial<EditDecisions> = {}
  const dropped: string[] = []
  for (const k of Object.keys(patch) as (keyof EditDecisions)[]) if (!['graphics', 'popups', 'hookText', 'endOnCta'].includes(k)) dropped.push(k)
  if (patch.graphics) {
    const before = d.graphics ?? []
    const starts = reelWordStarts(plan, { ...d, ...patch })
    const inBeat = (word: number): boolean => { const at = starts.get(word); return at !== undefined && at >= beat.start - 1 && at <= beat.end + 1 }
    const next = [
      ...before.filter((g) => !ids.graphics.includes(g.id)),
      ...patch.graphics.filter((g) => ids.graphics.includes(g.id)),
      ...patch.graphics.filter((g) => !before.some((b) => b.id === g.id) && inBeat(g.word))
    ].sort((a, b) => a.word - b.word).slice(0, MAX_EDIT_GRAPHICS)
    if (stable(next) !== stable(before)) out.graphics = next
    if (patch.graphics.some((g) => !ids.graphics.includes(g.id) && before.some((b) => b.id === g.id && stable(b) !== stable(g)))
      || before.some((b) => !ids.graphics.includes(b.id) && !patch.graphics!.some((g) => g.id === b.id))) dropped.push('other graphics')
  }
  if (patch.popups) {
    const next = d.popups.map((p) => ids.popups.includes(p.id) ? patch.popups!.find((x) => x.id === p.id) ?? p : p)
    if (stable(next) !== stable(d.popups)) out.popups = next
    if (patch.popups.some((x) => !ids.popups.includes(x.id) && stable(x) !== stable(d.popups.find((p) => p.id === x.id)))) dropped.push('other pop-ups')
  }
  if (patch.hookText !== undefined) { if (ids.hook) out.hookText = patch.hookText; else dropped.push('hookText') }
  if (patch.endOnCta !== undefined) { if (ids.cta) out.endOnCta = patch.endOnCta; else dropped.push('endOnCta') }
  return { patch: out, dropped }
}

// ---------------------------------------------------------------------------
// When to show it: the member's choice before each reel is made
// ---------------------------------------------------------------------------

/** What "Make my reel" does first: ask, open the beat sheet, or make it. */
export function beforeRender(choice: BeatSheetChoice | undefined, onSheet: boolean): 'ask' | 'sheet' | 'render' {
  if (onSheet) return 'render'
  const c = choice ?? DEFAULT_BEAT_SHEET_CHOICE
  return c === 'always' ? 'sheet' : c === 'skip' ? 'render' : 'ask'
}

// ---------------------------------------------------------------------------
// Flat stretches: where nothing on the reel's graphics layer or scene changes for too long
// ---------------------------------------------------------------------------

/** A graphic on screen may hold still this long (seconds), as custom graphics' motion check. */
export const REEL_FROZEN_SECONDS = 1.5
/** The plain face (no graphic, no scene change) may hold this long outside personal lines (seconds): the face carries most of a talking-head reel. */
export const REEL_FACE_FLAT_SECONDS = 6

/** A stretch of the reel where nothing visual changes. `frozen`: a graphic holds still; `nothing`: the plain face with no visual. */
export interface ReelFlat {
  from: number
  to: number
  why: 'frozen' | 'nothing'
  /** The word said in its middle (where a visual would be added), or null. */
  word: number | null
  /** The graphic that holds still (frozen), as 'g:<id>'. */
  ref: string | null
}

const PERSON = /^(i|i'm|im|i've|ive|i'd|i'll|me|my|myself|mine)$/
const STORY = /^(felt|feel|feeling|remember|remembered|scared|afraid|fear|honest|honestly|nobody|family|kids?|son|daughter|wife|husband|mom|dad|mother|father|cried|cry|love|loved|struggled|struggle|broke|lost|hurt|alone|ashamed|proud|dream|dreamed|grew|childhood|years|ago|sick|died|divorce|tears|heart)$/

/** A personal line (a first-person story or feeling): the reel stays on the face there by design. */
export function personalLine(text: string): boolean {
  const words = text.toLowerCase().replace(/[’]/g, "'").split(/\s+/).map((w) => w.replace(/^[^a-z']+|[^a-z']+$/g, '')).filter(Boolean)
  const me = words.filter((w) => PERSON.test(w)).length
  return me >= 1 && words.some((w) => STORY.test(w)) && !/\d/.test(text)
}

/**
 * The reel's flat stretches, from its timeline (before it is made): a graphic on screen that has finished animating
 * and holds still longer than REEL_FROZEN_SECONDS (a custom graphic: where its motion check measured it flat), and
 * plain-face stretches with no graphic or scene change longer than REEL_FACE_FLAT_SECONDS, except during personal
 * lines (the face is the point there). The hook and the call to action count as changing (they carry their own motion).
 */
export function reelFlatStretches(plan: EditPlan, d: EditDecisions, beats: readonly Beat[], options: { customFlat?: Readonly<Record<string, readonly { fromMs: number; toMs: number }[]>> } = {}): ReelFlat[] {
  const starts = reelWordStarts(plan, d)
  const order = reelOrder(plan, d)
  const total = Math.max(0.5, reelSeconds(plan, d) - (d.rawIntro ? RAW_INTRO_SECONDS : 0))
  const step = 0.1, n = Math.ceil(total / step)
  const onScreen = new Array<string | null>(n).fill(null), active = new Array<boolean>(n).fill(false)
  const mark = (from: number, to: number, f: (i: number) => void): void => { for (let i = Math.max(0, Math.floor(from / step)); i < Math.min(n, Math.ceil(to / step)); i++) f(i) }
  const graphics = new Map((d.graphics ?? []).map((g) => [`g:${g.id}`, g]))
  for (const beat of beats) {
    for (const part of beat.parts) {
      if (part.kind === 'hook' || part.kind === 'cta') { mark(part.start, part.end, (i) => { active[i] = true }); continue }
      mark(part.start, part.end, (i) => { onScreen[i] = onScreen[i] ?? part.ref })
      mark(part.start, part.start + 0.9, (i) => { active[i] = true })
      mark(part.end - 0.35, part.end, (i) => { active[i] = true })
      const g = graphics.get(part.ref)
      if (!g) continue
      if (g.template === 'custom') {
        // A custom graphic keeps moving (its motion check), except where it measured flat.
        mark(part.start, part.end, (i) => { active[i] = true })
        for (const f of options.customFlat?.[g.fields.comp ?? ''] ?? []) mark(part.start + f.fromMs / 1000 + .2, part.start + f.toMs / 1000 - .2, (i) => { active[i] = false })
      } else mark(part.start, part.start + settledMs(g) / 1000 + .3, (i) => { active[i] = true })
    }
  }
  // Personal lines: sentence by sentence, on the reel's clock.
  const personal = new Array<boolean>(n).fill(false)
  let sentence: number[] = []
  const flush = (): void => {
    if (!sentence.length) return
    const text = sentence.map((i) => plan.words[i].text).join(' ')
    if (personalLine(text)) {
      const a = starts.get(sentence[0]) ?? 0, last = sentence[sentence.length - 1]
      mark(a, (starts.get(last) ?? 0) + (plan.words[last].endMs - plan.words[last].startMs) / 1000, (i) => { personal[i] = true })
    }
    sentence = []
  }
  for (const i of order) { sentence.push(i); if (/[.!?]["”’)]*$/.test(plan.words[i].text)) flush() }
  flush()
  const wordAt = (t: number): number | null => {
    let best: number | null = null, bestAt = -1
    for (const i of order) { const s = starts.get(i) ?? 0; if (s <= t && s > bestAt) { best = i; bestAt = s } }
    return best
  }
  const out: ReelFlat[] = []
  let from = -1, kind: ReelFlat['why'] | null = null, ref: string | null = null
  const close = (to: number): void => {
    if (from >= 0 && kind) {
      const a = from * step, b = to * step
      const span = to - from
      const mostlyPersonal = personal.slice(from, to).filter(Boolean).length > span / 2
      if ((kind === 'frozen' && b - a > REEL_FROZEN_SECONDS) || (kind === 'nothing' && b - a > REEL_FACE_FLAT_SECONDS && !mostlyPersonal)) {
        out.push({ from: round(a), to: round(Math.min(total, b)), why: kind, word: wordAt((a + b) / 2), ref })
      }
    }
    from = -1; kind = null; ref = null
  }
  for (let i = 0; i < n; i++) {
    const k: ReelFlat['why'] | null = active[i] ? null : onScreen[i] ? 'frozen' : 'nothing'
    if (k !== kind || (k === 'frozen' && onScreen[i] !== ref)) { close(i); if (k) { from = i; kind = k; ref = k === 'frozen' ? onScreen[i] : null } }
  }
  close(n)
  return out
}

/**
 * A visual added on a flat stretch ("Add a visual here"): an effect the director uses, filled with the words said
 * there (a number said in the next few seconds counts up; else the line with its key word marked; else a statement).
 * Null when nothing said there fits or the reel has all the graphics it can take.
 */
export function addVisualAt(plan: EditPlan, d: EditDecisions, word: number): { decisions: EditDecisions; graphic: EditGraphic } | null {
  const graphics = d.graphics ?? []
  if (graphics.length >= MAX_EDIT_GRAPHICS) return null
  const starts = reelWordStarts(plan, d)
  const order = reelOrder(plan, d)
  const at = starts.get(word)
  if (at === undefined) return null
  const words: TimedWord[] = order.map((i) => ({ word: plan.words[i].text, start_ms: Math.round((starts.get(i) ?? 0) * 1000), end_ms: Math.round(((starts.get(i) ?? 0) * 1000) + Math.max(40, plan.words[i].endMs - plan.words[i].startMs)) }))
  const k = order.indexOf(word)
  const soon = words.slice(k, k + 12).filter((w) => w.start_ms < at * 1000 + 3000)
  const hasNumber = soon.some((_, j) => { const n = spokenNumber(words, k + j); return !!n && /\d/.test(n.text) })
  const tries: { template: GraphicTemplateId; effect?: string }[] = [...(hasNumber ? [{ template: 'fx' as const, effect: 'count-up' }] : []), { template: 'fx', effect: 'marker-highlight' }, { template: 'statement' }]
  for (const t of tries) {
    const fx = t.effect ? fxEffect(t.effect) : null
    const prefill = fx ? prefillEffect(fx.id, words, at * 1000) : prefillGraphic(t.template, words, at * 1000)
    if (!Object.keys(prefill.fields).length) continue
    const fields = fx ? { ...prefill.fields, effect: fx.id } : prefill.fields
    const duration = clampGraphicMs(fx ? fx.default_ms : GRAPHIC_DEFAULT_MS[t.template], t.template)
    const base = newGraphic(t.template, 0, { fields, duration_ms: duration, ...(fx?.size ? { size: fx.size } : {}), taken: graphics.map((g) => g.id) })
    const graphic: EditGraphic = { ...newEditGraphic(base, word), origin: 'member' }
    if (!graphicHasContent(graphic)) continue
    return { decisions: { ...d, graphics: [...graphics, graphic].sort((a, b) => a.word - b.word) }, graphic }
  }
  return null
}

/** A template graphic that holds still too long, shortened to end soon after it has settled. */
export function shortenFrozen(d: EditDecisions, ref: string): EditDecisions | null {
  const g = (d.graphics ?? []).find((x) => `g:${x.id}` === ref)
  if (!g || g.template === 'custom') return null
  const ms = clampGraphicMs(Math.max(1500, settledMs(g) + 1200), g.template)
  if (ms >= g.duration_ms) return null
  return { ...d, graphics: (d.graphics ?? []).map((x) => x.id === g.id ? { ...x, duration_ms: ms } : x) }
}
