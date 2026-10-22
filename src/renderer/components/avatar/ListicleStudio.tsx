import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FolderOpen, ImagePlus, ListOrdered, Mic, Plus, Send, Sparkles, Square, Trash2, Wand2, X } from 'lucide-react'
import {
  estimateListicleCost, estimateListicleSeconds, LISTICLE_LIMITS, LISTICLE_MAX_ITEMS, LISTICLE_MAX_RECORDING_SECONDS, LISTICLE_MIN_ITEMS, LISTICLE_SCRIPT_ESTIMATE_USD,
  partKeys, partLabel, spokenText, splitAccent, type ListicleBox, type ListicleItem, type ListicleStatus
} from '../../../shared/listicle'
import { PRESET_VOICES, type AvatarSummary } from '../../../shared/avatars'
import type { BrandIdentity } from '../../../shared/remix'
import { emptyItem, useListicleDraft, type ListicleVoiceChoice } from '../../store/use-listicle-store'
import { useBrands } from '../../store/use-brand-store'
import { getApi } from '../../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../../lib/utils'
import type { Page as PageName } from '../Sidebar'
import { CtaPicker } from '../CtaPicker'
import { PostDialog, type PostableClip } from '../PostDialog'
import { VoicePreview } from '../VoicePreview'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Field, TextArea, TextInput } from '../ui/Field'
import { Panel, PanelHeader } from '../ui/Panel'
import { ProgressBar } from '../ui/ProgressBar'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { SettingRow } from '../ui/SettingRow'
import { Switch } from '../ui/Switch'

function formatUsd(value: number): string {
  return value < 0.01 ? 'under $0.01' : `$${value.toFixed(2)}`
}

/** The brand's defaults for the header, end card and color (until the member types their own). */
function brandDefaults(brand: BrandIdentity | null, draft: ReturnType<typeof useListicleDraft.getState>): Partial<ReturnType<typeof useListicleDraft.getState>> {
  return {
    brandIdentityId: brand?.id ?? null,
    ...(draft.headerEdited ? {} : { header: brand ? brand.name.toUpperCase().slice(0, LISTICLE_LIMITS.header) : '' }),
    ...(draft.handleEdited ? {} : { handle: brand?.look?.handle ?? '' }),
    ...(brand?.look?.color ? { accentColor: brand.look.color } : {}),
    ...(brand?.look?.ctaId && !draft.ctaId ? { ctaId: brand.look.ctaId } : {})
  }
}

/**
 * Avatar Studio → Top list: a faceless "Top N" video. No avatar or camera
 * needed: the member's items and screenshots, an AI-drafted script they can
 * edit, and a voice (preset, an avatar's, or their own recordings).
 */
export function ListicleStudio({ avatars, openrouterConfigured, onNavigate, onViewLibrary, onOpenKeys }: {
  avatars: AvatarSummary[]
  openrouterConfigured: boolean
  onNavigate: (page: PageName) => void
  onViewLibrary?: (outputDir: string) => void
  onOpenKeys: () => void
}): React.JSX.Element {
  const draft = useListicleDraft()
  const brands = useBrands((s) => s.brands)
  const loadBrands = useBrands((s) => s.load)
  const [selected, setSelected] = useState(0)
  const [writing, setWriting] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ListicleStatus | null>(null)

  useEffect(() => {
    let live = true
    void loadBrands()
    getApi().listicle.status().then((current) => { if (live && current) setStatus(current) }).catch(() => undefined)
    const off = getApi().listicle.onStatus((next) => setStatus(next))
    return () => { live = false; off() }
  }, [loadBrands])
  // The member's first brand fills the header, handle and color the first time.
  const filled = useRef(false)
  useEffect(() => {
    if (filled.current || !brands.length) return
    filled.current = true
    const state = useListicleDraft.getState()
    if (!state.brandIdentityId && !state.header && !state.handle) state.update(brandDefaults(brands[0], state))
  }, [brands])

  const brand = brands.find((item) => item.id === draft.brandIdentityId) ?? null
  const avatar = avatars.find((item) => item.id === draft.avatarId) ?? avatars[0] ?? null
  const items = draft.items
  const itemsReady = items.every((item) => item.name.trim())
  const scripted = items.every((item) => item.script.trim())
  const request = { intro: draft.intro, items, handle: draft.handle }
  const voiceKind = draft.voiceChoice === 'recorded' ? 'recorded' : draft.voiceChoice === 'avatar' && avatar?.voice.provider === 'clone' ? 'clone' : 'preset'
  const cost = useMemo(() => scripted ? estimateListicleCost(request, voiceKind) : 0, [scripted, request.intro, items, voiceKind])
  const seconds = scripted ? estimateListicleSeconds(request) : 0
  const keys = partKeys(items.length, Boolean(draft.intro.trim()))
  const missingRecordings = draft.voiceChoice === 'recorded' ? keys.filter((key) => !draft.recordings[key]) : []
  const busy = status !== null && !['done', 'failed', 'cancelled'].includes(status.phase)
  const needsKey = draft.voiceChoice !== 'recorded' && !openrouterConfigured

  const setItems = (next: ListicleItem[]): void => {
    // Recordings belong to an item's place in the list: they're dropped when the list changes length.
    draft.update({ items: next, ...(next.length !== items.length ? { recordings: draft.recordings.intro ? { intro: draft.recordings.intro } : {} } : {}) })
    setSelected((current) => Math.min(current, next.length - 1))
  }

  const writeScript = async (): Promise<void> => {
    setWriting(true); setError(null)
    try {
      const script = await getApi().listicle.writeScript({ title: draft.title, items: items.map((item) => ({ name: item.name, line: item.line })), brandIdentityId: brand?.id ?? null })
      const state = useListicleDraft.getState()
      state.update({
        intro: script.intro, accent: script.titleAccent,
        items: state.items.map((item, i) => script.items[i] ? { ...item, script: script.items[i].script, accent: script.items[i].accent } : item)
      })
    } catch (err) { setError(errorMessage(err, 'The script could not be written.')) } finally { setWriting(false) }
  }

  const make = async (): Promise<void> => {
    setError(null); setLaunching(true)
    try {
      const voice = draft.voiceChoice === 'preset' ? { kind: 'preset', voice: draft.presetVoice }
        : draft.voiceChoice === 'avatar' ? { kind: 'avatar', avatarId: avatar?.id ?? '' }
          : { kind: 'recorded', recordings: Object.fromEntries(keys.map((key) => [key, draft.recordings[key]])) }
      const started = await getApi().listicle.render({
        title: draft.title, accent: draft.accent, intro: draft.intro, items, header: draft.header, handle: draft.handle, accentColor: draft.accentColor,
        voice, captions: draft.captions, ctaId: draft.ctaId, brandIdentityId: brand?.id ?? null
      })
      setStatus((previous) => previous?.id === started.id ? previous : started)
    } catch (err) { setError(errorMessage(err, 'The video could not be started.')) } finally { setLaunching(false) }
  }

  const current = items[selected] ?? items[0]

  return (
    <div className="mt-5 space-y-5">
      {error && <Callout tone="danger" onDismiss={() => setError(null)}>{error}</Callout>}
      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(220px,260px)]">
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="1 · Your list" description={`A title and ${LISTICLE_MIN_ITEMS} to ${LISTICLE_MAX_ITEMS} items. Add a screenshot to any item and drag on it to box the part that matters.`} />
            <div className="mt-4 space-y-4">
              <Field label="List title" hint={draft.title ? <AccentPicker title={draft.title} accent={draft.accent} onChange={(accent) => draft.update({ accent })} label="Italic word in the title" /> : 'For example: 5 AI tools that make your videos look different'}>
                <TextInput aria-label="List title" value={draft.title} maxLength={LISTICLE_LIMITS.title} placeholder="5 AI tools that make your videos look different"
                  onChange={(e) => draft.update({ title: e.target.value })} />
              </Field>
              <ol className="space-y-3" aria-label="Items">
                {items.map((item, i) => (
                  <ItemEditor key={i} index={i} item={item} selected={i === selected} count={items.length} onSelect={() => setSelected(i)}
                    onChange={(patch) => draft.updateItem(i, patch)} onBox={(box) => draft.setBox(i, box)}
                    onRemove={() => setItems(items.filter((_, k) => k !== i))} onError={setError} accentColor={draft.accentColor} />
                ))}
              </ol>
              {items.length < LISTICLE_MAX_ITEMS && (
                <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setItems([...items, emptyItem()]); setSelected(items.length) }}>Add item {items.length + 1}</Button>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="2 · Script" description="The AI drafts an opening line and a short line for each item from what you wrote. Change anything: the video says only what's here." />
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={writing} disabled={writing || !draft.title.trim() || !itemsReady || !openrouterConfigured}
                  onClick={() => void writeScript()}>{scripted ? 'Write it again' : 'Write the script'}</Button>
                <span className="text-2xs text-ink-subtle">
                  {!openrouterConfigured ? 'Needs your OpenRouter key, or write the lines yourself below.' : `One short AI call through your OpenRouter account, about ${formatUsd(LISTICLE_SCRIPT_ESTIMATE_USD)}.`}
                </span>
              </div>
              <Field label="Opening line (optional)" hint="Said over the title before item 1.">
                <TextArea aria-label="Opening line" rows={2} value={draft.intro} maxLength={LISTICLE_LIMITS.intro} onChange={(e) => draft.update({ intro: e.target.value })} />
              </Field>
              {items.map((item, i) => (
                <Field key={i} label={`${i + 1}. ${item.name || `Item ${i + 1}`}`}
                  hint={item.name ? <AccentPicker title={item.name} accent={item.accent} onChange={(accent) => draft.updateItem(i, { accent })} label={`Italic word in item ${i + 1}`} /> : undefined}>
                  <TextArea aria-label={`Script for item ${i + 1}`} rows={2} value={item.script} maxLength={LISTICLE_LIMITS.script} onChange={(e) => draft.updateItem(i, { script: e.target.value })} />
                </Field>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="3 · Voice and look" />
            <div className="mt-4 space-y-4">
              <Segmented<ListicleVoiceChoice> label="Voice" value={draft.voiceChoice} onChange={(voiceChoice) => draft.update({ voiceChoice })} options={[
                { value: 'preset', label: 'AI voice' },
                { value: 'avatar', label: 'My avatar’s voice', disabled: avatars.length ? undefined : 'Make an avatar first' },
                { value: 'recorded', label: 'Record my voice' }
              ]} />
              {draft.voiceChoice === 'preset' && (
                <div className="flex items-center gap-2">
                  <Select className="w-56" value={draft.presetVoice} onChange={(presetVoice) => draft.update({ presetVoice })} title="Voice"
                    options={PRESET_VOICES.map((voice) => ({ value: voice.id, label: voice.label, detail: voice.hint }))} />
                  <VoicePreview request={{ kind: 'avatar', voice: { provider: 'elevenlabs', voice: draft.presetVoice } }} name={draft.presetVoice} />
                </div>
              )}
              {draft.voiceChoice === 'avatar' && avatar && (
                <div className="flex items-center gap-2">
                  <Select className="w-56" value={avatar.id} onChange={(avatarId) => draft.update({ avatarId })} title="Avatar"
                    options={avatars.map((item) => ({ value: item.id, label: item.name, detail: item.voice.provider === 'clone' ? 'Cloned voice' : item.voice.voice }))} />
                  <VoicePreview request={{ kind: 'avatar', voice: avatar.voice, avatarId: avatar.id }} name={avatar.name} />
                </div>
              )}
              {draft.voiceChoice === 'recorded' && (
                <div className="space-y-2">
                  <p className="text-2xs text-ink-muted">Read each part out loud. Your own voice is free, and posting won’t mark it as AI. Up to {LISTICLE_MAX_RECORDING_SECONDS} seconds each.</p>
                  {keys.map((key) => {
                    const text = key === 'intro' ? draft.intro : items[Number(key) - 1]?.script ?? ''
                    return <PartRecorder key={key} label={partLabel(key)} text={text} path={draft.recordings[key] ?? null}
                      onSaved={(path) => draft.update({ recordings: { ...useListicleDraft.getState().recordings, [key]: path } })} onError={setError} />
                  })}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Brand">
                  <Select value={brand?.id ?? ''} onChange={(id) => draft.update(brandDefaults(brands.find((item) => item.id === id) ?? null, useListicleDraft.getState()))} title="Brand"
                    placeholder="No brand" options={[{ value: '', label: 'No brand' }, ...brands.map((item) => ({ value: item.id, label: item.name }))]} />
                </Field>
                <Field label="Header" hint="The label at the top of every frame.">
                  <TextInput aria-label="Header" value={draft.header} maxLength={LISTICLE_LIMITS.header} placeholder="YOUR BRAND · AI TOOLS"
                    onChange={(e) => draft.update({ header: e.target.value, headerEdited: true })} />
                </Field>
                <Field label="Your handle" hint="The end card says “Follow” with it. Leave it empty for no end card.">
                  <TextInput aria-label="Your handle" value={draft.handle} maxLength={LISTICLE_LIMITS.handle} placeholder="@yourhandle"
                    onChange={(e) => draft.update({ handle: e.target.value, handleEdited: true })} />
                </Field>
                <Field label="Accent color">
                  <input type="color" aria-label="Accent color" value={draft.accentColor} onChange={(e) => draft.update({ accentColor: e.target.value.toUpperCase() })}
                    className="h-9 w-16 cursor-pointer rounded-lg border border-white/10 bg-transparent" />
                </Field>
              </div>
              <SettingRow title="Captions" description="Words light up as they’re said, at the bottom." control={<Switch checked={draft.captions} onChange={(captions) => draft.update({ captions })} label="Captions" />} />
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Call to action</p>
                <CtaPicker value={draft.ctaId} onChange={(ctaId) => draft.update({ ctaId })} />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="4 · Make it" />
            {needsKey && (
              <Callout tone="info" className="mt-3" title="Add your OpenRouter key for the AI voice" action={<Button size="sm" onClick={onOpenKeys}>Open API keys</Button>}>
                Or choose Record my voice: your own voice needs no key.
              </Callout>
            )}
            <p className="mt-2 text-xs text-ink-muted" data-testid="listicle-cost">
              {!scripted ? 'Write or draft a line for each item first.'
                : draft.voiceChoice === 'recorded' ? `About ${seconds} seconds long. Your own voice is free: nothing is sent to AI.`
                  : `About ${seconds} seconds long. The voice costs about ${formatUsd(cost)} through your OpenRouter account (list price for ${spokenText(request).length} characters). Drawing the video is free.`}
            </p>
            {missingRecordings.length > 0 && <p className="mt-1 text-2xs text-danger">Record: {missingRecordings.map((key) => partLabel(key).toLowerCase()).join(', ')}.</p>}
            <div className="mt-3 flex justify-end">
              <Button variant="primary" size="lg" icon={<Wand2 className="h-4 w-4" />} loading={launching}
                disabled={busy || launching || !draft.title.trim() || !itemsReady || !scripted || needsKey || missingRecordings.length > 0 || (draft.voiceChoice === 'avatar' && !avatar)}
                onClick={() => void make()}>Make the video</Button>
            </div>
            {status && <ListicleProgress status={status} onNavigate={onNavigate} onViewLibrary={onViewLibrary} title={draft.title} />}
          </Panel>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Preview · item {selected + 1}</p>
          <FramePreview header={draft.header} item={current} index={selected} count={items.length} color={draft.accentColor} />
          <p className="mt-2 text-2xs text-ink-subtle">Click an item to preview it. Captions run along the bottom as it’s read.</p>
        </aside>
      </div>
    </div>
  )
}

/** Choose which word of a title is set in italic. */
function AccentPicker({ title, accent, onChange, label }: { title: string; accent: string; onChange: (accent: string) => void; label: string }): React.JSX.Element {
  const words = title.split(/\s+/).filter(Boolean)
  const chosen = splitAccent(title, accent).accent
  return (
    <span className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={label}>
      <span className="text-2xs text-ink-subtle">Italic word:</span>
      {words.slice(0, 14).map((word, i) => (
        <button key={`${word}-${i}`} type="button" role="radio" aria-checked={word === chosen} onClick={() => onChange(word.replace(/[.,!?:;]+$/, ''))}
          className={cn('rounded-md px-1.5 py-0.5 text-2xs', word === chosen ? 'bg-tool text-canvas' : 'bg-white/[0.06] text-ink-muted hover:text-ink')}>{word}</button>
      ))}
    </span>
  )
}

function ItemEditor({ index, item, selected, count, onSelect, onChange, onBox, onRemove, onError, accentColor }: {
  index: number; item: ListicleItem; selected: boolean; count: number; accentColor: string
  onSelect: () => void; onChange: (patch: Partial<ListicleItem>) => void; onBox: (box: ListicleBox | null) => void; onRemove: () => void; onError: (message: string) => void
}): React.JSX.Element {
  const pick = async (): Promise<void> => {
    try { const path = await getApi().listicle.pickImage(); if (path) onChange({ imagePath: path, box: null }) } catch (err) { onError(errorMessage(err, 'That picture could not be used.')) }
  }
  return (
    <li className={cn('glass-tile rounded-xl p-3', selected && 'glass-selected')} onFocusCapture={onSelect} onClick={onSelect} aria-label={`Item ${index + 1}`}>
      <div className="flex items-start gap-3">
        <span className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={{ background: accentColor, color: '#0C0C10' }}>{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <TextInput aria-label={`Name of item ${index + 1}`} value={item.name} maxLength={LISTICLE_LIMITS.name} placeholder="Name, e.g. HyperFrames" onChange={(e) => onChange({ name: e.target.value })} />
          <TextArea aria-label={`About item ${index + 1}`} rows={2} value={item.line} maxLength={LISTICLE_LIMITS.line} placeholder="A line or two: what it is and why it’s on the list" onChange={(e) => onChange({ line: e.target.value })} />
          {item.imagePath ? (
            <div className="space-y-1.5">
              <BoxDrawer path={item.imagePath} box={item.box} onChange={onBox} color={accentColor} label={`Picture for item ${index + 1}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xs text-ink-subtle">{item.box ? 'The boxed part glows in the video.' : 'Drag on the picture to box the part that matters, or leave it to fill the card.'}</span>
                {item.box && <Button size="sm" variant="ghost" onClick={() => onBox(null)}>Clear box</Button>}
                <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => onChange({ imagePath: null, box: null })}>Remove picture</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => void pick()}>Add a screenshot</Button>
          )}
        </div>
        {count > LISTICLE_MIN_ITEMS && <Button size="sm" variant="ghost" iconOnly aria-label={`Remove item ${index + 1}`} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); onRemove() }} />}
      </div>
    </li>
  )
}

/** The picture with a box the member drags out (stored as shares of its width and height). */
function BoxDrawer({ path, box, onChange, color, label }: { path: string; box: ListicleBox | null; onChange: (box: ListicleBox | null) => void; color: string; label: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const point = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) }
  }
  const shown = drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : box
  return (
    <div ref={ref} className="relative max-w-sm cursor-crosshair select-none overflow-hidden rounded-lg bg-black/40" aria-label={label} role="img" data-testid="listicle-box-drawer"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }) }}
      onPointerMove={(e) => { if (drag) { const p = point(e); setDrag({ ...drag, x1: p.x, y1: p.y }) } }}
      onPointerUp={() => {
        if (shown && shown.w >= 0.02 && shown.h >= 0.02) onChange({ x: shown.x, y: shown.y, w: shown.w, h: shown.h })
        setDrag(null)
      }}>
      <img src={localFileUrl(path)} alt="" draggable={false} className="block w-full" />
      {shown && shown.w > 0 && shown.h > 0 && (
        <span className="pointer-events-none absolute rounded-md" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%`, border: `2px solid ${color}`, boxShadow: `0 0 12px ${color}` }} />
      )}
    </div>
  )
}

/** Record one spoken part with the microphone. */
function PartRecorder({ label, text, path, onSaved, onError }: { label: string; text: string; path: string | null; onSaved: (path: string) => void; onError: (message: string) => void }): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current)
    recorder.current?.stream.getTracks().forEach((track) => track.stop())
  }, [])
  const stop = (): void => { if (recorder.current?.state === 'recording') recorder.current.stop() }
  const start = async (): Promise<void> => {
    try {
      await getApi().remix.mediaAccess().catch(() => null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
      const next = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (timer.current) { window.clearInterval(timer.current); timer.current = null }
        setPhase('saving')
        const type = next.mimeType || 'audio/webm'
        void new Blob(chunks, { type }).arrayBuffer().then((buffer) => getApi().listicle.saveRecording(new Uint8Array(buffer), type.startsWith('audio/mp4') ? 'video/mp4' : 'audio/webm'))
          .then(onSaved).catch((err) => onError(errorMessage(err, 'The recording could not be saved.'))).finally(() => setPhase('idle'))
      }
      recorder.current = next
      next.start(500)
      setElapsed(0)
      setPhase('recording')
      const began = Date.now()
      timer.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - began) / 1000)
        setElapsed(seconds)
        if (seconds >= LISTICLE_MAX_RECORDING_SECONDS) stop()
      }, 250)
    } catch {
      onError('The microphone could not be opened. Allow CreatorClips to use it, then try again.')
    }
  }
  return (
    <div className="glass-tile flex flex-wrap items-center gap-3 rounded-xl px-3 py-2" aria-label={`Recording: ${label}`}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">{label}</p>
        <p className="truncate text-2xs text-ink-muted">{text || 'Write this line first.'}</p>
      </div>
      {path && phase === 'idle' && <audio src={localFileUrl(path)} controls className="h-8 w-48" aria-label={`Your recording: ${label}`} />}
      {phase === 'recording'
        ? <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={stop}>Stop · {elapsed}s</Button>
        : <Button size="sm" variant={path ? 'ghost' : 'secondary'} icon={path ? <Check className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />} loading={phase === 'saving'} disabled={!text.trim() || phase === 'saving'}
          onClick={() => void start()}>{path ? 'Record again' : 'Record'}</Button>}
    </div>
  )
}

/** A small live sketch of the frame: header, title with its italic word, the chips and the card. */
function FramePreview({ header, item, index, count, color }: { header: string; item: ListicleItem | undefined; index: number; count: number; color: string }): React.JSX.Element {
  const name = item?.name || `Item ${index + 1}`
  const parts = splitAccent(name, item?.accent ?? '')
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-gradient-to-b from-[#0C0C10] to-[#16161E] p-3 text-center" data-testid="listicle-preview">
      {header && <div className="mx-auto inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[8px] font-bold tracking-[0.15em] text-white/80"><span className="h-1 w-1 rounded-full" style={{ background: color }} />{header.toUpperCase()}</div>}
      <p className="mt-3 text-[15px] font-extrabold leading-tight text-white">
        {index + 1}. {parts.before} {parts.accent && <span className="font-serif text-[18px] font-normal italic" style={{ color }}>{parts.accent}</span>} {parts.after}
      </p>
      <div className="mt-2 flex justify-center gap-1">
        {Array.from({ length: count }, (_, n) => (
          <span key={n} className={cn('flex h-4 w-4 items-center justify-center rounded text-[8px] font-bold', n === index ? 'text-[#0C0C10]' : n < index ? 'bg-white/10 text-white/80' : 'border border-white/25 text-white/50')}
            style={n === index ? { background: color } : undefined}>{n + 1}</span>
        ))}
      </div>
      <div className="relative mx-auto mt-3 flex h-[52%] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#1A1A22]">
        {item?.imagePath ? (
          <span className="relative block w-full">
            <img src={localFileUrl(item.imagePath)} alt="" className="block w-full" />
            {item.box && <span className="absolute rounded" style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.w * 100}%`, height: `${item.box.h * 100}%`, border: `2px solid ${color}`, boxShadow: `0 0 10px ${color}` }} />}
          </span>
        ) : (
          <span className="font-serif text-6xl italic" style={{ color }}>{String(index + 1).padStart(2, '0')}</span>
        )}
      </div>
      <p className="absolute inset-x-3 bottom-[12%] text-[11px] font-extrabold text-white">{(item?.script || 'Your words appear here').split(' ').slice(0, 6).map((word, i) => <span key={i} className={i < 3 ? '' : 'text-white/40'}>{word} </span>)}</p>
    </div>
  )
}

function ListicleProgress({ status, title, onNavigate, onViewLibrary }: { status: ListicleStatus; title: string; onNavigate: (page: PageName) => void; onViewLibrary?: (outputDir: string) => void }): React.JSX.Element {
  const [posting, setPosting] = useState<PostableClip[] | null>(null)
  if (status.phase === 'done' && status.outputPath) {
    const outputDir = status.outputDir
    return (
      <div className="mt-4 space-y-3" data-testid="listicle-result">
        <div className="flex flex-wrap items-start gap-4">
          <video src={localFileUrl(status.outputPath)} controls playsInline className="aspect-[9/16] w-[200px] rounded-xl bg-black object-contain" aria-label="Your list video" />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink">Your list video is ready</p>
            <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setPosting([{ path: status.outputPath!, title: title || 'Top list', tags: [], durationMs: 0, aiGenerated: true }])}>Post or schedule</Button>
            {onViewLibrary && outputDir && <Button variant="secondary" icon={<FolderOpen className="h-4 w-4" />} onClick={() => onViewLibrary(outputDir)}>Open in Library</Button>}
            {status.warning && <p className="max-w-xs text-2xs text-ink-muted">{status.warning}</p>}
          </div>
        </div>
        {posting && <PostDialog clips={posting} onClose={() => setPosting(null)} onNavigate={onNavigate} />}
      </div>
    )
  }
  if (status.phase === 'failed') return <Callout tone="danger" className="mt-4" title="The video could not be made">{status.error}</Callout>
  if (status.phase === 'cancelled') return <p className="mt-4 text-xs text-ink-muted">Canceled. Nothing was saved.</p>
  return (
    <div className="mt-4 space-y-2" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="flex items-center gap-2"><ListOrdered className="h-3.5 w-3.5" />{status.detail}</span>
        <Button size="sm" variant="ghost" onClick={() => void getApi().listicle.cancel()}>Cancel</Button>
      </div>
      <ProgressBar value={status.percent} />
    </div>
  )
}
