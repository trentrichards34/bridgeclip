import { useEffect, useState } from 'react'
import { Gamepad2, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { onRadioKeyDown } from './ui/Segmented'

interface BackgroundPickerProps {
  /** Selected library file name, or null for no background. */
  value: string | null
  onChange: (name: string | null) => void
}

/**
 * Gameplay split: the speaker on top, a looping muted video under them.
 * Videos are added once to the app's background library and reused.
 */
export function BackgroundPicker({ value, onChange }: BackgroundPickerProps): React.JSX.Element {
  const [names, setNames] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getApi().backgrounds.list().then((list) => { if (live) { setNames(list); setLoaded(true) } }).catch(() => { if (live) setError('Could not load your background videos.') })
    return () => { live = false }
  }, [])

  // A selected video removed elsewhere falls back to no background.
  useEffect(() => {
    if (value && loaded && !names.includes(value)) onChange(null)
  }, [loaded, names, value, onChange])

  const run = async (action: () => Promise<string[]>, select?: (before: string[], after: string[]) => string | null): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const before = names
      const after = await action()
      setNames(after)
      setLoaded(true)
      if (select) {
        const picked = select(before, after)
        if (picked) onChange(picked)
      }
    } catch {
      setError('That did not work. Try again with an .mp4, .mov, .m4v or .webm file.')
    } finally {
      setBusy(false)
    }
  }

  const options: { id: string | null; label: string }[] = [{ id: null, label: 'None' }, ...names.map((name) => ({ id: name, label: name }))]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Background video">
        {options.map((option) => {
          const selected = value === option.id
          return (
            <div key={option.id ?? 'none'} className="relative">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onKeyDown={onRadioKeyDown}
                onClick={() => onChange(option.id)}
                className={cn(
                  'glass-tile glass-tile-hover flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left',
                  selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink'
                )}
              >
                {option.id === null
                  ? <span className="block text-xs font-medium">None</span>
                  : <>
                      <Gamepad2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="block min-w-0 truncate pr-5 text-xs font-medium" title={option.label}>{option.label}</span>
                    </>}
              </button>
              {option.id !== null && (
                <button
                  type="button"
                  aria-label={`Remove ${option.label} from your backgrounds`}
                  disabled={busy}
                  onClick={() => { void run(() => getApi().backgrounds.remove(option.id as string)) }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-subtle transition-colors hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xs text-ink-subtle">
          {value ? 'Speaker on top, this video loops muted underneath. Captions sit on the seam.' : 'Add gameplay or “satisfying” clips to loop under the speaker.'}
        </p>
        <Button
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          disabled={busy}
          onClick={() => { void run(() => getApi().backgrounds.add(), (before, after) => after.find((name) => !before.includes(name)) ?? null) }}
        >
          Add video
        </Button>
      </div>
      {error && <p className="text-2xs text-danger" role="alert">{error}</p>}
    </div>
  )
}
