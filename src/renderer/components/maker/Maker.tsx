import { useId, type ReactNode } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { ENGINE_CAPTIONS } from '../../lib/style-board'

/**
 * The maker pages' shared pieces (Edit my recording, Remix, Avatar Studio, B-roll video):
 * numbered sections with a small mono label, choice cards, the "Look" summary card and
 * the sticky summary card on the right with the page's one primary action.
 */

/** Main column and a sticky summary card on the right (below the main column on narrow windows). */
export function MakerLayout({ main, aside, className }: { main: ReactNode; aside: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_288px] xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-7', className)}>
      <div className="min-w-0 space-y-6">{main}</div>
      <aside className="min-w-0 lg:sticky lg:top-0 lg:pt-10" aria-label="Summary">{aside}</aside>
    </div>
  )
}

/** "01 · What did you record?": a numbered section with its label as a small mono heading. */
export function MakerSection({ number, title, aside, children, className, ...props }: {
  number?: number
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>): React.JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('scroll-mt-4', className)} {...props}>
      <div className="mb-2.5 flex min-h-[14px] items-baseline gap-3">
        <h2 id={id} className="font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.12em] text-ink-subtle">
          {number !== undefined ? `${String(number).padStart(2, '0')} · ` : ''}{title}
        </h2>
        {aside && <span className="ml-auto text-2xs text-ink-subtle">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/** Arrow keys across a radio group whose radios sit inside their own card. */
export function onCardRadioKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
  const radios = Array.from(event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [])
  const current = radios.indexOf(event.currentTarget)
  if (current < 0) return
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : step ? (current + step + radios.length) % radios.length : -1
  if (next < 0) return
  event.preventDefault()
  radios[next].focus()
  radios[next].click()
}

export interface ChoiceOption<T extends string> {
  value: T
  label: string
  detail?: ReactNode
  /** A small mono tag after the label ("Beta"). */
  tag?: ReactNode
  icon?: ReactNode
  /** Shown under the card's button, inside the card (e.g. a link that isn't the choice itself). */
  footer?: ReactNode
  disabled?: boolean
}

/** Big two-up choice cards ("Retakes of one thing" / "Parts to combine"). The chosen one takes the tool's color. */
export function ChoiceCards<T extends string>({ label, value, options, onChange, disabled, className }: {
  label: string
  value: T
  options: readonly ChoiceOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('grid gap-2.5 sm:grid-cols-2', className)} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <div key={option.value} className={cn('glass-tile glass-tile-hover flex flex-col rounded-[13px] transition-colors', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink',
            (disabled || option.disabled) && 'opacity-60')}>
            <button type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} disabled={disabled || option.disabled} onKeyDown={onCardRadioKeyDown}
              onClick={() => onChange(option.value)}
              className={cn('flex flex-1 items-start gap-3 rounded-[13px] px-3.5 text-left', option.footer ? 'pb-1.5 pt-3.5' : 'py-3.5')}>
              {option.icon && <span aria-hidden className={cn('mt-0.5 shrink-0', selected ? 'text-tool' : 'text-ink-subtle')}>{option.icon}</span>}
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-display text-[15px] font-semibold leading-5 text-ink">
                  {option.label}
                  {option.tag && <span className="rounded bg-white/[0.07] px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-ink-muted">{option.tag}</span>}
                </span>
                {option.detail && <span className={cn('mt-1 block text-xs leading-relaxed', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{option.detail}</span>}
              </span>
            </button>
            {option.footer}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The look this video gets: the brand's look (or the plain one) in one line, and
 * "Customize for this video", which opens the per-video look controls below it.
 */
export function LookCard({ name, badge, summary, colors, open, onToggle, controls, summaryTestId, className, children }: {
  name: string
  badge?: string | null
  summary: string
  /** The look's colors, shown as small overlapping dots. */
  colors: readonly string[]
  open: boolean
  onToggle: () => void
  /** The id of the controls this opens. */
  controls: string
  summaryTestId?: string
  className?: string
  /** The per-video controls, shown while open. */
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('glass rounded-2xl', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
        <span aria-hidden className="flex shrink-0">
          {colors.slice(0, 3).map((color, i) => (
            <span key={`${color}-${i}`} className={cn('h-[18px] w-[18px] rounded-full border-2 border-surface', i > 0 && '-ml-1.5')} style={{ background: color }} />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink">
            <span className="truncate">{name}</span>
            {badge && <span className="rounded bg-white/[0.07] px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-ink-muted">{badge}</span>}
          </p>
          <p className="mt-0.5 truncate text-2xs text-ink-subtle" data-testid={summaryTestId} title={summary}>{summary}</p>
        </div>
        <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle}
          className="ml-auto inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-tool hover:bg-tool/10">
          Customize for this video
          <ArrowRight aria-hidden className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        </button>
      </div>
      {open && <div id={controls} className="space-y-4 border-t border-line px-3.5 pb-4 pt-4">{children}</div>}
    </div>
  )
}

/** The Look card's dots: the hook text color, the captions' highlight color, and the dark caption box. */
export function lookColors(hookColor: string | undefined, captionPreset: string | undefined): string[] {
  return [hookColor || '#FFFFFF', (captionPreset && ENGINE_CAPTIONS[captionPreset]?.emphasis) || '#FFFFFF', '#2A2F3A']
}

/** The sticky summary card on the right: a mono label, a preview, then the page's primary action. */
export function MakerAside({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('glass rounded-[18px] p-4', className)}>
      <p className="eyebrow">{label}</p>
      {children}
    </div>
  )
}

/** A 9:16 frame for the summary card's preview. */
export function PhoneFrame({ children, className }: { children?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('relative mx-auto mt-3 aspect-[9/16] w-[180px] overflow-hidden rounded-[14px] bg-[radial-gradient(ellipse_40%_28%_at_50%_52%,#3A3F4C_0%,rgba(58,63,76,0)_100%),linear-gradient(180deg,#232733,#101218)] shadow-[0_20px_50px_rgb(0_0_0/0.5)]', className)}>
      {children}
    </div>
  )
}

/** "✓ Retakes and filler words cut": what the tool does, as a short list. */
export function Checklist({ items, className }: { items: readonly string[]; className?: string }): React.JSX.Element {
  return (
    <ul className={cn('mt-4 space-y-2 text-xs text-ink-muted', className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2"><Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tool" strokeWidth={2.5} /><span>{item}</span></li>
      ))}
    </ul>
  )
}
