import { HEADLINE_HIDE_AFTER_S, isHeadlineHideAfter, type HeadlineHideAfter } from '../../shared/headline-look'
import { cn } from '../lib/utils'
import { Segmented } from './ui/Segmented'
import { Select } from './ui/Select'

/** The choices the pages offer (the contract also takes 8 s, shown only when a look already has it). */
const SHOWN: readonly HeadlineHideAfter[] = [3, 5, 10, 15]

/** "Hide hook text": never (the whole video), or fade it out after a few seconds. A bar look keeps its bar. */
export function HideHookText({ value, onChange, bar, compact = false, className }: {
  value: number | undefined
  onChange: (hideAfterS: HeadlineHideAfter | undefined) => void
  /** The look is a bar (white, black or brand): the bar stays when the text fades. */
  bar: boolean
  compact?: boolean
  className?: string
}): React.JSX.Element {
  const current = isHeadlineHideAfter(value) ? value : undefined
  const choices = HEADLINE_HIDE_AFTER_S.filter((s) => SHOWN.includes(s) || s === current)
  const options = [{ value: 'never', label: 'Never' }, ...choices.map((s) => ({ value: String(s), label: `After ${s} s` }))]
  const picked = current === undefined ? 'never' : String(current)
  const choose = (next: string): void => onChange(next === 'never' ? undefined : Number(next) as HeadlineHideAfter)
  return (
    <div className={cn('space-y-1.5', className)} data-testid="hide-hook-text">
      <div className={cn('flex flex-wrap items-center gap-2', compact && 'gap-1.5')}>
        <span className="text-xs font-semibold text-ink">Hide hook text</span>
        {compact
          // Narrow side panels: a dropdown, never wider than the panel.
          ? <Select size="sm" className="w-32" aria-label="Hide hook text" value={picked} options={options} onChange={choose} />
          : <Segmented label="Hide hook text" size="sm" value={picked} options={options} onChange={choose} />}
      </div>
      <p className="text-2xs text-ink-subtle">
        {current === undefined
          ? 'The hook text stays on screen the whole video.'
          : bar ? 'The text fades out; the bar stays.' : `The hook text fades out ${current} seconds in.`}
      </p>
    </div>
  )
}
