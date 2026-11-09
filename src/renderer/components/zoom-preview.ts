/**
 * The clip editor's live preview of screen zooms (screen-zoom.ts): the screen's area drawn again from the preview
 * video, zoomed by the same math the bake uses, its rounded corners kept and the webcam card left as it is, and the
 * glowing box around what is said. Approximate (the preview video is smaller than the source); exact on Bake.
 */
import { glowAt, zoomCropAt, type ZoomArea, type ZoomMove } from '../../shared/screen-zoom'

/** A source rectangle (video pixels) and where it is drawn on the canvas. */
export interface DrawnPanel { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

/** The glow's color (the bake's: a bright green). */
export const GLOW_COLOR = 'rgb(120, 220, 80)'

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * Draw the zoom playing at `t` (source ms) over a panel already drawn from `video`. Returns whether one was drawn.
 * Pure canvas calls, so it runs every frame while the video plays.
 */
export function drawZoom(ctx: CanvasRenderingContext2D, video: CanvasImageSource & { videoWidth: number; videoHeight: number },
  zooms: readonly ZoomMove[], zoom: ZoomArea, t: number, panel: DrawnPanel): boolean {
  const move = zooms.find((m) => t > m.at_ms && t < m.end_ms && m.on !== false)
  if (!move) return false
  const [x, y, w, h] = zoomCropAt(move, t)
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return false
  const [ax, ay, aw, ah] = [zoom.area[0] * vw, zoom.area[1] * vh, zoom.area[2] * vw, zoom.area[3] * vh]
  // Source pixels to canvas pixels (through the panel's crop).
  const kx = panel.dw / panel.sw, ky = panel.dh / panel.sh
  const map = (px: number, py: number): [number, number] => [panel.dx + (px - panel.sx) * kx, panel.dy + (py - panel.sy) * ky]
  const [cx0, cy0] = map(ax, ay), [cx1, cy1] = map(ax + aw, ay + ah)
  const radius = (zoom.radius ?? 0) * (cy1 - cy0)
  ctx.save()
  roundedRect(ctx, cx0, cy0, cx1 - cx0, cy1 - cy0, radius)
  ctx.clip()
  if (w < .9999) ctx.drawImage(video, ax + x * aw, ay + y * ah, w * aw, h * ah, cx0, cy0, cx1 - cx0, cy1 - cy0)
  const strength = glowAt(move, t)
  if (strength > 0 && move.glow) {
    const [gx, gy, gw, gh] = move.glow.box
    const bx0 = cx0 + (gx - x) / w * (cx1 - cx0), by0 = cy0 + (gy - y) / h * (cy1 - cy0)
    const bx1 = cx0 + (gx + gw - x) / w * (cx1 - cx0), by1 = cy0 + (gy + gh - y) / h * (cy1 - cy0)
    const pad = Math.max(3, (by1 - by0) * .22)
    ctx.globalAlpha = strength
    ctx.strokeStyle = GLOW_COLOR; ctx.lineWidth = Math.max(1.5, (by1 - by0) * .06)
    ctx.shadowColor = GLOW_COLOR; ctx.shadowBlur = Math.max(6, (by1 - by0) * .5)
    roundedRect(ctx, bx0 - pad, by0 - pad, bx1 - bx0 + 2 * pad, by1 - by0 + 2 * pad, (by1 - by0) * .25)
    ctx.stroke()
  }
  ctx.restore()
  // The webcam card over the screen stays as it is.
  if (zoom.keep && w < .9999) {
    const [kx0, ky0, kw, kh] = [zoom.keep[0] * vw, zoom.keep[1] * vh, zoom.keep[2] * vw, zoom.keep[3] * vh]
    const ring = 8 * vh / 1080
    const [dx0, dy0] = map(kx0 - ring, ky0 - ring), [dx1, dy1] = map(kx0 + kw + ring, ky0 + kh + ring)
    ctx.drawImage(video, kx0 - ring, ky0 - ring, kw + 2 * ring, kh + 2 * ring, dx0, dy0, dx1 - dx0, dy1 - dy0)
  }
  return true
}
