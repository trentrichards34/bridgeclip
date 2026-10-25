/**
 * Motion graphics in the clip editor: the Graphics row under the cut, the
 * Graphics inspector tab (template picker and field form), and the live
 * overlay on the Output monitor. Everything edits `candidate.graphics` through
 * the editor's `change()` (undo, redo and autosave like any other edit). The
 * overlay and the picker run the same template code the bake renders
 * offscreen (src/renderer/graphics/templates.ts).
 */
import { LogoPickRow } from './MyLogos'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { AlertTriangle, Plus, Trash2, ImagePlus, Shapes, Film, AudioLines, Sparkles, Bookmark, Eraser, RotateCcw, Wand2 } from 'lucide-react'
import type { MountedGraphic } from '../graphics/templates'
import {
  CHAPTER_STYLES, DIAGRAM_ACCENT, GRAPHIC_DEFAULT_MS, GRAPHIC_ICONS, GRAPHIC_ITEM_LIMITS, GRAPHIC_MIN_MS, GRAPHIC_TEMPLATES, MAX_GRAPHICS_PER_CLIP, MAX_GRAPHIC_ITEMS, graphicsCap, MAX_GRAPHIC_FIELD_CHARS,
  ITEM_TIMED_TEMPLATES, matchFxCues, graphicVariant, graphicVariants, bigWordsOptions, chapterStyle, clampGraphicMs, duplicateGraphic, compareWrong, graphicMaxMs, growthStyle, hubIcon, isDiagram, matchItemTimes, type ChapterStyle, fitGraphicInCut, graphicCanGoBehind, graphicClashes, graphicCutFit, graphicDepth, graphicHasContent, graphicIcons, isGraphicTemplate, graphicPictureFields, graphicUsesImage, placeInFreeBand, graphicLocalMs, highlightPoint, matchCardWords, newGraphic, removeGraphic, screenFrom, screenShape, switchGraphicTemplate, templateInfo, templateItems, updateGraphic, withGraphic,
  MAX_BIG_WORDS, MAX_TAKEOVER_WORDS, SCREEN_VIDEO_FILE, ctaKind, type CtaKind, WORD_TIMED_TEMPLATES, type BigWordsMotion, type BigWordsStyle, type EditorGraphic, type GraphicPlacement, type GraphicRenderSpec, type GraphicSize, type GraphicTemplateId, type ScreenShape, type TimedWord
} from '../../shared/motion-graphics'
import { GRAPHIC_DEFAULT_COLOR, graphicOwnFont, graphicSpec, graphicStyle } from '../../shared/graphic-layout'
import { prefillEffect, prefillGraphic, spokenSteps } from '../../shared/graphic-prefill'
import { FX_EFFECTS, FX_GROUPS, fxEffect, fxLine, fxNeedsPicture, fxRegion, fxRegionText } from '../../shared/fx-catalog'
import { HighlightPicker } from './ClipLayoutSections'
import type { CandidateEdit, EditorProject } from '../../shared/clip-editor'
import { isHexColor } from '../../shared/headline-look'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import type { EditorCustomInfo } from '../../shared/custom-graphics'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { Select } from './ui/Select'
import { Switch } from './ui/Switch'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { TEMPLATE_ICONS } from './GraphicGallery'
import { FX_SAMPLE_MARKS } from '../graphics/fx/samples'

/** Where a graphic's picture lives in the run (copied there by main). */
export function graphicImageUrl(outputDir: string, name: string | undefined): string | undefined {
  return name && /^[a-f0-9]{16}\.(png|jpg|webp)$/.test(name) ? localFileUrl(`${outputDir.replace(/[\\/]+$/, '')}/.graphics/images/${name}`) : undefined
}

/** Where a Screen recording's video file lives in the run (copied there by main). */
export function graphicVideoUrl(outputDir: string, name: string | undefined): string | undefined {
  return name && SCREEN_VIDEO_FILE.test(name) ? localFileUrl(`${outputDir.replace(/[\\/]+$/, '')}/.graphics/videos/${name}`) : undefined
}

// The templates (and anime.js) load with the first graphic shown, not with the app.
let templates: Promise<typeof import('../graphics/templates')> | null = null
const loadTemplates = (): Promise<typeof import('../graphics/templates')> => (templates ??= import('../graphics/templates'))

/** One template drawn at `width` CSS pixels: seeked to `time` (output ms into the graphic), or looping on its own. */
export function GraphicView({ spec, time, width, loop, offset = 0, className }: { spec: GraphicRenderSpec; time?: number | null; width: number; loop?: boolean; className?: string
  /** Looping: start this far (ms) into the animation, so tiles side by side don't all come in at once. */
  offset?: number }): React.JSX.Element {
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
        const started = performance.now() - offset, cycle = (JSON.parse(key) as GraphicRenderSpec).duration_ms + 700
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

/** Where the Output monitor's picture sits in its pane (the canvas, letterboxed to its aspect), in CSS pixels. */
export function useOutputBounds(canvas: RefObject<HTMLCanvasElement | null>, aspectKey: string): { width: number; height: number; left: number; top: number; outer: number } {
  const [bounds, setBounds] = useState({ width: 0, height: 0, left: 0, top: 0, outer: 0 })
  useEffect(() => {
    const element = canvas.current, parent = element?.parentElement
    if (!element || !parent) return
    const measure = (): void => {
      const box = element.getBoundingClientRect(), outer = parent.getBoundingClientRect()
      const aspect = element.width / element.height
      const width = Math.min(box.width, box.height * aspect), height = width / aspect
      setBounds({ width, height, left: box.left - outer.left + (box.width - width) / 2, top: box.top - outer.top + (box.height - height) / 2, outer: outer.width })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); observer.observe(parent); measure()
    return () => observer.disconnect()
  }, [canvas, aspectKey])
  return bounds
}

/** The real animations over the Output monitor, at the playhead. */
export function GraphicsOverlay({ canvas, project, candidate, time, outputDir, sourceUrl }: {
  canvas: RefObject<HTMLCanvasElement | null>; project: EditorProject; candidate: CandidateEdit; time: number; outputDir: string
  /** The clip's own video (the editor's preview of the source), for a Screen recording that shows part of it. */
  sourceUrl?: string
}): React.JSX.Element | null {
  const bounds = useOutputBounds(canvas, project.aspect_ratio)
  const stills = useEditorCustomInfo(outputDir, (candidate.graphics ?? []).filter((g) => g.template === 'custom').map((g) => g.fields.comp ?? ''))
  const shown = (candidate.graphics ?? []).flatMap((g) => {
    const local = graphicLocalMs(candidate, g, time)
    if (local === null || !graphicHasContent(g)) return []
    const spec = graphicSpec(project, candidate, g)
    if (!spec) return []
    for (const key of graphicPictureFields(g)) spec[key] = graphicImageUrl(outputDir, g.fields[key])
    if (g.template === 'custom') spec.stills = (stills[g.fields.comp ?? '']?.stills ?? []).map((path) => localFileUrl(path))
    if (g.template === 'screen_frame') {
      // The preview plays the video in the window (the export lays it in with the engine).
      const url = g.fields.video === 'source' ? sourceUrl : graphicVideoUrl(outputDir, g.fields.video)
      if (url) spec.preview_video = { url, from: screenFrom(g.fields) }
    }
    return [{ g, spec, local }]
  })
  if (!bounds.width || !shown.length) return null
  // The preview can't cut the speaker out: a graphic set behind them shows in front, with a note.
  const behind = shown.some(({ g }) => graphicDepth(g) === 'behind')
  const between = shown.some(({ g }) => graphicDepth(g) === 'between')
  return <div className="editor-graphics-overlay" style={{ width: bounds.width, height: bounds.height, left: bounds.left, top: bounds.top }}>
    <div aria-hidden>{shown.map(({ g, spec, local }) => <GraphicView key={g.id} spec={spec} time={local} width={bounds.width} />)}</div>
    {behind && <span className="editor-graphic-depth-badge" title="This preview shows the words in front. The exported clip puts them behind you.">Behind you in the export</span>}
    {between && !behind && <span className="editor-graphic-depth-badge" title="This preview shows the words only. The exported clip softens the room and puts your head between the lines.">Head between the lines in the export</span>}
  </div>
}

/** Custom graphics' info (idea, grade, stills, the template they replaced), fetched once per composition. */
const customInfoCache = new Map<string, EditorCustomInfo>()
export function useEditorCustomInfo(outputDir: string, comps: readonly string[]): Record<string, EditorCustomInfo> {
  const [info, setInfo] = useState<Record<string, EditorCustomInfo>>({})
  const key = [...new Set(comps.filter(Boolean))].sort().join(',')
  useEffect(() => {
    let live = true
    for (const comp of key ? key.split(',') : []) {
      const cached = customInfoCache.get(`${outputDir}:${comp}`)
      if (cached) { setInfo((current) => current[comp] ? current : { ...current, [comp]: cached }); continue }
      if (typeof getApi().editor.customInfo !== 'function') continue
      void getApi().editor.customInfo(outputDir, comp).then((found) => {
        customInfoCache.set(`${outputDir}:${comp}`, found)
        if (live) setInfo((current) => ({ ...current, [comp]: found }))
      }).catch(() => undefined)
    }
    return () => { live = false }
  }, [outputDir, key])
  return info
}

/**
 * A custom graphic in the inspector: its stills, what it shows, its grade, a note to design it again ("use a rocket
 * instead", paid) and going back to the template graphic it replaced.
 */
function CustomGraphicFields({ outputDir, candidate, graphic, disabled, onChange }: {
  outputDir: string; candidate: CandidateEdit; graphic: EditorGraphic; disabled: boolean; onChange: (graphics: EditorGraphic[]) => void
}): React.JSX.Element {
  const comp = graphic.fields.comp ?? ''
  const info = useEditorCustomInfo(outputDir, [comp])[comp]
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  useEffect(() => { setNote(''); setMessage(null) }, [graphic.id])
  const replace = (next: EditorGraphic): void => onChange((candidate.graphics ?? []).map((x) => x.id === graphic.id ? next : x))
  const redesign = async (): Promise<void> => {
    if (!note.trim()) return
    setBusy(true); setMessage(null)
    try {
      const result = await getApi().editor.customGraphic(outputDir, candidate.id, graphic, note.trim())
      if (result.graphic) { replace(result.graphic); setNote(''); setMessage({ tone: 'info', text: 'Designed again and checked over your video.' }) }
      else setMessage({ tone: 'error', text: result.reason ?? 'The new design didn’t pass the check, so your graphic stays as it was.' })
    } catch (err) { setMessage({ tone: 'error', text: errorMessage(err, 'It could not be designed again.') }) } finally { setBusy(false) }
  }
  const swapBack = (): void => {
    const fb = info?.fallback
    if (!fb || !isGraphicTemplate(fb.template)) { onChange(removeGraphic(candidate, graphic.id)); return }
    replace({ id: graphic.id, template: fb.template, at_ms: graphic.at_ms, duration_ms: Math.min(fb.duration_ms, graphicMaxMs(fb.template)), placement: (['top', 'middle', 'bottom'] as const).find((p) => p === fb.placement) ?? 'middle',
      fields: fb.fields, ...(fb.size === 'compact' || fb.size === 'card' || fb.size === 'stage' ? { size: fb.size } : {}), ...(fb.origin === 'auto' || fb.origin === 'member' || fb.origin === 'chat' ? { origin: fb.origin } : {}) })
  }
  return <div className="space-y-2" data-testid="custom-graphic-fields">
    <p className="text-2xs text-ink-subtle">{info ? `${info.idea}. Designed by your AI for this moment and checked over your video${info.tries > 1 ? ` (fixed ${info.tries - 1} time${info.tries === 2 ? '' : 's'})` : ''}.` : 'Designed by your AI for this moment.'}</p>
    {info?.stills.length ? <div className="grid grid-cols-3 gap-1" aria-label="Stills: coming in, settled, leaving">
      {info.stills.map((path, i) => <img key={path} src={localFileUrl(path)} alt={['Coming in', 'Settled', 'Leaving'][i] ?? ''} className="w-full rounded-md bg-black/60" />)}</div> : null}
    <label className="editor-label">Change it
      <textarea rows={2} maxLength={300} value={note} disabled={disabled || busy} placeholder="Like “make it a staircase” or “use a rocket instead”" aria-label="What to change in the custom graphic" onChange={(e) => setNote(e.target.value)} /></label>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" icon={<Wand2 size={13} />} loading={busy} disabled={disabled || busy || !note.trim()} onClick={() => void redesign()} tooltip="Your AI designs it again with your note, then checks it over your video.">Design again</Button>
      <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={disabled || busy} onClick={swapBack}>{info?.fallback ? 'Use the template instead' : 'Remove it'}</Button>
    </div>
    <p className="text-2xs text-ink-subtle">Designing again uses your OpenRouter credit (about $0.15 to $0.35). The export draws it from what’s saved in this run.</p>
    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={cn('text-2xs', message.tone === 'error' ? 'text-danger' : 'text-ink-subtle')}>{message.text}</p>}
  </div>
}

export const SHORT: Record<GraphicTemplateId, string> = {
  stat: 'Stat', title: 'Title', list: 'List', lower_third: 'Name', logo: 'Logo', before_after: 'Before/after', checklist: 'Checklist', quote: 'Quote', highlight: 'Arrow/circle',
  statement: 'Statement', sticky_notes: 'Notes', strike_list: 'Crossed out', browser_frame: 'Browser', icon_pop: 'Icons', headline_pill: 'Headline', comment_cta: 'Comment', link_cta: 'Call to action',
  big_words: 'Big words', orbit: 'Orbit', feature_tile: 'Tiles', screen_frame: 'Screen',
  chapter: 'Chapter', staircase: 'Stairs', funnel: 'Funnel', journey: 'Journey', growth: 'Growth', idea_hub: 'Idea hub', compare_marks: 'Wrong/right', fx: 'Effect', takeover: 'Takeover', custom: 'Custom'
}
export function graphicSummary(g: Pick<EditorGraphic, 'template' | 'fields'>): string {
  const f = g.fields
  if (g.template === 'fx') return [fxEffect(f.effect)?.label, fxLine(f)].filter(Boolean).join(' · ')
  const first = (f.items ?? '').split('\n')[0]
  const words = g.template === 'stat' ? [f.value, f.label] : g.template === 'lower_third' ? [f.name, f.role] : g.template === 'before_after' ? [f.before, f.after]
    : g.template === 'list' || g.template === 'checklist' ? [f.title, first] : g.template === 'logo' ? [f.caption] : g.template === 'highlight' ? [f.shape === 'arrow' ? 'Arrow' : 'Circle']
      : g.template === 'sticky_notes' || g.template === 'icon_pop' ? [first] : g.template === 'strike_list' ? [first, f.final] : g.template === 'browser_frame' ? [f.domain, f.title]
        : g.template === 'headline_pill' ? [f.text, f.phrase] : g.template === 'comment_cta' ? [f.keyword] : g.template === 'link_cta' ? [f.text, f.where] : g.template === 'orbit' ? [f.text, first]
          : g.template === 'feature_tile' ? [first] : g.template === 'screen_frame' ? [f.label || (f.video === 'source' ? 'This clip' : f.video ? 'Your video' : '')]
            : g.template === 'chapter' ? [[f.label, f.title].map((w) => w?.trim()).filter(Boolean).join(' ')] : g.template === 'idea_hub' ? [f.text, first]
              : isDiagram(g.template) ? [f.title, first] : [f.text]
  return words.map((w) => w?.trim()).filter(Boolean).join(' · ')
}

/** The picker's groups (and each graphic's color on the timeline). A template missing here shows under "More". */
export type GraphicGroup = 'text' | 'lists' | 'diagrams' | 'media' | 'ending'
export const GRAPHIC_GROUPS: { id: GraphicGroup; label: string; templates: readonly GraphicTemplateId[] }[] = [
  { id: 'text', label: 'Text', templates: ['title', 'statement', 'big_words', 'takeover', 'headline_pill', 'stat', 'quote', 'lower_third', 'chapter'] },
  { id: 'lists', label: 'Lists & steps', templates: ['list', 'checklist', 'sticky_notes', 'strike_list', 'before_after', 'icon_pop', 'feature_tile'] },
  { id: 'diagrams', label: 'Diagrams', templates: ['staircase', 'funnel', 'journey', 'growth', 'idea_hub', 'compare_marks', 'orbit'] },
  { id: 'media', label: 'Media', templates: ['logo', 'browser_frame', 'screen_frame', 'highlight'] },
  { id: 'ending', label: 'Ending', templates: ['link_cta', 'comment_cta'] }
]
export function graphicGroup(template: GraphicTemplateId): GraphicGroup | 'other' {
  return GRAPHIC_GROUPS.find((g) => g.templates.includes(template))?.id ?? 'other'
}

/** The Graphics row on the timeline: one block per graphic at its source time. */
export function GraphicsTrack({ candidate, viewStart, viewEnd, selected, disabled, onSelect, onChange, onDrag, onAdd, onAddAt, clock, cap = MAX_GRAPHICS_PER_CLIP }: {
  candidate: CandidateEdit; viewStart: number; viewEnd: number; selected: string | null; disabled: boolean
  /** Most graphics this clip may have (graphicsCap: a YouTube video's is higher). */
  cap?: number
  onSelect: (id: string) => void; onChange: (graphics: EditorGraphic[], remember: boolean) => void
  /** A drag starts or ends (the editor holds the timeline's zoom and autosave meanwhile). */
  onDrag: (active: boolean) => void; onAdd: () => void; clock: (ms: number) => string
  /** Right-click or double-click on the row: add a graphic at that time (source ms). */
  onAddAt?: (ms: number) => void
}): React.JSX.Element {
  const graphics = candidate.graphics ?? []
  const span = viewEnd - viewStart
  // Two lanes when graphics overlap.
  const lanes: number[] = []
  const ends = [-Infinity, -Infinity]
  for (const g of graphics) { const lane = g.at_ms >= ends[0] ? 0 : 1; lanes.push(lane); ends[lane] = Math.max(ends[lane], g.at_ms + g.duration_ms) }
  const stacked = lanes.includes(1)
  const clashes = graphicClashes(graphics)
  const full = graphics.length >= cap
  const startDrag = (e: React.PointerEvent<HTMLElement>, g: EditorGraphic, mode: 'move' | 'start' | 'end'): void => {
    if (disabled || e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const target = e.currentTarget, track = target.closest('.editor-graphics-track')!.getBoundingClientRect(), x = e.clientX
    const clipStart = candidate.ranges[0][0], clipEnd = candidate.ranges[candidate.ranges.length - 1][1]
    // Alt-drag (Option on a Mac): drag a copy, leaving the graphic where it was.
    const copy = mode === 'move' && e.altKey && !full ? duplicateGraphic(g, graphics.map((x) => x.id), g.at_ms) : null
    let base: CandidateEdit = candidate, moved = false
    if (copy) { base = { ...candidate, graphics: withGraphic(candidate, copy, cap) }; onChange(base.graphics!, true) }
    const dragged = copy ?? g
    target.setPointerCapture(e.pointerId)
    onSelect(dragged.id); onDrag(true)
    const move = (event: PointerEvent): void => {
      if (!moved && Math.abs(event.clientX - x) < 3) return
      const dt = Math.round((event.clientX - x) / track.width * span)
      const end = dragged.at_ms + dragged.duration_ms
      const patch = mode === 'move' ? { at_ms: Math.max(clipStart, Math.min(clipEnd - Math.min(dragged.duration_ms, clipEnd - clipStart), dragged.at_ms + dt)) }
        : mode === 'start' ? (() => { const at = Math.max(clipStart, end - graphicMaxMs(dragged.template), Math.min(end - GRAPHIC_MIN_MS, dragged.at_ms + dt)); return { at_ms: at, duration_ms: end - at } })()
        : { duration_ms: clampGraphicMs(Math.min(clipEnd - dragged.at_ms, dragged.duration_ms + dt), dragged.template) }
      onChange(updateGraphic(base, dragged.id, patch), !moved && !copy)
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
  /** The source time under the pointer on the row. */
  const timeAt = (e: React.MouseEvent<HTMLElement>): number => {
    const box = e.currentTarget.getBoundingClientRect()
    return Math.round(viewStart + Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * span)
  }
  return <div className="editor-graphics-row">
    <div className="editor-graphics-label editor-lane-head"><Shapes size={11} aria-hidden /><span className="editor-lane-name">Graphics</span>
      <Button size="sm" variant="ghost" iconOnly aria-label="Add graphic at playhead" icon={<Plus size={13} />} disabled={disabled || full} onClick={onAdd}
        tooltip={full ? `A clip can have up to ${cap} graphics.` : 'Add graphic at playhead (G): opens the gallery of animated graphics. Right-click the row to add one at that spot.'} /></div>
    <div className={cn('editor-graphics-track', stacked && 'stacked')} aria-label="Graphics"
      title={disabled || full ? undefined : 'Right-click or double-click to add a graphic here'}
      onContextMenu={(e) => { if (!onAddAt || disabled || full || e.target !== e.currentTarget) return; e.preventDefault(); onAddAt(timeAt(e)) }}
      onDoubleClick={(e) => { if (!onAddAt || disabled || full || e.target !== e.currentTarget) return; onAddAt(timeAt(e)) }}>
      {graphics.map((g, i) => {
        const a = Math.max(g.at_ms, viewStart), b = Math.min(g.at_ms + g.duration_ms, viewEnd)
        if (b <= a) return null
        const fit = graphicCutFit(candidate, g), offscreen = fit === 'outside', clash = clashes.has(g.id)
        const warning = graphicWarning(fit, clash, g.placement)
        const label = `${templateInfo(g.template).label} at ${clock(g.at_ms)}, ${(g.duration_ms / 1000).toFixed(1)} seconds${warning ? `. ${warning}` : ''}`
        const Icon = TEMPLATE_ICONS[g.template]
        const words = graphicSummary(g)
        return <div key={g.id} className={cn('editor-graphic-block', `group-${graphicGroup(g.template)}`, selected === g.id && 'selected', offscreen && 'cut-out', fit === 'partly' && 'partly', clash && 'clash', !graphicHasContent(g) && 'empty', stacked && (lanes[i] ? 'lane-2' : 'lane-1'))}
          style={{ left: `${(a - viewStart) / span * 100}%`, width: `${(b - a) / span * 100}%` }}>
          <button className="editor-graphic-edge" aria-label={`Change when ${label} starts`} disabled={disabled} onPointerDown={(e) => startDrag(e, g, 'start')} tabIndex={-1} />
          <button className="editor-graphic-body" aria-label={label} aria-pressed={selected === g.id}
            title={`${label} · Drag to move · Alt-drag to copy · Drag an edge to change its length · Delete removes it`}
            onPointerDown={(e) => startDrag(e, g, 'move')} onClick={() => onSelect(g.id)} onKeyDown={(e) => nudge(e, g)}>
            {(fit === 'partly' || clash) && <AlertTriangle size={10} className="editor-graphic-warning" aria-hidden />}
            <Icon size={11} className="editor-graphic-icon" aria-hidden />
            <span className="editor-graphic-words">{words || <span className="editor-graphic-kind">{SHORT[g.template]}</span>}</span>
          </button>
          <button className="editor-graphic-edge" aria-label={`Change when ${label} ends`} disabled={disabled} onPointerDown={(e) => startDrag(e, g, 'end')} tabIndex={-1} />
        </div>
      })}
      {!graphics.length && <span className="editor-graphics-empty">No graphics yet · right-click here or press G to add one</span>}
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
  highlight: { shape: 'circle', x: '0.5', y: '0.45' }, statement: { text: 'Your big idea', accent: 'idea', subline: 'A short line under it' },
  sticky_notes: { items: 'First note\nSecond note' }, strike_list: { items: 'Old way\nOther old way', final: 'The better way', accent: 'better way' },
  browser_frame: { domain: 'yoursite.com', title: 'Your page headline', accent: 'headline' }, icon_pop: { items: 'Email\nVideo\nChat', icons: 'mail\nvideo\nmessage' },
  headline_pill: { text: 'Your first line', phrase: 'Key words' }, comment_cta: { keyword: 'WORD' }, link_cta: { text: 'Click the link', where: 'below', kind: 'link' },
  big_words: { text: 'Big words', style: 'mixed' },
  orbit: { text: 'Hub', items: 'Email\nVideo\nChat\nCalendar\nChart', icons: 'mail\nvideo\nmessage\ncalendar\nchart', labels: 'off' },
  feature_tile: { items: 'Your feature', icons: 'search', dot: 'on' }, screen_frame: { label: 'Your screen', shape: 'square' },
  chapter: { label: 'Step #1.', title: 'Your section title' },
  staircase: { items: 'First step\nSecond step\nThird step\nFourth step', icons: 'idea\nuser\nsettings\nrocket' },
  funnel: { items: 'Stage one\nStage two\nStage three' }, journey: { items: 'Start\nMiddle\nGoal' },
  growth: { items: 'Small\nBigger\nBiggest' }, idea_hub: { items: 'First\nSecond\nThird\nFourth' },
  compare_marks: { items: 'The old way\nThe better way', wrong: 'first' },
  fx: { effect: 'per-word-rise', text: 'Words as you say them' },
  takeover: { text: 'This is the line that matters', accent: 'matters' },
  custom: {}
}

/** An effect's sample fields for the gallery's preview only (never put in a clip); a picture effect gets a sample mark. */
export function effectSample(id: string): Record<string, string> {
  const effect = fxEffect(id)
  const fields: Record<string, string> = { effect: id }
  for (const f of effect?.fields ?? []) if (f.sample) fields[f.key] = f.sample
  const region = effect?.fields.find((f) => f.kind === 'region')
  const sample = effect?.fields.find((f) => f.key === region?.on)?.sample
  if (region && sample && FX_SAMPLE_MARKS[sample]) { fields.mark = sample === 'photo' ? 'circle' : sample === 'page' ? 'box' : 'underline'; fields[region.key] = FX_SAMPLE_MARKS[sample] }
  return fields
}

/** Starting words for a new graphic, from the transcript line said at the playhead (nothing is made up). */
export function wordsAtPlayhead(template: GraphicTemplateId, line: string | undefined): Record<string, string> {
  return prefillGraphic(template, [], 0, { line }).fields
}

export const FIELD_LABELS: Record<string, string> = { value: 'Number', label: 'Label', text: 'Words', title: 'Title', items: 'Items (one per line)', name: 'Name', role: 'Role', caption: 'Caption', before: 'Before', after: 'After', author: 'Who said it',
  accent: 'Words in italics', subline: 'Small line under it', final: 'Last line', domain: 'Website address', highlights: 'Boxes on the picture', phrase: 'Key words (on the color box)', keyword: 'Keyword to comment', lead: 'Word above it', where: 'Where the link is',
  from: 'Starts at (seconds into the video)', zoom: 'Zoom into (optional)', notes: 'Short line under each (one per line)' }
/** Per-template field labels where the general one doesn't fit. */
const TEMPLATE_FIELD_LABELS: Partial<Record<GraphicTemplateId, Record<string, string>>> = {
  sticky_notes: { items: 'Notes (one per line, up to 3)' }, strike_list: { items: 'Crossed-out items (one per line, up to 4)' },
  icon_pop: { items: 'Labels (one per line, up to 4)' }, headline_pill: { text: 'First line' }, browser_frame: { title: 'Headline (when there’s no picture)' },
  big_words: { text: `Words (up to ${MAX_BIG_WORDS})` }, takeover: { text: `Your key line, as you say it (up to ${MAX_TAKEOVER_WORDS} words)`, accent: 'Key words (in your color)' }, orbit: { text: 'Center label', items: 'Labels (one per line, 3 to 6)' }, feature_tile: { items: 'Tiles (one per line, up to 3)' }, screen_frame: { label: 'Window title (optional)' },
  chapter: { label: 'Label (optional)', title: 'Section title' }, link_cta: { text: 'Button words', where: 'Where the link is (optional)', lead: 'Small line above (optional)' },
  staircase: { title: 'Title (optional)', items: 'Steps, bottom to top (one per line, 3 to 6)' }, funnel: { title: 'Title (optional)', items: 'Stages, wide end first (one per line, 3 to 5)' },
  journey: { title: 'Title (optional)', items: 'Milestones in order (one per line, 3 to 5)' }, growth: { title: 'Title (optional)', items: 'Labels, smallest first (one per line, 3 to 6)' },
  idea_hub: { text: 'Words under the icon (optional)', items: 'Labels around it (one per line, 3 to 6)' }, compare_marks: { items: 'The two cards (one per line)' }
}
/** Hints under a field. */
const FIELD_HINTS: Partial<Record<GraphicTemplateId, Record<string, string>>> = {
  statement: { accent: 'Words from the statement, drawn in italics with a marker. Empty: the last word.' },
  strike_list: { accent: 'Words from the last line, circled. Empty: the last word.' },
  browser_frame: { accent: 'Words from the headline, with a marker.', highlights: 'One box per line: across, down, width, height (0 to 1 of the picture), then the second it shows. For example: 0.1, 0.3, 0.6, 0.08, 1.5' },
  comment_cta: { lead: 'Empty: “Comment”.' },
  link_cta: { text: 'Your call to action as you say it, like “Click the link”.', where: 'As you say it, like “below” or “in my bio”. Arrows point down to it.', lead: 'A few words you say with it, like “Get the free guide”.' },
  big_words: { text: 'Use words you say here. Each line fills the width; press Enter to choose where a new line starts.' },
  orbit: { text: 'Short, like the one thing they all connect to. Empty: an icon (or your image).', items: 'One per node. Each node gets an icon below.' },
  chapter: { label: 'Like “Step #1.” Use the number you say.', title: 'Words you say at the start of this section. It stays at the top until the next chapter.' },
  staircase: { items: 'Each step lights up as you say it.' }, funnel: { items: 'Each stage lights up as you say it.' }, journey: { items: 'A small figure walks to each card as you say it.' },
  growth: { items: 'Each one grows as you say it.' }, idea_hub: { items: 'Each label appears as you say it.' }, compare_marks: { notes: 'Optional.' },
  screen_frame: { from: 'For this clip: the second in the source video where the screen part starts.', zoom: 'Across, down, width, height (0 to 1 of what the window shows), for a slow zoom in. For example: 0.1, 0.2, 0.5, 0.5' }
}
export const fieldLabel = (template: GraphicTemplateId, key: string): string => TEMPLATE_FIELD_LABELS[template]?.[key] ?? FIELD_LABELS[key] ?? key
const ICON_LABELS: Record<string, string> = { message: 'Chat', phone: 'Phone', file: 'Document', chart: 'Bar chart', trending: 'Trending up', dollar: 'Money', cart: 'Shopping cart', card: 'Credit card', bot: 'Robot', book: 'Book', idea: 'Light bulb', dashboard: 'Dashboard' }
const ICON_OPTIONS = [{ value: '', label: 'Letter' }, ...GRAPHIC_ICONS.map((name) => ({ value: name, label: ICON_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1) }))]
const SIZE_OPTIONS: { value: GraphicSize; label: string }[] = [{ value: 'compact', label: 'Small' }, { value: 'card', label: 'Card' }, { value: 'stage', label: 'Stage' }]
const BIG_STYLE_OPTIONS: { value: BigWordsStyle; label: string }[] = [{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Bold' }, { value: 'mixed', label: 'Mixed' }]
const BIG_SIDE_OPTIONS: { value: 'across' | 'left' | 'right'; label: string }[] = [{ value: 'across', label: 'Across' }, { value: 'left', label: 'Left side' }, { value: 'right', label: 'Right side' }]
const BIG_MOTION_OPTIONS: { value: BigWordsMotion; label: string }[] = [{ value: 'scale', label: 'Scale in' }, { value: 'reveal', label: 'Slide up' }]

/** Big words' look: style, across or along a side, and how they come in. */
export function BigWordsFields({ fields, onField }: { fields: Record<string, string>; onField: (key: string, value: string) => void }): React.JSX.Element {
  const options = bigWordsOptions(fields)
  return <div className="space-y-2">
    <div className="space-y-1"><p className="editor-label">Style</p>
      <Segmented<BigWordsStyle> label="Big words style" size="sm" value={options.style} onChange={(style) => onField('style', style)} options={BIG_STYLE_OPTIONS} />
      <p className="text-2xs text-ink-subtle">{options.style === 'serif' ? 'White serif type.' : options.style === 'sans' ? 'Bold condensed capitals.' : 'Line 1 in italic serif, line 2 in bold capitals in your color.'}</p></div>
    <div className="space-y-1"><p className="editor-label">Direction</p>
      <Segmented<'across' | 'left' | 'right'> label="Big words direction" size="sm" value={options.vertical ?? 'across'} onChange={(side) => onField('vertical', side === 'across' ? '' : side)} options={BIG_SIDE_OPTIONS} /></div>
    <div className="space-y-1"><p className="editor-label">Animation</p>
      <Segmented<BigWordsMotion> label="Big words animation" size="sm" value={options.motion} onChange={(motion) => onField('motion', motion)} options={BIG_MOTION_OPTIONS} /></div>
  </div>
}

/** The Icon row's icon for each label (generic icons only; a brand's logo is an image the member adds). */
export function IconFields({ fields, onField, imageNote = true, template = 'icon_pop' }: { fields: Record<string, string>; onField: (key: string, value: string) => void; imageNote?: boolean; template?: 'icon_pop' | 'orbit' | 'feature_tile' | 'staircase' | 'list' | 'checklist' }): React.JSX.Element | null {
  const labels = templateItems(template, fields.items)
  if (!labels.length) return null
  const icons = graphicIcons(fields, template)
  return <div className="space-y-1.5"><p className="editor-label">Icons</p>
    {labels.map((label, i) => <div key={i} className="flex items-center justify-between gap-2 text-2xs"><span className="truncate">{label}</span>
      <Select size="sm" aria-label={`Icon for ${label}`} value={icons[i] ?? ''} options={ICON_OPTIONS} searchable
        onChange={(name) => onField('icons', labels.map((_, k) => k === i ? name : icons[k] ?? '').join('\n'))} /></div>)}
    <p className="text-2xs text-ink-subtle">Simple icons only.{imageNote ? ' To show a brand’s logo, choose its image above.' : ' “Letter” shows the label’s first letter.'}</p></div>
}

const CTA_KIND_OPTIONS: { value: CtaKind; label: string }[] = [{ value: 'link', label: 'Link' }, { value: 'comment', label: 'Comment' }, { value: 'dm', label: 'Message' },
  { value: 'follow', label: 'Follow' }, { value: 'save', label: 'Save' }, { value: 'share', label: 'Share' }]
/** A template's looks (motion-graphics GRAPHIC_VARIANTS): a picker with a plain line about the one chosen. None for one-look templates. */
export function VariantField({ template, fields, onField }: { template: GraphicTemplateId; fields: Record<string, string>; onField: (key: string, value: string) => void }): React.JSX.Element | null {
  const looks = graphicVariants(template)
  if (!looks.length) return null
  const value = graphicVariant(template, fields)
  return <div className="space-y-1"><p className="editor-label">Look</p>
    <Segmented<string> label="Graphic look" size="sm" value={value} onChange={(look) => onField('variant', look)} options={looks.map((v) => ({ value: v.id, label: v.label }))} />
    <p className="text-2xs text-ink-subtle">{looks.find((v) => v.id === value)?.detail} Your color is the accent.</p></div>
}

const CHAPTER_STYLE_OPTIONS: { value: ChapterStyle; label: string }[] = [{ value: 'serif_caps', label: 'Serif' }, { value: 'sans', label: 'Bold' }, { value: 'pill', label: 'Pill' }]

/** The extra choices of a chapter header and the diagrams: look, which card is wrong, the center icon, the step icons. */
export function DiagramFields({ template, fields, onField }: { template: GraphicTemplateId; fields: Record<string, string>; onField: (key: string, value: string) => void }): React.JSX.Element | null {
  if (template === 'chapter') {
    const style = chapterStyle(fields)
    return <div className="space-y-1"><p className="editor-label">Look</p>
      <Segmented<ChapterStyle> label="Chapter header look" size="sm" value={style} onChange={(value) => onField('style', value)} options={CHAPTER_STYLE_OPTIONS.filter((o) => CHAPTER_STYLES.includes(o.value))} />
      <p className="text-2xs text-ink-subtle">{style === 'serif_caps' ? 'White small capitals in a serif, with a soft shadow.' : style === 'sans' ? 'Bold white type, the label in your color.' : 'White type on a dark pill.'} It sits at the very top; your hook text hides when the first chapter starts.</p></div>
  }
  if (template === 'link_cta') return <div className="flex items-center justify-between gap-2 text-2xs"><span>Icon on the button</span>
    <Select size="sm" aria-label="Icon on the button" value={ctaKind(fields)} options={CTA_KIND_OPTIONS} onChange={(kind) => onField('kind', kind === 'link' ? '' : kind)} /></div>
  if (template === 'staircase') return <IconFields fields={fields} onField={onField} template="staircase" imageNote={false} />
  if (template === 'growth') return <div className="space-y-1"><p className="editor-label">Drawn as</p>
    <Segmented<'plants' | 'bars'> label="Growth drawn as" size="sm" value={growthStyle(fields)} onChange={(value) => onField('style', value === 'plants' ? '' : value)} options={[{ value: 'plants', label: 'Plants' }, { value: 'bars', label: 'Bars' }]} /></div>
  if (template === 'idea_hub') return <div className="flex items-center justify-between gap-2 text-2xs"><span>Center icon</span>
    <Select size="sm" aria-label="Center icon" value={hubIcon(fields)} options={ICON_OPTIONS.filter((o) => o.value)} searchable onChange={(name) => onField('icon', name === 'idea' ? '' : name)} /></div>
  if (template === 'compare_marks') return <div className="space-y-1"><p className="editor-label">Red ✗ on</p>
    <Segmented<'first' | 'second'> label="Card with the red cross" size="sm" value={compareWrong(fields) ? 'second' : 'first'} onChange={(value) => onField('wrong', value)} options={[{ value: 'first', label: 'First card' }, { value: 'second', label: 'Second card' }]} />
    <p className="text-2xs text-ink-subtle">The other card gets the green ✓.</p></div>
  return null
}

const SHAPE_OPTIONS: { value: ScreenShape; label: string }[] = [{ value: 'wide', label: 'Wide' }, { value: 'square', label: 'Square' }, { value: 'tall', label: 'Tall' }]

/** A Screen recording's video (part of this clip, or a video file the member adds) and the window's shape. */
export function ScreenFields({ fields, outputDir, onField }: { fields: Record<string, string>; outputDir: string; onField: (key: string, value: string) => void }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const file = fields.video && fields.video !== 'source' ? fields.video : null
  const choose = (): void => {
    setError(null); setBusy(true)
    void getApi().editor.graphicVideo(outputDir).then((name) => { if (name) onField('video', name) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not add that video.'))
      .finally(() => setBusy(false))
  }
  return <div className="space-y-2">
    <div className="space-y-1"><p className="editor-label">Video</p>
      <Segmented<'source' | 'file'> label="Screen recording video" size="sm" value={fields.video === 'source' || !fields.video ? 'source' : 'file'}
        onChange={(v) => { if (v === 'source') onField('video', 'source'); else if (!file) choose() }}
        options={[{ value: 'source', label: 'Part of this clip' }, { value: 'file', label: 'A video file' }]} />
      {fields.video !== 'source' && <div className="flex items-center gap-2"><Button size="sm" icon={<Film size={13} />} loading={busy} onClick={choose}>{file ? 'Change video' : 'Choose video'}</Button>
        {file && <span className="text-2xs text-ink-subtle">Video added</span>}</div>}
      <p className="text-2xs text-ink-subtle">{fields.video === 'source' ? 'Shows your own video from “Starts at”, for example the part where you film your screen.' : 'MP4, MOV, M4V or WebM, up to 2 GB. It’s copied into this run and plays with no sound.'}</p>
      {error && <p role="alert" className="text-2xs text-danger">{error}</p>}</div>
    <div className="space-y-1"><p className="editor-label">Window shape</p>
      <Segmented<ScreenShape> label="Window shape" size="sm" value={screenShape(fields)} onChange={(shape) => onField('shape', shape)} options={SHAPE_OPTIONS} />
      <p className="text-2xs text-ink-subtle">The video fills the window, trimmed at the edges to fit.</p></div>
  </div>
}

/** The transcript's timed words around the clip (for timing text cards to the voice), or [] while loading or without them. */
export function useClipWords(outputDir: string, from: number, to: number): TimedWord[] {
  const [words, setWords] = useState<TimedWord[]>([])
  useEffect(() => {
    let live = true
    const api = getApi().editor
    if (typeof api.words !== 'function') return
    void api.words(outputDir, Math.max(0, from - 10000), to + 10000).then((list) => { if (live) setWords(list) }).catch(() => { if (live) setWords([]) })
    return () => { live = false }
  }, [outputDir, from, to])
  return words
}

const clipSpan = (c: CandidateEdit): [number, number] => [c.ranges[0][0], c.ranges[c.ranges.length - 1][1]]
/** A word-timed card snapped to where its words are said near it (start, length and each word's time), kept in the cut. */
function timedCard(c: CandidateEdit, g: EditorGraphic, words: readonly TimedWord[], windowMs: number): EditorGraphic | null {
  if (!WORD_TIMED_TEMPLATES.includes(g.template) || !words.length) return null
  const matched = matchCardWords(g, words, g.at_ms, windowMs)
  return matched ? fitGraphicInCut(matched, c) : null
}

/**
 * A new graphic of `template` at `time` (source ms): inside the cut (near the end it starts earlier), filled with the
 * words said there (only words said; empty when none fit), on its words (a text card starts on its first word, a
 * list's items show as they're said) and in a band no other graphic uses then.
 */
export function draftGraphic(project: Pick<EditorProject, 'transcript'>, c: CandidateEdit, template: GraphicTemplateId, time: number, words: readonly TimedWord[], effectId?: string): EditorGraphic {
  const graphics = c.graphics ?? []
  const [clipStart, clipEnd] = clipSpan(c)
  let at = Math.max(clipStart, Math.min(clipEnd - GRAPHIC_MIN_MS, Math.round(time)))
  const line = project.transcript.find((r) => at >= r.start_ms && at < r.end_ms)?.text
  const effect = template === 'fx' ? fxEffect(effectId) ?? FX_EFFECTS[0] : null
  if (effect) {
    // An effect: the words said here for its fields, its own length and size, its beats on the words as said.
    const prefill = prefillEffect(effect.id, words, at, { line, until: clipEnd })
    if (prefill.first_ms !== null && prefill.first_ms < at && at - prefill.first_ms < 4000) at = Math.max(clipStart, prefill.first_ms - 150)
    const until = prefill.last_ms !== null ? prefill.last_ms + 1000 - at : 0
    const drafted = newGraphic('fx', at, { fields: { effect: effect.id, ...prefill.fields }, taken: graphics.map((x) => x.id), duration_ms: Math.max(effect.default_ms, until), ...(effect.size ? { size: effect.size } : {}) })
    let g = fitGraphicInCut(drafted, c) ?? drafted
    if (words.length) g = matchFxCues(g, words) ?? g
    return placeInFreeBand(graphics, g)
  }
  const prefill = prefillGraphic(template, words, at, { line, until: clipEnd })
  // A list whose first item was said just before the playhead starts on it.
  if (words.length && ITEM_TIMED_TEMPLATES.includes(template) && prefill.first_ms !== null && prefill.first_ms < at && at - prefill.first_ms < 4000) at = Math.max(clipStart, prefill.first_ms - 150)
  // A diagram or chapter header (long ones) is cut to the time left rather than moved earlier.
  const left = clipEnd - at
  const long = template === 'chapter' || isDiagram(template)
  let duration = long && left >= GRAPHIC_MIN_MS ? Math.min(GRAPHIC_DEFAULT_MS[template], left) : undefined
  // A list stays up until its last item is said.
  if (prefill.last_ms !== null && words.length && ITEM_TIMED_TEMPLATES.includes(template)) duration = clampGraphicMs(Math.min(left, Math.max(duration ?? GRAPHIC_DEFAULT_MS[template], prefill.last_ms + 1200 - at)), template)
  const drafted = newGraphic(template, at, { fields: { ...(template === 'screen_frame' ? { video: 'source', from: String(Math.round(at / 100) / 10) } : {}), ...prefill.fields }, taken: graphics.map((x) => x.id),
    ...(duration !== undefined ? { duration_ms: duration } : {}) })
  let g = fitGraphicInCut(drafted, c) ?? drafted
  if (words.length && WORD_TIMED_TEMPLATES.includes(template)) g = timedCard(c, g, words, 3000) ?? g
  else if (words.length && ITEM_TIMED_TEMPLATES.includes(template)) g = matchItemTimes(g, words) ?? g
  return placeInFreeBand(graphics, g)
}

/** The clip's graphics with one field of `g` changed: a word-timed card moves onto its words, a diagram's items light up as said. */
export function graphicsWithField(c: CandidateEdit, g: EditorGraphic, key: string, value: string, words: readonly TimedWord[]): EditorGraphic[] {
  const next = updateGraphic(c, g.id, { fields: { [key]: value } })
  const changed = next.find((x) => x.id === g.id)
  // An effect's beats follow its words as said (when they are said while it shows).
  const cued = changed && changed.template === 'fx' && words.length && fxEffect(changed.fields.effect)?.cue ? matchFxCues(changed, words) : null
  if (cued) return withGraphic({ ...c, graphics: next }, cued)
  const items = changed && key === 'items' && isDiagram(changed.template) && words.length ? matchItemTimes(changed, words) : null
  if (items) return withGraphic({ ...c, graphics: next }, items)
  const snapped = changed && ['text', 'phrase', 'subline'].includes(key) ? timedCard(c, changed, words, 3000) : null
  return snapped ? withGraphic({ ...c, graphics: next }, snapped) : next
}

/** "Match my words": the graphic timed to where its words (or items) are said, or a note why it can't be. */
export function matchGraphicWords(c: CandidateEdit, g: EditorGraphic, words: readonly TimedWord[]): { graphics: EditorGraphic[] | null; note: string } {
  const [clipStart, clipEnd] = clipSpan(c)
  if (g.template === 'fx') {
    const matched = words.length ? matchFxCues(g, words) : null
    if (!matched) return { graphics: null, note: words.length ? 'Those words aren’t all said, in order, while this effect is on screen. Use words from the clip, or move or lengthen it.' : 'This run has no word timings, so the words can’t be matched.' }
    return { graphics: updateGraphic(c, g.id, { fields: { cue_ms: matched.fields.cue_ms } }), note: 'Matched: the effect’s beats now land on your words.' }
  }
  if (!WORD_TIMED_TEMPLATES.includes(g.template)) {
    const matched = words.length ? matchItemTimes(g, words) : null
    if (!matched) return { graphics: null, note: words.length ? 'Those items aren’t all said, in order, while this graphic is on screen. Use words from the clip, or move or lengthen the graphic.' : 'This run has no word timings, so the items can’t be matched.' }
    return { graphics: updateGraphic(c, g.id, { fields: { item_ms: matched.fields.item_ms } }), note: 'Matched: each item now shows as you say it.' }
  }
  const snapped = timedCard(c, { ...g, at_ms: Math.max(clipStart, Math.min(clipEnd, Math.round(g.at_ms))) }, words, 6000)
  if (!snapped) return { graphics: null, note: words.length ? 'Those words aren’t said near this graphic. Use words from the clip, said within a few seconds of it.' : 'This run has no word timings, so the words can’t be matched.' }
  return { graphics: withGraphic(c, snapped), note: 'Matched: each word now shows as you say it.' }
}

/** The clip's graphics with `g` switched to another template, keeping its words (and timed to them when they're said). */
export function graphicsWithTemplate(c: CandidateEdit, g: EditorGraphic, to: GraphicTemplateId, words: readonly TimedWord[]): EditorGraphic[] {
  let next = switchGraphicTemplate(g, to)
  if (to === 'screen_frame' && !next.fields.from) next = { ...next, fields: { ...next.fields, from: String(Math.round(next.at_ms / 100) / 10) } }
  next = fitGraphicInCut(next, c) ?? next
  if (words.length) next = timedCard(c, next, words, 3000) ?? (ITEM_TIMED_TEMPLATES.includes(to) ? matchItemTimes(next, words) : null) ?? next
  return withGraphic(c, next)
}

/**
 * The clip's graphics with effect graphic `g` switched to another effect: fields both share keep their words, else
 * its line goes to the new one's first text (or list) field; color, font and backing stay; its beats follow the words.
 */
export function graphicsWithEffect(c: CandidateEdit, g: EditorGraphic, to: string, words: readonly TimedWord[]): EditorGraphic[] {
  const effect = fxEffect(to)
  if (!effect) return c.graphics ?? []
  const fields: Record<string, string> = { effect: effect.id }
  for (const key of ['color', 'font', 'backing']) if (g.fields[key]) fields[key] = g.fields[key]
  for (const f of effect.fields) if (g.fields[f.key]) fields[f.key] = g.fields[f.key]
  const line = fxLine(g.fields)
  const first = effect.fields.find((f) => (f.kind === 'text' || f.kind === 'list') && f.said)
  if (line && first && !fields[first.key]) fields[first.key] = line.slice(0, first.max ?? MAX_GRAPHIC_FIELD_CHARS)
  let next: EditorGraphic = { ...g, fields }
  if (effect.size && !g.size) next = { ...next, size: effect.size }
  next = fitGraphicInCut(next, c) ?? next
  if (words.length) next = matchFxCues(next, words) ?? next
  return withGraphic(c, next)
}

/** A chapter header at each step the speaker names in the clip ("step one…", "first…"), with their own words. */
export function chaptersAtSteps(c: CandidateEdit, words: readonly TimedWord[], cap: number = MAX_GRAPHICS_PER_CLIP): { graphics: EditorGraphic[]; added: number } {
  const graphics = c.graphics ?? []
  const [, clipEnd] = clipSpan(c)
  const chapters = graphics.filter((g) => g.template === 'chapter')
  const steps = spokenSteps(words, c.ranges).filter((s) => !chapters.some((g) => Math.abs(g.at_ms - s.at_ms) < 1500))
  let list = graphics, added = 0
  steps.forEach((step, i) => {
    if (list.length >= cap) return
    const nextAt = Math.min(steps[i + 1]?.at_ms ?? clipEnd, ...chapters.filter((g) => g.at_ms > step.at_ms).map((g) => g.at_ms))
    const at = Math.max(c.ranges[0][0], step.at_ms - 100)
    const g = newGraphic('chapter', at, { fields: { ...(step.label ? { label: step.label } : {}), title: step.title }, duration_ms: Math.max(GRAPHIC_MIN_MS, nextAt - at - (nextAt < clipEnd ? 100 : 0)), taken: list.map((x) => x.id) })
    const fit = fitGraphicInCut(g, c)
    if (!fit) return
    list = withGraphic({ ...c, graphics: list }, fit, cap); added++
  })
  return { graphics: list, added }
}

export type QuickStyle = 'signature' | 'bold' | 'minimal'
/** Looks that restyle every graphic on the clip at once: the accent color, the type and the chapter and big words looks. */
export const QUICK_STYLES: { id: QuickStyle; label: string; detail: string }[] = [
  { id: 'signature', label: 'Signature', detail: 'Your hook’s font and brand color, serif chapter titles, mixed big words.' },
  { id: 'bold', label: 'Bold', detail: 'Bold condensed capitals in your brand color.' },
  { id: 'minimal', label: 'Minimal', detail: 'Clean sans type with a quiet slate accent and pill chapter titles.' }
]
const MINIMAL_ACCENT = '#334155'
const quickFields = (style: QuickStyle, g: EditorGraphic): Record<string, string> => {
  const look = style === 'signature' ? { font: '', color: '', chapter: 'serif_caps', big: 'mixed' } : style === 'bold' ? { font: 'condensed', color: '', chapter: 'sans', big: 'sans' }
    : { font: 'clean', color: isDiagram(g.template) ? '' : MINIMAL_ACCENT, chapter: 'pill', big: 'serif' }
  return { font: look.font, color: look.color, ...(g.template === 'chapter' ? { style: look.chapter } : g.template === 'big_words' ? { style: look.big } : {}) }
}
export function applyQuickStyle(c: CandidateEdit, style: QuickStyle): EditorGraphic[] {
  return (c.graphics ?? []).reduce<EditorGraphic[]>((list, g) => updateGraphic({ ...c, graphics: list }, g.id, { fields: quickFields(style, g) }), c.graphics ?? [])
}
/** The quick style every graphic on the clip has, or null (mixed, or none yet). */
export function quickStyleOf(c: CandidateEdit): QuickStyle | null {
  const graphics = c.graphics ?? []
  if (!graphics.length) return null
  return QUICK_STYLES.find((q) => graphics.every((g) => Object.entries(quickFields(q.id, g)).every(([k, v]) => (k === 'font' ? graphicOwnFont(g) ?? '' : g.fields[k] ?? '') === v)))?.id ?? null
}

/** The Graphics tab's one-click actions and quick styles. */
function GraphicsActions({ candidate, words, disabled, onChange, onSuggest, onNote, cap }: {
  candidate: CandidateEdit; words: readonly TimedWord[]; disabled: boolean; cap: number
  onChange: (graphics: EditorGraphic[], remember?: boolean) => void; onSuggest: (send: boolean) => void; onNote: (note: string | null) => void
}): React.JSX.Element {
  const graphics = candidate.graphics ?? []
  const auto = graphics.filter((g) => g.origin === 'auto').length
  const [asking, setAsking] = useState<{ note: string; ready: boolean } | null>(null)
  const style = quickStyleOf(candidate)
  const suggest = (): void => {
    onNote(null)
    const api = getApi().editor
    if (typeof api.chatInfo !== 'function') { onSuggest(false); return }
    void api.chatInfo().then((info) => setAsking({ ready: info.ready, note: info.ready ? `${info.costNote} Model: ${info.model}.` : info.reason ?? 'The chat is not available.' }),
      () => setAsking({ ready: false, note: 'The chat is not available right now.' }))
  }
  return <div className="editor-graphics-actions">
    <div className="editor-graphics-quick" role="group" aria-label="Quick actions">
      <button type="button" disabled={disabled} onClick={suggest}><Sparkles size={13} aria-hidden /><span>Suggest graphics for this clip</span></button>
      <button type="button" disabled={disabled || graphics.length >= cap} onClick={() => {
        if (!words.length) { onNote('This run has no word timings, so steps can’t be found. Add a chapter with “Add graphic”.'); return }
        const { graphics: next, added } = chaptersAtSteps(candidate, words, cap)
        if (!added) { onNote('No steps are named in this clip (like “step one” or “first”). Add a chapter with “Add graphic”.'); return }
        onChange(next); onNote(`Added ${added} chapter header${added === 1 ? '' : 's'}, one at each step you name.`)
      }}><Bookmark size={13} aria-hidden /><span>Add a chapter at each step</span></button>
      <button type="button" disabled={disabled || !auto} onClick={() => { onChange(graphics.filter((g) => g.origin !== 'auto')); onNote(`Removed ${auto} automatic graphic${auto === 1 ? '' : 's'}. Undo brings ${auto === 1 ? 'it' : 'them'} back.`) }}
        title={auto ? undefined : 'This clip has no graphics added automatically.'}><Eraser size={13} aria-hidden /><span>Clear auto graphics{auto ? ` (${auto})` : ''}</span></button>
    </div>
    {graphics.length > 0 && <div className="editor-graphics-styles" role="group" aria-label="Quick styles">
      <span className="editor-label">Quick style</span>
      <div>{QUICK_STYLES.map((q) => <button key={q.id} type="button" aria-pressed={style === q.id} disabled={disabled} title={q.detail} className={cn(`quick-${q.id}`, style === q.id && 'selected')}
        onClick={() => { onChange(applyQuickStyle(candidate, q.id)); onNote(`${q.label} look on every graphic.`) }}><Wand2 size={11} aria-hidden />{q.label}</button>)}</div>
    </div>}
    {asking && <ConfirmDialog onClose={() => setAsking(null)} request={asking.ready ? {
      title: 'Suggest graphics for this clip?', confirmLabel: 'Suggest graphics', tone: 'primary',
      body: <>The chat reads what you say in this clip and adds 3 to 5 graphics where they help, using only your words. You can undo or change each one.<br /><br />{asking.note}</>,
      onConfirm: () => { setAsking(null); onSuggest(true) }
    } : { title: 'Suggest graphics needs the chat', confirmLabel: 'Open the chat', tone: 'primary', body: <>{asking.note}</>, onConfirm: () => { setAsking(null); onSuggest(false) } }} />}
  </div>
}

const TYPE_OPTIONS = GRAPHIC_GROUPS.flatMap((group) => GRAPHIC_TEMPLATES.filter((t) => group.templates.includes(t.id)).map((t) => ({ value: t.id, label: t.label, detail: group.label })))
const EFFECT_OPTIONS = FX_GROUPS.flatMap((group) => FX_EFFECTS.filter((e) => e.group === group.id).map((e) => ({ value: e.id, label: e.label, detail: group.label.replace(/^Effects: /, '') })))

/**
 * Where an effect's pictures come from: the clip editor chooses a file (copied into the run); an edited reel picks one
 * of its screenshots. `url` shows a field's picture.
 */
export interface EffectPictures {
  url: (value: string | undefined) => string | undefined
  /** Choose a new picture: its field value, or null when nothing was chosen. */
  choose?: () => Promise<string | null>
  /** Pictures to pick from instead (an edited reel's screenshots). */
  options?: { value: string; label: string }[]
}

/** One picture field: what it shows, and how to change it. */
function PictureField({ label, value, required, pictures, onChange }: { label: string; value: string | undefined; required: boolean; pictures: EffectPictures; onChange: (value: string) => void }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const url = pictures.url(value)
  const choose = (): void => {
    if (!pictures.choose) return
    setError(null); setBusy(true)
    void pictures.choose().then((name) => { if (name) onChange(name) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not add that picture.'))
      .finally(() => setBusy(false))
  }
  return <div className="space-y-1"><p className="editor-label">{label}</p>
    <div className="flex flex-wrap items-center gap-2">{url && <img className="editor-graphic-thumb" src={url} alt="" />}
      {pictures.options ? <Select size="sm" aria-label={label} value={value ?? ''} options={[...(required ? [] : [{ value: '', label: 'None' }]), ...pictures.options]} onChange={onChange} />
        : <Button size="sm" icon={<ImagePlus size={13} />} loading={busy} onClick={choose}>{value ? 'Change picture' : 'Choose picture'}</Button>}
      {value && !required && !pictures.options && <Button size="sm" variant="ghost" onClick={() => onChange('')}>Remove</Button>}</div>
    {!value && required && <p className="text-2xs text-warning">Choose a picture to show it.</p>}
    {error && <p role="alert" className="text-2xs text-danger">{error}</p>}
  </div>
}

/** An effect's own fields (fx-catalog.ts): words, numbers, lists (one per line), choices, pictures and the mark on one. */
export function EffectFields({ fields, onField, pictures }: { fields: Record<string, string>; onField: (key: string, value: string) => void
  /** Where its pictures come from (none: they can't be changed here). */
  pictures?: EffectPictures }): React.JSX.Element | null {
  const effect = fxEffect(fields.effect)
  if (!effect) return null
  return <div className="space-y-2">
    <p className="text-2xs text-ink-subtle">{effect.detail}</p>
    {effect.fields.map((f) => {
      if (f.kind === 'image') return pictures ? <PictureField key={f.key} label={f.label} value={fields[f.key] || undefined} required={!!f.required} pictures={pictures} onChange={(v) => onField(f.key, v)} />
        : <p key={f.key} className="text-2xs text-ink-subtle">{f.label}: {fields[f.key] ? 'added' : 'none yet'}.</p>
      if (f.kind === 'region') {
        // The mark sits where the member drags on their picture.
        const src = pictures?.url(fields[f.on ?? 'image'])
        if (!fields.mark || !src) return null
        const box = fxRegion(fields[f.key])
        return <div key={f.key} className="space-y-1"><p className="editor-label">{f.label}</p>
          <HighlightPicker src={src} name="Your picture" className="w-48" label="drag on the picture to box what the mark points at" disabled={false}
            value={box ? { x: box[0], y: box[1], w: box[2], h: box[3] } : null} onChange={(r) => onField(f.key, r ? fxRegionText([r.x, r.y, r.w, r.h]) : '')} />
          <p className={cn('text-2xs', box ? 'text-ink-subtle' : 'text-warning')}>{box ? 'Drag again to move it.' : 'Drag on the picture to box what the mark points at. It shows once you do.'}</p></div>
      }
      return f.kind === 'choice' ? <div key={f.key} className="space-y-1"><p className="editor-label">{f.label}</p>
        <Select size="sm" aria-label={`${effect.label} ${f.label.toLowerCase()}`} value={f.options?.some((o) => o.value === fields[f.key]) ? fields[f.key] : f.options?.[0]?.value ?? ''}
          options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))} onChange={(value) => onField(f.key, value)} /></div>
        : <label key={f.key} className="editor-label">{f.label}
          {f.kind === 'list' ? <textarea rows={4} maxLength={MAX_GRAPHIC_FIELD_CHARS * 5} value={fields[f.key] ?? ''} onChange={(e) => onField(f.key, e.target.value)} aria-label={`${effect.label} ${f.label.toLowerCase()}`} />
            : <input className="editor-graphic-input" inputMode={f.kind === 'number' ? 'decimal' : undefined} maxLength={f.max ?? MAX_GRAPHIC_FIELD_CHARS} value={fields[f.key] ?? ''} onChange={(e) => onField(f.key, e.target.value)}
              aria-label={`${effect.label} ${f.label.toLowerCase()}`} placeholder={f.kind === 'number' ? 'A number said in the clip' : undefined} />}
        </label>
    })}
    {effect.backing === 'glass' && <div className="flex items-center justify-between gap-2 text-xs"><span>Dark glass behind it</span>
      <Switch label="Dark glass behind it" checked={fields.backing !== 'none'} onChange={(on) => onField('backing', on ? '' : 'none')} /></div>}
  </div>
}

/** The Graphics inspector tab: add graphics (the gallery), one-click actions, then the selected graphic's words, place and length. */
export function GraphicsInspector({ project, candidate, outputDir, time, selected, words, disabled, onGallery, onSuggest, onSelect, onChange, seek, clock }: {
  project: EditorProject; candidate: CandidateEdit; outputDir: string; time: number; selected: string | null; disabled: boolean
  /** The transcript's timed words around the clip ([] without them). */
  words: readonly TimedWord[]
  onGallery: () => void; onSuggest: (send: boolean) => void
  onSelect: (id: string | null) => void; onChange: (graphics: EditorGraphic[], remember?: boolean) => void
  seek: (ms: number) => void; clock: (ms: number) => string
}): React.JSX.Element {
  const cap = graphicsCap(project)
  const graphics = candidate.graphics ?? []
  const g = graphics.find((x) => x.id === selected) ?? null
  const style = graphicStyle(candidate)
  const [imageError, setImageError] = useState<string | null>(null)
  useEffect(() => setImageError(null), [selected])
  const full = graphics.length >= cap
  const [clipStart, clipEnd] = clipSpan(candidate)
  const [matchNote, setMatchNote] = useState<string | null>(null)
  useEffect(() => setMatchNote(null), [selected])
  const [actionNote, setActionNote] = useState<string | null>(null)
  const field = (key: string, value: string, remember = true): void => { if (g) onChange(graphicsWithField(candidate, g, key, value, words), remember) }
  const matchWords = (): void => {
    if (!g) return
    const { graphics: next, note } = matchGraphicWords(candidate, g, words)
    if (next) onChange(next)
    setMatchNote(note)
  }
  const actions = <GraphicsActions candidate={candidate} words={words} disabled={disabled} onChange={onChange} onSuggest={onSuggest} onNote={setActionNote} cap={cap} />
  const note = actionNote && <p role="status" className="text-2xs text-ink-subtle">{actionNote}</p>
  if (!graphics.length) {
    return <section className="editor-graphics-panel" aria-label="Graphics">
      <div className="editor-graphics-empty-card">
        <p className="text-sm font-medium text-ink">No graphics on this clip yet</p>
        <p className="text-2xs text-ink-subtle">Animated stats, titles, lists, steps and diagrams. Each one starts at the playhead ({clock(Math.max(clipStart, Math.min(clipEnd, time)))}) with the words you say there.</p>
        <Button variant="primary" icon={<Plus size={14} />} disabled={disabled} onClick={onGallery}>Add a graphic</Button>
        <p className="text-2xs text-ink-subtle">Or press G, or right-click the Graphics row on the timeline.</p>
      </div>
      {actions}{note}
    </section>
  }
  const clashes = graphicClashes(graphics)
  const list = <div className="editor-graphic-list" role="list" aria-label="Graphics on this clip">{graphics.map((x) => <button key={x.id} role="listitem" className={cn(`group-${graphicGroup(x.template)}`, x.id === selected && 'selected')}
    onClick={() => { onSelect(x.id); if (time < x.at_ms || time >= x.at_ms + x.duration_ms) seek(x.at_ms + Math.min(1200, x.duration_ms * .45)) }}>
    <span>{templateInfo(x.template).label}</span>{graphicWarning(graphicCutFit(candidate, x), clashes.has(x.id), x.placement) && <AlertTriangle size={11} className="text-warning" aria-label="Needs a look" />}<span className="text-ink-subtle">{clock(x.at_ms)}</span></button>)}</div>
  return <section className="editor-graphics-panel" aria-label="Graphics">
    <div className="flex items-center justify-between gap-2"><p className="text-xs">Graphics <span className="text-ink-subtle">{graphics.length} / {cap}</span></p>
      <Button size="sm" variant="primary" icon={<Plus size={13} />} disabled={disabled || full} onClick={onGallery} tooltip={full ? `A clip can have up to ${cap} graphics.` : 'Open the gallery and add a graphic at the playhead (G).'}>Add at playhead</Button></div>
    {actions}{note}
    {list}
    {!g ? <p className="text-2xs text-ink-subtle">Select a graphic on the timeline or in the list to edit it.</p> : <fieldset disabled={disabled} className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{templateInfo(g.template).label}</p>
        <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => { onChange(removeGraphic(candidate, g.id)); onSelect(null) }}>Remove</Button></div>
      {g.template === 'custom' ? <CustomGraphicFields outputDir={outputDir} candidate={candidate} graphic={g} disabled={disabled} onChange={(next) => onChange(next)} />
        : g.template === 'fx' ? <div className="flex items-center justify-between gap-2 text-2xs"><span className="text-ink-muted">Effect</span>
        <Select size="sm" aria-label="Effect" value={g.fields.effect ?? ''} options={EFFECT_OPTIONS} searchable
          onChange={(to) => { if (to !== g.fields.effect) onChange(graphicsWithEffect(candidate, g, to, words)) }} /></div>
        : <div className="flex items-center justify-between gap-2 text-2xs"><span className="text-ink-muted">Type</span>
        <Select size="sm" aria-label="Graphic type" value={g.template} options={TYPE_OPTIONS} searchable
          onChange={(to) => { if (to !== g.template) onChange(graphicsWithTemplate(candidate, g, to as GraphicTemplateId, words)) }} /></div>}
      <VariantField template={g.template} fields={g.fields} onField={field} />
      {(() => { const warning = graphicWarning(graphicCutFit(candidate, g), graphicClashes(graphics).has(g.id), g.placement); return warning && <p role="note" className="text-2xs text-warning">{warning}</p> })()}
      {!graphicHasContent(g) && !(g.template === 'fx' && fxNeedsPicture(g.fields.effect) && !g.fields.image) && <p className="text-2xs text-warning">{g.template === 'logo' ? 'Choose an image to show it.' : g.template === 'browser_frame' ? 'Choose a screenshot or add a headline to show it.' : 'Add its words to show it.'}</p>}
      {graphicUsesImage(g.template) && <div className="space-y-2">
        <div className="flex items-center gap-2">{graphicImageUrl(outputDir, g.fields.image) && <img className="editor-graphic-thumb" src={graphicImageUrl(outputDir, g.fields.image)} alt="" />}
          <Button size="sm" icon={<ImagePlus size={13} />} onClick={() => {
            setImageError(null)
            void getApi().editor.graphicImage(outputDir).then((name) => { if (name) field('image', name) }).catch((e: unknown) => setImageError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not add that image.'))
          }}>{g.fields.image ? 'Change image' : g.template === 'browser_frame' ? 'Choose screenshot' : 'Choose image'}</Button>
          {g.fields.image && g.template !== 'logo' && <Button size="sm" variant="ghost" onClick={() => field('image', '')}>Remove image</Button>}</div>
        <p className="text-2xs text-ink-subtle">PNG, JPEG or WebP, up to 12 MB. It’s copied into this run.{g.template === 'browser_frame' ? ' A tall screenshot scrolls slowly inside the window.' : g.template === 'icon_pop' ? ' It shows in the first tile.' : g.template === 'orbit' ? ' It shows in the center tile.' : ''}</p>
        {g.template === 'logo' && <LogoPickRow onPick={(logo) => { setImageError(null); void getApi().editor.logoImage(outputDir, logo.id).then((name) => field('image', name)).catch((e: unknown) => setImageError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not use that logo.')) }} />}
        {imageError && <p role="alert" className="text-2xs text-danger">{imageError}</p>}
      </div>}
      {g.template === 'screen_frame' && <ScreenFields fields={g.fields} outputDir={outputDir} onField={field} />}
      {g.template === 'fx' && <EffectFields fields={g.fields} onField={field} pictures={{ url: (name) => graphicImageUrl(outputDir, name), choose: () => getApi().editor.graphicImage(outputDir) }} />}
      {templateInfo(g.template).fields.filter((k) => !['effect', 'image', 'shape', 'x', 'y', 'icons', 'style', 'vertical', 'motion', 'video', 'labels', 'dot', 'icon', 'wrong', 'kind', 'comp', 'idea', 'scene'].includes(k)).map((key) => <label key={key} className="editor-label">{fieldLabel(g.template, key)}
        {key === 'items' || key === 'text' || key === 'highlights' || key === 'notes' ? <textarea rows={key === 'items' ? GRAPHIC_ITEM_LIMITS[g.template] ?? MAX_GRAPHIC_ITEMS : key === 'highlights' || key === 'notes' ? 2 : 3} maxLength={key === 'items' ? MAX_GRAPHIC_FIELD_CHARS * 5 : MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''} onChange={(e) => field(key, e.target.value)} aria-label={`${templateInfo(g.template).label} ${fieldLabel(g.template, key).toLowerCase()}`} />
          : <input className="editor-graphic-input" maxLength={MAX_GRAPHIC_FIELD_CHARS} value={g.fields[key] ?? ''} onChange={(e) => field(key, e.target.value)} aria-label={`${templateInfo(g.template).label} ${fieldLabel(g.template, key).toLowerCase()}`}
            placeholder={key === 'value' ? 'e.g. the number said in the clip' : key === 'domain' ? 'e.g. yoursite.com' : key === 'from' ? 'e.g. 12.5' : undefined} />}
        {FIELD_HINTS[g.template]?.[key] && <span className="block text-2xs text-ink-subtle">{FIELD_HINTS[g.template]?.[key]}</span>}
      </label>)}
      {g.template === 'icon_pop' && <IconFields fields={g.fields} onField={field} />}
      {g.template === 'list' && graphicVariant('list', g.fields) === 'chips' && <IconFields fields={g.fields} onField={field} template="list" imageNote={false} />}
      {g.template === 'big_words' && <BigWordsFields fields={g.fields} onField={field} />}
      <DiagramFields template={g.template} fields={g.fields} onField={field} />
      {(g.template === 'orbit' || g.template === 'feature_tile') && <IconFields fields={g.fields} onField={field} template={g.template} imageNote={g.template === 'orbit'} />}
      {g.template === 'orbit' && <div className="flex items-center justify-between gap-2 text-xs"><span>Labels under the icons</span>
        <Switch label="Labels under the icons" checked={g.fields.labels !== 'off'} onChange={(on) => field('labels', on ? '' : 'off')} /></div>}
      {g.template === 'feature_tile' && <div className="flex items-center justify-between gap-2 text-xs"><span>Red dot on the first tile</span>
        <Switch label="Red dot on the first tile" checked={g.fields.dot === 'on'} onChange={(on) => field('dot', on ? 'on' : '')} /></div>}
      {(WORD_TIMED_TEMPLATES.includes(g.template) || isDiagram(g.template) || (g.template === 'fx' && !!fxEffect(g.fields.effect)?.cue)) && <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" icon={<AudioLines size={13} />} onClick={matchWords}
          tooltip={isDiagram(g.template) ? 'Find each item in what you say while the graphic is on screen, so each one lights up as you say it.' : 'Find these words in what you say near the graphic. It then starts on your first word, shows each word as you say it and stays until just after the last.'}>Match my words</Button>
          <span className="text-2xs text-ink-subtle">{(isDiagram(g.template) ? g.fields.item_ms : g.template === 'fx' ? g.fields.cue_ms : g.fields.word_ms) ? 'Timed to your words' : isDiagram(g.template) ? 'Items light up on their own beat' : g.template === 'fx' ? 'Plays on its own beat' : 'Words build in on their own beat'}</span></div>
        {matchNote && <p role="status" className="text-2xs text-ink-subtle">{matchNote}</p>}</div>}
      {graphicCanGoBehind(g.template) && <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs"><span>Behind me</span>
          <Switch label="Behind me" checked={graphicDepth(g) === 'behind'} onChange={(on) => onChange(updateGraphic(candidate, g.id, { depth: on ? 'behind' : 'front' }))} /></div>
        <p className="text-2xs text-ink-subtle">{graphicDepth(g) === 'behind' ? 'In the export you stand in front of it: you’re cut out of the video and laid back over it. The preview here shows it in front.' : 'It sits over the video, in front of you.'}</p></div>}
      {g.template === 'takeover' && <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs"><span>Head between the lines</span>
          <Switch label="Head between the lines" checked={graphicDepth(g) === 'between'} onChange={(on) => onChange(updateGraphic(candidate, g.id, { depth: on ? 'between' : 'front' }))} /></div>
        <p className="text-2xs text-ink-subtle">{graphicDepth(g) === 'between' ? 'In the export the room behind you softens, one or two lines sit just above your head (tucked behind it) and the rest go in front of you. Every line stays readable; if it can’t, all lines go in front. The preview here shows the words only.' : 'The words sit over the video, in front of you.'}</p></div>}
      {g.template === 'stat' && <p className="text-2xs text-ink-subtle">The number counts up. Use one from the clip, like “$1,200/month”, “15 billion” or “25%”.</p>}
      {g.template === 'highlight' ? <div className="space-y-2">
        <Segmented label="Shape" size="sm" value={highlightPoint(g.fields).shape} onChange={(shape) => field('shape', shape)} options={[{ value: 'circle', label: 'Circle' }, { value: 'arrow', label: 'Arrow' }]} />
        {(['x', 'y'] as const).map((axis) => <label key={axis} className="editor-label">{axis === 'x' ? 'Across' : 'Down'} <span className="float-right">{Math.round(highlightPoint(g.fields)[axis] * 100)}%</span>
          <input type="range" min={0} max={100} step={1} aria-label={axis === 'x' ? 'Point across' : 'Point down'} value={Math.round(highlightPoint(g.fields)[axis] * 100)} onChange={(e) => field(axis, String(Number(e.target.value) / 100))} /></label>)}
      </div> : g.template === 'custom' ? null : g.template === 'chapter' ? <p className="text-2xs text-ink-subtle">A chapter header sits at the very top. Other graphics stay under it while it shows.</p> : <div className="space-y-1">{g.template !== 'big_words' && <><p className="editor-label">Size</p>
        <Segmented<GraphicSize> label="Graphic size" size="sm" value={g.size ?? 'card'} onChange={(size) => onChange(updateGraphic(candidate, g.id, { size }))} options={SIZE_OPTIONS} /></>}
        {g.size === 'stage' && g.template !== 'big_words' ? <p className="text-2xs text-ink-subtle">Stage: a big card over the top half of the video. Keep it short, so the speaker shows again.</p> : <>
          <p className="editor-label pt-1">Place</p>
          <Segmented<GraphicPlacement> label="Graphic placement" size="sm" value={g.placement} onChange={(placement) => onChange(updateGraphic(candidate, g.id, { placement }))}
            options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} /></>}
        <p className="text-2xs text-ink-subtle">Graphics stay clear of the hook and the captions.</p></div>}
      <label className="editor-label">Length <span className="float-right">{(g.duration_ms / 1000).toFixed(1)}s</span>
        <input type="range" aria-label="Graphic length" min={GRAPHIC_MIN_MS} max={Math.min(graphicMaxMs(g.template), Math.max(GRAPHIC_MIN_MS, clipEnd - g.at_ms))} step={100} value={g.duration_ms} onChange={(e) => onChange(updateGraphic(candidate, g.id, { duration_ms: Number(e.target.value) }))} /></label>
      {g.template === 'chapter' && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => {
        // Until the next chapter starts (or the clip ends).
        const next = graphics.filter((x) => x.template === 'chapter' && x.at_ms > g.at_ms).reduce((min, x) => Math.min(min, x.at_ms), clipEnd)
        onChange(updateGraphic(candidate, g.id, { duration_ms: Math.max(GRAPHIC_MIN_MS, next - g.at_ms - (next < clipEnd ? 100 : 0)) }))
      }} tooltip="Keep this header up until the next chapter header starts, or until the clip ends.">Last until the next chapter</Button>}
      <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-subtle"><span>Starts {clock(g.at_ms)}</span>
        <Button size="sm" variant="ghost" disabled={time < clipStart || time > clipEnd} onClick={() => onChange(updateGraphic(candidate, g.id, { at_ms: Math.round(time) }))}>Start at playhead</Button></div>
      {g.template !== 'custom' && <><div className="flex items-center justify-between gap-2 text-xs"><span>Color</span>
        <span className="flex items-center gap-2"><input type="color" className="editor-graphic-color" aria-label="Graphic color" value={(isHexColor(g.fields.color) ? g.fields.color : isDiagram(g.template) ? DIAGRAM_ACCENT : style.color).toLowerCase()}
          onChange={(e) => field('color', e.target.value.toUpperCase())} />
          {isHexColor(g.fields.color) && <Button size="sm" variant="ghost" onClick={() => onChange(updateGraphic(candidate, g.id, { fields: { color: '' } }))}>{isDiagram(g.template) ? 'Use green' : 'Use hook color'}</Button>}</span></div>
      <p className="text-2xs text-ink-subtle">{isHexColor(g.fields.color) ? 'This graphic has its own color.' : isDiagram(g.template) ? 'Lights up in green. Pick a color to use yours.' : style.color === GRAPHIC_DEFAULT_COLOR ? 'Uses blue. Give the hook a brand color to use yours.' : 'Uses the hook’s brand color.'} {isDiagram(g.template) ? 'Over your video it sits on a blue panel; in a Visual scene with the Solid backdrop it is drawn right on the backdrop.' : 'The font follows the hook.'}</p></>}
    </fieldset>}
  </section>
}
