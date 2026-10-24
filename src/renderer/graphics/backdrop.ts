/**
 * A full-screen brand card's backdrop (YouTube videos: longform.ts): the brand color as a deep gradient with a soft
 * glow, a faint grid and the brand's logo (or handle) as a large faint watermark, under the graphic's own drawing.
 * It cuts in with the graphic (a short fade and a slow push), holds and fades out at its end. Drawn by time like the
 * templates: the same `ms` gives the same pixels in the editor and the bake.
 */
import type { GraphicRenderSpec } from '../../shared/motion-graphics'

export const BACKDROP_IN_MS = 180
export const BACKDROP_OUT_MS = 220

function hex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color)
  const n = m ? parseInt(m[1], 16) : 0x2f5bff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(color: string, to: [number, number, number], t: number): string {
  const [r, g, b] = hex(color)
  return `rgb(${Math.round(r + (to[0] - r) * t)}, ${Math.round(g + (to[1] - g) * t)}, ${Math.round(b + (to[2] - b) * t)})`
}

/** How visible the backdrop is `ms` into a card `duration` long (0..1), and its push-in scale. */
export function backdropAt(ms: number, duration: number): { opacity: number; scale: number } {
  if (ms < 0 || ms >= duration) return { opacity: 0, scale: 1 }
  const fadeIn = Math.min(1, ms / BACKDROP_IN_MS), fadeOut = Math.min(1, (duration - ms) / BACKDROP_OUT_MS)
  const ease = (x: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3)
  return { opacity: Math.round(ease(Math.min(fadeIn, fadeOut)) * 1000) / 1000, scale: 1.06 - 0.06 * ease(ms / Math.max(1, duration)) }
}

export function mountBackdrop(host: HTMLElement, spec: GraphicRenderSpec): { seek: (ms: number) => void; destroy: () => void } {
  const back = spec.backdrop!
  const W = spec.width, H = spec.height
  const root = document.createElement('div')
  Object.assign(root.style, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${H}px`, overflow: 'hidden', pointerEvents: 'none' })
  const layer = document.createElement('div')
  Object.assign(layer.style, {
    position: 'absolute', inset: '0', transformOrigin: '50% 50%',
    background: `radial-gradient(120% 90% at 18% 12%, ${mix(back.color, [255, 255, 255], .12)} 0%, ${mix(back.color, [0, 0, 0], .18)} 38%, ${mix(back.color, [6, 8, 20], .72)} 100%)`
  })
  root.appendChild(layer)
  // A faint grid and a soft vignette: depth without noise.
  const grid = document.createElement('div')
  const step = Math.round(Math.min(W, H) / 9)
  Object.assign(grid.style, {
    position: 'absolute', inset: '0', opacity: '0.07',
    backgroundImage: `linear-gradient(rgba(255,255,255,.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.9) 1px, transparent 1px)`,
    backgroundSize: `${step}px ${step}px`, maskImage: 'radial-gradient(70% 70% at 50% 45%, #000 0%, transparent 100%)',
    webkitMaskImage: 'radial-gradient(70% 70% at 50% 45%, #000 0%, transparent 100%)'
  })
  layer.appendChild(grid)
  const vignette = document.createElement('div')
  Object.assign(vignette.style, { position: 'absolute', inset: '0', background: 'radial-gradient(90% 80% at 50% 50%, transparent 55%, rgba(0,0,0,.35) 100%)' })
  layer.appendChild(vignette)
  // The watermark: the brand's logo (or its handle), large and faint in the lower right.
  if (back.logo) {
    const img = document.createElement('img')
    img.src = back.logo
    img.alt = ''
    Object.assign(img.style, { position: 'absolute', right: `${Math.round(W * .04)}px`, bottom: `${Math.round(H * .06)}px`, height: `${Math.round(H * .34)}px`,
      width: 'auto', opacity: '0.08', filter: 'grayscale(1) brightness(3)' })
    layer.appendChild(img)
  } else if (back.mark) {
    const text = document.createElement('div')
    text.textContent = back.mark
    Object.assign(text.style, { position: 'absolute', right: `${Math.round(W * .04)}px`, bottom: `${Math.round(H * .05)}px`, font: `800 ${Math.round(H * .085)}px/1 Inter, system-ui, sans-serif`,
      color: 'rgba(255,255,255,.07)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' })
    layer.appendChild(text)
  }
  host.insertBefore(root, host.firstChild)
  const seek = (ms: number): void => {
    const { opacity, scale } = backdropAt(ms, spec.duration_ms)
    root.style.visibility = opacity > 0 ? 'visible' : 'hidden'
    root.style.opacity = String(opacity)
    layer.style.transform = `scale(${scale})`
  }
  seek(0)
  return { seek, destroy: () => root.remove() }
}
