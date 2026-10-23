/**
 * Type takeover: one key line in huge type over the whole frame, as in a launch reel's big moment. The words are
 * set in heavy condensed caps, one to three words a line, each line filling about 92% of the frame's width, stacked
 * from the top of the band to just above the captions. The engine does the depth (graphics depth "between"): the
 * room behind is darkened and blurred, the lines above the speaker's chin go behind their head and the lines below go
 * in front of their chest. The key words (`accent`) are drawn in the accent color.
 *
 * Moves: each line arrives from slight oversize (112%, its blur clearing), decelerating, as its first word is said
 * (`word_ms`) or on an even beat; the block holds still (the engine moves each line on its own) and leaves fast. Every frame comes from the
 * time alone (onSeek), so the render and the editor's scrubbing give the same pixels. Only the graphic's own words are drawn.
 */
import { graphicWordTimes, takeoverLines, type GraphicRenderSpec } from '../../shared/motion-graphics'

export interface TakeoverBuild {
  root: HTMLElement
  spec: GraphicRenderSpec
  u: number
  onSeek: ((ms: number) => void)[]
  fitters: (() => void)[]
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const outQuart = (p: number): number => 1 - Math.pow(1 - clamp(p, 0, 1), 4)
const inCubic = (p: number): number => Math.pow(clamp(p, 0, 1), 3)

function div(className: string, parent: HTMLElement, text?: string): HTMLElement {
  const node = document.createElement(text === undefined ? 'div' : 'span')
  node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}

/** Where the type sits: from the band's top to at least this share of the frame (above where captions go). */
export const TAKEOVER_BOTTOM = 0.62

const norm = (w: string): string => w.toLowerCase().replace(/[^a-z0-9$%']/g, '')

export function takeoverTemplate(b: TakeoverBuild): void {
  const { root, spec, u } = b
  const W = spec.width, H = spec.height
  const lines = takeoverLines(spec.fields.text)
  const accent = new Set((spec.fields.accent ?? '').split(/\s+/).map(norm).filter(Boolean))
  const top = spec.box.top * H, bottom = Math.max(spec.box.bottom, TAKEOVER_BOTTOM) * H
  const layer = div('mg-takeover', root)
  layer.style.top = `${top}px`
  layer.style.height = `${Math.max(1, bottom - top)}px`
  const drift = div('mg-takeover-drift', layer)
  const lineEls: HTMLElement[] = []
  lines.forEach((line) => {
    const el = div('mg-takeover-line', drift)
    line.forEach((word, k) => {
      if (k > 0) el.appendChild(document.createTextNode(' '))
      div(`mg-takeover-w${accent.has(norm(word)) ? ' accent' : ''}`, el, word)
    })
    lineEls.push(el)
  })

  // Each line fills the width; then all of them together fit the band (with a little air between lines).
  b.fitters.push(() => {
    const room = Math.max(1, bottom - top)
    const sizes = lineEls.map((line) => {
      line.style.fontSize = '100px'
      return clamp(W * .92 / Math.max(1, line.offsetWidth) * 100, 40 * u, room * .34)
    })
    lineEls.forEach((line, i) => { line.style.fontSize = `${sizes[i]}px` })
    const need = lineEls.reduce((n, line) => n + line.offsetHeight, 0) * 1.08
    if (need > room) lineEls.forEach((line, i) => { line.style.fontSize = `${sizes[i] * room / need}px` })
  })

  const duration = spec.duration_ms
  const tout = clamp(duration * .08, 140, 220), outAt = duration - tout
  const lineIn = 240
  const firstOfLine = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + l.length, 0))
  const said = graphicWordTimes(spec.fields, lines.flat().length, duration)
  const step = lines.length > 1 ? clamp(duration * .3 / (lines.length - 1), 70, 160) : 0
  // Each line starts a couple of frames before its first word is said (cut on motion) and lands on it.
  const starts = said ? firstOfLine.map((k) => Math.max(0, said[k] - 60)) : lines.map((_, i) => i * step)
  const blur = 16 * u
  b.onSeek.push((t) => {
    const out = clamp((t - outAt) / tout, 0, 1)
    // The block itself never moves or grows: the engine lays each line out on its own (around the speaker's head).
    drift.style.opacity = (1 - inCubic(out)).toFixed(3)
    lineEls.forEach((line, i) => {
      const p = (t - starts[i]) / lineIn
      const e = outQuart(p)
      line.style.opacity = clamp(p / .35, 0, 1).toFixed(3)
      line.style.transform = `scale(${(1.12 - .12 * e).toFixed(4)})`
      line.style.filter = e < 1 ? `blur(${((1 - e) * blur).toFixed(2)}px)` : 'none'
    })
  })
}
