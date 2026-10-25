/**
 * Custom graphics on Edit my recording (the review, before the reel is made): the director picks the hero moments
 * from the review's graphics and the opening line (shared pickHeroMoments), each becomes one custom graphic through
 * the producer loop (custom-graphics.ts), and a kept one replaces the template graphic that was there (a 'custom'
 * EditGraphic on the same word, its composition in the run). The engine carries it into the editor project; the bake
 * draws it in the sandbox. A note from the member ("make it a staircase") makes just that one again.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CUSTOM_MAX_MS, CUSTOM_MIN_MS, customGeometry, customGraphicsEstimate, customLook, DEFAULT_PRICE, heroDuration, isCustomComp, MAX_NOTE_CHARS, openingLineCandidate, pickHeroMoments, revisionCap, saidIndex,
  type CustomFallback, type CustomFrameKind, type HeroCandidate, type HeroKind, type HeroMoment, type WriterBrief
} from '../shared/custom-graphics'
import { reelOrder, reelWordStarts, type EditDecisions, type EditPlan, type EditSource } from '../shared/edit-recording'
import { editGraphicFrame, type EditGraphic } from '../shared/reel-graphics'
import { graphicBox } from '../shared/graphic-layout'
import { spokenNumber } from '../shared/graphic-prefill'
import { templateInfo, type TimedWord } from '../shared/motion-graphics'
import { BEAT_HOOK_SECONDS, graphicName, graphicWords } from '../shared/beat-sheet'
import { inBatches, memberLibrary, produceCustomGraphic, readCustomGraphic, type LibraryHooks, type ModelCall } from './custom-graphics'
import type { CustomSandbox } from './custom-render'
import { readLibraryTemplate } from './motion-library'
import { beatFrame } from './beat-stills'

export interface EditCustomContext {
  folder: string
  plan: EditPlan
  decisions: EditDecisions
  sources: EditSource[]
  brandColor?: string | null
  /** The brand's logo as a data URL (var(--cg-logo)), or none. */
  logo?: string | null
  model: string
  price: { input: number; output: number }
  /** The model can look at pictures (else only our own checks grade). */
  vision: boolean
}

/** A hero moment on the review's clock, with what it replaces. */
export interface EditHero extends HeroMoment { graphic: EditGraphic | null }

/** The review's graphics and the opening line as candidates, on the reel's clock (ms). */
function candidates(ctx: EditCustomContext): { list: HeroCandidate[]; starts: Map<number, number>; order: number[]; endMs: number } {
  const { plan, decisions } = ctx
  const startsS = reelWordStarts(plan, decisions)
  const starts = new Map([...startsS].map(([i, s]) => [i, Math.round(s * 1000)]))
  const order = reelOrder(plan, decisions)
  const last = order[order.length - 1]
  const endMs = last !== undefined ? (starts.get(last) ?? 0) + plan.words[last].endMs - plan.words[last].startMs : 0
  const list: HeroCandidate[] = []
  for (const g of decisions.graphics ?? []) {
    const at = starts.get(g.word)
    if (at === undefined) continue
    list.push({ ref: g.id, word: g.word, atMs: at, durationMs: g.duration_ms, template: g.template, fields: g.fields, size: g.size, placement: g.placement })
  }
  const line = openingLineCandidate(plan.words, order, starts)
  // The opening line is a candidate only when no graphic plays over it already.
  if (line && !list.some((c) => c.atMs < line.atMs + line.durationMs && line.atMs < c.atMs + c.durationMs)) list.push(line)
  return { list, starts, order, endMs }
}

/** The hero moments of this review (none for a reel without words). Custom graphics already made are left as they are. */
export function editHeroMoments(ctx: EditCustomContext): EditHero[] {
  const { list, endMs } = candidates(ctx)
  const format = ctx.plan.format === 'youtube' ? 'youtube' : 'reel'
  // Custom graphics already made keep their slots (they score highest), and aren't made again.
  const picked = pickHeroMoments(list, { durationMs: endMs, format })
  return picked.filter((m) => list.find((c) => c.ref === m.ref)?.template !== 'custom')
    .map((m) => ({ ...m, graphic: (ctx.decisions.graphics ?? []).find((g) => g.id === m.replaces) ?? null }))
}

/** What making them costs (shown before running). */
export function editCustomEstimate(ctx: EditCustomContext, count = editHeroMoments(ctx).length): { moments: number; expectedUsd: number; mostUsd: number; revisions: number } {
  const e = customGraphicsEstimate(count, ctx.price)
  return { moments: count, ...e }
}

const tidy = (w: string): string => w.replace(/\s+/g, ' ').trim()

/** The reel's words with reel times (ms). */
function reelWords(ctx: EditCustomContext, order: number[], starts: Map<number, number>): (TimedWord & { index: number })[] {
  return order.map((i) => {
    const w = ctx.plan.words[i], at = starts.get(i) ?? 0
    return { word: w.text, start_ms: at, end_ms: at + Math.max(40, w.endMs - w.startMs), index: i }
  })
}

/** What the planned template graphic showed, in a line (a hint for the writer). */
function plannedLine(g: EditGraphic | null, line: string): string {
  if (!g) return `(no graphic: the line "${line.slice(0, 160)}")`
  const words = graphicWords(g)
  return `${graphicName(g)}${words ? `: ${words}` : ''}`
}

/** The writer's brief for one moment. */
function briefFor(ctx: EditCustomContext, hero: HeroMoment, durationMs: number, words: (TimedWord & { index: number })[], graphic: EditGraphic | null, note?: string): { brief: WriterBrief; line: string; frameWord: number } {
  const from = hero.atMs - 1200, to = hero.atMs + durationMs
  const inside = words.filter((w) => w.start_ms >= from && w.start_ms < to)
  const before = words.filter((w) => w.start_ms >= hero.atMs - 9000 && w.start_ms < from).map((w) => w.word).join(' ')
  const after = words.filter((w) => w.start_ms >= to && w.start_ms < to + 5000).map((w) => w.word).join(' ')
  const line = tidy(inside.filter((w) => w.start_ms >= hero.atMs - 200).map((w) => w.word).join(' '))
  const numbers: string[] = []
  words.forEach((w, i) => {
    if (w.start_ms >= hero.atMs - 200 || numbers.length >= 6) return
    const n = spokenNumber(words, i, false)
    if (n && /[\d]/.test(n.text) && !numbers.includes(n.text) && /[$€£%]|\d{3}/.test(n.text)) numbers.push(n.text)
  })
  const look = ctx.decisions.look
  const hookShown = hero.atMs < BEAT_HOOK_SECONDS * 1000
  const frame = editGraphicFrame(ctx.decisions.hookText, look)
  const geometry = ctx.plan.format === 'youtube'
    ? customGeometry(hero.frame, { aspect: '16:9' })
    : customGeometry(hero.frame, { hook: hookShown ? frame.hook : 0, cardBox: hero.frame === 'card' ? graphicBox(hero.placement, hookShown ? frame : { ...frame, hook: 0 }, 'card') : null })
  const settled = hero.atMs + durationMs * .55
  const frameWord = (inside.find((w) => w.start_ms >= settled) ?? inside[inside.length - 1] ?? words[0])?.index ?? 0
  const brief: WriterBrief = {
    kind: hero.kind, frame: hero.frame, durationMs, geometry, planned: plannedLine(graphic, line),
    cues: inside.map((w) => ({ word: w.word, at: Math.round((w.start_ms - hero.atMs) / 10) / 100 })), before, after,
    look: customLook({ kind: hero.frame, brandColor: ctx.brandColor, font: look.headlineLook.font, logo: !!ctx.logo }),
    ...(numbers.length ? { saidNumbers: numbers } : {}), ...(note ? { note } : {})
  }
  return { brief, line, frameWord }
}

/** The video frame at a word (data URL), from its source (the proxy when there is one). Null when it can't be read. */
async function frameAt(ctx: EditCustomContext, word: number): Promise<string | null> {
  const w = ctx.plan.words[word]
  const source = w ? ctx.sources[w.src] : undefined
  if (!w || !source) return null
  try {
    const at = Math.max(0, Math.min(Math.round((w.startMs + w.endMs) / 2), Math.round(source.seconds * 1000) - 120))
    const path = await beatFrame(join(ctx.folder, '.work', 'beats'), source.proxy ?? source.path, at)
    return `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`
  } catch { return null }
}

const newId = (taken: Set<string>): string => {
  for (;;) {
    const id = `g-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`
    if (!taken.has(id)) { taken.add(id); return id }
  }
}

export interface EditCustomResult {
  /** The review's graphics with the kept custom graphics in place. */
  graphics: EditGraphic[]
  made: number
  tried: number
  costUsd: number
  /** Plain notes for the member (what stayed a template and why). */
  notes: string[]
}

/** The fallback a custom graphic keeps (its template graphic, to swap back to). */
function fallbackOf(g: EditGraphic | null): CustomFallback | null {
  if (!g) return null
  return { template: g.template, fields: { ...g.fields }, duration_ms: g.duration_ms, placement: g.placement, ...(g.size ? { size: g.size } : {}), ...(g.depth ? { depth: g.depth } : {}), ...(g.origin ? { origin: g.origin } : {}) }
}

/**
 * Make custom graphics for the hero moments (or, with `only`, again for one custom graphic with the member's note).
 * Two at a time; each kept one replaces its template graphic. Never throws for a graphic that fails: it stays a template.
 */
export async function makeEditCustomGraphics(ctx: EditCustomContext, options: { call: ModelCall; sandbox?: CustomSandbox; signal?: AbortSignal; only?: { id: string; note: string }; onProgress?: (done: number, total: number) => void; library?: LibraryHooks | null; pick?: { itemId: string; word: number; replaces?: string } }): Promise<EditCustomResult> {
  const { order, starts, endMs } = candidates(ctx)
  const words = reelWords(ctx, order, starts)
  const said = saidIndex(words)
  const graphics = [...(ctx.decisions.graphics ?? [])]
  const taken = new Set(graphics.map((g) => g.id))
  let heroes: EditHero[]
  let note: string | undefined
  if (options.only) {
    const g = graphics.find((x) => x.id === options.only!.id)
    if (!g || g.template !== 'custom' || !isCustomComp(g.fields.comp)) throw new Error('That custom graphic is no longer in your edit.')
    const found = readCustomGraphic(ctx.folder, g.fields.comp)
    if (!found) throw new Error('That custom graphic could not be read. Swap it back to its template.')
    const at = starts.get(g.word)
    if (at === undefined) throw new Error('That custom graphic’s words were cut.')
    note = options.only.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS)
    if (!note) throw new Error('Type what to change.')
    const replaced = found.meta.fallback ? { ...g, template: found.meta.fallback.template as EditGraphic['template'], fields: found.meta.fallback.fields } : null
    heroes = [{ ref: g.id, word: g.word, atMs: at, durationMs: g.duration_ms, kind: found.meta.kind, frame: found.meta.frame, placement: g.placement, replaces: g.id, score: 10, graphic: replaced }]
  } else if (options.pick) {
    // One of My motion library's graphics, picked by the member for a word (replacing that beat's graphic, if any).
    const found = readLibraryTemplate(options.pick.itemId)
    if (!found || found.item.status !== 'active') throw new Error('That graphic is no longer in your library.')
    const at = starts.get(options.pick.word)
    if (at === undefined) throw new Error('Pick a word that stays in your reel.')
    const replaced = options.pick.replaces ? graphics.find((g) => g.id === options.pick!.replaces) ?? null : null
    heroes = [{ ref: replaced?.id ?? `line:${options.pick.word}`, word: options.pick.word, atMs: at, durationMs: found.item.durationMs, kind: found.item.kind, frame: found.item.frame,
      placement: found.item.frame === 'card' ? 'bottom' : 'middle', replaces: replaced?.id ?? null, score: 10, graphic: replaced }]
  } else heroes = editHeroMoments(ctx)
  const cap = revisionCap(Math.max(1, heroes.length), ctx.price)
  let done = 0, costUsd = 0
  options.onProgress?.(0, heroes.length)
  const results = await inBatches(heroes, 2, async (hero) => {
    const next = graphics.filter((g) => g.id !== hero.replaces).map((g) => starts.get(g.word)).filter((t): t is number => t !== undefined && t > hero.atMs).sort((a, b) => a - b)[0] ?? null
    const durationMs = options.only ? Math.min(CUSTOM_MAX_MS, hero.durationMs) : options.pick ? Math.round(Math.max(CUSTOM_MIN_MS, Math.min(hero.durationMs, (next ?? endMs) - 300 - hero.atMs, endMs - hero.atMs))) : heroDuration(hero, next, endMs)
    const { brief, line, frameWord } = briefFor(ctx, hero, durationMs, words, hero.graphic, note)
    const frame = await frameAt(ctx, frameWord)
    const original = graphics.find((g) => g.id === hero.replaces) ?? null
    const fallback = options.only ? (readCustomGraphic(ctx.folder, original?.fields.comp)?.meta.fallback ?? null) : original?.template === 'custom' ? (readCustomGraphic(ctx.folder, original.fields.comp)?.meta.fallback ?? null) : fallbackOf(original)
    const result = await produceCustomGraphic({ run: ctx.folder, brief, words: line, said, frame, logo: ctx.logo ?? null, fallback, model: ctx.model, maxRevisions: options.only ? Math.max(1, cap) : cap, grade: ctx.vision, ...(options.pick ? { libraryItem: options.pick.itemId } : {}) },
      { call: options.call, sandbox: options.sandbox, signal: options.signal, library: options.library === undefined ? memberLibrary : options.library ?? undefined })
    costUsd += result.costUsd
    options.onProgress?.(++done, heroes.length)
    return { hero, durationMs, result }
  })
  const notes: string[] = []
  let made = 0
  for (const { hero, durationMs, result } of results) {
    if (!result.meta) {
      notes.push(`${hero.graphic ? `The ${graphicName(hero.graphic).toLowerCase()}` : 'The opening line'} stays as it was: its custom graphic didn’t pass the check.`)
      continue
    }
    made++
    const scene: CustomFrameKind = hero.frame
    const fields = { comp: result.meta.comp, idea: result.meta.idea, scene }
    const base: EditGraphic = { id: hero.replaces ?? newId(taken), template: 'custom', word: hero.word, duration_ms: durationMs, placement: hero.placement, fields, origin: 'auto', ...(scene === 'card' ? {} : { size: 'stage' as const }) }
    const at = graphics.findIndex((g) => g.id === hero.replaces)
    if (at >= 0) graphics[at] = { ...base, id: newId(taken) }
    else graphics.push(base)
  }
  graphics.sort((a, b) => a.word - b.word)
  return { graphics, made, tried: heroes.length, costUsd, notes: notes.slice(0, 4) }
}

/** Swap a custom graphic back to the template graphic it replaced (null when there was none: it is removed). */
export function swapBackCustomGraphic(folder: string, graphics: readonly EditGraphic[], id: string): EditGraphic[] {
  const g = graphics.find((x) => x.id === id)
  if (!g || g.template !== 'custom') throw new Error('That custom graphic is no longer in your edit.')
  const fallback = readCustomGraphic(folder, g.fields.comp)?.meta.fallback ?? null
  if (!fallback || !templateInfo(fallback.template as EditGraphic['template'])) return graphics.filter((x) => x.id !== id)
  const back: EditGraphic = { id: g.id, template: fallback.template as EditGraphic['template'], word: g.word, duration_ms: fallback.duration_ms, placement: fallback.placement as EditGraphic['placement'], fields: fallback.fields,
    ...(fallback.size === 'compact' || fallback.size === 'card' || fallback.size === 'stage' ? { size: fallback.size } : {}), ...(fallback.depth === 'behind' ? { depth: 'behind' as const } : {}),
    ...(fallback.origin === 'auto' || fallback.origin === 'member' || fallback.origin === 'chat' ? { origin: fallback.origin } : {}) }
  return graphics.map((x) => x.id === id ? back : x)
}

export type { HeroKind }
export { DEFAULT_PRICE }
