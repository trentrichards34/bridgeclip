import { memo, useMemo, useState, type ReactNode } from 'react'
import { Ban, Check, ChevronDown, ChevronLeft, ChevronRight, Image as ImageIcon, LayoutGrid, MessageCircle, Plus, Shuffle, SlidersHorizontal, Sparkles, Video } from 'lucide-react'
import { CAPTION_PRESETS } from '../../shared/caption-presets'
import { DEFAULT_HANDLE_POSITION, HANDLE_POSITIONS, hasBrandMark, type HandlePosition } from '../../shared/brand-kit'
import { HEADLINE_FONTS, isHexColor } from '../../shared/headline-look'
import { LOOK_EXTRAS, type LookExtraId } from '../../shared/look-extras'
import { MAX_CTA_OFFER_CHARS, normalizeCtaKeyword, type BrandIdentity } from '../../shared/remix'
import type { StyleKind } from '../../shared/member-prefs'
import {
  COLOR_PRESETS, CURATED_COMBOS, HOOK_HINTS, HOOK_LABELS, brandBoardPatch, captionName, colorName, colorPatch, comboPatch, cornerName, extrasName, fontName,
  hookPatch, matchingCombo, shuffleCombo, styleSummary, toggleExtra, type BoardRows, type BoardStyle, type CuratedCombo, type HookChoice
} from '../lib/style-board'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, youtubeId } from '../lib/utils'
import { useBrands } from '../store/use-brand-store'
import { BrandIdentityDialog } from './BrandIdentityDialog'
import { CTA_HELP, CtaDetails, CtaThumb, useCtaLibrary } from './CtaPicker'
import { FrameStill, LINGER_MS, LookFrame, SAMPLE_WORDS, STILL_MS, WORD_MS, useNearScreen } from './LookFrame'
import { SaveStyleButton } from './StylePresets'
import { StylePreview, type StyleFrame } from './StylePreview'
import { Button } from './ui/Button'
import { Field, TextInput } from './ui/Field'
import { onRadioKeyDown } from './ui/Segmented'
import { Switch } from './ui/Switch'

/** The preview's frame for a source: a local video or image, a YouTube thumbnail, or none (a neutral stand-in). */
export function previewFrame(source: string | null | undefined, kind: 'video' | 'image' = 'video', seek?: number): StyleFrame | null {
  const value = source?.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) {
    const id = youtubeId(value)
    return id ? { kind: 'image', src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } : null
  }
  return { kind, src: value, ...(seek !== undefined ? { seek } : {}) }
}

interface SwatchOption<T extends string> {
  id: T
  name: string
  /** The radio's accessible name (defaults to the name). */
  label?: string
  description?: string
  disabled?: boolean
  content: ReactNode
}

/** One row of the board: its name and current choice, then its visual swatches (a radio group) wrapped onto as many lines as they need. */
function SwatchRow<T extends string>({ title, groupLabel, current, options, value, onSelect, note, after, controls, disabled, first, grid }: {
  title: string; groupLabel: string; current: string; options: SwatchOption<T>[]; value: T | null; onSelect: (id: T) => void
  note?: ReactNode; after?: ReactNode; controls?: ReactNode; disabled?: boolean
  /** Show only this many at first (plus the chosen one), with a "Show all" toggle. */
  first?: number
  /** Even columns (same-size tiles) instead of a wrapped line. */
  grid?: string
}): React.JSX.Element {
  const [all, setAll] = useState(false)
  const enabled = disabled ? [] : options.filter((option) => !option.disabled)
  const selectedEnabled = enabled.some((option) => option.id === value)
  const step = (delta: number): void => {
    if (!enabled.length) return
    const at = enabled.findIndex((option) => option.id === value)
    onSelect(enabled[(at + delta + enabled.length) % enabled.length].id)
  }
  const folds = first !== undefined && options.length > first + 1
  const shown = !folds || all ? options : options.filter((option, i) => i < first || option.id === value)
  const id = `style-row-${groupLabel.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="space-y-1.5" role="group" aria-labelledby={id}>
      <div className="flex min-h-7 items-center gap-2">
        <span id={id} className="shrink-0 text-xs font-semibold text-ink">{title}</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted" data-testid={`${id}-current`}>{current}</span>
        {controls}
        {enabled.length > 1 && <>
          <Button size="sm" variant="ghost" iconOnly aria-label={`Previous ${title.toLowerCase()}`} icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => step(-1)} />
          <Button size="sm" variant="ghost" iconOnly aria-label={`Next ${title.toLowerCase()}`} icon={<ChevronRight className="h-3.5 w-3.5" />} onClick={() => step(1)} />
        </>}
      </div>
      <div role="radiogroup" aria-label={groupLabel} className={cn('gap-1.5', grid ? 'grid' : 'flex flex-wrap items-stretch')} style={grid ? { gridTemplateColumns: grid } : undefined}>
        {shown.map((option) => {
          const selected = option.id === value
          const tabbable = selected ? !(disabled || option.disabled) : !selectedEnabled && option === enabled[0]
          return (
            <button key={option.id} type="button" role="radio" aria-checked={selected} aria-label={option.label ?? option.name}
              tabIndex={tabbable ? 0 : -1} disabled={disabled || option.disabled} title={option.description ?? option.name} onKeyDown={onRadioKeyDown}
              onClick={() => onSelect(option.id)}
              className={cn('glass-tile glass-tile-hover relative flex min-w-0 flex-col items-center gap-1 rounded-xl p-1 text-center disabled:cursor-not-allowed disabled:opacity-40',
                selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              {option.content}
              {selected && (
                <span aria-hidden className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_0_0_1px_rgb(var(--accent)/0.6)]">
                  <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                </span>
              )}
            </button>
          )
        })}
        {after}
      </div>
      {folds && (
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
          className="inline-flex items-center gap-1 rounded-md px-1 text-2xs font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {all ? 'Show fewer' : `Show all ${options.length}`}
          <ChevronDown aria-hidden className={cn('h-3 w-3 transition-transform', all && 'rotate-180')} />
        </button>
      )}
      {note}
    </div>
  )
}

/** Caption styles shown before "Show all": No captions and the first nine (two even rows on a typical board). */
const CAPTIONS_FIRST = 10

/** The Extras row: a checkbox per effect (pick as many as you like), each a tile of the effect on the member's frame. */
function ExtrasRow({ value, onChange, options, wide }: {
  value: readonly LookExtraId[]; onChange: (extras: LookExtraId[]) => void
  options: { id: LookExtraId; name: string; description: string; content: ReactNode }[]; wide: boolean
}): React.JSX.Element {
  return (
    <div className="space-y-1.5" role="group" aria-labelledby="style-row-extras">
      <div className="flex min-h-7 items-center gap-2">
        <span id="style-row-extras" className="shrink-0 text-xs font-semibold text-ink">Extras</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted" data-testid="style-row-extras-current">
          {value.length ? extrasName(value) : 'Pick as many as you like'}
        </span>
        {value.length > 0 && <Button size="sm" variant="ghost" aria-label="Clear extras" onClick={() => onChange([])}>Clear</Button>}
      </div>
      <div role="group" aria-label="Extras: pick as many as you like" className="grid gap-1.5" style={{ gridTemplateColumns: wide ? TILE_GRID_WIDE : TILE_GRID }}>
        {options.map((option) => {
          const on = value.includes(option.id)
          return (
            <button key={option.id} type="button" role="checkbox" aria-checked={on} aria-label={option.name} title={option.description}
              data-extra={option.id} onClick={() => onChange(toggleExtra(value, option.id))}
              className={cn('glass-tile glass-tile-hover relative flex min-w-0 flex-col items-center gap-1 rounded-xl p-1 text-center',
                on ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              {option.content}
              <span aria-hidden className={cn('absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-[5px] shadow-[0_0_0_1px_rgb(255_255_255/0.35)]',
                on ? 'bg-accent text-accent-ink' : 'bg-black/40')}>
                {on && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-2xs text-ink-subtle">Effects on top of your look. Each tile shows it on your video.</p>
    </div>
  )
}

type StartChoice = 'ready' | 'build'
const START_KEY = 'creatorclips.styleBoard.start'
function readStart(): StartChoice {
  try { return globalThis.localStorage?.getItem(START_KEY) === 'ready' ? 'ready' : 'build' } catch { return 'build' }
}
function saveStart(choice: StartChoice): void {
  try { globalThis.localStorage?.setItem(START_KEY, choice) } catch { /* a convenience only */ }
}

const START_OPTIONS: { id: StartChoice; title: string; detail: string; icon: ReactNode }[] = [
  { id: 'ready', title: 'Start from a ready-made look', detail: 'Pick a complete look, then change anything.', icon: <LayoutGrid className="h-4 w-4" /> },
  { id: 'build', title: 'Build my own', detail: 'Choose captions, hook text, font and color one by one.', icon: <SlidersHorizontal className="h-4 w-4" /> }
]

/** The hook text on tiles when the page has none of its own (short, so it reads at tile size). */
const TILE_HOOK = 'Why nobody watches your videos'
/** Tile widths in pixels (9:16 and 16:9). */
const TILE_W = 84
const TILE_W_WIDE = 128
/** Tile columns: as many as fit, each at least a tile wide. */
const TILE_GRID = `repeat(auto-fill, minmax(${TILE_W + 10}px, 1fr))`
const TILE_GRID_WIDE = `repeat(auto-fill, minmax(${TILE_W_WIDE + 10}px, 1fr))`

/** How a tile looks: the board's look with one option applied, and how big its text is drawn. */
interface TileLook {
  value: BoardStyle
  rows: BoardRows
  extras?: readonly LookExtraId[]
  textScale: number
  forceCaptions?: boolean
}

/** What every tile on the board shares: the member's frame, the page's words and the shape. */
interface TileScene { frame: StyleFrame | null; aspect: '9:16' | '16:9'; hookText?: string; words?: string[]; keyword: string | null }

/**
 * One option as a small still of the member's own frame with that option
 * applied (LookFrame, not playing). It draws once it comes near the screen.
 */
const LookTile = memo(function LookTile({ look, scene }: { look: TileLook; scene: TileScene }): React.JSX.Element {
  const [ref, near] = useNearScreen<HTMLSpanElement>()
  const wide = scene.aspect === '16:9'
  const width = wide ? TILE_W_WIDE : TILE_W
  const lineWords = scene.words?.length ? scene.words.slice(0, 8) : SAMPLE_WORDS
  return (
    <span ref={ref} aria-hidden data-look-tile className={cn('relative block shrink-0 overflow-hidden rounded-lg bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]', wide ? 'aspect-video' : 'aspect-[9/16]')}
      style={{ width }}>
      {near && (
        <LookFrame value={look.value} rows={look.rows} background={<FrameStill frame={scene.frame} />} aspect={scene.aspect}
          hookText={scene.hookText?.trim() ? scene.hookText : TILE_HOOK} words={scene.words} keyword={scene.keyword} width={width}
          time={STILL_MS} loop={lineWords.length * WORD_MS + LINGER_MS} ending={false} extras={look.extras ?? []}
          textScale={look.textScale} tile forceCaptions={look.forceCaptions} />
      )}
    </span>
  )
})

/** A tile and its name under it. */
function TileOption({ look, scene, name }: { look: TileLook; scene: TileScene; name: string }): React.JSX.Element {
  return (
    <>
      <LookTile look={look} scene={scene} />
      <span className="w-full truncate px-0.5 text-2xs font-medium leading-tight">{name}</span>
    </>
  )
}

function CornerSwatch({ corner }: { corner: HandlePosition }): React.JSX.Element {
  return (
    <span aria-hidden className="relative block h-[48px] w-[27px] rounded-md bg-gradient-to-b from-slate-500 via-slate-700 to-slate-900">
      <span className={cn('absolute h-[5px] w-[12px] rounded-full bg-white/85', corner.startsWith('top') ? 'top-[14%]' : 'bottom-[14%]', corner.endsWith('left') ? 'left-[10%]' : 'right-[10%]')} />
    </span>
  )
}

export interface StyleBoardProps {
  value: BoardStyle
  onChange: (patch: Partial<BoardStyle>) => void
  rows: BoardRows
  brand: BrandIdentity | null
  frame?: StyleFrame | null
  aspect?: '9:16' | '16:9'
  /** The video's own hook text and words, when the page has them (Edit my recording). */
  hookText?: string
  words?: string[]
  /** Why some hook looks can't be used here (shown under the hook row). */
  hookNote?: ReactNode
  /** The page's own explanation under the keyword fields. */
  keywordHelp?: ReactNode
  /** @deprecated The row is headed "Comment keyword"; its field is labeled "Keyword". */
  keywordLabel?: string
  ctaHelp?: string
  /** Puts back the brand's look (default: the brand kit's fields on the board). */
  onUseBrand?: () => void
  /** Offers "Save as a style" for Create or Remix saved styles. */
  saveKind?: StyleKind
  /** Template options that aren't the look, under the board. */
  layout?: ReactNode
  title?: string
  className?: string
}

/**
 * Pick your pieces: a live preview of the video on one side and a row per
 * piece on the other (captions, hook text, font, color, handle, call to
 * action, comment keyword). Shuffle tries a curated combination; "Use my
 * brand" puts back the brand kit. Pages map the board to their own fields.
 */
export function StyleBoard({
  value, onChange, rows, brand, frame = null, aspect = '9:16', hookText, words, hookNote, keywordHelp,
  ctaHelp = CTA_HELP, onUseBrand, saveKind, layout, title = 'Your look', className
}: StyleBoardProps): React.JSX.Element {
  const hooks = rows.hooks ?? []
  const look = brand?.look
  const brandColor = look?.color && isHexColor(look.color) ? look.color.toUpperCase() : null
  const hasMark = hasBrandMark(look)
  const corner = look?.handlePosition ?? DEFAULT_HANDLE_POSITION
  const keyword = normalizeCtaKeyword(value.keyword)
  const [cornerError, setCornerError] = useState<string | null>(null)
  const [savingCorner, setSavingCorner] = useState(false)
  // The brand dialog, opened from the board: a new brand, or this one at its handle.
  const [brandDialog, setBrandDialog] = useState<'new' | 'handle' | null>(null)
  const library = useCtaLibrary(rows.cta ? value.ctaId : null, (ctaId) => onChange({ ctaId }))
  const ctaName = rows.cta && value.ctaId ? library.selected?.name ?? null : null
  const summary = styleSummary(value, rows, { brandColor, corner, hasMark, ctaName })
  const fontApplies = value.hook !== 'none' && value.hook !== 'card' && hooks.some((hook) => hook !== 'none' && hook !== 'card')

  const shuffle = (): void => onChange(comboPatch(shuffleCombo(value), hooks))
  const useBrand = (): void => {
    if (!brand) { setBrandDialog('new'); return }
    if (onUseBrand) onUseBrand()
    else onChange(brandBoardPatch(look, value, hooks))
  }
  const brandSaved = (list: BrandIdentity[], id: string): void => {
    const kind = brandDialog
    setBrandDialog(null)
    useBrands.getState().setBrands(list)
    const saved = list.find((item) => item.id === id)
    if (!saved) return
    // A new brand is picked on the page (its look fills the board); a handle just added turns on.
    if (kind === 'new') useBrands.getState().requestPick(saved.id)
    else if (hasBrandMark(saved.look) && !value.handle) onChange({ handle: true })
  }
  // The handle's corner belongs to the brand: choosing one saves it there.
  const chooseCorner = async (position: HandlePosition): Promise<void> => {
    if (!value.handle) onChange({ handle: true })
    if (!brand || position === corner) return
    setSavingCorner(true); setCornerError(null)
    try {
      const list = await getApi().brandIdentities.save({ id: brand.id, name: brand.name, text: brand.text, look: { ...(brand.look ?? {}), handlePosition: position } })
      useBrands.getState().setBrands(list)
    } catch (err) { setCornerError(errorMessage(err, 'The corner could not be saved to your brand.')) } finally { setSavingCorner(false) }
  }

  // Everything the tiles share. The frame is keyed by its file so a page's fresh object doesn't redraw every tile.
  const frameKey = frame ? `${frame.kind}:${frame.src}:${frame.seek ?? ''}` : ''
  const tileFrame = useMemo(() => frame, [frameKey])
  const wordsKey = words?.join(' ') ?? ''
  const tileKeyword = keyword || null
  const scene = useMemo<TileScene>(() => ({ frame: tileFrame, aspect, hookText, words, keyword: tileKeyword }), [tileFrame, aspect, hookText, wordsKey, tileKeyword])
  const wide = aspect === '16:9'
  const tileGrid = wide ? TILE_GRID_WIDE : TILE_GRID
  // A neutral look each row's option is applied to: the board's own font and colors, nothing else drawn.
  const plain: BoardStyle = useMemo(() => ({ ...value, captions: false, hook: 'none', handle: false, extras: [] }), [value.font, value.color])
  const hookRows = useMemo<BoardRows>(() => ({ hooks }), [hooks.join(' ')])
  const NO_ROWS = useMemo<BoardRows>(() => ({}), [])

  const captionOptions = useMemo<SwatchOption<string>[]>(() => [
    { id: 'off', name: 'No captions', description: 'No word-by-word captions', content: <TileOption name="Off" scene={scene} look={{ value: plain, rows: NO_ROWS, textScale: 1.9 }} /> },
    ...CAPTION_PRESETS.map((preset) => ({ id: preset.id as string, name: preset.name, description: preset.description, content: (
      <TileOption name={preset.name} scene={scene} look={{ value: { ...plain, captions: true, captionPreset: preset.id }, rows: NO_ROWS, textScale: 1.9 }} />
    ) }))
  ], [scene, plain, NO_ROWS])

  const hookColor = (hook: HookChoice): string => hook === 'brand' && value.color.toUpperCase() === '#FFFFFF' ? brandColor ?? COLOR_PRESETS[0].color : value.color
  const hookOptions = useMemo<SwatchOption<HookChoice>[]>(() => hooks.map((hook) => ({ id: hook, name: HOOK_LABELS[hook], description: HOOK_HINTS[hook], content: (
    <TileOption name={HOOK_LABELS[hook]} scene={scene} look={{ value: { ...plain, hook, color: hookColor(hook) }, rows: hookRows, textScale: 1.6 }} />
  ) })), [scene, plain, hookRows, brandColor])

  // Fonts on the hook look in use (a white bar when there's none to show).
  const fontHook: HookChoice = value.hook === 'none' || value.hook === 'card' ? 'white' : value.hook
  const fontOptions = useMemo<SwatchOption<BoardStyle['font']>[]>(() => HEADLINE_FONTS.map((font) => ({ id: font.id, name: font.label, content: (
    <TileOption name={font.label} scene={scene} look={{ value: { ...plain, hook: fontHook, font: font.id }, rows: { hooks: ['white'] }, textScale: 2 }} />
  ) })), [scene, plain, fontHook])

  const comboOptions = useMemo<SwatchOption<string>[]>(() => CURATED_COMBOS.map((combo: CuratedCombo) => ({
    id: combo.id, name: combo.name, description: `${captionName(combo.captionPreset)} captions · ${HOOK_LABELS[combo.hook]} · ${fontName(combo.font)} font`, content: (
      <TileOption name={combo.name} scene={scene} look={{ value: { ...plain, ...comboPatch(combo, hooks) }, rows: hookRows, textScale: 1.5 }} />
    ) })), [scene, plain, hookRows])

  // Extras on the board's captions (an extra on the caption line needs one, so it's drawn even when captions are off).
  const extrasBase: BoardStyle = useMemo(() => ({ ...plain, captions: value.captions, captionPreset: value.captions ? value.captionPreset : 'pop' }), [plain, value.captions, value.captionPreset])
  const extraOptions = useMemo(() => LOOK_EXTRAS.map((extra) => ({ id: extra.id, name: extra.label, description: extra.detail, content: (
    <TileOption name={extra.label} scene={scene} look={{ value: extrasBase, rows: NO_ROWS, extras: [extra.id], textScale: 1.6,
      forceCaptions: extra.id === 'keyword_pill' || extra.id === 'accent_words' }} />
  ) })), [scene, extrasBase, NO_ROWS])

  const [start, setStart] = useState<StartChoice>(readStart)
  const chooseStart = (choice: StartChoice): void => { setStart(choice); saveStart(choice) }
  const combo = matchingCombo(value)
  const lookRows = hooks.length > 0

  return (
    <section aria-label={title} className={cn('style-board space-y-3', className)} data-testid="style-board">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Sparkles className="h-4 w-4 text-accent" />{title}</h3>
          <p className="mt-0.5 truncate text-2xs text-ink-muted" data-testid="style-board-summary" title={summary}>{summary}</p>
        </div>
        <Button size="sm" variant="secondary" icon={<Shuffle className="h-3.5 w-3.5" />} onClick={shuffle} tooltip="Try a ready-made mix of captions, hook text, font and color">Shuffle</Button>
        {brand
          ? <Button size="sm" variant="ghost" onClick={useBrand} tooltip={`Put back ${brand.name}’s look`}>Use my brand</Button>
          : <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={useBrand}
            tooltip="Add your brand: your voice, offer and proof, plus your color, caption style and handle. Its look fills this board.">Set up my brand</Button>}
        {saveKind && <SaveStyleButton kind={saveKind} />}
      </div>

      {lookRows && (
        <div role="radiogroup" aria-label="How to start" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-1.5" data-testid="style-board-start">
          {START_OPTIONS.map((option) => {
            const selected = start === option.id
            return (
              <button key={option.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                onClick={() => chooseStart(option.id)}
                className={cn('glass-tile glass-tile-hover flex min-w-0 items-start gap-2 rounded-xl px-3 py-2 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
                <span aria-hidden className={cn('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-ink-subtle')}>{option.icon}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">{option.title}</span>
                  <span className={cn('block text-2xs', selected ? 'text-ink-muted' : 'text-ink-subtle')}>{option.detail}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Side by side when the board is wide enough, stacked (preview first) when it isn't: a container query in globals.css. */}
      <div className={cn('style-board-grid', aspect === '16:9' && 'is-landscape')}>
        <div className="style-board-preview">
          <StylePreview value={value} rows={rows} frame={frame} aspect={aspect} hookText={hookText} words={words} brand={brand}
            ctaName={ctaName} keyword={rows.keyword && keyword ? keyword : null} label={`Preview: ${summary}`} />
        </div>

        <div className="min-w-0 space-y-3">
          {lookRows && start === 'ready' ? (
            <SwatchRow title="Ready-made looks" groupLabel="Ready-made look" current={combo ? combo.name : 'Your own mix'}
              options={comboOptions} value={combo?.id ?? null} grid={tileGrid}
              onSelect={(id) => { const picked = CURATED_COMBOS.find((item) => item.id === id); if (picked) onChange(comboPatch(picked, hooks)) }}
              note={<p className="text-2xs text-ink-subtle">
                Captions, hook text, font and color that go together.{' '}
                <button type="button" onClick={() => chooseStart('build')} className="font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Change anything</button>
              </p>} />
          ) : <>
            <SwatchRow title="Captions" groupLabel="Caption style" current={value.captions ? captionName(value.captionPreset) : 'Off'}
              options={captionOptions} value={value.captions ? value.captionPreset : 'off'} first={CAPTIONS_FIRST} grid={tileGrid}
              onSelect={(id) => onChange(id === 'off' ? { captions: false } : { captions: true, captionPreset: id })} />

            {lookRows && <SwatchRow title="Hook text" groupLabel="Hook text look" current={HOOK_LABELS[value.hook]}
              options={hookOptions} grid={tileGrid}
              value={value.hook} onSelect={(hook) => onChange(hookPatch(value, hook, brandColor ?? undefined))}
              note={<p className="text-2xs text-ink-subtle">{hookNote ?? HOOK_HINTS[value.hook]}</p>} />}

            {lookRows && <SwatchRow title="Font" groupLabel="Hook text font" current={fontApplies ? fontName(value.font) : `${fontName(value.font)} · for the hook text`}
              disabled={!fontApplies} options={fontOptions} grid={tileGrid}
              value={value.font} onSelect={(font) => onChange({ font })} />}

            {value.hook === 'brand' && hooks.includes('brand') && <SwatchRow title="Color" groupLabel="Bar color" current={colorName(value.color, brandColor)}
              options={[...(brandColor ? [{ id: 'brand', name: 'Brand', color: brandColor }] : []), ...COLOR_PRESETS.filter((item) => item.color.toUpperCase() !== brandColor)].map((item) => ({
                id: item.color.toUpperCase(), name: item.name, label: `${item.name} ${item.color.toUpperCase()}`, content: (
                  <span aria-hidden className="block h-7 w-7 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]" style={{ background: item.color }} />
                ) }))}
              value={value.color.toUpperCase()} onSelect={(color) => onChange(colorPatch(color, hooks))}
              after={<label title="Custom color" className="glass-tile glass-tile-hover flex cursor-pointer items-center gap-1.5 rounded-xl p-1 pr-2.5 text-ink-muted hover:text-ink">
                <input type="color" aria-label="Custom bar color" value={(isHexColor(value.color) ? value.color : COLOR_PRESETS[0].color).toLowerCase()}
                  onChange={(e) => { if (isHexColor(e.target.value)) onChange(colorPatch(e.target.value, hooks)) }}
                  className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" />
                <span className="text-2xs font-medium">Custom</span>
              </label>}
              note={<p className="text-2xs text-ink-subtle">The color of the hook text bar. The text turns black or white to stay readable.</p>} />}
          </>}

          {rows.extras && <ExtrasRow value={value.extras} onChange={(extras) => onChange({ extras })} options={extraOptions} wide={wide} />}

          {rows.handle && (hasMark ? (
            <SwatchRow title="Handle" groupLabel="Handle corner" current={value.handle ? `${look?.handle || 'Your logo'} · ${cornerName(corner).toLowerCase()}` : 'Off'}
              controls={<Switch label="Show my handle" checked={value.handle} onChange={(handle) => onChange({ handle })} />}
              options={HANDLE_POSITIONS.map((item) => ({ id: item.id, name: item.label, description: `${item.label} (saved to your brand)`, disabled: savingCorner, content: (
                <>
                  <CornerSwatch corner={item.id} />
                  <span className="w-[52px] text-2xs font-medium leading-tight">{item.label}</span>
                </>
              ) }))}
              value={value.handle ? corner : null} onSelect={(position) => void chooseCorner(position)}
              note={<>
                <p className="text-2xs text-ink-subtle">Puts {look?.handle ? `“${look.handle}”` : 'your logo'} small in a corner of every video. The corner is saved to your brand.</p>
                {cornerError && <p role="alert" className="text-2xs text-danger">{cornerError}</p>}
              </>} />
          ) : (
            <div className="space-y-1.5" role="group" aria-labelledby="style-row-handle">
              <div className="flex min-h-7 items-center gap-2">
                <span id="style-row-handle" className="text-xs font-semibold text-ink">Handle</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted">Off</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setBrandDialog(brand ? 'handle' : 'new')}>
                  {brand ? 'Add a handle' : 'Set up my brand'}
                </Button>
                <p className="min-w-0 flex-1 basis-56 text-2xs text-ink-subtle">
                  {brand ? `Add your handle or logo to ${brand.name} to show it small in a corner of every video.` : 'Add a brand with your handle or logo to show it small in a corner of every video.'}
                </p>
              </div>
            </div>
          ))}

          {rows.cta && <SwatchRow title="Call to action" groupLabel="Call to action" current={ctaName ?? 'None'}
            options={[
              { id: '', name: 'None', description: 'Clips end as made', content: (
                <>
                  <span aria-hidden className="flex h-[64px] w-[36px] items-center justify-center rounded-md bg-black/25 text-ink-subtle"><Ban className="h-3.5 w-3.5" /></span>
                  <span className="w-[52px] text-2xs font-medium">None</span>
                </>
              ) },
              ...(library.ctas ?? []).map((cta) => ({ id: cta.id, name: cta.name, label: `${cta.name} (${cta.kind === 'video' ? 'video' : 'image'}, ${cta.seconds} seconds)`, content: (
                <>
                  <span aria-hidden className="relative block h-[64px] w-[36px] overflow-hidden rounded-md bg-black"><CtaThumb cta={cta} />
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-0.5 text-white">{cta.kind === 'video' ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}</span>
                  </span>
                  <span className="w-[52px] truncate text-2xs font-medium">{cta.name}</span>
                </>
              ) }))
            ]}
            value={value.ctaId ?? ''} onSelect={(id) => onChange({ ctaId: id || null })}
            after={<button type="button" disabled={library.adding || library.ctas === null} onClick={() => void library.add()}
              className="glass-tile glass-tile-hover flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 p-1 text-center text-ink-muted hover:text-ink disabled:opacity-50">
              <span aria-hidden className="flex h-[64px] w-[36px] items-center justify-center"><Plus className="h-4 w-4" /></span>
              <span className="w-[52px] text-2xs font-medium">{library.adding ? 'Adding…' : 'Add CTA'}</span>
            </button>}
            note={<>
              <CtaDetails library={library} />
              <p className="text-2xs text-ink-subtle">{ctaHelp}</p>
              {library.error && <p role="alert" className="text-2xs text-danger">{library.error}</p>}
            </>} />}

          {rows.keyword && (
            <div className="space-y-1.5" role="group" aria-label="Comment-keyword call to action">
              <div className="flex min-h-7 items-center gap-2">
                <span id="style-row-keyword" className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink"><MessageCircle className="h-3.5 w-3.5 text-ink-muted" />Comment keyword</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted">{keyword ? `Comment ${keyword}` : 'Optional'}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-3">
                <Field label="Keyword">
                  <TextInput aria-label="Comment keyword" value={value.keyword} maxLength={20} placeholder="e.g. SALES"
                    onChange={(e) => onChange({ keyword: e.target.value.toUpperCase().replace(/\s+/g, '') })} />
                </Field>
                <Field label="What they get">
                  <TextInput aria-label="What they get" value={value.offer} maxLength={MAX_CTA_OFFER_CHARS} disabled={!keyword}
                    placeholder="e.g. my free playbook" onChange={(e) => onChange({ offer: e.target.value })} />
                </Field>
              </div>
              {keywordHelp}
            </div>
          )}
        </div>
      </div>

      {brandDialog && <BrandIdentityDialog brand={brandDialog === 'handle' ? brand : null} focus={brandDialog === 'handle' ? 'handle' : undefined}
        onClose={() => setBrandDialog(null)} onSaved={brandSaved} />}

      {layout && (
        <section aria-labelledby="style-board-layout" className="space-y-3 border-t border-white/[0.06] pt-3">
          <h4 id="style-board-layout" className="eyebrow">Layout</h4>
          {layout}
        </section>
      )}
    </section>
  )
}

