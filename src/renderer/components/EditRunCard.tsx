import { useEffect, useState } from 'react'
import { EDIT_STAGE_LABELS, editStagePlan } from '../../shared/edit-progress'
import { isRunningEdit, type EditStatus } from '../../shared/edit-recording'
import { clockOf, recordEditTimings } from '../lib/edit-timings'
import { cn } from '../lib/utils'
import { useNow } from './EditProgressView'

/** The edit run's status, kept up to date (null when the app has no edit API, as in some tests). */
function useEditStatus(): EditStatus | null {
  const [status, setStatus] = useState<EditStatus | null>(null)
  useEffect(() => {
    const api = (globalThis as { window?: { bridgeclip?: { edit?: { status?: () => Promise<EditStatus | null>; onStatus?: (cb: (s: EditStatus) => void) => () => void } } } }).window?.bridgeclip?.edit
    if (!api?.status || !api.onStatus) return
    let live = true
    api.status().then((current) => { if (live) setStatus(current) }).catch(() => undefined)
    const off = api.onStatus((next) => { setStatus(next); recordEditTimings(next) })
    return () => { live = false; off() }
  }, [])
  return status
}

/**
 * Edit my recording / Combine clips while it runs, in the sidebar: the current step, the clip it's on, a dot per
 * step and the time so far. Opens the page.
 */
export function EditRunCard({ expanded, onOpen }: { expanded: boolean; onOpen: () => void }): React.JSX.Element | null {
  const status = useEditStatus()
  const running = isRunningEdit(status)
  const now = useNow(running)
  if (!status || !running) return null
  const progress = status.progress
  const combine = status.mode === 'combine'
  const making = status.phase === 'rendering'
  const plan = editStagePlan(combine, progress)
  const reviewAt = plan.indexOf('review')
  const part = making ? plan.slice(reviewAt + 1) : plan.slice(0, reviewAt)
  const current = progress?.stages[progress.stages.length - 1]
  const currentId = current && current.endedAt === null ? current.id : null
  const step = progress?.step
  const stepText = currentId ? `${EDIT_STAGE_LABELS[currentId]}${step && currentId !== 'cut' ? ` · ${step.n} of ${step.of}` : ''}` : status.detail || 'Working'
  const title = making ? 'Making your reel' : combine ? `Combining ${status.sources.length} clips` : 'Editing your recording'
  const startedAt = making ? progress?.renderStartedAt : progress?.startedAt
  const percent = Math.round(Math.max(0, Math.min(100, status.percent)))

  if (!expanded) {
    return (
      <button onClick={onOpen} aria-label={`${title}: ${stepText}, ${percent}%. Open Edit my recording`} title={`${title} · ${stepText} · ${percent}%`}
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full animate-fade-in"
        style={{ background: `conic-gradient(rgb(var(--tool-edit)) ${percent * 3.6}deg, rgb(255 255 255 / 0.08) 0deg)` }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar font-mono text-[9px] tabular text-tool-edit">{percent}%</span>
      </button>
    )
  }
  return (
    <button onClick={onOpen} aria-label={`${title}: ${stepText}, ${percent}%. Open Edit my recording`} data-testid="edit-run-card"
      className="group w-full rounded-xl border border-white/[0.07] bg-surface p-3 text-left transition-colors hover:border-white/[0.14] animate-fade-in">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-tool-edit motion-safe:animate-pulse" />
        <span className="truncate text-xs font-medium text-ink">{title}</span>
        {startedAt && <span className="ml-auto shrink-0 font-mono text-[10px] tabular text-ink-subtle">{clockOf(now - startedAt)}</span>}
      </div>
      <ol aria-hidden className="mt-2 flex items-center gap-1">
        {part.map((id) => {
          const time = progress?.stages.find((stage) => stage.id === id)
          const state = id === currentId ? 'current' : time?.endedAt != null ? 'done' : 'next'
          return <li key={id} title={EDIT_STAGE_LABELS[id]} className={cn('h-1 flex-1 rounded-full', state === 'done' ? 'bg-success/70' : state === 'current' ? 'bg-tool-edit motion-safe:animate-pulse' : 'bg-white/[0.08]')} />
        })}
      </ol>
      <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-ink-subtle">
        <span className="truncate">{stepText}</span>
        <span className="ml-auto shrink-0 tabular text-ink-muted">{percent}%</span>
      </div>
    </button>
  )
}
