/**
 * The Scenes row on the clip editor's timeline (vertical clips): stretches where
 * the clip switches from the normal full-frame video (Face) to a Stage (a
 * backdrop with the speaker in a card at the bottom, the top free for graphics)
 * or a Visual (backdrop only). Scenes sit at source time like the graphics and
 * edit `candidate.stage_scenes` through the editor's `change()` (undo, redo and
 * autosave like any other edit). Any time without a scene is Face.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Clapperboard, Plus, Trash2 } from 'lucide-react'
import type { CandidateEdit } from '../../shared/clip-editor'
import {
  BACKDROP_LABELS, MAX_SCENES, MIN_SCENE_MS, SCENE_DETAILS, SCENE_LABELS, STAGE_LAYOUT, newSceneAt, outputScenes, sceneMix, updateScene, withScene,
  type SceneBackdrop, type SceneKind, type StageScene
} from '../../shared/scenes'
import { nearestOutputTime } from '../../shared/motion-graphics'
import { isHexColor } from '../../shared/headline-look'
import { cn } from '../lib/utils'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import './clip-scenes.css'

export function ScenesTrack({ candidate, viewStart, viewEnd, time, disabled, onChange, onDrag, clock }: {
  candidate: CandidateEdit; viewStart: number; viewEnd: number
  /** The playhead, source ms. */
  time: number; disabled: boolean
  onChange: (scenes: StageScene[], remember: boolean) => void
  /** A drag starts or ends (the editor holds the timeline's zoom and autosave meanwhile). */
  onDrag: (active: boolean) => void
  clock: (ms: number) => string
}): React.JSX.Element {
  const scenes = candidate.stage_scenes ?? []
  const [selected, setSelected] = useState<number | null>(null)
  const span = viewEnd - viewStart
  const bounds = { start: candidate.ranges[0][0], end: candidate.ranges[candidate.ranges.length - 1][1] }
  const current = selected !== null ? scenes[selected] ?? null : null
  const draft = newSceneAt(scenes, time, bounds)
  const add = (): void => {
    if (!draft) return
    const next = withScene(scenes, draft)
    onChange(next, true)
    setSelected(next.indexOf(draft))
  }
  const remove = (index: number): void => { onChange(scenes.filter((_, i) => i !== index), true); setSelected(null) }
  const startDrag = (e: React.PointerEvent<HTMLElement>, index: number, mode: 'move' | 'start' | 'end'): void => {
    if (disabled || e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const target = e.currentTarget, track = target.closest('.editor-scenes-track')!.getBoundingClientRect(), x = e.clientX
    const s = scenes[index]
    let moved = false
    target.setPointerCapture(e.pointerId)
    setSelected(index); onDrag(true)
    const move = (event: PointerEvent): void => {
      if (!moved && Math.abs(event.clientX - x) < 3) return
      const dt = Math.round((event.clientX - x) / track.width * span)
      const patch = mode === 'move' ? { start_ms: s.start_ms + dt, end_ms: s.end_ms + dt } : mode === 'start' ? { start_ms: s.start_ms + dt } : { end_ms: s.end_ms + dt }
      onChange(updateScene(scenes, index, patch, bounds), !moved)
      moved = true
    }
    const done = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', done); onDrag(false) }
    target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', done)
  }
  const nudge = (e: React.KeyboardEvent, index: number): void => {
    if (disabled) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(index); return }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault(); e.stopPropagation()
    const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1000 : 100), s = scenes[index]
    onChange(updateScene(scenes, index, { start_ms: s.start_ms + step, end_ms: s.end_ms + step }, bounds), true)
  }
  const pick = (scene: SceneKind): void => {
    if (selected === null || !current) return
    // Face is the normal video: choosing it takes the scene away.
    if (scene === 'face') { remove(selected); return }
    onChange(updateScene(scenes, selected, { scene }, bounds), true)
  }
  const full = scenes.length >= MAX_SCENES
  return <div className="editor-scenes-row">
    <div className="editor-scenes-label"><Clapperboard size={12} aria-hidden /><span>Scenes</span>
      {current && <div className="editor-scenes-tools" role="group" aria-label="Selected scene">
        <Segmented<SceneKind> label="Scene" size="sm" value={current.scene} onChange={pick}
          options={(['face', 'stage', 'visual'] as const).map((value) => ({ value, label: SCENE_LABELS[value], ...(disabled ? { disabled: 'Editing is off right now.' } : {}) }))} />
        <Segmented<SceneBackdrop> label="Backdrop" size="sm" value={current.backdrop ?? 'light'}
          onChange={(backdrop) => onChange(updateScene(scenes, selected!, { backdrop }, bounds), true)}
          options={(['light', 'dark', 'brand'] as const).map((value) => ({ value, label: BACKDROP_LABELS[value], ...(disabled ? { disabled: 'Editing is off right now.' } : {}) }))} />
        <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={12} />} aria-label="Remove scene" tooltip="Remove this scene. That part goes back to the normal full-frame video." disabled={disabled} onClick={() => remove(selected!)} />
      </div>}
      <Button size="sm" variant="ghost" icon={<Plus size={12} />} disabled={disabled || full || !draft} onClick={add}
        tooltip={full ? `A clip can have up to ${MAX_SCENES} scenes.` : !draft ? `There’s no room at the playhead. A scene needs ${MIN_SCENE_MS / 1000} seconds of the clip that has no other scene.` : 'Add a Stage scene at the playhead: a backdrop with you in a card at the bottom, so a graphic has room at the top.'}>Add scene at playhead</Button></div>
    <div className="editor-scenes-track" aria-label="Scenes">
      {scenes.map((s, i) => {
        const a = Math.max(s.start_ms, viewStart), b = Math.min(s.end_ms, viewEnd)
        if (b <= a) return null
        const label = `${SCENE_LABELS[s.scene]} scene${s.scene !== 'face' ? `, ${BACKDROP_LABELS[s.backdrop ?? 'light'].toLowerCase()} backdrop,` : ''} from ${clock(s.start_ms)} to ${clock(s.end_ms)}`
        return <div key={`${i}-${s.start_ms}`} className={cn('editor-scene-block', `scene-${s.scene}`, `backdrop-${s.backdrop ?? 'light'}`, selected === i && 'selected')}
          style={{ left: `${(a - viewStart) / span * 100}%`, width: `${(b - a) / span * 100}%` }}>
          <button className="editor-scene-edge" aria-label={`Change when the ${label} starts`} disabled={disabled} onPointerDown={(e) => startDrag(e, i, 'start')} tabIndex={-1} />
          <button className="editor-scene-body" aria-label={label} aria-pressed={selected === i}
            title={`${label} · ${SCENE_DETAILS[s.scene]} Drag to move · Drag an edge to change its length · Delete removes it`}
            onPointerDown={(e) => startDrag(e, i, 'move')} onClick={() => setSelected(i)} onKeyDown={(e) => nudge(e, i)}>
            <span className="editor-scene-kind">{SCENE_LABELS[s.scene]}</span>{s.scene !== 'face' && <span className="editor-scene-backdrop">{BACKDROP_LABELS[s.backdrop ?? 'light']}</span>}
          </button>
          <button className="editor-scene-edge" aria-label={`Change when the ${label} ends`} disabled={disabled} onPointerDown={(e) => startDrag(e, i, 'end')} tabIndex={-1} />
        </div>
      })}
      {!scenes.length && <span className="editor-scenes-empty">Face throughout. Add a Stage scene to give a graphic room.</span>}
    </div>
  </div>
}

const BACKDROP_CSS: Record<SceneBackdrop, (brand: string) => string> = {
  light: () => 'linear-gradient(#f6f7f9, #e2e5ea)',
  dark: () => 'linear-gradient(#2b2e34, #15171b)',
  brand: (c) => `linear-gradient(color-mix(in srgb, ${c} 10%, white), color-mix(in srgb, ${c} 24%, white))`
}

/** A preview of the scenes over the Output monitor: the backdrop and the speaker card (cut from the preview's own frame). */
export function ScenesOverlay({ canvas, candidate, time }: { canvas: RefObject<HTMLCanvasElement | null>; candidate: CandidateEdit; time: number }): React.JSX.Element | null {
  const [bounds, setBounds] = useState({ width: 0, height: 0, left: 0, top: 0 })
  const card = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current, parent = element?.parentElement
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
  const scenes = outputScenes(candidate)
  const mix = sceneMix(scenes, nearestOutputTime(candidate, time))
  const visible = !!scenes.length && (mix.alpha > 0 || mix.card > 0)
  useEffect(() => {
    if (!visible) return
    let frame = 0
    const draw = (): void => {
      const source = canvas.current, target = card.current
      if (source && target) {
        // The card shows the speaker's face from the preview frame (the export frames it a little wider).
        const sw = source.width, sh = Math.round(sw * target.height / target.width), sy = Math.max(0, Math.min(source.height - sh, source.height * 0.36 - sh * 0.42))
        target.getContext('2d')?.drawImage(source, 0, sy, sw, sh, 0, 0, target.width, target.height)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [visible, canvas])
  if (!bounds.width || !visible) return null
  const brand = candidate.hook?.look.look === 'brand' && isHexColor(candidate.hook.look.color) ? candidate.hook.look.color : '#3B6BFF'
  const w = bounds.width, h = bounds.height
  const cardW = w * (1 - 2 * STAGE_LAYOUT.cardSide), cardH = h * STAGE_LAYOUT.cardHeight
  const rest = h * (1 - STAGE_LAYOUT.cardBottom) - cardH, off = h + 8
  return <div className="editor-scenes-overlay" style={bounds} aria-hidden data-scene={mix.card > 0.5 ? 'stage' : mix.alpha > 0.5 ? 'visual' : 'face'}>
    {mix.under && <div className="editor-scenes-backdrop" style={{ background: BACKDROP_CSS[mix.under](brand) }} />}
    {mix.backdrop && <div className="editor-scenes-backdrop" style={{ background: BACKDROP_CSS[mix.backdrop](brand), opacity: mix.alpha }} />}
    <canvas ref={card} className="editor-scenes-card" width={360} height={Math.round(360 * cardH / cardW)}
      style={{ width: cardW, height: cardH, left: (w - cardW) / 2, top: off - (off - rest) * mix.card, borderRadius: w * STAGE_LAYOUT.cardRadius, visibility: mix.card > 0 ? 'visible' : 'hidden' }} />
  </div>
}
