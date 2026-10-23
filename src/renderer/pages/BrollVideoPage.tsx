import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, AudioLines, Clapperboard, FileAudio, Images, Layers, Mic, Shuffle, Sparkles, Square, Wand2, type LucideIcon } from 'lucide-react'
import {
  BROLL_VIDEO_MAX_SCRIPT_CHARS, BROLL_VIDEO_MAX_SECONDS, defaultBrollVideoLook, estimateLine, shotsNeeded, scriptSeconds,
  type BrollVideoEstimate, type BrollVideoPhase, type BrollVideoShot, type BrollVoiceKind
} from '../../shared/broll-video'
import { aiEstimateLine, type BrollLibraryEntry } from '../../shared/broll-library'
import { PRESET_VOICES } from '../../shared/avatars'
import { setHideAfter, type HeadlineLook } from '../../shared/headline-look'
import type { BrandIdentity } from '../../shared/remix'
import { formatClock } from '../../shared/edit-recording'
import { getApi } from '../lib/ipc'
import { brandHeadlineLook, useDefaultLookSeed } from '../lib/default-look'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { brollVideoRequest, useBrollVideoDraft, useBrollVideoStatus, type BrollVideoDraft } from '../store/use-broll-video-store'
import { useBrollLibrary } from '../store/use-broll-library-store'
import { useSettingsStore } from '../store/use-settings-store'
import { CaptionPresetPicker } from '../components/CaptionPresetPicker'
import { useNow } from '../components/EditProgressView'
import { StepList, type StepItem } from '../components/StepList'
import { clockOf } from '../lib/edit-timings'
import { ClipEditor } from '../components/ClipEditor'
import { CtaPicker } from '../components/CtaPicker'
import { HeadlineLookPicker } from '../components/HeadlineLookPicker'
import { HideHookText } from '../components/HideHookText'
import { MusicPicker } from '../components/MusicPicker'
import { VoicePreview } from '../components/VoicePreview'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { Field, TextArea, TextInput } from '../components/ui/Field'
import { IconTile } from '../components/ui/IconTile'
import { Page as PageColumn } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Segmented } from '../components/ui/Segmented'
import { Select } from '../components/ui/Select'
import { SettingRow } from '../components/ui/SettingRow'
import { Switch } from '../components/ui/Switch'
import { Checklist, MakerAside, MakerLayout, MakerSection } from '../components/maker/Maker'
import type { Page } from '../components/Sidebar'

/**
 * B-roll video: your voiceover (or your script, voiced) covered start to end with your own b-roll, with captions,
 * hook text and motion graphics. The result opens in the clip editor, where everything stays editable. Adding more
 * b-roll and making it again uses the new clips.
 */
export function BrollVideoPage({ onNavigate, onViewLibrary }: { onNavigate: (page: Page) => void; onViewLibrary: (outputDir: string) => void }): React.JSX.Element {
  const status = useBrollVideoStatus((s) => s.status)
  const [editing, setEditing] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  useEffect(() => { void useBrollVideoStatus.getState().load() }, [])
  const working = status && !['done', 'failed', 'cancelled'].includes(status.phase)

  if (editing) return <ClipEditor outputDir={editing} onExports={async () => { setEditing(null) }}
    leading={<Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Back to B-roll video</Button>} />

  return (
    <PageColumn width="default">
      <PageHeader eyebrow="Studio" title="Your words, covered in b-roll"
        description="Your voiceover covered start to end with your own b-roll, with captions, hook text and motion graphics. Add more clips to your B-roll library any time: the next video uses them."
        actions={<Button variant="secondary" icon={<Images className="h-4 w-4" />} onClick={() => onNavigate('broll')}>B-roll library</Button>} />
      <div className="mt-4 space-y-4">
        {working && status ? <Making /> : status?.phase === 'done' && status.outputDir && !fresh
          ? <Result onEdit={setEditing} onViewLibrary={onViewLibrary} onAnother={() => setFresh(true)} />
          : <Form onStarted={() => setFresh(false)} onNavigate={onNavigate} />}
      </div>
    </PageColumn>
  )
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

type BrollLookFields = { captionPreset: string; hookLook: HeadlineLook; ctaId: string | null }

function brollLookFields(draft: Pick<BrollVideoDraft, 'look' | 'ctaId'>): BrollLookFields {
  return { captionPreset: draft.look.captionPreset, hookLook: draft.look.hookLook, ctaId: draft.ctaId }
}

/** A brand's look on a b-roll video: caption style, hook text look and call to action (the video's defaults where it saved nothing). */
function brollLookFromBrand(brand: BrandIdentity | null): BrollLookFields {
  const initial = defaultBrollVideoLook()
  return { captionPreset: brand?.look?.captionPreset ?? initial.captionPreset, hookLook: brandHeadlineLook(brand?.look, initial.hookLook), ctaId: brand?.look?.ctaId ?? null }
}

function Form({ onStarted, onNavigate }: { onStarted: () => void; onNavigate: (page: Page) => void }): React.JSX.Element {
  const draft = useBrollVideoDraft()
  // Starts from the default brand look (Brand look); a look picked here is for this video only.
  useDefaultLookSeed('broll-video', () => brollLookFields(useBrollVideoDraft.getState()), brollLookFields(useBrollVideoDraft.getInitialState()), brollLookFromBrand,
    ({ ctaId, ...look }) => { const state = useBrollVideoDraft.getState(); state.setLook(look); state.update({ ctaId }) })
  const status = useBrollVideoStatus((s) => s.status)
  const openrouter = useSettingsStore((s) => s.openrouterConfigured)
  const { view, load } = useBrollLibrary()
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [info, setInfo] = useState<{ estimate: BrollVideoEstimate; seconds: number | null; libraryShots: number; pickedShots: number } | null>(null)
  useEffect(() => { void load() }, [load])

  const needsFile = draft.voiceKind !== 'script'
  const needsScript = draft.voiceKind !== 'recording'
  const ready = (!needsFile || Boolean(draft.voiceover)) && (!needsScript || draft.script.trim().split(/\s+/).length >= 3)
  const request = useMemo(() => brollVideoRequest(draft), [draft])
  // The estimate and the shots it can use, kept up to date as the form changes.
  useEffect(() => {
    if (!ready) { setInfo(null); return }
    let live = true
    const timer = window.setTimeout(() => { void getApi().brollVideo.estimate(request).then((next) => { if (live) setInfo(next) }).catch(() => { if (live) setInfo(null) }) }, 250)
    return () => { live = false; window.clearTimeout(timer) }
  }, [request, ready, view])

  const usable = view?.usableShots ?? 0
  const seconds = info?.seconds ?? (needsFile ? draft.voiceover?.seconds ?? null : draft.script ? scriptSeconds(draft.script) : null)
  const needed = seconds ? shotsNeeded(seconds) : null
  const picked = info?.pickedShots ?? (draft.all ? usable : 0)
  const start = async (): Promise<void> => {
    setError(null); setStarting(true)
    try { await getApi().brollVideo.start(request); onStarted() }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setStarting(false) }
  }

  const vertical = draft.look.aspect === '9:16'
  const blocker = !openrouter ? 'Add your OpenRouter key first.' : !ready ? (needsFile ? 'Choose or record your voiceover first.' : 'Write your script first.')
    : usable === 0 && !draft.fillWithAi ? 'Add b-roll to your library, or fill gaps with AI shots.' : null
  const main = (<>
    {error && <Callout tone="danger" onDismiss={() => setError(null)}>{error}</Callout>}
    {status?.phase === 'failed' && status.error && !error && <Callout tone="danger">{status.error}</Callout>}
    {!openrouter && (
      <Callout tone="warning">Making a b-roll video uses your OpenRouter key: it listens to your voiceover for the word timings and plans the shots. <button type="button" className="text-tool underline" onClick={() => onNavigate('settings')}>Add it in Settings → API keys</button></Callout>
    )}

    <MakerSection number={1} title="Your words" aside="Your voiceover, a script, or both">
      <div className="space-y-3">
          <Segmented<BrollVoiceKind> label="Your words" value={draft.voiceKind} onChange={(voiceKind) => draft.update({ voiceKind })} options={[
            { value: 'recording', label: 'My voiceover' }, { value: 'script', label: 'A script (AI voice)' }, { value: 'both', label: 'Script + my recording' }]} />
          {needsScript && (
            <Field label="Script" hint={`${draft.script.length.toLocaleString('en-US')} / ${BROLL_VIDEO_MAX_SCRIPT_CHARS.toLocaleString('en-US')} characters${draft.script ? ` · about ${formatClock(scriptSeconds(draft.script))}` : ''}`}>
              <TextArea aria-label="Script" rows={6} maxLength={BROLL_VIDEO_MAX_SCRIPT_CHARS} value={draft.script} onChange={(e) => draft.update({ script: e.target.value })}
                placeholder={draft.voiceKind === 'both' ? 'Paste the script you read. It helps the app catch names and terms as you wrote them.' : 'Write what the voice says. Short sentences read best.'} />
            </Field>
          )}
          {draft.voiceKind === 'script' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink">Voice</span>
              <Select className="w-56" value={draft.presetVoice} onChange={(presetVoice) => draft.update({ presetVoice })} title="Voice" aria-label="Voice"
                options={PRESET_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.hint }))} />
              <VoicePreview request={{ kind: 'avatar', voice: { provider: 'elevenlabs', voice: draft.presetVoice } }} name={draft.presetVoice} />
            </div>
          )}
          {needsFile && <VoiceoverChooser onError={setError} />}
      </div>
    </MakerSection>

    <MakerSection number={2} title="Your b-roll" aside={<Button size="sm" variant="ghost" className="-my-1.5 text-tool hover:text-tool" onClick={() => onNavigate('broll')}>Add b-roll</Button>}>
      <div className="space-y-3">
        <p className="text-xs text-ink-muted">{view ? `${usable} shot${usable === 1 ? '' : 's'} ready in your B-roll library.${needed ? ` This video needs about ${needed} (one per phrase).` : ''}` : 'Loading your library…'}</p>
          <Segmented<'all' | 'pick'> label="Which b-roll" value={draft.all ? 'all' : 'pick'} onChange={(choice) => draft.update({ all: choice === 'all' })}
            options={[{ value: 'all', label: 'My whole library' }, { value: 'pick', label: 'Only some clips' }]} />
          {!draft.all && <BrollPicker items={view?.items ?? []} />}
          {needed !== null && picked > 0 && picked < needed && (
            <p className="text-2xs text-warning" data-testid="broll-video-reuse">You have {picked} shot{picked === 1 ? '' : 's'} for about {needed} moments, so some shots play twice (never back to back). Add more b-roll for more variety.</p>
          )}
          {usable === 0 && view && <p className="text-2xs text-warning">Your B-roll library has no shots ready yet. Add clips there, and let the AI look at them.</p>}
          <SettingRow title="Fill gaps with AI shots" description={draft.fillWithAi && view ? `Moments nothing in your library fits get a new AI shot (saved to your library). ${aiEstimateLine(view.ai)}` : 'Off: every moment uses your own b-roll.'}
            control={<Switch label="Fill gaps with AI shots" checked={draft.fillWithAi} onChange={(fillWithAi) => draft.update({ fillWithAi })} />} />
      </div>
    </MakerSection>

    <MakerSection number={3} title="The look" aside="All of it stays editable in the clip editor">
      <div className="glass space-y-4 rounded-2xl p-4">
          <Segmented<'9:16' | '16:9'> label="Shape" value={draft.look.aspect} onChange={(aspect) => draft.setLook({ aspect })}
            options={[{ value: '9:16', label: 'Vertical 9:16' }, { value: '16:9', label: 'Wide 16:9' }]} />
          {draft.look.aspect === '9:16' ? (
            <div className="space-y-2">
              <Field label="Hook text" hint="Big text at the top for the first seconds. Leave it empty for none.">
                <TextInput aria-label="Hook text" maxLength={120} value={draft.look.hookText} placeholder="I tried planning my day for 30 days" onChange={(e) => draft.setLook({ hookText: e.target.value })} />
              </Field>
              {draft.look.hookText.trim() && <>
                <HeadlineLookPicker compact value={draft.look.hookLook} onChange={(hookLook) => draft.setLook({ hookLook })} />
                <HideHookText value={draft.look.hookLook.hideAfterS} bar={draft.look.hookLook.look !== 'floating' && draft.look.hookLook.look !== 'none'}
                  onChange={(hideAfterS) => draft.setLook({ hookLook: setHideAfter(draft.look.hookLook, hideAfterS) })} />
              </>}
            </div>
          ) : <p className="text-2xs text-ink-subtle">Hook text is for vertical videos; wide videos have none.</p>}
          <SettingRow title="Captions" description="Word-by-word captions of what you say." control={<Switch label="Captions" checked={draft.look.captions} onChange={(captions) => draft.setLook({ captions })} />} />
          {draft.look.captions && <CaptionPresetPicker value={draft.look.captionPreset} onChange={(captionPreset) => draft.setLook({ captionPreset })} />}
          <SettingRow title="Motion graphics" description="Cards for numbers, lists and key lines, placed where you say them. Only words you say go on a card."
            control={<Switch label="Motion graphics" checked={draft.look.graphics} onChange={(graphics) => draft.setLook({ graphics })} />} />
          <SettingRow title="Quick crossfades" description="A 0.2 s crossfade between shots. Off: clean cuts on your phrases."
            control={<Switch label="Quick crossfades" checked={draft.look.crossfade} onChange={(crossfade) => draft.setLook({ crossfade })} />} />
          <SettingRow title="Voice cleanup" description="Less background noise and room echo, an even level."
            control={<Switch label="Voice cleanup" checked={draft.voiceCleanup} onChange={(voiceCleanup) => draft.update({ voiceCleanup })} />} />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink">Music</p>
            <MusicPicker value={draft.musicTrack} onChange={(musicTrack) => draft.update({ musicTrack })} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink">Call to action</p>
            <CtaPicker value={draft.ctaId} onChange={(ctaId) => draft.update({ ctaId })} compact />
          </div>
          <Field label="Name in your Library" hint="Optional. Otherwise the hook text or the first words.">
            <TextInput aria-label="Name in your Library" maxLength={120} value={draft.title} onChange={(e) => draft.update({ title: e.target.value })} />
          </Field>
      </div>
    </MakerSection>
  </>)

  const aside = (
    <MakerAside label={`Your video · ${draft.look.aspect}`}>
      <div className={cn('relative mx-auto mt-3 overflow-hidden rounded-[14px] bg-[radial-gradient(ellipse_40%_28%_at_50%_52%,#3A3F4C_0%,rgba(58,63,76,0)_100%),linear-gradient(180deg,#232733,#101218)] shadow-[0_20px_50px_rgb(0_0_0/0.5)]',
        vertical ? 'aspect-[9/16] w-[180px]' : 'aspect-video w-full')}>
        {vertical && draft.look.hookText.trim() && (
          <span className="absolute inset-x-[8%] top-[9%] text-center font-display text-sm font-bold leading-tight text-white [text-shadow:0_2px_6px_rgb(0_0_0/0.7)]">{draft.look.hookText.trim()}</span>
        )}
        <span className="absolute inset-x-3 bottom-3 text-center font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">{needsFile ? draft.voiceover ? `${formatClock(draft.voiceover.seconds)} voiceover` : 'Your voiceover' : 'AI voice'}</span>
      </div>
      <Checklist items={[
        'Your b-roll on every phrase',
        draft.look.captions ? 'Word-by-word captions' : 'No captions',
        draft.look.graphics ? 'Motion graphics on numbers and key lines' : 'No motion graphics',
        draft.look.crossfade ? 'Quick crossfades between shots' : 'Clean cuts on your phrases'
      ]} />
      <Button variant="primary" size="lg" className="mt-4 h-12 w-full rounded-[13px] font-display text-[15px] font-semibold" icon={<Clapperboard className="h-4 w-4" />} loading={starting}
        disabled={!ready || starting || !openrouter || (usable === 0 && !draft.fillWithAi)}
        onClick={() => void start()} data-testid="broll-video-start">Make my b-roll video</Button>
      {blocker && <p className="mt-2 text-center text-2xs text-ink-muted" role="status">{blocker}</p>}
      <p className="mt-2.5 text-center text-2xs leading-relaxed text-ink-subtle" data-testid="broll-video-cost">
        {info ? estimateLine(info.estimate) : ready ? 'Working out the cost…' : 'The cost shows here once your words are in.'}
      </p>
    </MakerAside>
  )

  return <MakerLayout main={main} aside={aside} />
}

function VoiceoverChooser({ onError }: { onError: (message: string) => void }): React.JSX.Element {
  const draft = useBrollVideoDraft()
  const [busy, setBusy] = useState<'' | 'choose' | 'recording' | 'saving'>('')
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current)
    recorder.current?.stream.getTracks().forEach((track) => track.stop())
  }, [])
  const choose = async (): Promise<void> => {
    setBusy('choose')
    try { const chosen = await getApi().brollVideo.chooseVoiceover(); if (chosen) draft.update({ voiceover: chosen }) }
    catch (failure) { onError(errorMessage(failure)) }
    finally { setBusy('') }
  }
  const stop = (): void => { if (recorder.current?.state === 'recording') recorder.current.stop() }
  const record = async (): Promise<void> => {
    try {
      await getApi().remix.mediaAccess().catch(() => null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
      const next = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (timer.current) { window.clearInterval(timer.current); timer.current = null }
        setBusy('saving')
        const type = next.mimeType || 'audio/webm'
        void new Blob(chunks, { type }).arrayBuffer()
          .then((buffer) => getApi().brollVideo.saveRecording(new Uint8Array(buffer), type.startsWith('audio/mp4') ? 'video/mp4' : 'audio/webm'))
          .then((saved) => draft.update({ voiceover: { ...saved, recorded: true } }))
          .catch((failure) => onError(errorMessage(failure, 'The recording could not be saved.'))).finally(() => setBusy(''))
      }
      recorder.current = next
      next.start(500)
      setElapsed(0)
      setBusy('recording')
      const began = Date.now()
      timer.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - began) / 1000)
        setElapsed(seconds)
        if (seconds >= BROLL_VIDEO_MAX_SECONDS) stop()
      }, 250)
    } catch {
      onError('The microphone could not be opened. Allow CreatorClips to use it, then try again.')
    }
  }
  const voice = draft.voiceover
  return (
    <div className="glass-tile flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5" data-testid="broll-voiceover">
      <FileAudio className="h-4 w-4 text-ink-subtle" aria-hidden />
      <div className="min-w-0 flex-1">
        {voice
          ? <p className="truncate text-xs font-medium text-ink">{voice.name} · {formatClock(voice.seconds)}</p>
          : <p className="text-xs text-ink-muted">An audio or video file of up to 3 minutes (MP3, M4A, WAV, MP4, MOV), or record it here.</p>}
        {voice?.recorded && <audio src={localFileUrl(voice.path)} controls className="mt-1 h-8 w-64" aria-label="Your recording" />}
      </div>
      {busy === 'recording'
        ? <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={stop}>Stop · {formatClock(elapsed)}</Button>
        : <>
          <Button size="sm" variant="secondary" icon={<FileAudio className="h-3.5 w-3.5" />} loading={busy === 'choose'} disabled={Boolean(busy)} onClick={() => void choose()}>{voice ? 'Choose another file' : 'Choose a file'}</Button>
          <Button size="sm" variant="ghost" icon={<Mic className="h-3.5 w-3.5" />} loading={busy === 'saving'} disabled={Boolean(busy)} onClick={() => void record()}>{voice?.recorded ? 'Record again' : 'Record'}</Button>
        </>}
    </div>
  )
}

/** Only some clips: by item, or by tag (yours and the AI's). */
function BrollPicker({ items }: { items: BrollLibraryEntry[] }): React.JSX.Element {
  const draft = useBrollVideoDraft()
  const ready = items.filter((item) => item.status === 'ready' && item.shots.some((shot) => shot.analysis))
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of ready) for (const tag of new Set([...item.tags, ...item.shots.flatMap((shot) => shot.analysis?.tags ?? [])])) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24).map(([tag]) => tag)
  }, [ready])
  const toggle = (list: string[], value: string): string[] => list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  return (
    <div className="space-y-2" data-testid="broll-video-picker">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {tags.map((tag) => (
            <button key={tag} type="button" aria-pressed={draft.tags.includes(tag)} onClick={() => draft.update({ tags: toggle(draft.tags, tag) })}
              className={cn('rounded-full px-2.5 py-1 text-2xs', draft.tags.includes(tag) ? 'bg-tool text-canvas' : 'bg-white/[0.06] text-ink-muted hover:text-ink')}>{tag}</button>
          ))}
        </div>
      )}
      <ul className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4" aria-label="Your b-roll clips">
        {ready.map((item) => {
          const on = draft.itemIds.includes(item.id)
          return (
            <li key={item.id}>
              <button type="button" aria-pressed={on} onClick={() => draft.update({ itemIds: toggle(draft.itemIds, item.id) })} aria-label={item.name}
                className={cn('glass-tile flex w-full items-center gap-2 rounded-xl p-1.5 text-left', on && 'glass-selected')}>
                {item.posterPath ? <img src={localFileUrl(item.posterPath)} alt="" className="h-10 w-16 shrink-0 rounded-md object-cover" /> : <span className="h-10 w-16 shrink-0 rounded-md bg-black/40" />}
                <span className="min-w-0">
                  <span className="block truncate text-2xs font-medium text-ink">{item.name}</span>
                  <span className="block text-[10px] text-ink-subtle">{item.shots.length} shot{item.shots.length === 1 ? '' : 's'}{item.me ? ' · you' : ''}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-2xs text-ink-subtle">{draft.itemIds.length + draft.tags.length ? `${draft.itemIds.length} clip${draft.itemIds.length === 1 ? '' : 's'} and ${draft.tags.length} tag${draft.tags.length === 1 ? '' : 's'} picked.` : 'Pick clips or tags to use.'}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Making it, and the result
// ---------------------------------------------------------------------------

/** The steps of a b-roll video, in order (the phases main reports). */
const BROLL_STEPS: { phase: BrollVideoPhase; label: string; icon: LucideIcon }[] = [
  { phase: 'voice', label: 'Your voiceover', icon: Mic }, { phase: 'listening', label: 'Listening', icon: AudioLines },
  { phase: 'planning', label: 'Planning your b-roll', icon: Wand2 }, { phase: 'making', label: 'Placing your b-roll', icon: Clapperboard },
  { phase: 'finishing', label: 'Captions and finishing', icon: Layers }
]
/** When this page saw each step start, per run (only what was seen: a step that started while away has no time). */
const brollStepSeen = new Map<string, Partial<Record<BrollVideoPhase, number>>>()

function Making(): React.JSX.Element {
  const status = useBrollVideoStatus((s) => s.status)!
  const [cancelling, setCancelling] = useState(false)
  const now = useNow(true)
  const seen = brollStepSeen.get(status.id) ?? {}
  if (!seen[status.phase]) { seen[status.phase] = Date.now(); brollStepSeen.set(status.id, seen) }
  const at = BROLL_STEPS.findIndex((item) => item.phase === status.phase)
  const started = Date.parse(status.startedAt)
  const step = /\((\d+) of (\d+)\)/.exec(status.detail)
  const items = BROLL_STEPS.map((item, i): StepItem => {
    const state = i < at ? 'done' : i === at ? 'current' : 'next'
    const from = seen[item.phase], next = BROLL_STEPS.slice(i + 1).map((later) => seen[later.phase]).find((value) => value !== undefined)
    const note = state === 'done' && from && next ? clockOf(next - from) : state === 'current' && from ? clockOf(now - from) : null
    return { id: item.phase, label: item.label, icon: item.icon, state, note, step: state === 'current' && step ? `${step[1]} of ${step[2]}` : null }
  })
  return (
    <Panel data-testid="broll-video-progress">
      <PanelHeader icon={<IconTile><Clapperboard /></IconTile>} title="Making your b-roll video" description={status.detail}
        action={<>
          {Number.isFinite(started) && <span className="glass-tile inline-flex h-7 items-center rounded-full px-3 font-mono text-[11px] tabular text-ink-muted">{clockOf(now - started)} elapsed</span>}
          <Button size="sm" variant="secondary" icon={<Square className="h-3.5 w-3.5" />} loading={cancelling}
            onClick={() => { setCancelling(true); void getApi().brollVideo.cancel().finally(() => setCancelling(false)) }}>Cancel</Button>
        </>} />
      <div className="mt-4"><StepList items={items} testId="broll-video-steps" /></div>
      <div className="mt-3 space-y-1">
        <ProgressBar value={status.percent} />
        <p className="text-2xs text-ink-subtle">{status.percent}% · {status.costUsd > 0 ? `$${status.costUsd.toFixed(3)} spent so far` : 'Nothing spent yet'}</p>
      </div>
    </Panel>
  )
}

function Result({ onEdit, onViewLibrary, onAnother }: { onEdit: (outputDir: string) => void; onViewLibrary: (outputDir: string) => void; onAnother: () => void }): React.JSX.Element {
  const status = useBrollVideoStatus((s) => s.status)!
  const outputDir = status.outputDir!
  const [shots, setShots] = useState<BrollVideoShot[]>(status.shots)
  const [swapped, setSwapped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const view = useBrollLibrary((s) => s.view)
  useEffect(() => { void useBrollLibrary.getState().load() }, [])
  const byItem = useMemo(() => new Map((view?.items ?? []).map((item) => [item.id, item])), [view])
  return (
    <>
      {status.warnings.map((warning) => <Callout key={warning} tone="warning">{warning}</Callout>)}
      {error && <Callout tone="danger" onDismiss={() => setError(null)}>{error}</Callout>}
      <Panel data-testid="broll-video-result">
        <PanelHeader icon={<IconTile><Sparkles /></IconTile>} title="Your b-roll video is ready"
          description={`${shots.length} shots over ${formatClock(Math.round((shots.at(-1)?.endMs ?? 0) / 1000))}${status.costUsd > 0 ? ` · $${status.costUsd.toFixed(3)} spent` : ''}. Open it in the editor to change the captions, hook text, graphics or framing.`} />
        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
          {status.outputPath
            ? <video src={localFileUrl(status.outputPath)} controls className="aspect-[9/16] w-full rounded-xl bg-black object-contain" data-testid="broll-video-player" />
            : <div className="flex aspect-[9/16] items-center justify-center rounded-xl bg-black/40 p-4 text-center text-2xs text-ink-subtle">Open it in the editor and press Bake to make the finished video.</div>}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => onEdit(outputDir)}>Open in the editor</Button>
              <Button variant="secondary" onClick={() => onViewLibrary(outputDir)}>See it in the Library</Button>
              <Button variant="ghost" onClick={onAnother}>Make another</Button>
            </div>
            {swapped && <Callout tone="info">Shot swapped. Open it in the editor and press Bake to update the finished video.</Callout>}
            <ShotList shots={shots} byItem={byItem} outputDir={outputDir} onShots={(next) => { setShots(next); setSwapped(true) }} onError={setError} />
          </div>
        </div>
      </Panel>
    </>
  )
}

/** Each shot, what is said over it, and "Swap": the next best match, or a shot you pick. */
function ShotList({ shots, byItem, outputDir, onShots, onError }: {
  shots: BrollVideoShot[]; byItem: Map<string, BrollLibraryEntry>; outputDir: string; onShots: (shots: BrollVideoShot[]) => void; onError: (message: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<number | null>(null)
  const [choosing, setChoosing] = useState<number | null>(null)
  const options = useMemo(() => [...byItem.values()].flatMap((item) => item.shots.filter((shot) => shot.analysis).map((shot) => ({
    value: `${item.id}:${shot.id}`, label: `${item.name}${item.shots.length > 1 ? ` (${shot.id.slice(1)})` : ''} · ${shot.analysis!.description.slice(0, 60)}`
  }))), [byItem])
  const swap = async (slot: number, shotId: string | null): Promise<void> => {
    setBusy(slot); setChoosing(null)
    try { onShots(await getApi().brollVideo.swapShot(outputDir, slot, shotId)) }
    catch (failure) { onError(errorMessage(failure)) }
    finally { setBusy(null) }
  }
  return (
    <ol className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1" aria-label="Shots">
      {shots.map((shot) => {
        const item = shot.shotId ? byItem.get(shot.shotId.split(':')[0]) : undefined
        return (
          <li key={shot.slot} className="glass-tile flex items-center gap-2 rounded-xl p-1.5" data-testid="broll-video-shot">
            {item?.posterPath ? <img src={localFileUrl(item.posterPath)} alt="" className="h-9 w-16 shrink-0 rounded-md object-cover" /> : <span className="flex h-9 w-16 shrink-0 items-center justify-center rounded-md bg-black/40 text-[10px] text-ink-subtle">{shot.ai ? 'AI' : '—'}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xs text-ink">“{shot.words || '…'}”</p>
              <p className="truncate text-[10px] text-ink-subtle">{formatClock(Math.round(shot.startMs / 1000))} · {shot.ai ? 'AI shot' : item?.name ?? 'Library shot'}{shot.reused ? ' · used again' : ''}</p>
            </div>
            {choosing === shot.slot
              ? <Select size="sm" className="w-56" searchable aria-label="Choose a shot" value="" options={[{ value: 'next', label: 'Next best match' }, ...options]}
                onChange={(value) => void swap(shot.slot, value === 'next' ? null : value)} />
              : <span className="flex">
                <Button size="sm" variant="ghost" icon={<Shuffle className="h-3.5 w-3.5" />} loading={busy === shot.slot} disabled={busy !== null} aria-label={`Swap shot ${shot.slot + 1} for the next best match`}
                  onClick={() => void swap(shot.slot, null)}>Swap</Button>
                <Button size="sm" variant="ghost" iconOnly icon={<ArrowLeftRight className="h-3.5 w-3.5" />} disabled={busy !== null} aria-label={`Choose a shot for moment ${shot.slot + 1}`} onClick={() => setChoosing(shot.slot)} />
              </span>}
          </li>
        )
      })}
      {shots.length === 0 && <li className="text-2xs text-ink-subtle"><Badge>No shots listed</Badge></li>}
    </ol>
  )
}

