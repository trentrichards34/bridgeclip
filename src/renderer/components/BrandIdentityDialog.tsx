import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  DEFAULT_HANDLE_POSITION, HANDLE_POSITIONS, MAX_HANDLE_CHARS, type BrandLook, type HandlePosition
} from '../../shared/brand-kit'
import { CAPTION_PRESETS } from '../../shared/caption-presets'
import { DEFAULT_BRAND_COLOR, DEFAULT_HEADLINE_LOOK, isHexColor, type HeadlineLook } from '../../shared/headline-look'
import { BRAND_IDENTITY_TEMPLATE, MAX_BRAND_IDENTITY_CHARS, MAX_CTA_OFFER_CHARS, normalizeCtaKeyword, type BrandIdentity } from '../../shared/remix'
import { getApi } from '../lib/ipc'
import { errorMessage, localFileUrl } from '../lib/utils'
import { useBrands } from '../store/use-brand-store'
import { CtaPicker } from './CtaPicker'
import { HeadlineLookPicker } from './HeadlineLookPicker'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { Dialog, DialogFooter } from './ui/Dialog'
import { Field, TextArea, TextInput } from './ui/Field'
import { Segmented } from './ui/Segmented'
import { Select } from './ui/Select'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

/** Add or edit a brand identity: its text, and the look it fills forms with. */
export function BrandIdentityDialog({ brand, onClose, onSaved }: { brand: BrandIdentity | null; onClose: () => void; onSaved: (list: BrandIdentity[], id: string) => void }): React.JSX.Element {
  const [name, setName] = useState(brand?.name ?? '')
  const [text, setText] = useState(brand?.text ?? '')
  const start = brand?.look ?? {}
  const [color, setColor] = useState(start.color ?? '')
  const [hookLook, setHookLook] = useState<HeadlineLook | null>(start.headlineLook ?? null)
  const [captionPreset, setCaptionPreset] = useState(start.captionPreset ?? '')
  const [ctaId, setCtaId] = useState<string | null>(start.ctaId ?? null)
  const [ctaKeyword, setCtaKeyword] = useState(start.ctaKeyword ?? '')
  const [ctaOffer, setCtaOffer] = useState(start.ctaOffer ?? '')
  const [handle, setHandle] = useState(start.handle ?? '')
  const [position, setPosition] = useState<HandlePosition>(start.handlePosition ?? DEFAULT_HANDLE_POSITION)
  const [logo, setLogo] = useState<{ logo: string; path: string } | null>(start.logo && brand?.logoPath ? { logo: start.logo, path: brand.logoPath } : null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const keyword = normalizeCtaKeyword(ctaKeyword)

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
  const chooseLogo = async (): Promise<void> => {
    setError(null)
    try {
      const chosen = await getApi().brandIdentities.chooseLogo()
      if (chosen) setLogo(chosen)
    } catch (err) { setError(errorMessage(err, 'That logo could not be used.')) }
  }
  const look = (): BrandLook => ({
    ...(color ? { color } : {}),
    ...(hookLook ? { headlineLook: hookLook } : {}),
    ...(captionPreset ? { captionPreset } : {}),
    ...(ctaId ? { ctaId } : {}),
    ...(keyword ? { ctaKeyword: keyword, ...(ctaOffer.trim() ? { ctaOffer: ctaOffer.trim() } : {}) } : {}),
    ...(handle.trim() ? { handle: handle.trim() } : {}),
    ...(handle.trim() || logo ? { handlePosition: position } : {}),
    ...(logo ? { logo: logo.logo } : {})
  })
  const save = async (): Promise<void> => {
    setWorking(true); setError(null)
    try {
      const list = await getApi().brandIdentities.save({ ...(brand ? { id: brand.id } : {}), name, text, look: look() })
      // The list is newest first, so a new identity is first.
      onSaved(list, brand?.id ?? list[0]?.id ?? '')
    } catch (err) { setError(errorMessage(err)) } finally { setWorking(false) }
  }
  const lookColor = isHexColor(color) ? color : DEFAULT_BRAND_COLOR

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
          <TextArea rows={10} value={text} maxLength={MAX_BRAND_IDENTITY_CHARS} onChange={(e) => setText(e.target.value)}
            placeholder={'Core promise: …\nWhat we believe: …\nMyths we push back on: …\nOur method: …\nProof (real results only): …\nVoice: …'} />
        </Field>

        <section aria-labelledby="brand-look-heading" className="space-y-4 border-t border-white/[0.06] pt-4">
          <div>
            <h3 id="brand-look-heading" className="text-sm font-semibold text-ink">Look</h3>
            <p className="mt-0.5 text-2xs text-ink-muted">All optional. When you pick this brand on Create or Remix, these fill in the form. You can still change them there.</p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <span className="block text-sm text-ink">Brand color</span>
              <span className="block text-2xs text-ink-subtle">For the hook bar in your color and your camera background.</span>
            </span>
            <span className="flex items-center gap-2">
              <input type="color" aria-label="Brand color" value={lookColor.toLowerCase()}
                onChange={(e) => { if (isHexColor(e.target.value)) setColor(e.target.value.toUpperCase()) }}
                className="h-7 w-10 cursor-pointer rounded-md border border-white/15 bg-transparent p-0.5" />
              <span className="font-mono text-2xs text-ink-subtle">{color || 'None'}</span>
              {color && <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setColor('')}>Clear</Button>}
            </span>
          </div>

          <SettingRow title="Hook text look" description="How the headline at the top looks by default."
            control={<Switch label="Set a hook text look" checked={hookLook !== null}
              onChange={(on) => setHookLook(on ? { ...DEFAULT_HEADLINE_LOOK, ...(color ? { look: 'brand', color } : {}) } : null)} />} />
          {hookLook && <HeadlineLookPicker value={{ ...hookLook, color: hookLook.look === 'brand' && color ? color : hookLook.color }}
            onChange={(next) => { setHookLook(next); if (next.look === 'brand') setColor(next.color) }} />}

          <Field label="Caption style">
            <Select value={captionPreset} onChange={setCaptionPreset}
              options={[{ value: '', label: 'Keep the form’s choice' }, ...CAPTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.name, detail: preset.description }))]} />
          </Field>

          <div>
            <p className="text-sm font-medium text-ink">Call-to-action clip</p>
            <p className="mb-2 mt-0.5 text-2xs text-ink-muted">Played at the end of every video when this brand is picked.</p>
            <CtaPicker value={ctaId} onChange={setCtaId} />
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="Comment keyword">
              <TextInput aria-label="Brand comment keyword" value={ctaKeyword} maxLength={20} placeholder="e.g. SALES"
                onChange={(e) => setCtaKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))} />
            </Field>
            <Field label="What they get">
              <TextInput aria-label="Brand comment offer" value={ctaOffer} maxLength={MAX_CTA_OFFER_CHARS} disabled={!keyword}
                placeholder="e.g. my free playbook" onChange={(e) => setCtaOffer(e.target.value)} />
            </Field>
          </div>
          {keyword === null && <p className="text-2xs text-danger">One word: letters, numbers or a dash (2–20 characters).</p>}

          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-ink">Your handle or logo on the video</p>
              <p className="mt-0.5 text-2xs text-ink-muted">Drawn small and see-through in a corner, clear of the hook text and captions, when “Show my handle” is on.</p>
            </div>
            <Field label="Handle" hint={`Up to ${MAX_HANDLE_CHARS} characters.`}>
              <TextInput aria-label="Handle" value={handle} maxLength={MAX_HANDLE_CHARS} placeholder="e.g. @coachname" onChange={(e) => setHandle(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              {logo ? (
                <span className="glass-tile flex items-center gap-2 rounded-xl px-2.5 py-1.5">
                  <img src={localFileUrl(logo.path)} alt="Your logo" className="h-8 w-8 rounded object-contain" />
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => void chooseLogo()}>Change</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setLogo(null)}>Remove</Button>
                </span>
              ) : (
                <Button size="sm" variant="secondary" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => void chooseLogo()}>Add a logo</Button>
              )}
              <span className="text-2xs text-ink-subtle">PNG, JPG or WebP, under 5 MB.</span>
            </div>
            {(handle.trim() || logo) && (
              <Segmented label="Corner" size="sm" value={position} onChange={setPosition}
                options={HANDLE_POSITIONS.map((item) => ({ value: item.id, label: item.label }))} />
            )}
          </div>
        </section>

        {notice && <Callout tone="warning">{notice}</Callout>}
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={working} disabled={working || !name.trim() || text.trim().length < 40 || keyword === null} onClick={() => void save()}>Save</Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Choose a brand (or none), add one, or edit or delete the chosen one.
 * `onChange` runs only when the choice changes (re-picking the same brand does nothing).
 */
export function BrandPicker({ value, onChange, noneLabel = 'No brand identity', noneDetail }: {
  value: string | null; onChange: (brand: BrandIdentity | null) => void; noneLabel?: string; noneDetail?: string
}): React.JSX.Element {
  const { brands, load, setBrands, error: loadError } = useBrands()
  const [editing, setEditing] = useState<BrandIdentity | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void load() }, [load])
  const brand = brands.find((item) => item.id === value) ?? null
  const choose = (id: string): void => {
    setConfirmDelete(false)
    // Compared with the stored choice, not the resolved brand: a deleted brand's id can still be cleared with "No brand".
    if ((id || null) === (value ?? null)) return
    onChange(brands.find((item) => item.id === id) ?? null)
  }
  const remove = async (id: string): Promise<void> => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setConfirmDelete(false); setError(null)
    try {
      setBrands(await getApi().brandIdentities.remove(id))
      if (value === id) onChange(null)
    } catch (err) { setError(errorMessage(err)) }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Select value={brand?.id ?? ''} onChange={choose} aria-label="Brand identity"
            options={[{ value: '', label: noneLabel, ...(noneDetail ? { detail: noneDetail } : {}) },
              ...brands.map((item) => ({ value: item.id, label: item.name, detail: `${item.text.length.toLocaleString()} characters` }))]} />
        </div>
        <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>Add</Button>
      </div>
      {brand && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(brand)}>Edit</Button>
          <Button size="sm" variant={confirmDelete ? 'danger' : 'ghost'} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void remove(brand.id)}>
            {confirmDelete ? 'Click again to delete' : 'Delete'}
          </Button>
        </div>
      )}
      {(error || loadError) && <p role="alert" className="text-2xs text-danger">{error ?? loadError}</p>}
      {editing && <BrandIdentityDialog brand={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(list, id) => {
        const before = editing === 'new' ? null : editing
        setBrands(list); setEditing(null)
        const saved = list.find((item) => item.id === id) ?? null
        // A new brand, or a changed look: its look fills the form. Editing only the text leaves the form alone.
        if (saved && (!before || saved.id !== value || JSON.stringify(saved.look ?? {}) !== JSON.stringify(before.look ?? {}))) onChange(saved)
      }} />}
    </div>
  )
}
