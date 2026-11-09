import { BookOpen, X } from 'lucide-react'
import { GUIDES, type VideoGoalId } from '../../shared/onboarding'
import { goalPage, useOnboarding } from '../store/use-onboarding-store'
import { Button } from './ui/Button'
import { IconTile } from './ui/IconTile'

/**
 * The how-to for a first video of one kind, shown at the top of the page it's
 * made on while the member follows it (started from the setup path or the
 * Guides page). Closing it hides it; the Guides page keeps every how-to.
 */
export function FirstRunGuide({ page }: { page: 'clip' | 'remix' | 'avatar' }): React.JSX.Element | null {
  const active = useOnboarding((state) => state.guide)
  if (!active || goalPage(active) !== page) return null
  return <GuideCard goal={active} onClose={() => useOnboarding.getState().setGuide(null)} />
}

function GuideCard({ goal, onClose }: { goal: VideoGoalId; onClose: () => void }): React.JSX.Element {
  const guide = GUIDES[goal]
  return (
    <section id="first-run-guide" aria-labelledby="first-run-guide-title" className="glass mt-4 rounded-3xl p-3.5 animate-fade-in" data-testid="first-run-guide" data-guide={goal}>
      <div className="flex items-start gap-3">
        <IconTile tone="accent"><BookOpen /></IconTile>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-accent">Your first one</p>
          <h2 id="first-run-guide-title" className="mt-0.5 text-base font-semibold text-ink">{guide.title}</h2>
          <p className="mt-0.5 text-xs text-ink-muted">{guide.summary}</p>
        </div>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close the guide" title="Close. Every guide is on the Guides page." icon={<X className="h-4 w-4" />} onClick={onClose} />
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-9 text-sm text-ink">
        {guide.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      {guide.tips.length > 0 && (
        <ul className="mt-2 space-y-0.5 pl-9 text-xs text-ink-subtle">
          {guide.tips.map((tip) => <li key={tip}>Tip: {tip}</li>)}
        </ul>
      )}
    </section>
  )
}
