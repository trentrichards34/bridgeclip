import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, ListChecks, Play, RefreshCw, RotateCcw, Sparkles, Upload, Wand2, X } from 'lucide-react'
import { formatTimecode, MOMENT_TAKE_MAX_SECONDS, momentBoundsProblem } from '../../shared/moment-take'
import {
  isRunning, MAX_POST_CAPTION_CHARS, momentMakeNote, REMIX_WORD_LIMITS, remixEditProblem, wordCount, type RemixDraft, type RemixEdit, type RemixRecordings, type RemixStatus
} from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { RemixRecorder } from './RemixRecorder'
import { RemixChatSection, RemixGraphicsSection, TakeTrimControl, TakeTrimNote, type TakeText } from './RemixReviewExtras'
import { RemixLookSection } from './RemixReviewLook'
import type { RemixAsked } from '../../shared/edit-log'
import { RemixEditLog } from './EditLog'
import type { EditorGraphic } from '../../shared/motion-graphics'
import { Segmented } from './ui/Segmented'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { FriendlyError } from './FriendlyError'
import { Checkbox } from './ui/Checkbox'
import { Field, TextArea, TextInput } from './ui/Field'
import { Panel, PanelHeader } from './ui/Panel'
import { ProgressBar } from './ui/ProgressBar'

/** 37:05.2: whole seconds and tenths, for nudging a moment's edges. */
function clock(ms: number): string {
  const tenths = Math.floor((ms % 1000) / 100)
  return `${formatTimecode(Math.floor(ms / 1000))}.${tenths}`
}

const NUDGES = [-1000, -250, 250, 1000]

/**
 * Moment + my take, once the moments are found: for each range, its moment (preview, nudge its edges, or find
 * another), your take (record here or upload, with optional talking points), then the hook text and caption the AI
 * writes from what you said. Every moment becomes its own video.
 */
export function MomentTakeReview({ status, onError }: { status: RemixStatus; onError: (message: string | null) => void }): React.JSX.Element {
  const drafts = status.drafts
  const writing = isRunning(status)
  const [recordings, setRecordings] = useState<RemixRecordings>({})
  const [edits, setEdits] = useState<Record<number, RemixEdit>>({})
  const [selected, setSelected] = useState<Set<number>>(() => new Set(drafts.map((draft) => draft.id)))
  const [recording, setRecording] = useState<RemixDraft | null>(null)
  const [working, setWorking] = useState<string>('')
  const [writeOwn, setWriteOwn] = useState<Set<number>>(new Set())
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [source, setSource] = useState<string | null>(null)
  // Graphics per take, and which take the Graphics and Chat sections are on.
  const [graphics, setGraphics] = useState<Record<number, EditorGraphic[]>>({})
  const [focus, setFocus] = useState<number>(drafts[0]?.id ?? 0)
  // What the chat set per take, and the moments the member moved themselves (no longer the AI's pick).
  const [asked, setAsked] = useState<Record<number, RemixAsked>>({})
  const [nudged, setNudged] = useState<Set<number>>(new Set())
  // Hook text that just arrived from the AI replaces what was typed for that take before.
  const headlines = useRef<Record<number, string>>({})
  useEffect(() => {
    const changed = drafts.filter((draft) => headlines.current[draft.id] !== undefined && headlines.current[draft.id] !== draft.headline).map((draft) => draft.id)
    for (const draft of drafts) headlines.current[draft.id] = draft.headline
    if (changed.length) setEdits((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !changed.includes(Number(id)))))
  }, [drafts])
  useEffect(() => {
    getApi().remix.recordings().then(setRecordings).catch(() => undefined)
    if (drafts[0]) getApi().remix.moment(drafts[0].id).then((moment) => setSource(moment.path)).catch(() => undefined)
  }, [status.id, drafts])

  const value = (draft: RemixDraft): RemixEdit => edits[draft.id] ?? { id: draft.id, headline: draft.headline, intro: '', beats: [], close: '', postCaption: draft.postCaption }
  const change = (draft: RemixDraft, patch: Partial<RemixEdit>): void => setEdits((current) => ({ ...current, [draft.id]: { ...value(draft), ...patch } }))
  const recorded = (draft: RemixDraft): boolean => Boolean(recordings[draft.id]?.reaction)
  const busy = working !== '' || writing

  const run = async (kind: string, work: () => Promise<unknown>, fallback: string): Promise<void> => {
    setWorking(kind); onError(null)
    try { await work() } catch (err) { onError(errorMessage(err, fallback)) } finally { setWorking('') }
  }
  const write = (ids: number[]): Promise<void> => run(`write-${ids.join(',')}`, () => getApi().remix.write(ids), 'The hook text could not be written.')
  const upload = (draft: RemixDraft): Promise<void> => run(`upload-${draft.id}`, async () => {
    const list = await getApi().remix.uploadRecording(draft.id, 'reaction')
    if (list) {
      setRecordings(list)
      if (!draft.headline && !edits[draft.id]?.headline) await getApi().remix.write([draft.id])
    }
  }, 'Your video could not be used.')
  const remove = (draft: RemixDraft): Promise<void> => run(`remove-${draft.id}`, async () => setRecordings(await getApi().remix.removeRecording(draft.id, 'reaction')), 'It could not be deleted.')
  const nudge = (draft: RemixDraft, startMs: number, endMs: number): Promise<void> => run(`nudge-${draft.id}`, async () => {
    await getApi().remix.momentBounds(draft.id, startMs, endMs)
    setNudged((list) => new Set(list).add(draft.id))
  }, 'The moment could not be changed.')
  const another = (draft: RemixDraft): Promise<void> => run(`another-${draft.id}`, async () => {
    await getApi().remix.anotherMoment(draft.id)
    setNudged((list) => { const next = new Set(list); next.delete(draft.id); return next })
  }, 'Another moment could not be found.')
  const points = (draft: RemixDraft): Promise<void> => run(`points-${draft.id}`, () => getApi().remix.talkingPoints(draft.id), 'No talking points came back.')
  const closeRecorder = (changed: boolean): void => {
    const draft = recording
    setRecording(null)
    if (!changed || !draft) return
    // A new take with no hook text yet: write it straight away (only after a new recording, so it isn't paid for twice).
    void getApi().remix.recordings().then(async (list) => {
      setRecordings(list)
      if (list[draft.id]?.reaction && !draft.headline && !edits[draft.id]?.headline) await write([draft.id])
    }).catch(() => undefined)
  }
  const discard = async (): Promise<void> => {
    if (!confirmDiscard) { setConfirmDiscard(true); return }
    await run('discard', () => getApi().remix.discard(), 'It could not be discarded.')
  }

  const chosen = drafts.filter((draft) => selected.has(draft.id))
  const unwritten = drafts.filter((draft) => recorded(draft) && !draft.headline && !edits[draft.id]?.headline)
  const problems = chosen.map((draft) => !recorded(draft) ? `Record your take on moment ${draft.id + 1}`
    : !value(draft).headline.trim() ? `Write the hook text for moment ${draft.id + 1}` : remixEditProblem(value(draft), 'moment_take') ? `Fix the hook text or caption of moment ${draft.id + 1}` : null)
  const blocker = chosen.length === 0 ? 'Choose at least one video to make' : problems.find(Boolean) ?? null
  const chosenGraphics = Object.fromEntries(chosen.filter((draft) => graphics[draft.id]?.length).map((draft) => [draft.id, graphics[draft.id]]))
  const make = (): Promise<void> => run('make', () => getApi().remix.render(chosen.map(value), Object.keys(chosenGraphics).length ? chosenGraphics : undefined), 'The videos could not be started.')
  const focused = drafts.find((draft) => draft.id === focus) ?? drafts[0]
  const focusText = (draft: RemixDraft): TakeText => ({ headline: value(draft).headline, postCaption: value(draft).postCaption ?? '', graphics: graphics[draft.id] ?? [] })
  const onText = (draft: RemixDraft, patch: Partial<TakeText>): void => {
    if (patch.graphics) { const next = patch.graphics; setGraphics((current) => ({ ...current, [draft.id]: next })) }
    if (patch.headline !== undefined || patch.postCaption !== undefined) change(draft, { ...(patch.headline !== undefined ? { headline: patch.headline } : {}), ...(patch.postCaption !== undefined ? { postCaption: patch.postCaption } : {}) })
  }

  return (
    <Panel>
      <PanelHeader title={`Your moments · ${drafts.length}`}
        description={`The AI picked the strongest moment in each of your ranges. Check each one, record your take on it, then make the videos: each moment plays first, then you.${status.costUsd ? ` So far this has cost about $${status.costUsd.toFixed(2)}.` : ''}`} />
      <div className="mt-4 space-y-4">
        {writing && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex justify-between gap-3 text-xs text-ink-muted"><span className="truncate">{status.detail}</span><span>{status.percent}%</span></div>
            <ProgressBar value={status.percent} />
          </div>
        )}
        {status.error && <Callout tone="danger"><FriendlyError error={status.error} suffix="Your recordings are still here, so you can try again." /></Callout>}
        {status.warnings.map((warning, i) => <Callout key={i} tone="warning">{warning}</Callout>)}
        {drafts.map((draft) => {
          const current = value(draft)
          const on = selected.has(draft.id)
          const take = recordings[draft.id]?.reaction
          const showText = Boolean(draft.headline) || writeOwn.has(draft.id) || Boolean(edits[draft.id])
          const problem = on && showText && take ? remixEditProblem(current, 'moment_take') : null
          const range = draft.moment
          return (
            <section key={draft.id} aria-label={`Moment ${draft.id + 1}`} className={cn('glass-tile space-y-3 rounded-2xl p-4', !on && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox checked={on} onChange={() => setSelected((list) => { const next = new Set(list); if (next.has(draft.id)) next.delete(draft.id); else next.add(draft.id); return next })}
                  label={`Make moment ${draft.id + 1}`} />
                <h3 className="text-sm font-medium text-ink">Moment {draft.id + 1}</h3>
                {range && <Badge>From your range {formatTimecode(range.rangeStartMs / 1000)}–{formatTimecode(range.rangeEndMs / 1000)}</Badge>}
                <Badge>{((draft.endMs - draft.startMs) / 1000).toFixed(1)}s</Badge>
              </div>
              <RemixEditLog draft={draft} recordings={recordings} headline={current.headline} caption={current.postCaption ?? ''} graphics={graphics[draft.id]} asked={asked[draft.id]}
                aiMoment={Boolean(range) && !nudged.has(draft.id)} disabled={busy} onRecordings={setRecordings} onError={onError} />
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                {source ? <MomentPreview source={source} startMs={draft.startMs} endMs={draft.endMs} label={`Moment ${draft.id + 1}`} />
                  : <div className="aspect-video w-full rounded-xl bg-black" />}
                <div className="space-y-2 text-xs text-ink-muted">
                  <p className="italic">“{draft.quote}”</p>
                  {draft.why && <p className="text-2xs text-ink-subtle">{draft.why}</p>}
                  {range && <Edges draft={draft} disabled={busy} onNudge={(a, b) => void nudge(draft, a, b)} />}
                  <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={working === `another-${draft.id}`} disabled={busy}
                    onClick={() => void another(draft)}>Find another moment in this range</Button>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <p className="flex items-center gap-1.5 text-sm text-ink"><Camera className="h-4 w-4" />Your take</p>
                {take ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-xs text-success"><Check className="mr-1 inline h-3 w-3" />{take.uploaded ? 'Uploaded' : 'Recorded here'}{take.seconds ? ` · ${formatTimecode(take.seconds)}` : ''}</span>
                    <Button size="sm" variant="secondary" icon={<Camera className="h-3.5 w-3.5" />} disabled={busy} onClick={() => setRecording(draft)}>Record again</Button>
                    <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} loading={working === `upload-${draft.id}`} disabled={busy} onClick={() => void upload(draft)}>Upload another</Button>
                    <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void remove(draft)}>Delete</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-2xs text-ink-muted">Say what you think about it, in your own words. Up to {MOMENT_TAKE_MAX_SECONDS / 60} minutes; no script needed.</span>
                    <Button size="sm" variant="primary" icon={<Camera className="h-3.5 w-3.5" />} disabled={busy} onClick={() => setRecording(draft)}>Record</Button>
                    <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} loading={working === `upload-${draft.id}`} disabled={busy}
                      onClick={() => void upload(draft)}>Upload a phone video</Button>
                  </div>
                )}
                {range?.points.length ? (
                  <ul className="space-y-0.5 text-xs text-ink-muted" aria-label={`Talking points, moment ${draft.id + 1}`}>
                    {range.points.map((point, i) => <li key={i}>• {point}</li>)}
                  </ul>
                ) : (
                  <Button size="sm" variant="ghost" icon={<ListChecks className="h-3.5 w-3.5" />} loading={working === `points-${draft.id}`} disabled={busy}
                    onClick={() => void points(draft)}>Give me talking points</Button>
                )}
                <TakeTrimControl draft={draft} recordings={recordings} disabled={busy || recording !== null} onRecordings={setRecordings} onError={onError} />
                <TakeTrimNote draft={draft} recordings={recordings} disabled={busy} onRecordings={setRecordings} onError={onError} />
              </div>

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm text-ink"><Sparkles className="h-4 w-4" />Hook text and caption</p>
                {range?.said && <p className="line-clamp-3 text-xs italic text-ink-muted">You said: “{range.said}”</p>}
                {take && (
                  <Button size="sm" variant={draft.headline ? 'ghost' : 'primary'} icon={<Sparkles className="h-3.5 w-3.5" />} loading={working === `write-${draft.id}`} disabled={busy}
                    onClick={() => void write([draft.id])}>{draft.headline ? 'Rewrite from what I said' : 'Write my hook text and caption'}</Button>
                )}
                {!showText && (
                  <button type="button" className="block text-2xs text-tool" onClick={() => setWriteOwn((list) => new Set(list).add(draft.id))}>Or write them yourself</button>
                )}
                {showText && <>
                  <Field label="Hook text" hint={`${wordCount(current.headline)} / ${REMIX_WORD_LIMITS.headline} words · shown at the top and used as the video’s title in your Library`}>
                    <TextInput aria-label={`Hook text, moment ${draft.id + 1}`} value={current.headline} maxLength={160} onChange={(e) => change(draft, { headline: e.target.value })} />
                  </Field>
                  <Field label="Post caption" hint={`${(current.postCaption ?? '').length.toLocaleString('en-US')} / ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters · filled in when you post from the Library`}>
                    <TextArea aria-label={`Post caption, moment ${draft.id + 1}`} rows={5} value={current.postCaption ?? ''} maxLength={MAX_POST_CAPTION_CHARS}
                      onChange={(e) => change(draft, { postCaption: e.target.value })} />
                  </Field>
                </>}
                {problem && <p className="text-2xs text-danger" role="alert">{problem}</p>}
                {draft.notes.map((note, i) => <p key={i} className="text-2xs text-warning"><AlertTriangle className="mr-1 inline h-3 w-3" />{note}</p>)}
              </div>
            </section>
          )
        })}
        <RemixLookSection status={status} disabled={busy} frame={recordings[focused?.id ?? 0]?.reaction?.path ?? source} hookText={focused ? value(focused).headline : ''} onError={onError} />
        {focused && <>
          {drafts.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs text-ink-muted">Graphics and chat for</span>
              <Segmented<string> label="Graphics and chat for" size="sm" value={String(focused.id)} onChange={(id) => setFocus(Number(id))}
                options={drafts.map((draft) => ({ value: String(draft.id), label: `Moment ${draft.id + 1}` }))} />
            </div>
          )}
          <RemixGraphicsSection key={`g${focused.id}`} status={status} draft={focused} text={focusText(focused)} recordings={recordings} banner={false} disabled={busy}
            onGraphics={(change) => setGraphics((current) => ({ ...current, [focused.id]: change(current[focused.id] ?? []) }))}
            partMs={recordings[focused.id]?.reaction?.seconds ? Math.round(recordings[focused.id]!.reaction!.seconds * 1000) : null} />
          <RemixChatSection key={`c${focused.id}`} runId={status.id} draft={focused} text={focusText(focused)} onText={(patch) => onText(focused, patch)}
            video={recordings[focused.id]?.reaction?.path ?? null} seek={(recordings[focused.id]?.reaction?.trim?.startMs ?? 0) / 1000 + 0.1} onAsked={(next) => setAsked((before) => ({ ...before, [focused.id]: { ...before[focused.id], ...next } }))}
            afterMain={async () => { setRecordings(await getApi().remix.recordings()) }} label={drafts.length > 1 ? `Chat · moment ${focused.id + 1}` : 'Chat'}
            disabledReason={busy ? 'Wait for what’s running to finish.' : recording ? 'Close the recorder to chat.' : null} />
        </>}
        <div className="flex flex-wrap items-center gap-2">
          {unwritten.length > 1 && (
            <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={working.startsWith('write-') && working.includes(',')} disabled={busy}
              onClick={() => void write(unwritten.map((draft) => draft.id))}>Write hook text for all {unwritten.length} takes</Button>
          )}
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={working === 'make'} disabled={busy || blocker !== null} tooltip={blocker ?? undefined}
            onClick={() => void make()}>Make {chosen.length === 1 ? '1 video' : `${chosen.length} videos`}</Button>
          {writing
            ? <Button variant="secondary" disabled={status.detail === 'Cancelling…'} onClick={() => void getApi().remix.cancel()}>Cancel</Button>
            : <Button variant={confirmDiscard ? 'danger' : 'ghost'} icon={<X className="h-4 w-4" />} disabled={busy} onClick={() => void discard()}>
                {confirmDiscard ? 'Click again to discard' : 'Discard all'}
              </Button>}
        </div>
        <p className="text-2xs text-ink-subtle">{momentMakeNote(chosen.map((draft) => draft.id), recordings)}</p>
      </div>
      {recording && <RemixRecorder draft={drafts.find((item) => item.id === recording.id) ?? recording} edit={value(recording)} recordings={recordings} talk
        points={drafts.find((item) => item.id === recording.id)?.moment?.points ?? []} onRecordings={setRecordings} onClose={closeRecorder} />}
    </Panel>
  )
}

/** Start and end of the moment, nudged in quarter and whole seconds (inside its range). */
function Edges({ draft, disabled, onNudge }: { draft: RemixDraft; disabled: boolean; onNudge: (startMs: number, endMs: number) => void }): React.JSX.Element {
  const range = draft.moment!
  const step = (startMs: number, endMs: number): { ok: boolean; startMs: number; endMs: number } =>
    ({ ok: momentBoundsProblem(startMs, endMs, range) === null, startMs, endMs })
  const row = (edge: 'start' | 'end'): React.JSX.Element => (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Nudge the ${edge}, moment ${draft.id + 1}`}>
      <span className="w-24 text-2xs text-ink-subtle">{edge === 'start' ? 'Starts' : 'Ends'} at {clock(edge === 'start' ? draft.startMs : draft.endMs)}</span>
      {NUDGES.map((by) => {
        const next = edge === 'start' ? step(draft.startMs + by, draft.endMs) : step(draft.startMs, draft.endMs + by)
        return (
          <Button key={by} size="sm" variant="secondary" disabled={disabled || !next.ok} aria-label={`${edge === 'start' ? 'Start' : 'End'} ${by > 0 ? 'later' : 'earlier'} by ${Math.abs(by) / 1000}s`}
            onClick={() => onNudge(next.startMs, next.endMs)}>{by > 0 ? `+${by / 1000}s` : `${by / 1000}s`}</Button>
        )
      })}
    </div>
  )
  return <div className="space-y-1">{row('start')}{row('end')}<p className="text-2xs text-ink-subtle">The cut lands on whole words when the video is made.</p></div>
}

/** The moment from the long video: plays from its start and stops at its end. */
function MomentPreview({ source, startMs, endMs, label }: { source: string; startMs: number; endMs: number; label: string }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { if (video.current && !playing) video.current.currentTime = startMs / 1000 }, [startMs, playing])
  const play = (): void => {
    const el = video.current
    if (!el) return
    if (!el.paused) { el.pause(); return }
    el.currentTime = startMs / 1000
    void el.play().catch(() => undefined)
  }
  return (
    <div className="space-y-1.5">
      <video ref={video} src={localFileUrl(source)} playsInline preload="metadata" aria-label={`${label} preview`} className="aspect-video w-full rounded-xl bg-black object-contain"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= endMs / 1000) { e.currentTarget.pause(); e.currentTarget.currentTime = startMs / 1000 } }} />
      <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} onClick={play}>{playing ? 'Stop' : 'Play the moment'}</Button>
    </div>
  )
}
