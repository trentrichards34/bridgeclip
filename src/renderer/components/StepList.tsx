import { Check, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import './edit-progress.css'

export interface StepItem {
  id: string
  label: string
  icon: LucideIcon
  state: 'done' | 'current' | 'next'
  /** Shown after the label while it runs ("7 of 13"). */
  step?: string | null
  /** Right-hand note: how long it took, the time so far, or a word ("Done", "You"). */
  note?: string | null
}

/** A long job's steps, top to bottom: done ones checked, the current one lit in the tool color, the rest dim. */
export function StepList({ items, testId }: { items: StepItem[]; testId?: string }): React.JSX.Element {
  return (
    <ol aria-label="Steps" data-testid={testId} className="relative">
      {items.map((item, i) => {
        const Icon = item.icon
        return (
          <li key={item.id} data-state={item.state} aria-current={item.state === 'current' ? 'step' : undefined}
            className={cn('relative flex items-center gap-3 py-1.5', item.state === 'next' && 'opacity-55')}>
            {i < items.length - 1 && <span aria-hidden className={cn('absolute left-[13px] top-[30px] h-[calc(100%-18px)] w-px', item.state === 'done' ? 'bg-success/40' : 'bg-white/10')} />}
            <span aria-hidden className={cn('relative z-[1] flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full',
              item.state === 'done' ? 'bg-success/15 text-success' : item.state === 'current' ? 'edit-progress-live bg-tool text-canvas' : 'bg-white/[0.06] text-ink-subtle')}>
              {item.state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Icon className="h-3.5 w-3.5" />}
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-xs', item.state === 'current' ? 'font-semibold text-ink' : item.state === 'done' ? 'text-ink-muted' : 'text-ink-subtle')}>
              {item.label}{item.state === 'current' && item.step ? <span className="font-normal text-ink-muted"> · {item.step}</span> : null}
            </span>
            {item.note && <span className="shrink-0 font-mono text-[10px] tabular text-ink-subtle">{item.note}</span>}
          </li>
        )
      })}
    </ol>
  )
}
