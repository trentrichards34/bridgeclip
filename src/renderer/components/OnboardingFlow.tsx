import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-react'
import { availableGoals, type GoalId } from '../../shared/onboarding'
import { goalLabels, setupItems, type SetupFacts } from '../../shared/setup-checklist'
import { brandFormPatch } from '../../shared/brand-kit'
import { ZERNIO_PLATFORMS, ZERNIO_PLATFORM_NAMES, type ZernioPlatform } from '../../shared/zernio'
import type { BrandIdentity } from '../../shared/remix'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { useOnboarding } from '../store/use-onboarding-store'
import { useDraftStore } from '../store/use-draft-store'
import { useRemixForm } from '../store/use-remix-form-store'
import { useBrands } from '../store/use-brand-store'
import { useSettingsStore } from '../store/use-settings-store'
import { cn, errorMessage } from '../lib/utils'
import { BrandPicker } from './BrandIdentityDialog'
import { CtaPicker } from './CtaPicker'
import { Button } from './ui/Button'
import { Dialog, DialogFooter } from './ui/Dialog'

type Step = 'goals' | 'platforms' | 'brand' | 'path'
const STEPS: { id: Step; label: string }[] = [
  { id: 'goals', label: 'What you make' },
  { id: 'platforms', label: 'Where you post' },
  { id: 'brand', label: 'Brand and call to action' },
  { id: 'path', label: 'Your setup path' }
]

/** A card that toggles on and off (a checkbox the size of a card). */
function ChoiceCard({ checked, onChange, title, detail }: { checked: boolean; onChange: (checked: boolean) => void; title: string; detail?: string }): React.JSX.Element {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)}
      className={cn('glass-tile glass-tile-hover flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-shadow',
        checked && 'glass-selected')}>
      <span aria-hidden className={cn('mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px]',
        checked ? 'bg-accent text-accent-ink' : 'shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.25)]')}>
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {detail && <span className="mt-0.5 block text-xs text-ink-subtle">{detail}</span>}
      </span>
    </button>
  )
}

/**
 * "Set up your CreatorClips profile": what the member wants to make, where they
 * post, their brand and call to action, then the setup path made for them.
 * Opens on its own the first time; Skip (or Escape) closes it at any step,
 * and it can be opened again from the setup path or Settings.
 */
export function OnboardingFlow({ onNavigate }: { onNavigate: (page: 'clip') => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const profile = useMemberPrefsStore((state) => state.profile)
  const firstTime = profile.onboarding === 'new'
  const [step, setStep] = useState<Step>('goals')
  const [goals, setGoals] = useState<GoalId[]>(profile.goals)
  const [platforms, setPlatforms] = useState<ZernioPlatform[]>(profile.platforms)
  const [brandId, setBrandId] = useState<string | null>(() => useMemberPrefsStore.getState().defaultBrandId ?? useDraftStore.getState().brandIdentityId ?? useRemixForm.getState().brandIdentityId)
  const [ctaId, setCtaId] = useState<string | null>(() => useDraftStore.getState().ctaId)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const index = STEPS.findIndex((item) => item.id === step)

  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => { void useBrands.getState().load() }, [])
  // Each step starts with focus on its heading, so a screen reader hears where it is.
  useEffect(() => { document.getElementById('onboarding-step-heading')?.focus() }, [step])

  const toggle = <T,>(list: T[], item: T, on: boolean): T[] => on ? (list.includes(item) ? list : [...list, item]) : list.filter((value) => value !== item)

  const close = async (state: 'skipped' | 'done'): Promise<void> => {
    setWorking(true); setError(null)
    try {
      // A finished setup keeps the path visible on Create; a skip never overrides a finished one.
      await useMemberPrefsStore.getState().saveProfile({ goals, platforms, onboarding: state === 'skipped' && profile.onboarding === 'done' ? 'done' : state })
      if (state === 'done') await useMemberPrefsStore.getState().saveApp({ setupChecklistDismissed: false })
      useOnboarding.getState().setOpen(false)
      if (state === 'done') onNavigate('clip')
    } catch (cause) { setError(errorMessage(cause, 'Your profile could not be saved.')) } finally { setWorking(false) }
  }

  /** Use the brand (and call to action) as the default on Create and Remix: fills each form's look the same way picking it there does. */
  const chooseBrand = (brand: BrandIdentity | null): void => {
    setBrandId(brand?.id ?? null)
    // It becomes the default look every tool starts from (Brand look shows it as the default).
    useMemberPrefsStore.setState({ defaultBrandId: brand?.id ?? null })
    void useMemberPrefsStore.getState().saveApp({ defaultBrandId: brand?.id ?? null }).catch(() => undefined)
    const draft = useDraftStore.getState()
    const remix = useRemixForm.getState()
    if (!brand) {
      draft.update({ brandIdentityId: null, showHandle: false })
      remix.applyStyle({ brandIdentityId: null })
      return
    }
    if (draft.brandIdentityId !== brand.id) draft.update({ brandIdentityId: brand.id, ...brandFormPatch(brand.look, draft) })
    if (remix.brandIdentityId !== brand.id) remix.applyStyle({ brandIdentityId: brand.id, ...brandFormPatch(brand.look, remix) })
    if (brand.look?.ctaId) setCtaId(brand.look.ctaId)
  }
  const chooseCta = (id: string | null): void => {
    setCtaId(id)
    useDraftStore.getState().update({ ctaId: id })
    useRemixForm.getState().applyStyle({ ctaId: id })
  }

  const next = (): void => {
    setError(null)
    if (step === 'goals' && goals.length === 0) { setError('Pick at least one, or choose “Not sure yet”.'); return }
    setStep(STEPS[Math.min(STEPS.length - 1, index + 1)].id)
  }

  return (
    // One height for every step (the body scrolls), so the footer never jumps.
    <Dialog ref={ref} aria-labelledby="onboarding-title" panelClassName="h-[680px] max-w-[760px]" data-testid="onboarding"
      onKeyDown={(e) => {
        // Escape inside a dialog opened from here (a brand) belongs to that dialog.
        if (e.key === 'Escape' && !working && ref.current?.contains(e.target as Node)) void close('skipped')
      }}>
      <div className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-accent"><Sparkles className="mr-1 inline h-3.5 w-3.5 align-[-3px]" />{firstTime ? 'Welcome to CreatorClips' : 'Your profile'}</p>
          <h1 id="onboarding-title" className="mt-1 font-display text-xl font-semibold tracking-[-0.02em] text-ink">Set up your CreatorClips profile</h1>
          <ol className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-4" aria-label="Steps">
            {STEPS.map((item, i) => (
              <li key={item.id} aria-current={item.id === step ? 'step' : undefined} className="min-w-0">
                <span aria-hidden className={cn('block h-[3px] rounded-full transition-colors duration-200', i <= index ? 'bg-accent' : 'bg-white/[0.08]')} />
                <span className={cn('mt-1.5 block text-2xs leading-snug', i === index ? 'font-medium text-ink' : i < index ? 'text-ink-muted' : 'text-ink-subtle')}>
                  {i + 1} · {item.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
        {step !== 'path' && <Button variant="ghost" size="sm" disabled={working} onClick={() => void close('skipped')}>Skip for now</Button>}
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" disabled={working} icon={<X className="h-4 w-4" />} onClick={() => void close('skipped')} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {step === 'goals' && (
          <>
            <StepHeading title="What do you want to make?" detail="Pick everything you’re interested in. Your setup path only shows the steps these need, and you can change this anytime." />
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="What you want to make">
              {availableGoals().map((goal) => (
                <ChoiceCard key={goal.id} title={goal.label} detail={goal.detail} checked={goals.includes(goal.id)}
                  onChange={(on) => { setError(null); setGoals((list) => toggle(list, goal.id, on)) }} />
              ))}
            </div>
            <ChoiceCard title="Not sure yet: show me everything" detail="Picks all of the above. You can narrow it down anytime."
              checked={availableGoals().every((goal) => goals.includes(goal.id))}
              onChange={(on) => { setError(null); setGoals(on ? availableGoals().map((goal) => goal.id) : []) }} />
          </>
        )}

        {step === 'platforms' && (
          <>
            <StepHeading title="Where do you post?" detail="Your setup path asks you to connect these accounts if you post from CreatorClips." />
            <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Where you post">
              {ZERNIO_PLATFORMS.map((platform) => (
                <ChoiceCard key={platform} title={ZERNIO_PLATFORM_NAMES[platform]} checked={platforms.includes(platform)}
                  onChange={(on) => setPlatforms((list) => toggle(list, platform, on))} />
              ))}
            </div>
            {platforms.length > 0 && (
              <div className="glass-tile rounded-xl p-3">
                <ChoiceCard title="Post and schedule to them from CreatorClips" detail="Uses Zernio, a separate service with its own pricing. Leave this off to download and post yourself."
                  checked={goals.includes('posting')} onChange={(on) => setGoals((list) => toggle(list, 'posting', on))} />
              </div>
            )}
          </>
        )}

        {step === 'brand' && (
          <>
            <StepHeading title="Your brand and call to action" detail="Both are optional, and you can add them later. Whatever you pick here becomes the default on Clip and Remix." />
            <section aria-labelledby="onboarding-brand" className="space-y-2">
              <h3 id="onboarding-brand" className="text-sm font-medium text-ink">Your brand</h3>
              <p className="text-xs text-ink-subtle">Who you help, what you believe, your offer and your proof, plus your color, caption style and handle. Titles, hook text and takes are written in your voice. They never make up results: only facts from the video or the proof you write here.</p>
              <BrandPicker value={brandId} onChange={chooseBrand} noneLabel="No brand yet" noneDetail="Titles in a neutral voice" />
            </section>
            <section aria-labelledby="onboarding-cta" className="space-y-2 border-t border-white/[0.06] pt-4">
              <h3 id="onboarding-cta" className="text-sm font-medium text-ink">Call to action</h3>
              <p className="text-xs text-ink-subtle">A short video or image added to the end of your videos, like “Follow for more”.</p>
              <CtaPicker value={ctaId} onChange={chooseCta} compact />
            </section>
          </>
        )}

        {step === 'path' && <PathSummary goals={goals} platforms={platforms} />}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>

      <DialogFooter className="justify-between">
        <Button variant="ghost" disabled={working || index === 0} icon={<ArrowLeft className="h-4 w-4" />} onClick={() => { setError(null); setStep(STEPS[Math.max(0, index - 1)].id) }}>Back</Button>
        {step === 'path'
          ? <Button variant="primary" loading={working} disabled={working} icon={<Check className="h-4 w-4" />} onClick={() => void close('done')}>Show my setup path</Button>
          : <Button variant="primary" disabled={working} onClick={next}>Continue<ArrowRight className="h-4 w-4" /></Button>}
      </DialogFooter>
    </Dialog>
  )
}

function StepHeading({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return (
    <div>
      <h2 id="onboarding-step-heading" tabIndex={-1} className="font-display text-base font-semibold tracking-[-0.01em] text-ink focus:outline-none">{title}</h2>
      <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
    </div>
  )
}

/** The steps this profile needs, before the member sees them ticked off on Create. */
function PathSummary({ goals, platforms }: { goals: GoalId[]; platforms: ZernioPlatform[] }): React.JSX.Element {
  const openrouter = useSettingsStore((state) => state.openrouterConfigured)
  const zernioKey = useSettingsStore((state) => state.zernioConfigured)
  // A preview of the path's shape; the real ticks come from the setup path on Create.
  const facts: SetupFacts = {
    openrouter, toolsOk: null, camera: null, zernioKey, postingAccounts: 0, connectedPlatforms: [], brandIdentities: useBrands.getState().brands.length,
    ctas: 0, avatars: 0, runs: 0, runsByKind: { clips: 0, aiReactions: 0, cameraReactions: 0, articles: 0, avatarVideos: 0 }
  }
  // The same steps, in the same order, as the setup path on Create.
  const items = setupItems(facts, { goals, platforms })
  return (
    <>
      <StepHeading title="Your setup path" detail={`Made for: ${goalLabels(goals).join(' · ')}. It sits at the top of Clip and ticks itself off as you go, and each step has a short how-to.`} />
      <ol className="grid gap-1.5 sm:grid-cols-2" aria-label="Your setup path" data-testid="onboarding-path">
        {items.map((item, i) => (
          <li key={item.id} data-setup-item={item.id} className="glass-tile flex items-start gap-2.5 rounded-xl px-3 py-2">
            <span aria-hidden className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.05] font-mono text-[10px] tabular text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-snug text-ink">{item.title}{item.optional && <span className="ml-1.5 text-2xs font-normal text-ink-subtle">Optional</span>}</span>
              <span className="mt-0.5 line-clamp-2 text-2xs text-ink-subtle" title={item.why ?? item.detail}>{item.why ?? item.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-2xs text-ink-subtle">The system check runs on its own. The Guides page has a short how-to for every kind of video.</p>
    </>
  )
}
