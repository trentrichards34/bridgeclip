import type { FormatCardId, RemixMode } from '../../../shared/remix'
import { cn } from '../../lib/utils'

/** Where "you" (or the presenter) and "their clip" sit in a 9:16 frame, in percent: left, top, width, height. */
type Box = readonly [number, number, number, number]
interface Layout { you: Box | null; their: Box | null; youInFront?: boolean; theirLabel?: string }

const CAMERA: Record<FormatCardId, Layout> = {
  pause_react: { you: [0, 0, 100, 100], their: [8, 6, 54, 30] },
  clip_then_me: { you: [0, 52, 100, 48], their: [0, 0, 100, 48] },
  react_thoughts: { you: [0, 50, 100, 50], their: [0, 0, 100, 50] },
  moment_take: { you: [0, 0, 100, 100], their: [8, 6, 42, 22] },
  image: { you: [22, 56, 56, 44], their: [8, 6, 84, 46], theirLabel: 'Their post' },
  greenscreen: { you: [18, 46, 64, 54], their: [0, 0, 100, 100], youInFront: true },
  commentary: { you: [0, 0, 100, 100], their: null },
  silent: { you: [18, 46, 64, 54], their: [0, 0, 100, 100], youInFront: true }
}

const AI: Partial<Record<FormatCardId, Layout>> = {
  // A few seconds of their moment, then the presenter's take.
  commentary: { you: [0, 40, 100, 60], their: [0, 0, 100, 40] },
  // Their moment plays; the avatar reacts on top.
  silent: { you: [54, 62, 40, 34], their: [0, 0, 100, 100], youInFront: true }
}

/**
 * A small line drawing of a Remix format: where their clip and you (or the AI presenter) sit in the vertical frame.
 * Decorative: the format's name is the card's label.
 */
export function FormatDiagram({ format, mode, size = 'sm', className }: { format: FormatCardId; mode: RemixMode; size?: 'sm' | 'lg'; className?: string }): React.JSX.Element {
  const layout = (mode === 'ai' ? AI[format] : undefined) ?? CAMERA[format]
  const large = size === 'lg'
  const box = (b: Box): React.CSSProperties => ({ left: `${b[0]}%`, top: `${b[1]}%`, width: `${b[2]}%`, height: `${b[3]}%` })
  const you = layout.you && (
    <div className={cn('absolute flex items-end justify-center', large
      ? 'bg-[radial-gradient(ellipse_40%_28%_at_50%_52%,#3A3F4C_0%,rgba(58,63,76,0)_100%),linear-gradient(180deg,#232733,#101218)] pb-2.5'
      : 'rounded-[3px] bg-white/[0.14]', large && layout.youInFront && 'rounded-md shadow-[0_8px_24px_rgb(0_0_0/0.5)]')} style={box(layout.you)}>
      {large && <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">{mode === 'ai' ? 'Presenter' : 'You · camera'}</span>}
    </div>
  )
  const their = layout.their && (
    <div className={cn('absolute border-tool', large
      ? 'flex items-start rounded-md border-[1.5px] bg-[linear-gradient(135deg,rgb(var(--tool)/0.45),rgb(var(--tool-avatar)/0.35))] p-1.5'
      : 'rounded-[3px] border bg-tool/35')} style={box(layout.their)}>
      {large && <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-white">{layout.theirLabel ?? 'Their clip'}</span>}
    </div>
  )
  return (
    <div aria-hidden className={cn('relative overflow-hidden', large
      ? 'mx-auto aspect-[9/16] w-[190px] rounded-[14px] bg-[#101218] shadow-[0_20px_50px_rgb(0_0_0/0.5)]'
      : 'h-[84px] w-[52px] rounded-md bg-raised', className)}>
      {layout.youInFront ? <>{their}{you}</> : <>{you}{their}</>}
    </div>
  )
}
