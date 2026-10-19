import { useEffect, useMemo, useState } from 'react'
import { FirstRunGuide } from '../components/FirstRunGuide'
import { AlertTriangle, Camera, Check, Image as ImageIcon, Copy, FileText, Film, FolderOpen, Library, MessageCircle, Send, Sparkles, UserRound, Wand2, X } from 'lucide-react'
import type { AvatarSummary } from '../../shared/avatars'
import { REACTIONS } from '../../shared/avatars'
import {
  brandCtaKeyword, ctaLine, estimateRemixCost, isRunning, MAX_CTA_OFFER_CHARS, MAX_POST_CAPTION_CHARS, MAX_SOURCES,
  closeWithoutCta, normalizeCtaKeyword, AVATAR_VOICE, REMIX_ANGLES, REMIX_HOSTS, REMIX_ORDERS, REMIX_PRICES, REMIX_VOICES,
  REMIX_WORD_LIMITS, remixEditProblem, remixSourceUrl, STANCE_LABELS, STYLE_LABELS, wordCount,
  REMIX_FORMATS, headlineOnly, CAMERA_LAYOUTS, partsFor, AVATAR_REACTIONS_BETA, type CameraSettings, type RemixRecordings, type BrandIdentity, type RemixDraft, type RemixEdit, type RemixHost, type RemixOutput, type RemixStatus
} from '../../shared/remix'
import type { Page as PageName } from '../components/Sidebar'
import { CaptionPresetPicker } from '../components/CaptionPresetPicker'
import { VoicePreview } from '../components/VoicePreview'
import { HeadlineLookPicker } from '../components/HeadlineLookPicker'
import { CtaPicker } from '../components/CtaPicker'
import { partLabel, RemixRecorder } from '../components/RemixRecorder'
import { PauseReactReview } from '../components/PauseReactReview'
import { PAUSE_CAPTION_CHOICES, PAUSE_LAYOUTS, PAUSE_REACT_MAX_SECONDS } from '../../shared/pause-react'
import { useLowDiskGate } from '../components/LowDiskGate'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { Checkbox } from '../components/ui/Checkbox'
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
import { useRemixForm } from '../store/use-remix-form-store'
import { useBrands } from '../store/use-brand-store'
import { BrandPicker } from '../components/BrandIdentityDialog'
import { brandFormPatch, hasBrandMark } from '../../shared/brand-kit'
import { StylePresets } from '../components/StylePresets'
import { PostDialog, type PostableClip } from '../components/PostDialog'
import { toPostable } from '../components/ClipList'
import { clipFilePath } from '../lib/thumbnails'
import { parseJobOutput } from '../../shared/job-output'

const COUNTS = [1, 3, 5, 10] as const

/** Links pasted one per line (or separated by spaces). */
export function parseLinks(value: string): { links: string[]; invalid: string[] } {
  const items = [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))]
  return { links: items.filter((item) => remixSourceUrl(item)), invalid: items.filter((item) => !remixSourceUrl(item)) }
}

const GRADE_TONES: Record<string, string> = {
  A: 'bg-emerald-400 text-black', B: 'bg-lime-300 text-black', C: 'bg-amber-300 text-black', D: 'bg-orange-400 text-black', F: 'bg-red-500 text-white'
}

export function RemixPage({ onNavigate, onViewLibrary }: { onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element {
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const pexelsConfigured = useSettingsStore((s) => s.pexelsConfigured)
  const form = useRemixForm()
  const [avatars, setAvatars] = useState<AvatarSummary[]>([])
  const brands = useBrands((s) => s.brands)
  const loadBrands = useBrands((s) => s.load)
  const [status, setStatus] = useState<RemixStatus | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lowDisk = useLowDiskGate()

  useEffect(() => {
    let live = true
    getApi().avatars.list().then((list) => { if (live) setAvatars(list) }).catch(() => undefined)
    void loadBrands(true)
    getApi().remix.status().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().remix.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [loadBrands])

  const avatar = avatars.find((item) => item.id === form.avatarId) ?? avatars[0] ?? null
  const brand = brands.find((item) => item.id === form.brandIdentityId) ?? null
  const busy = isRunning(status)
  const reviewing = status?.phase === 'review'
  const { links, invalid } = parseLinks(form.links)
  const silent = form.format === 'silent'
  const image = form.format === 'image'
  // Pause & react: you on camera; their video pauses whenever you talk.
  const pause = form.format === 'pause_react'
  const sources = image ? (form.imagePath ? [form.imagePath] : []) : form.filePath ? [form.filePath] : links
  // Silent react: the avatar's reactions, or the member's own. Over a screenshot, and in a pause-and-react, it's always you.
  const host: RemixHost = image || pause ? 'camera' : silent ? (form.host === 'camera' ? 'camera' : 'still') : form.host
  const onCamera = host === 'camera'
  const needsAvatar = !onCamera && (silent || host !== 'voice')
  // The avatar's own voice (its clone or preset) unless a preset is picked here; voice-only can borrow it too.
  const usesAvatarVoice = form.voice === AVATAR_VOICE
  const showAvatars = !onCamera && (needsAvatar || usesAvatarVoice)
  const avatarVoiceName = avatar ? (avatar.voice.provider === 'clone' ? `${avatar.name}’s cloned voice` : `${avatar.name}’s voice (${avatar.voice.voice})`) : 'Your avatar’s voice'
  const cost = estimateRemixCost(host, form.count, 0.5, form.format)
  const reactionCount = avatar?.reactions?.length ?? 0
  const keyword = normalizeCtaKeyword(form.ctaKeyword)
  const brandKeyword = brand ? brandCtaKeyword(brand.text) : ''
  const blocker = !openrouterConfigured ? 'Add your OpenRouter key in Settings first'
    : image ? (!form.imagePath ? 'Choose a screenshot of the article or post'
      : !form.creator.trim() ? 'Add where the screenshot is from, for the credit'
        : keyword === null ? 'Use one word for the comment keyword, like SALES'
          : !form.clipRightsAck ? 'Confirm you’re allowed to share this screenshot' : null)
    : sources.length === 0 ? 'Paste a video link or choose a file'
      : pause && sources.length > 1 ? 'React to one video at a time: paste one link'
      : sources.length > MAX_SOURCES ? `Up to ${MAX_SOURCES} videos per run`
        : invalid.length > 0 && !form.filePath ? 'Fix the links that aren’t valid'
          : form.filePath && !form.creator.trim() ? 'Add the original creator’s name for the credit'
            : silent && !onCamera && !avatar ? 'Create an avatar in Avatar Studio first'
            : silent && !onCamera && reactionCount === 0 ? 'Make this avatar’s reactions in Avatar Studio first'
            : silent && !form.clipRightsAck ? 'Confirm you’re allowed to use these clips'
            : pause && !form.clipRightsAck ? 'Confirm you’re allowed to use this video'
            : needsAvatar && !avatar ? 'Create an avatar in Avatar Studio, or use voice only'
              : !onCamera && usesAvatarVoice && !avatar ? 'Create an avatar in Avatar Studio, or pick a preset voice'
              : keyword === null ? 'Use one word for the comment keyword, like SALES'
              : !onCamera && !form.aiLabelAck ? 'Confirm you’ll turn on the AI label when you post' : null

  const openKeys = (): void => { requestSettingsSection('keys'); onNavigate('settings') }

  const chooseImage = async (): Promise<void> => {
    setError(null)
    try {
      const path = await getApi().remix.selectImage()
      if (path) form.update({ imagePath: path })
    } catch (err) { setError(errorMessage(err, 'That screenshot could not be opened.')) }
  }

  const chooseFile = async (): Promise<void> => {
    setError(null)
    try {
      const path = await getApi().dialog.selectVideo()
      if (path) form.update({ filePath: path, links: '' })
    } catch (err) { setError(errorMessage(err, 'That video could not be opened.')) }
  }

  // Picking a different brand fills the style fields from its look (picking the same one again changes nothing).
  const chooseBrand = (next: BrandIdentity | null): void => {
    form.update({ brandIdentityId: next?.id ?? null, ...(next ? brandFormPatch(next.look, form) : {}) })
  }
  const showMark = hasBrandMark(brand?.look)

  const plan = async (): Promise<void> => {
    setError(null)
    setLaunching(true)
    try {
      // A nearly full drive asks first (and offers Free up space).
      if (!(await lowDisk.ensureSpace())) return
      const started = await getApi().remix.start({
        sources, creator: sources.length === 1 ? form.creator : '', angle: form.angle, order: form.order, host,
        avatarId: showAvatars ? avatar?.id ?? null : null, voice: form.voice, brandIdentityId: brand?.id ?? null, count: form.count,
        captionPreset: form.captionPreset, includeCaptions: form.includeCaptions, aiLabelAck: form.aiLabelAck,
        ctaKeyword: keyword ?? '', ctaOffer: keyword ? form.ctaOffer.trim() : '', format: form.format, clipRightsAck: (silent || image || pause) && form.clipRightsAck,
        headlineLook: form.headlineLook,
        ...(onCamera ? { camera: image ? { ...form.imageCamera, talk: true } : pause ? { ...form.pauseCamera, layout: form.pauseCamera.layout === 'greenscreen' ? 'filmed' : form.pauseCamera.layout, talk: true }
          : { ...form.camera, talk: silent && form.camera.talk } } : {}),
        ...(pause ? { pause: { layout: form.pauseLayout, captions: form.pauseCaptions } } : {}),
        ...(form.ctaId ? { ctaId: form.ctaId } : {}),
        ...(brand && showMark && form.showHandle ? { showHandle: true } : {})
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
      <FirstRunGuide page="remix" />

      {!openrouterConfigured && (
        <Callout tone="info" className="mt-4" title="Add your OpenRouter key to start" action={<Button size="sm" onClick={openKeys}>Open API keys</Button>}>
          Remix finds the moments, writes the takes and records the voice through your OpenRouter account.
        </Callout>
      )}
      <Callout tone="info" className="mt-4" title="Is it your own video, or do you have permission?"
        action={<Button size="sm" variant="secondary" onClick={() => onNavigate('clip')}>Go to Create</Button>}>
        Use Create for straight clips. Remix is for other people's videos: it keeps the borrowed part short, credits the creator, and makes your take the content.
      </Callout>
      {error && <Callout tone="danger" className="mt-4" onDismiss={() => setError(null)}>{error}</Callout>}
      {lowDisk.element}

      {status && (reviewing || busy || status.phase === 'done' || status.phase === 'failed' || status.phase === 'cancelled') && (
        <div className="mt-5">
          {reviewing ? (status.drafts.length === 1 && status.drafts[0].format === 'pause_react'
            ? <PauseReactReview key={status.id} status={status} onError={setError} />
            : <ReviewPanel key={status.id} status={status} onError={setError} />) : (
            <Panel>
              <PanelHeader title={status.phase === 'planning' ? 'Writing your takes' : status.phase === 'rendering' ? 'Making your remixes' : 'Latest run'} />
              <div className="mt-4 space-y-3">
                <RemixProgress status={status} onNavigate={onNavigate} onViewLibrary={onViewLibrary} />
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
        <StylePresets kind="remix" />
        {reviewing && (
          <Callout tone="info">The takes above use the settings they were planned with. Changes below apply to your next plan.</Callout>
        )}
        <Panel>
          <PanelHeader title={image ? '1 · The article or post' : pause ? '1 · The video you react to' : '1 · The videos'} description={image
            ? 'A screenshot of the article, post, tweet or headline you want to talk about. A long screenshot scrolls behind you as you talk.'
            : pause ? 'Paste one public video link or choose a file. From the Library, use ⋯ → Remix this clip. You can trim it to the part you react to next.'
            : `Any public videos with a moment worth reacting to. Paste one link per line, up to ${MAX_SOURCES}.`} />
          <div className="mt-4 space-y-3">
            {image ? (
              form.imagePath ? (
                <div className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <img src={localFileUrl(form.imagePath)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover object-top" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink" title={form.imagePath}>{form.imagePath.split(/[\\/]/).pop()}</span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void chooseImage()}>Change</Button>
                </div>
              ) : (
                <Button variant="secondary" icon={<ImageIcon className="h-4 w-4" />} disabled={busy} onClick={() => void chooseImage()}>Choose a screenshot</Button>
              )
            ) : form.filePath ? (
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
            {image ? (
              <Field label="Where it’s from" hint="Shown on screen as “Source: …” and in the caption, e.g. the publication or the account.">
                <TextInput value={form.creator} maxLength={80} placeholder="e.g. The Wall Street Journal or @handle" onChange={(e) => form.update({ creator: e.target.value })} />
              </Field>
            ) : sources.length <= 1 && (
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
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Remix format">
              {REMIX_FORMATS.map((item) => {
                const selected = form.format === item.id
                return (
                  <button key={item.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                    onClick={() => item.id !== form.format && form.update({
                      format: item.id,
                      // Each kind has its own permission promise (clips vs. a screenshot).
                      clipRightsAck: false
                    })}
                    className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className={cn('mt-0.5 block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{item.detail}</span>
                  </button>
                )
              })}
            </div>
            {pause ? (<>
              <p className="text-2xs text-ink-muted">
                Their video plays in a box while you’re the main picture. Whenever you talk it pauses on a held frame, and it plays on when you stop. Record here (press Space to pause it) or upload a phone recording where you paused it yourself. The AI writes the hook text and caption from what you said.
              </p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where their video goes">
                {PAUSE_LAYOUTS.map((item) => {
                  const selected = form.pauseLayout === item.id
                  return (
                    <button key={item.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                      onClick={() => form.update({ pauseLayout: item.id })}
                      className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                      <span className="block text-xs font-medium">{item.label}</span>
                      <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{item.detail}</span>
                    </button>
                  )
                })}
              </div>
            </>) : image ? (
              <p className="text-2xs text-ink-muted">
                You record yourself talking about the screenshot, here or on your phone. Then the AI turns what you said into the hook text and the caption with your call to action, and you can edit both before the video is made.
              </p>
            ) : silent ? (
              <p className="text-2xs text-ink-muted">
                The AI picks complete 10–45 second moments, writes the hook text above the clip, times your avatar’s reactions (watching, nodding, pointing, laughing) to what’s said, and writes the caption with your take and call to action.
              </p>
            ) : (<>
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
            </>)}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="3 · Your take" description="Your Brand Identity decides what your presenter believes, so every reaction sounds like your brand and only uses your real proof. Its look fills in the style below." />
          <div className="mt-4 space-y-3">
            <BrandPicker value={form.brandIdentityId} onChange={chooseBrand} noneDetail="A neutral expert voice, no results or numbers" />
            {showMark && (
              <SettingRow title="Show my handle" description={`Puts ${brand?.look?.handle ? `“${brand.look.handle}”` : 'your logo'} small in a corner of every video.`}
                control={<Switch label="Show my handle" checked={form.showHandle} onChange={(showHandle) => form.update({ showHandle })} />} />
            )}
            <div className="glass-tile space-y-3 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                <div>
                  <span className="block text-sm text-ink">Comment-keyword call to action</span>
                  <span className="block text-2xs text-ink-subtle">Turns viewers into DMs: every video ends with it, it shows on screen, and it closes the caption. Deliver what you promise with an auto-DM tool like ManyChat.</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <Field label="Comment keyword (optional)">
                  <TextInput aria-label="Comment keyword" value={form.ctaKeyword} maxLength={20} placeholder="e.g. SALES"
                    onChange={(e) => form.update({ ctaKeyword: e.target.value.toUpperCase().replace(/\s+/g, '') })} />
                </Field>
                <Field label="What they get">
                  <TextInput aria-label="What they get" value={form.ctaOffer} maxLength={MAX_CTA_OFFER_CHARS} disabled={!keyword}
                    placeholder="e.g. my free playbook" onChange={(e) => form.update({ ctaOffer: e.target.value })} />
                </Field>
              </div>
              {keyword === null ? <p className="text-2xs text-danger">One word: letters, numbers or a dash (2–20 characters).</p>
                : keyword && form.ctaId ? <p className="text-2xs text-ink-muted">Your CTA clip below plays at the end of every video (so the presenter doesn’t say one too), and the caption ends with: <span className="text-ink">“{ctaLine(keyword, form.ctaOffer)}”</span></p>
                : keyword ? (silent || image || pause
                  ? <p className="text-2xs text-ink-muted">“Comment {keyword}” shows on screen at the end, and the caption ends with: <span className="text-ink">“{ctaLine(keyword, form.ctaOffer)}”</span></p>
                  : <p className="text-2xs text-ink-muted">Every video ends with: <span className="text-ink">“{ctaLine(keyword, form.ctaOffer)}”</span></p>)
                  : brandKeyword ? (
                    <button type="button" className="text-2xs text-accent" onClick={() => form.update({ ctaKeyword: brandKeyword })}>
                      Use “{brandKeyword}” from your Brand Identity
                    </button>
                  ) : <p className="text-2xs text-ink-subtle">Leave it empty to end on the payoff (or your Brand Identity’s own call to action).</p>}
            </div>
            <div className="glass-tile space-y-3 rounded-xl p-3">
              <div>
                <span className="block text-sm text-ink">Your call-to-action clip (optional)</span>
                <span className="block text-2xs text-ink-subtle">A short video of you (or an image) played at the end of every video. It replaces the presenter’s spoken call to action. You can change it on any video afterward in the Library.</span>
              </div>
              <CtaPicker value={form.ctaId} onChange={(ctaId) => form.update({ ctaId })} />
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={image || pause ? '4 · You, on camera' : '4 · Presenter'} description={image ? 'You talk in front of the screenshot, like a green screen.' : pause ? 'You fill the screen under their video.' : silent ? 'Whose reactions play with the clip.' : 'Who delivers the take.'} />
          <div className="mt-4 space-y-4">
            {!image && !pause && <div className={cn('grid gap-2', silent ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')} role="radiogroup" aria-label="Presenter">
              {(silent
                ? [{ id: 'still' as const, label: 'My avatar’s reactions', detail: 'The reaction clips made in Avatar Studio', unavailable: undefined, beta: AVATAR_REACTIONS_BETA },
                    { id: 'camera' as const, label: 'Me, on camera', detail: 'You film your real reaction while the clip plays, or upload one', unavailable: undefined, beta: undefined }]
                : REMIX_HOSTS).map((host) => {
                const selected = (silent ? (form.host === 'camera' ? 'camera' : 'still') : form.host) === host.id
                return (
                  <button key={host.id} type="button" role="radio" aria-checked={selected} aria-disabled={host.unavailable ? true : undefined}
                    tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown} disabled={Boolean(host.unavailable)} title={host.unavailable}
                    onClick={() => form.update({ host: host.id })}
                    className={cn('glass-tile rounded-xl px-3 py-2.5 text-left', host.unavailable ? 'cursor-not-allowed opacity-50' : 'glass-tile-hover',
                      selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                    <span className="flex items-center gap-1.5 text-xs font-medium">{host.label}{host.unavailable && <span className="text-2xs font-normal text-ink-subtle">· Coming soon</span>}
                      {host.beta && !host.unavailable && <Badge tone="warning">Beta</Badge>}</span>
                    <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{host.unavailable ?? host.detail}</span>
                    {host.beta && !host.unavailable && <span className="mt-0.5 block text-2xs text-ink-subtle">{host.beta}</span>}
                  </button>
                )
              })}
            </div>}
            {onCamera && <CameraOptions mode={image ? 'image' : pause ? 'pause' : silent ? 'silent' : 'take'} value={image ? form.imageCamera : pause ? form.pauseCamera : form.camera}
              onChange={(camera) => form.update(image ? { imageCamera: camera } : pause ? { pauseCamera: camera } : { camera })} />}
            {showAvatars && (avatars.length === 0 ? (
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
            {silent && !onCamera && avatar && (reactionCount > 0
              ? <p className="text-2xs text-ink-muted">{reactionCount} of 6 reactions ready for {avatar.name}. More reactions make the video feel more natural.</p>
              : <Callout tone="info" title={`${avatar.name} has no reactions yet`} action={<Button size="sm" onClick={() => onNavigate('avatar')}>Open Avatar Studio</Button>}>
                  Make them once in Avatar Studio (AI from the picture, about $2.50, or upload your own short clips), then come back.
                </Callout>)}
            {!silent && !onCamera && <Field label="Voice">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Select value={form.voice} searchable onChange={(voice) => form.update({ voice })}
                    options={[{ value: AVATAR_VOICE, label: avatarVoiceName, detail: 'Set in Avatar Studio · clone your voice there' },
                      ...REMIX_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.detail }))]} />
                </div>
                {(!usesAvatarVoice || avatar) && (
                  <VoicePreview
                    request={usesAvatarVoice && avatar ? { kind: 'avatar', voice: avatar.voice, avatarId: avatar.id } : { kind: 'avatar', voice: { provider: 'elevenlabs', voice: form.voice } }}
                    name={usesAvatarVoice ? avatarVoiceName : form.voice} />
                )}
              </div>
            </Field>}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={image ? '5 · Record your take' : pause ? '5 · Record your reaction' : '5 · Write the takes'} description={image
            ? 'Next you record yourself talking about it, then the AI writes the hook text and caption from your words (about $0.02). You can edit both before the video is made.'
            : pause
            ? `Next you choose the part of their video and record yourself reacting to it (up to ${PAUSE_REACT_MAX_SECONDS / 60} minutes), here or on your phone. Then the AI writes the hook text and caption from what you said (about $${cost.perRemixLow.toFixed(2)}–$${cost.perRemixHigh.toFixed(2)}). You can edit both before the video is made.`
            : onCamera
            ? silent
              ? `The AI finds the moments and writes the hook text and caption (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). Then you film your reaction to each one you keep, and making them is free.`
              : `The AI finds the moments and writes and grades a take for each (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). You edit the lines, read them on camera from a teleprompter, and making them costs about $0.01 each for captions.`
            : silent
            ? `The AI finds the moments, writes the hook text and caption, and times the reactions (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). You review them, and making them is free: your reactions are reused.`
            : `First the AI finds the moments and writes and grades a take for each (about $${REMIX_PRICES.sourcePerHour.toFixed(2)} per hour of video). You review and edit them, and only the ones you approve are made: ${cost.perRemixHigh - cost.perRemixLow < 0.01 ? `about $${cost.perRemixHigh.toFixed(2)}` : `about $${cost.perRemixLow.toFixed(2)}–$${cost.perRemixHigh.toFixed(2)}`} each.`} />
          <div className="mt-4 space-y-4">
            {!image && !pause && <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="block text-sm text-ink">Takes per long video</span>
                <span className="block text-2xs text-ink-subtle">A reel, TikTok or Short (up to 3 minutes) always gets one take{silent ? ' that reacts to the whole video' : ''}.</span>
              </span>
              <Segmented label="Takes per video" size="sm" value={String(form.count)} onChange={(value) => form.update({ count: Number(value) })}
                options={COUNTS.map((count) => ({ value: String(count), label: String(count) }))} />
            </div>}
            <SettingRow title="Captions" description="Word-by-word captions across the whole video."
              control={<Switch label="Captions" checked={form.includeCaptions} onChange={(includeCaptions) => form.update({ includeCaptions })} />} />
            {form.includeCaptions && pause && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="block text-sm text-ink">Whose words</span>
                  <span className="block text-2xs text-ink-subtle">{PAUSE_CAPTION_CHOICES.find((item) => item.id === form.pauseCaptions)?.detail}</span>
                </span>
                <Segmented label="Whose words" size="sm" value={form.pauseCaptions} onChange={(pauseCaptions) => form.update({ pauseCaptions })}
                  options={PAUSE_CAPTION_CHOICES.map((item) => ({ value: item.id, label: item.label }))} />
              </div>
            )}
            {form.includeCaptions && <CaptionPresetPicker value={form.captionPreset} onChange={(captionPreset) => form.update({ captionPreset })} />}
            <div>
              <p className="mb-1 text-sm text-ink">Hook text at the top</p>
              <p className="mb-2.5 text-2xs text-ink-muted">How the headline over each video looks.</p>
              <HeadlineLookPicker value={form.headlineLook} onChange={(headlineLook) => form.update({ headlineLook })} />
            </div>
            {!pexelsConfigured && !silent && !onCamera && (
              <p className="text-2xs text-ink-subtle">
                Tip: add a free Pexels key in Settings → API keys for stock B-roll under the voice-over. Without it, those beats use stills.
              </p>
            )}
            {image && (
              <div className="flex items-start gap-2">
                <Checkbox checked={form.clipRightsAck} onChange={(clipRightsAck) => form.update({ clipRightsAck })} label="I'm allowed to share this screenshot" className="mt-px" />
                <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => form.update({ clipRightsAck: !form.clipRightsAck })}>
                  I’m allowed to share this screenshot, and I’m commenting on it: it’s public, my own, or shared with permission. The video credits where it’s from.
                </span>
              </div>
            )}
            {pause && (
              <div className="flex items-start gap-2">
                <Checkbox checked={form.clipRightsAck} onChange={(clipRightsAck) => form.update({ clipRightsAck })} label="I'm allowed to use this video" className="mt-px" />
                <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => form.update({ clipRightsAck: !form.clipRightsAck })}>
                  I’m allowed to use this video and I’m reacting to it: it’s my own, an affiliate’s, or from a creator who allows reactions. Pause & react plays much of it with its sound, and credits the creator on screen.
                </span>
              </div>
            )}
            {silent && (
              <div className="flex items-start gap-2">
                <Checkbox checked={form.clipRightsAck} onChange={(clipRightsAck) => form.update({ clipRightsAck })} label="I'm allowed to use these clips" className="mt-px" />
                <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => form.update({ clipRightsAck: !form.clipRightsAck })}>
                  I’m allowed to use these clips: my own, an affiliate’s, or a creator who openly allows clipping. Silent react plays up to 45 seconds of their video with its sound.
                </span>
              </div>
            )}
            {!onCamera && <div className="flex items-start gap-2">
              <Checkbox checked={form.aiLabelAck} onChange={(aiLabelAck) => form.update({ aiLabelAck })} label="I'll turn on the AI-content label when I post" className="mt-px" />
              <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => form.update({ aiLabelAck: !form.aiLabelAck })}>
                I’ll turn on the platform’s AI-content label when I post these. TikTok, YouTube and Instagram require it for AI presenters and voices.
              </span>
            </div>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={image || pause ? <Camera className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} loading={launching} disabled={launching || busy || blocker !== null}
                tooltip={busy ? 'A remix run is in progress' : blocker ?? undefined} onClick={() => void plan()}>
                {image || pause ? 'Continue to recording' : 'Write the takes'}
              </Button>
              {reviewing && <span className="text-2xs text-warning">Starting again replaces the {image || pause ? 'take' : 'takes'} waiting for review.</span>}
            </div>
          </div>
        </Panel>
      </div>

    </Page>
  )
}

/** How the member appears in their own recordings. */
function CameraOptions({ mode, value, onChange }: { mode: 'take' | 'silent' | 'image' | 'pause'; value: CameraSettings; onChange: (value: CameraSettings) => void }): React.JSX.Element {
  const silent = mode === 'silent'
  const image = mode === 'image'
  const pause = mode === 'pause'
  const details: Partial<Record<CameraSettings['layout'], string>> = image
    ? { filmed: 'The screenshot on top, you below as filmed', cutout: 'The screenshot on top, you cut out below', greenscreen: 'The screenshot fills the screen behind you' }
    : pause ? { filmed: 'Your real room behind you', cutout: 'You cut out, over a blur or your color' }
      : {}
  // Pause & react fills the frame with you: no green screen.
  const layouts = pause ? CAMERA_LAYOUTS.filter((layout) => layout.id !== 'greenscreen') : CAMERA_LAYOUTS
  const chosen = pause && value.layout === 'greenscreen' ? 'filmed' : value.layout
  return (
    <div className="glass-tile space-y-3 rounded-xl p-3">
      <div>
        <span className="flex items-center gap-1.5 text-sm text-ink"><Camera className="h-4 w-4" />Your background</span>
        <span className="block text-2xs text-ink-subtle">{image || pause ? 'You record here with your camera, or upload a video from your phone.' : 'After the AI writes the takes, you record each one here with your camera, or upload a video from your phone.'}</span>
      </div>
      <div className={cn('grid gap-2', pause ? 'sm:grid-cols-2' : 'sm:grid-cols-3')} role="radiogroup" aria-label="Your background">
        {layouts.map((layout) => {
          const selected = chosen === layout.id
          return (
            <button key={layout.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
              onClick={() => onChange({ ...value, layout: layout.id })}
              className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <span className="block text-xs font-medium">{layout.label}</span>
              <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{details[layout.id] ?? layout.detail}</span>
            </button>
          )
        })}
      </div>
      {chosen === 'cutout' && (
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Behind you" size="sm" value={value.backdrop} onChange={(backdrop) => onChange({ ...value, backdrop: backdrop as CameraSettings['backdrop'] })}
            options={[{ value: 'blur', label: image ? 'Blurred screenshot' : pause ? 'Blurred room' : 'Blurred clip' }, { value: 'brand', label: 'My color' }]} />
          {value.backdrop === 'brand' && (
            <label className="flex items-center gap-2 text-2xs text-ink-muted">
              <input type="color" aria-label="Background color" value={value.backdropColor} onChange={(e) => onChange({ ...value, backdropColor: e.target.value.toUpperCase() })}
                className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent" />
              {value.backdropColor}
            </label>
          )}
        </div>
      )}
      {chosen !== 'filmed' && <p className="text-2xs text-ink-subtle">Removing the background works best with even light on you and a little space between you and the wall.</p>}
      {silent && (
        <SettingRow title="Talk while reacting" description={value.talk ? 'Your voice goes over the clip, with captions of what you say. Wear headphones.' : 'Face only: just the clip’s sound, no microphone.'}
          control={<Switch label="Talk while reacting" checked={value.talk} onChange={(talk) => onChange({ ...value, talk })} />} />
      )}
    </div>
  )
}

/** Planned takes: edit, drop, then make only the approved ones. */
function ReviewPanel({ status, onError }: { status: RemixStatus; onError: (message: string | null) => void }): React.JSX.Element {
  const ordered = useMemo(() => [...status.drafts].sort((a, b) => (b.grade?.score ?? -1) - (a.grade?.score ?? -1)), [status.drafts])
  const [edits, setEdits] = useState<Record<number, RemixEdit>>({})
  const [selected, setSelected] = useState<Set<number>>(() => new Set(ordered.filter((draft) => !draft.grade || 'ABC'.includes(draft.grade.letter)).map((draft) => draft.id)))
  const [working, setWorking] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [recordings, setRecordings] = useState<RemixRecordings>({})
  const [recording, setRecording] = useState<RemixDraft | null>(null)
  const onCamera = status.onCamera === true
  // Article or post: one take over a screenshot; the AI writes its headline once you've recorded.
  const imageTake = status.drafts.length === 1 && status.drafts[0].format === 'image' ? status.drafts[0] : null
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [writeOwn, setWriteOwn] = useState(false)
  useEffect(() => {
    if (!onCamera) return
    getApi().remix.recordings().then(setRecordings).catch(() => undefined)
    if (imageTake) getApi().remix.moment(imageTake.id).then((moment) => setScreenshot(moment.path)).catch(() => undefined)
  }, [onCamera, status.id, imageTake])
  const value = (draft: RemixDraft): RemixEdit => edits[draft.id] ?? { id: draft.id, headline: draft.headline, intro: draft.intro, beats: draft.beats, close: draft.close, postCaption: draft.postCaption }
  const change = (draft: RemixDraft, patch: Partial<RemixEdit>): void => setEdits((current) => ({ ...current, [draft.id]: { ...value(draft), ...patch } }))
  const toggle = (id: number): void => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const chosen = ordered.filter((draft) => selected.has(draft.id))
  const total = chosen.reduce((sum, draft) => sum + draft.estimateUsd, 0)
  const problems = new Map(chosen.map((draft) => [draft.id, remixEditProblem(value(draft), draft.format)]))
  const missing = (draft: RemixDraft): string[] => onCamera
    ? partsFor(draft.format, value(draft).beats.length).filter((part) => !recordings[draft.id]?.[part]).map(partLabel)
    : []
  const unrecorded = chosen.filter((draft) => missing(draft).length > 0).length
  const blocked = [...problems.values()].some(Boolean) || unrecorded > 0

  const make = async (): Promise<void> => {
    setWorking(true); onError(null)
    try { await getApi().remix.render(chosen.map(value)) } catch (err) { onError(errorMessage(err, 'The remixes could not be started.')) }
    finally { setWorking(false) }
  }
  const write = async (): Promise<void> => {
    setWorking(true); onError(null)
    try { await getApi().remix.write() } catch (err) { onError(errorMessage(err, 'The headline could not be written.')) }
    finally { setWorking(false) }
  }
  const closeRecorder = (changed: boolean): void => {
    const draft = recording
    setRecording(null)
    // Just recorded over a screenshot with no headline yet: write it straight away (only for a new recording, so it isn't paid for twice).
    if (changed && draft?.format === 'image' && !draft.headline && !edits[draft.id]?.headline && recordings[draft.id]?.reaction) void write()
  }
  const discard = async (): Promise<void> => {
    if (!confirmDiscard) { setConfirmDiscard(true); return }
    setWorking(true); onError(null)
    try { await getApi().remix.discard() } catch (err) { onError(errorMessage(err)) } finally { setWorking(false) }
  }

  return (
    <Panel>
      <PanelHeader title={imageTake ? 'Your take on the screenshot' : `Review your takes · ${status.drafts.length}`}
        description={imageTake
          ? 'Record yourself talking about it. The AI then writes the hook text and caption from what you said, and you can edit both before the video is made.'
          : `Graded on the Paid Creators frameworks, best first. Edit any line, untick the ones you don't want, then make the rest.${status.costUsd !== null ? ` Planning cost about $${status.costUsd.toFixed(2)}.` : ''}`} />
      <div className="mt-4 space-y-3">
        {status.error && <Callout tone="danger">{status.error} {imageTake ? 'Your recording is still here, so you can try again.' : 'Your takes are still here, so you can try again.'}</Callout>}
        {status.warnings.map((warning, i) => <Callout key={i} tone="warning">{warning}</Callout>)}
        {ordered.map((draft, position) => {
          const current = value(draft)
          const on = selected.has(draft.id)
          const take = `take ${position + 1}`
          const image = draft.format === 'image'
          // Over a screenshot the headline comes after the recording: no need to flag it before then.
          const showText = !image || Boolean(draft.headline) || writeOwn || Boolean(edits[draft.id])
          const problem = on && showText ? problems.get(draft.id) : null
          const counter = (text: string, limit: number): string => `${wordCount(text)} / ${limit} words`
          const cta = /\b[Cc]omment\s+["“]?([A-Z0-9][A-Z0-9-]{1,19})\b/.exec(draft.close)?.[1]
          return (
            <div key={draft.id} className={cn('glass-tile space-y-3 rounded-2xl p-4', !on && 'opacity-60')}>
              {!image && <div className="flex items-start gap-3">
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
                    {!onCamera && <Badge>about ${draft.estimateUsd.toFixed(2)}</Badge>}
                  </div>
                  {draft.grade?.verdict && <p className="mt-1.5 text-xs text-ink-muted">{draft.grade.verdict}</p>}
                  {draft.grade?.fix && <p className="mt-0.5 text-xs text-ink-subtle"><Sparkles className="mr-1 inline h-3 w-3" />{draft.grade.fix}</p>}
                </div>
              </div>}
              {image ? (
                <div className="flex gap-3 rounded-xl bg-white/[0.04] p-2 text-xs text-ink-muted">
                  {screenshot && <img src={localFileUrl(screenshot)} alt="Your screenshot" className="h-28 w-24 shrink-0 rounded-lg object-cover object-top" />}
                  <div className="min-w-0 py-1">
                    <span className="font-medium text-ink">Source: {draft.creator}</span>
                    {draft.quote ? <p className="mt-1 line-clamp-4 italic">You said: “{draft.quote}”</p> : <p className="mt-1">Say what it says and what you think about it.</p>}
                  </div>
                </div>
              ) : <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-ink-muted">
                <span className="font-medium text-ink">Their moment</span> · {((draft.endMs - draft.startMs) / 1000).toFixed(1)}s{draft.sourceTitle ? ` from “${draft.sourceTitle}”` : ''}
                <p className={cn('mt-0.5 italic', draft.format === 'silent' && 'line-clamp-4')}>“{draft.quote}”</p>
              </div>}
              {onCamera && on && (() => {
                const left = missing(draft)
                const total = partsFor(draft.format, current.beats.length).length
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 px-3 py-2">
                    <Camera className="h-4 w-4 text-ink-muted" />
                    <span className="flex-1 text-xs text-ink-muted">
                      {left.length === 0 ? <span className="text-success"><Check className="mr-1 inline h-3 w-3" />Recorded</span>
                        : image ? 'Record yourself talking about this screenshot.'
                        : draft.format === 'silent' ? 'Film your reaction to this moment.'
                          : `Record your lines: ${total - left.length} of ${total} done.`}
                      {!headlineOnly(draft.format) && left.length === 0 && <span className="text-ink-subtle"> · Change a line? Record that part again.</span>}
                    </span>
                    <Button size="sm" variant={left.length ? 'primary' : 'secondary'} icon={<Camera className="h-3.5 w-3.5" />} disabled={working}
                      onClick={() => setRecording(draft)}>{left.length === 0 ? 'Review or redo' : left.length < total ? 'Keep recording' : 'Record'}</Button>
                    {image && left.length === 0 && (
                      <Button size="sm" variant={draft.headline ? 'ghost' : 'primary'} icon={<Sparkles className="h-3.5 w-3.5" />} disabled={working} loading={working}
                        onClick={() => void write()}>{draft.headline ? 'Rewrite from what I said' : 'Write my headline and caption'}</Button>
                    )}
                  </div>
                )
              })()}
              {image && !showText && (
                <button type="button" className="text-2xs text-accent" onClick={() => setWriteOwn(true)}>Or write the headline and caption yourself</button>
              )}
              {!onCamera && draft.format === 'silent' && draft.cues.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" aria-label={`Reactions, ${take}`}>
                  <span className="text-2xs text-ink-subtle">Reactions:</span>
                  {draft.cues.map((cue, i) => <Badge key={i}>{cue.at.toFixed(0)}s · {REACTIONS.find((item) => item.id === cue.reaction)?.label ?? cue.reaction}</Badge>)}
                </div>
              )}
              {showText && <Field label="Headline" hint={`${counter(current.headline, REMIX_WORD_LIMITS.headline)} · the hook text at the top (unless you chose no hook text) and the video’s title in your Library`}>
                <TextInput aria-label={`Headline, ${take}`} value={current.headline} maxLength={160} onChange={(e) => change(draft, { headline: e.target.value })} />
              </Field>}
              {!headlineOnly(draft.format) && (<>
              <Field label="Opening (presenter)" hint={counter(current.intro, REMIX_WORD_LIMITS.intro)}>
                <TextArea aria-label={`Opening (presenter), ${take}`} rows={2} value={current.intro} onChange={(e) => change(draft, { intro: e.target.value })} />
              </Field>
              {current.beats.map((beat, index) => (
                <Field key={index} label={`Beat ${index + 1} (voice-over on “${beat.broll}”)`} hint={counter(beat.text, REMIX_WORD_LIMITS.beat)}>
                  <TextArea aria-label={`Beat ${index + 1}, ${take}`} rows={2} value={beat.text} onChange={(e) => change(draft, { beats: current.beats.map((b, i) => i === index ? { ...b, text: e.target.value } : b) })} />
                </Field>
              ))}
              <Field label="Close (presenter)" hint={`${counter(closeWithoutCta(current.close), REMIX_WORD_LIMITS.close)}${cta ? ` · plus “Comment ${cta}…”, which is added back if you remove it` : ''}`}>
                <TextArea aria-label={`Close (presenter), ${take}`} rows={2} value={current.close} onChange={(e) => change(draft, { close: e.target.value })} />
              </Field>
              </>)}
              {showText && <Field label="Post caption" hint={`${(current.postCaption ?? '').length.toLocaleString('en-US')} / ${MAX_POST_CAPTION_CHARS.toLocaleString('en-US')} characters · filled in when you post from the Library; empty keeps the AI’s`}>
                <TextArea aria-label={`Post caption, ${take}`} rows={6} value={current.postCaption ?? ''} maxLength={MAX_POST_CAPTION_CHARS}
                  onChange={(e) => change(draft, { postCaption: e.target.value })} />
              </Field>}
              {edits[draft.id] && draft.grade && <p className="text-2xs text-ink-subtle">Graded before your edits.</p>}
              {problem && <p className="text-2xs text-danger" role="alert">{problem}</p>}
              {draft.notes.map((note, i) => <p key={i} className="text-2xs text-warning"><AlertTriangle className="mr-1 inline h-3 w-3" />{note}</p>)}
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={working} disabled={working || chosen.length === 0 || blocked}
            tooltip={unrecorded > 0 ? `Record yourself for ${unrecorded === 1 ? 'the take' : `${unrecorded} takes`} still marked “Record”`
              : imageTake && !value(imageTake).headline.trim() ? 'Write the headline first' : blocked ? 'Fix the takes marked in red first' : undefined} onClick={() => void make()}>
            Make {chosen.length === 1 ? '1 remix' : `${chosen.length} remixes`}{chosen.length ? ` · about $${total.toFixed(2)}` : ''}
          </Button>
          <Button variant={confirmDiscard ? 'danger' : 'ghost'} icon={<X className="h-4 w-4" />} disabled={working} onClick={() => void discard()}>
            {confirmDiscard ? 'Click again to discard' : imageTake ? 'Discard' : 'Discard all'}
          </Button>
        </div>
      </div>
      {recording && <RemixRecorder draft={recording} edit={value(recording)} recordings={recordings} talk={status.cameraTalk === true}
        onRecordings={setRecordings} onClose={closeRecorder} />}
    </Panel>
  )
}

function RemixProgress({ status, onNavigate, onViewLibrary }: { status: RemixStatus; onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element | null {
  if (status.phase === 'failed') return <Callout tone="danger">{status.error ?? 'The remix failed.'}</Callout>
  if (status.phase === 'cancelled') {
    if (status.detail === 'Discarded') return <Callout tone="info">Takes discarded. Nothing was made.</Callout>
    if (status.detail === 'Cancelled while planning') return <Callout tone="info">Cancelled before anything was made.</Callout>
    return (
      <Callout tone="info" action={<Button size="sm" variant="secondary" onClick={() => void getApi().shell.openPath(status.folder)}>Open folder</Button>}>
        Remix cancelled. Any remixes already finished are in the folder and your Library. Steps already running on OpenRouter may still be charged.
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
      {status.warnings.map((warning, i) => <Callout key={i} tone="warning">{warning}</Callout>)}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {status.outputs.map((output) => <RemixCard key={output.path} output={output} folder={status.folder} onNavigate={onNavigate} onViewLibrary={onViewLibrary} />)}
      </div>
    </div>
  )
}

/** The video's Library clip, read from the run's job_output.json (posting starts from it, like the Library). */
async function libraryClip(folder: string, path: string): Promise<PostableClip | null> {
  const output = parseJobOutput(await getApi().history.getJob(folder))
  const clip = output?.clips.find((item) => clipFilePath(item.s3_url) === path)
  return clip ? { ...toPostable(clip), library: { outputDir: folder, clipIndex: clip.clip_index } } : null
}

function RemixCard({ output, folder, onNavigate, onViewLibrary }: { output: RemixOutput; folder: string; onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element {
  const issues = output.checks.filter((check) => !check.ok).length
  const [copied, setCopied] = useState(false)
  const [posting, setPosting] = useState<PostableClip | null>(null)
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const post = async (): Promise<void> => {
    setOpening(true); setProblem(null)
    try {
      const clip = await libraryClip(folder, output.path)
      if (clip) setPosting(clip)
      else setProblem('This video isn’t in your Library yet. Open it from the Library to post it.')
    } catch (err) { setProblem(errorMessage(err, 'This video could not be opened for posting.')) }
    finally { setOpening(false) }
  }
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
      {output.warnings.map((warning, i) => <p key={i} className="text-2xs text-warning">{warning}</p>)}
      {output.postCaption && (
        <details className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-ink-muted">
          <summary className="cursor-pointer text-ink">Post caption</summary>
          <p className="mt-1.5 whitespace-pre-line" data-selectable>{output.postCaption}</p>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {output.postCaption && (
          <Button size="sm" variant="secondary" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            onClick={() => { void navigator.clipboard?.writeText(output.postCaption).then(() => setCopied(true)).catch(() => undefined) }}>
            {copied ? 'Copied' : 'Copy caption'}
          </Button>
        )}
        <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} loading={opening} disabled={opening} onClick={() => void post()}>Post or schedule</Button>
        {onViewLibrary && <Button size="sm" variant="secondary" icon={<Library className="h-3.5 w-3.5" />} onClick={() => onViewLibrary(folder)}>Open in Library</Button>}
        <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.showItemInFolder(output.path)}>Show in folder</Button>
        <Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.openPath(output.manifestPath)}>Source record</Button>
      </div>
      {problem && <p role="alert" className="text-2xs text-warning">{problem}</p>}
      {posting && <PostDialog clips={[posting]} onClose={() => setPosting(null)} onNavigate={onNavigate} />}
    </div>
  )
}
