import { useEffect, useRef, useState } from 'react'
import { Layers, Minus, Plus } from 'lucide-react'
import type { MoreClipsChoices, MoreClipsInfo } from '../../preload/index'
import { CLIP_REQUEST_MAX_CHARS, DURATION_OPTIONS } from '../../shared/job-contract'
import { isCaptionLanguage, type CaptionLanguageChoice } from '../../shared/caption-language'
import type { QualityBar } from '../../shared/jobs'
import { cn, errorMessage } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { useJobStore } from '../store/use-job-store'
import { CaptionLanguagePicker, QUALITY_BAR_OPTIONS } from './JobForm'
import { Button } from './ui/Button'
import { Dialog, DialogFooter } from './ui/Dialog'
import { TextArea, TextInput } from './ui/Field'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'
import { onRadioKeyDown } from './ui/Segmented'

/** What More clips reuses, in plain words, for the dialog. */
export function reuseSummary(info: Pick<MoreClipsInfo, 'source' | 'transcriptSaved' | 'excludedCount'>): string[] {
  const lines: string[] = []
  if (info.transcriptSaved) lines.push('Uses the saved transcript, so there is no transcription charge.')
  if (info.source === 'original') lines.push('The video file is still on this computer, so nothing is downloaded.')
  else if (info.source === 'kept') lines.push('Uses the copy of the video kept with this run, so nothing is downloaded.')
  else if (info.source === 'download') lines.push('The video is downloaded again. The transcript is still reused.')
  if (info.excludedCount > 0) lines.push(`Skips the ${info.excludedCount} moment${info.excludedCount === 1 ? '' : 's'} already clipped.`)
  return lines
}

/** Whether a run can make more clips, and why not. */
export function moreClipsBlocked(info: Pick<MoreClipsInfo, 'source' | 'transcriptSaved'>): string | null {
  if (!info.transcriptSaved) return 'This run has no saved transcript.'
  if (info.source === 'missing') return 'The original video file is no longer on this computer.'
  return null
}

/** The member's choices, starting from the earlier run's settings. */
export function initialChoices(info: MoreClipsInfo): MoreClipsChoices & { captionLanguage?: MoreClipsChoices['captionLanguage'] } {
  const request = info.request
  return {
    autoClipCount: request.autoClipCount,
    maxClips: request.autoClipCount ? null : request.maxClips,
    durationRanges: request.durationRanges,
    qualityBar: request.qualityBar ?? 'b',
    clipRequest: '',
    ...(isCaptionLanguage(request.captionLanguage) ? { captionLanguage: request.captionLanguage } : {})
  }
}

/**
 * "More clips from this video": a header button on a finished Create run. It
 * appears once the run is known to have a saved transcript, and opens the
 * dialog with what can change for the new run.
 */
export function MoreClipsButton({ outputDir, onStarted, className }: { outputDir: string; onStarted: (jobId: string) => void; className?: string }): React.JSX.Element | null {
  const [info, setInfo] = useState<MoreClipsInfo | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    const api = getApi().job
    if (typeof api.moreClipsInfo !== 'function') return
    api.moreClipsInfo(outputDir).then((value) => { if (active) setInfo(value) }).catch(() => { if (active) setInfo(null) })
    return () => { active = false }
  }, [outputDir])
  if (!info || !info.transcriptSaved) return null
  const blocked = moreClipsBlocked(info)
  return <>
    <Button className={className} icon={<Layers className="h-3.5 w-3.5" />} disabled={Boolean(blocked)} title={blocked ?? 'Find new moments in this video without transcribing it again'}
      onClick={() => setOpen(true)}>
      More clips from this video
    </Button>
    {open && <MoreClipsDialog outputDir={outputDir} info={info} onClose={() => setOpen(false)} onStarted={(jobId) => { setOpen(false); onStarted(jobId) }} />}
  </>
}

export function MoreClipsDialog({ outputDir, info, onClose, onStarted }: {
  outputDir: string
  info: MoreClipsInfo
  onClose: () => void
  onStarted: (jobId: string) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [choices, setChoices] = useState(() => initialChoices(info))
  const [maxClips, setMaxClips] = useState(info.request.maxClips ?? 5)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const durations = choices.durationRanges ?? []
  const language: CaptionLanguageChoice = choices.captionLanguage ?? 'original'

  const start = async (): Promise<void> => {
    setWorking(true); setError(null)
    try {
      const { captionLanguage, clipRequest, ...rest } = choices
      const result = await getApi().job.moreClips(outputDir, {
        ...rest,
        maxClips: rest.autoClipCount ? null : maxClips,
        durationRanges: durations.length ? durations : null,
        ...(clipRequest?.trim() ? { clipRequest: clipRequest.trim() } : {}),
        ...(captionLanguage ? { captionLanguage } : {})
      })
      if (result.error) { setError(result.error); return }
      if (result.job) useJobStore.getState().upsert(result.job)
      if (result.jobId) onStarted(result.jobId)
    } catch (err) {
      setError(errorMessage(err, 'Could not start more clips. Please try again.'))
    } finally { setWorking(false) }
  }

  return (
    <Dialog ref={ref} aria-labelledby="more-clips-title" onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[620px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div>
          <h2 id="more-clips-title" className="flex items-center gap-2 text-base font-semibold text-ink"><Layers className="h-4 w-4" />More clips from this video</h2>
          <p className="mt-1 truncate text-xs text-ink-muted" title={info.title}>{info.title}</p>
        </div>
        <ul className="glass-well space-y-1 rounded-xl px-3 py-2.5 text-xs text-ink-muted" aria-label="What this reuses">
          {reuseSummary(info).map((line) => <li key={line}>{line}</li>)}
        </ul>

        <div>
          <p className="eyebrow mb-2">What to clip <span className="font-normal normal-case text-ink-subtle">· optional</span></p>
          <TextArea rows={2} maxLength={CLIP_REQUEST_MAX_CHARS} value={choices.clipRequest ?? ''} aria-label="What to clip"
            placeholder="e.g. the stories about early customers" onChange={(e) => setChoices({ ...choices, clipRequest: e.target.value })} />
        </div>

        <div>
          <p className="eyebrow mb-2">Clip length</p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" role="group" aria-label="Clip length options">
            {DURATION_OPTIONS.map((d) => {
              const selected = durations.includes(d.id)
              return (
                <button key={d.id} type="button" aria-pressed={selected}
                  onClick={() => setChoices({ ...choices, durationRanges: selected ? durations.filter((id) => id !== d.id) : [...durations, d.id] })}
                  className={cn('glass-tile glass-tile-hover rounded-xl px-1 py-1.5 text-center', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                  <span className="block font-mono text-xs tabular">{d.range}</span>
                  <span className={cn('block truncate text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{d.label}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-2xs text-ink-subtle">{durations.length ? `${durations.length} selected` : 'None selected: any length.'}</p>
        </div>

        <div>
          <p className="eyebrow mb-2">Quality bar</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Quality bar">
            {QUALITY_BAR_OPTIONS.map((option) => {
              const selected = choices.qualityBar === option.id
              return (
                <button key={option.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                  onClick={() => setChoices({ ...choices, qualityBar: option.id as QualityBar })}
                  className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                  <span className="block text-xs font-medium">{option.label}</span>
                  <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{option.hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <SettingRow title="Let AI decide how many" description="Every new moment worth posting."
            control={<Switch label="Let AI decide how many clips" checked={choices.autoClipCount} onChange={(autoClipCount) => setChoices({ ...choices, autoClipCount })} />} />
          {!choices.autoClipCount && (
            <div className="mt-2 flex max-w-xs items-center gap-2">
              <Button iconOnly aria-label="Fewer clips" onClick={() => setMaxClips(Math.max(1, maxClips - 1))} disabled={maxClips <= 1} icon={<Minus className="h-3.5 w-3.5" />} />
              <TextInput className="flex-1 rounded-full [&_input]:text-center" inputMode="numeric" mono aria-label="Maximum clips" value={String(maxClips)}
                onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); setMaxClips(Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 1) }} />
              <Button iconOnly aria-label="More clips" onClick={() => setMaxClips(Math.min(100, maxClips + 1))} disabled={maxClips >= 100} icon={<Plus className="h-3.5 w-3.5" />} />
            </div>
          )}
        </div>

        <CaptionLanguagePicker value={language} onChange={(next) => setChoices({ ...choices, captionLanguage: isCaptionLanguage(next) ? next : undefined })} />

        <p className="text-2xs text-ink-subtle">
          {info.savedSettings
            ? 'Format, framing, caption style, title and call to action stay as in the earlier run.'
            : 'This run is from an earlier version, so caption style, title and call to action use the defaults. Format and framing stay as before.'}
          {' '}Clip planning bills your OpenRouter account.
        </p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Layers className="h-4 w-4" />} loading={working} disabled={working} onClick={() => void start()}>
          {working ? 'Starting…' : 'Make more clips'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
