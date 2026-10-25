/**
 * Custom graphics in the clip editor: what one is (its idea, grade, stills, the template it replaced) and making it
 * again with the member's note ("use a rocket instead") through the same loop. The editor's own save keeps the new
 * `comp`; the bake re-draws it from the run's cached composition.
 */
import { readFileSync, realpathSync } from 'fs'
import { join } from 'path'
import { MAX_NOTE_CHARS, customLook, isCustomComp, saidIndex, type CustomFrameKind, type CustomGeometry, type CustomLook, type EditorCustomInfo, type EditorCustomRemake, type HeroKind, type SaidIndex, type WriterBrief } from '../shared/custom-graphics'
import type { CandidateEdit } from '../shared/clip-editor'
import { readLibraryTemplate } from './motion-library'
import { graphicSpec } from '../shared/graphic-layout'
import { newGraphic, parseGraphics, type EditorGraphic } from '../shared/motion-graphics'
import { STAGE_LAYOUT } from '../shared/scenes'
import { openEditor } from './clip-editor'
import { readChatTranscript } from './clip-chat'
import { customModel, customStillPaths, memberLibrary, openRouterModelCall, produceCustomGraphic, readCustomGraphic } from './custom-graphics'
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
async function editorBrief(run: string, session: Awaited<ReturnType<typeof openEditor>>, candidate: CandidateEdit, g: EditorGraphic, design: { kind: HeroKind; frame: CustomFrameKind; look: CustomLook; note?: string; planned: string }): Promise<{ brief: WriterBrief; frame: string | null; said: SaidIndex; words: string }> {
  const spec = graphicSpec(session.project, { ...candidate, graphics: [...(candidate.graphics ?? []).filter((x) => x.id !== g.id), g] }, g)
  if (!spec) throw new Error('That graphic is outside the clip’s cut.')
  const W = spec.width, H = spec.height
  const root = { x: Math.round((spec.box.left ?? 0) * W), y: Math.round(spec.box.top * H), width: Math.round(((spec.box.right ?? 1) - (spec.box.left ?? 0)) * W), height: Math.round((spec.box.bottom - spec.box.top) * H) }
  const cardH = Math.round(STAGE_LAYOUT.cardHeight * H)
  const geometry: CustomGeometry = { kind: design.frame, aspect: W > H ? '16:9' : '9:16', width: W, height: H, root, face: null,
    card: design.frame === 'stage' && H > W ? { x: Math.round(STAGE_LAYOUT.cardSide * W), y: H - Math.round(STAGE_LAYOUT.cardBottom * H) - cardH, width: W - 2 * Math.round(STAGE_LAYOUT.cardSide * W), height: cardH } : null }
  const all = (await readChatTranscript(run, 0, Math.max(session.project.duration_ms, g.at_ms + g.duration_ms) + 1000) ?? []).flatMap((s) => s.words.map((w) => ({ word: w.word, start_ms: w.start_ms, end_ms: w.end_ms })))
  const inside = all.filter((w) => w.start_ms >= g.at_ms - 1200 && w.start_ms < g.at_ms + g.duration_ms)
  const brief: WriterBrief = {
    kind: design.kind, frame: design.frame, durationMs: spec.duration_ms, geometry, look: design.look, ...(design.note ? { note: design.note } : {}),
    cues: inside.map((w) => ({ word: w.word, at: Math.round((w.start_ms - g.at_ms) / 10) / 100 })),
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
  return { brief, frame, said: saidIndex(all), words: inside.filter((w) => w.start_ms >= g.at_ms - 200).map((w) => w.word).join(' ') }
}

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
