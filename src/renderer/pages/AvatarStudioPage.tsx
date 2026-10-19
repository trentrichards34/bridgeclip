import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FirstRunGuide } from '../components/FirstRunGuide'
import { create } from 'zustand'
import { hasBrandMark } from '../../shared/brand-kit'
import { useBrands } from '../store/use-brand-store'
import { AudioLines, Clapperboard, Film, FolderOpen, ListVideo, Mic, Plus, Repeat2, Send, Sparkles, Trash2, UserRound, Wand2, X } from 'lucide-react'
import {
  estimateRecreateCost, estimateRenderCost, estimateSpokenSeconds, firstLine, MAX_HOOK_CHARS, MAX_SCENES, MAX_SCENE_SECONDS, overlongScenes, type SceneQuality, RECREATE_MAX_SECONDS, RECREATE_MIN_SECONDS, type RecreateMode, MAX_SPOKEN_SECONDS, PRESET_VOICES, PRICES, AI_PORTRAIT_CANDIDATES, PORTRAIT_LOOKS, type PortraitLook, REACTIONS, scriptText, SCRIPT_LENGTHS,
  MAX_AVATAR_PICTURES, type AvatarRenderStatus, type AvatarScene, type AvatarScript, type AvatarSummary, type AvatarVideoStyle, type AvatarVoice, type LipSyncModel, type ScriptLength
} from '../../shared/avatars'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import { DEFAULT_HEADLINE_LOOK, type HeadlineLook } from '../../shared/headline-look'
import { parseJobOutput } from '../../shared/job-output'
import type { Page as PageName } from '../components/Sidebar'
import { BackgroundPicker } from '../components/BackgroundPicker'
import { CaptionPresetPicker } from '../components/CaptionPresetPicker'
import { CtaPicker } from '../components/CtaPicker'
import { HeadlineLookPicker } from '../components/HeadlineLookPicker'
import { PostDialog, type PostableClip } from '../components/PostDialog'
import { VoicePreview } from '../components/VoicePreview'
import { heygenPriceNote, HeygenCreateForm, HeygenStatus } from '../components/avatar/HeygenAvatar'
import { estimateHeygenVideoUsd, heygenEngine, heygenStage, HEYGEN_PRICES } from '../../shared/heygen'
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
import { clipFilePath } from '../lib/thumbnails'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { useSettingsStore } from '../store/use-settings-store'

/** The video draft survives navigating away (e.g. to Settings to add a key). */
type StudioStyle = AvatarVideoStyle | 'recreate'

interface RecreateDraft {
  sourcePath: string | null
  sourceSeconds: number
  startSeconds: number
  endSeconds: number
  mode: RecreateMode
  keepAudio: boolean
  rightsConfirmed: boolean
}

interface StudioDraft {
  avatarId: string | null
  style: StudioStyle
  recreate: RecreateDraft
  topic: string
  niche: string
  seconds: ScriptLength
  script: AvatarScript
  lipSync: LipSyncModel
  sceneQuality: SceneQuality
  /** Cinematic scenes kept while the talking-head style is selected, so switching back restores them. */
  cinematicScenes: AvatarScene[] | null
  captionPreset: string
  includeCaptions: boolean
  includeTitle: boolean
  backgroundVideo: string | null
  brandIdentityId: string | null
  headlineLook: HeadlineLook
  /** A call to action from the library, added to the end of the video. */
  ctaId: string | null
  /** The brand whose handle or logo goes in a corner (null: none). */
  handleBrandId: string | null
  update: (patch: Partial<Omit<StudioDraft, 'update'>>) => void
}

const EMPTY_SCRIPT: AvatarScript = { title: '', scenes: [{ narration: '', visual: '', featuresAvatar: true }] }

const useStudioDraft = create<StudioDraft>((set) => ({
  avatarId: null, style: 'talking',
  recreate: { sourcePath: null, sourceSeconds: 0, startSeconds: 0, endSeconds: 0, mode: 'replace', keepAudio: true, rightsConfirmed: false },
  topic: '', niche: '', seconds: 30, script: EMPTY_SCRIPT, lipSync: 'avatar-iv', sceneQuality: 'standard', cinematicScenes: null,
  captionPreset: DEFAULT_CAPTION_PRESET, includeCaptions: true, includeTitle: true, backgroundVideo: null, brandIdentityId: null,
  headlineLook: DEFAULT_HEADLINE_LOOK, ctaId: null, handleBrandId: null,
  update: (patch) => set(patch)
}))

function voiceLabel(voice: AvatarVoice): string {
  return voice.provider === 'elevenlabs' ? voice.voice : 'Cloned voice'
}

export function AvatarStudioPage({ onNavigate, onViewLibrary }: { onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string, clipIndex?: number) => void }): React.JSX.Element {
  const falConfigured = useSettingsStore((s) => s.falConfigured)
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const heygenConfigured = useSettingsStore((s) => s.heygenConfigured)
  const draft = useStudioDraft()
  const [avatars, setAvatars] = useState<AvatarSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [status, setStatus] = useState<AvatarRenderStatus | null>(null)
  const [launching, setLaunching] = useState(false)
  const brands = useBrands((s) => s.brands)
  const loadBrands = useBrands((s) => s.load)
  const markBrands = brands.filter((brand) => hasBrandMark(brand.look))
  const handleBrand = markBrands.find((brand) => brand.id === draft.handleBrandId) ?? null
  const handleChoice = handleBrand ? { brandIdentityId: handleBrand.id, showHandle: true } : {}

  useEffect(() => {
    let live = true
    void loadBrands(true)
    getApi().avatars.list().then((list) => { if (live) setAvatars(list) }).catch((err) => { if (live) setError(errorMessage(err)) })
    getApi().avatars.renderStatus().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().avatars.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [loadBrands])

  const selected = avatars.find((avatar) => avatar.id === draft.avatarId) ?? avatars[0] ?? null
  useEffect(() => {
    if (selected && selected.id !== draft.avatarId) draft.update({ avatarId: selected.id })
  }, [selected, draft])

  const openKeys = (): void => { requestSettingsSection('keys'); onNavigate('settings') }
  const busy = status !== null && !['done', 'failed', 'cancelled'].includes(status.phase)
  const text = scriptText(draft.script)
  const seconds = estimateSpokenSeconds(text)
  const recreate = draft.recreate
  const recreateLength = Math.max(0, recreate.endSeconds - recreate.startSeconds)
  const recreateReady = Boolean(recreate.sourcePath) && recreate.rightsConfirmed && recreateLength >= RECREATE_MIN_SECONDS && recreateLength <= RECREATE_MAX_SECONDS
  const cost = useMemo(() => draft.style === 'recreate'
    ? (recreate.sourcePath ? estimateRecreateCost({ ...recreate, mode: recreate.mode }) : 0)
    : text ? estimateRenderCost({ style: draft.style, lipSync: draft.lipSync, sceneQuality: draft.sceneQuality, script: draft.script, voiceProvider: selected?.voice.provider }) : 0,
  [draft.style, draft.lipSync, draft.sceneQuality, draft.script, text, recreate, selected?.voice.provider])
  const longScenes = draft.style === 'cinematic' && text ? overlongScenes(draft.script) : []
  // A HeyGen avatar's talking head: lip-synced on HeyGen, priced from HeyGen's published per-second rate.
  const heygen = draft.style === 'talking' && selected?.heygen ? selected.heygen : null
  const heygenVoice = Boolean(heygen && heygen.voice === 'heygen' && heygen.voiceId)
  const heygenUsd = heygen && text ? estimateHeygenVideoUsd(seconds, heygenEngine(heygen.engines)) : null
  const heygenStep = heygen ? heygenStage(heygen) : null
  const needsOpenrouter = draft.style !== 'recreate' && !heygenVoice
  const updateRecreate = (patch: Partial<RecreateDraft>): void => draft.update({ recreate: { ...draft.recreate, ...patch } })

  const setStyle = (style: StudioStyle): void => {
    if (style === 'recreate') { draft.update({ style, backgroundVideo: null }); return }
    const narration = scriptText(draft.script)
    if (style === 'talking') {
      draft.update({
        style, cinematicScenes: draft.style === 'cinematic' ? draft.script.scenes : draft.cinematicScenes,
        script: { title: draft.script.title, scenes: [{ narration, visual: '', featuresAvatar: true }] }
      })
      return
    }
    // Back to cinematic: restore the scenes as they were unless the narration was edited meanwhile.
    const saved = draft.cinematicScenes
    const restore = saved && saved.map((scene) => scene.narration.trim()).join(' ') === narration ? saved : null
    draft.update({ style, backgroundVideo: null, script: restore ? { title: draft.script.title, scenes: restore } : draft.script })
  }

  const writeScript = async (): Promise<void> => {
    setWriting(true); setError(null)
    try {
      if (draft.style === 'recreate') return
      const brandIdentityId = brands.some((brand) => brand.id === draft.brandIdentityId) ? draft.brandIdentityId : null
      const script = await getApi().avatars.writeScript({ topic: draft.topic, niche: draft.niche, seconds: draft.seconds, style: draft.style, brandIdentityId })
      draft.update({ script })
    } catch (err) { setError(errorMessage(err, 'The script could not be written.')) }
    finally { setWriting(false) }
  }

  // Hook text: the title, or else the script's first line (talking and cinematic videos).
  const hookFallback = draft.style === 'recreate' ? '' : firstLine(draft.script)
  const hook = draft.script.title.trim() || hookFallback
  // With a gameplay split the hook is a title card, as in Create.
  const hookIsCard = draft.style === 'talking' && Boolean(draft.backgroundVideo)

  const generate = async (): Promise<void> => {
    if (!selected) return
    setError(null)
    setLaunching(true)
    try {
      const started = draft.style === 'recreate'
        ? await getApi().avatars.recreate({
          avatarId: selected.id, sourcePath: recreate.sourcePath, startSeconds: recreate.startSeconds, endSeconds: recreate.endSeconds, mode: recreate.mode,
          keepAudio: recreate.keepAudio, title: draft.script.title, captionPreset: draft.captionPreset, includeCaptions: draft.includeCaptions && recreate.keepAudio,
          includeTitle: draft.includeTitle, rightsConfirmed: recreate.rightsConfirmed, headlineLook: draft.headlineLook, ctaId: draft.ctaId, ...handleChoice
        })
        : await getApi().avatars.render({
          avatarId: selected.id, style: draft.style, script: draft.script, lipSync: draft.lipSync, sceneQuality: draft.sceneQuality, captionPreset: draft.captionPreset,
          includeCaptions: draft.includeCaptions, includeTitle: draft.includeTitle, backgroundVideo: draft.style === 'talking' ? draft.backgroundVideo : null,
          headline: hook, headlineLook: draft.headlineLook, ctaId: draft.ctaId, ...handleChoice
        })
      // A status event for this render may already have arrived; keep the newer one.
      setStatus((previous) => previous?.id === started.id ? previous : started)
    } catch (err) { setError(errorMessage(err, 'The video could not be started.')) }
    finally { setLaunching(false) }
  }

  const updateScene = (index: number, patch: Partial<AvatarScene>): void => {
    draft.update({ script: { ...draft.script, scenes: draft.script.scenes.map((scene, i) => i === index ? { ...scene, ...patch } : scene) } })
  }

  return (
    <Page width="default">
      <PageHeader
        eyebrow="Studio"
        title="Avatar Studio"
        description="Create an AI avatar once, then turn scripts into ready-to-post vertical videos for faceless channels."
      />
      <FirstRunGuide page="avatar" />

      {!openrouterConfigured && (
        <Callout tone="info" className="mt-4" title="Add your OpenRouter key to start"
          action={<Button size="sm" onClick={openKeys}>Open API keys</Button>}>
          Avatar Studio makes faces, voices and video on your own OpenRouter account (pay as you go), the same key Create and Remix use.
        </Callout>
      )}
      {error && <Callout tone="danger" className="mt-4" onDismiss={() => setError(null)}>{error}</Callout>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Your avatars" description="Your own likeness or a fictional AI person."
              action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>New</Button>} />
            {avatars.length === 0 ? (
              <EmptyState className="mt-4" icon={<UserRound />} title="No avatars yet"
                description="Use a photo of yourself, or describe a person and generate one." />
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Avatar">
                {avatars.map((avatar) => (
                  <button key={avatar.id} type="button" role="radio" aria-checked={selected?.id === avatar.id}
                    onClick={() => draft.update({ avatarId: avatar.id })}
                    className={cn('glass-tile glass-tile-hover overflow-hidden rounded-xl text-left', selected?.id === avatar.id && 'glass-selected')}>
                    <span className="relative block">
                      <img src={localFileUrl(avatar.portraitPath)} alt="" className="aspect-[9/16] w-full object-cover" />
                      {avatar.heygen && <span className="pointer-events-none absolute left-1 top-1"><Badge tone="neutral">HeyGen</Badge></span>}
                    </span>
                    <span className="block truncate px-2 py-1.5 text-2xs font-medium text-ink">{avatar.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
          {selected && <AvatarDetails avatar={selected} busy={busy} openrouterConfigured={openrouterConfigured} onChange={setAvatars} onError={setError} />}
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelHeader title={draft.style === 'recreate' ? '1 · Source video' : '1 · Script'}
              description={draft.style === 'recreate' ? 'Pick a video; your avatar takes over the person in it, with the same moves and timing.' : 'Hook, promise, payoff. Write your own or let AI draft it from a topic.'} />
            <div className="mt-4 space-y-4">
              <Segmented label="Video style" value={draft.style} onChange={setStyle} options={[
                { value: 'talking', label: <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />Talking head</span> },
                { value: 'cinematic', label: <span className="inline-flex items-center gap-1.5"><Clapperboard className="h-3.5 w-3.5" />Cinematic</span> },
                { value: 'recreate', label: <span className="inline-flex items-center gap-1.5"><Repeat2 className="h-3.5 w-3.5" />Recreate a video</span> }
              ]} />
              <p className="text-2xs text-ink-subtle">
                {draft.style === 'talking'
                  ? (heygen ? 'Your HeyGen avatar speaks to camera with realistic lip-sync (Beta). Pairs well with a gameplay split.' : 'Your avatar speaks to camera. Reliable and the cheapest option. Pairs well with a gameplay split.')
                  : draft.style === 'cinematic'
                    ? 'Narrated scenes: your avatar in different settings plus faceless shots. More cinematic, and it costs more.'
                    : `Restage a ${RECREATE_MIN_SECONDS}-${RECREATE_MAX_SECONDS} second clip with your avatar: same motion, timing and camera work, with the original audio.`}
              </p>
              {draft.style === 'recreate' ? (
                <RecreateSource recreate={recreate} title={draft.script.title} disabled={busy} onChange={updateRecreate}
                  onTitle={(title) => draft.update({ script: { ...draft.script, title } })} onError={setError} />
              ) : (<>
              <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <Field label="Topic">
                  <TextInput value={draft.topic} maxLength={500} placeholder="e.g. 3 money habits that keep people broke" onChange={(e) => draft.update({ topic: e.target.value })} />
                </Field>
                <Field label="Niche (optional)">
                  <TextInput value={draft.niche} maxLength={200} placeholder="e.g. personal finance" onChange={(e) => draft.update({ niche: e.target.value })} />
                </Field>
              </div>
              {brands.length > 0 && (
                <Field label="Brand identity (optional)" hint="Writes in your brand's voice and beliefs, using only its real proof.">
                  <Select value={brands.some((brand) => brand.id === draft.brandIdentityId) ? draft.brandIdentityId ?? '' : ''} onChange={(value) => draft.update({ brandIdentityId: value || null })}
                    options={[{ value: '', label: 'None' }, ...brands.map((brand) => ({ value: brand.id, label: brand.name }))]} />
                </Field>
              )}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <Segmented label="Length" size="sm" value={String(draft.seconds)} onChange={(value) => draft.update({ seconds: Number(value) as ScriptLength })}
                  options={SCRIPT_LENGTHS.map((length) => ({ value: String(length), label: `${length}s` }))} />
                <Button icon={<Sparkles className="h-4 w-4" />} loading={writing} disabled={!openrouterConfigured || draft.topic.trim().length < 3 || busy}
                  tooltip={!openrouterConfigured ? 'Add your OpenRouter key in Settings first' : undefined} onClick={() => void writeScript()}>
                  Write script
                </Button>
              </div>

              <Field label="Hook text (optional)" hint="Shown at the top of the video and used as its title in your Library. 2-7 words, outcome first. Leave it empty to use the script’s first line.">
                <TextInput aria-label="Hook text" value={draft.script.title} maxLength={MAX_HOOK_CHARS} placeholder={hookFallback || 'e.g. Stop doing this with your paycheck'} onChange={(e) => draft.update({ script: { ...draft.script, title: e.target.value } })} />
              </Field>

              {draft.script.scenes.map((scene, index) => (
                <div key={index} className={cn(draft.style === 'cinematic' && 'glass-tile space-y-2 rounded-xl p-3')}>
                  {draft.style === 'cinematic' && (
                    <div className="flex items-center justify-between">
                      <span className="eyebrow">Scene {index + 1}</span>
                      {draft.script.scenes.length > 1 && (
                        <Button size="sm" variant="ghost" iconOnly aria-label={`Remove scene ${index + 1}`} icon={<X className="h-3.5 w-3.5" />}
                          onClick={() => draft.update({ script: { ...draft.script, scenes: draft.script.scenes.filter((_, i) => i !== index) } })} />
                      )}
                    </div>
                  )}
                  <Field label={draft.style === 'cinematic' ? 'Narration' : 'Script'}>
                    <TextArea aria-label={draft.style === 'cinematic' ? `Scene ${index + 1} narration` : 'Script'} rows={draft.style === 'cinematic' ? 3 : 8} value={scene.narration} onChange={(e) => updateScene(index, { narration: e.target.value })}
                      placeholder="What your avatar says. Open with the hook, deliver the payoff, end strong." />
                  </Field>
                  {draft.style === 'cinematic' && (
                    <>
                      <Field label="Shot">
                        <TextArea rows={2} value={scene.visual} onChange={(e) => updateScene(index, { visual: e.target.value })}
                          placeholder="e.g. Close-up of hands counting cash on a kitchen table, morning light" />
                      </Field>
                      <LabeledCheckbox checked={scene.featuresAvatar} onChange={(featuresAvatar) => updateScene(index, { featuresAvatar })} label="Avatar appears in this shot" />
                    </>
                  )}
                </div>
              ))}
              {draft.style === 'cinematic' && draft.script.scenes.length < MAX_SCENES && (
                <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => draft.update({ script: { ...draft.script, scenes: [...draft.script.scenes, { narration: '', visual: '', featuresAvatar: false }] } })}>
                  Add scene
                </Button>
              )}
              {text && (
                <p className={cn('text-2xs', seconds > MAX_SPOKEN_SECONDS ? 'text-danger' : 'text-ink-subtle')}>
                  About {seconds}s of speech{seconds > MAX_SPOKEN_SECONDS ? ` · keep it under ${MAX_SPOKEN_SECONDS}s` : ''}
                </p>
              )}
              {longScenes.length > 0 && (
                <p className="text-2xs text-danger">Scene {longScenes.join(', ')} has more narration than one {MAX_SCENE_SECONDS}-second shot. Split it into two scenes.</p>
              )}
              </>)}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="2 · Look" description="The same caption styles as Create." />
            <div className="mt-4 space-y-4">
              {draft.style === 'talking' && (
                <p className="text-2xs text-ink-subtle">{heygen
                  ? `Realistic lip-sync on HeyGen (Beta), vertical 1080p, then the captions and hook text below are added here. ${heygenVoice ? 'HeyGen speaks the script in its voice for this avatar.' : 'Voiced in the avatar’s app voice, then HeyGen lip-syncs to it.'}`
                  : 'Your avatar’s photo with a slow push-in, voiced in its voice. Lip-sync is coming: OpenRouter can’t animate a face to your own voice yet. For realistic lip-sync, make a HeyGen avatar (Beta).'}</p>
              )}
              {draft.style === 'cinematic' && (
                <Field label="Scene quality">
                  <Select value={draft.sceneQuality} onChange={(value) => draft.update({ sceneQuality: value as SceneQuality })} options={[
                    { value: 'standard', label: 'Standard', detail: 'Kling 3 Standard · cheaper' },
                    { value: 'pro', label: 'Pro', detail: 'Kling 3 Pro · sharper motion' }
                  ]} />
                </Field>
              )}
              <SettingRow title="Captions"
                description={draft.style === 'recreate' ? (recreate.keepAudio ? 'Transcribed from the original audio (uses your OpenRouter key).' : 'Keep the original audio to add captions.') : 'Word-by-word captions in the style below.'}
                control={<Switch label="Captions" disabled={draft.style === 'recreate' && !recreate.keepAudio} checked={draft.includeCaptions && (draft.style !== 'recreate' || recreate.keepAudio)} onChange={(includeCaptions) => draft.update({ includeCaptions })} />} />
              {markBrands.length > 0 && (
                <div className="space-y-2">
                  <SettingRow title="Show my handle" description="Your brand’s handle or logo, small in a corner of the video."
                    control={<Switch label="Show my handle" checked={handleBrand !== null}
                      onChange={(on) => draft.update({ handleBrandId: on ? (markBrands.find((brand) => brand.id === draft.brandIdentityId) ?? markBrands[0]).id : null })} />} />
                  {handleBrand && markBrands.length > 1 && (
                    <Select value={handleBrand.id} aria-label="Brand for the handle" onChange={(handleBrandId) => draft.update({ handleBrandId })}
                      options={markBrands.map((brand) => ({ value: brand.id, label: brand.name, detail: brand.look?.handle || 'Logo' }))} />
                  )}
                </div>
              )}
              <SettingRow title="Hook text at the top" description={hookIsCard ? 'With a gameplay split the hook text is a title card, like Create’s clips.' : 'A headline at the top of the video, like Create’s clips.'}
                control={<Switch label="Hook text" checked={draft.includeTitle} onChange={(includeTitle) => draft.update({ includeTitle })} />} />
              {draft.includeTitle && !hookIsCard && (
                <div>
                  <p className="mb-2 text-xs font-medium text-ink">Hook text look</p>
                  <HeadlineLookPicker value={draft.headlineLook} onChange={(headlineLook) => draft.update({ headlineLook })} />
                  {draft.headlineLook.look !== 'none' && !(draft.style === 'recreate' ? draft.script.title.trim() : hook) && (
                    <p className="mt-2 text-2xs text-ink-subtle">Add hook text above to show it.</p>
                  )}
                </div>
              )}
              {draft.includeCaptions && (draft.style !== 'recreate' || recreate.keepAudio) && <CaptionPresetPicker value={draft.captionPreset} onChange={(captionPreset) => draft.update({ captionPreset })} />}
              {draft.style === 'talking' && (
                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="eyebrow">Gameplay split</span><span className="text-2xs text-ink-subtle">Optional</span></div>
                  <BackgroundPicker value={draft.backgroundVideo} onChange={(backgroundVideo) => draft.update({ backgroundVideo })} />
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-ink">Call to action at the end</p>
                <p className="mb-2.5 mt-0.5 text-2xs text-ink-muted">Add one of your CTA clips to the end of the video. You can change it later in the Library.</p>
                <CtaPicker value={draft.ctaId} onChange={(ctaId) => draft.update({ ctaId })} disabled={busy} />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="3 · Generate" description={draft.style === 'recreate'
              ? (recreate.sourcePath ? `Estimated cost about $${cost.toFixed(2)} on fal.ai · ${recreateLength.toFixed(1)}s video` : 'Recreate runs on fal.ai. Choose a video to see the estimated cost.')
              : !text ? 'Write a script to see the estimated cost.'
                : heygen ? (heygenUsd !== null
                  ? `Estimated cost about $${(heygenUsd + (heygenVoice ? 0 : cost)).toFixed(2)}: HeyGen at about $${HEYGEN_PRICES.avatarIvPerSecond.toFixed(2)} a second (${heygenPriceNote()})${heygenVoice ? '' : ' plus the voice on OpenRouter'} · ${seconds}s video`
                  : `Billed by HeyGen${heygenVoice ? '' : `, plus about $${cost.toFixed(2)} for the voice on OpenRouter`} · ${seconds}s video`)
                  : `Estimated cost about $${cost.toFixed(2)} on OpenRouter · ${seconds}s video`} />
            <div className="mt-4 space-y-3">
              {heygen && heygenStep !== 'ready' && !busy && (
                <Callout tone="warning">{heygenStep === 'training' ? 'HeyGen is still training this avatar. Generate once it’s ready (see the avatar on the left).'
                  : heygenStep === 'failed' ? 'HeyGen could not make this avatar. See the avatar on the left.'
                    : 'HeyGen needs your consent recording before this avatar can make videos. Open the consent page from the avatar on the left.'}</Callout>
              )}
              {heygen && !heygenConfigured && <Callout tone="info" action={<Button size="sm" onClick={openKeys}>Open API keys</Button>}>This avatar runs on HeyGen. Add your HeyGen key in Settings → API keys.</Callout>}
              {status && <RenderProgress status={status} onNavigate={onNavigate} onViewLibrary={onViewLibrary} />}
              <div className="flex flex-wrap gap-2">
                {busy ? (
                  <Button variant="secondary" onClick={() => void getApi().avatars.cancelRender()}>Cancel</Button>
                ) : (
                  <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={launching} disabled={launching || (draft.style === 'recreate' ? !falConfigured : needsOpenrouter && !openrouterConfigured) || (heygen !== null && (!heygenConfigured || heygenStep !== 'ready')) || !selected || (draft.style === 'recreate' ? !recreateReady : !text || seconds > MAX_SPOKEN_SECONDS || longScenes.length > 0)}
                    tooltip={draft.style === 'recreate' && !falConfigured ? 'Recreate needs a fal.ai key (Settings → API keys)' : heygen && !heygenConfigured ? 'Add your HeyGen key first' : heygen && heygenStep !== 'ready' ? 'This HeyGen avatar isn’t ready yet' : needsOpenrouter && !openrouterConfigured ? 'Add your OpenRouter key first' : !selected ? 'Create an avatar first' : draft.style === 'recreate' ? (recreateReady ? undefined : 'Choose a video, a 3-30 second range, and confirm your rights') : !text ? 'Write a script first' : undefined} onClick={() => void generate()}>
                    Generate video
                  </Button>
                )}
              </div>
              <p className="text-2xs text-ink-subtle">
                Talking-head videos take a few minutes; cinematic and recreated ones up to 10-20. You can leave this page while it works.
                {busy && (heygen ? ' Cancelling stops waiting; HeyGen can’t stop a video it already started, so it may still finish and be billed on your HeyGen account.'
                  : ` Cancelling stops what hasn’t started; a step already running on ${draft.style === 'recreate' ? 'fal.ai' : 'OpenRouter'} may still be charged.`)}
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {creating && <CreateAvatarDialog openrouterConfigured={openrouterConfigured} heygenConfigured={heygenConfigured} onOpenKeys={() => { setCreating(false); openKeys() }}
        onClose={() => setCreating(false)} onCreated={(list, consent) => {
          setAvatars(list); setCreating(false); if (list[0]) draft.update({ avatarId: list[0].id })
          // A new video avatar: HeyGen's consent page opens in the browser right away.
          if (consent && list[0]?.heygen?.source === 'twin') getApi().heygen.openConsent(list[0].id).then(setAvatars).catch((err) => setError(errorMessage(err)))
        }} />}
    </Page>
  )
}

function RecreateSource({ recreate, title, disabled, onChange, onTitle, onError }: {
  recreate: RecreateDraft; title: string; disabled: boolean; onChange: (patch: Partial<RecreateDraft>) => void; onTitle: (title: string) => void; onError: (message: string | null) => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const choose = async (): Promise<void> => {
    onError(null)
    try {
      const path = await getApi().dialog.selectVideo()
      if (path && path !== recreate.sourcePath) onChange({ sourcePath: path, sourceSeconds: 0, startSeconds: 0, endSeconds: 0 })
    } catch (err) { onError(errorMessage(err, 'That video could not be opened.')) }
  }
  const [unplayable, setUnplayable] = useState(false)
  useEffect(() => setUnplayable(false), [recreate.sourcePath])
  /** Typed seconds, or null while the field is empty or mid-edit. */
  const seconds = (value: string): number | null => value.trim() === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.round(Number(value) * 10) / 10)
  const here = (): number => Math.round((video.current?.currentTime ?? 0) * 10) / 10
  const length = recreate.endSeconds - recreate.startSeconds
  return (
    <div className="space-y-4">
      {recreate.sourcePath ? (
        <video ref={video} key={recreate.sourcePath} src={localFileUrl(recreate.sourcePath)} controls className="mx-auto max-h-[360px] rounded-2xl bg-black"
          onError={() => setUnplayable(true)}
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration
            if (Number.isFinite(duration) && recreate.sourceSeconds !== duration) {
              onChange({ sourceSeconds: duration, ...(recreate.endSeconds <= recreate.startSeconds ? { startSeconds: 0, endSeconds: Math.min(duration, 15) } : {}) })
            }
          }} />
      ) : (
        <EmptyState icon={<Film />} title="No video chosen" description="A short clip with one clearly visible person works best: dances, reactions, talking to camera, skits." />
      )}
      <div><Button variant="secondary" icon={<Film className="h-4 w-4" />} disabled={disabled} onClick={() => void choose()}>{recreate.sourcePath ? 'Choose another video' : 'Choose video'}</Button></div>
      {recreate.sourcePath && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start (seconds)" aside={<button type="button" className="text-2xs text-accent" onClick={() => onChange({ startSeconds: here() })}>Use current</button>}>
              <TextInput type="number" min={0} step={0.1} defaultValue={recreate.startSeconds} key={`s-${recreate.sourcePath}-${recreate.startSeconds}`}
                onBlur={(e) => { const value = seconds(e.target.value); if (value !== null) onChange({ startSeconds: value }) }} />
            </Field>
            <Field label="End (seconds)" aside={<button type="button" className="text-2xs text-accent" onClick={() => onChange({ endSeconds: here() })}>Use current</button>}>
              <TextInput type="number" min={0} step={0.1} defaultValue={recreate.endSeconds} key={`e-${recreate.sourcePath}-${recreate.endSeconds}`}
                onBlur={(e) => { const value = seconds(e.target.value); if (value !== null) onChange({ endSeconds: value }) }} />
            </Field>
          </div>
          {unplayable && <p className="text-2xs text-warning">This format can't be previewed here, but it can still be recreated. Type the start and end times.</p>}
          <p className={cn('text-2xs', length < RECREATE_MIN_SECONDS || length > RECREATE_MAX_SECONDS ? 'text-danger' : 'text-ink-subtle')}>
            {length.toFixed(1)}s selected · keep it between {RECREATE_MIN_SECONDS} and {RECREATE_MAX_SECONDS} seconds
          </p>
        </>
      )}
      <Segmented label="Recreate mode" value={recreate.mode} onChange={(mode) => onChange({ mode })} options={[
        { value: 'replace', label: 'Swap into the scene' },
        { value: 'motion', label: 'Animate my avatar' },
        { value: 'move', label: 'Animate · economy' }
      ]} />
      <p className="text-2xs text-ink-subtle">
        {recreate.mode === 'replace'
          ? 'Your avatar replaces the person; the original background, lighting and camera stay. (Wan Animate)'
          : recreate.mode === 'motion'
            ? 'Your avatar\'s own photo performs the video\'s moves, in your avatar\'s setting. Best motion quality. (Kling Motion Control)'
            : 'Same idea as Animate, at about half the cost, with looser motion. (Wan Motion)'}
      </p>
      <SettingRow title="Keep the original audio" description="Needed for captions. Turn off to add your own sound later."
        control={<Switch label="Keep the original audio" checked={recreate.keepAudio} onChange={(keepAudio) => onChange({ keepAudio })} />} />
      <Field label="Hook text (optional)" hint="Shown at the top of the video.">
        <TextInput value={title} maxLength={80} placeholder="e.g. POV: you finally get it" onChange={(e) => onTitle(e.target.value)} />
      </Field>
      <LabeledCheckbox checked={recreate.rightsConfirmed} onChange={(rightsConfirmed) => onChange({ rightsConfirmed })}
        label="I own this video or have permission to use it, and I won't use the result to impersonate anyone." />
    </div>
  )
}

/** A checkbox with its label visible and clickable. */
function LabeledCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <Checkbox checked={checked} onChange={onChange} label={label} className="mt-px" />
      <span aria-hidden="true" className="cursor-pointer select-none text-xs text-ink-muted" onClick={() => onChange(!checked)}>{label}</span>
    </div>
  )
}

function RenderProgress({ status, onNavigate, onViewLibrary }: {
  status: AvatarRenderStatus; onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string, clipIndex?: number) => void
}): React.JSX.Element {
  const [posting, setPosting] = useState<PostableClip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setPosting(null); setError(null) }, [status.id])
  if (status.phase === 'done' && status.outputPath) {
    const outputDir = status.outputDir
    /** The video as the Library has it (title, caption, AI label, call to action). */
    const post = async (): Promise<void> => {
      if (!outputDir) return
      setError(null)
      try {
        const output = parseJobOutput(await getApi().history.getJob(outputDir))
        const clip = output?.clips[0]
        if (!clip) { setError('This video is no longer in your Library.'); return }
        setPosting([{ path: clipFilePath(clip.s3_url), title: clip.summary || 'Avatar video', tags: clip.tags, durationMs: clip.duration_ms,
          aiGenerated: clip.ai_generated === true, postCaption: clip.post_caption ?? undefined, library: { outputDir, clipIndex: clip.clip_index } }])
      } catch (err) { setError(errorMessage(err, 'This video could not be opened for posting.')) }
    }
    return (
      <div className="space-y-3">
        {status.warning && <Callout tone="warning">{status.warning}</Callout>}
        <video key={`${status.id}:${status.outputPath}`} src={localFileUrl(status.outputPath)} controls className="mx-auto aspect-[9/16] max-h-[520px] rounded-2xl bg-black" />
        <div className="flex flex-wrap justify-center gap-2">
          {outputDir && <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={() => void post()}>Post or schedule</Button>}
          {outputDir && onViewLibrary && <Button size="sm" variant="secondary" icon={<ListVideo className="h-3.5 w-3.5" />} onClick={() => onViewLibrary(outputDir, 0)}>Open in Library</Button>}
          <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.showItemInFolder(status.outputPath!)}>Show in folder</Button>
        </div>
        {outputDir && <p className="text-center text-2xs text-ink-subtle">Saved to your Library with your other videos. Past avatar videos are there too.</p>}
        {error && <Callout tone="danger" onDismiss={() => setError(null)}>{error}</Callout>}
        {posting && <PostDialog clips={posting} onClose={() => setPosting(null)} onNavigate={onNavigate} />}
      </div>
    )
  }
  if (status.phase === 'failed') return <Callout tone="danger">{status.error ?? 'Generation failed.'}</Callout>
  if (status.phase === 'cancelled') return <Callout tone="info">Generation canceled.</Callout>
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-ink-muted"><span>{status.detail}</span><span>{status.percent}%</span></div>
      <ProgressBar value={status.percent} />
    </div>
  )
}

function AvatarDetails({ avatar, busy, openrouterConfigured, onChange, onError }: { avatar: AvatarSummary; busy: boolean; openrouterConfigured: boolean; onChange: (list: AvatarSummary[]) => void; onError: (message: string | null) => void }): React.JSX.Element {
  const [consent, setConsent] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => { setConsent(false); setConfirmRemove(false) }, [avatar.id])
  const clone = avatar.clonedVoice
  const options = [
    ...(clone ? [{ value: 'clone', label: 'Cloned voice', detail: 'Your recording' }] : []),
    ...PRESET_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.hint }))
  ]
  const value = avatar.voice.provider === 'clone' ? 'clone' : avatar.voice.voice
  const run = async (action: () => Promise<AvatarSummary[] | null>): Promise<void> => {
    onError(null)
    try { const list = await action(); if (list) onChange(list) } catch (err) { onError(errorMessage(err)) }
  }
  return (
    <Panel>
      <PanelHeader title={avatar.name} description={avatar.heygen ? (avatar.heygen.source === 'stock' ? 'HeyGen stock AI person' : 'Your likeness on HeyGen') : avatar.kind === 'self' ? 'Your likeness' : 'Fictional AI person'}
        action={<Badge tone={avatar.kind === 'self' ? 'accent' : 'neutral'}>{voiceLabel(avatar.voice)}</Badge>} />
      <div className="mt-4 space-y-4">
        <Field label="Voice">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Select value={value} options={options} disabled={busy} searchable onChange={(next) => {
                const voice = next === 'clone' ? (clone ? { provider: 'clone', clonedAt: clone.clonedAt } : null) : { provider: 'elevenlabs', voice: next }
                if (voice) void run(() => getApi().avatars.update(avatar.id, { voice }))
              }} />
            </div>
            <VoicePreview request={{ kind: 'avatar', voice: avatar.voice, avatarId: avatar.id }} name={voiceLabel(avatar.voice)} />
          </div>
        </Field>
        <HeygenStatus avatar={avatar} busy={busy} appVoiceLabel={voiceLabel(avatar.voice)} onChange={onChange} onError={onError} />
        {/* A HeyGen avatar's look lives on HeyGen; its picture here is only for the library. */}
        {!avatar.heygen && <PictureLibrary avatar={avatar} busy={busy} onChange={onChange} onError={onError} />}
        {avatar.kind === 'self' && !avatar.heygen && <RestylePortrait avatar={avatar} busy={busy} openrouterConfigured={openrouterConfigured} onChange={onChange} onError={onError} />}
        <ReactionLibrary avatar={avatar} busy={busy} openrouterConfigured={openrouterConfigured} onChange={onChange} onError={onError} />
        <div className="glass-tile space-y-2 rounded-xl p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink"><Mic className="h-3.5 w-3.5" />Clone a voice</p>
          <p className="text-2xs text-ink-subtle">Upload 30-90 seconds of clear speech from one person (MP3, WAV or M4A). No setup fee: the recording stays with this avatar and your OpenRouter account clones from it as each video is voiced.{clone ? ' Cloning again replaces the current clone.' : ''}</p>
          <LabeledCheckbox checked={consent} onChange={setConsent} label="This is my voice, or I have the speaker's permission" />
          <Button size="sm" variant="secondary" icon={<AudioLines className="h-3.5 w-3.5" />} loading={cloning} disabled={busy || !openrouterConfigured || !consent}
            onClick={() => { setCloning(true); void run(() => getApi().avatars.cloneVoice(avatar.id, true)).finally(() => setCloning(false)) }}>
            Choose recording
          </Button>
        </div>
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => getApi().avatars.remove(avatar.id))}>Remove {avatar.name}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Keep</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={busy} onClick={() => setConfirmRemove(true)}>Remove avatar</Button>
        )}
      </div>
    </Panel>
  )
}

function CreateAvatarDialog({ openrouterConfigured, heygenConfigured, onClose, onCreated, onOpenKeys }: {
  openrouterConfigured: boolean; heygenConfigured: boolean; onClose: () => void; onOpenKeys: () => void
  /** `consent`: a new HeyGen video avatar whose consent page should open now. */
  onCreated: (list: AvatarSummary[], consent?: boolean) => void
}): React.JSX.Element {
  const [kind, setKind] = useState<'self' | 'ai' | 'heygen'>(openrouterConfigured ? 'ai' : 'self')
  const [description, setDescription] = useState('')
  const [drafts, setDrafts] = useState<{ draftId: string; path: string }[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [voice, setVoice] = useState<string>(PRESET_VOICES[0].id)
  const [consent, setConsent] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Own photo: use it as is, or make an AI version of the person from it. */
  const [picture, setPicture] = useState<'photo' | 'ai'>('photo')
  const [photo, setPhoto] = useState<{ draftId: string; path: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const switchKind = (next: 'self' | 'ai' | 'heygen'): void => { setKind(next); setDrafts([]); setChosen(null); setError(null); setPhoto(null); setPicture('photo') }
  const attempt = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setWorking(true); setError(null)
    try { await action() } catch (err) { setError(errorMessage(err)) } finally { setWorking(false) }
  }, [])

  const pickPhoto = (): Promise<void> => attempt(async () => {
    const draft = await getApi().avatars.pickPhoto()
    if (draft) { setPhoto(draft); setDrafts([draft]); setChosen(draft.draftId) }
  })
  const generateFaces = (): Promise<void> => attempt(async () => {
    const list = await getApi().avatars.generateFaces(description)
    setDrafts(list); setChosen(list[0]?.draftId ?? null)
  })
  const createAvatar = (): Promise<void> => attempt(async () => {
    if (!chosen) return
    const ownPhoto = kind === 'self' && photo !== null && chosen === photo.draftId
    onCreated(await getApi().avatars.create({
      draftId: chosen, name, kind: kind === 'self' ? 'self' : 'ai', description: kind === 'ai' ? description : '', voice: { provider: 'elevenlabs', voice }, consent,
      pictureSource: ownPhoto ? 'photo' : 'ai',
      // An AI version of you: your own photo is kept with the avatar too, so you can switch back.
      ...(kind === 'self' && photo && !ownPhoto ? { keepPhotoDraftId: photo.draftId } : {})
    }))
  })

  const ready = Boolean(chosen && name.trim() && (kind === 'ai' || consent))
  const header = (
    <>
      <h2 className="text-base font-semibold text-ink">New avatar</h2>
      <Segmented label="Avatar type" value={kind} onChange={switchKind} options={[
        { value: 'ai', label: 'Generate an AI person' },
        { value: 'self', label: 'Use my photo' },
        { value: 'heygen', label: <span className="inline-flex items-center gap-1.5">Realistic talking avatar (HeyGen, Beta)</span> }
      ]} />
    </>
  )
  if (kind === 'heygen') {
    return (
      <Dialog ref={ref} aria-label="New avatar" onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[680px]"
        onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
        <HeygenCreateForm header={header} heygenConfigured={heygenConfigured} onOpenKeys={onOpenKeys} onClose={onClose}
          onCreated={(list, source) => onCreated(list, source === 'twin')} />
      </Dialog>
    )
  }
  return (
    <Dialog ref={ref} aria-label="New avatar" onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[680px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        {header}
        {kind === 'ai' ? (
          <Field label="Describe the person" hint={openrouterConfigured ? `Fictional people only. About $${(PRICES.image * AI_PORTRAIT_CANDIDATES).toFixed(2)} for ${AI_PORTRAIT_CANDIDATES} options.` : 'Add your OpenRouter key in Settings → API keys to generate faces.'}>
            <TextArea rows={3} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Woman in her early 30s, curly dark hair, warm smile, casual olive jacket, cozy home office" />
          </Field>
        ) : (
          <p className="text-xs text-ink-muted">Use a clear, front-facing photo with your face well lit and your mouth closed. A vertical photo works best.</p>
        )}
        <div className="flex gap-2">
          {kind === 'ai'
            ? <Button icon={<Sparkles className="h-4 w-4" />} loading={working && drafts.length === 0} disabled={working || !openrouterConfigured || description.trim().length < 10} onClick={() => void generateFaces()}>{drafts.length ? 'Generate again' : 'Generate faces'}</Button>
            : <Button icon={<UserRound className="h-4 w-4" />} disabled={working} onClick={() => void pickPhoto()}>{drafts.length ? 'Choose another photo' : 'Choose photo'}</Button>}
        </div>
        {kind === 'self' && photo && (
          <div className="space-y-3">
            <Segmented label="Picture" value={picture} onChange={(next) => { setPicture(next); if (next === 'photo') { setDrafts([photo]); setChosen(photo.draftId) } }} options={[
              { value: 'photo', label: 'Use my photo as is' },
              { value: 'ai', label: 'Make an AI version of me' }
            ]} />
            {picture === 'ai' && (
              <RestyleControls source={{ draftId: photo.draftId }} consent={consent} openrouterConfigured={openrouterConfigured} disabled={working}
                onBusy={setWorking} onMade={(made) => { setDrafts([photo, ...made]); setChosen(made[0]?.draftId ?? photo.draftId) }} onError={setError} />
            )}
          </div>
        )}
        {drafts.length > 0 && (
          <div className={cn('grid gap-3', drafts.length > 2 ? 'grid-cols-3' : 'grid-cols-2')} role="radiogroup" aria-label="Face">
            {drafts.map((item) => (
              <button key={item.draftId} type="button" role="radio" aria-checked={chosen === item.draftId} tabIndex={chosen === item.draftId || (!chosen && item === drafts[0]) ? 0 : -1}
              onKeyDown={onRadioKeyDown} onClick={() => setChosen(item.draftId)}
                className={cn('glass-tile overflow-hidden rounded-xl', chosen === item.draftId && 'glass-selected')}>
                <img src={localFileUrl(item.path)} alt="" className="aspect-[9/16] w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><TextInput value={name} maxLength={60} placeholder="e.g. Maya" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Voice">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Select value={voice} searchable onChange={setVoice} options={PRESET_VOICES.map((item) => ({ value: item.id, label: item.label, detail: item.hint }))} />
              </div>
              <VoicePreview request={{ kind: 'avatar', voice: { provider: 'elevenlabs', voice } }} name={voice} />
            </div>
          </Field>
        </div>
        {kind === 'self' && <LabeledCheckbox checked={consent} onChange={setConsent} label="This is me, or I have this person's written permission to use their likeness" />}
        {kind === 'self' && drafts.length > 1 && <p className="text-2xs text-ink-subtle">The first picture is your original photo; the others are AI versions. Pick the one your videos should use.</p>}
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || working} onClick={() => void createAvatar()}>Create avatar</Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Look + optional detail, then "Make AI versions": new pictures of the person in a photo. */
function RestyleControls({ source, consent, openrouterConfigured, disabled, onMade, onError, onBusy }: {
  source: { draftId: string } | { avatarId: string }; consent: boolean; openrouterConfigured: boolean; disabled: boolean
  onMade: (drafts: { draftId: string; path: string }[]) => void; onError: (message: string | null) => void
  /** While AI versions are being made (the parent locks its other buttons). */
  onBusy?: (busy: boolean) => void
}): React.JSX.Element {
  const [look, setLook] = useState<PortraitLook>('studio')
  const [detail, setDetail] = useState('')
  const [making, setMaking] = useState(false)
  const make = async (): Promise<void> => {
    setMaking(true); onBusy?.(true); onError(null)
    try { onMade(await getApi().avatars.restyle(source, look, detail, consent)) } catch (err) { onError(errorMessage(err)) } finally { setMaking(false); onBusy?.(false) }
  }
  const blocker = !openrouterConfigured ? 'Add your OpenRouter key in Settings first' : !consent ? 'Confirm this is you (below) first' : undefined
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Look">
          <Select value={look} onChange={(value) => setLook(value as PortraitLook)} options={PORTRAIT_LOOKS.map((item) => ({ value: item.id, label: item.label, detail: item.hint }))} />
        </Field>
        <Field label="Extra detail (optional)">
          <TextInput value={detail} maxLength={200} placeholder="e.g. navy blazer, short beard" onChange={(e) => setDetail(e.target.value)} />
        </Field>
      </div>
      <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={making} disabled={making || disabled || Boolean(blocker)} tooltip={blocker} onClick={() => void make()}>
        Make AI versions · about ${(PRICES.image * AI_PORTRAIT_CANDIDATES).toFixed(2)}
      </Button>
      <p className="text-2xs text-ink-subtle">Same face from your photo, a new professional shot. Make more until you like one.</p>
    </div>
  )
}

/** Existing own-photo avatars: make AI versions of the picture and swap it in; the voice and clone stay. */
function RestylePortrait({ avatar, busy, openrouterConfigured, onChange, onError }: {
  avatar: AvatarSummary; busy: boolean; openrouterConfigured: boolean; onChange: (list: AvatarSummary[]) => void; onError: (message: string | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<{ draftId: string; path: string }[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setOpen(false); setDrafts([]); setChosen(null) }, [avatar.id])
  const save = async (): Promise<void> => {
    if (!chosen) return
    setSaving(true); onError(null)
    try { onChange(await getApi().avatars.setPortrait(avatar.id, chosen)); setOpen(false); setDrafts([]); setChosen(null) }
    catch (err) { onError(errorMessage(err)) } finally { setSaving(false) }
  }
  if (!open) {
    const full = (avatar.pictures ?? []).length >= MAX_AVATAR_PICTURES
    return <Button size="sm" variant="secondary" icon={<Sparkles className="h-3.5 w-3.5" />} disabled={busy || full}
      tooltip={full ? `Remove a picture first: an avatar keeps up to ${MAX_AVATAR_PICTURES}.` : undefined} onClick={() => setOpen(true)}>Make an AI version of your photo</Button>
  }
  return (
    <div className="glass-tile space-y-3 rounded-xl p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink"><Sparkles className="h-3.5 w-3.5" />AI version of {avatar.name}</p>
      <RestyleControls source={{ avatarId: avatar.id }} consent openrouterConfigured={openrouterConfigured} disabled={busy || saving}
        onMade={(made) => { setDrafts((current) => [...made, ...current].slice(0, 6)); setChosen(made[0]?.draftId ?? null) }} onError={onError} />
      {drafts.length > 0 && (
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="New picture">
          {drafts.map((item) => (
            <button key={item.draftId} type="button" role="radio" aria-checked={chosen === item.draftId} tabIndex={chosen === item.draftId || (!chosen && item === drafts[0]) ? 0 : -1}
              onKeyDown={onRadioKeyDown} onClick={() => setChosen(item.draftId)}
              className={cn('glass-tile overflow-hidden rounded-xl', chosen === item.draftId && 'glass-selected')}>
              <img src={localFileUrl(item.path)} alt="" className="aspect-[9/16] w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={!chosen || saving || busy} loading={saving} onClick={() => void save()}>Use this picture</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setOpen(false); setDrafts([]); setChosen(null) }}>Cancel</Button>
      </div>
      <p className="text-2xs text-ink-subtle">Made from your own photo. The new picture is used from now on, and your current one stays under Pictures so you can switch back. The voice, the cloned voice and your own reaction clips stay as they are; AI reactions are kept with the picture they were made from.</p>
    </div>
  )
}

const PICTURE_LABELS = { photo: 'Your photo', ai: 'AI version', unknown: 'Picture' } as const

/** Every picture the avatar has used: switch between them, remove old ones, or add another photo. */
function PictureLibrary({ avatar, busy, onChange, onError }: {
  avatar: AvatarSummary; busy: boolean; onChange: (list: AvatarSummary[]) => void; onError: (message: string | null) => void
}): React.JSX.Element | null {
  const [working, setWorking] = useState<string | null>(null)
  /** A picture waiting for a second click to delete it. */
  const [confirming, setConfirming] = useState<string | null>(null)
  useEffect(() => setConfirming(null), [avatar.id])
  const pictures = avatar.pictures ?? []
  const run = async (key: string, action: () => Promise<AvatarSummary[] | null>): Promise<void> => {
    setWorking(key); onError(null)
    try { const list = await action(); if (list) onChange(list) } catch (err) { onError(errorMessage(err)) } finally { setWorking(null) }
  }
  if (pictures.length < 2 && avatar.kind !== 'self') return null
  return (
    <div className="glass-tile space-y-2.5 rounded-xl p-3">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink"><UserRound className="h-3.5 w-3.5" />Pictures</p>
        <p className="mt-0.5 text-2xs text-ink-subtle">Every picture is kept. Choose the one your videos use.</p>
      </div>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={`${avatar.name}’s pictures`}>
        {pictures.map((picture) => (
          <div key={picture.file} className="relative">
            {/* Switching a picture is an action (it swaps the avatar's reactions), so each is a button, not an arrow-key radio. */}
            <button type="button" aria-pressed={picture.active} disabled={busy || working !== null}
              aria-label={`${PICTURE_LABELS[picture.source]}${picture.active ? ' (in use)' : ''}`}
              onClick={() => { if (!picture.active) void run(picture.file, () => getApi().avatars.usePicture(avatar.id, picture.file)) }}
              className={cn('glass-tile block w-full overflow-hidden rounded-lg text-left', picture.active ? 'glass-selected ring-1 ring-accent' : 'glass-tile-hover opacity-80 hover:opacity-100')}>
              <img src={localFileUrl(picture.path)} alt="" className="aspect-[9/16] w-full object-cover" />
              <span className="block truncate px-1.5 py-1 text-2xs text-ink">{working === picture.file ? 'Switching…' : picture.active ? 'In use' : PICTURE_LABELS[picture.source]}</span>
            </button>
            {!picture.active && (
              <button type="button" aria-label={`Remove this ${PICTURE_LABELS[picture.source].toLowerCase()}`} disabled={busy || working !== null}
                onClick={() => setConfirming(picture.file)}
                className="glass-chip absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-white disabled:opacity-40">
                <X className="h-3 w-3" />
              </button>
            )}
            {picture.active && picture.source !== 'unknown' && <span className="pointer-events-none absolute left-1 top-1"><Badge tone="neutral">{PICTURE_LABELS[picture.source]}</Badge></span>}
          </div>
        ))}
        {avatar.kind === 'self' && pictures.length < MAX_AVATAR_PICTURES && (
          <button type="button" disabled={busy || working !== null} onClick={() => void run('add', () => getApi().avatars.addPhoto(avatar.id))}
            className="glass-tile glass-tile-hover flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-center text-ink-muted hover:text-ink disabled:opacity-50">
            <Plus className="h-4 w-4" />
            <span className="px-1 text-2xs">{working === 'add' ? 'Adding…' : 'Add your photo'}</span>
          </button>
        )}
      </div>
      {confirming && (() => {
        const picture = pictures.find((item) => item.file === confirming)
        if (!picture) return null
        const reactions = picture.archivedReactions
        return (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-2xs text-ink-muted">
            <span className="flex-1">Delete this {PICTURE_LABELS[picture.source].toLowerCase()}{reactions ? ` and the ${reactions} AI reaction${reactions === 1 ? '' : 's'} made from it` : ''}? This can’t be undone.</span>
            <Button size="sm" variant="danger" disabled={working !== null} onClick={() => { setConfirming(null); void run(`rm:${picture.file}`, () => getApi().avatars.removePicture(avatar.id, picture.file)) }}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep it</Button>
          </div>
        )
      })()}
      {pictures.length >= MAX_AVATAR_PICTURES && <p className="text-2xs text-ink-subtle">{avatar.name} has {MAX_AVATAR_PICTURES} pictures, the most an avatar keeps. Remove one to add or make another.</p>}
    </div>
  )
}

/** Silent reaction clips for Remix's "React to a clip": made once with AI from the picture, or the member's own recordings. */
function ReactionLibrary({ avatar, busy, openrouterConfigured, onChange, onError }: {
  avatar: AvatarSummary; busy: boolean; openrouterConfigured: boolean; onChange: (list: AvatarSummary[]) => void; onError: (message: string | null) => void
}): React.JSX.Element {
  const [making, setMaking] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => setNote(null), [avatar.id])
  const ready = new Map((avatar.reactions ?? []).map((reaction) => [reaction.id, reaction]))
  const missing = REACTIONS.filter((reaction) => !ready.has(reaction.id)).length
  const make = async (): Promise<void> => {
    setMaking(true); onError(null); setNote(null)
    try {
      const result = await getApi().avatars.makeReactions(avatar.id)
      onChange(result.avatars)
      if (result.error) onError(`${result.error}${result.made ? ` (${result.made} reaction${result.made === 1 ? ' was' : 's were'} made first and kept.)` : ''}`)
      else setNote(result.failed.length ? `Made ${result.made}. These didn’t work this time: ${result.failed.join(', ')}. Try again, or upload your own.` : `Made ${result.made} reaction${result.made === 1 ? '' : 's'}.`)
    } catch (err) { onError(errorMessage(err)) } finally { setMaking(false) }
  }
  const upload = async (kind: string): Promise<void> => {
    onError(null)
    try { const list = await getApi().avatars.uploadReaction(avatar.id, kind); if (list) onChange(list) } catch (err) { onError(errorMessage(err)) }
  }
  return (
    <div className="glass-tile space-y-3 rounded-xl p-3">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink"><Film className="h-3.5 w-3.5" />Reactions for React to a clip</p>
        <p className="mt-0.5 text-2xs text-ink-subtle">Short silent clips of {avatar.name} watching, nodding and pointing, played behind the viral clip in Remix. Made once, reused in every video.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {REACTIONS.map((reaction) => {
          const clip = ready.get(reaction.id)
          return (
            <div key={reaction.id} className="space-y-1">
              {clip
                ? <video key={`${clip.path}:${clip.version ?? 0}`} src={localFileUrl(clip.path)} muted loop autoPlay playsInline aria-label={`${reaction.label} reaction`} className="aspect-[9/16] w-full rounded-lg bg-black object-cover" />
                : <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg bg-white/[0.04] text-2xs text-ink-subtle">Not made yet</div>}
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-2xs text-ink">{reaction.label}{clip?.source === 'own' ? ' · yours' : ''}</span>
                <button type="button" className="shrink-0 text-2xs text-accent disabled:opacity-50" disabled={busy || making}
                  aria-label={`Upload my own ${reaction.label} clip`} onClick={() => void upload(reaction.id)}>{clip ? 'Replace' : 'Upload'}</button>
              </div>
            </div>
          )
        })}
      </div>
      {missing > 0 && (
        <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={making} disabled={making || busy || !openrouterConfigured}
          tooltip={!openrouterConfigured ? 'Add your OpenRouter key in Settings first' : undefined} onClick={() => void make()}>
          {making ? `Making ${missing} reactions…` : `Make ${missing} AI reaction${missing === 1 ? '' : 's'} · about $${(missing * PRICES.reactionClip).toFixed(2)}`}
        </Button>
      )}
      {making && <p className="text-2xs text-ink-subtle">This takes a few minutes. You can keep working; they’ll appear here when ready.</p>}
      {note && <p className="text-2xs text-ink-muted">{note}</p>}
    </div>
  )
}
