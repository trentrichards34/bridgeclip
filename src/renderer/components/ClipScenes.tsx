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
  BACKDROP_LABELS, CARD_LABELS, MAX_SCENES, SOLID_BACKDROP_COLOR, MIN_SCENE_MS, SCENE_BACKDROPS, SCENE_DETAILS, SCENE_LABELS, SCENE_TRANSITIONS, STAGE_LAYOUT, PREVIEW_CARD_SPAN, PREVIEW_CARD_TOP,
  TRANSITION_DETAILS, TRANSITION_LABELS, previewCard, newSceneAt, outputScenes, sceneEscapes, sceneMix, sceneMove, sceneTransition, updateScene, withScene,
  type SceneBackdrop, type SceneCard, type SceneKind, type SceneTransition, type StageScene
} from '../../shared/scenes'
import { nearestOutputTime } from '../../shared/motion-graphics'
import { isHexColor } from '../../shared/headline-look'
import { cn } from '../lib/utils'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { Select } from './ui/Select'
import { Switch } from './ui/Switch'
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
    <div className="editor-scenes-label editor-lane-head"><Clapperboard size={11} aria-hidden /><span className="editor-lane-name">Scenes</span>
      <Button size="sm" variant="ghost" iconOnly aria-label="Add scene at playhead" icon={<Plus size={13} />} disabled={disabled || full || !draft} onClick={add}
        tooltip={full ? `A clip can have up to ${MAX_SCENES} scenes.` : !draft ? `There’s no room at the playhead. A scene needs ${MIN_SCENE_MS / 1000} seconds of the clip that has no other scene.` : 'Add scene at playhead: a Stage scene, a backdrop with you in a card at the bottom, so a graphic has room at the top.'} /></div>
    {current && <div className="editor-scenes-tools" role="group" aria-label="Selected scene">
        <Segmented<SceneKind> label="Scene" size="sm" value={current.scene} onChange={pick}
          options={(['face', 'stage', 'visual'] as const).map((value) => ({ value, label: SCENE_LABELS[value], ...(disabled ? { disabled: 'Editing is off right now.' } : {}) }))} />
        <Select size="sm" aria-label="Backdrop" value={current.backdrop ?? 'light'} disabled={disabled}
          onChange={(backdrop) => onChange(updateScene(scenes, selected!, { backdrop: backdrop as SceneBackdrop }, bounds), true)}
          options={SCENE_BACKDROPS.map((value) => ({ value, label: BACKDROP_LABELS[value] }))} />
        {current.scene === 'stage' && <Segmented<SceneCard> label="Card" size="sm" value={current.card ?? 'rounded'}
          onChange={(card) => onChange(updateScene(scenes, selected!, { card }, bounds), true)}
          options={(['rounded', 'arch'] as const).map((value) => ({ value, label: CARD_LABELS[value], ...(disabled ? { disabled: 'Editing is off right now.' } : {}) }))} />}
        {current.scene === 'stage' && <span className="editor-scenes-switch" title="Your head and hair rise over the card's top edge. The export checks the cut-out first and keeps you inside the card when it isn't clean.">
          <span>Head out</span>
          <Switch label="Head breaks out of the card" checked={sceneEscapes(current)} disabled={disabled}
            onChange={(on) => onChange(updateScene(scenes, selected!, { escape: on ? undefined : false }, bounds), true)} /></span>}
        <Segmented<SceneTransition> label="Transition" size="sm" value={sceneTransition(current)}
          onChange={(transition) => onChange(updateScene(scenes, selected!, { transition }, bounds), true)}
          options={SCENE_TRANSITIONS.map((value) => ({ value, label: <span title={TRANSITION_DETAILS[value]}>{TRANSITION_LABELS[value]}</span>, ...(disabled ? { disabled: 'Editing is off right now.' } : {}) }))} />
        <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={12} />} aria-label="Remove scene" tooltip="Remove this scene. That part goes back to the normal full-frame video." disabled={disabled} onClick={() => remove(selected!)} />
      </div>}
    <div className="editor-scenes-track" aria-label="Scenes">
      {scenes.map((s, i) => {
        const a = Math.max(s.start_ms, viewStart), b = Math.min(s.end_ms, viewEnd)
        if (b <= a) return null
        const label = `${SCENE_LABELS[s.scene]} scene${s.scene !== 'face' ? `, ${BACKDROP_LABELS[s.backdrop ?? 'light'].toLowerCase()} backdrop${s.card === 'arch' ? ', arch card' : ''},` : ''} from ${clock(s.start_ms)} to ${clock(s.end_ms)}`
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

const bump = (p: number): number => p < .5 ? (p / .5) ** 2 : (1 - (p - .5) / .5) ** 2
/** The preview's version of a scene change's camera move: a CSS transform (and blur for the whip). */
export function cameraMoveStyle(move: { kind: 'zoom' | 'whip'; p: number } | null): { transform?: string; filter?: string } {
  if (!move) return {}
  if (move.kind === 'zoom') return { transform: `scale(${(1 + .07 * bump(move.p)).toFixed(4)})` }
  const shift = move.p < .5 ? -.35 * (move.p / .5) ** 2 : .35 * (1 - (move.p - .5) / .5) ** 2
  return { transform: `translateX(${(shift * 100).toFixed(2)}%)`, filter: `blur(${(8 * bump(move.p)).toFixed(1)}px)` }
}

const BACKDROP_CSS: Record<SceneBackdrop, (brand: string) => string> = {
  light: () => 'linear-gradient(#f6f7f9, #e2e5ea)',
  dark: () => 'linear-gradient(#2b2e34, #15171b)',
  brand: (c) => `linear-gradient(color-mix(in srgb, ${c} 10%, white), color-mix(in srgb, ${c} 24%, white))`,
  // The engine's grid: lavender easing into the brand color low in the frame, a faint white square grid fading out.
  grid: (c) => `linear-gradient(rgba(255,255,255,.28) 1px, transparent 1px) 0 0 / 7.1428% 4.0179%, linear-gradient(90deg, rgba(255,255,255,.28) 1px, transparent 1px) 0 0 / 7.1428% 4.0179%, linear-gradient(color-mix(in srgb, ${c} 16%, white), color-mix(in srgb, ${c} 30%, white) 45%, color-mix(in srgb, ${c} 82%, white))`,
  gradient: (c) => `linear-gradient(color-mix(in srgb, ${c} 8%, white), color-mix(in srgb, ${c} 20%, white) 45%, color-mix(in srgb, ${c} 50%, white))`,
  // The engine's solid: the color itself, a touch deeper at the bottom.
  solid: (c) => `radial-gradient(120% 60% at 50% 18%, color-mix(in srgb, ${c} 92%, white), transparent 70%), linear-gradient(${c}, color-mix(in srgb, ${c} 86%, black))`
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
  const now = nearestOutputTime(candidate, time)
  const mix = sceneMix(scenes, now)
  // The camera move at a scene change, approximated on the preview (the export draws it exactly).
  const move = sceneMove(scenes, now)
  const moveStyle = cameraMoveStyle(move)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    element.style.transform = moveStyle.transform ?? ''
    element.style.filter = moveStyle.filter ?? ''
  }, [canvas, moveStyle.transform, moveStyle.filter])
  useEffect(() => () => { const element = canvas.current; if (element) { element.style.transform = ''; element.style.filter = '' } }, [canvas])
  const escaping = mix.card > 0.5 && scenes.some((s) => s.start_ms <= now && now < s.end_ms && sceneEscapes(s))
  const visible = !!scenes.length && (mix.alpha > 0 || mix.card > 0)
  // How much wider than the framed preview the source is (a fill crop of part of it), for the card's width.
  const framing = [...candidate.scenes].reverse().find((s) => s.at_ms <= time) ?? candidate.scenes[0]
  const sourceShare = framing?.layout === 'fill' && framing.crops[0]?.[2] > 0 ? 1 / framing.crops[0][2] : 1
  const look = useRef({ span: PREVIEW_CARD_SPAN })
  useEffect(() => {
    if (!visible) return
    let frame = 0
    const draw = (): void => {
      const source = canvas.current, target = card.current
      const ctx = target?.getContext('2d')
      if (source && target && ctx && source.width && source.height) {
        // Head and shoulders from the preview frame: its upper part (the framing puts the face about 40% down), zoomed
        // out over a blurred copy where that is narrower than the card. The export frames from the detected face.
        const tw = target.width, th = target.height
        const sh = source.height * look.current.span, sy = Math.min(source.height * PREVIEW_CARD_TOP, source.height - sh)
        const sw = Math.min(source.width, sh * tw / th)
        const dw = sw * th / sh
        if (dw < tw - 1) {
          const ch = Math.min(sh, source.width * th / tw)
          ctx.filter = 'blur(10px) brightness(0.82)'
          ctx.drawImage(source, 0, sy + (sh - ch) / 2, source.width, ch, -12, -12, tw + 24, th + 24)
          ctx.filter = 'none'
        }
        ctx.drawImage(source, (source.width - sw) / 2, sy, sw, sh, (tw - dw) / 2, 0, dw, th)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [visible, canvas])
  if (!bounds.width || !visible) return null
  const own = candidate.hook?.look.look === 'brand' && isHexColor(candidate.hook.look.color) ? candidate.hook.look.color : null
  // Grid and gradient without a brand color are purple, like the engine's.
  const brandFor = (b: SceneBackdrop): string => own ?? (b === 'grid' || b === 'gradient' ? '#2F5BFF' : b === 'solid' ? SOLID_BACKDROP_COLOR : '#3B6BFF')
  const w = bounds.width, h = bounds.height
  const arch = mix.shape === 'arch'
  const fullW = arch ? w : w * (1 - 2 * STAGE_LAYOUT.cardSide), cardH = h * STAGE_LAYOUT.cardHeight + (arch ? h * STAGE_LAYOUT.cardBottom : 0)
  // Narrower than full width when the video is (a close selfie), as the export draws it.
  const { width: cardW, span } = previewCard(w, h, fullW, cardH, sourceShare)
  look.current.span = span
  const rest = h * (1 - STAGE_LAYOUT.cardBottom) - h * STAGE_LAYOUT.cardHeight, off = h + 8
  const radius = arch ? `${w * STAGE_LAYOUT.archRadius}px ${w * STAGE_LAYOUT.archRadius}px 0 0` : w * STAGE_LAYOUT.cardRadius
  return <div className="editor-scenes-overlay" style={{ ...bounds, ...moveStyle }} aria-hidden data-scene={mix.card > 0.5 ? 'stage' : mix.alpha > 0.5 ? 'visual' : 'face'}>
    {escaping && <span className="editor-graphic-depth-badge editor-scenes-badge">Head breaks out of the card in the export</span>}
    {mix.under && <div className="editor-scenes-backdrop" style={{ background: BACKDROP_CSS[mix.under](brandFor(mix.under)) }} />}
    {mix.backdrop && <div className="editor-scenes-backdrop" style={{ background: BACKDROP_CSS[mix.backdrop](brandFor(mix.backdrop)), opacity: mix.alpha }} />}
    <canvas ref={card} className="editor-scenes-card" data-card={mix.shape} width={Math.round(360 * cardW / fullW)} height={Math.round(360 * cardH / fullW)}
      style={{ width: cardW, height: cardH, left: (w - cardW) / 2, top: off - (off - rest) * mix.card, borderRadius: radius, visibility: mix.card > 0 ? 'visible' : 'hidden' }} />
  </div>
}
