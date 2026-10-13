import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { AudioLines, Clapperboard, Film, FolderOpen, Mic, Plus, Repeat2, Sparkles, Trash2, UserRound, Wand2, X } from 'lucide-react'
import {
  estimateRecreateCost, estimateRenderCost, estimateSpokenSeconds, MAX_SCENES, MAX_SCENE_SECONDS, overlongScenes, type SceneQuality, RECREATE_MAX_SECONDS, RECREATE_MIN_SECONDS, type RecreateMode, MAX_SPOKEN_SECONDS, PRESET_VOICES, scriptText, SCRIPT_LENGTHS,
  type AvatarRenderStatus, type AvatarScene, type AvatarScript, type AvatarSummary, type AvatarVideoStyle, type AvatarVoice, type LipSyncModel, type ScriptLength
} from '../../shared/avatars'
import { DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import type { Page as PageName } from '../components/Sidebar'
import { BackgroundPicker } from '../components/BackgroundPicker'
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
import { Segmented } from '../components/ui/Segmented'
import { Select } from '../components/ui/Select'
import { SettingRow } from '../components/ui/SettingRow'
import { Switch } from '../components/ui/Switch'
import { getApi } from '../lib/ipc'
import { requestSettingsSection } from '../lib/settings-focus'
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
  update: (patch: Partial<Omit<StudioDraft, 'update'>>) => void
}

const EMPTY_SCRIPT: AvatarScript = { title: '', scenes: [{ narration: '', visual: '', featuresAvatar: true }] }

const useStudioDraft = create<StudioDraft>((set) => ({
  avatarId: null, style: 'talking',
  recreate: { sourcePath: null, sourceSeconds: 0, startSeconds: 0, endSeconds: 0, mode: 'replace', keepAudio: true, rightsConfirmed: false },
  topic: '', niche: '', seconds: 30, script: EMPTY_SCRIPT, lipSync: 'fabric', sceneQuality: 'standard', cinematicScenes: null,
  captionPreset: DEFAULT_CAPTION_PRESET, includeCaptions: true, includeTitle: true, backgroundVideo: null, brandIdentityId: null,
  update: (patch) => set(patch)
}))

function voiceLabel(voice: AvatarVoice): string {
  return voice.provider === 'elevenlabs' ? voice.voice : 'Cloned voice'
}

export function AvatarStudioPage({ onNavigate }: { onNavigate: (page: PageName) => void }): React.JSX.Element {
  const falConfigured = useSettingsStore((s) => s.falConfigured)
  const openrouterConfigured = useSettingsStore((s) => s.openrouterConfigured)
  const draft = useStudioDraft()
  const [avatars, setAvatars] = useState<AvatarSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [status, setStatus] = useState<AvatarRenderStatus | null>(null)
  const [launching, setLaunching] = useState(false)
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    let live = true
    getApi().brandIdentities.list().then((list) => { if (live) setBrands(list.map(({ id, name }) => ({ id, name }))) }).catch(() => undefined)
    getApi().avatars.list().then((list) => { if (live) setAvatars(list) }).catch((err) => { if (live) setError(errorMessage(err)) })
    getApi().avatars.renderStatus().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().avatars.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [])

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
    : text ? estimateRenderCost({ style: draft.style, lipSync: draft.lipSync, sceneQuality: draft.sceneQuality, script: draft.script }) : 0,
  [draft.style, draft.lipSync, draft.sceneQuality, draft.script, text, recreate])
  const longScenes = draft.style === 'cinematic' && text ? overlongScenes(draft.script) : []
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

  const generate = async (): Promise<void> => {
    if (!selected) return
    setError(null)
    setLaunching(true)
    try {
      const started = draft.style === 'recreate'
        ? await getApi().avatars.recreate({
          avatarId: selected.id, sourcePath: recreate.sourcePath, startSeconds: recreate.startSeconds, endSeconds: recreate.endSeconds, mode: recreate.mode,
          keepAudio: recreate.keepAudio, title: draft.script.title, captionPreset: draft.captionPreset, includeCaptions: draft.includeCaptions && recreate.keepAudio,
          includeTitle: draft.includeTitle, rightsConfirmed: recreate.rightsConfirmed
        })
        : await getApi().avatars.render({
          avatarId: selected.id, style: draft.style, script: draft.script, lipSync: draft.lipSync, sceneQuality: draft.sceneQuality, captionPreset: draft.captionPreset,
          includeCaptions: draft.includeCaptions, includeTitle: draft.includeTitle, backgroundVideo: draft.style === 'talking' ? draft.backgroundVideo : null
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

      {!falConfigured && (
        <Callout tone="info" className="mt-4" title="Add your fal.ai key to start"
          action={<Button size="sm" onClick={openKeys}>Open API keys</Button>}>
          Avatar Studio generates faces, voices and video on your own fal.ai account (pay as you go).
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
                    <img src={localFileUrl(avatar.portraitPath)} alt="" className="aspect-[9/16] w-full object-cover" />
                    <span className="block truncate px-2 py-1.5 text-2xs font-medium text-ink">{avatar.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
          {selected && <AvatarDetails avatar={selected} busy={busy} falConfigured={falConfigured} onChange={setAvatars} onError={setError} />}
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
                  ? 'Your avatar speaks to camera. Reliable and the cheapest option. Pairs well with a gameplay split.'
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

              <Field label="Hook text" hint="Shown at the top of the video. 2-7 words, outcome first.">
                <TextInput value={draft.script.title} maxLength={80} placeholder="e.g. Stop doing this with your paycheck" onChange={(e) => draft.update({ script: { ...draft.script, title: e.target.value } })} />
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
                    <TextArea rows={draft.style === 'cinematic' ? 3 : 8} value={scene.narration} onChange={(e) => updateScene(index, { narration: e.target.value })}
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
                <Field label="Animation quality">
                  <Select value={draft.lipSync} onChange={(value) => draft.update({ lipSync: value as LipSyncModel })} options={[
                    { value: 'economy', label: 'Economy', detail: 'Kling Avatar · about 1/3 the cost' },
                    { value: 'fabric', label: 'Standard', detail: 'VEED Fabric · up to 1 min' },
                    { value: 'omnihuman', label: 'Premium', detail: 'OmniHuman 1.5 · most expressive' }
                  ]} />
                </Field>
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
              <SettingRow title="Hook text at the top" description="The hook text card, like Create's clips."
                control={<Switch label="Hook text" checked={draft.includeTitle} onChange={(includeTitle) => draft.update({ includeTitle })} />} />
              {draft.includeCaptions && (draft.style !== 'recreate' || recreate.keepAudio) && <CaptionPresetPicker value={draft.captionPreset} onChange={(captionPreset) => draft.update({ captionPreset })} />}
              {draft.style === 'talking' && (
                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="eyebrow">Gameplay split</span><span className="text-2xs text-ink-subtle">Optional</span></div>
                  <BackgroundPicker value={draft.backgroundVideo} onChange={(backgroundVideo) => draft.update({ backgroundVideo })} />
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="3 · Generate" description={draft.style === 'recreate'
              ? (recreate.sourcePath ? `Estimated cost about $${cost.toFixed(2)} on fal.ai · ${recreateLength.toFixed(1)}s video` : 'Choose a video to see the estimated cost.')
              : text ? `Estimated cost about $${cost.toFixed(2)} on fal.ai · ${seconds}s video` : 'Write a script to see the estimated cost.'} />
            <div className="mt-4 space-y-3">
              {status && <RenderProgress status={status} />}
              <div className="flex flex-wrap gap-2">
                {busy ? (
                  <Button variant="secondary" onClick={() => void getApi().avatars.cancelRender()}>Cancel</Button>
                ) : (
                  <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={launching} disabled={launching || !falConfigured || !selected || (draft.style === 'recreate' ? !recreateReady : !text || seconds > MAX_SPOKEN_SECONDS || longScenes.length > 0)}
                    tooltip={!selected ? 'Create an avatar first' : draft.style === 'recreate' ? (recreateReady ? undefined : 'Choose a video, a 3-30 second range, and confirm your rights') : !text ? 'Write a script first' : undefined} onClick={() => void generate()}>
                    Generate video
                  </Button>
                )}
              </div>
              <p className="text-2xs text-ink-subtle">
                Talking-head videos take a few minutes; cinematic and recreated ones up to 10-20. You can leave this page while it works.
                {busy && ' Cancelling stops what hasn’t started; a step already running on fal.ai may still be charged.'}
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {creating && <CreateAvatarDialog falConfigured={falConfigured} onClose={() => setCreating(false)} onCreated={(list) => {
        setAvatars(list); setCreating(false); if (list[0]) draft.update({ avatarId: list[0].id })
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

function RenderProgress({ status }: { status: AvatarRenderStatus }): React.JSX.Element {
  if (status.phase === 'done' && status.outputPath) {
    return (
      <div className="space-y-3">
        {status.warning && <Callout tone="warning">{status.warning}</Callout>}
        <video key={status.outputPath} src={localFileUrl(status.outputPath)} controls className="mx-auto aspect-[9/16] max-h-[520px] rounded-2xl bg-black" />
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.showItemInFolder(status.outputPath!)}>Show in folder</Button>
        </div>
      </div>
    )
  }
  if (status.phase === 'failed') return <Callout tone="danger">{status.error ?? 'Generation failed.'}</Callout>
  if (status.phase === 'cancelled') return <Callout tone="info">Generation cancelled.</Callout>
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-ink-muted"><span>{status.detail}</span><span>{status.percent}%</span></div>
      <ProgressBar value={status.percent} />
    </div>
  )
}

function AvatarDetails({ avatar, busy, falConfigured, onChange, onError }: { avatar: AvatarSummary; busy: boolean; falConfigured: boolean; onChange: (list: AvatarSummary[]) => void; onError: (message: string | null) => void }): React.JSX.Element {
  const [consent, setConsent] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => { setConsent(false); setConfirmRemove(false) }, [avatar.id])
  const clone = avatar.clonedVoice
  const options = [
    ...(clone ? [{ value: 'clone', label: 'Cloned voice', detail: 'Your recording' }] : []),
    ...PRESET_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.hint }))
  ]
  const value = avatar.voice.provider === 'minimax-clone' ? 'clone' : avatar.voice.voice
  const run = async (action: () => Promise<AvatarSummary[] | null>): Promise<void> => {
    onError(null)
    try { const list = await action(); if (list) onChange(list) } catch (err) { onError(errorMessage(err)) }
  }
  return (
    <Panel>
      <PanelHeader title={avatar.name} description={avatar.kind === 'self' ? 'Your likeness' : 'Fictional AI person'}
        action={<Badge tone={avatar.kind === 'self' ? 'accent' : 'neutral'}>{voiceLabel(avatar.voice)}</Badge>} />
      <div className="mt-4 space-y-4">
        <Field label="Voice">
          <Select value={value} options={options} disabled={busy} searchable onChange={(next) => {
            const voice = next === 'clone' ? (clone ? { provider: 'minimax-clone', voiceId: clone.voiceId, clonedAt: clone.clonedAt } : null) : { provider: 'elevenlabs', voice: next }
            if (voice) void run(() => getApi().avatars.update(avatar.id, { voice }))
          }} />
        </Field>
        <div className="glass-tile space-y-2 rounded-xl p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink"><Mic className="h-3.5 w-3.5" />Clone a voice</p>
          <p className="text-2xs text-ink-subtle">Upload 30-90 seconds of clear speech (MP3, WAV or M4A). About $1.50 on fal.ai.{clone ? ' Cloning again replaces the current clone.' : ''}</p>
          <LabeledCheckbox checked={consent} onChange={setConsent} label="This is my voice, or I have the speaker's permission" />
          <Button size="sm" variant="secondary" icon={<AudioLines className="h-3.5 w-3.5" />} loading={cloning} disabled={busy || !falConfigured || !consent}
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

function CreateAvatarDialog({ falConfigured, onClose, onCreated }: { falConfigured: boolean; onClose: () => void; onCreated: (list: AvatarSummary[]) => void }): React.JSX.Element {
  const [kind, setKind] = useState<'self' | 'ai'>(falConfigured ? 'ai' : 'self')
  const [description, setDescription] = useState('')
  const [drafts, setDrafts] = useState<{ draftId: string; path: string }[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [voice, setVoice] = useState<string>(PRESET_VOICES[0].id)
  const [consent, setConsent] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const switchKind = (next: 'self' | 'ai'): void => { setKind(next); setDrafts([]); setChosen(null); setError(null) }
  const attempt = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setWorking(true); setError(null)
    try { await action() } catch (err) { setError(errorMessage(err)) } finally { setWorking(false) }
  }, [])

  const pickPhoto = (): Promise<void> => attempt(async () => {
    const draft = await getApi().avatars.pickPhoto()
    if (draft) { setDrafts([draft]); setChosen(draft.draftId) }
  })
  const generateFaces = (): Promise<void> => attempt(async () => {
    const list = await getApi().avatars.generateFaces(description)
    setDrafts(list); setChosen(list[0]?.draftId ?? null)
  })
  const createAvatar = (): Promise<void> => attempt(async () => {
    if (!chosen) return
    onCreated(await getApi().avatars.create({ draftId: chosen, name, kind, description: kind === 'ai' ? description : '', voice: { provider: 'elevenlabs', voice }, consent }))
  })

  const ready = Boolean(chosen && name.trim() && (kind === 'ai' || consent))
  return (
    <Dialog ref={ref} aria-label="New avatar" onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[560px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <h2 className="text-base font-semibold text-ink">New avatar</h2>
        <Segmented label="Avatar type" value={kind} onChange={switchKind} options={[
          { value: 'ai', label: 'Generate an AI person' },
          { value: 'self', label: 'Use my photo' }
        ]} />
        {kind === 'ai' ? (
          <Field label="Describe the person" hint={falConfigured ? 'Fictional people only. About $0.16 for two options.' : 'Add your fal.ai key in Settings → API keys to generate faces.'}>
            <TextArea rows={3} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Woman in her early 30s, curly dark hair, warm smile, casual olive jacket, cozy home office" />
          </Field>
        ) : (
          <p className="text-xs text-ink-muted">Use a clear, front-facing photo with your face well lit and your mouth closed. A vertical photo works best.</p>
        )}
        <div className="flex gap-2">
          {kind === 'ai'
            ? <Button icon={<Sparkles className="h-4 w-4" />} loading={working && drafts.length === 0} disabled={working || !falConfigured || description.trim().length < 10} onClick={() => void generateFaces()}>{drafts.length ? 'Generate again' : 'Generate faces'}</Button>
            : <Button icon={<UserRound className="h-4 w-4" />} disabled={working} onClick={() => void pickPhoto()}>{drafts.length ? 'Choose another photo' : 'Choose photo'}</Button>}
        </div>
        {drafts.length > 0 && (
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Face">
            {drafts.map((item) => (
              <button key={item.draftId} type="button" role="radio" aria-checked={chosen === item.draftId} onClick={() => setChosen(item.draftId)}
                className={cn('glass-tile overflow-hidden rounded-xl', chosen === item.draftId && 'glass-selected')}>
                <img src={localFileUrl(item.path)} alt="" className="aspect-[9/16] w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><TextInput value={name} maxLength={60} placeholder="e.g. Maya" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Voice">
            <Select value={voice} searchable onChange={setVoice} options={PRESET_VOICES.map((item) => ({ value: item.id, label: item.label, detail: item.hint }))} />
          </Field>
        </div>
        {kind === 'self' && <LabeledCheckbox checked={consent} onChange={setConsent} label="This is me, or I have this person's written permission to use their likeness" />}
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || working} onClick={() => void createAvatar()}>Create avatar</Button>
      </DialogFooter>
    </Dialog>
  )
}
