/**
 * Custom graphics in the clip editor: what one is (its idea, grade, stills, the template it replaced) and making it
 * again with the member's note ("use a rocket instead") through the same loop. The editor's own save keeps the new
 * `comp`; the bake re-draws it from the run's cached composition.
 */
import { readFileSync, realpathSync } from 'fs'
import { join } from 'path'
import { MAX_NOTE_CHARS, isCustomComp, saidIndex, type CustomGeometry, type EditorCustomInfo, type EditorCustomRemake, type WriterBrief } from '../shared/custom-graphics'
import { graphicSpec } from '../shared/graphic-layout'
import { parseGraphics } from '../shared/motion-graphics'
import { STAGE_LAYOUT } from '../shared/scenes'
import { openEditor } from './clip-editor'
import { readChatTranscript } from './clip-chat'
import { customModel, customStillPaths, openRouterModelCall, produceCustomGraphic, readCustomGraphic } from './custom-graphics'
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
  const spec = graphicSpec(session.project, { ...candidate, graphics: [...(candidate.graphics ?? []).filter((x) => x.id !== g.id), g] }, g)
  if (!spec) throw new Error('That graphic is outside the clip’s cut.')
  const W = spec.width, H = spec.height
  const root = { x: Math.round((spec.box.left ?? 0) * W), y: Math.round(spec.box.top * H), width: Math.round(((spec.box.right ?? 1) - (spec.box.left ?? 0)) * W), height: Math.round((spec.box.bottom - spec.box.top) * H) }
  const cardH = Math.round(STAGE_LAYOUT.cardHeight * H)
  const geometry: CustomGeometry = { kind: found.meta.frame, aspect: W > H ? '16:9' : '9:16', width: W, height: H, root, face: null,
    card: found.meta.frame === 'stage' && H > W ? { x: Math.round(STAGE_LAYOUT.cardSide * W), y: H - Math.round(STAGE_LAYOUT.cardBottom * H) - cardH, width: W - 2 * Math.round(STAGE_LAYOUT.cardSide * W), height: cardH } : null }
  const all = (await readChatTranscript(run, 0, Math.max(session.project.duration_ms, g.at_ms + g.duration_ms) + 1000) ?? []).flatMap((s) => s.words.map((w) => ({ word: w.word, start_ms: w.start_ms, end_ms: w.end_ms })))
  const inside = all.filter((w) => w.start_ms >= g.at_ms - 1200 && w.start_ms < g.at_ms + g.duration_ms)
  const brief: WriterBrief = {
    kind: found.meta.kind, frame: found.meta.frame, durationMs: spec.duration_ms, geometry, look: found.meta.look, note: text,
    cues: inside.map((w) => ({ word: w.word, at: Math.round((w.start_ms - g.at_ms) / 10) / 100 })),
    before: all.filter((w) => w.start_ms >= g.at_ms - 9000 && w.start_ms < g.at_ms - 1200).map((w) => w.word).join(' '),
    after: all.filter((w) => w.start_ms >= g.at_ms + g.duration_ms && w.start_ms < g.at_ms + g.duration_ms + 5000).map((w) => w.word).join(' '),
    planned: found.meta.fallback ? `${found.meta.fallback.template}: ${Object.values(found.meta.fallback.fields).join(' · ').slice(0, 200)}` : '(none)'
  }
  let frame: string | null = null
  if (session.sourcePath) {
    try {
      const at = Math.round(g.at_ms + g.duration_ms * .55)
      frame = `data:image/jpeg;base64,${readFileSync(await beatFrame(join(run, '.graphics', 'frames'), session.sourcePath, at)).toString('base64')}`
    } catch { frame = null }
  }
  const result = await produceCustomGraphic({ run, brief, words: inside.filter((w) => w.start_ms >= g.at_ms - 200).map((w) => w.word).join(' '), said: saidIndex(all), frame, fallback: found.meta.fallback,
    model: m.model, maxRevisions: 1, grade: m.vision }, { call: openRouterModelCall(m.key, m.endpoint, m.price) })
  if (!result.meta) return { graphic: null, costUsd: result.costUsd, reason: 'The new design didn’t pass the check, so your graphic stays as it was.' }
  return { graphic: { ...g, fields: { ...g.fields, comp: result.meta.comp, idea: result.meta.idea } }, costUsd: result.costUsd, reason: null }
}
