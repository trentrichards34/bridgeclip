import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Palette, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { MAX_PRESET_NAME, MAX_PRESETS, pickStyle, presetName, type StyleKind } from '../../shared/member-prefs'
import { useDraftStore } from '../store/use-draft-store'
import { useBrands } from '../store/use-brand-store'
import { brandFormPatch } from '../../shared/brand-kit'
import { cn } from '../lib/utils'
import { useRemixForm } from '../store/use-remix-form-store'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { errorMessage } from '../lib/utils'
import { ActionMenu } from './ui/ActionMenu'
import { Button } from './ui/Button'
import { ConfirmDialog, type ConfirmRequest } from './ui/ConfirmDialog'
import { Dialog, DialogFooter } from './ui/Dialog'
import { Field, TextInput } from './ui/Field'
import { Select } from './ui/Select'

/** Re-render when the form changes, so the picker shows which saved style matches it. */
function useStyleJson(kind: StyleKind): string {
  const create = useDraftStore((state) => (kind === 'create' ? JSON.stringify(pickStyle('create', state)) : ''))
  const remix = useRemixForm((state) => (kind === 'remix' ? JSON.stringify(pickStyle('remix', state)) : ''))
  return kind === 'create' ? create : remix
}

/**
 * "Style": the member's saved styles for Create or Remix. Pick one to apply it,
 * save the current settings under a name, rename or delete one.
 */
export function StylePresets({ kind, className }: { kind: StyleKind; className?: string }): React.JSX.Element | null {
  const presets = useMemberPrefsStore((state) => state.presets[kind])
  const loaded = useMemberPrefsStore((state) => state.loaded)
  const current = useStyleJson(kind)
  const match = presets.find((preset) => JSON.stringify(preset.style) === current) ?? null
  const [picked, setPicked] = useState<string | null>(null)
  // The last one picked stays shown while the form still matches it.
  const active = presets.find((preset) => preset.id === picked && JSON.stringify(preset.style) === current) ?? match
  const [naming, setNaming] = useState<{ mode: 'save' | 'rename'; id?: string; name: string } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeConfirm = useCallback(() => setConfirm(null), [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])
  if (!loaded) return null

  const apply = (id: string): void => {
    if (!id) return
    setError(null)
    setPicked(id)
    useMemberPrefsStore.getState().applyPreset(kind, id)
    const name = presets.find((preset) => preset.id === id)?.name
    if (name) setNotice(`Applied “${name}”`)
  }
  const remove = (id: string, name: string): void => setConfirm({
    title: `Delete “${name}”?`,
    body: 'This removes the saved style. Your current settings stay as they are.',
    confirmLabel: 'Delete style',
    onConfirm: () => {
      setError(null)
      void useMemberPrefsStore.getState().deletePreset(kind, id).catch((err) => setError(errorMessage(err, 'The style could not be deleted.')))
    }
  })

  return (
    <div className={className}>
      <div className="glass-tile flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm text-ink"><Palette className="h-4 w-4 text-ink-muted" />Style</span>
        <div className="min-w-[180px] flex-1">
          <Select size="sm" aria-label="Saved style" value={active?.id ?? ''} onChange={apply}
            placeholder={presets.length ? 'Choose a saved style' : 'No saved styles yet'} emptyText="Save your current settings to reuse them."
            options={presets.map((preset) => ({ value: preset.id, label: preset.name }))} />
        </div>
        <Button size="sm" variant="secondary" icon={<Save className="h-3.5 w-3.5" />}
          disabled={presets.length >= MAX_PRESETS && !active}
          tooltip={presets.length >= MAX_PRESETS ? `You can save up to ${MAX_PRESETS} styles. Delete one first.` : undefined}
          onClick={() => { setError(null); setNaming({ mode: 'save', name: active?.name ?? '' }) }}>
          Save current as…
        </Button>
        {active && <ActionMenu label={`Actions for style “${active.name}”`} actions={[
          { label: 'Rename…', icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => { setError(null); setNaming({ mode: 'rename', id: active.id, name: active.name }) } },
          { label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onSelect: () => remove(active.id, active.name) }
        ]} />}
        {notice && <span role="status" className="text-2xs text-success">{notice}</span>}
      </div>
      {error && <p role="alert" className="mt-1.5 px-1 text-2xs text-danger">{error}</p>}
      {naming && <NameDialog kind={kind} mode={naming.mode} initial={naming.name} taken={presets.filter((preset) => preset.id !== naming.id).map((preset) => preset.name)}
        onClose={() => setNaming(null)}
        onSave={async (name) => {
          const store = useMemberPrefsStore.getState()
          if (naming.mode === 'rename' && naming.id) {
            await store.renamePreset(kind, naming.id, name)
            setNotice(`Renamed to “${name}”`)
          } else {
            await store.savePreset(kind, name)
            const saved = useMemberPrefsStore.getState().presets[kind].find((preset) => preset.name.toLowerCase() === name.toLowerCase())
            if (saved) setPicked(saved.id)
            setNotice(`Saved “${name}”`)
          }
          setNaming(null)
        }} />}
      {confirm && <ConfirmDialog request={confirm} onClose={closeConfirm} />}
    </div>
  )
}

/**
 * "Save as a style" on the style board: names the current settings as a saved
 * style (the same saved styles the Style bar above applies).
 */
export function SaveStyleButton({ kind }: { kind: StyleKind }): React.JSX.Element | null {
  const presets = useMemberPrefsStore((state) => state.presets[kind])
  const loaded = useMemberPrefsStore((state) => state.loaded)
  const current = useStyleJson(kind)
  const match = presets.find((preset) => JSON.stringify(preset.style) === current) ?? null
  const [naming, setNaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])
  if (!loaded) return null
  const full = presets.length >= MAX_PRESETS && !match
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Save className="h-3.5 w-3.5" />} disabled={full}
        tooltip={full ? `You can save up to ${MAX_PRESETS} styles. Delete one first.` : match ? `Matches your saved style “${match.name}”` : undefined}
        onClick={() => setNaming(true)}>
        Save as a style
      </Button>
      {notice && <span role="status" className="text-2xs text-success">{notice}</span>}
      {naming && <NameDialog kind={kind} mode="save" initial={match?.name ?? ''} taken={presets.map((preset) => preset.name)}
        onClose={() => setNaming(false)}
        onSave={async (name) => {
          await useMemberPrefsStore.getState().savePreset(kind, name)
          setNotice(`Saved “${name}”`)
          setNaming(false)
        }} />}
    </>
  )
}

export function NameDialog({ kind, mode, initial, taken, onClose, onSave }: {
  kind: StyleKind; mode: 'save' | 'rename'; initial: string; taken: string[]; onClose: () => void; onSave: (name: string) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(initial)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  const clean = presetName(name)
  const replaces = mode === 'save' && clean !== null && taken.some((item) => item.toLowerCase() === clean.toLowerCase())
  const duplicate = mode === 'rename' && clean !== null && taken.some((item) => item.toLowerCase() === clean.toLowerCase())
  const submit = async (): Promise<void> => {
    if (!clean || duplicate || working) return
    setWorking(true); setError(null)
    try { await onSave(clean) } catch (err) { setError(errorMessage(err, 'The style could not be saved.')); setWorking(false) }
  }
  const title = mode === 'rename' ? 'Rename style' : kind === 'create' ? 'Save your Create style' : 'Save your Remix style'
  return (
    <Dialog aria-label={title} onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[420px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {mode === 'save' && <p className="text-xs text-ink-muted">
          {kind === 'create'
            ? 'Saves your format, clip length, captions, hook text, title and call to action. Not the video or what to clip.'
            : 'Saves your remix kind, style, presenter, voice, brand identity, captions, hook text, call to action and camera look. Not the links, the file or the creator’s name.'}
        </p>}
        <Field label="Name" hint={replaces ? 'A style with this name exists: saving replaces it.' : duplicate ? 'You already have a style with that name.' : `${name.trim().length} / ${MAX_PRESET_NAME} characters`}>
          <TextInput ref={input} aria-label="Style name" value={name} maxLength={MAX_PRESET_NAME} placeholder="e.g. Podcast clips" onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-2xs text-danger">{error}</p>}
      </form>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={working} disabled={!clean || duplicate || working} onClick={() => void submit()}>
          {mode === 'rename' ? 'Rename' : replaces ? 'Replace' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** The Create defaults (the app's), with the member's default brand look on top. */
export function createDefaultStyle(): Record<string, unknown> {
  const initial = useDraftStore.getInitialState()
  const draft = useDraftStore.getState()
  const defaults = pickStyle('create', initial) as Record<string, unknown>
  const brand = useBrands.getState().brands.find((item) => item.id === draft.brandIdentityId) ?? null
  if (!brand) return defaults
  return { ...defaults, brandIdentityId: brand.id, ...brandFormPatch(brand.look, { ...initial, ...(defaults as object) } as Parameters<typeof brandFormPatch>[1]),
    ...(brand.look?.captionPreset ? { includeCaptions: true } : {}) }
}

/** True when every field of `style` matches the form's current style. */
function matches(style: Record<string, unknown> | null, current: Record<string, unknown>): boolean {
  if (!style || !Object.keys(style).length) return false
  return Object.entries(style).every(([key, value]) => JSON.stringify(current[key] ?? null) === JSON.stringify(value ?? null))
}

const START_CHIP = 'inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Create's "Start from" row: the settings of the last run, the defaults (with
 * the default brand look), the member's saved styles, and saving the current
 * settings as a new one. Applying one changes only style fields, never the video.
 */
export function CreateStartFrom({ className }: { className?: string }): React.JSX.Element | null {
  const presets = useMemberPrefsStore((state) => state.presets.create)
  const loaded = useMemberPrefsStore((state) => state.loaded)
  const lastRun = useDraftStore((state) => state.lastRun)
  const json = useStyleJson('create')
  useBrands((state) => state.brands)
  const current = JSON.parse(json || '{}') as Record<string, unknown>
  const match = presets.find((preset) => JSON.stringify(preset.style) === json) ?? null
  const [picked, setPicked] = useState<string | null>(null)
  const active = presets.find((preset) => preset.id === picked && JSON.stringify(preset.style) === json) ?? match
  const [naming, setNaming] = useState<{ mode: 'save' | 'rename'; id?: string; name: string } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeConfirm = useCallback(() => setConfirm(null), [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])
  if (!loaded) return null

  const defaults = createDefaultStyle()
  const onLast = matches(lastRun as Record<string, unknown> | null, current)
  const onDefaults = !onLast && matches(defaults, current)
  const apply = (style: object, message: string): void => {
    setError(null)
    useDraftStore.getState().update(style)
    setNotice(message)
  }
  const applyPreset = (id: string): void => {
    if (!id) return
    setError(null)
    setPicked(id)
    useMemberPrefsStore.getState().applyPreset('create', id)
    const name = presets.find((preset) => preset.id === id)?.name
    if (name) setNotice(`Applied “${name}”`)
  }
  const remove = (id: string, name: string): void => setConfirm({
    title: `Delete “${name}”?`,
    body: 'This removes the saved style. Your current settings stay as they are.',
    confirmLabel: 'Delete style',
    onConfirm: () => {
      setError(null)
      void useMemberPrefsStore.getState().deletePreset('create', id).catch((err) => setError(errorMessage(err, 'The style could not be deleted.')))
    }
  })
  const chip = (on: boolean): string => cn(START_CHIP, on
    ? 'bg-tool/[0.1] text-tool shadow-[inset_0_0_0_1px_rgb(var(--tool)/0.5)]'
    : 'bg-surface/80 text-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:bg-overlay')

  return (
    <div className={className} data-testid="create-start-from">
      <div role="group" aria-label="Start from" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-subtle" aria-hidden>Start from</span>
        <button type="button" className={chip(onLast)} aria-pressed={onLast} disabled={!lastRun || !Object.keys(lastRun).length}
          title={lastRun ? 'The settings you last clipped with' : 'Shows up once you’ve clipped a video'}
          onClick={() => lastRun && apply(lastRun, 'Back to your last run’s settings')}>
          <History aria-hidden className="h-3.5 w-3.5" />Same as last run
        </button>
        <button type="button" className={chip(onDefaults)} aria-pressed={onDefaults}
          title="The recommended settings, with your default brand look"
          onClick={() => apply(createDefaultStyle(), 'Back to the defaults')}>
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />Defaults
        </button>
        <div className="w-[200px] max-w-full">
          <Select size="sm" aria-label="Saved style" value={active?.id ?? ''} onChange={applyPreset}
            placeholder={presets.length ? 'Choose a saved style' : 'No saved styles yet'} emptyText="Save your current settings to reuse them."
            options={presets.map((preset) => ({ value: preset.id, label: preset.name }))} />
        </div>
        {active && <ActionMenu label={`Actions for style “${active.name}”`} actions={[
          { label: 'Rename…', icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => { setError(null); setNaming({ mode: 'rename', id: active.id, name: active.name }) } },
          { label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onSelect: () => remove(active.id, active.name) }
        ]} />}
        <button type="button" className={cn(START_CHIP, 'border border-dashed border-white/[0.16] text-ink-muted hover:border-white/30 hover:text-ink')}
          disabled={presets.length >= MAX_PRESETS && !active}
          title={presets.length >= MAX_PRESETS ? `You can save up to ${MAX_PRESETS} styles. Delete one first.` : undefined}
          onClick={() => { setError(null); setNaming({ mode: 'save', name: active?.name ?? '' }) }}>
          <Plus aria-hidden className="h-3.5 w-3.5" />Save current settings
        </button>
        {notice && <span role="status" className="text-2xs text-success">{notice}</span>}
      </div>
      {error && <p role="alert" className="mt-1.5 px-1 text-2xs text-danger">{error}</p>}
      {naming && <NameDialog kind="create" mode={naming.mode} initial={naming.name} taken={presets.filter((preset) => preset.id !== naming.id).map((preset) => preset.name)}
        onClose={() => setNaming(null)}
        onSave={async (name) => {
          const store = useMemberPrefsStore.getState()
          if (naming.mode === 'rename' && naming.id) {
            await store.renamePreset('create', naming.id, name)
            setNotice(`Renamed to “${name}”`)
          } else {
            await store.savePreset('create', name)
            const saved = useMemberPrefsStore.getState().presets.create.find((preset) => preset.name.toLowerCase() === name.toLowerCase())
            if (saved) setPicked(saved.id)
            setNotice(`Saved “${name}”`)
          }
          setNaming(null)
        }} />}
      {confirm && <ConfirmDialog request={confirm} onClose={closeConfirm} />}
    </div>
  )
}
