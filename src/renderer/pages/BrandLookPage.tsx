import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, FileText, Image as ImageIcon, ImagePlus, Pencil, Plus, Star, Trash2, Video } from 'lucide-react'
import type { BrandIdentity } from '../../shared/remix'
import { BRAND_IDENTITY_TEMPLATE, MAX_BRAND_IDENTITY_CHARS, MAX_CTA_OFFER_CHARS, normalizeCtaKeyword } from '../../shared/remix'
import {
  brandFormPatch, DEFAULT_HANDLE_POSITION, HANDLE_POSITIONS, hasBrandMark, MAX_HANDLE_CHARS, type BrandLook, type HandlePosition
} from '../../shared/brand-kit'
import { CAPTION_PRESETS, DEFAULT_CAPTION_PRESET } from '../../shared/caption-presets'
import {
  DEFAULT_BRAND_COLOR, DEFAULT_HEADLINE_LOOK, HEADLINE_FONTS, HEADLINE_LOOKS, HEADLINE_TEXT_BGS, headlineTextBg, isHexColor,
  type HeadlineFont, type HeadlineLook, type HeadlineLookStyle, type HeadlineTextBg
} from '../../shared/headline-look'
import { IMAGE_CTA_SECONDS, type CtaSummary } from '../../shared/ctas'
import { LOOK_EXTRAS, type LookExtraId } from '../../shared/look-extras'
import { REGISTERS, REGISTER_INFO } from '../../shared/register'
import { BAR_HOOKS, COLOR_PRESETS, HOOK_LABELS, LOOK_HOOKS, captionName, fontName, toggleExtra, type BoardRows, type BoardStyle } from '../lib/style-board'
import { CaptionSample, captionPreviewPreset, SCENE } from '../components/CaptionPresetPicker'
import { CtaThumb, useCtaLibrary, CTA_HELP } from '../components/CtaPicker'
import { HideHookText } from '../components/HideHookText'
import { FrameStill, LookFrame, STILL_MS, SAMPLE_WORDS, WORD_MS, LINGER_MS } from '../components/LookFrame'
import { StylePreview } from '../components/StylePreview'
import { CREATE_SKILL_EXTRAS } from '../components/JobForm'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { ConfirmDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { Field, TextArea, TextInput } from '../components/ui/Field'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { onRadioKeyDown, Segmented } from '../components/ui/Segmented'
import { Skeleton } from '../components/ui/Skeleton'
import { Switch } from '../components/ui/Switch'
import { useBrands } from '../store/use-brand-store'
import { useDraftStore } from '../store/use-draft-store'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { useRemixForm } from '../store/use-remix-form-store'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, formatRelativeDate, localFileUrl } from '../lib/utils'

/** A look being edited: the brand identity's name and text, and its look fields. */
interface LookDraft {
  name: string
  text: string
  color: string
  hook: HeadlineLook | null
  captionPreset: string
  ctaId: string | null
  ctaKeyword: string
  ctaOffer: string
  handle: string
  position: HandlePosition
  logo: { logo: string; path: string } | null
}

function draftOf(brand: BrandIdentity | null): LookDraft {
  const look = brand?.look ?? {}
  return {
    name: brand?.name ?? '', text: brand?.text ?? '', color: look.color ?? '', hook: look.headlineLook ?? null, captionPreset: look.captionPreset ?? '',
    ctaId: look.ctaId ?? null, ctaKeyword: look.ctaKeyword ?? '', ctaOffer: look.ctaOffer ?? '', handle: look.handle ?? '',
    position: look.handlePosition ?? DEFAULT_HANDLE_POSITION, logo: look.logo && brand?.logoPath ? { logo: look.logo, path: brand.logoPath } : null
  }
}

/** The look as saved (the same fields the brand identity dialog saves). */
function lookOf(draft: LookDraft): BrandLook {
  const keyword = normalizeCtaKeyword(draft.ctaKeyword)
  const hook = draft.hook && draft.color && (draft.hook.look === 'brand' || headlineTextBg(draft.hook) === 'brand') ? { ...draft.hook, color: draft.color } : draft.hook
  return {
    ...(draft.color ? { color: draft.color } : {}),
    ...(hook ? { headlineLook: hook } : {}),
    ...(draft.captionPreset ? { captionPreset: draft.captionPreset } : {}),
    ...(draft.ctaId ? { ctaId: draft.ctaId } : {}),
    ...(keyword ? { ctaKeyword: keyword, ...(draft.ctaOffer.trim() ? { ctaOffer: draft.ctaOffer.trim() } : {}) } : {}),
    ...(draft.handle.trim() ? { handle: draft.handle.trim() } : {}),
    ...(draft.handle.trim() || draft.logo ? { handlePosition: draft.position } : {}),
    ...(draft.logo ? { logo: draft.logo.logo } : {})
  }
}

/** A brand's look on the preview's board (unset fields show the app's defaults). */
function boardOf(look: BrandLook, extras: readonly LookExtraId[]): BoardStyle {
  const hook = look.headlineLook
  const color = hook && (hook.look === 'brand' || headlineTextBg(hook) === 'brand') && look.color ? look.color : hook?.color ?? look.color ?? '#FFFFFF'
  return {
    captions: true, captionPreset: look.captionPreset ?? DEFAULT_CAPTION_PRESET, hook: hook?.look ?? DEFAULT_HEADLINE_LOOK.look,
    font: hook?.font ?? DEFAULT_HEADLINE_LOOK.font, color, ...(hook?.textBg ? { textBg: hook.textBg } : {}), ...(hook?.hideAfterS ? { hideAfterS: hook.hideAfterS } : {}),
    handle: hasBrandMark(look), ctaId: look.ctaId ?? null, keyword: look.ctaKeyword ?? '', offer: look.ctaOffer ?? '', extras: [...extras]
  }
}

const PREVIEW_ROWS: BoardRows = { hooks: LOOK_HOOKS, handle: true, cta: true, keyword: true, extras: true }
const CARD_ROWS: BoardRows = { hooks: LOOK_HOOKS }

/**
 * Make a brand the default look: it's saved as the default every tool starts
 * from, Create and Remix pick it, and its look fills their forms (as picking
 * it there does).
 */
export function makeDefaultLook(brand: BrandIdentity): void {
  useMemberPrefsStore.setState({ defaultBrandId: brand.id })
  void useMemberPrefsStore.getState().saveApp({ defaultBrandId: brand.id }).catch(() => undefined)
  const draft = useDraftStore.getState()
  draft.update({ brandIdentityId: brand.id, ...brandFormPatch(brand.look, draft), ...(brand.look?.captionPreset ? { includeCaptions: true } : {}) })
  const remix = useRemixForm.getState()
  remix.applyStyle({ brandIdentityId: brand.id, ...brandFormPatch(brand.look, remix), ...(brand.look?.captionPreset ? { includeCaptions: true } : {}) })
}

/** A short line about a look: its type, captions and handle. */
function lookSummary(look: BrandLook): string {
  return [
    look.headlineLook ? fontName(look.headlineLook.font) : null,
    look.captionPreset ? `${captionName(look.captionPreset)} captions` : null,
    look.handle || (look.logo ? 'Logo' : null),
    look.ctaKeyword ? `Comment ${look.ctaKeyword}` : null
  ].filter(Boolean).join(' · ') || 'No look saved yet'
}

/**
 * Brand look ("Set your style once"): each brand identity is a look. Pick one
 * to edit its color, hook type and look, caption style, handle, comment
 * keyword, logo, call to action and voice; make one the default that Create
 * and Remix start from. The CTA library is managed here too.
 */
export function BrandLookPage(): React.JSX.Element {
  const { brands, loaded, load, setBrands, error: loadError } = useBrands()
  const defaultId = useMemberPrefsStore((state) => state.defaultBrandId)
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { void load(true) }, [load])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(timer)
  }, [notice])
  // Open on the default look (or the first one).
  useEffect(() => {
    if (!loaded || selected === 'new') return
    if (selected && brands.some((brand) => brand.id === selected)) return
    setSelected(brands.find((brand) => brand.id === defaultId)?.id ?? brands[0]?.id ?? null)
  }, [loaded, brands, selected, defaultId])

  const brand = selected && selected !== 'new' ? brands.find((item) => item.id === selected) ?? null : null
  const editing = selected === 'new' || brand !== null

  return (
    <Page>
      <PageHeader
        title="Set your style once"
        description="Every tool starts from your default look. Change it for one video, or one clip, whenever you like."
        actions={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSelected('new')}>New look</Button>}
      />

      {loadError && <Callout tone="danger" className="mt-5">{loadError}</Callout>}
      {notice && <p role="status" className="mt-3 text-xs text-success">{notice}</p>}

      <div className="mt-5">
        {!loaded ? (
          <div aria-busy="true" aria-label="Loading your looks" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[152px] rounded-2xl" />)}
          </div>
        ) : brands.length === 0 && selected !== 'new' ? (
          <EmptyState
            icon={<Star />}
            title="No look yet"
            description="Make your look once: your color, hook type, caption style, handle and call to action, plus your brand’s voice for titles. Every tool starts from it."
            action={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSelected('new')}>New look</Button>}
          />
        ) : (
          <div role="radiogroup" aria-label="Your looks" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {brands.map((item) => (
              <LookCard key={item.id} brand={item} selected={item.id === selected} isDefault={item.id === defaultId} onSelect={() => setSelected(item.id)} />
            ))}
            {selected === 'new' && (
              <div role="radio" aria-checked="true" tabIndex={0} className="glass glass-selected flex min-h-[152px] items-center justify-center rounded-2xl p-3 text-sm text-ink-muted">
                <Plus aria-hidden className="mr-1.5 h-4 w-4 text-tool" />New look (not saved yet)
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <LookEditor key={selected ?? ''} brand={brand} isDefault={Boolean(brand && brand.id === defaultId)} firstLook={brands.length === 0}
          onSaved={(list, id, message) => { setBrands(list); setSelected(id); setNotice(message) }}
          onCancelNew={() => setSelected(brands.find((item) => item.id === defaultId)?.id ?? brands[0]?.id ?? null)}
          onDelete={(target) => setConfirm({
            title: `Delete “${target.name}”?`,
            body: target.id === defaultId ? 'This is your default look. New videos start with no brand look until you make another one the default.' : 'Its look and voice are removed. Clips already made keep their look.',
            confirmLabel: 'Delete look',
            onConfirm: () => {
              void getApi().brandIdentities.remove(target.id).then((list) => {
                if (target.id === defaultId) {
                  useMemberPrefsStore.setState({ defaultBrandId: null })
                  void useMemberPrefsStore.getState().saveApp({ defaultBrandId: null }).catch(() => undefined)
                }
                setBrands(list); setSelected(null); setNotice(`Deleted “${target.name}”`)
              })
                .catch((err) => setNotice(errorMessage(err, 'The look could not be deleted.')))
            }
          })} />
      )}
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </Page>
  )
}

/** A look as a card: a 9:16 still of its hook and caption style, its name and a summary. */
function LookCard({ brand, selected, isDefault, onSelect }: { brand: BrandIdentity; selected: boolean; isDefault: boolean; onSelect: () => void }): React.JSX.Element {
  const look = brand.look ?? {}
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} onKeyDown={onRadioKeyDown} tabIndex={selected ? 0 : -1}
      aria-label={`${brand.name}${isDefault ? ', default look' : ''}`} aria-description={lookSummary(look)}
      className={cn('glass glass-tile-hover flex items-stretch gap-3 rounded-2xl p-2 text-left transition-shadow', selected && 'glass-selected')}>
      <LookThumb look={look} brand={brand} width={74} />
      <span className="flex min-w-0 flex-1 flex-col py-1 pr-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{brand.name}</span>
          {isDefault && <span className="shrink-0 rounded bg-tool/[0.16] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-tool">Default</span>}
        </span>
        <span className="mt-1 line-clamp-2 text-2xs text-ink-muted">{lookSummary(look)}</span>
        <span className="mt-auto flex items-center gap-1.5 pt-2">
          {look.color && <span aria-hidden className="h-3 w-3 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]" style={{ background: look.color }} />}
          <span className="truncate font-mono text-[10px] tabular text-ink-subtle">Updated {formatRelativeDate(brand.updatedAt).toLowerCase()}</span>
        </span>
      </span>
    </button>
  )
}

/** A small still of a look: its hook text and captions on a neutral frame. */
const LookThumb = memo(function LookThumb({ look, brand, width }: { look: BrandLook; brand: BrandIdentity | null; width: number }): React.JSX.Element {
  const value = useMemo(() => boardOf(look, []), [look])
  return (
    <span aria-hidden className="relative block shrink-0 overflow-hidden rounded-xl bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]" style={{ width, height: Math.round(width * 16 / 9) }}>
      <LookFrame value={value} rows={CARD_ROWS} background={<FrameStill frame={null} />} hookText="Your hook text here" brand={brand}
        width={width} time={STILL_MS} loop={SAMPLE_WORDS.length * WORD_MS + LINGER_MS} ending={false} extras={[]} textScale={1.7} tile />
    </span>
  )
})

function Section({ label, aside, children, id }: { label: string; aside?: ReactNode; children: ReactNode; id?: string }): React.JSX.Element {
  const headingId = `look-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={headingId} id={id} className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <h3 id={headingId} className="font-mono text-[10px] font-normal uppercase tracking-[0.1em] text-ink-subtle">{label}</h3>
        {aside && <span className="ml-auto text-2xs text-ink-subtle">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function LookEditor({ brand, isDefault, firstLook, onSaved, onCancelNew, onDelete }: {
  brand: BrandIdentity | null; isDefault: boolean; firstLook: boolean
  onSaved: (list: BrandIdentity[], id: string, message: string) => void
  onCancelNew: () => void
  onDelete: (brand: BrandIdentity) => void
}): React.JSX.Element {
  const initial = useMemo(() => draftOf(brand), [brand])
  const [draft, setDraft] = useState<LookDraft>(initial)
  // A save (here, or a corner chosen on a style board) shows the look as stored.
  useEffect(() => { setDraft(draftOf(brand)) }, [brand?.updatedAt])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileNotice, setFileNotice] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!brand) nameInput.current?.focus() }, [brand])
  const set = (patch: Partial<LookDraft>): void => setDraft((current) => ({ ...current, ...patch }))
  const look = lookOf(draft)
  const dirty = !brand || JSON.stringify(draftOf(brand)) !== JSON.stringify(draft)
  const keyword = normalizeCtaKeyword(draft.ctaKeyword)
  const canSave = draft.name.trim().length > 0 && draft.text.trim().length >= 40 && keyword !== null && !working
  const createExtras = useDraftStore((state) => state.lookExtras)
  const previewExtras = useMemo(() => createExtras.filter((id) => !CREATE_SKILL_EXTRAS.includes(id)), [createExtras])
  const previewBrand = useMemo<BrandIdentity>(() => ({
    id: brand?.id ?? 'new', name: draft.name, text: draft.text, look, ...(draft.logo ? { logoPath: draft.logo.path } : {}),
    createdAt: brand?.createdAt ?? '', updatedAt: brand?.updatedAt ?? ''
  }), [brand, draft, look])
  const board = boardOf(look, previewExtras)
  const library = useCtaLibrary(draft.ctaId, (ctaId) => set({ ctaId }))
  const ctaName = draft.ctaId ? library.selected?.name ?? null : null
  const hook = draft.hook
  const hookColor = isHexColor(draft.color) ? draft.color : DEFAULT_BRAND_COLOR

  const save = async (makeDefault = false): Promise<BrandIdentity | null> => {
    if (!canSave) return null
    setWorking(true); setError(null)
    try {
      const list = await getApi().brandIdentities.save({ ...(brand ? { id: brand.id } : {}), name: draft.name, text: draft.text, look })
      // The list is newest first, so a new look is first.
      const saved = list.find((item) => item.id === brand?.id) ?? (brand ? null : list[0]) ?? null
      if (!saved) return null
      const lookChanged = JSON.stringify(saved.look ?? {}) !== JSON.stringify(brand?.look ?? {})
      // The list first: Create and Remix drop a brand id the list doesn't have yet.
      useBrands.getState().setBrands(list)
      // The default look (or the very first one) fills Create and Remix again when its look changes.
      const nowDefault = makeDefault || firstLook || (isDefault && lookChanged)
      if (nowDefault) makeDefaultLook(saved)
      onSaved(list, saved.id, makeDefault || firstLook ? `Saved “${saved.name}” as your default look` : `Saved “${saved.name}”`)
      return saved
    } catch (err) { setError(errorMessage(err)); return null } finally { setWorking(false) }
  }
  const makeDefault = async (): Promise<void> => {
    if (!brand) return
    if (dirty) { await save(true); return }
    makeDefaultLook(brand)
    onSaved(useBrands.getState().brands, brand.id, `“${brand.name}” is your default look`)
  }
  const importFile = async (): Promise<void> => {
    setError(null)
    try {
      const file = await getApi().brandIdentities.importFile()
      if (file) {
        set({ text: file.text, ...(draft.name.trim() ? {} : { name: file.name }) })
        setFileNotice(file.truncated ? `That file is longer than ${MAX_BRAND_IDENTITY_CHARS.toLocaleString()} characters, so the end was cut off. Trim it so your proof and voice sections fit.` : null)
      }
    } catch (err) { setError(errorMessage(err)) }
  }
  const chooseLogo = async (): Promise<void> => {
    setError(null)
    try {
      const chosen = await getApi().brandIdentities.chooseLogo()
      if (chosen) set({ logo: chosen })
    } catch (err) { setError(errorMessage(err, 'That logo could not be used.')) }
  }
  const setHook = (patch: Partial<HeadlineLook>): void => {
    const base = hook ?? { ...DEFAULT_HEADLINE_LOOK }
    const next = { ...base, ...patch }
    if (next.look !== 'floating') delete next.textBg
    if (next.look === 'brand' || headlineTextBg(next) === 'brand') next.color = hookColor
    set({ hook: next, ...((next.look === 'brand' || headlineTextBg(next) === 'brand') && !draft.color ? { color: hookColor } : {}) })
  }
  const setColor = (color: string): void => {
    const upper = color.toUpperCase()
    set({ color: upper, ...(hook && (hook.look === 'brand' || headlineTextBg(hook) === 'brand') ? { hook: { ...hook, color: upper } } : {}) })
  }
  const title = brand ? `Editing “${draft.name.trim() || brand.name}”` : 'New look'

  return (
    <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-label={title} className="glass space-y-6 rounded-[18px] p-5" data-testid="look-editor">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {brand && (isDefault
            ? <span className="inline-flex items-center gap-1 text-xs font-medium text-tool" data-testid="default-look"><Check className="h-3.5 w-3.5" />Default look</span>
            : <Button size="sm" variant="secondary" icon={<Star className="h-3.5 w-3.5" />} disabled={working || (dirty && !canSave)} onClick={() => void makeDefault()}
              tooltip="Every tool starts from this look">Make default</Button>)}
          {brand && <Button size="sm" variant="ghost" iconOnly aria-label={`Delete ${brand.name}`} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(brand)} tooltip="Delete this look" />}
        </div>

        <Section label="Name">
          <TextInput ref={nameInput} aria-label="Look name" value={draft.name} maxLength={120} placeholder="e.g. Pull-Up Lab" onChange={(e) => set({ name: e.target.value })} />
        </Section>

        <Section label="Accent color" aside="Hook bar in brand color, extras and your camera background">
          <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap items-center gap-2.5">
            {COLOR_PRESETS.map((item) => {
              const on = draft.color.toUpperCase() === item.color.toUpperCase()
              return (
                <button key={item.id} type="button" role="radio" aria-checked={on} aria-label={`${item.name} ${item.color}`} title={item.name} tabIndex={on || (!draft.color && item === COLOR_PRESETS[0]) ? 0 : -1}
                  onKeyDown={onRadioKeyDown} onClick={() => setColor(item.color)}
                  className={cn('h-9 w-9 rounded-full transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    on ? 'shadow-[0_0_0_2px_rgb(var(--canvas)),0_0_0_4px_rgb(255_255_255/0.9)]' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)] hover:shadow-[0_0_0_2px_rgb(var(--canvas)),0_0_0_3px_rgb(255_255_255/0.35)]')}
                  style={{ background: item.color }} />
              )
            })}
            <label className="glass-tile glass-tile-hover flex h-9 cursor-pointer items-center gap-2 rounded-full pl-1 pr-3 text-2xs text-ink-muted">
              <input type="color" aria-label="Custom accent color" value={hookColor.toLowerCase()} onChange={(e) => { if (isHexColor(e.target.value)) setColor(e.target.value) }}
                className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" />
              Custom
            </label>
            <span className="font-mono text-2xs uppercase text-ink-subtle" data-testid="look-color">{draft.color || 'No color'}</span>
            {draft.color && <Button size="sm" variant="ghost" onClick={() => set({ color: '' })}>Clear</Button>}
          </div>
        </Section>

        <Section label="Headline type" aside={hook ? 'The hook text’s font' : 'Not set: each tool keeps its own'}>
          <div role="radiogroup" aria-label="Headline type" className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]">
            {HEADLINE_FONTS.map((font) => {
              const on = hook?.font === font.id
              return (
                <button key={font.id} type="button" role="radio" aria-checked={on} aria-label={font.label} tabIndex={on || (!hook && font === HEADLINE_FONTS[0]) ? 0 : -1}
                  onKeyDown={onRadioKeyDown} onClick={() => setHook({ font: font.id as HeadlineFont })}
                  className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', on && 'glass-selected')}>
                  <span aria-hidden className="block text-lg leading-tight text-ink" style={{ fontFamily: font.family, fontWeight: font.weight ?? 400, textTransform: font.upper ? 'uppercase' : 'none' }}>
                    Aa{font.accent && <span style={{ fontFamily: font.accent, fontStyle: 'italic', fontWeight: 400 }}> a</span>}
                  </span>
                  <span className="mt-1 block truncate text-2xs text-ink-muted">{font.label}</span>
                </button>
              )
            })}
          </div>
        </Section>

        <Section label="Hook look" aside={hook ? <button type="button" className="text-2xs text-ink-muted hover:text-ink" onClick={() => set({ hook: null })}>Don’t save a hook look</button> : 'Not set'}>
          <div role="radiogroup" aria-label="Hook text look" className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))]">
            {HEADLINE_LOOKS.map((item) => {
              const on = hook?.look === item.id
              return (
                <button key={item.id} type="button" role="radio" aria-checked={on} aria-label={item.label} title={item.hint} tabIndex={on || (!hook && item === HEADLINE_LOOKS[0]) ? 0 : -1}
                  onKeyDown={onRadioKeyDown} onClick={() => setHook({ look: item.id as HeadlineLookStyle })}
                  className={cn('glass-tile glass-tile-hover flex items-center gap-2 rounded-xl px-2.5 py-2 text-left', on ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                  <HookGlyph look={item.id} color={hookColor} />
                  <span className="min-w-0 truncate text-xs font-medium">{item.label}</span>
                </button>
              )
            })}
          </div>
          <p className="text-2xs text-ink-subtle">{hook ? HEADLINE_LOOKS.find((item) => item.id === hook.look)?.hint : 'Pick one to save a hook look with this look. Until then each tool keeps its own.'}</p>
          {hook?.look === 'floating' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ink">Text background</span>
              <Segmented label="Text background" size="sm" value={headlineTextBg(hook)} onChange={(textBg: HeadlineTextBg) => setHook({ textBg })}
                options={HEADLINE_TEXT_BGS.map((bg) => ({ value: bg.id, label: bg.label }))} />
            </div>
          )}
          {hook && hook.look !== 'none' && (
            <HideHookText value={hook.hideAfterS} bar={BAR_HOOKS.includes(hook.look)} onChange={(hideAfterS) => {
              const next = { ...hook }
              if (hideAfterS === undefined) delete next.hideAfterS
              else next.hideAfterS = hideAfterS
              set({ hook: next })
            }} />
          )}
        </Section>

        <Section label="Caption style" aside={`${CAPTION_PRESETS.length} styles from your engine`}>
          <div role="radiogroup" aria-label="Caption style" className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(96px,1fr))]">
            <button type="button" role="radio" aria-checked={!draft.captionPreset} aria-label="Pick each time" tabIndex={!draft.captionPreset ? 0 : -1}
              onKeyDown={onRadioKeyDown} onClick={() => set({ captionPreset: '' })}
              className={cn('glass-tile glass-tile-hover flex flex-col rounded-xl p-1 text-left', !draft.captionPreset && 'glass-selected')}>
              <span className="flex h-[46px] items-center justify-center rounded-lg text-2xs text-ink-subtle shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">Any</span>
              <span className="truncate px-1 pb-0.5 pt-1 text-2xs font-medium text-ink-muted">Pick each time</span>
            </button>
            {CAPTION_PRESETS.map((preset) => {
              const on = draft.captionPreset === preset.id
              return (
                <button key={preset.id} type="button" role="radio" aria-checked={on} aria-label={preset.name} title={preset.description} tabIndex={on ? 0 : -1}
                  onKeyDown={onRadioKeyDown} onClick={() => set({ captionPreset: preset.id })}
                  className={cn('glass-tile glass-tile-hover flex flex-col rounded-xl p-1 text-left', on && 'glass-selected')}>
                  <span aria-hidden className="relative flex h-[46px] items-center justify-center overflow-hidden rounded-lg px-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] [&>span]:scale-[0.8]" style={{ background: SCENE }}>
                    <CaptionSample preset={captionPreviewPreset(preset.id)} />
                  </span>
                  <span className={cn('truncate px-1 pb-0.5 pt-1 text-2xs font-medium', on ? 'text-ink' : 'text-ink-muted')}>{preset.name}</span>
                </button>
              )
            })}
          </div>
        </Section>

        <Section label="Handle and corner" aside="Drawn small and see-through when “Show my handle” is on">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Handle" hint={`Up to ${MAX_HANDLE_CHARS} characters.`}>
              <TextInput aria-label="Handle" value={draft.handle} maxLength={MAX_HANDLE_CHARS} placeholder="e.g. @coachname" onChange={(e) => set({ handle: e.target.value })} />
            </Field>
            <Field label="Logo" hint="PNG, JPG or WebP, under 5 MB.">
              {draft.logo ? (
                <span className="glass-tile flex h-8 items-center gap-1.5 rounded-lg px-1.5">
                  <img src={localFileUrl(draft.logo.path)} alt="Your logo" className="h-6 w-6 rounded object-contain" />
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => void chooseLogo()}>Change</Button>
                  <Button size="sm" variant="ghost" iconOnly aria-label="Remove logo" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => set({ logo: null })} />
                </span>
              ) : <Button size="sm" variant="secondary" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => void chooseLogo()}>Add a logo</Button>}
            </Field>
          </div>
          {(draft.handle.trim() || draft.logo) && (
            <Segmented label="Corner" size="sm" value={draft.position} onChange={(position) => set({ position })}
              options={HANDLE_POSITIONS.map((item) => ({ value: item.id, label: item.label }))} />
          )}
        </Section>

        <Section label="Comment keyword">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="Keyword">
              <TextInput aria-label="Brand comment keyword" value={draft.ctaKeyword} maxLength={20} placeholder="e.g. SALES"
                onChange={(e) => set({ ctaKeyword: e.target.value.toUpperCase().replace(/\s+/g, '') })} />
            </Field>
            <Field label="What they get">
              <TextInput aria-label="Brand comment offer" value={draft.ctaOffer} maxLength={MAX_CTA_OFFER_CHARS} disabled={!keyword}
                placeholder="e.g. my free playbook" onChange={(e) => set({ ctaOffer: e.target.value })} />
            </Field>
          </div>
          {keyword === null && <p role="alert" className="text-2xs text-danger">One word: letters, numbers or a dash (2–20 characters).</p>}
        </Section>

        <CtaLibrary library={library} value={draft.ctaId} onChange={(ctaId) => set({ ctaId })} />

        <CreateDefaults />

        <Section label="Brand voice" aside={<span className="flex gap-3">
          {!draft.text.trim() && <button type="button" className="text-2xs font-medium text-tool hover:underline" onClick={() => set({ text: BRAND_IDENTITY_TEMPLATE })}>Start from template</button>}
          <button type="button" className="inline-flex items-center gap-1 text-2xs font-medium text-tool hover:underline" onClick={() => void importFile()}><FileText className="h-3 w-3" />Import file</button>
        </span>}>
          <p className="text-2xs text-ink-muted">Your Brand Identity: what you believe, the myths you push back on, your method, real results and how you talk. Titles and hook text are written in this voice. At least 40 characters.</p>
          <TextArea aria-label="Brand voice" rows={7} value={draft.text} maxLength={MAX_BRAND_IDENTITY_CHARS} onChange={(e) => set({ text: e.target.value })}
            placeholder={'Core promise: …\nWhat we believe: …\nMyths we push back on: …\nOur method: …\nProof (real results only): …\nVoice: …'} />
          <p className="font-mono text-[10px] tabular text-ink-subtle">{draft.text.length.toLocaleString()} / {MAX_BRAND_IDENTITY_CHARS.toLocaleString()} characters</p>
          {fileNotice && <Callout tone="warning">{fileNotice}</Callout>}
        </Section>

        {error && <Callout tone="danger">{error}</Callout>}
        <div className={cn(dirty && 'sticky bottom-0', 'z-10 -mx-5 -mb-5 flex flex-wrap items-center gap-2 rounded-b-[18px] border-t border-white/[0.08] bg-surface px-5 py-3 shadow-[0_-12px_24px_-12px_rgb(0_0_0/0.6)]')}>
          <p className="min-w-0 flex-1 text-2xs text-ink-subtle">
            {!draft.name.trim() ? 'Give the look a name to save it.' : draft.text.trim().length < 40 ? 'Add your brand voice (40 characters or more) to save it.' : keyword === null ? 'Fix the comment keyword to save.' : dirty ? 'Unsaved changes.' : 'All changes saved.'}
          </p>
          {brand ? <Button variant="ghost" disabled={!dirty || working} onClick={() => setDraft(initial)}>Discard changes</Button>
            : <Button variant="ghost" disabled={working} onClick={onCancelNew}>Cancel</Button>}
          <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={working} disabled={!canSave || !dirty} onClick={() => void save()}>{brand ? 'Save look' : 'Save new look'}</Button>
        </div>
      </section>

      <aside aria-label="Live preview" className="space-y-3 xl:sticky xl:top-2">
        <div className="glass rounded-[18px] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-subtle">Live preview</p>
          <div className="mx-auto mt-3 w-full max-w-[220px]">
            <StylePreview value={board} rows={PREVIEW_ROWS} frame={null} brand={previewBrand} ctaName={ctaName} keyword={keyword || null}
              label={`Preview of ${draft.name.trim() || 'this look'}: ${board.captions ? `${captionName(board.captionPreset)} captions` : 'no captions'}, ${HOOK_LABELS[board.hook]}`} />
          </div>
        </div>
        <div className="glass-tile rounded-xl p-3 text-2xs leading-relaxed text-ink-muted">
          <p className="font-medium text-ink">Where this look is used</p>
          <p className="mt-1">Picking this brand on Create or Remix fills in its hook look, caption style, call to action, keyword and handle. You can change any of them for one video there, or for one clip in the editor.</p>
        </div>
      </aside>
    </div>
  )
}

/** A tiny drawing of a hook look: a bar (white, black, the color), floating text, or nothing. */
function HookGlyph({ look, color }: { look: HeadlineLookStyle; color: string }): React.JSX.Element {
  const bar = look === 'white' ? '#FFFFFF' : look === 'black' ? '#0E0E0E' : look === 'brand' ? color : null
  return (
    <span aria-hidden className="relative block h-[30px] w-[18px] shrink-0 overflow-hidden rounded-[4px] bg-gradient-to-b from-slate-500 to-slate-800 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)]">
      {bar && <span className="absolute inset-x-0 top-0 h-[9px]" style={{ background: bar }} />}
      {look === 'floating' && <span className="absolute inset-x-[3px] top-[4px] h-[2px] rounded bg-white" />}
      {look === 'floating' && <span className="absolute inset-x-[5px] top-[8px] h-[2px] rounded bg-white" />}
    </span>
  )
}

/** The CTA library: every clip and image, with rename, how long an image shows, remove, add, and which one this look ends with. */
function CtaLibrary({ library, value, onChange }: { library: ReturnType<typeof useCtaLibrary>; value: string | null; onChange: (id: string | null) => void }): React.JSX.Element {
  const { ctas, adding } = library
  return (
    <Section label="CTA library" aside={ctas ? `${ctas.length} saved` : undefined} id="cta-library">
      <p className="text-2xs text-ink-muted">{CTA_HELP} The one marked for this look is added when this look is picked.</p>
      {ctas === null ? <Skeleton className="h-16 rounded-xl" /> : (
        <ul aria-label="Your calls to action" className="space-y-1.5">
          {ctas.map((cta) => <CtaRow key={cta.id} cta={cta} used={cta.id === value} library={library} onUse={(on) => onChange(on ? cta.id : null)} />)}
          {ctas.length === 0 && <li className="glass-tile rounded-xl px-3 py-2.5 text-2xs text-ink-subtle">No calls to action yet. Add a short video of you, or an image like your offer graphic.</li>}
        </ul>
      )}
      <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} loading={adding} disabled={adding || ctas === null} onClick={() => void library.add()}>
        {adding ? 'Adding…' : 'Add CTA'}
      </Button>
      {library.error && <p role="alert" className="text-2xs text-danger">{library.error}</p>}
    </Section>
  )
}

function CtaRow({ cta, used, library, onUse }: { cta: CtaSummary; used: boolean; library: ReturnType<typeof useCtaLibrary>; onUse: (on: boolean) => void }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className={cn('glass-tile flex flex-wrap items-center gap-3 rounded-xl p-1.5 pr-2.5', used && 'glass-selected')} aria-label={`${cta.name}${used ? ', used by this look' : ''}`}>
      <span className="relative block h-[56px] w-[32px] shrink-0 overflow-hidden rounded-md bg-black"><CtaThumb cta={cta} /></span>
      <span className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <input aria-label={`Name of ${cta.name}`} defaultValue={cta.name} maxLength={60} key={cta.name}
          onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== cta.name) void library.update(cta.id, { name }); else e.target.value = cta.name }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="glass-well h-7 min-w-0 rounded-md px-2 text-xs text-ink focus:border-accent focus:outline-none" />
        <span className="flex items-center gap-1 text-2xs text-ink-subtle">
          {cta.kind === 'video' ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          {cta.kind === 'video' ? `Video · ${cta.seconds} s` : 'Image'}
        </span>
      </span>
      {cta.kind === 'image' && (
        <Segmented label={`Seconds ${cta.name} shows`} size="sm" value={String(cta.seconds)} onChange={(seconds) => void library.update(cta.id, { seconds: Number(seconds) })}
          options={Array.from({ length: IMAGE_CTA_SECONDS.max - IMAGE_CTA_SECONDS.min + 1 }, (_, i) => String(IMAGE_CTA_SECONDS.min + i)).map((s) => ({ value: s, label: `${s}s` }))} />
      )}
      <Switch label={`Use ${cta.name} with this look`} checked={used} onChange={onUse} />
      <span className="w-[86px] text-2xs text-ink-muted">{used ? 'This look’s CTA' : 'Use as default'}</span>
      <Button size="sm" variant={confirming ? 'danger' : 'ghost'} iconOnly={!confirming} aria-label={confirming ? `Click again to remove ${cta.name}` : `Remove ${cta.name}`}
        icon={<Trash2 className="h-3.5 w-3.5" />} onBlur={() => setConfirming(false)}
        onClick={() => { if (!confirming) { setConfirming(true); return } setConfirming(false); void library.remove(cta.id) }}>
        {confirming ? 'Remove' : undefined}
      </Button>
    </li>
  )
}

/** Extras and graphics: Create's own settings (not saved with a look), shown here so the look and its effects are set in one place. */
function CreateDefaults(): React.JSX.Element {
  const extras = useDraftStore((state) => state.lookExtras)
  const motionGraphics = useDraftStore((state) => state.motionGraphics)
  const stageLayouts = useDraftStore((state) => state.stageLayouts)
  const register = useDraftStore((state) => state.register)
  const update = useDraftStore((state) => state.update)
  const shown = LOOK_EXTRAS.filter((extra) => !CREATE_SKILL_EXTRAS.includes(extra.id))
  return (
    <Section label="Extras and graphics on Create" aside="Saved with your Create settings, for every look">
      <div role="group" aria-label="Extras: pick as many as you like" className="flex flex-wrap gap-1.5">
        {shown.map((extra) => {
          const on = extras.includes(extra.id)
          return (
            <button key={extra.id} type="button" role="checkbox" aria-checked={on} aria-label={extra.label} title={extra.detail} onClick={() => update({ lookExtras: toggleExtra(extras, extra.id) })}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                on ? 'bg-tool/[0.12] text-tool shadow-[inset_0_0_0_1px_rgb(var(--tool)/0.5)]' : 'bg-sidebar/70 text-ink-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:text-ink')}>
              {on && <Check aria-hidden className="h-3 w-3" strokeWidth={3} />}{extra.label}
            </button>
          )
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2">
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-ink">Motion graphics</span><span className="block text-2xs text-ink-subtle">Animated cards for numbers, lists and key lines (Automatic).</span></span>
          <Switch label="Motion graphics on Create" checked={motionGraphics} onChange={(motionGraphics) => update({ motionGraphics })} />
        </label>
        <label className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2">
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-ink">Stage layouts</span><span className="block text-2xs text-ink-subtle">Big cards on a stage over you, with motion graphics.</span></span>
          <Switch label="Stage layouts on Create" checked={stageLayouts} disabled={!motionGraphics} onChange={(on) => update({ stageLayouts: on })} />
        </label>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-ink">Style</p>
        <Segmented label="Style" size="sm" value={register ?? 'auto'} onChange={(value) => update({ register: value === 'auto' ? null : value })}
          options={[{ value: 'auto', label: 'Auto' }, ...REGISTERS.map((id) => ({ value: id, label: REGISTER_INFO[id].label }))]} />
        <p className="text-2xs text-ink-subtle">{register ? REGISTER_INFO[register].detail : 'Picked from what you say: a lesson gets more graphics and sound, a personal story fewer.'} Sets how many graphics and how much sound, on Create and Edit my recording.</p>
      </div>
      <p className="text-2xs text-ink-subtle">Extras use your accent color when the look has one. Zoom is in Create’s Skills.</p>
    </Section>
  )
}
