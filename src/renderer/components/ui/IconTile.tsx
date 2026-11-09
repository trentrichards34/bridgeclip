import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import type { Tone } from './Badge'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<Size, string> = {
  sm: 'h-7 w-7 rounded-lg [&_svg]:h-3.5 [&_svg]:w-3.5',
  md: 'h-8 w-8 rounded-[10px] [&_svg]:h-4 [&_svg]:w-4',
  lg: 'h-10 w-10 rounded-xl [&_svg]:h-[18px] [&_svg]:w-[18px]',
  xl: 'h-12 w-12 rounded-[14px] [&_svg]:h-[22px] [&_svg]:w-[22px]'
}

const TONES: Record<Tone, string> = {
  neutral:
    'text-ink-muted bg-white/[0.06] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]',
  accent:
    'text-tool bg-tool/[0.14]',
  success:
    'text-success bg-success/[0.14]',
  warning:
    'text-warning bg-warning/[0.14]',
  danger:
    'text-danger bg-danger/[0.14]'
}

/** A small tinted tile holding an icon. `accent` takes the page's tool colour. */
export function IconTile({ children, tone = 'neutral', size = 'md', className }: {
  children: ReactNode
  tone?: Tone
  size?: Size
  className?: string
}): React.JSX.Element {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center', SIZES[size], TONES[tone], className)}>
      {children}
    </span>
  )
}
