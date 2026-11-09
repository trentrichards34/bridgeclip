/**
 * Call to action (`link_cta`): the speaker's own call to action ("Hit the link") on a big button in the brand color,
 * an icon for what it asks (a link, a comment, a DM, a follow, a save, a share), a pointer that glides in and taps it
 * (the button presses, a ripple spreads, a shine sweeps across), an optional short line over it ("Get all the
 * details") and where the link is ("below", "in my bio") with chevrons bouncing toward it.
 *
 * Every frame is worked out from the time alone (onSeek), so the render and the editor's scrubbing get the same
 * pixels. Only words from the graphic's fields are drawn; the icons and the hand are generic shapes (Lucide, ISC,
 * see LICENSE-lucide.txt; the hand is our own), never a brand logo.
 */
import { ctaKind, ctaPointsDown, type CtaKind, type GraphicRenderSpec } from '../../shared/motion-graphics'
import { ICONS } from './icons'
import './cta.css'

export interface CtaBuild {
  root: HTMLElement
  fit: HTMLElement
  spec: GraphicRenderSpec
  u: number
  onSeek: ((ms: number) => void)[]
  fitters: (() => void)[]
}

type Node = [string, Record<string, string>][]
const KIND_ICONS: Record<CtaKind, Node> = {
  link: ICONS.link,
  comment: ICONS.message,
  dm: [['path', { d: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z' }], ['path', { d: 'm21.854 2.147-10.94 10.939' }]],
  follow: [['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }], ['circle', { cx: '9', cy: '7', r: '4' }], ['line', { x1: '19', x2: '19', y1: '8', y2: '14' }], ['line', { x1: '22', x2: '16', y1: '11', y2: '11' }]],
  save: [['path', { d: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' }]],
  share: [['circle', { cx: '18', cy: '5', r: '3' }], ['circle', { cx: '6', cy: '12', r: '3' }], ['circle', { cx: '18', cy: '19', r: '3' }], ['line', { x1: '8.59', x2: '15.42', y1: '13.51', y2: '17.49' }], ['line', { x1: '15.41', x2: '8.59', y1: '6.51', y2: '10.49' }]]
}
const CHEVRON: Node = [['path', { d: 'm6 9 6 6 6-6' }]]
/** The pointing hand (our own shape): the fingertip is at (38, 4) of its 100 × 120 box. */
const HAND = [
  { x: 28, y: 4, w: 20, h: 66, r: 10 }, { x: 46, y: 36, w: 18, h: 38, r: 9 }, { x: 62, y: 41, w: 17, h: 36, r: 8.5 }, { x: 77, y: 48, w: 15, h: 31, r: 7.5 },
  { x: 28, y: 56, w: 64, h: 52, r: 24 }
]
const THUMB = { x: 4, y: 60, w: 36, h: 18, r: 9, rotate: 32, cx: 30, cy: 70 }

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const p01 = (t: number, a: number, d: number): number => clamp((t - a) / Math.max(1, d), 0, 1)
const outCubic = (p: number): number => 1 - Math.pow(1 - p, 3)
const outQuart = (p: number): number => 1 - Math.pow(1 - p, 4)
const inCubic = (p: number): number => p * p * p
const inOutSine = (p: number): number => -(Math.cos(Math.PI * p) - 1) / 2
/** Overshoots a little and settles (a pop). */
const outBack = (p: number): number => { const c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2) }

function div(className: string, parent: HTMLElement, text?: string): HTMLElement {
  const node = document.createElement('div')
  node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}
function svgNode(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent.appendChild(node)
  return node
}
function iconSvg(parent: HTMLElement, node: Node, className: string): SVGElement {
  const svg = svgNode('svg', { class: className, viewBox: '0 0 24 24', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent)
  for (const [tag, attrs] of node) svgNode(tag, attrs, svg)
  return svg
}
function handSvg(parent: HTMLElement): SVGElement {
  const svg = svgNode('svg', { class: 'mg-cta2-hand-svg', viewBox: '-8 -6 116 132' }, parent)
  // The outline first (every shape drawn wide in dark), then the white hand over it: the inner lines disappear.
  for (const layer of ['line', 'fill']) {
    const g = svgNode('g', { class: `mg-cta2-hand-${layer}` }, svg)
    for (const s of HAND) svgNode('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.r }, g)
    svgNode('rect', { x: THUMB.x, y: THUMB.y, width: THUMB.w, height: THUMB.h, rx: THUMB.r, transform: `rotate(${THUMB.rotate} ${THUMB.cx} ${THUMB.cy})` }, g)
  }
  // A crease on the index finger and the knuckles, faint.
  svgNode('path', { class: 'mg-cta2-hand-crease', d: 'M33 40 H43 M50 58 V64 M66 62 V67 M81 66 V70' }, svg)
  return svg
}

const clean = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
function style(node: HTMLElement | SVGElement, transform: string, opacity: number): void {
  node.style.transform = transform
  node.style.opacity = String(Math.round(opacity * 1000) / 1000)
}

export function ctaTemplate(b: CtaBuild): void {
  const { spec, fit, u } = b
  const D = spec.duration_ms
  const text = clean(spec.fields.text), where = clean(spec.fields.where), lead = clean(spec.fields.lead)
  const kind = ctaKind(spec.fields)
  const down = ctaPointsDown(spec.fields)

  const push = div('mg-push mg-cta2-push', fit)
  const card = div('mg-cta2', push)
  const leadEl = lead ? div('mg-cta2-lead', card, lead) : null
  const stage = div('mg-cta2-stage', card)
  const button = div('mg-cta2-button', stage)
  const sheen = div('mg-cta2-sheen', button)
  const badge = div('mg-cta2-badge', button)
  const glyph = iconSvg(badge, KIND_ICONS[kind], 'mg-cta2-icon')
  const label = div('mg-cta2-label mg-display', button, text)
  // A long call to action takes two balanced lines; the size follows the longer line.
  const lines = text.length > 22 ? 2 : 1
  if (lines > 1) label.classList.add('two')
  label.style.setProperty('--cta2-size', String(Math.round(clamp(1250 / Math.max(9, (text.length / lines) * 1.1 + (lines > 1 ? 2 : 0)), 52, 86))))
  const ripple = div('mg-cta2-ripple', stage)
  const ripple2 = div('mg-cta2-ripple two', stage)
  const hand = div('mg-cta2-hand', stage)
  handSvg(hand)
  const spot = where || down ? div(`mg-cta2-where${down ? ' down' : ''}`, card) : null
  const chevrons: SVGElement[] = []
  if (spot && down) {
    const stack = div('mg-cta2-chevrons', spot)
    for (let i = 0; i < 2; i++) chevrons.push(iconSvg(stack, CHEVRON, 'mg-cta2-chevron'))
  }
  const whereText = spot && where ? div('mg-cta2-where-text', spot, where) : null

  const animated: (HTMLElement | SVGElement)[] = [card, leadEl, button, sheen, badge, glyph, label, ripple, ripple2, hand, spot, whereText, ...chevrons].filter((n): n is HTMLElement | SVGElement => !!n)
  // Measured without any move applied (the template page fits the band after the fitters).
  b.fitters.push(() => { for (const n of animated) { n.style.removeProperty('transform'); n.style.removeProperty('opacity') } })

  // Timing: in fast, the tap once the button has landed, a second tap when it holds long enough, a short exit.
  const tout = clamp(D * .08, 180, 280), outAt = D - tout
  const tap = clamp(D * .26, 780, 1150)
  const tap2 = D >= 3300 ? clamp(D * .62, tap + 1100, outAt - 700) : null
  const handIn = Math.max(260, tap - 520)
  const handOut = outAt - 260

  b.onSeek.push((t) => {
    const exit = inCubic(p01(t, outAt, tout))
    // The card: up from 90% while rising and fading in; a slow push while it holds; out with a lift.
    const cin = outQuart(p01(t, 0, 440))
    const hold = inOutSine(p01(t, 440, Math.max(1, outAt - 440)))
    style(card, `translateY(${(1 - cin) * 56 * u - exit * 24 * u}px) scale(${(.9 + .1 * cin) * (1 + .025 * hold) * (1 - .04 * exit)})`, Math.min(1, p01(t, 0, 200)) * (1 - exit))
    if (leadEl) style(leadEl, `translateY(${(1 - outCubic(p01(t, 140, 360))) * 22 * u}px)`, p01(t, 140, 220))
    // The button pops in and settles, presses on each tap.
    const pop = p01(t, 160, 460)
    const press = (at: number): number => t < at ? 0 : t < at + 110 ? outCubic((t - at) / 110) : 1 - outBack(p01(t, at + 110, 320))
    const pressed = Math.max(press(tap), tap2 ? press(tap2) : 0)
    style(button, `scale(${(pop < 1 ? .7 + .3 * outBack(pop) : 1) * (1 - .055 * Math.max(0, pressed))})`, p01(t, 160, 160))
    style(badge, `scale(${p01(t, 300, 1) ? .4 + .6 * outBack(p01(t, 300, 380)) : .4}) rotate(${(1 - outCubic(p01(t, 300, 520))) * -50}deg)`, p01(t, 300, 160))
    style(glyph, `scale(${1 + .18 * Math.max(0, pressed)})`, 1)
    style(label, `translateX(${(1 - outCubic(p01(t, 330, 420))) * -26 * u}px)`, p01(t, 330, 240))
    // The shine sweeps across after each tap (left to right, slanted).
    const shine = (at: number): number => p01(t, at + 60, 620)
    const s = Math.max(shine(tap) < 1 ? shine(tap) : 0, tap2 && shine(tap2) < 1 ? shine(tap2) : 0)
    style(sheen, `translateX(${-140 + 300 * inOutSine(s)}%) skewX(-18deg)`, s > 0 && s < 1 ? 1 : 0)
    // Ripples from the fingertip on each tap.
    const ring = (node: HTMLElement, at: number | null): void => {
      const p = at === null ? 0 : p01(t, at, 680)
      style(node, `translate(-50%, -50%) scale(${.25 + 1.55 * outCubic(p)})`, p > 0 && p < 1 ? .85 * (1 - p) : 0)
    }
    ring(ripple, tap)
    ring(ripple2, tap2)
    // The hand: glides in from the lower right, taps (dips and shrinks a touch), rests, leaves before the card.
    const hin = outCubic(p01(t, handIn, 480)), hout = inCubic(p01(t, handOut, 240))
    const dip = (at: number | null): number => at === null ? 0 : t < at - 90 ? 0 : t < at ? outCubic((t - at + 90) / 90) : 1 - outCubic(p01(t, at, 260))
    const d = Math.max(dip(tap), dip(tap2))
    style(hand, `translate(${(1 - hin) * 150 * u + hout * 90 * u}px, ${(1 - hin) * 190 * u + hout * 120 * u + d * 6 * u}px) rotate(${(1 - hin) * 16 - d * 4}deg) scale(${1 - .1 * d})`,
      Math.min(p01(t, handIn, 180), 1 - hout))
    // Where the link is: in after the first tap; the chevrons bounce toward it, one after the other.
    if (spot) style(spot, `translateY(${(1 - outCubic(p01(t, tap + 80, 380))) * -14 * u}px)`, p01(t, tap + 80, 260))
    chevrons.forEach((c, i) => {
      const phase = ((t - tap - i * 160) / 820) % 1
      const bounce = t < tap ? 0 : Math.sin(Math.max(0, phase) * Math.PI)
      style(c, `translateY(${bounce * 12 * u}px)`, t < tap ? 0 : .45 + .55 * (i === 0 ? bounce : 1 - bounce * .6))
    })
  })
}
