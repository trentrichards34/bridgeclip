import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Pause, Play } from 'lucide-react'
import type { BrandIdentity } from '../../shared/remix'
import { DEFAULT_HANDLE_POSITION, hasBrandMark } from '../../shared/brand-kit'
import { HEADLINE_FONTS, headlineBarColor, headlineTextColor } from '../../shared/headline-look'
import {
  BAR_HOOKS, CAPTION_Y, ENGINE_CAPTIONS, FRAME_H, FRAME_W, HEADLINE, KEYWORD_TAG, MARK, captionEm, captionsBottom, markPosition,
  type BoardRows, type BoardStyle
} from '../lib/style-board'
import { cn, localFileUrl } from '../lib/utils'
import { captionPreviewPreset, type CaptionPreset } from './CaptionPresetPicker'
import { Button } from './ui/Button'

/** The member's own frame behind the preview: a still image, or a video seeked to a representative moment. */
export interface StyleFrame { kind: 'video' | 'image'; src: string; seek?: number }

export const SAMPLE_HOOK = 'This is how your hook text looks on every video'
const SAMPLE_WORDS = ['This', 'is', 'how', 'your', 'captions', 'come', 'to', 'life']
/** The sample line's punch word, drawn in the preset's emphasis color like the planner's picks. */
const SAMPLE_EMPHASIS = 4
/** With reduced motion (or paused at first), the line holds on the punch word. */
const STILL_MS = SAMPLE_EMPHASIS * 450 + 225
const WORD_MS = 450
const LINGER_MS = 1300
/** "Comment KEYWORD" shows for the last stretch of the loop, as it does for a video's last 4 seconds. */
const TAG_MS = 2800
// Strokes the engine draws in a dark color other than black.
const OUTLINE: Record<string, string> = { retro: '#2B1300', vintage: '#1E120A' }

function ring(width: number, color: string): string[] {
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

/** A neutral stand-in frame: a dim studio backdrop with a speaker's silhouette. */
function Placeholder(): React.JSX.Element {
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

function Frame({ frame }: { frame: StyleFrame | null }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [frame?.src])
  if (!frame || failed) return <Placeholder />
  const src = frame.src.startsWith('https://') ? frame.src : localFileUrl(frame.src)
  return frame.kind === 'image'
    ? <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
    : <video src={src} muted playsInline preload="auto" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover"
      onLoadedMetadata={(e) => {
        const seconds = e.currentTarget.duration
        // Not a #t= fragment: the local-file protocol would treat it as part of the path.
        if (Number.isFinite(seconds) && seconds > 0) e.currentTarget.currentTime = Math.min(frame.seek ?? 2, seconds / 2)
      }} />
}

/** The caption line at a moment of the loop, drawn the way the engine's ASS layers are. */
function CaptionLine({ presetId, words, emphasis, time, u }: { presetId: string; words: string[]; emphasis: number; time: number; u: number }): React.JSX.Element | null {
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
    <span className="inline-flex flex-wrap justify-center gap-x-[0.28em]" data-caption-preset={preset.id}
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
        return (
          <span key={index} data-caption-state={state} className="relative inline-block whitespace-nowrap" style={style}>
            {word}
            {preset.karaoke && state === 'active' && (
              <span aria-hidden className="absolute inset-0" style={{ color: punch ?? preset.highlight, opacity: 1, clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`, padding: style.padding }}>{word}</span>
            )}
          </span>
        )
      })}
    </span>
  )
}

export interface StylePreviewProps {
  value: BoardStyle
  rows: BoardRows
  frame: StyleFrame | null
  aspect?: '9:16' | '16:9'
  /** The hook text to show (Edit my recording's own); a sample when not given. */
  hookText?: string
  /** The caption words to show (a sample when not given). */
  words?: string[]
  brand: BrandIdentity | null
  ctaName?: string | null
  /** The keyword as it will be drawn, or null when it isn't valid. */
  keyword?: string | null
  label: string
}

/**
 * A live 9:16 (or 16:9) mock-up of the video: the member's frame, the hook text
 * bar in its look, font and color, a caption line playing word by word in the
 * chosen preset, the handle in its corner and "Comment KEYWORD" near the end.
 * Proportions follow the engine (rendering_service, brand_mark, the caption
 * presets) so what is picked here is what is made. CSS only: nothing is rendered.
 */
export const StylePreview = memo(function StylePreview({ value, rows, frame, aspect = '9:16', hookText, words, brand, ctaName, keyword, label }: StylePreviewProps): React.JSX.Element {
  const landscape = aspect === '16:9'
  const FW = landscape ? 1920 : FRAME_W
  const FH = landscape ? 1080 : FRAME_H
  const root = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(landscape ? 320 : 200)
  const [barPx, setBarPx] = useState(0)
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const [playing, setPlaying] = useState(!reduced)
  const [time, setTime] = useState(STILL_MS)
  const elapsed = useRef(time)

  const u = width / FW
  const height = width * FH / FW
  const lineWords = words?.length ? words.slice(0, 8) : SAMPLE_WORDS
  const emphasis = words?.length ? -1 : SAMPLE_EMPHASIS
  // "Comment KEYWORD" overlaps the last words, as it does in a video's last seconds.
  const loop = lineWords.length * WORD_MS + LINGER_MS

  useEffect(() => {
    const element = root.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = (): void => { if (element.clientWidth) setWidth(element.clientWidth) }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const update = (): void => {
      setReduced(media.matches)
      if (media.matches) { setPlaying(false); elapsed.current = STILL_MS; setTime(STILL_MS) }
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!playing) return
    let frameId = 0
    let previous = performance.now()
    const tick = (now: number): void => {
      if (!document.hidden) {
        elapsed.current = (elapsed.current + Math.min(now - previous, 100)) % loop
        setTime(elapsed.current)
      }
      previous = now
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [playing, loop])

  // Hook text: a bar above the video (which fills the rest), floating text over it, a title card, or nothing.
  const text = (hookText ?? SAMPLE_HOOK).replace(/\s+/g, ' ').trim()
  const showHook = Boolean(rows.hooks?.length) && value.hook !== 'none' && text.split(' ').length >= 2
  const bar = showHook && !landscape && BAR_HOOKS.includes(value.hook)
  const floating = showHook && !landscape && value.hook === 'floating'
  const card = showHook && (value.hook === 'card' || (landscape && value.hook !== 'none'))
  const headLook = { look: value.hook === 'card' ? 'white' as const : value.hook, color: value.color, font: value.font }
  const font = HEADLINE_FONTS.find((item) => item.id === value.font) ?? HEADLINE_FONTS[0]
  const hookSize = HEADLINE.fontSize * (value.font === 'condensed' ? HEADLINE.condensedScale : 1) * u

  useLayoutEffect(() => {
    setBarPx(bar ? barRef.current?.offsetHeight ?? Math.round(height * 0.18) : 0)
  }, [bar, width, height, text, value.font, value.hook])
  const barH = bar ? barPx || Math.round(height * 0.18) : 0
  const barFrame = barH / u

  // The handle in its corner (brand_mark): 4% of the frame tall, 70% opaque.
  const look = brand?.look
  const mark = Boolean(rows.handle && value.handle && hasBrandMark(look))
  const markH = Math.max(24, Math.round(FH * MARK.height))
  const position = look?.handlePosition ?? DEFAULT_HANDLE_POSITION
  const captionsTo = landscape ? 0 : captionsBottom(FH, barFrame, value.captions, 1)
  const topFrom = landscape ? 0 : barFrame || (card ? Math.round(FH * 0.17) : 0)
  const markPlace = markPosition(position, FW, FH, 0, markH, topFrom, captionsTo)
  const tagSize = markH / 1.8
  const showTag = Boolean(keyword) && playing && !reduced && time >= loop - TAG_MS

  const hookStyle: CSSProperties = {
    color: headlineTextColor({ look: headLook.look === 'none' ? 'white' : headLook.look, color: value.color, font: value.font }),
    fontFamily: font.family, fontWeight: value.font === 'clean' ? 800 : 400, fontSize: hookSize, lineHeight: HEADLINE.lineHeight,
    textTransform: font.upper ? 'uppercase' : 'none', textWrap: 'balance' as CSSProperties['textWrap'],
    display: '-webkit-box', WebkitLineClamp: HEADLINE.maxLines, WebkitBoxOrient: 'vertical', overflow: 'hidden'
  }
  const hookBox: CSSProperties = { paddingTop: FH * HEADLINE.topSafe * u, paddingLeft: FW * HEADLINE.padX * u, paddingRight: FW * HEADLINE.padX * u, minHeight: FH * HEADLINE.minH * u, maxHeight: FH * HEADLINE.maxH * u }

  return (
    <div className="space-y-2">
      <div ref={root} role="img" aria-label={label} data-testid="style-preview" data-hook={showHook ? value.hook : 'none'}
        className={cn('relative w-full overflow-hidden rounded-xl bg-black shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_12px_30px_-12px_rgb(0_0_0/0.7)]', landscape ? 'aspect-video' : 'aspect-[9/16]')}>
        <div aria-hidden className="absolute inset-0 flex flex-col">
          {bar && (
            <div ref={barRef} data-testid="style-preview-bar" className="relative z-10 flex shrink-0 flex-col" style={{ ...hookBox, background: headlineBarColor(headLook) ?? undefined }}>
              <div className="flex flex-1 items-center justify-center text-center" style={{ paddingTop: FH * HEADLINE.padY * u, paddingBottom: FH * HEADLINE.padY * u }}>
                <span style={hookStyle}>{text}</span>
              </div>
            </div>
          )}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <Frame frame={frame} />
            {value.captions && (
              <div className="absolute inset-x-0 flex justify-center px-[4%] text-center"
                style={landscape ? { bottom: (100 / 1080) * height } : { top: `${CAPTION_Y * 100}%`, transform: 'translateY(-50%)' }}>
                <CaptionLine presetId={value.captionPreset} words={lineWords} emphasis={emphasis} time={time} u={u * (landscape ? 0.65 : 1)} />
              </div>
            )}
          </div>
          {floating && (
            <div className="absolute inset-x-0 top-0 flex flex-col" style={hookBox}>
              <div className="flex flex-1 items-center justify-center text-center" style={{ paddingTop: FH * HEADLINE.padY * u, paddingBottom: FH * HEADLINE.padY * u }}>
                <span style={{ ...hookStyle, color: '#FFFFFF', textShadow: [...ring(Math.max(3, hookSize / u * 0.09) * u, '#000'), `0 ${6 * u}px ${8 * u}px rgb(0 0 0 / 0.6)`].join(', ') }}>{text}</span>
              </div>
            </div>
          )}
          {card && (
            <div className="absolute inset-x-0 flex justify-center" style={{ top: FH * (landscape ? 0.06 : 0.09) * u }}>
              <span className="text-center" style={{ background: 'rgb(255 255 255 / 0.95)', color: '#111', borderRadius: 16 * u, padding: `${20 * u}px ${28 * u}px`,
                fontFamily: '"Montserrat", system-ui, sans-serif', fontWeight: 900, fontSize: 42 * u, lineHeight: 1.35, maxWidth: '80%' }}>
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
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" iconOnly aria-label={playing ? 'Pause the preview' : 'Play the preview'} tooltip={playing ? 'Pause the preview' : 'Play the preview'}
          icon={playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          onClick={() => setPlaying((on) => !on)} />
        {rows.cta && (
          <span data-testid="style-preview-ends" className="min-w-0 max-w-full truncate rounded-full bg-white/[0.06] px-2 py-0.5 text-2xs text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
            Ends with: <span className="text-ink">{ctaName ?? 'the clip as made'}</span>
          </span>
        )}
        {keyword && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-2xs text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">“Comment {keyword}” at the end</span>}
      </div>
    </div>
  )
})
