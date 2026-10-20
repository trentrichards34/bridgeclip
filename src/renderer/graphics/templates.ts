/**
 * Our motion graphic templates: DOM + CSS animated with an anime.js timeline
 * that is never played on its own clock. `seek(ms)` puts every element where
 * it is at that moment, so the editor's preview follows the playhead and the
 * offscreen render steps frame by frame (same input, same pixels).
 *
 * Text is only ever set with textContent. The page draws on a transparent
 * background; each template animates in, holds and animates out within
 * `spec.duration_ms`.
 */
import { createTimeline } from 'animejs'
import './graphics.css'
import { formatStatValue, graphicItems, highlightPoint, parseStatValue, type GraphicRenderSpec } from '../../shared/motion-graphics'

export interface MountedGraphic {
  /** Show the graphic as it is `ms` into its animation (hidden outside 0..duration). */
  seek: (ms: number) => void
  destroy: () => void
  /** Resolves when fonts are loaded and the layout is fitted to its band. */
  ready: Promise<void>
}

const DISPLAY: Record<string, { family: string; weight: number; upper: boolean }> = {
  clean: { family: '"MG Montserrat", "Montserrat", sans-serif', weight: 900, upper: false },
  serif: { family: '"MG Fraunces", "Fraunces 72pt Black", Georgia, serif', weight: 400, upper: false },
  condensed: { family: '"MG Anton", "Anton", Impact, sans-serif', weight: 400, upper: true },
  marker: { family: '"MG Caveat Brush", "Caveat Brush", cursive', weight: 400, upper: true },
  sans_serif_accent: { family: '"MG Montserrat", "Montserrat", sans-serif', weight: 900, upper: false }
}
const FONT_LOADS = ['900 40px "MG Montserrat"', '800 40px "MG Montserrat"', '700 40px "MG Jakarta"', '40px "MG Anton"', '40px "MG Fraunces"', '40px "MG Caveat Brush"', 'italic 40px "MG Instrument Serif"']

function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160 ? '#111318' : '#ffffff'
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
const outExpo = (p: number): number => p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)

type Value = number | string
type Segment = { at: number; duration: number; from: Value; to: Value; ease: string }
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
    for (const [key, value] of Object.entries(params)) {
      if (key === 'duration' || key === 'ease' || !Array.isArray(value)) continue
      const list = props.get(key) ?? []
      list.push({ at: Math.max(0, at), duration, from: value[0] as Value, to: value[1] as Value, ease })
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
      for (const [key, raw] of props) initial[key] = [...raw].sort((a, b) => a.at - b.at)[0].from
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
          frames.push({ from: seg.from, to: seg.to, duration, ease: seg.ease, delay: Math.max(0, seg.at - end) })
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

/** Timing shared by every template: in, hold, out. */
function phases(duration: number): { tin: number; tout: number; outAt: number; hold: number } {
  const tin = clamp(duration * .26, 220, 620), tout = clamp(duration * .16, 180, 420)
  return { tin, tout, outAt: duration - tout, hold: Math.max(0, duration - tin - tout) }
}

interface Build {
  root: HTMLElement; band: HTMLElement; fit: HTMLElement
  tl: Tracks; spec: GraphicRenderSpec; u: number
  /** Extra per-frame work (counters), run after the timeline is seeked. */
  onSeek: ((ms: number) => void)[]
  /** Layout fixes once fonts are loaded (before fitting the band). */
  fitters: (() => void)[]
}

export function mountGraphic(host: HTMLElement, spec: GraphicRenderSpec): MountedGraphic {
  const { width: W, height: H } = spec
  const u = Math.min(W, H) / 1080
  const display = DISPLAY[spec.font] ?? DISPLAY.clean
  const root = el('div', 'mg-root', host)
  root.style.width = `${W}px`; root.style.height = `${H}px`
  root.style.setProperty('--u', `${u}px`)
  root.style.setProperty('--accent', spec.color)
  root.style.setProperty('--on-accent', onColor(spec.color))
  root.style.setProperty('--display', display.family)
  root.style.setProperty('--display-weight', String(display.weight))
  root.style.setProperty('--display-case', display.upper ? 'uppercase' : 'none')
  root.style.setProperty('--card-w', `${Math.round(Math.min(W - 140 * u, 940 * u))}px`)
  root.style.setProperty('--logo', `${Math.round(Math.min(520 * u, (spec.box.bottom - spec.box.top) * H * .7))}px`)
  const band = el('div', `mg-band ${spec.placement}`, root)
  band.style.top = `${spec.box.top * H}px`
  band.style.height = `${(spec.box.bottom - spec.box.top) * H}px`
  const fit = el('div', 'mg-fit', band)
  // No composition between tweens: each one owns its stretch of time, so seeking is exact in any order.
  const tracks = new Tracks()
  const build: Build = { root, band, fit, tl: tracks, spec, u, onSeek: [], fitters: [] }
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
  if (spec.template === 'highlight') return
  fit.style.removeProperty('--u')
  fit.style.removeProperty('--card-w')
  const cardW = parseFloat(root.style.getPropertyValue('--card-w'))
  let scale = 1
  for (let i = 0; i < 3; i++) {
    const need = fit.scrollHeight, wide = fit.scrollWidth
    const next = scale * Math.min(1, band.clientHeight / Math.max(1, need), (band.clientWidth - 60 * u) / Math.max(1, wide))
    if (next >= scale - .001) break
    scale = next
    fit.style.setProperty('--u', `${u * scale}px`)
    fit.style.setProperty('--card-w', `${Math.round(cardW * scale)}px`)
  }
}

/** The common card entrance and exit. */
function cardInOut(b: Build, target: HTMLElement, from: 'up' | 'down' | 'left' = 'up'): void {
  const { tl, spec, u } = b
  const { tin, tout, outAt } = phases(spec.duration_ms)
  const dy = from === 'down' ? -90 * u : from === 'up' ? 90 * u : 0
  const dx = from === 'left' ? -140 * u : 0
  tl.add(target, { opacity: [0, 1], translateY: [dy, 0], translateX: [dx, 0], scale: [.86, 1], duration: tin, ease: 'outBack(1.5)' }, 0)
  tl.add(target, { opacity: [1, 0], translateY: [0, 50 * u], scale: [1, .94], duration: tout, ease: 'inQuad' }, outAt)
}

/** Even beats for revealing items during the hold. */
function beats(spec: GraphicRenderSpec, count: number, share = .6): number[] {
  const { tin, hold } = phases(spec.duration_ms)
  const step = count > 1 ? Math.min(520, (hold * share) / (count - 1)) : 0
  return Array.from({ length: count }, (_, i) => tin * .75 + i * step)
}

const TEMPLATES: Record<GraphicRenderSpec['template'], (b: Build) => void> = {
  stat(b) {
    const { spec, fit, tl, u } = b
    const value = spec.fields.value ?? '', label = (spec.fields.label ?? '').trim()
    const card = el('div', `mg-card mg-stat${label ? '' : ' no-label'}`, fit)
    const stat = parseStatValue(value)
    const number = el('span', 'mg-stat-value mg-display', card)
    // A long unit ("/month", " billion") is drawn smaller next to the number; "%" or "x" stay full size.
    const small = stat && stat.suffix.trim().length > 2 ? stat.suffix : ''
    const counted = stat ? { ...stat, suffix: small ? '' : stat.suffix } : null
    const digits = el('span', '', number, counted ? formatStatValue(counted, 0) : value.trim())
    if (small) el('span', 'mg-stat-suffix', number, small.trim())
    const final = counted ? formatStatValue(counted, 1) : value.trim()
    number.style.setProperty('--stat-size', String(Math.round(clamp(1250 / Math.max(3, final.length * .8 + small.length * .3), 110, 260))))
    b.fitters.push(() => {
      // The finished number must fit the card: shrink it when it would not.
      const shown = digits.textContent
      digits.textContent = final
      const room = card.clientWidth - 170 * u, need = number.scrollWidth
      if (need > room) number.style.setProperty('--stat-size', String(Math.floor(Number(number.style.getPropertyValue('--stat-size')) * room / need)))
      digits.textContent = shown
    })
    const rule = el('div', 'mg-stat-rule', card)
    if (label) el('div', 'mg-stat-label', card, label)
    cardInOut(b, card)
    const { tin, hold } = phases(spec.duration_ms)
    const countAt = tin * .55, countFor = clamp(hold * .7, 300, 1500)
    tl.add(rule, { scaleX: [0, 1], duration: Math.min(500, countFor), ease: 'outExpo' }, countAt)
    if (counted) {
      b.onSeek.push((t) => { digits.textContent = formatStatValue(counted, outExpo((t - countAt) / countFor)) })
      tl.add(number, { scale: [1, 1.12], duration: 140, ease: 'outQuad' }, countAt + countFor)
      tl.add(number, { scale: [1.12, 1], duration: 260, ease: 'outBack(2)' }, countAt + countFor + 140)
    }
    void u
  },

  title(b) {
    const { spec, fit, tl, u } = b
    const words = (spec.fields.text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 12)
    const box = el('div', 'mg-title', fit)
    const longest = words.reduce((n, w) => Math.max(n, w.length), 1), total = words.join(' ').length
    box.style.setProperty('--title-size', String(Math.round(clamp(Math.min(1700 / Math.max(5, longest * .9), 3900 / Math.max(10, total * .9)), 86, 210))))
    // One word carries the brand color: the last one with 3+ letters.
    let accent = -1
    for (let i = words.length - 1; i >= 0; i--) if ((words[i].match(/[\p{L}\p{N}]/gu) ?? []).length >= 3) { accent = i; break }
    const { tin, tout, outAt } = phases(spec.duration_ms)
    const step = Math.min(120, (tin * 1.6) / Math.max(1, words.length))
    words.forEach((word, i) => {
      const node = el('span', `mg-title-word mg-display${i === accent ? ' accent' : ''}`, box, word)
      const at = i * step
      tl.add(node, { opacity: [0, 1], scale: [2.3, 1], rotate: [i % 2 ? 7 : -7, i === accent ? -2 : 0], duration: 300, ease: 'outExpo' }, at)
      tl.add(node, { opacity: [1, 0], translateY: [0, -40 * u], duration: tout * .8, ease: 'inQuad' }, outAt + i * Math.min(40, tout * .2 / Math.max(1, words.length)))
    })
    // A small jolt as the last word lands.
    const land = (words.length - 1) * step + 120
    tl.add(box, { translateX: [0, -12 * u], translateY: [0, 6 * u], duration: 50, ease: 'linear' }, land)
    tl.add(box, { translateX: [-12 * u, 0], translateY: [6 * u, 0], duration: 220, ease: 'outElastic(1, .4)' }, land + 50)
    void tin
  },

  list(b) { listLike(b, false) },
  checklist(b) { listLike(b, true) },

  lower_third(b) {
    const { spec, fit, tl, u } = b
    const name = (spec.fields.name ?? '').trim(), role = (spec.fields.role ?? '').trim()
    const tag = el('div', 'mg-tag', fit)
    const row = el('div', 'mg-tag-row', tag)
    const bar = el('div', 'mg-tag-bar', row)
    const nameMask = el('div', 'mg-tag-mask', row)
    const nameEl = el('span', 'mg-tag-name', nameMask, name || role)
    let roleEl: HTMLElement | null = null
    if (name && role) roleEl = el('span', 'mg-tag-role', el('div', 'mg-tag-mask', tag), role)
    const { tin, tout, outAt } = phases(spec.duration_ms)
    tl.add(bar, { scaleY: [0, 1], duration: tin * .6, ease: 'outExpo' }, 0)
    tl.add(nameEl, { translateX: ['-105%', '0%'], duration: tin, ease: 'outExpo' }, tin * .25)
    if (roleEl) tl.add(roleEl, { translateX: ['-105%', '0%'], duration: tin, ease: 'outExpo' }, tin * .55)
    tl.add(nameEl, { translateX: ['0%', '-105%'], duration: tout, ease: 'inCubic' }, outAt)
    if (roleEl) tl.add(roleEl, { translateX: ['0%', '-105%'], duration: tout * .8, ease: 'inCubic' }, outAt)
    tl.add(bar, { scaleY: [1, 0], duration: tout * .7, ease: 'inQuad' }, outAt + tout * .3)
    void u
  },

  logo(b) {
    const { spec, fit, tl, u } = b
    const box = el('div', 'mg-logo', fit)
    const stage = el('div', 'mg-logo-stage', box)
    const ring = el('div', 'mg-logo-ring', stage)
    const tile = el('div', 'mg-logo-tile', stage)
    if (spec.image) {
      const img = el('img', '', tile)
      img.alt = ''
      img.decoding = 'sync'
      img.src = spec.image
    } else el('div', 'mg-logo-empty', tile, 'Add an image')
    const caption = (spec.fields.caption ?? '').trim()
    const pill = caption ? el('div', 'mg-logo-caption', box, caption) : null
    const { tin, tout, outAt } = phases(spec.duration_ms)
    tl.add(tile, { scale: [0, 1], rotate: [-14, 0], duration: tin * 1.2, ease: 'outBack(2.2)' }, 0)
    tl.add(ring, { scale: [.6, 1.55], opacity: [.9, 0], duration: tin * 1.6, ease: 'outCubic' }, tin * .35)
    if (pill) tl.add(pill, { opacity: [0, 1], translateY: [40 * u, 0], duration: tin, ease: 'outBack(1.6)' }, tin * .6)
    tl.add(tile, { scale: [1, 1.04], duration: 300, ease: 'inOutSine' }, tin * 1.3)
    tl.add(tile, { scale: [1.04, 1], duration: 300, ease: 'inOutSine' }, tin * 1.3 + 300)
    tl.add(box, { opacity: [1, 0], scale: [1, .85], duration: tout, ease: 'inBack(1.4)' }, outAt)
  },

  before_after(b) {
    const { spec, fit, tl, u } = b
    const box = el('div', 'mg-ba', fit)
    const before = el('div', 'mg-ba-card before', box)
    el('span', 'mg-ba-tag', before, 'BEFORE')
    el('div', 'mg-ba-text', before, (spec.fields.before ?? '').trim())
    const after = el('div', 'mg-ba-card after', box)
    el('span', 'mg-ba-tag', after, 'AFTER')
    el('div', 'mg-ba-text', after, (spec.fields.after ?? '').trim())
    const arrow = el('div', 'mg-ba-arrow', box)
    const icon = svg('svg', { viewBox: '0 0 100 100' }, arrow)
    svg('path', { d: 'M22 50 H74 M52 26 L76 50 L52 74' }, icon)
    const { tin, tout, outAt, hold } = phases(spec.duration_ms)
    const swap = tin + Math.min(650, hold * .3)
    tl.add(before, { opacity: [0, 1], translateX: [-120 * u, 0], rotate: [-4, 0], duration: tin, ease: 'outBack(1.4)' }, 0)
    tl.add(arrow, { scale: [0, 1], rotate: [-90, 0], duration: 360, ease: 'outBack(2)' }, swap - 220)
    tl.add(after, { opacity: [0, 1], translateX: [120 * u, 0], scale: [.8, 1], rotate: [4, 0], duration: tin, ease: 'outBack(1.6)' }, swap)
    tl.add(box, { opacity: [1, 0], translateY: [0, 50 * u], duration: tout, ease: 'inQuad' }, outAt)
  },

  quote(b) {
    const { spec, fit, tl, u } = b
    const card = el('div', 'mg-quote', fit)
    const mark = el('div', 'mg-quote-mark', card, '“')
    const textBox = el('div', 'mg-quote-text', card)
    const words = (spec.fields.text ?? '').replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '').split(' ').filter(Boolean)
    const total = words.join(' ').length
    card.style.setProperty('--quote-size', String(Math.round(clamp(6400 / Math.max(40, total), 56, 104))))
    const spans = words.map((w, i) => el('span', 'mg-quote-word', textBox, i < words.length - 1 ? `${w} ` : w))
    const author = (spec.fields.author ?? '').trim()
    const by = author ? el('div', 'mg-quote-author', card, author) : null
    cardInOut(b, card)
    const { tin, hold } = phases(spec.duration_ms)
    tl.add(mark, { scale: [0, 1], rotate: [-30, 0], duration: 420, ease: 'outBack(2.4)' }, tin * .5)
    const spread = Math.min(1100, hold * .45), step = spans.length > 1 ? spread / (spans.length - 1) : 0
    spans.forEach((span, i) => tl.add(span, { opacity: [0, 1], translateY: [18 * u, 0], duration: 320, ease: 'outCubic' }, tin * .6 + i * step))
    if (by) tl.add(by, { opacity: [0, 1], translateX: [-30 * u, 0], duration: 400, ease: 'outCubic' }, tin * .6 + spread + 120)
  },

  highlight(b) {
    const { spec, root, tl, u } = b
    const { width: W, height: H } = spec
    const { x, y, shape } = highlightPoint(spec.fields)
    const layer = svg('svg', { class: 'mg-highlight', viewBox: `0 0 ${W} ${H}` }, root)
    const px = x * W, py = y * H
    const { tin, tout, outAt } = phases(spec.duration_ms)
    const stroke = 22 * u
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
      const shadow = svg('path', { d, class: 'mg-shadow', 'stroke-width': stroke, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1, transform: `translate(0 ${6 * u})` }, layer)
      const loop = svg('path', { d, 'stroke-width': stroke, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, layer)
      for (const p of [shadow, loop]) tl.add(p, { strokeDashoffset: [1, 0], duration: tin * 1.4, ease: 'inOutCubic' }, 0)
      const pulse = svg('ellipse', { cx: px, cy: py, rx, ry, 'stroke-width': stroke * .5, opacity: 0 }, layer)
      tl.add(pulse, { opacity: [.7, 0], rx: [rx, rx * 1.35], ry: [ry, ry * 1.35], duration: 700, ease: 'outCubic' }, tin * 1.4)
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
      for (const cls of ['mg-shadow', '']) {
        const g = svg('g', cls ? { class: cls, transform: `translate(0 ${6 * u})` } : {}, group)
        const line = svg('path', { d: body, class: cls, 'stroke-width': stroke, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, g)
        const arrowHead = svg('path', { d: tip, class: cls, 'stroke-width': stroke, opacity: 0 }, g)
        tl.add(line, { strokeDashoffset: [1, 0], duration: tin * 1.2, ease: 'outCubic' }, 0)
        tl.add(arrowHead, { opacity: [0, 1], duration: 120, ease: 'linear' }, tin * 1.1)
      }
      // A nudge toward the point while it holds.
      tl.add(group, { translateX: [0, -dx * 14 * u], translateY: [0, -dy * 12 * u], duration: 260, ease: 'inOutSine' }, tin * 1.4)
      tl.add(group, { translateX: [-dx * 14 * u, 0], translateY: [-dy * 12 * u, 0], duration: 260, ease: 'inOutSine' }, tin * 1.4 + 260)
      tl.add(layer, { opacity: [1, 0], duration: tout, ease: 'inQuad' }, outAt)
    }
  }
}

function listLike(b: Build, checks: boolean): void {
  const { spec, fit, tl, u } = b
  const items = graphicItems(spec.fields.items)
  const card = el('div', 'mg-card mg-list', fit)
  const title = (spec.fields.title ?? '').trim()
  if (title) el('div', 'mg-list-title mg-display', card, title)
  const list = el('div', 'mg-list-items', card)
  const at = beats(spec, items.length)
  items.forEach((text, i) => {
    const row = el('div', 'mg-list-item', list)
    if (checks) {
      const box = el('div', 'mg-check-box', row)
      const fill = el('div', 'mg-check-fill', box)
      const mark = svg('svg', { viewBox: '0 0 100 100' }, box)
      const tick = svg('path', { d: 'M26 52 L44 69 L76 33', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, mark)
      el('div', 'mg-list-text', row, text)
      tl.add(row, { opacity: [0, 1], translateX: [-50 * u, 0], duration: 340, ease: 'outCubic' }, at[i])
      tl.add(fill, { scale: [0, 1], opacity: [0, 1], duration: 260, ease: 'outBack(2)' }, at[i] + 220)
      tl.add(tick, { strokeDashoffset: [1, 0], duration: 260, ease: 'outCubic' }, at[i] + 320)
    } else {
      const num = el('div', 'mg-list-num', row, String(i + 1))
      el('div', 'mg-list-text', row, text)
      tl.add(row, { opacity: [0, 1], translateX: [-60 * u, 0], duration: 360, ease: 'outCubic' }, at[i])
      tl.add(num, { scale: [0, 1], rotate: [-60, 0], duration: 380, ease: 'outBack(2.2)' }, at[i] + 60)
    }
  })
  cardInOut(b, card)
}
