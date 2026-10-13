import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Check, FileText, Film, FolderOpen, Pencil, Plus, Trash2, UserRound, Wand2 } from 'lucide-react'
import type { AvatarSummary } from '../../shared/avatars'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import {
  estimateRemixCost, MAX_BRAND_IDENTITY_CHARS, REMIX_ANGLES, REMIX_HOSTS, REMIX_VOICES, remixSourceUrl, STANCE_LABELS,
  type BrandIdentity, type RemixAngle, type RemixHost, type RemixOutput, type RemixStatus
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

interface RemixDraft {
  link: string
  filePath: string | null
  creator: string
  angle: RemixAngle
  brandIdentityId: string | null
  host: RemixHost
  avatarId: string | null
  voice: string
  count: number
  captionPreset: string
  includeCaptions: boolean
  aiLabelAck: boolean
  update: (patch: Partial<Omit<RemixDraft, 'update'>>) => void
}

/** The draft survives navigating away (e.g. to Settings to add a key). */
const useRemixDraft = create<RemixDraft>((set) => ({
  link: '', filePath: null, creator: '', angle: 'reaction', brandIdentityId: null, host: 'lipsync', avatarId: null, voice: 'onyx',
  count: 3, captionPreset: DEFAULT_CAPTION_PRESET, includeCaptions: true, aiLabelAck: false,
  update: (patch) => set(patch)
}))

export function RemixPage({ onNavigate }: { onNavigate: (page: PageName) => void }): React.JSX.Element {
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const pexelsConfigured = useSettingsStore((s) => s.pexelsConfigured)
  const draft = useRemixDraft()
  const [avatars, setAvatars] = useState<AvatarSummary[]>([])
  const [brands, setBrands] = useState<BrandIdentity[]>([])
  const [editing, setEditing] = useState<BrandIdentity | 'new' | null>(null)
  const [status, setStatus] = useState<RemixStatus | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getApi().avatars.list().then((list) => { if (live) setAvatars(list) }).catch(() => undefined)
    getApi().brandIdentities.list().then((list) => { if (live) setBrands(list) }).catch((err) => { if (live) setError(errorMessage(err)) })
    getApi().remix.status().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().remix.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [])

  const avatar = avatars.find((item) => item.id === draft.avatarId) ?? avatars[0] ?? null
  const brand = brands.find((item) => item.id === draft.brandIdentityId) ?? null
  const busy = status?.phase === 'running'
  const source = draft.filePath ?? draft.link.trim()
  const linkOk = Boolean(draft.filePath) || Boolean(remixSourceUrl(draft.link))
  const needsAvatar = draft.host !== 'voice'
  const cost = estimateRemixCost(draft.host, draft.count)
  const blocker = !openrouterConfigured ? 'Add your OpenRouter key in Settings first'
    : !linkOk ? 'Paste a video link or choose a file'
      : draft.filePath && !draft.creator.trim() ? 'Add the original creator’s name for the credit'
        : needsAvatar && !avatar ? 'Create an avatar in Avatar Studio, or use voice only'
          : !draft.aiLabelAck ? 'Confirm you’ll turn on the AI label when you post' : null

  const openKeys = (): void => { requestSettingsSection('keys'); onNavigate('settings') }

  const chooseFile = async (): Promise<void> => {
    setError(null)
    try {
      const path = await getApi().dialog.selectVideo()
      if (path) draft.update({ filePath: path, link: '' })
    } catch (err) { setError(errorMessage(err, 'That video could not be opened.')) }
  }

  const removeBrand = async (id: string): Promise<void> => {
    setError(null)
    try {
      setBrands(await getApi().brandIdentities.remove(id))
      if (draft.brandIdentityId === id) draft.update({ brandIdentityId: null })
    } catch (err) { setError(errorMessage(err)) }
  }

  const generate = async (): Promise<void> => {
    setError(null)
    setLaunching(true)
    try {
      const started = await getApi().remix.start({
        source, creator: draft.creator, angle: draft.angle, host: draft.host, avatarId: needsAvatar ? avatar?.id ?? null : null, voice: draft.voice,
        brandIdentityId: brand?.id ?? null, count: draft.count, captionPreset: draft.captionPreset, includeCaptions: draft.includeCaptions, aiLabelAck: draft.aiLabelAck
      })
      setStatus((previous) => previous?.id === started.id ? previous : started)
    } catch (err) { setError(errorMessage(err, 'The remix could not be started.')) }
    finally { setLaunching(false) }
  }

  return (
    <Page width="default">
      <PageHeader
        eyebrow="Studio"
        title="Remix"
        description="Turn any viral moment into your own take. A few seconds of the original set it up; your presenter's take, in your brand's voice, is the video."
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

      <div className="mt-5 space-y-5">
        <Panel>
          <PanelHeader title="1 · The video" description="Any public video with a moment worth reacting to." />
          <div className="mt-4 space-y-3">
            {draft.filePath ? (
              <div className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2.5">
                <Film className="h-4 w-4 shrink-0 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink" title={draft.filePath}>{draft.filePath.split(/[\\/]/).pop()}</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => draft.update({ filePath: null })}>Use a link instead</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <TextInput className="min-w-[240px] flex-1" value={draft.link} placeholder="https://www.youtube.com/watch?v=…" aria-label="Video link"
                  onChange={(e) => draft.update({ link: e.target.value })} />
                <Button variant="secondary" icon={<Film className="h-4 w-4" />} disabled={busy} onClick={() => void chooseFile()}>Choose file</Button>
              </div>
            )}
            {draft.link.trim() && !remixSourceUrl(draft.link) && <p className="text-2xs text-danger">Paste the full link, starting with https://</p>}
            <Field label={draft.filePath ? 'Original creator' : 'Original creator (optional)'}
              hint={draft.filePath ? 'Shown on screen while their moment plays.' : 'Shown on screen while their moment plays. Filled in from the link when left blank.'}>
              <TextInput value={draft.creator} maxLength={80} placeholder="e.g. @coachname" onChange={(e) => draft.update({ creator: e.target.value })} />
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="2 · Style" description="How your presenter responds to the moment." />
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Remix style">
            {REMIX_ANGLES.map((angle) => {
              const selected = draft.angle === angle.id
              return (
                <button key={angle.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                  onClick={() => draft.update({ angle: angle.id })}
                  className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                  <span className="block text-sm font-medium">{angle.label}</span>
                  <span className={cn('mt-0.5 block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{angle.description}</span>
                  <span className="mt-1 block text-2xs italic text-ink-subtle">{angle.example}</span>
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="3 · Your take" description="Your Brand Identity decides what your presenter believes, so every reaction sounds like your brand and only uses your real proof."
            action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>Add</Button>} />
          <div className="mt-4 space-y-3">
            <Select value={brand?.id ?? ''} onChange={(value) => draft.update({ brandIdentityId: value || null })}
              options={[{ value: '', label: 'No brand identity', detail: 'A neutral expert voice, no results or numbers' },
                ...brands.map((item) => ({ value: item.id, label: item.name, detail: `${item.text.length.toLocaleString()} characters` }))]} />
            {brand && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(brand)}>Edit</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void removeBrand(brand.id)}>Delete</Button>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="4 · Presenter" description="Who delivers the take." />
          <div className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Presenter">
              {REMIX_HOSTS.map((host) => {
                const selected = draft.host === host.id
                return (
                  <button key={host.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                    onClick={() => draft.update({ host: host.id })}
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
                  <button key={item.id} type="button" role="radio" aria-checked={avatar?.id === item.id} onClick={() => draft.update({ avatarId: item.id })}
                    className={cn('glass-tile glass-tile-hover overflow-hidden rounded-xl text-left', avatar?.id === item.id && 'glass-selected')}>
                    <img src={localFileUrl(item.portraitPath)} alt="" className="aspect-[9/16] w-full object-cover" />
                    <span className="block truncate px-2 py-1 text-2xs font-medium text-ink">{item.name}</span>
                  </button>
                ))}
              </div>
            ))}
            <Field label="Voice">
              <Select value={draft.voice} onChange={(voice) => draft.update({ voice })}
                options={REMIX_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.detail }))} />
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="5 · Make it" description={`About $${cost.perRemix.toFixed(2)} per remix, plus about $0.35 per hour of source video to transcribe and plan, on your OpenRouter account.`} />
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-ink">Remixes from this video</span>
              <Segmented label="Number of remixes" size="sm" value={String(draft.count)} onChange={(value) => draft.update({ count: Number(value) })}
                options={COUNTS.map((count) => ({ value: String(count), label: String(count) }))} />
            </div>
            <SettingRow title="Captions" description="Word-by-word captions across the whole video."
              control={<Switch label="Captions" checked={draft.includeCaptions} onChange={(includeCaptions) => draft.update({ includeCaptions })} />} />
            {draft.includeCaptions && <CaptionPresetPicker value={draft.captionPreset} onChange={(captionPreset) => draft.update({ captionPreset })} />}
            {!pexelsConfigured && (
              <p className="text-2xs text-ink-subtle">
                Tip: add a free Pexels key in Settings → API keys for stock B-roll under the voice-over. Without it, those beats use stills.
              </p>
            )}
            <div className="flex items-start gap-2">
              <Checkbox checked={draft.aiLabelAck} onChange={(aiLabelAck) => draft.update({ aiLabelAck })} label="I'll turn on the AI-content label when I post" className="mt-px" />
              <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => draft.update({ aiLabelAck: !draft.aiLabelAck })}>
                I’ll turn on the platform’s AI-content label when I post these. TikTok, YouTube and Instagram require it for AI presenters and voices.
              </span>
            </div>
            {status && <RemixProgress status={status} />}
            <div className="flex flex-wrap items-center gap-2">
              {busy ? (
                <Button variant="secondary" onClick={() => void getApi().remix.cancel()}>Cancel</Button>
              ) : (
                <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={launching} disabled={launching || blocker !== null}
                  tooltip={blocker ?? undefined} onClick={() => void generate()}>
                  Make {draft.count === 1 ? 'remix' : `${draft.count} remixes`}
                </Button>
              )}
              <span className="text-2xs text-ink-subtle">Takes a few minutes per remix. You can leave this page while it works.</span>
            </div>
          </div>
        </Panel>
      </div>

      {editing && <BrandIdentityDialog brand={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(list, id) => {
        setBrands(list); setEditing(null); draft.update({ brandIdentityId: id })
      }} />}
    </Page>
  )
}

function RemixProgress({ status }: { status: RemixStatus }): React.JSX.Element {
  if (status.phase === 'failed') return <Callout tone="danger">{status.error ?? 'The remix failed.'}</Callout>
  if (status.phase === 'cancelled') return <Callout tone="info">Remix cancelled. Steps already running on OpenRouter may still be charged.</Callout>
  if (status.phase === 'running') {
    return (
      <div className="space-y-1.5">
        <div className="flex justify-between gap-3 text-xs text-ink-muted"><span className="truncate">{status.detail}</span><span>{status.percent}%</span></div>
        <ProgressBar value={status.percent} />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink">
          {status.outputs.length} remix{status.outputs.length === 1 ? '' : 'es'} ready
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
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const importFile = async (): Promise<void> => {
    setError(null)
    try {
      const file = await getApi().brandIdentities.importFile()
      if (file) { setText(file.text); if (!name.trim()) setName(file.name) }
    } catch (err) { setError(errorMessage(err)) }
  }
  const save = async (): Promise<void> => {
    setWorking(true); setError(null)
    try {
      const list = await getApi().brandIdentities.save({ ...(brand ? { id: brand.id } : {}), name, text })
      const saved = brand ? list.find((item) => item.id === brand.id) : list.find((item) => item.name === name.replace(/\s+/g, ' ').trim()) ?? list[0]
      onSaved(list, saved?.id ?? list[0]?.id ?? '')
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
        <Field label="Brand identity" aside={<button type="button" className="text-2xs text-accent" onClick={() => void importFile()}>Import file</button>}
          hint={`${text.length.toLocaleString()} / ${MAX_BRAND_IDENTITY_CHARS.toLocaleString()} characters`}>
          <TextArea rows={14} value={text} maxLength={MAX_BRAND_IDENTITY_CHARS} onChange={(e) => setText(e.target.value)}
            placeholder={'Core promise: …\nWhat we believe: …\nMyths we push back on: …\nOur method: …\nProof (real results only): …\nVoice: …'} />
        </Field>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={working} disabled={working || !name.trim() || text.trim().length < 40} onClick={() => void save()}>Save</Button>
      </DialogFooter>
    </Dialog>
  )
}
