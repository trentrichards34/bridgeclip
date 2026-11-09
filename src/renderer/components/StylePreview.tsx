import { memo, useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import type { BrandIdentity } from '../../shared/remix'
import type { BoardRows, BoardStyle } from '../lib/style-board'
import { cn } from '../lib/utils'
import { Frame, LINGER_MS, LookFrame, SAMPLE_WORDS, STILL_MS, TAG_MS, WORD_MS, type StyleFrame } from './LookFrame'
import { Button } from './ui/Button'

export { SAMPLE_HOOK, type StyleFrame } from './LookFrame'

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
 * A live 9:16 (or 16:9) mock-up of the video (LookFrame), playing: the caption
 * line word by word, "Comment KEYWORD" and the comment box near the end, the
 * progress bar filling and the other extras in their moments.
 */
export const StylePreview = memo(function StylePreview({ value, rows, frame, aspect = '9:16', hookText, words, brand, ctaName, keyword, label }: StylePreviewProps): React.JSX.Element {
  const landscape = aspect === '16:9'
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(landscape ? 320 : 200)
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const [playing, setPlaying] = useState(!reduced)
  const [time, setTime] = useState(STILL_MS)
  const elapsed = useRef(time)
  const lineWords = words?.length ? words.slice(0, 8) : SAMPLE_WORDS
  // "Comment KEYWORD" overlaps the last words, as it does in a video's last seconds.
  const loop = lineWords.length * WORD_MS + LINGER_MS
  const extras = rows.extras ? value.extras : []

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

  return (
    <div className="space-y-2">
      <div ref={root} role="img" aria-label={label} data-testid="style-preview" data-hook={rows.hooks?.length && value.hook !== 'none' ? value.hook : 'none'}
        data-extras={extras.join(' ') || undefined}
        className={cn('relative w-full overflow-hidden rounded-xl bg-black shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_12px_30px_-12px_rgb(0_0_0/0.7)]', landscape ? 'aspect-video' : 'aspect-[9/16]')}>
        <LookFrame value={value} rows={rows} background={<Frame frame={frame} />} aspect={aspect} hookText={hookText} words={words} brand={brand}
          keyword={keyword ?? null} width={width} time={time} loop={loop} ending={playing && !reduced && time >= loop - TAG_MS} extras={extras} />
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
