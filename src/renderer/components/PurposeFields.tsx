import { useEffect, useState } from 'react'
import { ImagePlus, Palette, X } from 'lucide-react'
import { CAPTION_PRESETS } from '../../shared/caption-presets'
import {
  MAX_PURPOSE_CHARS, REFERENCE_MAX_BYTES, deriveReferenceLook, referenceCostLine, type ReferenceImage, type ReferenceLook, type ReferenceSupport
} from '../../shared/purpose'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { Button } from './ui/Button'
import { TextInput } from './ui/Field'

/** The picture's pixels, small, through a canvas (drawn from its bytes, so the canvas can be read back). */
async function pixelsOf(bytes: Uint8Array): Promise<Uint8ClampedArray | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  const scale = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return context.getImageData(0, 0, width, height).data
}

/** In a sentence: what "Use colors from my reference" changes. */
export function referenceLookLine(look: ReferenceLook): string {
  const preset = CAPTION_PRESETS.find((item) => item.id === look.captionPreset)?.name ?? look.captionPreset
  return `Hook bar in ${look.color} and ${preset} captions (your picture is mostly ${look.light ? 'light' : 'dark'}).`
}

/**
 * "Say what it's for": an optional one-line purpose and an optional reference picture ("A look you like"), both
 * passed to the AI planning call. A suggested look is worked out from the picture on this computer.
 */
export function PurposeFields({ purpose, onPurpose, reference, onReference, model, onUseLook, purposeHelp, disabled }: {
  purpose: string
  onPurpose: (purpose: string) => void
  reference: ReferenceImage | null
  onReference: (reference: ReferenceImage | null) => void
  /** Create: its clipping mode and model decide which planner looks at the picture. */
  model?: { clippingMode?: 'quality' | 'economy' | 'advanced'; plannerModel?: string }
  /** Applies the suggested look; leave out where there's no look to change. */
  onUseLook?: (look: ReferenceLook) => void
  purposeHelp?: string
  disabled?: boolean
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [support, setSupport] = useState<ReferenceSupport | null>(null)
  const [look, setLook] = useState<ReferenceLook | null>(null)
  const [used, setUsed] = useState(false)
  const id = reference?.id ?? null
  const mode = model?.clippingMode
  const planner = model?.plannerModel

  useEffect(() => {
    setLook(null); setUsed(false)
    if (!id) return
    let live = true
    getApi().reference.bytes(id).then(async (bytes) => {
      const pixels = await pixelsOf(bytes).catch(() => null)
      if (live && pixels) setLook(deriveReferenceLook(pixels))
    }).catch(() => { if (live) setError('Your reference image is no longer there. Choose it again.') })
    return () => { live = false }
  }, [id])

  useEffect(() => {
    setSupport(null)
    if (!id) return
    let live = true
    getApi().reference.support(id, mode ? { clippingMode: mode, ...(planner ? { plannerModel: planner } : {}) } : undefined)
      .then((result) => { if (live) setSupport(result) }).catch(() => undefined)
    return () => { live = false }
  }, [id, mode, planner])

  const choose = async (): Promise<void> => {
    setError(null); setChoosing(true)
    try {
      const picked = await getApi().reference.choose()
      if (picked) onReference(picked)
    } catch (err) { setError(errorMessage(err, 'That picture could not be used.')) } finally { setChoosing(false) }
  }

  const costLine = referenceCostLine(support)
  return (
    <section className="space-y-3" aria-label="Say what it’s for" data-testid="purpose-fields">
      <label className="block">
        <span className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-ink">What’s this video for?</span>
          <span className="text-2xs text-ink-subtle">Optional</span>
        </span>
        <TextInput aria-label="What’s this video for?" value={purpose} maxLength={MAX_PURPOSE_CHARS} disabled={disabled}
          placeholder="e.g. Instagram reel selling my coaching call" onChange={(e) => onPurpose(e.target.value)} />
        <span className="mt-1 block text-2xs text-ink-subtle">{purposeHelp ?? 'The AI uses it to choose the hook, title and graphics. It’s never shown in the video.'}</span>
      </label>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-ink">A look you like</span>
          <span className="text-2xs text-ink-subtle">Optional · PNG, JPEG or WebP up to {REFERENCE_MAX_BYTES / 1024 / 1024} MB</span>
        </div>
        {reference ? (
          <div className="glass-tile flex flex-wrap items-start gap-3 rounded-xl p-2.5" data-testid="reference-card">
            <img src={localFileUrl(reference.path)} alt="Your reference" className="h-16 w-16 shrink-0 rounded-lg bg-black/30 object-cover" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-ink" title={reference.name}>{reference.name}</span>
                <Button size="sm" variant="ghost" iconOnly aria-label="Remove the reference image" icon={<X className="h-3.5 w-3.5" />} disabled={disabled}
                  onClick={() => { onReference(null); setError(null) }} />
              </p>
              {costLine && <p className={cn('text-2xs', support?.supportsImages ? 'text-ink-subtle' : 'text-warning')} data-testid="reference-support">{costLine}</p>}
              {look && onUseLook && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <span className="h-4 w-4 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]" style={{ background: look.color }} aria-hidden />
                  <span className="min-w-0 text-2xs text-ink-muted">{referenceLookLine(look)}</span>
                  <Button size="sm" variant="secondary" icon={<Palette className="h-3.5 w-3.5" />} disabled={disabled}
                    onClick={() => { onUseLook(look); setUsed(true) }}>{used ? 'Colors used' : 'Use colors from my reference'}</Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<ImagePlus className="h-3.5 w-3.5" />} loading={choosing} disabled={disabled || choosing} onClick={() => void choose()}>
              Choose a picture
            </Button>
            <span className="text-2xs text-ink-subtle">A frame or post whose style you want. The AI looks at it when your model can.</span>
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-2xs text-danger">{error}</p>}
      </div>
    </section>
  )
}
