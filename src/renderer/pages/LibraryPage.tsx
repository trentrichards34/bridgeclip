import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bookmark, Clapperboard, FolderOpen, ListVideo, Pencil, RefreshCw, Scissors, Search, Sparkles, Trash2 } from 'lucide-react'
import { ActionMenu } from '../components/ui/ActionMenu'
import { LibraryClipGrid, StatusTiles, type ClipFilter } from '../components/LibraryClips'
import { useLibrarySummaryStore } from '../store/use-library-summary-store'
import { useActiveJobs, useJobStore } from '../store/use-job-store'
import type { LibraryClipItem } from '../../shared/library-summary'
import { getApi } from '../lib/ipc'
import { useDataVersion } from '../store/use-data-version-store'
import { cn, errorMessage, formatRelativeDate, formatUsd, localFileUrl } from '../lib/utils'
import { clipFilePath, loadThumbnail } from '../lib/thumbnails'
import { useSettingsStore } from '../store/use-settings-store'
import { usePostsStore } from '../store/use-posts-store'
import type { JobOutput } from '../store/use-job-store'
import { parseJobOutput } from '../../shared/job-output'
import type { HistoryEntry } from '../../preload/index'
import { BackLink, ClipList } from '../components/ClipList'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { TextInput } from '../components/ui/Field'
import { EmptyState } from '../components/ui/EmptyState'
import { Callout } from '../components/ui/Callout'
import { Skeleton } from '../components/ui/Skeleton'
import { ConfirmDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog'
import { useLibraryMotion } from '../hooks/use-library-motion'
import { useRunSizes } from '../hooks/use-run-sizes'
import { FreeUpSpaceButton } from '../components/FreeUpSpaceDialog'
import { PreviousFolders } from '../components/PreviousFolders'
import { ReadyToPost } from '../components/ReadyToPost'
import { Segmented } from '../components/ui/Segmented'
import { formatBytes } from '../../shared/library-storage'
import './library.css'
import { useShellStore } from '../store/use-shell-store'
import type { Page as AppPage } from '../components/Sidebar'

export function LibraryPage({ onNavigate, initialRun, initialClipIndex }: { onNavigate: (page: AppPage) => void; initialRun?: string | null; initialClipIndex?: number }): React.JSX.Element {
  const initialRunOpened = useRef(false)
  const outputDirectory = useSettingsStore((s) => s.outputDirectory)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  // A search typed in the top bar opens the Library with it.
  const [query, setQuery] = useState(() => useShellStore.getState().takeLibrarySearch())
  const [open, setOpen] = useState<{ entry: HistoryEntry; output: JobOutput; clipIndex?: number; editorCandidate?: number; earlierFolder?: boolean } | null>(null)
  const [sort, setSort] = useState<'newest' | 'largest'>('newest')
  const [view, setView] = useState<'runs' | 'clips' | 'ready'>('runs')
  const [clipFilter, setClipFilter] = useState<ClipFilter>('all')
  const [clipSort, setClipSort] = useState<'newest' | 'score'>('newest')
  const summary = useLibrarySummaryStore((state) => state.summary)
  const summaryError = useLibrarySummaryStore((state) => state.error)
  const activeJobs = useActiveJobs()
  const [storageRevision, setStorageRevision] = useState(0)
  const requestId = useRef(0)
  const openRequestId = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const closeConfirm = useCallback(() => setConfirm(null), [])
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const busyRef = useRef(new Set<string>())
  const pendingBookmarks = useRef(new Map<string, boolean>())
  const [previewRevision, setPreviewRevision] = useState(0)
  const { gridRef, capture } = useLibraryMotion()
  const [bookmarkMessage, setBookmarkMessage] = useState('')
  const [counts, setCounts] = useState<Record<string, { posted: number; notPosted: number } | null>>({})
  const posts = usePostsStore((state) => state.posts)
  const postError = usePostsStore((state) => state.error)
  const configured = useSettingsStore((state) => state.zernioConfigured)
  const directoryRef = useRef(outputDirectory)
  directoryRef.current = outputDirectory

  const load = useCallback(async () => {
    const request = ++requestId.current
    setRefreshing(true)
    setError(null)
    try {
      const result = await getApi().history.list()
      if (request === requestId.current) {
        setEntries(result.filter((entry) => entry.status === 'completed').map(entry =>
          pendingBookmarks.current.has(entry.outputDir) ? { ...entry, favorite: pendingBookmarks.current.get(entry.outputDir)! } : entry))
        setPreviewRevision(revision => revision + 1)
        void useLibrarySummaryStore.getState().refresh()
      }
    } catch (err) {
      if (request === requestId.current) {
        setEntries((previous) => previous ?? [])
        setError(errorMessage(err, 'Could not load the library. Please refresh to retry.'))
      }
    } finally {
      if (request === requestId.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    setOpen(null)
    setConfirm(null)
    setCounts({})
    setBookmarkMessage('')
    setEntries(null)
    openRequestId.current++
    void load()
    return () => { requestId.current++; openRequestId.current++ }
  }, [load, outputDirectory])

  // The assistant changed the Library (deleted clips, marked posted, exported): reload what's shown.
  const libraryVersion = useDataVersion('library')
  const seenLibraryVersion = useRef(libraryVersion)
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (libraryVersion === seenLibraryVersion.current) return
    seenLibraryVersion.current = libraryVersion
    void load()
    const current = openRef.current
    if (!current) return
    void getApi().history.getJob(current.entry.outputDir).then((output) => {
      if (openRef.current?.entry.outputDir !== current.entry.outputDir) return
      const parsed = output ? parseJobOutput(output) : null
      setOpen(parsed ? { ...openRef.current, output: parsed } : null)
    }).catch(() => {})
  }, [libraryVersion, load])

  useEffect(() => {
    if (!configured || open) return
    void usePostsStore.getState().refresh()
    const timer = window.setInterval(() => { void usePostsStore.getState().refresh() }, 30000)
    return () => window.clearInterval(timer)
  }, [configured, open])

  const entryPaths = JSON.stringify(entries?.map((entry) => entry.outputDir).sort() ?? [])
  // The posts store refreshes every 30 s with a new array. Re-check posting
  // status only when a post's link to a clip or its outcome actually changed.
  const postsRevision = useMemo(() => JSON.stringify(posts.map((post) => [post.id, post.clipPath, post.status,
    post.targets.map((target) => [target.platform, target.status, target.inbox])])), [posts])
  useEffect(() => {
    if (open) return
    const paths = JSON.parse(entryPaths) as string[]
    if (!paths.length) return
    let active = true
    // One request for every run: the main process reads settings, post history
    // and automation banks once, and recovers older bank copies by byte identity.
    getApi().history.postingSummary(paths).then((results) => {
      if (active) setCounts(Object.fromEntries(results.map((result) => [result.outputDir, result.counts])))
    }).catch(() => {
      if (active) setCounts(Object.fromEntries(paths.map((path) => [path, null])))
    })
    return () => { active = false }
  }, [entryPaths, postsRevision, open, configured])

  const sizes = useRunSizes(JSON.parse(entryPaths) as string[], storageRevision + previewRevision)
  const filtered = useMemo(() => {
    if (!entries) return []
    const q = query.trim().toLowerCase()
    const matches = entries.filter((entry) => !q || entry.videoTitle.toLowerCase().includes(q))
    // Largest first: unknown sizes last, newest first among equals (the list arrives newest first).
    return sort === 'largest' ? [...matches].sort((a, b) => (sizes[b.outputDir] ?? -1) - (sizes[a.outputDir] ?? -1)) : matches
  }, [entries, query, sort, sizes])

  const bookmarked = filtered.filter(entry => entry.favorite)
  const recent = filtered.filter(entry => !entry.favorite)
  const totalClips = entries?.reduce((sum, e) => sum + e.clipCount, 0) ?? 0

  const openRun = useCallback(async (entry: HistoryEntry, clipIndex?: number, earlierFolder = false, editorCandidate?: number): Promise<void> => {
    if (busyRef.current.has(entry.outputDir)) return
    const request = ++openRequestId.current
    setError(null)
    try {
      const output = await getApi().history.getJob(entry.outputDir)
      if (request !== openRequestId.current) return
      if (!output) {
        setError('This run is no longer available. Its files may have moved or been removed.')
        return
      }
      const parsed = parseJobOutput(output)
      if (!parsed) {
        setError('This run has an unsupported or damaged result file.')
        return
      }
      setOpen({ entry, output: parsed, clipIndex, editorCandidate, earlierFolder })
      document.getElementById('page-scroll')?.scrollTo({ top: 0 })
    } catch (err) {
      if (request === openRequestId.current) setError(errorMessage(err, 'Could not open this run.'))
    }
  }, [])

  useEffect(() => {
    if (!initialRun || !entries || initialRunOpened.current) return
    initialRunOpened.current = true
    const entry = entries.find((item) => item.outputDir === initialRun)
    if (entry) void openRun(entry, initialClipIndex)
    else setError('The source run is no longer in this Library. It may have been moved or deleted.')
  }, [initialRun, initialClipIndex, entries, openRun])

  const changeRun = async (entry: HistoryEntry, action: 'favorite' | 'delete'): Promise<void> => {
    if (busyRef.current.has(entry.outputDir)) return
    busyRef.current.add(entry.outputDir)
    setBusy(new Set(busyRef.current))
    const directory = directoryRef.current
    ++requestId.current
    ++openRequestId.current
    setRefreshing(false)
    setError(null)
    const favorite = !entry.favorite
    if (action === 'favorite') {
      pendingBookmarks.current.set(entry.outputDir, favorite)
      capture(entry.outputDir)
      setEntries(current => current?.map(item => item.outputDir === entry.outputDir ? { ...item, favorite } : item) ?? null)
      setBookmarkMessage('')
    }
    try {
      if (action === 'delete') await getApi().history.delete(entry.outputDir)
      else await getApi().history.setFavorite(entry.outputDir, favorite)
      if (directoryRef.current !== directory) return
      if (action === 'delete') { setEntries(current => current?.filter(item => item.outputDir !== entry.outputDir) ?? null); void useLibrarySummaryStore.getState().refresh() }
      else {
        setEntries(current => current?.map(item => item.outputDir === entry.outputDir ? { ...item, favorite } : item) ?? null)
        setBookmarkMessage(favorite ? `Bookmarked “${entry.videoTitle}”.` : `Removed “${entry.videoTitle}” from bookmarks.`)
      }
    } catch (cause) {
      if (directoryRef.current === directory) {
        if (action === 'favorite') {
          capture(entry.outputDir)
          setEntries(current => current?.map(item => item.outputDir === entry.outputDir ? { ...item, favorite: entry.favorite } : item) ?? null)
        }
        setError(errorMessage(cause, action === 'delete' ? 'Could not delete this run. Refresh the Library to check its files.' : 'Could not save this bookmark. Please try again.'))
      }
    } finally {
      // A list requested during the write may still contain the old disk value.
      if (directoryRef.current === directory) { ++requestId.current; setRefreshing(false) }
      pendingBookmarks.current.delete(entry.outputDir)
      busyRef.current.delete(entry.outputDir)
      setBusy(new Set(busyRef.current))
    }
  }

  const confirmDelete = (entry: HistoryEntry): void => setConfirm({
    title: 'Delete this Library item?',
    body: <>Permanently delete “{entry.videoTitle}” and all {entry.clipCount} clips, plus every other file in its run folder? This includes saved transcripts, previews and logs. This cannot be undone. Published posts and copies saved outside this folder remain.<span className="mt-3 block break-all text-xs text-ink-subtle">{entry.outputDir}</span></>,
    confirmLabel: 'Delete local files',
    onConfirm: () => { void changeRun(entry, 'delete') }
  })

  if (open) {
    return (
      <ClipList
        output={open.output}
        outputDir={open.entry.outputDir}
        initialClipIndex={open.clipIndex}
        initialEditorCandidate={open.editorCandidate}
        onNavigate={onNavigate}
        leading={<>
          <BackLink label="Library" onClick={() => {
            setOpen(null)
            setCounts({})
            void load()
          }} />
          {open.earlierFolder && <Callout tone="info" className="mt-3">This run is in an earlier output folder. You can watch and export its clips. To edit it, delete it or change its call to action, go back to the Library and move it to your current folder.</Callout>}
        </>}
      />
    )
  }

  const hasRuns = Boolean(entries && entries.length > 0)
  const entryFor = (outputDir: string): HistoryEntry | null => entries?.find((item) => item.outputDir === outputDir) ?? null
  const openClip = (item: LibraryClipItem, editor: boolean): void => {
    const entry = entryFor(item.outputDir)
    if (!entry) { setError('This run is no longer in the Library list. Refresh the Library and try again.'); void load(); return }
    void openRun(entry, editor || item.status !== 'exported' ? undefined : item.index, false, editor ? item.index : undefined)
  }
  const pickStatus = (status: ClipFilter): void => {
    setView('clips')
    setClipFilter((current) => current === status ? 'all' : status)
  }
  const totalSize = Object.values(sizes).reduce<number>((sum, size) => sum + (typeof size === 'number' ? size : 0), 0)
  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Studio"
        title="Your clips"
        description={
          entries && entries.length > 0
            ? <span className="font-mono text-xs tabular text-ink-subtle"><span>{entries.length} run{entries.length === 1 ? '' : 's'} · {totalClips} clips</span>{totalSize > 0 && <span title="Size of these runs’ folders on disk"> · {formatBytes(totalSize)}</span>}</span>
            : 'Every run you finish lands here.'
        }
        actions={
          <>
            <Button variant="ghost" icon={<ListVideo className="h-4 w-4" />} onClick={() => onNavigate('jobs')}>
              Jobs
            </Button>
            <Button
              variant="ghost"
              iconOnly
              aria-label="Refresh"
              title="Refresh"
              onClick={() => { void load(); if (configured) void usePostsStore.getState().refresh(true) }}
              disabled={refreshing || busy.size > 0}
              icon={<RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />}
            />
            {hasRuns && <FreeUpSpaceButton onFreed={() => { setStorageRevision((value) => value + 1); void load() }} />}
            {hasRuns && outputDirectory && (
              <Button icon={<FolderOpen className="h-4 w-4" />} onClick={() => getApi().shell.openPath(outputDirectory)}>
                Open folder
              </Button>
            )}
          </>
        }
      />

      {error && (
        <Callout tone="danger" className="mt-4" onDismiss={() => setError(null)}>
          {error}
        </Callout>
      )}
      {configured && postError && <Callout tone="warning" className="mt-4">{postError} Showing saved posting status.</Callout>}

      {(hasRuns || activeJobs.length > 0) && (
        <StatusTiles summary={summary} processing={activeJobs.length} active={view === 'clips' && clipFilter !== 'all' ? clipFilter : null} onPick={pickStatus} />
      )}

      {entries && entries.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
            {view === 'runs' ? 'All runs' : view === 'ready' ? 'Ready to post' : clipFilter === 'all' ? 'All clips' : `${clipFilter === 'processing' ? 'Processing' : clipFilter === 'refining' ? 'Refining' : clipFilter === 'ready' ? 'Ready' : 'Exported'} clips`}
          </h2>
          {view === 'runs' && <span className="font-mono text-xs tabular text-ink-subtle">{filtered.length}</span>}
          {view === 'clips' && clipFilter !== 'all' && <Button size="sm" variant="ghost" onClick={() => setClipFilter('all')}>Show every status</Button>}
          <Segmented className="ml-auto" label="Library view" value={view} onChange={setView}
            options={[{ value: 'runs', label: 'Runs' }, { value: 'clips', label: 'Clips' }, { value: 'ready', label: 'Ready to post' }]} />
        </div>
      )}

      {view === 'ready' && entries && entries.length > 0 ? (
        <ReadyToPost onNavigate={onNavigate} onOpenRun={(outputDir) => {
          const entry = entries.find((item) => item.outputDir === outputDir)
          if (entry) void openRun(entry)
          else { setError('This run is no longer in the Library list. Refresh the Library and try again.'); void load() }
        }} />
      ) : view === 'clips' && entries && entries.length > 0 ? <>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <TextInput
            className="max-w-sm flex-1 rounded-full"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by clip or video title"
            leading={<Search className="h-3.5 w-3.5" />}
            aria-label="Search clips"
          />
          <Segmented size="sm" label="Clip status" value={clipFilter} onChange={setClipFilter}
            options={[{ value: 'all', label: 'All' }, { value: 'refining', label: 'Refining' }, { value: 'ready', label: 'Ready' }, { value: 'exported', label: 'Exported' }, { value: 'processing', label: 'Processing' }]} />
          <Segmented size="sm" label="Sort clips" value={clipSort} onChange={setClipSort}
            options={[{ value: 'newest', label: 'Newest' }, { value: 'score', label: 'Best score' }]} />
        </div>
        {summaryError && <Callout tone="warning" className="mt-3">{summaryError} Refresh the Library to try again.</Callout>}
        <div className="mt-4">
          <LibraryClipGrid summary={summary} error={summaryError} jobs={activeJobs} query={query} filter={clipFilter} sort={clipSort}
            onOpenRun={(item) => openClip(item, false)} onEdit={(item) => openClip(item, true)}
            onOpenJobs={() => { useJobStore.getState().focusJob(activeJobs[0]?.id ?? null); onNavigate('jobs') }}
            onReveal={(item) => {
              if (item.media?.kind !== 'clip') return
              void getApi().shell.showItemInFolder(clipFilePath(item.media.url)).then((shown) => { if (!shown) setError('This clip file is no longer available.') })
                .catch((err) => setError(errorMessage(err, 'Could not show this clip in its folder.')))
            }}
            onExport={(item) => {
              if (item.media?.kind !== 'clip') return
              void getApi().clips.bulkExport([{ path: clipFilePath(item.media.url), name: item.title }]).then((result) => {
                if (!result.success && result.failedCount) setError('This clip could not be copied to that folder.')
                else if (result.success) setBookmarkMessage(`Exported “${item.title}”.`)
              }).catch((err) => setError(errorMessage(err, 'Could not export this clip. Please try again.')))
            }} />
        </div>
      </> : <>
      {entries && entries.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <TextInput
            className="max-w-sm flex-1 rounded-full"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by video title"
            leading={<Search className="h-3.5 w-3.5" />}
            aria-label="Search runs"
          />
          <Segmented size="sm" label="Sort runs" value={sort} onChange={setSort}
            options={[{ value: 'newest', label: 'Newest' }, { value: 'largest', label: 'Largest first' }]} />
        </div>
      )}

      <div className="mt-4">
        {entries === null ? (
          <div className="library-grid" aria-busy="true" aria-label="Loading library">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="library-card">
                <Skeleton className="aspect-[9/16] w-[76px] rounded-[9px]" />
                <div className="flex-1 space-y-2.5 py-1">
                  <Skeleton className="h-3 w-1/4 rounded-full" />
                  <Skeleton className="h-3.5 w-3/4 rounded-full" />
                  <Skeleton className="h-3 w-1/3 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Clapperboard />}
            title="No videos yet"
            description="Everything you make lands here, newest first: clips from Create, reaction videos from Remix, reels from Edit my recording and Avatar Studio videos."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" size="lg" icon={<Sparkles className="h-4 w-4" />} onClick={() => onNavigate('clip')}>
                  Create clips
                </Button>
                <Button size="lg" icon={<Clapperboard className="h-4 w-4" />} onClick={() => onNavigate('remix')}>Remix a video</Button>
                <Button size="lg" icon={<Scissors className="h-4 w-4" />} onClick={() => onNavigate('edit')}>Edit my recording</Button>
              </div>
            }
          />
        ) : filtered.length === 0 ? (
          <div className="glass flex flex-col items-center rounded-2xl px-5 py-10 text-center">
            <Search className="h-5 w-5 text-ink-subtle" />
            <p className="mt-3 text-sm text-ink-muted">No runs match “{query}”.</p>
          </div>
        ) : (
          <div ref={gridRef} className="library-grid">
            {[
              ...(bookmarked.length ? [{ key: 'bookmarked', title: 'Bookmarked', items: bookmarked }] : []),
              ...(recent.length ? [{ key: 'recent', title: bookmarked.length ? 'Recent runs' : 'All runs', items: recent }] : [])
            ].flatMap(group => [
              // With no bookmarks, the list's own "All runs" heading above says it all.
              bookmarked.length > 0 && <div key={`heading:${group.key}`} data-library-layout={`heading:${group.key}`} className="library-section-heading">
                {group.key === 'bookmarked' && <Bookmark size={14} className="text-tool" fill="currentColor" aria-hidden />}
                <h2 className="eyebrow !text-ink-muted">{group.title}</h2>
                <span className="font-mono text-2xs tabular text-ink-subtle">{group.items.length}</span>
              </div>,
              ...group.items.map(entry => <div key={entry.outputDir} data-library-layout={entry.outputDir} data-bookmarked={Boolean(entry.favorite)} className="library-run-slot">
              <RunCard
                entry={entry}
                size={sizes[entry.outputDir]}
                previewRevision={previewRevision}
                counts={counts[entry.outputDir]}
                busy={busy.has(entry.outputDir)}
                onFavorite={() => { void changeRun(entry, 'favorite') }}
                onDelete={() => confirmDelete(entry)}
                onOpen={() => openRun(entry)}
                onOpenFolder={async () => {
                  try {
                    if (!await getApi().shell.openPath(entry.outputDir)) setError('This run folder is no longer available.')
                  } catch (err) {
                    setError(errorMessage(err, 'Could not open this run folder.'))
                  }
                }}
              />
              </div>)
            ])}
          </div>
        )}
      </div>
      <PreviousFolders revision={storageRevision} onOpen={(entry) => { void openRun(entry, undefined, true) }} onMoved={() => { setStorageRevision((value) => value + 1); void load() }} />
      </>}
      <p className="sr-only" role="status" aria-live="polite">{bookmarkMessage}</p>
      {confirm && <ConfirmDialog request={confirm} onClose={closeConfirm} />}
    </Page>
  )
}

const MADE_WITH: Record<string, string> = { create: 'Create', remix: 'Remix', avatar: 'Avatar Studio', edit: 'Edit my recording', listicle: 'Avatar Studio', broll: 'B-roll video' }

function RunCard({ entry, size, previewRevision, counts, busy, onFavorite, onDelete, onOpen, onOpenFolder }: {
  entry: HistoryEntry
  /** Size on disk; undefined while measuring, null when unreadable. */
  size?: number | null
  previewRevision: number
  counts: { posted: number; notPosted: number } | null | undefined
  busy: boolean
  onFavorite: () => void
  onDelete: () => void
  onOpen: () => void
  onOpenFolder: () => void
}): React.JSX.Element {
  const failed = entry.status !== 'completed'
  const { thumb, remaining } = useRunPreview(failed ? null : entry, previewRevision)
  const editing = remaining !== null && remaining > 0
  const [previewFailed, setPreviewFailed] = useState(false)
  useEffect(() => { setPreviewFailed(false) }, [thumb, previewRevision])
  const made = entry.madeWith ? MADE_WITH[entry.madeWith] : null
  const clipsLabel = entry.editorProject && entry.clipCount === 0 ? entry.candidateCount == null ? 'Clip candidates' : `${entry.candidateCount} candidates` : `${entry.clipCount} clip${entry.clipCount === 1 ? '' : 's'}`

  return (
    <article className={cn('library-card group', editing ? 'status-refining' : failed ? 'status-failed' : 'status-exported', editing && 'editing')}>
      <button type="button" className="library-card-main" disabled={busy} onClick={failed ? onOpenFolder : onOpen} aria-label={`Open ${entry.videoTitle}`}>
      <div className="library-thumb">
        {thumb && !previewFailed ? (
          <>
            {/* The frame sits on a blurred copy of itself to fill the 9:16 slot. */}
            <img src={localFileUrl(thumb)} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-xl saturate-150" />
            <img
              src={localFileUrl(thumb)}
              alt=""
              draggable={false}
              className="relative h-full w-full object-contain transition-transform duration-500 ease-out group-hover:scale-[1.04]"
              onError={() => setPreviewFailed(true)}
            />
          </>
        ) : failed ? (
          <span className="library-thumb-empty text-danger/80"><AlertTriangle className="h-5 w-5" /></span>
        ) : (
          <Skeleton className="h-full rounded-none" />
        )}
      </div>
      <div className="library-card-body">
        <span className="library-card-top">
          {editing ? <span className="library-pill status-refining"
            aria-label={`Editing: ${remaining} clip${remaining === 1 ? '' : 's'} left to finish`} title={`${remaining} clip${remaining === 1 ? '' : 's'} left to finish`}>
            <Pencil className="h-2.5 w-2.5" aria-hidden="true" />Editing<span className="opacity-80">· {remaining} left</span>
          </span> : failed ? <span className="library-pill status-failed">{entry.status === 'incomplete' ? 'Unfinished' : 'Unreadable'}</span>
            : entry.clipCount > 0 ? <span className="library-pill status-exported">Exported</span> : <span className="library-pill status-neutral">No clips</span>}
        </span>
        <span className="library-card-title" title={entry.videoTitle}>
          {failed ? `${entry.status === 'incomplete' ? 'Unfinished' : 'Unreadable'} run · Open folder` : entry.videoTitle}
        </span>
        {!failed && <span className="library-card-source">{made && <>{made}<span className="text-ink-faint"> · </span></>}<span>{clipsLabel}</span></span>}
        <span className="library-card-source" title="Only fully published clips count as posted. Scheduled, partial and inbox deliveries remain Not Posted.">
          {entry.editorProject && entry.clipCount === 0 ? remaining === 0 ? 'No clips to finish' : 'No clips baked yet' : counts ? counts.posted > 0 ? <><span className="text-success">{counts.posted} Posted</span><span className="mx-1.5 text-ink-faint">·</span><span>{counts.notPosted} Not Posted</span></> : <span>{counts.notPosted} Not Posted</span>
            : counts === null ? 'Posting status unavailable' : 'Checking posting status…'}
        </span>
        <span className="library-card-meta font-mono tabular">
          <span>{formatRelativeDate(entry.date)}</span>
          {entry.totalCostUsd != null && <><span className="text-ink-faint"> · </span><span>{formatUsd(entry.totalCostUsd)}</span></>}
          {typeof size === 'number' && <><span className="text-ink-faint"> · </span><span title="Size of this run’s folder on disk" data-testid="run-size">{formatBytes(size)}</span></>}
        </span>
      </div>
      </button>
      <div className="library-card-menu">
        <Button size="sm" iconOnly className="glass-chip library-bookmark" aria-disabled={busy || undefined}
          tooltip={entry.favorite ? 'Remove bookmark. This run returns to its place among your recent runs.' : 'Bookmark this run to keep it in the Bookmarked section.'}
          aria-label={`${entry.favorite ? 'Remove bookmark from' : 'Bookmark'} ${entry.videoTitle}`} aria-pressed={Boolean(entry.favorite)}
          onClick={() => { if (!busy) onFavorite() }} icon={<Bookmark className="h-3.5 w-3.5" fill={entry.favorite ? 'currentColor' : 'none'} />} />
        <ActionMenu label={`More actions for ${entry.videoTitle}`} disabled={busy} triggerClassName="glass-chip"
          actions={[
            { label: 'Open folder', icon: <FolderOpen size={14} />, onSelect: onOpenFolder },
            { label: 'Delete this Library item…', icon: <Trash2 size={14} />, danger: true, onSelect: onDelete }
          ]} />
      </div>
    </article>
  )
}

/** Saved editing progress and the best clip's thumbnail (or source preview). */
function useRunPreview(entry: HistoryEntry | null, revision: number): { thumb: string | null; remaining: number | null } {
  const [thumb, setThumb] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const outputDir = entry?.outputDir
  useEffect(() => {
    if (!outputDir) { setThumb(null); setRemaining(null); return }
    let cancelled = false
    getApi()
      .history.getJob(outputDir)
      .then(async (raw) => {
        const output = parseJobOutput(raw)
        const best = output?.clips.reduce<JobOutput['clips'][number] | null>(
          (top, c) => (!top || c.virality_score > top.virality_score ? c : top),
          null
        )
        if (cancelled) return null
        setRemaining(null)
        if (output?.editor_project) {
          try {
            // Counts only, cached by main until the project file changes.
            const progress = await getApi().editor.progress(outputDir)
            if (cancelled) return null
            setRemaining(progress.remaining)
            if (!best && progress.previewPath) return loadThumbnail(progress.previewPath, progress.thumbnailMs / 1000)
          } catch { /* Existing exports remain usable if the editor project is unavailable. */ }
        }
        if (cancelled) return null
        if (!best) return null
        return loadThumbnail(clipFilePath(best.s3_url), best.duration_ms > 0 ? best.duration_ms / 2000 : undefined)
      })
      .then((path) => {
        if (!cancelled) setThumb(path ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [outputDir, entry?.clipCount, entry?.candidateCount, entry?.editorProject, entry?.date, revision])
  return { thumb, remaining }
}
