import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { HardDrive } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { formatBytes, type FreeSpace } from '../../shared/library-storage'
import { Button } from './ui/Button'
import { Dialog, DialogFooter } from './ui/Dialog'
import { FreeUpSpaceDialog } from './FreeUpSpaceDialog'

async function checkSpace(): Promise<FreeSpace | null> {
  try { return typeof getApi().storage?.freeSpace === 'function' ? await getApi().storage.freeSpace() : null } catch { return null }
}

/**
 * Before a Create or Remix run: when the output drive is nearly full, ask
 * first and offer "Free up space". `ensureSpace` resolves true to go ahead.
 * Render `element` somewhere in the page.
 */
export function useLowDiskGate(): { ensureSpace: () => Promise<boolean>; element: React.JSX.Element | null } {
  const [asking, setAsking] = useState<FreeSpace | null>(null)
  const resolver = useRef<((go: boolean) => void) | null>(null)
  const ensureSpace = useCallback(async (): Promise<boolean> => {
    const space = await checkSpace()
    // Can't tell (unknown drive): don't block the run.
    if (!space || !space.low) return true
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false)
      resolver.current = resolve
      setAsking(space)
    })
  }, [])
  const answer = useCallback((go: boolean) => {
    resolver.current?.(go)
    resolver.current = null
    setAsking(null)
  }, [])
  useEffect(() => () => { resolver.current?.(false) }, [])
  return { ensureSpace, element: asking ? <LowDiskDialog space={asking} onAnswer={answer} /> : null }
}

function LowDiskDialog({ space: initial, onAnswer }: { space: FreeSpace; onAnswer: (go: boolean) => void }): React.JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState(initial)
  const [freeing, setFreeing] = useState(false)
  useEffect(() => {
    if (freeing) return
    panelRef.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); onAnswer(false) } }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [freeing, onAnswer])
  if (freeing) {
    return <FreeUpSpaceDialog onClose={() => { setFreeing(false); void checkSpace().then((next) => { if (next) setSpace(next) }) }} />
  }
  return (
    <Dialog ref={panelRef} role="alertdialog" aria-labelledby={titleId} onBackdropMouseDown={() => onAnswer(false)} panelClassName="max-w-[440px]" data-testid="low-disk">
      <div className="space-y-2 px-5 pb-5 pt-5 text-sm text-ink-muted">
        <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-ink"><HardDrive aria-hidden className="h-4 w-4 text-warning" />{space.low ? 'Your drive is almost full' : 'There is room now'}</h2>
        {space.freeBytes !== null && <p><span className="text-ink">{formatBytes(space.freeBytes)}</span> free on the drive with your output folder.{space.low ? ` A run downloads and renders video there and can stop partway if the drive fills up. Below ${formatBytes(space.thresholdBytes)} we ask first.` : ''}</p>}
        <p className="break-all text-xs text-ink-subtle">{space.outputDirectory}</p>
      </div>
      <DialogFooter>
        <Button onClick={() => onAnswer(false)}>Cancel</Button>
        <Button onClick={() => setFreeing(true)}>Free up space</Button>
        <Button data-autofocus variant="primary" onClick={() => onAnswer(true)}>{space.low ? 'Start anyway' : 'Start'}</Button>
      </DialogFooter>
    </Dialog>
  )
}
