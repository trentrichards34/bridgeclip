import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { DURATION_OPTIONS } from '../../shared/job-contract'
import type { BoardRows, BoardStyle } from '../lib/style-board'
import { captionName } from '../lib/style-board'
import { cn, MOD_KEY, sourceLabel } from '../lib/utils'
import type { ClipDraft, WizardStep } from '../store/use-draft-store'
import { FrameStill, LookFrame, SAMPLE_WORDS, STILL_MS, WORD_MS, LINGER_MS, type StyleFrame } from './LookFrame'
import { Button } from './ui/Button'
import { previewFrame } from './StyleBoard'

/** Where a token in the summary sentence takes the member. */
export type SummaryTarget = WizardStep | 'workflow'

/** One piece of the summary sentence: plain words, or a setting (amber while it still needs the member). */
export type SentencePart = { text: string } | { token: string; go: SummaryTarget; missing?: boolean; title?: string }

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/** The clip lengths as the sentence says them ("30–60s, 1–2m", or "any length"). */
export function lengthsText(durations: readonly string[]): string {
  const ranges = DURATION_OPTIONS.filter((option) => durations.includes(option.id)).map((option) => option.range)
  return ranges.length ? ranges.join(', ') : 'any length'
}

/**
 * The run in one sentence, from the form as it is: "Find the best clips,
 * 30–60s, from a video. Then export automatically, with Pop captions." Each
 * setting is a button to its step; what's still needed is marked.
 */
export function createSentence(draft: Pick<ClipDraft, 'workflow' | 'clipRequest' | 'durations' | 'autoClipCount' | 'maxClips' | 'includeCaptions' | 'captionPreset'>,
  state: { sources: string[]; trimError: string | null; modelsValid: boolean }): SentencePart[] {
  const parts: SentencePart[] = []
  const request = draft.clipRequest?.trim()
  if (request) parts.push({ text: 'Find ' }, { token: `clips that match “${shorten(request, 36)}”`, go: 'clips' }, { text: ', ' })
  else parts.push({ text: 'Find ' }, { token: 'the best', go: 'clips' }, { text: ' clips, ' })
  parts.push({ token: `${lengthsText(draft.durations)}${draft.autoClipCount ? '' : `, up to ${draft.maxClips}`}`, go: 'clips' })
  parts.push({ text: ', from ' })
  const count = state.sources.length
  parts.push(count === 0 ? { token: 'a video', go: 'video', missing: true }
    : count === 1 ? { token: 'your video', go: 'video', title: sourceLabel(state.sources[0]) }
      : { token: `${count} videos`, go: 'video' })
  if (state.trimError) parts.push({ text: ' (' }, { token: 'fix the preferred part', go: 'video', missing: true }, { text: ')' })
  parts.push({ text: '. Then ' })
  parts.push(draft.workflow === 'automatic' ? { token: 'export automatically', go: 'workflow' }
    : draft.workflow === 'review' ? { token: 'you edit before export', go: 'workflow' }
      : { token: 'choose how to finish', go: 'workflow', missing: true })
  parts.push({ text: ', with ' })
  parts.push({ token: draft.includeCaptions ? `${captionName(draft.captionPreset)} captions` : 'no captions', go: 'captions' })
  parts.push({ text: '.' })
  if (!state.modelsValid) parts.push({ text: ' ' }, { token: 'Choose both models', go: 'clips', missing: true }, { text: '.' })
  return parts
}

/** Tracks an element's width. */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = (): void => { if (element.clientWidth) setWidth(element.clientWidth) }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** The moments each tile shows: three points in the caption line, three spots in the video. */
const TILE_TIMES = [STILL_MS, STILL_MS + 2 * WORD_MS, STILL_MS - 3 * WORD_MS]
const TILE_SEEKS = [2, 30, 90]
/** Neutral hook text on the tiles: the clips' real hooks are written when the video is clipped. */
const TILE_HOOK = 'Your hook text shows here'

export interface CreatePreviewProps {
  board: BoardStyle
  rows: BoardRows
  aspect: '9:16' | '16:9'
  source: string
  durations: readonly string[]
  sentence: SentencePart[]
  onGo: (target: SummaryTarget) => void
  /** The action's label: what's missing ("Add a video to continue") or "Generate clips". */
  actionLabel: string
  canSubmit: boolean
  submitting?: boolean
  onSubmit: () => void
  /** Under the button: why it can't start, or how the run goes. */
  hint: ReactNode
  /** The hint says why the run can't start (it stays visible on small windows). */
  blocked?: boolean
  className?: string
}

/**
 * Create's right-hand panel: three 9:16 tiles in the member's look (their own
 * video frame, caption style and hook look), the run in one sentence, and the
 * one primary action. Below xl it becomes a bar pinned to the bottom edge.
 */
export function CreatePreview({ board, rows, aspect, source, durations, sentence, onGo, actionLabel, canSubmit, submitting, onSubmit, hint, blocked = false, className }: CreatePreviewProps): React.JSX.Element {
  const [tilesRef, tilesWidth] = useWidth<HTMLDivElement>(300)
  const wide = aspect === '16:9'
  const count = wide ? 1 : 3
  const tileWidth = Math.max(60, Math.floor((tilesWidth - (count - 1) * 8) / count))
  const ranges = DURATION_OPTIONS.filter((option) => durations.includes(option.id)).map((option) => option.range)
  const loop = SAMPLE_WORDS.length * WORD_MS + LINGER_MS
  const missing = sentence.some((part) => 'token' in part && part.missing)
  return (
    <aside aria-label="Preview and generate" data-testid="create-preview"
      className={cn('glass-thick z-10 rounded-[18px] p-4 max-xl:sticky max-xl:bottom-3 max-xl:flex max-xl:flex-wrap max-xl:items-center max-xl:gap-x-4 max-xl:gap-y-1.5 max-xl:p-3 xl:sticky xl:top-2', className)}>
      <div className="flex items-center gap-2 max-xl:hidden">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-subtle">Preview · {aspect}</span>
        <span className="ml-auto truncate text-2xs text-ink-muted">{board.captions ? `${captionName(board.captionPreset)} captions` : 'No captions'}</span>
      </div>
      <div ref={tilesRef} className="mt-3 flex items-end gap-2 max-xl:hidden" role="img"
        aria-label={`Sample ${wide ? 'clip' : 'clips'} in your look: ${board.captions ? `${captionName(board.captionPreset)} captions` : 'no captions'}. Your clips’ real hook text is written when the video is clipped.`}>
        {Array.from({ length: count }, (_, i) => {
          const frame: StyleFrame | null = previewFrame(source, 'video', TILE_SEEKS[i])
          return (
            <div key={i} className={cn('relative shrink-0 overflow-hidden rounded-[10px] bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]', wide ? 'aspect-video' : 'aspect-[9/16]')}
              style={{ width: tileWidth }}>
              <LookFrame value={board} rows={rows} background={<FrameStill frame={frame} />} aspect={aspect} hookText={TILE_HOOK}
                width={tileWidth} time={TILE_TIMES[i]} loop={loop} ending={false} extras={rows.extras ? board.extras : []} textScale={wide ? 1.4 : 1.5} tile />
              <span className="absolute right-1 top-1 rounded bg-canvas/75 px-1 font-mono text-[9px] text-ink-muted">{ranges.length ? ranges[i % ranges.length] : 'Any'}</span>
            </div>
          )
        })}
      </div>
      <p className="text-[15px] leading-[1.7] tracking-[-0.01em] text-ink-muted max-xl:line-clamp-2 max-xl:min-w-0 max-xl:flex-1 max-xl:basis-72 max-xl:text-sm max-xl:leading-6 xl:mt-4" data-testid="create-sentence">
        {sentence.map((part, i) => 'token' in part
          ? <button key={i} type="button" onClick={() => onGo(part.go)} data-missing={part.missing || undefined} title={part.title}
            className={cn('rounded-[5px] px-1.5 py-px transition-[filter] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
              part.missing ? 'bg-warning/15 text-warning' : 'bg-white/[0.07] text-ink')}>{part.token}</button>
          : <span key={i}>{part.text}</span>)}
      </p>
      <Button variant="primary" size="lg" className="rounded-[13px] font-display text-[15px] max-xl:shrink-0 xl:mt-4 xl:h-12 xl:w-full" onClick={onSubmit}
        disabled={!canSubmit} loading={submitting} icon={canSubmit ? <Sparkles className="h-4 w-4" /> : undefined}
        trailingIcon={<span aria-hidden className="font-mono text-[11px] opacity-60">{MOD_KEY}↵</span>}>
        {actionLabel}
      </Button>
      <p className={cn('text-center text-2xs leading-relaxed text-ink-subtle max-xl:w-full max-xl:text-left xl:mt-2.5', !blocked && 'max-xl:hidden')} data-testid="create-hint">
        {hint ?? (missing ? 'Amber words still need you.' : null)}
      </p>
    </aside>
  )
}
