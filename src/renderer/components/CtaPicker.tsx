import { useEffect, useRef, useState } from 'react'
import { Check, Image as ImageIcon, Megaphone, Plus, Trash2, Video } from 'lucide-react'
import { IMAGE_CTA_SECONDS, type CtaSummary } from '../../shared/ctas'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'
import { Dialog, DialogFooter } from './ui/Dialog'
import { onRadioKeyDown } from './ui/Segmented'

/** The member's CTA library, loaded once per picker. */
export function useCtas(): { ctas: CtaSummary[] | null; setCtas: (list: CtaSummary[]) => void; error: string | null } {
  const [ctas, setCtas] = useState<CtaSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    getApi().ctas.list().then((list) => { if (live) setCtas(list) }).catch((err) => { if (live) { setCtas([]); setError(errorMessage(err)) } })
    return () => { live = false }
  }, [])
  return { ctas, setCtas, error }
}

function CtaThumb({ cta }: { cta: CtaSummary }): React.JSX.Element {
  return cta.kind === 'video'
    ? <video src={localFileUrl(cta.path)} muted loop playsInline autoPlay preload="metadata" aria-hidden className="h-full w-full object-cover" />
    : <img src={localFileUrl(cta.path)} alt="" className="h-full w-full object-cover" />
}

/**
 * Choose a call to action (or none) and manage the library: add a video or
 * image, rename, set how long an image shows, remove.
 */
export function CtaPicker({ value, onChange, disabled, onMissing }: {
  value: string | null; onChange: (id: string | null) => void; disabled?: boolean
  /** The chosen CTA was deleted from the library (default: clear the choice). */
  onMissing?: () => void
}): React.JSX.Element {
  const { ctas, setCtas, error: loadError } = useCtas()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = ctas?.find((cta) => cta.id === value) ?? null
  // A CTA removed from the library is no longer a choice.
  useEffect(() => {
    if (ctas && value && !ctas.some((cta) => cta.id === value)) { if (onMissing) onMissing(); else onChange(null) }
  }, [ctas, value, onChange, onMissing])

  const add = async (): Promise<void> => {
    setAdding(true); setError(null)
    try {
      const list = await getApi().ctas.add()
      if (list) {
        const added = list.find((cta) => !(ctas ?? []).some((old) => old.id === cta.id))
        setCtas(list)
        if (added) onChange(added.id)
      }
    } catch (err) { setError(errorMessage(err)) } finally { setAdding(false) }
  }
  const update = async (id: string, patch: { name?: string; seconds?: number }): Promise<void> => {
    setError(null)
    try { setCtas(await getApi().ctas.update(id, patch)) } catch (err) { setError(errorMessage(err)) }
  }
  const remove = async (id: string): Promise<void> => {
    setError(null)
    try { setCtas(await getApi().ctas.remove(id)); if (value === id) onChange(null) } catch (err) { setError(errorMessage(err)) }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Call to action">
        <button type="button" role="radio" aria-checked={value === null} tabIndex={value === null ? 0 : -1} onKeyDown={onRadioKeyDown} disabled={disabled}
          onClick={() => onChange(null)}
          className={cn('glass-tile glass-tile-hover flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-xl p-2 text-center', value === null ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
          <span className="text-xs font-medium">None</span>
          <span className="text-2xs text-ink-subtle">Clips end as made</span>
        </button>
        {(ctas ?? []).map((cta) => {
          const isOn = cta.id === value
          return (
            <button key={cta.id} type="button" role="radio" aria-checked={isOn} tabIndex={isOn ? 0 : -1} onKeyDown={onRadioKeyDown} disabled={disabled}
              onClick={() => onChange(cta.id)} aria-label={`${cta.name} (${cta.kind === 'video' ? 'video' : 'image'}, ${cta.seconds} seconds)`}
              className={cn('glass-tile glass-tile-hover relative flex aspect-[9/16] flex-col overflow-hidden rounded-xl text-left', isOn ? 'glass-selected' : '')}>
              <div className="min-h-0 flex-1 bg-black"><CtaThumb cta={cta} /></div>
              <div className="flex items-center gap-1 px-2 py-1.5">
                {cta.kind === 'video' ? <Video className="h-3 w-3 shrink-0 text-ink-subtle" /> : <ImageIcon className="h-3 w-3 shrink-0 text-ink-subtle" />}
                <span className="truncate text-2xs font-medium text-ink">{cta.name}</span>
                <span className="ml-auto shrink-0 font-mono text-2xs text-ink-subtle">{cta.seconds}s</span>
              </div>
              {isOn && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-ink"><Check className="h-3 w-3" /></span>}
            </button>
          )
        })}
        <button type="button" disabled={disabled || adding || ctas === null} onClick={() => void add()}
          className="glass-tile glass-tile-hover flex aspect-[9/16] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 p-2 text-center text-ink-muted hover:text-ink disabled:opacity-50">
          <Plus className="h-4 w-4" />
          <span className="text-xs font-medium">{adding ? 'Adding…' : 'Add CTA'}</span>
          <span className="text-2xs text-ink-subtle">Video or image</span>
        </button>
      </div>
      {selected && (
        <div className="glass-tile flex flex-wrap items-center gap-3 rounded-xl px-3 py-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-2xs text-ink-muted">
            Name
            <input aria-label="Call to action name" defaultValue={selected.name} key={selected.id} maxLength={60} disabled={disabled}
              onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== selected.name) void update(selected.id, { name }) }}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-ink" />
          </label>
          {selected.kind === 'image' && (
            <label className="flex items-center gap-2 text-2xs text-ink-muted">
              Shows for
              <select aria-label="Seconds the image shows" value={selected.seconds} disabled={disabled}
                onChange={(e) => void update(selected.id, { seconds: Number(e.target.value) })}
                className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-xs text-ink">
                {Array.from({ length: IMAGE_CTA_SECONDS.max - IMAGE_CTA_SECONDS.min + 1 }, (_, i) => IMAGE_CTA_SECONDS.min + i).map((s) => <option key={s} value={s}>{s} seconds</option>)}
              </select>
            </label>
          )}
          <button type="button" className="flex items-center gap-1 text-2xs text-danger disabled:opacity-50" disabled={disabled} onClick={() => void remove(selected.id)}>
            <Trash2 className="h-3 w-3" />Remove from library
          </button>
        </div>
      )}
      <p className="text-2xs text-ink-subtle">
        A short video of you asking for the comment, follow or click (up to 15 seconds), or an image like your offer graphic. It plays at the end of each clip, fitted to the clip’s shape. Added on your computer, so there’s no AI cost.
      </p>
      {(error || loadError) && <p role="alert" className="text-2xs text-danger">{error ?? loadError}</p>}
    </div>
  )
}

/** Change the CTA on one finished clip. */
export function ClipCtaDialog({ title, current, onApply, onClose }: {
  title: string; current: string | null; onApply: (ctaId: string | null) => Promise<void>; onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [choice, setChoice] = useState<string | null>(current)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const apply = async (): Promise<void> => {
    setWorking(true); setError(null)
    try { await onApply(choice); onClose() } catch (err) { setError(errorMessage(err)) } finally { setWorking(false) }
  }
  return (
    <Dialog ref={ref} aria-label="Call to action at the end" onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[620px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Megaphone className="h-4 w-4" />Call to action at the end</h2>
          <p className="mt-1 truncate text-xs text-ink-muted">{title}</p>
        </div>
        <CtaPicker value={choice} onChange={setChoice} disabled={working} />
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={working} disabled={working || choice === current} onClick={() => void apply()}>
          {working ? 'Updating the clip…' : choice ? 'Use this CTA' : 'Remove the CTA'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
