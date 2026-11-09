/**
 * The render path's last check (shared/graphic-safe-area.ts): what a mounted graphic paints, measured on the page as
 * drawn (every transform applied, effects' shadow roots included), and whether any words are cut off inside it by a
 * box that clips them.
 */
import type { SafeRect } from '../../shared/graphic-safe-area'

const NONE = 'rgba(0, 0, 0, 0)'
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'image', 'use'])
const SKIP = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'filter'])
type Clip = { l: number; t: number; r: number; b: number }

export interface Paint {
  /** The painted area (client pixels of the page), or null when nothing is drawn. */
  box: SafeRect | null
  /** Words partly hidden by a box that clips them (more than a sliver of a word cut off). */
  clipped: boolean
}

/** What `root` paints right now: the union of its visible words, pictures, shapes and filled or bordered boxes. */
export function paintOf(root: Element): Paint {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  let clipped = false
  const shownShare = (r: DOMRect, clip: Clip): number => {
    const w = Math.min(r.right, clip.r) - Math.max(r.left, clip.l), h = Math.min(r.bottom, clip.b) - Math.max(r.top, clip.t)
    return w > 0 && h > 0 ? (w * h) / Math.max(1e-6, r.width * r.height) : 0
  }
  const add = (r: DOMRect, clip: Clip): void => {
    if (r.width < .5 || r.height < .5) return
    const l = Math.max(r.left, clip.l), t = Math.max(r.top, clip.t), rr = Math.min(r.right, clip.r), b = Math.min(r.bottom, clip.b)
    if (rr - l < .5 || b - t < .5) return
    x0 = Math.min(x0, l); y0 = Math.min(y0, t); x1 = Math.max(x1, rr); y1 = Math.max(y1, b)
  }
  const visit = (el: Element, clip: Clip, opacity: number): void => {
    if (SKIP.has(el.tagName)) return
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return
    const alpha = opacity * (parseFloat(cs.opacity) || 0)
    if (alpha < .05) return
    const rect = el.getBoundingClientRect()
    const svg = el instanceof SVGElement
    if (cs.visibility !== 'hidden') {
      const tag = el.tagName.toLowerCase()
      if (svg ? SHAPES.has(tag) : tag === 'img' || tag === 'canvas' || tag === 'video'
        || cs.backgroundColor !== NONE || cs.backgroundImage !== 'none' || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor !== NONE && cs.borderTopStyle !== 'none')) add(rect, clip)
      // A card's soft shadow paints too (about a third of its blur past the card, where it is still visible), with its offset.
      if (!svg && cs.boxShadow && cs.boxShadow !== 'none') {
        const k = rect.width / Math.max(1, (el as HTMLElement).offsetWidth || rect.width)
        for (const shadow of cs.boxShadow.split(/,(?![^(]*\))/)) {
          if (/inset/.test(shadow) || /rgba\([^)]*,\s*0\)/.test(shadow)) continue
          const [x = 0, y = 0, blur = 0, spread = 0] = (shadow.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g) ?? []).map((v) => parseFloat(v) * k)
          const reach = blur * 0.3 + spread
          if (reach > 0 || x || y) add(new DOMRect(rect.left + x - reach, rect.top + y - reach, rect.width + 2 * reach, rect.height + 2 * reach), clip)
        }
      }
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim() || (svg && tag !== 'text')) continue
        const range = document.createRange(); range.selectNodeContents(node)
        const rects = [...range.getClientRects()]
        for (const r of rects) add(r, clip)
        // Words cut off: a word whose width is 12-88% hidden by a box that clips it, or more than 40% of its height (a
        // word's box is its font's full em, taller than its letters: a little of it past a tight box hides nothing). A
        // word fully outside its box is a line waiting off its mask; a digit just peeking past an odometer is a sliver.
        if (!clipped && rects.some((r) => shownShare(r, clip) < .999)) {
          for (const m of (node.textContent ?? '').matchAll(/\S+/g)) {
            const word = document.createRange(); word.setStart(node, m.index); word.setEnd(node, m.index + m[0].length)
            const r = word.getBoundingClientRect()
            if (r.width < .5 || r.height < .5) continue
            const across = (Math.min(r.right, clip.r) - Math.max(r.left, clip.l)) / r.width
            const down = (Math.min(r.bottom, clip.b) - Math.max(r.top, clip.t)) / r.height
            if (across <= 0 || down <= 0) continue
            if ((across > .12 && across < .88) || (across >= .88 && down > .12 && down < .6)) { clipped = true; break }
          }
        }
      }
    }
    if (!svg && el.classList.contains('fx-glass')) {
      // An effect's glass is drawn by ::before, inset from its stage (stage pixels, before the stage's scale).
      const inset = cs.getPropertyValue('--fx-glass-inset').trim().split(/\s+/).map((v) => parseFloat(v))
      const k = rect.width / Math.max(1, (el as HTMLElement).offsetWidth)
      if (inset.length === 4 && inset.every(Number.isFinite)) {
        const [t, r, b, l] = inset
        add(new DOMRect(rect.left + l * k, rect.top + t * k, rect.width - (l + r) * k, rect.height - (t + b) * k), clip)
      }
    }
    const clips = !svg && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')
    const inner = clips ? { l: Math.max(clip.l, rect.left), t: Math.max(clip.t, rect.top), r: Math.min(clip.r, rect.right), b: Math.min(clip.b, rect.bottom) } : clip
    for (const child of el.children) visit(child, inner, alpha)
    if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child, inner, alpha)
  }
  visit(root, { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity }, 1)
  return { box: x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null, clipped }
}

/** Union of two painted areas. */
export function unionRect(a: SafeRect | null, b: SafeRect | null): SafeRect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
