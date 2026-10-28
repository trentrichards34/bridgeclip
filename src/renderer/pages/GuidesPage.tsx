import { ArrowRight, Lightbulb, UserRoundCog } from 'lucide-react'
import { GOALS, GUIDES, TOOL_GUIDES, TOOL_GUIDE_PAGES, goalAvailable, isVideoGoal, type GoalId, type Guide, type ToolGuideId } from '../../shared/onboarding'
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
  // Guides for tools switched off for launch (Avatar Studio) are left out.
  const order: GoalId[] = [...goals, ...GOALS.map((goal) => goal.id).filter((id) => !goals.includes(id))].filter(goalAvailable)
  // Then the tools that aren't profile goals (B-roll video, AI explainers).
  const all: Guide[] = [...order.map((id) => GUIDES[id]), ...(Object.keys(TOOL_GUIDES) as ToolGuideId[]).map((id) => TOOL_GUIDES[id])]
  const isMine = (id: Guide['id']): boolean => (goals as string[]).includes(id)
  const start = (guide: Guide, mine: boolean): React.JSX.Element => {
    const variant = mine ? 'primary' : 'secondary'
    const id = guide.id
    if (isVideoGoal(id)) return <Button size="sm" variant={variant} onClick={() => onNavigate(startGoal(id))} aria-label={`Start: ${guide.title}`}>Start<ArrowRight className="h-3.5 w-3.5" /></Button>
    if (id === 'edit-recording') return <Button size="sm" variant={variant} onClick={() => onNavigate('edit')} aria-label={`Start: ${guide.title}`}>Start<ArrowRight className="h-3.5 w-3.5" /></Button>
    if (id in TOOL_GUIDE_PAGES) return <Button size="sm" variant={variant} onClick={() => onNavigate(TOOL_GUIDE_PAGES[id as ToolGuideId])} aria-label={`Start: ${guide.title}`}>Start<ArrowRight className="h-3.5 w-3.5" /></Button>
    return <Button size="sm" variant={variant} onClick={() => onNavigate('accounts')} aria-label={`Open Accounts: ${guide.title}`}>Open Accounts<ArrowRight className="h-3.5 w-3.5" /></Button>
  }
  return (
    <PageColumn width="narrow">
      <PageHeader eyebrow="Workspace" title="Guides" description="Short how-tos for each kind of video. Yours come first."
        actions={<Button variant="ghost" icon={<UserRoundCog className="h-4 w-4" />} onClick={() => useOnboarding.getState().setOpen(true)}>
          {goals.length ? 'Edit your profile' : 'Set up your profile'}
        </Button>} />
      <nav aria-label="Guides" className="mt-4 flex flex-wrap gap-1.5">
        {all.map(({ id, title }) => (
          <a key={id} href={`#guide-${id}`} className="glass-tile glass-tile-hover rounded-full px-3 py-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
            onClick={(e) => { e.preventDefault(); document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }}>
            {title}
          </a>
        ))}
      </nav>
      <div className="mt-4 space-y-3">
        {all.map((guide) => {
          const id = guide.id
          const mine = isMine(id)
          return (
            <section key={id} id={`guide-${id}`} aria-labelledby={`guide-${id}-title`} className="glass scroll-mt-4 rounded-2xl p-4 xl:p-5" data-testid="guide">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  {mine && <p className="eyebrow text-accent">In your profile</p>}
                  <h2 id={`guide-${id}-title`} className="mt-0.5 font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">{guide.title}</h2>
                  <p className="mt-0.5 text-sm text-ink-muted">{guide.summary}</p>
                </div>
                {start(guide, mine)}
              </div>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-muted">
                <span className="eyebrow">You’ll need</span>
                {guide.needs.join(' · ')}
              </p>
              <ol className="mt-3 space-y-2 border-t border-line pt-3 text-sm text-ink">
                {guide.steps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span aria-hidden className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.05] font-mono text-[10px] tabular text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">{index + 1}</span>
                    <span className="min-w-0 flex-1 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
              {guide.tips.length > 0 && (
                <ul className="glass-tile mt-3 space-y-1 rounded-xl px-3 py-2.5 text-xs text-ink-muted">
                  {guide.tips.map((tip) => (
                    <li key={tip} className="flex gap-2">
                      <Lightbulb aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                      <span><span className="sr-only">Tip: </span>{tip}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </PageColumn>
  )
}
