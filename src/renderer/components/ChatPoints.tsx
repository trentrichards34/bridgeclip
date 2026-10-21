/**
 * "Point at the preview" for the chat panels: a Point button, the layer over a
 * preview that takes the click (a pin) or drag (a box) and shows the pins, the
 * pins as chips above the message box, and a small frame to point on where a
 * place has no live preview (the review screens). Pins are kept per chat
 * thread in use-chat-points-store and go with the next message.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Crosshair, MapPin, X } from 'lucide-react'
import { MAX_CHAT_POINTS, MIN_POINT_BOX, pointLabel, type ChatPoint } from '../../shared/chat-point'
import { useChatPointsStore, useThreadPoints } from '../store/use-chat-points-store'
import { cn, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'

/** Shown and announced while a preview waits for a click. */
export const POINT_PROMPT = 'Click the video to point'

/** The Point button: turns pointing on or off for a thread. `onStart`: what the place does first (pause, open the Chat tab). */
export function PointButton({ thread, disabled, onStart }: { thread: string; disabled?: boolean; onStart?: () => void }): React.JSX.Element {
  const pointing = useChatPointsStore((s) => s.pointing === thread)
  const setPointing = useChatPointsStore((s) => s.setPointing)
  const full = useThreadPoints(thread).length >= MAX_CHAT_POINTS
  return <Button size="sm" variant={pointing ? 'primary' : 'ghost'} icon={<Crosshair size={13} aria-hidden />} aria-pressed={pointing}
    disabled={!pointing && (disabled || full)}
    tooltip={full && !pointing ? `You can use up to ${MAX_CHAT_POINTS} pins. Send your message or remove one first.` : pointing ? 'Click or drag on the video. Esc cancels.' : 'Point at a spot on the video (click), or drag a box, then ask about it in the chat.'}
    onClick={() => { if (pointing) setPointing(null); else { onStart?.(); setPointing(thread) } }}>Point</Button>
}

/** Where a canvas's picture sits inside its parent (it keeps its width:height ratio inside its box). */
function useCanvasBounds(canvas: RefObject<HTMLCanvasElement | null> | undefined): { width: number; height: number; left: number; top: number } | null {
  const [bounds, setBounds] = useState<{ width: number; height: number; left: number; top: number } | null>(null)
  useEffect(() => {
    const element = canvas?.current, parent = element?.parentElement
    if (!element || !parent) return
    const measure = (): void => {
      const box = element.getBoundingClientRect(), outer = parent.getBoundingClientRect()
      const aspect = element.width / element.height
      const width = Math.min(box.width, box.height * aspect), height = width / aspect
      setBounds({ width, height, left: box.left - outer.left + (box.width - width) / 2, top: box.top - outer.top + (box.height - height) / 2 })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); observer.observe(parent); measure()
    return () => observer.disconnect()
  }, [canvas])
  return bounds
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n))

/**
 * The layer over a preview: shows the thread's pins and, while pointing, takes
 * a click (a pin) or a drag (a box). `canvas`: the preview canvas it covers
 * (absent: it fills its parent). `outMs`: the output time a pin is made at.
 */
export function PointLayer({ thread, canvas, outMs }: { thread: string; canvas?: RefObject<HTMLCanvasElement | null>; outMs: () => number | null }): React.JSX.Element | null {
  const points = useThreadPoints(thread)
  const active = useChatPointsStore((s) => s.pointing === thread)
  const { add, setPointing } = useChatPointsStore.getState()
  const bounds = useCanvasBounds(canvas)
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null)
  const layer = useRef<HTMLDivElement>(null)

  // Esc cancels pointing before the page's own shortcuts see it.
  useEffect(() => {
    if (!active) return
    const cancel = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDrag(null); setPointing(null) } }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [active, setPointing])
  useEffect(() => { if (!active) setDrag(null) }, [active])

  if (canvas && !bounds) return null
  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const box = layer.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - box.left) / box.width), y: clamp((e.clientY - box.top) / box.height) }
  }
  const finish = (d: { x: number; y: number; x2: number; y2: number }): void => {
    const x = Math.min(d.x, d.x2), y = Math.min(d.y, d.y2), w = Math.abs(d.x2 - d.x), h = Math.abs(d.y2 - d.y)
    const out = outMs()
    add(thread, w < MIN_POINT_BOX && h < MIN_POINT_BOX ? { x: d.x, y: d.y, out_ms: out } : { x, y, w: Math.max(w, MIN_POINT_BOX), h: Math.max(h, MIN_POINT_BOX), out_ms: out })
    setDrag(null); setPointing(null)
  }
  const shown = drag ? { left: Math.min(drag.x, drag.x2), top: Math.min(drag.y, drag.y2), width: Math.abs(drag.x2 - drag.x), height: Math.abs(drag.y2 - drag.y) } : null
  return <div ref={layer} className={cn('chat-point-layer', active && 'pointing')} style={bounds ?? undefined} data-testid="point-layer"
    aria-label={active ? `${POINT_PROMPT}. Drag to draw a box. Esc cancels.` : undefined} role={active ? 'application' : undefined}
    onPointerDown={(e) => {
      if (!active || e.button !== 0) return
      e.preventDefault(); e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      const p = at(e)
      setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y })
    }}
    onPointerMove={(e) => { if (drag) { const p = at(e); setDrag({ ...drag, x2: p.x, y2: p.y }) } }}
    onPointerUp={(e) => { if (drag) { const p = at(e); finish({ ...drag, x2: p.x, y2: p.y }) } }}
    onPointerCancel={() => setDrag(null)}>
    <span role="status" className="sr-only">{active ? `${POINT_PROMPT}. Drag to draw a box. Esc cancels.` : ''}</span>
    {active && !drag && <span className="chat-point-prompt" aria-hidden>{POINT_PROMPT}</span>}
    {points.map((p) => <PointMarker key={p.n} point={p} />)}
    {shown && shown.width + shown.height > MIN_POINT_BOX && <div className="chat-point-box drawing" style={{ left: `${shown.left * 100}%`, top: `${shown.top * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }} />}
  </div>
}

function PointMarker({ point: p }: { point: ChatPoint }): React.JSX.Element {
  const label = `Pin ${p.n}, ${pointLabel(p)}`
  if (p.w !== undefined && p.h !== undefined) {
    return <div className="chat-point-box" title={label} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, height: `${p.h * 100}%` }}>
      <span className="chat-point-pin" aria-hidden>{p.n}</span>
    </div>
  }
  return <span className="chat-point-pin at" title={label} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-hidden>{p.n}</span>
}

/** The pins as chips over the message box ("Pin 1 · at 0:12, top-left"), each with a remove button. */
export function PointChips({ thread }: { thread: string }): React.JSX.Element | null {
  const points = useThreadPoints(thread)
  const remove = useChatPointsStore((s) => s.remove)
  if (!points.length) return null
  return <ul className="chat-point-chips" aria-label="Pins for your next message">
    {points.map((p) => <li key={p.n}>
      <MapPin size={11} aria-hidden /><span>Pin {p.n} · {pointLabel(p)}</span>
      <button type="button" aria-label={`Remove pin ${p.n}`} onClick={() => remove(thread, p.n)}><X size={10} aria-hidden /></button>
    </li>)}
  </ul>
}

/**
 * A still of `video` at `seek` seconds (a faint grid when there is no video or
 * it can't be read). The time is set once the video's length is known, not as
 * a #t= fragment: the local-file protocol refuses URLs with one.
 */
export function VideoStill({ video, seek = 0.1 }: { video?: string | null; seek?: number }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [video])
  if (!video || failed) return <div className="chat-point-pad-grid" aria-hidden />
  return <video key={video} src={localFileUrl(video)} muted preload="auto" playsInline aria-hidden data-testid="video-still"
    onError={() => setFailed(true)}
    onLoadedMetadata={(e) => {
      const length = e.currentTarget.duration
      e.currentTarget.currentTime = Number.isFinite(length) && length > 0 ? Math.min(Math.max(0, seek), Math.max(0, length - 0.05)) : Math.max(0, seek)
    }} />
}

/** A small vertical frame to point on, for a review screen with no live preview (a still of `video` at `seek` seconds when given). */
export function PointPad({ thread, video, seek }: { thread: string; video?: string | null; seek?: number }): React.JSX.Element {
  return <div className="chat-point-pad">
    <VideoStill video={video} seek={seek} />
    <PointLayer thread={thread} outMs={() => null} />
  </div>
}
