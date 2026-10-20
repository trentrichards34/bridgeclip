import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, ChevronDown, Film, Flame, Lightbulb, ListOrdered, Play, Repeat2, Scissors, UserRound } from 'lucide-react'
import {
  DAILY_TARGET, planSlots, recentSource, streakDays, streakLabel, todayRuns, type PlanKind, type PlanRun
} from '../../shared/daily-plan'
import { IDEAS_ESTIMATE_USD, MAX_IDEA_TOPIC_CHARS } from '../../shared/edit-recording'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, isUrl } from '../lib/utils'
import { useDailyPlan } from '../store/use-daily-plan-store'
import { useDataVersion } from '../store/use-data-version-store'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { useBrands } from '../store/use-brand-store'
import { useDraftStore } from '../store/use-draft-store'
import { useRemixForm } from '../store/use-remix-form-store'
import { useStudioMode } from '../store/use-listicle-store'
import { useSettingsStore } from '../store/use-settings-store'
import { Button } from './ui/Button'
import { TextInput } from './ui/Field'
import type { Page } from './Sidebar'

const ICONS: Record<PlanKind, React.ReactNode> = {
  clip: <Scissors className="h-4 w-4" />, reaction: <Repeat2 className="h-4 w-4" />, talking: <Camera className="h-4 w-4" />,
  listicle: <ListOrdered className="h-4 w-4" />, avatar: <UserRound className="h-4 w-4" />
}

/** Reads the Library's finished runs; again on focus and whenever the Library changes. */
function useRuns(): PlanRun[] | null {
  const [runs, setRuns] = useState<PlanRun[] | null>(null)
  const version = useDataVersion('library')
  const live = useRef(true)
  const refresh = useCallback(() => {
    void getApi().history.list().then((list) => { if (live.current) setRuns(list) }, () => undefined)
  }, [])
  useEffect(() => {
    live.current = true
    refresh()
    window.addEventListener('focus', refresh)
    return () => { live.current = false; window.removeEventListener('focus', refresh) }
  }, [refresh, version])
  return runs
}

/**
 * "Today's 3" on Create: three videos to make today, from the member's goals
 * and Library. Each item opens the right page set up for it and ticks off on
 * its own when a video of that kind finishes today. The plan is free; only
 * "Suggest today's ideas" is a paid AI call (Film ideas).
 */
export function TodaysPlan({ onNavigate, onViewLibrary, className }: {
  onNavigate: (page: Page) => void
  onViewLibrary?: (outputDir: string) => void
  className?: string
}): React.JSX.Element | null {
  const runs = useRuns()
  const goals = useMemberPrefsStore((state) => state.profile.goals)
  const prefsLoaded = useMemberPrefsStore((state) => state.loaded)
  const openrouterConfigured = useSettingsStore((state) => state.openrouterConfigured)
  const plan = useDailyPlan()
  const brands = useBrands((state) => state.brands)
  const loadBrands = useBrands((state) => state.load)
  const createBrand = useDraftStore((state) => state.brandIdentityId)
  const [topic, setTopic] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void loadBrands() }, [loadBrands])

  if (!prefsLoaded || runs === null) return null
  const now = new Date()
  const source = recentSource(runs, now)
  const slots = planSlots(goals, source !== null)
  const today = todayRuns(runs, now)
  const done = slots.filter((kind) => (today.byKind[kind] ?? 0) > 0).length
  const streak = streakDays(runs, now)
  const brand = brands.find((item) => item.id === createBrand) ?? brands[0] ?? null
  const talkingIdea = plan.ideas.find((idea) => idea.format === 'camera') ?? null
  const reactionIdea = plan.ideas.find((idea) => idea.format !== 'camera') ?? null
  const link = plan.reactionLink.trim()

  const suggest = async (): Promise<void> => {
    setSuggesting(true); setError(null)
    try { plan.setIdeas(await getApi().edit.ideas({ brandIdentityId: brand?.id ?? null, topic, material: '' })) }
    catch (err) { setError(errorMessage(err, 'No ideas came back. Try again.')) } finally { setSuggesting(false) }
  }

  const start = (kind: PlanKind): void => {
    if (kind === 'clip' && source) { if (onViewLibrary) onViewLibrary(source.outputDir); else onNavigate('library'); return }
    if (kind === 'clip') { document.getElementById('video-source-heading')?.scrollIntoView({ block: 'center' }); return }
    if (kind === 'reaction') {
      const remix = useRemixForm.getState()
      if (link && isUrl(link)) { remix.applyStyle({ format: 'pause_react', host: 'camera' }); remix.update({ links: link, filePath: null }) }
      else remix.applyStyle({ format: 'moment_take', host: 'camera' })
      onNavigate('remix')
      return
    }
    if (kind === 'talking') { useDailyPlan.getState().handOff(talkingIdea); onNavigate('edit'); return }
    useStudioMode.getState().setMode(kind === 'listicle' ? 'listicle' : 'avatar')
    onNavigate('avatar')
  }

  const describe = (kind: PlanKind): { title: string; detail: React.ReactNode; action: string } => {
    switch (kind) {
      case 'clip': return { title: 'A clip from your latest long video', detail: <>From “{source?.title}”. Opens it in your Library: More clips from this video finds new moments and reuses its transcript.</>, action: 'Open' }
      case 'reaction': return {
        title: 'A reaction to something trending',
        detail: link ? 'Pause & react to the video you pasted.' : reactionIdea ? <>Idea: “{reactionIdea.hook}”. Paste a link to react to it, or find a moment in a long video.</> : 'Paste a link to a viral video to react to it, or leave it empty to find a moment in a long video (Moment + my take).',
        action: 'Start'
      }
      case 'talking': return { title: 'A talking-head video', detail: talkingIdea ? <>“{talkingIdea.hook}” · {talkingIdea.points.join(' · ')}</> : 'Film one idea straight to camera; Edit my recording turns it into a reel.', action: talkingIdea ? 'Film this' : 'Start' }
      case 'listicle': return { title: 'A top list', detail: 'A “5 tools” style video from screenshots and a voice-over. No camera.', action: 'Start' }
      default: return { title: 'An avatar video', detail: 'Your avatar reads a short script.', action: 'Start' }
    }
  }

  return (
    <section aria-labelledby="todays-plan-title" className={cn('glass rounded-3xl p-3.5 animate-fade-in', className)} data-testid="todays-plan">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={!plan.folded} aria-controls="todays-plan-items" onClick={() => plan.setFolded(!plan.folded)}>
          <Film className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0">
            <span id="todays-plan-title" className="block text-sm font-semibold text-ink">Today’s 3</span>
            <span className="block text-2xs text-ink-muted">Three videos a day. Each ticks off when a video of that kind lands in your Library today.</span>
          </span>
          <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-ink-muted transition-transform', !plan.folded && 'rotate-180')} />
        </button>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-2xs font-medium tabular text-ink" data-testid="todays-plan-count">{done} of {DAILY_TARGET} done</span>
        <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium', streak ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-ink-muted')} data-testid="todays-plan-streak" title={streakLabel(streak)}>
          <Flame className="h-3.5 w-3.5" />{streak ? `${streak} day${streak === 1 ? '' : 's'} in a row` : 'No streak yet'}
        </span>
      </div>
      {!plan.folded && (
        <div id="todays-plan-items" className="mt-3 space-y-2">
          <ol className="space-y-2" aria-label="Today’s videos">
            {slots.map((kind) => {
              const item = describe(kind)
              const made = (today.byKind[kind] ?? 0) > 0
              return (
                <li key={kind} className={cn('glass-tile flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5', made && 'opacity-80')} aria-label={`${item.title}${made ? ', done today' : ''}`} data-kind={kind} data-done={made}>
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', made ? 'bg-success text-black' : 'bg-white/[0.06] text-ink-muted')} aria-hidden>
                    {made ? <Check className="h-4 w-4" strokeWidth={3} /> : ICONS[kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium text-ink', made && 'line-through decoration-ink-subtle')}>{item.title}</p>
                    <p className="text-2xs text-ink-muted">{item.detail}</p>
                    {kind === 'reaction' && !made && (
                      <TextInput aria-label="Link to react to" className="mt-1.5 h-8 max-w-md text-xs" value={plan.reactionLink} placeholder="Paste a link to a trending video (optional)"
                        onChange={(e) => plan.setReactionLink(e.target.value)} />
                    )}
                  </div>
                  <Button size="sm" variant={made ? 'ghost' : 'secondary'} icon={<Play className="h-3.5 w-3.5" />} onClick={() => start(kind)}>{made ? 'Make another' : item.action}</Button>
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!brand && openrouterConfigured && (
              <TextInput aria-label="What you talk about" className="h-8 w-56 text-xs" value={topic} maxLength={MAX_IDEA_TOPIC_CHARS} placeholder="What you talk about, e.g. pricing" onChange={(e) => setTopic(e.target.value)} />
            )}
            <Button size="sm" variant="ghost" icon={<Lightbulb className="h-3.5 w-3.5" />} loading={suggesting} disabled={suggesting || !openrouterConfigured || (!brand && !topic.trim())}
              onClick={() => void suggest()}>{plan.ideas.length ? 'Suggest new ideas' : 'Suggest today’s ideas'}</Button>
            <span className="text-2xs text-ink-subtle">
              {!openrouterConfigured ? 'Ideas need your OpenRouter key.' : `From ${brand ? `your brand “${brand.name}”` : 'your topic'} and goals. One short AI call, about $${IDEAS_ESTIMATE_USD.toFixed(2)}. The plan itself is free.`}
            </span>
          </div>
          {today.total > 0 && <p className="text-2xs text-ink-subtle">{today.total === 1 ? '1 video' : `${today.total} videos`} finished today.</p>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </section>
  )
}

