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
import { DIAGRAM_ACCENT, GRAPHIC_ITEM_LIMITS, GRAPHIC_MIN_MS, MAX_GRAPHIC_FIELD_CHARS, MAX_GRAPHIC_ITEMS, graphicCanGoBehind, graphicMaxMs, isDiagram, graphicDepth, graphicHasContent, highlightPoint, templateInfo, type EditorGraphic, type GraphicPlacement, type GraphicTemplateId } from '../../shared/motion-graphics'
import { MAX_REEL_GRAPHICS, REEL_GRAPHIC_TEMPLATES, reelGraphicSpec, reelGraphicStyle } from '../../shared/reel-graphics'
import { cn } from '../lib/utils'
import { BigWordsFields, DiagramFields, EffectFields, GraphicView, IconFields, SHORT, fieldLabel, graphicSummary, type EffectPictures } from './ClipGraphics'
import { fxEffect, fxPictureFields } from '../../shared/fx-catalog'
import { GraphicGallery, TEMPLATE_ICONS } from './GraphicGallery'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { Switch } from './ui/Switch'

/** One graphic as the strip shows it: `at` is seconds on the strip (null: not in the video now). */
export interface ReelGraphicItem extends Omit<EditorGraphic, 'at_ms'> {
  at: number | null
  /** Where it starts, in words ("on “pricing”", "at 0:12"). */
  where: string
  /** Why it won't show as placed, or null. */
  problem: string | null
}

export type ReelGraphicPatch = Partial<Pick<EditorGraphic, 'duration_ms' | 'placement' | 'depth'>> & { at?: number; fields?: Record<string, string> }

/** A graphic's name on the strip: its effect's name for an Effect, else its template's. */
const nameOf = (g: Pick<EditorGraphic, 'template' | 'fields'>): string => g.template === 'fx' ? fxEffect(g.fields.effect)?.label ?? templateInfo(g.template).label : templateInfo(g.template).label

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

export function ReelGraphics({ label, intro, items, totalSeconds, blocked, frame, look, disabled, emptyNote, onAdd, onPatch, onRemove, cursorLabel, prefill, pictures, heading = 'h3', limit = MAX_REEL_GRAPHICS }: {
  label: string
  /** The most graphics this video takes (an edited reel takes more). */
  limit?: number
  /** The title's heading level ('h4' when it sits inside a bigger section). */
  heading?: 'h3' | 'h4'
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
  /** `effect`: for an Effect (template 'fx'), the effect picked. */
  onAdd: (template: GraphicTemplateId, at: number, effect?: string) => string | null
  onPatch: (id: string, patch: ReelGraphicPatch) => void
  onRemove: (id: string) => void
  /** Where a new graphic would start, in words. */
  cursorLabel: (at: number) => string
  /** The words a new graphic of this template starts with at `at` (the gallery's previews show them). */
  prefill?: (template: GraphicTemplateId, at: number) => Record<string, string>
  /** The member's pictures for this video (an edited reel's screenshots): the effects on them are offered then. */
  pictures?: EffectPictures
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [cursor, setCursor] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  const total = Math.max(0.5, totalSeconds)
  const g = items.find((item) => item.id === selected) ?? null
  useEffect(() => { if (selected && !items.some((item) => item.id === selected)) setSelected(null) }, [items, selected])
  const full = items.length >= limit
  const style = reelGraphicStyle(look)
  const at = Math.max(0, Math.min(total - 0.5, cursor))
  const Heading = heading

  const add = (template: GraphicTemplateId, look?: string): void => {
    const id = onAdd(template, at, template === 'fx' ? look : undefined)
    // An effect on the member's pictures starts with their first screenshots (they can pick others).
    const wanted = template === 'fx' ? fxPictureFields(fxEffect(look)).filter((f) => f.required) : []
    if (id && wanted.length && pictures?.options?.length) {
      const options = pictures.options
      onPatch(id, { fields: Object.fromEntries(wanted.map((f, i) => [f.key, options[Math.min(i, options.length - 1)].value])) })
    }
    if (id) setSelected(id)
    setPicking(false)
  }
  const field = (key: string, value: string): void => { if (g) onPatch(g.id, { fields: { [key]: value } }) }

  return <section className="space-y-3" aria-label={label}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Heading className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Shapes className="h-4 w-4" aria-hidden />{label} <span className="text-2xs font-normal text-ink-subtle">{items.length} / {limit}</span></Heading>
        <p className="text-2xs text-ink-subtle">{intro}</p>
      </div>
      <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={disabled || full || !!emptyNote} aria-expanded={picking}
        tooltip={full ? `Add up to ${limit} graphics.` : emptyNote ?? undefined} onClick={() => setPicking(!picking)}>Add a graphic</Button>
    </div>
    {emptyNote ? <p className="text-2xs text-ink-subtle">{emptyNote}</p> : <>
      <div ref={strip} className="reel-graphics-strip" role="group" aria-label={`${label} timeline`}
        title="Click to choose where a new graphic starts"
        onClick={(e) => { if (disabled) return; const box = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(total, (e.clientX - box.left) / box.width * total))) }}>
        {blocked.map((b, i) => <span key={i} className="blocked" title={b.label} style={{ left: `${b.start / total * 100}%`, width: `${Math.max(0.5, (b.end - b.start) / total * 100)}%` }} />)}
        {items.filter((item) => item.at !== null).map((item) => <button key={item.id} type="button"
          className={cn('block', item.id === selected && 'selected', item.problem && 'conflict')}
          style={{ left: `${(item.at as number) / total * 100}%`, width: `${Math.max(2.5, item.duration_ms / 1000 / total * 100)}%` }}
          aria-label={`${nameOf(item)} ${item.where}, ${(item.duration_ms / 1000).toFixed(1)} seconds`} aria-pressed={item.id === selected}
          title={item.problem ?? `${nameOf(item)} ${item.where}`}
          onClick={(e) => { e.stopPropagation(); setSelected(item.id); setPicking(false) }}>
          {(() => { const Icon = TEMPLATE_ICONS[item.template]; return <Icon className="h-3 w-3 shrink-0" aria-hidden /> })()}<span className="truncate">{graphicSummary(item) || <span className="font-medium">{SHORT[item.template]}</span>}</span>
        </button>)}
        <span className="playhead" style={{ left: `${at / total * 100}%` }} aria-hidden />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-2xs text-ink-subtle"><span>0:00</span><span>New graphics start {cursorLabel(at)}.</span><span>{clock(total)}</span></div>
    </>}
    {picking && <GraphicGallery templates={REEL_GRAPHIC_TEMPLATES} where={cursorLabel(at)} style={style} full={full || disabled} limitNote={`Add up to ${limit} graphics.`}
      prefill={prefill ? (template) => prefill(template, at) : undefined} pictures={!!pictures?.options?.length} onPick={add} onClose={() => setPicking(false)} />}
    {items.length > 0 && <div className="flex flex-wrap gap-1.5" role="list" aria-label="Your graphics">
      {items.map((item) => <button key={item.id} type="button" role="listitem" onClick={() => setSelected(item.id)}
        className={cn('rounded-full border px-2.5 py-1 text-2xs', item.id === selected ? 'border-tool/70 bg-tool/15 text-ink' : 'border-white/10 text-ink-muted hover:text-ink')}>
        {item.problem && <AlertTriangle className="mr-1 inline h-3 w-3 text-warning" aria-hidden />}{nameOf(item)} {item.where}
      </button>)}
    </div>}
    {g && <GraphicForm key={g.id} g={g} frame={frame} look={look} disabled={disabled} cursorLabel={cursorLabel(at)} pictures={pictures}
      onField={field} onPatch={(patch) => onPatch(g.id, patch)} onMoveHere={() => onPatch(g.id, { at })}
      onRemove={() => { onRemove(g.id); setSelected(null) }} />}
  </section>
}

/** One reel graphic's form (exported for tests). */
export function GraphicForm({ g, frame, look, disabled, cursorLabel, pictures, onField, onPatch, onMoveHere, onRemove }: {
  g: ReelGraphicItem; frame: GraphicFrame; look: HeadlineLook | null; disabled: boolean; cursorLabel: string; pictures?: EffectPictures
  onField: (key: string, value: string) => void; onPatch: (patch: ReelGraphicPatch) => void; onMoveHere: () => void; onRemove: () => void
}): React.JSX.Element {
  const info = templateInfo(g.template)
  const style = reelGraphicStyle(look, g)
  const spec = useMemo(() => {
    const drawn = reelGraphicSpec(g, frame, g.duration_ms, look)
    // An effect's pictures (the reel's screenshots) show in the small preview too.
    if (g.template === 'fx' && pictures) for (const f of fxPictureFields(fxEffect(g.fields.effect))) if (f.key === 'image' || f.key === 'image_b') drawn[f.key] = pictures.url(g.fields[f.key])
    return drawn
  }, [g, frame, look, pictures])
  const box = graphicBox(g.placement, frame)
  const input = 'w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-accent/70 focus:outline-none'
  return <div className="grid gap-4 rounded-xl border border-white/10 p-3 sm:grid-cols-[minmax(0,1fr)_132px]">
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">{g.template === 'fx' ? fxEffect(g.fields.effect)?.label ?? info.label : info.label} <span className="font-normal text-ink-subtle">{g.where}</span></p>
        <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove}>Remove</Button>
      </div>
      {g.problem && <p className="text-2xs text-warning" role="note">{g.problem}</p>}
      {!graphicHasContent(g) && <p className="text-2xs text-warning">Add its words to show it.</p>}
      {g.template === 'fx' && <EffectFields fields={g.fields} onField={onField} pictures={pictures} />}
      {info.fields.filter((k) => !['image', 'shape', 'x', 'y', 'icons', 'highlights', 'style', 'vertical', 'motion', 'labels', 'dot', 'icon', 'wrong', 'effect'].includes(k)).map((key) => <label key={key} className="block space-y-1 text-2xs text-ink-muted">{fieldLabel(g.template, key)}
        {key === 'items' || key === 'text' || key === 'notes'
          ? <textarea className={cn(input, 'resize-y')} rows={key === 'items' ? GRAPHIC_ITEM_LIMITS[g.template] ?? MAX_GRAPHIC_ITEMS : 2} maxLength={key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''}
            onChange={(e) => onField(key, e.target.value)} aria-label={`${info.label} ${fieldLabel(g.template, key).toLowerCase()}`} />
          : <input className={input} maxLength={MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''} onChange={(e) => onField(key, e.target.value)}
            aria-label={`${info.label} ${fieldLabel(g.template, key).toLowerCase()}`} placeholder={key === 'value' ? 'e.g. a number you said, like 40%' : undefined} />}
      </label>)}
      {g.template === 'icon_pop' && <IconFields fields={g.fields} onField={onField} imageNote={false} />}
      {g.template === 'big_words' && <BigWordsFields fields={g.fields} onField={onField} />}
      <DiagramFields template={g.template} fields={g.fields} onField={onField} />
      {(g.template === 'orbit' || g.template === 'feature_tile') && <IconFields fields={g.fields} onField={onField} template={g.template} imageNote={false} />}
      {g.template === 'orbit' && <div className="flex items-center justify-between gap-2 text-xs text-ink"><span>Labels under the icons</span>
        <Switch label="Labels under the icons" checked={g.fields.labels !== 'off'} onChange={(on) => onField('labels', on ? '' : 'off')} /></div>}
      {g.template === 'feature_tile' && <div className="flex items-center justify-between gap-2 text-xs text-ink"><span>Red dot on the first tile</span>
        <Switch label="Red dot on the first tile" checked={g.fields.dot === 'on'} onChange={(on) => onField('dot', on ? 'on' : '')} /></div>}
      {graphicCanGoBehind(g.template) && <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs text-ink"><span>Behind me</span>
          <Switch label="Behind me" checked={graphicDepth(g) === 'behind'} onChange={(on) => onPatch({ depth: on ? 'behind' : 'front' })} /></div>
        <p className="text-2xs text-ink-subtle">{graphicDepth(g) === 'behind' ? 'In the video you stand in front of it: you’re cut out and laid back over it. The small preview shows it in front.' : 'It sits over the video, in front of you.'}</p></div>}
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
        <input type="range" className="w-full accent-[rgb(var(--accent))]" aria-label="Graphic length" min={GRAPHIC_MIN_MS} max={graphicMaxMs(g.template)} step={100} value={g.duration_ms}
          onChange={(e) => onPatch({ duration_ms: Number(e.target.value) })} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onMoveHere}>Start it {cursorLabel}</Button>
        <span className="ml-auto flex items-center gap-2 text-2xs text-ink-muted">Color
          <input type="color" className="h-6 w-8 cursor-pointer rounded border border-white/10 bg-transparent" aria-label="Graphic color" value={(isHexColor(g.fields.color) ? g.fields.color : isDiagram(g.template) ? DIAGRAM_ACCENT : style.color).toLowerCase()}
            onChange={(e) => onField('color', e.target.value.toUpperCase())} />
          {isHexColor(g.fields.color) && <Button size="sm" variant="ghost" onClick={() => onPatch({ fields: { color: '' } })}>{isDiagram(g.template) ? 'Use green' : 'Use hook color'}</Button>}</span>
      </div>
    </fieldset>
    <div className="space-y-1">
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-b from-slate-700 to-slate-900" style={{ width: 132, height: 132 * 16 / 9 }} aria-label="Where it sits">
        {frame.hook > 0 && <div className="absolute inset-x-0 top-0 bg-white/80" style={{ height: `${frame.hook * 100}%` }} />}
        {(frame.blocked ?? []).map(([a, b], i) => <div key={i} className="absolute inset-x-0 border-y border-white/30 bg-white/10" style={{ top: `${a * 100}%`, height: `${(b - a) * 100}%` }} />)}
        {frame.captions && <div className="absolute inset-x-6 h-[3px] rounded bg-white/50" style={{ top: `${frame.captions.y * 100}%` }} />}
        <div className="absolute inset-0" style={{ outline: 'none' }}><GraphicView spec={spec} width={132} loop /></div>
        <div className="pointer-events-none absolute inset-x-0 border border-dashed border-tool/60" style={{ top: `${box.top * 100}%`, height: `${(box.bottom - box.top) * 100}%` }} />
      </div>
      <p className="text-[10px] leading-tight text-ink-subtle">{(frame.blocked ?? []).length ? 'Graphics stay clear of the hook text, the captions and their clip.' : 'Graphics stay clear of the hook text and the captions.'}</p>
    </div>
  </div>
}
