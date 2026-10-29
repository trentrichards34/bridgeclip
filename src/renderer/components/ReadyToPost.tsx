import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, FolderOpen, RefreshCw, Search, Send, Sparkles } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, formatDuration, formatRelativeDate, localFileUrl } from '../lib/utils'
import { clipFilePath, loadThumbnail } from '../lib/thumbnails'
import { usePostsStore } from '../store/use-posts-store'
import { useSettingsStore } from '../store/use-settings-store'
import { LIBRARY_POSTING_LABELS } from '../../shared/library-posting'
import {
  DEFAULT_READY_FILTERS, RUN_KIND_LABELS, filterReadyClips, type MinGrade, type ReadyClip, type ReadyFilters, type ReadySort, type ReadyToPostResult, type RunKind
} from '../../shared/ready-to-post'
import { toPostable } from './ClipList'
import { PostDialog, type PostableClip } from './PostDialog'
import { GradeChip } from './FrameworkGrade'
import { Button } from './ui/Button'
import { TextInput } from './ui/Field'
import { Segmented } from './ui/Segmented'
import { Select } from './ui/Select'
import { Checkbox } from './ui/Checkbox'
import { Callout } from './ui/Callout'
import { Badge } from './ui/Badge'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import type { Page as AppPage } from './Sidebar'
import { isAvatarStudioEnabled } from '../../shared/features'

/** Same limit as a run's batch posting: each clip is still its own upload and post. */
const MAX_POST_BATCH = 10
const PAGE_SIZE = 40

const keyOf = (clip: Pick<ReadyClip, 'outputDir' | 'clipIndex'>): string => `${clip.outputDir}\n${clip.clipIndex}`

function postable(clip: ReadyClip): PostableClip {
  return {
    ...toPostable({ s3_url: clip.s3Url, summary: clip.title, clip_index: clip.clipIndex, tags: clip.tags, duration_ms: clip.durationMs, ai_generated: clip.aiGenerated, post_caption: clip.postCaption }),
    library: { outputDir: clip.outputDir, clipIndex: clip.clipIndex }
  }
}

/**
 * Library → Ready to post: clips from every run that are not posted yet, with
 * filters, search and batch posting. The list is built in the main process.
 */
export function ReadyToPost({ onOpenRun, onNavigate }: {
  onOpenRun: (outputDir: string) => void
  onNavigate?: (page: AppPage) => void
}): React.JSX.Element {
  const [result, setResult] = useState<ReadyToPostResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<ReadyFilters>(DEFAULT_READY_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [posting, setPosting] = useState<PostableClip[] | null>(null)
  const [shown, setShown] = useState(PAGE_SIZE)
  const [notice, setNotice] = useState<{ text: string; undo?: ReadyClip } | null>(null)
  const [marking, setMarking] = useState<Set<string>>(new Set())
  const request = useRef(0)
  const configured = useSettingsStore((state) => state.zernioConfigured)
  const posts = usePostsStore((state) => state.posts)
  // Reload only when a post's link to a clip or its outcome changed (the store refreshes with a new array).
  const postsRevision = useMemo(() => JSON.stringify(posts.map((post) => [post.id, post.clipPath, post.status,
    post.targets.map((target) => [target.platform, target.status, target.inbox])])), [posts])

  const load = useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    try {
      if (typeof getApi().history.readyToPost !== 'function') throw new Error('Restart CreatorClips to see clips that are ready to post.')
      const next = await getApi().history.readyToPost()
      if (id !== request.current) return
      setResult(next)
      setError(null)
    } catch (cause) {
      if (id === request.current) { setResult((previous) => previous ?? { clips: [], runs: 0, unreadableRuns: 0, postingHistory: false }); setError(errorMessage(cause, 'Could not check which clips are posted.')) }
    } finally { if (id === request.current) setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load, postsRevision, configured])
  useEffect(() => () => { request.current++ }, [])

  const visible = useMemo(() => result ? filterReadyClips(result.clips, filters) : [], [result, filters])
  const page = visible.slice(0, shown)
  const visibleKeys = useMemo(() => new Set(visible.map(keyOf)), [visible])
  useEffect(() => { setSelected((previous) => new Set([...previous].filter((key) => visibleKeys.has(key)))) }, [visibleKeys])
  useEffect(() => { setShown(PAGE_SIZE) }, [filters])
  const allSelected = page.length > 0 && page.every((clip) => selected.has(keyOf(clip)))
  const update = (patch: Partial<ReadyFilters>): void => setFilters((current) => ({ ...current, ...patch }))
  // Avatar Studio switched off: the Avatar filter only shows for a member who already has avatar videos.
  const kinds = useMemo(() => (['create', 'remix', 'avatar'] as const).filter((kind) => kind !== 'avatar' || isAvatarStudioEnabled() || filters.kind === 'avatar' || Boolean(result?.clips.some((clip) => clip.kind === 'avatar'))), [result, filters.kind])
  const filtered = filters.query.trim() !== '' || filters.minGrade !== 'any' || filters.kind !== 'all'

  const toggle = (clip: ReadyClip): void => setSelected((previous) => {
    const next = new Set(previous)
    const key = keyOf(clip)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const setPosted = async (clip: ReadyClip, posted: boolean): Promise<void> => {
    const key = keyOf(clip)
    if (marking.has(key)) return
    setMarking((previous) => new Set(previous).add(key))
    try {
      await getApi().history.setPosted(clip.outputDir, clip.clipIndex, posted)
      setNotice(posted ? { text: `Marked “${clip.title}” as posted.`, undo: clip } : { text: `“${clip.title}” is back in Ready to post.` })
      setResult((current) => current && (posted
        ? { ...current, clips: current.clips.filter((item) => keyOf(item) !== key) }
        : current.clips.some((item) => keyOf(item) === key) ? current : { ...current, clips: [...current.clips, clip] }))
      void load()
    } catch (cause) {
      setError(errorMessage(cause, 'Could not change this clip’s posted mark.'))
    } finally {
      setMarking((previous) => { const next = new Set(previous); next.delete(key); return next })
    }
  }

  const selectedClips = visible.filter((clip) => selected.has(keyOf(clip)))
  const gradeOptions: { value: MinGrade; label: string }[] = [
    { value: 'any', label: 'Any grade' }, { value: 'A', label: 'Grade A' }, { value: 'B', label: 'Grade B or better' }, { value: 'C', label: 'Grade C or better' }
  ]

  return (
    <section aria-label="Ready to post" className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <TextInput className="max-w-sm flex-1 rounded-full" value={filters.query} onChange={(event) => update({ query: event.target.value })}
          placeholder="Search titles, hooks and captions" leading={<Search className="h-3.5 w-3.5" />} aria-label="Search clips ready to post" />
        <Select size="sm" aria-label="Lowest grade" value={filters.minGrade} options={gradeOptions} onChange={(value) => update({ minGrade: value as MinGrade })} className="w-48" />
        <Segmented<RunKind | 'all'> size="sm" label="Kind of clip" value={filters.kind} onChange={(kind) => update({ kind })}
          options={[{ value: 'all', label: 'All' }, ...kinds.map((kind) => ({ value: kind, label: RUN_KIND_LABELS[kind] }))]} />
        <Segmented<ReadySort> size="sm" label="Sort clips ready to post" value={filters.sort} onChange={(sort) => update({ sort })}
          options={[{ value: 'newest', label: 'Newest' }, { value: 'best', label: 'Best first' }]} />
        <Button variant="ghost" size="sm" iconOnly aria-label="Refresh ready to post" title="Refresh"
          onClick={() => { if (configured) void usePostsStore.getState().refresh(true); void load() }} disabled={loading}
          icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />} />
      </div>

      {error && <Callout tone="danger" className="mt-3" onDismiss={() => setError(null)}>{error}</Callout>}
      {result && !result.postingHistory && <Callout tone="info" className="mt-3"
        action={onNavigate && <Button size="sm" onClick={() => onNavigate('settings')}>Open Settings</Button>}>
        Without a Zernio key, only clips you marked as posted are left out. Add your Zernio key to check your posting history too.
      </Callout>}
      {result && result.unreadableRuns > 0 && <Callout tone="warning" className="mt-3">
        {result.unreadableRuns === 1 ? 'One run' : `${result.unreadableRuns} runs`} could not be checked and {result.unreadableRuns === 1 ? 'is' : 'are'} not listed. Open {result.unreadableRuns === 1 ? 'it' : 'them'} from Runs.
      </Callout>}
      {filters.minGrade !== 'any' && <p className="mt-2 text-xs text-ink-subtle">Clips without a framework grade are hidden while a grade filter is on.</p>}

      <div className="glass-thick sticky top-0 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl py-1.5 pl-3 pr-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <Checkbox checked={allSelected} indeterminate={selected.size > 0 && !allSelected} label="Select all shown clips"
            onChange={() => setSelected(allSelected ? new Set() : new Set(page.map(keyOf)))} />
          <span className="whitespace-nowrap text-sm text-ink-muted" role="status" data-testid="ready-count">
            {selected.size > 0 ? <><span className="font-medium text-ink">{selected.size}</span> selected</>
              : result ? `${visible.length}${filtered ? ` of ${result.clips.length}` : ''} clip${visible.length === 1 ? '' : 's'} not posted yet` : 'Checking posting history…'}
          </span>
          {notice && <span className="inline-flex min-w-0 items-center gap-2 truncate rounded-full bg-success/[0.1] px-2.5 py-1 text-xs text-success animate-fade-in">
            <span className="truncate">{notice.text}</span>
            {notice.undo && <button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={() => { const clip = notice.undo!; setNotice(null); void setPosted(clip, false) }}>Undo</button>}
          </span>}
        </div>
        {selected.size > 0 && <div className="flex items-center gap-1.5 animate-fade-in">
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} disabled={selected.size > MAX_POST_BATCH}
            title={selected.size > MAX_POST_BATCH ? `Post up to ${MAX_POST_BATCH} clips at a time` : 'Post or schedule the selected clips'}
            onClick={() => setPosting(selectedClips.map(postable))}>
            Post or schedule {selected.size}
          </Button>
        </div>}
      </div>

      <div className="mt-3">
        {!result ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading clips ready to post">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />)}
          </div>
        ) : result.clips.length === 0 ? (
          <EmptyState icon={<CheckCheck />} title={result.runs ? 'Everything is posted' : 'No clips yet'}
            description={result.runs ? 'Every clip in your Library is posted or marked as posted. New clips show up here.' : `Make clips on ${isAvatarStudioEnabled() ? 'Clip, Remix or Avatar Studio' : 'Clip or Remix'} and the ones you have not posted show up here.`}
            action={!result.runs && onNavigate ? <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} onClick={() => onNavigate('clip')}>Create clips</Button> : undefined} />
        ) : visible.length === 0 ? (
          <div className="glass flex flex-col items-center rounded-3xl px-5 py-10 text-center">
            <Search className="h-5 w-5 text-ink-subtle" />
            <p className="mt-3 text-sm text-ink-muted">No clips match these filters.</p>
            <Button className="mt-3" size="sm" variant="ghost" onClick={() => setFilters(DEFAULT_READY_FILTERS)}>Clear filters</Button>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Clips ready to post">
            {page.map((clip) => (
              <ReadyRow key={keyOf(clip)} clip={clip} selected={selected.has(keyOf(clip))} busy={marking.has(keyOf(clip))}
                onToggle={() => toggle(clip)} onPost={() => setPosting([postable(clip)])}
                onOpenRun={() => onOpenRun(clip.outputDir)} onMarkPosted={() => void setPosted(clip, true)} />
            ))}
          </ul>
        )}
        {visible.length > shown && <div className="mt-4 flex justify-center">
          <Button variant="ghost" onClick={() => setShown((count) => count + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, visible.length - shown)} more</Button>
        </div>}
      </div>

      {posting && <PostDialog clips={posting} onNavigate={onNavigate} onClose={() => { setPosting(null); setSelected(new Set()); void load() }} />}
    </section>
  )
}

function ReadyRow({ clip, selected, busy, onToggle, onPost, onOpenRun, onMarkPosted }: {
  clip: ReadyClip
  selected: boolean
  busy: boolean
  onToggle: () => void
  onPost: () => void
  onOpenRun: () => void
  onMarkPosted: () => void
}): React.JSX.Element {
  const thumb = useLazyThumbnail(clip)
  const [failed, setFailed] = useState(false)
  return (
    <li ref={thumb.ref} data-testid="ready-clip" className={cn('glass flex flex-wrap items-center gap-3 rounded-2xl p-2 pr-3 sm:flex-nowrap', selected && 'shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.5)]')}>
      <Checkbox checked={selected} onChange={onToggle} label={`Select ${clip.title}`} className="ml-1" />
      <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-black/40 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
        {thumb.path && !failed ? <>
          <img src={localFileUrl(thumb.path)} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-xl" />
          <img src={localFileUrl(thumb.path)} alt="" draggable={false} className="relative h-full w-full object-contain" onError={() => setFailed(true)} />
        </> : <Skeleton className="h-full rounded-none" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {clip.grade && clip.gradeScore !== null && <GradeChip grade={{ grade: clip.grade, score: clip.gradeScore }} />}
          <p className="truncate text-sm font-medium text-ink" title={clip.title}>{clip.title}</p>
          {clip.state !== 'not_posted' && <Badge tone={clip.state === 'partial' || clip.state === 'failed' ? 'warning' : 'neutral'}>{LIBRARY_POSTING_LABELS[clip.state]}</Badge>}
        </div>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-subtle">
          <span className="shrink-0">{RUN_KIND_LABELS[clip.kind]}</span>
          <span className="text-ink-faint">·</span>
          <span className="truncate" title={clip.runTitle}>{clip.runTitle}</span>
          <span className="text-ink-faint">·</span>
          <span className="shrink-0">{formatRelativeDate(clip.runDate)}</span>
          {clip.durationMs > 0 && <><span className="text-ink-faint">·</span><span className="shrink-0 tabular-nums">{formatDuration(clip.durationMs)}</span></>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={onPost} aria-label={`Post or schedule ${clip.title}`}>Post or schedule</Button>
        <Button size="sm" variant="ghost" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={onOpenRun} aria-label={`Open the run for ${clip.title}`}>Open run</Button>
        <Button size="sm" variant="ghost" icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={onMarkPosted} loading={busy} aria-label={`Mark ${clip.title} as posted`}
          title="Mark as posted if you posted it outside CreatorClips. It leaves this list.">Mark as posted</Button>
      </div>
    </li>
  )
}

/** Thumbnails load only once a row scrolls near the screen (ffmpeg runs one at a time in main). */
function useLazyThumbnail(clip: ReadyClip): { ref: (node: HTMLElement | null) => void; path: string | null } {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [near, setNear] = useState(false)
  const [path, setPath] = useState<string | null>(null)
  useEffect(() => {
    if (!node || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setNear(true) }, { rootMargin: '400px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, near])
  useEffect(() => {
    if (!near) return
    let active = true
    void loadThumbnail(clipFilePath(clip.s3Url), clip.durationMs > 0 ? clip.durationMs / 2000 : undefined).then((result) => { if (active) setPath(result) })
    return () => { active = false }
  }, [near, clip.s3Url, clip.durationMs])
  return { ref: setNode, path }
}
