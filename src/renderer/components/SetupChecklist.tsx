import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronUp, ListChecks, PlayCircle, UserRoundCog, X } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { requestSettingsSection, type SettingsSection } from '../lib/settings-focus'
import { useSettingsStore, useSetupState } from '../store/use-settings-store'
import { useAccountsStore } from '../store/use-accounts-store'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { useDraftStore } from '../store/use-draft-store'
import { useDataVersion } from '../store/use-data-version-store'
import { isPostableAccount, type ZernioPlatform } from '../../shared/zernio'
import { MAX_SAMPLE_VIDEO_LINK, sampleVideoTarget } from '../../shared/member-prefs'
import { goalLabels, remainingSetup, setupItems, type RunCounts, type SetupFacts, type SetupItem, type SetupItemId } from '../../shared/setup-checklist'
import { startGoal, useOnboarding } from '../store/use-onboarding-store'
import { useBrands } from '../store/use-brand-store'
import { BrandIdentityDialog } from './BrandIdentityDialog'
import { OpenRouterKeyField } from './SetupCard'
import { Button } from './ui/Button'
import { IconTile } from './ui/IconTile'
import { Field, TextInput } from './ui/Field'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'
import type { Page } from './Sidebar'

interface Counts { brandIdentities: number; ctas: number; avatars: number; runs: number; runsByKind: RunCounts }
const NO_RUNS: RunCounts = { clips: 0, aiReactions: 0, cameraReactions: 0, articles: 0, avatarVideos: 0 }

/** Reads what the checklist needs from the app's own state; re-read on focus and when the Library changes. */
function useSetupFacts(): { facts: SetupFacts; refresh: () => void } {
  const openrouter = useSettingsStore((state) => state.openrouterConfigured)
  const zernioKey = useSettingsStore((state) => state.zernioConfigured)
  const { toolsOk } = useSetupState()
  const accounts = useAccountsStore((state) => state.accounts)
  const postable = accounts.filter(isPostableAccount)
  const platformKey = [...new Set(postable.map((account) => account.platform))].sort().join(',')
  const [counts, setCounts] = useState<Counts>({ brandIdentities: 0, ctas: 0, avatars: 0, runs: 0, runsByKind: NO_RUNS })
  const [camera, setCamera] = useState<boolean | null>(null)
  const libraryVersion = useDataVersion('library')
  const live = useRef(true)
  const refresh = useCallback(() => {
    const api = getApi()
    const count = (read: () => Promise<unknown[]>): Promise<number | null> => read().then((list) => list.length, () => null)
    void Promise.all([
      count(() => api.brandIdentities.list()),
      count(() => api.ctas.list()),
      count(() => api.avatars.list()),
      api.history.list().then((list) => list.filter((entry) => entry.status === 'completed'), () => null)
    ]).then(([brandIdentities, ctas, avatars, finished]) => {
      // A failed read keeps what was known (never ticks an item off).
      if (!live.current) return
      const kinds = (test: (entry: NonNullable<typeof finished>[number]) => boolean): number => finished?.filter(test).length ?? 0
      setCounts((current) => ({
        brandIdentities: brandIdentities ?? current.brandIdentities, ctas: ctas ?? current.ctas, avatars: avatars ?? current.avatars, runs: finished?.length ?? current.runs,
        runsByKind: finished ? {
          clips: kinds((entry) => (entry.madeWith ?? 'create') === 'create'),
          aiReactions: kinds((entry) => entry.madeWith === 'remix' && (entry.remixKinds ?? []).includes('ai')),
          cameraReactions: kinds((entry) => entry.madeWith === 'remix' && (entry.remixKinds ?? []).includes('camera')),
          articles: kinds((entry) => entry.madeWith === 'remix' && (entry.remixKinds ?? []).includes('image')),
          avatarVideos: kinds((entry) => entry.madeWith === 'avatar'),
          editedRecordings: kinds((entry) => entry.madeWith === 'edit')
        } : current.runsByKind
      }))
    })
    // Optional: a renderer hot-reloaded over an older preload has no status bridge.
    void api.app.mediaAccessStatus?.().then((status) => {
      if (live.current) setCamera(status.camera === true && status.microphone === true ? true : status.camera === false || status.microphone === false ? false : null)
    }, () => undefined)
  }, [])
  useEffect(() => {
    live.current = true
    refresh()
    window.addEventListener('focus', refresh)
    return () => { live.current = false; window.removeEventListener('focus', refresh) }
  }, [refresh, libraryVersion])
  // Cached accounts only: no Zernio request from the checklist.
  useEffect(() => { if (zernioKey) void useAccountsStore.getState().hydrate().catch(() => {}) }, [zernioKey])
  const connectedPlatforms = zernioKey && platformKey ? platformKey.split(',') as ZernioPlatform[] : []
  return { facts: { openrouter, toolsOk, camera, zernioKey, postingAccounts: zernioKey ? postable.length : 0, connectedPlatforms, ...counts }, refresh }
}

/**
 * The setup path: a dismissible checklist on Create (and always in Settings),
 * made for the member's goals when their profile has some. Items tick
 * themselves off from real state; each one says why it matters, how to do it
 * and what it costs, and links to where it's done. It never blocks anything.
 * On Create, the first row asks for the OpenRouter key right there; once the key
 * is saved the checklist folds into a one-line progress bar that opens again.
 */
export function SetupChecklist({ onNavigate, inSettings = false, className }: {
  onNavigate: (page: Page) => void
  /** In Settings: always shown, with a switch to show it on Create again. */
  inSettings?: boolean
  className?: string
}): React.JSX.Element | null {
  const { facts, refresh } = useSetupFacts()
  const prefsLoaded = useMemberPrefsStore((state) => state.loaded)
  const dismissed = useMemberPrefsStore((state) => state.setupChecklistDismissed)
  const profile = useMemberPrefsStore((state) => state.profile)
  const sampleLink = useMemberPrefsStore((state) => sampleVideoTarget(state.sampleVideoLink))
  const [error, setError] = useState<string | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const items = setupItems(facts, profile)
  const left = remainingSetup(items)
  const done = items.filter((item) => item.done).length
  const goals = goalLabels(profile.goals)

  if (!inSettings && (!prefsLoaded || dismissed)) return null

  const goSettings = (section: SettingsSection): void => {
    if (inSettings) { document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' }); return }
    requestSettingsSection(section)
    onNavigate('settings')
  }
  const dismiss = (value: boolean): void => {
    setError(null)
    void useMemberPrefsStore.getState().saveApp({ setupChecklistDismissed: value }).catch((cause) => setError(errorMessage(cause, 'Could not save this choice.')))
  }
  const addCta = async (): Promise<void> => {
    setError(null)
    try { if (await getApi().ctas.add()) refresh() } catch (cause) { setError(errorMessage(cause, 'Could not add the call-to-action clip.')) }
  }
  const allowCamera = async (): Promise<void> => {
    setError(null)
    try {
      const access = await getApi().remix.mediaAccess()
      if (!access.camera || !access.microphone) setError('CreatorClips can’t use the camera or microphone. See “How” for turning it on, or upload a phone video instead.')
    } catch (cause) { setError(errorMessage(cause, 'Could not ask for the camera.')) }
    refresh()
  }
  const trySample = (): void => {
    if (!sampleLink) return
    useDraftStore.getState().update({ source: sampleLink })
    useOnboarding.getState().setGuide('clips')
    if (inSettings) onNavigate('clip')
    else document.getElementById('video-source-heading')?.scrollIntoView({ block: 'center' })
  }
  const start = (item: SetupItem): void => {
    if (!item.goal) return
    const page = startGoal(item.goal)
    if (!inSettings && page === 'clip') document.getElementById('first-run-guide')?.scrollIntoView({ block: 'start' })
    else onNavigate(page)
  }

  const actions: Record<SetupItemId, { label: string; run: () => void } | null> = {
    // On Create the key is typed into the row itself.
    openrouter: inSettings ? { label: 'Add key', run: () => goSettings('keys') } : null,
    tools: { label: 'Open system check', run: () => goSettings('system') },
    camera: { label: 'Allow camera', run: () => void allowCamera() },
    posting: facts.zernioKey ? { label: 'Connect accounts', run: () => onNavigate('accounts') } : { label: 'Add Zernio key', run: () => goSettings('keys') },
    brand: { label: 'Add your brand', run: () => setBrandOpen(true) },
    cta: { label: 'Choose a file', run: () => void addCta() },
    avatar: { label: 'Open Avatar Studio', run: () => onNavigate('avatar') },
    'first-clip': inSettings || profile.goals.length ? { label: 'Start', run: () => start(items.find((item) => item.id === 'first-clip')!) } : null,
    'first-ai-reaction': { label: 'Start', run: () => start(items.find((item) => item.id === 'first-ai-reaction')!) },
    'first-camera-reaction': { label: 'Start', run: () => start(items.find((item) => item.id === 'first-camera-reaction')!) },
    'first-article': { label: 'Start', run: () => start(items.find((item) => item.id === 'first-article')!) },
    'first-avatar-video': { label: 'Start', run: () => start(items.find((item) => item.id === 'first-avatar-video')!) },
    'first-edited-recording': { label: 'Start', run: () => onNavigate('edit') }
  }
  const openProfile = (): void => useOnboarding.getState().setOpen(true)
  const closeButton = !inSettings && <Button variant="ghost" size="sm" iconOnly aria-label="Close the setup checklist" title="Close. You can open it again in Settings."
    icon={<X className="h-4 w-4" />} onClick={() => dismiss(true)} />

  // With the key saved, Create shows one line of progress instead of the whole list.
  if (!inSettings && facts.openrouter && !expanded) {
    const percent = items.length ? Math.round((done / items.length) * 100) : 100
    return (
      <section aria-label="Get set up" className={cn('glass flex items-center gap-3 rounded-2xl py-1.5 pl-3.5 pr-1.5 animate-fade-in', className)} data-testid="setup-checklist" data-compact="true">
        <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', left ? 'text-accent' : 'bg-success text-black')} aria-hidden>
          {left ? <ListChecks className="h-4 w-4" /> : <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
          <div className={cn('h-full rounded-full', left ? 'bg-accent' : 'bg-success')} style={{ width: `${percent}%` }} />
        </div>
        <p className="min-w-0 flex-1 truncate text-xs text-ink-muted" role="status">
          <span className="font-medium text-ink">{done} of {items.length} set up</span>{left ? '' : ' · You’re all set'}
        </p>
        <Button variant="ghost" size="sm" aria-expanded={false} onClick={() => setExpanded(true)}>
          {left ? 'Continue setup' : 'Show steps'}<ChevronDown className="h-3.5 w-3.5" />
        </Button>
        {closeButton}
      </section>
    )
  }

  return (
    <section aria-label="Get set up" className={cn(!inSettings && 'glass rounded-3xl p-3.5 animate-fade-in', className)} data-testid="setup-checklist">
      <div className="flex items-start gap-3">
        {!inSettings && <IconTile tone={left ? 'accent' : 'success'}>{left ? <ListChecks /> : <Check strokeWidth={3} />}</IconTile>}
        <div className="min-w-0 flex-1">
          {!inSettings && <p className="eyebrow text-accent">{goals.length ? 'Your setup path' : 'Get set up'}</p>}
          <h2 className="mt-0.5 text-base font-semibold text-ink">{left ? `${left} step${left === 1 ? '' : 's'} left` : 'You’re all set'}</h2>
          <p className="mt-0.5 text-xs text-ink-muted" role="status">{done} of {items.length} done. Steps check off on their own when they’re finished.</p>
          {goals.length > 0 && <p className="mt-0.5 text-2xs text-ink-subtle" data-testid="setup-goals">Set up for: {goals.join(' · ')}</p>}
        </div>
        <Button variant="ghost" size="sm" icon={<UserRoundCog className="h-3.5 w-3.5" />} onClick={openProfile}>
          {profile.goals.length ? 'Edit profile' : 'Set up your profile'}
        </Button>
        {!inSettings && facts.openrouter && <Button variant="ghost" size="sm" aria-expanded onClick={() => setExpanded(false)}>
          Show less<ChevronUp className="h-3.5 w-3.5" />
        </Button>}
        {closeButton}
      </div>
      <ol className="mt-3 space-y-1">
        {items.map((item) => <ChecklistRow key={item.id} item={item} action={actions[item.id]}
          extra={item.id === 'first-clip' && !item.done && sampleLink ? <Button size="sm" icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={trySample}>Try it with a sample video</Button> : null}
          body={item.id === 'openrouter' && !item.done && !inSettings ? <OpenRouterKeyField className="ml-8 mt-2 max-w-xl" /> : null} />)}
      </ol>
      {error && <p role="alert" className="mt-2 px-1 text-xs text-danger">{error}</p>}
      {inSettings && <SetupChecklistSettings onShow={dismiss} />}
      {brandOpen && <BrandIdentityDialog brand={null} onClose={() => setBrandOpen(false)} onSaved={(list) => { useBrands.getState().setBrands(list); setBrandOpen(false); refresh() }} />}
    </section>
  )
}

function ChecklistRow({ item, action, extra, body }: { item: SetupItem; action: { label: string; run: () => void } | null; extra: React.ReactNode; body?: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const howId = `setup-how-${item.id}`
  const hasHow = !item.done && (item.why || item.how?.length || item.cost)
  return (
    <li className="rounded-xl px-2 py-1.5 hover:bg-white/[0.03]" data-setup-item={item.id} data-done={item.done}>
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        <span aria-hidden className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          item.done ? 'bg-success text-black' : 'shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.25)]')}>
          {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm', item.done ? 'text-ink-muted line-through decoration-white/20' : 'font-medium text-ink')}>
            {item.title}{item.optional && <span className="ml-1.5 text-2xs font-normal text-ink-subtle">Optional</span>}
            <span className="sr-only">{item.done ? ' (done)' : ' (not done yet)'}</span>
          </p>
          {!item.done && <p className="mt-0.5 text-xs text-ink-subtle">{item.detail}</p>}
        </div>
        {!item.done && <div className="flex shrink-0 items-center gap-1.5">
          {hasHow && <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={howId} aria-label={`How: ${item.title}`} onClick={() => setOpen((value) => !value)}>
            How<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </Button>}
          {extra}
          {action && <Button size="sm" variant="ghost" onClick={action.run} aria-label={`${action.label}: ${item.title}`}>
            {action.label}<ChevronRight className="h-3.5 w-3.5" />
          </Button>}
        </div>}
      </div>
      {body}
      {hasHow && open && (
        <div id={howId} className="ml-8 mt-2 space-y-1.5 rounded-xl bg-white/[0.03] px-3 py-2 text-xs text-ink-muted">
          {item.why && <p><span className="font-medium text-ink">Why: </span>{item.why}</p>}
          {item.how && item.how.length > 0 && <ol className="list-decimal space-y-0.5 pl-4">{item.how.map((step) => <li key={step}>{step}</li>)}</ol>}
          {item.cost && <p><span className="font-medium text-ink">Cost: </span>{item.cost}</p>}
        </div>
      )}
    </li>
  )
}

/** Settings only: show the checklist on Create again, and the optional sample video link. */
function SetupChecklistSettings({ onShow }: { onShow: (dismissed: boolean) => void }): React.JSX.Element {
  const { loaded, setupChecklistDismissed, sampleVideoLink, saveApp } = useMemberPrefsStore()
  const [draft, setDraft] = useState(sampleVideoLink)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setDraft(sampleVideoLink), [sampleVideoLink])
  const commit = async (): Promise<void> => {
    const value = draft.trim()
    if (value === sampleVideoLink) { setError(null); return }
    if (value && !sampleVideoTarget(value)) { setError('Use a video link that starts with https://.'); return }
    try {
      await saveApp({ sampleVideoLink: value })
      setError(null); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (cause) { setError(errorMessage(cause, 'The sample video link could not be saved.')) }
  }
  return (
    <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
      <SettingRow title="Show the checklist on Create" description="It stays here in Settings either way."
        control={<Switch label="Show the checklist on Create" checked={!setupChecklistDismissed} disabled={!loaded} onChange={(show) => onShow(!show)} />} />
      <Field label="Sample video link (optional)"
        hint={error ? undefined : saved ? 'Saved.' : 'A video you have permission to clip. With a link here, the checklist offers “Try it with a sample video”, which puts it in Create. Empty: no sample is offered.'}>
        <TextInput aria-label="Sample video link" value={draft} maxLength={MAX_SAMPLE_VIDEO_LINK} placeholder="https://…" disabled={!loaded}
          onChange={(event) => { setDraft(event.target.value); setError(null) }} onBlur={() => void commit()}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()} />
      </Field>
      {error && <p role="alert" className="-mt-1 px-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
