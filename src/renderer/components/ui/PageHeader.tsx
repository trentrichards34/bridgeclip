import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { usePageTool } from './page-tool'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Small label above the title. The sidebar group names ("Studio", "Workspace") give way to the tool chip. */
  eyebrow?: ReactNode
  /** Rendered above the title, e.g. a back link. */
  leading?: ReactNode
  className?: string
}

/** Old group labels that the tool chip replaces. */
const GROUP_EYEBROWS = new Set(['Studio', 'Workspace'])

/**
 * Signal page header: the tool chip (coloured dot and uppercase mono label),
 * a large Space Grotesk title and a muted subtitle. The glow behind it is
 * drawn by Layout in the same tool colour.
 */
export function PageHeader({ title, description, actions, eyebrow, leading, className }: PageHeaderProps): React.JSX.Element {
  const page = usePageTool()
  const customEyebrow = eyebrow !== undefined && !(typeof eyebrow === 'string' && GROUP_EYEBROWS.has(eyebrow)) ? eyebrow : null
  const Icon = page?.icon
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0 flex-1">
        {leading && <div className="mb-2">{leading}</div>}
        {page?.label && (
          <p className="tool-chip mb-3">
            <span aria-hidden className="tool-chip-dot">{Icon && <Icon className="h-3 w-3" strokeWidth={2.6} />}</span>
            {page.label}
          </p>
        )}
        {customEyebrow && <p className="eyebrow mb-1">{customEyebrow}</p>}
        {!page?.label && eyebrow && !customEyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="truncate pb-0.5 font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink xl:text-[34px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted xl:text-[14px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
