import { useEffect, useState } from 'react'
import { Loader2, Minus, MonitorPlay, Play, Plus, X } from 'lucide-react'
import { formatClock } from '../../shared/edit-recording'
import {
  MAX_SCREEN_OFFSET_MS, SCREEN_KIND_HINTS, SCREEN_KIND_LABELS, SCREEN_SPLIT, offsetWords, screenOverlap, syncWords,
  type ScreenChoice, type ScreenSource, type ScreenStyle, type ScreenSync
} from '../../shared/screen-pair'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { ScreenLayoutGlyph } from './ScreenLayouts'
import { Button } from './ui/Button'
import { onRadioKeyDown } from './ui/Segmented'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

/** The screen recording added on Edit my recording, and how it lines up with the camera. */
export interface ScreenPick { source: ScreenSource; sync: ScreenSync | null; offsetMs: number }

/** How far either way the slider nudges from where the recordings were lined up. */
const NUDGE_MS = 10_000

/**
 * "+ Add a screen recording": a screen recording made at the same time as the camera recording (QuickTime, Loom,
 * OBS…). It's lined up with the camera by sound (or by when each file was made), and the member can nudge it while
 * watching a few seconds of both side by side.
 */
export function ScreenRecordingPicker({ camera, value, onChange, onError, disabledReason }: {
  camera: { path: string; seconds: number } | null
  value: ScreenPick | null
  onChange: (value: ScreenPick | null) => void
  onError: (message: string | null) => void
  disabledReason: string | null
}): React.JSX.Element {
  const [syncing, setSyncing] = useState(false)
  const [preview, setPreview] = useState<{ path: string; offsetMs: number } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [moment, setMoment] = useState<number | null>(null)

  // Line up again when the camera recording changes.
  useEffect(() => {
    if (!value || !camera) return
    if (value.sync && Math.abs(value.sync.cameraSeconds - camera.seconds) < 0.05) return
    void line(value.source)
  }, [camera?.path])

  const line = async (source: ScreenSource): Promise<void> => {
    if (!camera) return
    setSyncing(true); setPreview(null); onError(null)
    onChange({ source, sync: null, offsetMs: 0 })
    try {
      const sync = await getApi().edit.syncScreen(camera.path, source.path)
      onChange({ source, sync, offsetMs: sync.offsetMs })
    } catch (err) { onError(errorMessage(err, 'Your recordings could not be lined up.')) } finally { setSyncing(false) }
  }

  const choose = async (): Promise<void> => {
    onError(null)
    try {
      const source = await getApi().edit.chooseScreen()
      if (source) await line(source)
    } catch (err) { onError(errorMessage(err)) }
  }

  if (!value) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="screen-add">
        <Button variant="secondary" icon={<MonitorPlay className="h-4 w-4" />} disabled={Boolean(disabledReason)} onClick={() => void choose()}>+ Add a screen recording</Button>
        <span className="text-2xs text-ink-subtle">{disabledReason ?? 'Recorded your screen at the same time? Add it for a demo reel: your screen on top, you below, captions on the line between.'}</span>
      </div>
    )
  }

  const sync = value.sync
  const overlap = sync ? screenOverlap(value.offsetMs, sync.cameraSeconds, sync.screenSeconds) : null
  const base = sync?.offsetMs ?? 0
  const min = Math.max(-MAX_SCREEN_OFFSET_MS, base - NUDGE_MS), max = Math.min(MAX_SCREEN_OFFSET_MS, base + NUDGE_MS)
  const setOffset = (offsetMs: number): void => onChange({ ...value, offsetMs: Math.round(Math.max(min, Math.min(max, offsetMs))) })
  const at = overlap ? Math.round(moment ?? (overlap[0] + overlap[1]) / 2 - 3000) : 0
  const show = async (): Promise<void> => {
    if (!camera || !overlap) return
    setPreviewing(true); onError(null)
    try { setPreview({ path: await getApi().edit.previewScreen(camera.path, value.source.path, value.offsetMs, Math.max(0, at)), offsetMs: value.offsetMs }) }
    catch (err) { onError(errorMessage(err, 'The preview could not be made.')) } finally { setPreviewing(false) }
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-white/10 p-3" data-testid="screen-recording">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink"><MonitorPlay className="h-4 w-4 shrink-0 text-accent" aria-hidden /><span className="truncate">Screen recording · {value.source.name}</span></span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-2xs tabular text-ink-muted">{formatClock(value.source.seconds)}</span>
          <Button size="sm" variant="ghost" aria-label="Remove the screen recording" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setPreview(null); onChange(null) }} />
        </span>
      </div>
      {syncing && <p className="flex items-center gap-1.5 text-xs text-ink-muted" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Lining up your recordings by sound…</p>}
      {sync && (
        <>
          <p className="text-xs text-ink-muted" data-testid="screen-sync">{syncWords(sync)}</p>
          <div className="space-y-1">
            <label className="editor-label block text-xs text-ink-muted">Line up <span className="float-right font-mono tabular" data-testid="screen-offset">Screen {offsetWords(value.offsetMs)}</span>
              <input className="mt-1 w-full" aria-label="Screen recording offset" type="range" min={min} max={max} step={10} value={value.offsetMs}
                onChange={(e) => setOffset(Number(e.target.value))} />
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="ghost" icon={<Minus className="h-3.5 w-3.5" />} onClick={() => setOffset(value.offsetMs - 100)}>0.1 s earlier</Button>
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOffset(value.offsetMs + 100)}>0.1 s later</Button>
              {value.offsetMs !== sync.offsetMs && <Button size="sm" variant="ghost" onClick={() => setOffset(sync.offsetMs)}>Back to {sync.method === 'audio' ? 'the sound match' : 'where it started'}</Button>}
            </div>
          </div>
          {overlap ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} loading={previewing} onClick={() => void show()}>Preview the sync</Button>
                <label className="flex items-center gap-2 text-2xs text-ink-subtle">From
                  <input aria-label="Preview from" type="range" min={overlap[0]} max={Math.max(overlap[0], overlap[1] - 6000)} step={500} value={Math.max(overlap[0], Math.min(overlap[1], at))}
                    onChange={(e) => setMoment(Number(e.target.value))} />
                  <span className="font-mono tabular">{formatClock(Math.max(0, at) / 1000)}</span>
                </label>
              </div>
              {preview && (
                <figure>
                  <video key={preview.path} src={localFileUrl(preview.path)} controls autoPlay playsInline className="w-full max-w-md rounded-lg bg-black" aria-label="Sync preview" />
                  <figcaption className="mt-1 text-2xs text-ink-subtle">
                    {preview.offsetMs !== value.offsetMs ? 'You moved the slider: preview again to check.' : sync.screenAudio ? 'Your camera’s sound, with your screen recording’s sound quieter under it. An echo means they’re off: nudge until it’s gone and what you click matches what you say.' : 'Check that what you click matches what you say.'}
                  </figcaption>
                </figure>
              )}
              <p className="text-2xs text-ink-subtle">They play together for {formatClock((overlap[1] - overlap[0]) / 1000)}. What you say before or after that starts out cut.</p>
            </div>
          ) : <p className="text-2xs text-danger">At this offset your screen recording doesn’t overlap your camera recording. Move the slider back.</p>}
        </>
      )}
    </div>
  )
}

const STYLE_ORDER: ScreenStyle[] = ['screen_top', 'face_top', 'bubble']

/** The review's "Your screen" choices: the reel's main layout, the screen's size, fit or fill, the slow zoom and the per-part picks. */
export function ScreenChoicePanel({ value, onChange, disabled }: { value: ScreenChoice; onChange: (value: ScreenChoice) => void; disabled?: boolean }): React.JSX.Element {
  const split = value.style !== 'bubble'
  return (
    <section className="mt-5 space-y-3" aria-labelledby="edit-screen-title" data-testid="edit-screen">
      <div>
        <h3 id="edit-screen-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><MonitorPlay className="h-4 w-4" aria-hidden />Your screen and you</h3>
        <p className="text-2xs text-ink-subtle">How your screen recording and your camera share the frame. You can switch any part afterward in the clip editor.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Main layout">
        {STYLE_ORDER.map((style) => {
          const selected = value.style === style
          return (
            <button key={style} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown} disabled={disabled}
              onClick={() => onChange({ ...value, style })}
              className={cn('glass-tile glass-tile-hover flex items-center gap-2.5 rounded-xl px-3 py-2 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <ScreenLayoutGlyph kind={style} />
              <span><span className="block text-xs font-medium">{SCREEN_KIND_LABELS[style]}</span><span className="block text-2xs text-ink-subtle">{SCREEN_KIND_HINTS[style]}</span></span>
            </button>
          )
        })}
      </div>
      {split && (
        <label className="block text-xs text-ink-muted">Screen size <span className="float-right tabular">{Math.round(value.split * 100)}% of the height</span>
          <input className="mt-1 w-full" aria-label="Screen size" type="range" min={SCREEN_SPLIT.min * 100} max={SCREEN_SPLIT.max * 100} step={1} value={Math.round(value.split * 100)} disabled={disabled}
            onChange={(e) => onChange({ ...value, split: Number(e.target.value) / 100 })} />
        </label>
      )}
      {split && (
        <SettingRow title="Show all of your screen" description={value.fit === 'fit' ? 'All of your screen shows, with a blurred copy of it around the edges.' : 'Your screen fills its part of the frame; its sides are cut off.'}
          control={<Switch label="Show all of your screen" checked={value.fit === 'fit'} disabled={disabled} onChange={(on) => onChange({ ...value, fit: on ? 'fit' : 'cover' })} />} />
      )}
      {split && (
        <SettingRow title="Slow zoom on your screen" description="Eases in on the part of your screen that changes, when that’s a small part of it."
          control={<Switch label="Slow zoom on your screen" checked={value.zoom} disabled={disabled} onChange={(zoom) => onChange({ ...value, zoom })} />} />
      )}
      <SettingRow title="Pick a layout for each part" description="Just you for your hook and your call to action, and just your screen while it changes a lot and you talk about what’s on it. Off: the same layout all the way through."
        control={<Switch label="Pick a layout for each part" checked={value.auto} disabled={disabled} onChange={(auto) => onChange({ ...value, auto })} />} />
    </section>
  )
}
