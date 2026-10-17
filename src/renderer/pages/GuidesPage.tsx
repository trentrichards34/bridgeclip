import { ArrowRight, UserRoundCog } from 'lucide-react'
import { GOALS, GUIDES, isVideoGoal, type GoalId } from '../../shared/onboarding'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { startGoal, useOnboarding } from '../store/use-onboarding-store'
import { Page as PageColumn } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import type { Page } from '../components/Sidebar'

/**
 * Guides: a short written how-to for every kind of video CreatorClips makes,
 * with the member's own goals first. "Start" opens the right page with its
 * guide shown at the top.
 */
export function GuidesPage({ onNavigate }: { onNavigate: (page: Page) => void }): React.JSX.Element {
  const goals = useMemberPrefsStore((state) => state.profile.goals)
  const order: GoalId[] = [...goals, ...GOALS.map((goal) => goal.id).filter((id) => !goals.includes(id))]
  return (
    <PageColumn width="narrow">
      <PageHeader title="Guides" description="Short how-tos for each kind of video. Yours come first."
        actions={<Button variant="ghost" icon={<UserRoundCog className="h-4 w-4" />} onClick={() => useOnboarding.getState().setOpen(true)}>
          {goals.length ? 'Edit your profile' : 'Set up your profile'}
        </Button>} />
      <nav aria-label="Guides" className="mt-4 flex flex-wrap gap-1.5">
        {order.map((id) => (
          <a key={id} href={`#guide-${id}`} className="glass-tile glass-tile-hover rounded-full px-3 py-1 text-xs text-ink-muted"
            onClick={(e) => { e.preventDefault(); document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }}>
            {GUIDES[id].title}
          </a>
        ))}
      </nav>
      <div className="mt-4 space-y-3">
        {order.map((id) => {
          const guide = GUIDES[id]
          const mine = goals.includes(id)
          return (
            <section key={id} id={`guide-${id}`} aria-labelledby={`guide-${id}-title`} className="glass scroll-mt-4 rounded-3xl p-4" data-testid="guide">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  {mine && <p className="eyebrow text-accent">In your profile</p>}
                  <h2 id={`guide-${id}-title`} className="mt-0.5 text-base font-semibold text-ink">{guide.title}</h2>
                  <p className="mt-0.5 text-sm text-ink-muted">{guide.summary}</p>
                </div>
                {isVideoGoal(id)
                  ? <Button size="sm" variant={mine ? 'primary' : 'secondary'} onClick={() => onNavigate(startGoal(id))} aria-label={`Start: ${guide.title}`}>Start<ArrowRight className="h-3.5 w-3.5" /></Button>
                  : <Button size="sm" variant={mine ? 'primary' : 'secondary'} onClick={() => onNavigate('accounts')} aria-label={`Open Accounts: ${guide.title}`}>Open Accounts<ArrowRight className="h-3.5 w-3.5" /></Button>}
              </div>
              <p className="mt-3 text-xs text-ink-subtle"><span className="font-medium text-ink-muted">You’ll need: </span>{guide.needs.join(' · ')}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink">
                {guide.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {guide.tips.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-subtle">
                  {guide.tips.map((tip) => <li key={tip}>Tip: {tip}</li>)}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </PageColumn>
  )
}
