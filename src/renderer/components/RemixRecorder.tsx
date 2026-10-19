import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Circle, Headphones, Mic, Pause, Play, RotateCcw, Square, Upload, X } from 'lucide-react'
import { partsFor, type RecordingPart, type RemixDraft, type RemixEdit, type RemixRecordings } from '../../shared/remix'
import { formatSeconds, PAUSE_REACT_MAX_SECONDS, type PauseEvent } from '../../shared/pause-react'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'

/** What each part of a take is called while recording. */
export function partLabel(part: RecordingPart): string {
  if (part === 'reaction') return 'Your reaction'
  if (part === 'intro') return 'Opening'
  if (part === 'close') return 'Close'
  return `Point ${Number(part.slice(4)) + 1}`
}

/** The line to read for a part of a voiced take. */
export function partText(edit: Pick<RemixEdit, 'intro' | 'beats' | 'close'>, part: RecordingPart): string {
  if (part === 'intro') return edit.intro
  if (part === 'close') return edit.close
  if (part.startsWith('beat')) return edit.beats[Number(part.slice(4))]?.text ?? ''
  return ''
}

const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

function recorderMime(): string {
  return MIME_TYPES.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) ?? 'video/webm'
}

type Phase = 'idle' | 'countdown' | 'recording' | 'saving'

/**
 * Record yourself for one take: a live reaction while the moment plays (the
 * two stay in sync because they start together here), or each line of a
 * voiced take read from a teleprompter. Anything can be redone, or uploaded
 * from a phone instead.
 */
export function RemixRecorder({ draft, edit, recordings, talk, onRecordings, onClose }: {
  draft: RemixDraft
  edit: RemixEdit
  recordings: RemixRecordings
  /** Reactions keep the member's voice. */
  talk: boolean
  onRecordings: (recordings: RemixRecordings) => void
  /** changed: a recording was saved, uploaded or deleted while the recorder was open. */
  onClose: (changed: boolean) => void
}): React.JSX.Element {
  const reaction = draft.format === 'silent'
  // Pause & react: their video plays while the camera records; Space pauses it while you talk (the app logs when).
  const pauseMode = draft.format === 'pause_react'
  const needsMic = !reaction || talk
  // Article or post: you talk over a screenshot, in one take.
  const image = draft.format === 'image'
  const parts = partsFor(draft.format, edit.beats.length)
  const done = recordings[draft.id] ?? {}
  const [part, setPart] = useState<RecordingPart>(() => parts.find((item) => !done[item]) ?? parts[0])
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState<string>('')
  const [micId, setMicId] = useState<string>('')
  const [moment, setMoment] = useState<{ path: string; startSeconds: number; endSeconds: number; kind: 'video' | 'image' } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [clipPlaying, setClipPlaying] = useState(false)
  const [clipEnded, setClipEnded] = useState(false)
  const events = useRef<PauseEvent[]>([])
  const detach = useRef<(() => void) | null>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const clip = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const token = useRef<string | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const startedAt = useRef(0)
  const offset = useRef<number | null>(null)
  const cancelled = useRef(false)
  // Each openDevices call gets a number; a slower, older one stops its own stream.
  const generation = useRef(0)
  const [opening, setOpening] = useState(false)
  const [uploading, setUploading] = useState(false)
  const changed = useRef(false)
  const dialog = useRef<HTMLDivElement>(null)
  const updateRecordings = (list: RemixRecordings): void => { changed.current = true; onRecordings(list) }
  const close = (): void => onClose(changed.current)

  // Camera and microphone: ask once (macOS), then open the chosen devices.
  const openDevices = useCallback(async (camera: string, mic: string): Promise<void> => {
    const mine = ++generation.current
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    setOpening(true)
    try {
      const access = await getApi().remix.mediaAccess()
      if (mine !== generation.current) return
      if (!access.camera || (needsMic && !access.microphone)) {
        setError(`CreatorClips can’t use your ${!access.camera ? 'camera' : 'microphone'}. Allow it in System Settings → Privacy & Security, then reopen this window.`)
        return
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: { ...(camera ? { deviceId: { exact: camera } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        // Echo cancellation keeps the clip's sound (from your speakers) out of your voice.
        // A silent reaction (talking off) doesn't use the microphone at all.
        audio: needsMic ? { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: true, noiseSuppression: true } : false
      })
      // Closed, or another device chosen, while this one was opening: let it go.
      if (mine !== generation.current) { media.getTracks().forEach((track) => track.stop()); return }
      stream.current = media
      if (preview.current) { preview.current.srcObject = media; void preview.current.play().catch(() => undefined) }
      const devices = await navigator.mediaDevices.enumerateDevices()
      if (mine !== generation.current) return
      setCameras(devices.filter((device) => device.kind === 'videoinput'))
      setMics(devices.filter((device) => device.kind === 'audioinput'))
      setError(null)
    } catch (err) {
      if (mine === generation.current) setError(errorMessage(err, 'Your camera could not be opened. Check that no other app is using it.'))
    } finally {
      if (mine === generation.current) setOpening(false)
    }
  }, [needsMic])

  useEffect(() => {
    // Reset on every mount (React's development mode mounts twice).
    cancelled.current = false
    void openDevices('', '')
    if (reaction || image || pauseMode) getApi().remix.moment(draft.id).then(setMoment).catch((err) => setError(errorMessage(err)))
    dialog.current?.focus()
    return () => {
      cancelled.current = true
      generation.current++
      recorder.current?.state === 'recording' && recorder.current.stop()
      if (token.current) void getApi().remix.recordingAbort(token.current)
      stream.current?.getTracks().forEach((track) => track.stop())
      detach.current?.()
    }
  }, [draft.id, reaction, image, pauseMode, openDevices])

  // The moment ready at its start, so the reaction lines up with it.
  useEffect(() => {
    const video = clip.current
    if (video && moment) video.currentTime = moment.startSeconds
  }, [moment])

  const stop = useCallback((): void => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    clip.current?.pause()
  }, [])

  const record = async (): Promise<void> => {
    const media = stream.current
    if (!media) { setError('Turn on your camera first.'); return }
    setError(null); setReviewing(false)
    setPhase('countdown')
    for (let n = 3; n > 0; n--) {
      setCount(n)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (cancelled.current) { setPhase('idle'); return }
    }
    const mime = recorderMime()
    try { token.current = await getApi().remix.recordingBegin(draft.id, part, mime) } catch (err) { setError(errorMessage(err)); setPhase('idle'); return }
    const chunks = new MediaRecorder(media, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    recorder.current = chunks
    queue.current = Promise.resolve()
    offset.current = null
    chunks.ondataavailable = (event) => {
      if (!event.data.size || !token.current) return
      const current = token.current
      queue.current = queue.current.then(async () => getApi().remix.recordingAppend(current, new Uint8Array(await event.data.arrayBuffer())))
    }
    chunks.onstop = () => { void save() }
    chunks.onstart = () => {
      startedAt.current = performance.now()
      setPhase('recording')
      const video = clip.current
      if (pauseMode && video && moment) {
        // Every play and pause of their video, on the recording's clock (milliseconds), with where it was.
        events.current = []
        setClipEnded(false)
        const log = (kind: PauseEvent['kind']) => (): void => {
          if (recorder.current?.state !== 'recording') return
          events.current.push({ t: Math.round(performance.now() - startedAt.current), o: Math.round(video.currentTime * 1000), kind })
          setClipPlaying(kind === 'play')
        }
        const onPlaying = log('play'), onPause = log('pause')
        video.addEventListener('playing', onPlaying)
        video.addEventListener('pause', onPause)
        detach.current?.()
        detach.current = () => { video.removeEventListener('playing', onPlaying); video.removeEventListener('pause', onPause) }
        video.currentTime = moment.startSeconds
        void video.play().catch(() => setError('Their video couldn’t play. Try again.'))
      }
      if (reaction && video && moment) {
        video.currentTime = moment.startSeconds
        // When the moment really starts playing, measured on the same clock as the recording.
        const onPlaying = (): void => { offset.current ??= (performance.now() - startedAt.current) / 1000 }
        video.addEventListener('playing', onPlaying, { once: true })
        void video.play().catch(() => setError('The clip couldn’t play. Try again.'))
      }
    }
    chunks.start(1000)
  }

  const save = async (): Promise<void> => {
    const current = token.current
    if (!current) return
    setPhase('saving')
    try {
      await queue.current
      token.current = null
      detach.current?.()
      detach.current = null
      setClipPlaying(false)
      // A reaction whose clip never started playing has no known offset: the engine lines it up by sound.
      const list = await getApi().remix.recordingFinish(current, reaction ? offset.current : image ? 0 : null,
        pauseMode ? { events: events.current, durationMs: Math.round(performance.now() - startedAt.current) } : undefined)
      updateRecordings(list)
      setReviewing(true)
      // A voiced take moves on to the next line still to record.
      if (!reaction && !image) {
        const next = parts.find((item) => item !== part && !list[draft.id]?.[item])
        if (next) { setPart(next); setReviewing(false) }
      }
    } catch (err) {
      setError(errorMessage(err, 'The recording could not be saved.'))
      token.current = null
      void getApi().remix.recordingAbort(current)
    } finally { setPhase('idle') }
  }

  // Reactions stop by themselves at the end of the moment.
  useEffect(() => {
    const video = clip.current
    // (Pause & react keeps recording after their video ends: you can keep talking.)
    if (!video || !moment || !reaction) return
    const tick = (): void => {
      if (phase !== 'recording') return
      setElapsed(Math.max(0, video.currentTime - moment.startSeconds))
      if (video.currentTime >= moment.endSeconds) { video.pause(); setTimeout(stop, 400) }
    }
    video.addEventListener('timeupdate', tick)
    return () => video.removeEventListener('timeupdate', tick)
  }, [moment, phase, stop, reaction])

  // Lines: a running clock while recording.
  useEffect(() => {
    if (phase !== 'recording' || reaction) return
    const timer = setInterval(() => {
      const seconds = (performance.now() - startedAt.current) / 1000
      setElapsed(seconds)
      // A take over a screenshot stops at the longest a video can be.
      if (image && moment && seconds >= moment.endSeconds) stop()
      if (pauseMode && seconds >= PAUSE_REACT_MAX_SECONDS) stop()
    }, 250)
    return () => clearInterval(timer)
  }, [phase, reaction, image, pauseMode, moment, stop])

  // Pause & react: their video holds at the end of the part you chose; you can keep talking.
  useEffect(() => {
    const video = clip.current
    if (!video || !moment || !pauseMode) return
    const tick = (): void => {
      if (phase === 'recording' && video.currentTime >= moment.endSeconds && !video.paused) { video.pause(); setClipEnded(true) }
    }
    video.addEventListener('timeupdate', tick)
    return () => video.removeEventListener('timeupdate', tick)
  }, [moment, phase, pauseMode])

  const toggleClip = useCallback((): void => {
    const video = clip.current
    if (!video || !moment || recorder.current?.state !== 'recording') return
    if (video.paused) {
      if (video.currentTime < moment.endSeconds - 0.05) void video.play().catch(() => undefined)
    } else video.pause()
  }, [moment])

  // Space pauses and plays their video while recording, wherever the focus is (not on the device menus).
  useEffect(() => {
    if (!pauseMode || phase !== 'recording') return
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key !== ' ' && event.code !== 'Space') || event.repeat || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
      event.preventDefault()
      toggleClip()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pauseMode, phase, toggleClip])

  const upload = async (): Promise<void> => {
    setError(null); setUploading(true)
    try { const list = await getApi().remix.uploadRecording(draft.id, part); if (list) { updateRecordings(list); setReviewing(true) } } catch (err) { setError(errorMessage(err)) }
    finally { setUploading(false) }
  }
  const redo = async (): Promise<void> => {
    setError(null)
    try { updateRecordings(await getApi().remix.removeRecording(draft.id, part)); setReviewing(false) } catch (err) { setError(errorMessage(err)) }
  }

  const saved = (recordings[draft.id] ?? {})[part]
  const busy = phase !== 'idle' || uploading
  const allDone = parts.every((item) => recordings[draft.id]?.[item])
  const line = reaction || image || pauseMode ? '' : partText(edit, part)

  return (
    <Dialog ref={dialog} aria-label="Record yourself" onBackdropMouseDown={busy ? undefined : close} panelClassName="max-w-[920px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) close() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Camera className="h-4 w-4" />{reaction || pauseMode ? 'React on camera' : image ? 'Talk over the screenshot' : 'Record your take'}</h2>
            {edit.headline && <p className="mt-0.5 truncate text-xs text-ink-muted">“{edit.headline}”</p>}
          </div>
          <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} disabled={busy} onClick={close}>{allDone ? 'Done' : 'Close'}</Button>
        </div>

        {!reaction && !image && !pauseMode && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Parts of the take">
            {parts.map((item) => (
              <button key={item} type="button" role="tab" aria-selected={item === part} disabled={busy} tabIndex={item === part ? 0 : -1}
                onKeyDown={(e) => {
                  const order = parts.indexOf(item)
                  const next = e.key === 'ArrowRight' ? parts[(order + 1) % parts.length] : e.key === 'ArrowLeft' ? parts[(order - 1 + parts.length) % parts.length] : null
                  if (!next) return
                  e.preventDefault(); setPart(next); setReviewing(false)
                  ;(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[parts.indexOf(next)])?.focus()
                }}
                onClick={() => { setPart(item); setReviewing(false) }}
                className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs', item === part ? 'bg-accent text-accent-ink' : 'bg-white/[0.06] text-ink-muted hover:text-ink')}>
                {recordings[draft.id]?.[item] && <Check className="h-3 w-3" />}{partLabel(item)}
              </button>
            ))}
          </div>
        )}

        {image && (
          <p className="text-2xs text-ink-muted">
            Say what the article or post says and what you think about it, as if you were telling a friend. The AI writes the headline and caption from your words, and the screenshot fills the screen behind you. Up to {Math.round((moment?.endSeconds ?? 180) / 60)} minutes.
          </p>
        )}

        {pauseMode && (
          <p className="flex items-center gap-1.5 text-2xs text-ink-muted"><Headphones className="h-3.5 w-3.5" />
            Wear headphones so their video’s sound stays out of your microphone. Press Space (or the big button) to pause their video when you talk, and again to play on. Up to {PAUSE_REACT_MAX_SECONDS / 60} minutes.
          </p>
        )}

        {reaction && (
          <p className="flex items-center gap-1.5 text-2xs text-ink-muted"><Headphones className="h-3.5 w-3.5" />
            {talk ? 'Wear headphones so the clip’s sound stays out of your voice. Talk as you react; your voice goes over the clip.' : 'React with your face; your microphone isn’t used. Headphones help you hear the clip without it echoing.'}
          </p>
        )}

        <div className={cn('grid gap-3', reaction || image || pauseMode ? 'sm:grid-cols-2' : '')}>
          {image && (
            <div className="space-y-1">
              <p className="text-2xs text-ink-subtle">Your screenshot</p>
              {moment
                ? <div className="aspect-video w-full overflow-y-auto rounded-xl bg-black"><img src={localFileUrl(moment.path)} alt="The screenshot you’re talking about" className="w-full" /></div>
                : <div className="aspect-video w-full rounded-xl bg-black" />}
            </div>
          )}
          {pauseMode && (
            <div className="space-y-2">
              <p className="text-2xs text-ink-subtle">Their video · {moment ? formatSeconds(moment.endSeconds - moment.startSeconds) : 'loading…'}</p>
              {moment
                ? <video ref={clip} src={localFileUrl(moment.path)} playsInline preload="auto" className="aspect-video w-full rounded-xl bg-black object-contain" aria-label="Their video" />
                : <div className="aspect-video w-full rounded-xl bg-black" />}
              {phase === 'recording' && (
                <Button variant={clipPlaying ? 'primary' : 'secondary'} size="lg" className="w-full" disabled={clipEnded && !clipPlaying}
                  icon={clipPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />} onClick={toggleClip}>
                  {clipEnded ? 'Their video has ended: keep talking, or press Stop' : clipPlaying ? 'Pause their video to talk (Space)' : 'Play their video (Space)'}
                </Button>
              )}
            </div>
          )}
          {reaction && (
            <div className="space-y-1">
              <p className="text-2xs text-ink-subtle">The moment · {moment ? `${(moment.endSeconds - moment.startSeconds).toFixed(0)}s` : 'loading…'}</p>
              {moment
                ? <video ref={clip} src={localFileUrl(moment.path)} playsInline preload="auto" className="aspect-video w-full rounded-xl bg-black object-contain" aria-label="The moment you react to" />
                : <div className="aspect-video w-full rounded-xl bg-black" />}
            </div>
          )}
          <div className="space-y-1">
            <p className="text-2xs text-ink-subtle">{reviewing && saved ? 'Your recording' : 'Your camera'}</p>
            <div className="relative overflow-hidden rounded-xl bg-black">
              {!reaction && !image && !pauseMode && !reviewing && (
                // Teleprompter: the line right under the camera, so your eyes stay near the lens.
                <p className="absolute inset-x-0 top-0 z-10 bg-black/70 px-4 py-3 text-center text-lg font-semibold leading-snug text-white" aria-label="Your line">{line || 'Nothing to say for this part.'}</p>
              )}
              <video ref={preview} muted playsInline className={cn('aspect-video w-full -scale-x-100 object-cover', reviewing && saved && 'hidden')} aria-label="Camera preview" />
              {reviewing && saved && <video key={saved.path} src={localFileUrl(saved.path)} controls playsInline className="aspect-video w-full object-contain" aria-label="Your recording" />}
              {phase === 'countdown' && <span className="absolute inset-0 flex items-center justify-center text-7xl font-black text-white drop-shadow-lg" aria-live="assertive">{count}</span>}
              {phase === 'recording' && <span className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-2xs font-semibold text-white"><Circle className="h-2 w-2 fill-current" />REC {pauseMode ? `${formatSeconds(elapsed)} of ${PAUSE_REACT_MAX_SECONDS / 60}:00` : `${elapsed.toFixed(0)}s`}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phase === 'recording'
            ? <Button variant="danger" icon={<Square className="h-4 w-4" />} onClick={stop}>Stop</Button>
            : <Button variant="primary" icon={<Circle className="h-4 w-4" />} loading={phase === 'countdown' || phase === 'saving'} disabled={busy || !stream.current || ((reaction || image || pauseMode) && !moment)}
                onClick={() => void record()}>{saved ? 'Record again' : reaction ? 'Start: the clip plays and you react' : pauseMode ? 'Start: their video plays and you react' : image ? 'Start recording' : `Record ${partLabel(part).toLowerCase()}`}</Button>}
          {!pauseMode && <Button variant="secondary" icon={<Upload className="h-4 w-4" />} loading={uploading} disabled={busy} onClick={() => void upload()}>{uploading ? 'Copying your video…' : 'Upload a video instead'}</Button>}
          {saved && !busy && <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void redo()}>Delete this recording</Button>}
          {saved && <span className="text-2xs text-success">{saved.uploaded ? 'Uploaded' : 'Recorded'} · {saved.seconds ? `${saved.seconds.toFixed(0)}s` : 'saved'}</span>}
        </div>

        <div className="flex flex-wrap gap-3 text-2xs text-ink-muted">
          <label className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" />
            <select aria-label="Camera" value={cameraId} disabled={busy || opening} onChange={(e) => { setCameraId(e.target.value); void openDevices(e.target.value, micId) }}
              className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-ink">
              <option value="">Default camera</option>
              {cameras.map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Camera ${i + 1}`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" />
            <select aria-label="Microphone" value={micId} disabled={busy || opening} onChange={(e) => { setMicId(e.target.value); void openDevices(cameraId, e.target.value) }}
              className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-ink">
              <option value="">Default microphone</option>
              {mics.map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}
            </select>
          </label>
        </div>
        <p className="text-2xs text-ink-subtle">
          {pauseMode
            ? 'Filming on your phone instead? Close this and choose Upload a phone recording: CreatorClips finds the pauses from the sound.'
            : reaction
            ? 'Filming on your phone? Record yourself while the clip plays out loud, then upload it: CreatorClips lines it up with the clip by its sound.'
            : image ? 'Filming on your phone? Record yourself talking, then upload it here. Keep the phone upright and your whole head in the frame.'
            : 'Look at the camera and read the line in your own words if you like; captions follow what you actually say. Filming on your phone? Upload each part instead.'}
        </p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
