import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, HardDrive } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { formatBytes, type CleanupFilters, type CleanupGroupId, type CleanupPlan, type CleanupResult } from '../../shared/library-storage'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { Checkbox } from './ui/Checkbox'
import { Dialog, DialogFooter } from './ui/Dialog'
import { Select } from './ui/Select'
import { Switch } from './ui/Switch'

/** What each group is, in plain words. Order matches the dialog. */
const GROUPS: { id: CleanupGroupId; title: string; body: string; warning?: string; defaultOn: boolean }[] = [
  { id: 'editorMedia', title: 'Source copies and editor previews', defaultOn: true,
    body: 'The source video copies and editor previews kept with runs, for runs where every clip is baked or discarded. Review & edit projects become read-only. Clips from Automatic runs can still be edited: the editor downloads the video again, or uses the original file, when you open it.' },
  { id: 'intermediates', title: 'Framing previews and render scraps', defaultOn: true,
    body: 'Framing source previews and unfinished render files the engine left in run folders.' },
  { id: 'leftovers', title: 'Leftover working files', defaultOn: true,
    body: 'Remix working folders and recordings from runs that already finished, and temporary files left by a quit or a crash.' },
  { id: 'remixParts', title: 'Remix and b-roll video parts', defaultOn: false,
    body: 'The parts saved to re-make a Remix video without AI cost, and the voice and shots kept to swap shots in a b-roll video.',
    warning: 'You can no longer use “Edit hook text & captions” on these Remix videos, or swap shots in these b-roll videos.' },
  { id: 'ctaOriginals', title: 'Clip copies without the call to action', defaultOn: false,
    body: 'The copy of each clip saved before its call to action was added.',
    warning: 'You can no longer remove or switch the call to action on these clips. It stays part of the video.' }
]

const AGE_OPTIONS = [
  { value: 'any', label: 'Any age' },
  { value: '7', label: 'Older than 7 days' },
  { value: '30', label: 'Older than 30 days' },
  { value: '90', label: 'Older than 90 days' },
  { value: '180', label: 'Older than 180 days' }
]

type Stage = 'choose' | 'confirm' | 'working' | 'done'

/** Lists what can be removed without touching finished clips, then removes the chosen groups. */
export function FreeUpSpaceDialog({ onClose, onFreed }: { onClose: () => void; onFreed?: (result: CleanupResult) => void }): React.JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [filters, setFilters] = useState<CleanupFilters>({ olderThanDays: null, postedOnly: false })
  const [plan, setPlan] = useState<CleanupPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<CleanupGroupId>>(() => new Set(GROUPS.filter((group) => group.defaultOn).map((group) => group.id)))
  const [expanded, setExpanded] = useState<CleanupGroupId | null>(null)
  const [stage, setStage] = useState<Stage>('choose')
  const [result, setResult] = useState<CleanupResult | null>(null)
  const request = useRef(0)

  const load = useCallback(async (next: CleanupFilters) => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const value = await getApi().storage.cleanupPlan(next)
      if (id === request.current) setPlan(value)
    } catch (err) {
      if (id === request.current) setError(errorMessage(err, 'Could not check the Library. Try again.'))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [])
  useEffect(() => { void load(filters) }, [filters, load])

  const close = useCallback(() => { if (stage !== 'working') onClose() }, [stage, onClose])
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus() }
  }, [close])

  const group = (id: CleanupGroupId): CleanupPlan['groups'][number] | undefined => plan?.groups.find((item) => item.id === id)
  const chosen = GROUPS.filter((item) => selected.has(item.id) && (group(item.id)?.files ?? 0) > 0)
  const total = chosen.reduce((sum, item) => sum + (group(item.id)?.bytes ?? 0), 0)
  const warnings = chosen.filter((item) => item.warning)

  const run = async (): Promise<void> => {
    setStage('working')
    setError(null)
    try {
      const value = await getApi().storage.cleanup(chosen.map((item) => item.id), filters)
      setResult(value)
      setStage('done')
      onFreed?.(value)
    } catch (err) {
      setError(errorMessage(err, 'Could not free up space. Nothing else was changed.'))
      setStage('choose')
    }
  }

  return (
    <Dialog ref={panelRef} aria-labelledby={titleId} onBackdropMouseDown={close} panelClassName="max-w-[560px]" data-testid="free-up-space">
      <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-5">
        <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-ink">
          <HardDrive aria-hidden className="h-4 w-4 text-ink-muted" />Free up space
        </h2>
        {stage === 'done' && result ? (
          <div role="status" className="mt-3 space-y-3 text-sm">
            <p className="text-ink">{result.removedFiles ? `Freed ${formatBytes(result.freedBytes)} (${result.removedFiles.toLocaleString('en-US')} ${result.removedFiles === 1 ? 'file' : 'files'}).` : 'Nothing was removed.'}</p>
            {result.groups.filter((item) => item.files > 0).length > 0 && (
              <ul className="space-y-1 text-ink-muted">
                {result.groups.filter((item) => item.files > 0).map((item) => (
                  <li key={item.id} className="flex justify-between gap-3"><span>{GROUPS.find((g) => g.id === item.id)?.title}</span><span className="tabular-nums">{formatBytes(item.bytes)}</span></li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-subtle">Your finished clips, their details and posting history were not touched.</p>
            {result.skipped.length > 0 && <SkippedList items={result.skipped} title="Left alone" />}
          </div>
        ) : stage === 'confirm' ? (
          <div className="mt-3 space-y-3 text-sm text-ink-muted">
            <p className="text-ink">Remove {formatBytes(total)} from your Library? This cannot be undone.</p>
            <ul className="list-disc space-y-1 pl-5">{chosen.map((item) => <li key={item.id}>{item.title} ({formatBytes(group(item.id)?.bytes ?? 0)})</li>)}</ul>
            {warnings.map((item) => <Callout key={item.id} tone="warning">{item.title}: {item.warning}</Callout>)}
            <p className="text-xs text-ink-subtle">Finished clips, their details and posting history stay. Anything a job, the editor or Remix is using right now is skipped.</p>
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-ink-muted">These files are not part of your finished clips. Removing them never changes the clips you post.</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Select size="sm" className="w-52" aria-label="Run age" value={filters.olderThanDays === null ? 'any' : String(filters.olderThanDays)} options={AGE_OPTIONS}
                disabled={stage === 'working'} onChange={(value) => setFilters((current) => ({ ...current, olderThanDays: value === 'any' ? null : Number(value) }))} />
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <Switch checked={filters.postedOnly} disabled={stage === 'working'} label="Only runs whose clips are all posted"
                  onChange={(postedOnly) => setFilters((current) => ({ ...current, postedOnly }))} />
                Only fully posted runs
              </label>
            </div>
            {error && <Callout tone="danger" className="mt-4">{error}</Callout>}
            <div className="mt-4 space-y-2" aria-busy={loading || undefined}>
              {GROUPS.map((item) => {
                const info = group(item.id)
                const empty = !info || info.files === 0
                const open = expanded === item.id && !empty
                return (
                  <div key={item.id} className={cn('rounded-xl bg-white/[0.035] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]', empty && 'opacity-60')} data-group={item.id}>
                    <div className="flex items-start gap-3">
                      <Checkbox className="mt-0.5" label={item.title} checked={selected.has(item.id) && !empty} disabled={empty || stage === 'working'}
                        onChange={(on) => setSelected((current) => { const next = new Set(current); if (on) next.add(item.id); else next.delete(item.id); return next })} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium text-ink">{item.title}</p>
                          <span className="shrink-0 text-sm tabular-nums text-ink" data-testid={`group-size-${item.id}`}>{loading && !plan ? '…' : empty ? 'Nothing' : formatBytes(info.bytes)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-muted">{item.body}</p>
                        {item.warning && !empty && <p className="mt-1 text-xs text-warning">{item.warning}</p>}
                        {!empty && (
                          <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink" aria-expanded={open} onClick={() => setExpanded(open ? null : item.id)}>
                            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
                            {info.runs.length} {info.runs.length === 1 ? 'run' : 'runs'}
                          </button>
                        )}
                        {open && (
                          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-xs text-ink-muted">
                            {info.runs.map((runItem) => (
                              <li key={runItem.outputDir} className="flex justify-between gap-3"><span className="truncate" title={runItem.videoTitle}>{runItem.videoTitle}</span><span className="shrink-0 tabular-nums">{formatBytes(runItem.bytes)}</span></li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {plan && plan.skipped.length > 0 && <SkippedList items={plan.skipped} title="Left alone for now" className="mt-3" />}
            {plan && plan.runCount === 0 && !loading && <p className="mt-3 text-xs text-ink-subtle">No runs match these filters.</p>}
          </>
        )}
      </div>
      <DialogFooter>
        {stage === 'done' ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : stage === 'confirm' || stage === 'working' ? (
          <>
            <Button disabled={stage === 'working'} onClick={() => setStage('choose')}>Back</Button>
            <Button variant="danger" loading={stage === 'working'} onClick={() => { void run() }}>Remove {formatBytes(total)}</Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-sm text-ink-muted" role="status" data-testid="free-total">{loading ? 'Checking your Library…' : total > 0 ? `${formatBytes(total)} selected` : 'Nothing selected'}</span>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={loading || total === 0} onClick={() => setStage('confirm')}>Free up {total > 0 ? formatBytes(total) : 'space'}</Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}

function SkippedList({ items, title, className }: { items: { outputDir: string; videoTitle: string; reason: string }[]; title: string; className?: string }): React.JSX.Element {
  return (
    <details className={cn('text-xs text-ink-muted', className)}>
      <summary className="cursor-pointer text-ink-subtle">{title}: {items.length} {items.length === 1 ? 'run' : 'runs'}</summary>
      <ul className="mt-1.5 space-y-1">{items.slice(0, 50).map((item, index) => <li key={`${item.outputDir}:${index}`}><span className="text-ink">{item.videoTitle}</span>: {item.reason}</li>)}</ul>
    </details>
  )
}

/** A button that opens "Free up space". */
export function FreeUpSpaceButton({ onFreed, size = 'md', variant = 'secondary' }: { onFreed?: (result: CleanupResult) => void; size?: 'sm' | 'md'; variant?: 'secondary' | 'ghost' }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size={size} variant={variant} icon={<HardDrive className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Free up space</Button>
      {open && <FreeUpSpaceDialog onClose={() => setOpen(false)} onFreed={onFreed} />}
    </>
  )
}
