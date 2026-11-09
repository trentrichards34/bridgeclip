/**
 * Big words: 1–3 huge words set in the scene, as on a poster. Each line is
 * sized to fill about 90% of the frame's width (or, set along a side, most of
 * the band's height), so the words read even with the speaker standing in
 * front of them (the engine lays the speaker back over the words when the
 * graphic is "behind").
 *
 * Styles: `serif` (white high-contrast serif), `sans` (heavy condensed caps),
 * `mixed` (line 1 italic serif, line 2 condensed caps in the accent color).
 * Moves: `scale` (word by word from 108% with the blur clearing) or `reveal`
 * (each line slides up out of a mask); both leave fast. Every frame is worked
 * out from the time alone (onSeek), so the render and the editor's scrubbing
 * get the same pixels. Only the words from the `text` field are drawn. With
 * `word_ms` (each word's spoken time, ms into the graphic) every word lands as
 * it is said: it starts coming in just before and is fully there on its word.
 */
import { bigWords, bigWordsOptions, graphicWordTimes, type GraphicRenderSpec } from '../../shared/motion-graphics'

export interface BigWordsBuild {
  root: HTMLElement
  spec: GraphicRenderSpec
  u: number
  onSeek: ((ms: number) => void)[]
  fitters: (() => void)[]
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const outCubic = (p: number): number => 1 - Math.pow(1 - clamp(p, 0, 1), 3)
const outExpo = (p: number): number => p >= 1 ? 1 : p <= 0 ? 0 : 1 - Math.pow(2, -10 * p)
const inCubic = (p: number): number => Math.pow(clamp(p, 0, 1), 3)
const inOutSine = (p: number): number => -(Math.cos(Math.PI * clamp(p, 0, 1)) - 1) / 2

function div(className: string, parent: HTMLElement, text?: string): HTMLElement {
  const node = document.createElement(text === undefined ? 'div' : 'span')
  node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}

/** Timing: the words in, a slow drift while they hold, a fast exit. */
export function bigWordsTiming(duration: number, count: number): { step: number; wordIn: number; tout: number; outAt: number } {
  const tout = clamp(duration * .08, 150, 230)
  const wordIn = clamp(duration * .18, 320, 480)
  const step = count > 1 ? clamp((duration * .22) / (count - 1), 90, 170) : 0
  return { step, wordIn, tout, outAt: duration - tout }
}

export function bigWordsTemplate(b: BigWordsBuild): void {
  const { root, spec, u } = b
  const W = spec.width, H = spec.height
  const { style, vertical, motion } = bigWordsOptions(spec.fields)
  const lines = bigWords(spec.fields.text, { stack: !vertical, mixed: style === 'mixed' })
  const top = spec.box.top * H, bandH = Math.max(1, (spec.box.bottom - spec.box.top) * H)
  const layer = div(`mg-big ${style} ${motion}${vertical ? ` vertical ${vertical}` : ''} ${spec.placement}`, root)
  layer.style.top = `${top}px`
  layer.style.height = `${bandH}px`
  const drift = div('mg-big-drift', layer)
  const lineEls: HTMLElement[] = [], inners: HTMLElement[] = [], words: HTMLElement[] = []
  lines.forEach((line, i) => {
    const kind = style === 'mixed' ? (i === 0 ? 'serif-italic' : 'accent') : style
    const mask = div(`mg-big-line ${kind}`, drift)
    const inner = div('mg-big-inner', mask)
    line.forEach((word, k) => {
      if (k > 0) inner.appendChild(document.createTextNode(' '))
      words.push(div('mg-big-w', inner, word))
    })
    lineEls.push(mask); inners.push(inner)
  })

  // Size each line to fill the frame's width (vertical: the band's height), then shrink them together to fit the band.
  b.fitters.push(() => {
    const target = vertical ? bandH * .92 : W * .9
    const sizes = lineEls.map((line) => {
      line.style.fontSize = '100px'
      const length = vertical ? line.offsetHeight : line.offsetWidth
      return clamp(target / Math.max(1, length) * 100, 24 * u, (vertical ? W * .26 : bandH * .55))
    })
    lineEls.forEach((line, i) => { line.style.fontSize = `${sizes[i]}px` })
    // Across the frame: all the lines together within the band and about a third of the frame (so the speaker's head
    // overlaps their lower part, not the middle of line 2; the engine moves and shrinks them to the head); along a side: within about a quarter of the width.
    const room = vertical ? W * .3 : Math.min(bandH * .98, H * .3)
    const need = lineEls.reduce((n, line) => n + (vertical ? line.offsetWidth : line.offsetHeight), 0)
    if (need > room) lineEls.forEach((line, i) => { line.style.fontSize = `${sizes[i] * room / need}px` })
  })

  const count = motion === 'scale' ? words.length : lines.length
  const { step, wordIn: beatIn, tout, outAt } = bigWordsTiming(spec.duration_ms, count)
  // Spoken word times: each word (reveal: each line, on its first word) starts SAID_LEAD ms before it is said
  // and is clear within ~2 frames of it; otherwise evenly spaced beats.
  const said = graphicWordTimes(spec.fields, words.length, spec.duration_ms)
  const SAID_LEAD = 70
  const wordIn = said ? 260 : beatIn
  const firstOfLine = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + l.length, 0))
  const starts = said
    ? (motion === 'scale' ? said : firstOfLine.map((k) => said[k])).map((t) => Math.max(0, t - SAID_LEAD))
    : Array.from({ length: count }, (_, i) => i * step)
  const blurMax = 18 * u
  b.onSeek.push((t) => {
    // The exit: a quick fade with a touch of growth and blur (scale) or the lines sliding on out of their masks (reveal).
    const out = clamp((t - outAt) / tout, 0, 1)
    const settled = (starts[count - 1] ?? 0) + wordIn
    const hold = clamp((t - settled) / Math.max(1, outAt - settled), 0, 1)
    const grow = 1 + .025 * inOutSine(hold) + (motion === 'scale' ? .04 * out : 0)
    drift.style.transform = `scale(${grow.toFixed(4)})`
    drift.style.opacity = motion === 'scale' ? (1 - inCubic(out)).toFixed(3) : '1'
    drift.style.filter = motion === 'scale' && out > 0 ? `blur(${(out * 10 * u).toFixed(2)}px)` : 'none'
    if (motion === 'scale') {
      words.forEach((w, i) => {
        const p = (t - starts[i]) / wordIn
        const e = outCubic(p)
        w.style.opacity = clamp(p / (said ? .5 : .45), 0, 1).toFixed(3)
        w.style.transform = `scale(${(1.08 - .08 * e).toFixed(4)})`
        w.style.filter = e < 1 ? `blur(${((1 - e) * blurMax).toFixed(2)}px)` : 'none'
      })
    } else {
      inners.forEach((inner, i) => {
        const p = outExpo((t - starts[i]) / (wordIn * 1.15))
        const away = inCubic(out)
        const shift = (1 - p) * 108 - away * 108
        inner.style.transform = vertical ? `translateX(${(vertical === 'left' ? 1 : -1) * shift}%)` : `translateY(${shift}%)`
      })
    }
  })
}
