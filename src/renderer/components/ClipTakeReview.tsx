import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, Film, Plus, RotateCcw, Scissors, Sparkles, Upload, Wand2, X } from 'lucide-react'
import { formatSeconds } from '../../shared/pause-react'
import {
  MAX_POST_CAPTION_CHARS, partsFor, REMIX_WORD_LIMITS, remixEditProblem, wordCount, type RecordingPart, type RemixEdit, type RemixRecordings, type RemixStatus
} from '../../shared/remix'
import { BROLL_MAX_ITEMS, CLIP_MAX_SECONDS, CLIP_TAKE_MAX_SECONDS, type BrollShot, type BrollView } from '../../shared/react-templates'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { partLabel, RemixRecorder } from './RemixRecorder'
import { Part2Look, ProofScreenshots } from './ClipLayoutSections'
import type { BoxAt, LayoutExtrasView } from '../../shared/remix-layouts'
import type { EditorGraphic } from '../../shared/motion-graphics'
import { RemixChatSection, RemixGraphicsSection, TakeTrimNote, type TakeText } from './RemixReviewExtras'
import { RemixEditLog } from './EditLog'
import { Segmented } from './ui/Segmented'
import { TrimControl } from './PauseReactReview'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { FriendlyError } from './FriendlyError'
import { Field, TextArea, TextInput } from './ui/Field'
import { Panel, PanelHeader } from './ui/Panel'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

type Working = '' | 'upload' | 'write' | 'make' | 'trim' | 'discard' | 'broll' | 'plan' | 'layout'

/**
 * Their clip, then me / React, then my thoughts, once their video is ready: choose the part of it, record (or upload)
 * your take, or both parts, add your b-roll (React, then my thoughts), then the hook text and caption the AI writes
 * from what you said, and make it.
 */
export function ClipTakeReview({ status, onError, onOpenKeys }: { status: RemixStatus; onError: (message: string | null) => void; onOpenKeys: () => void }): React.JSX.Element {
  const draft = status.drafts[0]
  const react = draft.format === 'react_thoughts'
  const [recordings, setRecordings] = useState<RemixRecordings>({})
  const [source, setSource] = useState<string | null>(null)
  const [recording, setRecording] = useState<RecordingPart | null>(null)
  const [working, setWorking] = useState<Working>('')
  const [edit, setEdit] = useState<RemixEdit | null>(null)
  const [writeOwn, setWriteOwn] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [broll, setBroll] = useState<BrollView | null>(null)
  const [layout, setLayout] = useState<LayoutExtrasView | null>(null)
  const [graphics, setGraphics] = useState<EditorGraphic[]>([])
  const parts = partsFor(draft.format, 0)
  const recorded = (part: RecordingPart): boolean => Boolean(recordings[draft.id]?.[part])
  const allRecorded = parts.every(recorded)

  const refresh = useCallback(async (): Promise<RemixRecordings> => {
    const [list, view, extras] = await Promise.all([getApi().remix.recordings(), react ? getApi().remix.brollView() : Promise.resolve(null), getApi().remix.layoutView()])
    setRecordings(list)
    setBroll(view)
    setLayout(extras)
    return list
  }, [react])
  useEffect(() => {
    refresh().catch(() => undefined)
    getApi().remix.moment(draft.id).then((moment) => setSource(moment.path)).catch((err) => onError(errorMessage(err)))
  }, [status.id, draft.id, refresh, onError])

  const current: RemixEdit = edit ?? { id: draft.id, headline: draft.headline, intro: '', beats: [], close: '', postCaption: draft.postCaption }
  const showText = Boolean(draft.headline) || writeOwn || Boolean(edit)
  const problem = showText ? remixEditProblem(current, draft.format) : null
  const busy = working !== ''

  const run = async (kind: Working, work: () => Promise<unknown>, fallback: string): Promise<void> => {
    setWorking(kind); onError(null)
    try { await work() } catch (err) { onError(errorMessage(err, fallback)) } finally { setWorking('') }
  }
  const write = (): Promise<void> => run('write', () => getApi().remix.write(), 'The hook text could not be written.')
  // Once everything is recorded and there's no hook text yet, it's written straight away (only after a new recording, so it isn't paid for twice).
  const writeIfReady = async (list: RemixRecordings): Promise<void> => {
    if (parts.every((part) => list[draft.id]?.[part]) && !draft.headline && !edit?.headline) await write()
  }
  const upload = async (part: RecordingPart): Promise<void> => {
    let list: RemixRecordings | null = null
    await run('upload', async () => { list = await getApi().remix.uploadRecording(draft.id, part); if (list) setRecordings(list) }, 'Your video could not be used.')
    if (list) await writeIfReady(list)
  }
  const remove = (part: RecordingPart): Promise<void> => run('upload', async () => setRecordings(await getApi().remix.removeRecording(draft.id, part)), 'It could not be deleted.')
  const trim = (startMs: number, endMs: number): Promise<void> => run('trim', async () => {
    await getApi().remix.trim(draft.id, startMs, endMs)
    // (React, then my thoughts: part 1 was filmed with the old part playing, so it's recorded again.)
    await refresh()
  }, 'That part of their video could not be used.')
  const make = (): Promise<void> => run('make', () => getApi().remix.render([current], graphics.length ? { [draft.id]: graphics } : undefined), 'The video could not be started.')
  // The hook text, caption and graphics the Graphics and Chat sections change.
  const text: TakeText = { headline: current.headline, postCaption: current.postCaption ?? '', graphics }
  const onText = (patch: Partial<TakeText>): void => {
    if (patch.graphics) setGraphics(patch.graphics)
    if (patch.headline !== undefined || patch.postCaption !== undefined) {
      setEdit((before) => ({ ...(before ?? current), ...(patch.headline !== undefined ? { headline: patch.headline } : {}), ...(patch.postCaption !== undefined ? { postCaption: patch.postCaption } : {}) }))
    }
  }
  const setBoxAt = (boxAt: BoxAt): Promise<void> => run('layout', async () => setLayout(await getApi().remix.setLayout({ boxAt })), 'Their clip could not be moved.')
  const discard = async (): Promise<void> => {
    if (!confirmDiscard) { setConfirmDiscard(true); return }
    await run('discard', () => getApi().remix.discard(), 'It could not be discarded.')
  }
  const closeRecorder = (changed: boolean): void => {
    setRecording(null)
    if (changed) void refresh().then(writeIfReady).catch(() => undefined)
  }
  const setPlan = (plan: BrollShot[]): Promise<void> => run('broll', async () => setBroll(await getApi().remix.brollPlan(plan)), 'The b-roll could not be changed.')

  const take = react ? 'thoughts' : 'reaction'
  const blocker = react && !recorded('reaction') ? 'Record part 1 first: you watching their clip'
    : !recorded(take) ? (react ? 'Record part 2 first: your thoughts' : 'Record or upload your take first')
      : !current.headline.trim() ? 'Write the hook text first'
        : problem ? 'Fix the hook text or caption first' : null
  const recorder = (part: RecordingPart, title: string, detail: string, step: number): React.JSX.Element => {
    const saved = recordings[draft.id]?.[part]
    return (
      <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label={title}>
        <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Camera className="h-4 w-4" />{step} · {title}</h3>
        <p className="text-2xs text-ink-muted">{detail}</p>
        {saved ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 text-xs text-success"><Check className="mr-1 inline h-3 w-3" />{saved.uploaded ? 'Phone video uploaded' : 'Recorded here'}{saved.seconds ? ` · ${formatSeconds(saved.seconds)}` : ''}</span>
            <Button size="sm" variant="secondary" icon={<Camera className="h-3.5 w-3.5" />} disabled={busy} onClick={() => setRecording(part)}>Record again</Button>
            <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} loading={working === 'upload'} disabled={busy} onClick={() => void upload(part)}>Upload another</Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void remove(part)}>Delete</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<Camera className="h-3.5 w-3.5" />} disabled={busy || !source} onClick={() => setRecording(part)}>Record here</Button>
            <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} loading={working === 'upload'} disabled={busy} onClick={() => void upload(part)}>Upload a phone video</Button>
          </div>
        )}
      </section>
    )
  }
  // Steps in order: their clip, the recording(s), part 2's look, b-roll, proof screenshots, then the hook text.
  const lookStep = 4
  const brollStep = layout ? 5 : 4
  const proofStep = react ? brollStep + (broll ? 1 : 0) : 3
  const step = proofStep + (layout ? 1 : 0)
  const takeSeconds = recordings[draft.id]?.[take]?.seconds ?? null
  const layoutProps = layout ? { view: layout, busy, onView: setLayout, onError, setBusy: (on: boolean) => setWorking(on ? 'layout' : '') } : null

  return (
    <Panel>
      <PanelHeader title={react ? 'Your React, then my thoughts' : 'Your clip, then you'}
        description={react
          ? 'Their clip plays while you react to it silently, then you share your thoughts (on camera or over a screen recording) with your b-roll cutting in. Choose the part, record both parts, add your b-roll, then make it.'
          : 'Their clip plays first with its captions, then you give your take. Choose the part, record your take, then make it.'} />
      <div className="mt-4 space-y-4">
        {status.error && <Callout tone="danger"><FriendlyError error={status.error} suffix="Your recordings are still here, so you can try again." /></Callout>}
        {status.warnings.map((warning, i) => <Callout key={i} tone="warning">{warning}</Callout>)}
        <RemixEditLog draft={draft} recordings={recordings} headline={current.headline} disabled={busy} onRecordings={setRecordings} onError={onError} />

        <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Their clip">
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Scissors className="h-4 w-4" />1 · Their clip</h3>
          <p className="text-2xs text-ink-muted">{draft.sourceTitle ? `“${draft.sourceTitle}”` : 'Their video'}{draft.creator ? ` · credited on screen as ${draft.creator}` : ''}</p>
          {source ? <TrimControl key={`${draft.startMs}-${draft.endMs}`} source={source} startMs={draft.startMs} endMs={draft.endMs} disabled={busy || recording !== null}
            saving={working === 'trim'} uploaded={false} maxSeconds={CLIP_MAX_SECONDS} onTrim={(a, b) => void trim(a, b)}
            note={react ? 'It plays while you film part 1: changing it after means recording part 1 again.' : 'All of it plays before your take, with its captions.'} />
            : <div className="aspect-video w-full max-w-md rounded-xl bg-black" />}
          {react && layout?.boxAt && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs text-ink-muted">Their clip’s box while you react</span>
              <Segmented<BoxAt> label="Where their clip’s box goes" size="sm" value={layout.boxAt} onChange={(value) => void setBoxAt(value)}
                options={[{ value: 'auto', label: 'Clear of my face' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} />
            </div>
          )}
        </section>

        {react ? (<>
          {recorder('reaction', partLabel('reaction', 'react_thoughts'),
            'Their clip plays on screen while your camera films you watching it. React with your face; your microphone isn’t recorded for this part (their clip’s sound is used). Or upload a phone video of you watching it play out loud: it’s lined up by its sound.', 2)}
          {recorder('thoughts', partLabel('thoughts', 'react_thoughts'),
            layout?.part2 === 'screen'
              ? `Then say what you think of it, up to ${CLIP_TAKE_MAX_SECONDS / 60} minutes. Only your voice is used: your screen recording plays over it.`
              : `Then say what you think of it, in your own words, up to ${CLIP_TAKE_MAX_SECONDS / 60} minutes. You fill the screen, and your b-roll cuts in over what you say.`, 3)}
          {layoutProps && <Part2Look {...layoutProps} step={lookStep} />}
          {broll && <BrollSection view={broll} step={brollStep} busy={busy} working={working} canPlan={recorded('thoughts') && recorded('reaction')}
            onView={setBroll} onError={onError} setWorking={setWorking} onPlan={setPlan} onOpenKeys={onOpenKeys} />}
        </>) : <>
          {recorder('reaction', 'Your take',
            `Watch their clip, then say what you think of it, in your own words, up to ${CLIP_TAKE_MAX_SECONDS / 60} minutes. Record here, or upload a phone video.`, 2)}
          <TakeTrimNote draft={draft} recordings={recordings} disabled={busy} onRecordings={setRecordings} onError={onError} />
        </>}
        {layoutProps && <ProofScreenshots {...layoutProps} step={proofStep} takeSeconds={takeSeconds} />}

        <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Hook text and caption">
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Sparkles className="h-4 w-4" />{step} · Hook text and caption</h3>
          {draft.quote && <p className="line-clamp-3 text-xs italic text-ink-muted">You said: “{draft.quote}”</p>}
          {allRecorded && (
            <Button size="sm" variant={draft.headline ? 'ghost' : 'primary'} icon={<Sparkles className="h-3.5 w-3.5" />} loading={working === 'write'} disabled={busy}
              onClick={() => void write()}>{draft.headline ? 'Rewrite from what I said' : react ? 'Write my hook text, caption and b-roll plan' : 'Write my hook text and caption'}</Button>
          )}
          {!showText && (
            <button type="button" className="block text-2xs text-accent" onClick={() => setWriteOwn(true)}>Or write the hook text and caption yourself</button>
          )}
          {showText && <>
            <Field label="Hook text" hint={`${wordCount(current.headline)} / ${REMIX_WORD_LIMITS.headline} words · shown at the top and used as the video’s title in your Library`}>
              <TextInput aria-label="Hook text, your video" value={current.headline} maxLength={160} onChange={(e) => setEdit({ ...current, headline: e.target.value })} />
            </Field>
            <Field label="Post caption" hint={`${(current.postCaption ?? '').length.toLocaleString('en-US')} / ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters · filled in when you post from the Library`}>
              <TextArea aria-label="Post caption, your video" rows={6} value={current.postCaption ?? ''} maxLength={MAX_POST_CAPTION_CHARS}
                onChange={(e) => setEdit({ ...current, postCaption: e.target.value })} />
            </Field>
            {problem && <p className="text-2xs text-danger" role="alert">{problem}</p>}
          </>}
          {draft.notes.map((note, i) => <p key={i} className="text-2xs text-warning"><AlertTriangle className="mr-1 inline h-3 w-3" />{note}</p>)}
        </section>

        <RemixGraphicsSection status={status} draft={draft} text={text} onGraphics={(change) => setGraphics(change)} recordings={recordings}
          partMs={takeSeconds ? Math.round(takeSeconds * 1000) : null} banner={Boolean(layout?.banner && layout.keyword)} disabled={busy} step={step + 1} />
        <RemixChatSection runId={status.id} draft={draft} text={text} onText={onText} afterMain={async () => { await refresh() }}
          disabledReason={busy ? 'Wait for what’s running to finish.' : recording ? 'Close the recorder to chat.' : null} />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={working === 'make'} disabled={busy || blocker !== null} tooltip={blocker ?? undefined}
            onClick={() => void make()}>Make the video</Button>
          <Button variant={confirmDiscard ? 'danger' : 'ghost'} icon={<X className="h-4 w-4" />} disabled={busy} onClick={() => void discard()}>
            {confirmDiscard ? 'Click again to discard' : 'Discard'}
          </Button>
        </div>
      </div>
      {recording && <RemixRecorder key={recording} draft={draft} edit={current} recordings={recordings} talk={false} cameraLayout={status.cameraLayout} initialPart={recording}
        onRecordings={setRecordings} onClose={closeRecorder} />}
    </Panel>
  )
}

/** React, then my thoughts: your own clips and pictures, stock footage to fill, and the plan (time, which clip, swap or remove). */
function BrollSection({ view, step, busy, working, canPlan, onView, onError, setWorking, onPlan, onOpenKeys }: {
  view: BrollView; step: number; busy: boolean; working: Working; canPlan: boolean
  onView: (view: BrollView) => void; onError: (message: string | null) => void; setWorking: (working: Working) => void
  onPlan: (plan: BrollShot[]) => Promise<void>; onOpenKeys: () => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const act = async (kind: Working, work: () => Promise<BrollView | null>, fallback: string): Promise<void> => {
    setWorking(kind); onError(null)
    try { const next = await work(); if (next) onView(next) } catch (err) { onError(errorMessage(err, fallback)) } finally { setWorking('') }
  }
  // A dropped file can't grant access to itself: the file dialog opens (in main), as everywhere else in the app.
  const add = (): Promise<void> => act('broll', () => getApi().remix.addBroll(), 'Those clips could not be added.')
  const names = new Map(view.items.map((item) => [item.id, item.name]))
  const plan = view.plan ?? []
  const full = view.items.length >= BROLL_MAX_ITEMS
  const swap = (index: number, choice: string): void => {
    void onPlan(plan.map((shot, i) => i === index ? { ...shot, item: choice === 'stock' ? null : choice, query: shot.query || shot.words.split(' ').slice(0, 3).join(' ') } : shot))
  }
  return (
    <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Your b-roll">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><Film className="h-4 w-4" />{step} · Your b-roll</h3>
      <p className="text-2xs text-ink-muted">Your own clips and pictures cut in over your thoughts, 1.5–4 seconds each, where they match what you say. Never in your first 2 seconds or your last 1.5, and your voice keeps going underneath.</p>
      <div
        onDragEnter={(e) => { e.preventDefault(); depth.current += 1; if (!busy && !full) setDragging(true) }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false) }}
        onDrop={(e) => { e.preventDefault(); depth.current = 0; setDragging(false); if (!busy && !full && e.dataTransfer.files?.length) void add() }}
        className={cn('space-y-2 rounded-xl border border-dashed p-3', dragging ? 'border-accent bg-accent/10' : 'border-white/15')}
        data-testid="broll-drop">
        {view.items.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Your b-roll clips">
            {view.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5">
                {item.kind === 'image'
                  ? <img src={localFileUrl(item.path)} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                  : <video src={localFileUrl(item.path)} muted preload="metadata" className="h-9 w-9 shrink-0 rounded bg-black object-cover" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate text-xs text-ink" title={item.name}>{item.name}</span>
                <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} disabled={busy} aria-label={`Remove ${item.name}`}
                  onClick={() => void act('broll', () => getApi().remix.removeBroll(item.id), 'It could not be removed.')}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} loading={working === 'broll'} disabled={busy || full} onClick={() => void add()}>Add clips or pictures</Button>
          <span className="text-2xs text-ink-subtle">{full ? `That’s ${BROLL_MAX_ITEMS}, the most for one video.` : 'Or drop them here. Videos (MP4, MOV, WebM) or pictures (JPG, PNG, WebP).'}</span>
        </div>
      </div>
      <SettingRow title="Fill gaps with stock footage" description={view.stock ? 'Stock clips from Pexels fill the moments your own clips don’t cover.' : 'Off: only your own clips and pictures are used.'}
        control={<Switch label="Fill gaps with stock footage" checked={view.stock} disabled={busy} onChange={(on) => void act('broll', () => getApi().remix.brollStock(on), 'It could not be changed.')} />} />
      {view.stock && !view.pexels && (
        <p className="text-2xs text-warning">Stock footage needs a free Pexels key. <button type="button" className="text-accent underline" onClick={onOpenKeys}>Add it in Settings → API keys</button></p>
      )}
      {view.plan && (
        <div className="space-y-2">
          <p className="text-sm text-ink">Where your b-roll goes</p>
          {plan.length === 0 ? <p className="text-2xs text-ink-subtle">No b-roll: you’re on screen the whole time.</p> : (
            <ol className="space-y-1.5" aria-label="B-roll plan">
              {plan.map((shot, i) => (
                <li key={`${shot.start}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5 text-xs">
                  <span className="w-28 shrink-0 tabular-nums text-ink-muted">{formatSeconds(shot.start)}–{formatSeconds(shot.end)}</span>
                  <select aria-label={`Clip for the shot at ${formatSeconds(shot.start)}`} value={shot.item ?? 'stock'} disabled={busy}
                    onChange={(e) => swap(i, e.target.value)} className="max-w-[14rem] rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-ink">
                    {view.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    {(view.stock || shot.item === null) && <option value="stock">Stock: {shot.query || 'footage'}</option>}
                  </select>
                  <span className="min-w-0 flex-1 truncate italic text-ink-subtle" title={shot.words}>{shot.words ? `“${shot.words}”` : names.get(shot.item ?? '') ?? ''}</span>
                  <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} disabled={busy} aria-label={`Remove the shot at ${formatSeconds(shot.start)}`}
                    onClick={() => void onPlan(plan.filter((_, j) => j !== i))}>Remove</Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {(view.items.length > 0 || view.stock) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={view.plan ? 'ghost' : 'secondary'} icon={<Sparkles className="h-3.5 w-3.5" />} loading={working === 'plan'} disabled={busy || !canPlan}
            tooltip={canPlan ? undefined : 'Record both parts first'}
            onClick={() => void act('plan', () => getApi().remix.planBroll(), 'Your b-roll couldn’t be planned this time.')}>{view.plan ? 'Plan my b-roll again' : 'Plan my b-roll'}</Button>
          <span className="text-2xs text-ink-subtle">{view.plan ? 'Plans it again from what you said (a small AI call).' : 'It’s also planned when the AI writes your hook text, or when you make the video.'}</span>
        </div>
      )}
    </section>
  )
}
