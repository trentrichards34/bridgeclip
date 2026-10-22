import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, FileText, FolderOpen, Layers, ListVideo, Pencil, Plus, RefreshCw, RotateCcw, Search, Wallet, X } from 'lucide-react'
import type { MoreClipsInfo } from '../../preload/index'
import { MoreClipsDialog, moreClipsBlocked } from '../components/MoreClipsDialog'
import { requestSettingsSection } from '../lib/settings-focus'
import type { HistoryEntry } from '../../preload/index'
import { MAX_PARALLEL_JOBS } from '../../shared/jobs'
import { EditInspector, InspectEditsButton } from '../components/EditInspector'
import { BackLink } from '../components/ClipList'
import { JobFailure, JobProgress, STAGE_LABELS } from '../components/JobProgress'
import type { Page as AppPage } from '../components/Sidebar'
import { StatusDot } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { ActionMenu } from '../components/ui/ActionMenu'
import { Callout } from '../components/ui/Callout'
import { EmptyState } from '../components/ui/EmptyState'
import { TextInput } from '../components/ui/Field'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel } from '../components/ui/Panel'
import { ProgressRing } from '../components/ui/ProgressBar'
import { Skeleton } from '../components/ui/Skeleton'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, formatDate, formatDuration, formatRelativeDate, formatTimecode, formatUsd, sourceLabel } from '../lib/utils'
import { isJobActive, useActiveJobs, useJobStore, type Job } from '../store/use-job-store'

type Filter = 'all' | HistoryEntry['status']

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Canceled' },
  { id: 'interrupted', label: 'Interrupted' },
  { id: 'incomplete', label: 'Older unfinished' }
]

const STATUS: Record<HistoryEntry['status'], { label: string; tone: 'success' | 'accent' | 'danger' | 'warning' | 'neutral' }> = {
  completed: { label: 'Completed', tone: 'success' },
  running: { label: 'Running', tone: 'accent' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Canceled', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'warning' },
  incomplete: { label: 'Unfinished', tone: 'warning' }
}

/**
 * Clipping jobs: what is running or queued right now (live, from the main
 * process) and every earlier run in the output folder. Completed jobs open in
 * Library; other jobs show their progress or what went wrong.
 */
export function JobsPage({ onNavigate, onViewLibrary }: {
  onNavigate: (page: AppPage) => void
  onViewLibrary: (outputDir: string) => void
}): React.JSX.Element {
  const focusedJobId = useJobStore((s) => s.focusedJobId)
  const focused = useJobStore((s) => (s.focusedJobId ? s.jobs[s.focusedJobId] ?? null : null))
  const focusJob = useJobStore((s) => s.focusJob)
  const active = useActiveJobs()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [moreClips, setMoreClips] = useState<{ outputDir: string; info: MoreClipsInfo } | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (manual = false) => {
    const request = ++requestId.current
    if (manual) setRefreshing(true)
    try {
      const [live, history] = await Promise.allSettled([getApi().job.list(), getApi().history.list()])
      if (request === requestId.current) {
        if (live.status === 'fulfilled') {
          useJobStore.getState().hydrate(live.value)
          setJobsLoaded(true)
        }
        if (history.status === 'fulfilled') setEntries(history.value)
        else setEntries((previous) => previous ?? [])
        setError(live.status === 'rejected' ? 'Could not refresh active jobs. Try Refresh jobs.'
          : history.status === 'rejected' ? errorMessage(history.reason, 'Could not load previous jobs.') : null)
      }
    } catch (err) {
      if (request === requestId.current) {
        setEntries((previous) => previous ?? [])
        setError(errorMessage(err, 'Could not load previous jobs.'))
      }
    } finally {
      if (request === requestId.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 10000)
    return () => { window.clearInterval(timer); requestId.current++ }
  }, [load])

  // A job finishing moves it from Active to Previous; refresh the list then.
  const activeCount = active.length
  useEffect(() => { void load() }, [activeCount, load])

  // A focused job that was dismissed elsewhere falls back to the list.
  useEffect(() => {
    if (jobsLoaded && focusedJobId && !focused) focusJob(null)
  }, [jobsLoaded, focusedJobId, focused, focusJob])

  // A watched job finishing, or a completed job opened from Create, has the
  // same destination as opening that run in Library.
  const completedRun = focused?.status === 'completed' ? focused.outputDir : null
  useEffect(() => {
    if (!completedRun) return
    focusJob(null)
    onViewLibrary(completedRun)
  }, [completedRun, focusJob, onViewLibrary])

  const cancel = async (job: Job): Promise<void> => {
    try {
      if (!await getApi().job.cancel(job.id)) setError('This job already finished.')
    } catch (err) {
      setError(errorMessage(err, 'Could not cancel this job.'))
    }
  }

  const runAgain = async (job: Job): Promise<void> => {
    setError(null)
    try {
      const result = await getApi().job.start(job.request)
      if (result.error) setError(result.error)
      else if (result.jobId) {
        if (result.job) useJobStore.getState().upsert(result.job)
        else await getApi().job.list().then(useJobStore.getState().hydrate)
        focusJob(result.jobId)
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not start this job again.'))
    }
  }

  // More clips from a finished run: reuses its saved transcript when it still matches the video.
  const openMoreClips = async (outputDir: string): Promise<void> => {
    setError(null)
    try {
      const info = await getApi().job.moreClipsInfo(outputDir)
      const blocked = moreClipsBlocked(info)
      if (blocked) setError(`Can’t make more clips from this run: ${blocked.charAt(0).toLowerCase()}${blocked.slice(1)}`)
      else setMoreClips({ outputDir, info })
    } catch (err) {
      setError(errorMessage(err, 'Can’t make more clips from this run.'))
    }
  }

  const openFolder = async (outputDir: string): Promise<void> => {
    try {
      if (!await getApi().shell.openPath(outputDir)) setError('This run folder is unavailable.')
    } catch (err) {
      setError(errorMessage(err, 'Could not open this run folder.'))
    }
  }

  const back = <BackLink label="All jobs" onClick={() => focusJob(null)} />
  const errorCallout = error && (
    <Page width="focus" className="pb-0">
      <Callout tone="danger" onDismiss={() => setError(null)}>{error}</Callout>
    </Page>
  )

  if (focused) {
    if (isJobActive(focused)) {
      return <>{errorCallout}<JobProgress job={focused} leading={back} onCancel={() => { void cancel(focused) }} /></>
    }
    if (focused.status === 'completed') return <></>
    if (focused.status === 'failed') {
      return <>{errorCallout}<div className="px-6 pt-3"><InspectEditsButton outputDir={focused.outputDir} /></div><JobFailure job={focused} leading={back} onRetry={() => { void runAgain(focused) }} /></>
    }
    return <>{errorCallout}<JobCancelled job={focused} leading={back} onRetry={() => { void runAgain(focused) }} /></>
  }

  return (<>
    {moreClips && <MoreClipsDialog outputDir={moreClips.outputDir} info={moreClips.info} onClose={() => setMoreClips(null)}
      onStarted={(jobId) => { setMoreClips(null); focusJob(jobId); document.getElementById('page-scroll')?.scrollTo({ top: 0 }) }} />}
    <JobsList
      active={active}
      entries={entries}
      filter={filter}
      query={query}
      error={error}
      refreshing={refreshing}
      onFilter={setFilter}
      onQuery={setQuery}
      onDismissError={() => setError(null)}
      onRefresh={() => { void load(true) }}
      onNew={() => onNavigate('clip')}
      onSpending={() => { requestSettingsSection('spending'); onNavigate('settings') }}
      onOpenJob={(job) => { focusJob(job.id); document.getElementById('page-scroll')?.scrollTo({ top: 0 }) }}
      onCancel={(job) => { void cancel(job) }}
      onOpenEntry={(entry) => {
        if (entry.status === 'completed') {
          focusJob(null)
          onViewLibrary(entry.outputDir)
        } else if (useJobStore.getState().jobs[entry.jobId]) focusJob(entry.jobId)
      }}
      onOpenFolder={(dir) => { void openFolder(dir) }}
      onMoreClips={(dir) => { void openMoreClips(dir) }}
    />
  </>)
}

function JobsList({ active, entries, filter, query, error, refreshing, onFilter, onQuery, onDismissError, onRefresh, onNew, onSpending, onOpenJob, onCancel, onOpenEntry, onOpenFolder, onMoreClips }: {
  active: Job[]
  entries: HistoryEntry[] | null
  filter: Filter
  query: string
  error: string | null
  refreshing: boolean
  onFilter: (filter: Filter) => void
  onQuery: (query: string) => void
  onDismissError: () => void
  onRefresh: () => void
  onNew: () => void
  onSpending: () => void
  onOpenJob: (job: Job) => void
  onCancel: (job: Job) => void
  onOpenEntry: (entry: HistoryEntry) => void
  onOpenFolder: (dir: string) => void
  onMoreClips: (dir: string) => void
}): React.JSX.Element {
  const sessionJobs = useJobStore((s) => s.jobs)
  const liveIds = useMemo(() => new Set(active.map((job) => job.id)), [active])
  // Queued and running jobs show above; their disk records would duplicate them.
  const previous = useMemo(() => (entries ?? []).filter((entry) => !liveIds.has(entry.jobId) && entry.status !== 'running'), [entries, liveIds])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return previous.filter((entry) =>
      (filter === 'all' || entry.status === filter) &&
      (!q || entry.videoTitle.toLowerCase().includes(q) || entry.jobId.toLowerCase().includes(q)))
  }, [previous, filter, query])
  const counts = previous.reduce<Partial<Record<Filter, number>>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1
    return acc
  }, { all: previous.length })
  const running = active.filter((job) => job.status !== 'queued').length
  const queued = active.length - running
  const nothingYet = entries !== null && previous.length === 0 && active.length === 0

  return (
    <Page width="default">
      <PageHeader
        title="Everything that’s running or ran"
        description={`Up to ${MAX_PARALLEL_JOBS === 2 ? 'two' : MAX_PARALLEL_JOBS} jobs run at once; the rest wait in the queue and start automatically. Completed jobs open in Library.`}
        actions={
          <>
            <Button
              variant="ghost"
              icon={<Wallet className="h-3.5 w-3.5" />}
              onClick={onSpending}
              tooltip="What your AI runs cost (Settings → Spending)"
            >
              Spending
            </Button>
            <Button
              variant="secondary"
              iconOnly
              aria-label="Refresh jobs"
              title="Refresh jobs"
              onClick={onRefresh}
              disabled={refreshing}
              icon={<RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />}
            />
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" strokeWidth={2.4} />} onClick={onNew}>New job</Button>
          </>
        }
      />

      <div className="mt-5 space-y-3.5">
        {error && <Callout tone="danger" onDismiss={onDismissError}>{error}</Callout>}

        {nothingYet ? (
          <EmptyState
            icon={<ListVideo />}
            title="No jobs yet"
            description="Every video you make shows up here while it works, then stays listed when it’s done: Create clips, Remix, Edit my recording and Avatar Studio. Up to two run at once."
            action={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" strokeWidth={2.4} />} onClick={onNew}>Create clips</Button>}
          />
        ) : (<>
          <Panel padded={false} className="overflow-hidden">
            <section aria-label="Active jobs">
              <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <SectionTitle label="Active" count={active.length} />
                {active.length > 0 && (
                  <p className="text-2xs text-ink-subtle">
                    {running} running{queued > 0 && ` · ${queued} queued`} · up to {MAX_PARALLEL_JOBS} at once
                  </p>
                )}
              </div>
              {active.length === 0 ? (
                <p className="px-4 py-3.5 text-xs text-ink-subtle">Nothing running. Start a job from Create, Remix, Edit my recording or Avatar Studio; extra jobs wait here in line.</p>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {active.map((job) => (
                    <ActiveJobRow
                      key={job.id}
                      job={job}
                      position={job.status === 'queued' ? active.filter((j) => j.status === 'queued').indexOf(job) + 1 : null}
                      onOpen={() => onOpenJob(job)}
                      onCancel={() => onCancel(job)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </Panel>

          <Panel padded={false} className="overflow-hidden">
            <section aria-label="Previous jobs">
              <div className="flex min-h-[46px] flex-wrap items-center gap-2 border-b border-line py-2 pl-4 pr-2.5">
                <SectionTitle label="Previous" count={previous.length} className="mr-auto" />
                {previous.length > 0 && (
                  <>
                    <div className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="Filter jobs">
                      {FILTERS.filter((option) => option.id === 'all' || (counts[option.id] ?? 0) > 0).map((option) => {
                        const selected = filter === option.id
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => onFilter(option.id)}
                            aria-pressed={selected}
                            className={cn(
                              'inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors duration-150',
                              selected ? 'bg-white/[0.09] font-medium text-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]' : 'text-ink-muted hover:bg-white/[0.05] hover:text-ink'
                            )}
                          >
                            {option.label}
                            <span className="font-mono text-[10px] tabular text-ink-subtle">{counts[option.id] ?? 0}</span>
                          </button>
                        )
                      })}
                    </div>
                    <TextInput
                      inputSize="sm"
                      type="search"
                      className="ml-1 w-[170px] rounded-full max-sm:ml-0 max-sm:w-full"
                      value={query}
                      onChange={(event) => onQuery(event.target.value)}
                      placeholder="Search jobs"
                      aria-label="Search jobs"
                      leading={<Search className="h-3.5 w-3.5" />}
                    />
                  </>
                )}
              </div>

              {entries === null ? (
                <ul className="divide-y divide-white/[0.04]" aria-busy="true" aria-label="Loading jobs">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="flex h-[52px] items-center gap-3 px-4">
                      <Skeleton className="h-2 w-2 rounded-full" />
                      <Skeleton className="h-3 w-2/5 rounded-full" />
                      <Skeleton className="ml-auto h-3 w-24 rounded-full" />
                    </li>
                  ))}
                </ul>
              ) : previous.length === 0 ? (
                <p className="px-4 py-3.5 text-xs text-ink-subtle">Finished jobs will appear here.</p>
              ) : visible.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 text-xs text-ink-subtle">
                  <span>{query.trim() ? `No jobs match “${query.trim()}”.` : 'No jobs match this filter.'}</span>
                  <Button size="sm" variant="ghost" onClick={() => { onFilter('all'); onQuery('') }}>Show all jobs</Button>
                </div>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {visible.map((entry) => (
                    <PreviousJobRow key={entry.jobId} entry={entry} hasDetails={Boolean(sessionJobs[entry.jobId])} onOpen={() => onOpenEntry(entry)} onOpenFolder={() => onOpenFolder(entry.outputDir)} onMoreClips={() => onMoreClips(entry.outputDir)} />
                  ))}
                </ul>
              )}
            </section>
          </Panel>
        </>)}
      </div>
    </Page>
  )
}

function SectionTitle({ label, count, className }: { label: string; count: number; className?: string }): React.JSX.Element {
  return (
    <h2 className={cn('flex items-center gap-2.5', className)}>
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-2xs tabular text-ink-muted">{count}</span>
    </h2>
  )
}

function ActiveJobRow({ job, position, onOpen, onCancel }: { job: Job; position: number | null; onOpen: () => void; onCancel: () => void }): React.JSX.Element {
  const queued = job.status === 'queued'
  const since = job.startedAt ?? job.queuedAt
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const elapsed = Math.max(0, now - Date.parse(since))
  const stage = queued ? 'Queued' : STAGE_LABELS[job.status] ?? 'Working'
  const detail = queued ? 'Starts when a slot frees up' : job.step

  return (
    <li className="flex items-center pr-2.5 transition-colors duration-150 hover:bg-white/[0.02]">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3.5 py-3 pl-4 pr-3 text-left" title={job.request.videoUrl}>
        {queued ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.05] font-mono text-[10px] tabular text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]">
            #{position}
          </span>
        ) : (
          <ProgressRing value={job.percent} size={36} stroke={3.5} tone="tool">
            <span className="font-mono text-[9px] tabular text-tool">{Math.round(job.percent)}%</span>
          </ProgressRing>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-5 text-ink">{sourceLabel(job.request.videoUrl)}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-subtle">
            <span className={queued ? 'text-ink-muted' : 'text-tool'}>{stage}</span>
            {detail && detail !== stage && ` · ${detail}`}
          </span>
        </span>
        {job.clipsTotal > 0 && (
          <span className="hidden w-[70px] shrink-0 text-right font-mono text-2xs tabular text-ink-muted sm:block">
            {job.clipsDone}/{job.clipsTotal} <span className="font-sans">clips</span>
          </span>
        )}
        <span className="w-[110px] shrink-0 text-right text-2xs text-ink-subtle">
          <span className="font-mono tabular text-ink-muted">{formatTimecode(elapsed)}</span> {queued ? 'waiting' : 'elapsed'}
        </span>
      </button>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        aria-label={queued ? 'Remove from queue' : 'Cancel job'}
        title={queued ? 'Remove from queue' : 'Cancel job'}
        icon={queued ? <X className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
        onClick={onCancel}
        className="hover:bg-danger/10 hover:text-danger"
      />
    </li>
  )
}

const STATUS_DOT: Record<HistoryEntry['status'], 'success' | 'accent' | 'danger' | 'warning' | 'idle'> = {
  completed: 'success',
  running: 'accent',
  failed: 'danger',
  cancelled: 'idle',
  interrupted: 'warning',
  incomplete: 'warning'
}

/** The soft glow around a previous job's status dot, as in the Signal mockup. */
const DOT_GLOW: Record<HistoryEntry['status'], string> = {
  completed: 'shadow-[0_0_8px_rgb(var(--success)/0.7)]',
  running: 'shadow-[0_0_8px_rgb(var(--accent)/0.7)]',
  failed: 'shadow-[0_0_8px_rgb(var(--danger)/0.7)]',
  cancelled: '',
  interrupted: 'shadow-[0_0_8px_rgb(var(--warning)/0.7)]',
  incomplete: 'shadow-[0_0_8px_rgb(var(--warning)/0.7)]'
}

const STATUS_TEXT: Record<HistoryEntry['status'], string> = {
  completed: 'text-success',
  running: 'text-accent',
  failed: 'text-danger',
  cancelled: 'text-ink-subtle',
  interrupted: 'text-warning',
  incomplete: 'text-warning'
}

/** One line per run: status, title, then clips, run time, cost and date in aligned columns. */
function PreviousJobRow({ entry, hasDetails, onOpen, onOpenFolder, onMoreClips }: { entry: HistoryEntry; hasDetails: boolean; onOpen: () => void; onOpenFolder: () => void; onMoreClips: () => void }): React.JSX.Element {
  const [inspecting, setInspecting] = useState(false)
  const [progress, setProgress] = useState<{ outputDir: string; remaining: number } | null>(null)
  const closeInspector = useCallback(() => setInspecting(false), [])
  const status = STATUS[entry.status]
  const completed = entry.status === 'completed'
  useEffect(() => {
    if (!completed || !entry.editorProject) { setProgress(null); return }
    let active = true
    // Read saved candidate states, as Library does. Export counts cannot tell
    // whether an earlier export has since been edited or marked ready again.
    // Counts only, cached by main until the project file changes.
    getApi().editor.progress(entry.outputDir).then(({ remaining }) => {
      if (active) setProgress({ outputDir: entry.outputDir, remaining })
    }).catch(() => { if (active) setProgress(null) })
    return () => { active = false }
  }, [entry, completed])
  const remaining = completed && entry.editorProject && progress?.outputDir === entry.outputDir ? progress.remaining : 0
  const editing = remaining > 0
  // Failed and cancelled jobs from this session keep their options, so they can run again.
  const openable = completed || hasDetails
  const dated = !entry.date.startsWith('1970-')
  const cells = (
    <>
      <StatusDot tone={editing ? 'accent' : STATUS_DOT[entry.status]} className={cn('rounded-full', DOT_GLOW[editing ? 'running' : entry.status])} />
      <span className="min-w-0 flex-1 truncate text-xs" title={entry.errorMessage ?? entry.videoTitle}>
        {!editing && <span className="sr-only">{status.label}: </span>}
        <span className="text-sm font-medium text-ink">{entry.videoTitle}</span>
        {!completed && <span className={cn('ml-2 font-medium', STATUS_TEXT[entry.status])} aria-hidden>{status.label}</span>}
        {entry.errorMessage && <span className="text-ink-subtle" data-selectable> · {entry.errorMessage}</span>}
      </span>
      {editing && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 py-[3px] text-2xs font-semibold text-accent-ink"
        aria-label={`Editing: ${remaining} clip${remaining === 1 ? '' : 's'} left to finish`} title={`${remaining} clip${remaining === 1 ? '' : 's'} left to finish`}>
        <Pencil className="h-3 w-3" aria-hidden="true" />Editing<span className="hidden opacity-80 sm:inline">· {remaining} left</span>
      </span>}
      <span className="hidden w-16 shrink-0 text-right text-xs tabular text-ink-muted sm:block">
        {completed ? `${entry.clipCount} clip${entry.clipCount === 1 ? '' : 's'}` : ''}
      </span>
      <span className="hidden w-[64px] shrink-0 text-right font-mono text-2xs tabular text-ink-subtle md:block">
        {entry.durationMs != null ? formatDuration(entry.durationMs) : ''}
      </span>
      <span className="hidden w-14 shrink-0 text-right font-mono text-2xs tabular text-ink-subtle md:block">
        {entry.totalCostUsd != null ? formatUsd(entry.totalCostUsd) : ''}
      </span>
      <span className="w-[100px] shrink-0 truncate whitespace-nowrap text-right text-xs text-ink-subtle" title={dated ? formatDate(entry.date) : undefined}>
        {dated ? formatRelativeDate(entry.date).replace(/^(Today|Yesterday), .*$/, '$1') : 'Date unavailable'}
      </span>
    </>
  )
  const cellClass = 'flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left'

  return (
    <li className={cn('group/row flex items-center pr-2.5 transition-colors duration-150', openable && 'hover:bg-white/[0.02]')}>
      {openable ? (
        <button type="button" onClick={onOpen} className={cellClass} title={completed ? 'Open in Library' : 'Open job'}>{cells}</button>
      ) : (
        <div className={cellClass}>{cells}</div>
      )}
      <ActionMenu label={`Actions for ${entry.videoTitle}`} actions={[
        { label: completed ? 'Open in Library' : 'Open job', icon: <ListVideo className="h-3.5 w-3.5" />, disabled: !openable, onSelect: onOpen },
        ...(completed ? [{ label: 'More clips from this video', icon: <Layers className="h-3.5 w-3.5" />, onSelect: onMoreClips }] : []),
        { label: 'Open folder', icon: <FolderOpen className="h-3.5 w-3.5" />, onSelect: onOpenFolder },
        { label: 'Details', icon: <FileText className="h-3.5 w-3.5" />, onSelect: () => setInspecting(true) }
      ]} />
      {inspecting && <EditInspector outputDir={entry.outputDir} onClose={closeInspector} />}
    </li>
  )
}

function JobCancelled({ job, leading, onRetry }: { job: Job; leading: React.ReactNode; onRetry: () => void }): React.JSX.Element {
  return (
    <Page width="focus">
      <div className="mb-3">{leading}</div>
      <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">Job canceled</h1>
      <p className="mt-1 truncate text-sm text-ink-muted" title={job.request.videoUrl}>{sourceLabel(job.request.videoUrl)}</p>
      <div className="mt-4">
        <Button variant="primary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={onRetry}>Run again</Button>
      </div>
    </Page>
  )
}
