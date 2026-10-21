import { useRef, useState } from 'react'
import { ImagePlus, Pin, X } from 'lucide-react'
import {
  CARD_TYPE_LABELS, EDIT_IMAGE_EXTENSIONS, EDIT_MAX_IMAGE_BYTES, EDIT_MAX_IMAGES, EDIT_MAX_PINS, MAX_CARD_ITEM_CHARS, MAX_CARD_TITLE_CHARS,
  cardProblem, type EditCard, type EditImage
} from '../../shared/edit-recording'
import { EDIT_RECIPES, type EditRecipeId } from '../../shared/edit-recipes'
import { LOOK_EXTRAS, type LookExtraId } from '../../shared/look-extras'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'
import { TextInput } from './ui/Field'
import { onRadioKeyDown } from './ui/Segmented'
import { Switch } from './ui/Switch'

/** The edit styles as tiles, and the extras the chosen style switched on (each can be turned off or on). */
export function EditStylePicker({ recipe, extras, onRecipe, onExtras }: {
  recipe: EditRecipeId
  extras: LookExtraId[]
  onRecipe: (id: EditRecipeId) => void
  onExtras: (extras: LookExtraId[]) => void
}): React.JSX.Element {
  return (
    <section className="mt-4 space-y-2" aria-labelledby="edit-style-title">
      <div>
        <h3 id="edit-style-title" className="text-sm font-semibold text-ink">Edit style</h3>
        <p className="text-2xs text-ink-subtle">Sets the pace of the cuts and which pop-ups, half-screen graphics and extras start on. You can change each one below.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Edit style">
        {EDIT_RECIPES.map((item) => {
          const selected = item.id === recipe
          return (
            <button key={item.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
              onClick={() => onRecipe(item.id)}
              className={cn('glass-tile glass-tile-hover rounded-xl px-3 py-2.5 text-left', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <span className="block text-xs font-medium">{item.label}</span>
              <span className="block text-2xs text-ink-muted">{item.detail}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Extras">
        <span className="mr-1 text-2xs text-ink-muted">Extras:</span>
        {LOOK_EXTRAS.map((extra) => {
          const on = extras.includes(extra.id)
          return (
            <button key={extra.id} type="button" aria-pressed={on} title={extra.detail}
              onClick={() => onExtras(on ? extras.filter((id) => id !== extra.id) : [...extras, extra.id])}
              className={cn('rounded-full px-2.5 py-1 text-2xs transition-colors', on ? 'bg-accent/20 text-accent' : 'bg-white/[0.05] text-ink-muted hover:text-ink')}>
              {extra.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** One half-screen graphic on the review screen: switch it off, or change its words. */
export function CardEditor({ index, card, on, removed, where, seconds, onChange, onToggle }: {
  index: number
  card: EditCard
  on: boolean
  removed: boolean
  where: string
  seconds: number
  onChange: (card: EditCard) => void
  onToggle: (on: boolean) => void
}): React.JSX.Element {
  const labels = card.type === 'stat' ? ['The number', 'What it is'] : card.type === 'compare' ? ['Title (optional)', 'Before', 'After']
    : card.type === 'chat' ? ['', 'The question', 'The reply'] : ['Title', 'Item 1', 'Item 2', 'Item 3', 'Item 4']
  const problem = on && !removed ? cardProblem(card) : null
  const setItem = (k: number, value: string): void => {
    const items = [...card.items]
    while (items.length <= k) items.push('')
    items[k] = value
    onChange({ ...card, items })
  }
  const itemCount = card.type === 'list' ? 4 : card.type === 'stat' ? 1 : 2
  const name = `Half-screen graphic ${index + 1}`
  return (
    <div className="glass-tile space-y-2 rounded-xl px-3 py-2" data-testid={`edit-card-${index}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{name} · {CARD_TYPE_LABELS[card.type]}</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-subtle">{removed ? 'Its word is cut, so it won’t show.' : `Fills the top half for ${seconds} s when you say ${where}; you move to the bottom half.`}</p>
        </div>
        <Switch label={name} checked={on && !removed} disabled={removed} onChange={onToggle} />
      </div>
      {on && !removed && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {card.type !== 'chat' && (
            <TextInput aria-label={`${name} ${labels[0].toLowerCase()}`} placeholder={labels[0]} value={card.title} maxLength={MAX_CARD_TITLE_CHARS}
              onChange={(e) => onChange({ ...card, title: e.target.value })} />
          )}
          {Array.from({ length: itemCount }, (_, k) => (
            <TextInput key={k} aria-label={`${name} ${labels[k + 1].toLowerCase()}`} placeholder={labels[k + 1]} value={card.items[k] ?? ''}
              maxLength={MAX_CARD_ITEM_CHARS} onChange={(e) => setItem(k, e.target.value)} />
          ))}
        </div>
      )}
      {problem && <p className="text-2xs text-danger">{problem}</p>}
    </div>
  )
}

/** Reads dropped files that are pictures (the bytes go to main, which checks and keeps them). */
async function dropImages(files: FileList | null, onImages: (images: EditImage[]) => void, onError: (error: string | null) => void): Promise<void> {
  const list = Array.from(files ?? []).filter((file) => EDIT_IMAGE_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? '') || file.type.startsWith('image/'))
  if (!list.length) { onError('Drop a PNG, JPEG or WebP picture.'); return }
  onError(null)
  for (const file of list.slice(0, EDIT_MAX_IMAGES)) {
    if (file.size > EDIT_MAX_IMAGE_BYTES) { onError(`“${file.name}” is over ${EDIT_MAX_IMAGE_BYTES / 1024 / 1024} MB.`); continue }
    try { onImages(await getApi().edit.addImage(file.name, new Uint8Array(await file.arrayBuffer()))) } catch (err) { onError(errorMessage(err)); return }
  }
}

/**
 * My images: logos and product shots the member drops here (or chooses), each pinned to words: while "Pin" is on,
 * clicking a word in the transcript pins the picture there.
 */
export function MyImages({ images, pins, wordText, pinning, onPinning, onUnpin, onImages, onError, heading = 'h3', className = 'mt-5' }: {
  images: EditImage[]
  pins: { image: string; word: number }[]
  wordText: (index: number) => string
  pinning: string | null
  onPinning: (id: string | null) => void
  onUnpin: (pin: { image: string; word: number }) => void
  onImages: (images: EditImage[]) => void
  onError: (error: string | null) => void
  /** The title's heading level ('h4' inside a bigger section). */
  heading?: 'h3' | 'h4'
  className?: string
}): React.JSX.Element {
  const Heading = heading
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const full = images.length >= EDIT_MAX_IMAGES
  const choose = async (): Promise<void> => {
    onError(null)
    try { const next = await getApi().edit.chooseImages(); if (next) onImages(next) } catch (err) { onError(errorMessage(err)) }
  }
  const remove = async (id: string): Promise<void> => {
    try { onImages(await getApi().edit.removeImage(id)) } catch (err) { onError(errorMessage(err)) }
  }
  return (
    <section className={cn('space-y-2', className)} aria-labelledby="edit-images-title">
      <div>
        <Heading id="edit-images-title" className="text-sm font-semibold text-ink">My images</Heading>
        <p className="text-2xs text-ink-subtle">Logos or product shots that pop up in the middle of the screen as you say a word. Add one, press Pin, then click the word.</p>
      </div>
      <div
        onDragEnter={(e) => { e.preventDefault(); depth.current += 1; if (!full) setDragging(true) }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false) }}
        onDrop={(e) => { e.preventDefault(); depth.current = 0; setDragging(false); if (!full) void dropImages(e.dataTransfer.files, onImages, onError) }}
        className={cn('space-y-2 rounded-xl border border-dashed p-3', dragging ? 'border-accent bg-accent/10' : 'border-white/15')}
        data-testid="edit-images-drop">
        {images.length > 0 && (
          <ul className="space-y-1.5" aria-label="My images">
            {images.map((image) => {
              const mine = pins.filter((pin) => pin.image === image.id)
              return (
                <li key={image.id} className="flex flex-wrap items-center gap-2">
                  <img src={localFileUrl(image.path)} alt="" className="h-10 w-10 rounded-lg bg-black/30 object-contain" />
                  <span className="min-w-0 max-w-[12rem] truncate text-xs text-ink">{image.name}</span>
                  {mine.map((pin) => (
                    <span key={pin.word} className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-2xs text-accent">
                      on {wordText(pin.word)}
                      <button type="button" aria-label={`Unpin from ${wordText(pin.word)}`} onClick={() => onUnpin(pin)}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <Button size="sm" variant={pinning === image.id ? 'primary' : 'secondary'} icon={<Pin className="h-3.5 w-3.5" />} aria-pressed={pinning === image.id}
                    disabled={pins.length >= EDIT_MAX_PINS && pinning !== image.id} onClick={() => onPinning(pinning === image.id ? null : image.id)}>
                    {pinning === image.id ? 'Click a word…' : 'Pin to a word'}
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${image.name}`} icon={<X className="h-3.5 w-3.5" />} onClick={() => void remove(image.id)} />
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon={<ImagePlus className="h-3.5 w-3.5" />} disabled={full} onClick={() => void choose()}>Choose images</Button>
          <span className="text-2xs text-ink-subtle">{dragging ? 'Drop to add' : `or drop PNG, JPEG or WebP pictures here (up to ${EDIT_MAX_IMAGES})`}</span>
        </div>
      </div>
    </section>
  )
}
