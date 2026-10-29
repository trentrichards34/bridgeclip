/**
 * The Library's clip view: one card per clip across every run (being refined,
 * ready to bake or exported) plus the jobs still making clips, and the status
 * tiles above it. Everything else a clip can do lives in its run, one click away.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clapperboard, Download, FolderOpen, Layers, Loader2, Scissors, Search } from 'lucide-react'
import type { LibraryClipItem, LibraryClipStatus, LibrarySummary } from '../../shared/library-summary'
import type { Job } from '../store/use-job-store'
import { STAGE_LABELS } from './JobProgress'
import { ActionMenu } from './ui/ActionMenu'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { cn, formatRelativeDate, localFileUrl, sourceLabel } from '../lib/utils'
import { clipFilePath, loadThumbnail } from '../lib/thumbnails'
import { isAvatarStudioEnabled } from '../../shared/features'

export type ClipFilter = 'all' | LibraryClipStatus | 'processing'
export const STATUS_LABELS: Record<LibraryClipStatus | 'processing', string> = { refining: 'Refining', ready: 'Ready', exported: 'Exported', processing: 'Processing' }
const MADE_WITH: Record<string, string> = { create: 'Clip', remix: 'Remix', avatar: 'Avatar Studio', edit: 'Edit my recording', listicle: 'Avatar Studio', broll: 'B-roll video' }

/** m:ss for a clip's length. */
export function clipLength(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The four status tiles: counts from the summary (and the job list), each one a filter for the clip view. */
export function StatusTiles({ summary, processing, active, onPick }: {
  summary: LibrarySummary | null; processing: number; active: ClipFilter | null; onPick: (status: LibraryClipStatus | 'processing') => void
}): React.JSX.Element {
  const tiles: { status: LibraryClipStatus | 'processing'; count: number | null; hint: string }[] = [
    { status: 'refining', count: summary?.counts.refining ?? null, hint: 'Still being edited' },
    { status: 'ready', count: summary?.counts.ready ?? null, hint: 'Marked ready, waiting to bake' },
    { status: 'exported', count: summary?.counts.exported ?? null, hint: 'Finished clips in your Library' },
    { status: 'processing', count: processing, hint: processing === 1 ? 'Job still running' : 'Jobs running or queued' }
  ]
  return <div className="library-tiles" role="group" aria-label="Clips by status">
    {tiles.map(({ status, count, hint }) => <button key={status} type="button" aria-pressed={active === status} onClick={() => onPick(status)}
      aria-label={`${STATUS_LABELS[status]}: ${count ?? 'counting'}. Show these clips`} className={cn('library-tile', `status-${status}`, active === status && 'selected')}>
      <span className="flex items-center gap-2 text-xs text-ink-muted"><span aria-hidden className="library-status-dot" />{STATUS_LABELS[status]}</span>
      <span className="library-tile-count font-display tabular">{count ?? '–'}</span>
      <span className="text-2xs text-ink-subtle">{hint}</span>
    </button>)}
  </div>
}

/** Thumbnail for a clip card, made only once the card scrolls into view (frames come from main one at a time). */
function useLazyThumb(media: LibraryClipItem['media'], durationMs: number): [React.RefObject<HTMLDivElement | null>, string | null] {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || visible) return
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true) }, { rootMargin: '200px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])
  const key = media ? media.kind === 'clip' ? media.url : `${media.path}\n${media.ms}` : ''
  useEffect(() => {
    if (!visible || !media) return
    let live = true
    const job = media.kind === 'clip' ? loadThumbnail(clipFilePath(media.url), durationMs > 0 ? durationMs / 2000 : undefined) : loadThumbnail(media.path, media.ms / 1000)
    void job.then((path) => { if (live) setThumb(path) })
    return () => { live = false }
  // The media identity decides the frame.
  }, [visible, key])
  return [ref, thumb]
}

function ClipTile({ item, onOpen, onEdit, onReveal, onExport }: {
  item: LibraryClipItem; onOpen: () => void; onEdit?: () => void; onReveal?: () => void; onExport?: () => void
}): React.JSX.Element {
  const [thumbRef, thumb] = useLazyThumb(item.media, item.durationMs)
  const [failed, setFailed] = useState(false)
  const made = item.madeWith ? MADE_WITH[item.madeWith] : null
  // A clip still in the editor opens there; a finished one opens its run (the editor is in its menu).
  const edits = !!onEdit && item.status !== 'exported'
  const actions = [
    ...(onEdit ? [{ label: 'Open in the editor', icon: <Scissors size={14} />, onSelect: onEdit }] : []),
    { label: 'Open its run', icon: <Layers size={14} />, onSelect: onOpen },
    ...(onReveal ? [{ label: 'Show in folder', icon: <FolderOpen size={14} />, onSelect: onReveal }] : []),
    ...(onExport ? [{ label: 'Export a copy…', icon: <Download size={14} />, onSelect: onExport }] : [])
  ]
  return <article className={cn('library-card group', `status-${item.status}`)}>
    <button type="button" className="library-card-main" onClick={edits ? onEdit : onOpen} aria-label={`${edits ? 'Edit' : 'Open'} ${item.title}`}>
      <div ref={thumbRef} className="library-thumb">
        {thumb && !failed ? <>
          <img src={localFileUrl(thumb)} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-xl saturate-150" />
          <img src={localFileUrl(thumb)} alt="" draggable={false} onError={() => setFailed(true)} className="relative h-full w-full object-contain transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
        </> : <span aria-hidden className="library-thumb-empty"><Clapperboard size={16} /></span>}
      </div>
      <div className="library-card-body">
        <span className="library-card-top"><span className={cn('library-pill', `status-${item.status}`)}>{STATUS_LABELS[item.status]}</span></span>
        <span className="library-card-title" title={item.title}>{item.title}</span>
        <span className="library-card-source" title={`${item.runTitle}${made ? ` · made with ${made}` : ''} · ${formatRelativeDate(item.date)}`}>{item.runTitle}</span>
        <span className="library-card-meta font-mono tabular">{clipLength(item.durationMs)}{item.score !== null && <> · <span title="Score out of 10">Score {item.score.toFixed(1)}</span></>}</span>
      </div>
    </button>
    <div className="library-card-menu"><ActionMenu label={`More actions for ${item.title}`} actions={actions} triggerClassName="glass-chip" /></div>
  </article>
}

function JobTile({ job, onOpen }: { job: Job; onOpen: () => void }): React.JSX.Element {
  const percent = Math.round(Math.max(0, Math.min(100, job.status === 'queued' ? 0 : job.percent)))
  const title = sourceLabel(job.request.videoUrl)
  return <article className="library-card status-processing">
    <button type="button" className="library-card-main" onClick={onOpen} aria-label={`Open the job for ${title}`}>
      <div className="library-thumb"><span aria-hidden className="library-thumb-empty"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" /></span></div>
      <div className="library-card-body">
        <span className="library-card-top"><span className="library-pill status-processing">{STATUS_LABELS.processing}</span></span>
        <span className="library-card-title" title={title}>{title}</span>
        <span className="library-card-source">{job.status === 'queued' ? 'Waiting in the queue' : `${STAGE_LABELS[job.status] ?? 'Working'} · ${percent}%`}</span>
        <span className="library-progress" aria-hidden><span style={{ width: `${percent}%` }} /></span>
      </div>
    </button>
  </article>
}

/** Runs whose finished clips open in the clip editor (Clip runs, Remix videos, edited recordings and B-roll videos; not Avatar Studio). */
const EDITOR_RUNS = new Set(['create', 'remix', 'edit', 'broll'])

export function LibraryClipGrid({ summary, error, jobs, query, filter, sort, onOpenRun, onEdit, onOpenJobs, onReveal, onExport }: {
  summary: LibrarySummary | null; error: string | null; jobs: Job[]; query: string; filter: ClipFilter; sort: 'newest' | 'score'
  onOpenRun: (item: LibraryClipItem) => void; onEdit: (item: LibraryClipItem) => void; onOpenJobs: () => void
  onReveal: (item: LibraryClipItem) => void; onExport: (item: LibraryClipItem) => void
}): React.JSX.Element {
  const q = query.trim().toLowerCase()
  const clips = useMemo(() => {
    if (!summary || filter === 'processing') return []
    const list = summary.clips.filter((c) => (filter === 'all' || c.status === filter) && (!q || `${c.title} ${c.runTitle}`.toLowerCase().includes(q)))
    // Newest: the runs' order (newest first), then the clip's own order. Score: highest first, clips without one last.
    return sort === 'score' ? [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : list
  }, [summary, filter, q, sort])
  const working = filter === 'all' || filter === 'processing' ? jobs.filter((job) => !q || sourceLabel(job.request.videoUrl).toLowerCase().includes(q)) : []
  if (!summary && !error) return <div className="library-clip-grid" aria-busy="true" aria-label="Loading clips">
    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="library-card"><Skeleton className="aspect-[9/16] w-[76px] rounded-[9px]" /><div className="flex-1 space-y-2.5 py-1"><Skeleton className="h-3 w-1/4 rounded-full" /><Skeleton className="h-3.5 w-3/4 rounded-full" /><Skeleton className="h-3 w-1/2 rounded-full" /></div></div>)}
  </div>
  if (!clips.length && !working.length) {
    return <EmptyState className="mt-1" icon={<Search />}
      title={q ? 'No clips match your search' : filter === 'processing' ? 'Nothing is processing' : filter === 'all' ? 'No clips yet' : `No ${STATUS_LABELS[filter].toLowerCase()} clips`}
      description={q ? 'Try another title, or show every status.' : filter === 'processing' ? `Jobs you start on ${isAvatarStudioEnabled() ? 'Clip, Remix or Avatar Studio' : 'Clip or Remix'} show here while they run.`
        : filter === 'refining' ? 'Clips you are still editing show here.' : filter === 'ready' ? 'Clips you mark ready in the editor wait here until you bake them.' : 'Finished clips show here.'} />
  }
  return <>
    <div className="library-clip-grid">
      {working.map((job) => <JobTile key={job.id} job={job} onOpen={onOpenJobs} />)}
      {clips.map((item) => <ClipTile key={`${item.outputDir}\n${item.status === 'exported' ? 'e' : 'c'}${item.index}`} item={item} onOpen={() => onOpenRun(item)}
        onEdit={item.status !== 'exported' || (item.madeWith && EDITOR_RUNS.has(item.madeWith)) ? () => onEdit(item) : undefined}
        onReveal={item.status === 'exported' && item.media?.kind === 'clip' ? () => onReveal(item) : undefined}
        onExport={item.status === 'exported' && item.media?.kind === 'clip' ? () => onExport(item) : undefined} />)}
    </div>
    {summary?.truncated && <p className="mt-3 text-xs text-ink-subtle">Showing the first {summary.clips.length} clips. Search or open a run to find the rest.</p>}
  </>
}
