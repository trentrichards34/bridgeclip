import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, ChevronDown, RotateCcw, Scissors, Sparkles, Upload, Wand2, X } from 'lucide-react'
import {
  DEFAULT_PAUSE_SETTINGS, flipSegment, formatSeconds, MAX_NUDGE_SECONDS, MIN_PAUSE_CHOICES, MIN_PLAY_CHOICES, PAUSE_REACT_MAX_SECONDS, pauseSummary,
  type PauseSettings, type PauseTimeline, type PauseView
} from '../../shared/pause-react'
import { MAX_POST_CAPTION_CHARS, REMIX_WORD_LIMITS, remixEditProblem, wordCount, type RemixEdit, type RemixRecordings, type RemixStatus } from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { RemixRecorder } from './RemixRecorder'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { FriendlyError } from './FriendlyError'
import { Field, TextArea, TextInput } from './ui/Field'
import { Panel, PanelHeader } from './ui/Panel'
import { Segmented } from './ui/Segmented'

/**
 * Pause & react, after the video to react to is ready: trim it, record or upload
 * the reaction, check when it plays and pauses, then the hook text and caption.
 */
export function PauseReactReview({ status, onError }: { status: RemixStatus; onError: (message: string | null) => void }): React.JSX.Element {
  const draft = status.drafts[0]
  const [recordings, setRecordings] = useState<RemixRecordings>({})
  const [view, setView] = useState<PauseView | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [working, setWorking] = useState<'' | 'upload' | 'write' | 'make' | 'trim' | 'discard'>('')
  const [edit, setEdit] = useState<RemixEdit | null>(null)
  const [writeOwn, setWriteOwn] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const recorded = recordings[draft.id]?.reaction

  const refresh = useCallback(async (): Promise<void> => {
    const [list, next] = await Promise.all([getApi().remix.recordings(), getApi().remix.pauseView()])
    setRecordings(list)
    setView(next)
  }, [])
  useEffect(() => {
    refresh().catch(() => undefined)
    getApi().remix.moment(draft.id).then((moment) => setSource(moment.path)).catch((err) => onError(errorMessage(err)))
  }, [status.id, draft.id, refresh, onError])

  const current: RemixEdit = edit ?? { id: draft.id, headline: draft.headline, intro: '', beats: [], close: '', postCaption: draft.postCaption }
  const showText = Boolean(draft.headline) || writeOwn || Boolean(edit)
  const problem = showText ? remixEditProblem(current, 'pause_react') : null

  const run = async (kind: typeof working, work: () => Promise<unknown>, fallback: string): Promise<void> => {
    setWorking(kind); onError(null)
    try { await work() } catch (err) { onError(errorMessage(err, fallback)) } finally { setWorking('') }
  }
  const upload = async (): Promise<void> => {
    let uploaded = false
    await run('upload', async () => {
      const list = await getApi().remix.uploadRecording(draft.id, 'reaction')
      if (list) { setRecordings(list); setView(await getApi().remix.pauseView()); uploaded = Boolean(list[draft.id]?.reaction) }
    }, 'Your recording could not be used.')
    // Like a recording made here: a new upload with no headline yet gets its hook text and caption written straight away.
    if (uploaded && !draft.headline && !edit?.headline) await write()
  }
  const remove = (): Promise<void> => run('upload', async () => {
    setRecordings(await getApi().remix.removeRecording(draft.id, 'reaction'))
    setView(null)
  }, 'Your recording could not be removed.')
  const write = (): Promise<void> => run('write', () => getApi().remix.write(), 'The hook text could not be written.')
  const make = (): Promise<void> => run('make', () => getApi().remix.render([current]), 'The video could not be started.')
  const trim = (startMs: number, endMs: number): Promise<void> => run('trim', async () => {
    const result = await getApi().remix.trim(draft.id, startMs, endMs)
    setView(result.view)
  }, 'That part of the video could not be used.')
  const adjust = (settings: PauseSettings): Promise<void> => run('', async () => setView(await getApi().remix.pauseSettings(settings)), 'The pauses could not be changed.')
  const discard = async (): Promise<void> => {
    if (!confirmDiscard) { setConfirmDiscard(true); return }
    await run('discard', () => getApi().remix.discard(), 'It could not be discarded.')
  }
  const closeRecorder = (changed: boolean): void => {
    setRecording(false)
    if (changed) void refresh().then(async () => {
      // A new take with no headline yet: write it straight away (only after a new recording, so it isn't paid for twice).
      const list = await getApi().remix.recordings()
      if (list[draft.id]?.reaction && !draft.headline && !edit?.headline) await write()
    }).catch(() => undefined)
  }

  const blocker = !recorded ? 'Record or upload your reaction first'
    : !current.headline.trim() ? 'Write the headline first'
      : problem ? 'Fix the hook text or caption first' : null
  const busy = working !== ''

  return (
    <Panel>
      <PanelHeader title="Your pause-and-react" description="Their video plays in a box and pauses whenever you talk. Choose the part you react to, record yourself, check the pauses, then make it." />
      <div className="mt-4 space-y-4">
        {status.error && <Callout tone="danger"><FriendlyError error={status.error} suffix="Your recording is still here, so you can try again." /></Callout>}
        {status.warnings.map((warning, i) => <Callout key={i} tone="warning">{warning}</Callout>)}

        <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="The part you react to">
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Scissors className="h-4 w-4" />1 · The part you react to</h3>
          <p className="text-2xs text-ink-muted">{draft.sourceTitle ? `“${draft.sourceTitle}”` : 'Their video'}{draft.creator ? ` · credited on screen as ${draft.creator}` : ''}</p>
          {source ? <TrimControl key={`${draft.startMs}-${draft.endMs}`} source={source} startMs={draft.startMs} endMs={draft.endMs} disabled={busy || recording}
            saving={working === 'trim'} uploaded={recorded?.uploaded === true} onTrim={(a, b) => void trim(a, b)} /> : <div className="aspect-video w-full max-w-md rounded-xl bg-black" />}
        </section>

        <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Your reaction">
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Camera className="h-4 w-4" />2 · Your reaction</h3>
          {recorded ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-xs text-success"><Check className="mr-1 inline h-3 w-3" />{recorded.uploaded ? 'Phone recording uploaded' : 'Recorded here'}{recorded.seconds ? ` · ${formatSeconds(recorded.seconds)}` : ''}</span>
              <Button size="sm" variant="secondary" icon={<Camera className="h-3.5 w-3.5" />} disabled={busy} onClick={() => setRecording(true)}>Record again</Button>
              <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} loading={working === 'upload'} disabled={busy} onClick={() => void upload()}>Upload another</Button>
              <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void remove()}>Delete</Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <p className="text-sm text-ink">Record here</p>
                <p className="text-2xs text-ink-muted">Their video plays above your camera. Press Space (or the big button) to pause it when you talk, and again to play on. Wear headphones.</p>
                <Button size="sm" variant="primary" icon={<Camera className="h-3.5 w-3.5" />} disabled={busy || !source} onClick={() => setRecording(true)}>Record</Button>
              </div>
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <p className="text-sm text-ink">Upload a phone recording</p>
                <p className="text-2xs text-ink-muted">Film yourself while their video plays out loud on another screen. Pause it whenever you talk, then play it again. CreatorClips finds the pauses from the sound.</p>
                <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} loading={working === 'upload'} disabled={busy}
                  onClick={() => void upload()}>{working === 'upload' ? 'Finding the pauses…' : 'Upload'}</Button>
              </div>
            </div>
          )}
          <p className="text-2xs text-ink-subtle">Up to {PAUSE_REACT_MAX_SECONDS / 60} minutes. The finished video is as long as your reaction.</p>
        </section>

        {view && (
          <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="When their video plays and pauses">
            <h3 className="text-sm font-medium text-ink">3 · When their video plays and pauses</h3>
            <PauseEditor view={view} disabled={busy} onChange={(settings) => void adjust(settings)} />
            {source && <PausePreview view={view} source={source} />}
          </section>
        )}

        <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Hook text and caption">
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Sparkles className="h-4 w-4" />{view ? '4' : '3'} · Hook text and caption</h3>
          {draft.quote && <p className="line-clamp-3 text-xs italic text-ink-muted">You said: “{draft.quote}”</p>}
          {recorded && (
            <Button size="sm" variant={draft.headline ? 'ghost' : 'primary'} icon={<Sparkles className="h-3.5 w-3.5" />} loading={working === 'write'} disabled={busy}
              onClick={() => void write()}>{draft.headline ? 'Rewrite from what I said' : 'Write my hook text and caption'}</Button>
          )}
          {!showText && (
            <button type="button" className="block text-2xs text-accent" onClick={() => setWriteOwn(true)}>Or write the hook text and caption yourself</button>
          )}
          {showText && <>
            <Field label="Hook text" hint={`${wordCount(current.headline)} / ${REMIX_WORD_LIMITS.headline} words · shown at the top and used as the video’s title in your Library`}>
              <TextInput aria-label="Hook text, your pause-and-react" value={current.headline} maxLength={160} onChange={(e) => setEdit({ ...current, headline: e.target.value })} />
            </Field>
            <Field label="Post caption" hint={`${(current.postCaption ?? '').length.toLocaleString('en-US')} / ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters · filled in when you post from the Library`}>
              <TextArea aria-label="Post caption, your pause-and-react" rows={6} value={current.postCaption ?? ''} maxLength={MAX_POST_CAPTION_CHARS}
                onChange={(e) => setEdit({ ...current, postCaption: e.target.value })} />
            </Field>
            {problem && <p className="text-2xs text-danger" role="alert">{problem}</p>}
          </>}
          {draft.notes.map((note, i) => <p key={i} className="text-2xs text-warning"><AlertTriangle className="mr-1 inline h-3 w-3" />{note}</p>)}
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={working === 'make'} disabled={busy || blocker !== null} tooltip={blocker ?? undefined}
            onClick={() => void make()}>Make the video</Button>
          <Button variant={confirmDiscard ? 'danger' : 'ghost'} icon={<X className="h-4 w-4" />} disabled={busy} onClick={() => void discard()}>
            {confirmDiscard ? 'Click again to discard' : 'Discard'}
          </Button>
        </div>
      </div>
      {recording && <RemixRecorder draft={draft} edit={current} recordings={recordings} talk pauseLayout={status.pauseLayout} onRecordings={setRecordings} onClose={closeRecorder} />}
    </Panel>
  )
}

/** Start and end of the part to react to, on a preview of their video. */
function TrimControl({ source, startMs, endMs, disabled, saving, uploaded, onTrim }: {
  source: string; startMs: number; endMs: number; disabled: boolean; saving: boolean; uploaded: boolean; onTrim: (startMs: number, endMs: number) => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(endMs / 1000)
  const [start, setStart] = useState(startMs / 1000)
  const [end, setEnd] = useState(endMs / 1000)
  const changed = Math.abs(start * 1000 - startMs) > 50 || Math.abs(end * 1000 - endMs) > 50
  const seek = (seconds: number): void => { if (video.current) video.current.currentTime = seconds }
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <video ref={video} src={localFileUrl(source)} controls preload="metadata" playsInline aria-label="Their video"
        onLoadedMetadata={(e) => { const seconds = e.currentTarget.duration; if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds); e.currentTarget.currentTime = start }}
        className="aspect-video w-full rounded-xl bg-black object-contain" />
      <div className="space-y-2.5">
        <label className="block text-2xs text-ink-muted">Start · {formatSeconds(start)}
          <input type="range" aria-label="Start of the part" min={0} max={duration} step={0.1} value={start} disabled={disabled}
            onChange={(e) => { const value = Math.min(Number(e.target.value), end - 1); setStart(Math.max(0, value)); seek(Math.max(0, value)) }} className="mt-1 w-full accent-[rgb(var(--accent))]" />
        </label>
        <label className="block text-2xs text-ink-muted">End · {formatSeconds(end)}
          <input type="range" aria-label="End of the part" min={0} max={duration} step={0.1} value={end} disabled={disabled}
            onChange={(e) => { const value = Math.max(Number(e.target.value), start + 1); setEnd(Math.min(duration, value)); seek(Math.min(duration, value)) }} className="mt-1 w-full accent-[rgb(var(--accent))]" />
        </label>
        <p className="text-2xs text-ink-subtle">{formatSeconds(end - start)} of their video. {uploaded ? 'Changing it finds the pauses in your phone recording again.' : 'It plays from the start while you record.'}</p>
        {changed && (
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={saving} disabled={disabled} onClick={() => onTrim(Math.round(start * 1000), Math.round(end * 1000))}>Use this part</Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { setStart(startMs / 1000); setEnd(endMs / 1000) }}>Undo</Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The timeline as a bar (play and pause stretches); phone recordings can be adjusted. */
export function PauseEditor({ view, disabled, onChange }: { view: PauseView; disabled: boolean; onChange: (settings: PauseSettings) => void }): React.JSX.Element {
  const { timeline, settings } = view
  const summary = pauseSummary(timeline)
  const upload = view.source === 'upload'
  const detection = view.detection
  const offset = detection ? Math.max(0, detection.offset + settings.nudge) : 0
  // Fine-tuning opens on its own only when their video couldn't be heard in the recording.
  const [fineTune, setFineTune] = useState(upload && detection?.alignedBy !== 'sound')
  const nudge = (by: number): void => onChange({ ...settings, nudge: Math.max(-MAX_NUDGE_SECONDS, Math.min(MAX_NUDGE_SECONDS, Math.round((settings.nudge + by) * 10) / 10)) })
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted" data-testid="pause-summary">
        {summary.pauses === 0 ? 'No pauses: their video plays straight through' : `${summary.pauses} pause${summary.pauses === 1 ? '' : 's'}`}
        {` · you talk over held frames for ${formatSeconds(summary.pausedSeconds)} · their video plays for ${formatSeconds(summary.playedSeconds)} · ${formatSeconds(summary.seconds)} in all`}
      </p>
      <TimelineBar timeline={timeline} onFlip={upload && !disabled ? (index) => onChange(flipSegment(settings, timeline, index)) : undefined} />
      <div className="flex flex-wrap gap-3 text-2xs text-ink-subtle">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-white/25" />Their video plays</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />Paused while you talk</span>
        {upload && <span>Click a stretch to switch it.</span>}
      </div>
      {upload ? (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <p className="text-xs text-ink-muted">
            {detection?.alignedBy === 'sound'
              ? `Their video starts ${formatSeconds(offset)} into your recording (found by its sound).`
              : `Their video couldn’t be heard in your recording, so it starts ${formatSeconds(offset)} in. Watch the preview and nudge it until it lines up.`}
          </p>
          <button type="button" className="flex items-center gap-1 text-2xs text-accent" aria-expanded={fineTune} onClick={() => setFineTune(!fineTune)}>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', fineTune && 'rotate-180')} />Fine-tune (only if it looks off)
          </button>
          {fineTune && (<>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Nudge their video">
            <span className="mr-1 text-2xs text-ink-subtle">Nudge their video</span>
            {[-1, -0.1, 0.1, 1].map((by) => (
              <Button key={by} size="sm" variant="secondary" disabled={disabled} onClick={() => nudge(by)}>{by > 0 ? `+${by}s` : `${by}s`}</Button>
            ))}
            {settings.nudge !== 0 && <span className="text-2xs text-ink-muted">{settings.nudge > 0 ? 'later' : 'earlier'} by {Math.abs(settings.nudge).toFixed(1)}s</span>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xs text-ink-subtle">Ignore pauses shorter than</span>
            <Segmented label="Ignore pauses shorter than" size="sm" value={String(settings.minPause)} onChange={(value) => onChange({ ...settings, minPause: Number(value) })}
              options={MIN_PAUSE_CHOICES.map((value) => ({ value: String(value), label: `${value}s` }))} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xs text-ink-subtle">Keep paused through gaps shorter than</span>
            <Segmented label="Keep paused through gaps shorter than" size="sm" value={String(settings.minPlay)} onChange={(value) => onChange({ ...settings, minPlay: Number(value) })}
              options={MIN_PLAY_CHOICES.map((value) => ({ value: String(value), label: `${value}s` }))} />
          </div>
          {(settings.flips.length > 0 || settings.nudge !== 0 || settings.minPause !== DEFAULT_PAUSE_SETTINGS.minPause || settings.minPlay !== DEFAULT_PAUSE_SETTINGS.minPlay) && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => onChange(DEFAULT_PAUSE_SETTINGS)}>Back to what was found</Button>
          )}
          </>)}
        </div>
      ) : (
        <p className="text-2xs text-ink-subtle">Recorded here, so it follows exactly when you paused and played. Record again to change it.</p>
      )}
    </div>
  )
}

function TimelineBar({ timeline, onFlip, playhead }: { timeline: PauseTimeline; onFlip?: (index: number) => void; playhead?: number }): React.JSX.Element {
  const total = Math.max(0.001, timeline.end - timeline.start)
  return (
    <div className="relative">
      <div className="flex h-8 w-full overflow-hidden rounded-lg bg-white/[0.04]" role="list" aria-label="Pauses timeline">
        {timeline.segments.map((seg, i) => {
          const label = `${seg.kind === 'play' ? 'Plays' : 'Paused'} from ${formatSeconds(seg.start - timeline.start)} to ${formatSeconds(seg.end - timeline.start)}`
          const style = { width: `${((seg.end - seg.start) / total) * 100}%` }
          const look = cn('h-full border-r border-black/30 last:border-r-0', seg.kind === 'pause' ? 'bg-accent' : 'bg-white/25')
          return onFlip
            ? <button key={i} type="button" role="listitem" title={`${label}. Click to switch.`} aria-label={`${label}. Switch`} style={style} className={cn(look, 'hover:opacity-80')} onClick={() => onFlip(i)} />
            : <span key={i} role="listitem" title={label} aria-label={label} style={style} className={look} />
        })}
      </div>
      {playhead !== undefined && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${Math.min(100, Math.max(0, ((playhead - timeline.start) / total) * 100))}%` }} />}
      <div className="mt-1 flex justify-between text-2xs text-ink-subtle"><span>0:00</span><span>{formatSeconds(total)}</span></div>
    </div>
  )
}

/** A quick preview: your recording plays, and their video plays or holds along with it. */
function PausePreview({ view, source }: { view: PauseView; source: string }): React.JSX.Element {
  const me = useRef<HTMLVideoElement>(null)
  const them = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState<number | undefined>(undefined)
  const timeline = view.timeline
  useEffect(() => {
    const member = me.current, original = them.current
    if (!member || !original) return
    let frame = 0
    const tick = (): void => {
      const t = member.currentTime
      if (t < timeline.start - 0.05) member.currentTime = timeline.start
      if (t >= timeline.end) member.pause()
      const seg = timeline.segments.find((item) => t >= item.start && t < item.end) ?? timeline.segments[timeline.segments.length - 1]
      if (seg) {
        if (seg.kind === 'play' && !member.paused) {
          const expected = Math.min(timeline.trimEnd, seg.at + (t - seg.start))
          if (Math.abs(original.currentTime - expected) > 0.3) original.currentTime = expected
          if (original.paused && expected < timeline.trimEnd - 0.05) void original.play().catch(() => undefined)
          member.volume = view.source === 'upload' ? 0.15 : 0.4
        } else {
          if (!original.paused) original.pause()
          const held = seg.kind === 'play' ? Math.min(timeline.trimEnd, seg.at + (t - seg.start)) : seg.at
          if (Math.abs(original.currentTime - held) > 0.1) original.currentTime = held
          member.volume = 1
        }
      }
      setTime(t)
      if (!member.paused) frame = requestAnimationFrame(tick)
    }
    const start = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick) }
    const stop = (): void => { cancelAnimationFrame(frame); original.pause(); tick() }
    member.addEventListener('play', start)
    member.addEventListener('pause', stop)
    member.addEventListener('seeked', tick)
    return () => { cancelAnimationFrame(frame); member.removeEventListener('play', start); member.removeEventListener('pause', stop); member.removeEventListener('seeked', tick) }
  }, [timeline, view.source])
  return (
    <div className="space-y-2">
      <p className="text-2xs text-ink-subtle">Preview: press play on your recording. Their video follows the timeline above.</p>
      <div className="flex flex-wrap items-start gap-3">
        <div className="relative aspect-[9/16] w-44 overflow-hidden rounded-xl bg-black" aria-label="Preview">
          <video ref={me} src={localFileUrl(view.recordingPath)} playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" aria-label="Your recording" />
          <video ref={them} src={localFileUrl(source)} playsInline preload="auto" className="absolute inset-x-2 top-3 aspect-video w-[calc(100%-1rem)] rounded border-2 border-white bg-black object-contain" aria-label="Their video in the preview" />
        </div>
        <div className="space-y-2">
          <Button size="sm" variant="secondary" onClick={() => { const member = me.current; if (!member) return; if (member.paused) { if (member.currentTime < timeline.start || member.currentTime >= timeline.end) member.currentTime = timeline.start; void member.play() } else member.pause() }}>
            Play or pause the preview
          </Button>
          {time !== undefined && <Badge>{formatSeconds(Math.max(0, time - timeline.start))}</Badge>}
        </div>
      </div>
      {time !== undefined && <TimelineBar timeline={timeline} playhead={time} />}
    </div>
  )
}

