import { editStagePlan, type EditStageId } from '../../shared/edit-progress'
import type { EditStatus } from '../../shared/edit-recording'

/**
 * How long Edit my recording's stages took on this computer, per second of recording, from the last few runs. Kept in
 * this browser's storage (a convenience: without it the view times the run as it goes). Used only to say "about".
 */
const KEY = 'creatorclips.editTimings.v1'
const KEEP = 5

interface Stored { rates: Partial<Record<EditStageId, number[]>>; seen: string[] }

function read(): Stored {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as Stored | null
    if (raw && typeof raw === 'object' && raw.rates && Array.isArray(raw.seen)) return raw
  } catch { /* storage off or unreadable */ }
  return { rates: {}, seen: [] }
}

function write(value: Stored): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(value)) } catch { /* storage off */ }
}

const inputSeconds = (status: EditStatus): number => status.sources.reduce((sum, source) => sum + (Number.isFinite(source.seconds) ? source.seconds : 0), 0)

/** Keep the times of stages that finished (a later stage started, or the reel is done). */
export function recordEditTimings(status: EditStatus | null): void {
  const progress = status?.progress
  if (!status || !progress) return
  const seconds = inputSeconds(status)
  if (seconds < 1) return
  const stages = progress.stages
  const finished = stages.filter((stage, i) => stage.id !== 'review' && stage.endedAt !== null && (i < stages.length - 1 || status.phase === 'done'))
  if (!finished.length) return
  const stored = read()
  let changed = false
  for (const stage of finished) {
    const key = `${status.id}:${stage.id}:${stage.startedAt}`
    if (stored.seen.includes(key)) continue
    const ms = (stage.endedAt ?? stage.startedAt) - stage.startedAt
    if (ms <= 0 || ms > 6 * 3600_000) continue
    stored.rates[stage.id] = [...(stored.rates[stage.id] ?? []), ms / seconds].slice(-KEEP)
    stored.seen = [...stored.seen, key].slice(-80)
    changed = true
  }
  if (changed) write(stored)
}

function rateOf(stored: Stored, id: EditStageId): number | null {
  const list = (stored.rates[id] ?? []).filter((n) => Number.isFinite(n) && n > 0)
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null
}

export interface EditEstimate {
  /** How long this part of the run (the edit, or making the reel) takes in all, and what's left (ms); null: not known yet. */
  totalMs: number | null
  leftMs: number | null
  /** From the clips so far or from earlier runs on this computer. */
  basis: 'so-far' | 'earlier' | null
  /** Time left in the current stage alone, when that is known but the whole isn't. */
  stageLeftMs: number | null
}

/**
 * About how long is left, from measured times only: the stages done, the clips done so far in this stage, and the
 * stages' times on earlier runs. Unknown when there's nothing measured to go on.
 */
export function estimateEdit(status: EditStatus, now: number): EditEstimate {
  const progress = status.progress
  const none: EditEstimate = { totalMs: null, leftMs: null, basis: null, stageLeftMs: null }
  if (!progress) return none
  const stored = read()
  const seconds = inputSeconds(status)
  const plan = editStagePlan(status.mode === 'combine', progress, !status.screen)
  const reviewAt = plan.indexOf('review')
  const rendering = status.phase === 'rendering'
  const part = rendering ? plan.slice(reviewAt + 1) : plan.slice(0, reviewAt)
  const current = progress.stages[progress.stages.length - 1]
  let total = 0, known = true, fromSoFar = false, stageLeft: number | null = null
  for (const id of part) {
    const time = progress.stages.find((stage) => stage.id === id)
    if (time && time.endedAt !== null) { total += time.endedAt - time.startedAt; continue }
    const rate = rateOf(stored, id)
    if (time && current?.id === id) {
      const elapsed = Math.max(0, now - time.startedAt)
      // Clip by clip: the clips done so far say how long the rest take.
      let projected: number | null = null
      if (progress.step && progress.step.n > 1 && (id === 'ready' || id === 'listen') && status.sources.length === progress.step.of) {
        const done = status.sources.slice(0, progress.step.n - 1).reduce((sum, source) => sum + source.seconds, 0)
        if (done > 0 && elapsed > 1000) { projected = elapsed * (seconds / done); fromSoFar = true }
      }
      if (projected === null && rate !== null) projected = rate * seconds
      if (projected === null) { known = false; continue }
      projected = Math.max(projected, elapsed)
      stageLeft = projected - elapsed
      total += projected
      continue
    }
    if (rate === null) { known = false; continue }
    total += rate * seconds
  }
  const startedAt = rendering ? progress.renderStartedAt ?? progress.stages.find((stage) => part.includes(stage.id))?.startedAt : progress.startedAt
  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0
  if (!known) return { ...none, stageLeftMs: stageLeft }
  return { totalMs: total, leftMs: Math.max(0, total - elapsed), basis: fromSoFar ? 'so-far' : 'earlier', stageLeftMs: stageLeft }
}

/** "about 6 min", "about 1 min", "under a minute". */
export function aboutMinutes(ms: number): string {
  if (ms < 60_000) return 'under a minute'
  return `about ${Math.round(ms / 60_000)} min`
}

/** "4:07" (or "1:02:07"). */
export function clockOf(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
