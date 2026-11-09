import { cn } from '../../lib/utils'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  className?: string
}

export function Switch({ checked, onChange, disabled, label, className }: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full transition-[background,box-shadow] duration-200 ease-out',
        checked
          ? 'bg-accent shadow-[0_0_0_1px_rgb(var(--accent)/0.6),0_0_12px_rgb(var(--accent)/0.25)]'
          : 'bg-white/[0.08] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] hover:bg-white/[0.12]',
        disabled && 'opacity-40',
        className
      )}
    >
      <span
        className={cn(
          'block h-5 w-5 rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.45)] transition-[transform,background-color] duration-300 ease-spring motion-reduce:transition-none',
          checked ? 'translate-x-5 bg-accent-ink' : 'translate-x-0.5 bg-ink-muted'
        )}
      />
    </button>
  )
}
