import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CircleStop, ExternalLink, Film, RefreshCw, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { PRESET_VOICES, type AvatarSummary } from '../../../shared/avatars'
import {
  HEYGEN_PRICES, heygenStage, pricesCheckedOn, TWIN_MAX_SECONDS, TWIN_MIN_SECONDS,
  type HeygenSource, type HeygenStockAvatar, type HeygenVideoDraft
} from '../../../shared/heygen'
import { getApi } from '../../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../../lib/utils'
import { VoicePreview } from '../VoicePreview'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Checkbox } from '../ui/Checkbox'
import { DialogFooter } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { Field, TextInput } from '../ui/Field'
import { onRadioKeyDown, Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'

/** A checkbox with its label visible and clickable. */
function LabeledCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <Checkbox checked={checked} onChange={onChange} label={label} className="mt-px" />
      <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => onChange(!checked)}>{label}</span>
    </div>
  )
}

const usd = (value: number): string => `$${value.toFixed(2)}`

/** One line on what HeyGen bills, from the published prices kept in the app (with the date they were read). */
export function heygenPriceNote(): string {
  return `HeyGen’s API price, checked ${pricesCheckedOn()}`
}

/**
 * "Realistic talking avatar (HeyGen, Beta)" in the New avatar dialog: from a
 * short video of the member (digital twin, with HeyGen's consent step), one
 * photo of them, or one of HeyGen's stock AI people.
 */
export function HeygenCreateForm({ header, heygenConfigured, onCreated, onClose, onOpenKeys, initialSource = 'twin' }: {
  /** The dialog's title and avatar-type switch, shown above the form. */
  header: React.ReactNode
  heygenConfigured: boolean
  onCreated: (list: AvatarSummary[], source: HeygenSource) => void
  onClose: () => void
  onOpenKeys: () => void
  initialSource?: HeygenSource
}): React.JSX.Element {
  const [source, setSource] = useState<HeygenSource>(initialSource)
  const [video, setVideo] = useState<HeygenVideoDraft | null>(null)
  const [photo, setPhoto] = useState<{ draftId: string; path: string } | null>(null)
  const [recording, setRecording] = useState(false)
  const [stock, setStock] = useState<HeygenStockAvatar[] | null>(null)
  const [lookId, setLookId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [voice, setVoice] = useState<string>('heygen')
  const [consent, setConsent] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attempt = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setWorking(true); setError(null)
    try { await action() } catch (err) { setError(errorMessage(err)) } finally { setWorking(false) }
  }, [])

  useEffect(() => {
    if (source !== 'stock' || stock !== null || !heygenConfigured) return
    let live = true
    setWorking(true)
    getApi().heygen.stockAvatars().then((list) => { if (live) { setStock(list); setLookId(list[0]?.lookId ?? null) } })
      .catch((err) => { if (live) { setStock([]); setError(errorMessage(err, 'HeyGen’s stock avatars could not be loaded.')) } })
      .finally(() => { if (live) setWorking(false) })
    return () => { live = false }
  }, [source, stock, heygenConfigured])

  const chosenStock = stock?.find((item) => item.lookId === lookId) ?? null
  const heygenVoiceOffered = source === 'twin' || (source === 'stock' && Boolean(chosenStock?.voiceId))
  const voiceValue = heygenVoiceOffered ? voice : voice === 'heygen' ? PRESET_VOICES[0].id : voice
  const appVoice = voiceValue === 'heygen' ? PRESET_VOICES[0].id : voiceValue
  const switchSource = (next: HeygenSource): void => { setSource(next); setError(null); setConsent(false); setRecording(false) }

  const ready = Boolean(name.trim()) && !working && heygenConfigured && (
    source === 'stock' ? Boolean(lookId) : consent && (source === 'twin' ? Boolean(video) : Boolean(photo)))
  const create = (): Promise<void> => attempt(async () => {
    const list = await getApi().heygen.createAvatar({
      source, name, consent: source !== 'stock' && consent, voice: { provider: 'elevenlabs', voice: appVoice }, useHeygenVoice: voiceValue === 'heygen',
      ...(source === 'twin' ? { draftId: video?.draftId } : source === 'photo' ? { draftId: photo?.draftId } : { lookId: lookId ?? undefined })
    })
    onCreated(list, source)
  })

  return (
    <>
      <div className="space-y-4 overflow-y-auto p-5">
        {header}
        {!heygenConfigured && (
          <Callout tone="info" title="Add your HeyGen key first" action={<Button size="sm" onClick={onOpenKeys}>Open API keys</Button>}>
            Realistic talking avatars run on your own HeyGen account (Beta). Add a HeyGen API key in Settings → API keys.
          </Callout>
        )}
        <Segmented label="Make it from" value={source} onChange={switchSource} options={[
          { value: 'twin', label: <span className="inline-flex items-center gap-1.5"><Film className="h-3.5 w-3.5" />A video of me</span> },
          { value: 'photo', label: <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />A photo of me</span> },
          { value: 'stock', label: <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />HeyGen stock person</span> }
        ]} />

        {source === 'twin' && (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">
              {TWIN_MIN_SECONDS} seconds to {TWIN_MAX_SECONDS / 60} minutes of you talking to the camera (about 2 minutes works best). One person, face in frame the whole time, good light and a quiet room. HeyGen also clones your voice from it.
            </p>
            {recording ? (
              <TwinRecorder onCancel={() => setRecording(false)} onError={setError}
                onRecorded={(draft) => { setVideo(draft); setRecording(false) }} />
            ) : (
              <>
                {video && (
                  <video key={video.videoPath} src={localFileUrl(video.videoPath)} controls aria-label="Your video for HeyGen" className="mx-auto max-h-[260px] rounded-xl bg-black" />
                )}
                {video && <p className="text-center text-2xs text-ink-subtle">{video.seconds.toFixed(0)} seconds ready to send to HeyGen.</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} disabled={working || !heygenConfigured} onClick={() => { setError(null); setRecording(true) }}>{video ? 'Record again' : 'Record with camera'}</Button>
                  <Button size="sm" variant="secondary" icon={<Film className="h-3.5 w-3.5" />} loading={working} disabled={working || !heygenConfigured}
                    onClick={() => void attempt(async () => { const draft = await getApi().heygen.pickVideo(); if (draft) setVideo(draft) })}>{video ? 'Choose another video' : 'Choose video'}</Button>
                </div>
              </>
            )}
            <div className="glass-tile space-y-1 rounded-xl p-3" role="note" aria-label="HeyGen consent">
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink"><ShieldCheck className="h-3.5 w-3.5" />HeyGen asks for your consent</p>
              <p className="text-2xs text-ink-subtle">
                HeyGen requires consent for video avatars. After you create it, HeyGen’s consent page opens in your browser and you read a short statement on camera. HeyGen reviews it, usually within a few minutes, and the avatar can make videos once it’s accepted. The link works for 24 hours; you can get a new one from the avatar.
              </p>
            </div>
          </div>
        )}

        {source === 'photo' && (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">A clear, front-facing photo of you, evenly lit, your whole head in frame, nobody else in it. HeyGen animates it to speak.</p>
            {photo && <img src={localFileUrl(photo.path)} alt="Your photo for HeyGen" className="mx-auto max-h-[240px] rounded-xl object-cover" />}
            <Button size="sm" icon={<UserRound className="h-3.5 w-3.5" />} loading={working} disabled={working || !heygenConfigured}
              onClick={() => void attempt(async () => { const draft = await getApi().avatars.pickPhoto(); if (draft) setPhoto(draft) })}>{photo ? 'Choose another photo' : 'Choose photo'}</Button>
            <p className="text-2xs text-ink-subtle">HeyGen doesn’t run a consent check for photo avatars, so CreatorClips only makes one from a photo of you.</p>
          </div>
        )}

        {source === 'stock' && (
          <div className="space-y-2">
            <p className="text-xs text-ink-muted">A fully AI person from HeyGen’s stock avatars. Nobody’s real likeness, no consent step.</p>
            {stock === null ? <p className="text-2xs text-ink-subtle">{heygenConfigured ? 'Loading HeyGen’s stock avatars…' : 'Add your HeyGen key to see them.'}</p>
              : stock.length === 0 ? <EmptyState icon={<Sparkles />} title="No stock avatars" description="HeyGen returned none for this key." />
                : (
                  <div className="grid max-h-[300px] grid-cols-4 gap-2 overflow-y-auto pr-1" role="radiogroup" aria-label="HeyGen stock avatar">
                    {stock.map((item) => (
                      <button key={item.lookId} type="button" role="radio" aria-checked={lookId === item.lookId} aria-label={item.name}
                        tabIndex={lookId === item.lookId || (!lookId && item === stock[0]) ? 0 : -1} onKeyDown={onRadioKeyDown}
                        onClick={() => { setLookId(item.lookId); if (!name.trim()) setName(item.name.slice(0, 60)) }}
                        className={cn('glass-tile overflow-hidden rounded-lg text-left', lookId === item.lookId && 'glass-selected')}>
                        {item.previewPath
                          ? <img src={localFileUrl(item.previewPath)} alt="" className="aspect-[3/4] w-full object-cover" />
                          : <div className="flex aspect-[3/4] w-full items-center justify-center bg-white/[0.04]"><UserRound className="h-5 w-5 text-ink-subtle" /></div>}
                        <span className="block truncate px-1.5 py-1 text-2xs text-ink">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><TextInput value={name} maxLength={60} placeholder="e.g. Me on HeyGen" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Voice">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Select value={voiceValue} searchable onChange={setVoice} options={[
                  ...(heygenVoiceOffered ? [{ value: 'heygen', label: source === 'twin' ? 'My voice, cloned by HeyGen' : 'This avatar’s HeyGen voice', detail: source === 'twin' ? 'From the video' : 'HeyGen stock voice' }] : []),
                  ...PRESET_VOICES.map((item) => ({ value: item.id, label: item.label, detail: item.hint }))
                ]} />
              </div>
              {voiceValue !== 'heygen' && <VoicePreview request={{ kind: 'avatar', voice: { provider: 'elevenlabs', voice: voiceValue } }} name={voiceValue} />}
            </div>
          </Field>
        </div>
        <p className="text-2xs text-ink-subtle">
          {voiceValue === 'heygen' ? 'HeyGen speaks your scripts in this voice.' : 'Your scripts are voiced on OpenRouter (as with other avatars) and HeyGen lip-syncs the avatar to it.'}
        </p>

        {source !== 'stock' && (
          <LabeledCheckbox checked={consent} onChange={setConsent}
            label={source === 'twin' ? 'This is me. I’m the person in this video, and I agree to HeyGen making an avatar and a voice clone of me.' : 'This is me. I’m the person in this photo.'} />
        )}
        <p className="text-2xs text-ink-subtle">
          {source === 'stock'
            ? `Free to add. Videos are billed by HeyGen per second (about ${usd(HEYGEN_PRICES.avatarIvPerSecond)} a second, ${heygenPriceNote()}).`
            : `HeyGen bills about ${usd(HEYGEN_PRICES.avatarCreation)} to create this avatar, then about ${usd(HEYGEN_PRICES.avatarIvPerSecond)} per second of video (${heygenPriceNote()}).`}
        </p>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready} loading={working && ready} onClick={() => void create()}>Create HeyGen avatar</Button>
      </DialogFooter>
    </>
  )
}

/** Record twin footage with the camera: the member talks to the camera for 15 seconds to 3 minutes. */
function TwinRecorder({ onRecorded, onCancel, onError }: { onRecorded: (draft: HeygenVideoDraft) => void; onCancel: () => void; onError: (message: string | null) => void }): React.JSX.Element {
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [phase, setPhase] = useState<'starting' | 'ready' | 'recording' | 'saving'>('starting')
  const [elapsed, setElapsed] = useState(0)
  // The parent's callbacks change every render; the camera opens once.
  const callbacks = useRef({ onCancel, onError })
  callbacks.current = { onCancel, onError }

  useEffect(() => {
    let live = true
    const { onCancel, onError } = callbacks.current
    void (async () => {
      try {
        await getApi().remix.mediaAccess().catch(() => null)
        const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
        if (!live) { media.getTracks().forEach((track) => track.stop()); return }
        stream.current = media
        if (preview.current) preview.current.srcObject = media
        setPhase('ready')
      } catch {
        onError('The camera or microphone could not be opened. Allow CreatorClips to use them, or choose a video instead.')
        onCancel()
      }
    })()
    return () => {
      live = false
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const started = Date.now() - elapsed * 1000
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000)
      setElapsed(seconds)
      if (seconds >= TWIN_MAX_SECONDS) recorder.current?.stop()
    }, 250)
    return () => clearInterval(timer)
  }, [phase])

  const start = (): void => {
    if (!stream.current) return
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
    const next = new MediaRecorder(stream.current, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined)
    chunks.current = []
    next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
    next.onstop = () => {
      setPhase('saving')
      const blob = new Blob(chunks.current, { type: next.mimeType || 'video/webm' })
      void blob.arrayBuffer().then((buffer) => getApi().heygen.saveRecording(new Uint8Array(buffer), next.mimeType || 'video/webm'))
        .then(onRecorded)
        .catch((err) => { onError(errorMessage(err, 'The recording could not be saved.')); setPhase('ready') })
    }
    recorder.current = next
    next.start(1000)
    setElapsed(0)
    setPhase('recording')
    onError(null)
  }

  const minutes = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  return (
    <div className="space-y-2">
      <div className="relative mx-auto w-fit">
        <video ref={preview} autoPlay muted playsInline aria-label="Camera preview" className="max-h-[260px] rounded-xl bg-black" />
        {phase === 'recording' && <span className="glass-chip absolute left-2 top-2 rounded-full px-2 py-0.5 text-2xs text-white">● {minutes}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {phase === 'recording' ? (
          <Button size="sm" variant="danger" icon={<CircleStop className="h-3.5 w-3.5" />} disabled={elapsed < TWIN_MIN_SECONDS}
            tooltip={elapsed < TWIN_MIN_SECONDS ? `Keep talking: at least ${TWIN_MIN_SECONDS} seconds` : undefined} onClick={() => recorder.current?.stop()}>Stop</Button>
        ) : (
          <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} disabled={phase !== 'ready'} loading={phase === 'saving' || phase === 'starting'} onClick={start}>
            {phase === 'saving' ? 'Preparing…' : 'Start recording'}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={phase === 'saving'} onClick={onCancel}>Cancel</Button>
        <span className="text-2xs text-ink-subtle">Talk naturally to the camera: tell a story or explain something you know well. Stops by itself at {TWIN_MAX_SECONDS / 60} minutes.</span>
      </div>
    </div>
  )
}

/**
 * A HeyGen avatar's status in the avatar details: training, the consent step
 * (digital twins), errors in HeyGen's words, and which voice it speaks with.
 */
export function HeygenStatus({ avatar, busy, appVoiceLabel, onChange, onError }: {
  avatar: AvatarSummary; busy: boolean; appVoiceLabel: string; onChange: (list: AvatarSummary[]) => void; onError: (message: string | null) => void
}): React.JSX.Element | null {
  const link = avatar.heygen ?? null
  const [working, setWorking] = useState<string | null>(null)
  const stage = link ? heygenStage(link) : 'ready'
  const waiting = stage === 'training' || stage === 'consent'

  // While HeyGen trains or reviews consent, check now and then (a quiet call; nothing is billed).
  useEffect(() => {
    if (!link || !waiting) return
    const timer = setInterval(() => { getApi().heygen.refresh(avatar.id).then(onChange).catch(() => undefined) }, 20_000)
    return () => clearInterval(timer)
  }, [avatar.id, link, waiting, onChange])

  if (!link) return null
  const run = async (key: string, action: () => Promise<AvatarSummary[]>): Promise<void> => {
    setWorking(key); onError(null)
    try { onChange(await action()) } catch (err) { onError(errorMessage(err)) } finally { setWorking(null) }
  }
  const message = {
    training: 'HeyGen is training this avatar. It usually takes a few minutes.',
    consent: 'HeyGen needs your consent before this avatar can make videos. On HeyGen’s page you read a short statement on camera; HeyGen then reviews it, usually within a few minutes. The link works for 24 hours.',
    'consent-rejected': `HeyGen didn’t accept the consent recording${link.error ? `: ${link.error}` : '.'} Record it again.`,
    failed: `HeyGen could not make this avatar${link.error ? `: ${link.error}` : '.'} Make a new one with a clearer video or photo.`,
    ready: `Ready. Talking-head videos of ${avatar.name} are lip-synced by HeyGen.`
  }[stage]
  return (
    <div className="glass-tile space-y-2.5 rounded-xl p-3" role="group" aria-label="HeyGen avatar">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink"><Sparkles className="h-3.5 w-3.5" />Realistic talking avatar</p>
        <span className="flex gap-1"><Badge tone="neutral">HeyGen</Badge><Badge tone="warning">Beta</Badge></span>
      </div>
      <p className={cn('text-2xs', stage === 'failed' || stage === 'consent-rejected' ? 'text-danger' : stage === 'ready' ? 'text-success' : 'text-ink-muted')} role="status">{message}</p>
      <div className="flex flex-wrap gap-2">
        {(stage === 'consent' || stage === 'consent-rejected') && (
          <Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />} loading={working === 'consent'} disabled={working !== null}
            onClick={() => void run('consent', () => getApi().heygen.openConsent(avatar.id))}>{stage === 'consent' ? 'Open HeyGen consent page' : 'Record consent again'}</Button>
        )}
        {stage !== 'ready' && (
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={working === 'refresh'} disabled={working !== null}
            onClick={() => void run('refresh', () => getApi().heygen.refresh(avatar.id))}>Check status</Button>
        )}
      </div>
      {link.voiceId && (
        <Segmented label="Speaks with" size="sm" value={link.voice} onChange={(voice) => void run('voice', () => getApi().heygen.setVoice(avatar.id, voice))} options={[
          { value: 'heygen', label: link.source === 'twin' ? 'HeyGen voice clone' : 'HeyGen voice', disabled: busy ? 'Wait for the video to finish' : undefined },
          { value: 'app', label: `App voice · ${appVoiceLabel}`, disabled: busy ? 'Wait for the video to finish' : undefined }
        ]} />
      )}
      <p className="text-2xs text-ink-subtle">Removing this avatar here doesn’t delete it from your HeyGen account.</p>
    </div>
  )
}
