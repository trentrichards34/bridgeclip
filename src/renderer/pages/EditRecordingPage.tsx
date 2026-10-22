import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Combine, FolderOpen, Library, Scissors, Video, X } from 'lucide-react'
import {
  DEFAULT_EDIT_LOOK, EDIT_MAX_SOURCES, EDIT_MAX_TOTAL_SECONDS, aboutUsd, editEstimate, formatClock, formatUsd, isRunningEdit,
  type EditLook, type EditPlan, type EditSource, type EditStatus, type FilmIdea
} from '../../shared/edit-recording'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import { COMBINE_MAX_CLIPS, COMBINE_MAX_TOTAL_SECONDS, filmingOrder, orderedBy, type ClipOrderMode, type EditMode, type ImportProgress } from '../../shared/combine-clips'
import { ClipImport, ModeChoice } from '../components/CombineClips'
import { DEFAULT_HEADLINE_LOOK } from '../../shared/headline-look'
import { hasBrandMark } from '../../shared/brand-kit'
import type { BrandIdentity } from '../../shared/remix'
import type { Page as PageName } from '../components/Sidebar'
import { BrandPicker } from '../components/BrandIdentityDialog'
import { EditRecorder } from '../components/EditRecorder'
import { EditReview } from '../components/EditReview'
import { FilmIdeas } from '../components/FilmIdeas'
import { FriendlyError } from '../components/FriendlyError'
import { ScreenRecordingPicker, type ScreenPick } from '../components/ScreenRecording'
import { screenOverlap } from '../../shared/screen-pair'
import { PurposeFields } from '../components/PurposeFields'
import type { ReferenceImage } from '../../shared/purpose'
import { useLowDiskGate } from '../components/LowDiskGate'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Segmented } from '../components/ui/Segmented'
import { getApi } from '../lib/ipc'
import { requestSettingsSection } from '../lib/settings-focus'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { useBrands } from '../store/use-brand-store'
import { useEditRecordingStore } from '../store/use-edit-recording-store'
import { useSettingsStore } from '../store/use-settings-store'
import { useDailyPlan } from '../store/use-daily-plan-store'

/** The brand's look as the starting look (captions, hook text, its handle when it has one). */
export function lookFromBrand(brand: BrandIdentity | null): EditLook {
  const kit = brand?.look
  if (!kit) return DEFAULT_EDIT_LOOK
  const headlineLook = kit.headlineLook ? { ...kit.headlineLook, color: kit.color ?? kit.headlineLook.color } : kit.color ? { ...DEFAULT_HEADLINE_LOOK, color: kit.color } : DEFAULT_HEADLINE_LOOK
  return { includeCaptions: true, captionPreset: kit.captionPreset ?? DEFAULT_CAPTION_PRESET, headlineLook, showHandle: hasBrandMark(kit) }
}

/** When a clip was filmed, in the member's own clock ("Oct 21, 9:27 AM"). */
function filmedAt(iso: string): string {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

/**
 * Edit my recording: drop in a raw recording of you talking to camera (or a
 * few takes of it) and get back one finished vertical reel. Transcribing and
 * planning are the only paid steps; the review and the reel are free.
 */
export function EditRecordingPage({ onNavigate, onViewLibrary }: { onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element {
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const brands = useBrands((s) => s.brands)
  const loadBrands = useBrands((s) => s.load)
  const [status, setStatus] = useState<EditStatus | null>(null)
  const [sources, setSources] = useState<EditSource[]>([])
  // Retakes of one video, or parts of one video to combine (and how to order them to start with).
  const [mode, setMode] = useState<EditMode>('takes')
  const [orderMode, setOrderMode] = useState<ClipOrderMode>('filmed')
  const [importing, setImporting] = useState<ImportProgress[] | null>(null)
  // Camera + screen: a screen recording made with the (one) camera recording, and how they line up.
  const [screen, setScreen] = useState<ScreenPick | null>(null)
  // The brand and look are kept in a store, so leaving the page and coming back keeps them.
  const brandId = useEditRecordingStore((s) => s.brandId)
  const look = useEditRecordingStore((s) => s.look)
  const setLook = useEditRecordingStore((s) => s.setLook)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [recorder, setRecorder] = useState<{ hook: string; points: string[] } | null | false>(false)
  const [hookHint, setHookHint] = useState('')
  // "Say what it's for" (this recording only).
  const [purpose, setPurpose] = useState('')
  const [reference, setReference] = useState<ReferenceImage | null>(null)
  const lowDisk = useLowDiskGate()
  const startRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const brand = brands.find((item) => item.id === brandId) ?? null

  useEffect(() => {
    let live = true
    void loadBrands(true)
    getApi().edit.status().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().edit.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [loadBrands])

  const busy = isRunningEdit(status)
  const reviewing = status?.phase === 'review' && status.plan !== null
  const combine = mode === 'combine'
  const maxSources = combine ? COMBINE_MAX_CLIPS : EDIT_MAX_SOURCES
  const maxTotal = combine ? COMBINE_MAX_TOTAL_SECONDS : EDIT_MAX_TOTAL_SECONDS
  const total = sources.reduce((sum, source) => sum + source.seconds, 0)
  const estimate = editEstimate(total)
  const tooLong = total > maxTotal
  // Clips are listed (and combined) in the order they were filmed.
  const listed = combine ? filmingOrder(sources).map((i) => sources[i]) : sources
  const withScreen = !combine && screen !== null
  // The screen recording is ready once lined up (and overlapping the camera at the chosen offset).
  const screenReady = !withScreen || Boolean(screen?.sync && screenOverlap(screen.offsetMs, screen.sync.cameraSeconds, screen.sync.screenSeconds))
  const screenBlocked = sources.length === 0 ? 'Choose your camera recording first.' : sources.length > 1 ? 'A screen recording goes with one camera recording: keep one take to add one.' : null

  const addSources = (added: EditSource[], limit = maxSources): void => {
    setSources((current) => {
      const next = [...current]
      for (const source of added) if (!next.some((item) => item.path === source.path)) next.push(source)
      if (next.length > limit) setError(combine ? `Use up to ${limit} clips: the first ${limit} are kept.` : `Use up to ${limit} takes: the first ${limit} are kept.`)
      return next.slice(0, limit)
    })
  }

  const choose = async (): Promise<void> => {
    setError(null)
    if (!combine) {
      try { addSources(await getApi().edit.chooseSources()) } catch (err) { setError(errorMessage(err)) }
      return
    }
    // Clips (or one .zip): each file's progress shows while it is copied out and checked.
    const off = getApi().edit.onImportProgress((files) => setImporting(files))
    try {
      const result = await getApi().edit.chooseClips()
      addSources(result.sources)
      if (result.skipped.length) setError(`${result.skipped.length === 1 ? 'One file was' : `${result.skipped.length} files were`} left out. ${result.skipped.slice(0, 3).join(' ')}`)
    } catch (err) { setError(errorMessage(err)) } finally { off(); setImporting(null) }
  }

  const chooseMode = (next: EditMode): void => {
    if (next === mode) return
    setMode(next)
    // Takes can be up to 5: going back from clips keeps the first five.
    if (next === 'takes' && sources.length > EDIT_MAX_SOURCES) {
      setSources((current) => current.slice(0, EDIT_MAX_SOURCES))
      setError(`Use up to ${EDIT_MAX_SOURCES} takes: the first ${EDIT_MAX_SOURCES} are kept.`)
    }
  }

  const start = async (): Promise<void> => {
    if (!sources.length) return
    if (!(await lowDisk.ensureSpace())) return
    setStarting(true); setError(null)
    try {
      setStatus(await getApi().edit.start({ sources: listed.map((source) => source.path), brandIdentityId: brandId, ...(hookHint ? { hookHint } : {}),
        ...(combine ? { mode: 'combine' as const, order: orderMode } : {}),
        ...(withScreen && screen ? { screen: { path: screen.source.path, offsetMs: screen.offsetMs } } : {}),
        ...(purpose.trim() ? { purpose: purpose.replace(/\s+/g, ' ').trim() } : {}), ...(reference ? { referenceImage: reference.id } : {}) }))
    } catch (err) { setError(errorMessage(err)) } finally { setStarting(false) }
  }

  const chooseBrand = (next: BrandIdentity | null): void => {
    // The extras and the audio skills aren't part of a brand: they stay as picked.
    const { lookExtras: extras, music, musicTrack, voiceCleanup } = useEditRecordingStore.getState().look
    useEditRecordingStore.getState().setBrand(next?.id ?? null, { ...lookFromBrand(next), ...(extras?.length ? { lookExtras: extras } : {}),
      ...(music ? { music, ...(musicTrack ? { musicTrack } : {}) } : {}), ...(voiceCleanup ? { voiceCleanup } : {}) })
  }

  const film = (idea: FilmIdea): void => {
    setHookHint(idea.hook)
    setRecorder({ hook: idea.hook, points: idea.points })
  }
  // Today's 3 → "Film this": open the recorder with that idea as the teleprompter.
  useEffect(() => {
    const idea = useDailyPlan.getState().takePendingIdea()
    if (idea) film(idea)
  }, [])

  const startOver = (): void => {
    setSources([]); setImporting(null); setScreen(null); setHookHint(''); setPurpose(''); setReference(null); setStatus(null)
    void getApi().edit.discard().catch(() => undefined)
  }

  const openKeys = (): void => { requestSettingsSection('keys'); onNavigate('settings') }

  return (
    <Page width="default">
      <PageHeader eyebrow="Studio" title="Edit my recording"
        description="Drop in a raw recording of you talking to camera, a few takes of it, or several short clips to combine. You get back one finished vertical reel: retakes and filler words cut, your strongest hook first, captions, pop-ups and sound." />

      {!openrouterConfigured && (
        <Callout tone="info" className="mt-4" title="Add your OpenRouter key to start" action={<Button size="sm" onClick={openKeys}>Open API keys</Button>}>
          Your recording is transcribed and the edit is planned through your OpenRouter account. The reel itself is made on this computer.
        </Callout>
      )}
      {error && <Callout tone="danger" className="mt-4" onDismiss={() => setError(null)}><FriendlyError error={error} /></Callout>}
      {status?.phase !== 'rendering' && status?.error && (status.phase === 'failed' || status.phase === 'review') && (
        <Callout tone="danger" className="mt-4"><FriendlyError error={status.error} /></Callout>
      )}
      {lowDisk.element}

      {busy && status && (
        <Panel className="mt-5">
          <PanelHeader title={status.phase === 'rendering' ? 'Making your reel' : status.phase === 'planning' ? 'Planning your edit'
            : status.mode === 'combine' ? (status.percent < 45 ? 'Getting your clips ready' : 'Listening to your clips') : 'Listening to your recording'} />
          <ProgressBar className="mt-3" value={status.percent} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-muted" aria-live="polite">{status.detail}</p>
            <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => void getApi().edit.cancel()}>Cancel</Button>
          </div>
        </Panel>
      )}

      {reviewing && status && (
        <div className="mt-5">
          <EditReview key={status.id} status={status as EditStatus & { plan: EditPlan }} brand={brand} look={look} onLook={setLook} onError={setError} />
        </div>
      )}

      {status?.phase === 'done' && status.output && (
        <Panel className="mt-5">
          <PanelHeader title="Your reel is ready" icon={<Check className="h-4 w-4 text-success" />}
            description={`${formatClock(status.output.durationSeconds)} long, saved to your Library.${status.costUsd > 0 ? ` The AI steps cost ${formatUsd(status.costUsd)}.` : ''}`} />
          <div className="mt-3 flex flex-wrap items-start gap-4">
            <video src={localFileUrl(status.output.path)} controls playsInline className="aspect-[9/16] w-[220px] rounded-xl bg-black object-contain" aria-label="Your reel" />
            <div className="flex flex-col gap-2">
              {onViewLibrary && <Button variant="primary" icon={<Library className="h-4 w-4" />} onClick={() => onViewLibrary(status.folder)}>Open in Library</Button>}
              <Button variant="secondary" icon={<Video className="h-4 w-4" />} onClick={startOver}>Edit another recording</Button>
              {status.screen && <p className="max-w-sm text-2xs text-ink-muted" data-testid="screen-done">Your screen and camera play together. To show just you, just your screen or a different split in any part, open it in the Library and edit the clip.</p>}
              {status.warnings.map((warning) => <p key={warning} className="max-w-sm text-2xs text-ink-muted">{warning}</p>)}
            </div>
          </div>
        </Panel>
      )}

      {!busy && !reviewing && status?.phase !== 'done' && (
        <div className="mt-5 space-y-4" ref={startRef}>
          <div data-testid="edit-sources-drop"
            onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; if (sources.length < maxSources) setDragging(true) }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
            // A dropped file can't grant access to itself: the file dialog opens (in main), as everywhere else in the app.
            onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer.files?.length && sources.length < maxSources && !importing) void choose() }}
            className={cn('rounded-2xl transition-shadow', dragging && 'shadow-[0_0_0_2px_rgb(var(--accent)/0.7)]')}>
          <Panel>
            <PanelHeader title={combine ? '1 · Your clips' : '1 · Your recording'} description={combine
              ? `Short clips you filmed one after another, each a part of the video. They’re joined into one reel, in the order you filmed them (or the order the AI finds best). Up to ${COMBINE_MAX_CLIPS} clips, ${COMBINE_MAX_TOTAL_SECONDS / 60} minutes in all.`
              : 'One recording, or a few takes of the same video. Fluffed lines, retakes and “let me say that again” are fine: the edit keeps your last complete take of each line.'} />
            <ModeChoice className="mt-3" value={mode} onChange={chooseMode} disabled={Boolean(importing)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" icon={<FolderOpen className="h-4 w-4" />} disabled={sources.length >= maxSources || Boolean(importing)} loading={Boolean(importing)}
                onClick={() => void choose()}>{combine ? 'Choose clips or a .zip' : 'Choose recordings'}</Button>
              <Button variant="secondary" icon={<Camera className="h-4 w-4" />} disabled={sources.length >= maxSources || Boolean(importing)} onClick={() => setRecorder(null)}>Film it here</Button>
            </div>
            {importing && <ClipImport className="mt-3" files={importing} />}
            {sources.length > 0 && (
              <ul className="mt-3 space-y-1.5" aria-label={combine ? 'Your clips' : 'Your recordings'}>
                {listed.map((source, i) => (
                  <li key={source.path} className="glass-tile flex items-center justify-between gap-2 rounded-xl px-3 py-2">
                    <span className="min-w-0 truncate text-sm text-ink">{combine ? `Clip ${i + 1} · ` : sources.length > 1 ? `Take ${i + 1} · ` : ''}{source.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {combine && source.createdAt && <span className="text-2xs text-ink-subtle">Filmed {filmedAt(source.createdAt)}</span>}
                      <span className="font-mono text-2xs tabular text-ink-muted">{formatClock(source.seconds)}</span>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${source.name}`} icon={<X className="h-3.5 w-3.5" />}
                        onClick={() => setSources((current) => current.filter((item) => item.path !== source.path))} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!combine && (sources.length <= 1 || screen) && (
              <ScreenRecordingPicker camera={sources.length === 1 ? { path: sources[0].path, seconds: sources[0].seconds } : null} value={screen} onChange={setScreen}
                onError={setError} disabledReason={screenBlocked} />
            )}
            {combine && sources.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Segmented label="Clip order" value={orderMode} onChange={setOrderMode}
                  options={[{ value: 'filmed', label: 'Filming order' }, { value: 'ai', label: 'Let AI find the best order' }]} />
                <span className="text-2xs text-ink-subtle">{orderMode === 'ai'
                  ? 'The AI reads what you say and puts the clips in order: hook, points, proof, then your call to action. You can change it on the review screen.'
                  : orderedBy(sources) === 'time' ? 'In the order your camera filmed them. You can change it on the review screen.' : 'These clips don’t say when they were filmed, so they’re in file-name order. You can change it on the review screen.'}</span>
              </div>
            )}
            {combine && sources.length === 1 && <p className="mt-2 text-2xs text-ink-muted">Add at least one more clip to combine.</p>}
            {hookHint && sources.length > 0 && <p className="mt-2 text-2xs text-ink-muted">Planned hook: “{hookHint}”. The edit looks for it first.</p>}
            {tooLong && <p className="mt-2 text-2xs text-danger">{combine ? `Your clips add up to over ${maxTotal / 60} minutes. Use fewer or shorter clips.` : `Your takes add up to over ${maxTotal / 60} minutes. Use fewer or shorter takes.`}</p>}
            <p className="mt-2 text-2xs text-ink-subtle">{dragging ? `Drop to choose ${combine ? 'these clips' : 'this recording'} in the file picker.` : combine ? 'You can also drop clips or a .zip here.' : 'You can also drop recordings here.'}</p>
          </Panel>
          </div>

          <Panel>
            <PanelHeader title="2 · Your brand" description="The edit reads your brand to know your offer and voice, and your words are listened for by name. Its look sets your captions and hook text (change them on the review screen)." />
            <div className="mt-3">
              <BrandPicker value={brandId} onChange={chooseBrand} noneDetail="Plain look, no brand words" />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="3 · Edit it" />
            <div className="mt-3">
              <PurposeFields purpose={purpose} onPurpose={setPurpose} reference={reference} onReference={setReference} disabled={starting}
                purposeHelp="The AI uses it to choose your hook, title and pop-ups. It’s never shown in the video."
                onUseLook={(picked) => setLook({ ...look, captionPreset: picked.captionPreset, headlineLook: { ...look.headlineLook, color: picked.color, look: 'brand' } })} />
            </div>
            <p className="mt-3 text-xs text-ink-muted" data-testid="edit-cost">
              {sources.length
                ? `Listening to ${formatClock(total)}${combine ? ` (${sources.length} clip${sources.length === 1 ? '' : 's'})` : ''} with ElevenLabs Scribe v2 costs ${aboutUsd(estimate.transcribeUsd)}, and planning the edit ${aboutUsd(estimate.planUsd)}, through your OpenRouter account. Your custom vocabulary is sent as key terms, which may cost a little extra. Reviewing and making the reel are free.`
                : 'Add your recording first. Transcribing and planning go through your OpenRouter account; reviewing and making the reel are free.'}
            </p>
            <div className="mt-3 flex justify-end">
              <Button variant="primary" size="lg" icon={combine ? <Combine className="h-4 w-4" /> : <Scissors className="h-4 w-4" />} loading={starting}
                disabled={!sources.length || (combine && sources.length < 2) || starting || tooLong || !openrouterConfigured || Boolean(importing) || !screenReady || (withScreen && sources.length !== 1)}
                onClick={() => void start()}>{combine ? 'Combine my clips' : 'Edit my recording'}</Button>
            </div>
          </Panel>

          <FilmIdeas brandIdentityId={brandId} brandName={brand?.name ?? null} onFilm={film} onOpenRemix={() => onNavigate('remix')} disabled={!openrouterConfigured} />
        </div>
      )}

      {recorder !== false && (
        <EditRecorder prompt={recorder} onRecorded={(source) => addSources([source])}
          onClose={() => { setRecorder(false); startRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }} />
      )}
    </Page>
  )
}
