/**
 * Custom graphics, in main: one hero moment → the member's planning model writes a composition → the sandbox
 * (custom-render.ts) renders three stills over a real frame → the same model grades them (image input) and our own
 * checks run (words said, edges, type size, the face) → revise with the fixes (at most `maxRevisions`) → keep the
 * best that passes, or none (the template graphic stays). Kept in the run's .graphics/custom/: <comp>.html (the
 * composition as checked), <comp>.json (CustomMeta: what it replaced, its look, its grade, its cost), <comp>-<i>.png
 * (transparent stills for the beat sheet and the editor) and <comp>-review.jpg (the stills over the video).
 *
 * The bake (graphics-render.ts) reads the composition back by its id (the file's name is its hash, checked again) and
 * draws every frame in the same sandbox.
 */
import { createHash, randomUUID } from 'crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import {
  CUSTOM_DIR, DEFAULT_PRICE, MAX_COMPOSITION_CHARS, STILL_SCALE, callCost, checkComposition, customGeometry, customIdea, customLook, saidIndex, customStillNames, extractComposition, graderSystemPrompt, graderUserPrompt,
  isCustomComp, parseCustomMeta, parseGrade, stillTimes, unsaidOnScreen, writerSystemPrompt, writerUserPrompt, flatStretches, motionFixes, MOTION_STEP_MS, stressedWords, parseWorld, worldSystemPrompt, worldUserPrompt,
  type CustomFallback, type FlatStretch, type VisualWorld, type CustomFrameKind, type CustomGeometry, type CustomGrade, type CustomLook, type CustomMeta, type HeroKind, type SaidIndex, type WriterBrief
} from '../shared/custom-graphics'
import { customSandbox, type CustomSandbox } from './custom-render'
import { keepInLibrary, libraryMatch, noteLibraryUse, readLibraryTemplate } from './motion-library'
import { explainerStillTimes } from '../shared/explainer'
import { sceneStillTimes, type SceneAmount } from '../shared/custom-scenes'
import { plannedScenes, planScenes, reelStretches, usablePlan, type SceneWord } from './custom-scenes'
import { fillSystemPrompt, fillTemplate, fillUserPrompt, parseFill, type LibraryItem } from '../shared/motion-library'
import type { GraphicRenderSpec, TimedWord } from '../shared/motion-graphics'
import type { GraphicJob } from './graphics-render'
import { app } from 'electron'
import { readResponseText } from './http-response'
import { loadSettings } from './settings-store'
import { readMemberPrefs } from './member-prefs'
import { getModelCatalog } from './openrouter-models'
import { DEFAULT_PLANNER_MODEL, plannerModelFor } from '../shared/purpose'
import { logger } from './logger'

const GRAPHICS_DIR = '.graphics'
const MAX_REPLY_BYTES = 400_000

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface ModelRequest {
  model: string
  system: string
  user: string
  /** A JPEG/PNG data URL shown with the message (the grade's stills). */
  image?: string
  maxTokens: number
  temperature: number
  /** Which call this is (the fake model in tests answers by it). */
  purpose: 'write' | 'grade' | 'fill' | 'world' | 'plan' | 'scenes'
  signal?: AbortSignal
}
export interface ModelReply { text: string; costUsd: number }
export type ModelCall = (request: ModelRequest) => Promise<ModelReply>

/** The member's model through OpenRouter (their key). The system prompt is marked cacheable: it is the same for every moment. */
export function openRouterModelCall(key: string, endpoint: string, price: { input: number; output: number }, fetchImpl: typeof fetch = fetch): ModelCall {
  const once = openRouterModelCallOnce(key, endpoint, price, fetchImpl)
  // A dropped connection, an answer cut off mid-way or a busy server is tried once more after a short wait (a real run
  // lost every scene to one unreadable answer). A rejected key, missing credits or a cancel are not.
  return async (request) => {
    try { return await once(request) } catch (error) {
      const message = String((error as Error)?.message ?? error)
      if (request.signal?.aborted || /rejected the API key|insufficient credits|Canceled/.test(message)) throw error
      logger.info('custom.call.retry', { purpose: request.purpose, message: plainForLog(message) })
      await new Promise((r) => setTimeout(r, 4000))
      return once(request)
    }
  }
}

/** How long one answer may take: a long composition from a model that thinks first takes minutes (about 40 tokens a second). */
export function callTimeoutMs(maxTokens: number): number {
  return Math.max(180_000, Math.round(maxTokens / 40) * 1000 + 90_000)
}

function openRouterModelCallOnce(key: string, endpoint: string, price: { input: number; output: number }, fetchImpl: typeof fetch): ModelCall {
  return async (request) => {
    const user = request.image ? [{ type: 'image_url', image_url: { url: request.image } }, { type: 'text', text: request.user }] : request.user
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(callTimeoutMs(request.maxTokens))]) : AbortSignal.timeout(callTimeoutMs(request.maxTokens)),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/trentrichards34/bridgeclip', 'X-Title': 'CreatorClips' },
        body: JSON.stringify({ model: request.model, max_tokens: request.maxTokens, temperature: request.temperature, usage: { include: true },
          messages: [{ role: 'system', content: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }] }, { role: 'user', content: user }] })
      })
    } catch (error) {
      if (request.signal?.aborted) throw new Error('Canceled.')
      throw new Error(`OpenRouter could not be reached (${String((error as Error)?.message ?? error).slice(0, 80)}).`)
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('OpenRouter rejected the API key. Check it in Settings → API keys.')
      if (response.status === 402) throw new Error('OpenRouter reports insufficient credits.')
      if (response.status === 429) throw new Error('OpenRouter is busy. Try again shortly.')
      throw new Error(`OpenRouter could not design the graphic (${response.status}).`)
    }
    let body: { choices?: { message?: { content?: unknown } }[]; usage?: unknown }
    try { body = JSON.parse(await readResponseText(response, MAX_REPLY_BYTES, 'OpenRouter returned too much data.')) } catch { throw new Error('OpenRouter returned an unreadable answer.') }
    const content = body.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('') : ''
    return { text, costUsd: callCost(body.usage, price) }
  }
}

// ---------------------------------------------------------------------------
// The run's custom folder
// ---------------------------------------------------------------------------

function regularFile(path: string): boolean {
  try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() } catch { return false }
}

/** The run's .graphics/custom/ folder (made when `create`; never a link). */
export function customDir(run: string, create = false): string {
  const graphics = join(run, GRAPHICS_DIR), dir = join(graphics, CUSTOM_DIR)
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const path of [graphics, dir]) if (lstatSync(path).isSymbolicLink()) throw new Error('Graphics folder is invalid')
  return dir
}

function writeAtomic(path: string, data: string | Buffer): void {
  const temporary = `${path}.tmp-${randomUUID()}`
  try { writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path) } finally { try { unlinkSync(temporary) } catch { /* moved */ } }
}

export const compositionId = (html: string): string => createHash('sha256').update(html, 'utf8').digest('hex').slice(0, 16)

/** A kept composition and what it is, checked: its name must be its hash and it must still pass the static check. Null when missing or tampered with. */
export function readCustomGraphic(run: string, comp: unknown): { html: string; meta: CustomMeta } | null {
  if (!isCustomComp(comp)) return null
  let dir: string
  try { dir = customDir(run) } catch { return null }
  const htmlPath = join(dir, `${comp}.html`), metaPath = join(dir, `${comp}.json`)
  if (!regularFile(htmlPath) || !regularFile(metaPath) || statSync(htmlPath).size > MAX_COMPOSITION_CHARS * 4 || statSync(metaPath).size > 200_000) return null
  const html = readFileSync(htmlPath, 'utf8')
  if (compositionId(html) !== comp) return null
  let meta: CustomMeta | null
  try { meta = parseCustomMeta(JSON.parse(readFileSync(metaPath, 'utf8'))) } catch { return null }
  if (!meta || meta.comp !== comp) return null
  if (checkComposition(html, { width: meta.width, height: meta.height, durationMs: meta.durationMs }).length) return null
  return { html, meta }
}

/** The stills' paths for a kept composition (the ones that are there). */
export function customStillPaths(run: string, comp: string): string[] {
  if (!isCustomComp(comp)) return []
  let dir: string
  try { dir = customDir(run) } catch { return [] }
  return customStillNames(comp).map((name) => join(dir, name)).filter(regularFile)
}

function saveCustomGraphic(run: string, html: string, meta: CustomMeta, stills: Buffer[], review: Buffer): void {
  const dir = customDir(run, true)
  writeAtomic(join(dir, `${meta.comp}.html`), html)
  customStillNames(meta.comp).forEach((name, i) => { if (stills[i]) writeAtomic(join(dir, name), stills[i]) })
  writeAtomic(join(dir, `${meta.comp}-review.jpg`), review)
  writeAtomic(join(dir, `${meta.comp}.json`), JSON.stringify(meta, null, 1))
}

// ---------------------------------------------------------------------------
// One graphic: write, look, revise
// ---------------------------------------------------------------------------

export interface ProduceInput {
  run: string
  brief: WriterBrief
  /** The moment's words in one line (for the grade and the meta). */
  words: string
  said: SaidIndex
  /** The video frame at the moment (data URL), drawn behind the graded stills. */
  frame: string | null
  logo?: string | null
  fallback: CustomFallback | null
  model: string
  maxRevisions: number
  /** Grade the stills with the model (it can see pictures); false: only our own checks decide. */
  grade?: boolean
  /** Use this library graphic (the member picked it): filled with these words, or nothing. */
  libraryItem?: string
}

export interface ProduceResult {
  meta: CustomMeta | null
  /** The library graphic it was made from (filled with these words), if any. */
  library?: string
  costUsd: number
  tries: number
  /** Why none was kept (the last problems), when none was. */
  reason?: string
}

/** One try: its final grade (our checks and the motion check folded in), and what decided it. */
interface Attempt {
  html: string; grade: CustomGrade; stills: Buffer[]; review: Buffer
  /** Flat stretches found by the motion check (fixes for the writer). */
  flat: FlatStretch[]
  /** Only the motion check failed it (the grade and our hard checks passed): kept when no try passes outright. */
  motionOnly: boolean
  /** Our own checks all passed (words said, nothing clipped, readable sizes, never frozen), whatever the grade said. */
  clean: boolean
}
/**
 * The best try: one the grade passed and our checks passed, then one our checks passed (the grade is advice: a real
 * run's grade failed all ten designs and none reached the reel), then one that only failed the motion check, each by score.
 */
const attemptRank = (a: Attempt): number => (a.grade.pass && a.clean ? 3 : a.clean ? 2 : a.motionOnly ? 1 : 0) * 100 + a.grade.score
/** A try our own checks pass with this grade (or more) is kept without another revision (see the loop). */
export const GOOD_ENOUGH_SCORE = 6
/** The writer's room to answer (it thinks first, and its thinking counts): a pop-up, and a scene or an Explainer section (about twice the composition). */
export const WRITER_MAX_TOKENS = 16000
export const SCENE_WRITER_MAX_TOKENS = 24000

/** My motion library, as the producer uses it (motion-library.ts; tests pass their own). */
export interface LibraryHooks {
  /** The best library graphic for a moment, or null. */
  match: (kind: HeroKind, frame: CustomFrameKind, durationMs: number) => { item: LibraryItem; template: string } | null
  /** One library graphic by id (the member picked it in the gallery). */
  get: (id: string) => { item: LibraryItem; template: string } | null
  keep: (input: Parameters<typeof keepInLibrary>[0]) => void
  used: (id: string, runId: string) => void
}

/**
 * One custom graphic: first a library graphic filled with the new words (when one fits), else written, rendered,
 * graded and revised. A new one that passes joins the library; one that never passes is kept there as Retired.
 * Never throws for a bad composition: it returns no meta.
 */
export async function produceCustomGraphic(input: ProduceInput, deps: { call: ModelCall; sandbox?: CustomSandbox; signal?: AbortSignal; onTry?: (n: number) => void; library?: LibraryHooks }): Promise<ProduceResult> {
  const sandbox = deps.sandbox ?? customSandbox()
  const { brief } = input
  const expect = { width: brief.geometry.root.width, height: brief.geometry.root.height, durationMs: brief.durationMs }
  const times = brief.frame === 'explainer' ? explainerStillTimes(brief.durationMs) : brief.scene ? sceneStillTimes(brief.durationMs) : stillTimes(brief.durationMs, brief.cues.filter((c) => c.at >= 0).map((c) => c.at * 1000))
  const runId = basename(input.run)
  const moment = `${brief.kind}-${Math.round((brief.cues[0]?.at ?? 0) * 1000)}-${compositionId(input.words).slice(0, 6)}`
  let costUsd = 0, tries = 0
  let best: Attempt | null = null
  let reason = ''
  const keep = (attempt: Attempt): void => { if (!best || attemptRank(attempt) > attemptRank(best)) best = attempt }
  /** Render the stills, run our checks and the grade. Null when it couldn't be drawn (`reason` says why). */
  const look = async (html: string): Promise<Attempt | null> => {
    let shot
    try {
      shot = await sandbox.stills({ html, geometry: brief.geometry, look: brief.look, durationMs: brief.durationMs, times, frame: input.frame, logo: input.logo ?? null, scale: STILL_SCALE, motionStepMs: MOTION_STEP_MS })
    } catch (error) {
      reason = String((error as Error)?.message ?? error).slice(0, 200)
      logger.info('custom.render.failed', { message: plainForLog(reason) })
      keepAttempt(input.run, moment, tries, html, { stage: 'render', reason })
      return null
    }
    const unsaid = unsaidOnScreen(shot.texts, input.said)
    const machine = [...shot.problems, ...(unsaid.length ? [`These words or numbers on screen were not said: ${unsaid.map((w) => `“${w}”`).join(', ')}. Use only words and numbers from the transcript.`] : [])]
    // The motion check: nothing frozen for more than 1.5 s while it is on screen.
    const flat = shot.motion ? flatStretches(shot.motion.change, shot.motion.visible) : []
    const still = motionFixes(flat, brief.cues)
    let grade: CustomGrade = { pass: true, score: 7, failed: [], fixes: [] }
    if (input.grade !== false) {
      // A grade the model couldn't put into words is asked once more; still unreadable, our own checks decide alone.
      // (Two real runs had all ten Opus designs rejected because every grade came back unreadable: the answer ran out
      // of room at 700 tokens on a model that thinks first.)
      const userPrompt = graderUserPrompt({ words: input.words, kind: brief.kind, frame: brief.frame, machine: [...machine, ...still], world: brief.world ?? null, stressed: brief.stressed,
        ...(brief.explainer ? { explainer: brief.explainer.grade } : brief.scene ? { explainer: brief.scene.grade } : {}), ...(brief.look.theme ? { theme: brief.look.theme } : {}) })
      let unread = true
      for (let ask = 0; ask < 2 && unread; ask++) {
        const graded = await deps.call({ model: input.model, system: graderSystemPrompt(), user: ask ? `${userPrompt}\n\nAnswer with the JSON object only, nothing before or after it.` : userPrompt,
          image: `data:image/jpeg;base64,${shot.composite.toString('base64')}`, maxTokens: GRADE_MAX_TOKENS, temperature: 0, purpose: 'grade', signal: deps.signal })
        costUsd += graded.costUsd
        if (gradeReadable(graded.text)) { grade = parseGrade(graded.text); unread = false }
        else logger.info('custom.grade.unreadable', { chars: graded.text.length, ask })
      }
      if (unread) grade = { pass: true, score: 7, failed: [], fixes: [] }
    }
    // Our own checks are hard rules: any of them fails the graphic, whatever the grade says. The motion check sends it
    // back to be revised too, but a try that only fails it can still be kept when no other try passes.
    let final: CustomGrade = grade
    if (machine.length) final = { pass: false, score: Math.min(grade.score, 6), failed: [...new Set([...grade.failed, ...(unsaid.length ? ['words' as const] : []), ...(shot.problems.length ? ['clipped' as const] : []), ...(still.length ? ['builds' as const] : [])])], fixes: [...machine, ...still, ...grade.fixes].slice(0, 8) }
    else if (still.length) final = { pass: false, score: Math.min(grade.score, 7), failed: [...new Set([...grade.failed, 'builds' as const])], fixes: [...still, ...grade.fixes].slice(0, 8) }
    if (!final.pass) reason = final.fixes.join(' ')
    keepAttempt(input.run, moment, tries, html, { stage: 'grade', pass: final.pass, grader: grade, machine, motion: still, final }, shot.composite)
    return { html, grade: final, stills: shot.transparent, review: shot.composite, flat, motionOnly: !machine.length && !!still.length && grade.pass, clean: !machine.length && !still.length }
  }

  // My motion library first: a graphic of this kind, filled with the new words (a small call), when one fits.
  let fromLibrary: string | null = null
  // A note asks for a change: it is designed again, not filled from the library.
  const reuse = deps.library && (!brief.note || input.libraryItem) ? (input.libraryItem ? deps.library.get(input.libraryItem) : deps.library.match(brief.kind, brief.frame, brief.durationMs)) : null
  if (reuse) {
    const reply = await deps.call({ model: input.model, system: fillSystemPrompt(), user: fillUserPrompt(reuse.item, { words: input.words, before: brief.before, after: brief.after, note: brief.note }),
      maxTokens: SMALL_MAX_TOKENS, temperature: 0, purpose: 'fill', signal: deps.signal })
    costUsd += reply.costUsd
    const fill = parseFill(reply.text, reuse.item.slots)
    let html = ''
    if (fill.fits) { try { html = fillTemplate(reuse.template, fill.values, brief.durationMs) } catch { html = '' } }
    if (html && !checkComposition(html, expect).length) {
      tries++
      deps.onTry?.(tries)
      const attempt = await look(html)
      if (attempt?.grade.pass) { best = attempt; fromLibrary = reuse.item.id }
    } else reason = 'Your library graphic doesn’t fit what is said here.'
    if (!fromLibrary && input.libraryItem) return { meta: null, costUsd, tries, reason: reason || 'Your library graphic doesn’t fit what is said here.' }
  }

  if (!fromLibrary) {
    const system = writerSystemPrompt()
    let previous: { html: string; fixes: string[] } | undefined
    for (let attempt = 0; attempt <= input.maxRevisions; attempt++) {
      if (deps.signal?.aborted) throw new Error('Canceled.')
      tries++
      deps.onTry?.(tries)
      const reply = await deps.call({ model: input.model, system, user: writerUserPrompt(brief, previous), maxTokens: brief.frame === 'explainer' || brief.scene ? SCENE_WRITER_MAX_TOKENS : WRITER_MAX_TOKENS, temperature: attempt ? 0.4 : 0.7, purpose: 'write', signal: deps.signal })
      costUsd += reply.costUsd
      const html = extractComposition(reply.text)
      const problems = checkComposition(html, expect)
      if (problems.length) {
        // An answer that ran out of room (no closing script) is a cut-off composition, not a broken one: say so.
        if (html && !/<\/script>\s*$/i.test(html.trim())) problems.unshift('Your answer was cut off before its end: write a tighter composition (fewer elements, shorter CSS) and finish with </script>.')
        reason = problems.join(' ')
        keepAttempt(input.run, moment, tries, html, { stage: 'composition', problems })
        logger.info('custom.rejected', { problems: plainForLog(problems.slice(0, 4).join(' | ')) })
        previous = { html: html.slice(0, MAX_COMPOSITION_CHARS), fixes: problems }
        continue
      }
      const current = await look(html)
      if (!current) { previous = { html, fixes: [reason, 'Keep the script simple: build the timeline once, no loops that run long, fewer elements.'] }; continue }
      keep(current)
      // Good enough to stop early: the grade passed, or our own checks passed and the grade gave it GOOD_ENOUGH_SCORE.
      // Calibrated on a real run the owner approved (edit-751a0a07, 11 graphics, 33 tries, grades 3-6, none passing):
      // stopping there ships the same 11 graphics; stopping at 5 would have shipped a visibly weaker try of one.
      if (current.grade.pass || (current.clean && current.grade.score >= GOOD_ENOUGH_SCORE)) break
      previous = { html, fixes: current.grade.fixes }
    }
  }
  let kept = best as Attempt | null
  // Only the motion check failed every try: the best is kept (it passed the review and our hard checks), its flat stretches noted.
  if (kept && !kept.grade.pass && kept.motionOnly) kept = { ...kept, grade: { ...kept.grade, pass: true, score: Math.max(7, kept.grade.score) } }
  // The grade is advice, not a veto: after every try, the best one our own checks passed ships even when the grade
  // stayed under 7 (its grade is kept as it was). Only our checks failing on every try falls back to the template.
  const advisory = !!kept && !kept.grade.pass && kept.clean
  if (advisory) logger.info('custom.kept.belowGrade', { tries, score: kept!.grade.score, failed: kept!.grade.failed.join(',') })
  if (!kept || (!kept.grade.pass && !advisory)) {
    logger.info('custom.fallback', { tries, reason: plainForLog(reason) })
    // The best try is kept in the library as Retired, with the check's reason (never offered again).
    if (kept && deps.library) deps.library.keep({ id: compositionId(kept.html), html: kept.html, kind: brief.kind, frame: brief.frame, width: expect.width, height: expect.height, durationMs: brief.durationMs,
      idea: customIdea(brief.kind, brief.frame), runId, stills: [], stillData: kept.stills, status: 'retired', reason: reason || 'It did not pass the review.' })
    return { meta: null, costUsd, tries, reason: reason || 'It did not pass the review.' }
  }
  const meta: CustomMeta = {
    comp: compositionId(kept.html), kind: brief.kind, frame: brief.frame, width: expect.width, height: expect.height, durationMs: brief.durationMs, words: input.words.slice(0, 2000),
    idea: customIdea(brief.kind, brief.frame), model: input.model, tries, grade: kept.grade, ...(brief.note ? { note: brief.note } : {}), fallback: input.fallback, look: brief.look,
    costUsd: Math.round(costUsd * 10000) / 10000, createdAt: new Date().toISOString(), ...(fromLibrary ? { library: fromLibrary } : {}),
    flat: kept.flat.slice(0, 8), ...(brief.stressed?.length ? { builds: brief.stressed.length } : {})
  }
  saveCustomGraphic(input.run, kept.html, meta, kept.stills, kept.review)
  if (deps.library) {
    if (fromLibrary) deps.library.used(fromLibrary, runId)
    else if (advisory) {
      // In the reel, but not offered again from the library: only graphics the grade passed are.
      deps.library.keep({ id: meta.comp, html: kept.html, kind: brief.kind, frame: brief.frame, width: expect.width, height: expect.height, durationMs: brief.durationMs, idea: meta.idea, runId,
        stills: [], stillData: kept.stills, status: 'retired', reason: `Used below the grade (${kept.grade.score}/10): ${kept.grade.fixes.slice(0, 2).join(' ')}`.slice(0, 400) })
    } else {
      const dir = customDir(input.run)
      deps.library.keep({ id: meta.comp, html: kept.html, kind: brief.kind, frame: brief.frame, width: expect.width, height: expect.height, durationMs: brief.durationMs, idea: meta.idea, runId,
        stills: customStillNames(meta.comp).map((name) => join(dir, name)), status: 'active' })
    }
  }
  return { meta, costUsd, tries, ...(fromLibrary ? { library: fromLibrary } : {}) }
}

// ---------------------------------------------------------------------------
// The video's visual world (one call, before the hero graphics)
// ---------------------------------------------------------------------------

const WORLD_FILE = 'world.json'

/** The run's saved world, or null. */
export function readVisualWorld(run: string): VisualWorld | null {
  try {
    const path = join(customDir(run), WORLD_FILE)
    if (!regularFile(path) || statSync(path).size > 20_000) return null
    return parseWorld(JSON.parse(readFileSync(path, 'utf8')))
  } catch { return null }
}

/** Save the run's world (null removes nothing: a world is always replaced, never cleared). */
export function saveVisualWorld(run: string, world: VisualWorld): void {
  writeAtomic(join(customDir(run, true), WORLD_FILE), JSON.stringify(world, null, 1))
}

/** Propose the video's world from its transcript and the moments that get a graphic. Null when the answer is unusable (the graphics are designed without one). */
export async function proposeVisualWorld(input: { transcript: string; moments: { kind: HeroKind; words: string }[]; model: string; note?: string }, deps: { call: ModelCall; signal?: AbortSignal }): Promise<{ world: VisualWorld | null; costUsd: number }> {
  try {
    const reply = await deps.call({ model: input.model, system: worldSystemPrompt(), user: worldUserPrompt(input), maxTokens: SMALL_MAX_TOKENS, temperature: 0.6, purpose: 'world', signal: deps.signal })
    return { world: parseWorld(reply.text), costUsd: reply.costUsd }
  } catch (error) {
    if (deps.signal?.aborted) throw error
    logger.info('custom.world.failed', { message: String((error as Error)?.message ?? error).slice(0, 200) })
    return { world: null, costUsd: 0 }
  }
}

/** The member's library as the producer uses it (motion-library.ts). */
export const memberLibrary: LibraryHooks = {
  match: libraryMatch, get: readLibraryTemplate, keep: keepInLibrary, used: noteLibraryUse
}

/** Run `work` over `items`, `limit` at a time, in order of results. */
export async function inBatches<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(items[i], i) }
  }))
  return out
}

// ---------------------------------------------------------------------------
// The bake: a custom graphic's scene for the sandbox
// ---------------------------------------------------------------------------

/** What the sandbox draws for a kept composition in a band (frame pixels), lasting `durationMs` on the finished clip. */
export function bakeScene(found: { html: string; meta: CustomMeta }, frame: { width: number; height: number; aspect: '9:16' | '16:9' }, band: { x: number; y: number; width: number; height: number }, durationMs: number, backdrop?: string | null): import('./custom-render').CustomScene {
  const { meta } = found
  const scale = Math.min(1, band.width / meta.width, band.height / meta.height)
  const place = { x: Math.round(band.x + (band.width - meta.width * scale) / 2), y: Math.round(band.y + (band.height - meta.height * scale) / 2), scale: Math.round(scale * 10000) / 10000 }
  const geometry: CustomGeometry = { kind: meta.frame, aspect: frame.aspect, width: frame.width, height: frame.height, root: { x: place.x, y: place.y, width: meta.width, height: meta.height }, face: null, card: null }
  return { html: found.html, geometry, look: meta.look as CustomLook, durationMs, place, ...(backdrop ? { backdrop } : {}), timeScale: durationMs > 0 ? meta.durationMs / durationMs : 1 }
}

// ---------------------------------------------------------------------------
// End-to-end tests only (never in a packaged app): the sandbox and the loop, for the test's main-process evaluate.
// ---------------------------------------------------------------------------

export function installCustomGraphicsTestHook(): void {
  const hook = {
    shared: { customGeometry, customLook, stillTimes, checkComposition, stressedWords, flatStretches },
    async stills(request: import('./custom-render').StillsRequest) {
      const result = await customSandbox().stills(request)
      return { transparent: result.transparent.map((b) => b.toString('base64')), composite: result.composite.toString('base64'), texts: result.texts, problems: result.problems, ...(result.motion ? { motion: result.motion } : {}) }
    },
    async bake(scene: import('./custom-render').CustomScene, out: string) { await customSandbox().bake(scene, out) },
    async produce(input: Omit<ProduceInput, 'said'> & { said: TimedWord[] }, endpoint: string) {
      const call = openRouterModelCall('sk-or-test', endpoint, DEFAULT_PRICE)
      return produceCustomGraphic({ ...input, said: saidIndex(input.said) }, { call })
    },
    async world(input: { transcript: string; moments: { kind: HeroKind; words: string }[]; model: string }, endpoint: string) {
      return proposeVisualWorld(input, { call: openRouterModelCall('sk-or-test', endpoint, DEFAULT_PRICE) })
    },
    /** The scene plan of a reel's words for a Scenes choice: the plan call, checked, and the scenes it places. */
    async scenes(input: { words: SceneWord[]; endMs: number; amount: SceneAmount; model: string }, endpoint: string) {
      const stretches = reelStretches(input.words, input.endMs)
      const result = await planScenes({ model: input.model, theme: 'dark', stretches, said: saidIndex(input.words), amount: input.amount }, openRouterModelCall('sk-or-test', endpoint, DEFAULT_PRICE))
      const plan = usablePlan(result.plan, stretches, input.amount)
      return { fromModel: !!result.plan, stretches: stretches.length, picked: plan.stretches.flatMap((s, i) => s.scene ? [i] : []), scenes: plannedScenes(stretches, plan, input.words, input.endMs).map((s) => ({ atMs: s.atMs, durationMs: s.durationMs })) }
    },
    read: readCustomGraphic
  }
  ;(globalThis as Record<string, unknown>).__bridgeclipCustomGraphics = hook
}

// ---------------------------------------------------------------------------
// The bake's provider (graphics-render.ts): a custom graphic's job and its frames
// ---------------------------------------------------------------------------

/** A custom graphic's render job: its composition read back from the run, cached by what changes its pixels. */
export function customGraphicJob(run: string, id: string, spec: GraphicRenderSpec, window: { start_ms: number; duration_ms: number }): GraphicJob | null {
  const found = readCustomGraphic(run, spec.fields.comp)
  if (!found) return null
  const key = createHash('sha256').update(JSON.stringify({ v: 'custom-1', comp: found.meta.comp, w: spec.width, h: spec.height, box: spec.box, ms: spec.duration_ms, backdrop: spec.backdrop?.color ?? null })).digest('hex')
  return { id, spec, key, start_ms: window.start_ms, duration_ms: window.duration_ms, custom: found }
}

export function customGraphicBake(job: GraphicJob, out: string, cancelled: () => boolean): Promise<void> {
  if (!job.custom) throw new Error('Not a custom graphic')
  const { spec } = job
  const band = { x: Math.round((spec.box.left ?? 0) * spec.width), y: Math.round(spec.box.top * spec.height), width: Math.round(((spec.box.right ?? 1) - (spec.box.left ?? 0)) * spec.width), height: Math.round((spec.box.bottom - spec.box.top) * spec.height) }
  const scene = bakeScene(job.custom, { width: spec.width, height: spec.height, aspect: spec.width > spec.height ? '16:9' : '9:16' }, band, spec.duration_ms, spec.backdrop?.color ?? null)
  return customSandbox().bake(scene, out, cancelled)
}

// ---------------------------------------------------------------------------
// The member's model for custom graphics
// ---------------------------------------------------------------------------

export interface CustomModel { model: string; price: { input: number; output: number }; vision: boolean; key: string; endpoint: string }

/**
 * The model custom graphics are designed with: the member's planning model (Create's Advanced choice, else the
 * quality default), its list price and whether it can see pictures (from the OpenRouter catalog when it loads in a
 * few seconds; else a frontier model's price, and seeing assumed). Null without an OpenRouter key.
 */
export async function customModel(): Promise<CustomModel | null> {
  const key = loadSettings().openrouterApiKey
  if (!key) return null
  let model = DEFAULT_PLANNER_MODEL
  try { const create = readMemberPrefs().create; model = plannerModelFor(create.clippingMode, create.plannerModel) } catch { /* the default */ }
  let price: { input: number; output: number } = { ...DEFAULT_PRICE }, vision = true
  try {
    const catalog = await Promise.race([getModelCatalog(false), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow')), 4000))])
    const entry = catalog.planning.find((m) => m.id === model)
    if (entry) {
      if (entry.inputPrice !== null && entry.outputPrice !== null && entry.inputPrice >= 0 && entry.outputPrice >= 0) price = { input: entry.inputPrice, output: entry.outputPrice }
      vision = entry.supportsImages
    }
  } catch { /* list prices */ }
  const endpoint = app.isPackaged ? OPENROUTER_CHAT : process.env.BRIDGECLIP_E2E_OPENROUTER_URL || OPENROUTER_CHAT
  return { model, price, vision, key, endpoint }
}
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions'
/**
 * Every try is kept next to the run (.graphics/custom/attempts): the composition, what the checks said and the review
 * sheet the grader saw. Two real runs had every Opus design rejected and nothing to look at afterwards.
 */
export function keepAttempt(run: string, moment: string, n: number, html: string, info: Record<string, unknown>, review?: Buffer | null): void {
  try {
    const dir = join(run, '.graphics', 'custom', 'attempts', `${moment.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'moment'}-${n}`)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, 'composition.html'), html.slice(0, MAX_COMPOSITION_CHARS * 2), { mode: 0o600 })
    writeFileSync(join(dir, 'check.json'), JSON.stringify({ ...info, at: new Date().toISOString() }, null, 2), { mode: 0o600 })
    if (review?.length) writeFileSync(join(dir, 'review.jpg'), review, { mode: 0o600 })
  } catch { /* the run goes on without it */ }
}
/** Room for an answer from a model that thinks before it answers (its thinking counts against max_tokens). */
const GRADE_MAX_TOKENS = 4000
const SMALL_MAX_TOKENS = 3000
/** A grade answer with a JSON object in it (parseGrade's own reading). */
export function gradeReadable(text: string): boolean {
  const body = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text
  const start = body.indexOf('{'), end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return false
  try { const raw = JSON.parse(body.slice(start, end + 1)) as unknown; return !!raw && typeof raw === 'object' && 'pass' in (raw as object) } catch { return false }
}
/** A check's words as the log keeps them (it leaves out any value with a slash, a link or a line break). */
export function plainForLog(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '(link)').replace(/[\\/]/g, ' ').replace(/[\r\n]+/g, ' ').replace(/(token|secret|key)\s*[:=]/gi, '$1 ').slice(0, 160)
}
