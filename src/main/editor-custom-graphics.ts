/**
 * Custom graphics in the clip editor: what one is (its idea, grade, stills, the template it replaced) and making it
 * again with the member's note ("use a rocket instead") through the same loop. The editor's own save keeps the new
 * `comp`; the bake re-draws it from the run's cached composition.
 */
import { readFileSync, realpathSync } from 'fs'
import { join } from 'path'
import {
  CUSTOM_MIN_MS, DEFAULT_PRICE, DEFAULT_THEME, MAX_NOTE_CHARS, REEL_HERO_MAX_MS, REEL_HERO_MIN_MS, customDesignEstimate, customIdea, customLook, designKindFor, heroFrame, isCustomComp, isTheme, revisionCap, saidIndex, stressedWords, worldLine,
  type CustomFrameKind, type CustomGeometry, type CustomLook, type CustomTheme, type EditorCustomInfo, type EditorCustomRemake, type EditorDesignInfo, type HeroKind, type SaidIndex, type VisualWorld, type WriterBrief
} from '../shared/custom-graphics'
import type { CandidateEdit, EditorProject } from '../shared/clip-editor'
import { readLibraryTemplate } from './motion-library'
import { graphicSpec } from '../shared/graphic-layout'
import { graphicsCap, newGraphic, parseGraphics, type EditorGraphic } from '../shared/motion-graphics'
import { STAGE_LAYOUT } from '../shared/scenes'
import { openEditor } from './clip-editor'
import { readChatTranscript } from './clip-chat'
import {
  customModel, customStillPaths, memberLibrary, openRouterModelCall, produceCustomGraphic, proposeVisualWorld, readCustomGraphic, readCustomTheme, readVisualWorld, saveCustomTheme, saveVisualWorld,
  type CustomModel, type LibraryHooks, type ModelCall
} from './custom-graphics'
import type { CustomSandbox } from './custom-render'
import { beatFrame } from './beat-stills'
import { authorizeMedia } from './security'


async function editorRun(path: unknown): Promise<{ run: string; session: Awaited<ReturnType<typeof openEditor>> }> {
  const session = await openEditor(path)
  return { run: realpathSync(path as string), session }
}

export async function editorCustomInfo(path: unknown, comp: unknown): Promise<EditorCustomInfo> {
  const { run } = await editorRun(path)
  if (!isCustomComp(comp)) throw new Error('That custom graphic could not be read.')
  const found = readCustomGraphic(run, comp)
  if (!found) throw new Error('That custom graphic could not be read. Swap it back to its template.')
  const m = found.meta
  return { comp: m.comp, idea: m.idea, kind: m.kind, frame: m.frame, score: m.grade.score, tries: m.tries, note: m.note ?? null, costUsd: m.costUsd, fallback: m.fallback,
    stills: customStillPaths(run, m.comp).map((p) => authorizeMedia(p)) }
}

/** The spending check's estimate for making one again (a write and a grade, with a revision). */
export const EDITOR_REMAKE_ESTIMATE_USD = 0.35

/** Make one custom graphic again with the member's note. Returns the graphic with its new composition, and what it cost. */
/** What the producer needs for a custom graphic `g` on an editor clip (its band, words, frame). */
async function editorBrief(run: string, session: Awaited<ReturnType<typeof openEditor>>, candidate: CandidateEdit, g: EditorGraphic, design: { kind: HeroKind; frame: CustomFrameKind; look: CustomLook; note?: string; planned: string
  /** A new design at a spot: only the words heard in the clip's cut count, the graphic may show only the words said in its moment, and it builds on the stressed ones inside the video's world. */
  strict?: { world: VisualWorld | null } }): Promise<{ brief: WriterBrief; frame: string | null; said: SaidIndex; words: string }> {
  const spec = graphicSpec(session.project, { ...candidate, graphics: [...(candidate.graphics ?? []).filter((x) => x.id !== g.id), g] }, g)
  if (!spec) throw new Error('That graphic is outside the clip’s cut.')
  const W = spec.width, H = spec.height
  const root = { x: Math.round((spec.box.left ?? 0) * W), y: Math.round(spec.box.top * H), width: Math.round(((spec.box.right ?? 1) - (spec.box.left ?? 0)) * W), height: Math.round((spec.box.bottom - spec.box.top) * H) }
  const cardH = Math.round(STAGE_LAYOUT.cardHeight * H)
  const geometry: CustomGeometry = { kind: design.frame, aspect: W > H ? '16:9' : '9:16', width: W, height: H, root, face: null,
    card: design.frame === 'stage' && H > W ? { x: Math.round(STAGE_LAYOUT.cardSide * W), y: H - Math.round(STAGE_LAYOUT.cardBottom * H) - cardH, width: W - 2 * Math.round(STAGE_LAYOUT.cardSide * W), height: cardH } : null }
  const transcript = (await readChatTranscript(run, 0, Math.max(session.project.duration_ms, g.at_ms + g.duration_ms) + 1000) ?? []).flatMap((s) => s.words.map((w) => ({ word: w.word, start_ms: w.start_ms, end_ms: w.end_ms })))
  const all = design.strict ? transcript.filter((w) => inCut(candidate, w.start_ms)) : transcript
  const inside = all.filter((w) => w.start_ms >= g.at_ms - 1200 && w.start_ms < g.at_ms + g.duration_ms)
  const cues = inside.map((w) => ({ word: w.word, at: Math.round((w.start_ms - g.at_ms) / 10) / 100 }))
  const brief: WriterBrief = {
    kind: design.kind, frame: design.frame, durationMs: spec.duration_ms, geometry, look: design.look, ...(design.note ? { note: design.note } : {}),
    ...(design.strict ? { stressed: stressedWords(cues, spec.duration_ms), ...(design.strict.world ? { world: design.strict.world } : {}) } : {}),
    cues,
    before: all.filter((w) => w.start_ms >= g.at_ms - 9000 && w.start_ms < g.at_ms - 1200).map((w) => w.word).join(' '),
    after: all.filter((w) => w.start_ms >= g.at_ms + g.duration_ms && w.start_ms < g.at_ms + g.duration_ms + 5000).map((w) => w.word).join(' '),
    planned: design.planned
  }
  let frame: string | null = null
  if (session.sourcePath) {
    try {
      const at = Math.round(g.at_ms + g.duration_ms * .55)
      frame = `data:image/jpeg;base64,${readFileSync(await beatFrame(join(run, '.graphics', 'frames'), session.sourcePath, at)).toString('base64')}`
    } catch { frame = null }
  }
  // A new design may show only the words said in its moment (the cues it is given), never others from the video.
  return { brief, frame, said: saidIndex(design.strict ? inside : all), words: inside.filter((w) => w.start_ms >= g.at_ms - 200).map((w) => w.word).join(' ') }
}

/** A source time is inside the clip's cut. */
const inCut = (candidate: Pick<CandidateEdit, 'ranges'>, ms: number): boolean => candidate.ranges.some(([a, b]) => ms >= a && ms < b)

export async function editorRemakeCustom(path: unknown, candidateId: unknown, graphic: unknown, note: unknown): Promise<EditorCustomRemake> {
  const { run, session } = await editorRun(path)
  if (typeof candidateId !== 'string') throw new Error('Choose a clip.')
  const candidate = session.project.candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new Error('That clip is no longer in the editor.')
  const [g] = parseGraphics([graphic])
  if (!g || g.template !== 'custom') throw new Error('Choose a custom graphic.')
  const text = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS) : ''
  if (!text) throw new Error('Type what to change.')
  const found = readCustomGraphic(run, g.fields.comp)
  if (!found) throw new Error('That custom graphic could not be read. Swap it back to its template.')
  const m = await customModel()
  if (!m) throw new Error('Add your OpenRouter key in Settings → API keys to design custom graphics.')
  const made = await editorBrief(run, session, candidate, g, { kind: found.meta.kind, frame: found.meta.frame, look: found.meta.look, note: text,
    planned: found.meta.fallback ? `${found.meta.fallback.template}: ${Object.values(found.meta.fallback.fields).join(' · ').slice(0, 200)}` : '(none)' })
  const result = await produceCustomGraphic({ run, brief: made.brief, words: made.words, said: made.said, frame: made.frame, fallback: found.meta.fallback,
    model: m.model, maxRevisions: 1, grade: m.vision }, { call: openRouterModelCall(m.key, m.endpoint, m.price), library: memberLibrary })
  if (!result.meta) return { graphic: null, costUsd: result.costUsd, reason: 'The new design didn’t pass the check, so your graphic stays as it was.' }
  return { graphic: { ...g, fields: { ...g.fields, comp: result.meta.comp, idea: result.meta.idea } }, costUsd: result.costUsd, reason: null }
}

/** The spending check's estimate for filling one library graphic (a small fill call and a grade). */
export const LIBRARY_ADD_ESTIMATE_USD = 0.06

/** One of My motion library's graphics at `atMs` on a clip, filled with the words said there. */
export async function editorAddLibraryGraphic(path: unknown, candidateId: unknown, itemId: unknown, atMs: unknown): Promise<EditorCustomRemake> {
  const { run, session } = await editorRun(path)
  if (typeof candidateId !== 'string') throw new Error('Choose a clip.')
  const candidate = session.project.candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new Error('That clip is no longer in the editor.')
  if (typeof itemId !== 'string' || typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0) throw new Error('Choose a graphic and a time.')
  const found = readLibraryTemplate(itemId)
  if (!found || found.item.status !== 'active') throw new Error('That graphic is no longer in your library.')
  const m = await customModel()
  if (!m) throw new Error('Add your OpenRouter key in Settings → API keys to use your library graphics.')
  const taken = new Set((candidate.graphics ?? []).map((x) => x.id))
  const draft = newGraphic('custom', Math.round(atMs), { fields: { comp: '0000000000000000', idea: found.item.idea, scene: found.item.frame }, duration_ms: found.item.durationMs,
    placement: found.item.frame === 'card' ? 'bottom' : 'middle', ...(found.item.frame === 'card' ? {} : { size: 'stage' as const }), origin: 'member', taken })
  const look = customLook({ kind: found.item.frame, font: candidate.hook?.look.font ?? 'clean', brandColor: candidate.hook?.look.look === 'brand' ? candidate.hook.look.color : null })
  const made = await editorBrief(run, session, candidate, draft, { kind: found.item.kind, frame: found.item.frame, look, planned: '(a graphic from the creator’s library)' })
  const result = await produceCustomGraphic({ run, brief: made.brief, words: made.words, said: made.said, frame: made.frame, fallback: null, model: m.model, maxRevisions: 0, grade: m.vision, libraryItem: found.item.id },
    { call: openRouterModelCall(m.key, m.endpoint, m.price), library: memberLibrary })
  if (!result.meta) return { graphic: null, costUsd: result.costUsd, reason: result.reason ?? 'It didn’t fit what you say here.' }
  return { graphic: { ...draft, fields: { ...draft.fields, comp: result.meta.comp, idea: result.meta.idea } }, costUsd: result.costUsd, reason: null }
}

// ---------------------------------------------------------------------------
// A new custom graphic at the playhead, in any editor project (Clip runs, edited recordings, B-roll videos)
// ---------------------------------------------------------------------------

const NO_KEY = 'Add your OpenRouter key in Settings → API keys to design custom graphics.'

/**
 * The theme this project's custom graphics are designed in: the one kept with its first design, else the theme of a
 * custom graphic already in it (an edited recording's, designed in its review), else Dark product UI.
 */
export function editorTheme(run: string, project: Pick<EditorProject, 'candidates'>): CustomTheme {
  const kept = readCustomTheme(run)
  if (kept) return kept
  for (const c of project.candidates) {
    for (const g of c.graphics ?? []) {
      if (g.template !== 'custom') continue
      const theme = readCustomGraphic(run, g.fields.comp)?.meta.look.theme
      if (isTheme(theme)) return theme
    }
  }
  return DEFAULT_THEME
}

/** What designing a new custom graphic here costs (shown before it runs), whether it can, and the look it uses. Free. */
export async function editorDesignInfo(path: unknown, deps: { model?: CustomModel | null } = {}): Promise<EditorDesignInfo> {
  const { run, session } = await editorRun(path)
  const m = deps.model !== undefined ? deps.model : await customModel()
  const world = readVisualWorld(run)
  const estimate = customDesignEstimate(m?.price ?? DEFAULT_PRICE, !!world)
  return { available: !!m, reason: m ? null : NO_KEY, model: m?.model ?? '', expectedUsd: estimate.expectedUsd, mostUsd: estimate.mostUsd, theme: editorTheme(run, session.project), world: worldLine(world) }
}

/** The spending check's estimate for one new design (the most it can cost), or null without a key. */
export async function editorDesignEstimate(path: unknown): Promise<number | null> {
  try {
    const m = await customModel()
    if (!m) return null
    let world = false
    try { world = !!readVisualWorld(realpathSync(path as string)) } catch { world = false }
    return customDesignEstimate(m.price, world).mostUsd
  } catch { return null }
}

/** Where the playhead (source ms) is in the finished clip (ms from its start). */
function clipTime(candidate: Pick<CandidateEdit, 'ranges'>, at: number): number {
  let out = 0
  for (const [a, b] of candidate.ranges) {
    if (at >= b) { out += b - a; continue }
    if (at >= a) out += at - a
    break
  }
  return out
}

export interface DesignDeps {
  /** Stand-ins for tests: the model call, the sandbox, the library and the member's model (null: no key). */
  call?: ModelCall
  sandbox?: CustomSandbox
  library?: LibraryHooks | null
  model?: CustomModel | null
  /** Every cent it cost, for the spending ledger (also when nothing passed). */
  onSpend?: (usd: number) => void
}

/**
 * Design a new custom graphic at `atMs` (source ms) on a clip, from the words said there and the member's note
 * ("make it a rocket"), through the same loop as every custom graphic: written, drawn in the sandbox over the video,
 * graded and revised; only the words said in its moment may appear on it. It is designed in the project's theme and
 * the video's visual world (proposed and kept with the first design when the project has none). Returns the new
 * graphic to add to the clip, or why none was kept.
 */
export async function editorDesignCustom(path: unknown, candidateId: unknown, atMs: unknown, note: unknown, deps: DesignDeps = {}): Promise<EditorCustomRemake> {
  const { run, session } = await editorRun(path)
  const project = session.project
  if (project.media_freed) throw new Error('This project’s video was freed to save space. Open it again to get the video back first.')
  if (typeof candidateId !== 'string') throw new Error('Choose a clip.')
  const candidate = project.candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new Error('That clip is no longer in the editor.')
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0) throw new Error('Choose a time on the clip.')
  if (note !== undefined && note !== null && typeof note !== 'string') throw new Error('Type what you want, or leave it empty.')
  const text = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS) : ''
  const cap = graphicsCap(project)
  if ((candidate.graphics ?? []).length >= cap) throw new Error(`A clip can have up to ${cap} graphics. Remove one to add another.`)
  const at = Math.round(atMs)
  if (!inCut(candidate, at)) throw new Error('Move the playhead inside the clip’s cut to design a graphic there.')
  const m = deps.model !== undefined ? deps.model : await customModel()
  if (!m) throw new Error(NO_KEY)
  // The moment: what is said from the playhead, through the end of that thought (3–8 s), inside the clip.
  const words = (await readChatTranscript(run, Math.max(0, at - 2000), at + 12000) ?? []).flatMap((s) => s.words).filter((w) => inCut(candidate, w.start_ms))
  const ahead = words.filter((w) => w.start_ms >= at - 200 && w.start_ms < at + REEL_HERO_MAX_MS).sort((a, b) => a.start_ms - b.start_ms)
  if (!ahead.length) throw new Error('Nothing is said here. A custom graphic shows only the words you say, so move the playhead to where you speak.')
  const clipEnd = candidate.ranges[candidate.ranges.length - 1][1]
  let end = at + REEL_HERO_MIN_MS
  for (const w of ahead) {
    if (w.start_ms - at > 6500) break
    end = Math.max(end, w.end_ms + 500)
    if (/[.!?]["”’)]*$/.test(w.word) && w.end_ms - at >= 2500) break
  }
  const durationMs = Math.round(Math.min(REEL_HERO_MAX_MS, end - at, clipEnd - at))
  if (durationMs < CUSTOM_MIN_MS) throw new Error('There isn’t enough of the clip left here for a graphic. Move the playhead earlier.')
  const line = ahead.filter((w) => w.start_ms < at + durationMs).map((w) => w.word).join(' ').replace(/\s+/g, ' ').trim()
  const kind = designKindFor(line, text)
  const frame = heroFrame({ template: 'custom', atMs: clipTime(candidate, at), durationMs }, kind, project.aspect_ratio === '16:9' ? 'youtube' : 'reel')
  const call = deps.call ?? openRouterModelCall(m.key, m.endpoint, m.price)
  let costUsd = 0
  // The project's theme, kept so later designs in it match.
  const theme = editorTheme(run, project)
  if (!readCustomTheme(run)) saveCustomTheme(run, theme)
  // The video's world: the one kept in the run (an edited recording's, or an earlier design's), else proposed now from the video's words.
  let world = readVisualWorld(run)
  if (!world) {
    const proposed = await proposeVisualWorld({ transcript: project.transcript.map((r) => r.text).join(' '), moments: [{ kind, words: line }], model: m.model }, { call })
    costUsd += proposed.costUsd
    world = proposed.world
    if (world) saveVisualWorld(run, world)
  }
  const look = customLook({ kind: frame, font: candidate.hook?.look.font ?? 'clean', brandColor: candidate.hook?.look.look === 'brand' ? candidate.hook.look.color : null, worldAccent: world?.accent ?? null, theme })
  const draft = newGraphic('custom', at, { fields: { comp: '0000000000000000', idea: customIdea(kind, frame), scene: frame }, duration_ms: durationMs, placement: frame === 'card' ? 'bottom' : 'middle',
    ...(frame === 'card' ? {} : { size: 'stage' as const }), origin: 'member', taken: (candidate.graphics ?? []).map((x) => x.id) })
  try {
    const made = await editorBrief(run, session, candidate, draft, { kind, frame, look, ...(text ? { note: text } : {}), planned: '(none: the creator asked for a new graphic here)', strict: { world } })
    // Designed fresh (the gallery's My graphics tab offers the library's); a design that passes still joins the library.
    const base = deps.library === undefined ? memberLibrary : deps.library
    const library = base ? { ...base, match: () => null } : undefined
    const result = await produceCustomGraphic({ run, brief: made.brief, words: made.words, said: made.said, frame: made.frame, fallback: null, model: m.model, maxRevisions: revisionCap(1, m.price), grade: m.vision },
      { call, sandbox: deps.sandbox, library })
    costUsd += result.costUsd
    if (!result.meta) return { graphic: null, costUsd, reason: `The design didn’t pass our checks, so nothing was added. ${(result.reason ?? '').slice(0, 220)}`.trim() }
    return { graphic: { ...draft, fields: { ...draft.fields, comp: result.meta.comp, idea: result.meta.idea } }, costUsd, reason: null }
  } finally {
    if (costUsd > 0) deps.onSpend?.(Math.round(costUsd * 10000) / 10000)
  }
}
