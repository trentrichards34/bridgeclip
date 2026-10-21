/**
 * Motion graphics in the clip editor: the Graphics row under the cut, the
 * Graphics inspector tab (template picker and field form), and the live
 * overlay on the Output monitor. Everything edits `candidate.graphics` through
 * the editor's `change()` (undo, redo and autosave like any other edit). The
 * overlay and the picker run the same template code the bake renders
 * offscreen (src/renderer/graphics/templates.ts).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { AlertTriangle, Plus, Trash2, ImagePlus, Shapes } from 'lucide-react'
import type { MountedGraphic } from '../graphics/templates'
import {
  GRAPHIC_MAX_MS, GRAPHIC_MIN_MS, GRAPHIC_TEMPLATES, MAX_GRAPHICS_PER_CLIP, MAX_GRAPHIC_ITEMS, MAX_GRAPHIC_FIELD_CHARS,
  clampGraphicMs, fitGraphicInCut, graphicClashes, graphicCutFit, graphicHasContent, placeInFreeBand, graphicLocalMs, highlightPoint, newGraphic, removeGraphic, templateInfo, updateGraphic, withGraphic,
  type EditorGraphic, type GraphicPlacement, type GraphicRenderSpec, type GraphicTemplateId
} from '../../shared/motion-graphics'
import { GRAPHIC_DEFAULT_COLOR, graphicSpec, graphicStyle, outputSize } from '../../shared/graphic-layout'
import type { CandidateEdit, EditorProject } from '../../shared/clip-editor'
import { isHexColor } from '../../shared/headline-look'
import { cn, localFileUrl } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'

/** Where a graphic's picture lives in the run (copied there by main). */
export function graphicImageUrl(outputDir: string, name: string | undefined): string | undefined {
  return name && /^[a-f0-9]{16}\.(png|jpg|webp)$/.test(name) ? localFileUrl(`${outputDir.replace(/[\\/]+$/, '')}/.graphics/images/${name}`) : undefined
}

// The templates (and anime.js) load with the first graphic shown, not with the app.
let templates: Promise<typeof import('../graphics/templates')> | null = null
const loadTemplates = (): Promise<typeof import('../graphics/templates')> => (templates ??= import('../graphics/templates'))

/** One template drawn at `width` CSS pixels: seeked to `time` (output ms into the graphic), or looping on its own. */
export function GraphicView({ spec, time, width, loop, className }: { spec: GraphicRenderSpec; time?: number | null; width: number; loop?: boolean; className?: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<MountedGraphic | null>(null)
  const timeRef = useRef(time); timeRef.current = time
  const key = JSON.stringify(spec)
  useEffect(() => {
    let graphic: MountedGraphic | null = null, frame = 0, live = true
    void loadTemplates().then(({ mountGraphic }) => {
      if (!live || !host.current) return
      const mountedGraphic = mountGraphic(host.current, JSON.parse(key) as GraphicRenderSpec)
      graphic = mountedGraphic
      mounted.current = mountedGraphic
      const show = (): void => { mountedGraphic.seek(timeRef.current ?? -1) }
      void mountedGraphic.ready.then(() => { if (mounted.current === mountedGraphic && !loop) show() })
      if (loop) {
        const started = performance.now(), cycle = (JSON.parse(key) as GraphicRenderSpec).duration_ms + 700
        const tick = (now: number): void => { mountedGraphic.seek((now - started) % cycle); frame = requestAnimationFrame(tick) }
        frame = requestAnimationFrame(tick)
      } else show()
    })
    return () => { live = false; cancelAnimationFrame(frame); mounted.current = null; graphic?.destroy() }
  }, [key, loop])
  useEffect(() => { if (!loop) mounted.current?.seek(time ?? -1) }, [time, loop])
  const scale = width / spec.width
  return <div className={cn('editor-graphic-view', className)} style={{ width, height: spec.height * scale }}>
    <div ref={host} style={{ width: spec.width, height: spec.height, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
  </div>
}

/** The real animations over the Output monitor, at the playhead. */
export function GraphicsOverlay({ canvas, project, candidate, time, outputDir }: {
  canvas: RefObject<HTMLCanvasElement | null>; project: EditorProject; candidate: CandidateEdit; time: number; outputDir: string
}): React.JSX.Element | null {
  const [bounds, setBounds] = useState({ width: 0, height: 0, left: 0, top: 0 })
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
  }, [canvas, project.aspect_ratio])
  const shown = (candidate.graphics ?? []).flatMap((g) => {
    const local = graphicLocalMs(candidate, g, time)
    if (local === null || !graphicHasContent(g)) return []
    const spec = graphicSpec(project, candidate, g)
    if (!spec) return []
    if (g.template === 'logo') spec.image = graphicImageUrl(outputDir, g.fields.image)
    return [{ g, spec, local }]
  })
  if (!bounds.width || !shown.length) return null
  return <div className="editor-graphics-overlay" style={bounds} aria-hidden>
    {shown.map(({ g, spec, local }) => <GraphicView key={g.id} spec={spec} time={local} width={bounds.width} />)}
  </div>
}

export const SHORT: Record<GraphicTemplateId, string> = { stat: 'Stat', title: 'Title', list: 'List', lower_third: 'Name', logo: 'Logo', before_after: 'Before/after', checklist: 'Checklist', quote: 'Quote', highlight: 'Arrow/circle' }
export function graphicSummary(g: Pick<EditorGraphic, 'template' | 'fields'>): string {
  const f = g.fields
  const words = g.template === 'stat' ? [f.value, f.label] : g.template === 'lower_third' ? [f.name, f.role] : g.template === 'before_after' ? [f.before, f.after]
    : g.template === 'list' || g.template === 'checklist' ? [f.title, (f.items ?? '').split('\n')[0]] : g.template === 'logo' ? [f.caption] : g.template === 'highlight' ? [f.shape === 'arrow' ? 'Arrow' : 'Circle'] : [f.text]
  return words.map((w) => w?.trim()).filter(Boolean).join(' · ')
}

/** The Graphics row on the timeline: one block per graphic at its source time. */
export function GraphicsTrack({ candidate, viewStart, viewEnd, selected, disabled, onSelect, onChange, onDrag, onAdd, clock }: {
  candidate: CandidateEdit; viewStart: number; viewEnd: number; selected: string | null; disabled: boolean
  onSelect: (id: string) => void; onChange: (graphics: EditorGraphic[], remember: boolean) => void
  /** A drag starts or ends (the editor holds the timeline's zoom and autosave meanwhile). */
  onDrag: (active: boolean) => void; onAdd: () => void; clock: (ms: number) => string
}): React.JSX.Element {
  const graphics = candidate.graphics ?? []
  const span = viewEnd - viewStart
  // Two lanes when graphics overlap.
  const lanes: number[] = []
  const ends = [-Infinity, -Infinity]
  for (const g of graphics) { const lane = g.at_ms >= ends[0] ? 0 : 1; lanes.push(lane); ends[lane] = Math.max(ends[lane], g.at_ms + g.duration_ms) }
  const stacked = lanes.includes(1)
  const clashes = graphicClashes(graphics)
  const startDrag = (e: React.PointerEvent<HTMLElement>, g: EditorGraphic, mode: 'move' | 'start' | 'end'): void => {
    if (disabled || e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const target = e.currentTarget, track = target.closest('.editor-graphics-track')!.getBoundingClientRect(), x = e.clientX
    const clipStart = candidate.ranges[0][0], clipEnd = candidate.ranges[candidate.ranges.length - 1][1]
    let moved = false
    target.setPointerCapture(e.pointerId)
    onSelect(g.id); onDrag(true)
    const move = (event: PointerEvent): void => {
      if (!moved && Math.abs(event.clientX - x) < 3) return
      const dt = Math.round((event.clientX - x) / track.width * span)
      const end = g.at_ms + g.duration_ms
      const patch = mode === 'move' ? { at_ms: Math.max(clipStart, Math.min(clipEnd - Math.min(g.duration_ms, clipEnd - clipStart), g.at_ms + dt)) }
        : mode === 'start' ? (() => { const at = Math.max(clipStart, end - GRAPHIC_MAX_MS, Math.min(end - GRAPHIC_MIN_MS, g.at_ms + dt)); return { at_ms: at, duration_ms: end - at } })()
        : { duration_ms: clampGraphicMs(Math.min(clipEnd - g.at_ms, g.duration_ms + dt)) }
      onChange(updateGraphic(candidate, g.id, patch), !moved)
      moved = true
    }
    const done = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', done); onDrag(false) }
    target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', done)
  }
  const nudge = (e: React.KeyboardEvent, g: EditorGraphic): void => {
    if (disabled) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onChange(removeGraphic(candidate, g.id), true); return }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault(); e.stopPropagation()
    const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1000 : 100)
    onChange(updateGraphic(candidate, g.id, { at_ms: g.at_ms + step }), true)
  }
  return <div className="editor-graphics-row">
    <div className="editor-graphics-label"><Shapes size={12} aria-hidden /><span>Graphics</span>
      <Button size="sm" variant="ghost" icon={<Plus size={12} />} disabled={disabled || graphics.length >= MAX_GRAPHICS_PER_CLIP} onClick={onAdd}
        tooltip={graphics.length >= MAX_GRAPHICS_PER_CLIP ? `A clip can have up to ${MAX_GRAPHICS_PER_CLIP} graphics.` : 'Add an animated graphic (a stat, title, list and more) that starts at the playhead.'}>Add graphic at playhead</Button></div>
    <div className={cn('editor-graphics-track', stacked && 'stacked')} aria-label="Graphics">
      {graphics.map((g, i) => {
        const a = Math.max(g.at_ms, viewStart), b = Math.min(g.at_ms + g.duration_ms, viewEnd)
        if (b <= a) return null
        const fit = graphicCutFit(candidate, g), offscreen = fit === 'outside', clash = clashes.has(g.id)
        const warning = graphicWarning(fit, clash, g.placement)
        const label = `${templateInfo(g.template).label} at ${clock(g.at_ms)}, ${(g.duration_ms / 1000).toFixed(1)} seconds${warning ? `. ${warning}` : ''}`
        return <div key={g.id} className={cn('editor-graphic-block', selected === g.id && 'selected', offscreen && 'cut-out', fit === 'partly' && 'partly', clash && 'clash', !graphicHasContent(g) && 'empty', stacked && (lanes[i] ? 'lane-2' : 'lane-1'))}
          style={{ left: `${(a - viewStart) / span * 100}%`, width: `${(b - a) / span * 100}%` }}>
          <button className="editor-graphic-edge" aria-label={`Change when ${label} starts`} disabled={disabled} onPointerDown={(e) => startDrag(e, g, 'start')} tabIndex={-1} />
          <button className="editor-graphic-body" aria-label={label} aria-pressed={selected === g.id}
            title={`${label} · Drag to move · Drag an edge to change its length · Delete removes it`}
            onPointerDown={(e) => startDrag(e, g, 'move')} onClick={() => onSelect(g.id)} onKeyDown={(e) => nudge(e, g)}>
            {(fit === 'partly' || clash) && <AlertTriangle size={10} className="editor-graphic-warning" aria-hidden />}
            <span className="editor-graphic-kind">{SHORT[g.template]}</span><span className="editor-graphic-words">{graphicSummary(g)}</span>
          </button>
          <button className="editor-graphic-edge" aria-label={`Change when ${label} ends`} disabled={disabled} onPointerDown={(e) => startDrag(e, g, 'end')} tabIndex={-1} />
        </div>
      })}
      {!graphics.length && <span className="editor-graphics-empty">No graphics yet</span>}
    </div>
  </div>
}

/** What is wrong with where a graphic sits, in a sentence (or null). */
export function graphicWarning(fit: ReturnType<typeof graphicCutFit>, clash: boolean, placement: GraphicPlacement): string | null {
  const parts: string[] = []
  if (fit === 'outside') parts.push('It sits in a part you cut out, so it won’t show. Move it onto the cut.')
  if (fit === 'partly') parts.push('Part of it is outside the cut, so it plays shorter. Move it or shorten it to play all of it.')
  if (clash) parts.push(`Another graphic is at the ${placement} at the same time, so they cover each other. Move one to another place or time.`)
  return parts.length ? parts.join(' ') : null
}

/** Sample words for the picker's previews only (never put in a clip). */
export const SAMPLES: Record<GraphicTemplateId, Record<string, string>> = {
  stat: { value: '75%', label: 'Sample label' }, title: { text: 'Your big words' }, list: { title: 'Sample list', items: 'First point\nSecond point\nThird point' },
  lower_third: { name: 'Your name', role: 'Your role' }, logo: { caption: 'Your caption' }, before_after: { before: 'Before', after: 'After' },
  checklist: { title: 'Sample checklist', items: 'First item\nSecond item\nThird item' }, quote: { text: 'A short quote goes here.', author: 'Who said it' },
  highlight: { shape: 'circle', x: '0.5', y: '0.45' }
}

const NUMBER_WORDS = /[$€£]?\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|[kKmMxX]\b|thousand\b|million\b|billion\b|hours?\b|days?\b|minutes?\b|years?\b)?/
/** Starting words for a new graphic, from what is said at the playhead (nothing is made up). */
export function wordsAtPlayhead(template: GraphicTemplateId, line: string | undefined): Record<string, string> {
  const text = (line ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return {}
  if (template === 'title') return { text: text.split(' ').slice(0, 6).join(' ').replace(/[,.;:!?]+$/, '') }
  if (template === 'quote') return { text: text.slice(0, MAX_GRAPHIC_FIELD_CHARS) }
  if (template === 'stat') { const n = NUMBER_WORDS.exec(text); return n ? { value: n[0].trim() } : {} }
  return {}
}

export const FIELD_LABELS: Record<string, string> = { value: 'Number', label: 'Label', text: 'Words', title: 'Title', items: 'Items (one per line)', name: 'Name', role: 'Role', caption: 'Caption', before: 'Before', after: 'After', author: 'Who said it' }

/** The Graphics inspector tab: pick a template, then edit the selected graphic's words, place and length. */
export function GraphicsInspector({ project, candidate, outputDir, time, selected, picking, disabled, onPick, onSelect, onChange, seek, clock }: {
  project: EditorProject; candidate: CandidateEdit; outputDir: string; time: number; selected: string | null; picking: boolean; disabled: boolean
  onPick: (picking: boolean) => void; onSelect: (id: string | null) => void; onChange: (graphics: EditorGraphic[], remember?: boolean) => void
  seek: (ms: number) => void; clock: (ms: number) => string
}): React.JSX.Element {
  const graphics = candidate.graphics ?? []
  const g = graphics.find((x) => x.id === selected) ?? null
  const style = graphicStyle(candidate)
  const [imageError, setImageError] = useState<string | null>(null)
  useEffect(() => setImageError(null), [selected])
  const full = graphics.length >= MAX_GRAPHICS_PER_CLIP
  const clipStart = candidate.ranges[0][0], clipEnd = candidate.ranges[candidate.ranges.length - 1][1]
  const add = (template: GraphicTemplateId): void => {
    const at = Math.max(clipStart, Math.min(clipEnd - GRAPHIC_MIN_MS, Math.round(time)))
    const line = project.transcript.find((r) => at >= r.start_ms && at < r.end_ms)?.text
    const drafted = newGraphic(template, at, { fields: wordsAtPlayhead(template, line), taken: graphics.map((x) => x.id) })
    // All of it plays inside the cut (near the end it starts earlier), in a band no other graphic uses then.
    const graphic = placeInFreeBand(graphics, fitGraphicInCut(drafted, candidate) ?? drafted)
    onChange(withGraphic(candidate, graphic))
    onSelect(graphic.id); onPick(false)
  }
  const field = (key: string, value: string, remember = true): void => { if (g) onChange(updateGraphic(candidate, g.id, { fields: { [key]: value } }), remember) }
  if (picking || (!g && !graphics.length)) {
    const preview = (id: GraphicTemplateId): GraphicRenderSpec => {
      // A square crop of the template at full size reads better in a small tile than a whole 9:16 frame.
      const { width, height } = outputSize('1:1')
      return { template: id, fields: id === 'highlight' ? { ...SAMPLES[id], y: '0.5' } : SAMPLES[id], width, height, duration_ms: 2600, box: { top: .06, bottom: .94 }, placement: 'middle', ...style }
    }
    return <section className="editor-graphics-panel" aria-label="Choose a graphic">
      <div className="flex items-center justify-between gap-2"><p className="text-xs">Choose a graphic</p>{(picking && graphics.length > 0) && <Button size="sm" variant="ghost" onClick={() => onPick(false)}>Cancel</Button>}</div>
      <p className="text-2xs text-ink-subtle">It starts at the playhead ({clock(Math.max(clipStart, Math.min(clipEnd, time)))}). You add the words next; the previews use sample words.</p>
      <div className="editor-graphic-picker">{GRAPHIC_TEMPLATES.map((t) => <button key={t.id} className="editor-graphic-tile" disabled={disabled || full} onClick={() => add(t.id)} title={t.detail} aria-label={`Add ${t.label}`}>
        <GraphicView spec={preview(t.id)} width={76} loop />
        <span>{t.label}</span>
      </button>)}</div>
      {full && <p className="text-2xs text-warning">A clip can have up to {MAX_GRAPHICS_PER_CLIP} graphics.</p>}
    </section>
  }
  const clashes = graphicClashes(graphics)
  const list = <div className="editor-graphic-list" role="list" aria-label="Graphics on this clip">{graphics.map((x) => <button key={x.id} role="listitem" className={cn(x.id === selected && 'selected')}
    onClick={() => { onSelect(x.id); if (time < x.at_ms || time >= x.at_ms + x.duration_ms) seek(x.at_ms + Math.min(1200, x.duration_ms * .45)) }}>
    <span>{templateInfo(x.template).label}</span>{graphicWarning(graphicCutFit(candidate, x), clashes.has(x.id), x.placement) && <AlertTriangle size={11} className="text-warning" aria-label="Needs a look" />}<span className="text-ink-subtle">{clock(x.at_ms)}</span></button>)}</div>
  return <section className="editor-graphics-panel" aria-label="Graphics">
    <div className="flex items-center justify-between gap-2"><p className="text-xs">Graphics <span className="text-ink-subtle">{graphics.length} / {MAX_GRAPHICS_PER_CLIP}</span></p>
      <Button size="sm" icon={<Plus size={13} />} disabled={disabled || full} onClick={() => onPick(true)}>Add at playhead</Button></div>
    {list}
    {!g ? <p className="text-2xs text-ink-subtle">Select a graphic on the timeline or in the list to edit it.</p> : <fieldset disabled={disabled} className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{templateInfo(g.template).label}</p>
        <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => { onChange(removeGraphic(candidate, g.id)); onSelect(null) }}>Remove</Button></div>
      {(() => { const warning = graphicWarning(graphicCutFit(candidate, g), graphicClashes(graphics).has(g.id), g.placement); return warning && <p role="note" className="text-2xs text-warning">{warning}</p> })()}
      {!graphicHasContent(g) && <p className="text-2xs text-warning">{g.template === 'logo' ? 'Choose an image to show it.' : 'Add its words to show it.'}</p>}
      {g.template === 'logo' && <div className="space-y-2">
        <div className="flex items-center gap-2">{graphicImageUrl(outputDir, g.fields.image) && <img className="editor-graphic-thumb" src={graphicImageUrl(outputDir, g.fields.image)} alt="" />}
          <Button size="sm" icon={<ImagePlus size={13} />} onClick={() => {
            setImageError(null)
            void getApi().editor.graphicImage(outputDir).then((name) => { if (name) field('image', name) }).catch((e: unknown) => setImageError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not add that image.'))
          }}>{g.fields.image ? 'Change image' : 'Choose image'}</Button></div>
        <p className="text-2xs text-ink-subtle">PNG, JPEG or WebP, up to 12 MB. It’s copied into this run.</p>
        {imageError && <p role="alert" className="text-2xs text-danger">{imageError}</p>}
      </div>}
      {templateInfo(g.template).fields.filter((k) => !['image', 'shape', 'x', 'y'].includes(k)).map((key) => <label key={key} className="editor-label">{FIELD_LABELS[key] ?? key}
        {key === 'items' || key === 'text' ? <textarea rows={key === 'items' ? MAX_GRAPHIC_ITEMS : 3} maxLength={key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''} onChange={(e) => field(key, e.target.value)} aria-label={`${templateInfo(g.template).label} ${(FIELD_LABELS[key] ?? key).toLowerCase()}`} />
          : <input className="editor-graphic-input" maxLength={MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''} onChange={(e) => field(key, e.target.value)} aria-label={`${templateInfo(g.template).label} ${(FIELD_LABELS[key] ?? key).toLowerCase()}`}
            placeholder={key === 'value' ? 'e.g. the number said in the clip' : undefined} />}
      </label>)}
      {g.template === 'stat' && <p className="text-2xs text-ink-subtle">The number counts up. Use one from the clip, like “$1,200/month”, “15 billion” or “25%”.</p>}
      {g.template === 'highlight' ? <div className="space-y-2">
        <Segmented label="Shape" size="sm" value={highlightPoint(g.fields).shape} onChange={(shape) => field('shape', shape)} options={[{ value: 'circle', label: 'Circle' }, { value: 'arrow', label: 'Arrow' }]} />
        {(['x', 'y'] as const).map((axis) => <label key={axis} className="editor-label">{axis === 'x' ? 'Across' : 'Down'} <span className="float-right">{Math.round(highlightPoint(g.fields)[axis] * 100)}%</span>
          <input type="range" min={0} max={100} step={1} aria-label={axis === 'x' ? 'Point across' : 'Point down'} value={Math.round(highlightPoint(g.fields)[axis] * 100)} onChange={(e) => field(axis, String(Number(e.target.value) / 100))} /></label>)}
      </div> : <div className="space-y-1"><p className="editor-label">Place</p>
        <Segmented<GraphicPlacement> label="Graphic placement" size="sm" value={g.placement} onChange={(placement) => onChange(updateGraphic(candidate, g.id, { placement }))}
          options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
        <p className="text-2xs text-ink-subtle">Graphics stay clear of the hook and the captions.</p></div>}
      <label className="editor-label">Length <span className="float-right">{(g.duration_ms / 1000).toFixed(1)}s</span>
        <input type="range" aria-label="Graphic length" min={GRAPHIC_MIN_MS} max={GRAPHIC_MAX_MS} step={100} value={g.duration_ms} onChange={(e) => onChange(updateGraphic(candidate, g.id, { duration_ms: Number(e.target.value) }))} /></label>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-subtle"><span>Starts {clock(g.at_ms)}</span>
        <Button size="sm" variant="ghost" disabled={time < clipStart || time > clipEnd} onClick={() => onChange(updateGraphic(candidate, g.id, { at_ms: Math.round(time) }))}>Start at playhead</Button></div>
      <div className="flex items-center justify-between gap-2 text-xs"><span>Color</span>
        <span className="flex items-center gap-2"><input type="color" className="editor-graphic-color" aria-label="Graphic color" value={(isHexColor(g.fields.color) ? g.fields.color : style.color).toLowerCase()}
          onChange={(e) => field('color', e.target.value.toUpperCase())} />
          {isHexColor(g.fields.color) && <Button size="sm" variant="ghost" onClick={() => onChange(updateGraphic(candidate, g.id, { fields: { color: '' } }))}>Use hook color</Button>}</span></div>
      <p className="text-2xs text-ink-subtle">{isHexColor(g.fields.color) ? 'This graphic has its own color.' : style.color === GRAPHIC_DEFAULT_COLOR ? 'Uses blue. Give the hook a brand color to use yours.' : 'Uses the hook’s brand color.'} The font follows the hook.</p>
    </fieldset>}
  </section>
}
