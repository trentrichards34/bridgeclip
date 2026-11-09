/**
 * Make my cover: draws a cover on a canvas from a picked frame and its words (the layouts are shared/covers.ts), and
 * turns it into JPG or PNG bytes. The frame comes as bytes (an ImageBitmap), so the canvas can be saved.
 */
import {
  COVER_FONTS, reelCoverLayout, youtubeCoverLayout, type CoverExtension, type CoverFormat, type CoverFrame
} from '../../shared/covers'
import { DEFAULT_HEADLINE_LOOK, HEADLINE_FONTS, HIGHLIGHT, type HeadlineLook } from '../../shared/headline-look'

export async function frameBitmap(data: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }))
}

function leadFont(look: HeadlineLook | null): (typeof HEADLINE_FONTS)[number] {
  return HEADLINE_FONTS.find((f) => f.id === (look ?? DEFAULT_HEADLINE_LOOK).font) ?? HEADLINE_FONTS[0]
}

/** Waits for the cover's fonts, so the words are measured and drawn in them. */
export async function coverFontsReady(look: HeadlineLook | null): Promise<void> {
  const font = leadFont(look)
  const fonts = [`${font.weight ?? 400} 80px ${font.family}`, `italic 400 80px ${COVER_FONTS.phrase}`, `400 80px ${COVER_FONTS.thumb}`]
  try { await Promise.all(fonts.map((f) => document.fonts.load(f))) } catch { /* the fallback faces */ }
}

/** Draws the cover (canvas resized to the cover's size). */
export function drawCover(canvas: HTMLCanvasElement, format: CoverFormat, bitmap: ImageBitmap, frame: CoverFrame, text: string, look: HeadlineLook | null): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (format === 'reel') drawReel(canvas, ctx, bitmap, frame, text, look)
  else drawYouTube(canvas, ctx, bitmap, frame, text, look)
}

function drawReel(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, frame: CoverFrame, text: string, look: HeadlineLook | null): void {
  const font = leadFont(look)
  const shown = font.upper ? text.toUpperCase() : text
  const css = (size: number, phrase: boolean): string => phrase
    ? `italic 400 ${size * HIGHLIGHT.phraseScale}px ${COVER_FONTS.phrase}` : `${font.weight ?? 400} ${size * (font.scale ?? 1)}px ${font.family}`
  const measure = (line: string, size: number, phrase: boolean): number => { ctx.font = css(size, phrase); return ctx.measureText(line).width }
  const layout = reelCoverLayout(bitmap.width, bitmap.height, frame.face, shown, measure, look)
  canvas.width = layout.width; canvas.height = layout.height
  ctx.save()
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.filter = 'contrast(1.06) saturate(1.08)'
  ctx.drawImage(bitmap, layout.image.x, layout.image.y, layout.image.width, layout.image.height)
  ctx.restore()
  if (!shown.trim()) return
  ctx.save()
  ctx.translate(0, layout.hook.offsetY)
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6
  if (layout.hook.leadPath) { ctx.fillStyle = layout.colors.leadBg; ctx.fill(new Path2D(layout.hook.leadPath)) }
  if (layout.hook.phrasePath) { ctx.fillStyle = layout.colors.phraseBg; ctx.fill(new Path2D(layout.hook.phrasePath)) }
  ctx.shadowColor = 'transparent'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const line of layout.hook.lines) {
    ctx.font = css(layout.hook.size, line.phrase)
    ctx.fillStyle = line.phrase ? layout.colors.phraseInk : layout.colors.leadInk
    ctx.fillText(line.text, layout.width / 2, line.center + layout.hook.size * (line.phrase ? 0.02 : 0.04))
  }
  ctx.restore()
}

function drawYouTube(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, frame: CoverFrame, text: string, look: HeadlineLook | null): void {
  const css = (size: number): string => `400 ${size}px ${COVER_FONTS.thumb}`
  const measure = (line: string, size: number): number => { ctx.font = css(size); return ctx.measureText(line).width }
  const layout = youtubeCoverLayout(bitmap.width, bitmap.height, frame.face, text, measure, look)
  const { width: W, height: H } = layout
  canvas.width = W; canvas.height = H
  ctx.save()
  ctx.fillStyle = '#0B0D12'; ctx.fillRect(0, 0, W, H)
  if (layout.backdrop) {
    // A 9:16 frame: a blurred, darkened copy of it fills the thumbnail behind it.
    const s = Math.max(W / bitmap.width, H / bitmap.height)
    ctx.filter = 'blur(28px) brightness(0.5) saturate(1.2)'
    ctx.drawImage(bitmap, (W - bitmap.width * s) / 2, (H - bitmap.height * s) / 2, bitmap.width * s, bitmap.height * s)
  }
  ctx.filter = 'contrast(1.12) saturate(1.2)'
  ctx.drawImage(bitmap, layout.image.x, layout.image.y, layout.image.width, layout.image.height)
  ctx.filter = 'none'
  // The words' side darkened, so white words read at a glance.
  const g = layout.side === 'left' ? ctx.createLinearGradient(0, 0, layout.shade.to, 0) : ctx.createLinearGradient(W, 0, layout.shade.from, 0)
  g.addColorStop(0, 'rgba(5,7,12,0.88)'); g.addColorStop(0.55, 'rgba(5,7,12,0.62)'); g.addColorStop(1, 'rgba(5,7,12,0)')
  ctx.fillStyle = g
  ctx.fillRect(layout.side === 'left' ? 0 : layout.shade.from, 0, layout.shade.to - layout.shade.from, H)
  // A thin bar of the brand color along the words' edge.
  ctx.fillStyle = layout.accent
  ctx.fillRect(layout.side === 'left' ? 0 : W - Math.round(W * 0.012), 0, Math.round(W * 0.012), H)
  ctx.restore()
  ctx.save()
  ctx.textBaseline = 'top'; ctx.textAlign = 'left'
  for (const line of layout.lines) {
    ctx.font = css(line.size)
    if (line.key) {
      const padX = line.size * 0.14, padY = line.size * 0.06
      ctx.fillStyle = layout.accent
      ctx.beginPath()
      ctx.roundRect(line.x - padX, line.y - padY, line.width + 2 * padX, line.size * 1.02 + 2 * padY, line.size * 0.12)
      ctx.fill()
      ctx.fillStyle = layout.accentInk
      ctx.fillText(line.text, line.x, line.y + line.size * 0.04)
    } else {
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, line.size * 0.09); ctx.strokeStyle = '#05070C'
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = line.size * 0.18; ctx.shadowOffsetY = line.size * 0.04
      ctx.strokeText(line.text, line.x, line.y + line.size * 0.04)
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(line.text, line.x, line.y + line.size * 0.04)
    }
  }
  ctx.restore()
}

/** The canvas as JPG (quality 0.92) or PNG bytes. */
export function coverBytes(canvas: HTMLCanvasElement, ext: CoverExtension): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Couldn’t make the image.')); return }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, ext === 'jpg' ? 'image/jpeg' : 'image/png', 0.92)
  })
}
