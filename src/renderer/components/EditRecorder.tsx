import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Circle, Mic, Square, X } from 'lucide-react'
import { EDIT_RECORDER_MAX_SECONDS, formatClock, type EditSource } from '../../shared/edit-recording'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { frameGuide } from './RemixRecorder'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'

const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
function recorderMime(): string {
  return MIME_TYPES.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) ?? 'video/webm'
}

type Phase = 'idle' | 'countdown' | 'recording' | 'saving'

/**
 * Film yourself here: a camera preview with the 9:16 frame, and (from "What
 * should I film?") the hook and talking points over the top as a teleprompter.
 * Every take is saved to "My recordings" in your output folder and added to
 * the recordings to edit; record as many takes as you like.
 */
export function EditRecorder({ prompt, onRecorded, onClose }: {
  prompt: { hook: string; points: string[] } | null
  onRecorded: (source: EditSource) => void
  onClose: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<EditSource[]>([])
  const [showPrompt, setShowPrompt] = useState(true)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState('')
  const [micId, setMicId] = useState('')
  const [ready, setReady] = useState(false)
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const token = useRef<string | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const startedAt = useRef(0)
  const cancelled = useRef(false)
  const generation = useRef(0)
  const dialog = useRef<HTMLDivElement>(null)

  const openDevices = useCallback(async (camera: string, mic: string): Promise<void> => {
    const mine = ++generation.current
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    setReady(false)
    try {
      const access = await getApi().edit.mediaAccess()
      if (mine !== generation.current) return
      if (!access.camera || !access.microphone) {
        setError(`CreatorClips can’t use your ${!access.camera ? 'camera' : 'microphone'}. Allow it in System Settings → Privacy & Security, then reopen this window.`)
        return
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: { ...(camera ? { deviceId: { exact: camera } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: true, noiseSuppression: true }
      })
      if (mine !== generation.current) { media.getTracks().forEach((track) => track.stop()); return }
      stream.current = media
      if (preview.current) { preview.current.srcObject = media; void preview.current.play().catch(() => undefined) }
      const devices = await navigator.mediaDevices.enumerateDevices()
      if (mine !== generation.current) return
      setCameras(devices.filter((device) => device.kind === 'videoinput'))
      setMics(devices.filter((device) => device.kind === 'audioinput'))
      setError(null)
      setReady(true)
    } catch (err) {
      if (mine === generation.current) setError(errorMessage(err, 'Your camera could not be opened. Check that no other app is using it.'))
    }
  }, [])

  useEffect(() => {
    cancelled.current = false
    void openDevices('', '')
    dialog.current?.focus()
    return () => {
      cancelled.current = true
      generation.current++
      if (recorder.current?.state === 'recording') recorder.current.stop()
      if (token.current) void getApi().edit.recordingAbort(token.current)
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [openDevices])

  const stop = useCallback((): void => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(() => {
      const seconds = (performance.now() - startedAt.current) / 1000
      setElapsed(seconds)
      if (seconds >= EDIT_RECORDER_MAX_SECONDS) stop()
    }, 250)
    return () => clearInterval(timer)
  }, [phase, stop])

  const save = async (): Promise<void> => {
    const current = token.current
    if (!current) return
    setPhase('saving')
    try {
      await queue.current
      token.current = null
      const source = await getApi().edit.recordingFinish(current)
      setSaved((list) => [...list, source])
      onRecorded(source)
    } catch (err) {
      setError(errorMessage(err, 'The recording could not be saved.'))
      token.current = null
      void getApi().edit.recordingAbort(current)
    } finally { setPhase('idle') }
  }

  const record = async (): Promise<void> => {
    const media = stream.current
    if (!media) { setError('Turn on your camera first.'); return }
    setError(null)
    setPhase('countdown')
    for (let n = 3; n > 0; n--) {
      setCount(n)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (cancelled.current) { setPhase('idle'); return }
    }
    const mime = recorderMime()
    try { token.current = await getApi().edit.recordingBegin(mime) } catch (err) { setError(errorMessage(err)); setPhase('idle'); return }
    const chunks = new MediaRecorder(media, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    recorder.current = chunks
    queue.current = Promise.resolve()
    chunks.ondataavailable = (event) => {
      if (!event.data.size || !token.current) return
      const current = token.current
      queue.current = queue.current.then(async () => getApi().edit.recordingAppend(current, new Uint8Array(await event.data.arrayBuffer())))
    }
    chunks.onstop = () => { void save() }
    chunks.onstart = () => { startedAt.current = performance.now(); setElapsed(0); setPhase('recording') }
    chunks.start(1000)
  }

  const busy = phase !== 'idle'
  const guide = frameGuide()
  return (
    <Dialog ref={dialog} aria-label="Film yourself" onBackdropMouseDown={busy ? undefined : onClose} panelClassName="max-w-[760px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Camera className="h-4 w-4" />Film yourself</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Talk to the camera. Fluff a line? Just say it again: the edit keeps your last complete take. Up to {EDIT_RECORDER_MAX_SECONDS / 60} minutes.</p>
          </div>
          <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} disabled={busy} onClick={onClose}>{saved.length ? 'Done' : 'Close'}</Button>
        </div>

        {prompt && (
          <label className="flex items-center gap-2 text-2xs text-ink-muted">
            <input type="checkbox" checked={showPrompt} onChange={(e) => setShowPrompt(e.target.checked)} />
            Show the hook and talking points over the camera
          </label>
        )}

        <div className="relative overflow-hidden rounded-xl bg-black">
          {prompt && showPrompt && (
            // Teleprompter: right under the camera, so your eyes stay near the lens.
            <div className="absolute inset-x-0 top-0 z-10 bg-black/70 px-4 py-3 text-white" aria-label="Your teleprompter">
              <p className="text-center text-lg font-semibold leading-snug">{prompt.hook}</p>
              <ul className="mt-1 space-y-0.5 text-sm text-white/85">{prompt.points.map((point, i) => <li key={i}>• {point}</li>)}</ul>
            </div>
          )}
          <video ref={preview} muted playsInline className="aspect-video w-full -scale-x-100 object-cover" aria-label="Camera preview" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex justify-center">
            <div className="h-full rounded-sm border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" style={{ width: `${(guide.width * 100).toFixed(2)}%` }} />
          </div>
          {phase === 'countdown' && <span className="absolute inset-0 flex items-center justify-center text-7xl font-black text-white drop-shadow-lg" aria-live="assertive">{count}</span>}
          {phase === 'recording' && <span className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-2xs font-semibold text-white"><Circle className="h-2 w-2 fill-current" />REC {formatClock(elapsed)}</span>}
        </div>
        <p className="text-2xs text-ink-subtle">Keep your head and shoulders inside the bright frame: the reel is upright and follows your face.</p>

        <div className="flex flex-wrap items-center gap-2">
          {phase === 'recording'
            ? <Button variant="danger" icon={<Square className="h-4 w-4" />} onClick={stop}>Stop</Button>
            : <Button variant="primary" icon={<Circle className="h-4 w-4" />} loading={phase === 'countdown' || phase === 'saving'} disabled={busy || !ready} onClick={() => void record()}>
              {saved.length ? 'Record another take' : 'Start recording'}
            </Button>}
          {saved.map((source, i) => (
            <span key={source.path} className="flex items-center gap-1 text-2xs text-success"><Check className="h-3 w-3" />Take {i + 1} saved · {formatClock(source.seconds)}</span>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 text-2xs text-ink-muted">
          <label className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" />
            <select aria-label="Camera" value={cameraId} disabled={busy} onChange={(e) => { setCameraId(e.target.value); void openDevices(e.target.value, micId) }}
              className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-ink">
              <option value="">Default camera</option>
              {cameras.map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Camera ${i + 1}`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" />
            <select aria-label="Microphone" value={micId} disabled={busy} onChange={(e) => { setMicId(e.target.value); void openDevices(cameraId, e.target.value) }}
              className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-ink">
              <option value="">Default microphone</option>
              {mics.map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}
            </select>
          </label>
        </div>
        <p className={cn('text-2xs text-ink-subtle', saved.length && 'text-ink-muted')}>
          {saved.length ? 'Your takes are saved in “My recordings” in your output folder and added to this edit.' : 'Each take is saved in “My recordings” in your output folder.'}
        </p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
