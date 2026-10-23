import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Circle, Image as ImageIcon, MonitorPlay, Plus, X } from 'lucide-react'
import { formatSeconds } from '../../shared/pause-react'
import {
  MAX_CIRCLES, MAX_PROOFS, PROOF_LABELS, proofStarts, type HighlightRect, type LayoutExtrasPatch, type LayoutExtrasView, type ProofShot, type ScreenCircle
} from '../../shared/remix-layouts'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

interface SectionProps {
  view: LayoutExtrasView
  busy: boolean
  onView: (view: LayoutExtrasView) => void
  onError: (message: string | null) => void
  setBusy: (busy: boolean) => void
}

async function act(props: SectionProps, work: () => Promise<LayoutExtrasView | null>, fallback: string): Promise<void> {
  props.setBusy(true); props.onError(null)
  try { const next = await work(); if (next) props.onView(next) } catch (err) { props.onError(errorMessage(err, fallback)) } finally { props.setBusy(false) }
}

const change = (props: SectionProps, patch: LayoutExtrasPatch): Promise<void> => act(props, () => getApi().remix.setLayout(patch), 'It could not be changed.')

/**
 * React, then my thoughts, part 2: you on camera, or your voice over a screen recording (phone or computer) with the
 * "Comment KEYWORD" banner pinned at the top and red circles where you click on the recording.
 */
export function Part2Look(props: SectionProps & { step: number }): React.JSX.Element {
  const { view, busy } = props
  const screen = view.part2 === 'screen'
  const video = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  // A click on the recording drops a circle there, at the time it's paused or playing at.
  const mark = (event: React.MouseEvent<HTMLVideoElement>): void => {
    const el = video.current
    if (!el || busy || view.circles.length >= MAX_CIRCLES || !el.videoWidth) return
    event.preventDefault()
    const box = el.getBoundingClientRect()
    const scale = Math.min(box.width / el.videoWidth, box.height / el.videoHeight)
    const w = el.videoWidth * scale, h = el.videoHeight * scale
    const x = (event.clientX - box.left - (box.width - w) / 2) / w, y = (event.clientY - box.top - (box.height - h) / 2) / h
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    void change(props, { circles: [...view.circles, { at: Math.round(el.currentTime * 10) / 10, x, y }] })
  }
  const showing = (circle: ScreenCircle): boolean => now >= circle.at && now < circle.at + 2
  return (
    <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="How part 2 looks">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><MonitorPlay className="h-4 w-4" />{props.step} · How part 2 looks</h3>
      <Segmented label="How part 2 looks" size="sm" value={screen ? 'screen' : 'camera'}
        onChange={(value) => value === 'screen' && !view.screen
          ? void act(props, () => getApi().remix.addScreenRecording(), 'That screen recording could not be used.')
          : void change(props, { part2: value })}
        options={[{ value: 'camera', label: 'Me on camera' }, { value: 'screen', label: 'Voiceover over a screen recording' }]} />
      <p className="text-2xs text-ink-muted">{screen
        ? 'Your screen recording fills the screen and your voice from part 2 plays over it (your camera picture isn’t used). Click on the recording to circle something at that moment.'
        : 'You fill the screen while you talk. Showing how to do something? Use a screen recording from your phone or computer instead.'}</p>
      {screen && view.screen && (
        <div className="space-y-2">
          <div className="relative w-full max-w-xs">
            <video ref={video} src={localFileUrl(view.screen.path)} controls preload="metadata" aria-label="Your screen recording, click to circle"
              className="aspect-[9/16] w-full cursor-crosshair rounded-xl bg-black object-contain" onClick={mark} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
            {view.circles.filter(showing).map((circle, i) => <CircleMark key={i} circle={circle} el={video.current} />)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-ink" title={view.screen.name}>{view.screen.name}</span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(props, () => getApi().remix.addScreenRecording(), 'That screen recording could not be used.')}>Choose another</Button>
            <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} disabled={busy}
              onClick={() => void act(props, () => getApi().remix.removeLayoutItem(view.screen?.id ?? ''), 'It could not be removed.')}>Remove</Button>
          </div>
          {view.circles.length > 0 && (
            <ol className="flex flex-wrap gap-1.5" aria-label="Circles">
              {view.circles.map((circle, i) => (
                <li key={`${circle.at}-${i}`} className="flex items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pl-2 pr-1 text-2xs text-ink-muted">
                  <Circle className="h-3 w-3 text-danger" />{formatSeconds(circle.at)}
                  <button type="button" className="rounded-full p-0.5 hover:bg-white/10" aria-label={`Remove the circle at ${formatSeconds(circle.at)}`} disabled={busy}
                    onClick={() => void change(props, { circles: view.circles.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {view.keyword ? (
        <SettingRow title={`Pin “Comment ${view.keyword}” at the top`} description="It stays at the top the whole time you talk, so viewers know what to comment."
          control={<Switch label={`Pin “Comment ${view.keyword}” at the top`} checked={view.banner} disabled={busy} onChange={(on) => void change(props, { banner: on })} />} />
      ) : <p className="text-2xs text-ink-subtle">Add a comment keyword (under Look &amp; call to action) to pin “Comment KEYWORD” at the top while you talk.</p>}
    </section>
  )
}

/** A circle on the preview, where it was marked (the recording is shown whole inside the player). */
function CircleMark({ circle, el }: { circle: ScreenCircle; el: HTMLVideoElement | null }): React.JSX.Element | null {
  if (!el?.videoWidth) return null
  const scale = Math.min(el.clientWidth / el.videoWidth, el.clientHeight / el.videoHeight)
  const w = el.videoWidth * scale, h = el.videoHeight * scale
  const left = (el.clientWidth - w) / 2 + circle.x * w, top = (el.clientHeight - h) / 2 + circle.y * h
  return <span aria-hidden="true" className="pointer-events-none absolute h-8 w-12 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px] border-red-500" style={{ left, top }} />
}

/** Proof screenshots in part 2: up to six, each popping in at its time with an optional label and highlight box. */
export function ProofScreenshots(props: SectionProps & { step: number; takeSeconds: number | null }): React.JSX.Element {
  const { view, busy } = props
  const starts = proofStarts(view.proofs, props.takeSeconds)
  const full = view.proofs.length >= MAX_PROOFS
  const save = (proofs: ProofShot[]): Promise<void> => change(props, { proofs: proofs.map(({ id, at, label, highlight }) => ({ id, at, label, highlight })) })
  const update = (index: number, patch: Partial<ProofShot>): void => { void save(view.proofs.map((proof, i) => i === index ? { ...proof, ...patch } : proof)) }
  return (
    <section className="glass-tile space-y-3 rounded-2xl p-4" aria-label="Proof screenshots">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><ImageIcon className="h-4 w-4" />{props.step} · Proof screenshots (optional)</h3>
      <p className="text-2xs text-ink-muted">Show your posts or results while you talk: each one pops into the lower half for a few seconds. Leave the time empty to spread them out. Drag on a picture to box the part that matters.</p>
      {view.proofs.length > 0 && (
        <ul className="space-y-2" aria-label="Your proof screenshots">
          {view.proofs.map((proof, i) => (
            <li key={proof.id} className="flex flex-wrap items-start gap-3 rounded-lg bg-white/[0.04] p-2">
              <HighlightPicker src={localFileUrl(proof.path)} name={proof.name} value={proof.highlight} disabled={busy} onChange={(highlight) => update(i, { highlight })} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-xs text-ink" title={proof.name}>{proof.name}</p>
                <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-muted">
                  <label className="flex items-center gap-1">At
                    <input type="number" min={0} step={0.5} inputMode="decimal" aria-label={`Time for ${proof.name}`} disabled={busy}
                      placeholder={starts[i] !== null ? String(starts[i]) : 'auto'} defaultValue={proof.at ?? ''} key={`${proof.id}-${proof.at}`}
                      onBlur={(e) => { const value = e.target.value.trim(); const at = value === '' ? null : Number(value); if (at === null || Number.isFinite(at)) { if (at !== proof.at) update(i, { at }) } }}
                      className="w-16 rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-ink" />
                    s into your take{proof.at === null ? ' (auto)' : ''}
                  </label>
                  <select aria-label={`Label for ${proof.name}`} value={proof.label} disabled={busy} onChange={(e) => update(i, { label: e.target.value })}
                    className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-ink">
                    <option value="">No label</option>
                    {PROOF_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
                  </select>
                  {proof.highlight && <button type="button" className="text-accent hover:underline" disabled={busy} onClick={() => update(i, { highlight: null })}>Clear box</button>}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} disabled={busy} aria-label={`Remove ${proof.name}`}
                onClick={() => void act(props, () => getApi().remix.removeLayoutItem(proof.id), 'It could not be removed.')}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={busy || full}
          onClick={() => void act(props, () => getApi().remix.addProofs(), 'Those screenshots could not be added.')}>Add screenshots</Button>
        <span className="text-2xs text-ink-subtle">{full ? `That’s ${MAX_PROOFS}, the most for one video.` : `Up to ${MAX_PROOFS}: JPG, PNG or WebP.`}</span>
      </div>
    </section>
  )
}

/** A screenshot thumbnail you drag on to draw the highlight box (0..1 of the picture). */
export function HighlightPicker({ src, name, value, disabled, onChange, className = 'w-24', label = 'drag to box the part that matters' }: {
  src: string; name: string; value: HighlightRect | null; disabled: boolean; onChange: (rect: HighlightRect | null) => void
  /** Its size (default: a small thumbnail). */
  className?: string
  /** What dragging does, for its name and tooltip. */
  label?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState<HighlightRect | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const point = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) }
  }
  const rect = (a: { x: number; y: number }, b: { x: number; y: number }): HighlightRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
  const shown = draft ?? value
  return (
    <div role="img" aria-label={`${name}: ${label}`} title={label.charAt(0).toUpperCase() + label.slice(1)}
      className={cn('relative shrink-0 touch-none select-none', className, 'overflow-hidden rounded-md bg-black', disabled ? 'opacity-60' : 'cursor-crosshair')}
      onPointerDown={(e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = point(e); setDraft(null) }}
      onPointerMove={(e) => { if (start.current) setDraft(rect(start.current, point(e))) }}
      onPointerUp={(e) => {
        if (!start.current) return
        const box = rect(start.current, point(e))
        start.current = null; setDraft(null)
        if (box.w >= 0.02 && box.h >= 0.02) onChange(box)
      }}>
      <img src={src} alt="" draggable={false} className="block w-full" />
      {shown && <span aria-hidden="true" className="pointer-events-none absolute border-2 border-red-500 bg-red-500/10"
        style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }} />}
    </div>
  )
}
