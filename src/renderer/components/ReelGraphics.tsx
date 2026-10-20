/**
 * Motion graphics on a review screen (Edit my recording, Remix): a strip over
 * the reel (or the member's part) with a block per graphic, the template
 * picker, the selected graphic's words, place and length, and a small frame
 * showing where it sits. The templates and the live drawing are the clip
 * editor's (ClipGraphics). The place maps strip seconds to its own anchor (a
 * word, or a time in the take) and says what each graphic must keep clear of.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Plus, Shapes, Trash2 } from 'lucide-react'
import type { GraphicFrame } from '../../shared/graphic-layout'
import { graphicBox } from '../../shared/graphic-layout'
import type { HeadlineLook } from '../../shared/headline-look'
import { isHexColor } from '../../shared/headline-look'
import { GRAPHIC_MAX_MS, GRAPHIC_MIN_MS, MAX_GRAPHIC_FIELD_CHARS, MAX_GRAPHIC_ITEMS, graphicHasContent, highlightPoint, templateInfo, type EditorGraphic, type GraphicPlacement, type GraphicRenderSpec, type GraphicTemplateId } from '../../shared/motion-graphics'
import { MAX_REEL_GRAPHICS, REEL_GRAPHIC_TEMPLATES, reelGraphicSpec, reelGraphicStyle } from '../../shared/reel-graphics'
import { outputSize } from '../../shared/graphic-layout'
import { cn } from '../lib/utils'
import { FIELD_LABELS, GraphicView, SAMPLES, SHORT, graphicSummary } from './ClipGraphics'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'

/** One graphic as the strip shows it: `at` is seconds on the strip (null: not in the video now). */
export interface ReelGraphicItem extends Omit<EditorGraphic, 'at_ms'> {
  at: number | null
  /** Where it starts, in words ("on “pricing”", "at 0:12"). */
  where: string
  /** Why it won't show as placed, or null. */
  problem: string | null
}

export type ReelGraphicPatch = Partial<Pick<EditorGraphic, 'duration_ms' | 'placement'>> & { at?: number; fields?: Record<string, string> }

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

export function ReelGraphics({ label, intro, items, totalSeconds, blocked, frame, look, disabled, emptyNote, onAdd, onPatch, onRemove, cursorLabel }: {
  label: string
  intro: string
  items: ReelGraphicItem[]
  /** The strip's length (the reel, or the member's part). */
  totalSeconds: number
  /** Stretches graphics can't use (cards, the "My take" label), on the strip's clock. */
  blocked: { start: number; end: number; label: string }[]
  frame: GraphicFrame
  look: HeadlineLook | null
  disabled: boolean
  /** Shown when a graphic can't be added yet (nothing recorded), or null. */
  emptyNote: string | null
  onAdd: (template: GraphicTemplateId, at: number) => string | null
  onPatch: (id: string, patch: ReelGraphicPatch) => void
  onRemove: (id: string) => void
  /** Where a new graphic would start, in words. */
  cursorLabel: (at: number) => string
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [cursor, setCursor] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  const total = Math.max(0.5, totalSeconds)
  const g = items.find((item) => item.id === selected) ?? null
  useEffect(() => { if (selected && !items.some((item) => item.id === selected)) setSelected(null) }, [items, selected])
  const full = items.length >= MAX_REEL_GRAPHICS
  const style = reelGraphicStyle(look)
  const at = Math.max(0, Math.min(total - 0.5, cursor))

  const add = (template: GraphicTemplateId): void => {
    const id = onAdd(template, at)
    if (id) setSelected(id)
    setPicking(false)
  }
  const field = (key: string, value: string): void => { if (g) onPatch(g.id, { fields: { [key]: value } }) }
  const preview = (id: GraphicTemplateId): GraphicRenderSpec => {
    const { width, height } = outputSize('1:1')
    return { template: id, fields: id === 'highlight' ? { ...SAMPLES[id], y: '0.5' } : SAMPLES[id], width, height, duration_ms: 2600, box: { top: .06, bottom: .94 }, placement: 'middle', ...style }
  }

  return <section className="space-y-3" aria-label={label}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Shapes className="h-4 w-4" aria-hidden />{label} <span className="text-2xs font-normal text-ink-subtle">{items.length} / {MAX_REEL_GRAPHICS}</span></h3>
        <p className="text-2xs text-ink-subtle">{intro}</p>
      </div>
      <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={disabled || full || !!emptyNote} aria-expanded={picking}
        tooltip={full ? `Add up to ${MAX_REEL_GRAPHICS} graphics.` : emptyNote ?? undefined} onClick={() => setPicking(!picking)}>Add a graphic</Button>
    </div>
    {emptyNote ? <p className="text-2xs text-ink-subtle">{emptyNote}</p> : <>
      <div ref={strip} className="reel-graphics-strip" role="group" aria-label={`${label} timeline`}
        title="Click to choose where a new graphic starts"
        onClick={(e) => { if (disabled) return; const box = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(total, (e.clientX - box.left) / box.width * total))) }}>
        {blocked.map((b, i) => <span key={i} className="blocked" title={b.label} style={{ left: `${b.start / total * 100}%`, width: `${Math.max(0.5, (b.end - b.start) / total * 100)}%` }} />)}
        {items.filter((item) => item.at !== null).map((item) => <button key={item.id} type="button"
          className={cn('block', item.id === selected && 'selected', item.problem && 'conflict')}
          style={{ left: `${(item.at as number) / total * 100}%`, width: `${Math.max(2.5, item.duration_ms / 1000 / total * 100)}%` }}
          aria-label={`${templateInfo(item.template).label} ${item.where}, ${(item.duration_ms / 1000).toFixed(1)} seconds`} aria-pressed={item.id === selected}
          title={item.problem ?? `${templateInfo(item.template).label} ${item.where}`}
          onClick={(e) => { e.stopPropagation(); setSelected(item.id); setPicking(false) }}>
          <span className="font-medium">{SHORT[item.template]}</span><span className="truncate text-ink-muted">{graphicSummary(item)}</span>
        </button>)}
        <span className="playhead" style={{ left: `${at / total * 100}%` }} aria-hidden />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-2xs text-ink-subtle"><span>0:00</span><span>New graphics start {cursorLabel(at)}.</span><span>{clock(total)}</span></div>
    </>}
    {picking && <div className="space-y-2" role="region" aria-label="Choose a graphic">
      <p className="text-2xs text-ink-subtle">It starts {cursorLabel(at)}. You add the words next; the previews use sample words.</p>
      <div className="reel-graphic-picker">{REEL_GRAPHIC_TEMPLATES.map((t) => <button key={t.id} type="button" disabled={disabled || full} onClick={() => add(t.id)} title={t.detail} aria-label={`Add ${t.label}`}>
        <GraphicView spec={preview(t.id)} width={64} loop />
        <span>{t.label}</span>
      </button>)}</div>
    </div>}
    {items.length > 0 && !picking && <div className="flex flex-wrap gap-1.5" role="list" aria-label="Your graphics">
      {items.map((item) => <button key={item.id} type="button" role="listitem" onClick={() => setSelected(item.id)}
        className={cn('rounded-full border px-2.5 py-1 text-2xs', item.id === selected ? 'border-accent/70 bg-accent/15 text-ink' : 'border-white/10 text-ink-muted hover:text-ink')}>
        {item.problem && <AlertTriangle className="mr-1 inline h-3 w-3 text-warning" aria-hidden />}{templateInfo(item.template).label} {item.where}
      </button>)}
    </div>}
    {g && !picking && <GraphicForm key={g.id} g={g} frame={frame} look={look} disabled={disabled} cursorLabel={cursorLabel(at)}
      onField={field} onPatch={(patch) => onPatch(g.id, patch)} onMoveHere={() => onPatch(g.id, { at })}
      onRemove={() => { onRemove(g.id); setSelected(null) }} />}
  </section>
}

function GraphicForm({ g, frame, look, disabled, cursorLabel, onField, onPatch, onMoveHere, onRemove }: {
  g: ReelGraphicItem; frame: GraphicFrame; look: HeadlineLook | null; disabled: boolean; cursorLabel: string
  onField: (key: string, value: string) => void; onPatch: (patch: ReelGraphicPatch) => void; onMoveHere: () => void; onRemove: () => void
}): React.JSX.Element {
  const info = templateInfo(g.template)
  const style = reelGraphicStyle(look, g)
  const spec = useMemo(() => reelGraphicSpec(g, frame, g.duration_ms, look), [g, frame, look])
  const box = graphicBox(g.placement, frame)
  const input = 'w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-accent/70 focus:outline-none'
  return <div className="grid gap-4 rounded-xl border border-white/10 p-3 sm:grid-cols-[minmax(0,1fr)_132px]">
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">{info.label} <span className="font-normal text-ink-subtle">{g.where}</span></p>
        <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove}>Remove</Button>
      </div>
      {g.problem && <p className="text-2xs text-warning" role="note">{g.problem}</p>}
      {!graphicHasContent(g) && <p className="text-2xs text-warning">Add its words to show it.</p>}
      {info.fields.filter((k) => !['image', 'shape', 'x', 'y'].includes(k)).map((key) => <label key={key} className="block space-y-1 text-2xs text-ink-muted">{FIELD_LABELS[key] ?? key}
        {key === 'items' || key === 'text'
          ? <textarea className={cn(input, 'resize-y')} rows={key === 'items' ? MAX_GRAPHIC_ITEMS : 2} maxLength={key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''}
            onChange={(e) => onField(key, e.target.value)} aria-label={`${info.label} ${(FIELD_LABELS[key] ?? key).toLowerCase()}`} />
          : <input className={input} maxLength={MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''} onChange={(e) => onField(key, e.target.value)}
            aria-label={`${info.label} ${(FIELD_LABELS[key] ?? key).toLowerCase()}`} placeholder={key === 'value' ? 'e.g. a number you said, like 40%' : undefined} />}
      </label>)}
      {g.template === 'stat' && <p className="text-2xs text-ink-subtle">The number counts up. Use one you said, like “$1,200/month” or “40%”.</p>}
      {g.template === 'highlight' ? <div className="space-y-2">
        <Segmented label="Shape" size="sm" value={highlightPoint(g.fields).shape} onChange={(shape) => onField('shape', shape)} options={[{ value: 'circle', label: 'Circle' }, { value: 'arrow', label: 'Arrow' }]} />
        {(['x', 'y'] as const).map((axis) => <label key={axis} className="block text-2xs text-ink-muted">{axis === 'x' ? 'Across' : 'Down'} <span className="float-right">{Math.round(highlightPoint(g.fields)[axis] * 100)}%</span>
          <input type="range" className="w-full accent-[rgb(var(--accent))]" min={0} max={100} step={1} aria-label={axis === 'x' ? 'Point across' : 'Point down'} value={Math.round(highlightPoint(g.fields)[axis] * 100)}
            onChange={(e) => onField(axis, String(Number(e.target.value) / 100))} /></label>)}
      </div> : <div className="space-y-1"><p className="text-2xs text-ink-muted">Place</p>
        <Segmented<GraphicPlacement> label="Graphic placement" size="sm" value={g.placement} onChange={(placement) => onPatch({ placement })}
          options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} /></div>}
      <label className="block text-2xs text-ink-muted">Length <span className="float-right">{(g.duration_ms / 1000).toFixed(1)}s</span>
        <input type="range" className="w-full accent-[rgb(var(--accent))]" aria-label="Graphic length" min={GRAPHIC_MIN_MS} max={GRAPHIC_MAX_MS} step={100} value={g.duration_ms}
          onChange={(e) => onPatch({ duration_ms: Number(e.target.value) })} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onMoveHere}>Start it {cursorLabel}</Button>
        <span className="ml-auto flex items-center gap-2 text-2xs text-ink-muted">Color
          <input type="color" className="h-6 w-8 cursor-pointer rounded border border-white/10 bg-transparent" aria-label="Graphic color" value={(isHexColor(g.fields.color) ? g.fields.color : style.color).toLowerCase()}
            onChange={(e) => onField('color', e.target.value.toUpperCase())} />
          {isHexColor(g.fields.color) && <Button size="sm" variant="ghost" onClick={() => onPatch({ fields: { color: '' } })}>Use hook color</Button>}</span>
      </div>
    </fieldset>
    <div className="space-y-1">
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-b from-slate-700 to-slate-900" style={{ width: 132, height: 132 * 16 / 9 }} aria-label="Where it sits">
        {frame.hook > 0 && <div className="absolute inset-x-0 top-0 bg-white/80" style={{ height: `${frame.hook * 100}%` }} />}
        {(frame.blocked ?? []).map(([a, b], i) => <div key={i} className="absolute inset-x-0 border-y border-white/30 bg-white/10" style={{ top: `${a * 100}%`, height: `${(b - a) * 100}%` }} />)}
        {frame.captions && <div className="absolute inset-x-6 h-[3px] rounded bg-white/50" style={{ top: `${frame.captions.y * 100}%` }} />}
        <div className="absolute inset-0" style={{ outline: 'none' }}><GraphicView spec={spec} time={Math.round(spec.duration_ms * 0.8)} width={132} /></div>
        <div className="pointer-events-none absolute inset-x-0 border border-dashed border-accent/60" style={{ top: `${box.top * 100}%`, height: `${(box.bottom - box.top) * 100}%` }} />
      </div>
      <p className="text-[10px] leading-tight text-ink-subtle">{(frame.blocked ?? []).length ? 'Graphics stay clear of the hook text, the captions and their clip.' : 'Graphics stay clear of the hook text and the captions.'}</p>
    </div>
  </div>
}
