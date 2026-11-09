/**
 * The offscreen render page: main loads it in a sandboxed, transparent,
 * offscreen window and drives it with `__graphic.load(spec)` then
 * `__graphic.frame(ms)` for each frame, capturing the page after each one.
 */
import { mountGraphic, type MountedGraphic } from './templates'
import type { GraphicRenderSpec } from '../../shared/motion-graphics'

let mounted: MountedGraphic | null = null
const host = document.getElementById('graphic')!
const painted = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

declare global { interface Window { __graphic: { load: (spec: GraphicRenderSpec) => Promise<boolean>; frame: (ms: number) => Promise<boolean> } } }

window.__graphic = {
  async load(spec) {
    mounted?.destroy()
    host.replaceChildren()
    mounted = mountGraphic(host, spec)
    await mounted.ready
    await painted()
    return true
  },
  async frame(ms) {
    if (!mounted) return false
    mounted.seek(ms)
    await painted()
    return true
  }
}
