/**
 * The graphics gallery: every motion graphic template as a live animated tile, in groups, with a plain line about
 * what it does and a search. Picking one adds it where the member is (the playhead, or the review strip's spot),
 * already filled with the words said there when the place can find them. Used by the clip editor (the "+ Add
 * graphic" buttons, the Graphics row, the G key) and by the review screens' Graphics forms.
 */
import type { LogoSummary } from '../../shared/logos'
import { LogoPickRow } from './MyLogos'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALargeSmall, AppWindow, Bookmark, Heading, CircleCheckBig, Columns2, Contact, Crosshair, Filter, Footprints, Hash, Highlighter, Image, LayoutGrid, Lightbulb, ListChecks, ListOrdered,
  MessageCircle, MonitorPlay, MousePointerClick, Orbit, Pilcrow, Quote, Search, Shapes, Sparkles, Sprout, StickyNote, Strikethrough, TrendingUp, Type, Wand2, X, type LucideIcon
} from 'lucide-react'
import { DIAGRAM_ACCENT, graphicHasContent, graphicVariants, isDiagram, type GraphicRenderSpec, type GraphicTemplateId } from '../../shared/motion-graphics'
import { outputSize } from '../../shared/graphic-layout'
import { cn } from '../lib/utils'
import { GRAPHIC_GROUPS, GraphicView, SAMPLES, effectSample, graphicGroup } from './ClipGraphics'
import { FX_EFFECTS, FX_GROUPS, fxEffect, fxHasContent, fxNeedsPicture, fxPictureFields, type FxEffect } from '../../shared/fx-catalog'
import { FX_SAMPLE_PICTURES } from '../graphics/fx/samples'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import { Segmented } from './ui/Segmented'
import { MotionLibraryGrid } from './MotionLibrary'
import type { LibraryView } from '../../shared/motion-library'
import { THEME_LABELS, type EditorDesignInfo } from '../../shared/custom-graphics'
import './graphic-gallery.css'

/** Each template's icon (the gallery, the timeline blocks and the preview toolbar). */
export const TEMPLATE_ICONS: Record<GraphicTemplateId, LucideIcon> = {
  stat: Hash, title: Type, list: ListOrdered, lower_third: Contact, logo: Image, before_after: Columns2, checklist: ListChecks, quote: Quote, highlight: Crosshair,
  statement: Pilcrow, sticky_notes: StickyNote, strike_list: Strikethrough, browser_frame: AppWindow, icon_pop: Shapes, headline_pill: Highlighter, comment_cta: MessageCircle, link_cta: MousePointerClick,
  big_words: ALargeSmall, orbit: Orbit, feature_tile: LayoutGrid, screen_frame: MonitorPlay, chapter: Bookmark, staircase: TrendingUp, funnel: Filter, journey: Footprints,
  growth: Sprout, idea_hub: Lightbulb, compare_marks: CircleCheckBig, fx: Sparkles, takeover: Heading, custom: Wand2
}

export interface GalleryTemplate { id: GraphicTemplateId; label: string; detail: string }

/** A tile's animation: the words said at the spot when there are some, else sample words, on a square crop. */
export function galleryPreview(id: GraphicTemplateId, style: { color: string; font: string }, words?: Record<string, string>, look?: string): GraphicRenderSpec {
  const { width, height } = outputSize('1:1')
  if (id === 'fx') {
    // An effect (`look` is its id): the words said here when they fill it, else its sample words.
    const effect = fxEffect(look) ?? FX_EFFECTS[0]
    // An effect on the member's pictures previews with plain stand-in pictures (never their words: there are none to show yet).
    const samples = samplePictures(effect)
    const own = !samples && words && fxHasContent({ ...words, effect: effect.id }) ? { ...words, effect: effect.id } : null
    return { template: 'fx', fields: own ?? effectSample(effect.id), width, height, duration_ms: Math.min(5000, effect.default_ms), box: { top: .12, bottom: .88 }, placement: 'middle', ...style,
      ...(effect.size === 'compact' ? { size: 'compact' as const } : {}), ...(samples ?? {}) }
  }
  const own = words && graphicHasContent({ template: id, fields: words }) ? words : null
  const sample = id === 'highlight' ? { ...SAMPLES[id], y: '0.5' } : SAMPLES[id]
  const fields = { ...(own ? { ...sample, ...own } : sample), ...(isDiagram(id) ? { panel: 'on' } : {}), ...(look ? { variant: look } : {}) }
  // Keep a picture-only sample's own fields (a Logo pop never has words to show).
  return { template: id, fields, width, height, duration_ms: isDiagram(id) ? 4200 : 2600, box: { top: .06, bottom: .94 }, placement: 'middle', ...style, ...(isDiagram(id) ? { color: DIAGRAM_ACCENT } : {}) }
}

/** The stand-in pictures an effect previews with in the gallery (null: it shows no pictures). */
function samplePictures(effect: FxEffect): { image?: string; image_b?: string } | null {
  const fields = fxPictureFields(effect).filter((f) => f.required)
  if (!fields.length) return null
  return Object.fromEntries(fields.map((f) => [f.key, FX_SAMPLE_PICTURES[f.sample ?? 'page'] ?? FX_SAMPLE_PICTURES.page]))
}

/**
 * The effects a gallery lists: the ones that need the member's own pictures only where pictures can be added
 * (`pictures`: the clip editor, or an edited reel with screenshots); never one that would show an empty frame.
 */
export function galleryEffects(pictures: boolean): FxEffect[] {
  return FX_EFFECTS.filter((e) => pictures || !fxNeedsPicture(e))
}

export function GraphicGallery({ templates, where, style, prefill, prefillEffect, full, limitNote, looks = false, pictures = false, title = 'Add a graphic', onPick, onLogo, library, design, onClose }: {
  templates: readonly GalleryTemplate[]
  /** Where it goes, in words ("at 0:03.2, on “three things”"). */
  where: string
  style: { color: string; font: string }
  /** The words each template would start with here (empty: it starts with none). */
  prefill?: (template: GraphicTemplateId) => Record<string, string>
  /** The words each effect would start with here (offered when `templates` includes the Effect template). */
  prefillEffect?: (effect: string) => Record<string, string>
  /** No more graphics fit. */
  full: boolean
  limitNote: string
  /** Offer each template's looks (GRAPHIC_VARIANTS) as small buttons under its tile. */
  looks?: boolean
  /** The dialog's title (the beat sheet swaps a visual: "Swap the visual"). */
  title?: string
  /** The member can add pictures here: the effects on their own screenshots and photos are offered (they ask for one). */
  pictures?: boolean
  /** `look`: the look picked (GRAPHIC_VARIANTS), or for an effect (template 'fx') the effect's id. */
  onPick: (template: GraphicTemplateId, look?: string) => void
  /** One of My logos picked (a Logo pop with it); the row shows only when the member has logos. */
  onLogo?: (logo: LogoSummary) => void
  /** My motion library as a tab (the member's custom graphics, to add here filled with the words said). */
  library?: { onPick: (item: LibraryView) => void; busy?: string | null; error?: string | null }
  /** "Design a custom graphic here": your AI designs a new one for the words said at this spot (paid; the clip editor). */
  design?: DesignHere
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'builtin' | 'library'>('builtin')
  // The look a tile previews while the pointer (or focus) is on one of its look buttons.
  const [peek, setPeek] = useState<{ id: GraphicTemplateId; look: string } | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)
  useEffect(() => {
    search.current?.focus({ preventScroll: true })
    const back = opener.current
    return () => { if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true }) }
  }, [])
  const plain = useMemo(() => templates.filter((t) => t.id !== 'fx'), [templates])
  const withEffects = plain.length < templates.length
  const words = useMemo(() => Object.fromEntries(plain.map((t) => [t.id, prefill?.(t.id) ?? {}])) as Record<GraphicTemplateId, Record<string, string>>, [plain, prefill])
  const offered = useMemo(() => galleryEffects(pictures), [pictures])
  const effectWords = useMemo(() => withEffects ? Object.fromEntries(offered.map((e) => [e.id, fxNeedsPicture(e) ? {} : prefillEffect?.(e.id) ?? {}])) as Record<string, Record<string, string>> : {}, [withEffects, prefillEffect, offered])
  const q = query.trim().toLowerCase()
  const match = (t: GalleryTemplate): boolean => !q || `${t.label} ${t.detail} ${t.id.replace(/_/g, ' ')} ${groupLabel(t.id)}`.toLowerCase().includes(q)
  const groups = [...GRAPHIC_GROUPS, { id: 'other' as const, label: 'More', templates: plain.map((t) => t.id).filter((id) => graphicGroup(id) === 'other') }]
    .map((group) => ({ ...group, items: plain.filter((t) => group.templates.includes(t.id) && match(t)) })).filter((group) => group.items.length)
  // Effects: one tile per effect (HyperFrames units, fx-catalog.ts), in their own groups after the templates.
  const effectGroups = withEffects ? FX_GROUPS.map((group) => ({ ...group, items: offered.filter((e) => e.group === group.id && (!q || `${e.label} ${e.detail} ${group.label} effect ${e.jobs.join(' ')}`.toLowerCase().includes(q))) }))
    .filter((group) => group.items.length) : []
  const first = groups[0]?.items[0]
  const firstEffect = effectGroups[0]?.items[0]
  const filled = Object.values(words).some((f) => Object.keys(f).length > 0) || Object.values(effectWords).some((f) => Object.keys(f).length > 0)
  return <Dialog aria-label={title} panelClassName="graphic-gallery max-w-[980px] h-[min(780px,100%)]" onBackdropMouseDown={onClose}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}>
    <header className="graphic-gallery-head">
      <div className="min-w-0">
        <h2 className="graphic-gallery-title">{title}</h2>
        <p className="text-2xs text-ink-subtle">Starts {where}. {filled ? 'Each one starts with the words you say there; you can change them after.' : 'You add the words next; the previews use sample words.'}</p>
      </div>
      <label className="graphic-gallery-search"><Search size={14} aria-hidden />
        <input ref={search} type="search" aria-label="Search graphics" placeholder="Search: stat, list, steps…" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (first || firstEffect) && !full) { e.preventDefault(); if (first) onPick(first.id); else if (firstEffect) onPick('fx', firstEffect.id) } }} /></label>
      <Button size="sm" variant="ghost" iconOnly icon={<X size={15} />} aria-label="Close" onClick={onClose} />
    </header>
    {library && <div className="px-4 pt-2"><Segmented size="sm" label="Gallery" value={tab} onChange={setTab} options={[{ value: 'builtin', label: 'Built-in graphics and effects' }, { value: 'library', label: 'My graphics' }]} /></div>}
    {library && tab === 'library' ? <section className="graphic-gallery-body" aria-label="My motion library">
      {library.error && <p role="alert" className="graphic-gallery-note text-danger">{library.error}</p>}
      <MotionLibraryGrid onPick={full ? undefined : library.onPick} busy={library.busy ?? null} />
    </section> : <section className="graphic-gallery-body" aria-label="Choose a graphic">
      {full && <p role="note" className="graphic-gallery-note">{limitNote}</p>}
      {design && !query.trim() && <DesignHereCard design={design} full={full} />}
      {onLogo && !full && !query.trim() && <div className="graphic-gallery-group" role="group" aria-label="My logos"><LogoPickRow label="My logos: pops in on a white tile" onPick={onLogo} /></div>}
      {groups.map((group) => <div key={group.id} className={cn('graphic-gallery-group', `group-${group.id}`)} role="group" aria-label={group.label}>
        <p className="graphic-gallery-group-label"><span aria-hidden className="graphic-gallery-dot" />{group.label}<span className="graphic-gallery-count">{group.items.length}</span></p>
        <div className="graphic-gallery-grid">{group.items.map((t, i) => {
          const Icon = TEMPLATE_ICONS[t.id]
          const own = graphicHasContent({ template: t.id, fields: words[t.id] }) && Object.keys(words[t.id]).length > 0
          const variants = looks ? graphicVariants(t.id) : []
          const tile = <button key={t.id} type="button" className="editor-graphic-tile graphic-gallery-tile" disabled={full} onClick={() => onPick(t.id)} title={t.detail} aria-label={`Add ${t.label}`}>
            <span className="graphic-gallery-thumb"><GraphicView spec={galleryPreview(t.id, style, words[t.id], peek?.id === t.id ? peek.look : undefined)} width={150} loop offset={900 + i * 370} />
              {own && <span className="graphic-gallery-yours">Your words</span>}</span>
            <span className="graphic-gallery-name"><Icon size={13} aria-hidden />{t.label}</span>
            <span className="graphic-gallery-detail">{t.detail}</span>
          </button>
          if (!variants.length) return tile
          return <div key={t.id} className="graphic-gallery-cell">{tile}
            <div className="graphic-gallery-looks" role="group" aria-label={`${t.label} looks`}>{variants.map((v) => <button key={v.id} type="button" disabled={full} title={v.detail}
              aria-label={`Add ${t.label}: ${v.label}`} onClick={() => onPick(t.id, v.id)} onMouseEnter={() => setPeek({ id: t.id, look: v.id })} onFocus={() => setPeek({ id: t.id, look: v.id })}
              onMouseLeave={() => setPeek(null)} onBlur={() => setPeek(null)}>{v.label}</button>)}</div></div>
        })}</div>
      </div>)}
      {effectGroups.map((group) => <div key={group.id} className="graphic-gallery-group group-other" role="group" aria-label={group.label}>
        <p className="graphic-gallery-group-label"><span aria-hidden className="graphic-gallery-dot" />{group.label}<span className="graphic-gallery-count">{group.items.length}</span></p>
        <div className="graphic-gallery-grid">{group.items.map((e, i) => {
          const own = Object.keys(effectWords[e.id] ?? {}).length > 0 && fxHasContent({ ...effectWords[e.id], effect: e.id })
          const needs = fxNeedsPicture(e)
          return <button key={e.id} type="button" className="editor-graphic-tile graphic-gallery-tile" disabled={full} onClick={() => onPick('fx', e.id)} title={needs ? `${e.detail} You choose your picture next.` : e.detail}
            aria-label={`Add effect ${e.label}${needs ? ' (choose your picture)' : ''}`}>
            <span className="graphic-gallery-thumb"><GraphicView spec={galleryPreview('fx', style, effectWords[e.id], e.id)} width={150} loop offset={700 + i * 410} />
              {needs ? <span className="graphic-gallery-yours">Needs your picture</span> : own && <span className="graphic-gallery-yours">Your words</span>}</span>
            <span className="graphic-gallery-name"><Sparkles size={13} aria-hidden />{e.label}</span>
            <span className="graphic-gallery-detail">{e.detail}</span>
          </button>
        })}</div>
      </div>)}
      {!groups.length && !effectGroups.length && <p className="graphic-gallery-note">No graphic matches “{query.trim()}”. Try a word like stat, list, steps, quote or words.</p>}
    </section>}
  </Dialog>
}

function groupLabel(id: GraphicTemplateId): string {
  return GRAPHIC_GROUPS.find((g) => g.templates.includes(id))?.label ?? 'More'
}

/** The clip editor's "Design a custom graphic here": what it costs, its look, the member's note and its progress. */
export interface DesignHere {
  /** The estimate and look (null while it loads). */
  info: EditorDesignInfo | null
  busy: boolean
  error: string | null
  onDesign: (note: string) => void
}

const usd = (n: number): string => `$${n.toFixed(2)}`

/** Designing a new custom graphic at the gallery's spot, in the same look as the custom graphic's "Change it" controls. */
function DesignHereCard({ design, full }: { design: DesignHere; full: boolean }): React.JSX.Element {
  const [note, setNote] = useState('')
  const [seconds, setSeconds] = useState(0)
  const { info, busy, error } = design
  useEffect(() => {
    if (!busy) { setSeconds(0); return }
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])
  const unavailable = info && !info.available
  return <section className="graphic-gallery-design space-y-2" aria-label="Design a custom graphic here" data-testid="design-custom">
    <p className="graphic-gallery-design-title"><Wand2 size={14} aria-hidden />Design a custom graphic here</p>
    <p className="text-2xs text-ink-subtle">Your AI designs a new one for what you say at this spot{info ? `, in this video’s look (${THEME_LABELS[info.theme]})` : ''}, then checks it over your video. Only the words you say here can appear on it.</p>
    <label className="editor-label">What you want (optional)
      <textarea rows={2} maxLength={300} value={note} disabled={busy || full || !!unavailable} placeholder="Like “make it a rocket” or “show it as steps”" aria-label="What the custom graphic should show"
        onChange={(e) => setNote(e.target.value)} /></label>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" icon={<Wand2 size={13} />} loading={busy} disabled={busy || full || !info || !info.available} onClick={() => design.onDesign(note.trim())}
        tooltip="Your AI designs it for the words said here, then checks it over your video.">Design it here</Button>
      {info?.available && <span className="text-2xs text-ink-subtle" data-testid="design-estimate">Uses your OpenRouter credit: about {usd(info.expectedUsd)}, at most {usd(info.mostUsd)}.</span>}
    </div>
    {unavailable && <p role="note" className="text-2xs text-ink-subtle">{info.reason}</p>}
    {busy && <p role="status" className="text-2xs text-ink-subtle">Designing… writing it, drawing it over your video and checking it (usually 1 to 3 minutes). {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>}
    {error && !busy && <p role="alert" className="text-2xs text-danger">{error}</p>}
  </section>
}
