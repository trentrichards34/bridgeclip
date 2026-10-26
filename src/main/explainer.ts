/**
 * The Explainer style on Edit my recording (shared/explainer.ts says what it is): when the reel is made, the reel is
 * cut into sections at the turns of what is said, one plan call picks the hero object and each section's label and
 * arc, and each section becomes ONE custom graphic (frame 'explainer') through the custom graphics producer: written,
 * rendered in the sandbox, checked (words said, nothing clipped, never frozen), graded on its stills and revised. A
 * section that passes replaces the template graphics that started in it; one that doesn't keeps them (the normal look
 * on the same paper page). The engine lays the page out (edit_direction.explainer_layout): the paper backdrop with the
 * speaker cut out under the canvas, captions at the top.
 */
import {
  customGeometry, customLook, saidIndex, stressedWords, type SaidIndex, type WriterBrief
} from '../shared/custom-graphics'
import {
  EXPLAINER_MAX_MS, EXPLAINER_REVISIONS, explainerBriefLines, explainerEstimate, explainerPlanSystemPrompt, explainerPlanUserPrompt, explainerSections,
  parseExplainerPlan, sectionNumbers, sectionText, type ExplainerPlan, type ExplainerSection
} from '../shared/explainer'
import type { EditGraphic } from '../shared/reel-graphics'
import { editReelTimeline, frameAt, type EditCustomContext } from './edit-custom-graphics'
import { inBatches, produceCustomGraphic, type ModelCall } from './custom-graphics'
import type { CustomSandbox } from './custom-render'
import { logger } from './logger'

/** Graphics an Explainer section never replaces (they have their own place: the call to action, a pinned logo). */
const KEEP_TEMPLATES = new Set(['link_cta', 'comment_cta', 'logo'])

/** The sections of this review's reel, with the plan word each one starts on and how long its canvas lasts. */
export function explainerSectionsFor(ctx: EditCustomContext): { sections: (ExplainerSection & { word: number; atMs: number; durationMs: number })[]; endMs: number; words: ReturnType<typeof editReelTimeline>['words'] } {
  const { words, endMs } = editReelTimeline(ctx)
  const sections = explainerSections(words, endMs)
  const out = sections.map((s, k) => {
    const first = words.find((w) => w.start_ms >= s.startMs && w.start_ms < s.endMs)
    // The canvas starts on the section's first word (the graphic's word) and runs to the next section's first word (the reel's end for the last).
    const atMs = first?.start_ms ?? s.startMs
    const next = sections[k + 1] ? words.find((w) => w.start_ms >= sections[k + 1].startMs)?.start_ms ?? sections[k + 1].startMs : endMs
    return { ...s, word: first?.index ?? 0, atMs, durationMs: Math.max(1500, Math.min(EXPLAINER_MAX_MS, Math.round(next - atMs))) }
  })
  return { sections: out, endMs, words }
}

/** What making it costs (shown before running). */
export function explainerInfo(ctx: EditCustomContext): { sections: number; expectedUsd: number; mostUsd: number } {
  const { sections } = explainerSectionsFor(ctx)
  const e = explainerEstimate(sections.length, ctx.price)
  return { sections: sections.length, expectedUsd: e.expectedUsd, mostUsd: e.mostUsd }
}

/** What is said, for the checks: every word and number of the reel, the section numbers, and counters up to each said number. */
export function explainerSaid(words: readonly { word: string; start_ms: number; end_ms: number }[], sections: number): SaidIndex {
  const said = saidIndex(words)
  for (let k = 1; k <= sections; k++) said.numbers.add(String(k))
  const upTo = [...said.numbers].map(Number).filter((n) => Number.isFinite(n) && n > 0)
  return { ...said, upTo }
}

export interface ExplainerResult {
  graphics: EditGraphic[]
  made: number
  tried: number
  costUsd: number
  notes: string[]
}

const newId = (taken: Set<string>): string => {
  for (;;) {
    const id = `g-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`
    if (!taken.has(id)) { taken.add(id); return id }
  }
}

/** Ask for the hero object and the sections' labels and arcs (one call; null when the answer can't be used). */
async function planSections(ctx: EditCustomContext, sections: readonly ExplainerSection[], said: SaidIndex, call: ModelCall, signal?: AbortSignal): Promise<{ plan: ExplainerPlan | null; costUsd: number }> {
  try {
    const reply = await call({ model: ctx.model, system: explainerPlanSystemPrompt(), user: explainerPlanUserPrompt(sections), maxTokens: 6000, temperature: 0.5, purpose: 'plan', signal })
    return { plan: parseExplainerPlan(reply.text, sections, said), costUsd: reply.costUsd }
  } catch (error) {
    if (signal?.aborted) throw error
    logger.info('explainer.plan.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
    return { plan: null, costUsd: 0 }
  }
}

/**
 * Design the reel's Explainer sections. Two at a time; each kept one replaces the template graphics that start inside
 * it. Never throws for a section that fails: it keeps the normal look.
 */
export async function makeExplainer(ctx: EditCustomContext, options: { call: ModelCall; sandbox?: CustomSandbox; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<ExplainerResult> {
  const { sections, words } = explainerSectionsFor(ctx)
  const graphics = [...(ctx.decisions.graphics ?? [])]
  if (!sections.length) return { graphics, made: 0, tried: 0, costUsd: 0, notes: ['Your reel has no words to explain.'] }
  const said = explainerSaid(words, sections.length)
  let costUsd = 0
  const planned = await planSections(ctx, sections, said, options.call, options.signal)
  costUsd += planned.costUsd
  const plan = planned.plan
  const geometry = customGeometry('explainer', {})
  const look = customLook({ kind: 'explainer', brandColor: ctx.brandColor, font: ctx.decisions.look.headlineLook.font, logo: !!ctx.logo })
  let done = 0
  options.onProgress?.(0, sections.length)
  const results = await inBatches(sections, 2, async (section) => {
    const inside = words.filter((w) => w.start_ms >= section.atMs - 50 && w.start_ms < section.atMs + section.durationMs)
    const cues = inside.map((w) => ({ word: w.word, at: Math.round((w.start_ms - section.atMs) / 10) / 100 }))
    const before = words.filter((w) => w.start_ms >= section.atMs - 9000 && w.start_ms < section.atMs).map((w) => w.word).join(' ')
    const after = words.filter((w) => w.start_ms >= section.atMs + section.durationMs && w.start_ms < section.atMs + section.durationMs + 6000).map((w) => w.word).join(' ')
    const k = section.index
    const explainer = explainerBriefLines({ section, count: sections.length, plan, rootTop: geometry.root.y, frameHeight: geometry.height,
      ...(k > 0 && plan?.sections[k - 1]?.ends ? { previous: plan.sections[k - 1].ends } : {}),
      ...(plan?.sections[k + 1]?.starts ? { next: plan.sections[k + 1].starts } : {}) })
    const brief: WriterBrief = {
      kind: 'process', frame: 'explainer', durationMs: section.durationMs, geometry, look, cues, before, after, planned: '',
      stressed: stressedWords(cues, section.durationMs), explainer, ...(sectionNumbers(section).length ? { saidNumbers: sectionNumbers(section) } : {})
    }
    const mid = inside[Math.floor(inside.length / 2)]?.index ?? section.word
    const frame = await frameAt(ctx, mid)
    const result = await produceCustomGraphic({ run: ctx.folder, brief, words: sectionText(section), said, frame, logo: ctx.logo ?? null, fallback: null, model: ctx.model,
      maxRevisions: EXPLAINER_REVISIONS, grade: ctx.vision }, { call: options.call, sandbox: options.sandbox, signal: options.signal })
    costUsd += result.costUsd
    options.onProgress?.(++done, sections.length)
    return { section, result }
  })
  const taken = new Set(graphics.map((g) => g.id))
  const notes: string[] = []
  let made = 0
  let out = graphics
  const reelStart = new Map(words.map((w) => [w.index, w.start_ms]))
  for (const { section, result } of results) {
    if (!result.meta) {
      notes.push(`Section ${section.index + 1} keeps the normal look: its drawing didn’t pass the check.`)
      continue
    }
    made++
    const a = section.atMs, b = section.atMs + section.durationMs
    // The template graphics (and hero custom graphics) that start inside the section give way to its canvas.
    out = out.filter((g) => { const t = reelStart.get(g.word); return t === undefined || t < a || t >= b || KEEP_TEMPLATES.has(g.template) })
    out.push({ id: newId(taken), template: 'custom', word: section.word, duration_ms: section.durationMs, placement: 'top', size: 'stage', origin: 'auto',
      fields: { comp: result.meta.comp, idea: result.meta.idea, scene: 'explainer' } })
  }
  out.sort((x, y) => x.word - y.word)
  return { graphics: out, made, tried: sections.length, costUsd, notes: notes.slice(0, 4) }
}
