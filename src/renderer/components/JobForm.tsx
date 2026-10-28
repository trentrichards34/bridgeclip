import { normalizeVideoSource, twitchSourceError } from '../../shared/video-source'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, ListVideo, Minus, Plus } from 'lucide-react'
import { cn, MOD_KEY, parseTimecode, sourceLabel } from '../lib/utils'
import { useDraftStore, type ClipDraft, type WizardStep } from '../store/use-draft-store'
import { CreateStartFrom } from './StylePresets'
import { CreatePreview, createSentence, type SummaryTarget } from './CreatePreview'
import { useActiveJobs } from '../store/use-job-store'
import type { ClipJobRequest, HeadlineVoice, QualityBar, ScreenFocus } from '../../shared/jobs'
import { MAX_PARALLEL_JOBS } from '../../shared/jobs'
import { CAPTION_PRESET_NAMES } from './CaptionPresetPicker'
import { SourcePicker } from './SourcePicker'
import { Panel } from './ui/Panel'
import { Switch } from './ui/Switch'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { TextArea, TextInput } from './ui/Field'
import { IconTile } from './ui/IconTile'
import { SettingRow } from './ui/SettingRow'
import { onRadioKeyDown, Segmented } from './ui/Segmented'
import { CLIP_REQUEST_MAX_CHARS, DURATION_OPTIONS, VIDEO_SPEED_OPTIONS } from '../../shared/job-contract'
import { isModelId } from '../../shared/openrouter-models'
import { useModelStore } from '../store/use-model-store'
import { aiEstimateLine, BROLL_SOURCE_LABELS, effectiveBrollSource, usesAi, type BrollSource } from '../../shared/broll-library'
import { useBrollContext, useBrollLibrary } from '../store/use-broll-library-store'
import { BrollSourcePicker, useBrollLibraryLoaded } from './BrollSourcePicker'
import { useSettingsStore } from '../store/use-settings-store'
import { ModelPicker } from './ModelPicker'
import { WorkflowPicker } from './WorkflowPicker'
import { BackgroundPicker } from './BackgroundPicker'
import { brandRequestFields, CreateBrandSection, CreateKeywordHelp } from './CreateBrandSection'
import { previewFrame, StyleBoard } from './StyleBoard'
import { extrasName, HOOK_LABELS, withHideAfterPatch, withTextBg, type BoardRows, type BoardStyle, type HookChoice } from '../lib/style-board'
import { DEFAULT_HEADLINE_LOOK } from '../../shared/headline-look'
import { parseLookExtras, type LookExtraId } from '../../shared/look-extras'
import { CAPTION_LANGUAGES, captionLanguageLabel, isCaptionLanguage, type CaptionLanguageChoice } from '../../shared/caption-language'
import { mergeSources, parseSourceText, sourceCountLabel } from '../../shared/create-sources'
import { Select } from './ui/Select'
import { useBrands } from '../store/use-brand-store'
import { createCtaLine, DEFAULT_HANDLE_POSITION, HANDLE_POSITIONS, hasBrandMark } from '../../shared/brand-kit'
import { createSkillPatch, createSkillRows, stageLayoutsOn, type SkillId, type SkillRow } from '../../shared/skills'
import { MUSIC_TRACKS, musicTrackLabel } from '../../shared/music'
import type { ReferenceLook } from '../../shared/purpose'
import { SkillsPanel } from './SkillsPanel'
import { PurposeFields } from './PurposeFields'

const DURATIONS = DURATION_OPTIONS

const FORMATS = [
  { id: '9:16', label: 'Vertical', hint: 'Shorts, Reels, TikTok', w: 12, h: 21 },
  { id: '16:9', label: 'Horizontal', hint: 'YouTube, X, LinkedIn', w: 24, h: 14 }
] as const

const LAYOUT_STYLES = [
  { id: 'auto', label: 'Smart', hint: 'Auto frames each shot' },
  { id: 'fill', label: 'Full frame', hint: 'Follows the speaker' },
  { id: 'fit', label: 'Classic', hint: 'Whole frame, blurred' }
] as const

/** Screen share clips under Smart framing (videos with a shared screen and a webcam). */
export const SCREEN_FOCUS_OPTIONS: { id: ScreenFocus; label: string; hint: string; summary: string }[] = [
  { id: 'smart', label: 'Smart mix', hint: 'Each clip shows just you, or your screen above you, depending on whether the screen matters to it.', summary: 'Smart mix · just you or split, clip by clip' },
  { id: 'split', label: 'Split screen', hint: 'Your screen on top and you below in every clip. Long stretches where the screen doesn’t change show just you.', summary: 'Split screen in every clip' },
  { id: 'presenter', label: 'Presenter only', hint: 'Just you, filling the frame, in every clip. If your webcam is too small to fill it, the split is used.', summary: 'Just you in every clip' }
]

const BROLL_OPTIONS = [
  { id: 'off', label: 'Off', hint: 'Just the speaker', summary: 'Off' },
  { id: 'after-hook', label: 'After the hook', hint: 'Speaker for 3 s first', summary: 'Footage after a 3 s speaker hook' },
  { id: 'full', label: 'Whole clip', hint: 'Footage from the start', summary: 'Footage for the whole clip' }
] as const

const MAX_CLIPS = 100

/** The Create defaults the Format and Clips summaries compare against. */
const DEFAULTS = useDraftStore.getInitialState()

/** Clipping modes, by outcome; the models behind each are under Details. */
export const CLIPPING_MODE_OPTIONS = [
  { id: 'quality', label: 'Best quality', hint: 'Most accurate picks and captions', summary: 'Best quality' },
  { id: 'economy', label: 'Lower cost', hint: 'Cheaper, may be less accurate', summary: 'Lower cost' },
  { id: 'advanced', label: 'Choose models', hint: 'Pick your own OpenRouter models', summary: 'Your own models' }
] as const

export const WIZARD_STEPS: { id: WizardStep; label: string; title: string; description: string }[] = [
  { id: 'video', label: 'Video', title: 'Choose a video', description: 'A local file, YouTube link or Twitch VOD link. Optionally suggest where to find clips.' },
  { id: 'clips', label: 'Clips', title: 'What to clip, length and count', description: 'Optionally describe the moments you want. Pick one or more lengths, or none for any length.' },
  { id: 'captions', label: 'Look', title: 'Look', description: 'Choose how captions look. Word-by-word captions are burned into each clip; silent videos are clipped without them.' },
  { id: 'format', label: 'More options', title: 'Format, framing and speed', description: 'Choose the format, framing and pace of every clip in this job.' },
  { id: 'review', label: 'Review', title: 'Review and generate', description: 'Check the run, then generate. You can queue another video right after.' }
]

export const QUALITY_BAR_OPTIONS: { id: QualityBar; label: string; hint: string; summary: string }[] = [
  { id: 'b', label: 'B or better', hint: 'Recommended', summary: 'Keeps the good clips and better' },
  { id: 'a', label: 'Standouts', hint: 'A first, topped up with B', summary: 'Keeps the standout clips, topped up with good ones' },
  { id: 'c', label: 'C or better', hint: 'More clips', summary: 'Keeps the OK clips and better' },
  { id: 'all', label: 'Grade all', hint: 'Keep everything', summary: 'Keeps every clip, each with its grade' },
  { id: 'off', label: 'Off', hint: 'No grading', summary: 'Keeps every clip, no grading' }
]

export function parseTrimRange(enabled: boolean, startText: string, endText: string): {
  start: number | null
  end: number | null
  error: string | null
} {
  const start = enabled ? parseTimecode(startText) : null
  const end = enabled ? parseTimecode(endText) : null
  let error: string | null = null
  if (Number.isNaN(start) || Number.isNaN(end)) error = 'Use seconds (90) or a timecode (1:30).'
  else if (end != null && end <= (start ?? 0)) error = 'End must be after the start.'
  return { start, end, error }
}

/** Every video in the draft: the list when several were added, else the one source. */
export function draftSources(draft: Pick<ClipDraft, 'source' | 'sources'>): string[] {
  const list = draft.sources ?? []
  if (list.length > 1 && list[0] === draft.source) return list
  return draft.source.trim() ? [draft.source] : []
}

/** Where the run's b-roll comes from: the member's pick when it can run, otherwise the default (My library when it has shots). Never AI unless picked. */
export function draftBrollSource(draft: Pick<ClipDraft, 'brollSource'>): BrollSource | null {
  const settings = useSettingsStore.getState()
  return effectiveBrollSource(draft.brollSource, { libraryShots: useBrollLibrary.getState().view?.usableShots ?? 0, pexels: settings.pexelsConfigured, openrouter: settings.openrouterConfigured })
}

/** The review line for "B-roll from" (none chosen yet says so). */
export function brollFromSummary(source: BrollSource | null, ai: Parameters<typeof aiEstimateLine>[0]): string {
  if (!source) return 'Not chosen yet: pick where b-roll comes from'
  return `${BROLL_SOURCE_LABELS[source]}${usesAi(source) ? ` · ${aiEstimateLine(ai)}` : ''}`
}

const brollSourceField = (source: BrollSource | null): { brollSource?: BrollSource } => source ? { brollSource: source } : {}

/** One run request per video, all with the same settings. A preferred range only applies to a single video. */
export function buildJobRequests(draft: ClipDraft, trim: { start: number | null; end: number | null }): ClipJobRequest[] {
  const sources = draftSources(draft)
  return sources.map((source) => buildJobRequest({ ...draft, source }, sources.length > 1 ? { start: null, end: null } : trim))
}

/** The run request for the current draft. */
export function buildJobRequest(draft: ClipDraft, trim: { start: number | null; end: number | null }): ClipJobRequest {
  if (!draft.workflow) throw new Error('Choose a workflow before creating clips.')
  return {
    videoUrl: normalizeVideoSource(draft.source),
    workflow: draft.workflow,
    clippingMode: draft.clippingMode,
    ...(draft.clippingMode === 'advanced' ? { plannerModel: draft.plannerModel, transcriptionModel: draft.transcriptionModel } : {}),
    ...(draft.clipRequest?.trim() ? { clipRequest: draft.clipRequest.trim() } : {}),
    maxClips: draft.autoClipCount ? null : draft.maxClips,
    autoClipCount: draft.autoClipCount,
    durationRanges: draft.durations.length > 0 ? draft.durations : null,
    aspectRatio: draft.aspectRatio,
    layoutStyle: draft.layoutStyle,
    layoutVision: draft.clippingMode !== 'economy' && draft.aspectRatio === '9:16' && draft.layoutStyle === 'auto' && draft.layoutVision,
    // Smart framing only; the engine's default is the smart mix.
    ...(draft.aspectRatio === '9:16' && draft.layoutStyle === 'auto' && draft.screenFocus && draft.screenFocus !== 'smart' ? { screenFocus: draft.screenFocus } : {}),
    pacing: draft.pacing,
    videoSpeed: draft.videoSpeed ?? 1,
    includeCaptions: draft.includeCaptions,
    captionPreset: draft.captionPreset,
    includeTitle: draft.includeTitle,
    titleStyle: draft.titleStyle ?? 'headline',
    headlineLook: draft.headlineLook ?? DEFAULT_HEADLINE_LOOK,
    ...(draft.workflow !== 'review' && parseLookExtras(draft.lookExtras).length ? { lookExtras: parseLookExtras(draft.lookExtras) } : {}),
    ...(draft.ctaId && draft.workflow !== 'review' ? { ctaId: draft.ctaId } : {}),
    ...(draft.workflow === 'automatic' && draft.aspectRatio === '9:16' && draft.backgroundVideo && draft.broll === 'off' ? { backgroundVideo: draft.backgroundVideo } : {}),
    ...(draft.workflow === 'automatic' && draft.broll !== 'off' ? { broll: draft.broll, ...brollSourceField(draftBrollSource(draft)) } : {}),
    ...(draft.workflow === 'automatic' && draft.hookPreview ? { hookPreview: true } : {}),
    ...(draft.workflow === 'automatic' && draft.motionGraphics ? { motionGraphics: true, ...(draft.register ? { register: draft.register } : {}) } : {}),
    ...(draft.workflow === 'automatic' && stageLayoutsOn(draft) ? { stageLayouts: true } : {}),
    ...(draft.workflow === 'automatic' && draft.motionGraphics && draft.soundEffects ? { soundEffects: true } : {}),
    qualityBar: draft.qualityBar,
    headlineVoice: draft.headlineVoice,
    ...(draft.workflow === 'automatic' && isCaptionLanguage(draft.captionLanguage) ? { captionLanguage: draft.captionLanguage } : {}),
    ...brandRequestFields(draft),
    // Skills: music and voice cleanup (Automatic).
    ...(draft.workflow === 'automatic' && draft.music ? { music: true, ...(draft.musicTrack ? { musicTrack: draft.musicTrack } : {}) } : {}),
    ...(draft.workflow === 'automatic' && draft.voiceCleanup ? { voiceCleanup: true } : {}),
    // "Say what it's for".
    ...(draft.purpose?.trim() ? { purpose: draft.purpose.replace(/\s+/g, ' ').trim() } : {}),
    ...(draft.reference ? { referenceImage: draft.reference.id } : {}),
    startTimeSeconds: trim.start,
    endTimeSeconds: trim.end,
    bannerPlatform: null,
    bannerChannelUrl: null
  }
}

interface JobFormProps {
  /** One request per video (several when the member added more than one). */
  onSubmit: (configs: ClipJobRequest[]) => void
  /** Opens a queued job on the Jobs page. */
  onViewJob?: (jobId: string) => void
  /** Why the job can't start yet (missing keys, tools); disables submit. */
  blockedReason?: ReactNode
  submitting?: boolean
  /** Opens Remix (the Video step's note for reacting to someone else's video). */
  onOpenRemix?: () => void
  /** Opens the Brand look page (the Look step's "Edit looks"). */
  onOpenBrandLook?: () => void
  /** The page header, then what sits above the steps (the setup checklist) and below them (Today's 3), in the left column. */
  header?: ReactNode
  lead?: ReactNode
  trail?: ReactNode
  className?: string
}

type Update = (patch: Partial<ClipDraft>) => void

/** Links typed in the empty video field and not used yet (none if any part isn't a valid link). */
function pendingLinks(draft: Pick<ClipDraft, 'source'> & { pendingLink: string }): string[] {
  if (draft.source.trim() || !draft.pendingLink.trim()) return []
  const { links, invalid } = parseSourceText(draft.pendingLink)
  return invalid.length ? [] : mergeSources([], links).sources
}

/** The workflow row's one-line summary. */
const WORKFLOW_SUMMARY = { automatic: 'Automatic · export when done', review: 'Review & edit · you make the final cut' } as const

/** A step's one-line summary when it's folded. */
function stepSummary(id: WizardStep, draft: ClipDraft, brandName: string | null): string {
  if (id === 'video') {
    const sources = draftSources(draft)
    if (sources.length > 1) return `${sources.length} videos · ${sourceLabel(sources[0])} and ${sources.length - 1} more`
    return sources.length ? sourceLabel(sources[0]) : 'No video yet'
  }
  if (id === 'clips') {
    const parts = clipsSummary(draft).map((part) => part.text)
    return [draft.clipRequest?.trim() ? `“${draft.clipRequest.trim()}”` : null, ...parts].filter(Boolean).join(' · ')
  }
  if (id === 'captions') {
    const board = createBoardStyle(draft)
    return [
      draft.includeCaptions ? `${CAPTION_PRESET_NAMES[draft.captionPreset] ?? draft.captionPreset} captions` : 'No captions',
      draft.workflow !== 'review' ? HOOK_LABELS[board.hook] : null,
      brandName,
      draft.workflow !== 'review' && draft.ctaId ? 'call to action at the end' : null
    ].filter(Boolean).join(' · ')
  }
  if (id === 'format') {
    const format = FORMATS.find((item) => item.id === draft.aspectRatio)?.label ?? draft.aspectRatio
    const framing = draft.aspectRatio === '9:16' ? LAYOUT_STYLES.find((item) => item.id === draft.layoutStyle)?.label : null
    return [format, framing, ...formatSummary({ ...draft, brollSource: draft.brollSource }).map((part) => part.text)].filter(Boolean).join(' · ')
  }
  return 'Every setting in one list, each with Edit'
}

/**
 * Create: a vertical list of steps (Workflow, Video, Clips, Look, More
 * options, Review). The open step expands in place; the others fold to one
 * line with Change. The preview panel beside them shows the look on three
 * sample tiles, the run in one sentence and the Generate button. After
 * Generate the job is queued and the form offers the next video.
 */
export function JobForm({ onSubmit, onViewJob, blockedReason, submitting, onOpenRemix, onOpenBrandLook, header, lead, trail, className }: JobFormProps): React.JSX.Element {
  const draft = useDraftStore()
  const { update, step, setStep } = draft
  // Customize on Format and Clips: unset until the member opens or closes it (then each step starts open only when something differs from the defaults).
  const [customize, setCustomize] = useState<Partial<Record<'format' | 'clips', boolean>>>({})
  // The workflow row stays open until one is chosen and the member moves on (Change opens it again).
  const [workflowOpen, setWorkflowOpen] = useState(() => useDraftStore.getState().workflow === null)
  const brand = useBrands((s) => s.brands.find((item) => item.id === draft.brandIdentityId) ?? null)

  const sourceCount = draftSources(draft).length
  // A preferred range applies to a single video only.
  const trimOn = draft.trimOpen && sourceCount <= 1
  const trim = useMemo(
    () => parseTrimRange(trimOn, draft.trimStart, draft.trimEnd),
    [trimOn, draft.trimStart, draft.trimEnd]
  )

  const index = WIZARD_STEPS.findIndex((s) => s.id === step)
  const sourceError = twitchSourceError(draft.source)
  // A valid link still in the field counts: Next and Generate use it.
  const pending = pendingLinks(draft)
  const hasSource = (Boolean(draft.source.trim()) && !sourceError) || pending.length > 0
  const videoValid = hasSource && draft.workflow !== null && !trim.error
  const modelsValid = draft.clippingMode !== 'advanced' || (isModelId(draft.plannerModel) && isModelId(draft.transcriptionModel))
  const stepValid = videoValid && (step !== 'clips' || modelsValid)
  const canSubmit = videoValid && modelsValid && !blockedReason && !submitting && !draft.started

  /** Uses a valid link still in the field as the video; returns the draft with it. */
  const takePendingLink = (): ClipDraft => {
    if (!pending.length) return draft
    const patch = { source: pending[0], sources: pending }
    useDraftStore.setState({ ...patch, pendingLink: '' })
    return { ...draft, ...patch }
  }

  const submit = (): void => {
    if (canSubmit) onSubmit(buildJobRequests(takePendingLink(), trim))
  }

  // ⌘↵ / Ctrl+↵ generates only once a video and workflow are chosen.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (draft.started) {
    return <div className={cn('space-y-4', className)}>{header}{lead}<StartedPanel onViewJob={onViewJob} />{trail}</div>
  }

  const goTo = (target: WizardStep): void => {
    takePendingLink()
    setWorkflowOpen(false)
    setStep(target)
    // Bring the opened step's row into view.
    requestAnimationFrame(() => document.getElementById(`create-step-${target}`)?.scrollIntoView?.({ block: 'nearest' }))
  }
  const go = (target: SummaryTarget): void => {
    if (target === 'workflow') {
      setWorkflowOpen(true)
      requestAnimationFrame(() => document.getElementById('create-step-workflow')?.scrollIntoView?.({ block: 'nearest' }))
      return
    }
    if (target !== 'video' && !videoValid) { goTo('video'); return }
    goTo(target)
  }
  const next = WIZARD_STEPS[index + 1]
  const back = WIZARD_STEPS[index - 1]
  const automatic = draft.workflow !== 'review'
  const board = createBoardStyle(draft)
  const rows: BoardRows = automatic ? { hooks: createHooks(draft), handle: true, cta: true, keyword: true, extras: true } : {}
  const sentence = createSentence(draft, { sources: hasSource ? (pending.length ? pending : draftSources(draft)) : [], trimError: trim.error, modelsValid })
  const actionLabel = !draft.workflow ? 'Choose a workflow to continue'
    : !hasSource ? 'Add a video to continue'
      : trim.error ? 'Fix the preferred part to continue'
        : !modelsValid ? 'Choose both models to continue'
          : draft.workflow === 'review' ? 'Find candidates' : sourceCount > 1 ? `Generate clips for ${sourceCount} videos` : 'Generate clips'
  const hint = blockedReason ?? (!videoValid || !modelsValid ? null
    : sourceCount > 1 ? `${sourceCountLabel(sourceCount)}, one job each.` : 'Runs on this computer. Transcription and planning bill your OpenRouter account.')

  const body = (id: WizardStep): ReactNode => {
    switch (id) {
      case 'video': return <VideoStep draft={draft} update={update} trimError={trim.error} disabled={submitting} onOpenRemix={onOpenRemix} />
      case 'format': return <FormatStep draft={draft} update={update} customize={customize.format} onCustomize={(format) => setCustomize((value) => ({ ...value, format }))} />
      case 'clips': return <ClipsStep draft={draft} update={update} customize={customize.clips} onCustomize={(clips) => setCustomize((value) => ({ ...value, clips }))} />
      case 'captions': return <>
        {draft.workflow === 'review' && (
          <aside aria-labelledby="caption-editor-note" className="mb-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
            <span className="eyebrow text-accent">Review &amp; edit</span>
            <h2 id="caption-editor-note" className="mt-1 text-sm font-semibold text-ink">Adjust captions in the editor</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Choose a starting style below. Before exporting, you can change how captions look, reposition them, or hide them from selected parts of each clip.
            </p>
          </aside>
        )}
        <CaptionsStep draft={draft} update={update} onOpenBrandLook={onOpenBrandLook} />
      </>
      default: return <ReviewStep draft={draft} trim={trim} onEdit={goTo} />
    }
  }
  const description = (id: WizardStep): string | null => {
    if (id === 'video') return null
    if (id === 'review' && draft.workflow === 'review') return 'A quality check reviews each candidate before the editor opens for your final cut.'
    if (id === 'captions' && draft.workflow === 'automatic') return 'Turn parts of the edit on or off in Skills, then choose how captions and hook text look. Silent videos are clipped without captions.'
    return WIZARD_STEPS.find((item) => item.id === id)?.description ?? null
  }

  return (
    <div className={cn('grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_360px]', className)}>
      <div className="min-w-0 space-y-4">
        {header}
        {lead}
        <CreateStartFrom />
        <nav aria-label="Create steps" id="create-steps" className="scroll-mt-4">
          <ol className="flex flex-col">
            <StepRow id="workflow" number={1} title="Workflow" done={draft.workflow !== null} open={workflowOpen || draft.workflow === null}
              summary={draft.workflow ? WORKFLOW_SUMMARY[draft.workflow] : 'Choose one to continue'} missing={!draft.workflow}
              onToggle={() => setWorkflowOpen(!(workflowOpen || draft.workflow === null))} canFold={draft.workflow !== null}>
              <WorkflowPicker value={draft.workflow} onChange={(workflow) => update({ workflow })} disabled={submitting} />
            </StepRow>
            {WIZARD_STEPS.map((s, i) => {
              const active = s.id === step
              const enabled = s.id === 'video' || videoValid
              const done = !active && enabled && (s.id === 'video' ? hasSource && !trim.error : s.id === 'clips' ? modelsValid : s.id !== 'review')
              return (
                <StepRow key={s.id} id={s.id} number={i + 2} title={s.label} active={active} done={done} open={active} disabled={!enabled}
                  last={i === WIZARD_STEPS.length - 1}
                  summary={active ? '' : stepSummary(s.id, draft, brand?.name ?? null)}
                  missing={!active && s.id === 'video' && !hasSource} onToggle={() => goTo(s.id)}>
                  {description(s.id) && <p className="-mt-1 mb-3 text-xs text-ink-muted">{description(s.id)}</p>}
                  {sourceError && s.id === 'video' && <p role="alert" className="mb-2 text-sm text-danger">{sourceError}</p>}
                  {body(s.id)}
                  {s.id !== 'video' && sourceCount > 1 && <p className="mt-3 text-2xs text-ink-subtle" data-testid="batch-note">{sourceCountLabel(sourceCount)} with these settings, one job each.</p>}
                  <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3">
                    {back ? (
                      <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />} onMouseDown={keepFocus} onClick={() => goTo(back.id)}>Back</Button>
                    ) : <span />}
                    <p className="min-w-0 flex-1 truncate text-center text-2xs text-ink-subtle">
                      {!draft.workflow ? 'Choose a workflow to continue.' : !modelsValid && step === 'clips' ? 'Choose both models in Advanced mode.' : step === 'video' && !hasSource ? 'Add a video to continue.' : `${MOD_KEY}↵ generates from any step`}
                    </p>
                    {next && <Button variant="secondary" size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />} onMouseDown={keepFocus} onClick={() => goTo(next.id)} disabled={!stepValid}>
                      Next: {next.label}
                    </Button>}
                  </div>
                </StepRow>
              )
            })}
          </ol>
        </nav>
        {trail}
      </div>
      <CreatePreview board={board} rows={rows} aspect={draft.aspectRatio === '16:9' ? '16:9' : '9:16'} source={pending[0] ?? draft.source} durations={draft.durations}
        sentence={sentence} onGo={go} actionLabel={actionLabel} canSubmit={canSubmit} submitting={submitting} onSubmit={submit} hint={hint} blocked={Boolean(blockedReason)} />
    </div>
  )
}

/**
 * Mouse presses on the step buttons keep focus where it is: leaving the link
 * field would use the link and resize the open step under the pointer before
 * the click lands. The click itself uses a link still in the field.
 */
function keepFocus(e: React.MouseEvent): void {
  if (document.activeElement instanceof HTMLInputElement) e.preventDefault()
}

/**
 * One row of the step list: a numbered (or checked) node on the rail, the
 * step's name and a one-line summary with Change; the open step's settings
 * below it.
 */
function StepRow({ id, number, title, summary, active = false, done, open, disabled = false, missing = false, last = false, canFold = true, onToggle, children }: {
  id: WizardStep | 'workflow'; number: number; title: string; summary: string; active?: boolean; done: boolean; open: boolean; disabled?: boolean
  missing?: boolean; last?: boolean; canFold?: boolean; onToggle: () => void; children: ReactNode
}): React.JSX.Element {
  const titleId = `create-step-${id}-title`
  const summaryId = `create-step-${id}-summary`
  const node = active || (open && !done) ? 'active' : done ? 'done' : disabled ? 'off' : 'idle'
  return (
    <li id={`create-step-${id}`} className="flex scroll-mt-3 gap-4" data-step={id} data-state={node}>
      <div className="flex w-[30px] shrink-0 flex-col items-center">
        <span aria-hidden className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-full font-mono text-xs font-medium tabular transition-colors duration-200',
          node === 'active' ? 'bg-tool text-accent-ink shadow-[0_0_0_4px_rgb(var(--tool)/0.15),0_0_18px_rgb(var(--tool)/0.35)]'
            : node === 'done' ? 'border border-tool/40 bg-tool/[0.12] text-tool'
              : node === 'off' ? 'border border-white/[0.06] text-ink-faint' : 'border border-white/[0.12] text-ink-muted')}>
          {node === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : number}
        </span>
        {!last && <span aria-hidden className={cn('my-1 w-0.5 flex-1 rounded-full', done ? 'bg-tool/30' : 'bg-white/[0.07]')} />}
      </div>
      <div className={cn('min-w-0 flex-1', last ? 'pb-1' : 'pb-3.5')}>
        <button type="button" onMouseDown={keepFocus} onClick={() => { if (!(active && open) && !(open && !canFold)) onToggle() }} disabled={disabled} aria-current={active ? 'step' : undefined}
          aria-expanded={disabled ? undefined : open} aria-controls={open ? `create-step-${id}-body` : undefined} aria-labelledby={`${id}-step-number ${titleId}`} aria-describedby={summaryId}
          className="group flex min-h-[30px] w-full items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default">
          <span id={`${id}-step-number`} className="sr-only">Step {number}:</span>
          <span id={titleId} className={cn('shrink-0 font-display text-base font-semibold tracking-[-0.01em]', disabled ? 'text-ink-faint' : 'text-ink')}>{title}</span>
          <span id={summaryId} className={cn('min-w-0 flex-1 truncate text-xs', missing ? 'text-warning' : 'text-ink-muted')}>{summary}</span>
          {!disabled && !open && <span aria-hidden className="shrink-0 text-xs text-ink-muted group-hover:text-ink">Change</span>}
          {!disabled && open && canFold && !active && <span aria-hidden className="shrink-0 text-xs text-ink-muted group-hover:text-ink">Done</span>}
        </button>
        {open && (
          <div id={`create-step-${id}-body`} role="group" aria-labelledby={titleId} className="glass mt-2.5 rounded-[14px] p-4 animate-fade-in xl:p-5">
            {children}
          </div>
        )}
      </div>
    </li>
  )
}

export const HEADLINE_VOICE_OPTIONS: { id: HeadlineVoice; label: string; hint: string; summary: string }[] = [
  { id: 'clipper', label: 'Someone else’s', hint: 'Headlines about the speaker: “He admits he doesn’t know…”', summary: 'Someone else’s · headlines about the speaker' },
  { id: 'creator', label: 'My own video', hint: 'Headlines in your voice: “I don’t know what makes great carousels”', summary: 'Your own · headlines in your voice' }
]

/** Whose video it is decides the headline voice: the creator posting their own clips, or a clipper posting someone else's. */
function HeadlineVoicePicker({ value, onChange, disabled }: { value: HeadlineVoice; onChange: (value: HeadlineVoice) => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div>
      <p className="text-sm font-medium text-ink" id="headline-voice-label">Whose video is this?</p>
      <p className="mb-2 mt-0.5 text-2xs text-ink-muted" id="headline-voice-help">Headlines talk about the speaker when it’s someone else’s video, or speak in your voice when it’s yours.</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="headline-voice-label" aria-describedby="headline-voice-help">
        {HEADLINE_VOICE_OPTIONS.map((option) => {
          const selected = value === option.id
          return (
            <button key={option.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} disabled={disabled} onKeyDown={onRadioKeyDown}
              onClick={() => onChange(option.id)}
              className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <span className="block text-xs font-medium">{option.label}</span>
              <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{option.hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function VideoStep({ draft, update, trimError, disabled, onOpenRemix }: { draft: ClipDraft; update: Update; trimError: string | null; disabled?: boolean; onOpenRemix?: () => void }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <section aria-labelledby="video-source-heading" className="space-y-3">
        <div>
          <h2 id="video-source-heading" className="text-sm font-semibold text-ink">{WIZARD_STEPS[0].title}</h2>
          <p className="mt-0.5 text-xs text-ink-muted">{WIZARD_STEPS[0].description}</p>
        </div>
        <SourcePicker value={draft.source} sources={draft.sources} disabled={disabled}
          onChange={(source) => update({ source, sources: source ? [source] : [] })}
          onSourcesChange={(sources) => update({ sources, source: sources[0] ?? '' })}
          onPendingChange={(pendingLink) => useDraftStore.setState({ pendingLink })} />
      </section>
      <PurposeFields purpose={draft.purpose ?? ''} onPurpose={(purpose) => update({ purpose })} reference={draft.reference ?? null} disabled={disabled}
        onReference={(reference) => update({ reference })} model={{ clippingMode: draft.clippingMode, ...(draft.clippingMode === 'advanced' ? { plannerModel: draft.plannerModel } : {}) }}
        onUseLook={(look) => update(createReferencePatch(draft, look))} />
      <HeadlineVoicePicker value={draft.headlineVoice} onChange={(headlineVoice) => update({ headlineVoice })} disabled={disabled} />
      {onOpenRemix && <p className="flex flex-wrap items-center gap-x-1 text-2xs text-ink-subtle" data-testid="remix-note">
        Want to react to someone else’s video with your own take?
        <button type="button" onClick={onOpenRemix} className="rounded font-medium text-accent hover:underline focus-visible:underline">Use Remix</button>
      </p>}
      {draftSources(draft).length > 1 ? <p className="text-2xs text-ink-subtle">A preferred part of the video applies to one video at a time, so it is off when you clip several.</p> : <><SettingRow
        title="Preferred part of the video"
        description="Suggest where to find clips. The full source is transcribed; boundaries may expand to preserve complete ideas."
        control={<Switch label="Prefer a source range" checked={draft.trimOpen} onChange={(trimOpen) => update({ trimOpen })} />}
      />
      {draft.trimOpen && (
        <div className="animate-fade-in">
          <div className="grid grid-cols-2 gap-2">
            <TextInput
              mono
              placeholder="Start 0:00"
              value={draft.trimStart}
              onChange={(e) => update({ trimStart: e.target.value })}
              aria-label="Start time"
              aria-invalid={Boolean(trimError)}
              aria-describedby="trim-help"
            />
            <TextInput
              mono
              placeholder="End"
              value={draft.trimEnd}
              onChange={(e) => update({ trimEnd: e.target.value })}
              aria-label="End time"
              aria-invalid={Boolean(trimError)}
              aria-describedby="trim-help"
            />
          </div>
          <p id="trim-help" role={trimError ? 'alert' : undefined} className={cn('mt-1.5 text-2xs', trimError ? 'text-danger' : 'text-ink-subtle')}>
            {trimError ?? 'Use seconds (90) or mm:ss (1:30).'}
          </p>
        </div>
      )}</>}
    </div>
  )
}

/** One part of a step's summary; `changed` when it differs from the defaults. */
export interface SummaryPart { text: string; changed: boolean }

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** What the Format step's options will do, in a few words each (framing and format are shown as choices). */
export function formatSummary(draft: Pick<ClipDraft, 'aspectRatio' | 'layoutStyle' | 'clippingMode' | 'layoutVision' | 'screenFocus' | 'pacing' | 'videoSpeed' | 'workflow' | 'broll' | 'backgroundVideo'> & { brollSource?: ClipDraft['brollSource'] }): SummaryPart[] {
  const parts: SummaryPart[] = []
  const smart = draft.aspectRatio === '9:16' && draft.layoutStyle === 'auto'
  if (smart && draft.clippingMode !== 'economy') parts.push(draft.layoutVision === false ? { text: 'no AI shot checks', changed: true } : { text: 'AI checks tricky shots', changed: false })
  const focus = draft.screenFocus ?? 'smart'
  if (smart && focus !== DEFAULTS.screenFocus) parts.push({ text: lowerFirst(SCREEN_FOCUS_OPTIONS.find((option) => option.id === focus)?.summary ?? focus), changed: true })
  parts.push(draft.pacing === 'natural' ? { text: 'pauses kept', changed: true } : { text: 'dead air cut', changed: false })
  const speed = draft.videoSpeed ?? 1
  parts.push(speed === DEFAULTS.videoSpeed ? { text: 'normal speed', changed: false } : { text: `${speed}× speed`, changed: true })
  if (draft.workflow !== 'review') {
    const broll = draft.broll ?? 'off'
    if (broll !== 'off') parts.push({ text: `B-roll: ${lowerFirst(BROLL_OPTIONS.find((option) => option.id === broll)?.summary ?? broll)}${draft.brollSource ? ` · ${BROLL_SOURCE_LABELS[draft.brollSource]}` : ''}`, changed: true })
    else if (draft.aspectRatio === '9:16' && draft.backgroundVideo) parts.push({ text: `${draft.backgroundVideo} under the speaker`, changed: true })
    else parts.push({ text: 'no B-roll', changed: false })
  }
  return parts
}

/** What the Clips step's options will do (what to clip is shown as a field). */
export function clipsSummary(draft: Pick<ClipDraft, 'clippingMode' | 'durations' | 'qualityBar' | 'autoClipCount' | 'maxClips' | 'hookPreview' | 'workflow' | 'videoSpeed'>): SummaryPart[] {
  const parts: SummaryPart[] = []
  const mode = CLIPPING_MODE_OPTIONS.find((option) => option.id === draft.clippingMode) ?? CLIPPING_MODE_OPTIONS[0]
  parts.push({ text: mode.summary, changed: mode.id !== DEFAULTS.clippingMode })
  const durations = draft.durations ?? []
  const sameLengths = durations.length === DEFAULTS.durations.length && DEFAULTS.durations.every((id) => durations.includes(id))
  parts.push(durations.length === 0
    ? { text: 'any length', changed: true }
    // Lengths are of the original footage; a faster speed makes the clips shorter.
    : { text: `${DURATIONS.filter((d) => durations.includes(d.id)).map((d) => d.range).join(', ')} clips${(draft.videoSpeed ?? 1) > 1 ? ' (of source footage)' : ''}`, changed: !sameLengths })
  const bar = QUALITY_BAR_OPTIONS.find((option) => option.id === (draft.qualityBar ?? DEFAULTS.qualityBar)) ?? QUALITY_BAR_OPTIONS[0]
  parts.push(bar.id === DEFAULTS.qualityBar ? { text: 'good clips and better', changed: false } : { text: lowerFirst(bar.summary), changed: true })
  parts.push(draft.autoClipCount === false ? { text: `up to ${draft.maxClips} clip${draft.maxClips === 1 ? '' : 's'}`, changed: true } : { text: 'AI decides how many', changed: false })
  if (draft.workflow !== 'review' && draft.hookPreview) parts.push({ text: 'hook preview on', changed: true })
  return parts
}

/**
 * A step's options in one or two lines, with Customize to show them. Anything
 * changed from the defaults is named, so nothing is hidden silently.
 */
function RecommendedSummary({ id, parts, open, onToggle }: { id: string; parts: SummaryPart[]; open: boolean; onToggle: () => void }): React.JSX.Element {
  const changed = parts.filter((part) => part.changed)
  const sentence = parts.map((part) => part.text).join(', ')
  return (
    <div className="glass-tile flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5" data-testid={`${id}-summary`}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">{changed.length ? 'Your settings' : 'Recommended'}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{sentence.charAt(0).toUpperCase() + sentence.slice(1)}.</p>
        {changed.length > 0 && <p className="mt-0.5 text-2xs text-ink-subtle" data-testid={`${id}-changed`}>
          Changed from recommended: {changed.map((part) => part.text).join(', ')}.
        </p>}
      </div>
      <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={`${id}-options`} onClick={onToggle}>
        {open ? 'Hide options' : 'Customize'}<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
    </div>
  )
}

/** Customize's open state: the caller's choice, else open at first when something differs from the defaults. */
function useCustomize(parts: SummaryPart[], customize: boolean | undefined, onCustomize?: (open: boolean) => void): [boolean, () => void] {
  const [initial] = useState(() => parts.some((part) => part.changed))
  const [local, setLocal] = useState<boolean | undefined>(undefined)
  const open = customize ?? local ?? initial
  return [open, () => (onCustomize ?? setLocal)(!open)]
}

interface StepProps {
  draft: ClipDraft
  update: Update
  /** Customize open (true) or closed (false); unset: open only when something differs from the defaults. */
  customize?: boolean
  onCustomize?: (open: boolean) => void
}

/** Format, framing and pacing. Exported for the keyboard-navigation test. */
export function FormatStep({ draft, update, customize, onCustomize }: StepProps): React.JSX.Element {
  const setBackground = useCallback((backgroundVideo: string | null) => update(backgroundVideo ? { backgroundVideo, broll: 'off' } : { backgroundVideo }), [update])
  const pexelsConfigured = useSettingsStore((s) => s.pexelsConfigured)
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const { usableShots } = useBrollContext()
  useBrollLibraryLoaded()
  const brollAvailable = pexelsConfigured || openrouterConfigured || usableShots > 0
  const jevEnabled = useSettingsStore((s) => s.jevEnabled === 'on')
  const parts = formatSummary(draft)
  const [open, toggle] = useCustomize(parts, customize, onCustomize)
  return (
    <div className="space-y-4">
      <Group label="Format">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => {
            const selected = draft.aspectRatio === f.id
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onKeyDown={onRadioKeyDown}
                onClick={() => update({ aspectRatio: f.id })}
                className={cn('glass-tile glass-tile-hover flex items-center gap-3 rounded-xl px-3 py-2.5 text-left', selected && 'glass-selected')}
              >
                <span className="flex h-6 w-7 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'rounded-[4px] border-[1.5px] transition-colors duration-200',
                      selected ? 'border-accent bg-accent/25' : 'border-ink-subtle bg-white/[0.04]'
                    )}
                    style={{ width: f.w, height: f.h }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {f.label} <span className="font-mono text-2xs font-normal text-ink-subtle">{f.id}</span>
                  </span>
                  <span className="block truncate text-2xs text-ink-subtle">{f.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Group>

      {draft.aspectRatio === '9:16' && (
        <Group label="Framing">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Framing">
            {LAYOUT_STYLES.map((style) => {
              const selected = draft.layoutStyle === style.id
              return (
                <button
                  key={style.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={onRadioKeyDown}
                  onClick={() => update({ layoutStyle: style.id })}
                  className={cn(
                    'glass-tile glass-tile-hover flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left',
                    selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink'
                  )}
                >
                  <FramingGlyph style={style.id} selected={selected} />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{style.label}</span>
                    <span className={cn('block truncate text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{style.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </Group>
      )}

      <RecommendedSummary id="format" parts={parts} open={open} onToggle={toggle} />

      {open && <div id="format-options" className="space-y-4 animate-fade-in">
      {draft.aspectRatio === '9:16' && draft.layoutStyle === 'auto' && (
        <Group label="Smart framing">
          {draft.clippingMode === 'economy' && (
            <p className="text-2xs text-ink-subtle">AI checks of tricky shots are off with Lower cost.</p>
          )}
          {draft.clippingMode !== 'economy' && (
            <SettingRow
              title="Let AI check tricky shots"
              description="The AI looks at shots where it isn’t sure what to frame. May add OpenRouter charges."
              control={<Switch label="Let AI check tricky shots" checked={draft.layoutVision} onChange={(layoutVision) => update({ layoutVision })} />}
            />
          )}
          <div className="glass-tile mt-2 rounded-xl px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Screen share clips</p>
                  <p className="mt-0.5 text-2xs text-ink-subtle">For videos of your screen with your webcam. Other videos aren’t affected.</p>
                </div>
                <Segmented
                  size="sm"
                  label="Screen share clips"
                  value={draft.screenFocus ?? 'smart'}
                  onChange={(screenFocus) => update({ screenFocus })}
                  options={SCREEN_FOCUS_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                />
              </div>
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-muted">
                {(SCREEN_FOCUS_OPTIONS.find((option) => option.id === (draft.screenFocus ?? 'smart')) ?? SCREEN_FOCUS_OPTIONS[0]).hint}
              </p>
            </div>
        </Group>
      )}

      {draft.workflow !== 'review' && (
        <Group label={<span className="inline-flex items-center gap-1.5">B-roll <Badge tone="warning" className="h-4 px-1.5 text-[10px]">Beta</Badge></span>} aside="From your library, stock or AI">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="B-roll">
            {BROLL_OPTIONS.map((option) => {
              const selected = draft.broll === option.id
              const disabled = option.id !== 'off' && !brollAvailable
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={onRadioKeyDown}
                  onClick={() => update(option.id === 'off' ? { broll: 'off' } : { broll: option.id, backgroundVideo: null })}
                  className={cn(
                    'glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50',
                    selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink'
                  )}
                >
                  <span className="block text-xs font-medium">{option.label}</span>
                  <span className={cn('block truncate text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{option.hint}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-2xs text-ink-subtle">
            {brollAvailable
              ? 'AI picks footage that matches what’s said. The speaker’s audio, captions and title stay.'
              : 'Add clips to your B-roll library, or a free Pexels API key in Settings → API keys, to turn on B-roll.'}
          </p>
          {draft.broll !== 'off' && <div className="mt-3"><BrollSourcePicker value={draft.brollSource} onChange={(brollSource) => update({ brollSource })} /></div>}
        </Group>
      )}

      {draft.aspectRatio === '9:16' && draft.workflow !== 'review' && draft.broll === 'off' && (
        <Group label="Background video" aside="Gameplay split">
          <BackgroundPicker value={draft.backgroundVideo} onChange={setBackground} />
        </Group>
      )}

      <Group label="Pacing">
        <SettingRow
          title="Cut dead air"
          description={`Removes long pauses and filler words.${draft.workflow === 'review' || jevEnabled ? ' The quality check approves each cut.' : ''}`}
          control={
            <Switch label="Cut dead air and filler words" checked={draft.pacing === 'tight'} onChange={(on) => update({ pacing: on ? 'tight' : 'natural' })} />
          }
        />
      </Group>

      <Group label="Video speed" aside="All clips in this job">
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-label="Video speed" aria-describedby="video-speed-help">
          {VIDEO_SPEED_OPTIONS.map((speed) => {
            const selected = (draft.videoSpeed ?? 1) === speed
            return (
              <button key={speed} type="button" role="radio" aria-checked={selected}
                aria-label={`${speed}×${speed === 1 ? ' (Normal)' : ''}`}
                tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                onClick={() => update({ videoSpeed: speed })}
                className={cn('glass-tile glass-tile-hover rounded-xl px-2 py-2 text-center', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                <span className="block font-mono text-sm tabular">{speed}×</span>
                <span className="block text-2xs text-ink-subtle">{speed === 1 ? 'Normal' : `${Math.round(60 / speed)}s per minute`}</span>
              </button>
            )
          })}
        </div>
        <p id="video-speed-help" className="mt-2 text-2xs text-ink-subtle">Speeds up every exported clip, keeping voice pitch natural and captions in sync. Faster clips are shorter.</p>
      </Group>
      </div>}
    </div>
  )
}

export function ClipsStep({ draft, update, customize, onCustomize }: StepProps): React.JSX.Element {
  const jevEnabled = useSettingsStore((s) => s.jevEnabled === 'on')
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const parts = clipsSummary(draft)
  const [open, toggle] = useCustomize(parts, customize, onCustomize)
  // The quality check (Jev): always on for Review & edit, a Settings choice for automatic clips.
  const check = draft.workflow === 'review' ? 'required' : jevEnabled ? 'on' : 'off'
  const toggleDuration = (id: string): void => {
    update({ durations: draft.durations.includes(id) ? draft.durations.filter((d) => d !== id) : [...draft.durations, id] })
  }
  return (
    <div className="space-y-4">
      <Group label="What to clip" aside="Optional">
        <TextArea
          rows={3}
          maxLength={CLIP_REQUEST_MAX_CHARS}
          value={draft.clipRequest ?? ''}
          onChange={(e) => update({ clipRequest: e.target.value })}
          aria-label="What to clip"
          aria-describedby="clip-request-help"
          placeholder="e.g. every time they talk about pricing, or the funniest reactions"
        />
        <p id="clip-request-help" className="mt-2 text-2xs text-ink-subtle">Only matching moments are clipped, so you may get fewer clips, or none. Leave blank for the best moments.</p>
      </Group>
      <RecommendedSummary id="clips" parts={parts} open={open} onToggle={toggle} />
      {open && <div id="clips-options" className="space-y-4 animate-fade-in">
      {draft.workflow !== 'review' && (
        <SettingRow
          title="Hook preview"
          description="Open each clip with its strongest line, then play it from the start. Adds a few seconds; clips under 12 s are left as they are."
          control={<Switch label="Open each clip with its strongest line" checked={draft.hookPreview} onChange={(hookPreview) => update({ hookPreview })} />}
        />
      )}
      <Group label="Clipping mode">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Clipping mode">
          {CLIPPING_MODE_OPTIONS.map((mode) => {
            const selected = draft.clippingMode === mode.id
            return <button key={mode.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
              onKeyDown={onRadioKeyDown} onClick={() => update({ clippingMode: mode.id })}
              className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected && 'glass-selected')}>
              <span className="block text-sm font-medium text-ink">{mode.label}</span>
              <span className="block text-2xs text-ink-subtle">{mode.hint}</span>
            </button>
          })}
        </div>
        {draft.clippingMode === 'advanced' ? <AdvancedModels draft={draft} update={update} /> : <>
          <p className="mt-2 text-2xs text-ink-subtle" data-testid="clipping-mode-help">
            {draft.clippingMode === 'economy'
              ? 'Uses lower-cost AI and skips paid vision checks. If transcription fails, it tries other models. Clip choices and captions may be less accurate.'
              : 'Uses the most accurate AI to transcribe and pick moments.'}
            {check === 'required' ? ' A quality check reviews every candidate before you edit.'
              : check === 'on' ? ' A quality check reviews each clip and fixes problems, using extra OpenRouter credit.'
                : draft.clippingMode === 'economy' ? '' : ' The quality check for automatic clips is off; you can turn it on in Settings.'}
          </p>
          <details className="mt-1.5 text-2xs text-ink-subtle" data-testid="clipping-mode-details">
            <summary className="cursor-pointer select-none hover:text-ink-muted">Details</summary>
            <p className="mt-1 leading-relaxed">
              {draft.clippingMode === 'economy'
                ? 'Planning: GLM 5.3 Flash. Transcription: Whisper Turbo, then Whisper Large V3 and MAI Transcribe 2 if it fails.'
                : 'Planning: GPT-6 Sol. Transcription: MAI Transcribe 2.'}
              {` Quality check: Jev (${check}).`}
            </p>
          </details>
        </>}
      </Group>
      <Group label="Clip length" aside={draft.durations.length === 0 ? 'Any length' : `${draft.durations.length} selected`}>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" role="group" aria-label="Clip length options">
          {DURATIONS.map((d) => {
            const selected = draft.durations.includes(d.id)
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleDuration(d.id)}
                className={cn(
                  'glass-tile glass-tile-hover rounded-xl px-1 py-1.5 text-center',
                  selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink'
                )}
              >
                <span className="block font-mono text-xs tabular">{d.range}</span>
                <span className={cn('block truncate text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{d.label}</span>
              </button>
            )
          })}
        </div>
        {(draft.videoSpeed ?? 1) > 1 && <p className="mt-2 text-2xs text-ink-subtle">Lengths refer to the original footage. At {draft.videoSpeed}×, 60 seconds becomes about {Math.round(60 / draft.videoSpeed)} seconds before dead-air cuts.</p>}
      </Group>

      <Group label="Quality bar" aside="Graded on the Paid Creators frameworks">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Quality bar">
          {QUALITY_BAR_OPTIONS.map((option) => {
            const selected = draft.qualityBar === option.id
            return (
              <button key={option.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                onClick={() => update({ qualityBar: option.id })}
                className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                <span className="block text-xs font-medium">{option.label}</span>
                <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{option.hint}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-2xs text-ink-subtle">
          {!openrouterConfigured
            ? 'Grading uses your OpenRouter key. Add it in Settings to grade clips.'
            : draft.qualityBar === 'off'
              ? 'No grading: clips are picked by the planner alone.'
              : draft.aspectRatio === '16:9' && draft.durations.some((id) => ['xlong', 'extended', 'feature'].includes(id))
                ? 'Long 16:9 episodes are not graded; the bar applies to short clips.'
                : draft.qualityBar === 'all' || draft.clipRequest.trim()
                  ? 'Every clip is graded on hook, payoff and story, and all are kept.'
                  : 'CreatorClips finds extra candidates, grades each on hook, payoff and story, and keeps the ones that make the bar. If too few do, it tops up with the next grade down so you still get a full set.'}
        </p>
      </Group>

      <Group label="Number of clips">
        <SettingRow
          title="Let AI decide"
          description="Every moment worth posting."
          control={<Switch label="Let AI decide how many clips" checked={draft.autoClipCount} onChange={(autoClipCount) => update({ autoClipCount })} />}
        />
        {!draft.autoClipCount && (
          <div className="mt-2 flex max-w-xs items-center gap-2 animate-fade-in">
            <Button
              iconOnly
              aria-label="Fewer clips"
              onClick={() => update({ maxClips: Math.max(1, draft.maxClips - 1) })}
              disabled={draft.maxClips <= 1}
              icon={<Minus className="h-3.5 w-3.5" />}
            />
            <TextInput
              className="flex-1 rounded-full [&_input]:text-center"
              inputMode="numeric"
              value={String(draft.maxClips)}
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
                update({ maxClips: Number.isFinite(n) ? Math.min(MAX_CLIPS, Math.max(1, n)) : 1 })
              }}
              aria-label="Maximum clips"
              mono
            />
            <Button
              iconOnly
              aria-label="More clips"
              onClick={() => update({ maxClips: Math.min(MAX_CLIPS, draft.maxClips + 1) })}
              disabled={draft.maxClips >= MAX_CLIPS}
              icon={<Plus className="h-3.5 w-3.5" />}
            />
          </div>
        )}
      </Group>
      </div>}
    </div>
  )
}

/** Create's hook text choices: the headline looks and the title card, or only the card where the bar can't be drawn. */
export function createHooks(draft: Pick<ClipDraft, 'aspectRatio' | 'backgroundVideo' | 'broll'>): HookChoice[] {
  const headlineUnavailable = draft.aspectRatio !== '9:16' || Boolean(draft.backgroundVideo && draft.broll === 'off')
  return headlineUnavailable ? ['card', 'none'] : ['white', 'black', 'brand', 'floating', 'card', 'none']
}

/** The draft's look on the style board. */
export function createBoardStyle(draft: ClipDraft): BoardStyle {
  const look = draft.headlineLook ?? DEFAULT_HEADLINE_LOOK
  const hooks = createHooks(draft)
  const hook: HookChoice = !draft.includeTitle ? 'none'
    : !hooks.includes('white') || (draft.titleStyle ?? 'headline') === 'card' ? 'card'
      : look.look
  return {
    captions: draft.includeCaptions, captionPreset: draft.captionPreset, hook, font: look.font, color: look.color, ...(look.textBg ? { textBg: look.textBg } : {}),
    ...(look.hideAfterS ? { hideAfterS: look.hideAfterS } : {}),
    handle: draft.showHandle, ctaId: draft.ctaId ?? null, keyword: draft.ctaKeyword ?? '', offer: draft.ctaOffer ?? '', extras: parseLookExtras(draft.lookExtras)
  }
}

/** A board change as draft fields (the same fields the separate pickers set). */
export function createBoardPatch(draft: ClipDraft, patch: Partial<BoardStyle>): Partial<ClipDraft> {
  const out: Partial<ClipDraft> = {}
  if (patch.captions !== undefined) out.includeCaptions = patch.captions
  if (patch.captionPreset !== undefined) out.captionPreset = patch.captionPreset
  let look = draft.headlineLook ?? DEFAULT_HEADLINE_LOOK
  if (patch.font !== undefined || patch.color !== undefined) look = { ...look, ...(patch.font ? { font: patch.font } : {}), ...(patch.color ? { color: patch.color } : {}) }
  if (patch.textBg !== undefined && patch.textBg !== (look.textBg ?? 'none')) look = withTextBg(look, patch.textBg)
  if ('hideAfterS' in patch && patch.hideAfterS !== look.hideAfterS) look = withHideAfterPatch(look, patch)
  if (patch.hook === 'none') out.includeTitle = false
  else if (patch.hook === 'card') { out.includeTitle = true; out.titleStyle = 'card' }
  else if (patch.hook) { out.includeTitle = true; out.titleStyle = 'headline'; look = { ...look, look: patch.hook } }
  if (look !== (draft.headlineLook ?? DEFAULT_HEADLINE_LOOK)) out.headlineLook = look
  if (patch.handle !== undefined) out.showHandle = patch.handle
  if (patch.ctaId !== undefined) out.ctaId = patch.ctaId
  if (patch.keyword !== undefined) out.ctaKeyword = patch.keyword
  if (patch.offer !== undefined) out.ctaOffer = patch.offer
  if (patch.extras !== undefined) out.lookExtras = [...patch.extras]
  return out
}

/** Scrolls a control on this step into view (the Skills panel's "More options"). */
function reveal(id: string): () => void {
  return () => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

/** Extras the Skills list owns on Create (Zoom): one home, so the look's Extras row leaves them out. */
export const CREATE_SKILL_EXTRAS: readonly LookExtraId[] = ['punch_zoom']

/** B-roll's "More options", in place under the skill: when the footage plays (choosing one turns B-roll on). */
function BrollMoreOptions({ draft, update }: { draft: ClipDraft; update: Update }): React.JSX.Element {
  const value = draft.broll ?? 'off'
  return (
    <div className="space-y-1">
      <Segmented size="sm" label="When B-roll plays" value={value}
        options={BROLL_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
        onChange={(broll) => update(broll === 'off' ? { broll } : { broll, backgroundVideo: null })} />
      <p className="text-2xs text-ink-subtle">{BROLL_OPTIONS.find((option) => option.id === value)?.hint ?? ''}. The same choice as B-roll in the Format step, where a gameplay background is too.</p>
      {value !== 'off' && <BrollSourcePicker value={draft.brollSource} onChange={(brollSource) => update({ brollSource })} />}
    </div>
  )
}

/** "Use colors from my reference": the picture's color on the hook bar (where there is one) and its caption style. */
export function createReferencePatch(draft: ClipDraft, look: ReferenceLook): Partial<ClipDraft> {
  const current = draft.headlineLook ?? DEFAULT_HEADLINE_LOOK
  const bar = createHooks(draft).includes('brand')
  return {
    captionPreset: look.captionPreset,
    headlineLook: { ...current, color: look.color, ...(bar ? { look: 'brand' as const } : {}) },
    ...(bar ? { includeTitle: true, titleStyle: 'headline' as const } : {})
  }
}

export function CaptionsStep({ draft, update, onOpenBrandLook }: { draft: ClipDraft; update: Update; onOpenBrandLook?: () => void }): React.JSX.Element {
  const automatic = draft.workflow !== 'review'
  const brand = useBrands((s) => s.brands.find((item) => item.id === draft.brandIdentityId) ?? null)
  const pexels = useSettingsStore((s) => s.pexelsConfigured)
  const openrouter = useSettingsStore((s) => s.openrouterConfigured)
  const { usableShots } = useBrollContext()
  const hooks = createHooks(draft)
  const rows: BoardRows = automatic ? { hooks, handle: true, cta: true, keyword: true, extras: true } : {}
  const skills = createSkillRows(draft, { pexels, openrouter, library: usableShots })
  // "More options": Captions' style is on the look board below; B-roll's timing opens in place. Rough cut, Motion
  // graphics and Zoom have nothing more to set, so they have no link.
  const more = (id: SkillId): (() => void) | undefined => id === 'captions' ? reveal('create-look') : undefined
  const brollRow = skills.find((row) => row.id === 'broll')
  const expand = (id: SkillId): ReactNode | undefined =>
    id === 'broll' && brollRow && !(brollRow.disabledReason && !brollRow.on) ? <BrollMoreOptions draft={draft} update={update} /> : undefined
  return (
    <div className="space-y-3">
      {automatic && <SkillsPanel rows={skills} onToggle={(id, on) => update(createSkillPatch(draft, id, on))} onMore={more} expand={expand}
        music={{ track: draft.musicTrack || null, onChange: (track) => update({ musicTrack: track ?? '' }) }} />}
      <CreateBrandSection draft={draft} update={update} onOpenBrandLook={onOpenBrandLook} />
      <div id="create-look" className="scroll-mt-4">
      <StyleBoard value={createBoardStyle(draft)} onChange={(patch) => update(createBoardPatch(draft, patch))} rows={rows} brand={brand}
        frame={previewFrame(draft.source)} aspect={draft.aspectRatio === '16:9' ? '16:9' : '9:16'} saveKind="create" skillExtras={automatic ? CREATE_SKILL_EXTRAS : undefined}
        hookNote={!hooks.includes('white') ? (draft.aspectRatio !== '9:16' ? 'The headline bar is for vertical clips; 16:9 clips use the title card.' : 'With a gameplay background the clips use the title card.') : undefined}
        keywordHelp={<CreateKeywordHelp draft={draft} />}
        ctaHelp="Add one of your CTA clips to the end of every clip (a video of you up to 15 seconds, or an image). You can change it on any single clip afterward. Added on your computer, so there’s no AI cost." />
      </div>
      {automatic && <CaptionLanguagePicker value={draft.captionLanguage ?? 'original'} onChange={(captionLanguage) => update({ captionLanguage })} />}
    </div>
  )
}

/**
 * The Review step's Skills row: the skills that are on, by their Skills names (Music with its track), or None.
 * Motion graphics are only Skills now: Off until the member turns them on once, then remembered with their style.
 */
export function skillsSummary(rows: readonly SkillRow[], musicTrack: string | null | undefined): string {
  const on = rows.filter((row) => row.on).map((row) => row.id === 'music' ? `${row.label} (${musicTrackLabel(musicTrack || MUSIC_TRACKS[0].id)})` : row.label)
  return on.length ? on.join(' · ') : 'None'
}

export const CAPTION_LANGUAGE_OPTIONS = [
  { value: 'original', label: 'Original', detail: 'As spoken, no translation' },
  ...CAPTION_LANGUAGES.map((language) => ({ value: language.id, label: language.label }))
]

/** Caption language: Original, or captions translated into another language (the speech stays as recorded). */
export function CaptionLanguagePicker({ value, onChange, disabled }: { value: CaptionLanguageChoice; onChange: (value: CaptionLanguageChoice) => void; disabled?: boolean }): React.JSX.Element {
  return (
    <SettingRow
      title="Caption language"
      description={value === 'original'
        ? 'Captions match what is said. Choose a language to translate them.'
        : `Captions, title and hook text in ${captionLanguageLabel(value)}. The speech stays in its original language: only the captions are translated. Adds one OpenRouter request per clip.`}
      control={<Select size="sm" className="w-40" aria-label="Caption language" value={value} options={CAPTION_LANGUAGE_OPTIONS} disabled={disabled}
        onChange={(next) => onChange(isCaptionLanguage(next) ? next : 'original')} />}
    />
  )
}

export function ReviewStep({ draft, trim, onEdit }: {
  draft: ClipDraft
  trim: { start: number | null; end: number | null }
  onEdit: (step: WizardStep) => void
}): React.JSX.Element {
  const active = useActiveJobs()
  const pexels = useSettingsStore((s) => s.pexelsConfigured)
  const openrouterKey = useSettingsStore((s) => s.openrouterConfigured)
  const { usableShots, ai: brollAi } = useBrollContext()
  const automatic = draft.workflow !== 'review'
  const brand = useBrands((s) => s.brands.find((item) => item.id === draft.brandIdentityId) ?? null)
  const runningCount = active.filter((job) => job.status !== 'queued').length
  const lengths = draft.durations.length === 0
    ? 'Any length'
    : DURATIONS.filter((d) => draft.durations.includes(d.id)).map((d) => d.range).join(', ')
  const framing = draft.aspectRatio === '9:16'
    ? `${LAYOUT_STYLES.find((s) => s.id === draft.layoutStyle)?.label ?? 'Smart'} framing${draft.clippingMode !== 'economy' && draft.layoutStyle === 'auto' && draft.layoutVision ? ' · AI checks tricky shots' : ''}`
    : 'Whole frame'
  const trimLabel = draft.trimOpen && (trim.start != null || trim.end != null)
    ? ` · ${trim.start != null ? formatSeconds(trim.start) : 'start'} to ${trim.end != null ? formatSeconds(trim.end) : 'end'}`
    : ''

  const rows: { step: WizardStep; label: string; value: string }[] = [
    { step: 'video', label: 'Workflow', value: draft.workflow === 'review' ? 'Review & edit · export when ready' : 'Automatic' },
    { step: 'video', label: draftSources(draft).length > 1 ? 'Videos' : 'Video', value: draftSources(draft).length > 1
      ? `${draftSources(draft).length} videos · ${sourceLabel(draft.source)} and ${draftSources(draft).length - 1} more`
      : `${sourceLabel(draft.source)}${trimLabel}` },
    // What it's for and the reference picture are set with the video (step 1).
    ...(draft.purpose?.trim() ? [{ step: 'video' as const, label: 'For', value: draft.purpose.trim() }] : []),
    ...(draft.reference ? [{ step: 'video' as const, label: 'Reference', value: draft.reference.name }] : []),
    { step: 'format', label: 'Format', value: `${FORMATS.find((f) => f.id === draft.aspectRatio)?.label ?? draft.aspectRatio} ${draft.aspectRatio} · ${framing}` },
    ...(draft.aspectRatio === '9:16' && draft.layoutStyle === 'auto'
      ? [{ step: 'format' as const, label: 'Screen share', value: (SCREEN_FOCUS_OPTIONS.find((option) => option.id === (draft.screenFocus ?? 'smart')) ?? SCREEN_FOCUS_OPTIONS[0]).summary }]
      : []),
    // Automatic: Rough cut is a skill (the Skills row); Review & edit cuts by hand.
    ...(automatic ? [] : [{ step: 'format' as const, label: 'Pacing', value: 'Manual · choose your own cuts in the editor' }]),
    { step: 'format', label: 'Speed', value: `${draft.videoSpeed ?? 1}×${(draft.videoSpeed ?? 1) === 1 ? ' · Normal' : ' · All exported clips'}` },
    { step: 'clips', label: 'Mode', value: draft.clippingMode === 'advanced' ? 'Your own models' : draft.clippingMode === 'economy' ? 'Lower cost · may be less accurate' : 'Best quality' },
    { step: 'clips', label: 'Clips', value: `${lengths}${(draft.videoSpeed ?? 1) > 1 && draft.durations.length > 0 ? ' of source footage' : ''} · ${draft.autoClipCount ? 'AI decides how many' : `Up to ${draft.maxClips}`}` },
    { step: 'clips', label: 'What to clip', value: draft.clipRequest?.trim() || 'The best moments' },
    ...(draft.workflow !== 'review' && draft.hookPreview ? [{ step: 'clips' as const, label: 'Hook preview', value: 'Opens with the strongest line' }] : []),
    { step: 'video' as const, label: 'Whose video', value: HEADLINE_VOICE_OPTIONS.find((option) => option.id === draft.headlineVoice)?.summary ?? 'Someone else’s' },
    { step: 'clips' as const, label: 'Quality', value: QUALITY_BAR_OPTIONS.find((option) => option.id === draft.qualityBar)?.summary ?? QUALITY_BAR_OPTIONS[0].summary },
    // Skills by their Skills names, so each setting reads the same here as where it's set.
    ...(automatic ? [{ step: 'captions' as const, label: 'Skills', value: skillsSummary(createSkillRows(draft, { pexels, openrouter: openrouterKey, library: usableShots }), draft.musicTrack) }] : []),
    ...(automatic && draft.broll !== 'off' ? [{ step: 'captions' as const, label: 'B-roll from', value: brollFromSummary(draftBrollSource(draft), brollAi) }] : []),
    { step: 'captions', label: 'Captions', value: draft.includeCaptions ? CAPTION_PRESET_NAMES[draft.captionPreset] ?? draft.captionPreset : 'Off' }
  ]
  if (draft.workflow !== 'review' && isCaptionLanguage(draft.captionLanguage)) {
    rows.push({ step: 'captions', label: 'Language', value: `${captionLanguageLabel(draft.captionLanguage)} captions · speech stays original` })
  }
  // The hook text by the name the look board gives it (White bar, Title card, No hook text, ...).
  if (automatic) rows.push({ step: 'captions', label: 'Hook text', value: HOOK_LABELS[createBoardStyle(draft).hook] })
  if (automatic) rows.push({ step: 'captions', label: 'Extras', value: extrasName(parseLookExtras(draft.lookExtras).filter((id) => !CREATE_SKILL_EXTRAS.includes(id))) })
  if (automatic) rows.push({ step: 'captions', label: 'Call to action', value: draft.ctaId ? 'Added to the end of every clip' : 'None' })
  // The brand, comment keyword and handle, as they'll be sent (see brandRequestFields).
  const brandFields = brandRequestFields(draft)
  if (brand) rows.push({ step: 'captions', label: 'Brand', value: `${brand.name} · titles in its voice` })
  if (brandFields.ctaKeyword) {
    rows.push({ step: 'captions', label: 'Keyword', value: isCaptionLanguage(draft.captionLanguage)
      ? `“Comment ${brandFields.ctaKeyword}” at the end · left out of the post caption`
      : `Caption ends with “${createCtaLine(brandFields.ctaKeyword, brandFields.ctaOffer ?? '')}”` })
  }
  if (brand && brandFields.showHandle && hasBrandMark(brand.look)) {
    const corner = HANDLE_POSITIONS.find((item) => item.id === (brand.look?.handlePosition ?? DEFAULT_HANDLE_POSITION))?.label ?? 'Corner'
    rows.push({ step: 'captions', label: 'Handle', value: `${brand.look?.handle || 'Your logo'} · ${corner.toLowerCase()}` })
  }
  if (draft.clippingMode === 'advanced') rows.splice(rows.findIndex((row) => row.label === 'Mode') + 1, 0,
    { step: 'clips', label: 'Transcribe', value: draft.transcriptionModel || 'Choose a model' },
    { step: 'clips', label: 'Plan', value: draft.plannerModel || 'Choose a model' })
  const afterFormat = rows.findIndex((row) => row.label === 'Format') + 1
  if (draft.workflow !== 'review' && draft.broll !== 'off') rows.splice(afterFormat, 0, { step: 'format', label: 'B-roll', value: BROLL_OPTIONS.find((o) => o.id === draft.broll)?.summary ?? 'On' })
  else if (draft.workflow !== 'review' && draft.aspectRatio === '9:16' && draft.backgroundVideo) rows.splice(afterFormat, 0, { step: 'format', label: 'Background', value: `${draft.backgroundVideo} · under the speaker` })

  return (
    <div className="space-y-3">
      <dl className="glass-well divide-y divide-white/[0.05] overflow-hidden rounded-xl">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-3 py-2">
            <dt className="w-20 shrink-0 text-xs text-ink-subtle">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate text-sm text-ink" title={row.value}>{row.value}</dd>
            <Button size="sm" variant="ghost" onClick={() => onEdit(row.step)} aria-label={`Edit ${row.label.toLowerCase()}`}>
              Edit
            </Button>
          </div>
        ))}
      </dl>
      <p className="flex items-start gap-2 text-2xs text-ink-subtle">
        <Clock3 className="mt-px h-3.5 w-3.5 shrink-0" />
        {draftSources(draft).length > 1
          ? `${draftSources(draft).length} jobs are queued, one per video. Up to ${MAX_PARALLEL_JOBS} run at once; the rest start automatically.`
          : runningCount >= MAX_PARALLEL_JOBS
          ? `${runningCount} jobs are running. This one waits in the queue and starts automatically.`
          : active.length > 0
            ? `Runs alongside ${active.length} other job${active.length === 1 ? '' : 's'}. Up to ${MAX_PARALLEL_JOBS} run at once.`
            : 'Runs on this computer. Transcription and clip planning bill your OpenRouter account.'}
      </p>
    </div>
  )
}

function StartedPanel({ className, onViewJob }: { className?: string; onViewJob?: (jobId: string) => void }): React.JSX.Element | null {
  const started = useDraftStore((s) => s.started)
  const startAnother = useDraftStore((s) => s.startAnother)
  if (!started) return null
  return (
    <Panel className={cn('flex flex-col items-center px-5 py-8 text-center animate-fade-in', className)}>
      <IconTile tone="success" size="lg">
        <CheckCircle2 />
      </IconTile>
      <h2 className="mt-3 text-base font-semibold text-ink">{(started.count ?? 1) > 1 ? `${started.count} videos queued` : started.queued ? 'Queued' : 'Clipping started'}</h2>
      <p className="mt-1 max-w-md truncate text-sm text-ink-muted" title={started.source}>{(started.count ?? 1) > 1 ? `${sourceLabel(started.source)} and ${(started.count ?? 1) - 1} more` : sourceLabel(started.source)}</p>
      {started.failed?.length ? <p role="alert" className="mt-2 max-w-md text-xs text-danger">
        {started.failed.length === 1 ? `${sourceLabel(started.failed[0].videoUrl)} couldn’t start: ${started.failed[0].error}` : `${started.failed.length} videos couldn’t start: ${started.failed.map((item) => sourceLabel(item.videoUrl)).join(', ')}.`}
      </p> : null}
      <p className="mt-1 max-w-md text-xs text-ink-subtle">
        {(started.count ?? 1) > 1
          ? `Each video is its own job. Up to ${MAX_PARALLEL_JOBS} run at once; the rest start as slots free up.`
          : started.queued
          ? `Up to ${MAX_PARALLEL_JOBS} jobs run at once. This one starts as soon as a slot frees up.`
          : 'It keeps running while you queue more videos or use the rest of CreatorClips.'}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={startAnother}>
          Clip another video
        </Button>
        {onViewJob && (
          <Button icon={<ListVideo className="h-3.5 w-3.5" />} onClick={() => onViewJob(started.jobId)}>
            {(started.count ?? 1) > 1 ? 'View jobs' : 'View job'}
          </Button>
        )}
      </div>
    </Panel>
  )
}

function AdvancedModels({ draft, update }: { draft: ClipDraft; update: Update }): React.JSX.Element {
  const { catalog, loading, error, load } = useModelStore()
  useEffect(() => { void load() }, [load])
  return <div className="mt-3 space-y-4 rounded-xl border border-white/10 p-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-ink-muted">Search OpenRouter’s live model catalog.</p>
      <Button size="sm" variant="ghost" loading={loading} disabled={loading} onClick={() => void load(true)}>Refresh models</Button>
    </div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <ModelPicker task="transcription" models={catalog?.transcription ?? []} value={draft.transcriptionModel} loading={loading}
      onChange={(transcriptionModel) => update({ transcriptionModel })} />
    <ModelPicker task="planning" models={catalog?.planning ?? []} value={draft.plannerModel} loading={loading}
      onChange={(plannerModel) => update({ plannerModel })} />
    <p className="text-2xs text-ink-subtle">Temporary errors are retried with your selected models. No automatic model switching. Usage bills your OpenRouter account. Optional AI framing checks use Gemini and can be changed in Format.</p>
  </div>
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Tiny 9:16 diagram of a framing style: split panels, full bleed, or letterbox. */
function FramingGlyph({ style, selected }: { style: 'auto' | 'fill' | 'fit'; selected: boolean }): React.JSX.Element {
  const fill = selected ? 'bg-accent' : 'bg-ink-subtle/60'
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[24px] w-[14px] shrink-0 flex-col gap-px overflow-hidden rounded-[4px] border-[1.5px] p-px transition-colors duration-200',
        selected ? 'border-accent' : 'border-ink-subtle'
      )}
    >
      {style === 'auto' && (
        <>
          <span className={cn('flex-1 rounded-[1px]', fill)} />
          <span className={cn('flex-1 rounded-[1px] opacity-60', fill)} />
        </>
      )}
      {style === 'fill' && <span className={cn('flex-1 rounded-[1px]', fill)} />}
      {style === 'fit' && <span className={cn('my-auto h-[6px] rounded-[1px]', fill)} />}
    </span>
  )
}

function Group({ label, aside, children }: { label: ReactNode; aside?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {aside && <span className="text-2xs text-ink-subtle">{aside}</span>}
      </div>
      {children}
    </div>
  )
}
