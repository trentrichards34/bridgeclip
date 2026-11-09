import { Check } from 'lucide-react'
import { hookTextProblem, type EditDecisions, type EditPlan } from '../../shared/edit-recording'
import { ROLE_LABELS, openingQuotes, tripleHookLabel } from '../../shared/triple-hook'
import { cn } from '../lib/utils'
import { Button } from './ui/Button'

/**
 * The headline and the Triple Hook (Paid Creators): which of the qualifier, main statement and twist the line you say
 * and the headline stack together, quoted exactly, and the headline options the plan found (your own words, exact
 * numbers kept), each one click. It follows the hook and the headline as they change.
 */
export function HeadlineCheck({ plan, decisions, disabled, onChange }: {
  plan: EditPlan
  decisions: EditDecisions
  disabled?: boolean
  onChange: (next: EditDecisions) => void
}): React.JSX.Element | null {
  const hook = plan.hooks.find((h) => h.id === decisions.hookId) ?? null
  if (!hook) return null
  const cut = new Set(decisions.cut)
  const spoken = plan.words.slice(hook.start, hook.end + 1).filter((_, k) => !cut.has(hook.start + k)).map((w) => w.text).join(' ')
  const headline = decisions.hookText.replace(/\s+/g, ' ').trim()
  const quotes = openingQuotes(spoken, headline)
  const options = (hook.options ?? []).filter((o) => !hookTextProblem(o.text))
  return (
    <section className="glass-tile space-y-2 rounded-2xl p-3" aria-labelledby="edit-headline-check-title" data-testid="edit-headline-check">
      <div>
        <h4 id="edit-headline-check-title" className="text-xs font-semibold text-ink">Headline and the Triple Hook</h4>
        <p className="text-2xs text-ink-muted" data-testid="edit-headline-label">{tripleHookLabel(spoken, headline)}</p>
      </div>
      <ul className="space-y-1 text-2xs" aria-label="Triple Hook elements">
        {quotes.map(({ role, quote, from }) => (
          <li key={role} className="flex gap-1.5" data-role={role}>
            <span className={cn('w-[98px] shrink-0', quote ? 'text-ink' : 'text-ink-subtle')}>{ROLE_LABELS[role]}</span>
            {quote
              ? <span className="min-w-0 text-ink-muted">“{quote}” <span className="text-ink-subtle">({from === 'headline' ? 'headline' : 'you say it'})</span></span>
              : <span className="text-ink-subtle">Missing</span>}
          </li>
        ))}
      </ul>
      {hook.repeated && headline === hook.text && (
        <p className="text-2xs text-ink-subtle" data-testid="edit-headline-repeated">The planned headline, “{hook.repeated}”, only repeated what you say, so it now uses your own words that add to it.</p>
      )}
      {options.length > 0 && (
        <ul className="space-y-1.5" aria-label="Headline options" data-testid="edit-headline-options">
          {options.map((option) => {
            const inUse = option.text === headline
            return (
              <li key={option.text} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-black/20 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-2xs text-ink">“{option.text}”</p>
                  <p className="text-2xs text-ink-subtle">{tripleHookLabel(spoken, option.text)}</p>
                </div>
                {inUse
                  ? <span className="inline-flex items-center gap-1 text-2xs text-success"><Check className="h-3 w-3" aria-hidden />In use</span>
                  : <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onChange({ ...decisions, hookText: option.text })}>Use this headline</Button>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
