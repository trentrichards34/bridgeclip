import { SavedStageTimings } from './StageBreakdown'
import { ClipCtaDialog } from './CtaPicker'
import { RemixEditDialog } from './RemixEditDialog'
import { MoreClipsButton } from './MoreClipsDialog'
import { useJobStore } from '../store/use-job-store'
import { parseJobOutput, type ClipScreenFocus } from '../../shared/job-output'
import { editorProgress, type AutomaticEditInfo } from '../../shared/clip-editor'
import { ClipEditor } from './ClipEditor'
import { EditAutomaticDialog } from './EditAutomaticDialog'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronDown, Clapperboard, Download, FileArchive, FolderOpen, ListPlus, Plus, Scissors, Search, Send, Trash2, Youtube } from 'lucide-react'
import { basename, cn, errorMessage } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { clipFilePath } from '../lib/thumbnails'
import type { ApiCosts, ClipArtifact, JobOutput } from '../store/use-job-store'
import { ClipCard } from './ClipCard'
import { EditInspector } from './EditInspector'
import { EditorialWeights } from './EditorialWeights'
import { defaultWeights, editorialScore } from '../../shared/editorial'
import { youtubeSourceUrl } from '../../shared/video-source'
import { RunStats } from './RunStats'
import { AddToAutomationDialog } from './AddToAutomationDialog'
import { PostDialog, type PostableClip } from './PostDialog'
import { Page } from './ui/Page'
import { PageHeader } from './ui/PageHeader'
import { Button } from './ui/Button'
import { ConfirmDialog, type ConfirmRequest } from './ui/ConfirmDialog'
import { TextInput } from './ui/Field'
import { Checkbox } from './ui/Checkbox'
import { EmptyState } from './ui/EmptyState'
import { Callout } from './ui/Callout'
import { Segmented } from './ui/Segmented'
import { usePostsStore } from '../store/use-posts-store'
import { useSettingsStore } from '../store/use-settings-store'
import { useRemixForm } from '../store/use-remix-form-store'
import type { LibraryClipPostingStatus } from '../../shared/library-posting'
import type { Page as AppPage } from './Sidebar'

/** Framework grade when graded, otherwise the planner's virality score, both on 0-10. */
function clipRank(clip: ClipArtifact): number {
  return clip.framework ? clip.framework.score : clip.virality_score * 10
}

type Sort = 'score' | 'timeline' | 'editorial'

interface ClipListProps {
  output: JobOutput
  /** The directory containing job_output.json, available for Library runs without clips. */
  outputDir?: string
  /** Exact clip linked from an automation bank; independent of editable titles. */
  initialClipIndex?: number
  /** Editor clip (candidate index) to open straight in the editor, from the Library's clip view. */
  initialEditorCandidate?: number
  /** Shown above the title, e.g. a back link from the Library. */
  leading?: ReactNode
  onNewClip?: () => void
  /** Lets the post dialog send the user to Accounts to connect a platform. */
  onNavigate?: (page: AppPage) => void
}

/** Clips the post dialog handles in one go; each is still its own upload and post. */
const MAX_POST_BATCH = 10
const MAX_BANK_BATCH = 30

export function toPostable(clip: Pick<ClipArtifact, 's3_url' | 'summary' | 'clip_index' | 'tags' | 'duration_ms' | 'ai_generated' | 'post_caption'>): PostableClip {
  return { path: clipFilePath(clip.s3_url), title: clip.summary || `Clip ${clip.clip_index + 1}`, tags: clip.tags, durationMs: clip.duration_ms, aiGenerated: clip.ai_generated === true, postCaption: clip.post_caption ?? undefined }
}

export function ClipList(props: ClipListProps): React.JSX.Element {
  return <ClipRun key={`${props.outputDir ?? ''}:${props.output.job_id}`} {...props} />
}

/** A run made on Create (Automatic or Review & edit), not Remix, Avatar Studio or Edit my recording. */
export function isCreateOutput(output: JobOutput): boolean {
  const metrics = output.metrics ?? {}
  return metrics.remix !== true && typeof metrics.avatar_studio !== 'string' && metrics.edit_recording !== true && metrics.listicle !== true && metrics.broll_video !== true
}

/** Which clip and tab the editor opens on (from a clip's "Edit headline"). */
interface EditorTarget { clip?: number; tab?: 'hook'; candidate?: number }

function ClipRun(props: ClipListProps): React.JSX.Element {
  const [output, setOutput] = useState(props.output)
  const hasEditor = output.editor_project === true && !!props.outputDir
  // Automatic Create runs open in the editor too: the first time, their clips become an editor project.
  const canEdit = !!props.outputDir && isCreateOutput(output) && (hasEditor || output.clips.length > 0) && typeof getApi().editor?.automaticInfo === 'function'
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  const [opening, setOpening] = useState(hasEditor)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [gate, setGate] = useState<{ info: AutomaticEditInfo; target: EditorTarget } | null>(null)
  useEffect(() => {
    if (!hasEditor) return
    let active = true
    void getApi().editor.open(props.outputDir!).then((session) => {
      if (!active) return
      const { remaining } = editorProgress(session.project.candidates)
      setRemaining(remaining)
      if (props.initialEditorCandidate !== undefined) setEditing({ candidate: props.initialEditorCandidate })
      else if (props.initialClipIndex === undefined && props.output.clips.length === 0 && remaining > 0) setEditing({})
    }).catch((cause) => {
      if (active) setEditorError(errorMessage(cause, 'Could not read editor progress. Open the editor to retry.'))
    }).finally(() => { if (active) setOpening(false) })
    return () => { active = false }
  // Choose the landing view once per run, without interrupting active edits.
  }, [props.outputDir])
  const refresh = async (): Promise<void> => {
    const fresh = parseJobOutput(await getApi().history.getJob(props.outputDir!))
    if (!fresh) throw new Error('Could not load the clips. Reopen this Library item to retry.')
    setOutput(fresh)
    if (fresh.editor_project) setRemaining(editorProgress((await getApi().editor.open(props.outputDir!)).project.candidates).remaining)
  }
  /** Open the editor, first making the run's editor project (or getting its video back) when needed. */
  const openEditor = async (target: EditorTarget = {}): Promise<void> => {
    setEditorError(null)
    if (!canEdit) { if (hasEditor) setEditing(target); return }
    try {
      const info = await getApi().editor.automaticInfo(props.outputDir!)
      if (info.state === 'ready') setEditing(target)
      else setGate({ info, target })
    } catch (cause) { setEditorError(errorMessage(cause, 'Could not open the editor.')) }
  }
  if (opening) return <Page width="wide">{props.leading}<p className="mt-4 text-sm text-ink-muted" role="status">Opening clips…</p></Page>
  if (editing && props.outputDir) return <ClipEditor outputDir={props.outputDir} leading={props.leading} initialClip={editing.clip} initialCandidate={editing.candidate} initialTab={editing.tab}
    onNeedSource={() => { setEditing(null); void openEditor() }}
    onExports={async () => {
      await refresh()
      setEditorError(null); setEditing(null)
    }} />
  return <>
    <GeneratedClipList {...props} output={output} onOutputChanged={(fresh) => {
      setOutput(fresh)
      if (fresh.editor_project) void getApi().editor.open(props.outputDir!).then((session) => setRemaining(editorProgress(session.project.candidates).remaining))
        .catch((cause) => setEditorError(errorMessage(cause)))
    }} editor={canEdit || hasEditor ? { remaining: hasEditor ? remaining : null, started: hasEditor, error: editorError, onOpen: (target) => { void openEditor(target) } } : undefined} />
    {gate && props.outputDir && <EditAutomaticDialog outputDir={props.outputDir} info={gate.info} onClose={() => setGate(null)} onReady={() => {
      const target = gate.target
      setGate(null)
      void refresh().catch(() => {}).finally(() => setEditing(target))
    }} />}
  </>
}

function GeneratedClipList({ output, outputDir: runDirectory, leading, onNewClip, onNavigate, initialClipIndex, editor, onOutputChanged }: ClipListProps & {
  editor?: { remaining: number | null; started: boolean; error: string | null; onOpen: (target?: EditorTarget) => void }
  onOutputChanged: (output: JobOutput) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [focusedClip, setFocusedClip] = useState(initialClipIndex)
  const search = query.trim().toLowerCase()
  const filtering = focusedClip !== undefined || search.length > 0
  const sourceUrl = youtubeSourceUrl(output.source_video_url)
  const postRecords = usePostsStore((state) => state.posts)
  const refreshError = usePostsStore((state) => state.error)
  const configured = useSettingsStore((state) => state.zernioConfigured)
  const [postingStatus, setPostingStatus] = useState<LibraryClipPostingStatus[] | null>(null)
  const [postingError, setPostingError] = useState<string | null>(null)
  const [postedExpanded, setPostedExpanded] = useState(false)
  const [unpostedExpanded, setUnpostedExpanded] = useState(true)
  const [statusRetry, setStatusRetry] = useState(0)
  const [sort, setSort] = useState<Sort>('score')
  const [weights, setWeights] = useState({ ...defaultWeights })
  const hasEditorial = output.clips.some((c) => c.editorial?.status === 'success')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletingRef = useRef(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const closeConfirm = useCallback(() => setConfirm(null), [])
  const [posting, setPosting] = useState<PostableClip[] | null>(null)
  const [bankClips, setBankClips] = useState<number[] | null>(null)
  const [ctaClip, setCtaClip] = useState<ClipArtifact | null>(null)
  const [editClip, setEditClip] = useState<ClipArtifact | null>(null)
  const [addedToBank, setAddedToBank] = useState(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exportingRef = useRef(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Older CreatorClips engine runs do not record output format; use the first thumbnail for those.
  const [aspect, setAspect] = useState<number | null>(null)
  const settings = output.metrics?.requested_settings
  const requestedAspect = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).aspect_ratio : null
  const videoSpeed = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).video_speed : null
  const vertical = requestedAspect === '9:16' ? true : requestedAspect === '16:9' ? false : aspect == null ? true : aspect < 1

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
  }, [])

  useEffect(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setSelected(new Set())
    setInspectEdits(false)
    setAspect(null)
    setPosting(null)
    setBankClips(null)
    setAddedToBank(false)
    setExportError(null)
    setNotice(null)
  }, [output])

  const [inspectEdits, setInspectEdits] = useState(false)
  const firstClip = output.clips[0]
  const outputDir = runDirectory ?? (firstClip ? clipFilePath(firstClip.s3_url).replace(/[\\/][^\\/]+$/, '') : '')

  const asPostable = (clip: ClipArtifact): PostableClip => ({ ...toPostable(clip), library: { outputDir, clipIndex: clip.clip_index } })
  // Remix with this clip as the source file (main checks and authorizes it), then open Remix.
  const remixClip = async (clip: ClipArtifact): Promise<void> => {
    setExportError(null)
    try {
      const source = await getApi().remix.libraryClip(outputDir, clip.clip_index)
      useRemixForm.getState().setSourceFile(source.path, source.creator, clip.duration_ms > 0 ? clip.duration_ms / 1000 : undefined, !source.clean)
      onNavigate?.('remix')
    } catch (cause) { setExportError(errorMessage(cause, 'This clip could not be opened in Remix.')) }
  }

  useEffect(() => {
    if (!configured) return
    void usePostsStore.getState().refresh()
    const timer = window.setInterval(() => { void usePostsStore.getState().refresh() }, 30000)
    return () => window.clearInterval(timer)
  }, [configured])

  useEffect(() => {
    let active = true
    setPostingError(null)
    if (!outputDir) { setPostingStatus(null); return }
    void getApi().history.postingStatus(outputDir).then((statuses) => { if (active) setPostingStatus(statuses) })
      .catch((cause) => { if (active) { setPostingStatus(null); setPostingError(errorMessage(cause, 'Could not read posting history.')) } })
    return () => { active = false }
  }, [outputDir, postRecords, statusRetry])

  useEffect(() => { setPostingStatus(null); setPostedExpanded(false); setUnpostedExpanded(true) }, [outputDir])

  const topIndex = useMemo(() => {
    let best: ClipArtifact | null = null
    for (const clip of output.clips) if (!best || clipRank(clip) > clipRank(best)) best = clip
    return best?.clip_index ?? null
  }, [output.clips])

  const clips = useMemo(() => {
    const list = output.clips.filter((clip) => {
      if (focusedClip !== undefined && clip.clip_index !== focusedClip) return false
      return !search || [clip.summary, `Clip ${clip.clip_index + 1}`, ...(clip.tags ?? [])].join(' ').toLowerCase().includes(search)
    })
    if (sort === 'editorial') return list.sort((a, b) => (editorialScore(b.editorial, weights) ?? -1) - (editorialScore(a.editorial, weights) ?? -1))
    return sort === 'score'
      ? list.sort((a, b) => clipRank(b) - clipRank(a))
      : list.sort((a, b) => a.start_time_ms - b.start_time_ms)
  }, [output.clips, sort, weights, focusedClip, search])

  const statusByClip = new Map(postingStatus?.map((status) => [status.clipIndex, status]))
  const unposted = clips.filter((clip) => statusByClip.get(clip.clip_index)?.state !== 'posted')
  const posted = clips.filter((clip) => statusByClip.get(clip.clip_index)?.state === 'posted')
  const visibleClips = filtering ? clips : [...(unpostedExpanded ? unposted : []), ...(postedExpanded ? posted : [])]
  const visibleIds = visibleClips.map((clip) => clip.clip_index).join(',')
  useEffect(() => {
    const visible = new Set(visibleIds.split(',').filter(Boolean).map(Number))
    setSelected((previous) => new Set([...previous].filter((index) => visible.has(index))))
  }, [visibleIds])
  const allSelected = visibleClips.length > 0 && visibleClips.every((clip) => selected.has(clip.clip_index))

  const toggle = (index: number): void => {
    if (deletingRef.current) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const deleteSelected = async (indices: number[]): Promise<void> => {
    if (deletingRef.current || exportingRef.current) return
    deletingRef.current = true; setDeleting(true); setDeleteError(null)
    try {
      if (typeof getApi().history.deleteClips !== 'function') throw new Error('Restart CreatorClips to enable deleting selected clips.')
      const fresh = await getApi().history.deleteClips(outputDir, indices)
      onOutputChanged(fresh)
      setSelected(new Set()); setStatusRetry((value) => value + 1)
    } catch (cause) {
      // A cleanup failure can happen after the manifest was committed. Refresh
      // from disk so removed clips are never left available for posting/export.
      try {
        const fresh = parseJobOutput(await getApi().history.getJob(outputDir))
        if (fresh && JSON.stringify(fresh.clips) !== JSON.stringify(output.clips)) onOutputChanged(fresh)
      } catch { /* Keep the original deletion error visible. */ }
      setDeleteError(errorMessage(cause, 'Could not delete the selected clips. Please try again.'))
    } finally { deletingRef.current = false; setDeleting(false) }
  }
  const confirmDelete = (indices: number[]): void => {
    const targets = output.clips.filter((clip) => indices.includes(clip.clip_index))
    const picked = targets.map((clip) => clip.clip_index)
    if (!picked.length || deletingRef.current || exportingRef.current) return
    setConfirm({
      title: `Delete ${picked.length === 1 ? 'this clip' : `these ${picked.length} clips`}?`,
      body: <>Permanently delete {picked.length === 1 ? `“${targets[0].summary || `Clip ${targets[0].clip_index + 1}`}” and its local video file` : `the ${picked.length} selected clips and their local video files`}? This cannot be undone. Your source video, transcript and editor edits will be kept. Published posts and copies in automation banks or other folders will remain.</>,
      confirmLabel: picked.length === 1 ? 'Delete clip' : 'Delete clips',
      onConfirm: () => { void deleteSelected(picked) }
    })
  }

  const exportSelected = async (asZip = false): Promise<void> => {
    const picked = clips.filter((c) => selected.has(c.clip_index))
    if (picked.length === 0 || exportingRef.current || deletingRef.current) return
    exportingRef.current = true
    setExporting(true)
    setExportError(null)
    try {
      // A YouTube video (Edit my recording) says so in its file name.
      const format = output.metrics?.format === 'youtube' ? ' (YouTube)' : ''
      const list = picked.map((c) => ({ path: clipFilePath(c.s3_url), name: `${c.summary || `Clip ${c.clip_index + 1}`}${format}` }))
      const result = asZip ? await getApi().clips.exportZip(list, `${output.source_video_title || 'CreatorClips clips'}${format}`) : await getApi().clips.bulkExport(list)
      if (result.success) {
        setAddedToBank(false)
        setNotice(`Exported ${result.count} clip${result.count === 1 ? '' : 's'}${result.destDir ? ` to ${basename(result.destDir)}` : ''}${result.failedCount ? `; ${result.failedCount} could not be copied` : ''}`)
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(null), 3500)
      } else if (result.failedCount) {
        setExportError('No clips could be copied to that folder.')
      }
    } catch (err) {
      setExportError(errorMessage(err, 'Could not export clips. Please try again.'))
    } finally {
      exportingRef.current = false
      setExporting(false)
    }
  }

  const costs = readCosts(output.metrics?.api_costs)
  const framingNotice = framingProblem(output, vertical)
  const analysisNotice = sourceAnalysisNotice(output)
  const screenFocusByClip = screenFocusByIndex(output)

  const renderGrid = (items: ClipArtifact[]): React.JSX.Element => (
        <div
          className={cn(
            'mt-4 grid gap-5',
            vertical
              ? 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'
              : 'grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'
          )}
        >
          {items.map((clip) => (
            <ClipCard
              key={clip.clip_index}
              clip={clip}
              screenFocus={screenFocusByClip.get(clip.clip_index)}
              postingStatus={statusByClip.get(clip.clip_index)}
              vertical={vertical}
              topPick={clip.clip_index === topIndex && clips.length > 1}
              selected={selected.has(clip.clip_index)}
              selecting={selected.size > 0}
              onToggleSelect={() => toggle(clip.clip_index)}
              onAspect={aspect == null ? setAspect : undefined}
              onPost={() => setPosting([asPostable(clip)])}
              onAddToAutomation={outputDir ? () => setBankClips([clip.clip_index]) : undefined}
              onDelete={outputDir ? () => confirmDelete([clip.clip_index]) : undefined}
              onChangeCta={outputDir ? () => setCtaClip(clip) : undefined}
              onEditVideo={outputDir && clip.editable ? () => setEditClip(clip) : undefined}
              onEditHeadline={editor ? () => editor.onOpen({ clip: clip.clip_index, tab: 'hook' }) : undefined}
              onRemix={outputDir && onNavigate ? () => void remixClip(clip) : undefined}
              actionsDisabled={deleting || exporting}
              onSetPosted={outputDir ? async (posted) => {
                if (!getApi().history.setPosted) throw new Error('Restart CreatorClips to enable manual posted marks.')
                await getApi().history.setPosted(outputDir, clip.clip_index, posted)
                setStatusRetry((value) => value + 1)
                if (posted) setPostedExpanded(true)
                else setUnpostedExpanded(true)
              } : undefined}
            />
          ))}
        </div>
  )

  return (
    <Page width="wide">
      <PageHeader
        leading={leading}
        eyebrow={leading ? undefined : 'Your clips'}
        title={output.source_video_title || 'Untitled video'}
        description={editor?.remaining ? `${editor.remaining} clip${editor.remaining === 1 ? '' : 's'} left to finish` : undefined}
        actions={
          <>
            {editor && <Button disabled={deleting} variant={editor.remaining ? 'primary' : 'ghost'} icon={<Scissors className="h-4 w-4" />} onClick={() => editor.onOpen()}
              title={editor.started ? undefined : 'Rewrite or remove headlines, and change cuts, framing and captions. Baking a clip replaces it here.'}>
              {editor.remaining ? 'Continue editing' : editor.started ? 'Open editor' : 'Edit clips'}
            </Button>}
            {outputDir && <Button onClick={() => setInspectEdits(true)}>Inspect transcript & edits</Button>}
            {sourceUrl && <Button iconOnly icon={<Youtube className="h-4 w-4" />} aria-label="Open original video on YouTube" title="Open original video on YouTube"
              onClick={() => { setExportError(null); void getApi().shell.openPath(sourceUrl).catch(() => setExportError('Could not open the original video in your browser.')) }} />}
            {outputDir && onNavigate && <MoreClipsButton outputDir={outputDir} onStarted={(jobId) => { useJobStore.getState().focusJob(jobId); onNavigate('jobs') }} />}
            {outputDir && (
              <Button icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => getApi().shell.openPath(outputDir)}>
                Open folder
              </Button>
            )}
            {onNewClip && (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={onNewClip}>
                New clip
              </Button>
            )}
          </>
        }
      />

      {editor?.error && <Callout tone="warning" className="mt-3">{editor.error}</Callout>}

      {typeof videoSpeed === 'number' && videoSpeed > 1 && (
        <p className="mt-3 text-xs text-ink-muted">All clips exported at {videoSpeed}× speed · Original voice pitch</p>
      )}

      {(deleteError || exportError) && (
        <Callout tone="danger" className="mt-3" onDismiss={() => { setExportError(null); setDeleteError(null) }}>
          {deleteError || exportError}
        </Callout>
      )}

      <div className="mt-4">
        <RunStats key={output.job_id} output={output} costs={costs} videoSpeed={typeof videoSpeed === 'number' && videoSpeed > 1 ? videoSpeed : null} />
      </div>

      <SavedStageTimings stages={output.metrics?.pipeline_stages} diagnostics={output.metrics?.diagnostics} />
      {framingNotice && (
        <Callout tone="warning" className="mt-3">
          <span className="text-ink-muted">{framingNotice}</span>
        </Callout>
      )}

      {analysisNotice && (
        <Callout tone="warning" className="mt-3">
          <span className="text-ink-muted">{analysisNotice}</span>
        </Callout>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <TextInput className="w-full max-w-sm" aria-label="Search clips" placeholder="Search clips by title, tag or number"
          value={query} onChange={(event) => { setQuery(event.target.value); setFocusedClip(undefined) }}
          leading={<Search className="h-3.5 w-3.5" />} />
        {focusedClip !== undefined && <span className="text-sm text-ink-muted">From content bank · Clip {focusedClip + 1}</span>}
        {filtering && <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setFocusedClip(undefined) }}>Show all clips</Button>}
      </div>

      {/* Floating glass toolbar; sticks just below the 40px title-bar strip. */}
      <div className="glass-thick sticky top-0 z-20 mt-4 flex items-center justify-between gap-3 rounded-2xl py-1.5 pl-3 pr-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <Checkbox
            disabled={deleting}
            checked={allSelected}
            indeterminate={selected.size > 0 && !allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(visibleClips.map((c) => c.clip_index)))}
            label="Select all clips"
          />
          <span className="whitespace-nowrap text-sm text-ink-muted">
            {selected.size > 0 ? (
              <>
                <span className="font-medium text-ink">{selected.size}</span> selected
              </>
            ) : (
              filtering ? `${clips.length} of ${output.clips.length} clips` : `${clips.length} clips`
            )}
          </span>
          {notice && (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-success/[0.1] px-2.5 py-1 text-xs text-success shadow-[inset_0_0_0_1px_rgb(var(--success)/0.25)] animate-fade-in">
              <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
              <span className="truncate">{notice}</span>
              {addedToBank && onNavigate && <button className="shrink-0 font-semibold underline underline-offset-2" onClick={() => onNavigate('automations')}>View bank</button>}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selected.size > 0 && (
            <div className="flex items-center gap-1.5 animate-fade-in">
              <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                size="sm"
                icon={<Send className="h-3.5 w-3.5" />}
                disabled={deleting || selected.size > MAX_POST_BATCH}
                title={selected.size > MAX_POST_BATCH ? `Post up to ${MAX_POST_BATCH} clips at a time` : undefined}
                onClick={() => setPosting(clips.filter((c) => selected.has(c.clip_index)).map(asPostable))}
              >
                Post {selected.size}
              </Button>
              {outputDir && <Button
                size="sm"
                icon={<ListPlus className="h-3.5 w-3.5" />}
                disabled={deleting || selected.size > MAX_BANK_BATCH}
                title={selected.size > MAX_BANK_BATCH ? `Add up to ${MAX_BANK_BATCH} clips at a time` : 'Copy selected clips to an automation content bank'}
                onClick={() => setBankClips(clips.filter((clip) => selected.has(clip.clip_index)).map((clip) => clip.clip_index))}
              >
                Add {selected.size} to automation
              </Button>}
              <Button
                size="sm"
                variant="primary"
                loading={exporting}
                disabled={deleting}
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => void exportSelected()}
                title="Copy the selected clips to a folder"
              >
                Export {selected.size}
              </Button>
              <Button size="sm" disabled={deleting || exporting} icon={<FileArchive className="h-3.5 w-3.5" />} onClick={() => void exportSelected(true)}
                title="Save the selected clips as one .zip file">
                .zip
              </Button>
              {outputDir && <Button variant="danger" size="sm" iconOnly aria-label="Delete selected clips" title="Delete selected clips"
                icon={<Trash2 className="h-3.5 w-3.5" />} loading={deleting} disabled={exporting} onClick={() => confirmDelete(clips.filter((clip) => selected.has(clip.clip_index)).map((clip) => clip.clip_index))} />}
              <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
            </div>
          )}
          <Segmented<Sort>
            label="Sort clips"
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'score', label: 'Best first' },
              ...(hasEditorial ? [{ value: 'editorial' as const, label: 'Editorial' }] : []),
              { value: 'timeline', label: 'Timeline' }
            ]}
          />
        </div>
      </div>

      {hasEditorial && <EditorialWeights value={weights} onChange={setWeights} />}
      {filtering ? (
        clips.length ? renderGrid(clips) : <EmptyState className="mt-4" icon={<Search />}
          title={focusedClip !== undefined ? 'This clip is no longer in this run' : 'No clips match your search'}
          description={focusedClip !== undefined ? 'Show all clips to browse the remaining exports.' : 'Try another title, tag or clip number.'} />
      ) : clips.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Clapperboard />}
          title="No clips in this run"
          description={editor ? 'No saved exports remain. Open the editor to bake more clips.' : 'There are no saved clips in this run.'}
        />
      ) : (
        <>
          <div className="mt-4 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => { void usePostsStore.getState().refresh(true); setStatusRetry((value) => value + 1) }}>Refresh post status</Button>
          </div>
          {postingError && <Callout tone="warning" className="mt-3">{postingError} Clips are listed together below.</Callout>}
          {configured && refreshError && !postingError && <Callout tone="warning" className="mt-3">{refreshError} Showing saved posting status.</Callout>}
          {!postingStatus && !postingError && <p role="status" className="mt-2 text-xs text-ink-muted">Checking posting history…</p>}
          <ClipGroup title={postingStatus ? 'Not Posted' : 'Clips'} count={unposted.length} expanded={unpostedExpanded} onToggle={() => setUnpostedExpanded((value) => !value)}>
            {unposted.length ? renderGrid(unposted) : <p className="mt-3 text-sm text-ink-muted">All clips in this run have been posted.</p>}
          </ClipGroup>
          {postingStatus && <ClipGroup title="Posted" count={posted.length} expanded={postedExpanded} onToggle={() => setPostedExpanded((value) => !value)}>
            {posted.length ? renderGrid(posted) : <p className="mt-3 text-sm text-ink-muted">No clips in this run have been posted yet.</p>}
          </ClipGroup>}
        </>
      )}

      {confirm && <ConfirmDialog request={confirm} onClose={closeConfirm} />}
      {posting && <PostDialog clips={posting} onClose={() => setPosting(null)} onNavigate={onNavigate} />}
      {inspectEdits && <EditInspector outputDir={outputDir} onClose={() => setInspectEdits(false)} />}
      {ctaClip && outputDir && <ClipCtaDialog
        title={ctaClip.summary || `Clip ${ctaClip.clip_index + 1}`}
        current={ctaClip.cta?.id ?? null}
        onClose={() => setCtaClip(null)}
        onApply={async (ctaId) => {
          const fresh = await getApi().clips.setCta(outputDir, ctaClip.clip_index, ctaId)
          onOutputChanged(fresh)
          setNotice(`${ctaId ? 'The call to action was added to the end of the clip.' : 'The call to action was removed.'} Copies already queued in an automation keep their earlier ending.`)
          if (noticeTimer.current) clearTimeout(noticeTimer.current)
          noticeTimer.current = setTimeout(() => setNotice(null), 6000)
        }}
      />}
      {editClip && outputDir && <RemixEditDialog outputDir={outputDir} clip={editClip} onClose={() => setEditClip(null)}
        onDone={(fresh, note) => {
          if (fresh) onOutputChanged(fresh)
          setNotice(note ?? 'The video was made again with your changes. Copies already queued in an automation keep their earlier version.')
          if (noticeTimer.current) clearTimeout(noticeTimer.current)
          noticeTimer.current = setTimeout(() => setNotice(null), 6000)
        }} />}
      {bankClips && outputDir && <AddToAutomationDialog
        outputDir={outputDir}
        clipIndices={bankClips}
        onClose={() => setBankClips(null)}
        onAdded={(name) => {
          setBankClips(null)
          setSelected(new Set())
          setAddedToBank(true)
          setNotice(`Added ${bankClips.length} clip${bankClips.length === 1 ? '' : 's'} to ${name}.`)
          if (noticeTimer.current) clearTimeout(noticeTimer.current)
          noticeTimer.current = setTimeout(() => setNotice(null), 6000)
        }}
      />}
    </Page>
  )
}

function ClipGroup({ title, count, expanded, onToggle, children }: { title: string; count: number; expanded: boolean; onToggle: () => void; children: ReactNode }): React.JSX.Element {
  const id = useId()
  return <section className="mt-4">
    <h2>
      <button type="button" id={`${id}-heading`} aria-expanded={expanded} aria-controls={`${id}-content`} onClick={onToggle}
        className="glass-well flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-base font-semibold text-ink transition-colors hover:bg-white/[0.06]">
        <ChevronDown aria-hidden className={cn('h-4 w-4 shrink-0 text-ink-muted transition-transform', !expanded && '-rotate-90')} />
        <span>{title}</span><span className="ml-auto font-mono text-sm font-normal tabular text-ink-muted">{count}</span>
      </button>
    </h2>
    <div id={`${id}-content`} role="region" aria-labelledby={`${id}-heading`} hidden={!expanded}>{expanded && children}</div>
  </section>
}

/** Quiet link that returns from a run to the list it was opened from (ClipList's `leading`). */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="-ml-2 inline-flex h-6 items-center gap-1 rounded-full pl-1.5 pr-2.5 text-xs font-medium text-ink-muted transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

/** Persisted runs may contain incomplete cost data; only display complete sections. */
function readCosts(value: unknown): ApiCosts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const amount = raw.total_estimated_cost_usd
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null
  const section = (name: string): Record<string, unknown> | null => {
    const part = raw[name]
    return part && typeof part === 'object' && !Array.isArray(part) ? part as Record<string, unknown> : null
  }
  const validMoney = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  const result: ApiCosts = { total_estimated_cost_usd: amount, ...(raw.cost_incomplete === true ? { cost_incomplete: true } : {}) }
  const transcription = section('transcription')
  if (transcription && typeof transcription.provider === 'string' && typeof transcription.model === 'string' &&
      validMoney(transcription.audio_duration_seconds) && validMoney(transcription.estimated_cost_usd)) {
    result.transcription = transcription as unknown as NonNullable<ApiCosts['transcription']>
  }
  const planning = section('planning')
  if (planning && typeof planning.model === 'string' && validMoney(planning.total_tokens) &&
      validMoney(planning.attempts) && validMoney(planning.estimated_cost_usd)) {
    result.planning = planning as unknown as NonNullable<ApiCosts['planning']>
  }
  const layoutVision = section('layout_vision')
  if (layoutVision && typeof layoutVision.model === 'string' && validMoney(layoutVision.estimated_cost_usd)) {
    result.layout_vision = layoutVision as unknown as NonNullable<ApiCosts['layout_vision']>
  }
  for (const key of ['source_context', 'editorial', 'editorial_vision', 'editorial_repair', 'caption_translation'] as const) {
    const part = section(key)
    if (part && typeof part.provider === 'string' && typeof part.model === 'string' && validMoney(part.estimated_cost_usd)) {
      result[key] = { provider: part.provider, model: part.model, estimated_cost_usd: part.estimated_cost_usd }
    }
  }
  return result
}

/** Explain when a vertical clip kept its whole frame or fell back during rendering. */
export function framingProblem(output: JobOutput, vertical: boolean): string | null {
  if (!vertical || output.clips.length === 0) return null
  const requested = output.metrics?.requested_settings
  const requestedClassic = requested && typeof requested === 'object' && !Array.isArray(requested) &&
    (requested as Record<string, unknown>).layout_style !== 'auto'
  if (requestedClassic) return null
  if (output.metrics?.smart_framing_available === false) {
    return 'Smart framing was unavailable, so every clip used the classic whole-frame layout. OpenCV or the face model is missing from the engine; run Settings → System check.'
  }
  const fallbacks = output.clips.filter((clip) => clip.render_fallback).length
  const notices: string[] = []
  if (fallbacks > 0) {
    notices.push(`${fallbacks} of ${output.clips.length} clips couldn't render with smart framing and used the classic whole-frame layout instead. The log has the details.`)
  }
  const clipIndices = new Set(output.clips.map((clip) => clip.clip_index))
  const wholeFrame = new Set<number>()
  const layouts = output.metrics?.clip_layouts
  if (Array.isArray(layouts)) {
    for (const layout of layouts) {
      if (layout && typeof layout === 'object' && layout.framing_status === 'whole_frame_auto' &&
        Number.isSafeInteger(layout.clip_index) && clipIndices.has(layout.clip_index)) {
        wholeFrame.add(layout.clip_index)
      }
    }
  }
  if (wholeFrame.size > 0) {
    const sorted = [...wholeFrame].sort((a, b) => a - b)
    const shown = sorted.slice(0, 5).map((index) => index + 1).join(', ')
    const more = sorted.length > 5 ? ` and ${sorted.length - 5} more` : ''
    notices.push(`Smart framing kept the whole frame for clip${sorted.length === 1 ? '' : 's'} ${shown}${more}. Review the framing if you expected a closer crop.`)
  }
  return notices.join(' ') || null
}

/** Screen share clips' framing decisions, by clip index (from the run's clip_layouts). */
export function screenFocusByIndex(output: JobOutput): Map<number, ClipScreenFocus> {
  const result = new Map<number, ClipScreenFocus>()
  const layouts = output.metrics?.clip_layouts
  if (!Array.isArray(layouts)) return result
  for (const layout of layouts) {
    if (layout && typeof layout === 'object' && Number.isSafeInteger(layout.clip_index) && layout.screen_focus && typeof layout.screen_focus === 'object') {
      result.set(layout.clip_index, layout.screen_focus as ClipScreenFocus)
    }
  }
  return result
}

export function sourceAnalysisNotice(output: JobOutput): string | null {
  // More clips that couldn't use the saved transcript.
  const requested = output.metrics?.requested_settings as { more_clips?: unknown } | undefined
  const retranscribed = requested?.more_clips === true && output.metrics?.transcript_reused === false
    ? 'The saved transcript didn’t match this video or the part of it this run looked at, so the video was transcribed again.' : null
  if (output.metrics?.planning_source !== 'visual') return retranscribed
  if (output.metrics.transcription_status === 'no_speech') {
    return 'No speech was detected. Clips were selected from sampled video frames, and spoken-word captions are unavailable for this run.'
  }
  if (output.metrics.transcription_status === 'failed') {
    return 'Transcription failed. Clips were selected from sampled video frames, and spoken-word captions are unavailable for this run.'
  }
  return null
}
