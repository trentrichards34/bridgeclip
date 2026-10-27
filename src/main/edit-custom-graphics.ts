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
  CUSTOM_MAX_MS, CUSTOM_MIN_MS, CUSTOM_SECTION_MAX_MS, DEFAULT_THEME, stressedWords, type VisualWorld, customGeometry, customGraphicsEstimate, customLook, DEFAULT_PRICE, heroDuration, heroFrame, heroKindOf, REEL_HERO_MIN_MS, isCustomComp, MAX_NOTE_CHARS, openingLineCandidate, pickHeroMoments, revisionCap, saidIndex,
  type CustomFallback, type CustomFrameKind, type HeroCandidate, type HeroKind, type HeroMoment, type WriterBrief
} from '../shared/custom-graphics'
import { reelOrder, reelWordStarts, type EditDecisions, type EditPlan, type EditSource } from '../shared/edit-recording'
import { editGraphicFrame, type EditGraphic } from '../shared/reel-graphics'
import { graphicBox } from '../shared/graphic-layout'
import { spokenNumber } from '../shared/graphic-prefill'
import { templateInfo, type TimedWord } from '../shared/motion-graphics'
import { BEAT_HOOK_SECONDS, graphicName, graphicWords } from '../shared/beat-sheet'
import { planScenes, plannedScenes, planWorld, reelStretches, sceneBrief, usablePlan, type PlannedScene, type SceneWord } from './custom-scenes'
import { DEFAULT_SCENE_AMOUNT, isTextHighlight, MAX_POPUPS_WITH_SCENES, MAX_TEXT_HIGHLIGHTS, SCENE_AMOUNTS, SCENE_KEEPS, sceneEligible, sceneTarget, sectionText, type SceneAmount } from '../shared/custom-scenes'
import { inBatches, memberLibrary, plainForLog, produceCustomGraphic, proposeVisualWorld, readCustomGraphic, readVisualWorld, saveVisualWorld, type LibraryHooks, type ModelCall, type ProduceResult } from './custom-graphics'
import { logger } from './logger'
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

/**
 * The hero moments of this review (none for a reel without words). Custom graphics already made are left as they are.
 * `avoid`: stretches taken by scenes (reel ms): no pop-up there; `count`: at most this many.
 */
export function editHeroMoments(ctx: EditCustomContext, avoid: readonly { atMs: number; durationMs: number }[] = [], count?: number): EditHero[] {
  const all = candidates(ctx)
  const endMs = all.endMs
  const list = all.list.filter((c) => !avoid.some((a) => c.atMs < a.atMs + a.durationMs && a.atMs < c.atMs + c.durationMs))
  const format = ctx.plan.format === 'youtube' ? 'youtube' : 'reel'
  // Custom graphics already made keep their slots (they score highest), and aren't made again.
  const picked = pickHeroMoments(list, { durationMs: endMs, format, ...(count !== undefined ? { count } : {}) })
  return picked.filter((m) => list.find((c) => c.ref === m.ref)?.template !== 'custom')
    .map((m) => ({ ...m, graphic: (ctx.decisions.graphics ?? []).find((g) => g.id === m.replaces) ?? null }))
}

/** Scenes go on this reel: custom graphics on a reel (not YouTube, not the Explainer) with Stage layouts and scenes on. */
export function scenesOn(ctx: EditCustomContext): boolean {
  const d = ctx.decisions
  return ctx.plan.format !== 'youtube' && d.customScenes !== false && d.explainer !== true && d.motionGraphics !== false && d.stageLayouts !== false
}

/** The reel's words with reel times, plan index and whether each was said over a filmed screen. */
export function sceneWords(ctx: EditCustomContext): { words: SceneWord[]; endMs: number } {
  const { order, starts, endMs } = candidates(ctx)
  const words = reelWords(ctx, order, starts).map((w) => ({ ...w, screen: ctx.sources[ctx.plan.words[w.index]?.src ?? -1]?.shot === 'screen' }))
  return { words, endMs }
}

/** The member's Scenes choice (missing: Full). */
export const sceneAmountOf = (d: Pick<EditDecisions, 'sceneAmount'>): SceneAmount => d.sceneAmount ?? DEFAULT_SCENE_AMOUNT

/**
 * The stretches that could become scenes (before the plan call decides), how many we expect and the most there can
 * be. Full: the plan's rules (about 55% of the stretches, at most every eligible one); Light and Standard: their count.
 */
export function sceneOutlook(ctx: EditCustomContext, amount: SceneAmount = sceneAmountOf(ctx.decisions)): { stretches: number; eligible: number; expected: number; most: number } {
  if (!scenesOn(ctx)) return { stretches: 0, eligible: 0, expected: 0, most: 0 }
  const { words, endMs } = sceneWords(ctx)
  const stretches = reelStretches(words, endMs)
  const eligible = stretches.filter((s) => sceneEligible(s, stretches.length)).length
  const target = stretches.length ? sceneTarget(amount, stretches[stretches.length - 1].endMs - stretches[0].startMs, eligible) : null
  if (target !== null) return { stretches: stretches.length, eligible, expected: target, most: target }
  return { stretches: stretches.length, eligible, expected: Math.min(eligible, Math.ceil(stretches.length * .55)), most: eligible }
}

/**
 * What making them costs (shown before running), honestly: every graphic gets every revision it needs (MIN_REVISIONS),
 * scenes are priced as scenes (about twice a pop-up's composition), the plan call included.
 */
export function editCustomEstimate(ctx: EditCustomContext, count?: number, amount: SceneAmount = sceneAmountOf(ctx.decisions)): { moments: number; scenes: number; expectedUsd: number; mostUsd: number; revisions: number } {
  const outlook = sceneOutlook(ctx, amount)
  const pops = count ?? (outlook.eligible ? Math.min(MAX_POPUPS_WITH_SCENES, editHeroMoments(ctx).length) : editHeroMoments(ctx).length)
  const expected = customGraphicsEstimate(pops, ctx.price, outlook.expected)
  const most = customGraphicsEstimate(pops, ctx.price, outlook.most)
  return { moments: pops, scenes: outlook.expected, expectedUsd: expected.expectedUsd, mostUsd: most.mostUsd, revisions: expected.revisions }
}

/** Each Scenes choice's estimate for this reel (what the review shows next to it), or null when the reel has no scenes. */
export function editSceneAmounts(ctx: EditCustomContext): Record<SceneAmount, { scenes: number; expectedUsd: number; mostUsd: number }> | null {
  if (!sceneOutlook(ctx).eligible) return null
  const pops = Math.min(MAX_POPUPS_WITH_SCENES, editHeroMoments(ctx).length)
  return Object.fromEntries(SCENE_AMOUNTS.map((amount) => {
    const e = editCustomEstimate(ctx, pops, amount)
    return [amount, { scenes: e.scenes, expectedUsd: e.expectedUsd, mostUsd: e.mostUsd }]
  })) as Record<SceneAmount, { scenes: number; expectedUsd: number; mostUsd: number }>
}

const tidy = (w: string): string => w.replace(/\s+/g, ' ').trim()

/** The reel's words with reel times (ms). */
function reelWords(ctx: EditCustomContext, order: number[], starts: Map<number, number>): (TimedWord & { index: number })[] {
  return order.map((i) => {
    const w = ctx.plan.words[i], at = starts.get(i) ?? 0
    return { word: w.text, start_ms: at, end_ms: at + Math.max(40, w.endMs - w.startMs), index: i }
  })
}

/** The reel's words with reel times (and their plan index) and where the reel ends (ms): the Explainer's sections are cut from them. */
export function editReelTimeline(ctx: EditCustomContext): { words: (TimedWord & { index: number })[]; endMs: number } {
  const { order, starts, endMs } = candidates(ctx)
  return { words: reelWords(ctx, order, starts), endMs }
}

/** What the planned template graphic showed, in a line (a hint for the writer). */
function plannedLine(g: EditGraphic | null, line: string): string {
  if (!g) return `(no graphic: the line "${line.slice(0, 160)}")`
  const words = graphicWords(g)
  return `${graphicName(g)}${words ? `: ${words}` : ''}`
}

/** The writer's brief for one moment. */
function briefFor(ctx: EditCustomContext, hero: HeroMoment, durationMs: number, words: (TimedWord & { index: number })[], graphic: EditGraphic | null, note?: string, world?: VisualWorld | null): { brief: WriterBrief; line: string; frameWord: number } {
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
  const cues = inside.map((w) => ({ word: w.word, at: Math.round((w.start_ms - hero.atMs) / 10) / 100 }))
  const brief: WriterBrief = {
    kind: hero.kind, frame: hero.frame, durationMs, geometry, planned: plannedLine(graphic, line), cues, before, after, stressed: stressedWords(cues, durationMs),
    ...(world ? { world } : {}),
    look: customLook({ kind: hero.frame, brandColor: ctx.brandColor, font: look.headlineLook.font, logo: !!ctx.logo, worldAccent: world?.accent ?? null, theme: ctx.decisions.customTheme ?? DEFAULT_THEME }),
    ...(numbers.length ? { saidNumbers: numbers } : {}), ...(note ? { note } : {})
  }
  return { brief, line, frameWord }
}

/** The video frame at a word (data URL), from its source (the proxy when there is one). Null when it can't be read. */
export async function frameAt(ctx: EditCustomContext, word: number): Promise<string | null> {
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
  /** Why each one that didn't pass fell back (the checks' own words), kept in the run for review. */
  reasons?: { word: number; kind: string; tries: number; reason: string }[]
  /** How many of the made ones are scenes. */
  scenes?: number
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
export async function makeEditCustomGraphics(ctx: EditCustomContext, options: { call: ModelCall; sandbox?: CustomSandbox; signal?: AbortSignal; only?: { id: string; note: string }; onProgress?: (done: number, total: number) => void; library?: LibraryHooks | null; pick?: { itemId: string; word: number; replaces?: string }; design?: { id: string } }): Promise<EditCustomResult> {
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
  } else if (options.design) {
    // "Add a visual here" then design it: that one graphic becomes the hero moment.
    const g = graphics.find((x) => x.id === options.design!.id)
    const at = g ? starts.get(g.word) : undefined
    if (!g || at === undefined) throw new Error('That visual is no longer in your edit.')
    const candidate = { ref: g.id, word: g.word, atMs: at, durationMs: g.duration_ms, template: g.template, fields: g.fields, size: g.size, placement: g.placement }
    const kind = heroKindOf(candidate)?.kind ?? 'claim'
    heroes = [{ ref: g.id, word: g.word, atMs: at, durationMs: Math.max(REEL_HERO_MIN_MS, g.duration_ms), kind, frame: heroFrame(candidate, kind, ctx.plan.format === 'youtube' ? 'youtube' : 'reel'),
      placement: g.placement === 'top' || g.placement === 'bottom' ? g.placement : 'middle', replaces: g.id, score: 10, graphic: g }]
  } else heroes = []
  const theme = ctx.decisions.customTheme ?? DEFAULT_THEME
  let costUsd = 0
  // Scenes (a reel with Stage layouts): one plan call picks the hero object, the motif and the stretches that become
  // 15-20 s scenes; the pop-ups go only outside them, at most MAX_POPUPS_WITH_SCENES.
  let scenes: PlannedScene[] = []
  let sceneCount = 0
  let planned: ReturnType<typeof usablePlan> | null = null
  const fresh = !options.only && !options.pick && !options.design
  const timeline = sceneWords(ctx)
  if (fresh && scenesOn(ctx)) {
    const stretches = reelStretches(timeline.words, timeline.endMs)
    if (stretches.some((x) => sceneEligible(x, stretches.length))) {
      const amount = sceneAmountOf(ctx.decisions)
      const result = await planScenes({ model: ctx.model, theme, stretches, said, amount }, options.call, options.signal)
      costUsd += result.costUsd
      planned = usablePlan(result.plan, stretches, amount, theme)
      scenes = plannedScenes(stretches, planned, timeline.words, timeline.endMs)
      sceneCount = stretches.length
    }
  }
  if (fresh) heroes = scenes.length ? editHeroMoments(ctx, scenes, MAX_POPUPS_WITH_SCENES) : editHeroMoments(ctx)
  const cap = revisionCap(Math.max(1, heroes.length + scenes.length), ctx.price)
  let done = 0
  // One world note for the whole video: the saved one (the member may have written it), else the scene plan's hero
  // object and motif, else proposed now for the pop-ups.
  let world = readVisualWorld(ctx.folder)
  if (!world?.edited && planned) {
    const fromPlan = planWorld(planned)
    if (fromPlan) { world = fromPlan; saveVisualWorld(ctx.folder, fromPlan) }
  }
  if (!world && heroes.length && !options.pick) {
    const proposed = await proposeVisualWorld({ transcript: words.map((w) => w.word).join(' '), moments: heroes.map((h) => ({ kind: h.kind, words: tidy(words.filter((w) => w.start_ms >= h.atMs - 200 && w.start_ms < h.atMs + h.durationMs).map((w) => w.word).join(' ')) })), model: ctx.model },
      { call: options.call, signal: options.signal })
    costUsd += proposed.costUsd
    world = proposed.world
    if (world) saveVisualWorld(ctx.folder, world)
  }
  const total = heroes.length + scenes.length
  options.onProgress?.(0, total)
  type Job = { scene: PlannedScene } | { hero: EditHero }
  const jobs: Job[] = [...scenes.map((scene) => ({ scene })), ...heroes.map((hero) => ({ hero }))]
  const library = options.library === undefined ? memberLibrary : options.library ?? undefined
  // One moment that fails (a call that still errors after its retry) costs that moment only, never the others.
  const failed = (error: unknown): ProduceResult => {
    if (options.signal?.aborted) throw error
    const reason = String((error as Error)?.message ?? error).slice(0, 300)
    logger.warn('edit.custom.moment.failed', { message: plainForLog(reason) })
    return { meta: null, costUsd: 0, tries: 0, reason }
  }
  const results = await inBatches(jobs, 3, async (job) => {
    if ('scene' in job) {
      const scene = job.scene
      const brief = sceneBrief({ scene, scenes: scenes.length, count: sceneCount, plan: planned!, words: timeline.words, theme, brandColor: ctx.brandColor, font: ctx.decisions.look.headlineLook.font, logo: !!ctx.logo, world })
      const inside = timeline.words.filter((w) => w.start_ms >= scene.atMs && w.start_ms < scene.atMs + scene.durationMs)
      const frame = await frameAt(ctx, inside[Math.floor(inside.length / 2)]?.index ?? scene.word)
      // A scene is designed fresh for its words (never filled from the library: it is one continuous composition for this stretch).
      const result = await produceCustomGraphic({ run: ctx.folder, brief, words: sectionText(scene.stretch), said, frame, logo: ctx.logo ?? null, fallback: null, model: ctx.model, maxRevisions: cap, grade: ctx.vision },
        { call: options.call, sandbox: options.sandbox, signal: options.signal }).catch(failed)
      costUsd += result.costUsd
      options.onProgress?.(++done, total)
      return { type: 'scene' as const, scene, result }
    }
    const hero = job.hero
    const next = graphics.filter((g) => g.id !== hero.replaces).map((g) => starts.get(g.word)).filter((t): t is number => t !== undefined && t > hero.atMs).sort((a, b) => a - b)[0] ?? null
    const nextScene = scenes.map((x) => x.atMs).filter((t) => t > hero.atMs).sort((a, b) => a - b)[0] ?? null
    const upTo = next === null ? nextScene : nextScene === null ? next : Math.min(next, nextScene)
    const remake = options.only ? readCustomGraphic(ctx.folder, graphics.find((g) => g.id === options.only!.id)?.fields.comp) : null
    const durationMs = options.only ? Math.min(remake && remake.meta.durationMs > CUSTOM_MAX_MS ? CUSTOM_SECTION_MAX_MS : CUSTOM_MAX_MS, hero.durationMs) : options.pick ? Math.round(Math.max(CUSTOM_MIN_MS, Math.min(hero.durationMs, (next ?? endMs) - 300 - hero.atMs, endMs - hero.atMs))) : heroDuration(hero, upTo, endMs, ctx.plan.format === 'youtube' ? 'youtube' : 'reel')
    const { brief, line, frameWord } = briefFor(ctx, hero, durationMs, words, hero.graphic, note, world)
    const frame = await frameAt(ctx, frameWord)
    const original = graphics.find((g) => g.id === hero.replaces) ?? null
    const fallback = options.only ? (readCustomGraphic(ctx.folder, original?.fields.comp)?.meta.fallback ?? null) : original?.template === 'custom' ? (readCustomGraphic(ctx.folder, original.fields.comp)?.meta.fallback ?? null) : fallbackOf(original)
    const result = await produceCustomGraphic({ run: ctx.folder, brief, words: line, said, frame, logo: ctx.logo ?? null, fallback, model: ctx.model, maxRevisions: cap, grade: ctx.vision, ...(options.pick ? { libraryItem: options.pick.itemId } : {}) },
      { call: options.call, sandbox: options.sandbox, signal: options.signal, library }).catch(failed)
    costUsd += result.costUsd
    options.onProgress?.(++done, total)
    return { type: 'hero' as const, hero, durationMs, result }
  })
  const notes: string[] = []
  const reasons: { word: number; kind: string; tries: number; reason: string }[] = []
  let made = 0
  let out = graphics
  const reelStart = new Map(timeline.words.map((w) => [w.index, w.start_ms]))
  const madeScenes: PlannedScene[] = []
  for (const r of results) {
    if (r.type !== 'scene') continue
    const { scene, result } = r
    if (!result.meta) {
      reasons.push({ word: scene.word, kind: 'scene', tries: result.tries, reason: (result.reason ?? '').slice(0, 1200) })
      notes.push(`A scene at ${Math.floor(scene.atMs / 60000)}:${String(Math.floor(scene.atMs / 1000) % 60).padStart(2, '0')} keeps its graphics: its design didn’t pass our checks.`)
      continue
    }
    made++
    madeScenes.push(scene)
    const a = scene.atMs, b = scene.atMs + scene.durationMs
    // The template graphics (and earlier custom graphics) that start inside the scene give way to it.
    out = out.filter((g) => { const t = reelStart.get(g.word); return t === undefined || t < a || t >= b || SCENE_KEEPS.has(g.template) })
    out.push({ id: newId(taken), template: 'custom', word: scene.word, duration_ms: scene.durationMs, placement: 'top', size: 'stage', origin: 'auto',
      fields: { comp: result.meta.comp, idea: 'Designed scene', scene: scene.frame, ...(scene.screen ? { card: 'screen' } : {}), ...(scene.ground === 'light' && theme === 'dark' ? { ground: 'light' } : {}) } })
  }
  for (const r of results) {
    if (r.type !== 'hero') continue
    const { hero, durationMs, result } = r
    if (!result.meta) {
      reasons.push({ word: hero.word, kind: hero.kind, tries: result.tries, reason: (result.reason ?? '').slice(0, 1200) })
      notes.push(`${hero.graphic ? `The ${graphicName(hero.graphic).toLowerCase()}` : 'The opening line'} stays as it was: its custom graphic didn’t pass our checks.`)
      continue
    }
    made++
    const scene: CustomFrameKind = hero.frame
    const fields = { comp: result.meta.comp, idea: result.meta.idea, scene }
    const base: EditGraphic = { id: hero.replaces ?? newId(taken), template: 'custom', word: hero.word, duration_ms: durationMs, placement: hero.placement, fields, origin: 'auto', ...(scene === 'card' ? {} : { size: 'stage' as const }) }
    const at = out.findIndex((g) => g.id === hero.replaces)
    if (at >= 0) out[at] = { ...base, id: newId(taken) }
    else out.push(base)
  }
  // With scenes in the reel, the text highlights outside them are the exception: at most MAX_TEXT_HIGHLIGHTS, spread out.
  if (madeScenes.length) out = limitTextHighlights(out, reelStart, MAX_TEXT_HIGHLIGHTS)
  out.sort((a, b) => a.word - b.word)
  return { graphics: out, made, tried: total, costUsd, notes: notes.slice(0, 4), reasons, scenes: madeScenes.length }
}

/** At most `keep` automatic text highlights (the ones furthest apart stay); the member's own graphics are never removed. */
export function limitTextHighlights(graphics: readonly EditGraphic[], starts: ReadonlyMap<number, number>, keep: number): EditGraphic[] {
  const texts = graphics.filter((g) => g.origin === 'auto' && isTextHighlight(g)).map((g) => ({ g, at: starts.get(g.word) ?? 0 })).sort((a, b) => a.at - b.at)
  if (texts.length <= keep) return [...graphics]
  // Evenly spread: the first, the last and the ones nearest the even marks between them.
  const kept = new Set<EditGraphic>()
  for (let k = 0; k < keep; k++) {
    const want = texts[0].at + (texts[texts.length - 1].at - texts[0].at) * (keep === 1 ? .5 : k / (keep - 1))
    const pick = texts.filter((t) => !kept.has(t.g)).reduce((p, q) => (Math.abs(q.at - want) < Math.abs(p.at - want) ? q : p))
    kept.add(pick.g)
  }
  return graphics.filter((g) => !(g.origin === 'auto' && isTextHighlight(g)) || kept.has(g))
}

/** The run's visual world as the beat sheet shows it (null: none yet). */
export function editVisualWorld(folder: string): VisualWorld | null { return readVisualWorld(folder) }

/**
 * Propose the run's visual world again (one small paid call), from the transcript and the hero moments. The member's
 * own wish, when given, steers it. Custom graphics already designed keep their look until they are designed again.
 */
export async function regenerateVisualWorld(ctx: EditCustomContext, call: ModelCall, note?: string, signal?: AbortSignal): Promise<{ world: VisualWorld | null; costUsd: number }> {
  const { order, starts } = candidates(ctx)
  const words = reelWords(ctx, order, starts)
  const heroes = editHeroMoments(ctx)
  const proposed = await proposeVisualWorld({ transcript: words.map((w) => w.word).join(' '), moments: heroes.map((h) => ({ kind: h.kind, words: tidy(words.filter((w) => w.start_ms >= h.atMs - 200 && w.start_ms < h.atMs + h.durationMs).map((w) => w.word).join(' ')) })), model: ctx.model, ...(note ? { note } : {}) }, { call, signal })
  if (proposed.world) saveVisualWorld(ctx.folder, proposed.world)
  return proposed
}

/** Save the member's own line as the run's world (null when it is empty). */
export function setVisualWorld(folder: string, world: VisualWorld): VisualWorld { saveVisualWorld(folder, world); return world }

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
