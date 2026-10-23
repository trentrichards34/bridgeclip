import { useEffect, useRef, useState } from 'react'
import { Check, Combine, Library, Loader2, Plus, Scissors, Video, X } from 'lucide-react'
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
import { IconTile } from '../components/ui/IconTile'
import { Checklist, LookCard, lookColors, MakerAside, MakerLayout, MakerSection, PhoneFrame } from '../components/maker/Maker'
import { previewFrame, StyleBoard } from '../components/StyleBoard'
import { boardFromLook, LOOK_HOOKS, lookPatch, styleSummary } from '../lib/style-board'
import { EditProgressView } from '../components/EditProgressView'
import { Segmented } from '../components/ui/Segmented'
import { getApi } from '../lib/ipc'
import { useDefaultLookSeed } from '../lib/default-look'
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

/** The look fields a brand sets (the default look seeds these; extras and audio stay as picked). */
function brandLookFields(brandId: string | null, look: EditLook): { brandId: string | null } & Pick<EditLook, 'includeCaptions' | 'captionPreset' | 'headlineLook' | 'showHandle'> {
  return { brandId, includeCaptions: look.includeCaptions, captionPreset: look.captionPreset, headlineLook: look.headlineLook, showHandle: look.showHandle }
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
  // "Customize for this video": the look controls under the Look card.
  const [lookOpen, setLookOpen] = useState(false)
  // "Say what it's for" (this recording only).
  const [purpose, setPurpose] = useState('')
  const [reference, setReference] = useState<ReferenceImage | null>(null)
  const lowDisk = useLowDiskGate()
  const startRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const brand = brands.find((item) => item.id === brandId) ?? null
  // Starts from the default brand look (Brand look); a brand or look picked here is for this recording only.
  useDefaultLookSeed('edit-recording',
    () => { const state = useEditRecordingStore.getState(); return brandLookFields(state.brandId, state.look) },
    brandLookFields(null, DEFAULT_EDIT_LOOK),
    (next) => brandLookFields(next?.id ?? null, lookFromBrand(next)),
    ({ brandId: id, ...fields }) => useEditRecordingStore.getState().setBrand(id, { ...useEditRecordingStore.getState().look, ...fields }))

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

  const header = (
    <PageHeader eyebrow="Studio" title="Raw takes in, one finished reel out"
      description="Fluffed lines and “let me say that again” are fine. The edit keeps your best take, cuts filler and puts the strongest hook first." />
  )
  const notices = (
    <>
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
    </>
  )
  const setup = !busy && !reviewing && status?.phase !== 'done'

  // What still stands between the member and "Edit my recording", said under the button.
  const blocker = !openrouterConfigured ? 'Add your OpenRouter key first.'
    : importing ? 'Your clips are still being added.'
      : !sources.length ? (combine ? 'Add your clips first.' : 'Add a take first.')
        : combine && sources.length < 2 ? 'Add at least one more clip to combine.'
          : tooLong ? (combine ? 'Your clips are too long in all.' : 'Your takes are too long in all.')
            : withScreen && sources.length !== 1 ? 'A screen recording goes with one camera recording.'
              : !screenReady ? 'Your screen recording is still being lined up.' : null
  const canStart = !blocker && !starting
  const label = combine ? 'clip' : 'take'
  const tileClass = 'flex aspect-[9/15] w-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed px-2 text-center text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
  const brandColor = brand?.look?.color ?? null
  const lookRows = { hooks: LOOK_HOOKS, handle: true } as const
  const lookSummary = styleSummary(boardFromLook(look), lookRows, { brandColor, hasMark: hasBrandMark(brand?.look), corner: brand?.look?.handlePosition })
  const firstSource = listed[0] ?? null

  const takes = (
    <MakerSection number={2} title={combine ? 'Your clips' : 'Your takes'}
      aside={combine ? `Up to ${COMBINE_MAX_CLIPS} clips, or a .zip` : `Up to ${EDIT_MAX_SOURCES} · MP4, MOV, WebM, M4V or MKV`}>
      <div data-testid="edit-sources-drop"
        onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; if (sources.length < maxSources) setDragging(true) }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
        // A dropped file can't grant access to itself: the file dialog opens (in main), as everywhere else in the app.
        onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer.files?.length && sources.length < maxSources && !importing) void choose() }}
        className={cn('rounded-2xl transition-shadow', dragging && 'shadow-[0_0_0_2px_rgb(var(--tool)/0.7)]')}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2.5">
          <ul className="contents" aria-label={combine ? 'Your clips' : 'Your recordings'}>
            {listed.map((source, i) => (
              <li key={source.path} className="glass flex min-w-0 flex-col rounded-2xl p-[5px]">
                <div className="relative aspect-[9/14] overflow-hidden rounded-lg bg-black">
                  <video src={`${localFileUrl(source.path)}#t=0.1`} preload="metadata" muted playsInline aria-hidden tabIndex={-1} className="h-full w-full object-cover" />
                  {(combine || sources.length > 1) && <span aria-hidden className="absolute left-1.5 top-1.5 rounded bg-tool/90 px-1.5 py-px font-mono text-[9px] font-medium text-canvas">{combine ? `Clip ${i + 1}` : `Take ${i + 1}`}</span>}
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-canvas/75 px-1.5 py-px font-mono text-[9px] tabular text-ink">{formatClock(source.seconds)}</span>
                  <Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${source.name}`} icon={<X className="h-3.5 w-3.5" />}
                    className="absolute right-1 top-1 h-7 w-7 bg-canvas/70 text-ink hover:bg-canvas/90"
                    onClick={() => setSources((current) => current.filter((item) => item.path !== source.path))} />
                </div>
                <p className="truncate px-1 pb-0.5 pt-1.5 font-mono text-[10px] text-ink-muted" title={source.name}>{combine ? `Clip ${i + 1} · ` : sources.length > 1 ? `Take ${i + 1} · ` : ''}{source.name}</p>
                {combine && source.createdAt && <p className="truncate px-1 pb-0.5 text-[10px] text-ink-subtle">Filmed {filmedAt(source.createdAt)}</p>}
              </li>
            ))}
          </ul>
          <button type="button" disabled={sources.length >= maxSources || Boolean(importing)} onClick={() => void choose()}
            className={cn(tileClass, 'border-tool/40 bg-tool/[0.04] text-tool hover:bg-tool/[0.08]')}>
            {importing ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
            {combine ? 'Choose clips or a .zip' : 'Choose recordings'}
          </button>
          <button type="button" disabled={sources.length >= maxSources || Boolean(importing)} onClick={() => setRecorder(null)}
            className={cn(tileClass, 'border-line-strong text-ink-muted hover:border-white/25 hover:text-ink')}>
            <span aria-hidden className="h-3 w-3 rounded-full bg-[#FF4D4D] shadow-[0_0_12px_#FF4D4D]" />
            Film it here
          </button>
        </div>
        <p className="mt-2 text-2xs text-ink-subtle">{dragging ? `Drop to choose ${combine ? 'these clips' : 'this recording'} in the file picker.` : combine
          ? `Short clips filmed one after another. They’re joined in the order you filmed them (or the order the AI finds best), ${COMBINE_MAX_TOTAL_SECONDS / 60} minutes in all. You can also drop clips or a .zip here.`
          : `One recording, or up to ${EDIT_MAX_SOURCES} takes of the same video. You can also drop recordings here.`}</p>
      </div>
      {importing && <ClipImport className="mt-3" files={importing} />}
      {!combine && (sources.length <= 1 || screen) && (
        <ScreenRecordingPicker camera={sources.length === 1 ? { path: sources[0].path, seconds: sources[0].seconds } : null} value={screen} onChange={setScreen}
          onError={setError} disabledReason={screenBlocked} />
      )}
      {combine && sources.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Segmented label="Clip order" value={orderMode} onChange={setOrderMode}
            options={[{ value: 'filmed', label: 'Filming order' }, { value: 'ai', label: 'Let AI find the best order' }]} />
          <span className="min-w-0 flex-1 text-2xs text-ink-subtle">{orderMode === 'ai'
            ? 'The AI reads what you say and puts the clips in order: hook, points, proof, then your call to action. You can change it on the review screen.'
            : orderedBy(sources) === 'time' ? 'In the order your camera filmed them. You can change it on the review screen.' : 'These clips don’t say when they were filmed, so they’re in file-name order. You can change it on the review screen.'}</span>
        </div>
      )}
      {combine && sources.length === 1 && <p className="mt-2 text-2xs text-ink-muted">Add at least one more clip to combine.</p>}
      {hookHint && sources.length > 0 && <p className="mt-2 text-2xs text-ink-muted">Planned hook: “{hookHint}”. The edit looks for it first.</p>}
      {tooLong && <p className="mt-2 text-2xs text-danger">{combine ? `Your clips add up to over ${maxTotal / 60} minutes. Use fewer or shorter clips.` : `Your takes add up to over ${maxTotal / 60} minutes. Use fewer or shorter takes.`}</p>}
    </MakerSection>
  )

  const aside = (
    <MakerAside label={`Your reel · 9:16`}>
      <PhoneFrame>
        {firstSource
          ? <video key={firstSource.path} src={`${localFileUrl(firstSource.path)}#t=0.1`} preload="metadata" muted playsInline aria-hidden tabIndex={-1} className="h-full w-full object-cover" />
          : <span className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-2xs text-ink-subtle">Your first {label} shows here</span>}
        {hookHint && sources.length > 0 && (
          <span className="absolute inset-x-[8%] top-[9%] text-center font-display text-sm font-bold leading-tight text-white [text-shadow:0_2px_6px_rgb(0_0_0/0.7)]">{hookHint}</span>
        )}
      </PhoneFrame>
      <Checklist items={combine
        ? ['Your clips joined into one reel, in order', 'Brightness and loudness evened out', 'Captions, pop-ups and sound in your look']
        : ['Retakes and filler words cut', 'Strongest hook moved first', withScreen ? 'Your screen and you share the frame' : 'Captions, pop-ups and sound in your look']} />
      <Button variant="primary" size="lg" className="mt-4 h-12 w-full rounded-[13px] font-display text-[15px] font-semibold"
        icon={combine ? <Combine className="h-4 w-4" /> : <Scissors className="h-4 w-4" />} loading={starting} disabled={!canStart}
        onClick={() => void start()}>{combine ? 'Combine my clips' : 'Edit my recording'}</Button>
      {blocker && <p className="mt-2 text-center text-2xs text-ink-muted" role="status">{blocker}</p>}
      <p className="mt-2.5 text-center text-2xs leading-relaxed text-ink-subtle" data-testid="edit-cost">
        {sources.length
          ? `Listening to ${formatClock(total)}${combine ? ` (${sources.length} clip${sources.length === 1 ? '' : 's'})` : ''} with ElevenLabs Scribe v2 costs ${aboutUsd(estimate.transcribeUsd)}, and planning the edit ${aboutUsd(estimate.planUsd)}, through your OpenRouter account. Your custom vocabulary is sent as key terms, which may cost a little extra. Reviewing and making the reel are free.`
          : 'Add your recording first. Transcribing and planning go through your OpenRouter account; reviewing and making the reel are free.'}
      </p>
    </MakerAside>
  )

  const main = (
    <>
      <div>
        {header}
        {notices}
      </div>

      <MakerSection number={1} title="What did you record?">
        <ModeChoice value={mode} onChange={chooseMode} disabled={Boolean(importing)} />
      </MakerSection>

      {takes}

      <MakerSection number={3} title="What’s it for?" aside="Optional">
        <PurposeFields purpose={purpose} onPurpose={setPurpose} reference={reference} onReference={setReference} disabled={starting} labelHidden
          purposeHelp="Guides the hook, title and pop-ups. Never shown in the video."
          onUseLook={(picked) => setLook({ ...look, captionPreset: picked.captionPreset, headlineLook: { ...look.headlineLook, color: picked.color, look: 'brand' } })} />
      </MakerSection>

      <MakerSection number={4} title="Look">
        <LookCard name={brand?.name ?? 'Plain look'} badge={brand ? 'Brand look' : null} summary={lookSummary} summaryTestId="edit-setup-look"
          colors={lookColors(look.headlineLook.color, look.includeCaptions ? look.captionPreset : undefined)} open={lookOpen} onToggle={() => setLookOpen(!lookOpen)} controls="edit-setup-look-controls">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink">Brand</p>
            <p className="text-2xs text-ink-subtle">The edit reads your brand to know your offer and voice, and your words are listened for by name. Its look fills in your captions and hook text.</p>
            <BrandPicker value={brandId} onChange={chooseBrand} noneDetail="Plain look, no brand words" />
          </div>
          <StyleBoard value={boardFromLook(look)} onChange={(patch) => setLook({ ...look, ...lookPatch(look, patch) })}
            rows={lookRows} brand={brand} frame={previewFrame(firstSource?.path ?? null, 'video', 0.1)} hookText={hookHint || undefined} />
          <p className="text-2xs text-ink-subtle">Extras, skills, graphics and sound are picked on the review screen, once the edit is planned. You can change this look there too.</p>
        </LookCard>
      </MakerSection>

      <FilmIdeas brandIdentityId={brandId} brandName={brand?.name ?? null} onFilm={film} onOpenRemix={() => onNavigate('remix')} disabled={!openrouterConfigured} />
    </>
  )

  return (
    <Page width="default">
      {setup ? (
        <div ref={startRef}>
          <MakerLayout main={main} aside={aside} />
        </div>
      ) : (
        <>
          {header}
          {notices}
        </>
      )}

      {busy && status && <EditProgressView status={status} onCancel={() => void getApi().edit.cancel()} />}

      {reviewing && status && (
        <div className="mt-5">
          <EditReview key={status.id} status={status as EditStatus & { plan: EditPlan }} brand={brand} look={look} onLook={setLook} onError={setError} />
        </div>
      )}

      {status?.phase === 'done' && status.output && (
        <Panel className="mt-5">
          <PanelHeader title="Your reel is ready" icon={<IconTile tone="success"><Check /></IconTile>}
            description={`${formatClock(status.output.durationSeconds)} long, saved to your Library.${status.costUsd > 0 ? ` The AI steps cost ${formatUsd(status.costUsd)}.` : ''}`} />
          <div className="mt-4 flex flex-wrap items-start gap-5">
            <video src={localFileUrl(status.output.path)} controls playsInline className="aspect-[9/16] w-[220px] rounded-xl bg-black object-contain shadow-[0_20px_50px_rgb(0_0_0/0.5)]" aria-label="Your reel" />
            <div className="flex flex-col gap-2">
              {onViewLibrary && <Button variant="primary" icon={<Library className="h-4 w-4" />} onClick={() => onViewLibrary(status.folder)}>Open in Library</Button>}
              <Button variant="secondary" icon={<Video className="h-4 w-4" />} onClick={startOver}>Edit another recording</Button>
              {status.screen && <p className="max-w-sm text-2xs text-ink-muted" data-testid="screen-done">Your screen and camera play together. To show just you, just your screen or a different split in any part, open it in the Library and edit the clip.</p>}
              {status.warnings.map((warning) => <p key={warning} className="max-w-sm text-2xs text-ink-muted">{warning}</p>)}
            </div>
          </div>
        </Panel>
      )}

      {recorder !== false && (
        <EditRecorder prompt={recorder} onRecorded={(source) => addSources([source])}
          onClose={() => { setRecorder(false); startRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }} />
      )}
    </Page>
  )
}
