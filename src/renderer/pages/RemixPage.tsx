import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Check, FileText, Film, FolderOpen, Pencil, Plus, Sparkles, Trash2, UserRound, Wand2, X } from 'lucide-react'
import type { AvatarSummary } from '../../shared/avatars'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import {
  BRAND_IDENTITY_TEMPLATE, estimateRemixCost, isRunning, MAX_BRAND_IDENTITY_CHARS, MAX_SOURCES, REMIX_ANGLES, REMIX_HOSTS, REMIX_ORDERS, REMIX_PRICES, REMIX_VOICES,
  remixSourceUrl, STANCE_LABELS, STYLE_LABELS,
  type BrandIdentity, type RemixAngle, type RemixDraft, type RemixEdit, type RemixHost, type RemixOrder, type RemixOutput, type RemixStatus
} from '../../shared/remix'
import type { Page as PageName } from '../components/Sidebar'
import { CaptionPresetPicker } from '../components/CaptionPresetPicker'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { Checkbox } from '../components/ui/Checkbox'
import { Dialog, DialogFooter } from '../components/ui/Dialog'
import { EmptyState } from '../components/ui/EmptyState'
import { Field, TextArea, TextInput } from '../components/ui/Field'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ProgressBar } from '../components/ui/ProgressBar'
import { onRadioKeyDown, Segmented } from '../components/ui/Segmented'
import { Select } from '../components/ui/Select'
import { SettingRow } from '../components/ui/SettingRow'
import { Switch } from '../components/ui/Switch'
import { getApi } from '../lib/ipc'
import { requestSettingsSection } from '../lib/settings-focus'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { useSettingsStore } from '../store/use-settings-store'

const COUNTS = [1, 3, 5, 10] as const

interface FormDraft {
  links: string
  filePath: string | null
  creator: string
  angle: RemixAngle
  order: RemixOrder
  brandIdentityId: string | null
  host: RemixHost
  avatarId: string | null
  voice: string
  count: number
  captionPreset: string
  includeCaptions: boolean
  aiLabelAck: boolean
  update: (patch: Partial<Omit<FormDraft, 'update'>>) => void
}

/** The form survives navigating away (e.g. to Settings to add a key). */
const useRemixForm = create<FormDraft>((set) => ({
  links: '', filePath: null, creator: '', angle: 'reaction', order: 'moment_first', brandIdentityId: null, host: 'lipsync', avatarId: null, voice: 'onyx',
  count: 3, captionPreset: DEFAULT_CAPTION_PRESET, includeCaptions: true, aiLabelAck: false,
  update: (patch) => set(patch)
}))

/** Links pasted one per line (or separated by spaces). */
export function parseLinks(value: string): { links: string[]; invalid: string[] } {
  const items = [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))]
  return { links: items.filter((item) => remixSourceUrl(item)), invalid: items.filter((item) => !remixSourceUrl(item)) }
}

const GRADE_TONES: Record<string, string> = {
  A: 'bg-emerald-400 text-black', B: 'bg-lime-300 text-black', C: 'bg-amber-300 text-black', D: 'bg-orange-400 text-black', F: 'bg-red-500 text-white'
}

export function RemixPage({ onNavigate }: { onNavigate: (page: PageName) => void }): React.JSX.Element {
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const pexelsConfigured = useSettingsStore((s) => s.pexelsConfigured)
  const form = useRemixForm()
  const [avatars, setAvatars] = useState<AvatarSummary[]>([])
  const [brands, setBrands] = useState<BrandIdentity[]>([])
  const [editing, setEditing] = useState<BrandIdentity | 'new' | null>(null)
  const [status, setStatus] = useState<RemixStatus | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let live = true
    getApi().avatars.list().then((list) => { if (live) setAvatars(list) }).catch(() => undefined)
    getApi().brandIdentities.list().then((list) => { if (live) setBrands(list) }).catch((err) => { if (live) setError(errorMessage(err)) })
    getApi().remix.status().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().remix.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [])

  const avatar = avatars.find((item) => item.id === form.avatarId) ?? avatars[0] ?? null
  const brand = brands.find((item) => item.id === form.brandIdentityId) ?? null
  const busy = isRunning(status)
  const reviewing = status?.phase === 'review'
  const { links, invalid } = parseLinks(form.links)
  const sources = form.filePath ? [form.filePath] : links
  const needsAvatar = form.host !== 'voice'
  const cost = estimateRemixCost(form.host, form.count)
  const blocker = !openrouterConfigured ? 'Add your OpenRouter key in Settings first'
    : sources.length === 0 ? 'Paste a video link or choose a file'
      : sources.length > MAX_SOURCES ? `Up to ${MAX_SOURCES} videos per run`
        : invalid.length > 0 && !form.filePath ? 'Fix the links that aren’t valid'
          : form.filePath && !form.creator.trim() ? 'Add the original creator’s name for the credit'
            : needsAvatar && !avatar ? 'Create an avatar in Avatar Studio, or use voice only'
              : !form.aiLabelAck ? 'Confirm you’ll turn on the AI label when you post' : null

  const openKeys = (): void => { requestSettingsSection('keys'); onNavigate('settings') }

  const chooseFile = async (): Promise<void> => {
    setError(null)
    try {
      const path = await getApi().dialog.selectVideo()
      if (path) form.update({ filePath: path, links: '' })
    } catch (err) { setError(errorMessage(err, 'That video could not be opened.')) }
  }

  const removeBrand = async (id: string): Promise<void> => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setConfirmDelete(false)
    setError(null)
    try {
      setBrands(await getApi().brandIdentities.remove(id))
      if (form.brandIdentityId === id) form.update({ brandIdentityId: null })
    } catch (err) { setError(errorMessage(err)) }
  }

  const plan = async (): Promise<void> => {
    setError(null)
    setLaunching(true)
    try {
      const started = await getApi().remix.start({
        sources, creator: sources.length === 1 ? form.creator : '', angle: form.angle, order: form.order, host: form.host,
        avatarId: needsAvatar ? avatar?.id ?? null : null, voice: form.voice, brandIdentityId: brand?.id ?? null, count: form.count,
        captionPreset: form.captionPreset, includeCaptions: form.includeCaptions, aiLabelAck: form.aiLabelAck
      })
      setStatus((previous) => previous?.id === started.id && previous.phase !== 'planning' ? previous : started)
    } catch (err) { setError(errorMessage(err, 'The remixes could not be started.')) }
    finally { setLaunching(false) }
  }

  return (
    <Page width="default">
      <PageHeader
        eyebrow="Studio"
        title="Remix"
        description="Turn any viral moment into your own take. Their moment hooks the viewer; your presenter's take, in your brand's voice, is the video."
      />

      {!openrouterConfigured && (
        <Callout tone="info" className="mt-4" title="Add your OpenRouter key to start" action={<Button size="sm" onClick={openKeys}>Open API keys</Button>}>
          Remix writes, voices and animates everything through your OpenRouter account.
        </Callout>
      )}
      <Callout tone="info" className="mt-4" title="Is it your own video, or do you have permission?"
        action={<Button size="sm" variant="secondary" onClick={() => onNavigate('clip')}>Go to Create</Button>}>
        Use Create for straight clips. Remix is for other people's videos: it keeps the borrowed part short, credits the creator, and makes your take the content.
      </Callout>
      {error && <Callout tone="danger" className="mt-4" onDismiss={() => setError(null)}>{error}</Callout>}

      {status && (reviewing || busy || status.phase === 'done' || status.phase === 'failed' || status.phase === 'cancelled') && (
        <div className="mt-5">
          {reviewing ? <ReviewPanel status={status} onError={setError} /> : (
            <Panel>
              <PanelHeader title={status.phase === 'planning' ? 'Writing your takes' : status.phase === 'rendering' ? 'Making your remixes' : 'Latest run'} />
              <div className="mt-4 space-y-3">
                <RemixProgress status={status} />
                {busy && (
                  <Button variant="secondary" disabled={status.detail === 'Cancelling…'} onClick={() => void getApi().remix.cancel()}>
                    {status.detail === 'Cancelling…' ? 'Cancelling…' : 'Cancel'}
                  </Button>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}

      <div className="mt-5 space-y-5">
        <Panel>
          <PanelHeader title="1 · The videos" description={`Any public videos with a moment worth reacting to. Paste one link per line, up to ${MAX_SOURCES}.`} />
          <div className="mt-4 space-y-3">
            {form.filePath ? (
              <div className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2.5">
                <Film className="h-4 w-4 shrink-0 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink" title={form.filePath}>{form.filePath.split(/[\\/]/).pop()}</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => form.update({ filePath: null })}>Use links instead</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <TextArea rows={3} value={form.links} aria-label="Video links" placeholder={'https://www.youtube.com/watch?v=…\nhttps://www.youtube.com/shorts/…'}
                  onChange={(e) => form.update({ links: e.target.value })} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn('text-2xs', invalid.length ? 'text-danger' : 'text-ink-subtle')}>
                    {invalid.length ? `Not a full link: ${invalid[0].slice(0, 60)}${invalid.length > 1 ? ` and ${invalid.length - 1} more` : ''}` : `${links.length} video${links.length === 1 ? '' : 's'}`}
                  </span>
                  <Button size="sm" variant="secondary" icon={<Film className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void chooseFile()}>Or choose a file</Button>
                </div>
              </div>
            )}
            {sources.length <= 1 && (
              <Field label={form.filePath ? 'Original creator' : 'Original creator (optional)'}
                hint={form.filePath ? 'Shown on screen while their moment plays.' : 'Shown on screen while their moment plays. Filled in from the link when left blank.'}>
                <TextInput value={form.creator} maxLength={80} placeholder="e.g. @coachname" onChange={(e) => form.update({ creator: e.target.value })} />
              </Field>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="2 · Style" description="How your presenter responds to the moment." />
          <div className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Remix style">
              {REMIX_ANGLES.map((angle) => {
                const selected = form.angle === angle.id
                return (
                  <button key={angle.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                    onClick={() => form.update({ angle: angle.id })}
                    className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                    <span className="block text-sm font-medium">{angle.label}</span>
                    <span className={cn('mt-0.5 block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{angle.description}</span>
                    <span className="mt-1 block text-2xs italic text-ink-subtle">{angle.example}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="block text-sm text-ink">Order</span>
                <span className="block text-2xs text-ink-subtle">{REMIX_ORDERS.find((order) => order.id === form.order)?.detail}</span>
              </div>
              <Segmented label="Order" size="sm" value={form.order} onChange={(order) => form.update({ order })}
                options={REMIX_ORDERS.map((order) => ({ value: order.id, label: order.label }))} />
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="3 · Your take" description="Your Brand Identity decides what your presenter believes, so every reaction sounds like your brand and only uses your real proof."
            action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>Add</Button>} />
          <div className="mt-4 space-y-3">
            <Select value={brand?.id ?? ''} onChange={(value) => { setConfirmDelete(false); form.update({ brandIdentityId: value || null }) }}
              options={[{ value: '', label: 'No brand identity', detail: 'A neutral expert voice, no results or numbers' },
                ...brands.map((item) => ({ value: item.id, label: item.name, detail: `${item.text.length.toLocaleString()} characters` }))]} />
            {brand && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(brand)}>Edit</Button>
                <Button size="sm" variant={confirmDelete ? 'danger' : 'ghost'} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void removeBrand(brand.id)}>
                  {confirmDelete ? 'Click again to delete' : 'Delete'}
                </Button>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="4 · Presenter" description="Who delivers the take." />
          <div className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Presenter">
              {REMIX_HOSTS.map((host) => {
                const selected = form.host === host.id
                return (
                  <button key={host.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                    onClick={() => form.update({ host: host.id })}
                    className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                    <span className="block text-xs font-medium">{host.label}</span>
                    <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{host.detail}</span>
                  </button>
                )
              })}
            </div>
            {needsAvatar && (avatars.length === 0 ? (
              <EmptyState icon={<UserRound />} title="No avatars yet" description="Create one in Avatar Studio from your photo, then come back."
                action={<Button size="sm" onClick={() => onNavigate('avatar')}>Open Avatar Studio</Button>} />
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Avatar">
                {avatars.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={avatar?.id === item.id} tabIndex={avatar?.id === item.id ? 0 : -1}
                    onKeyDown={onRadioKeyDown} onClick={() => form.update({ avatarId: item.id })}
                    className={cn('glass-tile glass-tile-hover overflow-hidden rounded-xl text-left', avatar?.id === item.id && 'glass-selected')}>
                    <img src={localFileUrl(item.portraitPath)} alt="" className="aspect-[9/16] w-full object-cover" />
                    <span className="block truncate px-2 py-1 text-2xs font-medium text-ink">{item.name}</span>
                  </button>
                ))}
              </div>
            ))}
            <Field label="Voice">
              <Select value={form.voice} onChange={(voice) => form.update({ voice })}
                options={REMIX_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.detail }))} />
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="5 · Write the takes" description={`First the AI finds the moments and writes and grades a take for each (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). You review and edit them, and only the ones you approve are made: ${cost.perRemixHigh - cost.perRemixLow < 0.01 ? `about $${cost.perRemixHigh.toFixed(2)}` : `about $${cost.perRemixLow.toFixed(2)}–$${cost.perRemixHigh.toFixed(2)}`} each.`} />
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-ink">Takes per video</span>
              <Segmented label="Takes per video" size="sm" value={String(form.count)} onChange={(value) => form.update({ count: Number(value) })}
                options={COUNTS.map((count) => ({ value: String(count), label: String(count) }))} />
            </div>
            <SettingRow title="Captions" description="Word-by-word captions across the whole video."
              control={<Switch label="Captions" checked={form.includeCaptions} onChange={(includeCaptions) => form.update({ includeCaptions })} />} />
            {form.includeCaptions && <CaptionPresetPicker value={form.captionPreset} onChange={(captionPreset) => form.update({ captionPreset })} />}
            {!pexelsConfigured && (
              <p className="text-2xs text-ink-subtle">
                Tip: add a free Pexels key in Settings → API keys for stock B-roll under the voice-over. Without it, those beats use stills.
              </p>
            )}
            <div className="flex items-start gap-2">
              <Checkbox checked={form.aiLabelAck} onChange={(aiLabelAck) => form.update({ aiLabelAck })} label="I'll turn on the AI-content label when I post" className="mt-px" />
              <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => form.update({ aiLabelAck: !form.aiLabelAck })}>
                I’ll turn on the platform’s AI-content label when I post these. TikTok, YouTube and Instagram require it for AI presenters and voices.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={launching} disabled={launching || busy || blocker !== null}
                tooltip={busy ? 'A remix run is in progress' : blocker ?? undefined} onClick={() => void plan()}>
                Write the takes
              </Button>
              {reviewing && <span className="text-2xs text-warning">Starting again replaces the takes waiting for review.</span>}
            </div>
          </div>
        </Panel>
      </div>

      {editing && <BrandIdentityDialog brand={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(list, id) => {
        setBrands(list); setEditing(null); form.update({ brandIdentityId: id })
      }} />}
    </Page>
  )
}

/** Planned takes: edit, drop, then make only the approved ones. */
function ReviewPanel({ status, onError }: { status: RemixStatus; onError: (message: string | null) => void }): React.JSX.Element {
  const ordered = useMemo(() => [...status.drafts].sort((a, b) => (b.grade?.score ?? -1) - (a.grade?.score ?? -1)), [status.drafts])
  const [edits, setEdits] = useState<Record<number, RemixEdit>>({})
  const [selected, setSelected] = useState<Set<number>>(() => new Set(ordered.filter((draft) => !draft.grade || 'ABC'.includes(draft.grade.letter)).map((draft) => draft.id)))
  const [working, setWorking] = useState(false)
  const value = (draft: RemixDraft): RemixEdit => edits[draft.id] ?? { id: draft.id, headline: draft.headline, intro: draft.intro, beats: draft.beats, close: draft.close }
  const change = (draft: RemixDraft, patch: Partial<RemixEdit>): void => setEdits((current) => ({ ...current, [draft.id]: { ...value(draft), ...patch } }))
  const toggle = (id: number): void => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const chosen = ordered.filter((draft) => selected.has(draft.id))
  const total = chosen.reduce((sum, draft) => sum + draft.estimateUsd, 0)

  const make = async (): Promise<void> => {
    setWorking(true); onError(null)
    try { await getApi().remix.render(chosen.map(value)) } catch (err) { onError(errorMessage(err, 'The remixes could not be started.')) }
    finally { setWorking(false) }
  }
  const discard = async (): Promise<void> => {
    setWorking(true); onError(null)
    try { await getApi().remix.discard() } catch (err) { onError(errorMessage(err)) } finally { setWorking(false) }
  }

  return (
    <Panel>
      <PanelHeader title={`Review your takes · ${status.drafts.length}`}
        description={`Graded on the Paid Creators frameworks, best first. Edit any line, untick the ones you don't want, then make the rest.${status.costUsd !== null ? ` Planning cost about $${status.costUsd.toFixed(2)}.` : ''}`} />
      <div className="mt-4 space-y-3">
        {status.warnings.map((warning) => <Callout key={warning} tone="warning">{warning}</Callout>)}
        {ordered.map((draft) => {
          const current = value(draft)
          const on = selected.has(draft.id)
          return (
            <div key={draft.id} className={cn('glass-tile space-y-3 rounded-2xl p-4', !on && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <Checkbox checked={on} onChange={() => toggle(draft.id)} label={`Make “${current.headline}”`} className="mt-1" />
                {draft.grade && (
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base font-black', GRADE_TONES[draft.grade.letter])}
                    title={`Grade ${draft.grade.letter} (${draft.grade.score.toFixed(1)}/10)${draft.grade.edited ? ' · graded before your edits' : ''}`}>{draft.grade.letter}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{STYLE_LABELS[draft.style]}</Badge>
                    <Badge>{STANCE_LABELS[draft.stance]}</Badge>
                    {draft.creator && <Badge>{draft.creator}</Badge>}
                    <Badge>about ${draft.estimateUsd.toFixed(2)}</Badge>
                  </div>
                  {draft.grade?.verdict && <p className="mt-1.5 text-xs text-ink-muted">{draft.grade.verdict}</p>}
                  {draft.grade?.fix && <p className="mt-0.5 text-xs text-ink-subtle"><Sparkles className="mr-1 inline h-3 w-3" />{draft.grade.fix}</p>}
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-ink-muted">
                <span className="font-medium text-ink">Their moment</span> · {((draft.endMs - draft.startMs) / 1000).toFixed(1)}s{draft.sourceTitle ? ` from “${draft.sourceTitle}”` : ''}
                <p className="mt-0.5 italic">“{draft.quote}”</p>
              </div>
              <Field label="Headline"><TextInput aria-label="Headline" value={current.headline} maxLength={120} onChange={(e) => change(draft, { headline: e.target.value })} /></Field>
              <Field label="Opening (presenter)"><TextArea aria-label="Opening (presenter)" rows={2} value={current.intro} onChange={(e) => change(draft, { intro: e.target.value })} /></Field>
              {current.beats.map((beat, index) => (
                <Field key={index} label={`Beat ${index + 1} (voice-over on “${beat.broll}”)`}>
                  <TextArea aria-label={`Beat ${index + 1}`} rows={2} value={beat.text} onChange={(e) => change(draft, { beats: current.beats.map((b, i) => i === index ? { ...b, text: e.target.value } : b) })} />
                </Field>
              ))}
              <Field label="Close (presenter)"><TextArea aria-label="Close (presenter)" rows={2} value={current.close} onChange={(e) => change(draft, { close: e.target.value })} /></Field>
              {draft.notes.map((note) => <p key={note} className="text-2xs text-warning"><AlertTriangle className="mr-1 inline h-3 w-3" />{note}</p>)}
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={working} disabled={working || chosen.length === 0} onClick={() => void make()}>
            Make {chosen.length === 1 ? '1 remix' : `${chosen.length} remixes`}{chosen.length ? ` · about $${total.toFixed(2)}` : ''}
          </Button>
          <Button variant="ghost" icon={<X className="h-4 w-4" />} disabled={working} onClick={() => void discard()}>Discard all</Button>
        </div>
      </div>
    </Panel>
  )
}

function RemixProgress({ status }: { status: RemixStatus }): React.JSX.Element | null {
  if (status.phase === 'failed') return <Callout tone="danger">{status.error ?? 'The remix failed.'}</Callout>
  if (status.phase === 'cancelled') {
    return status.detail === 'Discarded' ? <Callout tone="info">Takes discarded. Nothing was made.</Callout> : (
      <Callout tone="info" action={<Button size="sm" variant="secondary" onClick={() => void getApi().shell.openPath(status.folder)}>Open folder</Button>}>
        Remix cancelled. Any remixes already finished are in the folder. Steps already running on OpenRouter may still be charged.
      </Callout>
    )
  }
  if (isRunning(status)) {
    return (
      <div className="space-y-1.5">
        <div className="flex justify-between gap-3 text-xs text-ink-muted"><span className="truncate">{status.detail}</span><span>{status.percent}%</span></div>
        <ProgressBar value={status.percent} />
      </div>
    )
  }
  if (status.phase !== 'done') return null
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink">
          {status.outputs.length} remix{status.outputs.length === 1 ? '' : 'es'} ready · also in your Library for posting
          {status.costUsd !== null && <span className="text-ink-subtle"> · about ${status.costUsd.toFixed(2)} total</span>}
        </p>
        <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.openPath(status.folder)}>Open folder</Button>
      </div>
      {status.warnings.map((warning) => <Callout key={warning} tone="warning">{warning}</Callout>)}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {status.outputs.map((output) => <RemixCard key={output.path} output={output} />)}
      </div>
    </div>
  )
}

function RemixCard({ output }: { output: RemixOutput }): React.JSX.Element {
  const issues = output.checks.filter((check) => !check.ok).length
  return (
    <div className="glass-tile space-y-2 rounded-2xl p-3">
      <video src={localFileUrl(output.path)} controls preload="metadata" className="mx-auto aspect-[9/16] max-h-[380px] rounded-xl bg-black" />
      <p className="line-clamp-2 text-sm font-medium text-ink" title={output.headline}>{output.headline}</p>
      <div className="flex flex-wrap gap-1.5">
        {output.grade && <Badge>Grade {output.grade}</Badge>}
        <Badge>{STYLE_LABELS[output.style]}</Badge>
        <Badge>{STANCE_LABELS[output.stance]}</Badge>
        <Badge tone={issues ? 'warning' : 'success'}>{issues ? `${issues} to review` : 'Checks passed'}</Badge>
        <Badge>{output.durationSeconds.toFixed(0)}s · ${output.costUsd.toFixed(2)}</Badge>
      </div>
      <ul className="space-y-1">
        {output.checks.map((check) => (
          <li key={check.id} className={cn('flex gap-1.5 text-2xs', check.ok ? 'text-ink-muted' : 'text-warning')}>
            {check.ok ? <Check className="mt-px h-3 w-3 shrink-0 text-success" /> : <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
            <span>{check.label}</span>
          </li>
        ))}
      </ul>
      {output.warnings.map((warning) => <p key={warning} className="text-2xs text-warning">{warning}</p>)}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.showItemInFolder(output.path)}>Show in folder</Button>
        <Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.openPath(output.manifestPath)}>Source record</Button>
      </div>
    </div>
  )
}

function BrandIdentityDialog({ brand, onClose, onSaved }: { brand: BrandIdentity | null; onClose: () => void; onSaved: (list: BrandIdentity[], id: string) => void }): React.JSX.Element {
  const [name, setName] = useState(brand?.name ?? '')
  const [text, setText] = useState(brand?.text ?? '')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const importFile = async (): Promise<void> => {
    setError(null)
    try {
      const file = await getApi().brandIdentities.importFile()
      if (file) {
        setText(file.text); if (!name.trim()) setName(file.name)
        setNotice(file.truncated ? `That file is longer than ${MAX_BRAND_IDENTITY_CHARS.toLocaleString()} characters, so the end was cut off. Trim it so your proof and voice sections fit.` : null)
      }
    } catch (err) { setError(errorMessage(err)) }
  }
  const save = async (): Promise<void> => {
    setWorking(true); setError(null)
    try {
      const list = await getApi().brandIdentities.save({ ...(brand ? { id: brand.id } : {}), name, text })
      // The list is newest first, so a new identity is first.
      onSaved(list, brand?.id ?? list[0]?.id ?? '')
    } catch (err) { setError(errorMessage(err)) } finally { setWorking(false) }
  }

  return (
    <Dialog ref={ref} aria-label={brand ? 'Edit brand identity' : 'Add brand identity'} onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[640px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <h2 className="text-base font-semibold text-ink">{brand ? 'Edit brand identity' : 'Add brand identity'}</h2>
        <p className="text-xs text-ink-muted">
          Paste the Brand Identity document from your membership area, or import it as a .txt or .md file. The more it covers, the better the takes:
          what you believe and why, the myths you push back on, your method, your real results and testimonials, and how you talk.
        </p>
        <Field label="Name"><TextInput value={name} maxLength={120} placeholder="e.g. Pull-Up Lab" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Brand identity" aside={<span className="flex gap-3">
          {!text.trim() && <button type="button" className="text-2xs text-accent" onClick={() => setText(BRAND_IDENTITY_TEMPLATE)}>Start from template</button>}
          <button type="button" className="text-2xs text-accent" onClick={() => void importFile()}>Import file</button>
        </span>}
          hint={`${text.length.toLocaleString()} / ${MAX_BRAND_IDENTITY_CHARS.toLocaleString()} characters`}>
          <TextArea rows={14} value={text} maxLength={MAX_BRAND_IDENTITY_CHARS} onChange={(e) => setText(e.target.value)}
            placeholder={'Core promise: …\nWhat we believe: …\nMyths we push back on: …\nOur method: …\nProof (real results only): …\nVoice: …'} />
        </Field>
        {notice && <Callout tone="warning">{notice}</Callout>}
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={working} disabled={working || !name.trim() || text.trim().length < 40} onClick={() => void save()}>Save</Button>
      </DialogFooter>
    </Dialog>
  )
}
