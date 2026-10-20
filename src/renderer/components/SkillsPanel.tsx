import { Wand2 } from 'lucide-react'
import type { SkillId, SkillRow } from '../../shared/skills'
import { cn } from '../lib/utils'
import { Badge } from './ui/Badge'
import { Switch } from './ui/Switch'

/**
 * Skills: one on/off list over settings that already exist (see shared/skills.ts). Each switch writes the same
 * field as the detailed control; "More options" takes the member to that control.
 */
export function SkillsPanel({ rows, onToggle, onMore, intro, className }: {
  rows: SkillRow[]
  onToggle: (id: SkillId, on: boolean) => void
  /** Where a skill's detailed control is ("More options"); undefined for skills with nothing more to set. */
  onMore?: (id: SkillId) => (() => void) | undefined
  intro?: string
  className?: string
}): React.JSX.Element {
  return (
    <section aria-labelledby="skills-title" className={cn('glass-tile rounded-2xl p-3', className)} data-testid="skills-panel">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id="skills-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Wand2 className="h-4 w-4 text-accent" aria-hidden />Skills</h3>
        <p className="text-2xs text-ink-subtle">{intro ?? 'Turn each part on or off. The detailed settings stay below.'}</p>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Skills">
        {rows.map((skill) => {
          const more = onMore?.(skill.id)
          return (
            <li key={skill.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2" data-skill={skill.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                  {skill.label}
                  {skill.beta && <Badge tone="warning" className="h-4 px-1.5 text-[10px]">Beta</Badge>}
                </p>
                <p className="mt-0.5 text-2xs leading-snug text-ink-subtle">{skill.disabledReason ?? skill.note ?? skill.detail}</p>
                {more && (
                  <button type="button" onClick={more} className="mt-0.5 rounded text-2xs font-medium text-accent hover:underline focus-visible:underline">
                    More options
                  </button>
                )}
              </div>
              <Switch label={skill.label} checked={skill.on} disabled={skill.disabledReason !== null && !skill.on} onChange={(on) => onToggle(skill.id, on)} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
