import { useEffect, useRef, useState } from 'react'
import { Camera, Check, FolderOpen, Library, Scissors, Video, X } from 'lucide-react'
import {
  DEFAULT_EDIT_LOOK, EDIT_MAX_SOURCES, EDIT_MAX_TOTAL_SECONDS, editEstimate, formatClock, formatUsd, isRunningEdit,
  type EditLook, type EditPlan, type EditSource, type EditStatus, type FilmIdea
} from '../../shared/edit-recording'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import { DEFAULT_HEADLINE_LOOK } from '../../shared/headline-look'
import { hasBrandMark } from '../../shared/brand-kit'
import type { BrandIdentity } from '../../shared/remix'
import type { Page as PageName } from '../components/Sidebar'
import { BrandPicker } from '../components/BrandIdentityDialog'
import { EditRecorder } from '../components/EditRecorder'
import { EditReview } from '../components/EditReview'
import { FilmIdeas } from '../components/FilmIdeas'
import { FriendlyError } from '../components/FriendlyError'
import { useLowDiskGate } from '../components/LowDiskGate'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ProgressBar } from '../components/ui/ProgressBar'
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
  // The brand and look are kept in a store, so leaving the page and coming back keeps them.
  const brandId = useEditRecordingStore((s) => s.brandId)
  const look = useEditRecordingStore((s) => s.look)
  const setLook = useEditRecordingStore((s) => s.setLook)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [recorder, setRecorder] = useState<{ hook: string; points: string[] } | null | false>(false)
  const [hookHint, setHookHint] = useState('')
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
  const total = sources.reduce((sum, source) => sum + source.seconds, 0)
  const estimate = editEstimate(total)
  const tooLong = total > EDIT_MAX_TOTAL_SECONDS

  const addSources = (added: EditSource[]): void => {
    setSources((current) => {
      const next = [...current]
      for (const source of added) if (!next.some((item) => item.path === source.path)) next.push(source)
      if (next.length > EDIT_MAX_SOURCES) setError(`Use up to ${EDIT_MAX_SOURCES} takes: the first ${EDIT_MAX_SOURCES} are kept.`)
      return next.slice(0, EDIT_MAX_SOURCES)
    })
  }

  const choose = async (): Promise<void> => {
    setError(null)
    try { addSources(await getApi().edit.chooseSources()) } catch (err) { setError(errorMessage(err)) }
  }

  const start = async (): Promise<void> => {
    if (!sources.length) return
    if (!(await lowDisk.ensureSpace())) return
    setStarting(true); setError(null)
    try {
      setStatus(await getApi().edit.start({ sources: sources.map((source) => source.path), brandIdentityId: brandId, ...(hookHint ? { hookHint } : {}) }))
    } catch (err) { setError(errorMessage(err)) } finally { setStarting(false) }
  }

  const chooseBrand = (next: BrandIdentity | null): void => {
    // The extras aren't part of a brand: they stay as picked.
    const extras = useEditRecordingStore.getState().look.lookExtras
    useEditRecordingStore.getState().setBrand(next?.id ?? null, { ...lookFromBrand(next), ...(extras?.length ? { lookExtras: extras } : {}) })
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
    setSources([]); setHookHint(''); setStatus(null)
    void getApi().edit.discard().catch(() => undefined)
  }

  const openKeys = (): void => { requestSettingsSection('keys'); onNavigate('settings') }

  return (
    <Page width="default">
      <PageHeader eyebrow="Studio" title="Edit my recording"
        description="Drop in a raw recording of you talking to camera, or a few takes of it. You get back one finished vertical reel: retakes and filler words cut, your strongest hook first, captions, pop-ups and sound." />

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
          <PanelHeader title={status.phase === 'rendering' ? 'Making your reel' : status.phase === 'planning' ? 'Planning your edit' : 'Listening to your recording'} />
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
              {status.warnings.map((warning) => <p key={warning} className="max-w-sm text-2xs text-ink-muted">{warning}</p>)}
            </div>
          </div>
        </Panel>
      )}

      {!busy && !reviewing && status?.phase !== 'done' && (
        <div className="mt-5 space-y-4" ref={startRef}>
          <div data-testid="edit-sources-drop"
            onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; if (sources.length < EDIT_MAX_SOURCES) setDragging(true) }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
            // A dropped file can't grant access to itself: the file dialog opens (in main), as everywhere else in the app.
            onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer.files?.length && sources.length < EDIT_MAX_SOURCES) void choose() }}
            className={cn('rounded-2xl transition-shadow', dragging && 'shadow-[0_0_0_2px_rgb(var(--accent)/0.7)]')}>
          <Panel>
            <PanelHeader title="1 · Your recording" description="One recording, or a few takes of the same video. Fluffed lines, retakes and “let me say that again” are fine: the edit keeps your last complete take of each line." />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" icon={<FolderOpen className="h-4 w-4" />} disabled={sources.length >= EDIT_MAX_SOURCES} onClick={() => void choose()}>Choose recordings</Button>
              <Button variant="secondary" icon={<Camera className="h-4 w-4" />} disabled={sources.length >= EDIT_MAX_SOURCES} onClick={() => setRecorder(null)}>Film it here</Button>
            </div>
            {sources.length > 0 && (
              <ul className="mt-3 space-y-1.5" aria-label="Your recordings">
                {sources.map((source, i) => (
                  <li key={source.path} className="glass-tile flex items-center justify-between gap-2 rounded-xl px-3 py-2">
                    <span className="min-w-0 truncate text-sm text-ink">{sources.length > 1 ? `Take ${i + 1} · ` : ''}{source.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-2xs tabular text-ink-muted">{formatClock(source.seconds)}</span>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${source.name}`} icon={<X className="h-3.5 w-3.5" />}
                        onClick={() => setSources((current) => current.filter((item) => item.path !== source.path))} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {hookHint && sources.length > 0 && <p className="mt-2 text-2xs text-ink-muted">Planned hook: “{hookHint}”. The edit looks for it first.</p>}
            {tooLong && <p className="mt-2 text-2xs text-danger">Your takes add up to over {EDIT_MAX_TOTAL_SECONDS / 60} minutes. Use fewer or shorter takes.</p>}
            <p className="mt-2 text-2xs text-ink-subtle">{dragging ? 'Drop to choose this recording in the file picker.' : 'You can also drop recordings here.'}</p>
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
            <p className="mt-1 text-xs text-ink-muted" data-testid="edit-cost">
              {sources.length
                ? `Listening to ${formatClock(total)} with ElevenLabs Scribe v2 costs about ${formatUsd(estimate.transcribeUsd)}, and planning the edit about ${formatUsd(estimate.planUsd)}, through your OpenRouter account. Your custom vocabulary is sent as key terms, which may cost a little extra. Reviewing and making the reel are free.`
                : 'Add your recording first. Transcribing and planning go through your OpenRouter account; reviewing and making the reel are free.'}
            </p>
            <div className="mt-3 flex justify-end">
              <Button variant="primary" size="lg" icon={<Scissors className="h-4 w-4" />} loading={starting} disabled={!sources.length || starting || tooLong || !openrouterConfigured}
                onClick={() => void start()}>Edit my recording</Button>
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
