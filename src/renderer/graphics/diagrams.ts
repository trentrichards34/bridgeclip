/**
 * Chapter headers and diagrams (our own designs, drawn for 9:16 first).
 *
 * Chapter header: a title at the very top that stays for a whole section
 * ("Step #1. Come Up With Your Idea"): white small-caps serif with a soft
 * shadow, a bold sans, or a dark pill.
 *
 * Diagrams: white line art drawn stroke by stroke on the scene's backdrop (or
 * on a royal-blue panel when the graphic sits over the video), with labels that
 * light up in the accent color one by one, as each is said (`item_ms`):
 * a staircase climbing to the right, a horizontal funnel, a row of milestone
 * cards with a small figure walking between them, plants (or bars) that grow
 * bigger, an icon with labels around it, and two cards that get a red ✗ and a
 * green ✓. Only the words in the graphic's fields are drawn.
 *
 * Every frame is worked out from the time alone (onSeek), like Big words, so
 * the render and the editor's scrubbing get the same pixels.
 */
import { ICONS } from './icons'
import {
  DIAGRAM_PANEL, chapterStyle, chapterText, compareNotes, compareTimes, compareWrong, graphicIcons, graphicItemTimes, growthStyle, hubIcon, templateItems,
  type GraphicIcon, type GraphicRenderSpec
} from '../../shared/motion-graphics'

export interface DiagramBuild {
  root: HTMLElement
  spec: GraphicRenderSpec
  u: number
  onSeek: ((ms: number) => void)[]
  fitters: (() => void)[]
}

const SVG = 'http://www.w3.org/2000/svg'
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const prog = (t: number, at: number, len: number): number => clamp((t - at) / Math.max(1, len), 0, 1)
const outCubic = (p: number): number => 1 - Math.pow(1 - clamp(p, 0, 1), 3)
const inOutCubic = (p: number): number => { const x = clamp(p, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const outBack = (p: number): number => { const x = clamp(p, 0, 1), c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }
const clean = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

function div(className: string, parent: Element, text?: string): HTMLElement {
  const node = document.createElement('div')
  node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}
function svg(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const node = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent.appendChild(node)
  return node
}
function rgb(hex: string): [number, number, number] {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#7CB82F'
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number]
}
/** Text on the accent: dark on a very light accent, else white. */
function onAccent(hex: string): string {
  const [r, g, b] = rgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 175 ? '#0F172A' : '#FFFFFF'
}
/** A line drawn from its start (`p` 0..1); hidden before it starts. */
function draw(path: SVGElement, p: number): void {
  path.setAttribute('stroke-dashoffset', String(1 - clamp(p, 0, 1)))
  path.style.opacity = p <= 0 ? '0' : '1'
}
function line(parent: Element, d: string, width: number, extra: Record<string, string | number> = {}): SVGElement {
  return svg('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1, ...extra }, parent)
}
/** A Lucide icon (24 grid) drawn at (x, y) with `size`, as a group whose stroke can change. */
function iconAt(parent: Element, name: GraphicIcon, x: number, y: number, size: number, width: number): SVGElement {
  const g = svg('g', { transform: `translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`, fill: 'none', stroke: '#fff', 'stroke-width': width * 24 / size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent)
  for (const [tag, attrs] of ICONS[name]) svg(tag, attrs, g)
  return g
}

/** When each of `count` items comes in (ms into the graphic): as said (`item_ms`), else evenly through the hold. */
function itemBeats(spec: GraphicRenderSpec, count: number, first = 900): number[] {
  const said = graphicItemTimes(spec.fields, count, spec.duration_ms)
  const last = Math.max(first, spec.duration_ms - 900)
  if (said) {
    const out = said.slice(0, count).map((t) => clamp(t - 60, 250, last))
    for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + 150)
    return out
  }
  const step = count > 1 ? clamp((last - first) * .8 / (count - 1), 300, 1600) : 0
  return Array.from({ length: count }, (_, i) => first + i * step)
}

interface Frame {
  /** The diagram's box (px of the output frame) and its content area inside the padding (and under the title). */
  box: HTMLElement; layer: SVGElement; W: number; H: number
  x0: number; x1: number; y0: number; y1: number; fu: number
  accent: string; ink: string
}

/**
 * The shared frame of a diagram: its band, an optional blue panel behind it (over the video), the title on top,
 * the SVG layer for the line art, the whole thing fading in and out.
 */
function frame(b: DiagramBuild, className: string): Frame {
  const { spec, root } = b
  const W = spec.width, top = spec.box.top * spec.height, H = (spec.box.bottom - spec.box.top) * spec.height
  const fu = Math.min(spec.width, spec.height) / 1080
  const box = div(`dg-box ${className}`, root)
  Object.assign(box.style, { left: '0px', top: `${top}px`, width: `${W}px`, height: `${H}px` })
  box.style.setProperty('--fu', `${fu}px`)
  box.style.setProperty('--accent', spec.color)
  box.style.setProperty('--on-accent', onAccent(spec.color))
  const panel = spec.fields.panel === 'on' ? div('dg-panel', box) : null
  if (panel) panel.style.background = DIAGRAM_PANEL
  const inset = panel ? 30 * fu : 0
  const layer = svg('svg', { class: 'dg-layer', width: W, height: H, viewBox: `0 0 ${W} ${H}` }, box)
  const title = clean(spec.fields.title)
  let y0 = inset + 30 * fu
  if (title) {
    const head = div('dg-title', box, title)
    const size = clamp(1900 / Math.max(14, title.length), 40, 60) * fu
    Object.assign(head.style, { top: `${y0}px`, left: `${inset + 56 * fu}px`, right: `${inset + 56 * fu}px`, fontSize: `${size}px` })
    const lines = title.length * size * .5 > W - 2 * (inset + 56 * fu) ? 2 : 1
    y0 += lines * size * 1.16 + 34 * fu
    b.fitters.push(() => {
      // Never more than two lines: a long title gets smaller.
      let s = size
      while (head.scrollHeight > s * 1.2 * 2 + 2 && s > 26 * fu) { s -= 2 * fu; head.style.fontSize = `${s}px` }
    })
    b.onSeek.push((t) => {
      const p = outCubic(prog(t, 80, 420))
      head.style.opacity = String(p)
      head.style.transform = `translateY(${(1 - p) * 18 * fu}px)`
    })
  }
  const pad = inset + 58 * fu
  const f: Frame = { box, layer, W, H, x0: pad, x1: W - pad, y0, y1: H - inset - 34 * fu, fu, accent: spec.color, ink: '#fff' }
  b.onSeek.push((t) => {
    const fadeIn = outCubic(prog(t, 0, 260)), out = prog(t, spec.duration_ms - 300, 300)
    box.style.opacity = String(fadeIn * (1 - out))
    box.style.transform = out > 0 ? `scale(${1 - .03 * out})` : ''
    if (panel) {
      const p = outCubic(prog(t, 0, 380))
      panel.style.transform = `scale(${.94 + .06 * p})`
      panel.style.opacity = String(p)
    }
  })
  if (panel) Object.assign(panel.style, { left: `${inset}px`, top: `${inset}px`, right: `${inset}px`, bottom: `${inset}px` })
  return f
}

/** A label tag: white outline, lit with the accent fill. `state(t)` returns how lit (0..1) and how visible (0..1) it is. */
function tag(f: Frame, text: string, cls = ''): HTMLElement {
  const el = div(`dg-tag ${cls}`.trim(), f.box)
  div('dg-tag-text', el, text)
  return el
}
/**
 * A label's state: `lit` (0..1, the accent fill), `shown` (0..1: it pops in from slight oversize as it is said, never a
 * long fade), `pop` (0..1, a small bump as it lights). Its words are always at full strength on a filled tag.
 */
function setTag(el: HTMLElement, lit: number, shown: number, pop = 0): void {
  el.style.opacity = String(Math.min(1, shown * 2.5))
  el.style.setProperty('--lit', String(lit))
  el.classList.toggle('lit', lit > .5)
  const bump = Math.sin(Math.PI * clamp(pop, 0, 1)) * .08
  el.style.transform = `translate(-50%, 0) scale(${(1.1 - .1 * shown) * (1 + bump)})`
}
/** A label pops in as it is said (about 10 frames), so a diagram builds item by item. */
const said = (t: number, beat: number): number => outCubic(prog(t, beat - 140, 320))
/** The smallest diagram label (px on a 1080-wide frame): a stage graphic's on-phone minimum (fx/fit.ts FX_MIN_TYPE.stage). */
export const DIAGRAM_MIN_LABEL = 48
/**
 * Place a tag centered on x with its top at y (or its bottom at y), at most `width` wide; its words shrink until
 * they fit `maxLines` lines.
 */
function placeTag(b: DiagramBuild, el: HTMLElement, x: number, y: number, width: number, size: number, anchor: 'top' | 'bottom' = 'top', maxLines = 3): void {
  Object.assign(el.style, { left: `${x}px`, width: `${width}px`, fontSize: `${size}px`, top: `${anchor === 'top' ? y : y - size * 2.6}px` })
  b.fitters.push(() => {
    const text = el.firstElementChild as HTMLElement
    let s = size
    // Smaller only down to the on-phone minimum (a long label then takes another line).
    const floor = Math.min(size, Math.max(size * .7, DIAGRAM_MIN_LABEL * b.spec.width / 1080 * .84))
    while ((text.scrollHeight > s * 1.18 * maxLines + 2 && s > floor) || (text.scrollWidth > text.clientWidth + 1 && s > size * .5)) { s -= 1; el.style.fontSize = `${s}px` }
    if (anchor === 'bottom') el.style.top = `${y - el.offsetHeight}px`
  })
}

// ---------------------------------------------------------------------------
// Chapter header
// ---------------------------------------------------------------------------

export function chapterTemplate(b: DiagramBuild): void {
  const { spec, root, u } = b
  const { label, title } = chapterText(spec.fields)
  const style = chapterStyle(spec.fields)
  const top = spec.box.top * spec.height, H = (spec.box.bottom - spec.box.top) * spec.height
  const band = div(`dg-chapter style-${style}${spec.fields.ink === 'dark' ? ' ink-dark' : ''}`, root)
  Object.assign(band.style, { left: '0px', top: `${top}px`, width: `${spec.width}px`, height: `${H}px` })
  band.style.setProperty('--accent', spec.color)
  band.style.setProperty('--on-accent', onAccent(spec.color))
  const line = div('dg-chapter-line', band)
  const words: HTMLElement[] = []
  const add = (text: string, cls: string): void => {
    for (const w of text.split(' ').filter(Boolean)) {
      if (words.length) line.appendChild(document.createTextNode(' '))
      const span = document.createElement('span')
      span.className = `dg-chapter-word ${cls}`
      span.textContent = w
      line.appendChild(span)
      words.push(span)
    }
  }
  if (label) add(label, 'label')
  add(title, 'title')
  const base = (style === 'pill' ? 52 : style === 'sans' ? 62 : 86) * u
  const longest = (label ? label.length + 1 : 0) + title.length
  let size = clamp(base * 44 / Math.max(44, longest), base * .6, base)
  line.style.fontSize = `${size}px`
  line.style.maxWidth = `${spec.width - 2 * 70 * u}px`
  b.fitters.push(() => {
    // Two lines at most, inside the band.
    while ((line.offsetHeight > H - 8 * u || line.offsetHeight > size * (style === 'pill' ? 1.25 : 1.12) * 2 + (style === 'pill' ? 60 * u : 4)) && size > base * .45) {
      size -= 1.5 * u; line.style.fontSize = `${size}px`
    }
  })
  const n = words.length, step = clamp(520 / Math.max(1, n), 40, 90)
  b.onSeek.push((t) => {
    const out = prog(t, spec.duration_ms - 320, 320)
    const p = outCubic(prog(t, 0, 420))
    line.style.opacity = String(p * (1 - out))
    line.style.transform = `translateY(${(1 - p) * -12 * u + out * -10 * u}px)`
    words.forEach((w, i) => {
      const q = outCubic(prog(t, 80 + i * step, 360))
      w.style.opacity = String(q)
      w.style.transform = `translateY(${(1 - q) * 16 * u}px)`
    })
  })
}

// ---------------------------------------------------------------------------
// Staircase: steps climbing bottom-left to top-right, a label above each tread.
// ---------------------------------------------------------------------------

export function staircaseTemplate(b: DiagramBuild): void {
  const { spec } = b
  const f = frame(b, 'dg-staircase')
  const items = templateItems('staircase', spec.fields.items)
  const icons = graphicIcons(spec.fields, 'staircase')
  const n = Math.max(1, items.length), fu = f.fu
  const w = f.x1 - f.x0, h = f.y1 - f.y0
  const size = (n <= 3 ? 60 : n === 4 ? 54 : n === 5 ? 48 : 44) * fu
  const tagH = size * 2.7 + 26 * fu
  const sw = w / n, sh = clamp((h - tagH - 16 * fu) / n, 40 * fu, sw * 1.05)
  const yb = f.y1
  const ty = (i: number): number => yb - (i + 1) * sh
  let d = `M${f.x0},${yb} V${ty(0)}`
  for (let i = 0; i < n; i++) { d += ` H${f.x0 + (i + 1) * sw}`; if (i < n - 1) d += ` V${ty(i + 1)}` }
  d += ` V${yb} Z`
  // Each step is a filled block that takes the accent as it is said.
  const blocks = items.map((_, i) => svg('rect', { x: f.x0 + i * sw, y: ty(i), width: sw, height: yb - ty(i), fill: '#fff', opacity: 0 }, f.layer))
  const outline = line(f.layer, d, 5 * fu)
  const risers = Array.from({ length: n - 1 }, (_, k) => line(f.layer, `M${f.x0 + (k + 1) * sw},${ty(k)} V${yb}`, 3 * fu, { opacity: .7 }))
  const treads = items.map((_, i) => line(f.layer, `M${f.x0 + i * sw + 3 * fu},${ty(i)} H${f.x0 + (i + 1) * sw - 3 * fu}`, 9 * fu, { stroke: f.accent }))
  const iconSize = (i: number): number => Math.min(sh * .62, sw * .42, 84 * fu) * (i === 0 ? 1 : 1)
  const glyphs = items.map((_, i) => icons[i] ? iconAt(f.layer, icons[i]!, f.x0 + (i + .5) * sw, ty(i) + Math.min(sh * .5, 70 * fu), iconSize(i), 3.2 * fu) : null)
  const tags = items.map((text, i) => {
    const el = tag(f, text)
    placeTag(b, el, f.x0 + (i + .5) * sw, ty(i) - 16 * fu, sw - 8 * fu, size, 'bottom')
    return el
  })
  const beats = itemBeats(spec, items.length, 1100)
  b.onSeek.push((t) => {
    draw(outline, inOutCubic(prog(t, 120, 900)))
    risers.forEach((r, k) => draw(r, outCubic(prog(t, 500 + k * 70, 400))))
    items.forEach((_, i) => {
      const lit = outCubic(prog(t, beats[i], 260))
      const next = i + 1 < items.length ? outCubic(prog(t, beats[i + 1], 260)) : 0
      setTag(tags[i], lit, said(t, beats[i]), prog(t, beats[i], 420))
      blocks[i].setAttribute('fill', lit > 0 ? f.accent : '#fff')
      blocks[i].setAttribute('opacity', String(.1 * outCubic(prog(t, 300, 500)) * (1 - lit) + lit * (.55 - .25 * next)))
      draw(treads[i], inOutCubic(prog(t, beats[i] - 60, 320)))
      const g = glyphs[i]
      if (g) {
        g.style.opacity = String(outCubic(prog(t, 600 + i * 90, 360)))
        g.setAttribute('stroke', lit > .5 ? f.accent : '#fff')
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Funnel: a cone on its side, wide on the left, with a stage per section and its label under it.
// ---------------------------------------------------------------------------

export function funnelTemplate(b: DiagramBuild): void {
  const { spec } = b
  const f = frame(b, 'dg-funnel')
  const items = templateItems('funnel', spec.fields.items)
  const n = Math.max(1, items.length), fu = f.fu
  const size = (n <= 3 ? 56 : n === 4 ? 50 : 46) * fu
  const labelsH = size * 2.6 + 30 * fu
  const w = f.x1 - f.x0, h = f.y1 - f.y0
  const arrow = 74 * fu
  const xa = f.x0, xb = f.x1 - arrow
  const hl = Math.min(h - labelsH - 40 * fu, w * .62), hr = hl * .3
  const cy = f.y0 + (h - labelsH) / 2
  const half = (x: number): number => (hl + (hr - hl) * (x - xa) / (xb - xa)) / 2
  const xs = Array.from({ length: n + 1 }, (_, k) => xa + (xb - xa) * k / n)
  const fills = items.map((_, i) => svg('path', { d: `M${xs[i]},${cy - half(xs[i])} L${xs[i + 1]},${cy - half(xs[i + 1])} L${xs[i + 1]},${cy + half(xs[i + 1])} L${xs[i]},${cy + half(xs[i])} Z`, fill: f.accent, opacity: 0 }, f.layer))
  const outline = line(f.layer, `M${xa},${cy - hl / 2} L${xb},${cy - hr / 2} L${xb},${cy + hr / 2} L${xa},${cy + hl / 2} Z`, 5 * fu)
  const rim = line(f.layer, `M${xa},${cy - hl / 2} C${xa - 34 * fu},${cy - hl / 4} ${xa - 34 * fu},${cy + hl / 4} ${xa},${cy + hl / 2}`, 4 * fu, { opacity: .8 })
  const dividers = xs.slice(1, -1).map((x) => line(f.layer, `M${x},${cy - half(x)} V${cy + half(x)}`, 3 * fu, { opacity: .75 }))
  const shaft = line(f.layer, `M${xb},${cy} H${f.x1 - 6 * fu}`, 5 * fu)
  const head = line(f.layer, `M${f.x1 - 30 * fu},${cy - 22 * fu} L${f.x1 - 6 * fu},${cy} L${f.x1 - 30 * fu},${cy + 22 * fu}`, 5 * fu)
  const tags = items.map((text, i) => {
    const el = tag(f, text)
    placeTag(b, el, (xs[i] + xs[i + 1]) / 2, cy + hl / 2 + 30 * fu, (xb - xa) / n - 12 * fu, size)
    return el
  })
  const ticks = items.map((_, i) => line(f.layer, `M${(xs[i] + xs[i + 1]) / 2},${cy + half((xs[i] + xs[i + 1]) / 2) + 6 * fu} V${cy + hl / 2 + 24 * fu}`, 2.5 * fu, { opacity: .6, 'stroke-dasharray': '1', 'stroke-dashoffset': 1 }))
  const beats = itemBeats(spec, items.length, 1100)
  b.onSeek.push((t) => {
    draw(outline, inOutCubic(prog(t, 120, 900)))
    draw(rim, outCubic(prog(t, 600, 360)))
    dividers.forEach((dv, k) => draw(dv, outCubic(prog(t, 600 + k * 80, 320))))
    draw(shaft, outCubic(prog(t, 900, 260))); draw(head, outCubic(prog(t, 1080, 220)))
    items.forEach((_, i) => {
      const lit = outCubic(prog(t, beats[i], 280))
      const next = i + 1 < items.length ? outCubic(prog(t, beats[i + 1], 280)) : 0
      // The stage being said is full; the ones before it stay a softer fill.
      fills[i].setAttribute('opacity', String(.1 * outCubic(prog(t, 300, 500)) * (1 - lit) + lit * (.92 - .5 * next)))
      setTag(tags[i], lit, said(t, beats[i]), prog(t, beats[i], 420))
      draw(ticks[i], outCubic(prog(t, 700 + i * 90, 300)))
    })
  })
}

// ---------------------------------------------------------------------------
// Journey: tall milestone cards in a row over a ground line; a small figure walks to each as it is said.
// ---------------------------------------------------------------------------

export function journeyTemplate(b: DiagramBuild): void {
  const { spec } = b
  const f = frame(b, 'dg-journey')
  const items = templateItems('journey', spec.fields.items)
  const n = Math.max(1, items.length), fu = f.fu
  const w = f.x1 - f.x0, h = f.y1 - f.y0
  const gap = 26 * fu
  const cw = (w - gap * (n - 1)) / n
  const figure = 136 * fu
  const yg = f.y1 - 10 * fu
  // Room above the cards for the goal's flag.
  const ch = clamp(h - figure - 140 * fu, 120 * fu, cw * 2.1)
  const cb = yg - figure - 40 * fu, ct = cb - ch
  const size = clamp(cw * .22, 40 * fu, 58 * fu)
  const cx = (i: number): number => f.x0 + i * (cw + gap) + cw / 2
  // The ground: a long line with a hill at either end.
  const ground = line(f.layer, `M${f.x0 - 20 * fu},${yg} H${f.x1 + 20 * fu}`, 4 * fu)
  const hills = line(f.layer, `M${f.x0 - 30 * fu},${yg} Q${f.x0 + 60 * fu},${yg - 70 * fu} ${f.x0 + 170 * fu},${yg} M${f.x1 - 220 * fu},${yg} Q${f.x1 - 120 * fu},${yg - 90 * fu} ${f.x1 + 30 * fu},${yg}`, 3 * fu, { opacity: .7 })
  const cards = items.map((text, i) => {
    const card = div('dg-card', f.box)
    Object.assign(card.style, { left: `${cx(i) - cw / 2}px`, top: `${ct}px`, width: `${cw}px`, height: `${ch}px`, fontSize: `${size}px` })
    const words = div('dg-card-text', card, text)
    b.fitters.push(() => {
      let s = size
      while ((words.scrollHeight > ch - 30 * fu || words.scrollWidth > words.clientWidth + 1) && s > 16 * fu) { s -= 1; card.style.fontSize = `${s}px` }
    })
    return card
  })
  // A small flag on the last card: the goal.
  const lastX = cx(n - 1) + cw / 2 - 20 * fu
  const flag = line(f.layer, `M${lastX},${ct} V${ct - 70 * fu} M${lastX},${ct - 70 * fu} L${lastX - 46 * fu},${ct - 56 * fu} L${lastX},${ct - 42 * fu}`, 4 * fu)
  // The walker: head, body, arms and two legs (the legs swing while walking).
  const walker = svg('g', { fill: 'none', stroke: '#fff', 'stroke-width': 5 * fu, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, f.layer)
  const s = figure / 100
  svg('circle', { cx: 0, cy: -86 * s, r: 11 * s }, walker)
  svg('path', { d: `M0,${-74 * s} L0,${-36 * s}` }, walker)
  const armA = svg('path', { d: `M0,${-64 * s} L${-16 * s},${-46 * s}` }, walker)
  const armB = svg('path', { d: `M0,${-64 * s} L${16 * s},${-46 * s}` }, walker)
  const legA = svg('path', { d: `M0,${-36 * s} L${-12 * s},0` }, walker)
  const legB = svg('path', { d: `M0,${-36 * s} L${12 * s},0` }, walker)
  const beats = itemBeats(spec, items.length, 1300)
  const walk = (i: number): number => Math.min(800, i > 0 ? beats[i] - beats[i - 1] - 80 : 700)
  b.onSeek.push((t) => {
    draw(ground, inOutCubic(prog(t, 100, 700)))
    draw(hills, outCubic(prog(t, 400, 600)))
    draw(flag, outCubic(prog(t, 900, 400)))
    // Where the walker is: off to the left at first, then at each card as it is said.
    let x = f.x0 - 40 * fu, moving = false
    const start = f.x0 - 40 * fu
    for (let i = 0; i < items.length; i++) {
      const from = i ? cx(i - 1) : start, len = Math.max(250, walk(i)), at = beats[i] - len
      if (t >= beats[i]) x = cx(i)
      else if (t > at) { x = from + (cx(i) - from) * inOutCubic((t - at) / len); moving = true; break }
      else { x = i ? cx(i - 1) : start; break }
    }
    const swing = moving ? Math.sin(t / 95) * 24 : 0
    walker.setAttribute('transform', `translate(${x} ${yg - 3 * fu})`)
    walker.style.opacity = String(outCubic(prog(t, 500, 300)))
    legA.setAttribute('transform', `rotate(${swing} 0 ${-36 * s})`); legB.setAttribute('transform', `rotate(${-swing} 0 ${-36 * s})`)
    armA.setAttribute('transform', `rotate(${-swing * .8} 0 ${-64 * s})`); armB.setAttribute('transform', `rotate(${swing * .8} 0 ${-64 * s})`)
    cards.forEach((card, i) => {
      // Each milestone comes in as it is said (the walker reaches it); the ground and the flag are there from the start.
      const shown = said(t, beats[i])
      const lit = outCubic(prog(t, beats[i], 280))
      const next = i + 1 < items.length ? outCubic(prog(t, beats[i + 1], 280)) : 0
      card.style.opacity = String(shown)
      card.style.transform = `translateY(${(1 - shown) * 30 * fu}px) scale(${1 + Math.sin(Math.PI * prog(t, beats[i], 420)) * .05})`
      // The card being said fills with the accent; the ones passed keep an accent edge.
      card.style.setProperty('--lit', String(lit * (1 - next)))
      card.style.setProperty('--passed', String(next))
      card.classList.toggle('lit', lit * (1 - next) > .5)
    })
  })
}

// ---------------------------------------------------------------------------
// Growth: plants in pots (or bars), each bigger than the one before, growing as they are said.
// ---------------------------------------------------------------------------

export function growthTemplate(b: DiagramBuild): void {
  const { spec } = b
  const f = frame(b, 'dg-growth')
  const items = templateItems('growth', spec.fields.items)
  const bars = growthStyle(spec.fields) === 'bars'
  const n = Math.max(1, items.length), fu = f.fu
  const w = f.x1 - f.x0
  const size = (n <= 3 ? 54 : n === 4 ? 50 : n === 5 ? 46 : 42) * fu
  const labelsH = size * 2.6 + 26 * fu
  const sw = w / n
  const base = f.y1 - labelsH
  const pw = Math.min(sw * .5, 120 * fu), ph = pw * .72
  const room = base - (bars ? 0 : ph) - f.y0 - 10 * fu
  const scale = (i: number): number => n > 1 ? .38 + .62 * i / (n - 1) : 1
  const cx = (i: number): number => f.x0 + (i + .5) * sw
  type Plant = { pot: SVGElement; stem: SVGElement; leaves: SVGElement[]; bar?: SVGElement; ghost?: SVGElement }
  const plants: Plant[] = items.map((_, i) => {
    const x = cx(i), k = scale(i)
    if (bars) {
      const bw = Math.min(sw * .52, 130 * fu), bh = room * k
      const ghost = svg('rect', { x: x - bw / 2, y: base - bh, width: bw, height: bh, rx: 14 * fu, fill: 'none', stroke: '#fff', 'stroke-width': 3 * fu, 'stroke-dasharray': `${10 * fu} ${10 * fu}`, opacity: 0 }, f.layer)
      const bar = svg('rect', { x: x - bw / 2, y: base - bh, width: bw, height: bh, rx: 14 * fu, fill: f.accent, stroke: '#fff', 'stroke-width': 4 * fu }, f.layer)
      return { pot: ghost, stem: bar, leaves: [], bar, ghost }
    }
    const pot = line(f.layer, `M${x - pw / 2},${base - ph} H${x + pw / 2} L${x + pw * .36},${base} H${x - pw * .36} Z M${x - pw / 2 - 8 * fu},${base - ph} H${x + pw / 2 + 8 * fu}`, 4.5 * fu)
    const stemH = (room - 10 * fu) * k
    const top = base - ph - stemH
    const stem = line(f.layer, `M${x},${base - ph} C${x - 10 * fu},${base - ph - stemH * .4} ${x + 10 * fu},${base - ph - stemH * .7} ${x},${top}`, 4.5 * fu)
    const pairs = 1 + Math.round(k * 3)
    const leaves: SVGElement[] = []
    for (let p = 0; p < pairs; p++) {
      const y = base - ph - stemH * (.28 + .62 * (p + 1) / (pairs + .4))
      const len = (34 + 44 * k) * fu * (1 - p * .08)
      for (const side of [-1, 1]) {
        const tipX = x + side * len, tipY = y - len * .55
        const leaf = svg('path', { d: `M${x},${y} Q${x + side * len * .2},${y - len * .7} ${tipX},${tipY} Q${x + side * len * .8},${y + len * .05} ${x},${y} Z`,
          fill: 'none', stroke: '#fff', 'stroke-width': 4 * fu, 'stroke-linejoin': 'round', style: `transform-origin:${x}px ${y}px` }, f.layer)
        leaves.push(leaf)
      }
    }
    const bud = svg('path', { d: `M${x},${top + 4 * fu} Q${x - 18 * fu},${top - 22 * fu} ${x},${top - 40 * fu} Q${x + 18 * fu},${top - 22 * fu} ${x},${top + 4 * fu} Z`, fill: 'none', stroke: '#fff', 'stroke-width': 4 * fu, style: `transform-origin:${x}px ${top}px` }, f.layer)
    leaves.push(bud)
    return { pot, stem, leaves }
  })
  const tags = items.map((text, i) => {
    const el = tag(f, text)
    placeTag(b, el, cx(i), base + 22 * fu, sw - 12 * fu, size)
    return el
  })
  const beats = itemBeats(spec, items.length, 1000)
  b.onSeek.push((t) => {
    items.forEach((_, i) => {
      const p = plants[i]
      const lit = outCubic(prog(t, beats[i], 280))
      setTag(tags[i], lit, said(t, beats[i]), prog(t, beats[i], 420))
      if (p.bar && p.ghost) {
        p.ghost.setAttribute('opacity', String(.45 * outCubic(prog(t, 200 + i * 90, 360)) * (1 - lit)))
        const g = outBack(prog(t, beats[i] - 120, 520))
        p.bar.setAttribute('transform', `translate(0 ${base}) scale(1 ${Math.max(0.001, g)}) translate(0 ${-base})`)
        p.bar.style.opacity = g > 0 ? '1' : '0'
        return
      }
      draw(p.pot, outCubic(prog(t, 200 + i * 90, 420)))
      p.pot.setAttribute('fill', lit > 0 ? f.accent : 'none')
      p.pot.setAttribute('fill-opacity', String(lit * .9))
      draw(p.stem, outCubic(prog(t, beats[i] - 140, 520)))
      p.leaves.forEach((leaf, k) => {
        const q = outBack(prog(t, beats[i] + 120 + k * 45, 360))
        leaf.style.transform = `scale(${Math.max(0, q)})`
        leaf.style.opacity = q > 0 ? '1' : '0'
        leaf.setAttribute('fill', f.accent)
        leaf.setAttribute('fill-opacity', String(.85 * lit))
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Idea hub: an icon in the middle (a light bulb by default) with labels around it, each appearing as said.
// ---------------------------------------------------------------------------

export function ideaHubTemplate(b: DiagramBuild): void {
  const { spec } = b
  const f = frame(b, 'dg-hub')
  const items = templateItems('idea_hub', spec.fields.items)
  const center = clean(spec.fields.text)
  const n = Math.max(1, items.length), fu = f.fu
  const w = f.x1 - f.x0, h = f.y1 - f.y0
  const cx = (f.x0 + f.x1) / 2, cy = f.y0 + h / 2
  const r = clamp(Math.min(w, h) * .17, 70 * fu, 150 * fu)
  const ring = line(f.layer, `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - .01},${cy - r}`, 5 * fu)
  const name = hubIcon(spec.fields)
  let glyph: SVGElement
  if (name === 'idea') {
    // Our own light bulb: glass, filament, base, and rays that flicker on.
    const g = svg('g', { transform: `translate(${cx - r * .62} ${cy - r * .7}) scale(${r * 1.24 / 100})`, fill: 'none', stroke: '#fff', 'stroke-width': 4.6 * fu * 100 / (r * 1.24), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, f.layer)
    svg('path', { d: 'M50 8 C29 8 17 25 17 42 C17 55 25 62 31 69 C35 73 37 77 37 82 L63 82 C63 77 65 73 69 69 C75 62 83 55 83 42 C83 25 71 8 50 8 Z' }, g)
    svg('path', { d: 'M42 82 L42 60 L46 53 L50 60 L54 53 L58 60 L58 82' }, g)
    svg('path', { d: 'M38 90 H62 M40 98 H60 M45 106 H55' }, g)
    glyph = g
  } else glyph = iconAt(f.layer, name, cx, cy, r * 1.15, 4.6 * fu)
  const rays = Array.from({ length: 8 }, (_, k) => {
    const a = -Math.PI / 2 + k * Math.PI / 4, r1 = r + 16 * fu, r2 = r + 40 * fu
    return line(f.layer, `M${cx + Math.cos(a) * r1},${cy + Math.sin(a) * r1} L${cx + Math.cos(a) * r2},${cy + Math.sin(a) * r2}`, 4 * fu, { opacity: .85 })
  })
  const caption = center ? div('dg-hub-caption', f.box, center) : null
  if (caption) Object.assign(caption.style, { left: `${cx}px`, top: `${cy + r + 52 * fu}px`, fontSize: `${30 * fu}px`, width: `${r * 3}px` })
  const size = (n <= 4 ? 54 : 48) * fu
  const tagW = Math.min(310 * fu, w * .4)
  const rx = Math.min(w / 2 - tagW / 2 + 6 * fu, r + 40 * fu + tagW * .62), ry = Math.min(h / 2 - size * 1.6, r + 150 * fu)
  // Around the icon from the top-left, clockwise; three or four labels sit on the diagonals.
  const angles = items.map((_, i) => (n <= 4 ? -Math.PI * .75 : -Math.PI / 2) + i * 2 * Math.PI / n)
  const spots = angles.map((a) => ({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, a }))
  const arrows = spots.map(({ a }) => {
    // From just outside the rays toward the label, stopping short of it.
    const s1 = r + 52 * fu, tx = Math.cos(a) * rx, ty = Math.sin(a) * ry
    const ex = tx - Math.sign(tx) * Math.min(Math.abs(tx), tagW * .5) * .8, ey = ty - Math.sign(ty) * size * 1.5
    const len = Math.hypot(ex, ey), e = Math.max(s1 + 30 * fu, len)
    const x1 = cx + Math.cos(a) * s1, y1 = cy + Math.sin(a) * s1 * (ry / rx > 1 ? 1 : 1)
    const x2 = cx + (ex / len) * e, y2 = cy + (ey / len) * e
    const ang = Math.atan2(y2 - y1, x2 - x1), hd = 18 * fu
    return {
      shaft: line(f.layer, `M${x1},${y1} L${x2},${y2}`, 4 * fu),
      head: line(f.layer, `M${x2 - hd * Math.cos(ang - .5)},${y2 - hd * Math.sin(ang - .5)} L${x2},${y2} L${x2 - hd * Math.cos(ang + .5)},${y2 - hd * Math.sin(ang + .5)}`, 4 * fu)
    }
  })
  const tags = items.map((text, i) => {
    const el = tag(f, text, 'pill')
    placeTag(b, el, spots[i].x, spots[i].y - size * .9, tagW, size)
    return el
  })
  const beats = itemBeats(spec, items.length, 1000)
  b.onSeek.push((t) => {
    draw(ring, inOutCubic(prog(t, 100, 700)))
    glyph.style.opacity = String(outCubic(prog(t, 250, 400)))
    glyph.style.transform = ''
    const glow = items.length ? outCubic(prog(t, beats[0] - 200, 400)) : 0
    glyph.setAttribute('stroke', glow > .5 ? f.accent : '#fff')
    rays.forEach((ray, k) => draw(ray, outCubic(prog(t, 650 + k * 40, 260))))
    if (caption) caption.style.opacity = String(outCubic(prog(t, 500, 400)))
    items.forEach((_, i) => {
      const appear = prog(t, beats[i], 380)
      draw(arrows[i].shaft, outCubic(prog(t, beats[i] - 260, 260)))
      draw(arrows[i].head, outCubic(prog(t, beats[i] - 40, 140)))
      const next = i + 1 < items.length ? outCubic(prog(t, beats[i + 1], 300)) : 0
      // Each label pops in as it is said and lights up; earlier ones settle to a filled tag (never faint).
      setTag(tags[i], outCubic(appear) * (1 - next), said(t, beats[i]), appear)
    })
  })
}

// ---------------------------------------------------------------------------
// Wrong / right: two big filled cards across the stage; each comes in as its side is said with its badge (a red ✗ on
// the wrong one, a green ✓ on the right one), and when the right one lands the wrong one dims and is struck through.
// ---------------------------------------------------------------------------

/** The share of the frame's width the two cards fill (a stage graphic fills at least 88%: text-fit TEXT_FILL.stage). */
export const COMPARE_FILL = .9
/** The smallest card title (px on a 1080-wide frame): a short line's on-phone minimum (text-fit textMinType). */
export const COMPARE_MIN_TITLE = 76
const CROSS_RED = '#E5484D'
const CHECK_GREEN = '#22B573'

export function compareMarksTemplate(b: DiagramBuild): void {
  const { spec } = b
  const f = frame(b, 'dg-compare')
  const items = templateItems('compare_marks', spec.fields.items)
  const notes = compareNotes(spec.fields)
  const wrong = compareWrong(spec.fields)
  const fu = f.fu
  const W = spec.width
  const gap = 56 * fu
  const span = Math.min(W * COMPARE_FILL, W - 2 * 24 * fu)
  const x0 = (W - span) / 2
  const cw = (span - gap) / 2
  const badge = 58 * fu
  // Room above the cards for the badges, which sit on the cards' top edge.
  const h = f.y1 - f.y0
  const ch = clamp(Math.min(h - badge - 16 * fu, cw * 1.3), 220 * fu, 760 * fu)
  const top = f.y0 + badge + Math.max(0, (h - badge - ch) / 2)
  const titleMin = COMPARE_MIN_TITLE * fu
  const cards = items.map((text, i) => {
    const card = div(`dg-compare-card ${i === wrong ? 'wrong' : 'right'}`, f.box)
    Object.assign(card.style, { left: `${x0 + i * (cw + gap)}px`, top: `${top}px`, width: `${cw}px`, height: `${ch}px` })
    const head = div('dg-compare-title', card, text)
    head.style.fontSize = `${clamp(1700 / Math.max(8, text.length), COMPARE_MIN_TITLE, 150) * fu}px`
    // The strike: the same words over them, struck through line by line, wiped in from the left.
    const strike = div('dg-compare-strike', head, text)
    // Its slot before it is said: a dashed outline, so the frame reads as two sides from its first frame.
    const slot = div('dg-compare-slot', f.box)
    Object.assign(slot.style, { left: `${x0 + i * (cw + gap)}px`, top: `${top}px`, width: `${cw}px`, height: `${ch}px` })
    const note = notes[i] ? div('dg-compare-note', card, notes[i]) : null
    if (note) note.style.fontSize = `${44 * fu}px`
    b.fitters.push(() => {
      // As big as the card allows, never under the on-phone minimum (a very long side may then wrap to more lines).
      let s = parseFloat(head.style.fontSize)
      while ((card.scrollHeight > card.clientHeight + 1 || head.scrollWidth > head.clientWidth + 1) && s > titleMin) { s -= 2 * fu; head.style.fontSize = `${s}px` }
    })
    return { card, strike, slot }
  })
  // A "vs" chip between the cards, so the frame reads as a comparison from its first frame.
  const vs = div('dg-compare-vs', f.box, 'vs')
  Object.assign(vs.style, { left: `${x0 + cw + gap / 2}px`, top: `${top + ch / 2}px`, fontSize: `${30 * fu}px`, width: `${72 * fu}px`, height: `${72 * fu}px` })
  const mark = (i: number, kind: 'cross' | 'check'): { circle: SVGElement; stroke: SVGElement } => {
    const r = badge, x = x0 + i * (cw + gap) + cw / 2, y = top
    const circle = svg('circle', { cx: x, cy: y, r, fill: kind === 'cross' ? CROSS_RED : CHECK_GREEN, stroke: '#fff', 'stroke-width': 7 * fu, style: `transform-origin:${x}px ${y}px` }, f.layer)
    const d = kind === 'cross' ? `M${x - r * .36},${y - r * .36} L${x + r * .36},${y + r * .36} M${x + r * .36},${y - r * .36} L${x - r * .36},${y + r * .36}` : `M${x - r * .4},${y + r * .02} L${x - r * .1},${y + r * .32} L${x + r * .42},${y - r * .3}`
    const stroke = line(f.layer, d, 12 * fu)
    return { circle, stroke }
  }
  const marks = items.length === 2 ? [mark(wrong, 'cross'), mark(1 - wrong, 'check')] : []
  // The layer (badges) above the cards.
  f.box.appendChild(f.layer)
  const said = compareTimes(spec.fields, spec.duration_ms)
  const cardAt = said ? said.cards.map((t) => clamp(t - 60, 120, spec.duration_ms - 900)) : [200, Math.min(1400, spec.duration_ms / 3)]
  const crossAt = said ? clamp(said.cross, 120, spec.duration_ms - 500) : cardAt[wrong] + 250
  const checkAt = said ? clamp(said.check, 120, spec.duration_ms - 500) : cardAt[1 - wrong] + 250
  // The verdict: once both marks are in, the wrong side dims and is struck through, the right one steps forward.
  const verdictAt = Math.max(crossAt, checkAt)
  b.onSeek.push((t) => {
    cards.forEach(({ card, strike, slot }, i) => {
      // In on its word: from slight oversize and a little below, settled in about 10 frames (no long fade).
      const p = outCubic(prog(t, cardAt[i] ?? 200, 320))
      const verdict = outCubic(prog(t, verdictAt + 80, 300))
      const isWrong = i === wrong
      card.style.opacity = String(p > 0 ? Math.min(1, p * 3) : 0)
      const scale = (1.08 - .08 * p) * (isWrong ? 1 - .04 * verdict : 1 + .03 * verdict)
      card.style.transform = `translateY(${(1 - p) * 34 * fu}px) scale(${scale})`
      card.style.setProperty('--verdict', String(verdict))
      card.classList.toggle('settled', verdict > .5)
      const wipe = isWrong ? inOutCubic(prog(t, verdictAt + 60, 300)) : 0
      strike.style.clipPath = `inset(0 ${(100 * (1 - wipe)).toFixed(2)}% 0 0)`
      strike.style.opacity = wipe > 0 ? '1' : '0'
      slot.style.opacity = String(outCubic(prog(t, 100, 260)) * (1 - Math.min(1, p * 2)))
    })
    vs.style.opacity = String(outCubic(prog(t, 120, 260)) * (1 - outCubic(prog(t, verdictAt, 260))))
    if (marks.length) {
      const [x, v] = marks
      const px = outBack(prog(t, crossAt, 300)), pv = outBack(prog(t, checkAt, 300))
      x.circle.style.transform = `scale(${Math.max(0, px)})`; x.circle.style.opacity = px > 0 ? '1' : '0'
      v.circle.style.transform = `scale(${Math.max(0, pv)})`; v.circle.style.opacity = pv > 0 ? '1' : '0'
      draw(x.stroke, outCubic(prog(t, crossAt + 90, 200)))
      draw(v.stroke, outCubic(prog(t, checkAt + 90, 200)))
    }
  })
}
