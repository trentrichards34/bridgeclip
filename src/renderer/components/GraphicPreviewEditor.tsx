/**
 * Editing graphics right on the Output preview: click a graphic to select it, drag it between the top, middle and
 * bottom (an arrow or circle moves to the spot), drag its handle to make it smaller or bigger, click it again to
 * change its words in place, and use the small toolbar over it (type, color, size, behind me, match my words,
 * duplicate, delete). The graphic itself is drawn by GraphicsOverlay with the same templates the bake renders, so
 * what the member sees is what bakes. Every change goes through the editor's change() (undo, redo, autosave).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { AudioLines, Copy, Pencil, Trash2, User, X } from 'lucide-react'
import {
  GRAPHIC_TEMPLATES, graphicsCap, MAX_GRAPHIC_FIELD_CHARS, WORD_TIMED_TEMPLATES, duplicateGraphic, fitGraphicInCut, graphicCanGoBehind, graphicDepth, graphicHasContent, graphicLocalMs,
  highlightPoint, isDiagram, placeInFreeBand, removeGraphic, templateInfo, updateGraphic, withGraphic, ITEM_TIMED_TEMPLATES,
  type EditorGraphic, type GraphicPlacement, type GraphicSize, type GraphicTemplateId, type TimedWord
} from '../../shared/motion-graphics'
import { graphicSpec, graphicStyle } from '../../shared/graphic-layout'
import { isHexColor } from '../../shared/headline-look'
import type { CandidateEdit, EditorProject } from '../../shared/clip-editor'
import { cn } from '../lib/utils'
import { GRAPHIC_GROUPS, fieldLabel, graphicsWithField, graphicsWithTemplate, matchGraphicWords, useOutputBounds } from './ClipGraphics'
import { TEMPLATE_ICONS } from './GraphicGallery'

/** The fields edited as words (the rest are choices, pictures or numbers set in the Graphics tab). */
const NOT_WORDS = ['image', 'shape', 'x', 'y', 'icons', 'style', 'vertical', 'motion', 'video', 'labels', 'dot', 'icon', 'wrong', 'highlights', 'from', 'zoom']
export const wordFields = (template: GraphicTemplateId): string[] => (templateInfo(template).fields as readonly string[]).filter((k) => !NOT_WORDS.includes(k))
const SIZES: { value: GraphicSize; label: string; short: string }[] = [{ value: 'compact', label: 'Small', short: 'S' }, { value: 'card', label: 'Card', short: 'M' }, { value: 'stage', label: 'Stage', short: 'L' }]
const PLACES: GraphicPlacement[] = ['top', 'middle', 'bottom']
/** Templates whose size can change (a chapter header, big words and an arrow have their own). */
const sizable = (template: GraphicTemplateId): boolean => !['chapter', 'big_words', 'highlight'].includes(template)
const movable = (template: GraphicTemplateId): boolean => template !== 'chapter'

/** One word field, edited in place: plain text, Enter for a new line in a list, Escape when done. */
function WordField({ value, label, multiline, autoFocus, onText, onDone }: {
  value: string; label: string; multiline: boolean; autoFocus: boolean; onText: (text: string) => void; onDone: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.innerText !== value) el.innerText = value
  }, [value])
  useEffect(() => {
    const el = ref.current
    if (!autoFocus || !el) return
    el.focus({ preventScroll: true })
    // Caret at the end.
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
    const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range)
  }, [autoFocus])
  return <div ref={ref} className={cn('editor-word-field', multiline && 'multiline')} role="textbox" aria-multiline={multiline} aria-label={label}
    contentEditable="plaintext-only" suppressContentEditableWarning spellCheck
    onInput={(e) => {
      const raw = e.currentTarget.innerText.replace(/\u00a0/g, ' ')
      onText(multiline ? raw.slice(0, MAX_GRAPHIC_FIELD_CHARS * 5) : raw.replace(/\s*\n\s*/g, ' ').slice(0, MAX_GRAPHIC_FIELD_CHARS))
    }}
    onKeyDown={(e) => {
      e.stopPropagation()
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !multiline))) { e.preventDefault(); onDone() }
    }} />
}

export function GraphicPreviewEditor({ canvas, project, candidate, time, selected, words, disabled, playing, onSelect, onChange, onDrag }: {
  canvas: RefObject<HTMLCanvasElement | null>; project: EditorProject; candidate: CandidateEdit; time: number; selected: string | null
  words: readonly TimedWord[]; disabled: boolean; playing: boolean
  onSelect: (id: string | null) => void; onChange: (graphics: EditorGraphic[], remember?: boolean) => void
  /** A drag on the preview starts or ends (the editor pauses and holds autosave). */
  onDrag: (active: boolean) => void
}): React.JSX.Element | null {
  const bounds = useOutputBounds(canvas, project.aspect_ratio)
  const [editing, setEditing] = useState(false)
  const [guides, setGuides] = useState<{ place: GraphicPlacement; top: number; bottom: number }[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const typed = useRef(false)
  useEffect(() => { setEditing(false); setNote(null); typed.current = false }, [selected])
  useEffect(() => { if (!editing) typed.current = false }, [editing])
  useEffect(() => { if (playing) setEditing(false) }, [playing])
  const W = bounds.width, H = bounds.height
  const graphics = candidate.graphics ?? []
  const shown = graphics.flatMap((g) => {
    if (graphicLocalMs(candidate, g, time) === null) return []
    const spec = graphicSpec(project, candidate, g)
    return spec ? [{ g, spec }] : []
  })
  if (!W || !shown.length) return null
  const rectOf = (g: EditorGraphic, box: { top: number; bottom: number }): { left: number; top: number; width: number; height: number } => {
    if (g.template === 'highlight') {
      const p = highlightPoint(g.fields), r = Math.min(W, H) * .16
      return { left: p.x * W - r, top: p.y * H - r, width: r * 2, height: r * 2 }
    }
    return { left: W * .03, top: box.top * H, width: W * .94, height: Math.max(18, (box.bottom - box.top) * H) }
  }
  const current = shown.find(({ g }) => g.id === selected) ?? null
  const g = current?.g ?? null

  /** Drag the selected graphic: between the bands (an arrow or circle: to the spot), or its handle: its size. */
  const startDrag = (e: React.PointerEvent<HTMLElement>, mode: 'move' | 'size'): void => {
    if (!g || disabled || e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const target = e.currentTarget, startX = e.clientX, startY = e.clientY, wasSelected = selected === g.id
    const area = target.closest('.editor-graphic-stage')!.getBoundingClientRect()
    let moved = false, first = true
    target.setPointerCapture(e.pointerId)
    const slots = PLACES.flatMap((place) => {
      const spec = graphicSpec(project, candidate, { ...g, placement: place, ...(g.size === 'stage' ? { size: 'card' as const } : {}) })
      return spec ? [{ place, top: spec.box.top, bottom: spec.box.bottom }] : []
    })
    const sizeIndex = Math.max(0, SIZES.findIndex((s) => s.value === (g.size ?? 'card')))
    let last: string = mode === 'size' ? g.size ?? 'card' : g.template === 'highlight' ? '' : g.placement
    const commit = (graphicsNext: EditorGraphic[]): void => { onChange(graphicsNext, first); first = false }
    const move = (event: PointerEvent): void => {
      if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 4) return
      if (!moved) { moved = true; onDrag(true); if (mode === 'move' && g.template !== 'highlight' && movable(g.template)) setGuides(slots) }
      if (mode === 'size') {
        const step = Math.round((event.clientY - startY) / 36)
        const size = SIZES[Math.max(0, Math.min(SIZES.length - 1, sizeIndex + step))].value
        if (size !== last) { last = size; commit(updateGraphic(candidate, g.id, { size })) }
        return
      }
      if (g.template === 'highlight') {
        const x = Math.max(0, Math.min(1, (event.clientX - area.left) / area.width)), y = Math.max(0, Math.min(1, (event.clientY - area.top) / area.height))
        commit(updateGraphic(candidate, g.id, { fields: { x: x.toFixed(3), y: y.toFixed(3) } }))
        return
      }
      if (!movable(g.template)) return
      const y = (event.clientY - area.top) / area.height
      const nearest = slots.reduce((best, s) => Math.abs((s.top + s.bottom) / 2 - y) < Math.abs((best.top + best.bottom) / 2 - y) ? s : best, slots[0])
      if (nearest && nearest.place !== last) { last = nearest.place; commit(updateGraphic(candidate, g.id, { placement: nearest.place, ...(g.size === 'stage' ? { size: 'card' as const } : {}) })) }
    }
    const done = (): void => {
      target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', done)
      setGuides(null)
      if (moved) onDrag(false)
      // A click (no drag) on the selected graphic: change its words in place.
      else if (mode === 'move' && wasSelected && !playing) setEditing(true)
    }
    target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', done)
  }

  const fields = g ? wordFields(g.template) : []
  const frame = current ? rectOf(current.g, current.spec.box) : null
  const above = frame ? frame.top + frame.height / 2 > H / 2 : false
  const style = g ? graphicStyle(candidate, g) : null
  const ownColor = g && isHexColor(g.fields.color)
  const cap = graphicsCap(project)
  const full = graphics.length >= cap
  const duplicate = (): void => {
    if (!g || full) return
    const ids = graphics.map((x) => x.id)
    const after = fitGraphicInCut(duplicateGraphic(g, ids), candidate)
    const copy = after && after.at_ms >= g.at_ms + g.duration_ms - 50 ? after : placeInFreeBand(graphics, { ...duplicateGraphic(g, ids, g.at_ms) })
    onChange(withGraphic(candidate, copy, cap)); onSelect(copy.id)
  }
  const match = (): void => {
    if (!g) return
    const { graphics: next, note: text } = matchGraphicWords(candidate, g, words)
    if (next) onChange(next)
    setNote(text)
  }
  // Beside the video when the pane has room (the graphic stays in view), else on the video.
  const side = bounds.outer - bounds.left - W >= 240 ? 'right' : bounds.left >= 240 ? 'left' : null
  // On the video, the toolbar sits on the side of the graphic with more room (above a low one, below a high one).
  const toolbarTop = frame ? (above ? Math.max(-34, frame.top - 40) : Math.min(H - 6, frame.top + frame.height + 12)) : 0
  const toolbarAt: React.CSSProperties = !frame ? {} : side ? { [side === 'right' ? 'left' : 'right']: W + 14, top: Math.max(0, Math.min(H - 110, frame.top)), width: 210 }
    : { top: toolbarTop, maxWidth: Math.max(W + 40, 250) }
  const wordsAt: React.CSSProperties = !frame ? {} : side ? { [side === 'right' ? 'left' : 'right']: W + 14, width: 226, top: Math.max(0, Math.min(H - 220, frame.top)) }
    : above ? { left: 6, right: 6, bottom: H - frame.top + 8 } : { left: 6, right: 6, top: Math.min(H - 60, frame.top + frame.height + 8) }
  return <div className="editor-graphic-stage" style={{ left: bounds.left, top: bounds.top, width: W, height: H }} data-testid="graphic-stage">
    {guides && guides.map((s) => <div key={s.place} aria-hidden className={cn('editor-graphic-slot', g?.placement === s.place && 'active')} style={{ top: s.top * H, height: Math.max(14, (s.bottom - s.top) * H) }}>
      <span>{s.place === 'top' ? 'Top' : s.place === 'middle' ? 'Middle' : 'Bottom'}</span></div>)}
    {shown.filter(({ g: x }) => x.id !== selected).map(({ g: x, spec }) => {
      const r = rectOf(x, spec.box)
      return <button key={x.id} type="button" className="editor-graphic-hit" style={r} aria-label={`Select the ${templateInfo(x.template).label.toLowerCase()} on the preview`}
        title={`${templateInfo(x.template).label} · Click to select, then drag to move or click again to change the words`}
        onClick={(e) => { e.stopPropagation(); onSelect(x.id) }} />
    })}
    {g && frame && <>
      <div className={cn('editor-graphic-frame', g.template === 'highlight' && 'round', !graphicHasContent(g) && 'empty')} style={frame} role="button" tabIndex={0}
        aria-label={`${templateInfo(g.template).label} on the preview. Click to change its words; drag to move it; arrow keys move it up or down.`}
        onPointerDown={(e) => startDrag(e, 'move')} onDoubleClick={() => { if (!playing) setEditing(true) }}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setEditing(true) }
          else if ((e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); e.stopPropagation(); onChange(removeGraphic(candidate, g.id)); onSelect(null) }
          else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && movable(g.template) && g.template !== 'highlight') {
            e.preventDefault(); e.stopPropagation()
            const i = PLACES.indexOf(g.placement), next = PLACES[Math.max(0, Math.min(2, i + (e.key === 'ArrowUp' ? -1 : 1)))]
            if (next !== g.placement || g.size === 'stage') onChange(updateGraphic(candidate, g.id, { placement: next, ...(g.size === 'stage' ? { size: 'card' as const } : {}) }))
          }
        }}>
        {!graphicHasContent(g) && <span className="editor-graphic-frame-hint">Click to add its words</span>}
        {sizable(g.template) && !disabled && <span className="editor-graphic-size-handle" role="presentation" title="Drag up or down to make it smaller or bigger" onPointerDown={(e) => startDrag(e, 'size')} />}
      </div>
      {!playing && !editing && <div className={cn('editor-graphic-toolbar', side && `beside ${side}`)} role="toolbar" aria-label="Graphic tools" style={toolbarAt} onPointerDown={(e) => e.stopPropagation()}>
        <label className="editor-graphic-type" title="Change the type; your words stay">
          {(() => { const Icon = TEMPLATE_ICONS[g.template]; return <Icon size={12} aria-hidden /> })()}
          <select aria-label="Change graphic type" value={g.template} disabled={disabled} onChange={(e) => onChange(graphicsWithTemplate(candidate, g, e.target.value as GraphicTemplateId, words))}>
            {GRAPHIC_GROUPS.map((group) => <optgroup key={group.id} label={group.label}>{GRAPHIC_TEMPLATES.filter((t) => group.templates.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}
          </select></label>
        <span className="editor-graphic-tool-sep" aria-hidden />
        <button type="button" className={cn('editor-graphic-swatch', !ownColor && 'selected')} disabled={disabled} aria-pressed={!ownColor}
          aria-label={isDiagram(g.template) ? 'Use the usual green' : 'Use the hook’s brand color'} title={isDiagram(g.template) ? 'The usual green' : 'Your hook’s brand color'}
          style={{ '--swatch': isDiagram(g.template) ? '#7CB82F' : graphicStyle(candidate).color } as React.CSSProperties}
          onClick={() => onChange(updateGraphic(candidate, g.id, { fields: { color: '' } }))} />
        <label className={cn('editor-graphic-swatch custom', ownColor && 'selected')} title="Pick a color" style={{ '--swatch': style?.color } as React.CSSProperties}>
          <input type="color" aria-label="Pick a color for this graphic" disabled={disabled} value={(style?.color ?? '#2F5BFF').toLowerCase()} onChange={(e) => onChange(updateGraphic(candidate, g.id, { fields: { color: e.target.value.toUpperCase() } }), !ownColor)} /></label>
        {sizable(g.template) && <><span className="editor-graphic-tool-sep" aria-hidden />
          <span className="editor-graphic-sizes" role="group" aria-label="Size on the video">{SIZES.map((s) => <button key={s.value} type="button" disabled={disabled} aria-pressed={(g.size ?? 'card') === s.value} title={s.label}
            aria-label={`${s.label} size`} onClick={() => onChange(updateGraphic(candidate, g.id, { size: s.value }))}>{s.short}</button>)}</span></>}
        <span className="editor-graphic-tool-sep" aria-hidden />
        {graphicCanGoBehind(g.template) && <button type="button" disabled={disabled} aria-pressed={graphicDepth(g) === 'behind'} aria-label={graphicDepth(g) === 'behind' ? 'Bring it in front of me' : 'Put it behind me'}
          title={graphicDepth(g) === 'behind' ? 'Behind you in the export. Click to put it in front.' : 'Put the words behind you (in the export you stand in front of them).'}
          onClick={() => onChange(updateGraphic(candidate, g.id, { depth: graphicDepth(g) === 'behind' ? 'front' : 'behind' }))}><User size={13} aria-hidden /></button>}
        {(WORD_TIMED_TEMPLATES.includes(g.template) || ITEM_TIMED_TEMPLATES.includes(g.template)) && <button type="button" disabled={disabled} aria-label="Match to my voice"
          title="Match my words: show each word (or item) as you say it" onClick={match}><AudioLines size={13} aria-hidden /></button>}
        {fields.length > 0 && <button type="button" disabled={disabled} aria-label="Edit words on the video" title="Change the words here (or click the graphic)" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden /></button>}
        <button type="button" disabled={disabled || full} aria-label="Duplicate graphic" title={full ? `A clip can have up to ${cap} graphics.` : 'Make a copy right after it (Ctrl/Cmd+D)'} onClick={duplicate}><Copy size={13} aria-hidden /></button>
        <button type="button" disabled={disabled} aria-label="Delete graphic" title="Delete (Delete key)" className="danger" onClick={() => { onChange(removeGraphic(candidate, g.id)); onSelect(null) }}><Trash2 size={13} aria-hidden /></button>
      </div>}
      {note && !editing && !playing && <p role="status" className="editor-graphic-stage-note" style={above ? { top: 8 } : { bottom: 8 }}>{note}<button type="button" aria-label="Dismiss" onClick={() => setNote(null)}><X size={11} /></button></p>}
      {editing && fields.length > 0 && <div className={cn('editor-word-editor', side && `beside ${side}`)} role="group" aria-label="Words on the video" style={wordsAt}
        onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2"><span className="editor-word-editor-title">{templateInfo(g.template).label} · words</span>
          <button type="button" className="editor-word-editor-done" onClick={() => setEditing(false)}>Done</button></div>
        {fields.map((key, i) => <label key={`${g.id}-${key}`} className="editor-word-editor-field"><span>{fieldLabel(g.template, key)}</span>
          <WordField value={g.fields[key] ?? ''} label={`${fieldLabel(g.template, key)} on the video`} multiline={key === 'items' || key === 'notes'} autoFocus={i === 0}
            onText={(text) => { onChange(graphicsWithField(candidate, g, key, text, words), !typed.current); typed.current = true }} onDone={() => setEditing(false)} /></label>)}
        <p className="text-[10px] text-ink-subtle">{fields.includes('items') ? 'One per line. ' : ''}Use the words you say. Esc when done.</p>
      </div>}
    </>}
  </div>
}
