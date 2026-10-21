/**
 * Motion graphics: Auto, after a Create (Automatic) run.
 *
 * The engine plans the cards with the clips (the same planner call), keeps
 * only the ones whose words were said, and writes auto-graphics.json: the
 * clips that have cards, as the editor candidates they open as (cut, framing,
 * hook, captions, graphics in SOURCE time), plus what the editor doesn't
 * describe (a hook preview's length before the clip, a title card at the top).
 *
 * Here, after the engine exits and before the run is shown as done (and before
 * its call to action is added), main draws each card with the editor's own
 * templates in the offscreen window (graphics-render.ts: cuts and speed map
 * them to output time, graphic-layout.ts keeps them clear of the hook, the
 * captions and the handle), then runs the engine's graphics_overlay once for
 * the run (bridge/graphics_runner.py), which lays them over the finished clips
 * in place. Why here and not in the engine: drawing needs Electron's offscreen
 * window, and the engine's job protocol is one-way (main never answers it), so
 * a short step after the run is the simplest path that can't stall a render.
 *
 * Anything that fails leaves that clip as made (with a run note); the run never
 * fails because of graphics. job_output.json then records only the cards that
 * were drawn, so opening the clip in the editor shows exactly those (origin
 * 'auto'), editable and removable.
 */
import { spawn } from 'child_process'
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { parseEditorProject, type EditorCandidate, type EditorProject } from '../shared/clip-editor'
import { renderCandidateGraphics, type RenderedGraphic } from './graphics-render'
import { placementAvoidingFace } from '../shared/graphic-layout'
import type { GraphicPlacement } from '../shared/motion-graphics'
import { withRunLock } from './ctas'
import { logger } from './logger'

export const GRAPHICS_PLAN_FILE = 'auto-graphics.json'
const MAX_PLAN_BYTES = 32 * 1024 * 1024
const MAX_JSON_BYTES = 64 * 1024 * 1024

export interface GraphicsPlan {
  project: EditorProject
  /** Per candidate id: the hook preview's length before the clip (output ms) and a title card's share of the top. */
  /** face: the speaker's face in the finished clip (x, y, w, h as fractions), when the engine found one. */
  clips: Record<string, { offset_ms: number; top: number; face?: [number, number, number, number] }>
}

export interface RunGraphicsWorker {
  python: string
  env: Record<string, string | undefined>
  /** bridge/graphics_runner.py */
  script: string
  cwd: string
  library: string
}

export interface RunGraphicsOptions {
  signal?: AbortSignal
  /** Cards drawn so far and in all, then clips finished. */
  onProgress?: (step: 'draw' | 'lay', done: number, total: number) => void
}

export interface RunGraphicsResult {
  /** Clips that were meant to get cards. */
  clips: number
  /** Clips that now have at least one card. */
  applied: number
  /** Clip indices left without some or all of their cards. */
  failed: number[]
  cancelled: boolean
}

function regularFile(path: string, limit: number): boolean {
  try { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() && s.size <= limit } catch { return false }
}

/** The run's graphics plan, checked like an editor project (null when there is none or it is malformed). */
export function readGraphicsPlan(run: string): GraphicsPlan | null {
  const file = join(run, GRAPHICS_PLAN_FILE)
  if (!regularFile(file, MAX_PLAN_BYTES)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; project?: unknown; clips?: unknown }
    if (raw.version !== 1) return null
    const project = parseEditorProject(raw.project)
    const clips: GraphicsPlan['clips'] = {}
    const extras = raw.clips && typeof raw.clips === 'object' && !Array.isArray(raw.clips) ? raw.clips as Record<string, unknown> : {}
    for (const c of project.candidates) {
      const e = extras[c.id] as Record<string, unknown> | undefined
      const offset = e && Number.isInteger(e.offset_ms) && (e.offset_ms as number) >= 0 && (e.offset_ms as number) <= 60_000 ? e.offset_ms as number : 0
      const top = e && typeof e.top === 'number' && Number.isFinite(e.top) ? Math.max(0, Math.min(.4, e.top)) : 0
      const rawFace = e?.face
      const face = Array.isArray(rawFace) && rawFace.length === 4 && rawFace.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
        ? rawFace as [number, number, number, number] : undefined
      clips[c.id] = { offset_ms: offset, top, ...(face ? { face } : {}) }
    }
    if (project.candidates.some((c) => c.library_clip === undefined)) return null
    return { project, clips }
  } catch { return null }
}

function removePlan(run: string): void {
  try { unlinkSync(join(run, GRAPHICS_PLAN_FILE)) } catch { /* gone */ }
}

type LayRequest = { clip_index: number; graphics: { file: string; start_ms: number; duration_ms: number; depth?: 'behind' }[] }
type LayResult = { done: number[]; failed: number[]; cancelled: boolean }

/** Run the engine's overlay once for the run. Clips it reports are final; the rest count as failed. */
function layGraphics(run: string, worker: RunGraphicsWorker, clips: LayRequest[], options: RunGraphicsOptions): Promise<LayResult> {
  return new Promise((resolve) => {
    const done = new Set<number>(), failed = new Set<number>()
    let settled = false, buffer = '', finalOk = false, cancelled = false
    const child = spawn(worker.python, [worker.script], { cwd: worker.cwd, env: worker.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    const kill = (): void => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM') } catch { /* gone */ }
    }
    // About a minute per clip at most (a re-encode of a short clip), and never forever.
    const timer = setTimeout(kill, 5 * 60_000 + clips.length * 90_000)
    const onAbort = (): void => { cancelled = true; kill() }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      for (const c of clips) if (!done.has(c.clip_index)) failed.add(c.clip_index)
      resolve({ done: [...done], failed: [...failed], cancelled })
    }
    const consume = (line: string): void => {
      if (!line.trim() || line.length > 16384) return
      try {
        const value = JSON.parse(line) as Record<string, unknown>
        const known = clips.some((c) => c.clip_index === value.clip_index)
        if (value.type === 'progress' && known && typeof value.ok === 'boolean') {
          ;(value.ok ? done : failed).add(value.clip_index as number)
          options.onProgress?.('lay', done.size + failed.size, clips.length)
        } else if (value.ok === true) finalOk = true
      } catch { /* not protocol */ }
    }
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1) }
      if (buffer.length > 65536) buffer = ''
    })
    child.stderr.on('data', () => { /* the engine's log; not shown */ })
    child.on('error', () => finish())
    child.on('close', (code) => {
      consume(buffer)
      if (code !== 0 || !finalOk) logger.warn('job.graphics.workerFailed', { code, cancelled })
      finish()
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ run, library: worker.library, clips }))
  })
}

/**
 * Record in job_output.json only the cards that are now in each clip, each where it was laid (a card may have
 * been moved off the speaker's face), so the editor shows and re-bakes what the clip has (temp file + rename;
 * the caller holds the run's lock). `drawn`: per clip index, card id to the placement it was drawn with.
 */
function recordDrawn(run: string, drawn: Map<number, Map<string, GraphicPlacement>>): void {
  const file = join(run, 'job_output.json')
  if (!regularFile(file, MAX_JSON_BYTES)) return
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { metrics?: { clip_layouts?: unknown } }
  const layouts = raw.metrics?.clip_layouts
  if (!Array.isArray(layouts)) return
  let changed = false
  for (const entry of layouts) {
    if (!entry || typeof entry !== 'object' || !Array.isArray((entry as Record<string, unknown>).graphics)) continue
    const e = entry as Record<string, unknown>
    const ids = drawn.get(e.clip_index as number)
    const kept = ids ? (e.graphics as { id?: unknown; placement?: unknown }[]).filter((g) => typeof g?.id === 'string' && ids.has(g.id)) : []
    if (kept.length !== (e.graphics as unknown[]).length) changed = true
    for (const g of kept) {
      const placement = ids?.get(g.id as string)
      if (placement && g.placement !== placement) { g.placement = placement; changed = true }
    }
    if (kept.length) e.graphics = kept
    else { delete e.graphics; delete e.teaser_ms }
  }
  if (!changed) return
  const temporary = join(run, `.graphics-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(raw), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } finally { try { unlinkSync(temporary) } catch { /* moved */ } }
}

/**
 * Draw and lay the run's planned motion graphics over its clips. Never throws
 * for a graphic or clip: those are reported in `failed`. Holds the run's lock.
 */
export function applyRunGraphics(run: string, worker: RunGraphicsWorker, options: RunGraphicsOptions = {}): Promise<RunGraphicsResult> {
  return withRunLock(run, () => applyNow(run, worker, options))
}

async function applyNow(run: string, worker: RunGraphicsWorker, options: RunGraphicsOptions): Promise<RunGraphicsResult> {
  const plan = readGraphicsPlan(run)
  if (!plan) {
    // A plan that can't be read: nothing is drawn, so the editor shouldn't show cards either.
    const had = regularFile(join(run, GRAPHICS_PLAN_FILE), MAX_PLAN_BYTES)
    if (had) { try { recordDrawn(run, new Map()) } catch { /* unreadable */ } removePlan(run) }
    return { clips: 0, applied: 0, failed: [], cancelled: false }
  }
  const signal = options.signal
  const candidates = plan.project.candidates.filter((c) => (c.graphics?.length ?? 0) > 0)
  const total = candidates.reduce((n, c) => n + (c.graphics?.length ?? 0), 0)
  const failed = new Set<number>()
  const requests: LayRequest[] = []
  const ids = new Map<number, Map<string, GraphicPlacement>>()
  let drawnCount = 0, cancelled = false
  options.onProgress?.('draw', 0, total)
  for (const c of candidates) {
    const index = c.library_clip as number
    const extra = plan.clips[c.id] ?? { offset_ms: 0, top: 0 }
    const rendered: RenderedGraphic[] = []
    // Cards go where they cover the speaker's face least (the planner can't see the picture).
    c.graphics = (c.graphics ?? []).map((g) => ({ ...g, placement: placementAvoidingFace(plan.project, c, g, extra.face, { top: extra.top }) }))
    for (const g of c.graphics) {
      if (signal?.aborted) { cancelled = true; break }
      try {
        // One card at a time: a card that can't be drawn leaves only itself out.
        const single: EditorCandidate = { ...c, graphics: [g] }
        rendered.push(...await renderCandidateGraphics(run, plan.project, single, () => !!signal?.aborted, { top: extra.top }))
      } catch (error) {
        if (signal?.aborted) { cancelled = true; break }
        failed.add(index)
        logger.warn('job.graphics.drawFailed', { template: g.template, message: String((error as Error)?.message ?? error).slice(0, 200) })
      }
      options.onProgress?.('draw', ++drawnCount, total)
    }
    if (cancelled) break
    if (rendered.length < (c.graphics?.length ?? 0)) failed.add(index)
    if (rendered.length) {
      requests.push({ clip_index: index, graphics: rendered.map((g) => ({ file: g.file, start_ms: g.start_ms + extra.offset_ms, duration_ms: g.duration_ms, ...(g.depth ? { depth: g.depth } : {}) })) })
      const placements = new Map((c.graphics ?? []).map((g) => [g.id, g.placement] as const))
      ids.set(index, new Map(rendered.flatMap((g) => placements.has(g.id) ? [[g.id, placements.get(g.id) as GraphicPlacement] as const] : [])))
    }
  }
  const applied = new Map<number, Map<string, GraphicPlacement>>()
  if (requests.length && !cancelled) {
    const result = await layGraphics(run, worker, requests, options)
    cancelled = result.cancelled
    for (const index of result.done) applied.set(index, ids.get(index) ?? new Map())
  }
  try { recordDrawn(run, applied) } catch (error) { logger.warn('job.graphics.recordFailed', { message: String((error as Error)?.message ?? error).slice(0, 200) }) }
  removePlan(run)
  // A clip without every card it was meant to get (a card not drawn, or the clip not laid over).
  const short = candidates.map((c) => c.library_clip as number).filter((index, i) => (applied.get(index)?.size ?? 0) < (candidates[i].graphics?.length ?? 0))
  if (short.length) logger.warn('job.graphics.partial', { clips: short.length, drawFailures: failed.size, cancelled })
  return { clips: candidates.length, applied: applied.size, failed: short, cancelled }
}

/** The run note for what happened (null when every card went on). */
export function graphicsNotice(result: RunGraphicsResult): string | null {
  if (result.cancelled) return 'Done. You stopped the motion graphics partway: the clips are made, and some are without their graphics. Add graphics to any clip in the editor.'
  const n = result.failed.length
  if (!n) return null
  return `Done. Some motion graphics couldn’t be drawn on ${n} clip${n === 1 ? '' : 's'}, so ${n === 1 ? 'it was' : 'they were'} made without them. Add graphics to any clip in the editor.`
}
