import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { BrandIdentity } from '../../shared/remix'
import { DEFAULT_HANDLE_POSITION, hasBrandMark } from '../../shared/brand-kit'
import {
  HEADLINE_ACCENT_SCALE, HEADLINE_FONTS, HIGHLIGHT, HIGHLIGHT_PHRASE_FAMILY, accentWordIndex, headlineBarColor, headlineTextBox, headlineTextColor, highlightColors,
  highlightPlacement, isHexColor, textBoxOutline, textBoxPath, textBoxRects, TEXT_BOX, wrapHeadline, FLOATING_FONT_SIZES, type HeadlineLook
} from '../../shared/headline-look'
import type { LookExtraId } from '../../shared/look-extras'
import {
  BAR_HOOKS, CAPTION_Y, ENGINE_CAPTIONS, FRAME_H, FRAME_W, HEADLINE, KEYWORD_TAG, MARK, captionEm, captionsBottom, markPosition,
  type BoardRows, type BoardStyle
} from '../lib/style-board'
import { localFileUrl } from '../lib/utils'
import { captionPreviewPreset, type CaptionPreset } from './CaptionPresetPicker'

/** The member's own frame behind the preview: a still image, or a video seeked to a representative moment. */
export interface StyleFrame { kind: 'video' | 'image'; src: string; seek?: number }

export const SAMPLE_HOOK = 'This is how your hook text looks on every video'
export const SAMPLE_WORDS = ['This', 'is', 'how', 'your', 'captions', 'come', 'to', 'life']
/** The sample line's punch word, drawn in the preset's emphasis color like the planner's picks. */
export const SAMPLE_EMPHASIS = 4
export const WORD_MS = 450
/** With reduced motion (or paused at first), the line holds on the punch word. */
export const STILL_MS = SAMPLE_EMPHASIS * WORD_MS + 225
export const LINGER_MS = 1300
/** "Comment KEYWORD" shows for the last stretch of the loop, as it does for a video's last 4 seconds. */
export const TAG_MS = 2800
/** The keyword pill's color (the reels' blue). */
export const PILL_COLOR = '#2F6BFF'
/** A stand-in keyword for the comment box when the page has none. */
const SAMPLE_KEYWORD = 'INFO'
// Strokes the engine draws in a dark color other than black.
const OUTLINE: Record<string, string> = { retro: '#2B1300', vintage: '#1E120A' }

export function ring(width: number, color: string): string[] {
  if (width <= 0) return []
  const layers: string[] = []
  for (let a = 0; a < 16; a++) {
    const r = (a / 16) * Math.PI * 2
    layers.push(`${(Math.cos(r) * width).toFixed(2)}px ${(Math.sin(r) * width).toFixed(2)}px 0 ${color}`)
  }
  return layers
}

function captionShadow(preset: CaptionPreset, u: number, extra: string[] = []): string {
  const layers = ring(preset.stroke * u, OUTLINE[preset.id] ?? '#000')
  if (preset.shadow === 'soft') layers.push(`0 ${(7 * u).toFixed(2)}px ${(10 * u).toFixed(2)}px rgb(0 0 0 / 0.6)`)
  if (preset.shadow === 'hard') layers.push(`0 ${(10 * u).toFixed(2)}px 0 rgb(0 0 0 / 0.9)`)
  if (preset.shadow === 'halo') layers.push(`0 0 ${(10 * u).toFixed(2)}px rgb(0 0 0 / 0.85)`, `0 0 ${(4 * u).toFixed(2)}px rgb(0 0 0 / 0.6)`)
  return [...layers, ...extra].join(', ') || 'none'
}

/** The word to emphasize in the member's own words (none chosen by the planner yet): the longest. */
export function emphasisOf(words: readonly string[]): number {
  let best = 0
  words.forEach((word, i) => { if (word.length > words[best].length) best = i })
  return best
}

/** A neutral stand-in frame: a dim studio backdrop with a speaker's silhouette. */
export function Placeholder(): React.JSX.Element {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-slate-500 via-slate-700 to-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgb(255_255_255/0.22),transparent_58%)]" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" className="absolute inset-x-0 bottom-0 h-[70%] w-full text-black/25">
        <circle cx="50" cy="40" r="15" fill="currentColor" />
        <path d="M18 100 C20 72 34 60 50 60 C66 60 80 72 82 100 Z" fill="currentColor" />
      </svg>
    </div>
  )
}

function frameSrc(frame: StyleFrame): string {
  return frame.src.startsWith('https://') ? frame.src : localFileUrl(frame.src)
}

/** The live preview's frame: the image, or the video itself seeked to its moment. */
export function Frame({ frame }: { frame: StyleFrame | null }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [frame?.src])
  if (!frame || failed) return <Placeholder />
  const src = frameSrc(frame)
  return frame.kind === 'image'
    ? <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
    : <video src={src} muted playsInline preload="auto" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover"
      onLoadedMetadata={(e) => {
        const seconds = e.currentTarget.duration
        // Not a #t= fragment: the local-file protocol would treat it as part of the path.
        if (Number.isFinite(seconds) && seconds > 0) e.currentTarget.currentTime = Math.min(frame.seek ?? 2, seconds / 2)
      }} />
}

// ---------------------------------------------------------------------------
// One still of a video for every tile: decoded once, drawn into each tile's canvas.
// ---------------------------------------------------------------------------

const STILL_WIDTH = 270
const stills = new Map<string, Promise<HTMLCanvasElement | null>>()

/** A small still of the video at its moment (cached per file and moment; null when it can't be read). */
export function videoStill(frame: StyleFrame): Promise<HTMLCanvasElement | null> {
  const key = `${frame.src}#${frame.seek ?? ''}`
  const cached = stills.get(key)
  if (cached) return cached
  const promise = new Promise<HTMLCanvasElement | null>((resolve) => {
    if (typeof document === 'undefined') { resolve(null); return }
    const video = document.createElement('video')
    let settled = false
    const finish = (canvas: HTMLCanvasElement | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(canvas)
    }
    const timer = setTimeout(() => finish(null), 15000)
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.onerror = () => finish(null)
    video.onloadedmetadata = () => {
      const seconds = video.duration
      video.currentTime = Number.isFinite(seconds) && seconds > 0 ? Math.min(frame.seek ?? 2, seconds / 2) : 0
    }
    video.onseeked = () => {
      const w = video.videoWidth, h = video.videoHeight
      if (!w || !h) { finish(null); return }
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(STILL_WIDTH, w)
      canvas.height = Math.round(canvas.width * h / w)
      try { canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height); finish(canvas) } catch { finish(null) }
    }
    video.src = frameSrc(frame)
  })
  stills.set(key, promise)
  // A failed read can be tried again later (the file may have been busy).
  void promise.then((canvas) => { if (!canvas) stills.delete(key) })
  return promise
}

/** A tile's frame: the image (decoded once by the browser for every tile), or a copy of the video's still. */
export const FrameStill = memo(function FrameStill({ frame }: { frame: StyleFrame | null }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    if (!frame || frame.kind !== 'video') return
    let live = true
    setState('loading')
    void videoStill(frame).then((still) => {
      if (!live) return
      const canvas = canvasRef.current
      if (!still || !canvas) { setState('failed'); return }
      canvas.width = still.width
      canvas.height = still.height
      canvas.getContext('2d')?.drawImage(still, 0, 0)
      setState('ready')
    })
    return () => { live = false }
  }, [frame?.kind, frame?.src, frame?.seek])
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => { setImageFailed(false) }, [frame?.src])
  if (!frame || (frame.kind === 'image' && imageFailed) || (frame.kind === 'video' && state === 'failed')) return <Placeholder />
  if (frame.kind === 'image') {
    return <img src={frameSrc(frame)} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
  }
  return (
    <>
      {state !== 'ready' && <Placeholder />}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />
    </>
  )
})

/** True once the element has come near the screen (rendering tiles only when they're about to be seen). */
export function useNearScreen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near) return
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect() }
    }, { rootMargin: '240px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])
  return [ref, near]
}

// ---------------------------------------------------------------------------
// The caption line and the drawing shared by the live preview and the tiles.
// ---------------------------------------------------------------------------

/** The caption line at a moment of the loop, drawn the way the engine's ASS layers are. */
function CaptionLine({ presetId, words, emphasis, time, u, pill, accent }: {
  presetId: string; words: string[]; emphasis: number; time: number; u: number
  /** Extras: the word in the keyword pill, and the word in an italic serif (-1 for none). */
  pill: number; accent: number
}): React.JSX.Element | null {
  const preset = captionPreviewPreset(presetId)
  const engine = ENGINE_CAPTIONS[preset.id] ?? ENGINE_CAPTIONS.pop
  const speech = words.length * WORD_MS
  if (time >= speech + LINGER_MS / 2) return null
  const active = Math.min(Math.floor(time / WORD_MS), words.length - 1)
  const groupSize = preset.maxWords ?? 3
  const groupStart = Math.floor(active / groupSize) * groupSize
  const groupTime = time - groupStart * WORD_MS
  const progress = Math.min(1, (time - active * WORD_MS) / WORD_MS)
  const pop = preset.entrancePop !== false && groupTime < 170
    ? groupTime < 90 ? 0.82 + 0.24 * groupTime / 90 : 1.06 - 0.06 * (groupTime - 90) / 80
    : 1
  const em = captionEm(preset.id) * u
  const shadow = captionShadow(preset, u)
  const base: CSSProperties = {
    color: preset.primary, fontFamily: preset.font, fontWeight: preset.weight, fontStyle: preset.italic ? 'italic' : 'normal',
    fontSize: em, lineHeight: 1.12, textShadow: shadow, textTransform: preset.uppercase ? 'uppercase' : 'none', transform: `scale(${pop})`
  }
  return (
    <span className="inline-flex flex-wrap items-baseline justify-center gap-x-[0.28em]" data-caption-preset={preset.id}
      style={{ ...base, background: preset.plate, borderRadius: preset.plate ? 16 * u : undefined, padding: preset.plate ? `${10 * u}px ${22 * u}px` : undefined }}>
      {words.slice(groupStart, groupStart + groupSize).map((word, offset) => {
        const index = groupStart + offset
        const state = index === active ? 'active' : index < active ? 'past' : 'future'
        const punch = index === emphasis && engine.emphasis ? engine.emphasis : null
        const style: CSSProperties = {
          visibility: state === 'future' && preset.future === 'hide' && !preset.karaoke ? 'hidden' : undefined,
          opacity: state === 'future' && (preset.future === 'dim' || preset.karaoke) ? preset.dimOpacity ?? 0.55 : 1,
          padding: preset.pill ? `0 ${10 * u}px` : undefined,
          borderRadius: 12 * u,
          color: punch ?? undefined
        }
        if (preset.karaoke) {
          if (state === 'past') style.color = punch ?? preset.highlight
        } else if (state === 'active') {
          const lit = punch ?? preset.highlight
          style.color = preset.colorTransition ? `color-mix(in srgb, ${lit} ${Math.min(1, progress / 0.3) * 100}%, ${preset.primary})` : lit
          if (preset.pill) { style.background = preset.pill; style.textShadow = 'none' }
          if (preset.glow) style.textShadow = captionShadow(preset, u, [`0 0 ${12 * u}px ${preset.glow}`, `0 0 ${28 * u}px ${preset.glow}`])
        }
        if (index === accent) {
          // Accent words: an italic serif, lowercase, a little bigger.
          Object.assign(style, { fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontWeight: 400, textTransform: 'none', fontSize: '1.15em' })
        }
        if (index === pill && state !== 'future') {
          Object.assign(style, { background: PILL_COLOR, color: '#FFFFFF', textShadow: 'none', padding: `0 ${14 * u}px`, borderRadius: 18 * u, visibility: undefined, opacity: 1 })
        }
        return (
          <span key={index} data-caption-state={state} data-extra={index === pill ? 'pill' : index === accent ? 'accent' : undefined}
            className="relative inline-block whitespace-nowrap" style={style}>
            {index === accent ? word.toLowerCase() : word}
            {preset.karaoke && state === 'active' && index !== pill && (
              <span aria-hidden className="absolute inset-0" style={{ color: punch ?? preset.highlight, opacity: 1, clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`, padding: style.padding }}>{word}</span>
            )}
          </span>
        )
      })}
    </span>
  )
}

/** The hook text, with the accent word in the italic serif for the "Sans + italic serif" font. */
function HookText({ text, accent, style }: { text: string; accent?: string; style: CSSProperties }): React.JSX.Element {
  if (!accent) return <span style={style}>{text}</span>
  const words = text.split(' ')
  const at = accentWordIndex(words)
  return (
    <span style={style}>
      {words.map((word, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {i === at ? <span data-hook-accent style={{ fontFamily: accent, fontStyle: 'italic', fontWeight: 400, fontSize: `${HEADLINE_ACCENT_SCALE}em`, lineHeight: 0.9 }}>{word}</span> : word}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Floating text on a box (Instagram's text background), placed the way the engine places it.
// ---------------------------------------------------------------------------

let measureCanvas: CanvasRenderingContext2D | null | undefined
/** A line's width in pixels at this CSS font (an estimate where there is no canvas, as in tests). */
function measureLine(text: string, css: string, size: number): number {
  if (measureCanvas === undefined) {
    try { measureCanvas = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d') } catch { measureCanvas = null }
  }
  if (!measureCanvas) return text.length * size * 0.56
  measureCanvas.font = css
  return measureCanvas.measureText(text).width
}

/** Re-renders once the page's fonts have loaded (measurements before that use a fallback font). */
function useFontsReady(): number {
  const [ready, setReady] = useState(0)
  useEffect(() => {
    let live = true
    const fonts = typeof document === 'undefined' ? undefined : (document as Document & { fonts?: FontFaceSet }).fonts
    void fonts?.ready.then(() => { if (live) setReady((n) => n + 1) })
    return () => { live = false }
  }, [])
  return ready
}

export interface BoxedLine { text: string; words: { text: string; accent: boolean; width: number }[]; width: number; center: number }

/**
 * Where floating text on a box goes, in 1080x1920 frame pixels: the engine's
 * wrap and size (wrapHeadline), each line centered, and the outline of the
 * boxes behind them (textBoxOutline). `scale` draws everything bigger (tiles).
 */
export function boxedHookLayout(text: string, fontId: HeadlineLook['font'], frameW: number, frameH: number, scale = 1,
  measure: (line: string, css: string, size: number) => number = measureLine): { size: number; lineH: number; lines: BoxedLine[]; path: string; height: number } {
  const font = HEADLINE_FONTS.find((item) => item.id === fontId) ?? HEADLINE_FONTS[0]
  const words = (font.upper ? text.toUpperCase() : text).split(/\s+/).filter(Boolean)
  const accentAt = font.accent ? accentWordIndex(words) : -1
  const css = (size: number, accent = false): string => accent ? `italic 400 ${size * HEADLINE_ACCENT_SCALE}px ${font.accent}` : `${font.weight ?? 400} ${size}px ${font.family}`
  // Word widths per size, so the wrap and the boxes measure the accent word in its own face.
  const lineWidth = (line: string, size: number, first: number): number => {
    const parts = line.split(' ')
    if (!font.accent) return measure(line, css(size), size)
    return parts.reduce((sum, word, i) => sum + measure(word, css(size, first + i === accentAt), size), 0) + measure(' ', css(size), size) * (parts.length - 1)
  }
  // Floating text on a box: at least the engine's floating sizes (a saved small label still reads on a phone).
  const sizes = FLOATING_FONT_SIZES.map((size) => size * (font.scale ?? 1) * scale)
  const maxW = frameW - 2 * Math.round(frameW * HEADLINE.padX)
  // The wrap measures whole lines in the base face (as the engine's _headline_lines does).
  const { size, lines } = wrapHeadline(words.join(' '), (line, at) => measure(line, css(at), at), maxW, sizes)
  const lineH = Math.round(size * 1.22)
  const top = Math.round(frameH * HEADLINE.topSafe)
  const padY = Math.round(frameH * HEADLINE.padY)
  const textH = lineH * lines.length
  const height = Math.min(Math.max(top + 2 * padY + textH, frameH * HEADLINE.minH), frameH * HEADLINE.maxH)
  const y = top + Math.max(0, Math.floor((height - top - textH) / 2))
  let first = 0
  const placed: BoxedLine[] = lines.map((line, i) => {
    const parts = line.split(' ')
    const out = {
      text: line,
      words: parts.map((word, j) => ({ text: word, accent: first + j === accentAt, width: measure(word, css(size, first + j === accentAt), size) })),
      width: lineWidth(line, size, first),
      // The middle of the line: the engine centers the box on ascent + descent, about a line's height for these fonts.
      center: y + i * lineH + lineH / 2
    }
    first += parts.length
    return out
  })
  const rects = textBoxRects(placed.map((line) => line.width), placed.map((line) => line.center), lineH, frameW, size)
  const radius = size * TEXT_BOX.radius
  return { size, lineH, lines: placed, path: textBoxPath(textBoxOutline(rects, radius, radius)), height }
}

/** Floating hook text with a box behind each line (the engine's drawing, as an SVG behind the lines). */
function BoxedHook({ text, look, u, scale, frameW, frameH }: { text: string; look: HeadlineLook; u: number; scale: number; frameW: number; frameH: number }): React.JSX.Element | null {
  const ready = useFontsReady()
  const box = headlineTextBox(look)
  const font = HEADLINE_FONTS.find((item) => item.id === look.font) ?? HEADLINE_FONTS[0]
  const layout = useMemo(() => boxedHookLayout(text, look.font, frameW, frameH, scale), [text, look.font, frameW, frameH, scale, ready])
  if (!box) return null
  const color = headlineTextColor(look)
  return (
    <div data-testid="hook-text-box" data-text-bg={look.textBg} className="absolute inset-x-0 top-0" style={{ height: layout.height * u }}>
      <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox={`0 0 ${frameW} ${layout.height}`} preserveAspectRatio="none">
        <path d={layout.path} fill={box.color} fillOpacity={box.opacity} />
      </svg>
      {layout.lines.map((line, i) => (
        <div key={i} data-hook-line className="absolute inset-x-0 flex justify-center whitespace-nowrap"
          style={{ top: (line.center - layout.lineH / 2) * u, height: layout.lineH * u, lineHeight: `${layout.lineH * u}px`, color,
            fontFamily: font.family, fontWeight: font.weight ?? 400, fontSize: layout.size * u }}>
          {font.accent
            ? line.words.map((word, j) => (
              <span key={j}>
                {j > 0 && ' '}
                {word.accent ? <span data-hook-accent style={{ fontFamily: font.accent, fontStyle: 'italic', fontWeight: 400, fontSize: `${HEADLINE_ACCENT_SCALE}em`, lineHeight: 0.9 }}>{word.text}</span> : word.text}
              </span>
            ))
            : line.text}
        </div>
      ))}
    </div>
  )
}

/** 'Key words in color' hook text: the lead words on a white box, the key words in italic on a box in the color (the engine's _highlight_headline). */
function HighlightHook({ text, look, u, scale, frameW, frameH }: { text: string; look: HeadlineLook; u: number; scale: number; frameW: number; frameH: number }): React.JSX.Element {
  const ready = useFontsReady()
  const font = HEADLINE_FONTS.find((item) => item.id === look.font) ?? HEADLINE_FONTS[0]
  const css = (size: number, phrase: boolean): string => phrase ? `italic 400 ${size * HIGHLIGHT.phraseScale}px ${HIGHLIGHT_PHRASE_FAMILY}` : `${font.weight ?? 400} ${size * (font.scale ?? 1)}px ${font.family}`
  const shown = font.upper ? text.toUpperCase() : text
  const layout = useMemo(() => highlightPlacement(shown, (line, size, phrase) => measureLine(line, css(size, phrase), size), frameW, frameH, scale),
    [shown, look.font, frameW, frameH, scale, ready])
  const colors = highlightColors(look)
  return (
    <div data-testid="hook-text-box" data-text-bg="highlight" className="absolute inset-x-0 top-0" style={{ height: layout.height * u }}>
      <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox={`0 0 ${frameW} ${layout.height}`} preserveAspectRatio="none">
        <path d={layout.leadPath} fill={colors.leadBg} />
        <path d={layout.phrasePath} fill={colors.phraseBg} />
      </svg>
      {layout.lines.map((line, i) => (
        <div key={i} data-hook-line className="absolute inset-x-0 flex items-center justify-center whitespace-nowrap"
          style={{ top: (line.center - line.height / 2) * u, height: line.height * u, color: line.phrase ? colors.phraseInk : colors.leadInk,
            fontFamily: line.phrase ? HIGHLIGHT_PHRASE_FAMILY : font.family, fontStyle: line.phrase ? 'italic' : 'normal', fontWeight: line.phrase ? 400 : font.weight ?? 400,
            fontSize: layout.size * (line.phrase ? HIGHLIGHT.phraseScale : font.scale ?? 1) * u, lineHeight: 1 }}>
          {line.text}
        </div>
      ))}
    </div>
  )
}

/** Small mock-ups of the extras that aren't part of the caption line. */
function ProgressBar({ u, progress, color }: { u: number; progress: number; color: string }): React.JSX.Element {
  return (
    <div data-testid="look-extra-progress_bar" className="absolute inset-x-0 top-0 z-10" style={{ height: Math.max(2, 12 * u), background: 'rgb(255 255 255 / 0.25)' }}>
      <div className="h-full" style={{ width: `${Math.round(progress * 100)}%`, background: color }} />
    </div>
  )
}

function BrollTag({ u }: { u: number }): React.JSX.Element {
  return (
    <div data-testid="look-extra-broll_tags" className="absolute flex items-center whitespace-nowrap rounded-full text-white"
      style={{ top: 40 * u, right: 36 * u, background: 'rgb(0 0 0 / 0.62)', fontFamily: '"Montserrat", system-ui, sans-serif', fontWeight: 800,
        fontSize: 30 * u, padding: `${8 * u}px ${18 * u}px`, gap: 10 * u, lineHeight: 1 }}>
      <span className="rounded-full" style={{ width: 16 * u, height: 16 * u, background: '#FF3B30' }} />Screen recording
    </div>
  )
}

function CommentBox({ u, keyword, typed }: { u: number; keyword: string; typed: number }): React.JSX.Element {
  const shown = keyword.slice(0, Math.max(0, Math.min(keyword.length, typed)))
  return (
    <div data-testid="look-extra-comment_box" className="absolute inset-x-0 flex justify-center" style={{ top: '52%' }}>
      <div className="flex items-center" style={{ width: '82%', background: '#FFFFFF', borderRadius: 28 * u, padding: `${18 * u}px ${22 * u}px`, gap: 16 * u,
        boxShadow: `0 ${10 * u}px ${30 * u}px rgb(0 0 0 / 0.45)`, fontFamily: '"Montserrat", system-ui, sans-serif' }}>
        <span className="shrink-0 rounded-full" style={{ width: 56 * u, height: 56 * u, background: 'linear-gradient(135deg,#FFB547,#FF2EC4)' }} />
        <span className="min-w-0 flex-1 truncate" style={{ color: '#111', fontWeight: 800, fontSize: 40 * u, lineHeight: 1.1 }}>
          {shown}<span style={{ color: PILL_COLOR, fontWeight: 400 }}>|</span>
        </span>
        <span style={{ color: PILL_COLOR, fontWeight: 800, fontSize: 34 * u }}>Post</span>
      </div>
    </div>
  )
}

function ProofCard({ u }: { u: number }): React.JSX.Element {
  const line = (width: string, dark = false): React.JSX.Element => (
    <span className="block rounded-full" style={{ width, height: 14 * u, background: dark ? '#1F2937' : '#D1D5DB', marginTop: 12 * u }} />
  )
  return (
    <div data-testid="look-extra-proof_underline" className="absolute" style={{ right: 40 * u, top: '40%', width: '58%', transform: 'rotate(-3deg)',
      background: '#FFFFFF', borderRadius: 22 * u, padding: 24 * u, boxShadow: `0 ${12 * u}px ${34 * u}px rgb(0 0 0 / 0.5)` }}>
      <span className="flex items-center" style={{ gap: 12 * u }}>
        <span className="rounded-full" style={{ width: 44 * u, height: 44 * u, background: '#CBD5E1' }} />
        {line('45%')}
      </span>
      {line('92%')}{line('70%')}
      <span className="relative block" style={{ marginTop: 18 * u }}>
        {line('52%', true)}
        <span className="absolute left-0 block rounded-full" style={{ width: '58%', height: 8 * u, bottom: -14 * u, background: '#E5202E', transform: 'rotate(-1.5deg)' }} />
      </span>
    </div>
  )
}

export interface LookFrameProps {
  value: BoardStyle
  rows: BoardRows
  /** The frame (the live <Frame> or a tile's <FrameStill>). */
  background: ReactNode
  aspect?: '9:16' | '16:9'
  hookText?: string
  words?: string[]
  brand?: BrandIdentity | null
  /** The keyword as it will be drawn, or null when it isn't valid. */
  keyword?: string | null
  /** The drawn width in pixels. */
  width: number
  /** Where in the loop (ms), and how long the loop is. */
  time: number
  loop: number
  /** Show what appears at the end of a video ("Comment KEYWORD", the comment box). */
  ending: boolean
  /** Extras to draw (the board's, or one tile's). */
  extras: readonly LookExtraId[]
  /** Tiles: draw the text this much bigger than the engine would (so it reads at tile size). */
  textScale?: number
  /** Tiles: leave out the handle and draw the caption even when captions are off (for an extra that needs one). */
  tile?: boolean
  forceCaptions?: boolean
}

/**
 * The 9:16 (or 16:9) mock-up of a video in a look: the frame, the hook text in
 * its look, font and color, a caption line in the chosen preset, the handle in
 * its corner, "Comment KEYWORD" near the end and the chosen extras. Proportions
 * follow the engine (rendering_service, brand_mark, the caption presets) so
 * what is picked is what is made. CSS only: nothing is rendered.
 */
export function LookFrame({ value, rows, background, aspect = '9:16', hookText, words, brand = null, keyword = null, width, time, loop, ending, extras,
  textScale = 1, tile = false, forceCaptions = false }: LookFrameProps): React.JSX.Element {
  const landscape = aspect === '16:9'
  const FW = landscape ? 1920 : FRAME_W
  const FH = landscape ? 1080 : FRAME_H
  const barRef = useRef<HTMLDivElement>(null)
  const [barPx, setBarPx] = useState(0)
  const u = width / FW
  const height = width * FH / FW
  const lineWords = words?.length ? words.slice(0, 8) : SAMPLE_WORDS
  const emphasis = words?.length ? -1 : SAMPLE_EMPHASIS
  const has = (id: LookExtraId): boolean => extras.includes(id)
  const keyWord = emphasis >= 0 ? emphasis : emphasisOf(lineWords)
  const pill = has('keyword_pill') ? keyWord : -1
  const accent = has('accent_words') ? (pill >= 0 ? Math.min(lineWords.length - 1, keyWord + 1) : keyWord) : -1

  // Hook text: a bar above the video (which fills the rest), floating text over it, a title card, or nothing.
  const fullText = (hookText ?? SAMPLE_HOOK).replace(/\s+/g, ' ').trim()
  const text = tile ? fullText.split(' ').slice(0, 5).join(' ') : fullText
  const showHook = Boolean(rows.hooks?.length) && value.hook !== 'none' && text.split(' ').length >= 2
  const bar = showHook && !landscape && BAR_HOOKS.includes(value.hook)
  const floating = showHook && !landscape && value.hook === 'floating'
  const card = showHook && (value.hook === 'card' || (landscape && value.hook !== 'none'))
  const headLook = { look: value.hook === 'card' ? 'white' as const : value.hook, color: value.color, font: value.font }
  const boxLook: HeadlineLook = { look: 'floating', color: value.color, font: value.font, textBg: value.textBg ?? 'none' }
  const boxed = floating && headlineTextBox(boxLook) !== null
  const font = HEADLINE_FONTS.find((item) => item.id === value.font) ?? HEADLINE_FONTS[0]
  const hookSize = HEADLINE.fontSize * (font.scale ?? 1) * u * textScale

  useLayoutEffect(() => {
    if (tile) return
    setBarPx(bar ? barRef.current?.offsetHeight ?? Math.round(height * 0.18) : 0)
  }, [tile, bar, width, height, text, value.font, value.hook])
  const barH = bar ? barPx || Math.round(height * 0.18) : 0
  const barFrame = barH / u

  // The handle in its corner (brand_mark): 4% of the frame tall, 70% opaque.
  const look = brand?.look
  const mark = !tile && Boolean(rows.handle && value.handle && hasBrandMark(look))
  const markH = Math.max(24, Math.round(FH * MARK.height))
  const position = look?.handlePosition ?? DEFAULT_HANDLE_POSITION
  const captionsTo = landscape ? 0 : captionsBottom(FH, barFrame, value.captions, 1)
  const topFrom = landscape ? 0 : barFrame || (card ? Math.round(FH * 0.17) : 0)
  const markPlace = markPosition(position, FW, FH, 0, markH, topFrom, captionsTo)
  const tagSize = markH / 1.8
  const showTag = Boolean(keyword) && ending

  const hookStyle: CSSProperties = {
    color: headlineTextColor({ look: headLook.look === 'none' ? 'white' : headLook.look, color: value.color, font: value.font }),
    fontFamily: font.family, fontWeight: font.weight ?? 400, fontSize: hookSize, lineHeight: HEADLINE.lineHeight,
    textTransform: font.upper ? 'uppercase' : 'none', textWrap: 'balance' as CSSProperties['textWrap'],
    display: '-webkit-box', WebkitLineClamp: HEADLINE.maxLines, WebkitBoxOrient: 'vertical', overflow: 'hidden'
  }
  const hookBox: CSSProperties = { paddingTop: FH * HEADLINE.topSafe * u, paddingLeft: FW * HEADLINE.padX * u, paddingRight: FW * HEADLINE.padX * u, minHeight: FH * HEADLINE.minH * u, maxHeight: FH * HEADLINE.maxH * u }
  // Zoom punch: a tight shot every other stretch of the loop (always tight on a tile).
  const zoomed = has('punch_zoom') && (tile || Math.floor(time / 1800) % 2 === 1)
  const barColor = isHexColor(value.color) && value.hook === 'brand' ? value.color : '#FFFFFF'
  const middle = time > loop * 0.25 && time < loop * 0.7
  const captions = value.captions || forceCaptions

  return (
    <div aria-hidden className="absolute inset-0 flex flex-col" data-extras={extras.join(' ') || undefined}>
      {bar && (
        <div ref={barRef} data-testid={tile ? undefined : 'style-preview-bar'} className="relative z-10 flex shrink-0 flex-col" style={{ ...hookBox, background: headlineBarColor(headLook) ?? undefined }}>
          <div className="flex flex-1 items-center justify-center text-center" style={{ paddingTop: FH * HEADLINE.padY * u, paddingBottom: FH * HEADLINE.padY * u }}>
            <HookText text={text} accent={font.accent} style={hookStyle} />
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0" style={zoomed ? { transform: 'scale(1.35)', transformOrigin: '50% 35%' } : undefined}>{background}</div>
        {has('punch_zoom') && tile && (
          <div data-testid="look-extra-punch_zoom" className="absolute inset-[12%] rounded-sm" style={{ boxShadow: 'inset 0 0 0 1.5px rgb(255 255 255 / 0.85)' }} />
        )}
        {has('progress_bar') && <ProgressBar u={tile ? u * 2 : u} progress={tile ? 0.45 : Math.min(1, time / loop)} color={barColor} />}
        {has('broll_tags') && (tile || middle) && <BrollTag u={tile ? u * 3 : u} />}
        {has('proof_underline') && (tile || middle) && <ProofCard u={u} />}
        {captions && (
          <div className="absolute inset-x-0 flex justify-center px-[4%] text-center"
            style={landscape ? { bottom: (100 / 1080) * height } : { top: `${CAPTION_Y * 100}%`, transform: 'translateY(-50%)' }}>
            <CaptionLine presetId={value.captionPreset} words={lineWords} emphasis={emphasis} time={time} u={u * (landscape ? 0.65 : 1) * textScale} pill={pill} accent={accent} />
          </div>
        )}
      </div>
      {boxed && boxLook.textBg === 'highlight' && <HighlightHook text={text} look={boxLook} u={u} scale={textScale} frameW={FW} frameH={FH} />}
      {boxed && boxLook.textBg !== 'highlight' && <BoxedHook text={text} look={boxLook} u={u} scale={textScale} frameW={FW} frameH={FH} />}
      {floating && !boxed && (
        <div className="absolute inset-x-0 top-0 flex flex-col" style={hookBox}>
          <div className="flex flex-1 items-center justify-center text-center" style={{ paddingTop: FH * HEADLINE.padY * u, paddingBottom: FH * HEADLINE.padY * u }}>
            <HookText text={text} accent={font.accent} style={{ ...hookStyle, color: '#FFFFFF', textShadow: [...ring(Math.max(3, hookSize / u * 0.09) * u, '#000'), `0 ${6 * u}px ${8 * u}px rgb(0 0 0 / 0.6)`].join(', ') }} />
          </div>
        </div>
      )}
      {card && (
        <div className="absolute inset-x-0 flex justify-center" style={{ top: FH * (landscape ? 0.06 : 0.09) * u }}>
          <span className="text-center" style={{ background: 'rgb(255 255 255 / 0.95)', color: '#111', borderRadius: 16 * u, padding: `${20 * u}px ${28 * u}px`,
            fontFamily: '"Montserrat", system-ui, sans-serif', fontWeight: 900, fontSize: 42 * u * textScale, lineHeight: 1.35, maxWidth: '80%' }}>
            {text.split(' ').slice(0, 5).join(' ')}
          </span>
        </div>
      )}
      {mark && (
        <div data-testid="style-preview-handle" data-corner={position} className="absolute flex items-center"
          style={{ top: markPlace.y * u, height: markH * u, maxWidth: FW * MARK.maxWidth * u, opacity: MARK.opacity, gap: markH * 0.2 * u,
            ...(position.endsWith('left') ? { left: FW * MARK.margin * u } : { right: FW * MARK.margin * u }) }}>
          {look?.logo && brand?.logoPath && <img src={localFileUrl(brand.logoPath)} alt="" className="h-full w-auto object-contain" />}
          {look?.handle && (
            <span className="truncate rounded-full text-white" style={{ background: 'rgb(0 0 0 / 0.59)', fontFamily: '"Montserrat", system-ui, sans-serif', fontWeight: 800,
              fontSize: tagSize * u, lineHeight: `${markH * u}px`, height: markH * u, padding: `0 ${tagSize * 0.6 * u}px` }}>{look.handle}</span>
          )}
        </div>
      )}
      {showTag && keyword && (
        <div data-testid="style-preview-keyword" className="absolute inset-x-0 flex justify-center animate-fade-in"
          style={{ top: (barFrame ? barFrame + FH * KEYWORD_TAG.underBar : FH * (landscape ? 0.12 : KEYWORD_TAG.top)) * u }}>
          <span className="rounded-full" style={{ background: 'rgb(255 255 255 / 0.94)', color: '#0A0A0A', fontFamily: '"Montserrat", system-ui, sans-serif', fontWeight: 800,
            fontSize: KEYWORD_TAG.size * u, padding: `${KEYWORD_TAG.size * 0.4 * u}px ${KEYWORD_TAG.size * 0.6 * u}px`, lineHeight: 1 }}>Comment {keyword}</span>
        </div>
      )}
      {has('comment_box') && (tile || ending) && (
        <CommentBox u={tile ? u * 2.2 : u} keyword={keyword || SAMPLE_KEYWORD}
          typed={tile ? 99 : Math.floor((time - (loop - TAG_MS)) / 160)} />
      )}
    </div>
  )
}
