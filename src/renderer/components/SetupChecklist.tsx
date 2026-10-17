import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, ListChecks, PlayCircle, X } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { requestSettingsSection, type SettingsSection } from '../lib/settings-focus'
import { useSettingsStore, useSetupState } from '../store/use-settings-store'
import { useAccountsStore } from '../store/use-accounts-store'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { useDraftStore } from '../store/use-draft-store'
import { useDataVersion } from '../store/use-data-version-store'
import { isPostableAccount } from '../../shared/zernio'
import { MAX_SAMPLE_VIDEO_LINK, sampleVideoTarget } from '../../shared/member-prefs'
import { remainingSetup, setupItems, type SetupFacts, type SetupItem, type SetupItemId } from '../../shared/setup-checklist'
import { Button } from './ui/Button'
import { IconTile } from './ui/IconTile'
import { Field, TextInput } from './ui/Field'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'
import type { Page } from './Sidebar'

interface Counts { brandIdentities: number; ctas: number; avatars: number; runs: number }

/** Reads what the checklist needs from the app's own state; re-read on focus and when the Library changes. */
function useSetupFacts(): { facts: SetupFacts; refresh: () => void } {
  const openrouter = useSettingsStore((state) => state.openrouterConfigured)
  const zernioKey = useSettingsStore((state) => state.zernioConfigured)
  const { toolsOk } = useSetupState()
  const postingAccounts = useAccountsStore((state) => state.accounts.filter(isPostableAccount).length)
  const [counts, setCounts] = useState<Counts>({ brandIdentities: 0, ctas: 0, avatars: 0, runs: 0 })
  const libraryVersion = useDataVersion('library')
  const live = useRef(true)
  const refresh = useCallback(() => {
    const api = getApi()
    const count = (read: () => Promise<unknown[]>): Promise<number | null> => read().then((list) => list.length, () => null)
    void Promise.all([
      count(() => api.brandIdentities.list()),
      count(() => api.ctas.list()),
      count(() => api.avatars.list()),
      api.history.list().then((list) => list.filter((entry) => entry.status === 'completed').length, () => null)
    ]).then(([brandIdentities, ctas, avatars, runs]) => {
      // A failed read keeps what was known (never ticks an item off).
      if (live.current) setCounts((current) => ({
        brandIdentities: brandIdentities ?? current.brandIdentities, ctas: ctas ?? current.ctas, avatars: avatars ?? current.avatars, runs: runs ?? current.runs
      }))
    })
  }, [])
  useEffect(() => {
    live.current = true
    refresh()
    window.addEventListener('focus', refresh)
    return () => { live.current = false; window.removeEventListener('focus', refresh) }
  }, [refresh, libraryVersion])
  // Cached accounts only: no Zernio request from the checklist.
  useEffect(() => { if (zernioKey) void useAccountsStore.getState().hydrate().catch(() => {}) }, [zernioKey])
  return { facts: { openrouter, toolsOk, zernioKey, postingAccounts: zernioKey ? postingAccounts : 0, ...counts }, refresh }
}

/**
 * "Get set up": a dismissible checklist on Create (and always in Settings).
 * Items tick themselves off from real state; each one links to where it's done.
 * It never blocks anything.
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
  const sampleLink = useMemberPrefsStore((state) => sampleVideoTarget(state.sampleVideoLink))
  const [error, setError] = useState<string | null>(null)
  const items = setupItems(facts)
  const left = remainingSetup(items)
  const done = items.filter((item) => item.done).length

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
  const trySample = (): void => {
    if (!sampleLink) return
    useDraftStore.getState().update({ source: sampleLink })
    if (inSettings) onNavigate('clip')
    else document.getElementById('video-source-heading')?.scrollIntoView({ block: 'center' })
  }

  const actions: Record<SetupItemId, { label: string; run: () => void } | null> = {
    openrouter: { label: 'Add key', run: () => goSettings('keys') },
    tools: { label: 'Open system check', run: () => goSettings('system') },
    posting: facts.zernioKey ? { label: 'Connect an account', run: () => onNavigate('accounts') } : { label: 'Add Zernio key', run: () => goSettings('keys') },
    brand: { label: 'Open Remix', run: () => onNavigate('remix') },
    cta: { label: 'Choose a file', run: () => void addCta() },
    avatar: { label: 'Open Avatar Studio', run: () => onNavigate('avatar') },
    'first-clip': inSettings ? { label: 'Open Create', run: () => onNavigate('clip') } : null
  }

  return (
    <section aria-label="Get set up" className={cn(!inSettings && 'glass rounded-3xl p-3.5 animate-fade-in', className)} data-testid="setup-checklist">
      <div className="flex items-start gap-3">
        {!inSettings && <IconTile tone={left ? 'accent' : 'success'}>{left ? <ListChecks /> : <Check strokeWidth={3} />}</IconTile>}
        <div className="min-w-0 flex-1">
          {!inSettings && <p className="eyebrow text-accent">Get set up</p>}
          <h2 className="mt-0.5 text-base font-semibold text-ink">{left ? `${left} step${left === 1 ? '' : 's'} left` : 'You’re all set'}</h2>
          <p className="mt-0.5 text-xs text-ink-muted" role="status">{done} of {items.length} done. Steps check off on their own when they’re finished.</p>
        </div>
        {!inSettings && <Button variant="ghost" size="sm" iconOnly aria-label="Close the setup checklist" title="Close. You can open it again in Settings."
          icon={<X className="h-4 w-4" />} onClick={() => dismiss(true)} />}
      </div>
      <ol className="mt-3 space-y-1">
        {items.map((item) => <ChecklistRow key={item.id} item={item} action={actions[item.id]}
          extra={item.id === 'first-clip' && !item.done && sampleLink ? <Button size="sm" icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={trySample}>Try it with a sample video</Button> : null} />)}
      </ol>
      {error && <p role="alert" className="mt-2 px-1 text-xs text-danger">{error}</p>}
      {inSettings && <SetupChecklistSettings onShow={dismiss} />}
    </section>
  )
}

function ChecklistRow({ item, action, extra }: { item: SetupItem; action: { label: string; run: () => void } | null; extra: React.ReactNode }): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/[0.03] sm:flex-nowrap" data-setup-item={item.id} data-done={item.done}>
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
        {extra}
        {action && <Button size="sm" variant="ghost" onClick={action.run} aria-label={`${action.label}: ${item.title}`}>
          {action.label}<ChevronRight className="h-3.5 w-3.5" />
        </Button>}
      </div>}
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
