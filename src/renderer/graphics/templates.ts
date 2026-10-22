/**
 * Our motion graphic templates: DOM + CSS animated with an anime.js timeline
 * that is never played on its own clock. `seek(ms)` puts every element where
 * it is at that moment, so the editor's preview follows the playhead and the
 * offscreen render steps frame by frame (same input, same pixels).
 *
 * One design system for every template (graphics.css): clean white rounded
 * cards with a soft shadow (and a thin accent glow on the key ones), bold sans
 * headlines with an italic serif accent, the brand color as the accent. Shared
 * moves: card enter (scale up, rise, fade), word-by-word build, pop-in that
 * settles, a highlight marker sweeping across a phrase, a rounded box drawn
 * around a phrase, a strike-through drawn line by line, a slow push-in while
 * the card is on screen and a short clean exit.
 *
 * Text is only ever set with textContent, and only words from the graphic's
 * fields are drawn. The page draws on a transparent background; each template
 * animates in, holds and animates out within `spec.duration_ms`.
 */
import { createTimeline } from 'animejs'
import './graphics.css'
import { ICONS } from './icons'
import { bigWordsTemplate } from './big-words'
import { chapterTemplate, compareMarksTemplate, funnelTemplate, growthTemplate, ideaHubTemplate, journeyTemplate, staircaseTemplate } from './diagrams'
import {
  accentWords, browserHighlights, cardWords, formatStatValue, graphicIcons, graphicItems, graphicItemTimes, graphicWordTimes, highlightPoint, orbitNodes, parseStatValue,
  screenFrameLayout, templateItems, SCREEN_FADE_MS, type GraphicRenderSpec
} from '../../shared/motion-graphics'

export interface MountedGraphic {
  /** Show the graphic as it is `ms` into its animation (hidden outside 0..duration). */
  seek: (ms: number) => void
  destroy: () => void
  /** Resolves when fonts are loaded and the layout is fitted to its band. */
  ready: Promise<void>
}

/** The headline face follows the hook's font; the accent is always the italic serif. */
const DISPLAY: Record<string, { family: string; weight: number; upper: boolean; tracking: string }> = {
  clean: { family: '"MG Jakarta", "MG Montserrat", sans-serif', weight: 800, upper: false, tracking: '-0.025em' },
  serif: { family: '"MG Fraunces", "Fraunces 72pt Black", Georgia, serif', weight: 400, upper: false, tracking: '-0.01em' },
  condensed: { family: '"MG Anton", "Anton", Impact, sans-serif', weight: 400, upper: true, tracking: '0.005em' },
  marker: { family: '"MG Caveat Brush", "Caveat Brush", cursive', weight: 400, upper: true, tracking: '0' },
  sans_serif_accent: { family: '"MG Jakarta", "MG Montserrat", sans-serif', weight: 800, upper: false, tracking: '-0.025em' }
}
const FONT_LOADS = ['900 40px "MG Montserrat"', '800 40px "MG Montserrat"', '800 40px "MG Jakarta"', '600 40px "MG Jakarta"', '40px "MG Anton"', '40px "MG Fraunces"',
  '40px "MG Caveat Brush"', 'italic 40px "MG Instrument Serif"', '40px "MG Instrument Serif"']
/** Size scale per graphic size: a compact card, the usual card, the stage. */
const SIZE_SCALE = { compact: .82, card: 1, stage: 1.1 } as const

function rgb(hex: string): [number, number, number] {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#2F5BFF'
  return [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}
function onColor(hex: string): string {
  const [r, g, b] = rgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 165 ? '#0F172A' : '#ffffff'
}
/** The accent as text on white: a very light brand color is darkened so it stays readable. */
function accentInk(hex: string): string {
  const [r, g, b] = rgb(hex)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (lum <= 150) return hex
  const k = 150 / lum
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  parent?.appendChild(node)
  return node
}
function svg(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent.appendChild(node)
  return node
}
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const outExpo = (p: number): number => p >= 1 ? 1 : p <= 0 ? 0 : 1 - Math.pow(2, -10 * p)
const clean = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

type Value = number | string
/** A value, or one worked out once the layout is measured (fonts loaded, picture sizes known). */
type Lazy = Value | (() => Value)
type Segment = { at: number; duration: number; from: Lazy; to: Lazy; ease: string }
const value = (v: Lazy): Value => typeof v === 'function' ? v() : v
/**
 * Templates describe moves as `add(target, { prop: [from, to], duration, ease }, at)`.
 * Each element's moves on one property become ONE anime.js animation with
 * keyframes (separated by holds), so no two animations ever write the same
 * property: seeking to any time, in any order, gives the same frame.
 */
class Tracks {
  private items = new Map<Element, Map<string, Segment[]>>()
  add(target: Element, params: Record<string, unknown>, at: number): this {
    const duration = Math.max(1, Number(params.duration) || 1), ease = String(params.ease ?? 'linear')
    let props = this.items.get(target)
    if (!props) { props = new Map(); this.items.set(target, props) }
    for (const [key, v] of Object.entries(params)) {
      if (key === 'duration' || key === 'ease' || !Array.isArray(v)) continue
      const list = props.get(key) ?? []
      list.push({ at: Math.max(0, at), duration, from: v[0] as Lazy, to: v[1] as Lazy, ease })
      props.set(key, list)
    }
    return this
  }
  /** Remove what the moves wrote, leaving each element's own layout. */
  clear(): void {
    for (const target of this.items.keys()) {
      const style = (target as HTMLElement).style
      style.removeProperty('transform'); style.removeProperty('opacity')
    }
  }
  timeline(total: number): ReturnType<typeof createTimeline> {
    const tl = createTimeline({ autoplay: false, defaults: { composition: 'none' } })
    for (const [target, props] of this.items) {
      const params: Record<string, unknown> = {}
      // Before its first move an element shows that move's starting value.
      const initial: Record<string, Value> = {}
      for (const [key, raw] of props) initial[key] = value([...raw].sort((a, b) => a.at - b.at)[0].from)
      setInitial(target, initial)
      for (const [key, raw] of props) {
        const list = [...raw].sort((a, b) => a.at - b.at)
        const frames: Record<string, unknown>[] = []
        let end = 0
        list.forEach((seg, i) => {
          // A move that starts before the previous one ends cuts it short.
          const next = list[i + 1]
          const duration = next ? Math.max(1, Math.min(seg.duration, next.at - seg.at)) : seg.duration
          // The value holds until the move begins (a keyframe delay).
          frames.push({ from: value(seg.from), to: value(seg.to), duration, ease: seg.ease, delay: Math.max(0, seg.at - end) })
          end = Math.max(end, seg.at) + duration
        })
        params[key] = frames
      }
      tl.add(target as HTMLElement, params as never, 0)
    }
    // Hold everything to the end, so seeking anywhere in the graphic is stable.
    tl.add({ duration: 1 }, Math.max(1, total))
    return tl
  }
}

const TRANSFORMS = ['translateX', 'translateY', 'rotate', 'scale', 'scaleX', 'scaleY']
/** Write starting values directly (anime.js renders an element only once its first move begins). */
function setInitial(target: Element, values: Record<string, Value>): void {
  const style = (target as HTMLElement).style
  const parts: string[] = []
  for (const key of TRANSFORMS) {
    const v = values[key]
    if (v === undefined) continue
    const unit = typeof v === 'string' ? '' : key.startsWith('translate') ? 'px' : key === 'rotate' ? 'deg' : ''
    parts.push(`${key}(${v}${unit})`)
  }
  if (parts.length) style.transform = parts.join(' ')
  for (const [key, v] of Object.entries(values)) {
    if (TRANSFORMS.includes(key)) continue
    if (key === 'opacity') style.opacity = String(v)
    else if (target instanceof SVGElement) target.setAttribute(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(v))
  }
}

/** Timing shared by every template: a snappy entrance, the hold, a short exit. */
function phases(duration: number): { tin: number; tout: number; outAt: number; hold: number } {
  const tin = clamp(duration * .14, 260, 420), tout = clamp(duration * .09, 180, 280)
  return { tin, tout, outAt: duration - tout, hold: Math.max(0, duration - tin - tout) }
}

interface Build {
  root: HTMLElement; band: HTMLElement; fit: HTMLElement
  tl: Tracks; spec: GraphicRenderSpec; u: number
  /** Extra per-frame work (counters), run after the timeline is seeked. */
  onSeek: ((ms: number) => void)[]
  /** Layout fixes once fonts and pictures are loaded (before fitting the band). */
  fitters: (() => void)[]
  /** Measurements once the layout is fitted to its band (boxes drawn around words). */
  after: (() => void)[]
}

export function mountGraphic(host: HTMLElement, spec: GraphicRenderSpec): MountedGraphic {
  const { width: W, height: H } = spec
  const size = spec.size === 'compact' || spec.size === 'stage' ? spec.size : 'card'
  const u = Math.min(W, H) / 1080 * SIZE_SCALE[size]
  const display = DISPLAY[spec.font] ?? DISPLAY.clean
  const root = el('div', `mg-root size-${size}`, host)
  root.style.width = `${W}px`; root.style.height = `${H}px`
  root.style.setProperty('--u', `${u}px`)
  root.style.setProperty('--accent', spec.color)
  root.style.setProperty('--accent-rgb', rgb(spec.color).join(', '))
  root.style.setProperty('--accent-ink', accentInk(spec.color))
  root.style.setProperty('--on-accent', onColor(spec.color))
  root.style.setProperty('--display', display.family)
  root.style.setProperty('--display-weight', String(display.weight))
  root.style.setProperty('--display-case', display.upper ? 'uppercase' : 'none')
  root.style.setProperty('--display-tracking', display.tracking)
  const frameU = Math.min(W, H) / 1080
  const widest = size === 'stage' ? 984 : size === 'compact' ? 800 : 940
  root.style.setProperty('--card-w', `${Math.round(Math.min(W - (size === 'stage' ? 96 : 140) * frameU, widest * frameU))}px`)
  root.style.setProperty('--logo', `${Math.round(Math.min(380 * u, (spec.box.bottom - spec.box.top) * H * .62))}px`)
  const band = el('div', `mg-band ${size === 'stage' ? 'stage' : spec.placement}`, root)
  band.style.top = `${spec.box.top * H}px`
  band.style.height = `${(spec.box.bottom - spec.box.top) * H}px`
  const fit = el('div', 'mg-fit', band)
  const tracks = new Tracks()
  const build: Build = { root, band, fit, tl: tracks, spec, u, onSeek: [], fitters: [], after: [] }
  const make = TEMPLATES[spec.template] ?? TEMPLATES.title
  make(build)
  // Every seek starts a fresh timeline at 0 and jumps to the time, so a frame
  // never depends on which frames came before it (the render and the editor's
  // scrubbing get the same pixels).
  let tl = tracks.timeline(spec.duration_ms)
  let last = 0
  const seek = (ms: number): void => {
    const t = clamp(ms, 0, spec.duration_ms)
    root.style.visibility = ms < 0 || ms >= spec.duration_ms ? 'hidden' : 'visible'
    if (t !== last) { tl.revert(); tl = tracks.timeline(spec.duration_ms) }
    tl.seek(t, true)
    for (const fn of build.onSeek) fn(t)
    last = t
  }
  const ready = (async (): Promise<void> => {
    try { await Promise.all(FONT_LOADS.map((f) => document.fonts.load(f).catch(() => []))) } catch { /* system fonts */ }
    await Promise.all([...root.querySelectorAll('img')].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })))
    // Measure the laid-out content without any animation applied.
    tl.revert()
    tracks.clear()
    for (const fix of build.fitters) fix()
    fitToBand(build)
    for (const measure of build.after) measure()
    tl = tracks.timeline(spec.duration_ms)
    const at = last
    last = -1
    seek(at)
  })()
  seek(0)
  return { seek, ready, destroy: () => { tl.revert(); root.remove() } }
}

/**
 * Shrink the content to its band when the words make it taller (or wider) than
 * the room. Sizes are re-laid out at the smaller unit (not a scale transform),
 * so text is drawn crisply at its final size.
 */
function fitToBand({ band, fit, root, spec, u }: Build): void {
  if (['highlight', 'big_words', 'orbit', 'screen_frame', 'chapter', 'staircase', 'funnel', 'journey', 'growth', 'idea_hub', 'compare_marks'].includes(spec.template)) return
  fit.style.removeProperty('--u')
  fit.style.removeProperty('--card-w')
  const cardW = parseFloat(root.style.getPropertyValue('--card-w'))
  let scale = 1
  for (let i = 0; i < 4; i++) {
    const need = fit.scrollHeight, wide = fit.scrollWidth
    const next = scale * Math.min(1, band.clientHeight / Math.max(1, need), (band.clientWidth - 40 * u) / Math.max(1, wide))
    if (next >= scale - .001) break
    scale = next
    fit.style.setProperty('--u', `${u * scale}px`)
    fit.style.setProperty('--card-w', `${Math.round(cardW * scale)}px`)
  }
}

// ---------------------------------------------------------------------------
// Shared moves
// ---------------------------------------------------------------------------

/** The card entrance: up from 92% while rising and fading in. */
function cardIn(b: Build, target: HTMLElement, at = 0): void {
  const { tl, u } = b
  tl.add(target, { opacity: [0, 1], duration: 220, ease: 'outQuad' }, at)
  tl.add(target, { scale: [.92, 1], translateY: [44 * u, 0], duration: 420, ease: 'outQuart' }, at)
}
/** The clean exit: a short fade, shrinking a touch and lifting. */
function cardOut(b: Build, target: HTMLElement): void {
  const { tl, spec, u } = b
  const { tout, outAt } = phases(spec.duration_ms)
  tl.add(target, { opacity: [1, 0], scale: [1, .96], translateY: [0, -20 * u], duration: tout, ease: 'inCubic' }, outAt)
}
/** A slow push-in while the graphic holds (on a wrapper, so it never fights the card's own moves). */
function pushIn(b: Build, target: HTMLElement, amount = .035): void {
  const { tin, outAt } = phases(b.spec.duration_ms)
  if (outAt - tin > 400) b.tl.add(target, { scale: [1, 1 + amount], duration: outAt - tin, ease: 'inOutSine' }, tin)
}
/** Pop in and settle: from 115% and see-through to its place. */
function popIn(b: Build, target: Element, at: number, from = 1.15, duration = 340): void {
  b.tl.add(target, { opacity: [0, 1], duration: Math.min(180, duration), ease: 'outQuad' }, at)
  b.tl.add(target, { scale: [from, 1], duration, ease: 'outCubic' }, at)
}
/** Rise in (a word or a row): up a little while fading in. */
function riseIn(b: Build, target: Element, at: number, distance = 22, duration = 320): void {
  b.tl.add(target, { opacity: [0, 1], duration: Math.min(200, duration), ease: 'outQuad' }, at)
  b.tl.add(target, { translateY: [distance * b.u, 0], duration, ease: 'outCubic' }, at)
}
/** The common shell: a push-in wrapper around the main element, which enters and exits like a card. */
function shell(b: Build, className: string, parent: HTMLElement = b.fit): { push: HTMLElement; card: HTMLElement } {
  const push = el('div', 'mg-push', parent)
  const card = el('div', className, push)
  cardIn(b, card)
  cardOut(b, card)
  pushIn(b, push)
  return { push, card }
}
/**
 * Beats for revealing items during the hold (`share` of it): evenly spaced, or as each item is said when
 * the graphic has item times (`item_ms`, automatic graphics). `extra`: one more beat after the items (a
 * Crossed-out list's final line), from the times when given.
 */
function beats(spec: GraphicRenderSpec, count: number, share = .55, start?: number, extra = false): number[] {
  const { tin, hold, outAt } = phases(spec.duration_ms)
  const said = graphicItemTimes(spec.fields, count, spec.duration_ms)
  if (said) {
    // Never before the card has started to come in, and never during its exit.
    const lo = Math.min(start ?? 0, tin * .5), hi = Math.max(lo, outAt - 260)
    const times = said.slice(0, count + (extra ? 1 : 0)).map((t) => clamp(t - 80, lo, hi))
    for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + 120)
    return times
  }
  const from = start ?? tin * .8
  const step = count > 1 ? clamp((hold * share) / (count - 1), 160, 560) : 0
  return Array.from({ length: count }, (_, i) => from + i * step)
}

interface RichText {
  /** Every word's span, in order. */
  words: HTMLElement[]
  /** The italic accent group (null when there is none), its marker and the words' character counts. */
  accent: HTMLElement | null
  mark: HTMLElement | null
}
/**
 * Words as spans (so they can build one by one) with the accent words in a
 * group drawn in the italic serif, with a marker behind it for the sweep.
 * Typed line breaks are kept.
 */
function richText(parent: HTMLElement, text: string | undefined, accent: string | undefined | null, options: { marker?: boolean; accentClass?: string } = {}): RichText {
  const parts = accentWords(text, accent ?? undefined)
  const from = accent === null ? -1 : parts.from, to = accent === null ? -1 : parts.to
  const words: HTMLElement[] = []
  let group: HTMLElement | null = null, mark: HTMLElement | null = null
  parts.words.forEach((word, i) => {
    const inGroup = from >= 0 && i >= from && i <= to
    const container: HTMLElement = inGroup && i > from && group ? group : parent
    if (i > 0) {
      if (parts.breaks.includes(i)) el('br', '', container)
      else container.appendChild(document.createTextNode(' '))
    }
    if (i === from) {
      group = el('span', `mg-accent ${options.accentClass ?? ''}`.trim(), parent)
      if (options.marker !== false) mark = el('span', 'mg-mark', group)
    }
    words.push(el('span', 'mg-w', inGroup && group ? group : parent, word))
  })
  return { words, accent: group, mark }
}
/** The marker sweeping left to right across the accent words. */
function sweep(b: Build, mark: HTMLElement | null, at: number, duration = 460): void {
  if (mark) b.tl.add(mark, { scaleX: [0, 1], duration, ease: 'inOutCubic' }, at)
}
/** Build words one by one from `at`, `step` ms apart; returns when the last one lands. */
function buildWords(b: Build, words: HTMLElement[], at: number, step: number, how: 'rise' | 'pop' = 'rise'): number {
  words.forEach((w, i) => how === 'pop' ? popIn(b, w, at + i * step, 1.18, 300) : riseIn(b, w, at + i * step, 26, 340))
  return at + Math.max(0, words.length - 1) * step + 300
}
/** Each word's spoken time on a word-timed card (`word_ms`, ms into the graphic), or null (even beats are used). */
function saidTimes(spec: GraphicRenderSpec): number[] | null {
  return graphicWordTimes(spec.fields, cardWords(spec.template, spec.fields).length, spec.duration_ms)
}
/** How early a word starts coming in before it is said (it is clear about a frame after). */
const SAID_LEAD = 70
/** Build each word as it is said (`times`, ms into the graphic); returns when the last one lands. */
function buildWordsAt(b: Build, words: HTMLElement[], times: number[], how: 'rise' | 'pop' = 'rise'): number {
  words.forEach((w, i) => {
    const at = Math.max(0, times[i] - SAID_LEAD)
    if (how === 'pop') popIn(b, w, at, 1.18, 240)
    else riseIn(b, w, at, 22, 260)
  })
  return Math.max(0, (times[words.length - 1] ?? 0) - SAID_LEAD) + 240
}
/** The step between words so `count` of them build within `budget` ms. */
const wordStep = (count: number, budget: number, max = 120): number => count > 1 ? clamp(budget / (count - 1), 45, max) : 0

/** The offset of `node` inside `ancestor` (layout pixels: transforms and the editor's preview scale don't change it). */
function offsetIn(node: HTMLElement, ancestor: HTMLElement): { x: number; y: number; w: number; h: number } {
  let x = 0, y = 0, at: HTMLElement | null = node
  while (at && at !== ancestor) { x += at.offsetLeft; y += at.offsetTop; at = at.offsetParent as HTMLElement | null }
  return { x, y, w: node.offsetWidth, h: node.offsetHeight }
}
/** A rounded outline drawn around `target` (inside `container`, which must be positioned). */
function boxAround(b: Build, container: HTMLElement, target: HTMLElement, at: number, duration = 520): void {
  const layer = svg('svg', { class: 'mg-boxdraw' }, container)
  const path = svg('path', { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, layer)
  b.after.push(() => {
    const box = offsetIn(target, container)
    const unit = parseFloat(getComputedStyle(container).getPropertyValue('--u')) || b.u
    const padX = 12 * unit, padY = 6 * unit, r = Math.min(26 * unit, (box.h + padY * 2) / 2)
    const x = box.x - padX, y = box.y - padY, w = box.w + padX * 2, h = box.h + padY * 2
    // Starts at the top middle and goes all the way round, a little past the start, like a quick pen stroke.
    path.setAttribute('d', `M${x + w * .45},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + w * .56}`)
    path.setAttribute('stroke-width', String(5 * unit))
  })
  b.tl.add(path, { strokeDashoffset: [1, 0], duration, ease: 'inOutCubic' }, at)
}
/** Lucide icon (24 grid) as an inline SVG. */
function icon(parent: HTMLElement, name: keyof typeof ICONS, className: string): SVGElement {
  const node = svg('svg', { class: className, viewBox: '0 0 24 24', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent)
  for (const [tag, attrs] of ICONS[name]) svg(tag, attrs, node)
  return node
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES: Record<GraphicRenderSpec['template'], (b: Build) => void> = {
  stat(b) {
    const { spec, tl, u } = b
    const valueText = clean(spec.fields.value), label = clean(spec.fields.label)
    const { card } = shell(b, `mg-card glow mg-stat${label ? '' : ' no-label'}`)
    const stat = parseStatValue(valueText)
    const number = el('div', 'mg-stat-value mg-display', card)
    // A long unit ("/month", " billion") is drawn in the italic serif after the number; a short one ("%", "x") in the accent color.
    const long = stat && stat.suffix.trim().length > 2 ? stat.suffix.trim() : ''
    const short = stat && !long ? stat.suffix : ''
    const counted = stat ? { ...stat, suffix: '' } : null
    const digits = el('span', '', number, counted ? formatStatValue(counted, 0) : valueText)
    if (short) el('span', 'mg-stat-short', number, short)
    if (long) el('span', 'mg-stat-unit', number, long)
    const final = counted ? formatStatValue(counted, 1) + short : valueText
    number.style.setProperty('--stat-size', String(Math.round(clamp(1180 / Math.max(3, final.length * .82 + long.length * .3), 120, 250))))
    b.fitters.push(() => {
      // The finished number must fit the card: shrink it when it would not.
      const shown = digits.textContent
      digits.textContent = counted ? formatStatValue(counted, 1) : valueText
      const room = card.clientWidth - 140 * u, need = number.scrollWidth
      if (need > room) number.style.setProperty('--stat-size', String(Math.floor(Number(number.style.getPropertyValue('--stat-size')) * room / need)))
      digits.textContent = shown
    })
    const rule = el('div', 'mg-stat-rule', card)
    const labelEl = label ? el('div', 'mg-stat-label', card) : null
    const labelWords = labelEl ? richText(labelEl, label, null).words : []
    const { tin, hold } = phases(spec.duration_ms)
    const countAt = tin * .6, countFor = clamp(hold * .55, 500, 1400)
    if (counted) {
      b.onSeek.push((t) => { digits.textContent = formatStatValue(counted, outExpo((t - countAt) / countFor)) })
      tl.add(number, { scale: [1, 1.06], duration: 130, ease: 'outQuad' }, countAt + countFor - 60)
      tl.add(number, { scale: [1.06, 1], duration: 300, ease: 'outCubic' }, countAt + countFor + 70)
    } else popIn(b, number, countAt)
    tl.add(rule, { scaleX: [0, 1], duration: 420, ease: 'outQuart' }, countAt + 120)
    buildWords(b, labelWords, countAt + 200, wordStep(labelWords.length, 420, 70))
  },

  title(b) {
    const { spec } = b
    const text = clean(spec.fields.text)
    const { card } = shell(b, 'mg-card mg-title-card')
    const box = el('div', 'mg-title mg-display', card)
    const words = text.split(' ').filter(Boolean)
    // One word carries the accent: the last one with 3+ letters.
    let accent: string | null = null
    for (let i = words.length - 1; i >= 0; i--) if ((words[i].match(/[\p{L}\p{N}]/gu) ?? []).length >= 3) { accent = words[i]; break }
    const longest = words.reduce((n, w) => Math.max(n, w.length), 1), total = text.length
    box.style.setProperty('--title-size', String(Math.round(clamp(Math.min(1500 / Math.max(5, longest * .9), 3400 / Math.max(10, total * .9)), 74, 150))))
    const rich = richText(box, words.slice(0, 14).join(' '), accent, { accentClass: 'tint' })
    const { tin } = phases(spec.duration_ms)
    const said = saidTimes(spec)
    const end = said ? buildWordsAt(b, rich.words, said, 'pop') : buildWords(b, rich.words, tin * .55, wordStep(rich.words.length, 700, 110), 'pop')
    sweep(b, rich.mark, end - 60)
  },

  list(b) { listLike(b, false) },
  checklist(b) { listLike(b, true) },

  lower_third(b) {
    const { spec, tl, fit } = b
    fit.classList.add('left')
    const name = clean(spec.fields.name), role = clean(spec.fields.role)
    const { card } = shell(b, 'mg-card mg-tag')
    const bar = el('div', 'mg-tag-bar', card)
    const col = el('div', 'mg-tag-text', card)
    const nameEl = el('div', 'mg-tag-name mg-display', col, name || role)
    const roleEl = name && role ? el('div', 'mg-tag-role', col, role) : null
    const { tin } = phases(spec.duration_ms)
    tl.add(bar, { scaleY: [0, 1], duration: 380, ease: 'outQuart' }, tin * .4)
    riseIn(b, nameEl, tin * .5, 18)
    if (roleEl) riseIn(b, roleEl, tin * .5 + 140, 18)
  },

  logo(b) {
    const { spec, fit } = b
    const box = el('div', 'mg-logo', fit)
    const push = el('div', 'mg-push mg-logo', box)
    const tile = el('div', 'mg-tile glow mg-logo-tile', push)
    if (spec.image) {
      const img = el('img', '', tile)
      img.alt = ''
      img.decoding = 'sync'
      img.src = spec.image
    } else el('div', 'mg-logo-empty', tile, 'Add an image')
    const caption = clean(spec.fields.caption)
    const chip = caption ? el('div', 'mg-chip', push, caption) : null
    const { tin } = phases(spec.duration_ms)
    popIn(b, tile, 0, 1.18, 380)
    if (chip) riseIn(b, chip, tin * .7, 20)
    pushIn(b, push)
    cardOut(b, box)
  },

  before_after(b) {
    const { spec, tl } = b
    const { card: grid } = shell(b, 'mg-ba')
    const before = el('div', 'mg-card mg-ba-card before', grid)
    el('div', 'mg-kicker muted', before, 'Before')
    const beforeText = el('div', 'mg-ba-text', before, clean(spec.fields.before))
    const after = el('div', 'mg-card glow mg-ba-card after', grid)
    el('div', 'mg-kicker', after, 'After')
    const afterText = el('div', 'mg-ba-text mg-display', after, clean(spec.fields.after))
    const arrow = el('div', 'mg-ba-arrow', grid)
    const glyph = svg('svg', { viewBox: '0 0 100 100' }, arrow)
    svg('path', { d: 'M24 50 H74 M54 30 L74 50 L54 70' }, glyph)
    const { tin, hold } = phases(spec.duration_ms)
    const swap = tin + clamp(hold * .25, 300, 700)
    riseIn(b, beforeText, tin * .6, 16)
    // The "before" fades back as the "after" arrives.
    tl.add(before, { opacity: [1, .78], duration: 300, ease: 'outQuad' }, swap)
    popIn(b, arrow, swap - 120, 1.4, 320)
    popIn(b, after, swap, 1.1, 380)
    riseIn(b, afterText, swap + 120, 16)
  },

  quote(b) {
    const { spec } = b
    const { card } = shell(b, 'mg-card mg-quote')
    const mark = el('div', 'mg-quote-mark', card, '“')
    const textBox = el('div', 'mg-quote-text', card)
    const text = clean(spec.fields.text).replace(/^["“”']+|["“”']+$/g, '')
    textBox.style.setProperty('--quote-size', String(Math.round(clamp(6000 / Math.max(36, text.length), 58, 104))))
    const rich = richText(textBox, text, null)
    const author = clean(spec.fields.author)
    const by = author ? el('div', 'mg-quote-author', card, author) : null
    const { tin, hold } = phases(spec.duration_ms)
    popIn(b, mark, tin * .4, 1.4, 360)
    const end = buildWords(b, rich.words, tin * .6, wordStep(rich.words.length, Math.min(1300, hold * .45), 90))
    if (by) riseIn(b, by, end + 60, 14)
  },

  highlight(b) {
    const { spec, root, tl, u } = b
    const { width: W, height: H } = spec
    const { x, y, shape } = highlightPoint(spec.fields)
    const layer = svg('svg', { class: 'mg-highlight', viewBox: `0 0 ${W} ${H}` }, root)
    const px = x * W, py = y * H
    const { tin, tout, outAt } = phases(spec.duration_ms)
    const stroke = 20 * u
    if (shape === 'circle') {
      const rx = 230 * u, ry = 160 * u
      // A hand-drawn loop: a little more than one turn, slightly tilted.
      const points: string[] = []
      for (let i = 0; i <= 48; i++) {
        const a = -Math.PI * .65 + (i / 48) * Math.PI * 2.18
        const wobble = 1 + .045 * Math.sin(i * .9)
        points.push(`${(px + Math.cos(a) * rx * wobble).toFixed(1)},${(py + Math.sin(a) * ry * wobble * (1 + i / 400)).toFixed(1)}`)
      }
      const d = `M${points.join(' L')}`
      const halo = svg('path', { d, class: 'mg-halo', 'stroke-width': stroke * 1.9, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, layer)
      const loop = svg('path', { d, 'stroke-width': stroke, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, layer)
      for (const p of [halo, loop]) tl.add(p, { strokeDashoffset: [1, 0], duration: tin * 1.6, ease: 'inOutCubic' }, 0)
      const pulse = svg('ellipse', { cx: px, cy: py, rx, ry, 'stroke-width': stroke * .5, opacity: 0 }, layer)
      tl.add(pulse, { opacity: [.6, 0], rx: [rx, rx * 1.3], ry: [ry, ry * 1.3], duration: 700, ease: 'outCubic' }, tin * 1.6)
      tl.add(layer, { opacity: [1, 0], duration: tout, ease: 'inQuad' }, outAt)
    } else {
      // The arrow comes in from the roomier side and stops just short of the point.
      const dx = x > .5 ? -1 : 1, dy = y > .5 ? -1 : 1
      const sx = px + dx * 430 * u, sy = py + dy * 330 * u
      const ex = px + dx * 40 * u, ey = py + dy * 36 * u
      const cx = (sx + ex) / 2 + dy * 90 * u, cy = (sy + ey) / 2 - dx * 40 * u
      const body = `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`
      const angle = Math.atan2(ey - cy, ex - cx), head = 90 * u
      const hx1 = ex - head * Math.cos(angle - .5), hy1 = ey - head * Math.sin(angle - .5)
      const hx2 = ex - head * Math.cos(angle + .5), hy2 = ey - head * Math.sin(angle + .5)
      const tip = `M${hx1},${hy1} L${ex},${ey} L${hx2},${hy2}`
      const group = svg('g', {}, layer)
      for (const cls of ['mg-halo', '']) {
        const g = svg('g', {}, group)
        const width = cls ? stroke * 1.9 : stroke
        const line = svg('path', { d: body, class: cls, 'stroke-width': width, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, g)
        const arrowHead = svg('path', { d: tip, class: cls, 'stroke-width': width, opacity: 0 }, g)
        tl.add(line, { strokeDashoffset: [1, 0], duration: tin * 1.4, ease: 'outCubic' }, 0)
        tl.add(arrowHead, { opacity: [0, 1], duration: 120, ease: 'linear' }, tin * 1.25)
      }
      // A nudge toward the point while it holds.
      tl.add(group, { translateX: [0, -dx * 14 * u], translateY: [0, -dy * 12 * u], duration: 260, ease: 'inOutSine' }, tin * 1.6)
      tl.add(group, { translateX: [-dx * 14 * u, 0], translateY: [-dy * 12 * u, 0], duration: 260, ease: 'inOutSine' }, tin * 1.6 + 260)
      tl.add(layer, { opacity: [1, 0], duration: tout, ease: 'inQuad' }, outAt)
    }
  },

  statement(b) {
    const { spec } = b
    const text = spec.fields.text ?? ''
    const subline = clean(spec.fields.subline)
    const { card } = shell(b, 'mg-card mg-statement')
    const box = el('div', 'mg-statement-text', card)
    const length = clean(text).length
    box.style.setProperty('--statement-size', String(Math.round(clamp(2400 / Math.max(10, length) + 40, 84, 156))))
    const rich = richText(box, text, spec.fields.accent)
    const sub = subline ? el('div', 'mg-sub', card) : null
    const subWords = sub ? richText(sub, subline, null).words : []
    const { tin, hold } = phases(spec.duration_ms)
    const said = saidTimes(spec)
    const end = said ? buildWordsAt(b, rich.words, said.slice(0, rich.words.length)) : buildWords(b, rich.words, tin * .55, wordStep(rich.words.length, Math.min(900, hold * .35), 130))
    sweep(b, rich.mark, end - 40, 520)
    if (said) buildWordsAt(b, subWords, said.slice(rich.words.length))
    else buildWords(b, subWords, end + 260, wordStep(subWords.length, 360, 60))
  },

  sticky_notes(b) {
    const { spec, fit, tl, u } = b
    const notes = templateItems('sticky_notes', spec.fields.items)
    const wall = el('div', `mg-notes n${notes.length}`, fit)
    const push = el('div', 'mg-push mg-notes-row', wall)
    const longest = notes.reduce((n, t) => Math.max(n, t.length), 1)
    const base = notes.length === 1 ? 78 : notes.length === 2 ? 66 : 56
    push.style.setProperty('--note-size', String(Math.round(clamp(base - Math.max(0, longest - 12) * .8, 34, base))))
    const tilt = [-4, 3, -2], drop = [0, 34, 10]
    const at = beats(spec, notes.length, .4, 0)
    notes.forEach((text, i) => {
      const note = el('div', `mg-note c${i % 3}`, push)
      note.style.marginTop = `calc(var(--u) * ${drop[i]})`
      const tape = el('div', 'mg-tape', note)
      tape.style.setProperty('--tape-tilt', `${i % 2 ? 4 : -3}deg`)
      const words = el('div', 'mg-note-text', note, text)
      // A long word must fit its note: shrink that note's words until it does.
      b.fitters.push(() => {
        const room = note.clientWidth - 92 * u
        const size = parseFloat(getComputedStyle(words).getPropertyValue('--note-size')) || 50
        if (words.scrollWidth > room) words.style.setProperty('--note-size', String(Math.floor(size * room / words.scrollWidth)))
      })
      tl.add(note, { opacity: [0, 1], duration: 160, ease: 'outQuad' }, at[i])
      tl.add(note, { translateY: [-150 * u, 0], duration: 460, ease: 'outBack(1.15)' }, at[i])
      tl.add(note, { rotate: [tilt[i] - 9, tilt[i]], scale: [1.08, 1], duration: 460, ease: 'outBack(1.4)' }, at[i])
    })
    pushIn(b, push, .03)
    cardOut(b, wall)
  },

  strike_list(b) {
    const { spec, tl } = b
    const items = templateItems('strike_list', spec.fields.items)
    const final = spec.fields.final ?? ''
    const { card } = shell(b, 'mg-card mg-strike')
    const rows = items.map((text) => {
      const row = el('div', 'mg-strike-row', card)
      const words = el('span', 'mg-strike-text', row, text)
      const line = el('span', 'mg-strike-line', words)
      return { row, words, line }
    })
    const finalEl = clean(final) ? el('div', 'mg-strike-final mg-display', card) : null
    const rich = finalEl ? richText(finalEl, final, spec.fields.accent, { marker: false, accentClass: 'tint' }) : null
    const { tin, hold } = phases(spec.duration_ms)
    rows.forEach((r, i) => riseIn(b, r.row, tin * .5 + i * 70, 16, 300))
    const at = beats(spec, rows.length, .45, tin + 280, true)
    rows.forEach((r, i) => {
      tl.add(r.line, { scaleX: [0, 1], duration: 300, ease: 'inOutQuad' }, at[i])
      tl.add(r.words, { opacity: [1, .5], duration: 260, ease: 'outQuad' }, at[i] + 220)
    })
    if (finalEl && rich) {
      const finalAt = at.length > rows.length ? at[rows.length] : rows.length ? at[rows.length - 1] + 420 : tin * .6
      const end = buildWords(b, rich.words, finalAt, wordStep(rich.words.length, 360, 80), 'pop')
      if (rich.accent) boxAround(b, card, rich.accent, Math.min(end + 40, tin + hold - 500))
    }
  },

  browser_frame(b) {
    const { spec, tl, band, u } = b
    const { card: win } = shell(b, 'mg-window glow')
    const bar = el('div', 'mg-window-bar', win)
    const dots = el('div', 'mg-dots', bar)
    for (let i = 0; i < 3; i++) el('span', `d${i}`, dots)
    const url = el('div', 'mg-url', bar)
    icon(url, 'lock', 'mg-url-lock')
    const domain = clean(spec.fields.domain).replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '')
    if (domain) el('span', 'mg-url-text', url, domain)
    el('div', 'mg-window-spacer', bar)
    const view = el('div', 'mg-window-view', win)
    const { tin, outAt } = phases(spec.duration_ms)
    if (spec.image) {
      const scroller = el('div', 'mg-window-scroll', view)
      const img = el('img', '', scroller)
      img.alt = ''
      img.decoding = 'sync'
      img.src = spec.image
      let distance = 0
      b.fitters.push(() => {
        const width = win.clientWidth
        const ratio = img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : .6
        const imageH = width * ratio
        const room = Math.max(160 * u, band.clientHeight - bar.offsetHeight - 24 * u)
        const viewH = Math.min(imageH, room)
        view.style.height = `${Math.round(viewH)}px`
        distance = Math.max(0, imageH - viewH)
      })
      // A tall page scrolls slowly from the top down while the window holds.
      const scrollAt = tin + 500, scrollFor = Math.max(400, outAt - 250 - scrollAt)
      tl.add(scroller, { translateY: [0, () => -distance], duration: scrollFor, ease: 'inOutSine' }, scrollAt)
      for (const box of browserHighlights(spec.fields.highlights)) {
        const mark = el('div', 'mg-window-mark', scroller)
        Object.assign(mark.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` })
        const at = clamp(box.at_ms, tin, outAt - 300)
        tl.add(mark, { scaleX: [0, 1], duration: 380, ease: 'inOutCubic' }, at)
      }
    } else {
      const page = el('div', 'mg-window-page', view)
      const head = el('div', 'mg-window-title mg-display', page)
      const title = clean(spec.fields.title)
      head.style.setProperty('--page-size', String(Math.round(clamp(1900 / Math.max(12, title.length) + 22, 56, 96))))
      const rich = richText(head, spec.fields.title, spec.fields.accent ? spec.fields.accent : null)
      const subline = clean(spec.fields.subline)
      const sub = subline ? el('div', 'mg-sub', page) : null
      const subWords = sub ? richText(sub, subline, null).words : []
      const end = buildWords(b, rich.words, tin * .8, wordStep(rich.words.length, 600, 100))
      sweep(b, rich.mark, end - 40)
      buildWords(b, subWords, end + 220, wordStep(subWords.length, 320, 60))
    }
  },

  icon_pop(b) {
    const { spec, fit } = b
    const labels = templateItems('icon_pop', spec.fields.items)
    const icons = graphicIcons(spec.fields)
    const count = Math.max(labels.length, spec.image ? 1 : 0)
    const row = el('div', `mg-icons n${count}`, fit)
    const push = el('div', 'mg-push mg-icons-row', row)
    const at = beats(spec, count, .5, 0)
    for (let i = 0; i < count; i++) {
      const tile = el('div', 'mg-tile mg-icon-tile', push)
      const art = el('div', 'mg-icon-art', tile)
      const name = icons[i]
      if (i === 0 && spec.image) {
        const img = el('img', '', art)
        img.alt = ''
        img.decoding = 'sync'
        img.src = spec.image
      } else if (name) icon(art, name, 'mg-icon-svg')
      else el('span', 'mg-icon-letter', art, (labels[i] ?? '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase())
      if (labels[i]) el('div', 'mg-icon-label', tile, labels[i])
      popIn(b, tile, at[i], 1.18, 360)
    }
    pushIn(b, push, .03)
    cardOut(b, row)
  },

  headline_pill(b) {
    const { spec, fit, tl } = b
    const box = el('div', 'mg-headline', fit)
    const push = el('div', 'mg-push mg-headline-stack', box)
    const text = clean(spec.fields.text), phrase = clean(spec.fields.phrase)
    const { tin, hold } = phases(spec.duration_ms)
    let t = 0
    const said = saidTimes(spec)
    // Line 1 should fit on one line when it can (the phrase is drawn 1.2× in a narrower italic).
    const longest = Math.max(text.length, phrase.length * .95, 8)
    push.style.setProperty('--headline-size', String(Math.round(clamp(1420 / longest, 58, 112))))
    let first = 0
    if (text) {
      const line = el('div', 'mg-hl-line one mg-display', push)
      const words = richText(line, text, null).words
      first = words.length
      cardIn(b, line, 0)
      t = said ? buildWordsAt(b, words, said.slice(0, words.length)) : buildWords(b, words, 120, wordStep(words.length, Math.min(520, hold * .25), 110))
    }
    if (phrase) {
      const line = el('div', 'mg-hl-line two', push)
      const fill = el('div', 'mg-hl-fill', line)
      const inner = el('div', 'mg-hl-text', line)
      const words = richText(inner, phrase, null).words
      // Spoken: the box sweeps in just before the phrase's first word.
      const at = said ? Math.max(0, said[first] - SAID_LEAD - 160) : text ? t - 120 : 0
      tl.add(line, { opacity: [0, 1], duration: 120, ease: 'linear' }, at)
      tl.add(fill, { scaleX: [0, 1], duration: 380, ease: 'outQuart' }, at)
      if (said) buildWordsAt(b, words, said.slice(first), 'pop')
      else buildWords(b, words, at + 160, wordStep(words.length, 420, 120), 'pop')
    }
    pushIn(b, push, .03)
    cardOut(b, box)
    void tin
  },

  comment_cta(b) {
    const { spec, tl } = b
    const keyword = clean(spec.fields.keyword), lead = clean(spec.fields.lead) || 'Comment'
    const { card } = shell(b, 'mg-card mg-cta')
    const leadEl = el('div', 'mg-cta-lead', card, lead)
    const pill = el('div', 'mg-cta-pill', card)
    const word = el('span', 'mg-cta-word mg-display', pill, keyword)
    pill.style.setProperty('--cta-size', String(Math.round(clamp(900 / Math.max(3, keyword.length), 64, 128))))
    const { tin, hold } = phases(spec.duration_ms)
    riseIn(b, leadEl, tin * .5, 18)
    popIn(b, pill, tin * .5 + 160, 1.25, 380)
    riseIn(b, word, tin * .5 + 260, 10, 260)
    // The pill's glow breathes once while it holds.
    const glow = el('div', 'mg-cta-glow', pill)
    tl.add(glow, { opacity: [0, 1], duration: 380, ease: 'outQuad' }, tin + 300)
    if (hold > 1600) {
      tl.add(pill, { scale: [1, 1.05], duration: 420, ease: 'inOutSine' }, tin + 900)
      tl.add(pill, { scale: [1.05, 1], duration: 520, ease: 'inOutSine' }, tin + 1320)
    }
  },

  // Huge words in the scene (big-words.ts): sized and animated on their own, outside the band's card layout.
  big_words(b) { bigWordsTemplate(b) },

  // A center tile with icon nodes on a ring: the ring draws round from the top and each node pops in as it passes.
  orbit(b) {
    const { spec, band, tl, u, root } = b
    const nodes = orbitNodes(spec.fields)
    const center = clean(spec.fields.text)
    const W = spec.width
    const wrap = el('div', 'mg-orbit', band)
    const push = el('div', 'mg-push mg-orbit-push', wrap)
    const ring = svg('svg', { class: 'mg-orbit-ring' }, push)
    const circle = svg('circle', { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, ring)
    const spokes = nodes.map(() => svg('line', { class: 'mg-orbit-spoke', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, ring))
    const hub = el('div', `mg-tile glow mg-orbit-hub${spec.image ? ' has-image' : center ? ' has-text' : ''}`, push)
    if (spec.image) {
      const img = el('img', '', hub)
      img.alt = ''; img.decoding = 'sync'; img.src = spec.image
    } else if (center) el('div', 'mg-orbit-hub-text mg-display', hub, center)
    else icon(hub, 'sparkles', 'mg-orbit-hub-svg')
    const els = nodes.map((n) => {
      const node = el('div', 'mg-orbit-node', push)
      const dot = el('div', 'mg-orbit-dot', node)
      if (n.icon) icon(dot, n.icon, 'mg-orbit-svg')
      else el('span', 'mg-orbit-letter', dot, n.label.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase())
      const label = n.label ? el('div', 'mg-orbit-label', node, n.label) : null
      return { node, dot, label }
    })
    // Sized from the band: the ring as big as the band allows (labels below the lowest nodes).
    b.fitters.push(() => {
      const bandH = band.clientHeight, labels = nodes.some((n) => n.label) ? 60 * u : 0
      const R = Math.max(120 * u, Math.min((bandH - labels) * .5 - 92 * u, W * .34))
      const node = Math.round(clamp(R * .42, 96 * u, 150 * u)), hubSize = Math.round(clamp(R * .78, 170 * u, 300 * u))
      const size = 2 * R + node
      Object.assign(push.style, { width: `${size}px`, height: `${size}px` })
      ring.setAttribute('viewBox', `0 0 ${size} ${size}`)
      ring.setAttribute('width', String(size)); ring.setAttribute('height', String(size))
      circle.setAttribute('cx', String(size / 2)); circle.setAttribute('cy', String(size / 2)); circle.setAttribute('r', String(R))
      // The ring draws from the top (an SVG circle starts at 3 o'clock).
      circle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`)
      circle.setAttribute('stroke-width', String(4 * u))
      Object.assign(hub.style, { width: `${hubSize}px`, height: `${hubSize}px`, left: `${(size - hubSize) / 2}px`, top: `${(size - hubSize) / 2}px` })
      root.style.setProperty('--orbit-node', `${node}px`)
      els.forEach((e, i) => {
        // From the top, clockwise, evenly round the ring.
        const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, nodes.length)
        const x = size / 2 + R * Math.cos(a), y = size / 2 + R * Math.sin(a)
        Object.assign(e.node.style, { left: `${x - node / 2}px`, top: `${y - node / 2}px`, width: `${node}px` })
        const s = spokes[i]
        const inner = hubSize * .5 + 10 * u, outer = R - node * .5 - 8 * u
        s.setAttribute('x1', String(size / 2 + inner * Math.cos(a))); s.setAttribute('y1', String(size / 2 + inner * Math.sin(a)))
        s.setAttribute('x2', String(size / 2 + outer * Math.cos(a))); s.setAttribute('y2', String(size / 2 + outer * Math.sin(a)))
        s.setAttribute('stroke-width', String(3 * u))
      })
    })
    const { tin, hold } = phases(spec.duration_ms)
    popIn(b, hub, 0, 1.2, 380)
    const ringAt = tin * .6, ringFor = clamp(hold * .55, 900, 2400)
    tl.add(circle, { strokeDashoffset: [1, 0], duration: ringFor, ease: 'inOutSine' }, ringAt)
    // As each node is said (item_ms), else as the ring passes it.
    const said = graphicItemTimes(spec.fields, nodes.length, spec.duration_ms)
    els.forEach((e, i) => {
      const at = said ? clamp(said[i] - 80, ringAt, spec.duration_ms - 600) : ringAt + ringFor * (i / Math.max(1, nodes.length)) + 60
      popIn(b, e.dot, at, 1.35, 320)
      tl.add(spokes[i], { strokeDashoffset: [1, 0], duration: 260, ease: 'outCubic' }, at + 40)
      if (e.label) riseIn(b, e.label, at + 120, 12, 260)
    })
    pushIn(b, push, .03)
    cardOut(b, wrap)
  },

  // Frosted pills, each an icon and a short label, stacked; an optional red notification dot on the first.
  feature_tile(b) {
    const { spec, fit } = b
    const labels = templateItems('feature_tile', spec.fields.items)
    const icons = graphicIcons(spec.fields, 'feature_tile')
    const stack = el('div', 'mg-features', fit)
    const push = el('div', 'mg-push mg-features-stack', stack)
    const longest = labels.reduce((n, t) => Math.max(n, t.length), 1)
    push.style.setProperty('--feature-size', String(Math.round(clamp(980 / Math.max(10, longest) + 20, 40, 66))))
    const at = beats(spec, labels.length, .35, 0)
    labels.forEach((label, i) => {
      const tile = el('div', 'mg-feature', push)
      const art = el('div', 'mg-feature-art', tile)
      const name = icons[i]
      if (name) icon(art, name, 'mg-feature-svg')
      else el('span', 'mg-feature-letter', art, label.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase())
      el('div', 'mg-feature-label', tile, label)
      riseIn(b, tile, at[i], 30, 380)
      b.tl.add(tile, { scale: [.94, 1], duration: 380, ease: 'outBack' }, at[i])
      if (i === 0 && spec.fields.dot === 'on') popIn(b, el('div', 'mg-feature-dot', art), at[i] + 380, 1.8, 300)
    })
    pushIn(b, push, .025)
    cardOut(b, stack)
  },

  // A dark window with a soft accent glow; its view is a transparent hole the engine plays the video under
  // (graphics_overlay). It fades in and out over SCREEN_FADE_MS, the same as the engine fades the video.
  screen_frame(b) {
    const { spec, root, tl, u } = b
    const box = screenFrameLayout(spec)
    const wrap = el('div', 'mg-screen', root)
    const glow = el('div', 'mg-screen-glow', wrap)
    const win = el('div', 'mg-screen-window', wrap)
    for (const node of [glow, win]) Object.assign(node.style, { left: `${box.window.x}px`, top: `${box.window.y}px`, width: `${box.window.w}px`, height: `${box.window.h}px`, borderRadius: `${box.radius}px` })
    Object.assign(win.style, { borderWidth: `${box.bar}px ${box.border}px ${box.border}px` })
    const bar = el('div', 'mg-screen-bar', win)
    Object.assign(bar.style, { height: `${box.bar}px`, top: `${-box.bar}px`, left: `${-box.border}px`, right: `${-box.border}px`, padding: `0 ${box.border + 14 * u}px` })
    const dots = el('div', 'mg-dots', bar)
    for (let i = 0; i < 3; i++) el('span', `d${i}`, dots)
    const label = clean(spec.fields.label)
    if (label) el('div', 'mg-screen-label', bar, label)
    const preview = spec.preview_video
    if (preview) {
      // The editor's preview plays the video in the hole; the render leaves it see-through.
      const video = el('video', 'mg-screen-video', wrap)
      Object.assign(video.style, { left: `${box.hole.x}px`, top: `${box.hole.y}px`, width: `${box.hole.w}px`, height: `${box.hole.h}px` })
      video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = preview.url
      b.onSeek.push((t) => { const want = preview.from + t / 1000; if (Math.abs(video.currentTime - want) > .2) video.currentTime = want })
      tl.add(video, { opacity: [0, 1], duration: SCREEN_FADE_MS, ease: 'linear' }, 0)
      tl.add(video, { opacity: [1, 0], duration: SCREEN_FADE_MS, ease: 'linear' }, spec.duration_ms - SCREEN_FADE_MS)
    }
    tl.add(win, { opacity: [0, 1], duration: SCREEN_FADE_MS, ease: 'linear' }, 0)
    tl.add(win, { opacity: [1, 0], duration: SCREEN_FADE_MS, ease: 'linear' }, spec.duration_ms - SCREEN_FADE_MS)
    tl.add(glow, { opacity: [0, .75], duration: 520, ease: 'outQuad' }, 0)
    if (spec.duration_ms > 2400) {
      tl.add(glow, { opacity: [.75, 1], duration: 900, ease: 'inOutSine' }, 700)
      tl.add(glow, { opacity: [1, .8], duration: 900, ease: 'inOutSine' }, 1600)
    }
    tl.add(glow, { opacity: [.8, 0], duration: SCREEN_FADE_MS, ease: 'linear' }, spec.duration_ms - SCREEN_FADE_MS)
  },

  // A title at the top for a whole section, and the diagrams (diagrams.ts: worked out per frame, like Big words).
  chapter(b) { chapterTemplate(b) },
  staircase(b) { staircaseTemplate(b) },
  funnel(b) { funnelTemplate(b) },
  journey(b) { journeyTemplate(b) },
  growth(b) { growthTemplate(b) },
  idea_hub(b) { ideaHubTemplate(b) },
  compare_marks(b) { compareMarksTemplate(b) }
}

function listLike(b: Build, checks: boolean): void {
  const { spec, tl } = b
  const items = graphicItems(spec.fields.items)
  const { card } = shell(b, `mg-card mg-list${checks ? ' checks' : ''}`)
  const title = clean(spec.fields.title)
  if (title) {
    const head = el('div', 'mg-list-title mg-display', card)
    const words = richText(head, title, null).words
    buildWords(b, words, phases(spec.duration_ms).tin * .5, wordStep(words.length, 300, 70))
  }
  const list = el('div', 'mg-list-items', card)
  const at = beats(spec, items.length, .55)
  items.forEach((text, i) => {
    const row = el('div', 'mg-list-item', list)
    if (checks) {
      const box = el('div', 'mg-check', row)
      const fill = el('div', 'mg-check-fill', box)
      const mark = svg('svg', { viewBox: '0 0 100 100' }, box)
      const tick = svg('path', { d: 'M28 52 L44 67 L73 36', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, mark)
      el('div', 'mg-list-text', row, text)
      riseIn(b, row, at[i], 18, 300)
      popIn(b, fill, at[i] + 200, 1.3, 260)
      tl.add(tick, { strokeDashoffset: [1, 0], duration: 240, ease: 'outCubic' }, at[i] + 300)
    } else {
      const num = el('div', 'mg-list-num', row, String(i + 1))
      el('div', 'mg-list-text', row, text)
      riseIn(b, row, at[i], 18, 300)
      popIn(b, num, at[i] + 60, 1.35, 320)
    }
  })
}
